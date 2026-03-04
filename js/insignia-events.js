// ═══════════════════════════════════════════════════════════════
// INSIGNIA EVENTS - Event handlers for the insignia editor tab
// Keeps main.js clean by encapsulating all insignia interaction.
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { InsigniaEditor } from './insignia-editor.js';
import { render } from './ui.js';
import { RANK_NAMES } from './constants.js';
import * as pxl from './insignia-pixel.js';
import { buildPreset } from './insignia-presets.js';
import { cacheInsigniaSet } from './insignia-renderer.js';

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
    // Try to load the active battle set, otherwise create a fresh default
    const activeId = Game.settings.insigniaSetId;
    if (activeId) {
      // Load async — init with default first, replace when loaded
      InsigniaEditor.loadSet(InsigniaEditor.createDefaultSet());
      fetch(`/api/insignia/${encodeURIComponent(activeId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(set => {
          if (set) {
            InsigniaEditor.loadSet(set);
            _renderThumbnails();
            const nameInput = document.getElementById('insignia-set-name');
            if (nameInput) nameInput.value = set.name || 'Untitled';
          }
        })
        .catch(() => {});
    } else {
      InsigniaEditor.loadSet(InsigniaEditor.createDefaultSet());
    }
  }

  // Point editor at the canvas (starts render loop if not already running)
  InsigniaEditor.init(canvas);

  // Store reference on Game so ui.js can read state for HTML generation
  Game.insigniaEditor = InsigniaEditor;

  // Wire canvas mouse events
  _bindCanvasEvents(canvas);

  // Render rank thumbnails
  _renderThumbnails();

  // Populate battle set dropdown
  _populateBattleSetDropdown();
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
    // Middle-click or right-click: start panning (both modes)
    if (e.button === 1 || e.button === 2) {
      _panning = true;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      e.preventDefault();
      return;
    }

    // Space+left-click also pans (both modes)
    if (_spaceHeld && e.button === 0) {
      _panning = true;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      e.preventDefault();
      return;
    }

    // Pixel mode: route to pixel engine
    if (InsigniaEditor.mode === 'pixel') {
      const pos = pxl.canvasToPixel(canvas, e);
      pxl.strokeStart(InsigniaEditor, pos.x, pos.y);
      _renderThumbnails();
      return;
    }

    // Vector mode
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
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

    // Pixel mode: route to pixel engine
    if (InsigniaEditor.mode === 'pixel') {
      const pos = pxl.canvasToPixel(canvas, e);
      pxl.strokeMove(InsigniaEditor, pos.x, pos.y);
      return;
    }

    // Vector mode
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    InsigniaEditor.onMouseMove(x, y);
    if (InsigniaEditor._dragging || InsigniaEditor._draggingVertex) {
      _updatePropsPanel();
    }
  });

  canvas.addEventListener('mouseup', e => {
    if (_panning) {
      _panning = false;
      return;
    }

    // Pixel mode: end stroke
    if (InsigniaEditor.mode === 'pixel') {
      const pos = pxl.canvasToPixel(canvas, e);
      pxl.strokeEnd(InsigniaEditor, pos.x, pos.y);
      _renderThumbnails();
      return;
    }

    // Vector mode
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

  // Touch events for pixel mode drawing
  canvas.addEventListener('touchstart', e => {
    if (InsigniaEditor.mode !== 'pixel') return;
    e.preventDefault();
    const touch = e.touches[0];
    const pos = pxl.canvasToPixel(canvas, touch);
    pxl.strokeStart(InsigniaEditor, pos.x, pos.y);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (InsigniaEditor.mode !== 'pixel') return;
    e.preventDefault();
    const touch = e.touches[0];
    const pos = pxl.canvasToPixel(canvas, touch);
    pxl.strokeMove(InsigniaEditor, pos.x, pos.y);
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (InsigniaEditor.mode !== 'pixel') return;
    e.preventDefault();
    pxl.strokeEnd(InsigniaEditor, 0, 0);
    _renderThumbnails();
  }, { passive: false });
}

// ─── Keyboard Shortcuts ────────────────────────────────────────

/**
 * Handle keydown events for the insignia editor.
 * Returns true if the key was handled.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function handleInsigniaKeyDown(e) {
  // Pixel mode: Ctrl+Z/Y for undo/redo
  if (InsigniaEditor.mode === 'pixel' && (e.ctrlKey || e.metaKey)) {
    if (e.key === 'z') {
      if (pxl.undo(InsigniaEditor)) {
        InsigniaEditor._invalidateCache();
        _renderThumbnails();
      }
      e.preventDefault();
      return true;
    }
    if (e.key === 'y') {
      if (pxl.redo(InsigniaEditor)) {
        InsigniaEditor._invalidateCache();
        _renderThumbnails();
      }
      e.preventDefault();
      return true;
    }
  }

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
    case 'insignia-set-mode': {
      const mode = el.dataset.mode;
      if (mode === 'pixel' || mode === 'vector') {
        InsigniaEditor.mode = mode;
        InsigniaEditor.clearSelection();
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-set-tool': {
      const tool = el.dataset.tool;
      if (tool) {
        InsigniaEditor.activeTool = tool;
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-select-rank': {
      const rank = parseInt(el.dataset.rank);
      if (!isNaN(rank) && rank >= 0 && rank <= 5) {
        InsigniaEditor.currentRank = rank;
        InsigniaEditor.selectedShapeIdx = -1;
        InsigniaEditor.selectedIndices = [];
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

    case 'insignia-save-as': {
      _saveAsNewSet();
      return true;
    }

    case 'insignia-rename': {
      const input = document.getElementById('insignia-set-name');
      if (input) {
        input.removeAttribute('readonly');
        input.focus();
        input.select();
      }
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

    case 'insignia-ref-clear': {
      delete InsigniaEditor.refImages[InsigniaEditor.currentRank];
      _renderAndReinit();
      return true;
    }

    case 'insignia-array-create': {
      const idx = parseInt(el.dataset.idx);
      const shapes = InsigniaEditor.getCurrentShapes();
      if (!isNaN(idx) && idx >= 0 && idx < shapes.length) {
        shapes[idx].array = { count: 3, spacing: 4, direction: 'y', linked: true };
        InsigniaEditor._invalidateCache();
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-array-unlink': {
      const idx = parseInt(el.dataset.idx);
      const shapes = InsigniaEditor.getCurrentShapes();
      if (!isNaN(idx) && idx >= 0 && idx < shapes.length) {
        const shape = shapes[idx];
        const arr = shape.array;
        if (arr && arr.linked && arr.count > 1) {
          // Create independent copies
          const dx = arr.direction === 'x' ? (arr.spacing || 4) : 0;
          const dy = arr.direction === 'x' ? 0 : (arr.spacing || 4);
          const newShapes = [];
          for (let i = 1; i < arr.count; i++) {
            const clone = JSON.parse(JSON.stringify(shape));
            delete clone.array;
            clone.id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            clone.x = (clone.x || 0) + dx * i;
            clone.y = (clone.y || 0) + dy * i;
            newShapes.push(clone);
          }
          delete shape.array;
          // Insert copies after the original
          shapes.splice(idx + 1, 0, ...newShapes);
          InsigniaEditor._invalidateCache();
          _renderAndReinit();
        }
      }
      return true;
    }

    case 'insignia-array-remove': {
      const idx = parseInt(el.dataset.idx);
      const shapes = InsigniaEditor.getCurrentShapes();
      if (!isNaN(idx) && idx >= 0 && idx < shapes.length) {
        delete shapes[idx].array;
        InsigniaEditor._invalidateCache();
        _renderAndReinit();
      }
      return true;
    }

    case 'insignia-preset-color':
      // Handled in handleInsigniaInput — forward it there
      handleInsigniaInput(el);
      return true;

    default:
      // Track clicks on color inputs for palette targeting
      if (target.type === 'color' && target.dataset?.action) {
        InsigniaEditor._lastColorAction = target.dataset.action;
      }
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

  // Preset dropdown
  if (action === 'insignia-load-preset') {
    const presetId = target.value;
    if (presetId) {
      const set = buildPreset(presetId);
      if (set) {
        InsigniaEditor.loadSet(set);
        _renderAndReinit();
      }
      target.value = ''; // Reset dropdown
    }
    return true;
  }

  // Battle set selector
  if (action === 'insignia-battle-select') {
    const setId = target.value || null;
    Game.settings.insigniaSetId = setId;
    if (setId) {
      fetch(`/api/insignia/${encodeURIComponent(setId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(set => {
          if (set) {
            cacheInsigniaSet(set);
            // Load into editor + update previews
            InsigniaEditor.loadSet(set);
            _renderThumbnails();
            const nameInput = document.getElementById('insignia-set-name');
            if (nameInput) nameInput.value = set.name || 'Untitled';
            // Stamp on active battle units
            const b = Game.battle || (Game.fireRange && Game.fireRange.battle);
            if (b) {
              for (const u of [...(b.units || []), ...(b.enemies || [])]) {
                u._insigniaSetId = setId;
              }
            }
          }
        })
        .catch(err => console.warn('[Insignia] Failed to cache battle set:', err));
    } else {
      // "None" selected — load fresh default, clear from battle
      InsigniaEditor.loadSet(InsigniaEditor.createDefaultSet());
      _renderThumbnails();
      const b = Game.battle || (Game.fireRange && Game.fireRange.battle);
      if (b) {
        for (const u of [...(b.units || []), ...(b.enemies || [])]) {
          delete u._insigniaSetId;
        }
      }
    }
    // Persist
    import('./storage.js').then(({ save }) => save());
    return true;
  }

  // Color preset palette
  if (action === 'insignia-preset-color') {
    const color = target.dataset.color;
    if (!color) return true;
    const lastAction = InsigniaEditor._lastColorAction;
    const set = InsigniaEditor.currentSet;
    if (!set) return true;

    // Apply to the targeted color input, or default to outline + shape stroke
    if (lastAction === 'insignia-fill-color' && set.patch?.insigniaFill) {
      set.patch.insigniaFill.color = color;
    } else if (lastAction === 'insignia-patch-fill' && set.patch) {
      set.patch.fillColor = color;
    } else if (lastAction === 'insignia-patch-stroke' && set.patch) {
      set.patch.strokeColor = color;
    } else if (lastAction === 'fillColor' && InsigniaEditor.selectedIndices?.length) {
      for (const idx of InsigniaEditor.selectedIndices) {
        const shapes = set.ranks?.[InsigniaEditor.activeRank]?.shapes;
        if (shapes?.[idx]) shapes[idx].fillColor = color;
      }
    } else {
      // Default: apply to outline + all shape strokes
      if (set.patch?.outline) set.patch.outline.color = color;
      const shapes = set.ranks?.[InsigniaEditor.activeRank]?.shapes;
      if (shapes) {
        for (const shape of shapes) shape.strokeColor = color;
      }
    }

    // Update UI color inputs to reflect
    if (lastAction) {
      const colorInput = document.querySelector(`[data-action="${lastAction}"]`);
      if (colorInput) colorInput.value = color;
    }
    // Highlight active swatch
    document.querySelectorAll('.ipc-swatch').forEach(s => s.classList.remove('ipc-swatch-active'));
    target.classList.add('ipc-swatch-active');
    _renderThumbnails();
    return true;
  }

  // Track last-used color input for palette presets
  if (action === 'insignia-fill-color' || action === 'insignia-outline-color' ||
      action === 'insignia-patch-fill' || action === 'insignia-patch-stroke' ||
      action === 'strokeColor' || action === 'fillColor') {
    InsigniaEditor._lastColorAction = action;
  }

  // Insignia fill controls
  if (action === 'insignia-fill-enabled') {
    const set = InsigniaEditor.currentSet;
    if (!set) return true;
    if (!set.patch) set.patch = { enabled: false, shape: 'shield', fillColor: '#4a5d3a', strokeColor: '#000000', strokeWidth: 1, width: 28, height: 34 };
    if (!set.patch.insigniaFill) set.patch.insigniaFill = { enabled: false, color: '#ffd700' };
    set.patch.insigniaFill.enabled = target.checked;
    _renderAndReinit();
    return true;
  }
  if (action === 'insignia-fill-color') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch?.insigniaFill) { set.patch.insigniaFill.color = target.value; _renderThumbnails(); }
    return true;
  }

  // Insignia outline controls
  if (action === 'insignia-outline-enabled') {
    const set = InsigniaEditor.currentSet;
    if (!set) return true;
    if (!set.patch) set.patch = { enabled: false, shape: 'shield', fillColor: '#4a5d3a', strokeColor: '#000000', strokeWidth: 1, width: 28, height: 34 };
    if (!set.patch.outline) set.patch.outline = { enabled: false, color: '#000000', width: 1 };
    set.patch.outline.enabled = target.checked;
    _renderAndReinit();
    return true;
  }
  if (action === 'insignia-outline-color') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch?.outline) { set.patch.outline.color = target.value; _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-outline-width') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch?.outline) { set.patch.outline.width = parseFloat(target.value); _renderThumbnails(); }
    return true;
  }

  // Patch controls
  if (action === 'insignia-patch-enabled') {
    const set = InsigniaEditor.currentSet;
    if (!set) return true;
    if (!set.patch) set.patch = { enabled: false, shape: 'shield', fillColor: '#4a5d3a', strokeColor: '#000000', strokeWidth: 1, width: 28, height: 34 };
    set.patch.enabled = target.checked;
    _renderAndReinit();
    return true;
  }
  if (action === 'insignia-patch-shape') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.shape = target.value; _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-patch-filled') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.filled = target.checked; _renderAndReinit(); }
    return true;
  }
  if (action === 'insignia-patch-outlined') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.outlined = target.checked; _renderAndReinit(); }
    return true;
  }
  if (action === 'insignia-patch-fill') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.fillColor = target.value; _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-patch-stroke') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.strokeColor = target.value; _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-patch-sw') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.strokeWidth = parseFloat(target.value); _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-patch-width') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.width = parseInt(target.value); _renderThumbnails(); }
    return true;
  }
  if (action === 'insignia-patch-height') {
    const set = InsigniaEditor.currentSet;
    if (set?.patch) { set.patch.height = parseInt(target.value); _renderThumbnails(); }
    return true;
  }

  // Reference image upload
  if (action === 'insignia-ref-upload') {
    const file = target.files?.[0];
    if (!file) return true;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        InsigniaEditor.refImages[InsigniaEditor.currentRank] = img;
        _renderAndReinit();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    return true;
  }

  // Reference image opacity
  if (action === 'insignia-ref-opacity') {
    InsigniaEditor.refOpacity = parseInt(target.value) / 100;
    const valSpan = target.nextElementSibling;
    if (valSpan?.classList.contains('prop-val')) {
      valSpan.textContent = target.value + '%';
    }
    return true;
  }

  // Reference image visibility toggle
  if (action === 'insignia-ref-visible') {
    InsigniaEditor.refVisible = target.checked;
    return true;
  }

  // Array/repeat controls
  if (action === 'insignia-array-prop') {
    const key = target.dataset.key;
    const idx = parseInt(target.dataset.idx);
    const val = parseFloat(target.value);
    const shapes = InsigniaEditor.getCurrentShapes();
    if (key && !isNaN(idx) && idx >= 0 && idx < shapes.length && shapes[idx].array) {
      shapes[idx].array[key] = val;
      InsigniaEditor._invalidateCache();
      _renderThumbnails();
      const valSpan = target.nextElementSibling;
      if (valSpan?.classList.contains('prop-val')) {
        valSpan.textContent = key === 'count' ? val + 'x' : val;
      }
    }
    return true;
  }

  if (action === 'insignia-array-dir') {
    const idx = parseInt(target.dataset.idx);
    const shapes = InsigniaEditor.getCurrentShapes();
    if (!isNaN(idx) && idx >= 0 && idx < shapes.length && shapes[idx].array) {
      shapes[idx].array.direction = target.value;
      InsigniaEditor._invalidateCache();
      _renderThumbnails();
    }
    return true;
  }

  if (action === 'insignia-tool-color') {
    InsigniaEditor.toolColor = target.value;
    return true;
  }

  if (action === 'insignia-brush-size') {
    InsigniaEditor.brushSize = parseInt(target.value) || 1;
    const valSpan = target.nextElementSibling;
    if (valSpan?.classList.contains('prop-val')) {
      valSpan.textContent = InsigniaEditor.brushSize + 'px';
    }
    return true;
  }

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

