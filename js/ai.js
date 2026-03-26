// ═══════════════════════════════════════════════════════════════
// AI — Rewritten from scratch
// Architecture: Command → Type/Stats → Personality → Morale → Action
// Modifiers: Veterancy (consistency), Awareness, Cohesion
// Shared brain for allies AND enemies.
// ═══════════════════════════════════════════════════════════════

import { UNITS, UNIT_PROJECTILES, UNIT_COMBAT_STATS, Formation, FORMATION_OFFSETS, Team, Owner, DEFAULT_MAX_SPREAD_DEG } from './constants.js';
import { updateStability, shouldFire, getDamageFalloff, applyRecoilDrop } from './fire-decision.js';
import {
  isTerrainBlocked, getTerrainSpeedMod, getTerrainAt, isInCover,
  TERRAIN_COVER_SCORE, getWaterDepth, isTerrainPassable,
  getWaterSpeedMod, distanceBetween, findNearbyCoverPos
} from './terrain-utils.js';
import { queryBridge, queryBridgeRailing, queryBridgeEntry, queryBoulder, isBridgeDeckBlocking } from './terrain-query.js';
import { findPathWorld, resolveNavWaypoint } from './pathfinding.js';
import {
  traceLineOfSight, hasLineOfSight, getConcealment, canDetect,
  buildSpottedList
} from './vision.js';
import {
  MovementMode, buildMovementContext, resolveMovementMode,
  computeThreatSpeed
} from './movement-modes.js';
import { smoothRotateToward } from './movement.js';
import { logEvent } from './battle-log.js';


// ═══════════════════════════════════════════════════════════════
// SQUAD-SCOPED WAYPOINT LOOKUP
// Multi-squad support: each squad can have its own waypoint.
// Falls back to team-level waypoint for backwards compat.
// ═══════════════════════════════════════════════════════════════

function getSquadWaypoint(b, unit) {
  if (unit._squadId != null && b._squadWaypoints?.[unit._squadId]) {
    return b._squadWaypoints[unit._squadId];
  }
  return b._teamWaypoints?.[unit.team] ?? null;
}


// ═══════════════════════════════════════════════════════════════
// LAYER 1: COMMANDS
// 6 core commands. Player issues for allies, AI Sergeant for enemies.
// Commands are LITERAL — personality affects HOW, not WHAT.
// ═══════════════════════════════════════════════════════════════

export const Command = {
  FOLLOW:     'follow',      // Stay behind leader, engage targets of opportunity
  ADVANCE:    'advance',     // Push toward enemies aggressively
  HOLD:       'hold',        // Stay where you are, defend position
  FALL_BACK:  'fall_back',   // Pull back toward safety
  COVER_ME:   'cover_me',    // Suppress enemies in leader's direction
  FOCUS_FIRE: 'focus_fire',  // Everyone targets the same enemy
  FLANK_LEFT:  'flank_left',   // Move squad to attack from the left
  FLANK_RIGHT: 'flank_right'   // Move squad to attack from the right
};

// Command registry — extensible. Add new commands here.
export const COMMAND_REGISTRY = {
  [Command.FOLLOW]: {
    label: 'Follow Me',
    allowsMovement: true,
    requiresLeader: true
  },
  [Command.ADVANCE]: {
    label: 'Advance',
    allowsMovement: true,
    requiresLeader: false
  },
  [Command.HOLD]: {
    label: 'Hold',
    allowsMovement: false,
    requiresLeader: false
  },
  [Command.FALL_BACK]: {
    label: 'Fall Back',
    allowsMovement: true,
    requiresLeader: false
  },
  [Command.COVER_ME]: {
    label: 'Cover Me',
    allowsMovement: false,
    requiresLeader: true
  },
  [Command.FOCUS_FIRE]: {
    label: 'Focus Fire',
    allowsMovement: false,
    requiresLeader: false
  },
  [Command.FLANK_LEFT]: {
    label: 'Flank Left',
    allowsMovement: true,
    requiresLeader: false
  },
  [Command.FLANK_RIGHT]: {
    label: 'Flank Right',
    allowsMovement: true,
    requiresLeader: false
  }
};

// ═══════════════════════════════════════════════════════════════
// LAYER 2: UNIT TYPES
// 4 ground categories. Stats drive behavior, not hardcoded logic.
// ═══════════════════════════════════════════════════════════════

export const UnitCategory = {
  INFANTRY:      'infantry',
  LIGHT_VEHICLE: 'light_vehicle',
  MEDIUM_TANK:   'medium_tank',
  HEAVY_TANK:    'heavy_tank'
};

// Armor tier per category — used for damage multiplier calculation
// Same-tier = 1.0x, each tier difference = ±0.25x
const ARMOR_TIER = {
  [UnitCategory.INFANTRY]:      0,
  [UnitCategory.LIGHT_VEHICLE]: 1,
  [UnitCategory.MEDIUM_TANK]:   2,
  [UnitCategory.HEAVY_TANK]:    3
};

/**
 * Get the armor tier for a unit (0=infantry, 1=light, 2=medium, 3=heavy).
 */
export function getArmorTier(unit) {
  return ARMOR_TIER[inferCategory(unit)] ?? 0;
}

/**
 * Compute damage multiplier: attacker tier vs defender tier.
 * Same tier = 1.0x. Each tier up = -0.25x, each tier down = +0.25x.
 * Clamped to [0.15, 2.0] to prevent zero damage or extreme overkill.
 */
export function getTierDamageMultiplier(attackerTier, defenderTier) {
  return Math.max(0.15, Math.min(2.0, 1.0 + (attackerTier - defenderTier) * 0.25));
}

// Core skills per category — what actions are available
export const CATEGORY_SKILLS = {
  [UnitCategory.INFANTRY]: {
    canUseCover: true,
    canGoProne: true,
    hasRecon: false
  },
  [UnitCategory.LIGHT_VEHICLE]: {
    canUseCover: false,
    canGoProne: false,
    hasRecon: true
  },
  [UnitCategory.MEDIUM_TANK]: {
    canUseCover: false,      // IS cover — uses hull down
    canGoProne: false,
    hasRecon: false,
    canHullDown: true
  },
  [UnitCategory.HEAVY_TANK]: {
    canUseCover: false,
    canGoProne: false,
    hasRecon: false,
    canHullDown: true,
    isIntimidating: true     // Enemies prioritize as threat
  }
};

// ═══════════════════════════════════════════════════════════════
// LAYER 3: PERSONALITY
// 6 axes, each 0-1. Rolled at creation, mutable.
// ═══════════════════════════════════════════════════════════════

export const PersonalityAxis = {
  AGGRESSION:   'aggression',    // 0=cautious, 1=eager
  PATIENCE:     'patience',      // 0=fires ASAP, 1=waits for perfect shot
  COURAGE:      'courage',       // 0=flinches, 1=stands ground
  DISCIPLINE:   'discipline',    // 0=freelances, 1=follows orders
  INITIATIVE:   'initiative',    // 0=only does what told, 1=acts on opportunities
  AWARENESS:    'awareness'      // 0=tunnel vision, 1=quick reactions (capability)
};

/**
 * Generate a random personality for a new unit.
 * Can optionally weight axes toward certain values by category.
 * @param {string} category - UnitCategory value (optional, for weighting)
 * @returns {object} Personality with 6 axes, each 0-1
 */
export function generatePersonality(category = null) {
  const p = {
    aggression:   Math.random(),
    patience:     Math.random(),
    courage:      Math.random(),
    discipline:   Math.random(),
    initiative:   Math.random(),
    awareness:    Math.random()
  };

  // Optional category weighting — nudge toward typical values
  // Infantry tends more disciplined, tanks more patient, etc.
  if (category === UnitCategory.INFANTRY) {
    p.discipline = clamp01(p.discipline * 0.8 + 0.2);  // Nudge higher
    p.awareness = clamp01(p.awareness * 0.8 + 0.2);
  } else if (category === UnitCategory.LIGHT_VEHICLE) {
    p.aggression = clamp01(p.aggression * 0.8 + 0.2);
    p.initiative = clamp01(p.initiative * 0.8 + 0.2);
  } else if (category === UnitCategory.MEDIUM_TANK) {
    p.patience = clamp01(p.patience * 0.7 + 0.3);
    p.discipline = clamp01(p.discipline * 0.7 + 0.3);
  } else if (category === UnitCategory.HEAVY_TANK) {
    p.patience = clamp01(p.patience * 0.6 + 0.4);
    p.courage = clamp01(p.courage * 0.6 + 0.4);
  }

  return p;
}

// ═══════════════════════════════════════════════════════════════
// LAYER 4: MORALE
// Dynamic 0-1 meter. Morale = trigger, Courage = response direction.
// Same event affects different personalities differently.
// ═══════════════════════════════════════════════════════════════

export const MoraleEvent = {
  TOOK_DAMAGE:      'took_damage',
  ALLY_DIED:        'ally_died',
  LANDED_KILL:      'landed_kill',
  UNDER_FIRE:       'under_fire',
  OUTNUMBERED:      'outnumbered',
  NEAR_ALLIES:      'near_allies',
  ISOLATED:         'isolated',
  WINNING:          'winning',
  LOSING:           'losing',
  LEADER_DIED:      'leader_died'
};

/**
 * Calculate morale change from a battle event, filtered through personality.
 * High courage + aggression: bad events can INCREASE morale (rage).
 * Low courage: bad events decrease morale (fear).
 *
 * @param {object} personality - Unit's 6-axis personality
 * @param {string} event - MoraleEvent type
 * @param {number} intensity - 0-1 how severe the event is
 * @returns {number} Morale delta (positive = boost, negative = drop)
 */
export function getMoraleChange(personality, event, intensity = 0.5) {
  const { courage, aggression, discipline } = personality;

  // Base impact of the event (negative = bad, positive = good)
  let baseImpact;
  switch (event) {
    case MoraleEvent.TOOK_DAMAGE:   baseImpact = -0.15; break;
    case MoraleEvent.ALLY_DIED:     baseImpact = -0.20; break;
    case MoraleEvent.UNDER_FIRE:    baseImpact = -0.05; break;
    case MoraleEvent.OUTNUMBERED:   baseImpact = -0.10; break;
    case MoraleEvent.ISOLATED:      baseImpact = -0.10; break;
    case MoraleEvent.LOSING:        baseImpact = -0.10; break;
    case MoraleEvent.LEADER_DIED:   baseImpact = -0.30; break;
    case MoraleEvent.LANDED_KILL:   baseImpact = +0.15; break;
    case MoraleEvent.NEAR_ALLIES:   baseImpact = +0.05; break;
    case MoraleEvent.WINNING:       baseImpact = +0.10; break;
    default: baseImpact = 0;
  }

  baseImpact *= intensity;

  // Courage filters the response DIRECTION
  // High courage: negative events are less negative (or even positive with high aggression)
  // Low courage: negative events hit harder
  if (baseImpact < 0) {
    // Bad event
    const courageFilter = 1.0 - courage; // 0 courage = full impact, 1 courage = no impact
    let delta = baseImpact * courageFilter;

    // High courage + high aggression: bad events can fuel rage (positive morale)
    if (courage > 0.7 && aggression > 0.6) {
      delta = -baseImpact * 0.3 * aggression; // Flip to positive, scaled by aggression
    }

    // Discipline dampens all swings (steady under pressure)
    delta *= (1.0 - discipline * 0.3);

    return delta;
  } else {
    // Good event — courage doesn't gate positive events much
    let delta = baseImpact;

    // Aggressive units get bigger morale boost from kills
    if (event === MoraleEvent.LANDED_KILL) {
      delta *= (1.0 + aggression * 0.5);
    }

    return delta;
  }
}

/**
 * Update a unit's morale based on an event.
 * @param {object} unit - Unit with .morale and .personality
 * @param {string} event - MoraleEvent type
 * @param {number} intensity - 0-1 severity
 */
