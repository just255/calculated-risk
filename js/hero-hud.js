// ═══════════════════════════════════════════════════════════════
// HERO HUD — Crosshair + reload arc + accuracy circle for hero unit mode
// Rendered in screen space on the effects canvas layer.
// Designed to extend: SGT mode and CMD mode will have their own
// HUD renderers called from the same site in battle-renderer.js.
// ═══════════════════════════════════════════════════════════════

import { computeShotAccuracy } from './fire-decision.js';
import { UNIT_COMBAT_STATS, DEFAULT_MAX_SPREAD_DEG, CREW_MOD_CEILING, isInfantryUnit } from './constants.js';

const COLOR_RED = '#f87171';
const COLOR_GREEN = '#4ade80';
const COLOR_DIM = '#94a3b8';
const COLOR_YELLOW = '#fbbf24';

const CROSSHAIR_GAP = 6;
const CROSSHAIR_TICK = 10;
const CROSSHAIR_WIDTH = 2;
const ARC_RADIUS = 22;
const ARC_WIDTH = 2;
const ALIGN_THRESHOLD = 0.17; // ~10 degrees
const READY_FLASH_MS = 200;

const AIM_LERP_RATE = 0.3;

// ── Shared aim display helpers ──────────────────────────────

/** Lerp the hero's displayed aim angle + depth toward the target values. */
function _lerpAimDisplay(hero, targetAngle, targetDepth) {
  if (hero._displayAimAngle == null) hero._displayAimAngle = targetAngle;
  let delta = targetAngle - hero._displayAimAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  hero._displayAimAngle += delta * AIM_LERP_RATE;

  if (targetDepth != null) {
    if (hero._displayAimDepth == null) hero._displayAimDepth = targetDepth;
    hero._displayAimDepth += (targetDepth - hero._displayAimDepth) * AIM_LERP_RATE;
  }
}

