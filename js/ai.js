// ═══════════════════════════════════════════════════════════════
// AI — Rewritten from scratch
// Architecture: Command → Type/Stats → Personality → Morale → Action
// Modifiers: Veterancy (consistency), Awareness, Cohesion
// Shared brain for allies AND enemies.
// ═══════════════════════════════════════════════════════════════

import { UNITS, UNIT_PROJECTILES, Formation, FORMATION_OFFSETS } from './constants.js';
import { updateStability, shouldFire } from './fire-decision.js';
import {
  isTerrainBlocked, getTerrainSpeedMod, getTerrainAt, isInCover,
  TERRAIN_COVER_SCORE, getWaterDepth, isTerrainPassable,
  getWaterSpeedMod, distanceBetween, findNearbyCoverPos
} from './terrain-utils.js';
import {
  traceLineOfSight, hasLineOfSight, getConcealment, canDetect,
  buildSpottedList
} from './vision.js';
import {
  MovementMode, buildMovementContext, resolveMovementMode,
  computeThreatSpeed
} from './movement-modes.js';

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
  FOCUS_FIRE: 'focus_fire'   // Everyone targets the same enemy
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
    canSprint: true,
    canGoProne: true,
    canTransport: false,
    hasRecon: false
  },
  [UnitCategory.LIGHT_VEHICLE]: {
    canUseCover: false,
    canSprint: false,       // Uses speed stat instead
    canGoProne: false,
    canTransport: true,
    hasRecon: true
  },
  [UnitCategory.MEDIUM_TANK]: {
    canUseCover: false,      // IS cover — uses hull down
    canSprint: false,
    canGoProne: false,
    canTransport: false,
    hasRecon: false,
    canHullDown: true
  },
  [UnitCategory.HEAVY_TANK]: {
    canUseCover: false,
    canSprint: false,
    canGoProne: false,
    canTransport: false,
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
  ADAPTABILITY: 'adaptability'   // 0=tunnel vision, 1=quick reactions
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
    adaptability: Math.random()
  };

  // Optional category weighting — nudge toward typical values
  // Infantry tends more disciplined, tanks more patient, etc.
  if (category === UnitCategory.INFANTRY) {
    p.discipline = clamp01(p.discipline * 0.8 + 0.2);  // Nudge higher
    p.adaptability = clamp01(p.adaptability * 0.8 + 0.2);
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
  if (unit._battle?._debugLog && Math.abs(delta) > 0.001) {
    const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
    unit._battle._debugLog.push({
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
 * Combines base value (config), personality (adaptability), veterancy,
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

  // Personality: adaptability = inherent perceptiveness
  awareness += (p.adaptability || 0) * 0.2;

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

  const depth = getWaterDepth(b, aheadX, aheadY);
  if (!depth) return { x: 0, y: 0 };

  // How strongly to avoid: shallow=small, medium=moderate, deep=strong
  const strength = depth === 'shallow' ? 0.2 : depth === 'medium' ? 0.6 : 1.0;

  // Vehicles avoid water more aggressively
  const catMult = category === 'infantry' ? 1.0 : 1.5;

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

// Range lookup — mirrors EFFECTIVE_RANGE from fire-decision.js
// so the brain knows how far each unit can actually shoot.
const BRAIN_RANGE = {
  BASIC: 200, RUSHER: 100, HUNTER: 300, CAUTIOUS: 400,
  FLANKER: 200, SWARMER: 60,
  infantry: 150, jeep: 180, humvee: 180,
  sherman: 250, tiger: 300, abrams: 350, howitzer: 350
};

/**
 * First-frame initialization. Sets personality, morale, command, team.
 */
function initBrain(unit, team) {
  if (unit._brainInit) return;

  if (!unit.personality) {
    unit.personality = generatePersonality(inferCategory(unit));
  }
  if (unit.morale === undefined) unit.morale = 0.8;
  if (unit.veterancy === undefined) unit.veterancy = 0;
  if (!unit.team) unit.team = team;

  // Ensure unit has a range (some enemies don't set it at spawn)
  if (!unit.range) {
    const typeKey = unit.aiTypeKey || unit.unitId || 'infantry';
    unit.range = BRAIN_RANGE[typeKey] || 150;
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
  const alive = [];
  if (Array.isArray(spotted)) {
    // Vision system active — only target what this unit can see
    for (const s of spotted) {
      if (s.enemy && !s.enemy.dead && s.enemy.hp > 0) alive.push(s.enemy);
    }
  } else {
    // Fallback: no vision system active (e.g., campaign mode without vision)
    for (const e of hostiles) {
      if (e.dead || (e.hp !== undefined && e.hp <= 0)) continue;
      alive.push(e);
    }
  }
  if (alive.length === 0) return null;

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

  // Personality influence:
  // - Patient units lean toward weakness (finish off wounded efficiently)
  // - Aggressive units lean toward distance (push into closest)
  // - Courageous units lean toward threat (take on the biggest danger)
  const patience = p.patience ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;
  wWeak += (patience - 0.5) * 0.4;       // +0.2 at max patience, -0.2 at min
  wDist += (aggression - 0.5) * 0.3;     // aggressive = close, cautious = less distance focus
  wThreat += (courage - 0.5) * 0.3;      // brave = engage threats, cowardly = avoid them

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
    td.factors = { dist: distScore, weak: weakScore, threat: threatScore, value: valueScore };

    if (td.score > bestScore) {
      bestScore = td.score;
      bestEntry = td;
    }
  }

  const chosen = bestEntry?.target || null;

  // Log target selection reasoning when target changes
  if (chosen && b._debugLog) {
    const prevTarget = unit._dbg?.targetId;
    if (chosen.id !== prevTarget) {
      const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
      const f = bestEntry.factors;
      const wStr = `w[d:${wDist.toFixed(1)} w:${wWeak.toFixed(1)} t:${wThreat.toFixed(1)} v:${wValue.toFixed(1)}]`;
      const fStr = `f[d:${f.dist.toFixed(2)} w:${f.weak.toFixed(2)} t:${f.threat.toFixed(2)} v:${f.value.toFixed(2)}]`;
      const sStr = `s[d:${statsMod.dDist.toFixed(2)} w:${statsMod.dWeak.toFixed(2)} t:${statsMod.dThreat.toFixed(2)} v:${statsMod.dValue.toFixed(2)}]`;
      b._debugLog.push({ t: Date.now(), who: unit.id, team: logTeam, type: 'decision',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: `chose ${chosen.id}`,
        detail: `score:${bestScore.toFixed(2)} ${wStr} ${sStr} ${fStr} hp:${chosen.hp}/${chosen.maxHp}` });
    }
  }
  return chosen;
}

/**
 * Move unit toward a point with separation steering.
 * Returns true if arrived.
 */
function moveBrainUnit(b, unit, targetX, targetY, dtSec, allUnits, speedMult = 1.0) {
  // Prone/hull-down units cannot move
  if (unit._isProne || unit._isHullDown) return false;

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return true;

  const category = inferCategory(unit);
  const baseSpeed = unit._inFormation && unit._formationSpeed
    ? Math.min(unit.speed || 80, unit._formationSpeed)
    : (unit.speed || 80);
  const waitMult = unit._formationWaitMult ?? 1;
  const speed = baseSpeed * speedMult * waitMult;
  const terrainMod = getTerrainSpeedMod(b, unit.x, unit.y);
  // Water depth speed modifier (category-aware)
  const waterMod = getWaterSpeedMod(b, unit.x, unit.y, category);
  // Suppression slows movement (max 40% penalty)
  const suppressionMod = 1 - (unit._suppression ?? 0) * 0.4;
  // Threat-based speed (personality-modulated)
  const threatMod = unit._moveCtx ? computeThreatSpeed(unit, unit._moveCtx) : 1.0;
  const finalSpeed = speed * terrainMod * waterMod * suppressionMod * threatMod;

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

  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLen > 0) { dirX /= dirLen; dirY /= dirLen; }

  const newX = unit.x + dirX * finalSpeed * dtSec;
  const newY = unit.y + dirY * finalSpeed * dtSec;

  // Axis-independent terrain blocking + water passability check
  if (!isTerrainBlocked(b, newX, unit.y) && isTerrainPassable(b, newX, unit.y, category)) unit.x = newX;
  if (!isTerrainBlocked(b, unit.x, newY) && isTerrainPassable(b, unit.x, newY, category)) unit.y = newY;

  // Clamp to map bounds
  const mapW = b.mapWidth || 2000;
  const mapH = b.mapHeight || 2000;
  unit.x = Math.max(20, Math.min(mapW - 20, unit.x));
  unit.y = Math.max(20, Math.min(mapH - 20, unit.y));

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
function updateSuppression(unit, dtSec, b) {
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
      if (b._debugLog) {
        const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
        b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'cover',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: 'bound reached', detail: `bias:${coverBias.toFixed(2)} pause:${Math.round((500 + patience * 1500) * coverBias)}ms` });
      }
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

    if (b._debugLog) {
      const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
      b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'cover',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: 'bound selected', target: `(${Math.round(nextBound.x)},${Math.round(nextBound.y)})`,
        detail: `bias:${coverBias.toFixed(2)} score:${nextBound.score.toFixed(2)}` });
    }

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
function maintainFormation(b, unit, slotTarget, dtSec, friendlies) {
  const discipline = unit.personality?.discipline ?? 0.5;
  const spacing = 40; // Base spacing
  const tolerance = spacing * (1.2 + (1 - discipline) * 0.8); // High disc = 1.2x, low = 2.0x

  const deviation = Math.hypot(slotTarget.x - unit.x, slotTarget.y - unit.y);
  if (deviation <= tolerance * 0.3) return true; // Close enough — snap threshold

  // Leader moving? Followers should continuously track, no dead zone.
  const leader = unit._formationLeader;
  const leaderMoving = leader && leader._movedThisFrame;

  if (leaderMoving || deviation > tolerance * 0.5) {
    // Match leader speed when tracking; urgency scales when far out of position
    const urgency = Math.min(1.0, deviation / (tolerance * 3));
    const speedMult = leaderMoving && deviation <= tolerance
      ? 1.0   // Match leader speed exactly (formation speed cap ensures same base)
      : 0.5 + urgency * 0.5;  // Catching up
    moveBrainUnit(b, unit, slotTarget.x, slotTarget.y, dtSec, friendlies, speedMult);
  }

  return false;
}

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

  // Formation stress — personality-driven breaking
  const teamKey = alive[0].team === 'enemy' ? 'red' : 'blue';
  if (!b._formationStress) b._formationStress = {};
  let stress = b._formationStress[teamKey] ?? 0;

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
  b._formationStress[teamKey] = stress;

  // Break threshold: disciplined teams hold longer
  const breakThreshold = 0.5 + avgDiscipline * 0.3;
  if (stress >= breakThreshold) {
    for (const u of alive) u._inFormation = false;
    const fs = b._formationState?.[teamKey];
    if (fs?.assigned && b._debugLog) {
      b._debugLog.push({ t: now, who: alive[0].id, team: teamKey, type: 'formation',
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
  const teamState = formationState[teamKey] = formationState[teamKey] || {};

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
    // Face direction of movement (leader's angle)
    formationAngle = leader.angle || 0;
  }

  // Discipline affects spacing (high = tight, low = loose)
  // avgDiscipline already computed above in stress section
  const spacingMult = 0.8 + (1 - avgDiscipline) * 0.6; // 0.8x (high disc) to 1.4x (low)

  // Terrain spacing modifier
  if (leaderTerrain === 'forest') {
    formationState[teamKey].spacingMult = spacingMult * 1.5;
  } else {
    formationState[teamKey].spacingMult = spacingMult;
  }
  const finalSpacing = formationState[teamKey].spacingMult;

  // Assign slots (only reassign periodically or when composition changes)
  if (teamState.leader !== leader.id || teamState.count !== aliveCount
      || teamState.formation !== formationType || !teamState.assigned) {
    assignFormationSlots(alive, formationType, leader, leaderTerrain, formationAngle, finalSpacing);
    teamState.leader = leader.id;
    teamState.count = aliveCount;
    teamState.formation = formationType;
    teamState.assigned = true;

    // Log formation change with slot assignments
    if (b._debugLog) {
      const offsets = FORMATION_OFFSETS[formationType] || FORMATION_OFFSETS.line;
      const slotDetails = alive.filter(u => u !== leader).map(u => {
        const pos = slotWorldPos(offsets[Math.min(u._formationSlot, offsets.length - 1)], leader, formationAngle, finalSpacing);
        return `${u.id}→s${u._formationSlot}(${Math.round(pos.x)},${Math.round(pos.y)}) d=${Math.round(Math.hypot(pos.x - u.x, pos.y - u.y))}`;
      }).join(' ');
      b._debugLog.push({ t: now, who: leader.id, team: teamKey, type: 'formation',
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
  if (b._debugLog && now - (teamState.lastTelemetry || 0) > 4000) {
    teamState.lastTelemetry = now;
    const followers = alive.filter(u => u !== leader && u._slotTarget);
    const maxDev = followers.reduce((mx, f) => Math.max(mx, Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y)), 0);
    const avgDev = followers.length > 0 ? followers.reduce((s, f) => s + Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y), 0) / followers.length : 0;
    const xSpread = alive.length > 1 ? Math.max(...alive.map(u => u.x)) - Math.min(...alive.map(u => u.x)) : 0;
    const devList = followers.map(f => `${f.id}:${Math.round(Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y))}`).join(' ');
    b._debugLog.push({ t: now, who: leader.id, team: teamKey, type: 'formation',
      x: Math.round(leader.x), y: Math.round(leader.y),
      action: 'formation_state',
      detail: `wMul:${(leader._formationWaitMult ?? 1).toFixed(2)} maxDev:${Math.round(maxDev)} avgDev:${Math.round(avgDev)} xSpd:${Math.round(xSpread)} ang:${Math.round(formationAngle * 180 / Math.PI)}° | ${devList}` });
  }
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
  unit._movementMode = mode;

  // Formation leader wait — smooth speed ramp based on follower deviation
  if (unit._inFormation && unit === unit._formationLeader) {
    const followers = friendlies.filter(f => !f.dead && f._formationLeader === unit && f !== unit);
    if (followers.length > 0) {
      const spacing = unit._formationSpacing ?? 1;
      const tolerance = 40 * spacing * 1.2;
      const maxDev = followers.reduce((mx, f) => {
        if (!f._slotTarget) return mx;
        return Math.max(mx, Math.hypot(f._slotTarget.x - f.x, f._slotTarget.y - f.y));
      }, 0);

      // Smooth ramp: speed scales continuously with deviation
      // devNorm=0 → 1.0 speed, devNorm=1 → 0.4 speed, devNorm≥1.5 → near-stop
      const devNorm = maxDev / tolerance;
      const leadership = unit.leadership ?? 0;
      const aggression = unit.personality?.aggression ?? 0.5;
      const patienceMod = leadership * 0.15 - aggression * 0.1; // -0.1 to +0.15
      const rawSpeed = 1 - devNorm * (0.6 + patienceMod);
      const formUpSpeed = Math.max(0.05, Math.min(1, rawSpeed));
      unit._formationWaitMult = formUpSpeed;
      if (devNorm > 0.5) unit._actionVerb = 'waiting_for_squad';
    }
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

    case MovementMode.FORMATION_MOVE:
      executeFormationMode(b, unit, ctx, range, now, dtSec, friendlies);
      break;

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
  const isBlue = unit.team !== 'enemy';
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
 * PANIC_FLEE — run toward own spawn zone at sprint speed
 */
function executePanicFlee(b, unit, ctx, speed, dtSec, friendlies) {
  unit._actionVerb = 'panicking';
  const isBlue = unit.team !== 'enemy';
  const ownZone = isBlue ? b.blueSpawnZone : b.redSpawnZone;
  let fleeX, fleeY;
  if (ownZone) {
    fleeX = ownZone.x;
    fleeY = ownZone.y;
  } else {
    const mapW = b.mapWidth || 2000;
    fleeX = isBlue ? 50 : mapW - 50;
    fleeY = unit.y;
  }
  moveBrainUnit(b, unit, fleeX, fleeY, dtSec, friendlies, 1.2);
}

/**
 * URGENT_COVER — sprint to nearest cover, snap-fire while running
 */
function executeUrgentCover(b, unit, ctx, range, now, dtSec, friendlies) {
  // Use existing sprint-to-cover if we have a target (it handles cover + firing)
  if (ctx.target && ctx.nearestCover) {
    // Sprint to cover position
    const arrived = moveBrainUnit(b, unit, ctx.nearestCover.x, ctx.nearestCover.y, dtSec, friendlies, 1.3);
    unit._actionVerb = arrived ? 'in_cover' : 'sprinting_to_cover';

    // Snap-fire while running
    if (ctx.target && ctx.targetDist <= range * 0.8) {
      unit.angle = Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x);
      tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
    }
  } else if (ctx.nearestCover) {
    moveBrainUnit(b, unit, ctx.nearestCover.x, ctx.nearestCover.y, dtSec, friendlies, 1.3);
    unit._actionVerb = 'sprinting_to_cover';
  } else {
    // No cover — go prone if infantry, otherwise just hunker
    const category = inferCategory(unit);
    if (CATEGORY_SKILLS[category]?.canGoProne) {
      unit._isProne = true;
      unit._actionVerb = 'prone';
    } else {
      unit._actionVerb = 'hunkered';
    }
  }
}

/**
 * FORMATION_MOVE — maintain slot, fire at targets
 */
function executeFormationMode(b, unit, ctx, range, now, dtSec, friendlies) {
  if (unit._slotTarget) {
    const atSlot = maintainFormation(b, unit, unit._slotTarget, dtSec, friendlies);
    unit._actionVerb = atSlot ? 'in_formation' : 'forming_up';
  }

  // Fire at targets while in formation
  if (ctx.target && ctx.targetDist <= range * 1.5) {
    unit.angle = Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x);
    if (tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target)) {
      unit._actionVerb = 'firing';
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
    // No target — advance toward waypoint or enemy base
    const teamKey = unit.team || 'player';
    const wp = b._teamWaypoints?.[teamKey];
    const commanderAlive = b._teamCommanders?.[teamKey]?.dead === false;
    if (wp && commanderAlive) {
      objX = wp.x; objY = wp.y;
    } else {
      // Default objective: enemy spawn zone or opposite edge
      const enemyZone = unit.team === 'enemy' ? b.blueSpawnZone : b.redSpawnZone;
      if (enemyZone) {
        objX = enemyZone.x; objY = enemyZone.y;
      } else {
        const mapW = b.mapWidth || 2000;
        const mapH = b.mapHeight || 2000;
        objX = mapW / 2;
        objY = unit.team === 'enemy' ? mapH - 128 : 128;
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
    unit.angle = Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x);
    tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
  }
}

/**
 * COMMAND_EXECUTE — directly execute the active command
 */
function executeCommandMode(b, unit, ctx, range, speed, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;

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
 * REGROUP — fall back toward nearest ally
 */
function executeRegroupMode(b, unit, ctx, range, now, dtSec, friendlies) {
  unit._actionVerb = 'regrouping';
  if (ctx.nearestAlly) {
    moveBrainUnit(b, unit, ctx.nearestAlly.x, ctx.nearestAlly.y, dtSec, friendlies, 0.9);
  }

  // Fire while regrouping
  if (ctx.target && ctx.targetDist <= range) {
    unit.angle = Math.atan2(ctx.target.y - unit.y, ctx.target.x - unit.x);
    tryShoot(b, unit, ctx.target.x, ctx.target.y, now, ctx.target);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMAND EXECUTORS
// Each implements a specific command. Stats + personality shape HOW.
// ═══════════════════════════════════════════════════════════════

/**
 * HOLD — Stay put, defend position. Cover-seeking handled by general awareness system.
 */
function executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies) {
  unit._actionVerb = 'holding';

  // Fire at target in range
  if (target && targetDist <= range * 1.5) {
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
    if (tryShoot(b, unit, target.x, target.y, now, target)) {
      unit._actionVerb = 'firing';
    }
  }
}

/**
 * ADVANCE — Push toward enemies. Personality determines engagement distance.
 */
function executeAdvance(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  unit._actionVerb = 'advancing';
  const p = unit.personality || {};

  // Engagement distance: patient units stop further, aggressive push closer
  const engageDist = range * (0.6 + (p.patience || 0.5) * 0.6);

  if (!target) {
    // No target — advance toward waypoint or enemy base
    const teamKey = unit.team || 'player';
    const wp = b._teamWaypoints?.[teamKey];
    const commanderAlive = b._teamCommanders?.[teamKey]?.dead === false;
    let cx, cy;
    if (wp && commanderAlive) {
      cx = wp.x; cy = wp.y;
    } else {
      // Default objective: enemy spawn zone or opposite edge
      const enemyZone = unit.team === 'enemy' ? b.blueSpawnZone : b.redSpawnZone;
      if (enemyZone) {
        cx = enemyZone.x; cy = enemyZone.y;
      } else {
        const mapW = b.mapWidth || 1600;
        const mapH = b.mapHeight || 1600;
        cx = mapW / 2;
        cy = unit.team === 'enemy' ? mapH - 128 : 128;
      }
    }
    // Update facing toward objective so formation angle tracks movement direction
    unit.angle = Math.atan2(cy - unit.y, cx - unit.x);
    moveBrainUnit(b, unit, cx, cy, dtSec, friendlies);
    return;
  }

  // Desired hold distance: aggressive units push to 40% of engage range, cautious stay at 80%
  const agg = p.aggression || 0.5;
  const holdDist = engageDist * (0.4 + (1 - agg) * 0.5);

  if (targetDist > engageDist) {
    // Out of engagement range — push toward target
    unit._isBackingOff = false;
    moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
  } else if ((targetDist < holdDist * 0.6 && agg < 0.6) ||
             (unit._isBackingOff && targetDist < holdDist * 0.85)) {
    // Too close for a non-aggressive unit — reposition to desired hold distance
    // Hysteresis: once backing off, continue until reaching 85% of holdDist
    unit._isBackingOff = true;
    const d = targetDist || 1;
    const backX = target.x + ((unit.x - target.x) / d) * holdDist;
    const backY = target.y + ((unit.y - target.y) / d) * holdDist;
    moveBrainUnit(b, unit, backX, backY, dtSec, friendlies);
    unit._actionVerb = 'repositioning';
    // Log personality decision (once per backoff decision)
    if (b._debugLog && !unit._lastDecisionLog?.backoff) {
      const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
      b._debugLog.push({ t: Date.now(), who: unit.id, team: logTeam, type: 'decision',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: 'backing off (low aggression)', detail: `agg:${agg.toFixed(2)} dist:${Math.round(targetDist)} holdDist:${Math.round(holdDist)}` });
      if (!unit._lastDecisionLog) unit._lastDecisionLog = {};
      unit._lastDecisionLog.backoff = true;
    }
  } else {
    // In comfortable zone — hold position
    unit._isBackingOff = false;
    if (unit._lastDecisionLog) unit._lastDecisionLog.backoff = false;
  }

  // Fire at target
  unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
  if (tryShoot(b, unit, target.x, target.y, now, target)) {
    unit._actionVerb = 'firing';
  }
}

/**
 * FOLLOW — Stay behind leader, fire at targets of opportunity.
 */
function executeFollow(b, unit, leader, target, targetDist, range, speed, now, dtSec, friendlies) {
  unit._actionVerb = 'following';

  if (!leader || leader.dead) {
    // No leader — default to hold
    executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies);
    return;
  }

  const leaderDist = distanceBetween(unit, leader);
  const followDist = 80;

  if (leaderDist > followDist * 2.5) {
    // Far from leader — catch up
    const behindX = leader.x - Math.cos(leader.angle || 0) * followDist;
    const behindY = leader.y - Math.sin(leader.angle || 0) * followDist;
    moveBrainUnit(b, unit, behindX, behindY, dtSec, friendlies);
  } else if (leaderDist > followDist) {
    // Gentle approach
    moveBrainUnit(b, unit, leader.x, leader.y, dtSec, friendlies, 0.7);
  }

  // Fire at targets of opportunity
  if (target && targetDist <= range * 1.2) {
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
    if (tryShoot(b, unit, target.x, target.y, now, target)) {
      unit._actionVerb = 'firing';
    }
  }
}

/**
 * FALL_BACK — Retreat toward personality-driven objective, fire over shoulder.
 * Aggressive units push to enemy base and dig in.
 * Cautious units fall back to own base and dig in.
 * Sergeant waypoint overrides if available.
 */
function executeFallBack(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  // Resolve objective: sergeant waypoint > personality-driven destination
  const teamKey = unit.team === 'enemy' ? 'enemy' : 'player';
  const wp = b._teamWaypoints?.[teamKey];
  const commanderAlive = b._teamCommanders?.[teamKey]?.dead === false;
  let objX, objY;

  if (wp && commanderAlive) {
    objX = wp.x;
    objY = wp.y;
  } else {
    const obj = resolveRetreatObjective(b, unit);
    objX = obj.x;
    objY = obj.y;
  }

  const distToObj = Math.hypot(objX - unit.x, objY - unit.y);

  if (distToObj < 150) {
    // Near objective — dig in: find cover and hold position
    unit._actionVerb = 'digging_in';

    // Search for cover nearby (wider search when digging in)
    const coverPos = findNearbyCoverPos(b, unit, 4, friendlies);
    if (coverPos) {
      const arrived = moveBrainUnit(b, unit, coverPos.x, coverPos.y, dtSec, friendlies);
      if (arrived) {
        unit._actionVerb = 'dug_in';
        // Infantry goes prone when dug in
        const cat = inferCategory(unit);
        if (cat === UnitCategory.INFANTRY) unit._isProne = true;
      }
    }
    // else already at objective, just hold

    // Fire at targets from position
    if (target && targetDist <= range) {
      unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  } else {
    // Moving toward objective
    unit._actionVerb = 'retreating';
    moveBrainUnit(b, unit, objX, objY, dtSec, friendlies);

    // Fire over shoulder if in range
    if (target && targetDist <= range) {
      unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
}

/**
 * COVER_ME — Stay in position, suppress targets near leader. Cover handled by awareness system.
 */
function executeCoverMe(b, unit, leader, target, targetDist, range, now, dtSec, friendlies) {
  unit._actionVerb = 'covering';

  if (!leader || leader.dead) {
    executeHold(b, unit, target, targetDist, range, now, dtSec, friendlies);
    return;
  }

  // Suppress targets — fire aggressively even at longer range
  if (target && targetDist <= range * 1.8) {
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
    if (tryShoot(b, unit, target.x, target.y, now, target)) {
      unit._actionVerb = 'suppressing';
    }
  }
}

/**
 * FOCUS_FIRE — Everyone targets the same enemy. Move into range if needed.
 */
function executeFocusFire(b, unit, target, targetDist, range, speed, now, dtSec, friendlies) {
  unit._actionVerb = 'focusing';

  if (!target) {
    unit._actionVerb = 'idle';
    return;
  }

  // Move into range if needed
  if (targetDist > range * 1.2) {
    moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies);
  }

  // Fire at target
  unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
  if (tryShoot(b, unit, target.x, target.y, now, target)) {
    unit._actionVerb = 'firing';
  }
}

// ═══════════════════════════════════════════════════════════════
// SURVIVAL SYSTEM — Threat assessment + self-preservation actions
// ═══════════════════════════════════════════════════════════════

/**
 * Assess whether unit can survive engagement with current target.
 * Compares time-to-kill estimates. Awareness gates the danger threshold.
 * @param {object} unit - Firing unit
 * @param {object} target - Current target
 * @returns {{ survivalRatio: number, inDanger: boolean, action: string|null, myTTK: number, theirTTK: number }}
 */
function assessSurvival(unit, target) {
  if (!target || target.dead) return { survivalRatio: Infinity, inDanger: false, action: null };

  const myDmg = unit.damage || 10;
  const myFireRate = (unit.fireRate || 2000) / 1000;
  const myAccuracy = Math.max(0.3, unit.stability || 0.5);
  const myDPS = (myDmg / myFireRate) * myAccuracy;
  const myTTK = myDPS > 0 ? (target.hp || 60) / myDPS : Infinity;

  const theirDmg = target.damage || 10;
  const theirFireRate = (target.fireRate || 2000) / 1000;
  const theirDPS = (theirDmg / theirFireRate) * 0.5; // assume average enemy accuracy
  const theirTTK = theirDPS > 0 ? (unit.hp || 60) / theirDPS : Infinity;

  // survivalRatio < 1 means I die first
  const survivalRatio = myTTK > 0 ? theirTTK / myTTK : 0;

  // Danger threshold scaled by courage and awareness
  const courage = unit.personality?.courage ?? 0.5;
  const awareness = unit._awareness ?? 0.5;
  const dangerThreshold = (0.3 + courage * 0.5) * awareness;

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
      } else if (discipline > 0.6) {
        action = 'fall_back_to_allies';
      } else if (skills.canUseCover) {
        action = 'sprint_to_cover';
      } else {
        action = 'fall_back_to_allies';
      }
    } else if (category === UnitCategory.LIGHT_VEHICLE) {
      action = aggression > 0.6 ? 'reposition' : 'disengage';
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
 * Execute a survival action. Returns true if action was taken (command overridden).
 */
function executeSurvivalAction(b, unit, target, targetDist, range, survival, now, dtSec, friendlies) {
  const action = survival.action;
  if (!action) return false;

  switch (action) {
    case 'go_prone':       return executeProne(b, unit, target, targetDist, range, now);
    case 'sprint_to_cover': return executeSprintToCover(b, unit, target, targetDist, range, now, dtSec, friendlies);
    case 'fall_back_to_allies': return executeFallBackToAllies(b, unit, target, range, now, dtSec, friendlies);
    case 'disengage':      return executeDisengage(b, unit, target, dtSec, friendlies);
    case 'reposition':     return executeReposition(b, unit, target, range, now, dtSec, friendlies);
    case 'hull_down':      return executeHullDown(b, unit, target, targetDist, range, now);
    case 'charge':         return executeCharge(b, unit, target, targetDist, range, now, dtSec, friendlies);
    default: return false;
  }
}

function executeProne(b, unit, target, targetDist, range, now) {
  unit._isProne = true;
  unit._isHullDown = false;
  unit._actionVerb = 'prone';

  if (target && targetDist <= range * 1.5) {
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
    tryShoot(b, unit, target.x, target.y, now, target);
  }
  return true;
}

function executeSprintToCover(b, unit, target, targetDist, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'sprinting_to_cover';

  if (!unit._survivalCoverTarget) {
    unit._survivalCoverTarget = findNearbyCoverPos(b, unit);
  }

  if (unit._survivalCoverTarget) {
    const arrived = moveBrainUnit(b, unit, unit._survivalCoverTarget.x, unit._survivalCoverTarget.y, dtSec, friendlies, 1.3);
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
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
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
  }

  // Fire while retreating
  if (target) {
    const dist = distanceBetween(unit, target);
    if (dist <= range) {
      unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
  return true;
}

function executeDisengage(b, unit, target, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'disengaging';

  if (target) {
    const d = distanceBetween(unit, target) || 1;
    const retreatX = unit.x + ((unit.x - target.x) / d) * 300;
    const retreatY = unit.y + ((unit.y - target.y) / d) * 300;
    moveBrainUnit(b, unit, retreatX, retreatY, dtSec, friendlies);
  }
  return true;
}

function executeReposition(b, unit, target, range, now, dtSec, friendlies) {
  unit._isProne = false;
  unit._isHullDown = false;
  unit._actionVerb = 'repositioning';

  if (target) {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // Move perpendicular to threat
    if (!unit._repositionDir) {
      unit._repositionDir = Math.random() > 0.5 ? 1 : -1;
    }
    const perpX = unit.x + (-dy / dist) * 150 * unit._repositionDir;
    const perpY = unit.y + (dx / dist) * 150 * unit._repositionDir;
    const arrived = moveBrainUnit(b, unit, perpX, perpY, dtSec, friendlies);
    if (arrived) unit._repositionDir = null;

    // Fire while repositioning
    if (distanceBetween(unit, target) <= range) {
      unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
      tryShoot(b, unit, target.x, target.y, now, target);
    }
  }
  return true;
}

function executeHullDown(b, unit, target, targetDist, range, now) {
  unit._isHullDown = true;
  unit._isProne = false;
  unit._actionVerb = 'hull_down';

  if (target) {
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
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

  if (target) {
    moveBrainUnit(b, unit, target.x, target.y, dtSec, friendlies, 1.2);
    unit.angle = Math.atan2(target.y - unit.y, target.x - unit.x);
    if (targetDist <= range) {
      tryShoot(b, unit, target.x, target.y, now, target);
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
function checkFlankThreats(b, unit, hostiles, now) {
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

      if (b._debugLog) {
        const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
        b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'flank',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: `flanked by ${e.id}`,
          detail: `dist:${Math.round(dist)} angle:${Math.round(Math.abs(angleDiff) * 180 / Math.PI)}°` });
      }

      // High awareness: auto-rotate to face flanker
      if (awareness > 0.7) {
        unit.angle = angleToEnemy;
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
    if (b._debugLog) {
      const logTeam = unit.team === 'enemy' ? 'red' : 'blue';
      b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'decision',
        x: Math.round(unit.x), y: Math.round(unit.y),
        action: 'cover seek',
        detail: `awr:${awareness.toFixed(2)} radius:${searchRadius} cover@(${Math.round(coverPos.x)},${Math.round(coverPos.y)})` });
    }
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

  // 3. Morale panic check — low morale + low courage = forced retreat
  let activeCommand = unit.command || Command.ADVANCE;
  const courage = unit.personality?.courage ?? 0.5;
  if (unit.morale < 0.2 && courage < 0.4) {
    activeCommand = Command.FALL_BACK;
    unit._panicking = true;
    unit._inFormation = false; // Panic breaks formation
  } else {
    unit._panicking = false;
  }

  // 2.4. Decay suppression
  updateSuppression(unit, dtSec, b);

  // 2.5. Build spotted list — vision scan of all hostiles
  buildSpottedList(unit, hostiles, b, now);

  // 2.6. Compute cover bias — how much this unit prefers cover-to-cover movement
  unit._coverBias = computeCoverBias(unit, activeCommand);

  // 4. Select target (initiative-driven re-evaluation interval)
  const initiative = unit.personality?.initiative ?? 0.5;
  const reEvalInterval = 1500 - initiative * 1000; // 500ms (high) to 1500ms (low)
  let target;
  const prevTarget = unit._currentTarget;
  const prevTargetAlive = prevTarget && !prevTarget.dead && prevTarget.hp > 0;

  if (prevTargetAlive && now < (unit._targetLockedUntil || 0)) {
    // Keep current target (locked)
    target = prevTarget;
  } else {
    // Re-evaluate target
    target = selectBrainTarget(b, unit, hostiles, leader, activeCommand);
    unit._targetLockedUntil = now + reEvalInterval;
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
  if (target && !unit._panicking) {
    const survivalInterval = 800 - (unit._awareness ?? 0.5) * 300;
    if (now - (unit._lastSurvivalCheck || 0) > survivalInterval) {
      unit._lastSurvivalCheck = now;
      const survival = assessSurvival(unit, target);
      unit._lastSurvival = survival;
      // Log survival state changes
      if (survival.inDanger) {
        unit._survivalAction = survival.action;
        if (b._debugLog) {
          const logTeam = team === 'enemy' ? 'red' : 'blue';
          b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'survival',
            x: Math.round(unit.x), y: Math.round(unit.y),
            action: survival.action,
            detail: `ratio:${survival.survivalRatio.toFixed(2)} myTTK:${survival.myTTK.toFixed(1)}s theirTTK:${survival.theirTTK.toFixed(1)}s` });
        }
      } else {
        // Danger passed — clear survival state
        if (unit._survivalAction && b._debugLog) {
          const logTeam = team === 'enemy' ? 'red' : 'blue';
          b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'survival',
            x: Math.round(unit.x), y: Math.round(unit.y),
            action: 'survival_clear',
            detail: `ratio:${survival.survivalRatio.toFixed(2)} danger passed` });
        }
        unit._survivalAction = null;
        unit._isProne = false;
        unit._isHullDown = false;
        unit._survivalCoverTarget = null;
        unit._repositionDir = null;
      }
    }
  } else if (!target) {
    unit._isProne = false;
    unit._isHullDown = false;
    unit._survivalAction = null;
    unit._survivalCoverTarget = null;
    unit._repositionDir = null;
    unit._lastSurvival = null;
  }

  // 6. Unified movement — build context, resolve mode, execute
  const moveCtx = buildMovementContext(b, unit, target, targetDist, hostiles, friendlies, now, leader);
  unit._moveCtx = moveCtx; // Cache for moveBrainUnit threat speed calculation
  const modeResult = resolveMovementMode(unit, moveCtx);

  // Log mode changes with full score breakdown
  if (b._debugLog && unit._prevMovementMode !== modeResult.mode) {
    const logTeam = team === 'enemy' ? 'red' : 'blue';
    // Build compact score summary: UCvr:35 Surv:0 Fmt:50 Bnd:12 Cmd:40 Rgrp:5
    const scoreStr = modeResult.scores ? Object.entries(modeResult.scores)
      .map(([k, v]) => {
        const abbr = { urgent_cover: 'UCvr', survival_action: 'Surv', formation_move: 'Fmt',
          tactical_bound: 'Bnd', command_execute: 'Cmd', regroup: 'Rgrp' };
        return `${abbr[k] || k}:${Math.round(v)}`;
      }).join(' ') : '';
    b._debugLog.push({ t: now, who: unit.id, team: logTeam, type: 'movement',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: modeResult.mode,
      detail: `winner:${Math.round(modeResult.score)} [${scoreStr}] prev:${unit._prevMovementMode || 'none'}` });
    unit._prevMovementMode = modeResult.mode;
  }

  executeMovementMode(b, unit, modeResult, moveCtx, range, speed, now, dtSec, friendlies);

  // 6.7. Flank detection (awareness + initiative gated) — read-only, no movement
  checkFlankThreats(b, unit, hostiles, now);

  // 7. Track movement and update stability
  // Use a threshold so micro-adjustments (separation steering, float drift) don't count as movement
  const moveDist = Math.hypot(unit.x - prevX, unit.y - prevY);
  unit._movedThisFrame = moveDist > 1.5; // >1.5px = real movement (ignores formation micro-adjustments)
  const prevStab = unit.stability ?? 0;
  updateStability(unit, dtSec, typeKey);

  // 8. State-change event logging
  const unitTerrain = getTerrainAt(b, unit.x, unit.y);
  const inCover = unitTerrain === 'trench' || unitTerrain === 'pillbox';
  const prevDbg = unit._dbg || {};
  const log = b._debugLog;
  const logTeam = team === 'enemy' ? 'red' : 'blue';

  if (log) {
    const ux = Math.round(unit.x), uy = Math.round(unit.y);
    const prevTarget = prevDbg.targetId || null;
    const curTarget = target?.id || null;
    const prevAction = prevDbg.state || null;
    const curAction = unit._actionVerb || 'idle';

    // Target changed
    if (curTarget !== prevTarget) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'target', x: ux, y: uy,
        action: curTarget ? `target → ${curTarget}` : 'lost target',
        detail: prevTarget ? `was ${prevTarget}` : 'had none' });
    }
    // Action/state changed (skip firing transitions — fire event covers those)
    if (curAction !== prevAction && prevAction !== null
        && curAction !== 'firing' && prevAction !== 'firing') {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'action', x: ux, y: uy,
        action: `${prevAction} → ${curAction}` });
    }
    // Panic started/stopped
    if (unit._panicking && !prevDbg.panicking) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'panic', x: ux, y: uy,
        action: 'PANIC', detail: `morale:${(unit.morale||0).toFixed(2)} crg:${courage.toFixed(2)}` });
    } else if (!unit._panicking && prevDbg.panicking) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'panic', x: ux, y: uy,
        action: 'panic over', detail: `morale:${(unit.morale||0).toFixed(2)}` });
    }
    // Morale threshold crossings (check every update, but only log on cross)
    const mrl = unit.morale ?? 0.8;
    const prevMrl = prevDbg._rawMorale ?? mrl;
    if (prevMrl >= 0.5 && mrl < 0.5) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'morale', x: ux, y: uy,
        action: 'morale LOW', detail: mrl.toFixed(2) });
    } else if (prevMrl < 0.5 && mrl >= 0.5) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'morale', x: ux, y: uy,
        action: 'morale recovered', detail: mrl.toFixed(2) });
    }
    if (prevMrl >= 0.2 && mrl < 0.2) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'morale', x: ux, y: uy,
        action: 'morale CRITICAL', detail: mrl.toFixed(2) });
    }
    // Cover entered/left
    if (inCover && !prevDbg.inCover) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'cover', x: ux, y: uy, action: 'entered cover', detail: unitTerrain });
    } else if (!inCover && prevDbg.inCover) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'cover', x: ux, y: uy, action: 'left cover' });
    }
    // Movement start/stop
    const wasMoving = prevDbg._moving || false;
    if (unit._movedThisFrame && !wasMoving) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'move', x: ux, y: uy, action: 'started moving',
        detail: `stab:${prevStab.toFixed(2)}→decaying` });
    } else if (!unit._movedThisFrame && wasMoving) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'move', x: ux, y: uy,
        action: 'stopped', detail: `stab:${(unit.stability||0).toFixed(2)} zeroing in...` });
    }
    // Stability threshold crossings
    const curStab = unit.stability || 0;
    if (prevStab < 0.95 && curStab >= 0.95) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'stability', x: ux, y: uy,
        action: 'zeroed in', detail: `stab:${curStab.toFixed(2)} type:${typeKey}` });
    } else if (prevStab >= 0.5 && curStab < 0.5) {
      log.push({ t: now, who: unit.id, team: logTeam, type: 'stability', x: ux, y: uy,
        action: 'stability lost', detail: `stab:${curStab.toFixed(2)} (moving)` });
    }
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
    waitMult: unit._formationWaitMult != null ? +unit._formationWaitMult.toFixed(2) : null,
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
    _moving: unit._movedThisFrame,
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
  updateBrain(b, unit, hero, enemies, b.units || [], now, dtSec, 'player');
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
  updateBrain(b, enemy, null, hostiles, b.enemies || [], now, dtSec, 'enemy');
}