export function applyMoraleEvent(unit, event, intensity = 0.5) {
  if (!unit.personality) return;
  if (unit.morale === undefined) unit.morale = 0.8; // Default: fairly confident

  const prevMorale = unit.morale;
  const delta = getMoraleChange(unit.personality, event, intensity);
  unit.morale = clamp01(unit.morale + delta);

  // Log morale event to battle debug log if available
  if (Math.abs(delta) > 0.02) {
    const logTeam = unit.team;
    logEvent(unit._battle, {
      t: Date.now(), who: unit.id, team: logTeam, type: 'morale_event',
      x: Math.round(unit.x || 0), y: Math.round(unit.y || 0),
      action: `${event}`, detail: `delta:${delta > 0 ? '+' : ''}${delta.toFixed(3)} mrl:${prevMorale.toFixed(2)}→${unit.morale.toFixed(2)} int:${intensity.toFixed(1)}`
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// MODIFIER 1: VETERANCY
// Consistency modifier. Rookies are unpredictable, veterans are reliable.
// ═══════════════════════════════════════════════════════════════

/**
 * Apply veterancy-scaled randomness to a value.
 * Rookie (veterancy 0): value +/- maxSwing (full randomness)
 * Veteran (veterancy 1): value is returned nearly unchanged
 *
 * @param {number} value - Base value
 * @param {number} veterancy - 0-1 veterancy level
 * @param {number} maxSwing - Maximum random deviation at veterancy 0
 * @returns {number} Value with veterancy-scaled noise
 */
export function veterancyApply(value, veterancy = 0, maxSwing = 0.2) {
  const noise = (Math.random() - 0.5) * 2 * maxSwing; // -maxSwing to +maxSwing
  const scaledNoise = noise * (1.0 - veterancy);        // Reduced by veterancy
  return value + scaledNoise;
}

// ═══════════════════════════════════════════════════════════════
// MODIFIER 2: AWARENESS
// Intelligence layer — gates how smart the unit behaves.
// Computed from base config + personality + conditions.
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate awareness level for a unit.
 * Combines base value (config), personality (awareness), veterancy,
 * cohesion, and situational penalties (suppression, smoke, shock).
 * Result cached on unit._awareness for use by other systems.
 *
 * @param {object} unit - Combat unit
 * @param {object} cohesion - From getCohesion() { nearbyCount, hasLeader }
 * @returns {number} 0-1 awareness level (1 = fully aware)
 */
export function getAwareness(unit, cohesion) {
  const p = unit.personality || {};

  // Base awareness from config (slider value) or default
  let awareness = unit.awareness ?? 0.5;

  // Personality: awareness trait = inherent perceptiveness
  awareness += (p.awareness || 0) * 0.2;

  // Experience: veteran units are more aware
  awareness += (unit.veterancy || 0) * 0.15;

  // Cohesion: allies nearby share info (+0.05 per ally, max +0.15)
  if (cohesion) {
    awareness += Math.min(0.15, (cohesion.nearbyCount || 0) * 0.05);
    // Leader presence gives extra awareness bonus
    if (cohesion.hasLeader) awareness += 0.05;
  }

  // Suppression: under fire = tunnel vision
  if (unit.suppressed) {
    awareness -= 0.4;
  }

  // Smoke: can't see
  if (unit.inSmoke) {
    awareness -= 0.5;
  }

  // Shock: recent damage causes brief awareness drop (decays over 2s)
  if (unit._shockTimer > 0) {
    awareness -= 0.2 * Math.min(1, unit._shockTimer / 2);
  }

  awareness = clamp01(awareness);
  unit._awareness = awareness;
  return awareness;
}

// ═══════════════════════════════════════════════════════════════
// MODIFIER 3: COHESION
// Nearby friendlies boost morale and coordination.
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate cohesion bonus for a unit based on nearby allies.
 * @param {object} unit - The unit to check
 * @param {Array} allies - All friendly units
 * @param {number} radius - Cohesion radius (pixels)
 * @returns {object} { nearbyCount, hasLeader, cohesionBonus }
 */
export function getCohesion(unit, allies, radius = 150) {
  let nearbyCount = 0;
  let hasLeader = false;

  for (const ally of allies) {
    if (ally === unit || ally.dead || ally.id === unit.id) continue;
    const dx = unit.x - ally.x;
    const dy = unit.y - ally.y;
    if (dx * dx + dy * dy < radius * radius) {
      nearbyCount++;
      if (ally.isLeader || ally.isHero) hasLeader = true;
    }
  }

  // Cohesion bonus: more nearby = better, with diminishing returns
  const countBonus = Math.min(0.3, nearbyCount * 0.05);
  const leaderBonus = hasLeader ? 0.15 : 0;

  return {
    nearbyCount,
    hasLeader,
    cohesionBonus: countBonus + leaderBonus, // 0 to ~0.45
    isolated: nearbyCount === 0
  };
}

// ═══════════════════════════════════════════════════════════════
// ENTITY COLLISION SYSTEM (kept from old AI)
// ═══════════════════════════════════════════════════════════════

export const ENTITY_RADIUS = {
  hero: 20,
  ally: 20,
  enemy: 15,
  projectile: 4
};

export function entitiesCollide(a, b, radiusA, radiusB) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distSq = dx * dx + dy * dy;
  const minDist = radiusA + radiusB;
  return distSq < minDist * minDist;
}

export function wouldCollide(x, y, radius, entities, excludeId = null) {
  for (const e of entities) {
    if (e.dead) continue;
    if (excludeId && e.id === excludeId) continue;
    const otherRadius = e.radius || ENTITY_RADIUS.enemy;
    const dx = x - e.x;
    const dy = y - e.y;
    const distSq = dx * dx + dy * dy;
    const minDist = radius + otherRadius;
    if (distSq < minDist * minDist) return e;
  }
  return null;
}

export function getSeparationVector(entity, others, entityRadius) {
  let sepX = 0, sepY = 0;
  for (const other of others) {
    if (other.dead || other === entity || other.id === entity.id) continue;
    const otherRadius = other.radius || ENTITY_RADIUS.enemy;
    const dx = entity.x - other.x;
    const dy = entity.y - other.y;
    const distSq = dx * dx + dy * dy;
    const minDist = entityRadius + otherRadius;
    if (distSq < minDist * minDist && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const overlap = minDist - dist;
      sepX += (dx / dist) * overlap * 0.5;
      sepY += (dy / dist) * overlap * 0.5;
    }
  }
  return { x: sepX, y: sepY };
}

export function calcSeparation(entity, others, separationRadius = 40) {
  let sepX = 0, sepY = 0;
  for (const other of others) {
    if (other === entity || other.dead || other.id === entity.id) continue;
    const dx = entity.x - other.x;
    const dy = entity.y - other.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < separationRadius * separationRadius && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const force = (separationRadius - dist) / separationRadius;
      sepX += (dx / dist) * force;
      sepY += (dy / dist) * force;
    }
  }
  return { x: sepX, y: sepY };
}

/**
 * Water avoidance steering. Samples cells in the movement direction and
 * pushes the unit perpendicular to avoid entering water. Strength is
 * proportional to the water cost (deep > medium > shallow).
 */
function calcWaterAvoidance(b, unit, dirX, dirY, category) {
  const cellSize = b.terrainMap?.cellSize || b.cellSize || 64;
  // Check a cell-width ahead
  const lookDist = cellSize * 0.8;
  const aheadX = unit.x + dirX * lookDist;
  const aheadY = unit.y + dirY * lookDist;

  // If the ahead point is on a bridge, don't avoid — let the unit walk onto it
  const bridges = b.terrainMap?.bridges;
  if (bridges && queryBridge(bridges, aheadX, aheadY)) return { x: 0, y: 0 };

  const depth = getWaterDepth(b, aheadX, aheadY);
  if (!depth) return { x: 0, y: 0 };

  // Shallow: no steering — it's almost free to cross
  if (depth === 'shallow') return { x: 0, y: 0 };

  // Medium/deep: light nudge; vehicles steer harder for deep (can't pass)
  const strength = depth === 'medium' ? 0.1 : 0.3;
  const catMult = category === 'infantry' ? 1.0 : 2.0;

  // Perpendicular directions (left and right of movement)
  const perpLX = -dirY, perpLY = dirX;
  const perpRX = dirY,  perpRY = -dirX;

  // Sample both sides — pick the drier side
  const leftDepth  = getWaterDepth(b, unit.x + perpLX * lookDist, unit.y + perpLY * lookDist);
  const rightDepth = getWaterDepth(b, unit.x + perpRX * lookDist, unit.y + perpRY * lookDist);

  const leftScore  = leftDepth  ? (leftDepth === 'deep' ? 3 : leftDepth === 'medium' ? 2 : 1) : 0;
  const rightScore = rightDepth ? (rightDepth === 'deep' ? 3 : rightDepth === 'medium' ? 2 : 1) : 0;

  // Steer toward the drier side
  const force = strength * catMult;
  if (leftScore <= rightScore) {
    return { x: perpLX * force, y: perpLY * force };
  } else {
    return { x: perpRX * force, y: perpRY * force };
  }
}

// Terrain helpers extracted to terrain-utils.js
// Vision system extracted to vision.js
// Movement modes extracted to movement-modes.js


// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (kept from old AI)
// ═══════════════════════════════════════════════════════════════

export function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: THE BRAIN — Unified AI for all combat units
// Same brain for allies AND enemies. Commands + Stats + Personality → Action.
// ═══════════════════════════════════════════════════════════════

/**
 * Map unitId to UnitCategory for skill lookups.
 */
function inferCategory(unit) {
  switch (unit.unitId || 'infantry') {
    case 'infantry': case 'medic': case 'specops':
      return UnitCategory.INFANTRY;
    case 'jeep': case 'humvee':
      return UnitCategory.LIGHT_VEHICLE;
    case 'sherman':
      return UnitCategory.MEDIUM_TANK;
    case 'tiger': case 'abrams': case 'howitzer':
      return UnitCategory.HEAVY_TANK;
    default:
      return UnitCategory.INFANTRY;
  }
}

// ── Turn rates per unit category (radians/sec) ──────────────
// Tanks: tracked, can pivot in place at full rate.
// Wheeled: need forward speed to turn; stationary turn is very slow.
// Infantry: free movement, near-instant facing.
const TURN_RATE = {
  [UnitCategory.INFANTRY]:      Math.PI * 6,    // ~1080 deg/s — near-instant
  [UnitCategory.LIGHT_VEHICLE]: Math.PI * 1.0,  // ~180 deg/s — nimble but visible
  [UnitCategory.MEDIUM_TANK]:   Math.PI * 0.5,  // ~90 deg/s  — deliberate
  [UnitCategory.HEAVY_TANK]:    Math.PI * 0.33, // ~60 deg/s  — lumbering
};

// Movement model per category
const MOVE_MODEL = {
  [UnitCategory.INFANTRY]:      'free',    // move any direction, face instantly
  [UnitCategory.LIGHT_VEHICLE]: 'wheeled', // need speed to turn, move along hull
  [UnitCategory.MEDIUM_TANK]:   'tracked', // pivot in place, move along hull
  [UnitCategory.HEAVY_TANK]:    'tracked', // pivot in place, move along hull
};

// Wheeled vehicles: fraction of turn rate when stationary (creep-turn)
const WHEELED_STATIONARY_TURN = 0.15;

// How much misalignment reduces forward speed (0 = no penalty, 1 = full stop if sideways)
// At 90° off, speed = baseSpeed * (1 - ALIGNMENT_PENALTY)
const ALIGNMENT_PENALTY = 0.7;

// Beyond this angle diff (radians), vehicle reverses instead of doing a full 180
const REVERSE_THRESHOLD = Math.PI * 0.75; // 135°

// Fallback acceleration rates by category (used when UNIT_COMBAT_STATS has no accel/decel)
const ACCEL_RATE = {
  [UnitCategory.INFANTRY]:      { accel: 4.0, decel: 6.0 },
  [UnitCategory.LIGHT_VEHICLE]: { accel: 4.5, decel: 3.5 },
  [UnitCategory.MEDIUM_TANK]:   { accel: 2.0, decel: 3.5 },
  [UnitCategory.HEAVY_TANK]:    { accel: 1.5, decel: 3.0 },
};

/**
 * Smoothly rotate unit.hullAngle toward a target angle at the unit's hull turn rate.
 * Wheeled vehicles turn slower when stationary/slow.
 * Unit-level override: set unit._hullRate (deg/s) to customize per-unit.
 */
function turnHullToward(unit, targetAngle, dtSec) {
  const cat = inferCategory(unit);
  const combatStats = UNIT_COMBAT_STATS[unit.unitId];
  let rate = unit._hullRate
    ? (unit._hullRate * Math.PI / 180)
    : combatStats?.hullRate
      ? (combatStats.hullRate * Math.PI / 180)
      : (unit._turnRate ?? TURN_RATE[cat] ?? TURN_RATE[UnitCategory.INFANTRY]);

  // Wheeled vehicles turn slower when not moving
  if (MOVE_MODEL[cat] === 'wheeled') {
    const speed = unit._currentSpeed ?? 0;
    const maxSpeed = unit.speed ?? 80;
    const speedFrac = Math.min(1, speed / maxSpeed);
    const turnFrac = WHEELED_STATIONARY_TURN + (1 - WHEELED_STATIONARY_TURN) * speedFrac;
    rate *= turnFrac;
  }

  if (unit.hullAngle == null) unit.hullAngle = unit.angle;
  unit.hullAngle = smoothRotateToward(unit.hullAngle, targetAngle, rate * dtSec);
}

/**
 * Smoothly rotate unit.angle (turret/torso) toward a target angle.
 * Uses trapezoidal motion profile: accelerate → cruise → decelerate.
 * For small angles, triangular profile (never reaches max speed).
 * Enforces turret arc hard limit relative to hullAngle.
 * Tracks angular velocity for stability penalty.
 */
function turnTurretToward(unit, targetAngle, dtSec) {
  const combatStats = UNIT_COMBAT_STATS[unit.unitId];
  const maxRateDeg = combatStats?.turretRate ?? 270;
  const maxRate = maxRateDeg * Math.PI / 180;           // rad/s max
  const accelDeg = combatStats?.turretAccel ?? (maxRateDeg * 4);
  const accel = accelDeg * Math.PI / 180;               // rad/s² accel & decel

  // Enforce turret arc hard limit relative to hull facing
  const arcDeg = combatStats?.turretArc ?? 360;
  if (arcDeg < 360) {
    const halfArc = (arcDeg / 2) * Math.PI / 180;
    const hull = unit.hullAngle ?? unit.angle;
    let relAngle = normalizeAngle(targetAngle - hull);
    relAngle = Math.max(-halfArc, Math.min(halfArc, relAngle));
    targetAngle = hull + relAngle;
  }

  const prevAngle = unit.angle;
  let diff = normalizeAngle(targetAngle - unit.angle);
  const absDiff = Math.abs(diff);
  const sign = Math.sign(diff) || 1;

  // Current turret angular speed (unsigned, rad/s)
  let curSpeed = Math.abs(unit._turretCurSpeed ?? 0);

  if (absDiff < 0.001) {
    // Close enough — snap and zero speed
    unit.angle = targetAngle;
    curSpeed = 0;
  } else {
    // Stopping distance at current speed: d = v² / (2a)
    const stopDist = (curSpeed * curSpeed) / (2 * accel);

    if (stopDist >= absDiff) {
      // Must decelerate — we'd overshoot if we maintained speed
      curSpeed = Math.max(0, curSpeed - accel * dtSec);
    } else {
      // Room to accelerate (or cruise at max)
      curSpeed = Math.min(maxRate, curSpeed + accel * dtSec);
    }

    // Clamp movement to remaining distance
    const move = Math.min(curSpeed * dtSec, absDiff);
    unit.angle = normalizeAngle(unit.angle + sign * move);
  }

  // Store unsigned speed for next frame
  unit._turretCurSpeed = curSpeed;

  // Track angular velocity for stability penalty — smoothed with exponential decay
  // so a single-frame turret snap (e.g. first target acquisition) doesn't cause max penalty
  const instantAngVel = Math.abs(normalizeAngle(unit.angle - prevAngle)) / Math.max(dtSec, 0.001);
  const prev = unit._turretAngVel ?? 0;
  const smoothing = 0.3; // blend factor: 0.3 = 30% new, 70% old (smooths over ~3 frames)
  unit._turretAngVel = prev + (instantAngVel - prev) * smoothing;
}

/**
 * Check if turret is aimed close enough to target to fire.
 */
function isTurretAligned(unit, targetAngle) {
  const combatStats = UNIT_COMBAT_STATS[unit.unitId];
  const toleranceDeg = combatStats?.fireTolerance ?? 10;
  const tolerance = toleranceDeg * Math.PI / 180;
  return Math.abs(normalizeAngle(unit.angle - targetAngle)) <= tolerance;
}

// Legacy alias — some callers still use the old name
function turnUnitToward(unit, targetAngle, dtSec) {
  turnTurretToward(unit, targetAngle, dtSec);
}

/**
 * First-frame initialization. Sets personality, morale, command, team.
 */
// ── Effective Morale System ──────────────────────────────────

/**
 * Compute effective morale — the single number that drives all behavior decisions.
 * Raw morale is the stress meter (decays/recovers). Effective morale adds modifiers
 * from discipline, sergeant leadership, and veterancy.
 *
 * @param {object} unit - The unit (reads morale, personality.discipline, veterancy)
 * @param {number} sgtLeadership - Sergeant's leadership stat (0-1)
 * @returns {number} Effective morale (can exceed 1.0 with high modifiers)
 */
function computeEffectiveMorale(unit, sgtLeadership) {
  const morale = unit.morale ?? 0.8;
  const discipline = unit.personality?.discipline ?? 0.5;
  const veterancy = unit.veterancy ?? 0;
  return morale + discipline * 0.3 + sgtLeadership * 0.2 + veterancy * 0.1;
}

/**
 * Compute personality-driven band thresholds for behavior transitions.
 * Cached on brain init — only changes if personality changes.
 *
 * Bands (low to high effectiveMorale):
 *   below routThreshold     → rout (blue only: break from squad)
 *   rout..survival          → survival dominates (self-preservation)
 *   survival..obey          → competition (orders vs instinct)
 *   above obeyThreshold     → follows orders reliably
 */
function _computeBandThresholds(unit) {
  const courage = unit.personality?.courage ?? 0.5;
  const aggression = unit.personality?.aggression ?? 0.5;
  const patience = unit.personality?.patience ?? 0.5;

  const routThreshold = 0.10 + (1 - courage) * 0.15;
  const survivalThreshold = routThreshold + 0.15 + (1 - aggression) * 0.15;
  const obeyThreshold = survivalThreshold + 0.10 + patience * 0.10;

  unit._routThreshold = routThreshold;
  unit._survivalThreshold = survivalThreshold;
  unit._obeyThreshold = obeyThreshold;
}

function initBrain(unit, team) {
  if (unit._brainInit) return;

  if (!unit.personality) {
    unit.personality = generatePersonality(inferCategory(unit));
  }
  if (unit.morale === undefined) unit.morale = 0.8;
  if (unit.veterancy === undefined) unit.veterancy = 0;
  if (!unit.team) unit.team = team;

  // Ensure unit has a range — single source: UNIT_COMBAT_STATS
  if (!unit.range) {
    const id = unit.unitId || 'infantry';
    unit.range = UNIT_COMBAT_STATS[id]?.range || 150;
  }

  // Map old orders to new commands
  if (!unit.command) {
    const order = unit.currentOrder || '';
    switch (order) {
      case 'hold': case 'digIn':
        unit.command = Command.HOLD; break;
      case 'advance': case 'search': case 'flank':
        unit.command = Command.ADVANCE; break;
      case 'fallback':
        unit.command = Command.FALL_BACK; break;
      default:
        unit.command = Command.ADVANCE;
    }
  }

  // Cache personality-driven band thresholds (rout/survival/obey)
  _computeBandThresholds(unit);

  // Cache detection signatures from UNIT_COMBAT_STATS (avoids lookup per vision scan)
  const stats = UNIT_COMBAT_STATS[unit.unitId || 'infantry'];
  unit._moveSignature = stats?.moveSignature ?? 1.2;
  unit._fireSignature = stats?.fireSignature ?? 1.4;
  unit._proneSignature = stats?.proneSignature ?? 0.5;

  unit._brainInit = true;
}

/**
 * Compute stat-driven targeting weight modifiers based on unit combat stats.
 * Awareness scales the influence — low awareness = stats don't affect targeting.
 * @param {object} unit - Unit with range, damage, hp, maxHp, speed
 * @returns {{ dDist: number, dWeak: number, dThreat: number, dValue: number }}
 */
function getStatsTargetingModifiers(unit) {
  const awareness = unit._awareness ?? 0.5;
  if (awareness < 0.05) return { dDist: 0, dWeak: 0, dThreat: 0, dValue: 0 };

  // Reference midpoints from unit stat ranges
  const REF_RANGE = 200, REF_DAMAGE = 30, REF_HP = 120, REF_SPEED = 75;
  const INFLUENCE = 0.2; // max modifier per axis

  const range = unit.range || 150;
  const damage = unit.damage || 10;
  const hp = unit.maxHp || unit.hp || 60;
  const speed = unit.speed || 80;

  // Normalize each stat relative to reference (-1 to +1)
  const rangeN = clamp((range - REF_RANGE) / REF_RANGE, -1, 1);
  const damageN = clamp((damage - REF_DAMAGE) / REF_DAMAGE, -1, 1);
  const hpN = clamp((hp - REF_HP) / REF_HP, -1, 1);
  const speedN = clamp((speed - REF_SPEED) / REF_SPEED, -1, 1);

  // Long-range units: reduce distance weight (don't prefer close), boost weakness
  // Short-range units: boost distance weight (get close)
  let dDist = -rangeN * INFLUENCE;
  let dWeak = rangeN * INFLUENCE * 0.6;
  // High-damage units prefer high-value targets
  let dValue = damageN * INFLUENCE;
  // Fragile units (low HP) prioritize threats (self-preservation)
  let dThreat = -hpN * INFLUENCE * 0.8;
  // Fast units slightly prefer closer targets
  dDist += speedN * INFLUENCE * 0.3;

  // Awareness scales the entire influence
  return {
    dDist: dDist * awareness,
    dWeak: dWeak * awareness,
    dThreat: dThreat * awareness,
    dValue: dValue * awareness
  };
}

/**
 * Select best target from hostiles. Personality influences preference.
 */
function selectBrainTarget(b, unit, hostiles, leader, command) {
  // Use spotted list (vision-gated) when available, fall back to raw hostiles
  const spotted = unit._spotted;
  const bridges = b.terrainMap?.bridges;
  const alive = [];
  const spottedByEnemy = new Map(); // enemyId → spotted entry (concealment, accuracy)
  const bridgeBlocked = [];
  if (Array.isArray(spotted)) {
    // Vision system active — only target what this unit can see
    const unitRange = unit.range || 150;
    for (const s of spotted) {
      if (s.enemy && !s.enemy.dead && s.enemy.hp > 0) {
        // Skip off-map enemies (stuck behind edges)
        if (s.enemy.x < 0 || s.enemy.y < 0 || s.enemy.x > (b.mapWidth || 9999) || s.enemy.y > (b.mapHeight || 9999)) continue;
        // Shared intel (hero/sergeant relay) gives awareness, not a firing solution.
        // Unit must be within its own range to engage — intel tells you where to look,
        // not where to shoot. Direct sightings are always targetable.
        if (!s.direct) {
          const d = distanceBetween(unit, s.enemy);
          if (d > unitRange * 1.2) continue; // Too far to engage on intel alone
        }
        // Bridge deck blocks targeting between different elevation levels
        if (isBridgeDeckBlocking(bridges, unit.x, unit.y, s.enemy.x, s.enemy.y, unit._bridgeElevation, s.enemy._bridgeElevation)) {
          bridgeBlocked.push(s.enemy);
        } else {
          alive.push(s.enemy);
          spottedByEnemy.set(s.enemy.id, s);
        }
      }
    }
  } else {
    // Fallback: no vision system active (e.g., campaign mode without vision)
    for (const e of hostiles) {
      if (e.dead || (e.hp !== undefined && e.hp <= 0)) continue;
      if (e.x < 0 || e.y < 0 || e.x > (b.mapWidth || 9999) || e.y > (b.mapHeight || 9999)) continue;
      alive.push(e);
    }
  }
  // If no unblocked targets but bridge-blocked targets exist, use those as fallback.
  // The unit will reposition to get LOS instead of firing.
  if (alive.length === 0) {
    if (bridgeBlocked.length > 0) {
      alive.push(...bridgeBlocked);
      unit._targetBridgeBlocked = true;
    } else {
      unit._targetBridgeBlocked = false;
      return null;
    }
  } else {
    unit._targetBridgeBlocked = false;
  }

  // FOCUS_FIRE: match leader's target (hard override)
  if (command === Command.FOCUS_FIRE && leader?._currentTarget) {
    const lt = leader._currentTarget;
    if (!lt.dead && lt.hp > 0) return lt;
  }

  const p = unit.personality || {};
  const tgt = unit.targeting || {};

  // --- Resolve effective weights: config base + personality + command modifiers ---
  let wDist = tgt.distance ?? 0.7;
  let wWeak = tgt.weakness ?? 0.3;
  let wThreat = tgt.threat ?? 0.0;
  let wValue = tgt.value ?? 0.0;

  // Personality influence (doubled from original — needs to overcome normalization compression):
  // - Patient units lean toward weakness (finish off wounded efficiently)
  // - Aggressive units lean toward distance (push into closest)
  // - Courageous units lean toward threat (take on the biggest danger)
  // - Initiative adds random bias per-unit so identical personalities diverge
  const patience = p.patience ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;
  const initiative = p.initiative ?? 0.5;
  wWeak += (patience - 0.5) * 0.8;       // ±0.4 (was ±0.2)
  wDist += (aggression - 0.5) * 0.6;     // ±0.3 (was ±0.15)
  wThreat += (courage - 0.5) * 0.6;      // ±0.3 (was ±0.15)

  // Note: personality influence above is multiplicative with factor scores.
  // When targets are similar (same type, similar range), factor gaps compress
  // and personality * tiny_gap ≈ 0. The per-target additive bias below
  // ensures personality still differentiates even when factors are compressed.

  // Courage-gated targeting priority:
  // Low courage → prioritize threats to SELF (self-defense)
  // High courage → prioritize threats to ALLIES (ally-defense)
  const wSelfDefense = (1 - courage) * 0.5;   // max 0.5 for cowardly unit (was 0.4)
  const wAllyDefense = courage * 0.4;          // max 0.4 for brave unit (was 0.3)

  // Command influence:
  // - HOLD: boost distance (engage what's close, don't chase)
  // - FALL_BACK: boost threat (watch the biggest danger while retreating)
  // - COVER_ME: boost threat (suppress the most dangerous enemy)
  if (command === Command.HOLD) { wDist += 0.3; }
  else if (command === Command.FALL_BACK) { wThreat += 0.3; wDist += 0.2; }
  else if (command === Command.COVER_ME) { wThreat += 0.4; }

  // Stats influence: unit combat stats bias targeting (scaled by awareness)
  const statsMod = getStatsTargetingModifiers(unit);
  wDist += statsMod.dDist;
  wWeak += statsMod.dWeak;
  wThreat += statsMod.dThreat;
  wValue += statsMod.dValue;

  // Clamp weights to 0-2 range (allow amplification but not negative)
  wDist = Math.max(0, wDist);
  wWeak = Math.max(0, wWeak);
  wThreat = Math.max(0, wThreat);
  wValue = Math.max(0, wValue);

  // Fallback: if all weights are ~0, default to distance
  const totalW = wDist + wWeak + wThreat + wValue;
  if (totalW < 0.01) wDist = 1.0;

  // --- Compute per-target reference values for normalization ---
  let maxDist = 0, maxDmg = 0, maxMaxHp = 0;
  const targetData = [];
  for (const e of alive) {
    const dx = e.x - unit.x, dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dmg = e.damage || 10;
    const mhp = e.maxHp || 60;
    if (dist > maxDist) maxDist = dist;
    if (dmg > maxDmg) maxDmg = dmg;
    if (mhp > maxMaxHp) maxMaxHp = mhp;
    targetData.push({ target: e, dist, dmg, hp: e.hp, maxHp: mhp });
  }
  if (maxDist < 1) maxDist = 1;
  if (maxDmg < 1) maxDmg = 1;
  if (maxMaxHp < 1) maxMaxHp = 1;

  // --- Perception roll: awareness determines how much this unit perceives right now ---
  // Single roll per evaluation — determines perception quality for all 8 factors
  const awareness = unit._awareness ?? (p.awareness ?? 0.5);
  const discipline = p.discipline ?? 0.5;
  const perceptionRoll = Math.random();
  const perceives = perceptionRoll < awareness; // true = full perception this eval

  // Pre-compute engagement counts (how many friendlies target each enemy) — only if perceived
  let engagedCounts = null;
  if (perceives && command !== Command.FOCUS_FIRE) {
    engagedCounts = new Map();
    const friendlyPool = unit.team === Team.BLUE ? (b.units || []) : (b.enemies || []);
    for (const f of friendlyPool) {
      if (f === unit || f.dead) continue;
      const ft = f._currentTarget;
      if (ft && !ft.dead) {
        engagedCounts.set(ft.id, (engagedCounts.get(ft.id) || 0) + 1);
      }
    }
  }

  // --- Score each target ---
  let bestScore = -Infinity, bestEntry = null;
  for (const td of targetData) {
    const distScore = 1.0 - (td.dist / (maxDist * 1.2));    // closer = higher (0-1)
    const weakScore = 1.0 - (td.hp / (td.maxHp || 1));      // lower HP% = higher (0-1)
    let threatScore = td.dmg / maxDmg;                       // higher damage = higher (0-1)
    // Flank threat boost: flanking enemies get +0.5 threat for 2 seconds
    if (td.target._flankThreatBoost && Date.now() < td.target._flankThreatBoost) {
      threatScore = Math.min(1, threatScore + 0.5);
    }
    const valueScore = td.maxHp / maxMaxHp;                  // higher maxHP = higher (0-1)

    td.score = distScore * wDist + weakScore * wWeak + threatScore * wThreat + valueScore * wValue;

    // Personality-driven additive bias — ensures different personalities pick
    // different targets even when factor scores compress (same unit type, similar range).
    const persBonus = (aggression - 0.5) * distScore * 0.16   // aggressive → close
                    + (patience - 0.5) * weakScore * 0.16     // patient → wounded
                    + (courage - 0.5) * threatScore * 0.16;   // brave → dangerous
    td.score += persBonus;

    // Courage-gated: bonus for enemies targeting me or my allies
    // Scaled by how much damage they deal (DPS proxy)
    const enemyTarget = td.target._currentTarget;
    const enemyDpsRatio = td.dmg / maxDmg;
    if (enemyTarget === unit) {
      td.score += wSelfDefense * (0.5 + enemyDpsRatio * 0.5);
    } else if (enemyTarget && enemyTarget.team === unit.team && !enemyTarget.dead) {
      const allyHpRatio = enemyTarget.hp / (enemyTarget.maxHp || 1);
      const urgency = (1 - allyHpRatio) * 0.4 + enemyDpsRatio * 0.6;
      td.score += wAllyDefense * urgency;
    }

    // ── PERCEPTION LAYER ─────────────────────────────────────────
    // Awareness determines IF the unit perceives each factor.
    // Personality determines HOW the brain processes what was perceived.
    // Bonuses are small (0.10-0.15) — nudge decisions, don't override weights.
    if (perceives) {
      const e = td.target;
      const sEntry = spottedByEnemy.get(e.id);

      // 1. CONCEALMENT — discipline: high → bonus for exposed, low → bonus for any visible
      const concealment = sEntry?.concealment ?? 0;
      td.score += (1 - concealment) * discipline * 0.12      // disciplined: bonus for exposed
               +  concealment * (1 - discipline) * 0.06;     // undisciplined: doesn't care, slight bonus (commits)

      // 2. SUPPRESSION STATE — initiative: high → bonus for unsuppressed, low → bonus for maintaining pressure
      const eSup = e._suppression ?? 0;
      td.score += (1 - eSup) * initiative * 0.12             // high initiative: seek active threats
               +  eSup * (1 - initiative) * 0.08;            // low initiative: keep pressure on pinned

      // 3. FORTIFIED (stance + stability) — courage: high → bonus for dug-in, low → bonus for exposed
      const fortified = (e._isProne ? 0.4 : 0) + (e._isHullDown ? 0.6 : 0);
      const eStab = e.stability ?? 0.5;
      const fortifiedScore = Math.min(1, fortified + eStab * 0.3);
      td.score += fortifiedScore * courage * 0.12             // brave: engage the dug-in threat
               +  (1 - fortifiedScore) * (1 - courage) * 0.10; // cautious: pick easy exposed target

      // 4. ENGAGEMENT STATE — initiative: high → bonus for unengaged, focus_fire overrides
      if (engagedCounts) {
        const engaged = engagedCounts.get(e.id) || 0;
        const unengaged = engaged === 0 ? 1 : 0;
        td.score += unengaged * initiative * 0.15;            // high initiative: distribute fire
      }

      // 5. SPOTTED CLARITY — discipline: high → bonus for clear, low → bonus for any
      const clarity = sEntry?.accuracy ?? 1.0;
      td.score += clarity * discipline * 0.10                 // disciplined: prefer clear targets
               +  (1 - discipline) * 0.04;                    // undisciplined: shoots at anything (flat bonus)

      // 6. ADVANCING ENEMY — aggression: high → bonus for chargers, low → bonus for static
      const eVelX = (e.x - (e._prevX ?? e.x));
      const eVelY = (e.y - (e._prevY ?? e.y));
      const toMeX = unit.x - e.x, toMeY = unit.y - e.y;
      const toMeDist = Math.sqrt(toMeX * toMeX + toMeY * toMeY) || 1;
      const approachDot = (eVelX * toMeX + eVelY * toMeY) / toMeDist; // positive = closing
      const advancing = approachDot > 1 ? 1 : approachDot > 0 ? approachDot : 0; // 0-1
      td.score += advancing * aggression * 0.12               // aggressive: engage the charger head-on
               +  (1 - advancing) * (1 - aggression) * 0.06; // cautious: prefer static targets you can aim at

      // 7. VULNERABILITY WINDOW — initiative: high → exploit cooldown, low → doesn't notice
      const now = Date.now();
      const sinceShot = now - (e.lastShot || 0);
      const eFireRate = e.fireRate || 2000;
      const inCooldown = sinceShot < eFireRate ? 1 : 0;
      td.score += inCooldown * initiative * 0.10;             // high initiative: exploit the opening

      // 8. ISOLATION — patience: high → bonus for loners, low → doesn't notice
      const nearbyAllies = hostiles.reduce((c, h) => {
        if (h === e || h.dead) return c;
        return distanceBetween(e, h) < 150 ? c + 1 : c;
      }, 0);
      const isolated = nearbyAllies === 0 ? 1 : nearbyAllies === 1 ? 0.5 : 0;
      td.score += isolated * patience * 0.12;                 // patient: finish the loner efficiently
    }

    td.factors = { dist: distScore, weak: weakScore, threat: threatScore, value: valueScore };

    if (td.score > bestScore) {
      bestScore = td.score;
      bestEntry = td;
    }
  }

  const chosen = bestEntry?.target || null;

  // Store winning score for hysteresis comparison
  unit._lastTargetScore = bestEntry?.score ?? 0;

  // Log target selection reasoning when target changes
  if (chosen) {
    const prevTarget = unit._dbg?.targetId;
    if (chosen.id !== prevTarget) {
      const logTeam = unit.team;
      const f = bestEntry.factors;
      const wStr = `w[d:${wDist.toFixed(1)} w:${wWeak.toFixed(1)} t:${wThreat.toFixed(1)} v:${wValue.toFixed(1)}]`;
      const fStr = `f[d:${f.dist.toFixed(2)} w:${f.weak.toFixed(2)} t:${f.threat.toFixed(2)} v:${f.value.toFixed(2)}]`;
      const sStr = `s[d:${statsMod.dDist.toFixed(2)} w:${statsMod.dWeak.toFixed(2)} t:${statsMod.dThreat.toFixed(2)} v:${statsMod.dValue.toFixed(2)}]`;
      logEvent(b, { t: Date.now(), who: unit.id, team: logTeam, type: 'decision',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: `chose ${chosen.id}`,
        detail: `score:${bestScore.toFixed(2)} ${wStr} ${sStr} ${fStr} hp:${chosen.hp}/${chosen.maxHp}` });
    }
  }
  return chosen;
}

/**
 * Quick-score an existing target for hysteresis comparison.
 * Uses the same weights as selectBrainTarget but only scores one target
 * against the same candidate pool for normalization.
 */
function _scoreExistingTarget(b, unit, target, hostiles, leader, command) {
  const spotted = unit._spotted;
  const alive = [];
  if (Array.isArray(spotted)) {
    for (const s of spotted) {
      if (s.enemy && !s.enemy.dead && s.enemy.hp > 0) alive.push(s.enemy);
    }
  } else {
    for (const e of hostiles) {
      if (!e.dead && e.hp > 0) alive.push(e);
    }
  }
  if (alive.length === 0) return 0;

  // Compute normalization bounds from all visible targets
  let maxDist = 0, maxDmg = 0, maxMaxHp = 0;
  for (const e of alive) {
    const dx = e.x - unit.x, dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) maxDist = dist;
    const dmg = e.damage || 10;
    if (dmg > maxDmg) maxDmg = dmg;
    const mhp = e.maxHp || 60;
    if (mhp > maxMaxHp) maxMaxHp = mhp;
  }
  if (maxDist < 1) maxDist = 1;
  if (maxDmg < 1) maxDmg = 1;
  if (maxMaxHp < 1) maxMaxHp = 1;

  // Resolve weights (mirrors selectBrainTarget weight logic)
  const p = unit.personality || {};
  const tgt = unit.targeting || {};
  let wDist = tgt.distance ?? 0.7, wWeak = tgt.weakness ?? 0.3;
  let wThreat = tgt.threat ?? 0.0, wValue = tgt.value ?? 0.0;
  const patience = p.patience ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;
  const initiative = p.initiative ?? 0.5;
  wWeak += (patience - 0.5) * 0.8;
  wDist += (aggression - 0.5) * 0.6;
  wThreat += (courage - 0.5) * 0.6;
  // (No arbitrary hash noise — personality-driven additive bias applied per-target below)
  if (command === Command.HOLD) wDist += 0.3;
  else if (command === Command.FALL_BACK) { wThreat += 0.3; wDist += 0.2; }
  else if (command === Command.COVER_ME) wThreat += 0.4;
  const statsMod = getStatsTargetingModifiers(unit);
  wDist = Math.max(0, wDist + statsMod.dDist);
  wWeak = Math.max(0, wWeak + statsMod.dWeak);
  wThreat = Math.max(0, wThreat + statsMod.dThreat);
  wValue = Math.max(0, wValue + statsMod.dValue);

  // Score the existing target
  const dx = target.x - unit.x, dy = target.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const distScore = 1.0 - (dist / (maxDist * 1.2));
  const weakScore = 1.0 - (target.hp / (target.maxHp || 1));
  const tdDmg = target.damage || 10;
  let threatScore = tdDmg / maxDmg;
  if (target._flankThreatBoost && Date.now() < target._flankThreatBoost) {
    threatScore = Math.min(1, threatScore + 0.5);
  }
  const valueScore = (target.maxHp || 60) / maxMaxHp;
  let score = distScore * wDist + weakScore * wWeak + threatScore * wThreat + valueScore * wValue;

  // Additive personality bias (mirrors selectBrainTarget)
  score += (aggression - 0.5) * distScore * 0.16
         + (patience - 0.5) * weakScore * 0.16
         + (courage - 0.5) * threatScore * 0.16;

  // DPS-scaled courage-gated bonuses (mirrors selectBrainTarget)
  const wSelfDefense = (1 - courage) * 0.5;
  const wAllyDefense = courage * 0.4;
  const enemyDpsRatio = tdDmg / maxDmg;
  const enemyTarget = target._currentTarget;
  if (enemyTarget === unit) {
    score += wSelfDefense * (0.5 + enemyDpsRatio * 0.5);
  } else if (enemyTarget && enemyTarget.team === unit.team && !enemyTarget.dead) {
    const allyHpRatio = enemyTarget.hp / (enemyTarget.maxHp || 1);
    const urgency = (1 - allyHpRatio) * 0.4 + enemyDpsRatio * 0.6;
    score += wAllyDefense * urgency;
  }

  return score;
}

/**
 * Spiral-search for the nearest passable cell and teleport the unit there.
 * Used as a safety net when a unit is terrain-stuck for too long.
 * Returns true if a valid position was found.
 */
function nudgeToPassable(b, unit, category) {
  for (let i = 1; i <= 24; i++) {
    const angle = i * 2.399; // Golden angle
    const dist = 20 + i * 15;
    const nx = unit.x + Math.cos(angle) * dist;
    const ny = unit.y + Math.sin(angle) * dist;
    if (nx < 0 || ny < 0 || nx > b.mapWidth || ny > b.mapHeight) continue;
    if (!isTerrainBlocked(b, nx, ny) && isTerrainPassable(b, nx, ny, category)) {
      unit.x = nx;
      unit.y = ny;
      return true;
    }
  }
  return false;
}

/**
 * Move unit toward a point with separation steering.
 * Returns true if arrived.
 */
function moveBrainUnit(b, unit, targetX, targetY, dtSec, allUnits, speedMult = 1.0) {
  // Prone/hull-down units cannot move
  if (unit._isProne || unit._isHullDown) return false;

  // A* path following — resolves long-distance targets to next waypoint
  const nav = resolveNavWaypoint(b, unit, targetX, targetY, inferCategory(unit));
  targetX = nav.x;
  targetY = nav.y;

  // Store previous position for bridge railing revert
  unit._prevX = unit.x;
  unit._prevY = unit.y;

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return true;

  const category = inferCategory(unit);
  const baseSpeed = unit._inFormation && unit._formationSpeed
    ? Math.min(unit.speed || 80, unit._formationSpeed)
    : (unit.speed || 80);
  const speed = baseSpeed * speedMult;
  const terrainMod = getTerrainSpeedMod(b, unit.x, unit.y);
  // Water depth speed modifier (category-aware)
  const waterMod = getWaterSpeedMod(b, unit.x, unit.y, category);
  // Suppression slows movement (max 40% penalty)
  const suppressionMod = 1 - (unit._suppression ?? 0) * 0.4;
  // Threat-based speed (personality-modulated)
  const threatMod = unit._moveCtx ? computeThreatSpeed(unit, unit._moveCtx) : 1.0;
  // Minimum 10% speed so units can always escape bad terrain (deep water, etc.)
  const finalSpeed = Math.max(speed * terrainMod * waterMod * suppressionMod * threatMod, speed * 0.1);

  let dirX = dx / dist;
  let dirY = dy / dist;

  // Separation steering — avoid overlapping friendlies
  const sep = calcSeparation(unit, allUnits, 40);
  dirX += sep.x * 0.5;
  dirY += sep.y * 0.5;

  // Water avoidance steering — nudge away from nearby water cells
  const waterNudge = calcWaterAvoidance(b, unit, dirX, dirY, category);
  dirX += waterNudge.x;
  dirY += waterNudge.y;

  // Map edge avoidance — push units out of the gradient fade zones (150px from edge)
  const edgeMargin = 150;
  const edgePush = 0.8;
  if (unit.x < edgeMargin) dirX += edgePush * (1 - unit.x / edgeMargin);
  else if (unit.x > b.mapWidth - edgeMargin) dirX -= edgePush * (1 - (b.mapWidth - unit.x) / edgeMargin);
  if (unit.y < edgeMargin) dirY += edgePush * (1 - unit.y / edgeMargin);
  else if (unit.y > b.mapHeight - edgeMargin) dirY -= edgePush * (1 - (b.mapHeight - unit.y) / edgeMargin);

  // Formation slot steering — bias toward assigned slot position
  // Formations are a suggestion: discipline controls nudge strength
  if (unit._inFormation && unit._slotTarget && unit !== unit._formationLeader) {
    const slotDx = unit._slotTarget.x - unit.x;
    const slotDy = unit._slotTarget.y - unit.y;
    const slotDist = Math.sqrt(slotDx * slotDx + slotDy * slotDy);
    if (slotDist > 5) {
      const discipline = unit.personality?.discipline ?? 0.5;
      // Strength ramps with distance: gentle near slot, stronger when far
      // Discipline scales from 0.15 (undisciplined) to 0.5 (very disciplined)
      const strength = (0.15 + discipline * 0.35) * Math.min(1.0, slotDist / 80);
      dirX += (slotDx / slotDist) * strength;
      dirY += (slotDy / slotDist) * strength;
    }
  }

  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLen > 0) { dirX /= dirLen; dirY /= dirLen; }

  // ── Movement model: free / tracked / wheeled ──────────────
  const model = MOVE_MODEL[category] ?? 'free';
  const desiredAngle = Math.atan2(dirY, dirX);
  let moveDirX = dirX;
  let moveDirY = dirY;
  let speedScale = 1;

  if (model === 'free') {
    // Infantry: move any direction, face hull toward movement direction
    turnHullToward(unit, desiredAngle, dtSec);
  } else {
    // Tracked / Wheeled: movement locked to hull facing
    const hullAng = unit.hullAngle ?? unit.angle;
    let angleDiff = desiredAngle - hullAng;
    if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    if (Math.abs(angleDiff) > REVERSE_THRESHOLD) {
      // Target is mostly behind — reverse instead of doing a full 180
      const reverseAngle = normalizeAngle(desiredAngle + Math.PI);
      turnHullToward(unit, reverseAngle, dtSec);
      moveDirX = -Math.cos(unit.hullAngle);
      moveDirY = -Math.sin(unit.hullAngle);
      speedScale = 0.5; // reverse is slower
    } else {
      // Rotate hull toward desired direction
      turnHullToward(unit, desiredAngle, dtSec);
      // Move along current hull facing
      moveDirX = Math.cos(unit.hullAngle);
      moveDirY = Math.sin(unit.hullAngle);
      // Speed penalty when hull isn't aligned yet
      const alignment = Math.cos(angleDiff); // 1 = aligned, 0 = 90°, -1 = opposite
      speedScale = Math.max(0.1, 1 - ALIGNMENT_PENALTY * (1 - Math.max(0, alignment)));
    }

    // Turning telemetry (throttled — only log when significantly misaligned)
    {
      const absDiff = Math.abs(angleDiff);
      const now = Date.now();
      const wasAligned = unit._wasHullAligned ?? true;
      const isAligned = absDiff < 0.15; // ~8.5°

      if (!isAligned && wasAligned) {
        // Started turning
        unit._turnStartTime = now;
        unit._turnStartAngle = absDiff;
      } else if (isAligned && !wasAligned && unit._turnStartTime) {
        // Finished turning — log the completed turn
        const elapsed = now - unit._turnStartTime;
        const turned = unit._turnStartAngle ?? absDiff;
        const logTeam = unit.team === 'red' ? 'red' : 'blue';
        logEvent(b, { t: now, who: unit.id, team: logTeam, type: 'turning',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: `turn_complete`,
          detail: `model:${model} turned:${Math.round(turned * 180 / Math.PI)}° in ${elapsed}ms spd:${Math.round(unit._currentSpeed)}` });
        unit._turnStartTime = null;
      }
      unit._wasHullAligned = isAligned;

      // Log reversals (once per reversal)
      if (Math.abs(angleDiff) > REVERSE_THRESHOLD && !unit._wasReversing) {
        const logTeam = unit.team === 'red' ? 'red' : 'blue';
        logEvent(b, { t: now, who: unit.id, team: logTeam, type: 'turning',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: 'reversing',
          detail: `model:${model} angleDiff:${Math.round(Math.abs(angleDiff) * 180 / Math.PI)}°` });
      }
      unit._wasReversing = Math.abs(angleDiff) > REVERSE_THRESHOLD;
    }
  }

  // Arrival deceleration — slow down when approaching target
  // Stopping distance scales with current speed and decel rate
  const combatStats = UNIT_COMBAT_STATS[unit.unitId];
  const accelFallback = ACCEL_RATE[category] || ACCEL_RATE[UnitCategory.INFANTRY];
  const unitAccel = combatStats?.accel ?? accelFallback.accel;
  const unitDecel = combatStats?.decel ?? accelFallback.decel;
  const stoppingDist = (unit.speed || 80) / unitDecel; // px needed to decelerate to 0
  let arrivalScale = 1.0;
  if (dist < stoppingDist * 2) {
    arrivalScale = Math.max(0.15, dist / (stoppingDist * 2));
  }

  // Acceleration/deceleration — exponential ease, per-unit power-to-weight
  const targetSpeed = finalSpeed * speedScale * arrivalScale;
  if (unit._currentSpeed == null) unit._currentSpeed = 0;
  const rate = targetSpeed >= unit._currentSpeed ? unitAccel : unitDecel;
  const blend = 1 - Math.exp(-rate * dtSec);
  unit._currentSpeed += (targetSpeed - unit._currentSpeed) * blend;

  const newX = unit.x + moveDirX * unit._currentSpeed * dtSec;
  const newY = unit.y + moveDirY * unit._currentSpeed * dtSec;

  // Axis-independent terrain blocking + water passability
  const xBlocked = isTerrainBlocked(b, newX, unit.y);
  const xImpass = !isTerrainPassable(b, newX, unit.y, category);
  const yBlocked = isTerrainBlocked(b, unit.x, newY);
  const yImpass = !isTerrainPassable(b, unit.x, newY, category);
  let xOk = !xBlocked && !xImpass;
  let yOk = !yBlocked && !yImpass;

  // Escape clause: if current position is ALREADY impassable (not hard-blocked),
  // allow movement so the unit can escape rather than being permanently trapped.
  // Only applies to soft impassability (deep water), not hard terrain blocks.
  if (!xOk && !yOk && !isTerrainBlocked(b, unit.x, unit.y)) {
    const currentlyTrapped = !isTerrainPassable(b, unit.x, unit.y, category);
    if (currentlyTrapped) {
      // Allow movement at reduced speed — unit is wading out of deep water
      xOk = !xBlocked;
      yOk = !yBlocked;
    }
  }

  if (xOk) unit.x = newX;
  if (yOk) unit.y = newY;

  // Both blocked — try perpendicular slide, then reverse, to escape
  if (!xOk && !yOk) {
    const slide = finalSpeed * dtSec * 0.5;
    let escaped = false;
    // Try perpendicular directions first
    const perpX = -moveDirY;
    const perpY = moveDirX;
    for (const sign of [1, -1]) {
      const sx = unit.x + perpX * slide * sign;
      const sy = unit.y + perpY * slide * sign;
      const sxOk = !isTerrainBlocked(b, sx, unit.y) && isTerrainPassable(b, sx, unit.y, category);
      const syOk = !isTerrainBlocked(b, unit.x, sy) && isTerrainPassable(b, unit.x, sy, category);
      if (sxOk || syOk) {
        if (sxOk) unit.x = sx;
        if (syOk) unit.y = sy;
        escaped = true;
        break;
      }
    }
    // Fallback: reverse direction (back away from obstacle)
    if (!escaped) {
      const rx = unit.x - moveDirX * slide;
      const ry = unit.y - moveDirY * slide;
      const rxOk = !isTerrainBlocked(b, rx, unit.y) && isTerrainPassable(b, rx, unit.y, category);
      const ryOk = !isTerrainBlocked(b, unit.x, ry) && isTerrainPassable(b, unit.x, ry, category);
      if (rxOk) unit.x = rx;
      if (ryOk) unit.y = ry;
    }
  }

  // Log when both axes are blocked (throttled to once per 5s)
  if (!xOk && !yOk) {
    const now = Date.now();
    if (!unit._lastMoveBlockLog || now - unit._lastMoveBlockLog > 5000) {
      unit._lastMoveBlockLog = now;
      const logTeam = unit.team;
      logEvent(b, {
        t: now, who: unit.id, team: logTeam, type: 'move_blocked',
        x: Math.round(unit.x), y: Math.round(unit.y),
        detail: `x:${xBlocked ? 'blocked' : xImpass ? 'impass' : 'ok'} y:${yBlocked ? 'blocked' : yImpass ? 'impass' : 'ok'} target:(${Math.round(targetX)},${Math.round(targetY)}) cat:${category}`
      });
    }
  }

  // Bridge elevation tracking — determine if unit is on/under/off bridge
  const bridges = b.terrainMap?.bridges;
  unit._bridgeElevation = queryBridgeEntry(
    bridges, unit._prevX ?? unit.x, unit._prevY ?? unit.y,
    unit.x, unit.y, unit._bridgeElevation
  );

  // Bridge railing — only enforced when unit is ON the bridge deck.
  // Under-bridge units pass freely through the railing zone.
  if (unit._bridgeElevation === 'on') {
    const prevBridge = bridges && queryBridge(bridges, unit._prevX ?? unit.x, unit._prevY ?? unit.y);
    if (prevBridge && queryBridgeRailing(bridges, unit.x, unit.y)) {
      // Try reverting X only
      if (!queryBridgeRailing(bridges, unit._prevX ?? unit.x, unit.y)) {
        unit.x = unit._prevX ?? unit.x;
      }
      // Try reverting Y only
      else if (!queryBridgeRailing(bridges, unit.x, unit._prevY ?? unit.y)) {
        unit.y = unit._prevY ?? unit.y;
      }
      // Both fail — nudge toward bridge centerline to escape railing
      else {
        const prevX = unit._prevX ?? unit.x;
        const prevY = unit._prevY ?? unit.y;
        unit.x = prevX;
        unit.y = prevY;
        const bDx = prevX - prevBridge.x;
        const bDy = prevY - prevBridge.y;
        const perpX = -prevBridge.dirY;
        const perpY = prevBridge.dirX;
        const projPerp = bDx * perpX + bDy * perpY;
        const nudgeStr = finalSpeed * dtSec * 0.5;
        const nudgeX = -Math.sign(projPerp) * perpX * nudgeStr;
        const nudgeY = -Math.sign(projPerp) * perpY * nudgeStr;
        const tryX = prevX + nudgeX;
        const tryY = prevY + nudgeY;
        if (!queryBridgeRailing(bridges, tryX, tryY) && queryBridge(bridges, tryX, tryY)) {
          unit.x = tryX;
          unit.y = tryY;
        }
      }
    }
  }

  // Clamp to map bounds (extended during staging to allow off-map positions)
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  const stagePad = b.stageDepth || 0;
  unit.x = Math.max(20, Math.min(mapW - 20, unit.x));
  unit.y = Math.max(-stagePad, Math.min(mapH + stagePad, unit.y));

  return false;
}

