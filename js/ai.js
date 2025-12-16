// ═══════════════════════════════════════════════════════════════
// AI - Unit AI behavior, state machines, and order execution
// ═══════════════════════════════════════════════════════════════

import { UNITS, UNIT_PROJECTILES } from './constants.js';
import { findPath, findNearestCover, pathToWorld, worldToGrid, smoothPath } from './pathfinding.js';

// AI States for units
export const AIState = {
  IDLE: 'idle',           // No orders, stationary
  MOVING: 'moving',       // Moving to waypoint
  ATTACKING: 'attacking', // Engaging enemy
  DEFENDING: 'defending', // Hold position, attack in range
  FOLLOWING: 'following', // Follow hero
  RETREATING: 'retreating', // Fall back when low HP
  COVERING: 'covering'    // Provide cover fire
};

// Order types for command system
export const OrderType = {
  MOVE_TO: 'move_to',         // Move to position
  HOLD_POSITION: 'hold',      // Stay at current position
  DEFEND_AREA: 'defend',      // Defend radius around position
  FOLLOW_HERO: 'follow',      // Follow player hero
  ATTACK_TARGET: 'attack',    // Attack specific target
  PATROL: 'patrol',           // Move between waypoints
  COVER_FIRE: 'cover'         // Suppressive fire in direction
};

// Tactical commands available to player (for UI and input handling)
export const TacticalCommand = {
  FOLLOW: { key: '1', label: 'Follow', icon: '👥', state: 'following' },
  HOLD: { key: '2', label: 'Hold', icon: '🛡️', state: 'defending' },
  ATTACK: { key: '3', label: 'Attack', icon: '⚔️', state: 'attacking' },
  MOVE: { key: '4', label: 'Move', icon: '🎯', state: 'moving', needsTarget: true },
  RETREAT: { key: '5', label: 'Retreat', icon: '↩️', state: 'retreating' }
};

// ═══════════════════════════════════════════════════════════════
// AI BEHAVIOR PRESETS - Customizable unit behaviors
// ═══════════════════════════════════════════════════════════════

export const AIBehavior = {
  // Aggressive: pursues enemies, advances on targets
  AGGRESSIVE: {
    retreatThreshold: 0.15,    // Retreat at 15% HP
    engageRange: 1.2,          // Engage enemies at 120% of weapon range
    advanceWhenBlocked: true,  // Move closer when can't shoot
    prioritizeWeak: false,     // Target nearest, not weakest
    holdFireWhenMoving: false  // Shoot while moving
  },

  // Defensive: holds position, prioritizes survival
  DEFENSIVE: {
    retreatThreshold: 0.35,    // Retreat at 35% HP
    engageRange: 0.9,          // Only engage at 90% of range
    advanceWhenBlocked: false, // Stay in position
    prioritizeWeak: true,      // Finish off weak enemies
    holdFireWhenMoving: false
  },

  // Support: follows hero closely, provides covering fire
  SUPPORT: {
    retreatThreshold: 0.25,
    engageRange: 1.0,
    advanceWhenBlocked: false,
    prioritizeWeak: false,
    holdFireWhenMoving: true,  // Focus on movement over shooting
    followDistance: 80         // Stay close to hero
  },

  // Sniper: long range, stays back, prioritizes high-value targets
  SNIPER: {
    retreatThreshold: 0.40,    // Very cautious
    engageRange: 1.5,          // Engage from max range
    advanceWhenBlocked: false, // Never advance
    prioritizeWeak: false,
    preferDistance: 250,       // Preferred distance from enemies
    holdFireWhenMoving: true
  },

  // Flanker: mobile, tries to attack from sides
  FLANKER: {
    retreatThreshold: 0.20,
    engageRange: 1.0,
    advanceWhenBlocked: true,
    prioritizeWeak: true,
    preferFlank: true,         // Tries to flank enemies
    holdFireWhenMoving: false
  }
};

// ═══════════════════════════════════════════════════════════════
// ENEMY AI TYPES - Different enemy behaviors
// ═══════════════════════════════════════════════════════════════

export const EnemyAIType = {
  // Basic: balanced behavior, moderate memory
  BASIC: {
    speed: 1.0,
    aggression: 0.5,      // Moderate aggro decay (7.5 dmg/sec)
    attackRange: 60,
    retreatHP: 0          // Never retreats
  },

  // Rusher: fast, impulsive, short memory
  RUSHER: {
    speed: 1.4,
    aggression: 1.0,      // Fast aggro decay (15 dmg/sec) - impulsive
    attackRange: 40,      // Gets very close
    retreatHP: 0
  },

  // Hunter: methodical, longer memory
  HUNTER: {
    speed: 1.0,
    aggression: 0.6,      // Moderate-fast decay
    attackRange: 80,
    retreatHP: 0.1
  },

  // Cautious: paranoid, long memory, holds grudges
  CAUTIOUS: {
    speed: 0.8,
    aggression: 0.3,      // Slow aggro decay (8 dmg/sec) - paranoid
    attackRange: 120,
    retreatHP: 0.4,
    preferDistance: 100
  },

  // Flanker: tries to approach from sides
  FLANKER: {
    speed: 1.2,
    aggression: 0.7,
    attackRange: 60,
    retreatHP: 0.2,
    flankAngle: Math.PI / 3  // 60 degree offset
  }
};

