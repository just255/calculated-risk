// ═══════════════════════════════════════════════════════════════
// PROJECTILE RESOLVER — Shared hit detection, damage, and combat
// effects for all free-form battle modes (fire range, endless, campaign).
// Lane-based and H2H modes use their own systems.
// ═══════════════════════════════════════════════════════════════

import { Team, Owner, getStanceModifier, getEnemyStance, CREW_DEFAULT_MOD } from './constants.js';
import { applyHitStabilityDrop } from './fire-decision.js';
import { isTerrainBlocked, getTerrainAt } from './terrain-utils.js';
import { getBridgeCoverMult, isBridgeDeckBlocking } from './terrain-query.js';
import {
  recordDamage,
  applyMoraleEvent,
  MoraleEvent,
  applySuppression,
  getArmorTier,
  getTierDamageMultiplier
} from './ai.js';
import { logEvent } from './battle-log.js';

// ── Terrain cover system ─────────────────────────────────────
// Miss chance: projectile "hits a tree" — based on terrain + endurance (cover effectiveness)
// Damage reduction: strength absorbs impact when hit lands

const TERRAIN_MISS_CHANCE = {
  open:    0,
  grass:   0,
  brush:   0.10,
  forest:  0.25,
  trench:  0.35,
  pillbox: 0.45,
  water:   0
};

const TERRAIN_SUPPRESSION_MULT = {
  open:    1.0,
  grass:   1.0,
  brush:   0.85,
  forest:  0.70,
  trench:  0.55,
  pillbox: 0.40,
  water:   1.0
};

/**
 * Apply terrain cover effects to incoming damage.
 * Returns { missed, dmg, suppressionMult } — missed=true means projectile hit cover, not the unit.
 *
 * @param {object} b - Battle state
 * @param {object} unit - Target unit being hit
 * @param {number} dmg - Incoming damage before cover
 * @returns {{ missed: boolean, dmg: number, suppressionMult: number }}
 */
function applyTerrainCover(b, unit, dmg) {
  const terrain = getTerrainAt(b, unit.x, unit.y);
  const baseMiss = TERRAIN_MISS_CHANCE[terrain] || 0;
  const suppressionMult = TERRAIN_SUPPRESSION_MULT[terrain] || 1.0;

  if (baseMiss <= 0 && suppressionMult >= 1.0) {
    return { missed: false, dmg, suppressionMult: 1.0 };
  }

  // Endurance (cover effectiveness) modifies miss chance: high endurance = better cover use
  // coverMod ranges from CREW_DEFAULT_MOD (0.3) to ~1.0
  const coverMod = unit._crewMods?.coverEffectiveness ?? CREW_DEFAULT_MOD;
  const missChance = baseMiss * (0.5 + coverMod * 0.5); // 50%-100% of base miss chance

  // Roll for miss
  if (Math.random() < missChance) {
    return { missed: true, dmg: 0, suppressionMult };
  }

  // Strength-based damage reduction: stronger soldiers absorb more impact
  // strengthMod ranges from ~0.3 to ~1.0
  const strengthMod = unit._crewMods?.recoilManagement ?? CREW_DEFAULT_MOD; // recoilManagement is strength-driven
  const dmgReduction = strengthMod * 0.12; // 0-12% damage reduction
  const reducedDmg = Math.max(1, Math.round(dmg * (1 - dmgReduction)));

  return { missed: false, dmg: reducedDmg, suppressionMult };
}

/**
 * Track hit/kill metrics for roster soldier progression.
 * Finds the source unit by ID, then credits the linked soldier (infantry)
 * or gunner crew member (vehicle).
 */
function _trackHitMetric(b, sourceId, dmg, isKill) {
  if (!b._soldierMetrics || !sourceId) return;
  const allUnits = [...(b.units || [])];
  if (b.hero && !b.hero.observer) allUnits.push(b.hero);
  const srcUnit = allUnits.find(u => u.id === sourceId);
  if (!srcUnit) return;

  // Infantry: credit soldier directly
  if (srcUnit._soldierId && b._soldierMetrics.has(srcUnit._soldierId)) {
    const m = b._soldierMetrics.get(srcUnit._soldierId);
    m.shotsHit++;
    m.damageDealt += dmg;
    if (isKill) m.kills++;
  }
  // Vehicle: credit gunner
  if (srcUnit._crewSoldierIds?.gunner && b._soldierMetrics.has(srcUnit._crewSoldierIds.gunner)) {
    const m = b._soldierMetrics.get(srcUnit._crewSoldierIds.gunner);
    m.shotsHit++;
    m.damageDealt += dmg;
    if (isKill) m.kills++;
  }
}

