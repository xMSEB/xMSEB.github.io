/**
 * main.js
 * Wires together the WASM bundler, Three.js scene, and UI controls.
 */

import { initBundler,    runBundler,    getLastFibGPU } from './bundler_api.js';
import { initBundlerCPU, runBundlerCPU, getLastFibCPU } from './bundler_api_cpu.js';
import { initMseb,       runMseb       } from './mseb_api.js';
import { Scene }                   from './scene.js';
import { UI }                      from './ui.js';
import { DATASETS }                from './datasets.js';

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseNodes(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [x, y, z] = l.split(/\s+/).map(Number);
      return { x, y, z };
    })
    .filter(n => !isNaN(n.x) && !isNaN(n.y) && !isNaN(n.z));
}

function parseEdges(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const parts = l.split(/\s+/);
      if (parts.length < 2) return null;
      return {
        from:   parseInt(parts[0], 10),
        to:     parseInt(parts[1], 10),
        weight: parts[2] ? parseFloat(parts[2]) : 1.0,
      };
    })
    .filter(Boolean);
}

// ── VTK parser (ASCII + Binary) ──────────────────────────────────────────────

/**
 * Parse a VTK polydata file (ASCII or Binary) into nodes and polyline edges.
 * @param {ArrayBuffer} buffer - raw file contents
 * @returns {{ nodes: Array<{x,y,z}>, edges: Array<{points: Array<{x,y,z}>}> }}
 */
function parseVTK(buffer) {
  // Decode enough of the header to detect format — header is always ASCII text
  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  const headerText  = new TextDecoder('ascii').decode(headerBytes);
  const isBinary    = /\bBINARY\b/i.test(headerText);

  return isBinary ? parseVTKBinary(buffer, headerText) : parseVTKAscii(buffer);
}

function parseVTKAscii(buffer) {
  const text  = new TextDecoder('utf-8').decode(buffer);
  const lines = text.split('\n').map(l => l.trim());

  const nodes = [];
  const edges = [];
  let i = 0;

  // Skip to POINTS
  while (i < lines.length && !lines[i].startsWith('POINTS')) i++;
  if (i >= lines.length) throw new Error('No POINTS section found in VTK file');
  const np = parseInt(lines[i].split(/\s+/)[1], 10);
  i++;

  for (let p = 0; p < np; p++, i++) {
    const [x, y, z] = lines[i].split(/\s+/).map(Number);
    nodes.push({ x, y, z });
  }

  // Skip to LINES
  while (i < lines.length && !lines[i].startsWith('LINES')) i++;
  if (i >= lines.length) throw new Error('No LINES section found in VTK file');
  const nLines = parseInt(lines[i].split(/\s+/)[1], 10);
  i++;

  for (let l = 0; l < nLines; l++, i++) {
    const parts    = lines[i].split(/\s+/).map(Number);
    const numPts   = parts[0];
    const points   = [];
    for (let j = 1; j <= numPts; j++) {
      points.push(nodes[parts[j]]);
    }
    edges.push({ points });
  }

  return { nodes, edges };
}