// ═══════════════════════════════════════════════════════════════
// THREAT & AGGRO SYSTEM
// ═══════════════════════════════════════════════════════════════

// Weapon categories for counter-based threat calculation
const WEAPON_CATEGORY = {
  // Small arms - low threat to armor
  SMALL_ARMS: { antiArmor: 0.2, antiInfantry: 1.0 },
  // Anti-armor weapons - high threat to armor
  ANTI_ARMOR: { antiArmor: 1.5, antiInfantry: 0.8 },
  // Artillery - threat to everything
  ARTILLERY: { antiArmor: 1.2, antiInfantry: 1.5 },
  // Laser/precision - balanced
  PRECISION: { antiArmor: 0.8, antiInfantry: 1.2 }
};

// Map projectile types to weapon categories
const PROJECTILE_TO_CATEGORY = {
  bullet: 'SMALL_ARMS',
  rifle: 'SMALL_ARMS',
  missile: 'ANTI_ARMOR',
  shell: 'ANTI_ARMOR',
  cannon: 'ANTI_ARMOR',
  artillery: 'ARTILLERY',
  laser: 'PRECISION'
};

// Enemy armor classes
const ENEMY_ARMOR_CLASS = {
  infantry: 'SOFT',      // grunt
  jeep: 'SOFT',          // scout
  sherman: 'ARMORED',    // heavy
  tiger: 'ARMORED'       // elite
};

// How armor class affects incoming threat perception
const ARMOR_THREAT_MODIFIER = {
  SOFT: { SMALL_ARMS: 1.0, ANTI_ARMOR: 1.0, ARTILLERY: 1.2, PRECISION: 1.0 },
  ARMORED: { SMALL_ARMS: 0.2, ANTI_ARMOR: 1.5, ARTILLERY: 1.0, PRECISION: 0.6 }
};

// Hero's weapon category based on MOS
const HERO_MOS_WEAPON = {
  infantry: 'SMALL_ARMS',
  cavalry: 'ANTI_ARMOR',
  naval: 'ANTI_ARMOR',
  aviation: 'ANTI_ARMOR',
  artillery: 'ARTILLERY'
};

// Vision cone settings
const VISION_CONE_ANGLE = Math.PI * 2 / 3;  // 120 degrees
const VISION_RANGE = 250;  // pixels

// Get hero's weapon category from MOS
function getHeroWeaponCategory(hero) {
  return HERO_MOS_WEAPON[hero.mos] || 'SMALL_ARMS';
}

// Calculate distance between two entities
function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Check if target is within enemy's vision cone
function isInVisionCone(enemy, target) {
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > VISION_RANGE) return false;

  const angleToTarget = Math.atan2(dy, dx);
  const enemyAngle = enemy.angle || 0;
  let angleDiff = angleToTarget - enemyAngle;

  // Normalize to -PI to PI
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  return Math.abs(angleDiff) <= VISION_CONE_ANGLE / 2;
}

// Calculate threat score for a potential target
function calculateThreat(enemy, target, recentDamage = 0) {
  // Get enemy's armor class
  const enemyArmor = ENEMY_ARMOR_CLASS[enemy.unitId] || 'SOFT';

  // Get target's weapon category
  let targetWeapon;
  if (target.isHero) {
    targetWeapon = getHeroWeaponCategory(target);
  } else {
    // Look up projectile type from UNIT_PROJECTILES if not set directly
    const projType = target.projectileType || UNIT_PROJECTILES[target.unitId] || 'bullet';
    targetWeapon = PROJECTILE_TO_CATEGORY[projType] || 'SMALL_ARMS';
  }

  // Base threat from counter potential (can this target hurt me?)
  const counterMod = ARMOR_THREAT_MODIFIER[enemyArmor]?.[targetWeapon] || 1.0;
  const baseThreat = counterMod * 2;

  // Damage-based awareness (proportional to damage taken)
  const damageThreat = recentDamage > 0
    ? (recentDamage / enemy.maxHp) * 5 * counterMod
    : 0;

  // Proximity bonus (closer = more threatening)
  const dist = distanceBetween(enemy, target);
  const proximityThreat = Math.max(0, (300 - dist) / 150);

  // Desperation: low HP enemies are more reactive
  const hpRatio = enemy.hp / enemy.maxHp;
  const desperation = hpRatio < 0.3 ? 1.5 : (hpRatio < 0.6 ? 1.2 : 1.0);

  // Low HP targets are more attractive (finish them off)
  const targetVulnerability = target.hp && target.maxHp
    ? (1 - target.hp / target.maxHp) * 0.5
    : 0;

  return (baseThreat + damageThreat + proximityThreat + targetVulnerability) * desperation;
}

