// ═══════════════════════════════════════════════════════════════
// AI - Unit AI behavior, state machines, and order execution
// ═══════════════════════════════════════════════════════════════

import { UNITS, UNIT_PROJECTILES, ORDER_EFFECTS, UnitStance, STANCE_PARAMS, getStanceModifier, getEnemyStance, getFormationPositions } from './constants.js';
import { findPath, findNearestCover, pathToWorld, worldToGrid, smoothPath } from './pathfinding.js';

// AI States for units
export const AIState = {
  IDLE: 'idle',                    // No orders, brief pause
  ADVANCING: 'advancing',          // NEW: Moving toward front line
  MOVING: 'moving',                // Moving to specific waypoint
  ENGAGING: 'engaging',            // NEW: In combat, stance drives behavior
  ATTACKING: 'attacking',          // Actively pursuing enemy
  DEFENDING: 'defending',          // Hold position, attack in range
  FOLLOWING: 'following',          // Follow hero
  RETREATING: 'retreating',        // Fall back when low HP
  REPOSITIONING: 'repositioning',  // NEW: Finding better position
  COVERING: 'covering'             // Provide cover fire
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
// SMART POSITIONING - AI finds optimal deployment positions
// ═══════════════════════════════════════════════════════════════

// Terrain cover/defense values
const TERRAIN_COVER_SCORE = {
  pillbox: 50,    // Best cover
  trench: 40,     // Great cover
  forest: 25,     // Good concealment
  brush: 15,      // Light cover
  high: -1000,    // Impassable (rocks)
  water: -500,    // Avoid water
  grass: 5,       // Slight preference
  open: 0         // Neutral
};

/**
 * Find optimal positions for units when no specific positions are set.
 * Evaluates terrain, spacing, support range, and firing lines.
 *
 * @param {Object} b - Battle state
 * @param {Object} hero - Hero object with x, y position
 * @param {Array} existingUnits - Units already positioned (to avoid clustering)
 * @param {number} numPositions - How many positions to find
 * @returns {Array} Array of {x, y, score} positions sorted by score (best first)
 */
export function findSmartPositions(b, hero, existingUnits, numPositions) {
  const positions = [];
  const cellSize = b.cellSize;

  // Define search area - fan out from hero toward enemy side
  // Enemy spawns at top, player at bottom, so search area is around/ahead of hero
  const searchRadiusMin = 60;   // Min distance from hero
  const searchRadiusMax = 200;  // Max distance from hero
  const minSpacing = 50;        // Min distance between units

  // Get hero grid position
  const heroCol = Math.floor(hero.x / cellSize);
  const heroRow = Math.floor(hero.y / cellSize);

  // Calculate enemy direction (assumed to be toward top of map)
  const enemyDir = -Math.PI / 2; // Facing up

  // Evaluate cells in search area
  for (let row = 0; row < b.gridHeight; row++) {
    for (let col = 0; col < b.gridWidth; col++) {
      const x = (col + 0.5) * cellSize;
      const y = (row + 0.5) * cellSize;

      // Calculate distance from hero
      const dx = x - hero.x;
      const dy = y - hero.y;
      const distFromHero = Math.sqrt(dx * dx + dy * dy);

      // Skip if outside search radius
      if (distFromHero < searchRadiusMin || distFromHero > searchRadiusMax) {
        continue;
      }

      // Skip blocked terrain
      const terrain = getTerrainAt(b, x, y);
      if (terrain === 'high' || terrain === 'water') {
        continue;
      }

      // Calculate position score
      let score = 0;

      // 1. Terrain cover value
      score += TERRAIN_COVER_SCORE[terrain] || 0;

      // 2. Prefer positions in front of hero (toward enemy)
      const angleToPos = Math.atan2(dy, dx);
      const angleDiff = Math.abs(normalizeAngle(angleToPos - enemyDir));
      const forwardBonus = Math.cos(angleDiff) * 20; // Up to +20 for forward positions
      score += forwardBonus;

      // 3. Optimal support distance (not too close, not too far)
      const optimalDist = 120;
      const distPenalty = Math.abs(distFromHero - optimalDist) * 0.1;
      score -= distPenalty;

      // 4. Check spacing from existing units
      let tooClose = false;
      for (const unit of existingUnits) {
        const ux = unit.x !== undefined ? unit.x : unit.targetX;
        const uy = unit.y !== undefined ? unit.y : unit.targetY;
        if (ux === undefined || uy === undefined) continue;

        const udx = x - ux;
        const udy = y - uy;
        const unitDist = Math.sqrt(udx * udx + udy * udy);
        if (unitDist < minSpacing) {
          tooClose = true;
          break;
        }
        // Small penalty for being close to other units
        if (unitDist < minSpacing * 2) {
          score -= (minSpacing * 2 - unitDist) * 0.2;
        }
      }
      if (tooClose) continue;

      // 5. Firing line bonus - prefer positions with clear view forward
      const lookAheadX = x + Math.cos(enemyDir) * 100;
      const lookAheadY = y + Math.sin(enemyDir) * 100;
      if (!isTerrainBlocked(b, lookAheadX, lookAheadY)) {
        score += 10; // Clear firing lane
      }

      // 6. Flank coverage - spread units to cover sides
      const flankAngle = Math.atan2(dy, dx);
      const spreadBonus = Math.abs(Math.sin(flankAngle)) * 10;
      score += spreadBonus;

      positions.push({ x, y, score, terrain });
    }
  }

  // Sort by score (highest first)
  positions.sort((a, b) => b.score - a.score);

  // Return top N positions, ensuring spacing
  const selected = [];
  for (const pos of positions) {
    if (selected.length >= numPositions) break;

    // Check spacing from already selected positions
    let valid = true;
    for (const sel of selected) {
      const dx = pos.x - sel.x;
      const dy = pos.y - sel.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minSpacing) {
        valid = false;
        break;
      }
    }

    if (valid) {
      selected.push(pos);
    }
  }

  return selected;
}

