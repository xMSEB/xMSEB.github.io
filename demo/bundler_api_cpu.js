/**
 * bundler_api_cpu.js
 * Thin wrapper around the CPU WASM module (no WebGPU).
 * Lazily loads the script on first call to initBundlerCPU().
 */

let M = null;

/**
 * Load and initialise the CPU WASM module.
 * Safe to call multiple times — only loads once.
 */
export async function initBundlerCPU() {
  if (M) return;

  // Dynamically inject the script. BundlerModuleCPU is a distinct export name
  // so it doesn't collide with window.BundlerModule (GPU build).
  // Keep onload synchronous (not async) so that errors from factory() propagate
  // correctly — an async onload swallows rejections inside the Promise executor.
  const factory = await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src   = '../bundler_wasm/bundler_cpu.js';
    script.onload = () => {
      if (!window.BundlerModuleCPU)
        return reject(new Error('BundlerModuleCPU not found after script load'));
      resolve(window.BundlerModuleCPU);
    };
    script.onerror = () => reject(new Error('Failed to load bundler_wasm/bundler_cpu.js'));
    document.head.appendChild(script);
  });
  M = await factory({ locateFile: (path) => `../bundler_wasm/${path}` });
}

/**
 * Run the CPU bundling algorithm (synchronous — no ASYNCIFY).
 *
 * @param {Array<{x,y,z}>} nodeList
 * @param {Array<{from,to,weight}>} edgeList
 * @param {{c_thr, numcycles, start_i, bell, smooth, directed}} params
 * @returns parsed JSON: { edges: [{points:[[x,y,z],...], weight, startCluster, endCluster}] }
 */
export function runBundlerCPU(nodeList, edgeList, params) {
  if (!M) throw new Error('CPU bundler not initialised — call initBundlerCPU() first');

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

/**
 * Return the .fib binary from the most recent runBundlerCPU() call as a Uint8Array.
 * Frees the internal buffer — call once per run.
 */
export function getLastFibCPU() {
  if (!M) throw new Error('CPU bundler not initialised — call initBundlerCPU() first');
  const sizePtr = M._malloc(4);
  const fibPtr  = M._bundler_get_fib(sizePtr);
  const size    = new Int32Array(M.HEAPU8.buffer, sizePtr, 1)[0];
  const data    = new Uint8Array(M.HEAPU8.buffer, fibPtr, size).slice();
  M._free(sizePtr);
  M._bundler_free_fib();
  return data;
}