// Get aggro decay rate based on enemy personality (aggression stat)
function getAggroDecayRate(enemy) {
  const aiType = enemy.aiType || EnemyAIType.BASIC;
  const aggression = aiType.aggression || 0.5;

  // More aggressive = faster decay (impulsive, moves on quickly)
  // Less aggressive = slower decay (paranoid, holds grudge)
  // Range: 5-15 damage per second decay
  return 5 + aggression * 10;
}

// Decay damage memory over time
function decayDamageMemory(enemy, dtSec) {
  if (!enemy.recentDamageFrom) return;
  const decayRate = getAggroDecayRate(enemy);

  for (const id in enemy.recentDamageFrom) {
    enemy.recentDamageFrom[id] -= decayRate * dtSec;
    if (enemy.recentDamageFrom[id] <= 0) {
      delete enemy.recentDamageFrom[id];
    }
  }
}

// Record damage dealt to an enemy (for aggro tracking)
export function recordDamage(enemy, sourceId, amount) {
  if (!enemy.recentDamageFrom) enemy.recentDamageFrom = {};
  enemy.recentDamageFrom[sourceId] = (enemy.recentDamageFrom[sourceId] || 0) + amount;
}

// Select best target using threat-based system
export function selectTarget(enemy, hero, allies) {
  const candidates = [];

  // Evaluate all player units (allies)
  for (const ally of allies) {
    if (ally.dead) continue;
    const threat = calculateThreat(enemy, ally, enemy.recentDamageFrom?.[ally.id] || 0);
    candidates.push({ target: ally, threat, isHero: false });
  }

  // Evaluate hero (only if conditions are met)
  const heroVisible = isInVisionCone(enemy, hero);
  const heroDamagedUs = (enemy.recentDamageFrom?.hero || 0) > 0;
  const noOtherTargets = candidates.length === 0;

  if (heroVisible || heroDamagedUs || noOtherTargets) {
    const heroTarget = { ...hero, isHero: true };
    const heroThreat = calculateThreat(enemy, heroTarget, enemy.recentDamageFrom?.hero || 0);
    candidates.push({ target: hero, threat: heroThreat, isHero: true });
  }

  if (candidates.length === 0) return null;

  // Sort by threat (descending), then by target HP (ascending) for tiebreaker
  candidates.sort((a, b) => {
    if (Math.abs(a.threat - b.threat) < 0.1) {
      // Threat nearly equal - target lowest HP
      const aHpRatio = a.target.hp / a.target.maxHp;
      const bHpRatio = b.target.hp / b.target.maxHp;
      return aHpRatio - bHpRatio;
    }
    return b.threat - a.threat;
  });

  return candidates[0].target;
}

// ═══════════════════════════════════════════════════════════════
// ENTITY COLLISION SYSTEM
// ═══════════════════════════════════════════════════════════════

// Entity sizes (radius) matching visual icon sizes
export const ENTITY_RADIUS = {
  hero: 20,      // 40x40 icon
  ally: 20,      // 40x40 icon
  enemy: 15,     // 30x30 icon
  projectile: 4  // 8x8 icon
};

// Check if two entities are colliding (circles)
export function entitiesCollide(a, b, radiusA, radiusB) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distSq = dx * dx + dy * dy;
  const minDist = radiusA + radiusB;
  return distSq < minDist * minDist;
}

// Check if a position would collide with any entity in a list
export function wouldCollide(x, y, radius, entities, excludeId = null) {
  for (const e of entities) {
    if (e.dead) continue;
    if (excludeId && e.id === excludeId) continue;

    const otherRadius = e.radius || ENTITY_RADIUS.enemy;
    const dx = x - e.x;
    const dy = y - e.y;
    const distSq = dx * dx + dy * dy;
    const minDist = radius + otherRadius;

    if (distSq < minDist * minDist) {
      return e; // Return the entity we'd collide with
    }
  }
  return null;
}

// Get separation vector to push apart overlapping entities
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
      // Push away from the other entity
      sepX += (dx / dist) * overlap * 0.5;
      sepY += (dy / dist) * overlap * 0.5;
    }
  }

  return { x: sepX, y: sepY };
}

// ═══════════════════════════════════════════════════════════════
// TERRAIN HELPERS
// ═══════════════════════════════════════════════════════════════

export function isTerrainBlocked(b, x, y) {
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);

  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) {
    return true;
  }

  const terrain = b.terrain[row]?.[col];
  return terrain === 'high'; // Rocks are impassable
}

