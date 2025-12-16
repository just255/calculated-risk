// ═══════════════════════════════════════════════════════════════
// COMBAT - Shared combat system for all battle modes
// ═══════════════════════════════════════════════════════════════

import { UNITS, ENEMIES, PROJECTILES, UNIT_PROJECTILES, UNIT_COMBAT_STATS, getTypeMultiplier } from './constants.js';
import { sound } from './audio.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const BLOCK_DISTANCE = 55; // Minimum distance before units block each other

// ═══════════════════════════════════════════════════════════════
// ENTITY HELPERS
// ═══════════════════════════════════════════════════════════════

// Get combat stats for a unit by index
export function getUnitCombatStats(unitIdx) {
  const unit = UNITS[unitIdx];
  if (!unit) return null;
  return UNIT_COMBAT_STATS[unit.id];
}

// Get combat stats for an enemy by type index
export function getEnemyCombatStats(enemyType) {
  const enemy = ENEMIES[enemyType];
  if (!enemy) return null;
  return {
    range: enemy.range,
    speed: enemy.speed,
    isAir: enemy.isAir
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCKING LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a unit moving in a direction is blocked by enemies
 * @param {Object} unit - The unit to check {y, lane, isAir}
 * @param {Array} enemies - Array of potential blockers {y, lane, isAir, dead}
 * @param {number} direction - Movement direction: -1 = up, 1 = down
 * @returns {boolean} True if blocked
 */
export function isBlocked(unit, enemies, direction) {
  const relevantEnemies = enemies.filter(e => e.lane === unit.lane && !e.dead);

  for (const enemy of relevantEnemies) {
    // Air units only blocked by air, ground by ground
    if (unit.isAir !== enemy.isAir) continue;

    if (direction < 0) {
      // Moving up: blocked if enemy is above (lower y) and close
      if (enemy.y < unit.y && unit.y - enemy.y < BLOCK_DISTANCE) return true;
    } else {
      // Moving down: blocked if enemy is below (higher y) and close
      if (enemy.y > unit.y && enemy.y - unit.y < BLOCK_DISTANCE) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// TARGETING
// ═══════════════════════════════════════════════════════════════

/**
 * Find enemies in range of a unit
 * @param {Object} unit - The attacking unit {y, lane}
 * @param {Array} enemies - Potential targets {y, lane, dead}
 * @param {number} range - Weapon range in pixels
 * @param {number} direction - Direction unit faces: -1 = up, 1 = down
 * @returns {Array} Enemies in range
 */
export function findTargetsInRange(unit, enemies, range, direction) {
  return enemies.filter(e => {
    if (e.lane !== unit.lane || e.dead) return false;

    const dist = direction < 0
      ? unit.y - e.y  // Facing up: enemy must be above (lower y)
      : e.y - unit.y; // Facing down: enemy must be below (higher y)

    return dist > 0 && dist <= range;
  });
}

/**
 * Get the closest target from a list
 * @param {Array} targets - Array of targets with y positions
 * @param {number} direction - -1 = want highest y (closest when moving up), 1 = want lowest y
 * @returns {Object|null} Closest target or null
 */
export function getClosestTarget(targets, direction) {
  if (!targets.length) return null;
  return targets.reduce((best, cur) => {
    if (direction < 0) {
      return cur.y > best.y ? cur : best; // Moving up, want highest y (closest)
    } else {
      return cur.y < best.y ? cur : best; // Moving down, want lowest y (closest)
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// PROJECTILE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Create a projectile
 * @param {Object} options - Projectile options
 * @returns {Object} New projectile
 */
export function createProjectile({ unitId, x, y, lane, damage, attackerTypes, direction, owner }) {
  const projType = UNIT_PROJECTILES[unitId] || 'bullet';
  return {
    type: projType,
    x,
    y,
    lane,
    damage,
    attackerTypes,
    direction: direction || -1, // Default: moving up
    owner: owner || 'player'
  };
}

/**
 * Update all projectiles - move them and check for impacts
 * @param {Array} projectiles - Array of projectiles
 * @param {Array} targets - Array of potential targets
 * @param {number} dtSec - Delta time in seconds
 * @param {number} bfH - Battlefield height
 * @param {Function} getTargetTypes - Function to get target's types for damage calc
 * @returns {Object} { updatedProjectiles, kills, effects }
 */
export function updateProjectiles(projectiles, targets, dtSec, bfH, getTargetTypes) {
  const effects = [];
  let kills = 0;

  projectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) {
      p.hit = true;
      return;
    }

    // Move projectile
    p.y += p.direction * projDef.speed * dtSec;

    // Check for impact with targets
    const target = targets.find(t =>
      t.lane === p.lane && !t.dead && Math.abs(t.y - p.y) < 25
    );

    if (target) {
      const targetTypes = getTargetTypes(target);
      const mult = getTypeMultiplier(p.attackerTypes, targetTypes);
      const finalDamage = Math.round(p.damage * mult);

      target.hp -= finalDamage;
      p.hit = true;

      // Create impact effect
      effects.push({
        type: 'impact',
        x: p.x,
        y: target.y,
        size: Math.min(30, 8 + finalDamage * 0.5),
        color: projDef.color,
        t: Date.now()
      });

      if (target.hp <= 0) {
        target.dead = true;
        kills++;
        effects.push({
          type: 'explosion',
          x: p.x,
          y: target.y,
          t: Date.now()
        });
        sound('explosion');
      }
    }

    // Off screen
    if (p.y < -20 || p.y > bfH + 20) {
      p.hit = true;
    }
  });

  return {
    projectiles: projectiles.filter(p => !p.hit),
    kills,
    effects
  };
}

// ═══════════════════════════════════════════════════════════════
// MOVEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Move a unit if not blocked
 * @param {Object} unit - Unit to move {y, blocked}
 * @param {number} speed - Movement speed (pixels/second)
 * @param {number} direction - -1 = up, 1 = down
 * @param {number} dtSec - Delta time in seconds
 * @param {Object} bounds - {min, max} y boundaries
 */
export function moveUnit(unit, speed, direction, dtSec, bounds = { min: 0, max: 9999 }) {
  if (unit.blocked || unit.dead) return;

  const newY = unit.y + direction * speed * dtSec;
  unit.y = Math.max(bounds.min, Math.min(bounds.max, newY));
}

// ═══════════════════════════════════════════════════════════════
// COMBAT ROUND
// ═══════════════════════════════════════════════════════════════

/**
 * Process combat for a unit - check if can fire and spawn projectile
 * @param {Object} unit - Attacking unit
 * @param {Array} enemies - Potential targets
 * @param {Object} stats - Unit stats {damage, fireRate, types}
 * @param {Object} combatStats - Combat stats {range}
 * @param {string} unitId - Unit ID for projectile type
 * @param {number} direction - Facing direction
 * @param {number} laneW - Lane width for x calculation
 * @param {number} now - Current timestamp
 * @returns {Object|null} New projectile or null
 */
export function processCombat(unit, enemies, stats, combatStats, unitId, direction, laneW, now) {
  if (unit.dead) return null;

  const targets = findTargetsInRange(unit, enemies, combatStats.range, direction);

  if (targets.length && now - unit.lastShot > stats.fireRate) {
    unit.lastShot = now;

    const projX = unit.lane * laneW + laneW / 2;
    const projY = unit.y + (direction * -20); // Spawn slightly ahead of unit

    sound('shoot');

    return createProjectile({
      unitId,
      x: projX,
      y: projY,
      lane: unit.lane,
      damage: stats.damage,
      attackerTypes: stats.types,
      direction,
      owner: direction < 0 ? 'player' : 'ai'
    });
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// RENDERING HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a projectile DOM element
 * @param {Object} projectile - Projectile data
 * @returns {HTMLElement} DOM element
 */
export function createProjectileElement(projectile) {
  const projDef = PROJECTILES[projectile.type];
  if (!projDef) return null;

  const el = document.createElement('div');
  el.className = 'projectile';
  el.style.position = 'absolute';
  el.style.left = `${projectile.x - projDef.width / 2}px`;
  el.style.top = `${projectile.y}px`;
  el.style.width = `${Math.max(projDef.width, 6)}px`;
  el.style.height = `${Math.max(projDef.height, 12)}px`;
  el.style.backgroundColor = projDef.color;
  el.style.borderRadius = '2px';
  el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}`;
  el.style.zIndex = '15';
  el.style.pointerEvents = 'none';

  if (projDef.trail) {
    el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}, 0 ${projDef.height}px ${projDef.height * 2}px ${projDef.trailColor}`;
  }

  return el;
}

/**
 * Get border style for blocked status (debug visualization)
 * @param {boolean} blocked - Whether entity is blocked
 * @param {string} movingColor - Color when moving
 * @returns {string} CSS border value
 */
export function getBlockedBorder(blocked, movingColor = 'lime') {
  return blocked ? '2px solid red' : `2px solid ${movingColor}`;
}
