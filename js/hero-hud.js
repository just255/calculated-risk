// ═══════════════════════════════════════════════════════════════
// HERO HUD — Crosshair + reload arc + accuracy circle for hero unit mode
// Rendered in screen space on the effects canvas layer.
// Designed to extend: SGT mode and CMD mode will have their own
// HUD renderers called from the same site in battle-renderer.js.
// ═══════════════════════════════════════════════════════════════

import { computeShotAccuracy } from './fire-decision.js';

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

// Accuracy circle — represents spread cone at aim distance
const SPREAD_MIN_RADIUS = 4;    // Minimum circle at perfect accuracy
const SPREAD_MAX_RADIUS = 50;   // Maximum circle at worst accuracy
const SPREAD_LERP = 0.15;       // Smoothing per frame (avoids jitter)

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

  // Aim point in screen coords
  const zoom = b.camera?.zoom || 1;
  const aimX = b.mouse.x;
  const aimY = b.mouse.y;

  // Turret alignment check
  const worldAimX = aimX / zoom + (b.camera?.x || 0);
  const worldAimY = aimY / zoom + (b.camera?.y || 0);
  const targetAngle = Math.atan2(worldAimY - hero.y, worldAimX - hero.x);
  let aimDiff = hero.angle - targetAngle;
  while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
  while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
  const aligned = Math.abs(aimDiff) < ALIGN_THRESHOLD;

  // Reload state
  const elapsed = Date.now() - (hero.lastShot || 0);
  const fireRate = hero.fireRate || 1800;
  const reloadProgress = Math.min(1, elapsed / fireRate);
  const ready = reloadProgress >= 1;

  // Pick color based on state
  const crossColor = !aligned ? COLOR_RED
    : ready ? COLOR_GREEN
    : COLOR_DIM;

  ctx.save();

  // Shadow pass for contrast
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = CROSSHAIR_WIDTH + 2;
  ctx.lineCap = 'round';
  _drawTicks(ctx, aimX, aimY);

  // Colored ticks
  ctx.strokeStyle = crossColor;
  ctx.lineWidth = CROSSHAIR_WIDTH;
  _drawTicks(ctx, aimX, aimY);

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

  // Accuracy circle — stability-driven spread indicator
  {
    const aimTarget = { x: worldAimX, y: worldAimY };
    const shot = computeShotAccuracy(hero, aimTarget);
    const accuracy = shot.accuracy;

    // Spread radius: lerp for smooth transitions
    const targetRadius = SPREAD_MIN_RADIUS + (1 - accuracy) * (SPREAD_MAX_RADIUS - SPREAD_MIN_RADIUS);
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
