// ═══════════════════════════════════════════════════════════════
// INSIGNIA EDITOR - State management, canvas rendering, and
// interaction handling for the insignia editor.
// Produces JSON data that the insignia-renderer consumes.
// ═══════════════════════════════════════════════════════════════

import { drawShape, drawInsignia, clearInsigniaCache } from './insignia-renderer.js';

// ─── Shape Defaults ──────────────────────────────────────────

const SHAPE_DEFAULTS = {
  chevron: { halfW: 6, height: 7, bow: 0.35 },
  arc:     { halfW: 5, arcHeight: 4 },
  diamond: { width: 10, height: 14 },
  line:    { length: 12 },
  circle:  { radius: 4 },
  path:    { points: [], closed: true }
};

const COMMON_DEFAULTS = {
  x: 0, y: 0,
  scaleX: 1, scaleY: 1,
  rotation: 0,
  flipX: false, flipY: false,
  strokeColor: '#ffd700',
  strokeWidth: 1.5,
  fillColor: '#ffd700',
  fillEnabled: false,
  fillOpacity: 0.5,
  visible: true
};

// ─── Helpers ─────────────────────────────────────────────────

function _genId() {
  return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Editor Singleton ────────────────────────────────────────

export const InsigniaEditor = {
  currentSet: null,         // The InsigniaSet JSON being edited
  currentRank: 1,           // Which rank (0-5) is selected for editing
  selectedShapeIdx: -1,     // Primary selected shape index, -1 = none
  selectedIndices: [],      // All selected shape indices (multi-select)
  clipboard: null,          // Copied shape(s) for paste (array)
  mode: 'vector',           // Editor mode: 'vector' | 'pixel'

  // Pixel mode state
  pixelData: {},            // { rank: ImageData(96, 96) } — per-rank pixel buffers
  pixelHistory: {},         // { rank: [ImageData, ...] } — undo stacks per rank
  pixelRedoHistory: {},     // { rank: [ImageData, ...] } — redo stacks per rank
  activeTool: 'pencil',    // Current pixel tool
  toolColor: '#ffd700',    // Primary pixel drawing color
  brushSize: 1,            // Brush diameter in pixels

  // Reference image state (per-rank, for tracing)
  refImages: {},            // { rank: HTMLImageElement } — loaded reference images
  refOpacity: 0.3,          // Reference image opacity (0-1)
  refVisible: true,         // Whether reference images are shown

  // Canvas state
  _canvas: null,            // The editor canvas element
  _ctx: null,
  zoom: 8,                  // Editor canvas zoom level
  panX: 0, panY: 0,        // Pan offset

  // Drag state
  _dragging: false,
  _dragStartX: 0, _dragStartY: 0,
  _dragShapeStartX: 0, _dragShapeStartY: 0,

  // Vertex drag state
  _draggingVertex: null,  // { shapeIdx, vertexIdx } or null

  // Marquee selection state
  _marquee: null,  // { startX, startY, endX, endY } in canvas coords, null if inactive

  // Path tool state
  pathToolActive: false,
  _pathPoints: [],          // Points being placed for new path

  // RAF handle
  _rafId: null,
  // Mouse position in canvas space (for path tool preview line)
  _cursorCanvasX: 0,
  _cursorCanvasY: 0,
  // Snap guides (drawn during drag)
  _snapGuides: [],   // [{ axis: 'x'|'y', pos: number }] — world coords

  // ═════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════════════════════

  /**
   * Store canvas reference, obtain 2D context, start render loop.
   * @param {HTMLCanvasElement} canvas
   */
  init(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    // Sync canvas resolution to its CSS display size
    this._syncCanvasSize();
    this._startLoop();
  },

  _syncCanvasSize() {
    const canvas = this._canvas;
    if (!canvas) return;
    if (this.mode === 'pixel') {
      // Pixel mode: fixed 96x96 logical resolution, CSS scales to fill
      if (canvas.width !== 96 || canvas.height !== 96) {
        canvas.width = 96;
        canvas.height = 96;
      }
    } else {
      // Vector mode: match CSS display size for 1:1 coordinate mapping
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
  },

  /**
   * Start the requestAnimationFrame render loop.
   * Only renders when the editor canvas is attached to the DOM.
   */
  _startLoop() {
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      if (this._canvas && this._canvas.isConnected) {
        this.render();
      }
    };
    this._rafId = requestAnimationFrame(tick);
  },

  // ═════════════════════════════════════════════════════════════
  // SET MANAGEMENT
  // ═════════════════════════════════════════════════════════════

  /**
   * Load an insignia set JSON for editing. Deep-clones it.
   * @param {object} set - InsigniaSet JSON
   */
  loadSet(set) {
    this.currentSet = _deepClone(set);
    this.currentRank = 1; // Default to PV2
    this.selectedShapeIdx = -1;
    this.selectedIndices = [];
    this.clipboard = null;
    this.pathToolActive = false;
    this._pathPoints = [];
  },

  /** Clear all selection */
  clearSelection() {
    this.selectedShapeIdx = -1;
    this.selectedIndices = [];
  },

  /** Select a single shape (replaces any multi-select) */
  selectShape(idx) {
    this.selectedShapeIdx = idx;
    this.selectedIndices = idx >= 0 ? [idx] : [];
  },

  /** Toggle a shape in/out of multi-select */
  toggleSelect(idx) {
    const pos = this.selectedIndices.indexOf(idx);
    if (pos >= 0) {
      this.selectedIndices.splice(pos, 1);
    } else {
      this.selectedIndices.push(idx);
    }
    // Primary = last toggled in, or first remaining
    this.selectedShapeIdx = this.selectedIndices.length > 0
      ? this.selectedIndices[this.selectedIndices.length - 1] : -1;
  },

  /** Select all shapes in current rank */
  selectAll() {
    const shapes = this.getCurrentShapes();
    this.selectedIndices = shapes.map((_, i) => i);
    this.selectedShapeIdx = shapes.length > 0 ? 0 : -1;
  },

  /** Check if a shape index is selected */
  isSelected(idx) {
    return this.selectedIndices.includes(idx);
  },

  /**
   * Generate a default insignia set matching the hardcoded rendering
   * in entity-renderer.js.
   * @returns {object} InsigniaSet JSON
   */
  createDefaultSet() {
    const id = 'default_' + Date.now();
    let shapeCounter = 0;
    const sid = () => 's_' + (shapeCounter++);

    const gold = '#ffd700';
    const sw = 1.5;

    // Helper: build a shape with common defaults merged
    const mkShape = (type, overrides) => ({
      ...COMMON_DEFAULTS,
      ...SHAPE_DEFAULTS[type],
      type,
      id: sid(),
      ...overrides
    });

    const set = {
      id,
      name: 'Default',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ranks: []
    };

    // Rank 0 (PVT) - empty
    set.ranks[0] = { shapes: [] };

    // Rank 1 (PV2) - 1 chevron
    set.ranks[1] = {
      shapes: [
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35 })
      ]
    };

    // Rank 2 (PFC) - 1 chevron + 1 arc rocker above
    set.ranks[2] = {
      shapes: [
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35 }),
        mkShape('arc', { halfW: 5.1, arcHeight: 4, y: -6.5 })
      ]
    };

    // Rank 3 (SPC) - Flipped filled chevron + flipped arc + 2 eagle wing arcs
    set.ranks[3] = {
      shapes: [
        mkShape('chevron', {
          halfW: 6, height: 6, bow: 0.10,
          rotation: Math.PI,
          fillEnabled: true, fillOpacity: 0.5
        }),
        mkShape('arc', {
          halfW: 6, arcHeight: 3.5,
          flipY: true,
          y: -3.5
        }),
        // Left eagle wing
        mkShape('arc', {
          halfW: 1.5, arcHeight: 2,
          x: -1.5, y: 0.5
        }),
        // Right eagle wing
        mkShape('arc', {
          halfW: 1.5, arcHeight: 2,
          x: 1.5, y: 0.5
        })
      ]
    };

    // Rank 4 (CPL) - 2 chevrons stacked (second scaled to 0.88)
    set.ranks[4] = {
      shapes: [
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35, y: 2 }),
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35, y: -2, scaleX: 0.88, scaleY: 0.88 })
      ]
    };

    // Rank 5 (SGT) - 3 chevrons stacked (scaling: 1.0, 0.88, 0.76)
    set.ranks[5] = {
      shapes: [
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35, y: 4 }),
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35, y: 0, scaleX: 0.88, scaleY: 0.88 }),
        mkShape('chevron', { halfW: 6, height: 7, bow: 0.35, y: -4, scaleX: 0.76, scaleY: 0.76 })
      ]
    };

    return set;
  },

  /**
   * Return a blank insignia set with empty shapes for all 6 ranks.
   * @returns {object} InsigniaSet JSON
   */
  createBlankSet() {
    return {
      id: 'set_' + Date.now(),
      name: 'Untitled',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ranks: [
        { shapes: [] },
        { shapes: [] },
        { shapes: [] },
        { shapes: [] },
        { shapes: [] },
        { shapes: [] }
      ]
    };
  },

  // ═════════════════════════════════════════════════════════════
  // SHAPE OPERATIONS
  // ═════════════════════════════════════════════════════════════

  /**
   * Get the shapes array for the currently selected rank.
   * @returns {Array} shapes array (possibly empty)
   */
  getCurrentShapes() {
    if (!this.currentSet || !this.currentSet.ranks[this.currentRank]) return [];
    return this.currentSet.ranks[this.currentRank].shapes;
  },

  /**
   * Get the currently selected shape object.
   * @returns {object|null}
   */
  getSelectedShape() {
    const shapes = this.getCurrentShapes();
    if (this.selectedShapeIdx < 0 || this.selectedShapeIdx >= shapes.length) return null;
    return shapes[this.selectedShapeIdx];
  },

  /**
   * Add a new shape of the given type with default params.
   * @param {string} type - 'chevron', 'arc', 'diamond', 'line', 'circle', 'path'
   * @returns {object} The newly created shape
   */
  addShape(type) {
    const shapes = this.getCurrentShapes();
    const typeDefaults = SHAPE_DEFAULTS[type] || {};

    const shape = {
      ...COMMON_DEFAULTS,
      ...typeDefaults,
      type,
      id: _genId()
    };

    shapes.push(shape);
    this.selectedShapeIdx = shapes.length - 1;
    this._invalidateCache();
    return shape;
  },

  /**
   * Remove shape at index. Clear selection if it was selected.
   * @param {number} idx
   */
  removeShape(idx) {
    const shapes = this.getCurrentShapes();
    if (idx < 0 || idx >= shapes.length) return;

    shapes.splice(idx, 1);

    if (this.selectedShapeIdx === idx) {
      this.selectedShapeIdx = -1;
    } else if (this.selectedShapeIdx > idx) {
      this.selectedShapeIdx--;
    }
    this._invalidateCache();
  },

  /**
   * Clone shape at index, offset slightly, append after original.
   * @param {number} idx
   * @returns {object|null} The duplicated shape, or null
   */
  duplicateShape(idx) {
    const shapes = this.getCurrentShapes();
    if (idx < 0 || idx >= shapes.length) return null;

    const clone = _deepClone(shapes[idx]);
    clone.id = _genId();
    clone.x = (clone.x || 0) + 2;
    clone.y = (clone.y || 0) + 2;

    shapes.splice(idx + 1, 0, clone);
    this.selectedShapeIdx = idx + 1;
    this._invalidateCache();
    return clone;
  },

  /**
   * Move shape up in render order (swap with idx+1, higher = on top).
   * @param {number} idx
   */
  moveShapeUp(idx) {
    const shapes = this.getCurrentShapes();
    if (idx < 0 || idx >= shapes.length - 1) return;

    [shapes[idx], shapes[idx + 1]] = [shapes[idx + 1], shapes[idx]];

    if (this.selectedShapeIdx === idx) {
      this.selectedShapeIdx = idx + 1;
    } else if (this.selectedShapeIdx === idx + 1) {
      this.selectedShapeIdx = idx;
    }
    this._invalidateCache();
  },

  /**
   * Move shape down in render order (swap with idx-1).
   * @param {number} idx
   */
  moveShapeDown(idx) {
    const shapes = this.getCurrentShapes();
    if (idx <= 0 || idx >= shapes.length) return;

    [shapes[idx], shapes[idx - 1]] = [shapes[idx - 1], shapes[idx]];

    if (this.selectedShapeIdx === idx) {
      this.selectedShapeIdx = idx - 1;
    } else if (this.selectedShapeIdx === idx - 1) {
      this.selectedShapeIdx = idx;
    }
    this._invalidateCache();
  },

  /**
   * Copy selected shape(s) to clipboard. Supports multi-select.
   * @param {number} [idx] - Single index, or omit to use selectedIndices
   */
  copyShape(idx) {
    const shapes = this.getCurrentShapes();
    if (idx != null && idx >= 0) {
      this.clipboard = [_deepClone(shapes[idx])];
      return;
    }
    // Multi-select copy
    if (this.selectedIndices.length > 0) {
      this.clipboard = this.selectedIndices
        .filter(i => i >= 0 && i < shapes.length)
        .map(i => _deepClone(shapes[i]));
    }
  },

  /**
   * Paste clipboard shape(s) with slight offset. Selects pasted shapes.
   * @returns {Array|null} Pasted shapes, or null if clipboard empty
   */
  pasteShape() {
    if (!this.clipboard || this.clipboard.length === 0) return null;

    const shapes = this.getCurrentShapes();
    const pasted = [];
    const newIndices = [];

    for (const src of this.clipboard) {
      const clone = _deepClone(src);
      clone.id = _genId();
      clone.x = (clone.x || 0) + 2;
      clone.y = (clone.y || 0) + 2;
      shapes.push(clone);
      pasted.push(clone);
      newIndices.push(shapes.length - 1);
    }

    this.selectedIndices = newIndices;
    this.selectedShapeIdx = newIndices[newIndices.length - 1];
    this._invalidateCache();
    return pasted;
  },

  /**
   * Delete all selected shapes (multi-select aware).
   */
  deleteSelected() {
    const shapes = this.getCurrentShapes();
    // Sort descending so splicing doesn't shift indices
    const sorted = [...this.selectedIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      if (idx >= 0 && idx < shapes.length) shapes.splice(idx, 1);
    }
    this.clearSelection();
    this._invalidateCache();
  },

  /**
   * Invalidate the insignia cache for the current set.
   */
  _invalidateCache() {
    if (this.currentSet && this.currentSet.id) {
      clearInsigniaCache(this.currentSet.id);
    }
  },

  // ═════════════════════════════════════════════════════════════
  // CANVAS RENDERING
  // ═════════════════════════════════════════════════════════════

  /**
   * Main render loop — called per frame via requestAnimationFrame.
   * Draws background, grid, crosshair, unit silhouette, shapes,
   * selection handles, and path tool preview.
   */
  render() {
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!canvas || !ctx) return;

    this._syncCanvasSize();

    const w = canvas.width;
    const h = canvas.height;

    // Pixel mode: render pixel buffer
    if (this.mode === 'pixel') {
      this._renderPixelMode(ctx, w, h);
      return;
    }

    // Vector mode below
    // 1. Background
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, 0, w, h);

    // 2. Grid (subtle lines every 2px world space)
    this._drawGrid(ctx, w, h);

    // 3. Crosshair at center
    this._drawCrosshair(ctx, w, h);

    // 4. Unit size reference (filled square)
    ctx.save();
    ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
    ctx.scale(this.zoom, this.zoom);
    const ref = 20; // half-size in world units
    ctx.fillStyle = '#333333';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(-ref, -ref, ref * 2, ref * 2);
    ctx.globalAlpha = 1;
    ctx.restore();

    // 4b. Reference image (behind shapes, in world space)
    this._drawRefImage(ctx, w, h, this.currentRank);

    // 5. All shapes for the current rank
    ctx.save();
    ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
    ctx.scale(this.zoom, this.zoom);

    const rankData = this.currentSet?.ranks?.[this.currentRank];
    if (rankData) {
      drawInsignia(ctx, rankData, 1, this.currentSet?.patch);
    }

    ctx.restore();

    // 6. Selection handles for all selected shapes
    for (const si of this.selectedIndices) {
      this._drawSelectionHandles(ctx, w, h, si);
    }

    // 6b. Vertex handles on selected shapes
    if (this.selectedIndices.length > 0) {
      this._drawVertexHandles(ctx, w, h);
    }

    // 6c. Snap guides
    if (this._snapGuides.length > 0) {
      const cx = w / 2 + this.panX;
      const cy = h / 2 + this.panY;
      ctx.save();
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      for (const g of this._snapGuides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          const sx = cx + g.pos * this.zoom;
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
        } else {
          const sy = cy + g.pos * this.zoom;
          ctx.moveTo(0, sy);
          ctx.lineTo(w, sy);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 7. Marquee selection rectangle
    if (this._marquee) {
      const m = this._marquee;
      ctx.save();
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = 'rgba(96, 165, 250, 0.1)';
      const rx = Math.min(m.startX, m.endX);
      const ry = Math.min(m.startY, m.endY);
      const rw = Math.abs(m.endX - m.startX);
      const rh = Math.abs(m.endY - m.startY);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 8. Path tool preview
    if (this.pathToolActive) {
      this._drawPathPreview(ctx, w, h);
    }
  },

  /**
   * Render the pixel mode canvas: checkerboard + pixel data.
   * Canvas is 96x96 logical pixels, CSS scales it up.
   */
  _renderPixelMode(ctx, w, h) {
    // Checkerboard background (transparency indicator)
    const checkSize = 4;
    for (let y = 0; y < h; y += checkSize) {
      for (let x = 0; x < w; x += checkSize) {
        const dark = ((x / checkSize) + (y / checkSize)) % 2 === 0;
        ctx.fillStyle = dark ? '#2a2a3a' : '#323246';
        ctx.fillRect(x, y, checkSize, checkSize);
      }
    }

    // Reference image (behind pixel data)
    const rank = this.currentRank;
    this._drawRefImage(ctx, w, h, rank);

    // Draw pixel data if it exists
    const pd = this.pixelData[rank];
    if (pd) {
      ctx.putImageData(pd, 0, 0);
    }

    // Grid overlay (1px grid at this resolution = per-pixel grid)
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Crosshair at center
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * Get or create the pixel ImageData for the current rank.
   * @returns {ImageData}
   */
  getPixelData(rank) {
    if (!this.pixelData[rank]) {
      this.pixelData[rank] = new ImageData(96, 96);
    }
    return this.pixelData[rank];
  },

  /**
   * Draw the reference image for a given rank (if loaded and visible).
   * In pixel mode: draws at 96x96 behind pixel data.
   * In vector mode: draws centered at the canvas origin, scaled by zoom.
   */
  _drawRefImage(ctx, w, h, rank) {
    if (!this.refVisible) return;
    const img = this.refImages[rank];
    if (!img) return;

    ctx.save();
    ctx.globalAlpha = this.refOpacity;

    if (this.mode === 'pixel') {
      // Fit image into 96x96
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      // Center at world origin, scale to fit ~40px world radius
      const cx = w / 2 + this.panX;
      const cy = h / 2 + this.panY;
      ctx.translate(cx, cy);
      ctx.scale(this.zoom, this.zoom);
      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;
      const fitScale = 40 / Math.max(imgW, imgH);
      ctx.drawImage(img, -imgW * fitScale / 2, -imgH * fitScale / 2, imgW * fitScale, imgH * fitScale);
    }

    ctx.restore();
  },

  /**
   * Draw subtle grid lines every 2px at current zoom.
   */
  _drawGrid(ctx, w, h) {
    const step = 2 * this.zoom;
    if (step < 4) return; // Too zoomed out, skip grid

    const cx = w / 2 + this.panX;
    const cy = h / 2 + this.panY;

    // Compute grid offset so lines align with world origin
    const offX = cx % step;
    const offY = cy % step;

    ctx.save();
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.4;

    ctx.beginPath();
    for (let x = offX; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = offY; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
  },

  /**
   * Draw center crosshair lines.
   */
  _drawCrosshair(ctx, w, h) {
    const cx = w / 2 + this.panX;
    const cy = h / 2 + this.panY;

    ctx.save();
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;

    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * Draw a dashed gold bounding box with corner handles around a shape.
   * @param {number} [shapeIdx] - Index of the shape, defaults to selectedShapeIdx
   */
  _drawSelectionHandles(ctx, w, h, shapeIdx) {
    const shapes = this.getCurrentShapes();
    const idx = shapeIdx ?? this.selectedShapeIdx;
    const shape = (idx >= 0 && idx < shapes.length) ? shapes[idx] : null;
    if (!shape) return;

    // Compute a rough bounding box in world space based on shape type/params
    const bounds = this._getShapeBounds(shape);
    if (!bounds) return;

    const cx = w / 2 + this.panX;
    const cy = h / 2 + this.panY;
    const z = this.zoom;

    // Convert world bounds to screen space
    const sx = cx + bounds.x * z;
    const sy = cy + bounds.y * z;
    const sw = bounds.w * z;
    const sh = bounds.h * z;

    const pad = 4; // Padding around shape

    ctx.save();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2);
    ctx.setLineDash([]);

    // Corner handles (small filled squares)
    const hs = 4; // Handle half-size
    ctx.fillStyle = '#ffd700';
    const corners = [
      [sx - pad, sy - pad],
      [sx + sw + pad, sy - pad],
      [sx - pad, sy + sh + pad],
      [sx + sw + pad, sy + sh + pad]
    ];
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
    }

    ctx.restore();
  },

  /**
   * Compute an approximate bounding box for a shape in world space.
   * Returns { x, y, w, h } in world coords (top-left corner + dimensions).
   */
  _getShapeBounds(shape) {
    const sx = shape.scaleX ?? 1;
    const sy = shape.scaleY ?? 1;
    const px = shape.x || 0;
    const py = shape.y || 0;

    let hw, hh;

    switch (shape.type) {
      case 'chevron': {
        const halfW = (shape.halfW ?? 6) * Math.abs(sx);
        const h = (shape.height ?? 7) * Math.abs(sy);
        const pad1 = shape.verticalEnds ? (shape.strokeWidth ?? 1.5) / 2 : 0;
        hw = halfW + pad1;
        hh = h / 2 + pad1;
        break;
      }
      case 'arc': {
        const halfW = (shape.halfW ?? 6) * Math.abs(sx);
        const arcH = (shape.arcHeight ?? 4) * Math.abs(sy);
        const pad2 = shape.verticalEnds ? (shape.strokeWidth ?? 1.5) / 2 : 0;
        hw = halfW + pad2;
        hh = arcH / 2 + pad2;
        break;
      }
      case 'diamond': {
        hw = ((shape.width ?? 8) / 2) * Math.abs(sx);
        hh = ((shape.height ?? 8) / 2) * Math.abs(sy);
        break;
      }
      case 'line': {
        const half = ((shape.length ?? 10) / 2) * Math.abs(sx);
        hw = half;
        hh = 1;
        break;
      }
      case 'circle': {
        const r = (shape.radius ?? 4) * Math.max(Math.abs(sx), Math.abs(sy));
        hw = r;
        hh = r;
        break;
      }
      case 'path': {
        const pts = shape.points;
        if (!pts || pts.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        hw = Math.max(Math.abs(minX), Math.abs(maxX)) * Math.abs(sx);
        hh = Math.max(Math.abs(minY), Math.abs(maxY)) * Math.abs(sy);
        break;
      }
      default:
        return null;
    }

    return {
      x: px - hw,
      y: py - hh,
      w: hw * 2,
      h: hh * 2
    };
  },

  /**
   * Draw the in-progress path for the path tool.
   * Shows placed points connected by lines, with a line from the
   * last point to the cursor position.
   */
  _drawPathPreview(ctx, w, h) {
    const pts = this._pathPoints;
    if (pts.length === 0) return;

    const cx = w / 2 + this.panX;
    const cy = h / 2 + this.panY;
    const z = this.zoom;

    ctx.save();
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);

    // Draw placed segments
    ctx.beginPath();
    ctx.moveTo(cx + pts[0].x * z, cy + pts[0].y * z);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(cx + pts[i].x * z, cy + pts[i].y * z);
    }

    // Line from last point to cursor
    const cursor = this.screenToWorld(this._cursorCanvasX, this._cursorCanvasY);
    ctx.lineTo(cx + cursor.x * z, cy + cursor.y * z);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw point markers
    ctx.fillStyle = '#00ff88';
    for (const p of pts) {
      const screenX = cx + p.x * z;
      const screenY = cy + p.y * z;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  // ═════════════════════════════════════════════════════════════
  // HIT TESTING
  // ═════════════════════════════════════════════════════════════

  /**
   * Convert canvas pixel coordinates to world coordinates.
   * @param {number} canvasX
   * @param {number} canvasY
   * @returns {{ x: number, y: number }}
   */
  screenToWorld(canvasX, canvasY) {
    const canvas = this._canvas;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: (canvasX - canvas.width / 2 - this.panX) / this.zoom,
      y: (canvasY - canvas.height / 2 - this.panY) / this.zoom
    };
  },

  /**
   * Convert world coordinates to canvas pixel coordinates.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {{ x: number, y: number }}
   */
  worldToScreen(worldX, worldY) {
    const canvas = this._canvas;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: canvas.width / 2 + this.panX + worldX * this.zoom,
      y: canvas.height / 2 + this.panY + worldY * this.zoom
    };
  },

  /**
   * Hit test canvas coordinates against shapes in reverse render order.
   * Uses an offscreen canvas to reconstruct each shape's path and test
   * with isPointInStroke / isPointInPath.
   *
   * @param {number} canvasX - X in canvas pixel space
   * @param {number} canvasY - Y in canvas pixel space
   * @returns {number} Shape index or -1
   */
  hitTest(canvasX, canvasY) {
    const shapes = this.getCurrentShapes();
    if (shapes.length === 0) return -1;

    const world = this.screenToWorld(canvasX, canvasY);

    // Use an offscreen canvas for path reconstruction
    const oc = new OffscreenCanvas(1, 1);
    const octx = oc.getContext('2d');

    // Tolerance: expand stroke hit area slightly
    const tolerance = 2 / this.zoom;

    // Check in reverse order (top-most shape first)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      if (shape.visible === false) continue;

      // Reconstruct the shape path in world space on the offscreen context
      octx.save();
      octx.translate(shape.x || 0, shape.y || 0);
      if (shape.rotation) octx.rotate(shape.rotation);
      const sx = (shape.flipX ? -1 : 1) * (shape.scaleX ?? 1);
      const sy = (shape.flipY ? -1 : 1) * (shape.scaleY ?? 1);
      if (sx !== 1 || sy !== 1) octx.scale(sx, sy);

      octx.lineWidth = (shape.strokeWidth ?? 1.5) + tolerance;
      octx.beginPath();

      // Rebuild the path based on type
      this._buildHitPath(octx, shape);

      // Outline mode builds a closed polygon — use isPointInPath
      const isOutline = shape.verticalEnds && (shape.type === 'chevron' || shape.type === 'arc');
      const hit = isOutline
        ? octx.isPointInPath(world.x, world.y)
        : (octx.isPointInStroke(world.x, world.y) ||
           (shape.fillEnabled && octx.isPointInPath(world.x, world.y)));

      octx.restore();

      if (hit) return i;
    }

    return -1;
  },

  /**
   * Build a path on the given context for a shape (for hit testing).
   * Mirrors the path builders in insignia-renderer.js.
   * For verticalEnds shapes, builds the outline polygon so isPointInPath works.
   */
  _buildHitPath(ctx, shape) {
    // Outline mode: build the filled polygon path instead of the stroke path
    if (shape.verticalEnds && (shape.type === 'chevron' || shape.type === 'arc')) {
      this._buildOutlineHitPath(ctx, shape);
      return;
    }

    switch (shape.type) {
      case 'chevron': {
        const halfW = shape.halfW ?? 6;
        const h = shape.height ?? 7;
        const bow = halfW * (shape.bow ?? 0.35);
        ctx.moveTo(-halfW, h);
        ctx.quadraticCurveTo(-halfW * 0.5 + bow, h * 0.45, 0, 0);
        ctx.quadraticCurveTo(halfW * 0.5 - bow, h * 0.45, halfW, h);
        break;
      }
      case 'arc': {
        const halfW = shape.halfW ?? 6;
        const arcH = shape.arcHeight ?? 4;
        ctx.moveTo(-halfW, 0);
        ctx.quadraticCurveTo(0, -arcH, halfW, 0);
        break;
      }
      case 'diamond': {
        const hw = (shape.width ?? 8) / 2;
        const hh = (shape.height ?? 8) / 2;
        ctx.moveTo(0, -hh);
        ctx.lineTo(hw, 0);
        ctx.lineTo(0, hh);
        ctx.lineTo(-hw, 0);
        ctx.closePath();
        break;
      }
      case 'line': {
        const half = (shape.length ?? 10) / 2;
        ctx.moveTo(-half, 0);
        ctx.lineTo(half, 0);
        break;
      }
      case 'circle': {
        const r = shape.radius ?? 4;
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
      }
      case 'path': {
        const pts = shape.points;
        if (!pts || pts.length === 0) break;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) {
          const p = pts[j];
          if (p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
            ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        if (shape.closed) ctx.closePath();
        break;
      }
    }
  },

  /**
   * Build an outline polygon path for verticalEnds shapes (hit testing).
   * Mirrors _fillOutline() in insignia-renderer.js but only builds the path
   * without filling, so the caller can use isPointInPath().
   */
  _buildOutlineHitPath(ctx, shape) {
    const hw = (shape.strokeWidth ?? 1.5) / 2;
    const N = 14;

    // Inline bezier sampling (mirrors insignia-renderer.js helpers)
    const sampleQ = (p0x, p0y, cpx, cpy, p1x, p1y, t) => {
      const mt = 1 - t;
      return [mt * mt * p0x + 2 * mt * t * cpx + t * t * p1x,
              mt * mt * p0y + 2 * mt * t * cpy + t * t * p1y];
    };
    const tangentQ = (p0x, p0y, cpx, cpy, p1x, p1y, t) => {
      const mt = 1 - t;
      return [2 * mt * (cpx - p0x) + 2 * t * (p1x - cpx),
              2 * mt * (cpy - p0y) + 2 * t * (p1y - cpy)];
    };
    const sampleArm = (p0x, p0y, cpx, cpy, p1x, p1y, startT) => {
      const e1 = [], e2 = [];
      for (let i = (startT ? 1 : 0); i <= N; i++) {
        const t = i / N;
        const [px, py] = sampleQ(p0x, p0y, cpx, cpy, p1x, p1y, t);
        const [tx, ty] = tangentQ(p0x, p0y, cpx, cpy, p1x, p1y, t);
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        const nx = -ty / len, ny = tx / len;
        e1.push([px + nx * hw, py + ny * hw]);
        e2.push([px - nx * hw, py - ny * hw]);
      }
      return { edge1: e1, edge2: e2 };
    };

    if (shape.type === 'chevron') {
      const halfW = shape.halfW ?? 6;
      const h = shape.height ?? 7;
      const bow = halfW * (shape.bow ?? 0.35);
      const left = sampleArm(-halfW, h, -halfW * 0.5 + bow, h * 0.45, 0, 0, false);
      const right = sampleArm(0, 0, halfW * 0.5 - bow, h * 0.45, halfW, h, true);
      const e1 = [...left.edge1, ...right.edge1];
      const e2 = [...left.edge2, ...right.edge2];
      e1[0][0] = -halfW; e2[0][0] = -halfW;
      const last = e1.length - 1;
      e1[last][0] = halfW; e2[last][0] = halfW;
      ctx.moveTo(e1[0][0], e1[0][1]);
      for (let i = 1; i <= last; i++) ctx.lineTo(e1[i][0], e1[i][1]);
      ctx.lineTo(e2[last][0], e2[last][1]);
      for (let i = last - 1; i >= 0; i--) ctx.lineTo(e2[i][0], e2[i][1]);
      ctx.closePath();
    } else if (shape.type === 'arc') {
      const halfW = shape.halfW ?? 6;
      const arcH = shape.arcHeight ?? 4;
      const arm = sampleArm(-halfW, 0, 0, -arcH, halfW, 0, false);
      arm.edge1[0][0] = -halfW; arm.edge2[0][0] = -halfW;
      arm.edge1[N][0] = halfW; arm.edge2[N][0] = halfW;
      ctx.moveTo(arm.edge1[0][0], arm.edge1[0][1]);
      for (let i = 1; i <= N; i++) ctx.lineTo(arm.edge1[i][0], arm.edge1[i][1]);
      ctx.lineTo(arm.edge2[N][0], arm.edge2[N][1]);
      for (let i = N - 1; i >= 0; i--) ctx.lineTo(arm.edge2[i][0], arm.edge2[i][1]);
      ctx.closePath();
    }
  },

  // ═════════════════════════════════════════════════════════════
  // VERTEX EDITING
  // ═════════════════════════════════════════════════════════════

  /**
   * Get the editable vertices for a shape in local (pre-transform) space.
   * Each vertex: { x, y, label }
   */
  _getVertices(shape) {
    switch (shape.type) {
      case 'chevron': {
        const hw = shape.halfW ?? 6;
        const h = shape.height ?? 7;
        return [
          { x: -hw, y: h, label: 'L' },
          { x: 0, y: 0, label: 'Apex' },
          { x: hw, y: h, label: 'R' },
        ];
      }
      case 'arc': {
        const hw = shape.halfW ?? 6;
        const arcH = shape.arcHeight ?? 4;
        return [
          { x: -hw, y: 0, label: 'L' },
          { x: 0, y: -arcH, label: 'Peak' },
          { x: hw, y: 0, label: 'R' },
        ];
      }
      case 'diamond': {
        const dw = (shape.width ?? 8) / 2;
        const dh = (shape.height ?? 8) / 2;
        return [
          { x: 0, y: -dh, label: 'T' },
          { x: dw, y: 0, label: 'R' },
          { x: 0, y: dh, label: 'B' },
          { x: -dw, y: 0, label: 'L' },
        ];
      }
      case 'line': {
        const half = (shape.length ?? 10) / 2;
        return [
          { x: -half, y: 0, label: 'A' },
          { x: half, y: 0, label: 'B' },
        ];
      }
      case 'circle': {
        const r = shape.radius ?? 4;
        return [
          { x: r, y: 0, label: 'R' },
        ];
      }
      case 'path': {
        const pts = shape.points;
        if (!pts) return [];
        return pts.map((p, i) => ({ x: p.x, y: p.y, label: `P${i}` }));
      }
      default:
        return [];
    }
  },

  /**
   * Apply a vertex move back to the shape's parameters.
   * vIdx is the index into the array returned by _getVertices.
   * nx, ny are the new local-space coordinates.
   */
  _setVertex(shape, vIdx, nx, ny) {
    switch (shape.type) {
      case 'chevron': {
        if (vIdx === 0) {
          // Left tip: halfW = -x, height = y
          shape.halfW = Math.max(1, -nx);
          shape.height = Math.max(1, ny);
        } else if (vIdx === 1) {
          // Apex: moves the whole shape's origin offset
          shape.x = (shape.x || 0) + nx;
          shape.y = (shape.y || 0) + ny;
        } else if (vIdx === 2) {
          // Right tip: halfW = x, height = y
          shape.halfW = Math.max(1, nx);
          shape.height = Math.max(1, ny);
        }
        break;
      }
      case 'arc': {
        if (vIdx === 0) {
          shape.halfW = Math.max(1, -nx);
        } else if (vIdx === 1) {
          shape.arcHeight = Math.max(0.5, -ny);
        } else if (vIdx === 2) {
          shape.halfW = Math.max(1, nx);
        }
        break;
      }
      case 'diamond': {
        if (vIdx === 0) { // top
          shape.height = Math.max(1, -ny * 2);
        } else if (vIdx === 1) { // right
          shape.width = Math.max(1, nx * 2);
        } else if (vIdx === 2) { // bottom
          shape.height = Math.max(1, ny * 2);
        } else if (vIdx === 3) { // left
          shape.width = Math.max(1, -nx * 2);
        }
        break;
      }
      case 'line': {
        if (vIdx === 0) {
          shape.length = Math.max(1, -nx * 2);
        } else if (vIdx === 1) {
          shape.length = Math.max(1, nx * 2);
        }
        break;
      }
      case 'circle': {
        shape.radius = Math.max(0.5, Math.sqrt(nx * nx + ny * ny));
        break;
      }
      case 'path': {
        const pts = shape.points;
        if (pts && vIdx >= 0 && vIdx < pts.length) {
          pts[vIdx].x = nx;
          pts[vIdx].y = ny;
        }
        break;
      }
    }
  },

  /**
   * Hit-test vertices of selected shapes. Returns { shapeIdx, vertexIdx } or null.
   * Tests in canvas pixel space with a generous hit radius.
   */
  _hitTestVertex(canvasX, canvasY) {
    const shapes = this.getCurrentShapes();
    const hitRadius = 6; // pixels

    // Only show vertices for selected shapes
    for (const si of this.selectedIndices) {
      const shape = shapes[si];
      if (!shape || shape.visible === false) continue;

      const verts = this._getVertices(shape);
      const sx = (shape.flipX ? -1 : 1) * (shape.scaleX ?? 1);
      const sy = (shape.flipY ? -1 : 1) * (shape.scaleY ?? 1);
      const rot = shape.rotation || 0;
      const px = shape.x || 0;
      const py = shape.y || 0;

      for (let vi = 0; vi < verts.length; vi++) {
        const v = verts[vi];
        // Transform local vertex to world space
        let wx = v.x * sx;
        let wy = v.y * sy;
        if (rot) {
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const rx = wx * cos - wy * sin;
          const ry = wx * sin + wy * cos;
          wx = rx; wy = ry;
        }
        wx += px;
        wy += py;

        // Convert to screen
        const screen = this.worldToScreen(wx, wy);
        const dx = canvasX - screen.x;
        const dy = canvasY - screen.y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          return { shapeIdx: si, vertexIdx: vi };
        }
      }
    }
    return null;
  },

  /**
   * Draw vertex handles (small circles) on all selected shapes.
   */
  _drawVertexHandles(ctx, w, h) {
    const shapes = this.getCurrentShapes();
    const z = this.zoom;
    const cx = w / 2 + this.panX;
    const cy = h / 2 + this.panY;

    for (const si of this.selectedIndices) {
      const shape = shapes[si];
      if (!shape || shape.visible === false) continue;

      const verts = this._getVertices(shape);
      const sx = (shape.flipX ? -1 : 1) * (shape.scaleX ?? 1);
      const sy = (shape.flipY ? -1 : 1) * (shape.scaleY ?? 1);
      const rot = shape.rotation || 0;
      const px = shape.x || 0;
      const py = shape.y || 0;

      for (const v of verts) {
        let wx = v.x * sx;
        let wy = v.y * sy;
        if (rot) {
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const rx = wx * cos - wy * sin;
          const ry = wx * sin + wy * cos;
          wx = rx; wy = ry;
        }
        wx += px;
        wy += py;

        const screenX = cx + wx * z;
        const screenY = cy + wy * z;

        // Outer ring
        ctx.beginPath();
        ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2a';
        ctx.fill();
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(screenX, screenY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff88';
        ctx.fill();
      }
    }
  },

  // ═════════════════════════════════════════════════════════════
  // MOUSE INTERACTION
  // ═════════════════════════════════════════════════════════════

  /**
   * Handle mouse down on the editor canvas.
   * @param {number} canvasX
   * @param {number} canvasY
   * @param {number} button - 0=left, 1=middle, 2=right
   * @param {boolean} [ctrlKey] - Ctrl/Cmd held for multi-select
   */
  onMouseDown(canvasX, canvasY, button, ctrlKey) {
    if (this.pathToolActive && button === 0) {
      // Path tool: add a point
      const world = this.screenToWorld(canvasX, canvasY);
      this._pathPoints.push({ x: world.x, y: world.y });
      return;
    }

    // Check vertex hit first (only on selected shapes)
    if (this.selectedIndices.length > 0 && button === 0) {
      const vHit = this._hitTestVertex(canvasX, canvasY);
      if (vHit) {
        this._draggingVertex = vHit;
        this._dragging = false;
        this._dragStartX = canvasX;
        this._dragStartY = canvasY;
        return;
      }
    }

    // Normal mode: hit test shapes
    const hitIdx = this.hitTest(canvasX, canvasY);

    if (hitIdx >= 0) {
      if (ctrlKey) {
        // Ctrl+click: toggle in multi-select
        this.toggleSelect(hitIdx);
      } else if (!this.isSelected(hitIdx)) {
        // Plain click on unselected: select only this
        this.selectShape(hitIdx);
      }
      // else: clicking already-selected shape, keep selection (start drag)

      // Start drag — store start positions for all selected shapes
      this._dragging = true;
      this._draggingVertex = null;
      this._dragStartX = canvasX;
      this._dragStartY = canvasY;
      this._dragShapeStarts = {};
      for (const si of this.selectedIndices) {
        const s = this.getCurrentShapes()[si];
        if (s) this._dragShapeStarts[si] = { x: s.x || 0, y: s.y || 0 };
      }
    } else {
      // Click on empty space: start marquee selection
      this.clearSelection();
      this._dragging = false;
      this._draggingVertex = null;
      this._marquee = { startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY };
    }
  },

  /**
   * Handle mouse move on the editor canvas.
   * @param {number} canvasX
   * @param {number} canvasY
   */
  onMouseMove(canvasX, canvasY) {
    // Always track cursor for path tool preview
    this._cursorCanvasX = canvasX;
    this._cursorCanvasY = canvasY;

    if (this._marquee) {
      this._marquee.endX = canvasX;
      this._marquee.endY = canvasY;
      return;
    }

    // Vertex dragging
    if (this._draggingVertex) {
      const { shapeIdx, vertexIdx } = this._draggingVertex;
      const shapes = this.getCurrentShapes();
      const shape = shapes[shapeIdx];
      if (!shape) return;

      // Convert mouse to world, then to shape-local space (undo transforms)
      const world = this.screenToWorld(canvasX, canvasY);
      let lx = world.x - (shape.x || 0);
      let ly = world.y - (shape.y || 0);

      // Undo rotation
      const rot = shape.rotation || 0;
      if (rot) {
        const cos = Math.cos(-rot), sin = Math.sin(-rot);
        const rx = lx * cos - ly * sin;
        const ry = lx * sin + ly * cos;
        lx = rx; ly = ry;
      }

      // Undo scale/flip
      const sx = (shape.flipX ? -1 : 1) * (shape.scaleX ?? 1);
      const sy = (shape.flipY ? -1 : 1) * (shape.scaleY ?? 1);
      if (sx) lx /= sx;
      if (sy) ly /= sy;

      this._setVertex(shape, vertexIdx, lx, ly);
      this._invalidateCache();
      return;
    }

    if (this._dragging && this.selectedIndices.length > 0) {
      const dx = (canvasX - this._dragStartX) / this.zoom;
      const dy = (canvasY - this._dragStartY) / this.zoom;
      const shapes = this.getCurrentShapes();

      // Move shapes to raw position first
      for (const si of this.selectedIndices) {
        const s = shapes[si];
        const start = this._dragShapeStarts?.[si];
        if (s && start) {
          s.x = start.x + dx;
          s.y = start.y + dy;
        }
      }

      // Snap guides: compute edges/centers of dragged vs all other shapes
      this._snapGuides = [];
      const SNAP_THRESHOLD = 1.5; // world units

      // Get bounds of primary selected shape
      const primary = shapes[this.selectedShapeIdx];
      if (primary) {
        const pb = this._getShapeBounds(primary);
        if (pb) {
          const pCx = pb.x + pb.w / 2;
          const pCy = pb.y + pb.h / 2;
          const pEdges = {
            left: pb.x, right: pb.x + pb.w, cx: pCx,
            top: pb.y, bottom: pb.y + pb.h, cy: pCy
          };

          let snapDx = 0, snapDy = 0;
          let bestDistX = SNAP_THRESHOLD, bestDistY = SNAP_THRESHOLD;

          for (let i = 0; i < shapes.length; i++) {
            if (this.selectedIndices.includes(i)) continue;
            const ob = this._getShapeBounds(shapes[i]);
            if (!ob) continue;
            const oCx = ob.x + ob.w / 2;
            const oCy = ob.y + ob.h / 2;
            const oEdges = {
              left: ob.x, right: ob.x + ob.w, cx: oCx,
              top: ob.y, bottom: ob.y + ob.h, cy: oCy
            };

            // X-axis alignment
            for (const pk of ['left', 'right', 'cx']) {
              for (const ok of ['left', 'right', 'cx']) {
                const dist = Math.abs(pEdges[pk] - oEdges[ok]);
                if (dist < bestDistX) {
                  bestDistX = dist;
                  snapDx = oEdges[ok] - pEdges[pk];
                  this._snapGuides = this._snapGuides.filter(g => g.axis !== 'x');
                  this._snapGuides.push({ axis: 'x', pos: oEdges[ok] });
                }
              }
            }

            // Y-axis alignment
            for (const pk of ['top', 'bottom', 'cy']) {
              for (const ok of ['top', 'bottom', 'cy']) {
                const dist = Math.abs(pEdges[pk] - oEdges[ok]);
                if (dist < bestDistY) {
                  bestDistY = dist;
                  snapDy = oEdges[ok] - pEdges[pk];
                  this._snapGuides = this._snapGuides.filter(g => g.axis !== 'y');
                  this._snapGuides.push({ axis: 'y', pos: oEdges[ok] });
                }
              }
            }
          }

          // Also snap to origin (0,0)
          for (const pk of ['left', 'right', 'cx']) {
            const dist = Math.abs(pEdges[pk]);
            if (dist < bestDistX) {
              bestDistX = dist;
              snapDx = -pEdges[pk];
              this._snapGuides = this._snapGuides.filter(g => g.axis !== 'x');
              this._snapGuides.push({ axis: 'x', pos: 0 });
            }
          }
          for (const pk of ['top', 'bottom', 'cy']) {
            const dist = Math.abs(pEdges[pk]);
            if (dist < bestDistY) {
              bestDistY = dist;
              snapDy = -pEdges[pk];
              this._snapGuides = this._snapGuides.filter(g => g.axis !== 'y');
              this._snapGuides.push({ axis: 'y', pos: 0 });
            }
          }

          // Apply snap offset
          if (snapDx !== 0 || snapDy !== 0) {
            for (const si of this.selectedIndices) {
              const s = shapes[si];
              if (s) {
                s.x = (s.x || 0) + snapDx;
                s.y = (s.y || 0) + snapDy;
              }
            }
          }

          // Clear guides if nothing snapped
          if (bestDistX >= SNAP_THRESHOLD) {
            this._snapGuides = this._snapGuides.filter(g => g.axis !== 'x');
          }
          if (bestDistY >= SNAP_THRESHOLD) {
            this._snapGuides = this._snapGuides.filter(g => g.axis !== 'y');
          }
        }
      }

      this._invalidateCache();
    }
  },

  /**
   * Handle mouse up on the editor canvas.
   */
  onMouseUp() {
    if (this._marquee) {
      this._finishMarquee();
      return;
    }
    this._dragging = false;
    this._draggingVertex = null;
    this._snapGuides = [];
  },

  /**
   * Finalize marquee: select all shapes whose bounds intersect the rectangle.
   */
  _finishMarquee() {
    const m = this._marquee;
    this._marquee = null;
    if (!m) return;

    // Convert marquee corners to world space
    const w1 = this.screenToWorld(Math.min(m.startX, m.endX), Math.min(m.startY, m.endY));
    const w2 = this.screenToWorld(Math.max(m.startX, m.endX), Math.max(m.startY, m.endY));

    // Check if marquee is too small (just a click, not a drag)
    if (Math.abs(m.endX - m.startX) < 3 && Math.abs(m.endY - m.startY) < 3) {
      this.clearSelection();
      return;
    }

    const shapes = this.getCurrentShapes();
    const hits = [];
    for (let i = 0; i < shapes.length; i++) {
      const bounds = this._getShapeBounds(shapes[i]);
      if (!bounds) continue;
      // AABB overlap test
      if (bounds.x + bounds.w >= w1.x && bounds.x <= w2.x &&
          bounds.y + bounds.h >= w1.y && bounds.y <= w2.y) {
        hits.push(i);
      }
    }

    this.selectedIndices = hits;
    this.selectedShapeIdx = hits.length > 0 ? hits[0] : -1;
  },

  // ═════════════════════════════════════════════════════════════
  // PATH TOOL
  // ═════════════════════════════════════════════════════════════

  /**
   * Activate the path drawing tool.
   */
  startPathTool() {
    this.pathToolActive = true;
    this._pathPoints = [];
  },

  /**
   * Finish the current path and create a path shape from placed points.
   * Requires at least 2 points.
   */
  finishPath() {
    if (this._pathPoints.length >= 2) {
      const shapes = this.getCurrentShapes();

      const shape = {
        ...COMMON_DEFAULTS,
        type: 'path',
        id: _genId(),
        points: _deepClone(this._pathPoints),
        closed: true
      };

      shapes.push(shape);
      this.selectedShapeIdx = shapes.length - 1;
      this._invalidateCache();
    }

    this.pathToolActive = false;
    this._pathPoints = [];
  },

  /**
   * Cancel the path tool without creating a shape.
   */
  cancelPath() {
    this._pathPoints = [];
    this.pathToolActive = false;
  },

  // ═════════════════════════════════════════════════════════════
  // THUMBNAILS
  // ═════════════════════════════════════════════════════════════

  /**
   * Render a small preview of one rank's insignia into a given context.
   * Centers the shapes and auto-scales to fit the given size.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} rank - 0-5
   * @param {number} size - Pixel dimensions of the thumbnail (square)
   */
  renderThumbnail(ctx, rank, size) {
    // Pixel mode: draw scaled pixel data
    if (this.mode === 'pixel') {
      const pd = this.pixelData[rank];
      if (!pd) return;
      // Draw 96x96 ImageData scaled down to thumbnail size
      const tmpCanvas = new OffscreenCanvas(96, 96);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.putImageData(pd, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmpCanvas, 0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      return;
    }

    // Vector mode: render shapes
    if (!this.currentSet || !this.currentSet.ranks[rank]) return;

    const rankData = this.currentSet.ranks[rank];
    const shapes = rankData.shapes;
    if (!shapes || shapes.length === 0) return;

    // Compute overall bounding box of all shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const shape of shapes) {
      const bounds = this._getShapeBounds(shape);
      if (!bounds) continue;
      if (bounds.x < minX) minX = bounds.x;
      if (bounds.y < minY) minY = bounds.y;
      if (bounds.x + bounds.w > maxX) maxX = bounds.x + bounds.w;
      if (bounds.y + bounds.h > maxY) maxY = bounds.y + bounds.h;
    }

    if (!isFinite(minX)) return;

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw <= 0 && bh <= 0) return;

    // Auto-scale to fit with some padding
    const padding = size * 0.15;
    const available = size - padding * 2;
    const scale = Math.min(available / Math.max(bw, 0.1), available / Math.max(bh, 0.1));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);

    drawInsignia(ctx, rankData, 1, this.currentSet?.patch);

    ctx.restore();
  }
};