/**
 * Find a single smart position for a unit.
 * Wrapper around findSmartPositions for single unit.
 */
export function findSmartPosition(b, hero, existingUnits) {
  const positions = findSmartPositions(b, hero, existingUnits, 1);
  return positions.length > 0 ? positions[0] : null;
}

/**
 * Assign smart positions to units that don't have explicit positions set.
 * Uses terrain evaluation to find optimal deployment positions.
 *
 * @param {Object} b - Battle state with units, hero, and terrain
 */
export function assignSmartPositions(b) {
  if (!b || !b.units || b.units.length === 0) return;

  // Separate units that need positions from those that already have them
  const unitsNeedingPositions = [];
  const unitsWithPositions = [];

  for (const unit of b.units) {
    // Check if unit has a manually set position (from battle plan)
    const hasExplicitPos = unit.primaryPos !== null && unit.primaryPos !== undefined;

    if (hasExplicitPos) {
      unitsWithPositions.push(unit);
    } else {
      unitsNeedingPositions.push(unit);
    }
  }

  // If no units need positions, done
  if (unitsNeedingPositions.length === 0) return;

  console.log(`[AI] Finding smart positions for ${unitsNeedingPositions.length} units`);

  // Build list of already-positioned units for spacing checks
  const existingPositions = unitsWithPositions.map(u => ({
    x: u.currentDestination?.x || u.primaryPos?.x || u.x,
    y: u.currentDestination?.y || u.primaryPos?.y || u.y
  })).filter(p => p.x !== undefined && p.y !== undefined);

  // Find optimal positions using smart positioning AI
  const smartPositions = findSmartPositions(
    b,
    b.hero,
    existingPositions,
    unitsNeedingPositions.length
  );

  // Assign positions to units
  for (let i = 0; i < unitsNeedingPositions.length; i++) {
    const unit = unitsNeedingPositions[i];

    if (i < smartPositions.length) {
      const pos = smartPositions[i];
      unit.currentDestination = { x: pos.x, y: pos.y };
      unit.aiState = AIState.MOVING;
      unit.reachedDestination = false;

      // Store as primary position for fall back reference
      unit.primaryPos = { x: pos.x, y: pos.y };

      console.log(`[AI] Unit ${unit.id} assigned to (${Math.round(pos.x)}, ${Math.round(pos.y)}) - terrain: ${pos.terrain}, score: ${Math.round(pos.score)}`);

      // Add this position to existing list for next iteration spacing
      existingPositions.push({ x: pos.x, y: pos.y });
    } else {
      // Fallback if not enough smart positions found - spread around hero
      const fallbackRadius = 100 + (i * 30);
      const fallbackAngle = (Math.PI * 0.5) + (i / unitsNeedingPositions.length) * Math.PI;
      const fallbackPos = {
        x: b.hero.x + Math.cos(fallbackAngle) * fallbackRadius,
        y: b.hero.y + Math.sin(fallbackAngle) * fallbackRadius
      };
      unit.currentDestination = fallbackPos;
      unit.primaryPos = fallbackPos;
      unit.aiState = AIState.MOVING;
      unit.reachedDestination = false;

      console.log(`[AI] Unit ${unit.id} using fallback position`);
    }
  }
}