/**
 * Share spotted intel between friendly units via cohesion.
 * Call once per frame per team, AFTER all individual brain updates.
 * Nearby allies share their _spotted lists. Quality scales with receiver's awareness.
 * Scouts (hasRecon) share at 2x cohesion range.
 */
export function shareTeamIntel(friendlies, now) {
  const COHESION_RANGE = 120;
  const SCOUT_MULT = 2.0;

  for (const unit of friendlies) {
    if (unit.dead) continue;
    if (!unit._spotted || unit._spotted.length === 0) continue;

    const isScout = CATEGORY_SKILLS[inferCategory(unit)]?.hasRecon || false;
    const shareRange = isScout ? COHESION_RANGE * SCOUT_MULT : COHESION_RANGE;

    for (const ally of friendlies) {
      if (ally === unit || ally.dead) continue;
      const d = distanceBetween(unit, ally);
      if (d > shareRange) continue;

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

export function tryShoot(b, unit, targetX, targetY, now, targetEntity) {
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
  // Suppression reduces accuracy (max 30% penalty)
  const suppressionAccPenalty = 1 - (unit._suppression ?? 0) * 0.3;
  const accuracy = fireDecision.accuracy * suppressionAccPenalty;
  const maxSpread = Math.PI / 6;
  const spread = (1.0 - accuracy) * maxSpread;
  const angle = baseAngle + (Math.random() - 0.5) * 2 * spread;

  const projSpeed = unit.projectileSpeed || 400;
  b.projectiles.push({
    x: unit.x,
    y: unit.y,
    vx: Math.cos(angle) * projSpeed,
    vy: Math.sin(angle) * projSpeed,
    damage,
    owner: unit.team || (unit.isHero ? 'player' : 'player'),
    sourceId: unit.id,
    attackerTier: getArmorTier(unit),
    type: projType
  });

  if (b._debugLog) {
    const factorStr = fireDecision.factors
      ? fireDecision.factors.map(f => `${f.name}:${f.value.toFixed(2)}`).join(' ')
      : `stab:${(unit.stability||0).toFixed(2)}`;
    b._debugLog.push({
      t: now,
      who: unit.id,
      team: unit.team === 'enemy' ? 'red' : 'blue',
      type: 'fire',
      x: Math.round(unit.x), y: Math.round(unit.y),
      action: 'fire',
      target: targetEntity?.id || '?',
      acc: accuracy.toFixed(2),
      dmg: damage,
      detail: `${factorStr} dist:${Math.round(Math.sqrt(dx*dx+dy*dy))}`
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