/**
 * Apply damage from an enemy projectile to a blue unit (hero or ally).
 * Shared logic: tier scaling, stability drop, suppression, shock, logging.
 */
function _applyEnemyHitToBlue(b, p, unit, now, opts = {}) {
  const { useTierDamage, debugInvincible, onKill } = opts;

  let dmg = p.damage;

  // Tier-based damage scaling
  if (useTierDamage) {
    const defTier = getArmorTier(unit);
    dmg = Math.round(dmg * getTierDamageMultiplier(p.attackerTier ?? 0, defTier));
  }

  // Bridge truss cover
  const bridgeMult = getBridgeCoverMult(b.terrainMap?.bridges, unit.x, unit.y, p.vx, p.vy);
  if (bridgeMult < 1) dmg = Math.round(dmg * bridgeMult);

  // God mode: hero takes no damage
  if (unit._godMode) { p.dead = true; return; }

  // Terrain cover: miss chance + damage reduction
  const cover = applyTerrainCover(b, unit, dmg);
  if (cover.missed) {
    p.dead = true;
    // Still apply reduced suppression — near miss in cover
    applySuppression(unit, dmg * 0.3 * cover.suppressionMult, unit.maxHp);
    return;
  }
  dmg = cover.dmg;

  // Critical hit roll — source unit's crit chance
  let isCrit = false;
  if (p._critChance > 0 && Math.random() < p._critChance) {
    dmg = Math.round(dmg * 1.5);
    isCrit = true;
  }

  unit.hp -= dmg;

  // Penetration — projectile continues through target with reduced damage
  if (p._penetration > 0 && Math.random() < p._penetration) {
    p.damage = Math.round(p.damage * 0.5);
    p._penetration = 0; // only penetrate once
    // don't mark p.dead — it continues
  } else {
    p.dead = true;
  }

  // Physics: stability drop, shock, suppression (reduced by cover)
  applyHitStabilityDrop(unit, dmg);
  unit._shockTimer = 2;
  unit._lastAttackerId = p.sourceId || null;
  unit._lastCrit = isCrit;
  if (isCrit) console.log(`[CRIT] ${p.sourceId} → ${unit.id} dmg:${dmg} (1.5×)`);
  applySuppression(unit, dmg * cover.suppressionMult, unit.maxHp);
  recordDamage(unit, p.sourceId || '?', dmg);

  // Debug invincibility
  if (debugInvincible) {
    unit.hp = unit.maxHp; unit.dead = false;
  }

  if (unit.hp <= 0) {
    unit.hp = 0; unit.dead = true;
    logEvent(b, { t: now, who: p.sourceId || '?', team: Team.RED, type: 'kill',
      x: Math.round(unit.x), y: Math.round(unit.y), action: 'kill',
      target: unit.id, dmg, detail: `hp:0/${unit.maxHp}` });

    const killer = b.enemies?.find(en => en.id === p.sourceId);
    if (killer && !killer.dead) applyMoraleEvent(killer, MoraleEvent.LANDED_KILL, 0.5);
    if (onKill) onKill(unit, dmg, killer);
  } else {
    logEvent(b, { t: now, who: p.sourceId || '?', team: Team.RED, type: 'hit',
      x: Math.round(unit.x), y: Math.round(unit.y), action: 'hit',
      target: unit.id, dmg, detail: `hp:${unit.hp}/${unit.maxHp}` });
  }

  return dmg;
}

/**
 * Detonate an AOE projectile at an impact point.
 * Damages units within blast radius, suppresses units in near-miss range.
 */