export function getTerrainSpeedMod(b, x, y) {
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);

  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) {
    return 1.0;
  }

  const terrain = b.terrain[row]?.[col];
  switch (terrain) {
    case 'water': return 0.5;
    case 'brush': return 0.9;
    case 'forest': return 0.7;
    default: return 1.0;
  }
}

export function getTerrainAt(b, x, y) {
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);

  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) {
    return 'open';
  }

  return b.terrain[row]?.[col] || 'open';
}

// Check if unit is in cover (trench or pillbox)
export function isInCover(b, x, y) {
  const terrain = getTerrainAt(b, x, y);
  return terrain === 'trench' || terrain === 'pillbox';
}

// ═══════════════════════════════════════════════════════════════
// TARGETING
// ═══════════════════════════════════════════════════════════════

export function findNearestEnemy(unit, enemies) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = e;
    }
  }

  return { enemy: nearest, distance: nearestDist };
}

export function findEnemiesInRange(unit, enemies, range) {
  const inRange = [];
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= range) {
      inRange.push({ enemy: e, distance: dist });
    }
  }
  return inRange.sort((a, b) => a.distance - b.distance);
}

// ═══════════════════════════════════════════════════════════════
// MOVEMENT
// ═══════════════════════════════════════════════════════════════

export function moveToward(b, unit, targetX, targetY, dtSec) {
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 5) return true; // Arrived at exact position

  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const baseSpeed = unitDef?.speed || 100;
  const speedMod = getTerrainSpeedMod(b, unit.x, unit.y);
  const speed = baseSpeed * speedMod;

  let moveX = (dx / dist) * speed * dtSec;
  let moveY = (dy / dist) * speed * dtSec;

  let newX = unit.x + moveX;
  let newY = unit.y + moveY;

  // Only check terrain collision (no unit collision for now)
  const blockedX = isTerrainBlocked(b, newX, unit.y);
  const blockedY = isTerrainBlocked(b, unit.x, newY);

  if (!blockedX) {
    unit.x = newX;
  }
  if (!blockedY) {
    unit.y = newY;
  }

  // Wall-sliding for terrain
  if (blockedX || blockedY) {
    unit.stuckTime = (unit.stuckTime || 0) + dtSec;

    if (unit.stuckTime > 0.3) {
      if (blockedX && !blockedY) {
        const slideDir = dy > 0 ? 1 : -1;
        const slideY = unit.y + slideDir * speed * dtSec;
        if (!isTerrainBlocked(b, unit.x, slideY)) {
          unit.y = slideY;
        }
      } else if (blockedY && !blockedX) {
        const slideDir = dx > 0 ? 1 : -1;
        const slideX = unit.x + slideDir * speed * dtSec;
        if (!isTerrainBlocked(b, slideX, unit.y)) {
          unit.x = slideX;
        }
      }
    }
  } else {
    unit.stuckTime = 0;
  }

  // Face direction of movement
  unit.angle = Math.atan2(dy, dx);

  return false;
}

// ═══════════════════════════════════════════════════════════════
// SHOOTING
// ═══════════════════════════════════════════════════════════════

