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
export function shouldFire(unit, target, b, now, opts = {}) {
  const factors = [];

  // 0. BASE ACCURACY — weapon system ceiling (upgrades/crew can push higher, cap at 1.0)
  const combatStats = unit.unitId ? UNIT_COMBAT_STATS[unit.unitId] : null;
  const baseAcc = Math.min(1.0, unit._accuracyBonus
    ? (combatStats?.baseAccuracy ?? 0.80) + unit._accuracyBonus
    : (combatStats?.baseAccuracy ?? 0.80));
  let accuracy = baseAcc;
  factors.push({ name: 'base', value: baseAcc });

  // 1. COOLDOWN — hard gate
  const fireRate = unit.fireRate || 2000;
  const lastAttack = unit.lastAttack || unit.lastShot || 0;
  if (now - lastAttack < fireRate) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // 2. STABILITY — moving units are inaccurate (wider band: 0.15–1.0)
  const stability = unit.stability ?? 0.5;
  const stabilityWeight = 0.15 + stability * 0.85; // Range: 0.15 – 1.0
  accuracy *= stabilityWeight;
  factors.push({ name: 'stability', value: stabilityWeight });

  // 2b. TURRET TRAVERSAL — rotating turret reduces accuracy (counts as movement)
  // Patient units handle turret rotation better (reduced penalty)
  const turretAngVel = unit._turretAngVel ?? 0;
  if (turretAngVel > 0.1) {
    const patience = unit._personality?.patience ?? 0.5;
    const maxPenalty = 0.3 * (1.0 - patience * 0.5); // patience 0→0.30, patience 1→0.15
    const floor = 1.0 - maxPenalty;                    // patience 0→0.70, patience 1→0.85
    const turretWeight = Math.max(floor, 1.0 - Math.min(maxPenalty, turretAngVel / (Math.PI * 2)));
    accuracy *= turretWeight;
    factors.push({ name: 'turretTraversal', value: turretWeight });
  }

  // 3. RANGE — unit.range is the single source of truth
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const range = unit.range || 150;

  // Hard cutoff: nothing fires beyond range × 1.1
  if (dist > range * 1.1) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // Accuracy falloff — noticeable at range (wider band: 0.55–1.0)
  const rangeRatio = Math.min(1.0, dist / range);
  const rangeWeight = 1.0 - rangeRatio * 0.45; // 1.0 at close range, 0.55 at max range
  accuracy *= rangeWeight;
  factors.push({ name: 'range', value: rangeWeight });

  // Damage falloff (steep beyond 60% of range)
  const damageMod = getDamageFalloff(dist, range);

  // 4. TARGET SPEED — faster target = lower accuracy
  const heroVelocity = opts.heroVelocity || 0;
  if (heroVelocity > 0) {
    const heroMaxSpeed = opts.heroMaxSpeed || 120;
    const speedRatio = Math.min(1.0, heroVelocity / heroMaxSpeed);
    const speedWeight = Math.max(0.3, 1.0 - speedRatio * 0.6); // 1.0 stationary, 0.4 full speed
    accuracy *= speedWeight;
    factors.push({ name: 'targetSpeed', value: speedWeight });
  }

  // 5. STABILITY THRESHOLD — personality-driven minimum stability to fire
  // Disciplined/patient units wait for a stable shot; aggressive/impatient units snap-fire
  const personality = unit._personality || unit.personality || {};
  const discipline = personality.discipline ?? 0.5;
  const patience = personality.patience ?? 0.5;
  const minStability = discipline * 0.4 + patience * 0.2; // 0.0 – 0.6
  if (stability < minStability) {
    return { canFire: false, accuracy, damageMod, factors, reason: 'stability' };
  }

  // 6. TARGET ACQUISITION DELAY — awareness + initiative gate
  // Units need time to identify and lock onto a new target before firing
  const awareness = unit._awareness ?? (personality.awareness ?? 0.5);
  const initiative = personality.initiative ?? 0.5;
  const acquireTime = (0.3 + (1 - awareness) * 0.5 + (1 - initiative) * 0.4) * 1000; // ms
  const timeSinceAcquired = now - (unit._targetAcquiredAt || 0);
  if (timeSinceAcquired < acquireTime) {
    return { canFire: false, accuracy, damageMod, factors, reason: 'acquiring' };
  }

  // 7. FIRE PROBABILITY — low-accuracy units sometimes skip firing entirely
  // At very low accuracy (<0.3), have a chance to not fire at all (suppression feel)
  if (accuracy < 0.3 && Math.random() > accuracy * 2) {
    return { canFire: false, accuracy, damageMod, factors };
  }

  return { canFire: true, accuracy, damageMod, factors };
}
