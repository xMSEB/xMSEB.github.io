/**
 * bundler_api.js
 * Thin wrapper around the Emscripten WASM module.
 * Handles memory allocation/deallocation and JSON parsing.
 */

let M = null;

/**
 * Load and initialise the WASM module.
 * Must be called once before runBundler().
 */
export async function initBundler() {
  if (!window.BundlerModule) throw new Error('BundlerModule script not loaded');
  M = await window.BundlerModule({
    // bundler.wasm lives one directory up from the demo
    locateFile: (path) => `../bundler_wasm/${path}`,
  });
}

/**
 * Run the bundling algorithm.
 *
 * @param {Array<{x,y,z}>} nodeList
 * @param {Array<{from,to,weight}>} edgeList
 * @param {{c_thr, numcycles, start_i, bell, smooth, directed}} params
 * @returns parsed JSON: { edges: [{points:[[x,y,z],...], weight, startCluster, endCluster}] }
 */
export async function runBundler(nodeList, edgeList, params) {
  if (!M) throw new Error('Bundler not initialised — call initBundler() first');

  const numNodes = nodeList.length;
  const numEdges = edgeList.length;

  // Build flat typed arrays expected by the C API
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

  // Allocate WASM heap memory
  const nBuf = M._malloc(nodeCoords.byteLength);
  const eBuf = M._malloc(edgeEndpoints.byteLength);
  const wBuf = M._malloc(edgeWeights.byteLength);

  // Copy into WASM heap (HEAPU8.buffer is the underlying ArrayBuffer)
  new Float32Array(M.HEAPU8.buffer, nBuf, nodeCoords.length).set(nodeCoords);
  new Int32Array  (M.HEAPU8.buffer, eBuf, edgeEndpoints.length).set(edgeEndpoints);
  new Float32Array(M.HEAPU8.buffer, wBuf, edgeWeights.length).set(edgeWeights);

  // bundler_run uses emscripten_sleep internally (ASYNCIFY) — must use ccall with
  // {async: true} so Emscripten wraps the ASYNCIFY unwind/rewind into a Promise.
  // Calling M._bundler_run() synchronously would return a sentinel and flood the
  // event loop with dangling continuations, hanging the page.
  const ptr = await M.ccall(
    'bundler_run',
    'number',
    ['number','number','number','number','number',
     'number','number','number','number','number','number'],
    [nBuf, numNodes, eBuf, wBuf, numEdges,
     params.c_thr, params.numcycles, params.start_i,
     params.bell, params.smooth, params.directed ? 1 : 0],
    { async: true },
  );

  const json = M.UTF8ToString(ptr);

  // Free WASM allocations
  M._bundler_free();
  M._free(nBuf);
  M._free(eBuf);
  M._free(wBuf);

  return JSON.parse(json);
}

/**
 * Return the .fib binary from the most recent runBundler() call as a Uint8Array.
 * Frees the internal buffer — call once per run.
 */
export function getLastFibGPU() {
  if (!M) throw new Error('GPU bundler not initialised — call initBundler() first');
  const sizePtr = M._malloc(4);
  const fibPtr  = M._bundler_get_fib(sizePtr);
  const size    = new Int32Array(M.HEAPU8.buffer, sizePtr, 1)[0];
  const data    = new Uint8Array(M.HEAPU8.buffer, fibPtr, size).slice();
  M._free(sizePtr);
  M._bundler_free_fib();
  return data;
}
