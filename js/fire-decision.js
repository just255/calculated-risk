// ═══════════════════════════════════════════════════════════════
// FIRE DECISION PIPELINE — Shared by enemies AND ally units
// Determines WHEN to fire, HOW accurate the shot is, and damage falloff.
//
// Range source: unit.range (set at spawn from UNIT_COMBAT_STATS or enemy def)
// Hard cutoff: range × 1.1 — nothing fires beyond this
// Damage falloff: steep drop beyond ~60% of range
// ═══════════════════════════════════════════════════════════════

import { UNIT_COMBAT_STATS } from './constants.js';

// Zero-in time fallback for enemy AI types (not in UNIT_COMBAT_STATS)
const ENEMY_ZERO_IN = {
  BASIC: 2.5,
  RUSHER: 3.5,
  HUNTER: 2.0,
  CAUTIOUS: 1.5,
  FLANKER: 3.0,
  SWARMER: 4.5
};

/**
 * Update stability for any combat unit (enemy or ally).
 * Call once per frame BEFORE shouldFire.
 *
 * @param {object} unit - Entity with x, y, stability, _movedThisFrame
 * @param {number} dtSec - Frame delta in seconds
 * @param {string} typeKey - AI type key (e.g. 'BASIC') or unitId (e.g. 'infantry')
 */
export function updateStability(unit, dtSec, typeKey) {
  if (unit.stability === undefined) unit.stability = 0;

  // Prefer UNIT_COMBAT_STATS.zeroIn (data-driven), fall back to enemy AI table
  const combatStats = unit.unitId ? UNIT_COMBAT_STATS[unit.unitId] : null;
  const baseZeroIn = combatStats?.zeroIn ?? ENEMY_ZERO_IN[typeKey] ?? 2.0;
  // Discipline modulates zeroing speed: high discipline zeros in faster
  // Range: discipline 0.0 → 1.2x slower, discipline 1.0 → 0.8x faster
  const discipline = unit.personality?.discipline ?? 0.5;
  const zeroIn = baseZeroIn * (1.2 - discipline * 0.4);

  // Target acquisition penalty — switching targets resets stability partially.
  // Awareness determines how much stability is preserved on target switch.
  // High awareness = quicker re-acquisition (keeps more stability).
  if (unit._targetJustSwitched) {
    const awareness = unit._awareness ?? 0.5;
    const keepFraction = 0.1 + awareness * 0.3; // 0.1-0.4 preserved
    unit.stability *= keepFraction;
    unit._targetJustSwitched = false;
  }

  // Turret slew bleeds stability — fast turret rotation destabilizes aim.
  // This compounds with the accuracy penalty in shouldFire().
  const turretAngVel = unit._turretAngVel ?? 0;
  if (turretAngVel > 0.2) {
    const slewBleed = Math.min(0.8, turretAngVel / (Math.PI * 1.5)) * dtSec;
    unit.stability = Math.max(0, unit.stability - slewBleed);
  }

  if (unit._movedThisFrame) {
    // Scale decay by movement speed — slow creep barely affects aim, sprinting wrecks it
    const floor = unit._isProne ? 0.3 : (unit._isHullDown ? 0.2 : 0.1);
    const maxDist = (unit.speed || 80) * dtSec;
    const moveFraction = Math.min((unit._moveDistThisFrame || 0) / (maxDist || 1), 1.0);
    const decay = (0.1 + moveFraction * 1.4) * dtSec;
    unit.stability = Math.max(floor, unit.stability - decay);
  } else {
    // Standing still builds stability toward 1.0
    // Prone: 50% faster stabilization. Hull-down: 30% faster.
    const posBonus = unit._isProne ? 1.5 : (unit._isHullDown ? 1.3 : 1.0);
    unit.stability = Math.min(1.0, unit.stability + (dtSec / zeroIn) * posBonus);
  }

  // Suppression bleeds stability (replaces separate accuracy penalty)
  const suppression = unit._suppression ?? 0;
  if (suppression > 0.05) {
    const supBleed = suppression * 0.4 * dtSec; // Max 0.4/s at full suppression
    unit.stability = Math.max(0, unit.stability - supBleed);
  }

  // Final clamp — multiple effects can stack in one frame and push below 0
  if (unit.stability < 0) unit.stability = 0;
}