// Helper: Normalize angle to -PI to PI
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// ═══════════════════════════════════════════════════════════════
// FRONT LINE & THREAT EVALUATION - For proactive AI behavior
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate the dynamic front line Y position based on battle state.
 * Front line is where units should advance to before engaging.
 *
 * @param {Object} b - Battle state
 * @returns {number} Y coordinate of the front line
 */
export function calculateFrontLine(b) {
  // Default: middle of map
  let frontLineY = b.mapHeight * 0.5;

  // Adjust based on enemy positions (stay ahead of enemies)
  const liveEnemies = b.enemies?.filter(e => !e.dead) || [];
  if (liveEnemies.length > 0) {
    const avgEnemyY = liveEnemies.reduce((sum, e) => sum + e.y, 0) / liveEnemies.length;
    // Position front line slightly ahead of average enemy position
    frontLineY = Math.max(frontLineY, avgEnemyY + 80);
  }

  // Clamp to player territory (don't push too far forward)
  frontLineY = Math.min(frontLineY, b.mapHeight * 0.75);

  // Don't retreat past spawn area
  frontLineY = Math.max(frontLineY, b.mapHeight * 0.3);

  return frontLineY;
}

/**
 * Evaluate threat level for a unit based on nearby enemies, HP, and cover.
 * Used by AUTONOMOUS stance to decide push/hold/retreat.
 *
 * @param {Object} unit - The unit to evaluate
 * @param {Object} b - Battle state
 * @param {Array} enemies - List of enemies
 * @returns {number} Threat level from 0.0 (safe) to 1.0 (critical)
 */
export function evaluateThreat(unit, b, enemies) {
  const liveEnemies = enemies.filter(e => !e.dead);
  if (liveEnemies.length === 0) return 0;

  // Count nearby enemies
  let nearbyCount = 0;
  for (const e of liveEnemies) {
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 200) nearbyCount++;
  }

  // HP ratio (lower HP = higher threat)
  const hpRatio = unit.hp / unit.maxHp;

  // Cover check
  const inCover = isInCover(b, unit.x, unit.y);

  // Calculate threat
  let threat = 0;
  threat += nearbyCount * 0.15;      // Each nearby enemy adds 15%
  threat += (1 - hpRatio) * 0.4;     // Low HP adds up to 40%
  if (!inCover) threat += 0.15;      // Not in cover adds 15%

  return Math.min(1.0, threat);
}

/**
 * Check if unit should reposition to a better location.
 *
 * @param {Object} unit - The unit to evaluate
 * @param {Object} b - Battle state
 * @returns {Object|null} Better position {x, y} or null if current is fine
 */
export function shouldReposition(unit, b) {
  // Don't reposition if:
  // - Currently moving already
  // - Low HP (focus on survival)
  // - In the middle of digging in
  if (unit.aiState === AIState.MOVING || unit.aiState === AIState.REPOSITIONING) {
    return null;
  }
  if (unit.hp < unit.maxHp * 0.25) {
    return null;
  }
  if (unit.isDugIn) {
    return null;
  }

  // Score current position
  const currentScore = evaluatePositionScore(b, unit.x, unit.y, b.units, b.hero);

  // Search for better positions nearby (within 100px)
  const searchRadius = 100;
  const step = 30;
  let bestPos = null;
  let bestScore = currentScore;

  for (let dx = -searchRadius; dx <= searchRadius; dx += step) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += step) {
      if (dx === 0 && dy === 0) continue;

      const testX = unit.x + dx;
      const testY = unit.y + dy;

      // Skip blocked terrain
      if (isTerrainBlocked(b, testX, testY)) continue;

      const score = evaluatePositionScore(b, testX, testY, b.units, b.hero);

      // Need 30% improvement to be worth moving
      if (score > bestScore * 1.3) {
        bestScore = score;
        bestPos = { x: testX, y: testY };
      }
    }
  }

  return bestPos;
}

/**
 * Score a position for quality (terrain, spacing, firing lines).
 * Used for repositioning decisions.
 */
function evaluatePositionScore(b, x, y, units, hero) {
  let score = 50; // Base score

  // Terrain bonus
  const terrain = getTerrainAt(b, x, y);
  const terrainScores = {
    pillbox: 50, trench: 40, forest: 25, brush: 15, grass: 5, open: 0
  };
  score += terrainScores[terrain] || 0;

  // Distance from hero (optimal ~120px)
  const heroDist = Math.sqrt((x - hero.x) ** 2 + (y - hero.y) ** 2);
  score -= Math.abs(heroDist - 120) * 0.1;

  // Spacing from other units (don't cluster)
  for (const u of units) {
    if (u.dead) continue;
    const dist = Math.sqrt((x - u.x) ** 2 + (y - u.y) ** 2);
    if (dist < 50) score -= 20;
    else if (dist < 80) score -= 5;
  }

  // Forward position bonus (toward enemy)
  if (y < b.mapHeight * 0.5) score += 10;

  return score;
}

