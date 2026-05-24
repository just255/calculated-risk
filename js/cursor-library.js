// Cursor + reticle library + builder. See docs/systems/cursors.md.
//
// Two cursor families:
//   - type 'menu'    → CSS cursor via data: URI. Needs hotspot.
//   - type 'battle'  → canvas-rendered in renderHeroCrosshair via entry.canvasDraw.
//                       template is still required (used for picker thumbnails).
//
// Each entry exposes a parts manifest. Settings store {id, colors?} where colors
// is an override map. resolveColors() merges with defaults.

// Tick geometry shared with hero-hud.js (kept in sync, see docs/systems/cursors.md).
const ORIG_GAP = 6;
const ORIG_TICK = 10;
const ORIG_WIDTH = 2;

// ═══════════════════════════════════════════════════════════════════════════
// Templates (SVG strings with {{token}} placeholders)
// ═══════════════════════════════════════════════════════════════════════════

const D3_AMBER_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="ag" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="{{fillTop}}"/><stop offset="1" stop-color="{{fillBottom}}"/></linearGradient><filter id="ds" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="0.7"/><feOffset dx="0.6" dy="1.1"/><feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M3 3 L3 23 L9 18 L13 26 L16 24.5 L12 16.5 L20 16.5 Z" fill="url(#ag)" stroke="{{outline}}" stroke-width="1.2" filter="url(#ds)"/></svg>`;

// `original` thumbnail — static rendering of the dynamic crosshair (uses 'auto' tokens replaced by sensible defaults for the picker).
const ORIGINAL_THUMB_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g stroke="{{stroke}}" stroke-width="${ORIG_WIDTH}" stroke-linecap="round" fill="none"><line x1="16" y1="${16 - ORIG_GAP}" x2="16" y2="${16 - ORIG_GAP - ORIG_TICK}"/><line x1="16" y1="${16 + ORIG_GAP}" x2="16" y2="${16 + ORIG_GAP + ORIG_TICK}"/><line x1="${16 - ORIG_GAP}" y1="16" x2="${16 - ORIG_GAP - ORIG_TICK}" y2="16"/><line x1="${16 + ORIG_GAP}" y1="16" x2="${16 + ORIG_GAP + ORIG_TICK}" y2="16"/></g><circle cx="16" cy="16" r="1.5" fill="{{center}}"/></svg>`;

const B1_OLIVE_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g stroke="{{stroke}}" stroke-width="1.6" fill="none"><circle cx="16" cy="16" r="9"/><line x1="16" y1="2" x2="16" y2="9"/><line x1="16" y1="23" x2="16" y2="30"/><line x1="2" y1="16" x2="9" y2="16"/><line x1="23" y1="16" x2="30" y2="16"/></g><circle cx="16" cy="16" r="1.8" fill="{{center}}"/></svg>`;

const B2_DIAMOND_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,3 29,16 16,29 3,16" fill="none" stroke="{{stroke}}" stroke-width="2"/><line x1="16" y1="10" x2="16" y2="22" stroke="{{inner}}" stroke-width="1.2"/><line x1="10" y1="16" x2="22" y2="16" stroke="{{inner}}" stroke-width="1.2"/><circle cx="16" cy="16" r="2" fill="{{center}}"/></svg>`;

// ═══════════════════════════════════════════════════════════════════════════
// Canvas draw fns (battle reticles only)
// ═══════════════════════════════════════════════════════════════════════════

// `original` canvasDraw — ports js/hero-hud.js:193-212 verbatim.
// colors.stroke / colors.center accept the sentinel 'auto' to mean
// "use the dynamic crossColor from opts" (red/green/gray based on alignment + ready).
function _drawOriginalReticle(ctx, x, y, colors, opts) {
  const dyn = opts?.crossColor || '#94a3b8';
  const stroke = colors.stroke === 'auto' ? dyn : colors.stroke;
  const center = colors.center === 'auto' ? stroke : colors.center;
  const shadow = colors.shadow || 'rgba(0, 0, 0, 0.5)';

  if (!opts?.skipCrosshair) {
    ctx.strokeStyle = shadow;
    ctx.lineWidth = ORIG_WIDTH + 2;
    ctx.lineCap = 'round';
    _origTicks(ctx, x, y);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = ORIG_WIDTH;
    _origTicks(ctx, x, y);
  }

  // Center dot — always drawn (kept even when ticks are skipped, matches
  // the pre-refactor behavior for infantry-on-mobile joystick aim).
  ctx.fillStyle = center;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function _origTicks(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y - ORIG_GAP);            ctx.lineTo(x, y - ORIG_GAP - ORIG_TICK);
  ctx.moveTo(x, y + ORIG_GAP);            ctx.lineTo(x, y + ORIG_GAP + ORIG_TICK);
  ctx.moveTo(x - ORIG_GAP, y);            ctx.lineTo(x - ORIG_GAP - ORIG_TICK, y);
  ctx.moveTo(x + ORIG_GAP, y);            ctx.lineTo(x + ORIG_GAP + ORIG_TICK, y);
  ctx.stroke();
}

// B1 olive reticle — circle outline + 4 ticks + center dot
function _drawB1Olive(ctx, x, y, colors) {
  const stroke = colors.stroke || '#8a9a4d';
  const center = colors.center || '#fbbf24';

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y - 9);   ctx.lineTo(x, y - 16);
  ctx.moveTo(x, y + 9);   ctx.lineTo(x, y + 16);
  ctx.moveTo(x - 9, y);   ctx.lineTo(x - 16, y);
  ctx.moveTo(x + 9, y);   ctx.lineTo(x + 16, y);
  ctx.stroke();

  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

// B2 diamond — outline + inner cross + center dot
function _drawB2Diamond(ctx, x, y, colors) {
  const stroke = colors.stroke || '#fb923c';
  const inner = colors.inner || '#fb923c';
  const center = colors.center || '#fbbf24';

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 13);
  ctx.lineTo(x + 13, y);
  ctx.lineTo(x, y + 13);
  ctx.lineTo(x - 13, y);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = inner;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
  ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
  ctx.stroke();

  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ═══════════════════════════════════════════════════════════════════════════
// Built-in entries
// ═══════════════════════════════════════════════════════════════════════════

export const BUILT_IN_CURSORS = [
  {
    id: 'd3-amber',
    name: 'Amber Arrow',
    type: 'menu',
    parts: [
      { token: 'fillTop',    label: 'Highlight', default: '#fde68a' },
      { token: 'fillBottom', label: 'Shadow',    default: '#d97706' },
      { token: 'outline',    label: 'Outline',   default: '#1a1f2e' }
    ],
    template: D3_AMBER_TEMPLATE,
    hotspot: [3, 3]
  },
  {
    id: 'original',
    name: 'Original Crosshair',
    type: 'battle',
    // 'auto' is a sentinel: original entry uses dynamic crossColor at runtime.
    parts: [
      { token: 'stroke', label: 'Stroke',     default: 'auto' },
      { token: 'shadow', label: 'Shadow',     default: 'rgba(0,0,0,0.5)' },
      { token: 'center', label: 'Center dot', default: 'auto' }
    ],
    template: ORIGINAL_THUMB_TEMPLATE,
    canvasDraw: _drawOriginalReticle
  },
  {
    id: 'b1-olive',
    name: 'Olive Reticle',
    type: 'battle',
    parts: [
      { token: 'stroke', label: 'Stroke',     default: '#8a9a4d' },
      { token: 'center', label: 'Center dot', default: '#fbbf24' }
    ],
    template: B1_OLIVE_TEMPLATE,
    canvasDraw: _drawB1Olive
  },
  {
    id: 'b2-diamond',
    name: 'Diamond Marker',
    type: 'battle',
    parts: [
      { token: 'stroke', label: 'Outline',     default: '#fb923c' },
      { token: 'inner',  label: 'Inner cross', default: '#fb923c' },
      { token: 'center', label: 'Center dot',  default: '#fbbf24' }
    ],
    template: B2_DIAMOND_TEMPLATE,
    canvasDraw: _drawB2Diamond
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function defaultColors(entry) {
  const out = {};
  for (const p of entry.parts) out[p.token] = p.default;
  return out;
}

export function resolveColors(entry, override) {
  return { ...defaultColors(entry), ...(override || {}) };
}

// Resolve any id (built-in or custom) to a renderable entry shape.
// Custom entries can be:
//   (a) library-derived — { id, baseId, name, type, colors? } → merged with base
//   (b) user-uploaded   — { id, baseId: null, name, type, template, parts, hotspot? } → returned as-is
export function getCursor(id, customLibrary = []) {
  const direct = BUILT_IN_CURSORS.find(c => c.id === id);
  if (direct) return direct;

  const c = customLibrary.find(c => c.id === id);
  if (!c) return null;

  // (b) User-uploaded — already self-contained.
  if (c.template) return c;

  // (a) Library-derived — clone base, override part defaults with custom-baked colors.
  const base = BUILT_IN_CURSORS.find(b => b.id === c.baseId);
  if (!base) return null;
  const mergedParts = base.parts.map(p => ({
    ...p,
    default: (c.colors && c.colors[p.token] !== undefined) ? c.colors[p.token] : p.default
  }));
  return {
    ...base,
    id: c.id,
    name: c.name || base.name,
    parts: mergedParts
    // hotspot / template / canvasDraw / type inherited from base via spread
  };
}

// Replace {{token}} placeholders, then URL-encode for use as data: URI.
// Works in both `cursor: url("…")` declarations and `<img src="…">`.
export function buildCursorSvg(entry, colors) {
  if (!entry?.template) return null;
  let svg = entry.template;
  for (const [k, v] of Object.entries(colors)) {
    svg = svg.split(`{{${k}}}`).join(v);
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Default fallback ids — used by settings migration and resolve-or-fallback.
export const DEFAULT_MENU_CURSOR_ID = 'd3-amber';
export const DEFAULT_BATTLE_RETICLE_ID = 'original';

// ═══════════════════════════════════════════════════════════════════════════
// SVG sanitization for user-pasted custom cursors
// (whitelist elements + attributes, reject everything else; see plan risk #4)
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_ELEMENTS = new Set([
  'svg', 'defs', 'g', 'path', 'line', 'rect', 'circle', 'ellipse',
  'polygon', 'polyline', 'linearGradient', 'radialGradient', 'stop',
  'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
  'feComponentTransfer', 'feFuncA', 'feFlood', 'feComposite'
]);

const ALLOWED_ATTRS = new Set([
  'viewBox', 'width', 'height', 'xmlns', 'd', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'x', 'y',
  'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points',
  'gradientUnits', 'offset', 'stop-color', 'stop-opacity', 'fill-opacity',
  'filterUnits', 'stdDeviation', 'dx', 'dy', 'type', 'slope', 'in', 'in2',
  'result', 'data-part', 'data-part-label'
]);

export function sanitizeSvg(text) {
  if (typeof text !== 'string') return { ok: false, err: 'not a string' };
  if (text.length > 10240) return { ok: false, err: 'too large (>10kb)' };

  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { ok: false, err: 'invalid xml' };

  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') return { ok: false, err: 'root must be <svg>' };
  if (!svg.getAttribute('viewBox')) return { ok: false, err: 'missing viewBox' };

  const parts = [];
  function walk(el) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) { el.remove(); return; }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'xlink:href') {
        if (!attr.value.startsWith('#')) el.removeAttribute(attr.name);
        continue;
      }
      if (!ALLOWED_ATTRS.has(name)) el.removeAttribute(attr.name);
    }
    const partId = el.getAttribute('data-part');
    if (partId && !parts.find(p => p.token === partId)) {
      parts.push({
        token: partId,
        label: el.getAttribute('data-part-label') || partId,
        default: el.getAttribute('fill') || el.getAttribute('stroke') || '#888888'
      });
    }
    for (const child of [...el.children]) walk(child);
  }
  walk(svg);

  return { ok: true, svg: svg.outerHTML, parts };
}
