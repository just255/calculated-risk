// ═══════════════════════════════════════════════════════════════
// CAMERA - Shared camera logic for battle views
// Used by drawHeroBattle (game.js), ReplayPlayer, and input handlers
// ═══════════════════════════════════════════════════════════════

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

// ── Per-frame camera update ────────────────────────────────────

/**
 * Update a fire-range-style camera: auto-follow blue leader with WASD pan override.
 * Mutates b.camera in place, returns computed zoom.
 *
 * @param {object} b       - Battle object (needs .mapWidth, .mapHeight, .units, .camera, .keys)
 * @param {number} screenW - Container pixel width
 * @param {number} screenH - Container pixel height
 * @returns {number} zoom  - Final computed zoom value (baseZoom * userZoom)
 */
export function updateFireRangeCamera(b, screenW, screenH) {
  const TACTICAL_RADIUS = 600;
  const baseZoom = Math.min(screenW, screenH) / (TACTICAL_RADIUS * 2);
  const userZoom = b.camera.userZoom || 1;
  const zoom = baseZoom * userZoom;
  const viewW = screenW / zoom;
  const viewH = screenH / zoom;

  // Find blue leader (first alive unit with slot 0, or first alive, or map center)
  const leader = b.units?.find(u => !u.dead && u._formationSlot === 0)
              || b.units?.find(u => !u.dead)
              || { x: b.mapWidth / 2, y: b.mapHeight / 2 };

  // WASD camera pan override
  const panSpeed = 400 / zoom;
  const dtSec = 1 / 60;
  let panX = 0, panY = 0;
  if (b.keys.a) panX -= panSpeed * dtSec;
  if (b.keys.d) panX += panSpeed * dtSec;
  if (b.keys.w) panY -= panSpeed * dtSec;
  if (b.keys.s) panY += panSpeed * dtSec;

  if (panX !== 0 || panY !== 0) {
    b.camera.x += panX;
    b.camera.y += panY;
    b.camera._manualPan = true;
  } else if (!b.camera._manualPan) {
    // Auto-follow blue leader
    const targetX = leader.x - viewW / 2;
    const targetY = leader.y - viewH / 2;
    const clampX = Math.max(0, Math.min(b.mapWidth - viewW, targetX));
    const clampY = Math.max(0, Math.min(b.mapHeight - viewH, targetY));
    b.camera.x += (clampX - b.camera.x) * 0.08;
    b.camera.y += (clampY - b.camera.y) * 0.08;
  }

  // Clamp camera within map bounds (center if view is larger than map)
  if (viewW >= b.mapWidth) {
    b.camera.x = (b.mapWidth - viewW) / 2;
  } else {
    b.camera.x = Math.max(0, Math.min(b.mapWidth - viewW, b.camera.x));
  }
  if (viewH >= b.mapHeight) {
    b.camera.y = (b.mapHeight - viewH) / 2;
  } else {
    b.camera.y = Math.max(0, Math.min(b.mapHeight - viewH, b.camera.y));
  }

  b.camera.zoom = zoom;
  return zoom;
}

/**
 * Update a hero-mode camera: center on hero position.
 * Supports WASD pan override (for replay mode) — panning detaches from hero,
 * F key or re-center snaps back.
 *
 * @param {object} b       - Battle object (needs .mapWidth, .mapHeight, .hero, .camera)
 * @param {number} screenW - Container pixel width
 * @param {number} screenH - Container pixel height
 * @returns {number} zoom  - Final computed zoom value
 */
export function updateHeroCamera(b, screenW, screenH) {
  const TACTICAL_RADIUS = 450;
  const baseZoom = Math.min(screenW, screenH) / (TACTICAL_RADIUS * 2);
  const userZoom = b.camera.userZoom || 1;
  const zoom = baseZoom * userZoom;
  const viewW = screenW / zoom;
  const viewH = screenH / zoom;

  // WASD camera pan override (only in replay/spectator — live play uses WASD for hero movement)
  if (b._isReplay) {
    const panSpeed = 400 / zoom;
    const dtSec = 1 / 60;
    let panX = 0, panY = 0;
    if (b.keys?.a) panX -= panSpeed * dtSec;
    if (b.keys?.d) panX += panSpeed * dtSec;
    if (b.keys?.w) panY -= panSpeed * dtSec;
    if (b.keys?.s) panY += panSpeed * dtSec;

    if (panX !== 0 || panY !== 0) {
      b.camera.x += panX;
      b.camera.y += panY;
      b.camera._manualPan = true;
    }
  }

  if (!b.camera._manualPan) {
    // Auto-follow hero
    b.camera.x = b.hero.x - viewW / 2;
    b.camera.y = b.hero.y - viewH * 0.65;
  }

  // Clamp within map bounds
  if (viewW >= b.mapWidth) {
    b.camera.x = (b.mapWidth - viewW) / 2;
  } else {
    b.camera.x = Math.max(0, Math.min(b.mapWidth - viewW, b.camera.x));
  }
  if (viewH >= b.mapHeight) {
    b.camera.y = (b.mapHeight - viewH) / 2;
  } else {
    b.camera.y = Math.max(0, Math.min(b.mapHeight - viewH, b.camera.y));
  }

  b.camera.zoom = zoom;
  return zoom;
}

// ── Input handlers ─────────────────────────────────────────────

