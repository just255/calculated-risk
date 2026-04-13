// ═══════════════════════════════════════════════════════════════
// CREW - Stat blending and crew-to-unit personality integration
// ═══════════════════════════════════════════════════════════════

import { CREW_SCHEMAS } from './constants.js';
import { getCrewForVehicle, getCrewModifiers } from './roster.js';

// ─── Personality blending ─────────────────────────────────────

// TC has most influence (vehicle commander sets the tone)
const BLEND_WEIGHTS = { tc: 0.4, gunner: 0.35, driver: 0.25 };

const PERSONALITY_KEYS = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];

/**
 * Compute blended personality from a vehicle's crew.
 * For infantry (crew of 1), returns the soldier's own personality.
 * Floor at base: if no crew in a slot, that slot contributes 0.3 (recruit baseline).
 *
 * @param {string} vehicleId - The vehicle instance ID
 * @param {string} unitId - The unit type (e.g. 'sherman', 'infantry')
 * @returns {object} Blended personality { aggression, patience, courage, discipline, initiative, awareness }
 */
export function getEffectivePersonality(vehicleId, unitId) {
  const schema = CREW_SCHEMAS[unitId];
  if (!schema || schema[0] === 'self') {
    // Infantry: no blending needed, caller should use soldier personality directly
    return null;
  }

  const crew = getCrewForVehicle(vehicleId);
  const blended = {};

  for (const key of PERSONALITY_KEYS) {
    let total = 0;
    let totalWeight = 0;

    for (const slot of schema) {
      const w = BLEND_WEIGHTS[slot] ?? 0.25;
      const soldier = crew[slot];
      const val = soldier?.personality?.[key] ?? 0.3; // recruit baseline if empty
      total += val * w;
      totalWeight += w;
    }

    blended[key] = totalWeight > 0 ? total / totalWeight : 0.5;
  }

  return blended;
}

/**
 * Get a specific crew member's trait for direct-read overrides.
 * Used for fire decision (gunner), morale (TC), spotting (TC).
 *
 * @param {string} vehicleId
 * @param {string} slot - 'tc', 'gunner', or 'driver'
 * @param {string} trait - personality trait key
 * @returns {number} trait value (0-1), defaults to 0.3 if no crew in slot
 */
export function getCrewTrait(vehicleId, slot, trait) {
  const crew = getCrewForVehicle(vehicleId);
  return crew[slot]?.personality?.[trait] ?? 0.3;
}

// ─── Stat blending ────────────────────────────────────────────

/**
 * Compute effective vehicle stat with crew bonus.
 * Floor at base: crew can only improve, never degrade.
 *
 * @param {number} baseStat - Vehicle's inherent stat value
 * @param {object} opts
 * @param {number} [opts.traitValue] - Crew member's personality trait (0-1)
 * @param {number} [opts.traitWeight=0.3] - How much the trait matters (max bonus %)
 * @param {number} [opts.expertise=0] - Soldier's vehicleExpertise for this type (0-1)
 * @param {number} [opts.expertiseWeight=0.15] - Expertise contribution
 * @param {number} [opts.familiarity=0] - Crew bond / missions together (0-1)
 * @param {number} [opts.familiarityWeight=0.05] - Familiarity contribution
 * @returns {number} Effective stat value (>= baseStat)
 */
export function computeEffectiveStat(baseStat, opts = {}) {
  const traitBonus = Math.max(0, (opts.traitValue ?? 0) * (opts.traitWeight ?? 0.3));
  const expertiseBonus = (opts.expertise ?? 0) * (opts.expertiseWeight ?? 0.15);
  const familiarityBonus = (opts.familiarity ?? 0) * (opts.familiarityWeight ?? 0.05);

  return baseStat * (1 + traitBonus + expertiseBonus + familiarityBonus);
}

// ─── Crew effectiveness ──────────────────────────────────────

/**
 * Compute crew modifiers for all slots of a vehicle.
 * Uses physical stats + training (via getCrewModifiers from roster.js).
 *
 * @param {string} vehicleId - Vehicle inventory ID
 * @param {string} unitId - Unit type for schema lookup
 * @returns {{ tc: object, gunner: object, driver: object }} Per-slot modifier objects
 */
export function getEffectiveVehicleStats(vehicleId, unitId) {
  const schema = CREW_SCHEMAS[unitId];
  if (!schema || schema[0] === 'self') return {};

  const crew = getCrewForVehicle(vehicleId);
  const result = {};
  for (const slot of schema) {
    result[slot] = getCrewModifiers(crew[slot], slot);
  }
  return result;
}

/**
 * Stamp blended personality onto a battle unit.
 * Call this when spawning a unit that has a crew assignment.
 * For infantry, stamps the soldier's own personality directly.
 *
 * @param {object} unit - Battle unit object (from state.js spawn)
 * @param {string} vehicleId - The vehicle instance ID
 * @param {string} unitId - The unit type
 */
export function stampCrewPersonality(unit, vehicleId, unitId) {
  const blended = getEffectivePersonality(vehicleId, unitId);
  if (blended) {
    unit.personality = blended;
  }
  // Also store vehicleId on unit for mid-battle crew lookups
  unit._crewVehicleId = vehicleId;
}