/**
 * Apply a formation to units around a center point.
 *
 * @param {Object} b - Battle state
 * @param {Array} units - Units to arrange
 * @param {string} formation - Formation type (line, wedge, column, spread)
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} facing - Direction to face (radians, default up)
 */
export function applyFormation(b, units, formation, cx, cy, facing = -Math.PI/2) {
  const positions = getFormationPositions(formation, cx, cy, units.length, facing);

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.dead) continue;

    if (i < positions.length) {
      const pos = positions[i];
      unit.currentDestination = { x: pos.x, y: pos.y };
      unit.aiState = AIState.MOVING;
      unit.reachedDestination = false;
    }
  }
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

// Find target based on unit's priority setting and squad concentrate target
export function findTargetByPriority(b, unit, enemies, range) {
  // If squad has a concentrate target, prioritize it (unless unit has assigned priority)
  if (b?.squad?.concentrateTarget && unit.targetPriority !== 'assigned') {
    const concentrateEnemy = enemies.find(e => e.id === b.squad.concentrateTarget && !e.dead);
    if (concentrateEnemy) {
      const dx = concentrateEnemy.x - unit.x;
      const dy = concentrateEnemy.y - unit.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Always target concentrate enemy even if out of range (will move toward or wait)
      return { enemy: concentrateEnemy, distance: dist };
    }
  }

  // Filter to enemies in range first
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

  if (inRange.length === 0) {
    return { enemy: null, distance: Infinity };
  }

  const priority = unit.targetPriority || 'nearest';

  switch (priority) {
    case 'nearest':
      // Sort by distance ascending
      inRange.sort((a, b) => a.distance - b.distance);
      return inRange[0];

    case 'weakest':
      // Sort by HP ascending
      inRange.sort((a, b) => a.enemy.hp - b.enemy.hp);
      return inRange[0];

    case 'strongest':
      // Sort by HP descending
      inRange.sort((a, b) => b.enemy.hp - a.enemy.hp);
      return inRange[0];

    case 'armor':
      // Prioritize armored units (check unitId for vehicle types)
      const armored = inRange.filter(e => isArmoredEnemy(e.enemy));
      if (armored.length > 0) {
        armored.sort((a, b) => a.distance - b.distance);
        return armored[0];
      }
      // Fallback to nearest
      inRange.sort((a, b) => a.distance - b.distance);
      return inRange[0];

    case 'infantry':
      // Prioritize infantry units
      const infantry = inRange.filter(e => !isArmoredEnemy(e.enemy));
      if (infantry.length > 0) {
        infantry.sort((a, b) => a.distance - b.distance);
        return infantry[0];
      }
      // Fallback to nearest
      inRange.sort((a, b) => a.distance - b.distance);
      return inRange[0];

    case 'artillery':
      // Prioritize support/artillery units (further back, high damage)
      const artillery = inRange.filter(e => e.enemy.aiType === 'support' || e.enemy.isArtillery);
      if (artillery.length > 0) {
        artillery.sort((a, b) => a.distance - b.distance);
        return artillery[0];
      }
      // Fallback to nearest
      inRange.sort((a, b) => a.distance - b.distance);
      return inRange[0];

    case 'assigned':
      // Only attack squad concentrate target, if not found return null
      return { enemy: null, distance: Infinity };

    default:
      // Default to nearest
      inRange.sort((a, b) => a.distance - b.distance);
      return inRange[0];
  }
}