/**
 * Handle keydown for WASD movement + camera controls.
 * All modes: WASD/arrows toggle b.keys, +/- zoom, M fit map.
 * Fire range/replay only (b.fireRange): F re-centers on leader.
 * @returns {boolean} true if the key was consumed
 */
export function cameraKeyDown(b, key) {
  const k = key.toLowerCase();
  // WASD/arrows — pan (fire range/replay) or movement (campaign/endless)
  if (k === 'w' || k === 'arrowup')    { b.keys.w = true; return true; }
  if (k === 'a' || k === 'arrowleft')  { b.keys.a = true; return true; }
  if (k === 's' || k === 'arrowdown')  { b.keys.s = true; return true; }
  if (k === 'd' || k === 'arrowright') { b.keys.d = true; return true; }
  // Zoom (all modes)
  if (k === '=' || k === '+' || k === 'numpadadd')  { cameraZoom(b, -1); return true; }
  if (k === '-' || k === 'numpadsubtract')           { cameraZoom(b, 1);  return true; }
  // Fit whole map (all modes)
  if (k === 'm') {
    const c = b.battleRenderer?._container;
    if (c) cameraFitMap(b, c.offsetWidth, c.offsetHeight);
    return true;
  }
  // Re-center on leader/hero (resets manual pan so auto-follow resumes)
  if (k === 'f' && (b.fireRange || b._isReplay)) { b.camera._manualPan = false; return true; }
  return false;
}

/**
 * Handle keyup for WASD movement.
 * @returns {boolean} true if the key was consumed
 */
export function cameraKeyUp(b, key) {
  const k = key.toLowerCase();
  if (k === 'w' || k === 'arrowup')    { b.keys.w = false; return true; }
  if (k === 'a' || k === 'arrowleft')  { b.keys.a = false; return true; }
  if (k === 's' || k === 'arrowdown')  { b.keys.s = false; return true; }
  if (k === 'd' || k === 'arrowright') { b.keys.d = false; return true; }
  return false;
}

/**
 * Apply a zoom step to the camera, keeping the current view center stable.
 * @param {object} b      - Battle object (needs .camera.userZoom, .camera.x/y)
 * @param {number} deltaY - Positive = zoom out, negative = zoom in
 */
export function cameraZoom(b, deltaY) {
  const step = deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  const oldUserZoom = b.camera.userZoom || 1;
  const newUserZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldUserZoom + step));
  if (newUserZoom === oldUserZoom) return;

  // Preserve the world-space center of the current view
  const oldZoom = b.camera.zoom || 1;
  const newZoom = oldZoom * (newUserZoom / oldUserZoom);
  const container = b.battleRenderer?._container;
  if (container) {
    const sw = container.offsetWidth;
    const sh = container.offsetHeight;
    // Current view center in world coords
    const cx = b.camera.x + sw / oldZoom / 2;
    const cy = b.camera.y + sh / oldZoom / 2;
    // New camera top-left so the same world point stays centered
    b.camera.x = cx - sw / newZoom / 2;
    b.camera.y = cy - sh / newZoom / 2;
  }

  b.camera.userZoom = newUserZoom;
  b.camera._manualPan = true;
}

/**
 * Start a mouse-drag pan (typically middle mouse button).
 * Stores the initial screen position for delta calculation.
 * @param {object} b  - Battle object
 * @param {number} sx - Screen X at drag start
 * @param {number} sy - Screen Y at drag start
 */
export function cameraPanStart(b, sx, sy) {
  b.camera._dragPan = { sx, sy, startX: b.camera.x, startY: b.camera.y };
}

/**
 * Update camera position during a mouse-drag pan.
 * @param {object} b  - Battle object
 * @param {number} mx - Current screen X
 * @param {number} my - Current screen Y
 */
export function cameraPanMove(b, mx, my) {
  const drag = b.camera._dragPan;
  if (!drag) return;
  const zoom = b.camera.zoom || 1;
  b.camera.x = drag.startX - (mx - drag.sx) / zoom;
  b.camera.y = drag.startY - (my - drag.sy) / zoom;
  b.camera._manualPan = true;
}

/**
 * End a mouse-drag pan.
 * @param {object} b - Battle object
 */
export function cameraPanEnd(b) {
  if (b.camera._dragPan) b.camera._dragPan = null;
}

/**
 * Toggle fit-map zoom: if not at fit-zoom, zoom to fit entire map; if already there, reset to 1x.
 * @param {object} b       - Battle object
 * @param {number} screenW - Container pixel width
 * @param {number} screenH - Container pixel height
 */
export function cameraFitMap(b, screenW, screenH) {
  const TACTICAL_RADIUS = 600;
  const baseZoom = Math.min(screenW, screenH) / (TACTICAL_RADIUS * 2);

  const fitZoomX = screenW / (b.mapWidth * baseZoom);
  const fitZoomY = screenH / (b.mapHeight * baseZoom);
  const fitZoom = Math.min(fitZoomX, fitZoomY);

  const current = b.camera.userZoom || 1;
  if (Math.abs(current - fitZoom) < 0.05) {
    b.camera.userZoom = 1;
    b.camera._manualPan = false;
  } else {
    b.camera.userZoom = fitZoom;
    const zoom = baseZoom * fitZoom;
    const viewW = screenW / zoom;
    const viewH = screenH / zoom;
    b.camera.x = (b.mapWidth - viewW) / 2;
    b.camera.y = (b.mapHeight - viewH) / 2;
    b.camera._manualPan = true;
  }
}
