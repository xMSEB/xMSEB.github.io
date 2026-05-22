/**
 * ui.js
 * Manages all DOM interactions: dataset picker, file inputs, sliders, view toggle.
 */

import { complexity } from './datasets.js';

const PARAMS = ['c_thr', 'numcycles', 'start_i', 'bell', 'smooth'];

export class UI {
  /**
   * @param {object} handlers
   * @param {function} handlers.onDatasetSelect - called with a dataset object (built-in)
   * @param {function} handlers.onFileChange    - called with (nodesText, edgesText) for custom
   * @param {function} handlers.onParamChange   - called when any parameter changes
   * @param {function} handlers.onViewChange    - called with 'bundled' | 'original' | 'mseb'
   * @param {function} handlers.onColorChange   - called with color map object
   * @param {Array}    datasets                 - DATASETS registry from datasets.js
   */
  constructor({ onDatasetSelect, onFileChange, onVtkFile, onParamChange, onViewChange, onColorChange }, datasets) {
    this._onDatasetSelect = onDatasetSelect;
    this._onFileChange    = onFileChange;
    this._onVtkFile       = onVtkFile;
    this._onParamChange   = onParamChange;
    this._onViewChange    = onViewChange;
    this._onColorChange   = onColorChange;
    this._datasets        = datasets;

    this._nodesText = null;
    this._edgesText = null;

    this._buildDropdown();
    this._bindFiles();
    this._bindParams();
    this._bindColors();
    this._bindViewToggle();
  }

  // ── Dataset dropdown ────────────────────────────────────────────────────────

  _buildDropdown() {
    const select = document.getElementById('dataset-select');

    for (const ds of this._datasets) {
      const opt    = document.createElement('option');
      opt.value    = ds.id;
      const effort = complexity(ds.nEdges);
      opt.textContent = effort
        ? `${ds.label}  ·  ${effort.label}`
        : ds.label;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => this._onSelectChange());
  }

  _onSelectChange() {
    const select  = document.getElementById('dataset-select');
    const ds      = this._datasets.find(d => d.id === select.value);
    const custom  = document.getElementById('custom-files');
    const badge   = document.getElementById('complexity-badge');

    if (ds.id === 'custom') {
      custom.hidden = false;
      badge.hidden  = true;
      // Reset custom file state so a fresh upload is required
      this._nodesText = null;
      this._edgesText = null;
      document.getElementById('nodes-display').textContent = 'Choose file…';
      document.getElementById('edges-display').textContent = 'Choose file…';
      document.getElementById('vtk-display').textContent   = 'Choose file…';
      document.getElementById('label-nodes').classList.remove('loaded');
      document.getElementById('label-edges').classList.remove('loaded');
      document.getElementById('label-vtk').classList.remove('loaded');
    } else {
      this.setVtkMode(false);
      custom.hidden = true;
      this._updateBadge(ds.nEdges);
      this._onDatasetSelect(ds);
    }
  }

  _updateBadge(nEdges) {
    const badge = document.getElementById('complexity-badge');
    const info  = complexity(nEdges);
    if (!info) { badge.hidden = true; return; }
    badge.textContent = info.label;
    badge.className   = `badge ${info.cls}`;
    badge.hidden      = false;
  }

  // ── Custom file inputs ──────────────────────────────────────────────────────