// ─── Battle Set Selector ────────────────────────────────────────

async function _populateBattleSetDropdown() {
  const sel = document.getElementById('insignia-battle-select');
  if (!sel) return;

  try {
    const res = await fetch('/api/insignia');
    if (!res.ok) return;
    const sets = await res.json();

    const activeId = Game.settings.insigniaSetId || '';
    // Count name occurrences to disambiguate duplicates
    const nameCounts = {};
    for (const s of sets) { const n = s.name || 'Untitled'; nameCounts[n] = (nameCounts[n] || 0) + 1; }
    sel.innerHTML = `<option value="">None (default)</option>` +
      sets.map(s => {
        const name = s.name || 'Untitled';
        const date = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
        const label = nameCounts[name] > 1 && date ? `${name} (${date})` : name;
        return `<option value="${s.id}"${s.id === activeId ? ' selected' : ''}>${label}</option>`;
      }).join('');
  } catch (err) {
    console.warn('[Insignia] Failed to populate battle set dropdown:', err);
  }
}

// ─── Save / Load / Delete ──────────────────────────────────────

async function _saveSet() {
  const set = InsigniaEditor.currentSet;
  if (!set) return;

  // Update name from input and re-lock
  const nameInput = document.getElementById('insignia-set-name');
  if (nameInput) {
    set.name = nameInput.value || 'Untitled';
    nameInput.setAttribute('readonly', '');
  }

  set.updatedAt = Date.now();

  try {
    const res = await fetch('/api/insignia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(set)
    });
    if (res.ok) {
      console.log('[Insignia] Set saved:', set.id);
      cacheInsigniaSet(set);
      Game.settings.insigniaSetId = set.id;
      const b = Game.battle || (Game.fireRange && Game.fireRange.battle);
      if (b) {
        for (const u of [...(b.units || []), ...(b.enemies || [])]) {
          u._insigniaSetId = set.id;
        }
      }
      const { save } = await import('./storage.js');
      save();
      _populateBattleSetDropdown();
    } else {
      console.error('[Insignia] Save failed:', res.status);
    }
  } catch (err) {
    console.error('[Insignia] Save error:', err);
  }
}

async function _saveAsNewSet() {
  const original = InsigniaEditor.currentSet;
  if (!original) return;

  // Deep copy and assign new ID
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = 'set_' + Date.now();
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();

  const nameInput = document.getElementById('insignia-set-name');
  const baseName = nameInput?.value || original.name || 'Untitled';
  copy.name = baseName + ' (copy)';

  // Load the copy into the editor
  InsigniaEditor.loadSet(copy);
  if (nameInput) {
    nameInput.value = copy.name;
    nameInput.removeAttribute('readonly');
    nameInput.focus();
    nameInput.select();
  }

  // Save immediately
  await _saveSet();
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

async function _renameSet(id, newName) {
  try {
    const res = await fetch(`/api/insignia/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const set = await res.json();
    set.name = newName;
    set.updatedAt = Date.now();
    await fetch('/api/insignia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(set)
    });
    // If this is the set currently loaded in the editor, update it too
    if (InsigniaEditor.currentSet?.id === id) {
      InsigniaEditor.currentSet.name = newName;
    }
    // Refresh the load dialog and battle dropdown
    _showLoadDialog();
    _populateBattleSetDropdown();
  } catch (err) {
    console.error('[Insignia] Rename error:', err);
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
