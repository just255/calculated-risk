// ═══════════════════════════════════════════════════════════════
// INSIGNIA RENDERER - Shared vector rendering for military rank insignia
// Pure rendering utility: no state management, no game logic.
// Used by the insignia editor and the battle entity renderer.
// ═══════════════════════════════════════════════════════════════

// Module-level cache: Map<string, OffscreenCanvas>
// Keys are "${setId}_${rank}"
const cache = new Map();

// ─── Patch Background ──────────────────────────────────────────

/**
 * Draw a patch background shape centered at origin.
 * Called before shapes so it sits behind everything.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} patch - { enabled, shape, fillColor, strokeColor, strokeWidth, width, height }
 */
function drawPatch(ctx, patch) {
  if (!patch || !patch.enabled) return;

  const w = (patch.width ?? 28) / 2;
  const h = (patch.height ?? 34) / 2;
  const r = Math.min(w, h);

  ctx.save();
  ctx.beginPath();

  switch (patch.shape) {
    case 'shield':
      // Classic Army shield: flat top, pointed bottom
      ctx.moveTo(-w, -h);
      ctx.lineTo(w, -h);
      ctx.lineTo(w, h * 0.3);
      ctx.lineTo(0, h);
      ctx.lineTo(-w, h * 0.3);
      ctx.closePath();
      break;

    case 'rounded':
      // Rounded rectangle
      const cr = Math.min(4, w, h);
      ctx.moveTo(-w + cr, -h);
      ctx.lineTo(w - cr, -h);
      ctx.quadraticCurveTo(w, -h, w, -h + cr);
      ctx.lineTo(w, h - cr);
      ctx.quadraticCurveTo(w, h, w - cr, h);
      ctx.lineTo(-w + cr, h);
      ctx.quadraticCurveTo(-w, h, -w, h - cr);
      ctx.lineTo(-w, -h + cr);
      ctx.quadraticCurveTo(-w, -h, -w + cr, -h);
      ctx.closePath();
      break;

    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;

    case 'rect':
    default:
      ctx.rect(-w, -h, w * 2, h * 2);
      break;
  }

  if (patch.filled !== false && patch.fillColor) {
    ctx.fillStyle = patch.fillColor;
    ctx.fill();
  }
  if (patch.outlined !== false && patch.strokeColor && (patch.strokeWidth ?? 1) > 0) {
    ctx.strokeStyle = patch.strokeColor;
    ctx.lineWidth = patch.strokeWidth ?? 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Shape Drawing ─────────────────────────────────────────────

/**
 * Draw a single shape primitive onto a canvas context.
 * Applies translate, rotate, scale, and flip transforms in isolation.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} shape - Shape definition with type, transforms, style, and geometry params
 */
export function drawShape(ctx, shape) {
  if (shape.visible === false) return;

  ctx.save();

  // --- Transforms ---
  ctx.translate(shape.x || 0, shape.y || 0);
  if (shape.rotation) ctx.rotate(shape.rotation);
  const sx = (shape.flipX ? -1 : 1) * (shape.scaleX ?? 1);
  const sy = (shape.flipY ? -1 : 1) * (shape.scaleY ?? 1);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);

  // --- Style ---
  ctx.lineCap = shape._lineCap || (shape._roundCaps ? 'round' : 'butt');
  ctx.lineJoin = shape._lineJoin || (shape._roundCaps ? 'round' : 'miter');
  if (shape._miterLimit != null) ctx.miterLimit = shape._miterLimit;
  ctx.strokeStyle = shape.strokeColor || '#ffd700';
  ctx.lineWidth = shape.strokeWidth ?? 1.5;

  // --- Mitered chevron: each arm as a filled polygon with skewed apex end ---
  // Tips get square-cap extensions, apex ends are cut along the miter line (x=0).
  if (shape._splitArms && shape.type === 'chevron') {
    const halfW = shape.halfW ?? 6;
    const h = shape.height ?? 7;
    const bow = halfW * (shape.bow ?? 0.35);
    const sc = shape.strokeColor || '#ffd700';
    const hw = (shape.strokeWidth ?? 1.5) / 2;
    const N = 16;

    // Fill the closed chevron interior if needed
    if (shape.fillEnabled && shape._closePath) {
      ctx.beginPath();
      ctx.moveTo(-halfW, h);
      ctx.quadraticCurveTo(-halfW * 0.5 + bow, h * 0.45, 0, 0);
      ctx.quadraticCurveTo(halfW * 0.5 - bow, h * 0.45, halfW, h);
      ctx.closePath();
      const prevA = ctx.globalAlpha;
      ctx.globalAlpha = prevA * (shape.fillOpacity ?? 1);
      ctx.fillStyle = shape.fillColor || sc;
      ctx.fill();
      ctx.globalAlpha = prevA;
    }

    // Helper: find y where an edge line crosses x=0 (extrapolate from last 2 samples)
    const xZeroY = (p1, p2) => {
      const dx = p2[0] - p1[0];
      if (Math.abs(dx) < 0.001) return p2[1];
      const t = -p1[0] / dx;
      return p1[1] + t * (p2[1] - p1[1]);
    };

    // Left arm: sample offset edges
    const lP0 = [-halfW, h];
    const lCP = [-halfW * 0.5 + bow, h * 0.45];
    const lP1 = [0, 0];
    const left = _sampleArm(...lP0, ...lCP, ...lP1, hw, N, false);

    // Square cap at left tip: extend by hw along reverse tangent
    const [lt0x, lt0y] = _tangentQ(...lP0, ...lCP, ...lP1, 0);
    const lt0L = Math.hypot(lt0x, lt0y) || 1;
    const tipDx = -(lt0x / lt0L) * hw, tipDy = -(lt0y / lt0L) * hw;
    const tipE1 = [left.edge1[0][0] + tipDx, left.edge1[0][1] + tipDy];
    const tipE2 = [left.edge2[0][0] + tipDx, left.edge2[0][1] + tipDy];

    // Miter at apex: extrapolate each edge to x=0
    const apexY1 = xZeroY(left.edge1[N - 1], left.edge1[N]);
    const apexY2 = xZeroY(left.edge2[N - 1], left.edge2[N]);

    // Build left arm polygon
    ctx.beginPath();
    ctx.moveTo(tipE1[0], tipE1[1]);
    for (let i = 0; i <= N; i++) ctx.lineTo(left.edge1[i][0], left.edge1[i][1]);
    ctx.lineTo(0, apexY1); // skewed apex end
    ctx.lineTo(0, apexY2);
    for (let i = N; i >= 0; i--) ctx.lineTo(left.edge2[i][0], left.edge2[i][1]);
    ctx.lineTo(tipE2[0], tipE2[1]);
    ctx.closePath();
    ctx.fillStyle = sc;
    ctx.fill();

    // Right arm: sample offset edges
    const rP0 = [0, 0];
    const rCP = [halfW * 0.5 - bow, h * 0.45];
    const rP1 = [halfW, h];
    const right = _sampleArm(...rP0, ...rCP, ...rP1, hw, N, false);

    // Square cap at right tip: extend by hw along tangent at t=1
    const [rt1x, rt1y] = _tangentQ(...rP0, ...rCP, ...rP1, 1);
    const rt1L = Math.hypot(rt1x, rt1y) || 1;
    const tipDxR = (rt1x / rt1L) * hw, tipDyR = (rt1y / rt1L) * hw;
    const tipE1R = [right.edge1[N][0] + tipDxR, right.edge1[N][1] + tipDyR];
    const tipE2R = [right.edge2[N][0] + tipDxR, right.edge2[N][1] + tipDyR];

    // Miter at apex: extrapolate each edge to x=0
    const apexY1R = xZeroY(right.edge1[1], right.edge1[0]);
    const apexY2R = xZeroY(right.edge2[1], right.edge2[0]);

    // Build right arm polygon
    ctx.beginPath();
    ctx.moveTo(0, apexY1R); // skewed apex end
    for (let i = 0; i <= N; i++) ctx.lineTo(right.edge1[i][0], right.edge1[i][1]);
    ctx.lineTo(tipE1R[0], tipE1R[1]);
    ctx.lineTo(tipE2R[0], tipE2R[1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(right.edge2[i][0], right.edge2[i][1]);
    ctx.lineTo(0, apexY2R);
    ctx.closePath();
    ctx.fillStyle = sc;
    ctx.fill();

    ctx.restore();
    return;
  }

  // --- Build path by type ---
  ctx.beginPath();

  switch (shape.type) {
    case 'chevron':
      _pathChevron(ctx, shape);
      break;
    case 'arc':
      _pathArc(ctx, shape);
      break;
    case 'diamond':
      _pathDiamond(ctx, shape);
      break;
    case 'line':
      _pathLine(ctx, shape);
      break;
    case 'circle':
      _pathCircle(ctx, shape);
      break;
    case 'path':
      _pathCustom(ctx, shape);
      break;
    default:
      ctx.restore();
      return;
  }

  // Close open paths (chevron, arc, line) so fill covers the full shape
  if (shape._closePath) ctx.closePath();

  // --- Fill (optional) then stroke ---
  if (shape.fillEnabled) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * (shape.fillOpacity ?? 1);
    ctx.fillStyle = shape.fillColor || shape.strokeColor || '#ffd700';
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
  }

  // --- Outline mode: filled polygon with vertical ends ---
  if (shape.verticalEnds && (shape.type === 'chevron' || shape.type === 'arc')) {
    ctx.fillStyle = shape.strokeColor || '#ffd700';
    _fillOutline(ctx, shape);
  } else {
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Path Builders (private) ──────────────────────────────────

/**
 * Curved V pointing UP. Apex at (0, 0), arms spread down to (+-halfW, height).
 * Arms bow inward: control points are pulled toward the center axis.
 */
function _pathChevron(ctx, s) {
  const halfW = s.halfW ?? 6;
  const h = s.height ?? 7;
  const bow = halfW * (s.bow ?? 0.35);

  // Left arm: tip up to apex
  ctx.moveTo(-halfW, h);
  ctx.quadraticCurveTo(-halfW * 0.5 + bow, h * 0.45, 0, 0);
  // Right arm: apex down to tip
  ctx.quadraticCurveTo(halfW * 0.5 - bow, h * 0.45, halfW, h);
}

/**
 * Convex upward arc. Endpoints at (+-halfW, 0), bulge up to (0, -arcHeight).
 */
function _pathArc(ctx, s) {
  const halfW = s.halfW ?? 6;
  const arcH = s.arcHeight ?? 4;

  ctx.moveTo(-halfW, 0);
  ctx.quadraticCurveTo(0, -arcH, halfW, 0);
}

/**
 * Four-sided rhombus centered at origin.
 */
function _pathDiamond(ctx, s) {
  const hw = (s.width ?? 8) / 2;
  const hh = (s.height ?? 8) / 2;

  ctx.moveTo(0, -hh);   // top
  ctx.lineTo(hw, 0);    // right
  ctx.lineTo(0, hh);    // bottom
  ctx.lineTo(-hw, 0);   // left
  ctx.closePath();
}

/**
 * Horizontal line from (-length/2, 0) to (length/2, 0).
 * Rotation (applied via ctx.rotate above) controls direction.
 */
function _pathLine(ctx, s) {
  const half = (s.length ?? 10) / 2;

  ctx.moveTo(-half, 0);
  ctx.lineTo(half, 0);
}

/**
 * Circle centered at origin.
 */
function _pathCircle(ctx, s) {
  const r = s.radius ?? 4;

  ctx.arc(0, 0, r, 0, Math.PI * 2);
}

/**
 * Custom path from an array of points.
 * Each point: { x, y, cp1x?, cp1y?, cp2x?, cp2y? }
 * If cp1/cp2 are present, bezierCurveTo is used. Otherwise lineTo.
 */
function _pathCustom(ctx, s) {
  const pts = s.points;
  if (!pts || pts.length === 0) return;

  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
      ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  if (s.closed) ctx.closePath();
}

// ─── Outline Rendering ──────────────────────────────────────

/** Sample a quadratic bezier at parameter t */
function _sampleQ(p0x, p0y, cpx, cpy, p1x, p1y, t) {
  const mt = 1 - t;
  return [mt * mt * p0x + 2 * mt * t * cpx + t * t * p1x,
          mt * mt * p0y + 2 * mt * t * cpy + t * t * p1y];
}

/** Tangent of a quadratic bezier at parameter t */
function _tangentQ(p0x, p0y, cpx, cpy, p1x, p1y, t) {
  const mt = 1 - t;
  return [2 * mt * (cpx - p0x) + 2 * t * (p1x - cpx),
          2 * mt * (cpy - p0y) + 2 * t * (p1y - cpy)];
}

/**
 * Sample an arm (quadratic bezier) and compute offset edge points.
 * Returns { edge1: [[x,y],...], edge2: [[x,y],...] }
 */
function _sampleArm(p0x, p0y, cpx, cpy, p1x, p1y, hw, N, startT) {
  const edge1 = [], edge2 = [];
  for (let i = (startT ? 1 : 0); i <= N; i++) {
    const t = i / N;
    const [px, py] = _sampleQ(p0x, p0y, cpx, cpy, p1x, p1y, t);
    const [tx, ty] = _tangentQ(p0x, p0y, cpx, cpy, p1x, p1y, t);
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    const nx = -ty / len, ny = tx / len;
    edge1.push([px + nx * hw, py + ny * hw]);
    edge2.push([px - nx * hw, py - ny * hw]);
  }
  return { edge1, edge2 };
}

/**
 * Draw a shape as a filled outline polygon with vertical ends.
 * Replaces ctx.stroke() for shapes that need precise edge control.
 */
function _fillOutline(ctx, shape) {
  const hw = (shape.strokeWidth ?? 1.5) / 2;
  const N = 14;

  if (shape.type === 'chevron') {
    const halfW = shape.halfW ?? 6;
    const h = shape.height ?? 7;
    const bow = halfW * (shape.bow ?? 0.35);

    // Left arm: (-halfW, h) → (0, 0)
    const left = _sampleArm(-halfW, h, -halfW * 0.5 + bow, h * 0.45, 0, 0, hw, N, false);
    // Right arm: (0, 0) → (halfW, h)
    const right = _sampleArm(0, 0, halfW * 0.5 - bow, h * 0.45, halfW, h, hw, N, true);

    // Merge edges
    const e1 = [...left.edge1, ...right.edge1];
    const e2 = [...left.edge2, ...right.edge2];

    const last = e1.length - 1;
    // Force vertical ends only when explicitly requested
    if (shape.verticalEnds) {
      e1[0][0] = -halfW;
      e2[0][0] = -halfW;
      e1[last][0] = halfW;
      e2[last][0] = halfW;
    }

    // Build polygon: edge1 forward → edge2 backward → closePath
    ctx.beginPath();
    ctx.moveTo(e1[0][0], e1[0][1]);
    for (let i = 1; i <= last; i++) ctx.lineTo(e1[i][0], e1[i][1]);
    ctx.lineTo(e2[last][0], e2[last][1]); // right vertical end
    for (let i = last - 1; i >= 0; i--) ctx.lineTo(e2[i][0], e2[i][1]);
    ctx.closePath(); // left vertical end
    ctx.fill();

  } else if (shape.type === 'arc') {
    const halfW = shape.halfW ?? 6;
    const arcH = shape.arcHeight ?? 4;

    const arm = _sampleArm(-halfW, 0, 0, -arcH, halfW, 0, hw, N, false);

    if (shape.verticalEnds) {
      arm.edge1[0][0] = -halfW;
      arm.edge2[0][0] = -halfW;
      arm.edge1[N][0] = halfW;
      arm.edge2[N][0] = halfW;
    }

    ctx.beginPath();
    ctx.moveTo(arm.edge1[0][0], arm.edge1[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(arm.edge1[i][0], arm.edge1[i][1]);
    ctx.lineTo(arm.edge2[N][0], arm.edge2[N][1]);
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(arm.edge2[i][0], arm.edge2[i][1]);
    ctx.closePath();
    ctx.fill();
  }
}

// ─── Insignia Composition ─────────────────────────────────────


/** Draw a shape, handling array/repeat if present. */
function _drawShapeWithArray(ctx, shape) {
  if (shape.array && shape.array.linked && shape.array.count > 1) {
    const { count, spacing, direction } = shape.array;
    const dx = direction === 'x' ? (spacing || 4) : 0;
    const dy = direction === 'x' ? 0 : (spacing || 4);
    for (let i = 0; i < count; i++) {
      ctx.save();
      ctx.translate(dx * i, dy * i);
      drawShape(ctx, shape);
      ctx.restore();
    }
  } else {
    drawShape(ctx, shape);
  }
}

/**
 * Draw all shapes for a rank definition.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rankData - { shapes: [...] }
 * @param {number} [scale=1] - Overall scale multiplier
 */
export function drawInsignia(ctx, rankData, scale, patch) {
  if (!rankData || !rankData.shapes) return;

  scale = scale ?? 1;

  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);

  // Draw patch background behind shapes
  drawPatch(ctx, patch);

  const outline = patch?.outline;
  const insigniaFill = patch?.insigniaFill;

  if (outline?.enabled || insigniaFill?.enabled) {
    // Square caps extend stroke by strokeWidth/2 past endpoints.
    // Thicker outline extends further than thinner fill — uniform border at tips.
    const capStyle = { _splitArms: true, _lineCap: 'square', _lineJoin: 'miter', verticalEnds: false };
    const fillClose = insigniaFill?.enabled ? { _closePath: true } : {};

    // Pass 1: Outline — thick stroke in outline color (only fill interior if insigniaFill is on)
    if (outline?.enabled) {
      const olFill = !!insigniaFill?.enabled;
      for (const shape of rankData.shapes) {
        if (shape.visible === false) continue;
        const outShape = {
          ...shape, ...capStyle, ...fillClose,
          strokeColor: outline.color || '#000000',
          strokeWidth: (shape.strokeWidth ?? 1.5) + (outline.width ?? 2) * 2,
          fillEnabled: olFill,
          fillColor: outline.color || '#000000',
          fillOpacity: 1
        };
        _drawShapeWithArray(ctx, outShape);
      }
    }

    // Pass 2: Fill — normal stroke + fill in fill color, covers outline interior
    const fc = insigniaFill?.enabled ? (insigniaFill.color || '#ffd700') : null;
    for (const shape of rankData.shapes) {
      if (shape.visible === false) continue;
      if (fc) {
        const fillShape = {
          ...shape, ...capStyle, ...fillClose,
          strokeColor: fc,
          fillEnabled: true,
          fillColor: fc,
          fillOpacity: 1
        };
        _drawShapeWithArray(ctx, fillShape);
      } else {
        _drawShapeWithArray(ctx, { ...shape, ...capStyle });
      }
    }
  } else {
    // No outline/fill — draw shapes normally
    for (const shape of rankData.shapes) {
      if (shape.visible === false) continue;
      _drawShapeWithArray(ctx, shape);
    }
  }

  ctx.restore();
}

// ─── Caching ──────────────────────────────────────────────────

const CACHE_SIZE = 48;      // Logical pixels
const CACHE_RES = 2;        // 2x resolution for crisp rendering
const CACHE_PX = CACHE_SIZE * CACHE_RES; // 96 actual pixels

/**
 * Pre-render all 6 ranks (0-5) of an insignia set into OffscreenCanvas objects.
 * Each canvas is 48x48 logical pixels at 2x resolution (96x96 actual).
 * Populates the module-level cache keyed by "${set.id}_${rank}".
 *
 * @param {object} set - Insignia set with id and ranks array
 *   set.id: string identifier
 *   set.ranks: array of 6 rank definitions, each { shapes: [...] }
 */
export function cacheInsigniaSet(set) {
  if (!set || !set.id || !set.ranks) return;

  for (let rank = 0; rank < 6; rank++) {
    const rankData = set.ranks[rank];
    const key = `${set.id}_${rank}`;

    const oc = new OffscreenCanvas(CACHE_PX, CACHE_PX);
    const ctx = oc.getContext('2d');

    // Scale for resolution and center the drawing
    ctx.scale(CACHE_RES, CACHE_RES);
    ctx.translate(CACHE_SIZE / 2, CACHE_SIZE / 2);

    if (rankData) {
      drawInsignia(ctx, rankData, 1, set.patch);
    }

    cache.set(key, oc);
  }
}

/**
 * Look up the cached OffscreenCanvas for a given set ID and rank.
 *
 * @param {string} setId
 * @param {number} rank - 0-5
 * @returns {OffscreenCanvas|null}
 */
export function getCachedInsignia(setId, rank) {
  return cache.get(`${setId}_${rank}`) || null;
}

/**
 * Remove all cached canvases for a given set ID (all 6 ranks).
 * Call when the set is modified in the editor.
 *
 * @param {string} setId
 */
export function clearInsigniaCache(setId) {
  for (let rank = 0; rank < 6; rank++) {
    cache.delete(`${setId}_${rank}`);
  }
}
