// ═══════════════════════════════════════════════════════════════
// INSIGNIA EVENTS - Event handlers for the insignia editor tab
// Keeps main.js clean by encapsulating all insignia interaction.
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { InsigniaEditor } from './insignia-editor.js';
import { render } from './ui.js';
import { RANK_NAMES } from './constants.js';

// ─── Initialization ────────────────────────────────────────────

/**
 * Initialize the insignia editor when the INSIGNIA tab is opened.
 * Sets up the canvas, loads/creates the default set, renders thumbnails.
 * Safe to call multiple times — idempotent.
 */
export function initInsigniaTab() {
  const canvas = document.getElementById('insignia-canvas');
  if (!canvas) return;

  // Create or reuse the editor's working set
  if (!InsigniaEditor.currentSet) {
    InsigniaEditor.loadSet(InsigniaEditor.createDefaultSet());
  }

  // Point editor at the canvas (starts render loop if not already running)
  InsigniaEditor.init(canvas);

  // Store reference on Game so ui.js can read state for HTML generation
  Game.insigniaEditor = InsigniaEditor;

  // Wire canvas mouse events
  _bindCanvasEvents(canvas);

  // Render rank thumbnails
  _renderThumbnails();
}

// ─── Canvas Mouse Binding ──────────────────────────────────────

let _canvasBound = false;
let _spaceHeld = false;

function _bindCanvasEvents(canvas) {
  if (_canvasBound) return;
  _canvasBound = true;

  let _panning = false;
  let _panLastX = 0, _panLastY = 0;

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Middle-click or right-click: start panning
    if (e.button === 1 || e.button === 2) {
      _panning = true;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      e.preventDefault();
      return;
    }

    // Space+left-click also pans (checked via _spaceHeld)
    if (_spaceHeld && e.button === 0) {
      _panning = true;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      e.preventDefault();
      return;
    }

    InsigniaEditor.onMouseDown(x, y, e.button, e.ctrlKey || e.metaKey);
    _afterSelectionChange();
  });

  canvas.addEventListener('mousemove', e => {
    if (_panning) {
      InsigniaEditor.panX += e.clientX - _panLastX;
      InsigniaEditor.panY += e.clientY - _panLastY;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    InsigniaEditor.onMouseMove(x, y);
    // Live update props panel during drag or vertex drag
    if (InsigniaEditor._dragging || InsigniaEditor._draggingVertex) {
      _updatePropsPanel();
    }
  });

  canvas.addEventListener('mouseup', e => {
    if (_panning) {
      _panning = false;
      return;
    }
    const hadMarquee = !!InsigniaEditor._marquee;
    InsigniaEditor.onMouseUp();
    if (hadMarquee) _afterSelectionChange();
  });

  // Scroll wheel for zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    InsigniaEditor.zoom = Math.max(2, Math.min(20, InsigniaEditor.zoom + delta));
  }, { passive: false });

  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ─── Keyboard Shortcuts ────────────────────────────────────────

/**
 * Handle keydown events for the insignia editor.
 * Returns true if the key was handled.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function handleInsigniaKeyDown(e) {
  // Ctrl+C: copy selected
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (InsigniaEditor.selectedIndices.length > 0) {
      InsigniaEditor.copyShape();
      e.preventDefault();
      return true;
    }
  }
  // Ctrl+V: paste
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (InsigniaEditor.clipboard && InsigniaEditor.clipboard.length > 0) {
      InsigniaEditor.pasteShape();
      _renderAndReinit();
      e.preventDefault();
      return true;
    }
  }
  // Ctrl+A: select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    InsigniaEditor.selectAll();
    _renderAndReinit();
    e.preventDefault();
    return true;
  }
  // Delete / Backspace: delete selected
  if (e.key === 'Delete' || e.key === 'Backspace') {
    // Don't intercept if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return false;
    if (InsigniaEditor.selectedIndices.length > 0) {
      InsigniaEditor.deleteSelected();
      _renderAndReinit();
      e.preventDefault();
      return true;
    }
  }
  // Ctrl+D: duplicate selected
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    if (InsigniaEditor.selectedShapeIdx >= 0) {
      InsigniaEditor.duplicateShape(InsigniaEditor.selectedShapeIdx);
      _renderAndReinit();
      e.preventDefault();
      return true;
    }
  }
  // WASD: move selected shapes (Shift = fine, no modifier = normal)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return false;
  const moveKeys = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
  const dir = moveKeys[e.key.toLowerCase()];
  if (dir && InsigniaEditor.selectedIndices.length > 0) {
    const step = e.shiftKey ? 0.25 : 1;
    const shapes = InsigniaEditor.getCurrentShapes();
    for (const si of InsigniaEditor.selectedIndices) {
      const shape = shapes[si];
      if (shape) {
        shape.x = (shape.x || 0) + dir[0] * step;
        shape.y = (shape.y || 0) + dir[1] * step;
      }
    }
    InsigniaEditor._invalidateCache();
    _updatePropsPanel();
    e.preventDefault();
    return true;
  }
  // Space: hold for pan mode
  if (e.key === ' ') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return false;
    _spaceHeld = true;
    e.preventDefault();
    return true;
  }
  // R: reset pan/zoom to center
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return false;
    InsigniaEditor.panX = 0;
    InsigniaEditor.panY = 0;
    InsigniaEditor.zoom = 8;
    e.preventDefault();
    return true;
  }
  return false;
}

/**
 * Handle keyup for the insignia editor.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function handleInsigniaKeyUp(e) {
  if (e.key === ' ') {
    _spaceHeld = false;
    return true;
  }
  return false;
}

// ─── Click Handlers ────────────────────────────────────────────

/**
 * Handle click events delegated from main.js.
 * Returns true if the click was handled, false otherwise.
 * @param {HTMLElement} target - The event target
 * @param {MouseEvent} [event] - Original event for modifier keys
 * @returns {boolean}
 */
