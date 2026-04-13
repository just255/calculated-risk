// ═══════════════════════════════════════════════════════════════
// RENDER CACHE — Shared caching utilities for canvas rendering
// Reduces per-frame cost of text labels, minimap, and repeated draws.
// ═══════════════════════════════════════════════════════════════

// ── Text label cache ────────────────────────────────────────
// Pre-renders unit name labels to offscreen canvases.
// Key: label string. Value: { canvas, width, height }.

const _labelCache = new Map();
const LABEL_FONT = 'bold 8px Oxanium, monospace';
const LABEL_PADDING = 4; // extra pixels around text for outline

/**
 * Get or create a cached text label canvas.
 * @param {string} label - Text to render
 * @param {string} color - Fill color
 * @returns {{ canvas: HTMLCanvasElement, width: number, height: number }}
 */
export function getCachedLabel(label, color) {
  const key = `${label}|${color}`;
  if (_labelCache.has(key)) return _labelCache.get(key);

  // Measure text
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = LABEL_FONT;
  const metrics = measure.measureText(label);
  const w = Math.ceil(metrics.width) + LABEL_PADDING * 2;
  const h = 12 + LABEL_PADDING * 2;

  // Render to offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Outline (replaces expensive shadowBlur)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeText(label, w / 2, LABEL_PADDING);

  // Fill
  ctx.fillStyle = color;
  ctx.fillText(label, w / 2, LABEL_PADDING);

  const entry = { canvas, width: w, height: h };
  _labelCache.set(key, entry);
  return entry;
}

/**
 * Clear all cached labels (call on battle end or unit rename).
 */
export function clearLabelCache() {
  _labelCache.clear();
}

// ── Minimap throttle ────────────────────────────────────────

let _minimapFrame = 0;

/**
 * Check if the minimap should redraw this frame.
 * Draws every Nth frame to reduce cost.
 * @param {number} [interval=3] - Draw every N frames
 * @returns {boolean}
 */
export function shouldDrawMinimap(interval = 3) {
  _minimapFrame++;
  return _minimapFrame % interval === 0;
}