/**
 * Apply stability drop from getting hit.
 * Scaled by damage relative to maxHp — rifle vs tank barely registers,
 * tank-on-tank rocks the whole vehicle.
 * Call from projectile resolver when a unit takes damage.
 *
 * @param {object} unit - The unit that was hit
 * @param {number} damage - Damage dealt
 */
export function applyHitStabilityDrop(unit, damage) {
  if (!unit || unit.stability === undefined) return;
  const maxHp = unit.maxHp || 100;
  const impactRatio = damage / maxHp; // 0-1: how hard the hit was relative to unit size
  const drop = impactRatio * 1.5; // Scale: 10% hp hit = 0.15 stability drop
  unit.stability = Math.max(0, unit.stability - drop);
}

/**
 * Apply post-fire recoil stability drop.
 * Scaled by weapon damage (bigger gun = more recoil).
 * Call from tryShoot/heroFire after creating a projectile.
 *
 * @param {object} unit - The unit that fired
 */
export function applyRecoilDrop(unit) {
  if (!unit || unit.stability === undefined) return;
  const damage = unit.damage || 10;
  // Light weapons (10 dmg): 0.05 drop. Heavy (60 dmg): 0.30 drop.
  const drop = Math.min(0.4, damage * 0.005);
  unit.stability = Math.max(0, unit.stability - drop);
}

/**
 * Compute damage falloff multiplier based on distance vs unit's range.
 * Full damage up to 60% of range, steep drop beyond that.
 *
 * @param {number} dist - Distance to target (pixels)
 * @param {number} range - Unit's weapon range (pixels)
 * @returns {number} Damage multiplier (0-1)
 */
export function getDamageFalloff(dist, range) {
  if (range <= 0) return 1.0;
  const ratio = dist / range;
  if (ratio <= 0.6) return 1.0;                    // Full damage up to 60% range
  if (ratio >= 1.1) return 0.0;                    // No damage beyond hard cutoff
  // Steep falloff from 60% to 110%: 1.0 → 0.1
  const t = (ratio - 0.6) / 0.5;                   // 0 at 60%, 1 at 110%
  return Math.max(0.1, 1.0 - t * t * 0.9);         // Quadratic drop to 0.1
}

/**
 * Extensible fire-decision pipeline.
 * Returns whether the unit should fire this frame and the accuracy of the shot.
 *
 * Range source: unit.range (single source of truth, set at spawn)
 * Hard cutoff: range × 1.1 — nothing fires beyond this
 *
 * @param {object} unit - Firing entity { x, y, range, stability, lastAttack, fireRate, ... }
 * @param {object} target - Target entity { x, y, speed?, velocity? }
 * @param {object} b - Battle state (for LOS checks, etc.)
 * @param {number} now - Current timestamp (ms)
 * @param {object} opts - Optional overrides { heroVelocity }
 * @returns {{ canFire: boolean, accuracy: number, damageMod: number }}
 */
// ═══════════════════════════════════════════════════════════════
// SHOT ACCURACY — Pure physics, no AI gates.
// Used by both AI (via shouldFire) and hero (directly).
// ═══════════════════════════════════════════════════════════════

/**
 * Compute accuracy and damage modifier for a shot.
 * No cooldowns, no personality gates, no fire probability — just physics.
 *
 * @param {object} unit   - The firing unit
 * @param {object} target - Target { x, y } or entity
 * @param {object} [opts] - { heroVelocity, heroMaxSpeed }
 * @returns {{ accuracy, damageMod, factors, dist, range, stability }}
 */