// ═══════════════════════════════════════════════════════════════
// COVER BIAS + BOUNDING MOVEMENT
// Cover bias = how much a unit prefers cover-to-cover movement.
// Bounding = advancing through intermediate cover waypoints.
// ═══════════════════════════════════════════════════════════════

// Category base cover bias — infantry loves cover, tanks don't care as much
const CATEGORY_COVER_BASE = {
  [UnitCategory.INFANTRY]:      0.5,
  [UnitCategory.LIGHT_VEHICLE]: 0.2,
  [UnitCategory.MEDIUM_TANK]:   0.3,
  [UnitCategory.HEAVY_TANK]:    0.15
};

// Command modifiers to cover bias
const COMMAND_COVER_MOD = {
  [Command.HOLD]:       0.3,
  [Command.COVER_ME]:   0.4,
  [Command.ADVANCE]:    0.0,
  [Command.FOLLOW]:     0.1,
  [Command.FALL_BACK]:  0.2,
  [Command.FOCUS_FIRE]: -0.1
};

/**
 * Compute how much this unit prefers cover-to-cover movement.
 * Returns 0-1. Higher = more cover-seeking. Cached per brain tick.
 */
function computeCoverBias(unit, command) {
  const p = unit.personality || {};
  const category = inferCategory(unit);
  const awareness = unit._awareness ?? 0.5;

  const base = CATEGORY_COVER_BASE[category] ?? 0.3;
  const cmdMod = COMMAND_COVER_MOD[command] ?? 0;

  const bias = base
    + (p.courage ?? 0.5)     * -0.15   // Brave = less cover need
    + (p.aggression ?? 0.5)  * -0.1    // Aggressive = close distance
    + (p.discipline ?? 0.5)  * 0.1     // Disciplined = methodical
    + (p.patience ?? 0.5)    * 0.1     // Patient = takes covered route
    + awareness              * 0.15    // Aware = finds cover better
    + cmdMod;

  return Math.max(0, Math.min(1, bias));
}

// ═══════════════════════════════════════════════════════════════
// SUPPRESSION SYSTEM
// Fire volume (even misses) pins units down. Decays over time.
// Discipline accelerates recovery. Cover provides psychological safety.
// ═══════════════════════════════════════════════════════════════

/**
 * Decay suppression per frame. Called early in updateBrain().
 * Base decay: 0.08/sec. Discipline bonus: +0.04 * discipline/sec.
 * In cover bonus: +0.03/sec.
 */
export function updateSuppression(unit, dtSec, b) {
  const sup = unit._suppression ?? 0;
  if (sup <= 0) return;

  const discipline = unit.personality?.discipline ?? 0.5;
  const inCover = (TERRAIN_COVER_SCORE[getTerrainAt(b, unit.x, unit.y)] || 0) >= 15;

  let decayRate = 0.08 + discipline * 0.04;
  if (inCover) decayRate += 0.03;

  unit._suppression = Math.max(0, sup - decayRate * dtSec);
}

/**
 * Apply suppression from an external event.
 * Called by game.js when projectiles pass nearby, explosions happen, allies die.
 */
export function applySuppression(unit, amount) {
  unit._suppression = Math.min(1, (unit._suppression ?? 0) + amount);
}

/**
 * Find the next cover waypoint between the unit and its objective.
 * Scans a forward arc (±60° from direction to objective) for cover cells.
 * Returns { x, y, score } or null if no cover found in the arc.
 */
function findNextCoverBound(b, unit, objX, objY, friendlies) {
  const cellSize = b.terrainMap?.cellSize || b.cellSize || 64;
  const coverBias = unit._coverBias ?? 0.3;

  // Direction to objective
  const dxObj = objX - unit.x;
  const dyObj = objY - unit.y;
  const distToObj = Math.sqrt(dxObj * dxObj + dyObj * dyObj);
  if (distToObj < cellSize) return null; // Already at objective

  const angleToObj = Math.atan2(dyObj, dxObj);

  // Search radius: 2-5 cells ahead, based on view range and cover bias
  const viewRange = unit.viewRange || 200;
  const searchDist = Math.min(viewRange * 0.6, distToObj); // Don't search past objective
  const searchCells = Math.ceil(searchDist / cellSize);
  const col = Math.floor(unit.x / cellSize);
  const row = Math.floor(unit.y / cellSize);

  let bestBound = null;
  let bestScore = -Infinity;

  for (let dr = -searchCells; dr <= searchCells; dr++) {
    for (let dc = -searchCells; dc <= searchCells; dc++) {
      if (dr === 0 && dc === 0) continue;
      const cx = (col + dc + 0.5) * cellSize;
      const cy = (row + dr + 0.5) * cellSize;

      // Must be passable
      if (isTerrainBlocked(b, cx, cy)) continue;

      const t = getTerrainAt(b, cx, cy);
      const coverScore = TERRAIN_COVER_SCORE[t] || 0;
      if (coverScore < 15) continue; // Only consider actual cover (brush+)

      // Angle from unit to this cell, relative to objective direction
      const dxCell = cx - unit.x;
      const dyCell = cy - unit.y;
      const cellDist = Math.sqrt(dxCell * dxCell + dyCell * dyCell);
      if (cellDist < cellSize * 0.5) continue; // Too close

      const angleToCell = Math.atan2(dyCell, dxCell);
      let angleDiff = angleToCell - angleToObj;
      // Normalize to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Forward arc: ±60° (±PI/3) widened slightly by coverBias
      const arcHalf = Math.PI / 3 + coverBias * (Math.PI / 6); // ±60° to ±90° based on bias
      if (Math.abs(angleDiff) > arcHalf) continue;

      // Score components:
      // 1. Forward progress (dot product with objective direction)
      const normalDx = dxObj / distToObj;
      const normalDy = dyObj / distToObj;
      const forwardProgress = (dxCell * normalDx + dyCell * normalDy) / cellDist;

      // 2. Cover quality (normalized 0-1)
      const coverQuality = Math.min(1, coverScore / 50);

      // 3. Distance sweet spot: prefer 60-150px ahead
      const idealMin = 60, idealMax = 150;
      let distScore;
      if (cellDist >= idealMin && cellDist <= idealMax) {
        distScore = 1.0;
      } else if (cellDist < idealMin) {
        distScore = cellDist / idealMin;
      } else {
        distScore = Math.max(0, 1.0 - (cellDist - idealMax) / idealMax);
      }

      // 4. Threat exposure: if enemies known, prefer cover that blocks LOS to them
      let threatScore = 0;
      if (unit._spotted && unit._spotted.length > 0) {
        let blocked = 0;
        const checks = Math.min(unit._spotted.length, 3); // Check top 3 threats
        for (let i = 0; i < checks; i++) {
          const enemy = unit._spotted[i].enemy;
          if (enemy && !enemy.dead) {
            if (!hasLineOfSight(b, cx, cy, enemy.x, enemy.y)) blocked++;
          }
        }
        threatScore = checks > 0 ? blocked / checks : 0;
      }

      // 5. Crowding penalty: avoid positions where friendlies already are or heading
      let crowdPenalty = 0;
      if (friendlies) {
        for (const f of friendlies) {
          if (f === unit || f.dead) continue;
          // Friendly already at this position
          const fdist = Math.hypot(cx - f.x, cy - f.y);
          if (fdist < cellSize * 1.5) crowdPenalty += 0.4;
          // Friendly bound target heading to same position
          if (f._boundTarget) {
            const bdist = Math.hypot(cx - f._boundTarget.x, cy - f._boundTarget.y);
            if (bdist < cellSize) crowdPenalty += 0.5;
          }
        }
      }

      // Weighted score — cover bias determines how much the unit deviates for cover
      const score = forwardProgress * (1.0 - coverBias * 0.5)   // Less weight on forward if high bias
                  + coverQuality   * (0.3 + coverBias * 0.4)    // More weight on cover quality if high bias
                  + distScore      * 0.3
                  + threatScore    * coverBias * 0.4
                  - crowdPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestBound = { x: cx, y: cy, score };
      }
    }
  }

  return bestBound;
}

/**
 * Bounding movement: advance cover-to-cover toward objective.
 * Called from command executors when unit is advancing and has coverBias > 0.2.
 * Returns true if unit is bounding (caller should not do additional movement).
 */
