// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Clear Tool
// Targeted clearing of terrain features
// ═══════════════════════════════════════════════════════════════

import { removeTreesInRadius } from '../../world-builder/strokes.js';

/**
 * Clear tool - removes terrain features with options for what to clear
 */
export const ClearTool = {
  name: 'clear',
  icon: '🧹',
  cursor: 'crosshair',

  // Internal state
  _isClearing: false,
  _lastClearPos: null,
  _strokesRemovedDuringDrag: 0,

  onActivate(state, renderer) {
    console.log('[ClearTool] Activated');
  },

  onDeactivate(state, renderer) {
    this._isClearing = false;
    this._lastClearPos = null;
    renderer.clearBrushPreview();
  },

  onMouseDown(e, state, renderer) {
    if (e.button === 0) {
      // Left click - start clearing
      this._isClearing = true;
      this._lastClearPos = { x: e.x, y: e.y };
      this._strokesRemovedDuringDrag = 0;
      this._clear(e.x, e.y, state, false);
    }
  },

  onMouseMove(e, state, renderer) {
    const options = state.toolOptions;

    // Check if within bounds
    const inBounds = e.x >= 0 && e.x <= state.canvasWidth &&
                     e.y >= 0 && e.y <= state.canvasHeight;

    // Update brush preview (red tint for clearing)
    if (inBounds) {
      renderer.setBrushPreview(e.x, e.y, options.brushRadius, 'rgba(255, 100, 50, 0.4)');
    } else {
      renderer.setBrushPreview(e.x, e.y, options.brushRadius, 'rgba(255, 50, 50, 0.3)');
    }

    // Drag clearing (only in bounds)
    if (this._isClearing && e.buttons === 1 && inBounds) {
      const dx = e.x - this._lastClearPos.x;
      const dy = e.y - this._lastClearPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Clear spacing: 40% of brush radius (min 20px)
      const clearSpacing = Math.max(20, options.brushRadius * 0.4);

      if (dist >= clearSpacing) {
        this._clear(e.x, e.y, state, true);
        this._lastClearPos = { x: e.x, y: e.y };
        this._strokesRemovedDuringDrag++;
      }
    }
  },

  onMouseUp(e, state, renderer) {
    // Final render after drag clearing
    if (this._isClearing && this._strokesRemovedDuringDrag > 0) {
      state.requestRender();
    }
    this._isClearing = false;
    this._lastClearPos = null;
    this._strokesRemovedDuringDrag = 0;
  },

  onMouseLeave(state, renderer) {
    // Final render if we were clearing when leaving
    if (this._isClearing && this._strokesRemovedDuringDrag > 0) {
      state.requestRender();
    }
    this._isClearing = false;
    this._lastClearPos = null;
    this._strokesRemovedDuringDrag = 0;
  },

  // ═══════════════════════════════════════════════════════════════
  // CLEARING LOGIC
  // ═══════════════════════════════════════════════════════════════

  _clear(x, y, state, skipRender = false) {
    const options = state.toolOptions;
    const radius = options.brushRadius;
    const clearMode = options.clearMode || 'all';

    // Clamp to canvas bounds
    if (x < 0 || x > state.canvasWidth || y < 0 || y > state.canvasHeight) {
      return;
    }

    let anyCleared = false;

    // Clear trees if mode allows
    if (clearMode === 'all' || clearMode === 'trees') {
      const treesRemoved = state.clearTreesAt(x, y, radius, options.falloff || 'hard');
      if (treesRemoved > 0) anyCleared = true;
    }

    // Clear brush/undergrowth if mode allows
    if (clearMode === 'all' || clearMode === 'brush') {
      const brushRemoved = state.clearBrushAt(x, y, radius, options.falloff || 'hard');
      if (brushRemoved > 0) anyCleared = true;
    }

    // Clear water strokes if mode allows
    if (clearMode === 'all' || clearMode === 'water') {
      const removed = this._removeStrokesByType(state, x, y, radius, 'water');
      if (removed > 0) anyCleared = true;
    }

    // Clear ground texture strokes if mode allows
    if (clearMode === 'all' || clearMode === 'groundTexture') {
      const removed = this._removeStrokesByType(state, x, y, radius, 'groundTexture');
      if (removed > 0) anyCleared = true;
    }

    // Clear forest strokes (feature coverage, not trees) if mode allows
    if (clearMode === 'all' || clearMode === 'forest') {
      const removed = this._removeStrokesByType(state, x, y, radius, 'forest');
      if (removed > 0) anyCleared = true;
    }

    if (anyCleared && !skipRender) {
      state.requestRender();
    }
  },

  _removeStrokesByType(state, x, y, radius, type) {
    const terrainMap = state.terrainMap;
    if (!terrainMap || !terrainMap.strokes) return 0;

    const radiusSq = radius * radius;
    const before = terrainMap.strokes.length;

    terrainMap.strokes = terrainMap.strokes.filter(stroke => {
      // Skip if not the target type
      if (stroke.type !== type) return true;

      // Check if stroke center is within clearing radius
      const dx = stroke.x - x;
      const dy = stroke.y - y;
      const distSq = dx * dx + dy * dy;

      // Remove if stroke center is within radius
      // or if clearing radius overlaps with stroke radius
      const combinedRadius = radius + (stroke.radius || 0);
      return distSq > combinedRadius * combinedRadius;
    });

    const removed = before - terrainMap.strokes.length;
    if (removed > 0) {
      terrainMap.dirty = true;
    }
    return removed;
  }
};