/** Infantry: gradient line from hero to max range, fading at distance. */
function _drawInfantryAimLine(ctx, hero, hx, hy, camX, camY, zoom) {
  const maxRange = UNIT_COMBAT_STATS[hero.unitId]?.range || 400;
  const endX = (hero.x + Math.cos(hero._displayAimAngle) * maxRange - camX) * zoom;
  const endY = (hero.y + Math.sin(hero._displayAimAngle) * maxRange - camY) * zoom;

  ctx.save();
  const grad = ctx.createLinearGradient(hx, hy, endX, endY);
  grad.addColorStop(0, 'rgba(74, 222, 128, 0.5)');
  grad.addColorStop(0.6, 'rgba(74, 222, 128, 0.25)');
  grad.addColorStop(0.85, 'rgba(251, 191, 36, 0.15)');
  grad.addColorStop(1, 'rgba(248, 113, 113, 0.1)');
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Tank: aim line + reticle circle with ticks + center dot. */
function _drawTankReticle(ctx, hero, hx, hy, camX, camY, zoom) {
  const depth = hero._displayAimDepth || 0;
  const wx = hero.x + Math.cos(hero._displayAimAngle) * depth;
  const wy = hero.y + Math.sin(hero._displayAimAngle) * depth;
  const rx = (wx - camX) * zoom;
  const ry = (wy - camY) * zoom;

  ctx.save();
  // Aim line
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(rx, ry);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Reticle circle
  const r = 14;
  ctx.beginPath();
  ctx.arc(rx, ry, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Ticks
  const tl = 5, tg = 2;
  ctx.beginPath();
  ctx.moveTo(rx, ry - r - tg); ctx.lineTo(rx, ry - r - tg - tl);
  ctx.moveTo(rx, ry + r + tg); ctx.lineTo(rx, ry + r + tg + tl);
  ctx.moveTo(rx - r - tg, ry); ctx.lineTo(rx - r - tg - tl, ry);
  ctx.moveTo(rx + r + tg, ry); ctx.lineTo(rx + r + tg + tl, ry);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(rx, ry, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.fill();
  ctx.restore();
}

// Accuracy circle — derived from projectile spread cone at aim distance
// maxSpread must match heroFire/tryShoot so circle = actual projectile cone
// Spread cone uses DEFAULT_MAX_SPREAD_DEG from constants.js
// Per-unit override via UNIT_COMBAT_STATS.maxSpreadDeg
const SPREAD_LERP = 0.12;               // Smoothing per frame

/**
 * Render the hero crosshair + reload arc in screen space.
 * @param {CanvasRenderingContext2D} ctx - Screen-space context (identity + dpr)
 * @param {object} b - Battle state
 * @param {number} now - performance.now()
 */
export function renderHeroCrosshair(ctx, b, now) {
  const hero = b.hero;
  if (!hero || hero.dead || hero.observer) return;
  if (!b.mouse) return;

  // Aim point in screen coords — joystick aim or mouse
  const zoom = b.camera?.zoom || 1;
  const camX = b.camera?.x || 0;
  const camY = b.camera?.y || 0;
  let aimX, aimY, worldAimX, worldAimY;

  if (b.aimAngle != null && b._aimDepth != null) {
    // Mobile joystick: compute world aim from angle + depth, then to screen
    worldAimX = hero.x + Math.cos(b.aimAngle) * b._aimDepth;
    worldAimY = hero.y + Math.sin(b.aimAngle) * b._aimDepth;
    aimX = (worldAimX - camX) * zoom;
    aimY = (worldAimY - camY) * zoom;
  } else {
    aimX = b.mouse.x;
    aimY = b.mouse.y;
    worldAimX = aimX / zoom + camX;
    worldAimY = aimY / zoom + camY;
  }

  // Mobile aim visualization
  const isInf = isInfantryUnit(hero.unitId);
  if (b.aimAngle != null) {
    _lerpAimDisplay(hero, b.aimAngle, b._aimDepth);
    const heroScreenX = (hero.x - camX) * zoom;
    const heroScreenY = (hero.y - camY) * zoom;

    if (isInf) {
      _drawInfantryAimLine(ctx, hero, heroScreenX, heroScreenY, camX, camY, zoom);
    } else if (b._aimDepth != null) {
      _drawTankReticle(ctx, hero, heroScreenX, heroScreenY, camX, camY, zoom);
    }
  }
  const targetAngle = Math.atan2(worldAimY - hero.y, worldAimX - hero.x);
  let aimDiff = hero.angle - targetAngle;
  while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
  while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
  const aligned = Math.abs(aimDiff) < ALIGN_THRESHOLD;

  // Reload state — magazine-aware
  const hasMag = hero._hasMagazine;
  let reloadProgress, ready;

  if (hasMag) {
    if (hero._isReloading) {
      const reloadMod = hero._crewMods?.gunner?.reloadSpeed ?? hero._crewMods?.reloadSpeed ?? 0.3;
      const reloadDur = hero._reloadDuration * (CREW_MOD_CEILING - reloadMod * (CREW_MOD_CEILING - 0.7));
      reloadProgress = Math.min(1, (Date.now() - hero._reloadStart) / reloadDur);
      ready = false;
    } else {
      reloadProgress = 1;
      ready = hero._magAmmo > 0;
    }
  } else {
    const elapsed = Date.now() - (hero.lastShot || 0);
    const fireRate = hero.fireRate || 1800;
    reloadProgress = Math.min(1, elapsed / fireRate);
    ready = reloadProgress >= 1;
  }

  // Pick color based on state
  const crossColor = !aligned ? COLOR_RED
    : ready ? COLOR_GREEN
    : COLOR_DIM;

  ctx.save();

  // Skip tick crosshair for infantry on mobile (aim line replaces it)
  const skipCrosshair = isInf && b.aimAngle != null;

  if (!skipCrosshair) {
    // Shadow pass for contrast
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = CROSSHAIR_WIDTH + 2;
    ctx.lineCap = 'round';
    _drawTicks(ctx, aimX, aimY);

    // Colored ticks
    ctx.strokeStyle = crossColor;
    ctx.lineWidth = CROSSHAIR_WIDTH;
    _drawTicks(ctx, aimX, aimY);
  }

  // Center dot
  ctx.fillStyle = crossColor;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(aimX, aimY, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Reload arc (only visible while reloading)
  if (!ready) {
    const start = -Math.PI / 2; // 12 o'clock

    // Faint track ring
    ctx.strokeStyle = crossColor;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = ARC_WIDTH;
    ctx.beginPath();
    ctx.arc(aimX, aimY, ARC_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Progress arc
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = ARC_WIDTH;
    ctx.beginPath();
    ctx.arc(aimX, aimY, ARC_RADIUS, start, start + reloadProgress * Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Ammo counter (magazine weapons only)
  if (hasMag) {
    const ammo = hero._magAmmo ?? 0;
    const maxAmmo = hero._magSize ?? 1;
    const ammoRatio = ammo / maxAmmo;
    const ammoColor = hero._isReloading ? COLOR_YELLOW
      : ammoRatio > 0.3 ? COLOR_GREEN
      : ammoRatio > 0 ? COLOR_YELLOW
      : COLOR_RED;

    ctx.font = 'bold 11px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillText(hero._isReloading ? 'RELOAD' : `${ammo}`, aimX + 1, aimY + ARC_RADIUS + 5);
    // Text
    ctx.fillStyle = ammoColor;
    ctx.fillText(hero._isReloading ? 'RELOAD' : `${ammo}`, aimX, aimY + ARC_RADIUS + 4);
  }

  // Accuracy circle — stability-driven spread indicator
  {
    const aimTarget = { x: worldAimX, y: worldAimY };
    const shot = computeShotAccuracy(hero, aimTarget);
    const accuracy = shot.accuracy;

    // Spread radius derived from projectile cone at aim distance
    // Per-unit max spread from UNIT_COMBAT_STATS, fallback to default
    const unitStats = UNIT_COMBAT_STATS[hero.unitId];
    const maxSpreadDeg = unitStats?.maxSpreadDeg ?? DEFAULT_MAX_SPREAD_DEG;
    const maxSpreadRad = maxSpreadDeg * Math.PI / 180;
    const aimDistWorld = Math.sqrt((worldAimX - hero.x) ** 2 + (worldAimY - hero.y) ** 2);
    const spreadAngle = (1 - accuracy) * maxSpreadRad;
    const worldRadius = aimDistWorld * Math.tan(spreadAngle);
    const targetRadius = Math.max(3, worldRadius * zoom); // Convert to screen px, min 3px

    if (hero._spreadRadius === undefined) hero._spreadRadius = targetRadius;
    hero._spreadRadius += (targetRadius - hero._spreadRadius) * SPREAD_LERP;
    const radius = hero._spreadRadius;

    // Color: green when tight, yellow when medium, red when wide
    const spreadColor = accuracy > 0.6 ? COLOR_GREEN
      : accuracy > 0.35 ? COLOR_YELLOW
      : COLOR_RED;

    // Outer spread circle
    ctx.strokeStyle = spreadColor;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(aimX, aimY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill for low accuracy (visual urgency)
    if (accuracy < 0.35) {
      ctx.fillStyle = spreadColor;
      ctx.globalAlpha = 0.05;
      ctx.beginPath();
      ctx.arc(aimX, aimY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Ready flash — brief green pulse when reload completes
  if (!hero._crosshairReadyTime && ready && hero.lastShot > 0) {
    hero._crosshairReadyTime = now;
  }
  if (!ready) {
    hero._crosshairReadyTime = 0;
  }
  if (hero._crosshairReadyTime && aligned) {
    const flashAge = now - hero._crosshairReadyTime;
    if (flashAge < READY_FLASH_MS) {
      const t = flashAge / READY_FLASH_MS;
      ctx.fillStyle = COLOR_GREEN;
      ctx.globalAlpha = (1 - t) * 0.3;
      ctx.beginPath();
      ctx.arc(aimX, aimY, ARC_RADIUS + t * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

function _drawTicks(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y - CROSSHAIR_GAP);
  ctx.lineTo(x, y - CROSSHAIR_GAP - CROSSHAIR_TICK);
  ctx.moveTo(x, y + CROSSHAIR_GAP);
  ctx.lineTo(x, y + CROSSHAIR_GAP + CROSSHAIR_TICK);
  ctx.moveTo(x - CROSSHAIR_GAP, y);
  ctx.lineTo(x - CROSSHAIR_GAP - CROSSHAIR_TICK, y);
  ctx.moveTo(x + CROSSHAIR_GAP, y);
  ctx.lineTo(x + CROSSHAIR_GAP + CROSSHAIR_TICK, y);
  ctx.stroke();
}