function boundingAdvance(b, unit, objX, objY, dtSec, friendlies, now) {
  const coverBias = unit._coverBias ?? 0;
  if (coverBias <= 0.2) return false; // Too low bias, just advance directly

  const p = unit.personality || {};
  const patience = p.patience ?? 0.5;

  // Check if we've arrived at current bound target
  if (unit._boundTarget) {
    const dist = Math.hypot(unit._boundTarget.x - unit.x, unit._boundTarget.y - unit.y);
    if (dist < 10) {
      // Arrived at bound — enter pause
      unit._boundPauseUntil = now + (500 + patience * 1500) * coverBias;
      unit._boundTarget = null;
      unit._actionVerb = 'bounding_hold';

      // Log arrival at cover
      logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'cover',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: 'bound reached', detail: `bias:${coverBias.toFixed(2)} pause:${Math.round((500 + patience * 1500) * coverBias)}ms` });
      return true;
    }

    // Still en route to bound target
    unit._actionVerb = 'bounding_advance';
    moveBrainUnit(b, unit, unit._boundTarget.x, unit._boundTarget.y, dtSec, friendlies);
    return true;
  }

  // Check if we're pausing at a bound
  if (unit._boundPauseUntil) {
    if (now < unit._boundPauseUntil) {
      unit._actionVerb = 'bounding_hold';
      return true; // Still pausing, scan & build stability
    }
    unit._boundPauseUntil = null; // Pause over, select next bound
  }

  // Select next bound toward objective
  const nextBound = findNextCoverBound(b, unit, objX, objY, friendlies);
  if (nextBound) {
    unit._boundTarget = nextBound;
    unit._actionVerb = 'bounding_advance';

    logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'cover',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: 'bound selected', target: `(${Math.round(nextBound.x)},${Math.round(nextBound.y)})`,
      detail: `bias:${coverBias.toFixed(2)} score:${nextBound.score.toFixed(2)}` });

    moveBrainUnit(b, unit, nextBound.x, nextBound.y, dtSec, friendlies);
    return true;
  }

  // No cover found — behavior depends on cover bias
  if (coverBias > 0.7) {
    // Very cautious: slow to 50% speed
    unit._actionVerb = 'advancing_cautious';
    moveBrainUnit(b, unit, objX, objY, dtSec, friendlies, 0.5);
    return true;
  }

  return false; // Low/mid bias, no cover found → advance normally
}

// ═══════════════════════════════════════════════════════════════
// FORMATION SYSTEM
// Sergeant → formation → individual AI.
// When in formation, units maintain slots relative to lead unit.
// When dispersed or no sergeant, fall back to individual behavior.
// ═══════════════════════════════════════════════════════════════

// Command → default formation mapping
const COMMAND_DEFAULT_FORMATION = {
  [Command.ADVANCE]:    Formation.WEDGE,
  [Command.HOLD]:       Formation.LINE,
  [Command.FALL_BACK]:  Formation.COLUMN,
  [Command.FOLLOW]:     Formation.COLUMN,
  [Command.COVER_ME]:   Formation.LINE,
  [Command.FOCUS_FIRE]: Formation.LINE
};

/**
 * Select the formation lead unit — highest awareness in the squad.
 * Commander can override by setting unit._isFormationLead = true.
 */
function selectFormationLead(friendlies) {
  // Check for manual override first
  const override = friendlies.find(u => !u.dead && u._isFormationLead);
  if (override) return override;

  // Composite score from stable base stats (no frame-to-frame fluctuation)
  let bestUnit = null;
  let bestScore = -1;
  for (const u of friendlies) {
    if (u.dead) continue;
    const leadership = u.leadership ?? 0;
    const veterancy = u.veterancy ?? 0;
    const awareness = u.awareness ?? 0.5;
    const score = leadership * 0.5 + veterancy * 0.3 + awareness * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestUnit = u;
    }
  }
  return bestUnit;
}

/**
 * Compute world position of a slot given its offset, leader, angle, spacing.
 * Used by assignFormationSlots for proximity matching.
 */
function slotWorldPos(offset, leader, formationAngle, spacingMult) {
  const [ox, oy] = offset;
  const sx = ox * spacingMult;
  const sy = oy * spacingMult;
  const cos = Math.cos(formationAngle + Math.PI / 2);
  const sin = Math.sin(formationAngle + Math.PI / 2);
  return { x: leader.x + sx * cos - sy * sin, y: leader.y + sx * sin + sy * cos };
}

/**
 * Assign formation slots to units. Leader always slot 0 (center per doctrine).
 * Doctrine groups (armor/infantry/support) determine which POOL of slots each
 * group gets. Within each pool, slots are assigned by proximity to minimize
 * travel distance and prevent cross-formation scrambling.
 * @param {Array} friendlies - All friendly units
 * @param {string} formationType - Formation key (wedge, line, etc.)
 * @param {object} leader - The formation lead unit
 * @param {string} terrain - Terrain type at leader's position
 * @param {number} formationAngle - Current formation facing angle
 * @param {number} spacingMult - Current spacing multiplier
 */
function assignFormationSlots(friendlies, formationType, leader, terrain, formationAngle, spacingMult) {
  const alive = friendlies.filter(u => !u.dead);
  if (alive.length === 0) return;

  // Categorize units for slot priority
  const armor = [];    // Tanks/vehicles
  const infantry = []; // Foot soldiers
  const support = [];  // Rear slots (medics, howitzers)

  for (const u of alive) {
    if (u === leader) continue; // Leader always slot 0
    const cat = inferCategory(u);
    const unitId = u.unitId || 'infantry';
    if (unitId === 'medic' || unitId === 'howitzer') {
      support.push(u);
    } else if (cat === UnitCategory.MEDIUM_TANK || cat === UnitCategory.HEAVY_TANK) {
      armor.push(u);
    } else {
      infantry.push(u);
    }
  }

  // Slot 0 = leader (center position per platoon doctrine)
  leader._formationSlot = 0;

  // Doctrine ordering: determines which group gets forward vs rear slots
  const restricted = terrain === 'forest' || terrain === 'brush';
  const groups = restricted
    ? [infantry, armor, support]
    : [armor, infantry, support];

  const offsets = FORMATION_OFFSETS[formationType] || FORMATION_OFFSETS.line;

  // Build pool of available slot indices (1 through N, since 0 = leader)
  let nextSlot = 1;

  for (const group of groups) {
    if (group.length === 0) continue;

    // Collect this group's slot pool (consecutive slots based on doctrine order)
    const slotPool = [];
    for (let i = 0; i < group.length; i++) {
      const idx = Math.min(nextSlot + i, offsets.length - 1);
      slotPool.push(idx);
    }

    // Compute world positions for each slot in the pool
    const slotPositions = slotPool.map(idx => ({
      idx,
      ...slotWorldPos(offsets[idx], leader, formationAngle, spacingMult)
    }));

    // Greedy proximity assignment: for each slot, find nearest unassigned unit
    const assigned = new Set();
    for (const slot of slotPositions) {
      let bestUnit = null;
      let bestDist = Infinity;
      for (const u of group) {
        if (assigned.has(u)) continue;
        const d = Math.hypot(slot.x - u.x, slot.y - u.y);
        if (d < bestDist) { bestDist = d; bestUnit = u; }
      }
      if (bestUnit) {
        bestUnit._formationSlot = slot.idx;
        assigned.add(bestUnit);
      }
    }

    nextSlot += group.length;
  }
}

/**
 * Compute the world position of a unit's assigned formation slot.
 * @param {object} unit - Unit with _formationSlot
 * @param {object} leader - Formation lead unit
 * @param {string} formationType - Formation key
 * @param {number} formationAngle - Direction the formation faces (radians)
 * @param {number} spacingMult - Spacing multiplier (discipline-based)
 * @returns {{ x: number, y: number }}
 */
function getFormationSlotTarget(unit, leader, formationType, formationAngle, spacingMult) {
  const offsets = FORMATION_OFFSETS[formationType] || FORMATION_OFFSETS.line;
  const slotIdx = unit._formationSlot ?? 0;
  const [ox, oy] = offsets[Math.min(slotIdx, offsets.length - 1)];

  // Scale by spacing multiplier (discipline affects tightness)
  const sx = ox * spacingMult;
  const sy = oy * spacingMult;

  // Rotate offset to match formation facing
  const cos = Math.cos(formationAngle + Math.PI / 2); // +90° so "forward" = toward angle
  const sin = Math.sin(formationAngle + Math.PI / 2);
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;

  return { x: leader.x + rx, y: leader.y + ry };
}

/**
 * Move unit toward its assigned formation slot.
 * Returns true if unit is close enough to its slot (within tolerance).
 * @param {object} b - Battle state
 * @param {object} unit - The unit to move
 * @param {{ x: number, y: number }} slotTarget - Target slot position
 * @param {number} dtSec - Frame delta
 * @param {Array} friendlies - For separation steering
 * @returns {boolean} true if within tolerance
 */
// maintainFormation removed — formation slots are now a steering nudge in moveBrainUnit

/**
 * Run formation logic for a team. Called once per frame per team.
 * Sets up leader, assigns slots, computes facing, and flags units as in-formation.
 * @param {object} b - Battle state
 * @param {Array} friendlies - All units on one team
 * @param {Array} hostiles - Enemy units (for facing determination)
 * @param {number} now - Current timestamp
 */
export function updateFormation(b, friendlies, hostiles, now) {
  const alive = friendlies.filter(u => !u.dead);
  if (alive.length < 2) {
    // Solo unit — no formation
    for (const u of alive) u._inFormation = false;
    return;
  }

  // Formation stress — personality-driven breaking (squad-scoped for multi-squad support)
  const teamKey = alive[0].team;
  const stateKey = alive[0]._squadId ?? teamKey;
  if (!b._formationStress) b._formationStress = {};
  let stress = b._formationStress[stateKey] ?? 0;

  // Stress sources
  const casualtyRatio = 1 - alive.length / friendlies.length;
  const casualtyStress = casualtyRatio * 0.6; // Up to 0.6 at total wipe

  const avgSuppression = alive.reduce((sum, u) => sum + (u._suppression ?? 0), 0) / alive.length;
  const suppressionStress = avgSuppression * 0.5;

  const currentLead = alive.find(u => u === u._formationLeader);
  const leaderStress = currentLead ? 0 : 0.4; // No leader = +0.4

  // Can't shoot back? Check if anyone has spotted targets
  const hasTargets = alive.some(u => (u._spotted?.length ?? 0) > 0);
  const blindStress = (!hasTargets && avgSuppression > 0.2) ? 0.2 : 0;

  const targetStress = casualtyStress + suppressionStress + leaderStress + blindStress;

  // Decay toward target (fast if rising, slow if falling)
  const avgDiscipline = alive.reduce((sum, u) => sum + (u.personality?.discipline ?? 0.5), 0) / alive.length;
  const dtSec = 1 / 60; // approximate frame time
  if (targetStress > stress) {
    stress += (targetStress - stress) * Math.min(1, dtSec * 2); // Rise fast
  } else {
    stress -= (stress - targetStress) * Math.min(1, dtSec * 0.05 * (1 + avgDiscipline)); // Decay slow
  }
  stress = Math.max(0, Math.min(1, stress));
  b._formationStress[stateKey] = stress;

  // Break threshold: disciplined teams hold longer
  const breakThreshold = 0.5 + avgDiscipline * 0.3;
  if (stress >= breakThreshold) {
    for (const u of alive) u._inFormation = false;
    const fs = b._formationState?.[stateKey];
    if (fs?.assigned) {
      logEvent(b, { t: now, who: alive[0].id, team: teamKey, type: 'formation',
        x: Math.round(alive[0].x), y: Math.round(alive[0].y),
        action: 'formation broken',
        detail: `stress:${stress.toFixed(2)} thresh:${breakThreshold.toFixed(2)} cas:${casualtyStress.toFixed(2)} sup:${suppressionStress.toFixed(2)} ldr:${leaderStress.toFixed(1)} blind:${blindStress.toFixed(1)}` });
      if (fs) fs.assigned = false;
    }
    return;
  }

  // Individual unit breaks (panic, high suppression + low discipline, critical HP)
  for (const u of alive) {
    if (u._panicking) {
      u._inFormation = false;
      continue;
    }
    const disc = u.personality?.discipline ?? 0.5;
    if ((u._suppression ?? 0) > 0.8 && disc < 0.4) {
      u._inFormation = false; // Pinned and undisciplined
      continue;
    }
    const crg = u.personality?.courage ?? 0.5;
    const criticalHp = 0.15 + crg * 0.15;
    if ((u.hp / (u.maxHp || 100)) < criticalHp) {
      u._inFormation = false; // Critically wounded
    }
  }

  // Get the team's formation type (from first unit's command default, or override)
  const firstAlive = alive[0];
  const command = firstAlive.command || Command.ADVANCE;
  const formationType = firstAlive._formationOverride
    || COMMAND_DEFAULT_FORMATION[command]
    || Formation.WEDGE;

  // Dispersed/spread = no formation
  if (formationType === Formation.SPREAD || formationType === 'dispersed') {
    for (const u of alive) u._inFormation = false;
    return;
  }

  // Select lead
  const leader = selectFormationLead(alive);
  if (!leader) {
    for (const u of alive) u._inFormation = false;
    return;
  }

  // teamKey already declared above in stress section
  const formationState = b._formationState = b._formationState || {};
  const teamState = formationState[stateKey] = formationState[stateKey] || {};

  const aliveCount = alive.length;
  const leaderTerrain = getTerrainAt(b, leader.x, leader.y);

  // Compute formation facing (needed BEFORE slot assignment for proximity matching)
  let formationAngle;
  if (command === Command.HOLD || command === Command.COVER_ME || command === Command.FOCUS_FIRE) {
    // Face nearest known threat
    let nearestThreat = null, nearDist = Infinity;
    for (const h of hostiles) {
      if (h.dead) continue;
      const d = distanceBetween(leader, h);
      if (d < nearDist) { nearDist = d; nearestThreat = h; }
    }
    formationAngle = nearestThreat
      ? Math.atan2(nearestThreat.y - leader.y, nearestThreat.x - leader.x)
      : leader.angle || 0;
  } else {
    // Face direction of movement — use waypoint direction (already updated by sergeant this
    // frame) instead of leader's facing angle, which may still point at the previous waypoint
    const wp = getSquadWaypoint(b, leader);
    if (wp) {
      formationAngle = Math.atan2(wp.y - leader.y, wp.x - leader.x);
    } else {
      formationAngle = leader.angle || 0;
    }
  }

  // Discipline affects spacing (high = tight, low = loose)
  // avgDiscipline already computed above in stress section
  const spacingMult = 0.8 + (1 - avgDiscipline) * 0.6; // 0.8x (high disc) to 1.4x (low)

  // Terrain spacing modifier
  if (leaderTerrain === 'forest') {
    formationState[stateKey].spacingMult = spacingMult * 1.5;
  } else {
    formationState[stateKey].spacingMult = spacingMult;
  }
  const finalSpacing = formationState[stateKey].spacingMult;

  // Assign slots (only reassign periodically or when composition changes)
  if (teamState.leader !== leader.id || teamState.count !== aliveCount
      || teamState.formation !== formationType || !teamState.assigned) {
    assignFormationSlots(alive, formationType, leader, leaderTerrain, formationAngle, finalSpacing);
    teamState.leader = leader.id;
    teamState.count = aliveCount;
    teamState.formation = formationType;
    teamState.assigned = true;

    // Log formation change with slot assignments
    {
      const offsets = FORMATION_OFFSETS[formationType] || FORMATION_OFFSETS.line;
      const slotDetails = alive.filter(u => u !== leader).map(u => {
        const pos = slotWorldPos(offsets[Math.min(u._formationSlot, offsets.length - 1)], leader, formationAngle, finalSpacing);
        return `${u.id}→s${u._formationSlot}(${Math.round(pos.x)},${Math.round(pos.y)}) d=${Math.round(Math.hypot(pos.x - u.x, pos.y - u.y))}`;
      }).join(' ');
      logEvent(b, { t: now, who: leader.id, team: teamKey, type: 'formation',
        x: Math.round(leader.x), y: Math.round(leader.y),
        action: `formation: ${formationType}`,
        detail: `lead:${leader.id} units:${aliveCount} ang:${Math.round(formationAngle * 180 / Math.PI)}° spc:${finalSpacing.toFixed(2)} | ${slotDetails}` });
    }
  }

  // Compute formation speed — match the slowest unit
  let slowestSpeed = Infinity;
  for (const u of alive) {
    const spd = u.speed || u.spd || 60;
    if (spd < slowestSpeed) slowestSpeed = spd;
  }

  // Store formation data on each unit
  for (const u of alive) {
    u._inFormation = true;
    u._formationLeader = leader;
    u._formationType = formationType;
    u._formationAngle = formationAngle;
    u._formationSpacing = finalSpacing;
    u._formationSpeed = slowestSpeed;

    // Compute slot target position
    if (u !== leader) {
      u._slotTarget = getFormationSlotTarget(u, leader, formationType, formationAngle, finalSpacing);
    } else {
      u._slotTarget = null; // Leader moves freely
    }
  }

  // Periodic formation telemetry (every 4 seconds)
  if (now - (teamState.lastTelemetry || 0) > 4000) {
    teamState.lastTelemetry = now;
    const followers = alive.filter(u => u !== leader && u._slotTarget);
    const maxDev = followers.reduce((mx, f) => Math.max(mx, Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y)), 0);
    const avgDev = followers.length > 0 ? followers.reduce((s, f) => s + Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y), 0) / followers.length : 0;
    const xSpread = alive.length > 1 ? Math.max(...alive.map(u => u.x)) - Math.min(...alive.map(u => u.x)) : 0;
    const devList = followers.map(f => `${f.id}:${Math.round(Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y))}`).join(' ');
    logEvent(b, { t: now, who: leader.id, team: teamKey, type: 'formation',
      x: Math.round(leader.x), y: Math.round(leader.y),
      action: 'formation_state',
      detail: `maxDev:${Math.round(maxDev)} avgDev:${Math.round(avgDev)} xSpd:${Math.round(xSpread)} ang:${Math.round(formationAngle * 180 / Math.PI)}° | ${devList}` });
  }
}

// ═══════════════════════════════════════════════════════════════
// FIRE PAUSE — Units halt to stabilize before firing
// Patient/disciplined units pause movement to let stability build.
// Returns true if the unit should halt (skip movement this frame).
// ═══════════════════════════════════════════════════════════════
function shouldHaltToFire(unit, target, targetDist, range) {
  if (!target || target.dead) {
    unit._haltingToFire = false;
    unit._aimWindowUntil = 0;
    return false;
  }
  if (targetDist > range * 1.1) return false;

  const p = unit.personality || {};
  const discipline = p.discipline ?? 0.5;
  const courage = p.courage ?? 0.5;
  const patience = p.patience ?? 0.5;
  const initiative = p.initiative ?? 0.5;
  const now = Date.now();

  // Initiative: don't halt if target is retreating (chase instead)
  if (initiative > 0.4 && target._actionVerb === 'falling_back') {
    // Roll: high initiative = more likely to chase
    if (Math.random() < initiative * 0.8) {
      unit._haltingToFire = false;
      unit._aimWindowUntil = 0;
      return false;
    }
  }

  // Courage: determines preferred halt range
  // Courageous units push to close range before stopping (40-70% of max range)
  // Cautious units halt at max range (80-100% of max range)
  const haltRangeRatio = 0.4 + (1 - courage) * 0.6; // courage 1→0.4, courage 0→1.0
  const preferredHaltDist = range * haltRangeRatio;
  // Don't halt if we're farther than preferred halt distance (keep advancing)
  if (targetDist > preferredHaltDist && !unit._haltingToFire) return false;

  // Already in aim window — stay halted until it expires
  if (unit._aimWindowUntil && now < unit._aimWindowUntil) {
    return true;
  }

  // Aim window expired — resume movement with cooldown
  if (unit._aimWindowUntil && now >= unit._aimWindowUntil) {
    unit._haltingToFire = false;
    unit._aimWindowUntil = 0;
    // Cooldown before next halt: courageous units resume faster (want to close)
    // Patient units pause longer between advances
    const cooldown = 800 + courage * 800 + (1 - patience) * 600;
    unit._nextHaltAllowed = now + cooldown;
    return false;
  }

  // Cooldown active — keep moving
  if (unit._nextHaltAllowed && now < unit._nextHaltAllowed) return false;

  // Already halting, waiting for stability
  if (unit._haltingToFire) {
    const minStab = discipline * 0.4 + patience * 0.2;
    if ((unit.stability ?? 0) >= minStab) {
      // Stability reached — open aim window
      // Patience controls duration: 1.2-3.5s (2-4 aimed shots)
      const windowMs = 1200 + patience * 2300;
      unit._aimWindowUntil = now + windowMs;
    }
    return true;
  }

  // Discipline roll: decide whether to halt
  // High discipline = almost always halts. Low = rarely.
  if (Math.random() < discipline) {
    unit._haltingToFire = true;
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// MOVEMENT MODE EXECUTION
// Scoring + resolution imported from movement-modes.js.
// Execute functions stay here — they call moveBrainUnit, tryShoot, etc.
// ═══════════════════════════════════════════════════════════════

// buildMovementContext, scoring functions, and resolveMovementMode
// are now in movement-modes.js

/**
 * Execute the winning movement mode. Only this function calls moveBrainUnit().
 * Firing is handled independently — all modes can fire at targets.
 */
function executeMovementMode(b, unit, modeResult, ctx, range, speed, now, dtSec, friendlies) {
  const { mode } = modeResult;
  // Track mode start time for minimum duration cooldown
  if (mode !== unit._movementMode) {
    unit._movementModeStart = Date.now();
  }
  unit._movementMode = mode;

  // Clear cover latch when a different mode wins
  if (mode !== MovementMode.URGENT_COVER) {
    unit._coverTarget = null;
  }

  // Clear orphaned hidden/LOS-break latch when no longer in survival
  if (mode !== MovementMode.SURVIVAL_ACTION && unit._losBreakArrived) {
    unit._losBreakArrived = false;
    unit._losBreakArriveTime = null;
    unit._losBreakTarget = null;
    unit._isProne = false;
  }

  switch (mode) {
    case MovementMode.PANIC_FLEE:
      executePanicFlee(b, unit, ctx, speed, dtSec, friendlies);
      break;

    case MovementMode.URGENT_COVER:
      executeUrgentCover(b, unit, ctx, range, now, dtSec, friendlies);
      break;

    case MovementMode.SURVIVAL_ACTION: {
      const survival = unit._lastSurvival;
      if (survival) {
        const didAct = executeSurvivalAction(b, unit, ctx.target, ctx.targetDist, range, survival, now, dtSec, friendlies);
        if (!didAct) {
          // Survival scored high but action failed — fall back to command
          executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies);
        }
      } else {
        executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies);
      }
      break;
    }

    case MovementMode.TACTICAL_BOUND:
      executeTacticalBound(b, unit, ctx, range, speed, now, dtSec, friendlies);
      break;

    case MovementMode.COMMAND_EXECUTE:
      executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies);
      break;

    case MovementMode.REGROUP:
      executeRegroupMode(b, unit, ctx, range, now, dtSec, friendlies);
      break;

    default:
      executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies);
  }

  // Independent firing — all modes can fire at spotted targets
  // (some modes handle their own firing internally, e.g. survival actions)
  // Command executors and formation mode handle firing themselves
}

/**
 * Resolve retreat objective based on personality.
 * Aggressive/courageous units push toward enemy base and dig in.
 * Cautious/disciplined units fall back to own base.
 * Cached per retreat episode — recalculated when command changes.
 * @returns {{ x: number, y: number }}
 */
function resolveRetreatObjective(b, unit) {
  // Cache: reuse same objective while retreating (no flip-flopping)
  if (unit._retreatObjective && unit._retreatCmd === (unit.command || 'advance')) {
    return unit._retreatObjective;
  }

  const p = unit.personality || {};
  const aggression = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;

  // Personality score: high = aggressive retreat (push forward, dig in at enemy base)
  const pushScore = aggression * 0.5 + courage * 0.5;
  const isBlue = unit.team === Team.BLUE;
  let obj;

  if (pushScore > 0.6) {
    // Aggressive retreat — advance to enemy base and dig in
    const enemyZone = isBlue ? b.redSpawnZone : b.blueSpawnZone;
    if (enemyZone) {
      obj = { x: enemyZone.x, y: enemyZone.y };
    } else {
      const mapW = b.mapWidth || 2000;
      obj = { x: isBlue ? mapW - 100 : 100, y: unit.y };
    }
  } else {
    // Defensive retreat — fall back to own base
    const ownZone = isBlue ? b.blueSpawnZone : b.redSpawnZone;
    if (ownZone) {
      obj = { x: ownZone.x, y: ownZone.y };
    } else {
      const mapW = b.mapWidth || 2000;
      obj = { x: isBlue ? 100 : mapW - 100, y: unit.y };
    }
  }

  unit._retreatObjective = obj;
  unit._retreatCmd = unit.command || 'advance';
  return obj;
}

/**
 * SHARED RETREAT SYSTEM — used by panic flee, fall_back, and survival actions.
 * Three outcomes based on personality:
 *   1. Find cover — scan for terrain cover away from threat, dig in, fight
 *   2. Charge — brave unit turns and rushes the threat (last stand)
 *   3. Break — cowardly unit actively evades, bounds away from threat around the map
 */

/**
 * Find a retreat position away from a threat, clamped to map bounds.
 * Scans for terrain cover in the direction away from the threat.
 * Returns { x, y, type } where type is 'cover', 'charge', or 'break'.
 *
 * @param {object} b - Battle state
 * @param {object} unit - The retreating unit
 * @param {object|null} threat - The threat position { x, y } or null
 * @returns {{ x: number, y: number, type: string }}
 */