export function tryShoot(b, unit, targetX, targetY, now) {
  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const fireRate = unitDef?.fireRate || 1000;
  const damage = unitDef?.damage || 10;

  if (now - unit.lastShot < fireRate) return false;

  unit.lastShot = now;

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const angle = Math.atan2(dy, dx);
  const projSpeed = 400;

  // Get projectile type from UNIT_PROJECTILES mapping
  const projType = UNIT_PROJECTILES[unit.unitId] || 'bullet';

  b.projectiles.push({
    x: unit.x,
    y: unit.y,
    vx: Math.cos(angle) * projSpeed,
    vy: Math.sin(angle) * projSpeed,
    damage: damage,
    owner: 'ally',
    sourceUnitId: unit.id,  // Track which unit fired for aggro
    type: projType
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════
// AI STATE MACHINE
// ═══════════════════════════════════════════════════════════════

export function updateUnitAI(b, unit, hero, enemies, now, dtSec) {
  // Initialize AI state and behavior if needed
  if (!unit.aiState) {
    unit.aiState = AIState.DEFENDING;
  }
  if (!unit.aiBehavior) {
    unit.aiBehavior = AIBehavior.DEFENSIVE; // Default behavior
  }

  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const baseRange = unitDef?.range || 200;
  const behavior = unit.aiBehavior;
  const range = baseRange * (behavior.engageRange || 1.0);

  // Check for retreat condition based on behavior threshold
  const retreatThreshold = behavior.retreatThreshold || 0.25;
  if (unit.hp && unit.maxHP && unit.hp < unit.maxHP * retreatThreshold) {
    unit.aiState = AIState.RETREATING;
  }

  // Execute based on current state
  switch (unit.aiState) {
    case AIState.IDLE:
      executeIdle(b, unit, enemies, now, range);
      break;

    case AIState.DEFENDING:
      executeDefending(b, unit, enemies, now, dtSec, range, behavior);
      break;

    case AIState.ATTACKING:
      executeAttacking(b, unit, enemies, now, dtSec, range, behavior);
      break;

    case AIState.FOLLOWING:
      executeFollowing(b, unit, hero, enemies, now, dtSec, range, behavior);
      break;

    case AIState.RETREATING:
      executeRetreating(b, unit, hero, enemies, now, dtSec);
      break;

    case AIState.MOVING:
      executeMoving(b, unit, enemies, now, dtSec, range, behavior);
      break;

    default:
      executeDefending(b, unit, enemies, now, dtSec, range, behavior);
  }
}

// Set unit AI behavior preset
export function setUnitBehavior(unit, behaviorKey) {
  const behavior = AIBehavior[behaviorKey];
  if (behavior) {
    unit.aiBehavior = behavior;
  }
}

// Set custom behavior parameters
export function setCustomBehavior(unit, params) {
  unit.aiBehavior = { ...AIBehavior.DEFENSIVE, ...params };
}

// ═══════════════════════════════════════════════════════════════
// STATE BEHAVIORS
// ═══════════════════════════════════════════════════════════════

function executeIdle(b, unit, enemies, now, range) {
  // Just look for enemies, switch to defending if found
  const { enemy, distance } = findNearestEnemy(unit, enemies);
  if (enemy && distance < range * 1.5) {
    unit.aiState = AIState.DEFENDING;
  }
}

function executeDefending(b, unit, enemies, now, dtSec, range, behavior = {}) {
  // Stay in position, shoot at enemies in range
  const { enemy, distance } = behavior.prioritizeWeak
    ? findWeakestInRange(unit, enemies, range * 1.5)
    : findNearestEnemy(unit, enemies);

  if (!enemy) {
    unit.aiState = AIState.IDLE;
    return;
  }

  // Face enemy
  const dx = enemy.x - unit.x;
  const dy = enemy.y - unit.y;
  unit.angle = Math.atan2(dy, dx);

  // Shoot if in range
  if (distance <= range) {
    tryShoot(b, unit, enemy.x, enemy.y, now);
  }
}

// Find weakest enemy in range (for priority targeting)
function findWeakestInRange(unit, enemies, range) {
  let weakest = null;
  let lowestHP = Infinity;
  let dist = Infinity;

  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= range && e.hp < lowestHP) {
      lowestHP = e.hp;
      weakest = e;
      dist = d;
    }
  }

  return { enemy: weakest, distance: dist };
}

function executeAttacking(b, unit, enemies, now, dtSec, range, behavior = {}) {
  const { enemy, distance } = behavior.prioritizeWeak
    ? findWeakestInRange(unit, enemies, range * 1.5)
    : findNearestEnemy(unit, enemies);

  if (!enemy) {
    unit.aiState = AIState.DEFENDING;
    return;
  }

  // Face enemy
  const dx = enemy.x - unit.x;
  const dy = enemy.y - unit.y;
  unit.angle = Math.atan2(dy, dx);

  // Move closer if out of range (unless behavior says don't advance)
  if (distance > range * 0.8 && behavior.advanceWhenBlocked !== false) {
    // If flanking behavior, try to approach from the side
    if (behavior.preferFlank) {
      const flankAngle = unit.angle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4);
      const flankX = enemy.x - Math.cos(flankAngle) * (range * 0.6);
      const flankY = enemy.y - Math.sin(flankAngle) * (range * 0.6);
      moveToward(b, unit, flankX, flankY, dtSec);
    } else {
      moveToward(b, unit, enemy.x, enemy.y, dtSec);
    }
  }

  // Shoot if in range (unless holdFireWhenMoving and we're moving)
  const isMoving = distance > range * 0.8;
  if (distance <= range && !(behavior.holdFireWhenMoving && isMoving)) {
    tryShoot(b, unit, enemy.x, enemy.y, now);
  }
}