  _bindFiles() {
    this._bindFileInput('nodes-file', 'nodes-display', 'label-nodes', (text) => {
      this._nodesText = text;
      this._tryCustomLoad();
    });
    this._bindFileInput('edges-file', 'edges-display', 'label-edges', (text) => {
      this._edgesText = text;
      this._tryCustomLoad();
    });

    // VTK file input — read as ArrayBuffer (needed for binary VTK)
    const vtkInput   = document.getElementById('vtk-file');
    const vtkDisplay = document.getElementById('vtk-display');
    const vtkLabel   = document.getElementById('label-vtk');
    vtkInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      vtkDisplay.textContent = file.name;
      vtkLabel.classList.add('loaded');
      this._onVtkFile(await file.arrayBuffer());
    });
  }

  _bindFileInput(inputId, displayId, labelId, onLoad) {
    const input   = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    const label   = document.getElementById(labelId);

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      display.textContent = file.name;
      label.classList.add('loaded');
      onLoad(await file.text());
    });
  }

  _tryCustomLoad() {
    if (this._nodesText && this._edgesText)
      this._onFileChange(this._nodesText, this._edgesText);
  }

  // ── Parameter sliders ───────────────────────────────────────────────────────

  _bindParams() {
    for (const key of PARAMS) {
      const slider = document.getElementById(key);
      const num    = document.getElementById(`${key}-num`);

      slider.addEventListener('input', () => {
        num.value = slider.value;
        this._onParamChange();
      });

      num.addEventListener('change', () => {
        const clamped = Math.min(
          Math.max(parseFloat(num.value), parseFloat(slider.min)),
          parseFloat(slider.max),
        );
        num.value = slider.value = clamped;
        this._onParamChange();
      });
    }

    document.getElementById('directed').addEventListener('change', () => {
      this._onParamChange();
    });
  }

  // ── Color pickers ──────────────────────────────────────────────────────────

  _bindColors() {
    const ids = ['color-bundled', 'color-xmseb-cpu', 'color-original', 'color-mseb', 'color-dir-start', 'color-dir-end'];
    const notify = () => this._onColorChange(this.getColors());
    for (const id of ids) {
      const el = document.getElementById(id);
      el.addEventListener('input',  notify);
      el.addEventListener('change', notify);
    }
  }

  getColors() {
    return {
      bundled:  document.getElementById('color-bundled').value,
      xmsebCpu: document.getElementById('color-xmseb-cpu').value,
      original: document.getElementById('color-original').value,
      mseb:     document.getElementById('color-mseb').value,
      dirStart: document.getElementById('color-dir-start').value,
      dirEnd:   document.getElementById('color-dir-end').value,
    };
  }

  // ── View toggle ─────────────────────────────────────────────────────────────

  _bindViewToggle() {
    const buttons = {
      bundled:    document.getElementById('btn-bundled'),
      'xmseb-cpu': document.getElementById('btn-xmseb-cpu'),
      mseb:       document.getElementById('btn-mseb'),
      original:   document.getElementById('btn-original'),
    };

    for (const [mode, btn] of Object.entries(buttons)) {
      btn.addEventListener('click', () => {
        for (const b of Object.values(buttons)) b.classList.remove('active');
        btn.classList.add('active');
        this._onViewChange(mode);
      });
    }
  }

  // ── Public helpers ──────────────────────────────────────────────────────────

  /** Load whichever dataset (or custom files) is currently selected. */
  loadSelected() {
    this._onSelectChange();
  }

  /** Enable/disable VTK-only mode (disables view toggle and parameters). */
  setVtkMode(enabled) {
    const viewBtns = document.querySelectorAll('.view-btn');
    const paramSection = document.querySelectorAll('.section')[1]; // Parameters section
    for (const btn of viewBtns) {
      btn.disabled = enabled;
      btn.classList.toggle('disabled', enabled);
    }
    if (paramSection) {
      paramSection.classList.toggle('disabled-section', enabled);
      for (const input of paramSection.querySelectorAll('input')) {
        input.disabled = enabled;
      }
    }
  }


  getParams() {
    return {
      c_thr:     parseFloat(document.getElementById('c_thr').value),
      numcycles: parseInt  (document.getElementById('numcycles').value, 10),
      start_i:   parseInt  (document.getElementById('start_i').value,   10),
      bell:      parseFloat(document.getElementById('bell').value),
      smooth:    parseInt  (document.getElementById('smooth').value,    10),
      directed:  document.getElementById('directed').checked,
    };
  }

  setStatus(text, type = '') {
    const el = document.getElementById('status');
    el.textContent = text;
    el.className   = type;
  }
}