function findRetreatPosition(b, unit, threat) {
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  const margin = 80;
  const courage = unit.personality?.courage ?? 0.5;
  const cellSize = b.terrainMap?.cellSize || b.cellSize || 64;

  // Direction away from threat (or toward map center if no threat)
  let awayX, awayY;
  if (threat) {
    const dx = unit.x - threat.x;
    const dy = unit.y - threat.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    awayX = dx / d;
    awayY = dy / d;
  } else {
    // No threat — head toward map center
    const cx = mapW / 2 - unit.x;
    const cy = mapH / 2 - unit.y;
    const d = Math.sqrt(cx * cx + cy * cy) || 1;
    awayX = cx / d;
    awayY = cy / d;
  }

  // 1. Scan for terrain cover away from threat (not toward map edges)
  let bestCover = null;
  let bestScore = -1;
  const baseAngle = Math.atan2(awayY, awayX);

  for (let r = 2; r <= 6; r++) {
    for (let a = -3; a <= 3; a++) {
      const angle = baseAngle + a * 0.35;
      const px = unit.x + Math.cos(angle) * r * cellSize;
      const py = unit.y + Math.sin(angle) * r * cellSize;
      // Must be well inside map bounds
      if (px < margin || py < margin || px > mapW - margin || py > mapH - margin) continue;
      if (isTerrainBlocked(b, px, py)) continue;
      const terrain = getTerrainAt(b, px, py);
      const cover = TERRAIN_COVER_SCORE[terrain] || 0;
      if (cover < 10) continue;
      // Prefer positions that are away from edges
      const edgeDist = Math.min(px, py, mapW - px, mapH - py);
      const score = cover + edgeDist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestCover = { x: px, y: py };
      }
    }
  }

  if (bestCover) {
    return { ...bestCover, type: 'cover' };
  }

  // 2. No cover found — personality decides
  if (courage > 0.5 && threat) {
    // Charge the threat
    return { x: threat.x, y: threat.y, type: 'charge' };
  }

  // 3. Break — pick a bound point perpendicular to the threat, away from edges
  // Like SEARCH but inverted — bound away from known threat position
  const perpAngle = baseAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
  const breakDist = 150 + Math.random() * 200;
  let breakX = unit.x + Math.cos(perpAngle) * breakDist;
  let breakY = unit.y + Math.sin(perpAngle) * breakDist;
  // Clamp and push away from edges
  breakX = Math.max(margin, Math.min(mapW - margin, breakX));
  breakY = Math.max(margin, Math.min(mapH - margin, breakY));
  return { x: breakX, y: breakY, type: 'break' };
}

/**
 * PANIC_FLEE — flee from threat using shared retreat system.
 * Finds cover, charges, or breaks depending on personality and terrain.
 * Recovers from panic when arriving at a defensible position.
 */
function executePanicFlee(b, unit, ctx, speed, dtSec, friendlies) {
  unit._actionVerb = 'panicking';

  // Compute retreat destination (cached until arrived or invalid)
  if (!unit._panicFleeTarget) {
    const threat = ctx.target;
    const retreat = findRetreatPosition(b, unit, threat);
    unit._panicFleeTarget = retreat;
    unit._panicBreakCount = (unit._panicBreakCount || 0) + (retreat.type === 'break' ? 1 : 0);

    if (retreat.type === 'charge') {
      unit._panicCharging = true;
    }
  }

  const target = unit._panicFleeTarget;
  const arrived = moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);

  // Arrived at retreat position — resolve based on type
  if (arrived || distanceBetween(unit, target) < 30) {
    if (target.type === 'cover') {
      // Found cover — recover from panic, fight from here
      unit._panicking = false;
      unit._panicFleeTarget = null;
      unit._panicCharging = false;
      unit._panicBreakCount = 0;
      unit.morale = Math.max(unit.morale, 0.25);
    } else if (target.type === 'charge') {
      // Charging — keep going (will resolve via normal combat)
      unit._panicking = false;
      unit._panicFleeTarget = null;
      unit._panicCharging = false;
      unit._panicBreakCount = 0;
      unit.morale = Math.max(unit.morale, 0.3);
    } else {
      // Break — pick a new bound point, keep evading
      unit._panicFleeTarget = null; // Will recompute next frame
      // After 3 break loops, stop panicking — nowhere to go, fight from here
      if (unit._panicBreakCount >= 3) {
        unit._panicking = false;
        unit._panicBreakCount = 0;
        unit.morale = Math.max(unit.morale, 0.20);
      }
    }
  }
}

/**
 * URGENT_COVER — rush to nearest cover at normal speed. Fire while rushing scales
 * with aggression (high = shoots while moving, low = just runs).
 * Uses A* pathfinding to validate cover reachability and navigate around obstacles.
 * No-cover behavior by unit type: infantry→prone, vehicle→park behind concealment,
 * tank→hull-down + fire at target.
 */
function executeUrgentCover(b, unit, ctx, range, now, dtSec, friendlies) {
  // Determine cover destination — use latched target if still valid, otherwise find new
  // After a cover target is abandoned (stuck), cooldown 5s before trying a new one
  let coverPos = unit._coverTarget;
  if (!coverPos && ctx.nearestCover && (!unit._coverFailedUntil || now > unit._coverFailedUntil)) {
    const candidate = { x: ctx.nearestCover.x, y: ctx.nearestCover.y };
    // A* validate: ensure a path exists to the cover position
    const category = inferCategory(unit);
    const catKey = category === UnitCategory.INFANTRY ? 'infantry'
      : category === UnitCategory.LIGHT_VEHICLE ? 'light_vehicle' : 'vehicle';
    const path = findPathWorld(b, unit.x, unit.y, candidate.x, candidate.y, {
      category: catKey, maxIterations: 2000
    });
    if (path && path.length > 0) {
      coverPos = candidate;
      unit._coverTarget = coverPos;
      unit._coverPath = path;
      unit._coverPathIndex = 0;
      unit._coverStuckTime = 0;
    } else {
      // Unreachable — cooldown before retrying
      unit._coverFailedUntil = now + 5000;
    }
  }

  const category = inferCategory(unit);
  const aggression = unit.personality?.aggression ?? 0.5;

  if (coverPos && unit._coverPath && unit._coverPath.length > 0) {
    // Must clear prone/hull-down so moveBrainUnit actually moves
    unit._isProne = false;
    unit._isHullDown = false;

    // Follow A* path waypoint-by-waypoint
    const pathIdx = unit._coverPathIndex || 0;
    const waypoint = unit._coverPath[Math.min(pathIdx, unit._coverPath.length - 1)];

    const prevX = unit.x, prevY = unit.y;
    const atWaypoint = moveBrainUnit(b, unit, waypoint.x, waypoint.y, dtSec, friendlies);

    // Advance to next waypoint when close
    if (atWaypoint || distanceBetween(unit, waypoint) < 16) {
      if (pathIdx < unit._coverPath.length - 1) {
        unit._coverPathIndex = pathIdx + 1;
      } else {
        // Arrived at final cover position — release latch
        unit._coverTarget = null;
        unit._coverPath = null;
        unit._coverPathIndex = 0;
        unit._coverStuckTime = 0;
        unit._actionVerb = 'in_cover';
      }
    }

    if (unit._coverTarget) {
      unit._actionVerb = 'rushing_to_cover';
      // Track stuck time — if unit didn't move, accumulate
      const moved = Math.hypot(unit.x - prevX, unit.y - prevY) > 1;
      if (!moved) {
        unit._coverStuckTime = (unit._coverStuckTime || 0) + dtSec;
      } else {
        unit._coverStuckTime = 0;
      }
    }

    // Fire while rushing — aggression scales probability (continuous)
    if (ctx.target && ctx.targetDist <= range * 1.1 && Math.random() < aggression * 0.5) {
      turnUnitToward(unit, Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x), dtSec);
      tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
    }
  } else {
    // No cover available or path invalid — unit-type specific behavior
    unit._coverTarget = null;
    unit._coverPath = null;
    const skills = CATEGORY_SKILLS[category] || {};

    if (skills.canGoProne) {
      // Infantry: go prone
      unit._isProne = true;
      unit._actionVerb = 'prone';
    } else if (skills.canHullDown) {
      // Tank: hull-down + fire at target
      unit._isHullDown = true;
      unit._actionVerb = 'hull_down';
      if (ctx.target && ctx.targetDist <= range * 1.1) {
        turnUnitToward(unit, Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x), dtSec);
        tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
      }
    } else {
      // Light vehicle: exposed, fire if able
      unit._actionVerb = 'exposed';
      if (ctx.target && ctx.targetDist <= range * 1.1) {
        turnUnitToward(unit, Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x), dtSec);
        tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
      }
    }
  }
}

/**
 * TACTICAL_BOUND — cover-to-cover advance using bounding system
 */
function executeTacticalBound(b, unit, ctx, range, speed, now, dtSec, friendlies) {
  const activeCommand = ctx.command;
  // Determine objective based on command
  let objX, objY;
  if (ctx.target) {
    objX = ctx.target.x;
    objY = ctx.target.y;
  } else {
    // No target — advance toward sergeant waypoint or enemy base
    const wp = getSquadWaypoint(b, unit);
    if (wp) {
      objX = wp.x; objY = wp.y;
    } else {
      const enemyZone = unit.team === Team.RED ? b.blueSpawnZone : b.redSpawnZone;
      if (enemyZone) {
        objX = enemyZone.x; objY = enemyZone.y;
      } else {
        const mapW = b.mapWidth || 2000;
        const mapH = b.mapHeight || 2000;
        objX = mapW / 2;
        objY = unit.team === Team.RED ? mapH - 128 : 128;
      }
    }
  }

  const bounded = boundingAdvance(b, unit, objX, objY, dtSec, friendlies, now);
  if (!bounded) {
    // Bounding returned false (no cover found) — fall back to command
    executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies);
    return;
  }

  // Fire while bounding (between bounds)
  if (ctx.target && ctx.targetDist <= range) {
    turnUnitToward(unit, Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x), dtSec);
    tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
  }
}

/**
 * COMMAND_EXECUTE — directly execute the active command
 */
function executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;

  // Cover hold: unit arrived at cover and is holding position until safe
  // Override any movement command with hold behavior
  if (unit._coverHolding) {
    unit._actionVerb = 'cover_hold';
    executeHold(b, unit, ctx.target, ctx.targetDist, range, now, dtSec, friendlies);
    return;
  }

  const activeCommand = ctx.command;
  switch (activeCommand) {
    case Command.HOLD:
      executeHold(b, unit, ctx.target, ctx.targetDist, range, now, dtSec, friendlies);
      break;
    case Command.ADVANCE:
      executeAdvance(b, unit, ctx.target, ctx.targetDist, range, speed, now, dtSec, friendlies);
      break;
    case Command.FOLLOW:
      executeFollow(b, unit, ctx.leader, ctx.target, ctx.targetDist, range, speed, now, dtSec, friendlies);
      break;
    case Command.FALL_BACK:
      executeFallBack(b, unit, ctx.target, ctx.targetDist, range, speed, now, dtSec, friendlies);
      break;
    case Command.COVER_ME:
      executeCoverMe(b, unit, ctx.leader, ctx.target, ctx.targetDist, range, now, dtSec, friendlies);
      break;
    case Command.FOCUS_FIRE:
      executeFocusFire(b, unit, ctx.target, ctx.targetDist, range, speed, now, dtSec, friendlies);
      break;
    default:
      executeAdvance(b, unit, ctx.target, ctx.targetDist, range, speed, now, dtSec, friendlies);
  }
}

/**
 * REGROUP — fall back toward nearest ally. If no ally, move to sergeant waypoint
 * or own spawn zone as fallback.
 */
function executeRegroupMode(b, unit, ctx, range, now, dtSec, friendlies) {
  unit._actionVerb = 'regrouping';

  if (ctx.nearestAlly) {
    moveBrainUnit(b, unit, ctx.nearestAlly.x, ctx.nearestAlly.y, dtSec, friendlies, 0.9);
  } else {
    // No ally nearby — fall back to sergeant waypoint or own spawn
    const wp = getSquadWaypoint(b, unit);
    const isBlue = unit.team === Team.BLUE;
    const ownZone = isBlue ? b.blueSpawnZone : b.redSpawnZone;

    if (wp) {
      moveBrainUnit(b, unit, wp.x, wp.y, dtSec, friendlies, 0.9);
    } else if (ownZone) {
      moveBrainUnit(b, unit, ownZone.x, ownZone.y, dtSec, friendlies, 0.9);
    }
  }

  // Fire while regrouping
  if (ctx.target && ctx.targetDist <= range) {
    turnUnitToward(unit, Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x), dtSec);
    tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMAND EXECUTORS
// Each implements a specific command. Stats + personality shape HOW.
// ═══════════════════════════════════════════════════════════════

/**
 * HOLD — Defend current position. Fire at visible enemies. Don't advance unless needed.
 * Unit-type behavior: infantry→prone, tank→hull-down, vehicle→park behind cover.
 * Personality: aggression > discipline → push up to help squad. Otherwise hold + watch flank.
 */
function executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies) {
  unit._actionVerb = 'holding';
  const p = unit.personality || {};
  const patience = p.patience ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const discipline = p.discipline ?? 0.5;
  const engageDist = range * (0.6 + patience * 0.6);
  const category = inferCategory(unit);

  if (target) {
    // Always face target
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);

    // Bridge-blocked target: can't shoot through bridge, don't advance toward it.
    // Hold position and wait — HOLD means hold.
    if (unit._targetBridgeBlocked) {
      // tryShoot will fail (bridge gate), so just hold and face target
      return;
    }

    // Always try to fire — shouldFire() handles range gating + stability + acquisition
    if (tryShoot(b, unit, target.x, target.y, now, target)) {
      unit._actionVerb = 'firing';
      unit._haltingToFire = false;
    }

    // Check actual damage effectiveness, not just raw range
    const falloff = getDamageFalloff(targetDist, range);

    if (falloff >= 0.5) {
      // In effective range — hold and fire (doing meaningful damage)
      // Halt to stabilize if needed
      if (shouldHaltToFire(unit, target, targetDist, range)) {
        unit._actionVerb = 'aiming';
      }
    } else if (falloff > 0) {
      // In weapon reach but ineffective (falloff < 0.5) — advance to effective range
      const d = targetDist || 1;
      const desiredDist = range * 0.7; // target 70% of range where falloff = 1.0
      const moveX = target.x + ((unit.x - target.x) / d) * desiredDist;
      const moveY = target.y + ((unit.y - target.y) / d) * desiredDist;
      moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies);
      unit._actionVerb = 'closing_to_fire';
    } else if (targetDist <= engageDist) {
      // Out of range but closeable — move to engagement distance
      const d = targetDist || 1;
      const desiredDist = range * 0.7;
      const moveX = target.x + ((unit.x - target.x) / d) * desiredDist;
      const moveY = target.y + ((unit.y - target.y) / d) * desiredDist;
      moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies);
      unit._actionVerb = 'closing_to_fire';
    } else {
      // Target beyond engagement distance — push up to weapon range
      const courage = p.courage ?? 0.5;

      if (unit._pushingUp) {
        if (falloff >= 0.5) {
          // Goal achieved — in effective range
          unit._pushingUp = false;
        } else if (!target || target.dead) {
          unit._pushingUp = false;
        } else if ((unit._shockTimer ?? 0) > 0 && courage < 0.4) {
          unit._pushingUp = false;
        } else {
          moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
          unit._actionVerb = 'pushing_up';
        }
      } else {
        unit._pushingUp = true;
        moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
        unit._actionVerb = 'pushing_up';
      }
    }
  } else {
    // No target — dig in per unit type
    const spotted = unit._spotted || [];
    if (spotted.length > 0) {
      // Enemies spotted but not targeted — face nearest threat
      const nearest = spotted[0]?.enemy;
      if (nearest && !nearest.dead) {
        turnUnitToward(unit, Math.atan2(nearest.y - unit.y, nearest.x - unit.x), dtSec);
        // Try to fire at spotted enemies (pipeline handles range gating)
        tryShoot(b, unit, nearest.x, nearest.y, now, nearest);
      }
    }

    // Dig in based on unit type (cover-seeking system handles finding cover)
    if (category === UnitCategory.INFANTRY) {
      if (!unit._isProne) {
        unit._isProne = true;
        unit._actionVerb = 'digging_in';
      }
    } else if (category === UnitCategory.MEDIUM_TANK || category === UnitCategory.HEAVY_TANK) {
      if (!unit._isHullDown) {
        unit._isHullDown = true;
        unit._actionVerb = 'hull_down';
      }
    }
    // Light vehicles: cover-seeking system parks them behind concealment
  }
}

/**
 * ADVANCE — Push toward objective. Engage enemies along the way.
 * Personality: patience→engagement distance, aggression→hold distance,
 * initiative→flanking aggressiveness (continuous scaling, no hard thresholds).
 */
function executeAdvance(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  // Clear prone/hull-down — advancing means moving
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'advancing';
  const p = unit.personality || {};

  // Engagement distance: patient units engage further, impatient push close
  const engageDist = range * (0.6 + (p.patience || 0.5) * 0.6);

  if (!target) {
    // No target — advance toward sergeant waypoint or enemy base
    const wp = getSquadWaypoint(b, unit);
    let cx, cy;
    if (wp) {
      cx = wp.x; cy = wp.y;
    } else {
      const enemyZone = unit.team === Team.RED ? b.blueSpawnZone : b.redSpawnZone;
      if (enemyZone) {
        cx = enemyZone.x; cy = enemyZone.y;
      } else {
        const mapW = b.mapWidth || 1600;
        const mapH = b.mapHeight || 1600;
        cx = mapW / 2;
        cy = unit.team === Team.RED ? mapH - 128 : 128;
      }
    }
    turnUnitToward(unit, Math.atan2(cy - unit.y, cx - unit.x), dtSec);
    moveBrainUnit(b, unit, cx, cy, dtSec, friendlies);

    // Opportunity fire: shoot at spotted enemies in reach while advancing
    const spotted = unit._spotted || [];
    for (const s of spotted) {
      if (s.enemy && !s.enemy.dead) {
        if (tryShoot(b, unit, s.enemy.x, s.enemy.y, now, s.enemy)) {
          unit._actionVerb = 'firing_on_move';
          break;
        }
      }
    }
    return;
  }

  // Desired hold distance: aggressive=40% of engage range, cautious=90%
  const agg = p.aggression || 0.5;
  const holdDist = engageDist * (0.4 + (1 - agg) * 0.5);

  // Back-off urgency scales continuously with (1-aggression)
  const backoffUrgency = 1 - agg;  // 0=never backs off, 1=always tries

  if (targetDist > engageDist || unit._targetBridgeBlocked) {
    // Out of engagement range (or bridge-blocked: keep moving to get LOS)
    unit._isBackingOff = false;
    moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
    if (unit._targetBridgeBlocked) unit._actionVerb = 'repositioning';
  } else if (targetDist < holdDist * 0.6 && backoffUrgency > 0.3) {
    // Too close — back off scales with (1-aggression)
    // At agg=1: backoffUrgency=0, never enters. At agg=0: backoffUrgency=1, always backs off.
    unit._isBackingOff = true;
    const d = targetDist || 1;
    const backX = target.x + ((unit.x - target.x) / d) * holdDist;
    const backY = target.y + ((unit.y - target.y) / d) * holdDist;
    moveBrainUnit(b, unit, backX, backY, dtSec, friendlies);
    unit._actionVerb = 'repositioning';
  } else if (unit._isBackingOff && targetDist < holdDist * 0.85) {
    // Hysteresis: continue backing off until reaching 85% of holdDist
    const d = targetDist || 1;
    const backX = target.x + ((unit.x - target.x) / d) * holdDist;
    const backY = target.y + ((unit.y - target.y) / d) * holdDist;
    moveBrainUnit(b, unit, backX, backY, dtSec, friendlies);
    unit._actionVerb = 'repositioning';
  } else {
    // In comfortable zone — hold position or flank
    unit._isBackingOff = false;

    // Halt to stabilize before firing (patient/disciplined units)
    if (shouldHaltToFire(unit, target, targetDist, range)) {
      unit._actionVerb = 'aiming';
      // Skip flanking while stabilizing — stand still
    } else {

    // Flanking: initiative scales aggressiveness (continuous, no threshold)
    const initiative = p.initiative ?? 0.5;
    const suppression = unit._suppression ?? 0;
    const flankDrive = initiative * (1 - suppression); // Suppression dampens flanking

    if (flankDrive > 0.25 && !unit._isProne) {
      // Commit to a flank target (latch to prevent oscillation)
      if (!unit._flankTarget) {
        const flankPos = findFlankPosition(b, unit, target, range);
        if (flankPos) {
          unit._flankTarget = { x: flankPos.x, y: flankPos.y };
          logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'flank',
            x: Math.round(unit.x), y: Math.round(unit.y),
            action: 'flanking', target: `(${Math.round(flankPos.x)},${Math.round(flankPos.y)})`,
            detail: `init:${initiative.toFixed(2)} drive:${flankDrive.toFixed(2)} score:${flankPos.flankScore.toFixed(2)}` });
        }
      }

      if (unit._flankTarget) {
        const fDist = Math.hypot(unit._flankTarget.x - unit.x, unit._flankTarget.y - unit.y);
        if (fDist < 15) {
          unit._flankTarget = null;
          unit._actionVerb = 'flanking_hold';
        } else {
          moveBrainUnit(b, unit, unit._flankTarget.x, unit._flankTarget.y, dtSec, friendlies);
          unit._actionVerb = 'flanking';
        }
      }
    }
    } // end halt-to-fire else
  }

  // Clear flank target if target dies or we lose sight
  if (unit._flankTarget && (!target || target.dead)) {
    unit._flankTarget = null;
  }

  // Fire at target — shouldFire() handles range gating + stability + acquisition
  turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
  if (tryShoot(b, unit, target.x, target.y, now, target)) {
    unit._actionVerb = 'firing';
    unit._haltingToFire = false;
  }
}

/**
 * FOLLOW — Trail leader. Hold fire unless squad is under fire (command-level rule).
 * <80px: drift to slot behind leader. Discipline controls spacing tolerance.
 * When squad is under fire: aggression > discipline → break away to fight.
 */
function executeFollow(b, unit, leader, target, targetDist, range, speed, now, dtSec, friendlies) {
  unit._actionVerb = 'following';

  if (!leader || leader.dead) {
    // No leader — fall back to hold
    executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies);
    return;
  }

  const p = unit.personality || {};
  const discipline = p.discipline ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const leaderDist = distanceBetween(unit, leader);
  const followDist = 70; // Slot distance behind leader

  // Compute slot position: behind leader, opposite facing direction
  const leaderAngle = leader.angle || 0;
  const slotX = leader.x - Math.cos(leaderAngle) * followDist;
  const slotY = leader.y - Math.sin(leaderAngle) * followDist;

  if (leaderDist > 200) {
    // Far from leader — catch up to slot
    moveBrainUnit(b, unit, slotX, slotY, dtSec, friendlies);
    unit._actionVerb = 'catching_up';
  } else if (leaderDist > 80) {
    // Medium distance — gentle approach (discipline controls spacing tolerance)
    const approachSpeed = 0.5 + discipline * 0.3; // 0.5-0.8× speed
    moveBrainUnit(b, unit, slotX, slotY, dtSec, friendlies, approachSpeed);
  } else {
    // Close to leader (<80px) — drift to slot position slowly
    const slotDist = Math.hypot(slotX - unit.x, slotY - unit.y);
    if (slotDist > 15) { // Dead zone: don't micro-adjust within 15px
      moveBrainUnit(b, unit, slotX, slotY, dtSec, friendlies, 0.3);
    }
  }

  // Face same direction as leader when not firing
  turnUnitToward(unit, leaderAngle, dtSec);

  // Fire discipline: FOLLOW holds fire unless squad is under fire
  const squadUnderFire = friendlies.some(f =>
    f !== unit && !f.dead && (f._shockTimer ?? 0) > 0 &&
    distanceBetween(unit, f) < 200
  );

  if (squadUnderFire && target) {
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);

    if (aggression > discipline) {
      // Aggressive: break away from formation to fight
      if (targetDist > range * 1.1) {
        moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
      }
      unit._actionVerb = 'engaging';
    }
    // Fire at target — pipeline handles range gating
    if (tryShoot(b, unit, target.x, target.y, now, target)) {
      unit._actionVerb = 'firing';
    }
  }
  // Otherwise: hold fire (FOLLOW = quiet, only shoot when squad is under fire)
}

/**
 * FALL_BACK — Tactical pullback. NOT "retreat to base."
 * 1. Disengage from current enemy contact
 * 2. Move to sergeant rally point (sergeant decides where)
 * 3. Spread out, seek cover within rally area
 * 4. Form defensive position → transition to HOLD behavior
 *
 * Personality: aggression scales fire-while-retreating frequency.
 * courage scales squad cohesion (wait for squad vs run ahead).
 */
