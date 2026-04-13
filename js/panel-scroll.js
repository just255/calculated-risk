// ═══════════════════════════════════════════════════════════════
// PANEL-SCROLL - General-purpose scrollable canvas panel regions
// ═══════════════════════════════════════════════════════════════

const SCROLL_SPEED = 24;
const SCROLLBAR_W = 4;

// ─── State ───────────────────────────────────────────────────

/**
 * All scroll state lives on the battle object at b._panelScroll.
 *   b._panelScroll.offsets  = { [key]: number }   — scroll positions
 *   b._panelScroll.regions  = { [key]: { x, y, w, h, contentH } } — registered regions
 */
function _ensure(b) {
  if (!b._panelScroll) b._panelScroll = { offsets: {}, regions: {} };
  return b._panelScroll;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Register a scrollable region and get the current scroll offset.
 * Call this at draw time before drawing content.
 *
 * @param {object} b        - Battle object
 * @param {string} key      - Unique region key (e.g. 'lineup', 'pool', 'available')
 * @param {number} x        - Region left edge (screen px)
 * @param {number} y        - Region top edge (screen px)
 * @param {number} w        - Region width
 * @param {number} clipH    - Visible height
 * @param {number} contentH - Total content height (may exceed clipH)
 * @returns {number} Current scroll offset (0 = top)
 */
export function registerScrollRegion(b, key, x, y, w, clipH, contentH) {
  const ps = _ensure(b);
  const maxScroll = Math.max(0, contentH - clipH);

  let scroll = ps.offsets[key] || 0;
  if (scroll > maxScroll) scroll = maxScroll;
  if (scroll < 0) scroll = 0;
  ps.offsets[key] = scroll;

  ps.regions[key] = { x, y, w, h: clipH, contentH };
  return scroll;
}

/**
 * Begin a clipped scroll region. Call before drawing content.
 * Saves canvas state and sets clip rect.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x, y, w, clipH - Region bounds
 */
export function beginScrollClip(ctx, x, y, w, clipH) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 4, y - 2, w + 8, clipH + 4);
  ctx.clip();
}

/**
 * End a clipped scroll region and draw scrollbar if needed.
 * Restores canvas state.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} b    - Battle object
 * @param {string} key  - Region key
 * @param {number} x, y, w, clipH - Region bounds
 */
export function endScrollClip(ctx, b, key, x, y, w, clipH) {
  ctx.restore();

  const ps = _ensure(b);
  const region = ps.regions[key];
  if (!region || region.contentH <= clipH) return;

  const contentH = region.contentH;
  const scroll = ps.offsets[key] || 0;
  const maxScroll = contentH - clipH;

  // Scrollbar track
  ctx.fillStyle = 'rgba(100, 130, 70, 0.25)';
  ctx.fillRect(x + w - SCROLLBAR_W, y, SCROLLBAR_W, clipH);

  // Scrollbar thumb
  const barH = Math.max(16, (clipH / contentH) * clipH);
  const barY = maxScroll > 0 ? y + (scroll / maxScroll) * (clipH - barH) : y;
  ctx.fillStyle = 'rgba(140, 176, 96, 0.5)';
  ctx.fillRect(x + w - SCROLLBAR_W, barY, SCROLLBAR_W, barH);
}

/**
 * Handle a wheel event. Tests all registered regions against mouse position.
 * Returns true if the event was consumed.
 *
 * @param {object} b       - Battle object
 * @param {number} screenX - Mouse X in screen/canvas coords
 * @param {number} screenY - Mouse Y in screen/canvas coords
 * @param {number} deltaY  - Wheel delta (positive = scroll down)
 * @returns {boolean} true if scroll was applied
 */
export function handlePanelWheel(b, screenX, screenY, deltaY) {
  const ps = b._panelScroll;
  if (!ps) return false;

  for (const [key, region] of Object.entries(ps.regions)) {
    if (screenX >= region.x && screenX <= region.x + region.w &&
        screenY >= region.y && screenY <= region.y + region.h) {
      // Only scroll if content overflows
      if (region.contentH <= region.h) continue;
      const maxScroll = region.contentH - region.h;
      const scroll = ps.offsets[key] || 0;
      const dir = deltaY > 0 ? 1 : -1;
      ps.offsets[key] = Math.max(0, Math.min(maxScroll, scroll + dir * SCROLL_SPEED));
      return true;
    }
  }
  return false;
}

/**
 * Get current scroll offset for a region.
 */
export function getScrollOffset(b, key) {
  return b._panelScroll?.offsets?.[key] || 0;
}

/**
 * Filter an array of hit rects, removing entries added after startIdx
 * that fall outside the visible clip region.
 *
 * @param {Array} rects    - Hit rect array
 * @param {number} startIdx - Index before new rects were added
 * @param {number} clipTop  - Top of visible area
 * @param {number} clipH    - Height of visible area
 */
export function filterRectsToClip(rects, startIdx, clipTop, clipH) {
  for (let i = rects.length - 1; i >= startIdx; i--) {
    const r = rects[i];
    if (r.y + r.h < clipTop - 2 || r.y > clipTop + clipH + 2) {
      rects.splice(i, 1);
    }
  }
}
