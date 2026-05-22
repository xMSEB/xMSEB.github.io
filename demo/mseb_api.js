/**
 * mseb_api.js
 * Thin wrapper around the mseb WASM module.
 * Lazily loads the script on first call to initMseb().
 */

let M = null;

/**
 * Load and initialise the mseb WASM module.
 * Safe to call multiple times — only loads once.
 */
export async function initMseb() {
  if (M) return;

  // Dynamically inject the script. Both modules export as BundlerModule,
  // so save the existing value and restore it after capturing mseb's factory.
  const factory = await new Promise((resolve, reject) => {
    const prev   = window.BundlerModule;
    const script = document.createElement('script');
    script.src   = '../mseb_wasm/bundler.js';
    script.onload = () => {
      const msebFactory  = window.BundlerModule;
      window.BundlerModule = prev;   // restore bundler_wasm's factory
      resolve(msebFactory);
    };
    script.onerror = () => reject(new Error('Failed to load mseb_wasm/bundler.js'));
    document.head.appendChild(script);
  });

  M = await factory({
    locateFile: (path) => `../mseb_wasm/${path}`,
  });
}

/**
 * Run the mseb bundling algorithm.
 *
 * @param {Array<{x,y,z}>} nodeList
 * @param {Array<{from,to,weight}>} edgeList
 * @param {{c_thr, numcycles, start_i, bell, smooth, directed}} params
 * @returns parsed JSON: { edges: [{points:[[x,y,z],...], weight, startCluster, endCluster}] }
 */
export function runMseb(nodeList, edgeList, params) {
  if (!M) throw new Error('MSEB not initialised — call initMseb() first');

  const numNodes = nodeList.length;
  const numEdges = edgeList.length;

  const nodeCoords    = new Float32Array(numNodes * 3);
  const edgeEndpoints = new Int32Array(numEdges * 2);
  const edgeWeights   = new Float32Array(numEdges);

  for (let i = 0; i < numNodes; i++) {
    nodeCoords[i * 3]     = nodeList[i].x;
    nodeCoords[i * 3 + 1] = nodeList[i].y;
    nodeCoords[i * 3 + 2] = nodeList[i].z;
  }

  for (let i = 0; i < numEdges; i++) {
    edgeEndpoints[i * 2]     = edgeList[i].from;
    edgeEndpoints[i * 2 + 1] = edgeList[i].to;
    edgeWeights[i]           = edgeList[i].weight ?? 1.0;
  }

  const nBuf = M._malloc(nodeCoords.byteLength);
  const eBuf = M._malloc(edgeEndpoints.byteLength);
  const wBuf = M._malloc(edgeWeights.byteLength);

  new Float32Array(M.HEAPU8.buffer, nBuf, nodeCoords.length).set(nodeCoords);
  new Int32Array  (M.HEAPU8.buffer, eBuf, edgeEndpoints.length).set(edgeEndpoints);
  new Float32Array(M.HEAPU8.buffer, wBuf, edgeWeights.length).set(edgeWeights);

  const ptr = M._bundler_run(
    nBuf, numNodes,
    eBuf, wBuf, numEdges,
    params.c_thr,
    params.numcycles,
    params.start_i,
    params.bell,
    params.smooth,
    params.directed ? 1 : 0,
  );

  const json = M.UTF8ToString(ptr);

  M._bundler_free();
  M._free(nBuf);
  M._free(eBuf);
  M._free(wBuf);

  return JSON.parse(json);
}