function executeFallBack(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  const p = unit.personality || {};
  const aggression = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;
  const category = inferCategory(unit);

  // Resolve rally point: sergeant waypoint > own spawn (clamped to map)
  const wp = getSquadWaypoint(b, unit);
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  const safeMargin = 80;
  let rallyX, rallyY;

  if (wp) {
    rallyX = wp.x;
    rallyY = wp.y;
  } else {
    const isBlue = unit.team === Team.BLUE;
    const ownZone = isBlue ? b.blueSpawnZone : b.redSpawnZone;
    if (ownZone) {
      rallyX = ownZone.x; rallyY = ownZone.y;
    } else {
      rallyX = isBlue ? 100 : mapW - 100;
      rallyY = unit.y;
    }
  }
  // Clamp rally point to safe map bounds — never retreat off-map
  rallyX = Math.max(safeMargin, Math.min(mapW - safeMargin, rallyX));
  rallyY = Math.max(safeMargin, Math.min(mapH - safeMargin, rallyY));

  const distToRally = Math.hypot(rallyX - unit.x, rallyY - unit.y);

  // Hysteresis: once dug in, stay until rally point moves significantly
  const alreadyDugIn = unit._actionVerb === 'digging_in' || unit._actionVerb === 'dug_in';
  const rallyThreshold = alreadyDugIn ? 220 : 150;

  if (distToRally < rallyThreshold) {
    // Near rally area — spread out, find cover, dig in
    unit._actionVerb = 'digging_in';

    // Search for best cover within rally area
    const coverPos = findNearbyCoverPos(b, unit, 4, friendlies);
    if (coverPos) {
      const coverDistToRally = Math.hypot(rallyX - coverPos.x, rallyY - coverPos.y);
      if (coverDistToRally < rallyThreshold * 0.9) {
        const arrived = moveBrainUnit(b, unit, coverPos.x, coverPos.y, dtSec, friendlies);
        if (arrived) {
          unit._actionVerb = 'dug_in';
          // Unit-type-specific dig in
          if (category === UnitCategory.INFANTRY) {
            unit._isProne = true; // Cover + prone = max defense
          } else if (category === UnitCategory.MEDIUM_TANK || category === UnitCategory.HEAVY_TANK) {
            unit._isHullDown = true;
          }
          // Light vehicles: park behind cover (handled by cover system)
        }
      }
    } else {
      // No cover found — dig in anyway
      if (category === UnitCategory.INFANTRY) unit._isProne = true;
      else if (category === UnitCategory.MEDIUM_TANK || category === UnitCategory.HEAVY_TANK) unit._isHullDown = true;
    }

    // Fire at targets from rally position (pipeline handles range)
    if (target) {
      turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  } else {
    // Retreating toward rally point — must clear prone/hull-down to move
    unit._isProne = false;
    unit._isHullDown = false;
    unit._actionVerb = 'retreating';
    moveBrainUnit(b, unit, rallyX, rallyY, dtSec, friendlies);

    // Aggression scales fire-while-retreating frequency (continuous)
    // High aggression: fires often (pauses = slower effective movement)
    // Low aggression: focuses on running (faster effective movement)
    if (target && aggression > 0.15) { // Even low-agg units occasionally shoot
      // Fire probability scales with aggression: random check
      if (Math.random() < aggression) {
        turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
        tryShoot(b, unit, target.x, target.y, now, target);
      }
    }
  }
}

/**
 * COVER_ME — Suppress threats near leader. Player-only (sergeant never issues).
 * Unit acts as leader's bodyguard/fire support.
 * Personality: aggression→suppress distance, initiative→angle repositioning,
 * discipline→bodyguard distance maintenance.
 */
function executeCoverMe(b, unit, leader, target, targetDist, range, now, dtSec, friendlies) {
  unit._actionVerb = 'covering';

  if (!leader || leader.dead) {
    executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies);
    return;
  }

  const p = unit.personality || {};
  const aggression = p.aggression ?? 0.5;
  const discipline = p.discipline ?? 0.5;
  const leaderDist = distanceBetween(unit, leader);
  const bodyguardDist = 60 + (1 - discipline) * 40; // Disciplined=60px, sloppy=100px

  // Stay near leader: reposition to beside/behind leader if too far
  if (leaderDist > bodyguardDist * 2) {
    // Far from leader — move to beside/behind them
    const leaderAngle = leader.angle || 0;
    const offsetAngle = leaderAngle + Math.PI * 0.8; // Slightly behind and to the side
    const moveX = leader.x + Math.cos(offsetAngle) * bodyguardDist;
    const moveY = leader.y + Math.sin(offsetAngle) * bodyguardDist;
    moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies);
  }

  if (target) {
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);

    if (targetDist <= range * 1.1) {
      // Halt to stabilize if covering (discipline-driven)
      if (shouldHaltToFire(unit, target, targetDist, range)) {
        unit._actionVerb = 'aiming';
      }
      // Target in reach — suppress from position
      if (tryShoot(b, unit, target.x, target.y, now, target)) {
        unit._actionVerb = 'suppressing';
        unit._haltingToFire = false;
      }
    } else {
      // Target out of reach — move up to get in suppress range
      // Aggression scales how aggressively: high=push toward threat, low=just to weapon reach
      const suppressDist = range * (0.7 + (1 - aggression) * 0.3); // agg→70% range, cautious→100%
      const d = targetDist || 1;
      const moveX = target.x + ((unit.x - target.x) / d) * suppressDist;
      const moveY = target.y + ((unit.y - target.y) / d) * suppressDist;
      moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies);
      unit._actionVerb = 'closing_to_suppress';
      // Try to fire while closing (pipeline handles range)
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  } else {
    // No target — face leader's facing direction, scan for threats
    turnUnitToward(unit, leader.angle || 0, dtSec);
    unit._actionVerb = 'guarding';

    // Gently drift toward bodyguard position if not already there
    if (leaderDist > bodyguardDist * 1.2) {
      const leaderAngle = leader.angle || 0;
      const offsetAngle = leaderAngle + Math.PI * 0.8;
      const moveX = leader.x + Math.cos(offsetAngle) * bodyguardDist;
      const moveY = leader.y + Math.sin(offsetAngle) * bodyguardDist;
      moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies, 0.5);
    }
  }
}

/**
 * FOCUS_FIRE — Concentrate fire on leader's target. Move into range if needed.
 * When target dies → auto-transition to HOLD (this command was for THAT target).
 * Initiative scales flanking aggressiveness continuously.
 * Aggression scales closing distance.
 * Patience scales willingness to wait for stability before firing.
 */
function executeFocusFire(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  unit._actionVerb = 'focusing';

  const p = unit.personality || {};
  const initiative = p.initiative ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const suppression = unit._suppression ?? 0;

  // Target died or no target — FOCUS_FIRE was for THAT target, transition to HOLD
  if (!target || target.dead) {
    unit._flankTarget = null;
    unit.command = Command.HOLD;
    executeHold(b, unit, null, Infinity, range, now, dtSec, friendlies);
    return;
  }

  // Engagement distance: patience scales how far out they start engaging
  const engageDist = range * (0.6 + (p.patience ?? 0.5) * 0.6);

  if (targetDist > engageDist || unit._targetBridgeBlocked) {
    // Out of engagement range (or bridge-blocked: keep closing to get LOS)
    const closeDist = engageDist * (1.0 - aggression * 0.3);
    const d = targetDist || 1;
    const moveX = target.x + ((unit.x - target.x) / d) * closeDist;
    const moveY = target.y + ((unit.y - target.y) / d) * closeDist;
    moveBrainUnit(b, unit, moveX, moveY, dtSec, friendlies);
    unit._actionVerb = unit._targetBridgeBlocked ? 'repositioning' : 'closing';
  } else {
    // In engagement range — flank with initiative scaling (continuous, not threshold)
    // Effective initiative dampened by suppression
    const effInitiative = initiative * (1 - suppression);

    if (effInitiative > 0.15 && !unit._isProne) {
      // Probability of seeking a flank position scales with initiative
      if (!unit._flankTarget && Math.random() < effInitiative * 0.03) {
        const flankPos = findFlankPosition(b, unit, target, range);
        if (flankPos) {
          unit._flankTarget = { x: flankPos.x, y: flankPos.y };
        }
      }
      if (unit._flankTarget) {
        const flankDist = Math.hypot(unit._flankTarget.x - unit.x, unit._flankTarget.y - unit.y);
        if (flankDist < 15) {
          unit._flankTarget = null;
        } else {
          moveBrainUnit(b, unit, unit._flankTarget.x, unit._flankTarget.y, dtSec, friendlies);
          unit._actionVerb = 'flanking';
        }
      }
    }
  }

  // Halt to stabilize if in engagement range (patient/disciplined units)
  if (shouldHaltToFire(unit, target, targetDist, range)) {
    unit._actionVerb = 'aiming';
  }

  // Fire at target — shouldFire() handles range gating + stability + acquisition
  turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
  if (tryShoot(b, unit, target.x, target.y, now, target)) {
    unit._actionVerb = 'firing';
    unit._haltingToFire = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// SURVIVAL SYSTEM — Threat assessment + self-preservation actions
// ═══════════════════════════════════════════════════════════════

// ── LOS-Breaking & Flanking Helpers ─────────────────────────

/**
 * Find a position that breaks line of sight with a threat.
 * Samples positions at ~100px around the unit, returns the best one
 * that blocks LOS from the threat. Prefers positions that also increase
 * distance from the threat.
 */
function findLOSBreakPosition(b, unit, threat) {
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  const searchDist = 100;
  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const cx = unit.x + Math.cos(angle) * searchDist;
    const cy = unit.y + Math.sin(angle) * searchDist;

    // Bounds check
    if (cx < 20 || cy < 20 || cx > mapW - 20 || cy > mapH - 20) continue;
    // Not blocked terrain
    if (isTerrainBlocked(b, cx, cy)) continue;

    // LOS from threat to candidate position
    const los = traceLineOfSight(b, threat.x, threat.y, cx, cy);
    // Distance from threat (prefer farther)
    const threatDist = Math.hypot(cx - threat.x, cy - threat.y);
    const currentThreatDist = Math.hypot(unit.x - threat.x, unit.y - threat.y);

    // Score: LOS break is primary (lower LOS = better), distance is secondary
    let score = (1.0 - los) * 60;  // 0-60 points for LOS blocking
    if (threatDist > currentThreatDist) score += 15; // Bonus for increasing distance
    score += (threatDist / 400) * 10; // Small bonus for raw distance

    if (score > bestScore) {
      bestScore = score;
      best = { x: cx, y: cy, los, threatDist };
    }
  }

  // Only return if the position actually reduces LOS significantly
  return (best && best.los < 0.5) ? best : null;
}

/**
 * Find a position to flank a target — in their peripheral or rear arc.
 * Samples positions around the target at engagement range, returns the best
 * one that has LOS to the target and is outside their forward cone.
 */
function findFlankPosition(b, unit, target, range) {
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  const targetFacing = target.angle || 0;
  const engageRange = range * 0.8; // Flank at 80% of weapon range
  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const cx = target.x + Math.cos(angle) * engageRange;
    const cy = target.y + Math.sin(angle) * engageRange;

    // Bounds check
    if (cx < 20 || cy < 20 || cx > mapW - 20 || cy > mapH - 20) continue;
    // Not blocked
    if (isTerrainBlocked(b, cx, cy)) continue;

    // Must have LOS to target from this position
    const los = traceLineOfSight(b, cx, cy, target.x, target.y);
    if (los < 0.15) continue; // Can't fire from there

    // Angle from target's facing — how far off their forward cone?
    // angle is direction from target to candidate
    let angleDiff = angle - targetFacing;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const absAngleDiff = Math.abs(angleDiff);

    // flankScore: 0 = directly in front, 1 = directly behind
    const flankScore = absAngleDiff / Math.PI;
    // Must be at least 60 degrees off the front (flankScore > 0.33)
    if (flankScore < 0.33) continue;

    // Movement cost: prefer closer positions to reduce travel time
    const moveDist = Math.hypot(cx - unit.x, cy - unit.y);

    // Score: flank angle is primary, move distance is secondary penalty
    let score = flankScore * 50;         // 0-50 for flank angle
    score -= (moveDist / 400) * 20;      // Penalty for long moves
    score += los * 5;                    // Prefer clearer LOS

    if (score > bestScore) {
      bestScore = score;
      best = { x: cx, y: cy, flankScore, moveDist, los };
    }
  }

  return best;
}

// ── Survival Assessment ─────────────────────────────────────

/**
 * Look up the leadership stat of this unit's sergeant.
 * Cached on the unit as _sgtLeadership to avoid repeated squad lookups.
 * @returns {number} 0-1 leadership value
 */
function _getSquadLeadership(b, unit) {
  // Return cached value if fresh (recalc every 5s or on squad change)
  if (unit._sgtLeadership !== undefined && unit._sgtLeadershipSquad === unit._squadId) {
    return unit._sgtLeadership;
  }
  // Look up squad → sergeant unit → leadership
  const squads = b._squads || [];
  for (const sq of squads) {
    if (sq.id !== unit._squadId || !sq.active) continue;
    const pool = sq.team === 'blue' ? (b.units || []) : (b.enemies || []);
    const sgtUnit = pool.find(u => u.id === sq.sergeantUnitId);
    const lead = sgtUnit?.leadership ?? 0;
    unit._sgtLeadership = lead;
    unit._sgtLeadershipSquad = unit._squadId;
    return lead;
  }
  unit._sgtLeadership = 0;
  unit._sgtLeadershipSquad = unit._squadId;
  return 0;
}

/**
 * Command posture multiplier for survival threshold.
 * Offensive commands suppress self-preservation (unit commits to the fight).
 * Defensive commands amplify it (unit prioritizes staying alive).
 * @param {string} command - Active sergeant command
 * @returns {number} Multiplier for danger threshold (lower = harder to trigger flee)
 */
function getCommandPosture(command) {
  switch (command) {
    case Command.ADVANCE:    return 0.3;  // Committed to attack — hard to spook
    case Command.FOCUS_FIRE: return 0.3;  // Locked on target — suppress flee
    case Command.FOLLOW:     return 0.5;  // Following leader — moderate suppression
    case Command.HOLD:       return 0.7;  // Defending — some self-preservation
    case Command.COVER_ME:   return 0.7;  // Supporting — hold your ground
    case Command.FALL_BACK:  return 1.5;  // Retreating — flee easily
    default:                 return 1.0;
  }
}

function assessSurvival(unit, target, hostiles, friendlies, b) {
  if (!target || target.dead) return { survivalRatio: Infinity, inDanger: false, action: null };

  const awareness = unit._awareness ?? 0.5;

  // My DPS against current target
  const myDmg = unit.damage || 10;
  const myFireRate = (unit.fireRate || 2000) / 1000;
  const myAccuracy = Math.max(0.3, unit.stability || 0.5);
  const myDPS = (myDmg / myFireRate) * myAccuracy;

  // Incoming threat: count enemies actually threatening THIS unit
  // Full DPS from enemies targeting me, reduced DPS from enemies targeting others
  // Awareness gates how many threats we perceive (low awareness = tunnel vision)
  const threatRange = (unit.range || 400) * 1.5;
  let incomingDPS = 0;
  let threatCount = 0;
  if (hostiles) {
    for (const h of hostiles) {
      if (h.dead) continue;
      const d = distanceBetween(unit, h);
      if (d > threatRange) continue;
      threatCount++;
      if (threatCount > Math.ceil(awareness * 5)) break;
      const hDmg = h.damage || 10;
      const hRate = (h.fireRate || 2000) / 1000;
      const baseDPS = hDmg / hRate;
      // Enemies targeting me are the real threat; others are ambient danger
      if (h._currentTarget === unit) {
        incomingDPS += baseDPS * 0.7;  // Targeting me directly
      } else {
        incomingDPS += baseDPS * 0.1;  // Not focused on me — ambient risk only
      }
    }
  }
  // Fallback: single-target model if no threats scanned
  if (incomingDPS === 0) {
    const theirDmg = target.damage || 10;
    const theirRate = (target.fireRate || 2000) / 1000;
    incomingDPS = (theirDmg / theirRate) * 0.5;
  }

  // Ally support: nearby allies reduce effective risk
  // Awareness determines how much we "trust" allies to help
  let allyDPS = 0;
  if (friendlies && awareness > 0.3) {
    const cohesionRange = 200;
    for (const a of friendlies) {
      if (a === unit || a.dead) continue;
      if (distanceBetween(unit, a) > cohesionRange) continue;
      const aDmg = a.damage || 10;
      const aRate = (a.fireRate || 2000) / 1000;
      allyDPS += (aDmg / aRate) * 0.3 * awareness;
    }
  }

  // Cover reduces effective incoming DPS
  let coverReduction = 0;
  if (b) {
    const terrain = getTerrainAt(b, unit.x, unit.y);
    const coverScore = TERRAIN_COVER_SCORE[terrain] ?? 0;
    coverReduction = Math.min(coverScore / 100, 0.4); // up to 40% in pillbox
  }

  const effectiveIncoming = incomingDPS * (1 - coverReduction);
  const effectiveMyDPS = myDPS + allyDPS;

  const theirTTK = effectiveIncoming > 0 ? (unit.hp || 60) / effectiveIncoming : Infinity;
  const myTTK = effectiveMyDPS > 0 ? (target.hp || 60) / effectiveMyDPS : Infinity;

  // survivalRatio < 1 means I die first
  const survivalRatio = myTTK > 0 ? theirTTK / myTTK : 0;

  // Danger threshold scaled by courage, awareness, HP, and sergeant command
  // Full-HP units are much harder to spook — need overwhelming odds to flee
  // Wounded units flee sooner (self-preservation kicks in)
  // Offensive commands suppress survival instinct; defensive commands amplify it
  const courage = unit.personality?.courage ?? 0.5;
  const hpPercent = (unit.hp || 60) / (unit.maxHp || 60);
  const hpFactor = 0.3 + hpPercent * 0.7; // 0.3 (near-death) → 1.0 (full HP)

  // Danger threshold: courage, awareness, and HP determine when survival instinct triggers.
  // Command authority (discipline + leadership) is now handled by the effectiveMorale band
  // system in movement-modes.js — even if assessSurvival flags danger, the band gating
  // prevents survival from overriding orders when effectiveMorale is high.
  const dangerThreshold = (0.3 + courage * 0.5) * awareness * hpFactor;

  const inDanger = survivalRatio < dangerThreshold;

  let action = null;
  if (inDanger) {
    const aggression = unit.personality?.aggression ?? 0.5;
    const discipline = unit.personality?.discipline ?? 0.5;
    const category = inferCategory(unit);
    const skills = CATEGORY_SKILLS[category];

    if (category === UnitCategory.INFANTRY) {
      if (aggression > 0.7 && skills.canGoProne) {
        action = 'go_prone';
      } else if (aggression < 0.5 && discipline < 0.6) {
        // Low aggression + low discipline: escape via LOS break
        action = 'break_los';
      } else if (discipline > 0.6) {
        action = 'fall_back_to_allies';
      } else if (skills.canUseCover) {
        action = 'rush_to_cover';
      } else {
        action = 'fall_back_to_allies';
      }
    } else if (category === UnitCategory.LIGHT_VEHICLE) {
      if (aggression > 0.6) {
        action = 'reposition';
      } else {
        action = 'break_los'; // Light vehicles use speed to break LOS
      }
    } else { // MEDIUM_TANK, HEAVY_TANK
      if (aggression > 0.7 && courage > 0.6) {
        action = 'charge';
      } else if (skills.canHullDown) {
        action = 'hull_down';
      } else {
        action = null; // keep fighting normally
      }
    }
  }

  return { survivalRatio, inDanger, action, myTTK, theirTTK };
}

/**
 * Clear all survival-related state on a unit.
 */
function clearSurvivalState(unit) {
  unit._survivalAction = null;
  unit._survivalCommitment = null;
  unit._isProne = false;
  unit._isHullDown = false;
  unit._survivalCoverTarget = null;
  unit._repositionDir = null;
  unit._losBreakTarget = null;
  unit._losBreakArrived = false;
  unit._losBreakArriveTime = null;
  unit._repositionTarget = null;
  unit._disengageTarget = null;
}

/**
 * Check if the survival system is allowed to override sergeant commands.
 * Courage caps how long survival can override (3s brave → 15s coward).
 * Discipline sets a cooldown after override expires (5s low → 10s high).
 * Returns true if survival override is allowed, false if blocked.
 *
 * @param {object} unit - The unit to check
 * @param {number} now - Current timestamp
 * @returns {boolean} Whether survival can take control
 */
function canSurvivalOverride(unit, now) {
  const courage = unit.personality?.courage ?? 0.5;
  const discipline = unit.personality?.discipline ?? 0.5;

  // Cooldown active — sergeant has control
  if (unit._survivalCooldownUntil && now < unit._survivalCooldownUntil) {
    return false;
  }

  // Check if current commitment has exceeded courage-driven max duration
  const commitment = unit._survivalCommitment;
  if (commitment) {
    const maxDuration = 8000 - courage * 6000; // 2s (brave) to 8s (coward)
    if (now - commitment.startTime > maxDuration) {
      // Expired — enter cooldown, sergeant takes over
      unit._survivalCooldownUntil = now + 5000 + discipline * 5000; // 5s (undisciplined) to 10s (disciplined)
      return false;
    }
  }

  return true;
}

/**
 * Check if a survival action has been completed.
 * Used for commitment tracking — units finish what they started.
 */
function isSurvivalComplete(unit) {
  const c = unit._survivalCommitment;
  if (!c) return true;
  switch (c.action) {
    case 'go_prone':
      return !!unit._isProne;
    case 'hull_down':
      return !!unit._isHullDown;
    case 'rush_to_cover':
    case 'break_los':
    case 'reposition':
      if (c.targetPos) {
        return Math.hypot(unit.x - c.targetPos.x, unit.y - c.targetPos.y) < 30;
      }
      return false;
    case 'fall_back_to_allies':
      return !!unit._losBreakArrived;
    case 'charge':
      return unit._currentTarget && distanceBetween(unit, unit._currentTarget) < (unit.range || 150);
    default:
      return true;
  }
}

/**
 * Execute a survival action. Returns true if action was taken (command overridden).
 */
function executeSurvivalAction(b, unit, target, targetDist, range, survival, now, dtSec, friendlies) {
  const action = survival.action;
  if (!action) return false;

  switch (action) {
    case 'go_prone':       return executeProne(b, unit, target, targetDist, range, now, dtSec);
    case 'rush_to_cover': return executeRushToCover(b, unit, target, targetDist, range, now, dtSec, friendlies);
    case 'fall_back_to_allies': return executeFallBackToAllies(b, unit, target, range, now, dtSec, friendlies);
    case 'disengage':      return executeDisengage(b, unit, target, dtSec, friendlies);
    case 'reposition':     return executeReposition(b, unit, target, range, now, dtSec, friendlies);
    case 'break_los':      return executeBreakLOS(b, unit, target, range, now, dtSec, friendlies);
    case 'hull_down':      return executeHullDown(b, unit, target, targetDist, range, now, dtSec);
    case 'charge':         return executeCharge(b, unit, target, targetDist, range, now, dtSec, friendlies);
    default: return false;
  }
}

function executeProne(b, unit, target, targetDist, range, now, dtSec) {
  unit._isProne = true;
  unit._isHullDown = false;
  unit._actionVerb = 'prone';

  if (target && targetDist <= range * 1.5) {
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
    tryShoot(b, unit, target.x, target.y, now, target);
  }
  return true;
}

function executeRushToCover(b, unit, target, targetDist, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'rushing_to_cover';

  if (!unit._survivalCoverTarget) {
    unit._survivalCoverTarget = findNearbyCoverPos(b, unit);
    if (unit._survivalCoverTarget && unit._survivalCommitment) {
      unit._survivalCommitment.targetPos = { x: unit._survivalCoverTarget.x, y: unit._survivalCoverTarget.y };
    }
  }

  if (unit._survivalCoverTarget) {
    const arrived = moveBrainUnit(b, unit, unit._survivalCoverTarget.x, unit._survivalCoverTarget.y, dtSec, friendlies);
    if (arrived) {
      unit._survivalCoverTarget = null;
      unit._actionVerb = 'in_cover';
      unit._isProne = true; // Go prone once in cover
    }
  } else {
    // No cover found — fall back to allies
    return executeFallBackToAllies(b, unit, target, range, now, dtSec, friendlies);
  }

  // Snap-fire while running
  if (target && targetDist <= range * 0.8) {
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
    tryShoot(b, unit, target.x, target.y, now, target);
  }
  return true;
}