function _detonateProjectile(b, p, impactX, impactY, now, opts = {}) {
  const { useTierDamage, debugInvincible, onEnemyKill, onAllyKill, onHeroHit, heroRef } = opts;
  const blastR = p.blastRadius;
  const nearMissR = blastR * 1.5; // Suppression-only zone beyond blast

  // Determine which units to check based on projectile owner
  const isBlueShot = p.owner === Owner.PLAYER || p.owner === Owner.ALLY;
  const targets = isBlueShot ? (b.enemies || []) : (b.units || []);

  // Check hero as a target for enemy AOE
  if (!isBlueShot && heroRef && !heroRef.dead) {
    const hd = Math.sqrt((impactX - heroRef.x) ** 2 + (impactY - heroRef.y) ** 2);
    if (hd < blastR) {
      const falloff = 1.0 - (hd / blastR);
      const blastDmg = Math.round(p.damage * falloff);
      if (blastDmg > 0) {
        _applyEnemyHitToBlue(b, { ...p, damage: blastDmg }, heroRef, now, {
          useTierDamage, debugInvincible: debugInvincible?.blueInvincible, onKill: onHeroHit
        });
      }
    } else if (hd < nearMissR) {
      applySuppression(heroRef, 0, heroRef.maxHp); // near-miss
      applyHitStabilityDrop(heroRef, 1);
    }
  }

  for (const unit of targets) {
    if (unit.dead) continue;
    const dist = Math.sqrt((impactX - unit.x) ** 2 + (impactY - unit.y) ** 2);

    if (dist < blastR) {
      // In blast radius — deal falloff damage
      const falloff = 1.0 - (dist / blastR);
      const blastDmg = Math.round(p.damage * falloff);
      if (blastDmg <= 0) continue;

      if (isBlueShot) {
        // Blue shooting red
        let dmg = blastDmg;
        if (useTierDamage) {
          dmg = Math.round(dmg * getTierDamageMultiplier(p.attackerTier ?? 0, getArmorTier(unit)));
        }
        // Terrain cover on blast damage
        const bCover = applyTerrainCover(b, unit, dmg);
        if (bCover.missed) {
          applySuppression(unit, dmg * 0.3 * bCover.suppressionMult, unit.maxHp);
          continue;
        }
        dmg = bCover.dmg;
        unit.hp -= dmg;
        if (unit.hp < 0) unit.hp = 0;
        applyHitStabilityDrop(unit, dmg);
        unit._shockTimer = 2;
        applySuppression(unit, dmg * bCover.suppressionMult, unit.maxHp);
        recordDamage(unit, p.sourceId || '?', dmg);

        if (unit.hp <= 0) {
          unit.dead = true;
          logEvent(b, { t: now, who: p.sourceId || '?', team: Team.BLUE, type: 'kill',
            x: Math.round(unit.x), y: Math.round(unit.y), action: 'kill',
            target: unit.id, dmg, detail: `hp:0/${unit.maxHp} blast` });
          _trackHitMetric(b, p.sourceId, dmg, true);
          const killer = (b.units || []).find(u => u.id === p.sourceId) || heroRef;
          if (killer && !killer.dead) applyMoraleEvent(killer, MoraleEvent.LANDED_KILL, 0.5);
          if (onEnemyKill) onEnemyKill(unit, dmg, killer);
        } else {
          logEvent(b, { t: now, who: p.sourceId || '?', team: Team.BLUE, type: 'hit',
            x: Math.round(unit.x), y: Math.round(unit.y), action: 'hit',
            target: unit.id, dmg, detail: `hp:${unit.hp}/${unit.maxHp} blast` });
          _trackHitMetric(b, p.sourceId, dmg, false);
        }
      } else {
        // Red shooting blue
        _applyEnemyHitToBlue(b, { ...p, damage: blastDmg }, unit, now, {
          useTierDamage, debugInvincible: debugInvincible?.blueInvincible,
          onKill: onAllyKill
        });
      }
    } else if (dist < nearMissR) {
      // Near miss — suppression only, no damage
      applySuppression(unit, 0, unit.maxHp); // near-miss
      applyHitStabilityDrop(unit, 1);
    }
  }

  // Visual explosion effect
  if (!b.effects) b.effects = [];
  b.effects.push({ type: 'explosion', x: impactX, y: impactY, radius: blastR, t: now });

  // Log blast event
  logEvent(b, { t: now, who: p.sourceId || '?', team: isBlueShot ? Team.BLUE : Team.RED,
    type: 'blast', x: Math.round(impactX), y: Math.round(impactY),
    action: 'detonate', detail: `radius:${blastR} dmg:${p.damage}` });
}