export function computeShotAccuracy(unit, target, opts = {}) {
  const factors = [];

  // BASE ACCURACY — weapon system ceiling
  const combatStats = unit.unitId ? UNIT_COMBAT_STATS[unit.unitId] : null;
  const baseAcc = Math.min(1.0, unit._accuracyBonus
    ? (combatStats?.baseAccuracy ?? 0.80) + unit._accuracyBonus
    : (combatStats?.baseAccuracy ?? 0.80));
  let accuracy = baseAcc;
  factors.push({ name: 'base', value: baseAcc });

  // STABILITY — single readiness measure. All disruptions (movement, turret slew,
  // suppression, hits, recoil) feed INTO stability. Accuracy reads FROM stability.
  // No separate penalties here for things that already affect stability.
  const stability = unit.stability ?? 0.5;
  const stabilityWeight = 0.15 + stability * 0.85; // Band: 0.15–1.0
  accuracy *= stabilityWeight;
  factors.push({ name: 'stability', value: stabilityWeight });

  // RANGE — distance falloff
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const range = unit.range || 150;
  const rangeRatio = Math.min(1.0, dist / range);
  const rangeWeight = 1.0 - rangeRatio * 0.45;
  accuracy *= rangeWeight;
  factors.push({ name: 'range', value: rangeWeight });

  const damageMod = getDamageFalloff(dist, range);

  // TARGET SPEED (for enemies shooting at the moving hero)
  const heroVelocity = opts.heroVelocity || 0;
  if (heroVelocity > 0) {
    const heroMaxSpeed = opts.heroMaxSpeed || 120;
    const speedRatio = Math.min(1.0, heroVelocity / heroMaxSpeed);
    const speedWeight = Math.max(0.3, 1.0 - speedRatio * 0.6);
    accuracy *= speedWeight;
    factors.push({ name: 'targetSpeed', value: speedWeight });
  }

  return { accuracy, damageMod, factors, dist, range, stability };
}

// ═══════════════════════════════════════════════════════════════
// AI FIRE DECISION — Gates + accuracy physics.
// AI units call this. Hero calls computeShotAccuracy directly.
// ═══════════════════════════════════════════════════════════════

export function shouldFire(unit, target, b, now, opts = {}) {
  // 1. COOLDOWN — hard gate
  const fireRate = unit.fireRate || 2000;
  const lastAttack = unit.lastAttack || unit.lastShot || 0;
  if (now - lastAttack < fireRate) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // 2. RANGE CUTOFF — hard gate
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const range = unit.range || 150;
  if (dist > range * 1.1) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // 3. Accuracy physics (shared with hero)
  const shot = computeShotAccuracy(unit, target, opts);

  // 4. STABILITY THRESHOLD — personality gate
  const personality = unit._personality || unit.personality || {};
  const discipline = personality.discipline ?? 0.5;
  const patience = personality.patience ?? 0.5;
  const minStability = discipline * 0.4 + patience * 0.2;
  if (shot.stability < minStability) {
    return { canFire: false, accuracy: shot.accuracy, damageMod: shot.damageMod, factors: shot.factors, reason: 'stability' };
  }

  // 5. TARGET ACQUISITION DELAY — awareness + initiative gate
  const awareness = unit._awareness ?? (personality.awareness ?? 0.5);
  const initiative = personality.initiative ?? 0.5;
  const acquireTime = (0.3 + (1 - awareness) * 0.5 + (1 - initiative) * 0.4) * 1000;
  const timeSinceAcquired = now - (unit._targetAcquiredAt || 0);
  if (timeSinceAcquired < acquireTime) {
    return { canFire: false, accuracy: shot.accuracy, damageMod: shot.damageMod, factors: shot.factors, reason: 'acquiring' };
  }

  // 6. FIRE PROBABILITY — low-accuracy suppression skip
  if (shot.accuracy < 0.3 && Math.random() > shot.accuracy * 2) {
    return { canFire: false, accuracy: shot.accuracy, damageMod: shot.damageMod, factors: shot.factors };
  }

  return { canFire: true, accuracy: shot.accuracy, damageMod: shot.damageMod, factors: shot.factors };
}
