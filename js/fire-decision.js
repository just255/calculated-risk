// ═══════════════════════════════════════════════════════════════
// FIRE DECISION PIPELINE — Shared by enemies AND ally units
// Determines WHEN to fire, HOW accurate the shot is, and damage falloff.
//
// Range source: unit.range (set at spawn from UNIT_COMBAT_STATS or enemy def)
// Hard cutoff: range × 1.1 — nothing fires beyond this
// Damage falloff: steep drop beyond ~60% of range
// ═══════════════════════════════════════════════════════════════

// Zero-in time (seconds to reach full stability) per AI type key
const ZERO_IN_TIME = {
  BASIC: 2.0,
  RUSHER: 3.0,
  HUNTER: 1.5,
  CAUTIOUS: 1.0,
  FLANKER: 2.5,
  SWARMER: 4.0,
  // Ally defaults (keyed by unitId)
  infantry: 1.8,
  jeep: 2.5,
  sherman: 1.2,
  tiger: 1.0,
  abrams: 0.8
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

  const zeroIn = ZERO_IN_TIME[typeKey] || 2.0;

  if (unit._movedThisFrame) {
    // Moving resets stability quickly (decay to 0)
    unit.stability = Math.max(0, unit.stability - dtSec * 2.0);
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
  let accuracy = 1.0;
  const factors = [];

  // 1. COOLDOWN — hard gate
  const fireRate = unit.fireRate || 2000;
  const lastAttack = unit.lastAttack || unit.lastShot || 0;
  if (now - lastAttack < fireRate) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // 2. STABILITY — moving units are inaccurate
  const stability = unit.stability ?? 0.5;
  const stabilityWeight = 0.5 + stability * 0.5; // Range: 0.5 – 1.0
  accuracy *= stabilityWeight;
  factors.push({ name: 'stability', value: stabilityWeight });

  // 3. RANGE — unit.range is the single source of truth
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const range = unit.range || 150;

  // Hard cutoff: nothing fires beyond range × 1.1
  if (dist > range * 1.1) {
    return { canFire: false, accuracy: 0, damageMod: 0 };
  }

  // Accuracy falloff — mild at close range, moderate at max
  const rangeRatio = Math.min(1.0, dist / range);
  const rangeWeight = 1.0 - rangeRatio * 0.25; // 1.0 at close range, 0.75 at max range
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

  // 5. FIRE PROBABILITY — low-accuracy units sometimes skip firing entirely
  // At very low accuracy (<0.3), have a chance to not fire at all (suppression feel)
  if (accuracy < 0.3 && Math.random() > accuracy * 2) {
    return { canFire: false, accuracy, damageMod, factors };
  }

  return { canFire: true, accuracy, damageMod, factors };
}