function executeFollowing(b, unit, hero, enemies, now, dtSec, range, behavior = {}) {
  const followDistance = behavior.followDistance || 60; // Distance behind hero
  const unitSpacing = ENTITY_RADIUS.ally * 2; // Space between units in line
  const pathSpacing = 12; // Distance between breadcrumb points

  // Get all followers sorted by their index/order
  const followers = b.units ? b.units.filter(u => u.aiState === AIState.FOLLOWING && !u.dead) : [];
  const unitIndex = followers.indexOf(unit);

  // Initialize or update hero's breadcrumb path
  if (!b.heroPath) b.heroPath = [];

  // Add hero position to path if moved far enough from last point
  const lastPos = b.heroPath[0];
  if (!lastPos ||
      Math.hypot(hero.x - lastPos.x, hero.y - lastPos.y) > pathSpacing) {
    b.heroPath.unshift({ x: hero.x, y: hero.y, time: now });
    // Keep path limited to reasonable length
    if (b.heroPath.length > 100) b.heroPath.pop();
  }

  // Calculate how far along the path this unit should be
  // First unit is followDistance behind hero, each subsequent unit is unitSpacing further
  const targetDistance = followDistance + (unitIndex * unitSpacing);

  // Find the point on the breadcrumb path at the target distance
  let targetX = hero.x;
  let targetY = hero.y;
  let accumulatedDist = 0;
  let foundTarget = false;

  for (let i = 0; i < b.heroPath.length - 1; i++) {
    const p1 = b.heroPath[i];
    const p2 = b.heroPath[i + 1];
    const segmentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    if (accumulatedDist + segmentDist >= targetDistance) {
      // Target point is on this segment
      const t = (targetDistance - accumulatedDist) / segmentDist;
      targetX = p1.x + (p2.x - p1.x) * t;
      targetY = p1.y + (p2.y - p1.y) * t;
      foundTarget = true;
      break;
    }
    accumulatedDist += segmentDist;
  }

  // If path isn't long enough, use the last point or fall back to behind hero
  if (!foundTarget) {
    if (b.heroPath.length > 0) {
      const lastPoint = b.heroPath[b.heroPath.length - 1];
      targetX = lastPoint.x;
      targetY = lastPoint.y;
    } else {
      // No path yet - position behind hero
      const heroFacing = hero.angle || 0;
      const behindAngle = heroFacing + Math.PI;
      targetX = hero.x + Math.cos(behindAngle) * targetDistance;
      targetY = hero.y + Math.sin(behindAngle) * targetDistance;
    }
  }

  // Check if target position is blocked by another unit
  const allyRadius = ENTITY_RADIUS.ally;
  const allAllies = b.units ? b.units.filter(u => u.id !== unit.id && !u.dead) : [];
  const blocked = wouldCollide(targetX, targetY, allyRadius, allAllies, unit.id);

  if (blocked) {
    // Find nearest unoccupied position by searching in a spiral pattern
    const searchAngles = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3,
                          Math.PI/2, -Math.PI/2, 2*Math.PI/3, -2*Math.PI/3,
                          5*Math.PI/6, -5*Math.PI/6, Math.PI];
    const searchDistances = [unitSpacing, unitSpacing * 1.5, unitSpacing * 2];

    outerLoop:
    for (const dist of searchDistances) {
      for (const angleOffset of searchAngles) {
        const testX = targetX + Math.cos(angleOffset) * dist;
        const testY = targetY + Math.sin(angleOffset) * dist;
        if (!wouldCollide(testX, testY, allyRadius, allAllies, unit.id) &&
            !isTerrainBlocked(b, testX, testY)) {
          targetX = testX;
          targetY = testY;
          break outerLoop;
        }
      }
    }
  }

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const distToTarget = Math.hypot(dx, dy);

  // Only move if far enough from target (prevents jittering)
  if (distToTarget > unitSpacing * 0.4) {
    moveToward(b, unit, targetX, targetY, dtSec);
  }

  // Shoot at enemies in range
  const isMoving = distToTarget > unitSpacing;
  const { enemy, distance } = findNearestEnemy(unit, enemies);

  if (enemy && distance <= range && !(behavior.holdFireWhenMoving && isMoving)) {
    unit.angle = Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
    tryShoot(b, unit, enemy.x, enemy.y, now);
  } else if (distToTarget > 10) {
    // Face direction of movement
    unit.angle = Math.atan2(dy, dx);
  }
}

function executeRetreating(b, unit, hero, enemies, now, dtSec) {
  // Move toward hero (safety)
  const arrived = moveToward(b, unit, hero.x, hero.y, dtSec);

  // If reached hero and HP recovered, switch to following
  if (unit.hp >= unit.maxHP * 0.5) {
    unit.aiState = AIState.FOLLOWING;
  }

  // Still shoot at enemies while retreating
  const { enemy, distance } = findNearestEnemy(unit, enemies);
  if (enemy && distance < 150) {
    tryShoot(b, unit, enemy.x, enemy.y, now);
  }
}

