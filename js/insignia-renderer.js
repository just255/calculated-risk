// ═══════════════════════════════════════════════════════════════
// INSIGNIA RENDERER - Shared vector rendering for military rank insignia
// Pure rendering utility: no state management, no game logic.
// Used by the insignia editor and the battle entity renderer.
// ═══════════════════════════════════════════════════════════════

// Module-level cache: Map<string, OffscreenCanvas>
// Keys are "${setId}_${rank}"
const cache = new Map();

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
  ctx.lineCap = shape.lineCap || 'butt';
  ctx.lineJoin = shape.lineJoin || 'miter';
  ctx.strokeStyle = shape.strokeColor || '#ffd700';
  ctx.lineWidth = shape.strokeWidth ?? 1.5;

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
    if (shape.capStyle && shape.capStyle !== 'none') {
      _drawEndpointCaps(ctx, shape);
    }
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

    // Force vertical ends
    e1[0][0] = -halfW;
    e2[0][0] = -halfW;
    const last = e1.length - 1;
    e1[last][0] = halfW;
    e2[last][0] = halfW;

    // Build polygon: edge1 forward → edge2 backward → closePath (vertical left end)
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

    // Force vertical ends
    arm.edge1[0][0] = -halfW;
    arm.edge2[0][0] = -halfW;
    arm.edge1[N][0] = halfW;
    arm.edge2[N][0] = halfW;

    ctx.beginPath();
    ctx.moveTo(arm.edge1[0][0], arm.edge1[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(arm.edge1[i][0], arm.edge1[i][1]);
    ctx.lineTo(arm.edge2[N][0], arm.edge2[N][1]);
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(arm.edge2[i][0], arm.edge2[i][1]);
    ctx.closePath();
    ctx.fill();
  }
}

// ─── Endpoint Caps ───────────────────────────────────────────

/** Cap style presets drawn at each endpoint of open paths. */
const CAP_STYLES = {
  /** Angled cut — slashes the cap at 45° */
  angle(ctx, size, lw) {
    ctx.beginPath();
    ctx.moveTo(-lw * 0.5, -size);
    ctx.lineTo(lw * 0.5, size);
    ctx.lineTo(lw * 0.5, -size);
    ctx.closePath();
    ctx.fill();
  },
  /** Arrow / pointed tip */
  arrow(ctx, size, lw) {
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.2);
    ctx.lineTo(lw * 0.6, 0);
    ctx.lineTo(0, size * 1.2);
    ctx.closePath();
    ctx.fill();
  },
  /** Small diamond at the tip */
  diamond(ctx, size, lw) {
    ctx.beginPath();
    ctx.moveTo(lw * 0.5, 0);
    ctx.lineTo(0, -size);
    ctx.lineTo(-size * 0.6, 0);
    ctx.lineTo(0, size);
    ctx.closePath();
    ctx.fill();
  },
  /** Serif — small perpendicular bar */
  serif(ctx, size, lw) {
    ctx.fillRect(-lw * 0.3, -size, lw * 0.6, size * 2);
  },
  /** Round dot at the tip */
  dot(ctx, size) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
    ctx.fill();
  },
  /** Miter — right-triangle cut, one edge stays straight/vertical */
  miter(ctx, size, lw) {
    const hw = lw * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -hw);       // top of stroke at cap
    ctx.lineTo(size, -hw);    // extend outward along top edge
    ctx.lineTo(0, hw);        // bottom of stroke stays put
    ctx.closePath();
    ctx.fill();
  },
};

/**
 * Get the two endpoints and their outward tangent angles for open-path shapes.
 * Returns [{ x, y, angle }, ...] (angle in radians, pointing outward from the shape).
 */
function _getEndpoints(shape) {
  switch (shape.type) {
    case 'chevron': {
      const hw = shape.halfW ?? 6;
      const h = shape.height ?? 7;
      const bow = hw * (shape.bow ?? 0.35);
      // Left tip tangent: direction from the quadratic control point to the endpoint
      const cpLx = -hw * 0.5 + bow, cpLy = h * 0.45;
      const angL = Math.atan2(h - cpLy, -hw - cpLx);
      // Right tip tangent: direction from the quadratic control point to the endpoint
      const cpRx = hw * 0.5 - bow, cpRy = h * 0.45;
      const angR = Math.atan2(h - cpRy, hw - cpRx);
      return [
        { x: -hw, y: h, angle: angL },
        { x: hw, y: h, angle: angR },
      ];
    }
    case 'arc': {
      const hw = shape.halfW ?? 6;
      const arcH = shape.arcHeight ?? 4;
      // Tangent at left endpoint: direction from control point (0, -arcH) to (-halfW, 0)
      const angL = Math.atan2(0 - (-arcH), -hw - 0);
      const angR = Math.atan2(0 - (-arcH), hw - 0);
      return [
        { x: -hw, y: 0, angle: angL },
        { x: hw, y: 0, angle: angR },
      ];
    }
    case 'line': {
      const half = (shape.length ?? 10) / 2;
      return [
        { x: -half, y: 0, angle: Math.PI },
        { x: half, y: 0, angle: 0 },
      ];
    }
    case 'path': {
      const pts = shape.points;
      if (!pts || pts.length < 2 || shape.closed) return [];
      const first = pts[0], second = pts[1];
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      return [
        { x: first.x, y: first.y, angle: Math.atan2(first.y - second.y, first.x - second.x) },
        { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) },
      ];
    }
    default:
      return []; // Closed shapes (diamond, circle) have no open endpoints
  }
}

/**
 * Draw decorative caps at each endpoint of an open-path shape.
 */
function _drawEndpointCaps(ctx, shape) {
  const style = CAP_STYLES[shape.capStyle];
  if (!style) return;

  const endpoints = _getEndpoints(shape);
  if (endpoints.length === 0) return;

  const size = (shape.capSize ?? 1) * (shape.strokeWidth ?? 1.5);
  const lw = shape.strokeWidth ?? 1.5;
  ctx.fillStyle = shape.strokeColor || '#ffd700';

  const capRot = (shape.capRotation ?? 0) * Math.PI / 180;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    ctx.save();
    ctx.translate(ep.x, ep.y);
    ctx.rotate(ep.angle + capRot);
    // Mirror asymmetric caps for the second endpoint so both sides match
    if (i > 0) ctx.scale(1, -1);
    style(ctx, size, lw);
    ctx.restore();
  }
}

// ─── Insignia Composition ─────────────────────────────────────

/**
 * Draw all shapes for a rank definition.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rankData - { shapes: [...] }
 * @param {number} [scale=1] - Overall scale multiplier
 */
export function drawInsignia(ctx, rankData, scale) {
  if (!rankData || !rankData.shapes) return;

  scale = scale ?? 1;

  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);

  for (const shape of rankData.shapes) {
    if (shape.visible === false) continue;
    drawShape(ctx, shape);
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
      drawInsignia(ctx, rankData, 1);
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