// Helper: Check if enemy is armored type
function isArmoredEnemy(enemy) {
  const armoredIds = ['sherman', 'tiger', 'abrams', 'panzer', 'halftrack', 'armored'];
  return enemy.unitId && armoredIds.some(id => enemy.unitId.toLowerCase().includes(id));
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

export function moveToward(b, unit, targetX, targetY, dtSec, orderSpeedMod = 1.0) {
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 5) return true; // Arrived at exact position

  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const baseSpeed = unitDef?.speed || 100;
  const terrainSpeedMod = getTerrainSpeedMod(b, unit.x, unit.y);
  const speed = baseSpeed * terrainSpeedMod * orderSpeedMod;

  // DEBUG: Log movement (throttled)
  const now = Date.now();
  if (!unit._lastMoveLog || now - unit._lastMoveLog > 2000) {
    unit._lastMoveLog = now;
    console.log(`[MOVE] Unit ${unit.id}: speed=${speed.toFixed(1)}, dtSec=${dtSec.toFixed(3)}, terrainMod=${terrainSpeedMod.toFixed(2)}, orderMod=${orderSpeedMod}`);
  }

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
    // If unit has a destination to move to, start in MOVING state
    unit.aiState = unit.currentDestination ? AIState.MOVING : AIState.DEFENDING;
  }
  if (!unit.aiBehavior) {
    unit.aiBehavior = AIBehavior.DEFENSIVE; // Default behavior
  }

  // DEBUG: Log unit state every 2 seconds (throttled)
  if (!unit._lastDebugLog || now - unit._lastDebugLog > 2000) {
    unit._lastDebugLog = now;
    console.log(`[AI] Unit ${unit.id}: order=${unit.currentOrder}, state=${unit.aiState}, pos=(${Math.round(unit.x)},${Math.round(unit.y)}), enemies=${enemies.filter(e => !e.dead).length}`);
  }

  const unitDef = UNITS.find(u => u.id === unit.unitId);
  const baseRange = unitDef?.range || 200;
  const behavior = unit.aiBehavior;

  // === GET ORDER EFFECTS ===
  const order = unit.currentOrder || 'hold';
  const orderEffects = ORDER_EFFECTS[order] || ORDER_EFFECTS.hold;

  // Apply order-based modifiers
  const speedMod = orderEffects.speedMod ?? 1.0;
  const defenseMod = orderEffects.defenseMod ?? 1.0;
  const canMove = orderEffects.canMove ?? true;
  const range = baseRange * (behavior.engageRange || 1.0);

  // Store defense modifier for damage calculations elsewhere
  unit.currentDefenseMod = defenseMod;

  // === DIG IN: Handle setup time ===
  if (order === 'digIn') {
    if (!unit.digInStartTime) {
      unit.digInStartTime = now;
    }
    const setupTime = orderEffects.setupTime || 2000;
    const elapsed = now - unit.digInStartTime;
    unit.isDugIn = elapsed >= setupTime;
    // Can't do anything while digging in
    if (!unit.isDugIn) {
      return;
    }
  } else {
    unit.digInStartTime = null;
    unit.isDugIn = false;
  }

  // Check for retreat condition based on behavior threshold
  const retreatThreshold = behavior.retreatThreshold || 0.25;
  if (unit.hp && unit.maxHp && unit.hp < unit.maxHp * retreatThreshold) {
    unit.aiState = AIState.RETREATING;
  }

  // === ORDER-BASED STATE TRANSITIONS ===
  // Advance order: Move toward enemies aggressively
  if (order === 'advance' && orderEffects.aggressive) {
    if (unit.advancePos) {
      unit.currentDestination = unit.advancePos;
      unit.reachedDestination = false;
      unit.aiState = AIState.MOVING;
    } else {
      // No advance position, just be aggressive
      unit.aiState = AIState.ATTACKING;
    }
  }

  // Fallback order: Move toward fallback position or follow hero
  if (order === 'fallback' && orderEffects.retreating) {
    if (unit.fallbackPos) {
      unit.currentDestination = unit.fallbackPos;
      unit.reachedDestination = false;
      unit.aiState = AIState.MOVING;
    } else if (unit.primaryPos) {
      // Fallback to primary if no fallback set
      unit.currentDestination = unit.primaryPos;
      unit.reachedDestination = false;
      unit.aiState = AIState.MOVING;
    } else {
      // No positions set - fall back to hero
      unit.aiState = AIState.FOLLOWING;
    }
  }

  // Hold order: Stay in position and defend
  if (order === 'hold' && !canMove) {
    unit.aiState = AIState.DEFENDING;
  }

  // Search order: Hunt enemies
  if (order === 'search' && orderEffects.hunting) {
    unit.aiState = AIState.ATTACKING;
  }

  // Flank order: Attack from the side
  if (order === 'flank') {
    unit.aiState = AIState.ATTACKING;
    unit.aiBehavior = { ...unit.aiBehavior, preferFlank: true };
  }

  // Suppress order: Hold position and provide covering fire
  if (order === 'suppress' && orderEffects.areaFire) {
    unit.aiState = AIState.DEFENDING;
  }

  // === SUPPORT UNIT BEHAVIOR: Follow hero ===
  if (unit.isSupport && order !== 'hold' && order !== 'digIn') {
    // Support units follow the hero unless commanded otherwise
    if (unit.aiState !== AIState.RETREATING) {
      unit.aiState = AIState.FOLLOWING;
    }
  }

  // === DESTINATION-BASED MOVEMENT ===
  // Handle movement toward currentDestination (from primary/advance/fallback positions)
  if (unit.aiState === AIState.MOVING && unit.currentDestination && !unit.reachedDestination && canMove) {
    const dest = unit.currentDestination;
    const arrived = moveToward(b, unit, dest.x, dest.y, dtSec, speedMod);

    if (arrived) {
      unit.reachedDestination = true;
      unit.aiState = AIState.DEFENDING;
    }

    // Shoot at enemies while moving (use priority targeting)
    const { enemy, distance } = findTargetByPriority(b, unit, enemies, range * 2);
    if (enemy && distance <= range) {
      unit.angle = Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
      tryShoot(b, unit, enemy.x, enemy.y, now);
    }
    return;  // Don't execute other behaviors while moving to destination
  }

  // Execute based on current state
  switch (unit.aiState) {
    case AIState.IDLE:
      executeIdle(b, unit, enemies, now, range);
      break;

    case AIState.ADVANCING:
      executeAdvancing(b, unit, hero, enemies, now, dtSec, range);
      break;

    case AIState.ENGAGING:
      executeEngaging(b, unit, hero, enemies, now, dtSec, range);
      break;

    case AIState.REPOSITIONING:
      executeRepositioning(b, unit, enemies, now, dtSec, range);
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
      // Default to advancing if state is unknown
      executeAdvancing(b, unit, hero, enemies, now, dtSec, range);
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
  // Don't stay idle - proactively advance to front line
  // This makes units useful without babysitting
  unit.aiState = AIState.ADVANCING;
}