function parseVTKBinary(buffer, headerText) {
  const headerLines = headerText.split('\n');

  // Find byte offset right after the line containing "POINTS ..."
  let textOffset = 0;
  let np = 0;
  for (const line of headerLines) {
    textOffset += line.length + 1; // +1 for \n
    if (line.startsWith('POINTS')) {
      np = parseInt(line.split(/\s+/)[1], 10);
      break;
    }
  }

  // Read points — big-endian Float32
  const view  = new DataView(buffer);
  let offset  = textOffset;
  const nodes = [];
  for (let i = 0; i < np; i++) {
    const x = view.getFloat32(offset,     false); offset += 4;
    const y = view.getFloat32(offset,     false); offset += 4;
    const z = view.getFloat32(offset,     false); offset += 4;
    nodes.push({ x, y, z });
  }

  // After points data there's a newline, then the LINES header line
  // Scan for "LINES" in the bytes after the point data
  offset++; // skip newline after binary point data
  let linesHeader = '';
  while (offset < buffer.byteLength) {
    const ch = String.fromCharCode(view.getUint8(offset));
    offset++;
    if (ch === '\n') break;
    linesHeader += ch;
  }

  const linesParts = linesHeader.split(/\s+/);
  const nLines     = parseInt(linesParts[1], 10);

  // Read line connectivity — big-endian Int32
  const edges = [];
  for (let l = 0; l < nLines; l++) {
    const numPts = view.getInt32(offset, false); offset += 4;
    const points = [];
    for (let j = 0; j < numPts; j++) {
      const idx = view.getInt32(offset, false); offset += 4;
      points.push(nodes[idx]);
    }
    edges.push({ points });
  }

  return { nodes, edges };
}

// ── WebGPU detection ─────────────────────────────────────────────────────────

/**
 * Probe for WebGPU support. The check has to cover three failure modes that all
 * lead to "silently falls back to CPU":
 *   1. `navigator.gpu` missing (Firefox stable < 141, Safari without the flag)
 *   2. `requestAdapter()` resolves to null (compatible API but no usable GPU)
 *   3. A fallback / software adapter is returned (Firefox on some configs hands
 *      out an adapter whose backend is software-only — the bundler "runs" but at
 *      CPU-like speed and the user can't tell the GPU path is broken).
 * We also confirm a device can actually be acquired, since that's the next step
 * the WASM does and any failure there is what surfaces as the silent fallback.
 */