function executeFallBackToAllies(b, unit, target, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'falling_back';

  // Find nearest alive friendly
  let nearestAlly = null, nearestDist = Infinity;
  for (const ally of friendlies) {
    if (ally === unit || ally.dead || ally.id === unit.id) continue;
    const d = distanceBetween(unit, ally);
    if (d < nearestDist && d > 30) {
      nearestDist = d;
      nearestAlly = ally;
    }
  }

  if (nearestAlly && nearestDist > 60) {
    moveBrainUnit(b, unit, nearestAlly.x, nearestAlly.y, dtSec, friendlies);
  } else if (!nearestAlly) {
    // No ally — fall back to waypoint or own spawn
    const wp = getSquadWaypoint(b, unit);
    const isBlue = unit.team === Team.BLUE;
    const ownZone = isBlue ? b.blueSpawnZone : b.redSpawnZone;
    const dest = wp || ownZone;
    if (dest) {
      moveBrainUnit(b, unit, dest.x, dest.y, dtSec, friendlies);
    }
  }

  // Fire while retreating
  if (target) {
    const dist = distanceBetween(unit, target);
    if (dist <= range) {
      turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
  return true;
}

function executeDisengage(b, unit, target, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'disengaging';

  // Use shared retreat system — boundary-aware, personality-driven
  if (!unit._disengageTarget) {
    const retreat = findRetreatPosition(b, unit, target);
    unit._disengageTarget = retreat;
    if (unit._survivalCommitment) {
      unit._survivalCommitment.targetPos = { x: retreat.x, y: retreat.y };
    }
  }

  const dest = unit._disengageTarget;
  const arrived = moveBrainUnit(b, unit, dest.x, dest.y, dtSec, friendlies);

  if (arrived || distanceBetween(unit, dest) < 30) {
    if (dest.type === 'cover') {
      // Found cover — hold here, clear disengage
      unit._disengageTarget = null;
      unit._survivalAction = null;
      unit._survivalCommitment = null;
    } else if (dest.type === 'charge') {
      // Cornered and brave — switch to fighting
      unit._disengageTarget = null;
      unit._survivalAction = null;
      unit._survivalCommitment = null;
    } else {
      // Break — arrived at fallback position. Stop fleeing, fight from here.
      // Don't clear target — prevents expensive recompute loop
      // (findRetreatPosition + A* pathfinding every frame)
      unit._survivalAction = null;
      unit._survivalCommitment = null;
    }
  }

  // Fire while retreating if target in range
  if (target && !target.dead) {
    const range = unit.range || 300;
    const dist = distanceBetween(unit, target);
    if (dist <= range) {
      turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
      tryShoot(b, unit, target.x, target.y, b._now || Date.now(), target);
    }
  }
  return true;
}

function executeBreakLOS(b, unit, target, range, now, dtSec, friendlies) {
  // Already arrived at LOS-break position — hold prone, stay hidden ~2s then release
  if (unit._losBreakArrived) {
    unit._isProne = true;
    unit._isHullDown = false;
    unit._actionVerb = 'hidden';
    // Stay hidden for ~2s after arrival, then clear survival action
    const hiddenDuration = now - (unit._losBreakArriveTime || now);
    if (hiddenDuration > 2000) {
      unit._losBreakArrived = false;
      unit._survivalAction = null;
    }
    return true;
  }

  // No target and no LOS-break position in progress — nothing to break LOS from
  if (!target && !unit._losBreakTarget) return false;

  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'breaking_los';

  // Latch: once committed to a LOS-break position, keep moving there
  if (!unit._losBreakTarget) {
    const pos = findLOSBreakPosition(b, unit, target);
    if (pos) {
      unit._losBreakTarget = { x: pos.x, y: pos.y };
      if (unit._survivalCommitment) {
        unit._survivalCommitment.targetPos = { x: pos.x, y: pos.y };
      }
      logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'survival',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: 'break_los', target: `(${Math.round(pos.x)},${Math.round(pos.y)})`,
        detail: `los:${pos.los.toFixed(2)} threatDist:${Math.round(pos.threatDist)}` });
    } else {
      // No LOS-break position found — fall back to disengaging
      return executeDisengage(b, unit, target, dtSec, friendlies);
    }
  }

  if (unit._losBreakTarget) {
    const arrived = moveBrainUnit(b, unit, unit._losBreakTarget.x, unit._losBreakTarget.y, dtSec, friendlies);
    if (arrived) {
      unit._losBreakTarget = null;
      unit._losBreakArrived = true; // Latch — hold this position
      unit._losBreakArriveTime = now;
      unit._actionVerb = 'hidden';
      unit._isProne = true;
    }
  }

  // Don't fire while breaking LOS — stealth escape
  return true;
}