/**
 * ADVANCING state: Move toward the front line, shoot while moving.
 * Units advance until they reach a good position or heavy contact.
 */
function executeAdvancing(b, unit, hero, enemies, now, dtSec, range) {
  const stance = unit.stance || 'autonomous';
  const stanceParams = STANCE_PARAMS[stance] || STANCE_PARAMS.autonomous;

  // Calculate front line and get advance target
  const frontLineY = calculateFrontLine(b);

  // If no advance target, find one using smart positioning
  if (!unit.advanceTarget) {
    const existingUnits = b.units.filter(u => u.id !== unit.id && !u.dead).map(u => ({
      x: u.advanceTarget?.x || u.x,
      y: u.advanceTarget?.y || u.y
    }));

    const smartPos = findSmartPositions(b, hero, existingUnits, 1);
    if (smartPos.length > 0) {
      // Adjust Y to be near front line
      unit.advanceTarget = {
        x: smartPos[0].x,
        y: Math.min(smartPos[0].y, frontLineY)
      };
    } else {
      // Fallback: position based on unit index
      const unitIndex = b.units.indexOf(unit);
      const spread = 60;
      unit.advanceTarget = {
        x: hero.x + (unitIndex % 5 - 2) * spread,
        y: frontLineY
      };
    }
  }

  // Move toward advance target
  const target = unit.advanceTarget;
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distToTarget = Math.sqrt(dx * dx + dy * dy);

  // Apply stance speed modifier
  const speedMod = stanceParams.advanceSpeed || 1.0;
  const arrived = moveToward(b, unit, target.x, target.y, dtSec, speedMod);

  // Shoot at enemies while moving
  const { enemy, distance } = findTargetByPriority(b, unit, enemies, range * 1.5);
  if (enemy && distance <= range) {
    unit.angle = Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
    tryShoot(b, unit, enemy.x, enemy.y, now);

    // If in heavy contact (2+ enemies nearby), switch to ENGAGING
    const nearbyEnemies = findEnemiesInRange(unit, enemies, range);
    if (nearbyEnemies.length >= 2) {
      unit.aiState = AIState.ENGAGING;
      return;
    }
  } else if (distToTarget > 10) {
    // Face movement direction
    unit.angle = Math.atan2(dy, dx);
  }

  // Arrived at position - switch to defending
  if (arrived || distToTarget < 20) {
    unit.aiState = AIState.DEFENDING;
    unit.advanceTarget = null;
  }
}

/**
 * ENGAGING state: In combat, stance determines exact behavior.
 * - AGGRESSIVE: Keep pushing toward enemy
 * - DEFENSIVE: Find cover, hold position
 * - AUTONOMOUS: Evaluate threat and decide
 * - SUPPORT: Stay near hero
 */
