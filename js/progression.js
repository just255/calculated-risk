// ═══════════════════════════════════════════════════════════════
// PROGRESSION - Post-battle performance tracking, trait growth, ranks
// ═══════════════════════════════════════════════════════════════

import { RANK_TABLE, TRAINING_GROWTH_PER_BATTLE, MOS_GROWTH_MULTIPLIER, TRAINING_CAP } from './constants.js';
import { getRoster, applyPromotion, saveRoster } from './roster.js';

// ─── Performance metrics template ─────────────────────────────

/**
 * Create a fresh metrics object for a soldier in a battle.
 */
export function createBattleMetrics() {
  return {
    kills: 0,
    assists: 0,
    damageDealt: 0,
    damageReceived: 0,
    shotsFired: 0,
    shotsHit: 0,
    timeSuppressed: 0,       // seconds
    timeInCover: 0,          // seconds
    survivalTime: 0,         // seconds
    healsDone: 0,
    repairsDone: 0,
    panics: 0,
    spotsProvided: 0,
    spotReactionTimeSum: 0,  // total ms (divide by spotsProvided for avg)
    crewmateLost: 0,
    objectivesCompleted: 0,
    ordersFollowed: 0,
    died: false,
    battleResult: null       // 'win' | 'loss' | 'draw'
  };
}

// ─── Trait growth matrix ──────────────────────────────────────

/**
 * Evaluate a soldier's battle performance and compute trait deltas.
 * Returns { trait: delta } for each affected trait.
 * All deltas are pre-diminishing-returns (raw increments).
 */
function computeTraitDeltas(metrics) {
  const d = {};
  const add = (trait, val) => { d[trait] = (d[trait] || 0) + val; };

  const hitRatio = metrics.shotsFired > 0 ? metrics.shotsHit / metrics.shotsFired : 0;

  // Kills
  if (metrics.kills >= 3) {
    add('aggression', 0.01);
    add('initiative', 0.005);
  } else if (metrics.kills >= 1) {
    add('aggression', 0.005);
  }

  // Assists
  if (metrics.assists >= 2) {
    add('awareness', 0.005);
    add('discipline', 0.005);
  }

  // Hit ratio
  if (hitRatio > 0.5 && metrics.shotsFired >= 5) {
    add('patience', 0.01);
    add('discipline', 0.01);
  } else if (hitRatio < 0.2 && metrics.shotsFired >= 5) {
    add('patience', -0.005);
    add('aggression', 0.005);
  }

  // Damage dealt
  if (metrics.damageDealt > 200) {
    add('aggression', 0.005);
  }

  // Damage received + survived
  if (metrics.damageReceived > 50 && !metrics.died) {
    add('courage', 0.01);
    add('survivability', 0.01);
  }

  // Damage received near-death (died with low courage)
  if (metrics.died) {
    add('survivability', -0.01);
  }

  // Suppression — high = numbness/desensitization
  if (metrics.timeSuppressed > 30) {
    add('courage', 0.005);
  }

  // Cover time
  if (metrics.timeInCover > 60) {
    add('aggression', -0.005);
    add('patience', 0.005);
  } else if (metrics.timeInCover < 10 && metrics.survivalTime > 30) {
    add('aggression', 0.005);
  }

  // Survival time
  if (metrics.survivalTime > 120 && !metrics.died) {
    add('courage', 0.005);
    add('morale', 0.02);
  }

  // Spots provided (TC value)
  if (metrics.spotsProvided >= 3) {
    add('awareness', 0.01);
    add('initiative', 0.005);
  }

  // Spot reaction time (fast = good awareness)
  if (metrics.spotsProvided > 0) {
    const avgReaction = metrics.spotReactionTimeSum / metrics.spotsProvided;
    if (avgReaction < 1500) { // under 1.5s average
      add('awareness', 0.005);
    }
  }

  // Panics
  if (metrics.panics > 0) {
    add('courage', -0.015 * metrics.panics);
    add('discipline', -0.01 * metrics.panics);
  }

  // Crewmate lost
  if (metrics.crewmateLost > 0) {
    add('courage', -0.01 * metrics.crewmateLost);
    add('morale', -0.1 * metrics.crewmateLost);
  }

  // Battle result
  if (metrics.battleResult === 'win') {
    add('initiative', 0.005);
    add('morale', 0.05);
  } else if (metrics.battleResult === 'loss') {
    add('morale', -0.05);
    if (!metrics.died) {
      // Surviving a loss builds character (if disciplined)
      add('courage', 0.005);
    }
  }

  // Role-specific
  if (metrics.healsDone > 0) {
    add('patience', 0.01);
  }
  if (metrics.repairsDone > 0) {
    add('discipline', 0.005);
  }

  // MVP (top performer placeholder — caller can set kills high)
  // objectivesCompleted
  if (metrics.objectivesCompleted > 0) {
    add('discipline', 0.01);
    add('initiative', 0.005);
  }

  // Orders followed (SGT compliance)
  if (metrics.ordersFollowed > 0) {
    add('discipline', 0.01);
  }

  return d;
}