export function handleInsigniaClick(target, event) {
  const action = target.dataset?.action || target.closest('[data-action]')?.dataset?.action;
  if (!action || !action.startsWith('insignia-')) return false;

  const el = target.closest('[data-action]') || target;

  switch (action) {
    case 'insignia-select-rank': {
      const rank = parseInt(el.dataset.rank);
      if (!isNaN(rank) && rank >= 0 && rank <= 5) {
        InsigniaEditor.currentRank = rank;
        InsigniaEditor.selectedShapeIdx = -1;
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-add-shape': {
      const type = el.dataset.type;
      if (type) {
        if (type === 'path') {
          InsigniaEditor.startPathTool();
        } else {
          InsigniaEditor.addShape(type);
        }
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-select-shape': {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        if (event && (event.ctrlKey || event.metaKey)) {
          InsigniaEditor.toggleSelect(idx);
        } else {
          InsigniaEditor.selectShape(idx);
        }
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-shape-up': {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        InsigniaEditor.moveShapeUp(idx);
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-shape-down': {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        InsigniaEditor.moveShapeDown(idx);
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-shape-dup': {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        InsigniaEditor.duplicateShape(idx);
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-shape-del': {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        InsigniaEditor.removeShape(idx);
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-save': {
      _saveSet();
      return true;
    }

    case 'insignia-load': {
      _showLoadDialog();
      return true;
    }

    case 'insignia-delete': {
      _deleteCurrentSet();
      return true;
    }

    case 'insignia-load-item': {
      const id = el.dataset.setId;
      if (id) _loadSetById(id);
      return true;
    }

    case 'insignia-load-cancel': {
      _renderAndReinit();
      return true;
    }

    case 'insignia-finish-path': {
      InsigniaEditor.finishPath();
      _renderAndReinit();
      return true;
    }

    case 'insignia-cancel-path': {
      InsigniaEditor.cancelPath();
      _renderAndReinit();
      return true;
    }

    default:
      return false;
  }
}

// ─── Input (Slider/Color) Handlers ─────────────────────────────

/**
 * Handle input events (sliders, color pickers) delegated from main.js.
 * Returns true if the event was handled.
 * @param {HTMLElement} target
 * @returns {boolean}
 */
export function handleInsigniaInput(target) {
  const action = target.dataset?.action;

  if (action === 'insignia-prop') {
    const key = target.dataset.key;
    const idx = parseInt(target.dataset.idx);
    const val = parseFloat(target.value);
    if (key && !isNaN(idx) && !isNaN(val)) {
      _setShapeProp(idx, key, val);
      // Update the display span next to the slider
      const valSpan = target.nextElementSibling;
      if (valSpan?.classList.contains('prop-val')) {
        valSpan.textContent = Number.isInteger(val) ? val : val.toFixed(2);
      }
    }
    return true;
  }

  if (action === 'insignia-color') {
    const key = target.dataset.key;
    const idx = parseInt(target.dataset.idx);
    if (key && !isNaN(idx)) {
      _setShapeProp(idx, key, target.value);
    }
    return true;
  }

  if (action === 'insignia-toggle') {
    // Checkboxes: flipX, flipY, fillEnabled
    const key = target.dataset.key;
    const idx = parseInt(target.dataset.idx);
    if (key && !isNaN(idx)) {
      _setShapeProp(idx, key, target.checked);
      // fillEnabled/verticalEnds toggle needs full re-render to show/hide dependent rows
      if (key === 'fillEnabled' || key === 'verticalEnds') _renderAndReinit();
    }
    return true;
  }

  if (action === 'insignia-select') {
    // Dropdowns: lineCap, lineJoin, capStyle
    const key = target.dataset.key;
    const idx = parseInt(target.dataset.idx);
    if (key && !isNaN(idx)) {
      _setShapeProp(idx, key, target.value);
      // capStyle change shows/hides capSize slider
      if (key === 'capStyle') _renderAndReinit();
    }
    return true;
  }

  return false;
}

// ─── Render + Reinit ───────────────────────────────────────────

/**
 * Call render() to rebuild DOM, then re-attach the editor canvas.
 * Must be used instead of bare render() since render() destroys the canvas element.
 */
function _renderAndReinit() {
  render();
  setTimeout(() => {
    const canvas = document.getElementById('insignia-canvas');
    if (canvas) {
      _canvasBound = false;
      _bindCanvasEvents(canvas);
      InsigniaEditor.init(canvas);
      _renderThumbnails();
    }
  }, 0);
}

// ─── Shape Property Mutation ───────────────────────────────────

function _setShapeProp(idx, key, value) {
  const shapes = InsigniaEditor.getCurrentShapes();
  if (idx < 0 || idx >= shapes.length) return;

  // Apply to all selected shapes if the source shape is among them
  const selected = InsigniaEditor.selectedIndices;
  if (selected.length > 1 && selected.includes(idx)) {
    for (const si of selected) {
      if (si >= 0 && si < shapes.length) {
        shapes[si][key] = value;
      }
    }
  } else {
    shapes[idx][key] = value;
  }

  InsigniaEditor._invalidateCache();
  _renderThumbnails();
}

// ─── Selection Change ──────────────────────────────────────────

function _afterSelectionChange() {
  _renderAndReinit();
}

function _updatePropsPanel() {
  // Lightweight update: just the slider values, not full render
  const shape = InsigniaEditor.getSelectedShape();
  if (!shape) return;

  const inputs = document.querySelectorAll('[data-action="insignia-prop"]');
  for (const input of inputs) {
    const key = input.dataset.key;
    if (key && shape[key] !== undefined) {
      input.value = shape[key];
      const valSpan = input.nextElementSibling;
      if (valSpan?.classList.contains('prop-val')) {
        const v = shape[key];
        valSpan.textContent = Number.isInteger(v) ? v : (typeof v === 'number' ? v.toFixed(2) : v);
      }
    }
  }
}

// ─── Thumbnails ────────────────────────────────────────────────

function _renderThumbnails() {
  const thumbCanvases = document.querySelectorAll('.insignia-rank-thumb');
  for (const tc of thumbCanvases) {
    const rank = parseInt(tc.dataset.rank);
    if (isNaN(rank)) continue;

    const ctx = tc.getContext('2d');
    ctx.clearRect(0, 0, tc.width, tc.height);

    // Draw background
    ctx.fillStyle = rank === InsigniaEditor.currentRank ? '#2a2a3a' : '#1a1a2a';
    ctx.fillRect(0, 0, tc.width, tc.height);

    // Draw the rank insignia
    InsigniaEditor.renderThumbnail(ctx, rank, tc.width);
  }
}

// ─── Save / Load / Delete ──────────────────────────────────────

async function _saveSet() {
  const set = InsigniaEditor.currentSet;
  if (!set) return;

  // Update name from input
  const nameInput = document.getElementById('insignia-set-name');
  if (nameInput) set.name = nameInput.value || 'Untitled';

  set.updatedAt = Date.now();

  try {
    const res = await fetch('/api/insignia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(set)
    });
    if (res.ok) {
      console.log('[Insignia] Set saved:', set.id);
    } else {
      console.error('[Insignia] Save failed:', res.status);
    }
  } catch (err) {
    console.error('[Insignia] Save error:', err);
  }
}