function executeEngaging(b, unit, hero, enemies, now, dtSec, range) {
  const stance = unit.stance || 'autonomous';
  const stanceParams = STANCE_PARAMS[stance] || STANCE_PARAMS.autonomous;

  const { enemy, distance } = findTargetByPriority(b, unit, enemies, range * 1.5);

  // No enemies - switch to advancing
  if (!enemy) {
    unit.aiState = AIState.ADVANCING;
    unit.advanceTarget = null;
    return;
  }

  // Face enemy
  const dx = enemy.x - unit.x;
  const dy = enemy.y - unit.y;
  unit.angle = Math.atan2(dy, dx);

  // Behavior based on stance
  switch (stance) {
    case 'aggressive':
      // Keep pushing toward enemy
      if (distance > range * 0.6) {
        moveToward(b, unit, enemy.x, enemy.y, dtSec, stanceParams.advanceSpeed);
      }
      tryShoot(b, unit, enemy.x, enemy.y, now);
      break;

    case 'defensive':
      // Find cover if not in cover
      if (!isInCover(b, unit.x, unit.y)) {
        const betterPos = shouldReposition(unit, b);
        if (betterPos) {
          unit.repositionTarget = betterPos;
          unit.aiState = AIState.REPOSITIONING;
          return;
        }
      }
      // Stay put and shoot
      if (distance <= range) {
        tryShoot(b, unit, enemy.x, enemy.y, now);
      }
      break;

    case 'support':
      // Stay near hero
      const heroDistSq = (unit.x - hero.x) ** 2 + (unit.y - hero.y) ** 2;
      const followDist = stanceParams.followDistance || 80;
      if (heroDistSq > followDist * followDist) {
        moveToward(b, unit, hero.x, hero.y, dtSec);
      }
      // Shoot at enemies
      if (distance <= range) {
        tryShoot(b, unit, enemy.x, enemy.y, now);
      }
      break;

    case 'autonomous':
    default:
      // Evaluate threat and decide
      const threat = evaluateThreat(unit, b, enemies);

      if (threat > stanceParams.threatHoldThreshold) {
        // High threat - reposition
        const betterPos = shouldReposition(unit, b);
        if (betterPos) {
          unit.repositionTarget = betterPos;
          unit.aiState = AIState.REPOSITIONING;
          return;
        }
      } else if (threat < stanceParams.threatPushThreshold && distance > range * 0.7) {
        // Low threat - can push forward
        moveToward(b, unit, enemy.x, enemy.y, dtSec);
      }
      // Always shoot if in range
      if (distance <= range) {
        tryShoot(b, unit, enemy.x, enemy.y, now);
      }
      break;
  }

  // Check retreat threshold
  const hpRatio = unit.hp / unit.maxHp;
  if (hpRatio < stanceParams.retreatThreshold) {
    unit.aiState = AIState.RETREATING;
  }
}

/**
 * REPOSITIONING state: Moving to a better position mid-combat.
 */
function executeRepositioning(b, unit, enemies, now, dtSec, range) {
  if (!unit.repositionTarget) {
    unit.aiState = AIState.DEFENDING;
    return;
  }

  const target = unit.repositionTarget;
  const arrived = moveToward(b, unit, target.x, target.y, dtSec);

  // Shoot while moving if enemies in range
  const { enemy, distance } = findTargetByPriority(b, unit, enemies, range);
  if (enemy && distance <= range) {
    unit.angle = Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
    tryShoot(b, unit, enemy.x, enemy.y, now);
  }

  if (arrived) {
    unit.repositionTarget = null;
    unit.aiState = AIState.DEFENDING;
  }
}