async function isWebGPUAvailable() {
  if (!('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    if (adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return false;
    // Firefox exposes a GPUAdapterInfo whose vendor/architecture/device/description
    // are all empty strings when WebGPU isn't really usable on the system (the
    // compute pipeline runs but silently produces no work). A populated info
    // object — even partially — indicates a real backend.
    const info = adapter.info;
    if (info && !info.vendor && !info.architecture && !info.device && !info.description) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── App ──────────────────────────────────────────────────────────────────────

async function main() {
  // Probe WebGPU once at startup. We surface the warning only when the GPU view
  // is selected — CPU and MSEB still work, so on other views it'd be noise.
  const webgpuOK = await isWebGPUAvailable();
  const warningEl = document.getElementById('webgpu-warning');
  const updateWebGPUWarning = (mode) => {
    if (warningEl) warningEl.hidden = webgpuOK || mode !== 'bundled';
  };

  const scene = new Scene(document.getElementById('canvas'));
  const ui    = new UI(
    { onDatasetSelect, onFileChange, onVtkFile, onParamChange, onViewChange, onColorChange },
    DATASETS,
  );

  // Screenshot button
  document.getElementById('btn-screenshot').addEventListener('click', () => {
    scene.screenshot();
  });

  let currentNodes  = null;
  let currentEdges  = null;
  let debounceTimer = null;
  let isRunning     = false;
  let pendingRun    = false;
  let bundlerReady  = false;
  let fitCamera     = true;  // reset on new dataset, preserved on param changes

  // mseb state — kept separate, run lazily on first 'mseb' view switch
  let msebValid   = false;   // false = cached result is stale, re-run on next view
  let msebRunning = false;
  // xmseb-cpu state — run lazily on first 'xmseb-cpu' view switch
  let xmsebCpuValid   = false;
  let xmsebCpuRunning = false;
  let viewMode    = 'bundled';
  updateWebGPUWarning(viewMode);

  // Cached results for export — populated as each technique runs
  let exportBundled  = null;
  let exportXmsebCpu = null;
  let exportMseb     = null;
  let exportOriginal = null;

  /**
   * window.exportJSON()
   * Downloads the current bundled results as a JSON file.
   * All three techniques are included if they have been computed.
   * Open the browser console and run: exportJSON()
   */
  window.exportJSON = function (filename = 'graph.json') {
    if (!currentNodes) { console.warn('exportJSON: no data loaded yet'); return; }
    const normalise = pts =>
      pts.map(p => Array.isArray(p) ? p : [p.x, p.y, p.z]);
    const serialiseEdges = edges =>
      edges ? edges.map(e => ({ points: normalise(e.points), weight: e.weight ?? 1 })) : null;
    const payload = {
      nodes:    currentNodes.map(n => ({ x: n.x, y: n.y, z: n.z })),
      xmseb:    serialiseEdges(exportBundled),
      xmsebCpu: serialiseEdges(exportXmsebCpu),
      mseb:     serialiseEdges(exportMseb),
      original: serialiseEdges(exportOriginal),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click();
    URL.revokeObjectURL(a.href);
    console.log(`exportJSON: saved ${filename}`);
  };

  // Init WASM first, then trigger the selected dataset load.
  // Sequential is simpler and avoids any race between the fetch and bundler init.
  ui.setStatus('Initialising bundler…');
  try {
    await initBundler();
    bundlerReady = true;
  } catch (err) {
    ui.setStatus('Failed to load WASM: ' + err.message, 'error');
    console.error(err);
    return;
  }
  ui.loadSelected();

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function onDatasetSelect(ds) {
    ui.setStatus(`Fetching ${ds.label}…`);
    try {
      const [nodesText, edgesText] = await Promise.all([
        fetch(ds.nodes).then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); }),
        fetch(ds.edges).then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); }),
      ]);
      onFileChange(nodesText, edgesText);
    } catch (err) {
      ui.setStatus(`Failed to load ${ds.label}: ${err.message}`, 'error');
    }
  }

  function onFileChange(nodesText, edgesText) {
    currentNodes    = parseNodes(nodesText);
    currentEdges    = parseEdges(edgesText);
    fitCamera       = true;
    msebValid       = false;
    xmsebCpuValid   = false;
    scheduleRun();
  }

  function onParamChange() {
    if (!currentNodes || !currentEdges) return;
    msebValid     = false;
    xmsebCpuValid = false;
    // Don't reset camera when only parameters change
    scheduleRun();
  }

  function onViewChange(mode) {
    viewMode = mode;
    scene.setViewMode(mode);
    updateWebGPUWarning(mode);
    if (mode === 'mseb' && !msebValid && !msebRunning) {
      runMsebNow();
    }
    if (mode === 'xmseb-cpu' && !xmsebCpuValid && !xmsebCpuRunning) {
      runXmsebCpuNow();
    }
  }

  function onColorChange(colors) {
    scene.setColors(colors);
  }

  function onVtkFile(arrayBuffer) {
    try {
      ui.setStatus('Parsing VTK file…');
      const { nodes, edges } = parseVTK(arrayBuffer);
      document.getElementById('empty-msg').style.display = 'none';

      // In VTK mode we show the polylines directly — no bundling
      ui.setVtkMode(true);
      scene.setData(nodes, edges, edges, true, false);
      ui.setStatus(`VTK: ${edges.length} edges · ${nodes.length} points`, 'ok');
    } catch (err) {
      ui.setStatus('VTK error: ' + err.message, 'error');
      console.error(err);
    }
  }

  document.getElementById('theme-toggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'light' : 'dark';
    document.body.classList.toggle('light', e.target.checked);
    scene.setTheme(theme);
  });

  // ── Debounced run ──────────────────────────────────────────────────────────

  function scheduleRun() {
    if (!bundlerReady) return;
    clearTimeout(debounceTimer);
    ui.setStatus('Re-bundling in 0.5 s…', 'waiting');
    debounceTimer = setTimeout(run, 500);
  }

  async function run() {
    if (isRunning) { pendingRun = true; return; }

    isRunning = true;
    document.getElementById('empty-msg').style.display = 'none';
    document.getElementById('spinner').hidden = false;
    ui.setStatus('Bundling…', 'running');

    // Yield so the status + spinner render before the WASM call starts.
    await new Promise(r => setTimeout(r, 30));

    try {
      const t0     = performance.now();
      const params = ui.getParams();
      const result = await runBundler(currentNodes, currentEdges, params);
      const ms     = Math.round(performance.now() - t0);

      const originalEdges = currentEdges.map(e => ({
        points: [currentNodes[e.from], currentNodes[e.to]],
      }));

      exportBundled  = result.edges;
      exportOriginal = originalEdges;
      scene.setData(currentNodes, result.edges, originalEdges, fitCamera, params.directed);
      fitCamera = false;
      ui.setStatus(
        `${result.edges.length} edges · ${currentNodes.length} nodes · ${ms} ms`,
        'ok',
      );
      if (viewMode === 'mseb' && !msebValid && !msebRunning) {
        runMsebNow();
      }
      if (viewMode === 'xmseb-cpu' && !xmsebCpuValid && !xmsebCpuRunning) {
        runXmsebCpuNow();
      }
    } catch (err) {
      ui.setStatus('Error: ' + err.message, 'error');
      console.error(err);
    } finally {
      isRunning = false;
      document.getElementById('spinner').hidden = true;
      if (pendingRun) {
        pendingRun = false;
        scheduleRun();
      }
    }
  }
  async function runXmsebCpuNow() {
    if (!currentNodes || !currentEdges) return;
    xmsebCpuRunning = true;
    document.getElementById('spinner').hidden = false;
    ui.setStatus('Running xMSEB (CPU)…', 'running');

    await new Promise(r => setTimeout(r, 30));

    try {
      await initBundlerCPU();
      const t0     = performance.now();
      const params = ui.getParams();
      const result = runBundlerCPU(currentNodes, currentEdges, params);
      const ms     = Math.round(performance.now() - t0);

      exportXmsebCpu = result.edges;
      scene.setXmsebCpuLines(result.edges);
      xmsebCpuValid = true;
      ui.setStatus(
        `xMSEB (CPU): ${result.edges.length} edges · ${currentNodes.length} nodes · ${ms} ms`,
        'ok',
      );
    } catch (err) {
      ui.setStatus('xMSEB (CPU) error: ' + err.message, 'error');
      console.error(err);
    } finally {
      xmsebCpuRunning = false;
      document.getElementById('spinner').hidden = true;
    }
  }

  async function runMsebNow() {
    if (!currentNodes || !currentEdges) return;
    msebRunning = true;
    document.getElementById('spinner').hidden = false;
    ui.setStatus('Running MSEB…', 'running');

    // Yield so status + spinner render before the synchronous WASM call blocks.
    await new Promise(r => setTimeout(r, 30));

    try {
      await initMseb();
      const t0     = performance.now();
      const params = ui.getParams();
      const result = runMseb(currentNodes, currentEdges, params);
      const ms     = Math.round(performance.now() - t0);

      exportMseb = result.edges;
      scene.setMsebLines(result.edges);
      msebValid = true;
      ui.setStatus(
        `MSEB: ${result.edges.length} edges · ${currentNodes.length} nodes · ${ms} ms`,
        'ok',
      );
    } catch (err) {
      ui.setStatus('MSEB error: ' + err.message, 'error');
      console.error(err);
    } finally {
      msebRunning = false;
      document.getElementById('spinner').hidden = true;
    }
  }
}

main().catch(console.error);

// ── Console download helpers (not in UI) ─────────────────────────────────────

function _triggerFibDownload(data, filename) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

window.downloadFibCPU = function(filename = 'bundled.fib') {
  _triggerFibDownload(getLastFibCPU(), filename);
};

window.downloadFibGPU = function(filename = 'bundled.fib') {
  _triggerFibDownload(getLastFibGPU(), filename);
};