function executeReposition(b, unit, target, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'repositioning';

  if (target) {
    // Try LOS-breaking reposition first — move to position that blocks threat's view
    if (!unit._repositionTarget) {
      const losPos = findLOSBreakPosition(b, unit, target);
      if (losPos) {
        unit._repositionTarget = { x: losPos.x, y: losPos.y };
      } else {
        // Fallback: perpendicular movement
        if (!unit._repositionDir) {
          unit._repositionDir = Math.random() > 0.5 ? 1 : -1;
        }
        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        unit._repositionTarget = {
          x: unit.x + (-dy / dist) * 150 * unit._repositionDir,
          y: unit.y + (dx / dist) * 150 * unit._repositionDir
        };
      }
      if (unit._repositionTarget && unit._survivalCommitment) {
        unit._survivalCommitment.targetPos = { x: unit._repositionTarget.x, y: unit._repositionTarget.y };
      }
    }

    const arrived = moveBrainUnit(b, unit, unit._repositionTarget.x, unit._repositionTarget.y, dtSec, friendlies);
    if (arrived) {
      unit._repositionTarget = null;
      unit._repositionDir = null;
    }

    // Fire while repositioning
    if (distanceBetween(unit, target) <= range) {
      turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
  return true;
}

function executeHullDown(b, unit, target, targetDist, range, now, dtSec) {
  unit._isHullDown = true;
  unit._isProne = false;
  unit._actionVerb = 'hull_down';

  if (target) {
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
    if (targetDist <= range * 1.3) {
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
  return true;
}

function executeCharge(b, unit, target, targetDist, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'charging';

  if (target && !target.dead) {
    moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
    turnUnitToward(unit, Math.atan2(target.y - unit.y, target.x - unit.x), dtSec);
    if (targetDist <= range) {
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  } else {
    // Target died or no target — charge toward objective (waypoint or enemy spawn)
    const wp = getSquadWaypoint(b, unit);
    const isBlue = unit.team === Team.BLUE;
    const enemyZone = isBlue ? b.redSpawnZone : b.blueSpawnZone;
    const dest = wp || enemyZone;
    if (dest) {
      moveBrainUnit(b, unit, dest.x, dest.y, dtSec, friendlies);
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// AWARENESS FACETS — Flank detection, proactive cover
// ═══════════════════════════════════════════════════════════════

/**
 * Scan for enemies flanking this unit (behind it, within detection range).
 * Boosts flanker's threat score temporarily. Initiative controls scan frequency.
 */
function checkFlankThreats(b, unit, hostiles, now, dtSec) {
  const initiative = unit.personality?.initiative ?? 0.5;
  const awareness = unit._awareness ?? 0.5;
  const scanInterval = 3000 - initiative * 2000; // 1s (high) to 3s (low)

  if (now - (unit._lastFlankScan || 0) < scanInterval) return;
  unit._lastFlankScan = now;

  const detectionRange = 150 * awareness; // awareness scales detection range
  if (detectionRange < 30) return; // too low awareness to detect flanks

  const facing = unit.angle || 0;
  let flankerFound = false;

  for (const e of hostiles) {
    if (e.dead || (e.hp !== undefined && e.hp <= 0)) continue;
    const dx = e.x - unit.x, dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > detectionRange) continue;

    // Check if enemy is behind unit (angle > 90 degrees from facing)
    const angleToEnemy = Math.atan2(dy, dx);
    let angleDiff = angleToEnemy - facing;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    if (Math.abs(angleDiff) > Math.PI / 2) {
      // Flanker detected — mark for threat boost in targeting
      e._flankThreatBoost = now + 2000; // boost lasts 2 seconds
      flankerFound = true;

      logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'flank',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: `flanked by ${e.id}`,
        detail: `dist:${Math.round(dist)} angle:${Math.round(Math.abs(angleDiff) * 180 / Math.PI)}°` });

      // High awareness: auto-rotate to face flanker
      if (awareness > 0.7) {
        turnUnitToward(unit, angleToEnemy, dtSec);
      }
      break; // Only report first flanker per scan
    }
  }
  return flankerFound;
}

/**
 * General awareness-driven cover seeking. Runs for ALL commands.
 * Higher awareness → lower threshold, wider search, faster checks.
 * Initiative controls check interval. Replaces per-command cover logic.
 */
function awarenessCoverCheck(b, unit, friendlies, now, dtSec) {
  const awareness = unit._awareness ?? 0.5;
  if (awareness < 0.35) return; // Too unaware to seek cover

  // Already in cover — but invalidate if unit moved significantly from cover position
  if (unit._coverReached && unit._coverPos) {
    const dFromCover = Math.hypot(unit.x - unit._coverPos.x, unit.y - unit._coverPos.y);
    if (dFromCover > 40) {
      // Unit displaced from cover (e.g., command moved it) — re-enable seeking
      unit._coverReached = false;
      unit._coverPos = null;
      unit._proactiveCoverTarget = null;
    } else {
      return; // Still in cover, nothing to do
    }
  }

  // Already moving to cover target — keep moving
  if (unit._proactiveCoverTarget) {
    unit._actionVerb = 'seeking_cover';
    const arrived = moveBrainUnit(b, unit, unit._proactiveCoverTarget.x, unit._proactiveCoverTarget.y, dtSec, friendlies, 0.7);
    if (arrived) {
      unit._coverPos = { x: unit._proactiveCoverTarget.x, y: unit._proactiveCoverTarget.y };
      unit._proactiveCoverTarget = null;
      unit._coverReached = true;
      unit._actionVerb = 'in_cover';
    }
    return;
  }

  // Throttle checks by initiative
  const initiative = unit.personality?.initiative ?? 0.5;
  const checkInterval = 4000 - initiative * 2500; // 1.5s (high init) to 4s (low init)
  if (now - (unit._lastProactiveCoverCheck || 0) < checkInterval) return;
  unit._lastProactiveCoverCheck = now;

  // Only seek cover if not currently moving (stationary = stopped to fire, hold, etc.)
  if (unit._movedThisFrame) return;

  // Search radius scales with awareness: 2 cells (low) to 4 cells (high)
  const searchRadius = Math.round(2 + awareness * 2);
  const coverPos = findNearbyCoverPos(b, unit, searchRadius);
  if (coverPos) {
    unit._proactiveCoverTarget = coverPos;
    logEvent(b, { t: now, who: unit.id, team: unit.team, type: 'decision',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: 'cover seek',
      detail: `awr:${awareness.toFixed(2)} radius:${searchRadius} cover@(${Math.round(coverPos.x)},${Math.round(coverPos.y)})` });
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN BRAIN LOOP — Called per frame for every combat unit
// ═══════════════════════════════════════════════════════════════

function updateBrain(b, unit, leader, hostiles, friendlies, now, dtSec, team) {
  // 0. Init on first frame
  initBrain(unit, team);
  unit._battle = b; // ref for morale event logging

  // Create _dbg early so tryShoot can write fireResult to it
  unit._dbg = unit._dbg || {};

  const prevX = unit.x;
  const prevY = unit.y;

  // Stability type key (used after movement detection)
  const typeKey = unit.aiTypeKey || unit.unitId || 'infantry';

  // 1. Cohesion + awareness
  const cohesion = getCohesion(unit, friendlies);
  if (now - (unit._lastMoraleCheck || 0) > 2000) {
    if (cohesion.isolated) {
      applyMoraleEvent(unit, MoraleEvent.ISOLATED, 0.3);
    } else if (cohesion.nearbyCount >= 2) {
      applyMoraleEvent(unit, MoraleEvent.NEAR_ALLIES, 0.3);
    }
    unit._lastMoraleCheck = now;
  }

  // 2. Compute awareness (uses cohesion) + decay shock timer
  if (unit._shockTimer > 0) unit._shockTimer = Math.max(0, unit._shockTimer - dtSec);
  getAwareness(unit, cohesion);

  // 2.1. Compute effective morale — single number driving all behavior decisions
  const sgtLeadership = _getSquadLeadership(b, unit);
  unit._effectiveMorale = computeEffectiveMorale(unit, sgtLeadership);

  // 3. Morale panic check — uses effectiveMorale so discipline/leadership help resist panic
  //    Recovery time: 2 + (1 - courage) × 3 seconds
  //    Cooldown: 10s after recovery before can re-panic (prevents oscillation)
  let activeCommand = unit.command || Command.ADVANCE;
  const courage = unit.personality?.courage ?? 0.5;
  const panicCooldownOver = !unit._panicRecoveryTime || (now - unit._panicRecoveryTime) > 10000;
  if (!unit._panicking && unit._effectiveMorale < unit._routThreshold && panicCooldownOver) {
    // Enter panic
    unit._panicking = true;
    unit._panicStartTime = now;
    unit._panicFleeTarget = null;
    unit._panicCoverTarget = null;
    unit._panicCharging = false;
    unit._inFormation = false;
  }
  if (unit._panicking) {
    const panicDuration = (2 + (1 - courage) * 3) * 1000; // 2-5 seconds
    if (now - (unit._panicStartTime || 0) > panicDuration && unit._effectiveMorale >= unit._routThreshold + 0.05) {
      // Recovered — set cooldown to prevent immediate re-panic
      unit._panicking = false;
      unit._panicFleeTarget = null;
      unit._panicCoverTarget = null;
      unit._panicCharging = false;
      unit._panicRecoveryTime = now;
      unit.morale = Math.max(unit.morale, 0.3); // Boost morale above re-trigger threshold
    } else {
      activeCommand = Command.FALL_BACK;
    }
  }

  // 2.4. Decay suppression
  updateSuppression(unit, dtSec, b);

  // Brain sub-timing — accumulates into b._brainPerf for the perf snapshot system
  if (!b._brainPerf) b._brainPerf = { vision: 0, targeting: 0, survival: 0, movement: 0, flank: 0, _count: 0 };
  const _bp = b._brainPerf;
  _bp._count++;
  let _bt;

  // 2.5. Build spotted list — vision scan of all hostiles
  _bt = performance.now();
  buildSpottedList(unit, hostiles, b, now);
  _bp.vision += performance.now() - _bt;

  // 2.6. Compute cover bias — how much this unit prefers cover-to-cover movement
  unit._coverBias = computeCoverBias(unit, activeCommand);

  // 4. Select target (initiative-driven re-evaluation interval + hysteresis)
  _bt = performance.now();
  const initiative = unit.personality?.initiative ?? 0.5;
  const reEvalInterval = 2500 - initiative * 1500; // 1000ms (high) to 2500ms (low)
  let target;
  const prevTarget = unit._currentTarget;
  const prevTargetAlive = prevTarget && !prevTarget.dead && prevTarget.hp > 0;

  if (prevTargetAlive && now < (unit._targetLockedUntil || 0)) {
    // Keep current target (locked)
    target = prevTarget;
  } else {
    // Re-evaluate target
    const candidate = selectBrainTarget(b, unit, hostiles, leader, activeCommand);

    // Target-switch hysteresis: only switch if the new target scores meaningfully
    // better than keeping the current one. Prevents oscillation between close scores.
    // Discipline increases the margin needed to switch (disciplined units commit).
    if (candidate && prevTargetAlive && candidate !== prevTarget) {
      const discipline = unit.personality?.discipline ?? 0.5;
      const switchMargin = 0.15 + discipline * 0.15; // 0.15-0.30 score margin required
      const candidateScore = unit._lastTargetScore ?? 0;
      const prevScore = _scoreExistingTarget(b, unit, prevTarget, hostiles, leader, activeCommand);
      if (candidateScore - prevScore < switchMargin) {
        // Not enough advantage — keep current target
        target = prevTarget;
      } else {
        target = candidate;
      }
    } else {
      target = candidate;
    }
    unit._targetLockedUntil = now + reEvalInterval;
  }
  _bp.targeting += performance.now() - _bt;
  // Clear flank target and stamp acquisition time when switching targets
  if (target !== prevTarget) {
    unit._flankTarget = null;
    unit._targetAcquiredAt = now;
    unit._targetJustSwitched = true; // Triggers stability reset in fire-decision
  }
  unit._currentTarget = target;

  // 5. Calculate distance
  let targetDist = Infinity;
  if (target) {
    targetDist = distanceBetween(unit, target);
  }

  const range = unit.range || 150;
  let speed = unit.speed || 80;
  // In formation: cap to slowest unit so the squad stays together
  if (unit._inFormation && unit._formationSpeed) {
    speed = Math.min(speed, unit._formationSpeed);
  }

  // 5.5. Survival assessment — update survival state (used by mode scoring)
  _bt = performance.now();
  if (target && !unit._panicking) {
    const survivalInterval = 800 - (unit._awareness ?? 0.5) * 300;
    if (now - (unit._lastSurvivalCheck || 0) > survivalInterval) {
      unit._lastSurvivalCheck = now;
      const survival = assessSurvival(unit, target, hostiles, friendlies, b);
      unit._lastSurvival = survival;
      // Log survival state changes
      if (survival.inDanger) {
        // Band-based gate: survival can only set _survivalAction when
        // effectiveMorale is below the obey threshold. Above it, the scoring
        // system caps survival score so it can't override commands anyway,
        // but we also prevent new commitments from forming.
        const em = unit._effectiveMorale ?? 0.8;
        if (em > unit._obeyThreshold) {
          // High effective morale — sergeant has authority, clear survival
          if (unit._survivalAction) {
            logEvent(b, { t: now, who: unit.id, team, type: 'survival',
              x: Math.round(unit.x), y: Math.round(unit.y),
              action: 'survival_suppressed',
              detail: `eMorale:${em.toFixed(2)} obeyThresh:${unit._obeyThreshold.toFixed(2)}` });
            clearSurvivalState(unit);
          }
        } else {
          // Below obey threshold — survival instinct can engage
          if (!unit._survivalCommitment) {
            unit._survivalCommitment = {
              action: survival.action,
              startTime: now,
              startPos: { x: unit.x, y: unit.y },
              targetPos: null,
              completed: false
            };
          }
          unit._survivalAction = unit._survivalCommitment.action;
          logEvent(b, { t: now, who: unit.id, team, type: 'survival',
            x: Math.round(unit.x), y: Math.round(unit.y),
            action: unit._survivalAction,
            detail: `ratio:${survival.survivalRatio.toFixed(2)} eMorale:${em.toFixed(2)} myTTK:${survival.myTTK.toFixed(1)}s theirTTK:${survival.theirTTK.toFixed(1)}s` });
        }
      } else {
        // Danger passed — check commitment before clearing
        const commitment = unit._survivalCommitment;
        if (commitment && !commitment.completed) {
          commitment.completed = isSurvivalComplete(unit);

          if (!commitment.completed) {
            // Discipline determines whether we finish or abandon
            const discipline = unit.personality?.discipline ?? 0.5;
            const abandonThreshold = 0.3 + discipline * 0.5; // 0.3-0.8
            const elapsed = now - commitment.startTime;
            const progressBonus = Math.min(elapsed / 5000, 0.3);

            if (Math.random() > abandonThreshold + progressBonus) {
              // Abandon — low discipline gives up
              logEvent(b, { t: now, who: unit.id, team, type: 'survival',
                x: Math.round(unit.x), y: Math.round(unit.y),
                action: 'survival_abandon',
                detail: `disc:${discipline.toFixed(2)} elapsed:${(elapsed / 1000).toFixed(1)}s` });
              clearSurvivalState(unit);
            } else {
              // Stay committed — keep doing current action
              unit._survivalAction = commitment.action;
            }
          } else {
            // Action completed — clear normally
            logEvent(b, { t: now, who: unit.id, team, type: 'survival',
              x: Math.round(unit.x), y: Math.round(unit.y),
              action: 'survival_complete',
              detail: `action:${commitment.action} elapsed:${((now - commitment.startTime) / 1000).toFixed(1)}s` });
            clearSurvivalState(unit);
          }
        } else {
          // No active commitment or already completed — clear
          if (unit._survivalAction) {
            logEvent(b, { t: now, who: unit.id, team, type: 'survival',
              x: Math.round(unit.x), y: Math.round(unit.y),
              action: 'survival_clear',
              detail: `ratio:${survival.survivalRatio.toFixed(2)} danger passed` });
          }
          clearSurvivalState(unit);
        }
      }
    }
  } else if (!target) {
    clearSurvivalState(unit);
    unit._lastSurvival = null;
  }

  _bp.survival += performance.now() - _bt;

  // 6. Unified movement — build context, resolve mode, execute
  _bt = performance.now();
  const moveCtx = buildMovementContext(b, unit, target, targetDist, hostiles, friendlies, now, leader);
  unit._moveCtx = moveCtx; // Cache for moveBrainUnit threat speed calculation
  const modeResult = resolveMovementMode(unit, moveCtx);

  // Log mode changes with full score breakdown
  if (unit._prevMovementMode !== modeResult.mode) {
    // Build compact score summary: UCvr:35 Surv:0 Bnd:12 Cmd:40 Rgrp:5
    const scoreStr = modeResult.scores ? Object.entries(modeResult.scores)
      .map(([k, v]) => {
        const abbr = { urgent_cover: 'UCvr', survival_action: 'Surv',
          tactical_bound: 'Bnd', command_execute: 'Cmd', regroup: 'Rgrp' };
        return `${abbr[k] || k}:${Math.round(v)}`;
      }).join(' ') : '';
    logEvent(b, { t: now, who: unit.id, team, type: 'movement',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: modeResult.mode,
      detail: `winner:${Math.round(modeResult.score)} [${scoreStr}] prev:${unit._prevMovementMode || 'none'}` });
    unit._prevMovementMode = modeResult.mode;
  }

  executeMovementMode(b, unit, modeResult, moveCtx, range, speed, now, dtSec, friendlies);

  _bp.movement += performance.now() - _bt;

  // 6.7. Flank detection (awareness + initiative gated) — read-only, no movement
  _bt = performance.now();
  checkFlankThreats(b, unit, hostiles, now, dtSec);
  _bp.flank += performance.now() - _bt;

  // 7. Track movement and update stability
  // Use a threshold so micro-adjustments (separation steering, float drift) don't count as movement
  const moveDist = Math.hypot(unit.x - prevX, unit.y - prevY);
  // Scale movement threshold by expected per-frame displacement (speed * dt)
  // 20% of expected = real movement vs micro-drift; floor at 0.3px
  const expectedFrameMove = (unit.speed || 80) * dtSec;
  const rawMoved = moveDist > Math.max(0.3, expectedFrameMove * 0.2);
  unit._moveDistThisFrame = moveDist;

  // Debounce movement state — prevent micro-stutter from destroying stability
  // Unit must be stationary for 3+ consecutive frames before we consider it "not moving"
  if (rawMoved) {
    unit._stationaryFrames = 0;
    unit._movedThisFrame = true;
  } else {
    unit._stationaryFrames = (unit._stationaryFrames || 0) + 1;
    unit._movedThisFrame = unit._stationaryFrames < 3; // Still "moving" for first 2 frames
  }

  const prevStab = unit.stability ?? 0;
  updateStability(unit, dtSec, typeKey);

  // 7.5. Stuck detector — sliding window displacement check
  // Track position history over 2-second window and check total displacement
  // Only applies to movement verbs — stationary verbs (holding, firing, prone) are intentional
  {
    const MOVEMENT_VERBS = new Set([
      'advancing', 'rushing_to_cover', 'pushing_up', 'closing_to_fire',
      'flanking', 'bounding_advance', 'regrouping', 'repositioning',
      'breaking_los', 'retreating', 'catching_up', 'following'
    ]);
    const isMovementVerb = MOVEMENT_VERBS.has(unit._actionVerb || '');

    // Initialize position history ring buffer (stores positions every 0.5s)
    if (!unit._posHistory) unit._posHistory = [];
    if (!unit._posHistoryTimer) unit._posHistoryTimer = 0;
    unit._posHistoryTimer += dtSec;
    if (unit._posHistoryTimer >= 0.5) {
      unit._posHistoryTimer = 0;
      unit._posHistory.push({ x: unit.x, y: unit.y, t: now });
      // Keep only last 2 seconds worth (4 entries at 0.5s intervals)
      while (unit._posHistory.length > 5) unit._posHistory.shift();
    }

    // Check displacement over the full window (oldest entry to current position)
    const oldest = unit._posHistory[0];
    const windowDisplacement = oldest
      ? Math.hypot(unit.x - oldest.x, unit.y - oldest.y)
      : Infinity;
    const windowDuration = oldest ? (now - oldest.t) / 1000 : 0;

    // Stuck threshold: unit should have moved at least 10% of expected distance over the window
    // Floor of 8px prevents false positives from slow formation movement, terrain drag, etc.
    const expectedWindowMove = (unit.speed || 80) * windowDuration;
    const stuckThreshold = Math.max(8, expectedWindowMove * 0.10);

    // Skip dead units entirely
    const isDead = unit.dead || unit.hp <= 0;

    if (isMovementVerb && !isDead && windowDuration >= 2 && windowDisplacement < stuckThreshold) {
      unit._stuckTime = (unit._stuckTime || 0) + dtSec;
    } else if (!isMovementVerb || isDead || windowDisplacement >= stuckThreshold) {
      unit._stuckTime = 0;
    }
    if (unit._stuckTime >= 3 && now - (unit._lastStuckLog || 0) > 4000) {
      unit._lastStuckLog = now;
      const logTeam2 = team;
      const ldr = unit._formationLeader;
      const wp = getSquadWaypoint(b, unit);
      const scores = modeResult?.scores || {};
      const scoreStr = Object.entries(scores)
        .map(([k, v]) => {
          const abbr = { urgent_cover: 'UCvr', survival_action: 'Surv',
            tactical_bound: 'Bnd', command_execute: 'Cmd', regroup: 'Rgrp' };
          return `${abbr[k] || k}:${Math.round(v)}`;
        }).join(' ');
      logEvent(b, {
        t: now, who: unit.id, team: logTeam2, type: 'STUCK',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: `stuck ${unit._stuckTime.toFixed(1)}s`,
        detail: [
          `mode:${modeResult?.mode || '?'}`,
          `verb:${unit._actionVerb || 'idle'}`,
          `cmd:${activeCommand}`,
          `[${scoreStr}]`,
          `slot:${unit._slotTarget ? `(${Math.round(unit._slotTarget.x)},${Math.round(unit._slotTarget.y)})` : 'none'}`,
          `slotDev:${unit._slotTarget ? Math.round(Math.hypot(unit._slotTarget.x - unit.x, unit._slotTarget.y - unit.y)) : '-'}`,
          `ldr:${ldr ? `${ldr.id}@(${Math.round(ldr.x)},${Math.round(ldr.y)})${ldr.dead ? ' DEAD' : ''}` : 'none'}`,
          `fmt:${unit._inFormation ? unit._formationType || 'yes' : 'no'}`,
          `wp:${wp ? `(${Math.round(wp.x)},${Math.round(wp.y)})` : 'none'}`,
          `tgt:${target ? `${target.id}@${Math.round(targetDist)}` : 'none'}`,
          `hp:${Math.round(unit.hp || 0)}/${Math.round(unit.maxHp || 100)}`,
          `sup:${(unit._suppression ?? 0).toFixed(2)}`,
          `morale:${(unit.morale ?? 0.8).toFixed(2)}`,
          unit._flankTarget ? `flank:(${Math.round(unit._flankTarget.x)},${Math.round(unit._flankTarget.y)})` : '',
          unit._losBreakTarget ? `losBreak:(${Math.round(unit._losBreakTarget.x)},${Math.round(unit._losBreakTarget.y)})` : ''
        ].filter(Boolean).join(' ')
      });
    }

    // Terrain escape: if stuck for 5+ seconds AND actually on impassable terrain
    const cat = inferCategory(unit);
    const terrainTrapped = isTerrainBlocked(b, unit.x, unit.y)
      || !isTerrainPassable(b, unit.x, unit.y, cat);
    if (unit._stuckTime >= 5 && terrainTrapped && !unit._escapeAttempted) {
      unit._escapeAttempted = true;
      const escaped = nudgeToPassable(b, unit, cat);
      if (escaped) {
        logEvent(b, {
          t: now, who: unit.id, team, type: 'STUCK',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: 'terrain_escape',
          detail: `Nudged to (${Math.round(unit.x)},${Math.round(unit.y)})`
        });
      }
    }
    if (unit._stuckTime === 0) unit._escapeAttempted = false;
  }

  // 8. State-change event logging
  const unitTerrain = getTerrainAt(b, unit.x, unit.y);
  const inCover = unitTerrain === 'trench' || unitTerrain === 'pillbox';
  const prevDbg = unit._dbg || {};

  {
    const ux = Math.round(unit.x), uy = Math.round(unit.y);
    const prevTarget = prevDbg.targetId || null;
    const curTarget = target?.id || null;
    const prevAction = prevDbg.state || null;
    const curAction = unit._actionVerb || 'idle';

    // Command changed (sergeant issued new command or FOCUS_FIRE auto-transitioned)
    const prevCmd = prevDbg.command || null;
    if (activeCommand !== prevCmd && prevCmd !== null) {
      logEvent(b, { t: now, who: unit.id, team, type: 'command', x: ux, y: uy,
        action: `${prevCmd} → ${activeCommand}`,
        detail: `verb:${curAction}` });
    }
    // Survival action changed
    const curSurvival = unit._survivalAction || null;
    const prevSurvival = prevDbg.survivalAction || null;
    if (curSurvival !== prevSurvival) {
      if (curSurvival) {
        logEvent(b, { t: now, who: unit.id, team, type: 'survival', x: ux, y: uy,
          action: `survival → ${curSurvival}`,
          detail: `mode:${unit._movementMode || '?'} hp:${Math.round((unit.hp / (unit.maxHp || 100)) * 100)}%` });
      } else if (prevSurvival) {
        logEvent(b, { t: now, who: unit.id, team, type: 'survival', x: ux, y: uy,
          action: `survival cleared (was ${prevSurvival})` });
      }
    }
    // Target changed
    if (curTarget !== prevTarget) {
      logEvent(b, { t: now, who: unit.id, team, type: 'target', x: ux, y: uy,
        action: curTarget ? `target → ${curTarget}` : 'lost target',
        detail: prevTarget ? `was ${prevTarget}` : 'had none' });
    }
    // Action/state changed (skip firing transitions — fire event covers those)
    // Debounce: suppress logging if same unit changed action within last 500ms
    if (curAction !== prevAction && prevAction !== null
        && curAction !== 'firing' && prevAction !== 'firing') {
      const lastActionLogTime = unit._lastActionLogTime || 0;
      if (now - lastActionLogTime > 500) {
        logEvent(b, { t: now, who: unit.id, team, type: 'action', x: ux, y: uy,
          action: `${prevAction} → ${curAction}` });
        unit._lastActionLogTime = now;
      }
    }
    // Panic started/stopped
    if (unit._panicking && !prevDbg.panicking) {
      logEvent(b, { t: now, who: unit.id, team, type: 'panic', x: ux, y: uy,
        action: 'PANIC', detail: `morale:${(unit.morale||0).toFixed(2)} crg:${courage.toFixed(2)}` });
    } else if (!unit._panicking && prevDbg.panicking) {
      logEvent(b, { t: now, who: unit.id, team, type: 'panic', x: ux, y: uy,
        action: 'panic over', detail: `morale:${(unit.morale||0).toFixed(2)}` });
    }
    // Morale threshold crossings (check every update, but only log on cross)
    const mrl = unit.morale ?? 0.8;
    const prevMrl = prevDbg._rawMorale ?? mrl;
    if (prevMrl >= 0.5 && mrl < 0.5) {
      logEvent(b, { t: now, who: unit.id, team, type: 'morale', x: ux, y: uy,
        action: 'morale LOW', detail: mrl.toFixed(2) });
    } else if (prevMrl < 0.5 && mrl >= 0.5) {
      logEvent(b, { t: now, who: unit.id, team, type: 'morale', x: ux, y: uy,
        action: 'morale recovered', detail: mrl.toFixed(2) });
    }
    if (prevMrl >= 0.2 && mrl < 0.2) {
      logEvent(b, { t: now, who: unit.id, team, type: 'morale', x: ux, y: uy,
        action: 'morale CRITICAL', detail: mrl.toFixed(2) });
    }
    // Cover entered/left
    if (inCover && !prevDbg.inCover) {
      logEvent(b, { t: now, who: unit.id, team, type: 'cover', x: ux, y: uy, action: 'entered cover', detail: unitTerrain });
    } else if (!inCover && prevDbg.inCover) {
      logEvent(b, { t: now, who: unit.id, team, type: 'cover', x: ux, y: uy, action: 'left cover' });
    }
    // Movement start/stop — tracked via frame data (x,y,stab), no event needed
    // Stability threshold crossings
    const curStab = unit.stability || 0;
    if (prevStab < 0.95 && curStab >= 0.95) {
      logEvent(b, { t: now, who: unit.id, team, type: 'stability', x: ux, y: uy,
        action: 'zeroed in', detail: `stab:${curStab.toFixed(2)} type:${typeKey}` });
    } else if (prevStab >= 0.5 && curStab < 0.5) {
      logEvent(b, { t: now, who: unit.id, team, type: 'stability', x: ux, y: uy,
        action: 'stability lost', detail: `stab:${curStab.toFixed(2)} (moving)` });
    }
  }

  // 8.5. Turret return-to-forward — when no target, slowly center turret on hull
  if (!target && unit.hullAngle != null) {
    turnTurretToward(unit, unit.hullAngle, dtSec * 0.3);
  }

  // 9. Debug telemetry — read by fire range overlay and debug panel
  const p = unit.personality || {};
  const lastFire = unit.lastShot || unit.lastAttack || 0;
  const fireRate = unit.fireRate || 2000;
  const cooldownElapsed = now - lastFire;
  const cooldownPct = Math.min(1, cooldownElapsed / fireRate); // 1 = ready
  const fireResult = unit._dbg?.fireResult || null;

  unit._dbg = {
    // Action state
    command: activeCommand,
    state: unit._actionVerb || 'idle',
    targetId: target?.id || null,
    targetDist: target ? Math.round(targetDist) : null,
    // Personality axes
    aggression: +(p.aggression ?? 0.5).toFixed(2),
    patience: +(p.patience ?? 0.5).toFixed(2),
    courage: +(p.courage ?? 0.5).toFixed(2),
    discipline: +(p.discipline ?? 0.5).toFixed(2),
    // Morale & veterancy
    morale: +(unit.morale ?? 0.8).toFixed(2),
    veterancy: +(unit.veterancy ?? 0).toFixed(2),
    panicking: unit._panicking || false,
    // Awareness & initiative & vision
    awareness: +(unit._awareness ?? 0.5).toFixed(2),
    initiative: +(p.initiative ?? 0.5).toFixed(2),
    spotted: unit._spotted ? unit._spotted.length : 0,
    viewRange: unit.viewRange || 200,
    coverBias: +(unit._coverBias ?? 0).toFixed(2),
    // Formation
    formation: unit._formationType || null,
    formationSlot: unit._formationSlot ?? null,
    inFormation: unit._inFormation || false,
    isLead: unit._inFormation && unit === unit._formationLeader,
    slotDev: unit._slotTarget ? Math.round(Math.hypot(unit._slotTarget.x - unit.x, unit._slotTarget.y - unit.y)) : null,
    slotX: unit._slotTarget ? Math.round(unit._slotTarget.x) : null,
    slotY: unit._slotTarget ? Math.round(unit._slotTarget.y) : null,
    fmtAngle: unit._formationAngle != null ? +(unit._formationAngle * 180 / Math.PI).toFixed(1) : null,
    // Movement mode
    movementMode: unit._movementMode || null,
    modeScores: modeResult?.scores || null,
    // Survival
    survivalAction: unit._survivalAction || null,
    survivalRatio: unit._lastSurvival ? +unit._lastSurvival.survivalRatio.toFixed(2) : null,
    isProne: unit._isProne || false,
    isHullDown: unit._isHullDown || false,
    inCover: unit._coverReached || false,
    suppression: +(unit._suppression ?? 0).toFixed(2),
    _rawMorale: unit.morale ?? 0.8,
    // Fire readiness
    stability: +(unit.stability || 0).toFixed(2),
    cooldown: +cooldownPct.toFixed(2),
    aimTime: lastFire > 0 ? Math.round(cooldownElapsed) : null,
    accuracy: fireResult?.accuracy ? +fireResult.accuracy.toFixed(2) : null,
    canFire: fireResult?.canFire ?? null,
    fireResult,
    // Terrain
    terrain: unitTerrain,
    cover: TERRAIN_COVER_SCORE[unitTerrain] || 0,
    inCover,
    // Legacy compat fields
    behavior: unit._behaviorKey || activeCommand,
    typeKey
  };
}

// ═══════════════════════════════════════════════════════════════
// LEGACY EXPORTS — Kept for game.js compatibility
// ═══════════════════════════════════════════════════════════════

// Old AIState — aliased to Command for transition
export const AIState = {
  IDLE: 'idle',
  ADVANCING: 'advancing',
  MOVING: 'moving',
  ENGAGING: 'engaging',
  ATTACKING: 'attacking',
  DEFENDING: 'defending',
  FOLLOWING: 'following',
  RETREATING: 'retreating',
  REPOSITIONING: 'repositioning',
  COVERING: 'covering'
};

// Old AIBehavior — stub, will be replaced by personality
export const AIBehavior = {
  AGGRESSIVE: { retreatThreshold: 0.15 },
  DEFENSIVE: { retreatThreshold: 0.35 },
  SUPPORT: { retreatThreshold: 0.25 },
  SNIPER: { retreatThreshold: 0.40 },
  FLANKER: { retreatThreshold: 0.20 }
};

// Old EnemyAIType — stub, will be replaced by personality + commander
export const EnemyAIType = {
  BASIC: { speed: 1.0, aggression: 0.5, attackRange: 60, retreatHP: 0 },
  RUSHER: { speed: 1.4, aggression: 1.0, attackRange: 40, retreatHP: 0 },
  HUNTER: { speed: 1.0, aggression: 0.6, attackRange: 80, retreatHP: 0.1 },
  CAUTIOUS: { speed: 0.8, aggression: 0.3, attackRange: 120, retreatHP: 0.4 },
  FLANKER: { speed: 1.2, aggression: 0.7, attackRange: 60, retreatHP: 0.2 },
  SWARMER: { speed: 1.6, aggression: 1.0, attackRange: 30, retreatHP: 0 }
};

// Old TacticalCommand — stub
export const TacticalCommand = {
  FOLLOW: { key: '1', label: 'Follow', state: 'following' },
  HOLD: { key: '2', label: 'Hold', state: 'defending' },
  ATTACK: { key: '3', label: 'Attack', state: 'attacking' },
  MOVE: { key: '4', label: 'Move', state: 'moving', needsTarget: true },
  RETREAT: { key: '5', label: 'Retreat', state: 'retreating' }
};

// ═══════════════════════════════════════════════════════════════
// PUBLIC API — Called by game.js
// ═══════════════════════════════════════════════════════════════

export function updateUnitAI(b, unit, hero, enemies, now, dtSec) {
  if (unit.dead) return;
  updateBrain(b, unit, hero, enemies, b.units || [], now, dtSec, Team.BLUE);
}

export function updateEnemyAI(b, enemy, hero, allies, now, dtSec) {
  if (enemy.dead) return;
  // Build hostiles list: hero + player allies
  const hostiles = [];
  if (hero && !hero.dead && hero.hp > 0 && hero.x > -1000) {
    hostiles.push(hero);
  }
  if (allies) {
    for (const a of allies) {
      if (!a.dead) hostiles.push(a);
    }
  }
  updateBrain(b, enemy, null, hostiles, b.enemies || [], now, dtSec, Team.RED);
}

/**
 * Share spotted intel between friendly units via cohesion.
 * Call once per frame per team, AFTER all individual brain updates.
 * Nearby allies share their _spotted lists. Quality scales with receiver's awareness.
 * Scouts (hasRecon) share at 2x cohesion range.
 *
 * @param {Array} friendlies - Units to share intel between
 * @param {number} now - Current timestamp
 * @param {object} opts - Optional: { squadMode: true } bypasses range limit (sgt relay)
 */
export function shareTeamIntel(friendlies, now, opts = {}) {
  const COHESION_RANGE = 120;
  const SCOUT_MULT = 2.0;
  const squadMode = opts.squadMode || false;

  for (const unit of friendlies) {
    if (unit.dead) continue;
    if (!unit._spotted || unit._spotted.length === 0) continue;

    const isScout = CATEGORY_SKILLS[inferCategory(unit)]?.hasRecon || false;
    const shareRange = squadMode ? Infinity : (isScout ? COHESION_RANGE * SCOUT_MULT : COHESION_RANGE);

    for (const ally of friendlies) {
      if (ally === unit || ally.dead) continue;
      if (!squadMode) {
        const d = distanceBetween(unit, ally);
        if (d > shareRange) continue;
      }

      const allyAwareness = ally._awareness ?? 0.5;
      // Accuracy degradation by receiver's awareness
      let posUncertainty;
      if (allyAwareness < 0.4) posUncertainty = 80;       // direction only
      else if (allyAwareness < 0.7) posUncertainty = 40;   // approximate
      else posUncertainty = 10;                             // near-exact

      // Share each spotted entry the ally doesn't already have from direct vision
      if (!ally._spotted) ally._spotted = [];
      const allyDirectIds = new Set();
      for (const s of ally._spotted) {
        if (s.direct) allyDirectIds.add(s.enemy?.id);
      }

      for (const entry of unit._spotted) {
        if (!entry.enemy || entry.enemy.dead) continue;
        if (allyDirectIds.has(entry.enemy.id)) continue; // Ally already sees this directly

        // Check if ally already has a shared entry for this enemy
        const existing = ally._spotted.find(s => s.enemy?.id === entry.enemy.id && !s.direct);
        const sharedAccuracy = Math.min(entry.accuracy, allyAwareness * 0.8);

        if (existing) {
          // Update if newer
          if (entry.timestamp > existing.timestamp) {
            existing.accuracy = sharedAccuracy;
            existing.timestamp = entry.timestamp;
            existing.posUncertainty = posUncertainty;
          }
        } else {
          // Add new shared entry
          ally._spotted.push({
            enemy: entry.enemy,
            dist: distanceBetween(ally, entry.enemy),
            zone: entry.zone,
            accuracy: sharedAccuracy,
            concealment: entry.concealment,
            direct: false,
            source: isScout ? 'scout_relay' : 'shared',
            posUncertainty,
            timestamp: entry.timestamp
          });
        }
      }
    }
  }
}

export function issueCommand(units, command, params = {}) {
  for (const unit of units) {
    if (unit.dead) continue;
    unit.command = command;
    // Reset cover state when command changes — awareness system will re-seek
    unit._coverReached = false;
    unit._coverPos = null;
    unit._proactiveCoverTarget = null;
    unit._lastProactiveCoverCheck = 0;
    // Reset bounding state
    unit._boundTarget = null;
    unit._boundPauseUntil = null;
    // Reset movement mode transient state
    unit._coverHolding = false;
    unit._coverTarget = null;
    unit._coverPath = null;
    unit._coverPathIndex = 0;
    unit._coverStuckTime = 0;
    unit._coverFailedUntil = 0;
    unit._targetLockedUntil = 0;
    unit._pushingUp = false;
    // Preserve survival state if unit is actively committed — let the survival
    // system run its course. Only clear if no active commitment.
    if (!unit._survivalAction || !unit._survivalCommitment) {
      clearSurvivalState(unit);
    }
    unit._losBreakArriveTime = 0;
    // Reset flanking/retreat state
    unit._flankTarget = null;
    unit._retreatObjective = null;
    unit._retreatCmd = null;
    // Reset bridge-blocked targeting
    unit._targetBridgeBlocked = false;
    // Reset A* navigation path
    unit._navPath = null;
    unit._navIndex = 0;
    unit._navTarget = null;
    // Formation override (commander can set formation per command)
    if (params.formation) {
      unit._formationOverride = params.formation;
    }
  }
}

export function issueFrontLineCommand(units, command) {
  issueCommand(units, command);
}

export function recordDamage(entity, sourceId, amount) {
  if (!entity.recentDamageFrom) entity.recentDamageFrom = {};
  entity.recentDamageFrom[sourceId] = (entity.recentDamageFrom[sourceId] || 0) + amount;
  // Trigger morale event
  applyMoraleEvent(entity, MoraleEvent.TOOK_DAMAGE, Math.min(1, amount / (entity.maxHp || 100)));
}

export function setUnitBehavior(unit, behaviorKey) {
  // Legacy — personality replaces this
}

export function setEnemyAIType(enemy, typeKey) {
  // Legacy — personality + commander replaces this
}

export function addWaypoint(unit, x, y) {
  if (!unit.waypoints) unit.waypoints = [];
  unit.waypoints.push({ x, y });
}

export function clearWaypoints(unit) {
  unit.waypoints = [];
  unit.currentWaypointIndex = 0;
}

export function setWaypointsFromGrid(unit, gridWaypoints, cellSize) {
  unit.waypoints = gridWaypoints.map(wp => ({
    x: (wp.col + 0.5) * cellSize,
    y: (wp.row + 0.5) * cellSize
  }));
  unit.currentWaypointIndex = 0;
}

export function assignSmartPositions(b) {
  // Will be reimplemented in Phase 3
}

export function moveToward(b, unit, targetX, targetY, dtSec, orderSpeedMod = 1.0) {
  // Basic movement — kept as foundation, will be enhanced in Phase 2
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return true; // Arrived

  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const speed = unit.speed || unitDef?.speed || 100;
  const terrainMod = getTerrainSpeedMod(b, unit.x, unit.y);
  const finalSpeed = speed * terrainMod * orderSpeedMod;

  const step = finalSpeed * dtSec;
  const ratio = Math.min(1, step / dist);

  const newX = unit.x + dx * ratio;
  const newY = unit.y + dy * ratio;

  if (!isTerrainBlocked(b, newX, newY)) {
    unit.x = newX;
    unit.y = newY;
  }

  return dist < step;
}

/**
 * Check if any boulder blocks a ray between two points.
 * Samples queryBoulder() every 16px along the ray (same step size as LOS).
 */
function _boulderBlocksRay(terrainMap, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = 16;
  if (dist < step) return false;
  const steps = Math.ceil(dist / step);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (queryBoulder(terrainMap, x1 + dx * t, y1 + dy * t)) return true;
  }
  return false;
}

export function tryShoot(b, unit, targetX, targetY, now, targetEntity) {
  // Turret alignment gate — unit can't fire until turret is aimed at target
  if (unit.hullAngle != null) {
    const aimAngle = Math.atan2(targetY - unit.y, targetX - unit.x);
    if (!isTurretAligned(unit, aimAngle)) {
      return false;
    }
  }

  // Bridge deck blocks shots between different elevation levels
  if (isBridgeDeckBlocking(b.terrainMap?.bridges, unit.x, unit.y, targetX, targetY, unit._bridgeElevation, targetEntity?._bridgeElevation)) {
    return false;
  }

  // Boulders block shots (suppressive fire through forest is still allowed)
  if (b.terrainMap && _boulderBlocksRay(b.terrainMap, unit.x, unit.y, targetX, targetY)) {
    return false;
  }

  // Kept — uses fire decision pipeline
  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const damage = unit.damage || unitDef?.damage || 10;
  const projType = UNIT_PROJECTILES[unit.unitId] || 'bullet';

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;

  const target = targetEntity || { x: targetX, y: targetY };
  const fireDecision = shouldFire(unit, target, b, now);

  if (unit._dbg) unit._dbg.fireResult = fireDecision;
  if (!fireDecision.canFire) return false;

  unit.lastShot = now;
  const baseAngle = Math.atan2(dy, dx);
  // Suppression is now included in computeShotAccuracy — no separate penalty here
  const accuracy = fireDecision.accuracy;
  const maxSpreadDeg = UNIT_COMBAT_STATS[unit.unitId]?.maxSpreadDeg ?? DEFAULT_MAX_SPREAD_DEG;
  const maxSpread = maxSpreadDeg * Math.PI / 180;
  const spread = (1.0 - accuracy) * maxSpread;
  const angle = baseAngle + (Math.random() - 0.5) * 2 * spread;

  // Apply damage falloff from fire decision pipeline
  const finalDamage = Math.round(damage * (fireDecision.damageMod ?? 1.0));

  const projSpeed = unit.projectileSpeed || 400;
  const blastRadius = UNIT_COMBAT_STATS[unit.unitId]?.blastRadius || 0;
  // For AOE projectiles, calculate the impact point (where the shell will land)
  const distToTarget = Math.sqrt(dx * dx + dy * dy);
  const impactX = unit.x + Math.cos(angle) * distToTarget;
  const impactY = unit.y + Math.sin(angle) * distToTarget;

  b.projectiles.push({
    x: unit.x,
    y: unit.y,
    originX: unit.x,
    originY: unit.y,
    vx: Math.cos(angle) * projSpeed,
    vy: Math.sin(angle) * projSpeed,
    damage: finalDamage,
    owner: unit.team === Team.RED ? Owner.ENEMY : Owner.PLAYER,
    sourceId: unit.id,
    attackerTier: getArmorTier(unit),
    type: projType,
    blastRadius,
    impactTarget: blastRadius > 0 ? { x: impactX, y: impactY } : null,
    _bridgeElevation: unit._bridgeElevation || null
  });

  // Post-fire recoil — bigger guns drop more stability
  applyRecoilDrop(unit);

  // Track shotsFired for roster metrics
  if (b._soldierMetrics) {
    // Infantry: credit the soldier directly
    if (unit._soldierId && b._soldierMetrics.has(unit._soldierId)) {
      b._soldierMetrics.get(unit._soldierId).shotsFired++;
    }
    // Vehicle: credit the gunner
    if (unit._crewSoldierIds?.gunner && b._soldierMetrics.has(unit._crewSoldierIds.gunner)) {
      b._soldierMetrics.get(unit._crewSoldierIds.gunner).shotsFired++;
    }
  }

  {
    const factorStr = fireDecision.factors
      ? fireDecision.factors.map(f => `${f.name}:${f.value.toFixed(2)}`).join(' ')
      : `stab:${(unit.stability||0).toFixed(2)}`;
    logEvent(b, {
      t: now,
      who: unit.id,
      team: unit.team,
      type: 'fire',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: 'fire',
      target: targetEntity?.id || '?',
      acc: accuracy.toFixed(2),
      dmg: finalDamage,
      detail: `${factorStr} dist:${Math.round(Math.sqrt(dx*dx+dy*dy))} falloff:${(fireDecision.damageMod ?? 1).toFixed(2)}`
    });
  }

  return true;
}

// Utility kept for compatibility
export function findNearestEnemy(unit, enemies) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = distanceBetween(unit, e);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = e;
    }
  }
  return nearest ? { enemy: nearest, distance: nearestDist } : { enemy: null, distance: Infinity };
}