function executeDefending(b, unit, enemies, now, dtSec, range, behavior = {}) {
  // Stay in position, shoot at enemies in range (use priority targeting)
  const { enemy, distance } = findTargetByPriority(b, unit, enemies, range * 1.5);

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
  // First try priority targeting within extended range
  let { enemy, distance } = findTargetByPriority(b, unit, enemies, range * 1.5);

  // If no nearby enemy, hunt any alive enemy on the map
  if (!enemy) {
    const aliveEnemies = enemies.filter(e => !e.dead);
    if (aliveEnemies.length > 0) {
      // Find closest enemy anywhere on map
      let closest = null;
      let closestDist = Infinity;
      for (const e of aliveEnemies) {
        const dx = e.x - unit.x;
        const dy = e.y - unit.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < closestDist) {
          closestDist = d;
          closest = e;
        }
      }
      enemy = closest;
      distance = closestDist;
    }
  }

  if (!enemy) {
    // No enemies left - go to defending
    unit.aiState = AIState.DEFENDING;
    return;
  }

  // DEBUG: Log attacking behavior
  if (!unit._lastAttackLog || now - unit._lastAttackLog > 2000) {
    unit._lastAttackLog = now;
    console.log(`[ATTACK] Unit ${unit.id}: target=${enemy.id}, dist=${Math.round(distance)}, range=${Math.round(range)}, willMove=${distance > range * 0.8}`);
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

  // Shoot at enemies in range (use priority targeting)
  const isMoving = distToTarget > unitSpacing;
  const { enemy, distance } = findTargetByPriority(b, unit, enemies, range);

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

  // Still shoot at enemies while retreating (use priority targeting)
  const { enemy, distance } = findTargetByPriority(b, unit, enemies, 150);
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

  // Shoot at enemies while moving (unless holdFireWhenMoving) - use priority targeting
  if (!behavior.holdFireWhenMoving) {
    const { enemy, distance } = findTargetByPriority(b, unit, enemies, range);
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
// FRONT LINE COMMANDS (Advance / Hold / Retreat)
// ═══════════════════════════════════════════════════════════════

/**
 * Issue a front line command to all non-support units.
 * Changes which destination they move toward based on their planned positions.
 *
 * Commands:
 * - ADVANCE: Move to advance position (or forward if not set)
 * - HOLD: Staged fallback - if above primary go to primary, else go to fallback, then defend
 * - RETREAT: Full retreat - always go to fallback position immediately
 *
 * @param {Array} units - Array of player units
 * @param {string} command - 'advance' | 'hold' | 'retreat'
 */
export function issueFrontLineCommand(units, command) {
  units.forEach(unit => {
    // Skip support units - they always follow the hero
    if (unit.isSupport) return;

    switch (command) {
      case 'advance':
        // Move to advance position if set, otherwise push toward enemy
        if (unit.advancePos) {
          unit.currentDestination = unit.advancePos;
          unit.reachedDestination = false;
          unit.aiState = AIState.MOVING;
          unit.fallbackStage = 0;  // Reset fallback stage
        } else if (unit.primaryPos) {
          // No advance pos set - push forward from primary
          unit.currentDestination = {
            x: unit.primaryPos.x,
            y: unit.primaryPos.y - 100  // Move forward (up) toward enemy
          };
          unit.reachedDestination = false;
          unit.aiState = AIState.ATTACKING; // More aggressive behavior
          unit.fallbackStage = 0;
        }
        break;

      case 'hold':
        // Staged fallback: Find cover and hold position
        // Stage 0: If above primary position -> go to primary
        // Stage 1: If at primary -> go to fallback (if set)
        // Stage 2+: Stay and defend
        if (!unit.primaryPos) {
          unit.aiState = AIState.DEFENDING;
          return;
        }

        const atPrimary = unit.reachedDestination &&
          unit.currentDestination === unit.primaryPos;
        const abovePrimary = unit.y < unit.primaryPos.y - 50;  // More than 50px above

        // Track fallback stage per unit
        if (unit.fallbackStage === undefined) unit.fallbackStage = 0;

        if (abovePrimary) {
          // Above primary - fall back to primary
          unit.currentDestination = unit.primaryPos;
          unit.reachedDestination = false;
          unit.aiState = AIState.MOVING;
          unit.fallbackStage = 1;
        } else if (unit.fallbackStage < 2 && unit.fallbackPos) {
          // At or below primary - check if should go to fallback
          const atFallback = unit.y >= unit.fallbackPos.y - 50;
          if (!atFallback) {
            unit.currentDestination = unit.fallbackPos;
            unit.reachedDestination = false;
            unit.aiState = AIState.MOVING;
            unit.fallbackStage = 2;
          } else {
            // At fallback - just defend
            unit.aiState = AIState.DEFENDING;
          }
        } else {
          // No fallback or already there - just defend in place
          unit.aiState = AIState.DEFENDING;
        }
        break;

      case 'retreat':
        // FULL RETREAT: Always go to fallback position immediately
        if (unit.fallbackPos) {
          unit.currentDestination = unit.fallbackPos;
          unit.reachedDestination = false;
          unit.aiState = AIState.MOVING;
          unit.fallbackStage = 2;
        } else if (unit.primaryPos) {
          // No fallback pos set - retreat behind primary
          unit.currentDestination = {
            x: unit.primaryPos.x,
            y: unit.primaryPos.y + 100  // Move backward (down) toward spawn
          };
          unit.reachedDestination = false;
          unit.aiState = AIState.RETREATING;
          unit.fallbackStage = 2;
        } else {
          unit.aiState = AIState.RETREATING;
        }
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

    // Apply stance modifiers for enemy attacks
    const attackerStance = getEnemyStance(enemy.aiType);
    const targetStance = target.stance || (target.isHero ? 'aggressive' : 'autonomous');

    // Get stance modifier and apply to damage
    const stanceMod = getStanceModifier(attackerStance, targetStance);
    const baseDamage = enemy.damage || 10;
    const finalDamage = Math.round(baseDamage * stanceMod.damageMod);

    target.hp -= finalDamage;
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