/**
 * Resolve all projectile movement, hit detection, damage, and combat effects.
 *
 * @param {object} b - Battle object
 * @param {number} now - Current timestamp (ms)
 * @param {number} dtSec - Delta time in seconds
 * @param {object} [opts] - Mode-specific options
 * @param {object}   [opts.heroRef]          - Hero object (endless/campaign) or null
 * @param {number}   [opts.heroHitRadiusSq]  - Squared hit radius for hero (625=25px, 361=19px)
 * @param {boolean}  [opts.useTierDamage]    - Use tier-based damage scaling
 * @param {boolean}  [opts.useStanceModifiers] - Use stance-based damage modifiers (campaign)
 * @param {object}   [opts.debugInvincible]  - { redInvincible, blueInvincible } flags
 * @param {Function} [opts.onEnemyKill]      - (enemy, dmg, killerUnit) mode-specific kill handling
 * @param {Function} [opts.onAllyKill]       - (unit, dmg, killerUnit) mode-specific ally death handling
 * @param {Function} [opts.onHeroHit]        - (hero, dmg, projectile) mode-specific hero hit handling
 */
export function resolveProjectiles(b, now, dtSec, opts = {}) {
  const {
    heroRef = null,
    heroHitRadiusSq = 0,
    useTierDamage = false,
    useStanceModifiers = false,
    debugInvincible = null,
    onEnemyKill = null,
    onAllyKill = null,
    onHeroHit = null
  } = opts;

  // --- MOVE + RESOLVE ---
  b.projectiles.forEach(p => {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;

    // Bounds check
    if (p.x < 0 || p.x > b.mapWidth || p.y < 0 || p.y > b.mapHeight) {
      p.dead = true;
      return;
    }

    // Terrain collision — artillery arcs over, everything else stops
    if (p.type !== 'artillery' && b.terrainMap && isTerrainBlocked(b, p.x, p.y)) {
      p.dead = true;
      return;
    }

    // --- AOE DETONATION: shell reaches impact point ---
    if (!p.dead && p.blastRadius > 0 && p.impactTarget) {
      const toImpactX = p.impactTarget.x - p.originX;
      const toImpactY = p.impactTarget.y - p.originY;
      const totalDist = Math.sqrt(toImpactX * toImpactX + toImpactY * toImpactY);
      const traveledX = p.x - p.originX;
      const traveledY = p.y - p.originY;
      const traveled = Math.sqrt(traveledX * traveledX + traveledY * traveledY);

      if (traveled >= totalDist) {
        // Shell reached impact point — detonate
        _detonateProjectile(b, p, p.impactTarget.x, p.impactTarget.y, now, opts);
        p.dead = true;
        return;
      }
    }

    if (p.owner === Owner.PLAYER || p.owner === Owner.ALLY) {
      // --- Player/ally projectiles hitting enemies ---
      b.enemies.forEach(e => {
        if (e.dead || p.dead) return;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        if (dx * dx + dy * dy < 400) { // ~20px radius
          // Bridge deck blocks shots between different elevation levels
          if (isBridgeDeckBlocking(b.terrainMap?.bridges, p.originX ?? p.x, p.originY ?? p.y, e.x, e.y, p._bridgeElevation, e._bridgeElevation)) return;

          let dmg = p.damage;

          // Tier-based damage scaling (infantry < light < medium < heavy)
          if (useTierDamage) {
            const defTier = getArmorTier(e);
            dmg = Math.round(dmg * getTierDamageMultiplier(p.attackerTier ?? 0, defTier));
          }

          // Stance-based damage modifiers (campaign)
          if (useStanceModifiers) {
            let attackerStance = 'autonomous';
            if (p.owner === Owner.ALLY && p.sourceId) {
              const sourceUnit = b.units?.find(u => u.id === p.sourceId);
              if (sourceUnit) attackerStance = sourceUnit.stance || 'autonomous';
            } else if (p.owner === Owner.PLAYER) {
              attackerStance = 'aggressive';
            }
            const targetStance = getEnemyStance(e.aiType);
            const stanceMod = getStanceModifier(attackerStance, targetStance);
            dmg = Math.round(dmg * stanceMod.damageMod);
          }

          // Legacy modifier damage reduction (armored/shielded)
          if (e.modifier === 'armored') {
            dmg = Math.round(dmg * 0.5);
          } else if (e.modifier === 'shielded') {
            const projAngle = Math.atan2(p.vy, p.vx);
            let angleDiff = projAngle - e.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            if (Math.abs(angleDiff) > Math.PI / 2) dmg = Math.round(dmg * 0.3);
          }

          // Bridge truss cover — directional damage reduction
          const bridgeMult = getBridgeCoverMult(b.terrainMap?.bridges, e.x, e.y, p.vx, p.vy);
          if (bridgeMult < 1) dmg = Math.round(dmg * bridgeMult);

          // Terrain cover: miss chance + damage reduction
          const eCover = applyTerrainCover(b, e, dmg);
          if (eCover.missed) {
            applySuppression(e, dmg * 0.3 * eCover.suppressionMult, e.maxHp);
            return; // Projectile missed — hit terrain cover
          }
          dmg = eCover.dmg;

          e.hp -= dmg;
          if (e.hp < 0) e.hp = 0;

          // AOE shells pass through infantry — only stop on armored targets
          const targetTier = getArmorTier(e);
          if (p.blastRadius > 0 && targetTier === 0) {
            // Shell passes through infantry, continues to impact point
            // Damage is dealt but shell isn't destroyed
          } else {
            p.dead = true;
            // If AOE shell stops on a vehicle, detonate at that position
            if (p.blastRadius > 0 && !e.dead) {
              _detonateProjectile(b, p, e.x, e.y, now, opts);
            }
          }
          applyHitStabilityDrop(e, dmg);

          // Combat effects
          e._shockTimer = 2;
          e._lastAttackerId = p.sourceId || null;
          applySuppression(e, dmg * eCover.suppressionMult, e.maxHp);
          recordDamage(e, p.sourceId || 'hero', dmg);

          // Debug invincibility
          if (debugInvincible?.redInvincible) {
            e.hp = e.maxHp; e.dead = false;
          }

          if (e.hp <= 0) {
            e.dead = true;
            b.kills++;

            logEvent(b, { t: now, who: p.sourceId || '?', team: Team.BLUE, type: 'kill', x: Math.round(e.x), y: Math.round(e.y), action: 'kill', target: e.id, dmg, detail: `hp:0/${e.maxHp}` });
            // Track kill for roster metrics
            _trackHitMetric(b, p.sourceId, dmg, true);

            // Killer morale boost
            const killer = b.units?.find(u => u.id === p.sourceId);
            if (killer && !killer.dead) applyMoraleEvent(killer, MoraleEvent.LANDED_KILL, 0.5);

            // Commander succession
            _handleCommanderDeath(b, e, b.enemies, Team.RED, now);

            // Nearby morale/suppression cascade
            _cascadeMorale(b.enemies, e);

            // Mode-specific kill callback
            if (onEnemyKill) onEnemyKill(e, dmg, killer);
          } else {
            logEvent(b, { t: now, who: p.sourceId || '?', team: Team.BLUE, type: 'hit', x: Math.round(e.x), y: Math.round(e.y), action: 'hit', target: e.id, dmg, detail: `hp:${e.hp}/${e.maxHp}` });
            _trackHitMetric(b, p.sourceId, dmg, false);
          }
        }
      });
    } else if (p.owner === Owner.ENEMY) {
      // --- Enemy projectiles hitting hero ---
      if (heroRef && !p.dead && heroHitRadiusSq > 0) {
        const hdx = p.x - heroRef.x;
        const hdy = p.y - heroRef.y;
        if (hdx * hdx + hdy * hdy < heroHitRadiusSq) {
          // Same damage pipeline as ally units (tier scaling, stability, suppression, logging)
          _applyEnemyHitToBlue(b, p, heroRef, now, {
            useTierDamage,
            debugInvincible: debugInvincible?.blueInvincible,
            onKill: onHeroHit
          });
          if (!heroRef.dead && onHeroHit) onHeroHit(heroRef, p.damage, p);
        }
      }

      // --- Enemy projectiles hitting ally units ---
      if (!p.dead && b.units) {
        for (const unit of b.units) {
          if (unit.dead || p.dead) continue;
          const udx = p.x - unit.x;
          const udy = p.y - unit.y;
          if (udx * udx + udy * udy < 400) {
            // Bridge deck blocks shots
            if (isBridgeDeckBlocking(b.terrainMap?.bridges, p.originX ?? p.x, p.originY ?? p.y, unit.x, unit.y, p._bridgeElevation, unit._bridgeElevation)) continue;

            // Same damage pipeline as hero (shared function)
            _applyEnemyHitToBlue(b, p, unit, now, {
              useTierDamage,
              debugInvincible: debugInvincible?.blueInvincible,
              onKill: (deadUnit, dmg, killer) => {
                _handleCommanderDeath(b, deadUnit, b.units, Team.BLUE, now);
                _cascadeMorale(b.units, deadUnit);
                if (onAllyKill) onAllyKill(deadUnit, dmg, killer);
              }
            });
            break;
          }
        }
      }
    }
  });

  // --- NEAR-MISS SUPPRESSION --- Projectiles within 30px suppress nearby units
  b.projectiles.forEach(p => {
    if (p.dead) return;
    if (!p._suppressedIds) p._suppressedIds = new Set();
    const nearMissRadSq = 900; // 30px^2
    const nearTargets = (p.owner === Owner.PLAYER || p.owner === Owner.ALLY) ? b.enemies : (b.units || []);
    for (const u of nearTargets) {
      if (u.dead || p._suppressedIds.has(u.id)) continue;
      const dx = p.x - u.x, dy = p.y - u.y;
      if (dx * dx + dy * dy < nearMissRadSq) {
        applySuppression(u, 0, u.maxHp); // near-miss
        p._suppressedIds.add(u.id);
      }
    }
  });

  // --- CLEANUP ---
  b.projectiles = b.projectiles.filter(p => !p.dead);
}