function executeMoving(b, unit, enemies, now, dtSec, range, behavior = {}) {
  // Check for waypoints first
  if (unit.waypoints && unit.waypoints.length > 0) {
    const wpIndex = unit.currentWaypoint || 0;
    if (wpIndex < unit.waypoints.length) {
      const waypoint = unit.waypoints[wpIndex];
      const arrived = moveToward(b, unit, waypoint.x, waypoint.y, dtSec);

      if (arrived) {
        unit.currentWaypoint = wpIndex + 1;
        // If more waypoints, continue moving; otherwise switch to defending
        if (unit.currentWaypoint >= unit.waypoints.length) {
          unit.aiState = AIState.DEFENDING;
          unit.waypoints = []; // Clear waypoints
        }
      }
    } else {
      unit.aiState = AIState.DEFENDING;
    }
  }
  // Fall back to direct target movement
  else if (unit.targetX && unit.targetY) {
    const arrived = moveToward(b, unit, unit.targetX, unit.targetY, dtSec);

    if (arrived) {
      unit.aiState = AIState.DEFENDING;
      unit.targetX = null;
      unit.targetY = null;
    }
  } else {
    // No waypoints or target, switch to defending
    unit.aiState = AIState.DEFENDING;
    return;
  }

  // Shoot at enemies while moving (unless holdFireWhenMoving)
  if (!behavior.holdFireWhenMoving) {
    const { enemy, distance } = findNearestEnemy(unit, enemies);
    if (enemy && distance <= range) {
      unit.angle = Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
      tryShoot(b, unit, enemy.x, enemy.y, now);
    }
  }
}

// Add waypoint to a unit's path
export function addWaypoint(unit, x, y) {
  if (!unit.waypoints) unit.waypoints = [];
  unit.waypoints.push({ x, y });
}

// Clear all waypoints
export function clearWaypoints(unit) {
  unit.waypoints = [];
  unit.currentWaypoint = 0;
}