// ─── Apply growth ─────────────────────────────────────────────

const PERSONALITY_TRAITS = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];

/**
 * Apply trait deltas to a soldier with diminishing returns.
 * Multiply delta by (1 - currentValue) so stats near 1.0 grow very slowly.
 * Negative deltas multiply by currentValue (stats near 0 decay slowly).
 */
function applyTraitGrowth(soldier, deltas) {
  for (const [trait, rawDelta] of Object.entries(deltas)) {
    if (trait === 'morale') {
      // Morale is not a personality trait — apply directly with bounds
      soldier.morale = Math.max(0, Math.min(1, (soldier.morale || 0.5) + rawDelta));
      continue;
    }
    if (trait === 'survivability') {
      const current = soldier.survivability ?? 0.5;
      const factor = rawDelta > 0 ? (1 - current) : current;
      soldier.survivability = Math.max(0, Math.min(1, current + rawDelta * factor));
      continue;
    }
    if (!PERSONALITY_TRAITS.includes(trait)) continue;

    const current = soldier.personality[trait] ?? 0.5;
    // Diminishing returns: positive growth harder near 1, negative harder near 0
    const factor = rawDelta > 0 ? (1 - current) : current;
    soldier.personality[trait] = Math.max(0, Math.min(1, current + rawDelta * factor));
  }
}

// ─── XP and rank ──────────────────────────────────────────────

const BASE_XP = 10;      // XP for participating
const KILL_XP = 5;       // XP per kill
const ASSIST_XP = 3;     // XP per assist
const WIN_BONUS = 15;    // XP bonus for winning
const MVP_BONUS = 20;    // XP bonus for top performer

/**
 * Calculate XP earned from battle metrics.
 */
function calculateXP(metrics, isMVP) {
  let xp = BASE_XP;
  xp += metrics.kills * KILL_XP;
  xp += metrics.assists * ASSIST_XP;
  if (metrics.battleResult === 'win') xp += WIN_BONUS;
  if (isMVP) xp += MVP_BONUS;
  return Math.floor(xp);
}

// ─── Wound / KIA processing ──────────────────────────────────

/**
 * Determine if a soldier who died in battle is KIA or wounded.
 * Higher survivability = more likely to survive as wounded.
 *
 * @returns {'wounded'|'kia'}
 */
function resolveDeathOutcome(soldier) {
  const survivalChance = soldier.survivability ?? 0.5;
  return Math.random() < survivalChance ? 'wounded' : 'kia';
}

/**
 * Determine wound recovery time (battles to miss).
 */
function rollWoundDuration() {
  return 1 + Math.floor(Math.random() * 3); // 1-3 battles
}

// ─── Main post-battle processor ───────────────────────────────

/**
 * Process all soldiers after a battle ends.
 * Takes a map of soldierId → battleMetrics.
 *
 * @param {Map<string, object>} metricsMap - soldierId → createBattleMetrics() result
 * @param {string} battleResult - 'win' | 'loss' | 'draw'
 * @returns {object} Summary of changes for UI display
 */