async function _showLoadDialog() {
  try {
    const res = await fetch('/api/insignia');
    if (!res.ok) return;
    const sets = await res.json();

    // Build a simple inline list in the props panel
    const propsDiv = document.querySelector('.insignia-props');
    if (!propsDiv) return;

    if (sets.length === 0) {
      propsDiv.innerHTML = '<p style="color:var(--text-secondary);margin:8px;">No saved sets</p>' +
        '<button data-action="insignia-load-cancel">Back</button>';
      return;
    }

    propsDiv.innerHTML = '<h4>Load Set</h4>' +
      sets.map(s => `
        <div class="insignia-layer-item" data-action="insignia-load-item" data-set-id="${s.id}" style="cursor:pointer;">
          <span class="layer-label">${s.name || s.id}</span>
        </div>
      `).join('') +
      '<button data-action="insignia-load-cancel" style="margin-top:8px;">Cancel</button>';
  } catch (err) {
    console.error('[Insignia] Load list error:', err);
  }
}

async function _loadSetById(id) {
  try {
    const res = await fetch(`/api/insignia/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const set = await res.json();
    InsigniaEditor.loadSet(set);
    _renderThumbnails();
    render();
    // Re-init canvas after render
    setTimeout(() => {
      const canvas = document.getElementById('insignia-canvas');
      if (canvas) {
        _canvasBound = false;
        _bindCanvasEvents(canvas);
        InsigniaEditor.init(canvas);
        _renderThumbnails();
      }
    }, 0);
  } catch (err) {
    console.error('[Insignia] Load error:', err);
  }
}

async function _deleteCurrentSet() {
  const set = InsigniaEditor.currentSet;
  if (!set) return;

  try {
    await fetch(`/api/insignia/${encodeURIComponent(set.id)}`, { method: 'DELETE' });
    // Reset to default
    InsigniaEditor.loadSet(InsigniaEditor.createDefaultSet());
    _renderThumbnails();
    render();
  } catch (err) {
    console.error('[Insignia] Delete error:', err);
  }
}
