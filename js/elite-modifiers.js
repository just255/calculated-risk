// ═══════════════════════════════════════════════════════════════
// ELITE MODIFIERS — Random affixes for elite/heavy enemies
// 5 modifiers that create mini-boss encounters
// ═══════════════════════════════════════════════════════════════

export const ELITE_MODIFIERS = {
  fast: {
    label: 'Fast',
    color: '#00ffff',          // Cyan glow
    apply(enemy) {
      enemy.speed *= 1.8;
    }
  },

  armored: {
    label: 'Armored',
    color: '#888888',          // Grey glow
    apply(enemy) {
      // Damage reduction handled in projectile hit code (0.5x)
    }
  },

  commander: {
    label: 'Commander',
    color: '#ffd700',          // Gold glow
    auraRange: 150,
    damageBuff: 1.3,
    apply(enemy) {
      // Aura is applied each frame via updateModifierEffects
    }
  },

  berserker: {
    label: 'Berserker',
    color: '#ff2222',          // Red glow
    hpThreshold: 0.3,
    apply(enemy) {
      // Berserker rage checked each frame via updateModifierEffects
    }
  },

  shielded: {
    label: 'Shielded',
    color: '#4488ff',          // Blue glow
    apply(enemy) {
      // Frontal damage reduction handled in projectile hit code (70% frontal)
    }
  }
};

// Weighted table — harder modifiers become more likely at higher waves
const MODIFIER_WEIGHTS = [
  { key: 'fast',      baseWeight: 20, waveBonus: 0 },
  { key: 'armored',   baseWeight: 15, waveBonus: 1 },
  { key: 'commander', baseWeight: 10, waveBonus: 2 },
  { key: 'berserker', baseWeight: 10, waveBonus: 1.5 },
  { key: 'shielded',  baseWeight: 12, waveBonus: 1 }
];

/**
 * Roll a random modifier, weighted by wave number.
 * @param {number} wave - Current wave number
 * @returns {string} Modifier key
 */
export function rollModifier(wave) {
  let totalWeight = 0;
  const entries = MODIFIER_WEIGHTS.map(m => {
    const w = m.baseWeight + wave * m.waveBonus;
    totalWeight += w;
    return { key: m.key, weight: w };
  });

  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.key;
  }
  return 'fast'; // fallback
}

/**
 * Apply a modifier to an enemy. Sets stats + marker properties.
 * @param {object} enemy - Enemy entity
 * @param {string} key - Modifier key from ELITE_MODIFIERS
 */
export function applyModifier(enemy, key) {
  const mod = ELITE_MODIFIERS[key];
  if (!mod) return;

  enemy.modifier = key;
  enemy.modifierColor = mod.color;
  enemy.modifierLabel = mod.label;
  mod.apply(enemy);
}

/**
 * Tick modifier effects each frame.
 * - Commander: buff nearby enemies' damage
 * - Berserker: boost speed/damage when below HP threshold
 *
 * @param {Array} enemies - All enemies in battle
 * @param {number} dtSec - Frame delta in seconds
 */
export function updateModifierEffects(enemies, dtSec) {
  // First, reset any buffed flags from last frame
  for (const e of enemies) {
    if (e.dead) continue;
    if (e._commanderBuffed) {
      e._commanderBuffed = false;
    }
  }

  for (const e of enemies) {
    if (e.dead || !e.modifier) continue;

    if (e.modifier === 'commander') {
      // Buff allies within aura range
      const mod = ELITE_MODIFIERS.commander;
      for (const ally of enemies) {
        if (ally === e || ally.dead) continue;
        const dx = ally.x - e.x;
        const dy = ally.y - e.y;
        if (dx * dx + dy * dy < mod.auraRange * mod.auraRange) {
          ally._commanderBuffed = true;
        }
      }
    }

    if (e.modifier === 'berserker') {
      const mod = ELITE_MODIFIERS.berserker;
      const hpRatio = e.hp / e.maxHp;
      if (hpRatio < mod.hpThreshold && !e._berserkerActive) {
        // Activate berserker rage
        e._berserkerActive = true;
        e.speed *= 2.0;
        e.damage *= 2.0;
      }
    }
  }
}

/**
 * Get effective damage for an enemy (applies commander buff).
 * Call this when computing projectile damage from an enemy.
 * @param {object} enemy - Enemy entity
 * @returns {number} Effective damage
 */
export function getModifiedDamage(enemy) {
  let dmg = enemy.damage || 10;
  if (enemy._commanderBuffed) {
    dmg = Math.round(dmg * ELITE_MODIFIERS.commander.damageBuff);
  }
  return dmg;
}