export function processBattleResults(metricsMap, battleResult) {
  const roster = getRoster();
  const summary = {
    promotions: [],   // [{ soldier, oldRank, newRank }]
    wounded: [],      // [{ soldier, battlesOut }]
    kia: [],          // [{ soldier }]
    traitChanges: [], // [{ soldier, deltas }]
    xpGained: []      // [{ soldier, xp }]
  };

  // Find MVP (highest composite score)
  let mvpId = null;
  let mvpScore = -1;
  for (const [id, m] of metricsMap) {
    const score = m.kills * 10 + m.assists * 5 + m.damageDealt * 0.1 +
                  m.spotsProvided * 8 + m.healsDone * 6 + m.repairsDone * 6;
    if (score > mvpScore) { mvpScore = score; mvpId = id; }
  }

  for (const soldier of roster) {
    if (soldier.status === 'kia') continue;

    const metrics = metricsMap.get(soldier.id);
    if (!metrics) continue; // Soldier wasn't in this battle

    // Set battle result on metrics
    metrics.battleResult = battleResult;

    // Track battles served
    soldier.battlesServed = (soldier.battlesServed || 0) + 1;
    soldier.kills = (soldier.kills || 0) + metrics.kills;

    // XP
    const isMVP = soldier.id === mvpId;
    const xp = calculateXP(metrics, isMVP);
    soldier.experience = (soldier.experience || 0) + xp;
    summary.xpGained.push({ soldier, xp, isMVP });

    // Trait growth
    const deltas = computeTraitDeltas(metrics);
    if (Object.keys(deltas).length > 0) {
      applyTraitGrowth(soldier, deltas);
      summary.traitChanges.push({ soldier, deltas });
    }

    // Training growth — improve proficiency in active role
    if (soldier.training) {
      const activeRole = metrics._role || soldier.role;
      if (activeRole) {
        const isMOS = soldier.mos === activeRole;
        const growth = TRAINING_GROWTH_PER_BATTLE * (isMOS ? MOS_GROWTH_MULTIPLIER : 1.0);
        soldier.training[activeRole] = Math.min(TRAINING_CAP, (soldier.training[activeRole] || 0) + growth);
      }
    }

    // Rank promotion
    const oldRankIndex = soldier.rankIndex;
    if (applyPromotion(soldier)) {
      summary.promotions.push({
        soldier,
        oldRank: RANK_TABLE[oldRankIndex],
        newRank: RANK_TABLE[soldier.rankIndex]
      });
    }

    // Death processing
    if (metrics.died) {
      const outcome = resolveDeathOutcome(soldier);
      if (outcome === 'kia') {
        soldier.status = 'kia';
        summary.kia.push({ soldier });
      } else {
        soldier.status = 'wounded';
        soldier.woundedBattlesLeft = rollWoundDuration();
        soldier.morale = Math.max(0.2, (soldier.morale || 0.5) - 0.15);
        summary.wounded.push({ soldier, battlesOut: soldier.woundedBattlesLeft });
      }
    }

    // Fatigue reset (between battles)
    soldier.fatigue = 0;

    // Partial morale recovery for survivors
    if (!metrics.died && soldier.morale < 0.7) {
      soldier.morale = Math.min(0.7, soldier.morale + 0.1);
    }
  }

  // Tick down wounded recovery for soldiers NOT in this battle
  for (const soldier of roster) {
    if (soldier.status === 'wounded' && !metricsMap.has(soldier.id)) {
      soldier.woundedBattlesLeft = Math.max(0, (soldier.woundedBattlesLeft || 1) - 1);
      if (soldier.woundedBattlesLeft <= 0) {
        soldier.status = 'active';
        soldier.woundedBattlesLeft = 0;
      }
    }
  }

  // Persist
  saveRoster();

  return summary;
}

// ─── Bond building ────────────────────────────────────────────

/**
 * Build familiarity bonds between crew members who served together.
 * Call after each battle with the list of vehicle crews that fought.
 *
 * @param {Array<string[]>} crewGroups - Array of soldier ID arrays (one per vehicle)
 */
export function buildBonds(crewGroups) {
  const roster = getRoster();
  const byId = new Map(roster.map(s => [s.id, s]));

  for (const group of crewGroups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = byId.get(group[i]);
        const b = byId.get(group[j]);
        if (!a || !b) continue;

        if (!a.bonds) a.bonds = {};
        if (!b.bonds) b.bonds = {};

        // Grow bond by 0.05 per battle, max 1.0
        a.bonds[b.id] = Math.min(1, (a.bonds[b.id] || 0) + 0.05);
        b.bonds[a.id] = Math.min(1, (b.bonds[a.id] || 0) + 0.05);
      }
    }
  }
}

/**
 * Get average bond strength between crew members of a vehicle.
 */
export function getCrewFamiliarity(soldierIds) {
  const roster = getRoster();
  const byId = new Map(roster.map(s => [s.id, s]));

  let total = 0;
  let count = 0;

  for (let i = 0; i < soldierIds.length; i++) {
    for (let j = i + 1; j < soldierIds.length; j++) {
      const a = byId.get(soldierIds[i]);
      if (a?.bonds?.[soldierIds[j]] != null) {
        total += a.bonds[soldierIds[j]];
      }
      count++;
    }
  }

  return count > 0 ? total / count : 0;
}