// Set waypoints from grid coordinates
export function setWaypointsFromGrid(unit, gridWaypoints, cellSize) {
  unit.waypoints = gridWaypoints.map(wp => ({
    x: (wp.col + 0.5) * cellSize,
    y: (wp.row + 0.5) * cellSize
  }));
  unit.currentWaypoint = 0;
  if (unit.waypoints.length > 0) {
    unit.aiState = AIState.MOVING;
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMANDS (Real-time orders from player)
// ═══════════════════════════════════════════════════════════════

export function issueCommand(units, command, params = {}) {
  // For move commands with multiple units, spread them in formation
  const spreadRadius = ENTITY_RADIUS.ally * 2.5; // Space between units

  units.forEach((unit, index) => {
    switch (command) {
      case 'follow':
        unit.aiState = AIState.FOLLOWING;
        clearWaypoints(unit);
        break;

      case 'hold':
        unit.aiState = AIState.DEFENDING;
        clearWaypoints(unit);
        break;

      case 'attack':
        unit.aiState = AIState.ATTACKING;
        clearWaypoints(unit);
        break;

      case 'move':
        unit.aiState = AIState.MOVING;
        // If waypoints provided, use them; otherwise use single target
        if (params.waypoints && params.waypoints.length > 0) {
          unit.waypoints = params.waypoints;
          unit.currentWaypoint = 0;
        } else if (params.x !== undefined && params.y !== undefined) {
          // Spread units in formation around the target point
          let targetX = params.x;
          let targetY = params.y;

          if (units.length > 1) {
            // Calculate formation offset (circular pattern)
            const angle = (index / units.length) * Math.PI * 2;
            const radius = spreadRadius * Math.ceil((index + 1) / 6); // Expand radius for more units
            targetX = params.x + Math.cos(angle) * radius;
            targetY = params.y + Math.sin(angle) * radius;
          }

          unit.waypoints = [{ x: targetX, y: targetY }];
          unit.currentWaypoint = 0;
          unit.targetX = targetX;
          unit.targetY = targetY;
        }
        break;

      case 'retreat':
        unit.aiState = AIState.RETREATING;
        clearWaypoints(unit);
        break;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ENEMY AI
// ═══════════════════════════════════════════════════════════════

export function updateEnemyAI(b, enemy, hero, allies, now, dtSec) {
  if (enemy.dead) return;

  // Get AI type (default to BASIC)
  const aiType = enemy.aiType || EnemyAIType.BASIC;

  // Decay damage memory (aggro fades over time based on personality)
  decayDamageMemory(enemy, dtSec);

  // Use threat-based target selection
  const target = selectTarget(enemy, hero, allies);
  if (!target) return;

  // Calculate distance to target
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const targetDist = Math.sqrt(dx * dx + dy * dy);

  // Update enemy facing angle toward target
  enemy.angle = Math.atan2(dy, dx);

  // Check for retreat - find cover instead of just moving away
  if (aiType.retreatHP > 0 && enemy.hp && enemy.maxHp) {
    if (enemy.hp < enemy.maxHp * aiType.retreatHP) {
      // Find nearest cover and retreat there
      if (!enemy.retreatPath) {
        const enemyGrid = worldToGrid(enemy.x, enemy.y, b.cellSize);
        const cover = findNearestCover({
          terrain: b.terrain,
          fromRow: enemyGrid.row,
          fromCol: enemyGrid.col,
          gridHeight: b.gridHeight,
          gridWidth: b.gridWidth,
          maxDistance: 8
        });
        if (cover) {
          enemy.retreatPath = pathToWorld(cover.path, b.cellSize);
          enemy.retreatPathIndex = 0;
        }
      }

      // Follow retreat path
      if (enemy.retreatPath && enemy.retreatPathIndex < enemy.retreatPath.length) {
        const wp = enemy.retreatPath[enemy.retreatPathIndex];
        const arrived = moveEnemyTowardPoint(b, enemy, wp.x, wp.y, aiType.speed, dtSec);
        if (arrived) {
          enemy.retreatPathIndex++;
        }
        return;
      }
    }
  }

  // Calculate attack range from AI type
  const attackRange = aiType.attackRange || 60;
  const preferDistance = aiType.preferDistance || attackRange;

  // Movement logic - use A* pathfinding with direct movement fallback
  if (targetDist > preferDistance) {
    // Check if we need to calculate a new path
    const needsNewPath = !enemy.path ||
      enemy.pathTargetX !== target.x ||
      enemy.pathTargetY !== target.y ||
      (now - (enemy.lastPathTime || 0)) > 2000; // Recalc every 2 seconds

    if (needsNewPath) {
      const enemyGrid = worldToGrid(enemy.x, enemy.y, b.cellSize);
      let targetGrid = worldToGrid(target.x, target.y, b.cellSize);

      // Flanking behavior - adjust target position
      if (aiType.flankAngle) {
        const baseAngle = Math.atan2(dy, dx);
        const flankDir = (enemy.id || Math.random()) > 0.5 ? 1 : -1;
        const flankAngle = baseAngle + flankDir * aiType.flankAngle;
        const flankX = target.x - Math.cos(flankAngle) * preferDistance;
        const flankY = target.y - Math.sin(flankAngle) * preferDistance;
        targetGrid = worldToGrid(flankX, flankY, b.cellSize);
      }

      const path = findPath({
        terrain: b.terrain,
        startRow: enemyGrid.row,
        startCol: enemyGrid.col,
        endRow: targetGrid.row,
        endCol: targetGrid.col,
        gridHeight: b.gridHeight,
        gridWidth: b.gridWidth,
        maxIterations: 500
      });

      if (path && path.length > 0) {
        // Smooth the path and convert to world coords
        const smoothed = smoothPath(path, b.terrain, b.gridHeight, b.gridWidth);
        enemy.path = pathToWorld(smoothed, b.cellSize);
        enemy.pathIndex = 0;
        enemy.pathTargetX = target.x;
        enemy.pathTargetY = target.y;
        enemy.lastPathTime = now;
      } else {
        // Pathfinding failed - clear path to use direct movement
        enemy.path = null;
        enemy.lastPathTime = now;
      }
    }

    // Follow the path if we have one
    if (enemy.path && enemy.pathIndex < enemy.path.length) {
      const wp = enemy.path[enemy.pathIndex];
      const arrived = moveEnemyTowardPoint(b, enemy, wp.x, wp.y, aiType.speed, dtSec);
      if (arrived) {
        enemy.pathIndex++;
      }
    } else {
      // No path available - move directly toward target (fallback)
      moveEnemyTowardPoint(b, enemy, target.x, target.y, aiType.speed, dtSec);
    }
  } else if (targetDist < preferDistance * 0.6 && aiType.preferDistance) {
    // Cautious AI backs off if too close
    const backX = enemy.x - (dx / targetDist) * 50;
    const backY = enemy.y - (dy / targetDist) * 50;
    moveEnemyTowardPoint(b, enemy, backX, backY, aiType.speed * 0.5, dtSec);
  }

  // Attack if in range
  if (targetDist < attackRange && now - (enemy.lastAttack || 0) > 1000) {
    enemy.lastAttack = now;
    target.hp -= enemy.damage || 10;
  }
}

// Simple point-to-point movement (terrain collision only)
function moveEnemyTowardPoint(b, enemy, targetX, targetY, speedMult, dtSec) {
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 5) return true; // Arrived

  const baseSpeed = enemy.speed || 80;
  const terrainMod = getTerrainSpeedMod(b, enemy.x, enemy.y);
  const speed = baseSpeed * (speedMult || 1.0) * terrainMod;

  const moveX = (dx / dist) * speed * dtSec;
  const moveY = (dy / dist) * speed * dtSec;

  const newX = enemy.x + moveX;
  const newY = enemy.y + moveY;

  // Only check terrain collision (no unit collision for now)
  if (!isTerrainBlocked(b, newX, enemy.y)) {
    enemy.x = newX;
  }
  if (!isTerrainBlocked(b, enemy.x, newY)) {
    enemy.y = newY;
  }

  return false;
}

// Set enemy AI type
export function setEnemyAIType(enemy, typeKey) {
  const aiType = EnemyAIType[typeKey];
  if (aiType) {
    enemy.aiType = aiType;
  }
}

// Set custom enemy AI parameters
export function setCustomEnemyAI(enemy, params) {
  enemy.aiType = { ...EnemyAIType.BASIC, ...params };
}