// --- Internal helpers ---

/** Handle commander death: promote highest-leadership survivor */
function _handleCommanderDeath(b, deadUnit, teamUnits, team, now) {
  if (!deadUnit.isLeader) return;
  deadUnit.isLeader = false;
  const candidates = teamUnits.filter(u => !u.dead && u !== deadUnit);
  const successor = candidates.length > 0
    ? candidates.reduce((best, u) => (u.leadership ?? 0) > (best.leadership ?? 0) ? u : best, candidates[0])
    : null;
  if (successor) {
    successor.isLeader = true;
    if (b._teamLeaders) b._teamLeaders[team] = successor;
    logEvent(b, { t: now, who: deadUnit.id, team, type: 'movement', x: Math.round(deadUnit.x), y: Math.round(deadUnit.y), action: 'commander died', detail: `promoted ${successor.id} (ldr:${(successor.leadership ?? 0).toFixed(1)})` });
  } else {
    if (b._teamLeaders) b._teamLeaders[team] = null;
    logEvent(b, { t: now, who: deadUnit.id, team, type: 'movement', x: Math.round(deadUnit.x), y: Math.round(deadUnit.y), action: 'commander died', detail: 'no successor' });
  }
}

/** Cascade morale loss + suppression to nearby allies of a killed unit */
function _cascadeMorale(teamUnits, deadUnit) {
  for (const ally of teamUnits) {
    if (ally.dead || ally === deadUnit) continue;
    const adx = ally.x - deadUnit.x, ady = ally.y - deadUnit.y;
    const distSq = adx * adx + ady * ady;
    if (distSq < 40000) { // within ~200px
      applyMoraleEvent(ally, MoraleEvent.ALLY_DIED, 0.5);
      if (distSq < 6400) { // within ~80px
        applySuppression(ally, 0, ally.maxHp); // ally death shock — near-miss equivalent
      }
    }
  }
}
