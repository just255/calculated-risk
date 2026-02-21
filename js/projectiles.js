// ═══════════════════════════════════════════════════════════════
// PROJECTILES - Free-form velocity-based projectile system
// Used by test-mode.js (terrain editor) and future hero battle mode
// Distinct from combat.js which handles lane-based projectiles
// ═══════════════════════════════════════════════════════════════

import { PROJECTILES, UNIT_PROJECTILES } from './constants.js';

/**
 * Create a free-form projectile
 * @param {object} opts
 * @param {number} opts.x - Start X in world space
 * @param {number} opts.y - Start Y in world space
 * @param {number} opts.angle - Direction in radians
 * @param {string} opts.unitType - Unit type key (e.g. 'abrams') to look up projectile config
 * @param {number} [opts.damage] - Override damage (default from config)
 * @param {string} [opts.owner] - Owner ID for hit filtering
 * @returns {object} Projectile object
 */
export function createFreeProjectile({ x, y, angle, unitType, damage, owner }) {
  const projType = UNIT_PROJECTILES[unitType] || 'bullet';
  const config = PROJECTILES[projType] || PROJECTILES.bullet;

  return {
    x,
    y,
    angle,
    vx: Math.cos(angle) * config.speed,
    vy: Math.sin(angle) * config.speed,
    speed: config.speed,
    damage: damage ?? 10,
    owner: owner || null,
    type: projType,
    config,
    age: 0,
    maxAge: 3, // seconds before auto-removal
    alive: true,
    // Muzzle flash state
    flashTime: config.muzzleFlash ? config.muzzleFlash.duration / 1000 : 0
  };
}

/**
 * Update all free projectiles (move, age, bounds check, hit detection)
 * @param {object[]} projectiles - Array of projectile objects
 * @param {number} dtSec - Delta time in seconds
 * @param {object} bounds - { width, height } map bounds
 * @param {object[]} [targets] - Optional array of { x, y, radius, health } for hit detection
 * @returns {{ projectiles: object[], hits: object[] }} Surviving projectiles and any hits
 */
export function updateFreeProjectiles(projectiles, dtSec, bounds, targets = []) {
  const hits = [];
  const surviving = [];

  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (!p.alive) continue;

    // Move
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.age += dtSec;
    p.flashTime = Math.max(0, p.flashTime - dtSec);

    // Bounds check
    if (p.x < -50 || p.x > bounds.width + 50 ||
        p.y < -50 || p.y > bounds.height + 50 ||
        p.age > p.maxAge) {
      p.alive = false;
      continue;
    }

    // Hit detection against targets
    let hit = false;
    for (let j = 0; j < targets.length; j++) {
      const t = targets[j];
      if (t.owner === p.owner) continue; // Don't hit own team
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const r = t.radius || 16;
      if (dx * dx + dy * dy < r * r) {
        hits.push({ projectile: p, target: t });
        p.alive = false;
        hit = true;
        break;
      }
    }

    if (!hit) {
      surviving.push(p);
    }
  }

  return { projectiles: surviving, hits };
}

/**
 * Render projectiles on a canvas context (in world space — ctx should already have world transform)
 * @param {CanvasRenderingContext2D} ctx - Canvas context with world transform applied
 * @param {object[]} projectiles - Array of projectile objects
 */
export function renderProjectiles(ctx, projectiles) {
  if (projectiles.length === 0) return;

  ctx.save();

  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (!p.alive) continue;

    const cfg = p.config;
    const angleDeg = p.angle * 180 / Math.PI;

    // Draw trail
    if (cfg.trail) {
      const trailLen = cfg.height * 2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle + Math.PI / 2); // rotate so "up" is travel direction

      const grad = ctx.createLinearGradient(0, 0, 0, trailLen);
      grad.addColorStop(0, cfg.trailColor || 'rgba(255,200,50,0.4)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-cfg.width / 2, 0, cfg.width, trailLen);
      ctx.restore();
    }

    // Draw projectile body
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.fillStyle = cfg.color || '#ffcc00';
    ctx.fillRect(-cfg.width / 2, -cfg.height / 2, cfg.width, cfg.height);
    ctx.restore();

    // Draw muzzle flash (fades quickly)
    if (p.flashTime > 0 && cfg.muzzleFlash) {
      const flashAlpha = p.flashTime / (cfg.muzzleFlash.duration / 1000);
      const flashSize = cfg.muzzleFlash.size * flashAlpha;
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, flashSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}
