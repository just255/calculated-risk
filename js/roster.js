// ═══════════════════════════════════════════════════════════════
// ROSTER - Persistent soldier management for the crew system
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { RANK_TABLE, CREW_SCHEMAS, VEHICLE_ROLES, SCORE_WEIGHTS, STREAK_CONFIG, HEROIC_ACTIONS, COMMENDATIONS, OFFICER_RANKS, GREEN_TO_GOLD, CMD_SCORE_WEIGHTS, SGT_LEADERSHIP_WEIGHTS, INFANTRY_ARCHETYPES, UNIT_COMBAT_STATS, UNITS, PIXELS_TO_METERS, MOS_DEFINITIONS, PHYSICAL_RANGES, TRAINING_GROWTH_PER_BATTLE, MOS_GROWTH_MULTIPLIER, TRAINING_CAP, ALL_ROLES, CREW_MOD_FLOOR, CREW_MOD_CEILING } from './constants.js';

// ─── Name pools ───────────────────────────────────────────────

const FIRST_NAMES = [
  'Rodriguez', 'Chen', 'Kim', 'Martinez', 'Jackson',
  'Williams', 'Brown', 'Jones', 'Davis', 'Garcia',
  'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas',
  'Harris', 'Clark', 'Lewis', 'Lee', 'Walker',
  'Hall', 'Allen', 'Young', 'King', 'Wright',
  'Lopez', 'Hill', 'Scott', 'Green', 'Adams',
  'Baker', 'Nelson', 'Carter', 'Mitchell', 'Perez',
  'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker',
  'Evans', 'Edwards', 'Collins', 'Stewart', 'Sanchez',
  'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan'
];

const LAST_NAMES = [
  'James', 'Michael', 'Robert', 'David', 'William',
  'Carlos', 'Daniel', 'Thomas', 'Joseph', 'Mark',
  'Anthony', 'Paul', 'Kevin', 'Jason', 'Brian',
  'Eric', 'Ryan', 'Sean', 'Kyle', 'Tyler',
  'Marcus', 'Derek', 'Troy', 'Omar', 'Malik',
  'Javier', 'Diego', 'Hector', 'Luis', 'Miguel',
  'Jin', 'Wei', 'Yuki', 'Kai', 'Raj',
  'Andre', 'Darius', 'Isaiah', 'Caleb', 'Ethan',
  'Noah', 'Mason', 'Logan', 'Aiden', 'Liam',
  'Cole', 'Blake', 'Chase', 'Grant', 'Wyatt'
];

// ─── UUID generation ──────────────────────────────────────────

let _idCounter = 0;

function generateId() {
  return `sol_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

// ─── Random helpers ───────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Generate physical attributes for a soldier.
 * @param {'recruit'|'starter'|'veteran'} tier
 * @returns {{ vision: number, strength: number, reflexes: number, endurance: number }}
 */
export function generatePhysicals(tier = 'recruit') {
  const r = PHYSICAL_RANGES[tier] || PHYSICAL_RANGES.recruit;
  return {
    vision:    Math.round(randRange(r.min, r.max)),
    strength:  Math.round(randRange(r.min, r.max)),
    reflexes:  Math.round(randRange(r.min, r.max)),
    endurance: Math.round(randRange(r.min, r.max))
  };
}

/**
 * Build starting training map for a given MOS.
 * @param {string} mos - Primary specialty
 * @returns {object} role → proficiency (0-1)
 */
function buildTrainingMap(mos) {
  const def = MOS_DEFINITIONS[mos];
  return def ? { ...def.startingTraining } : { [mos]: 0.5 };
}

// ─── Soldier factory ──────────────────────────────────────────

/**
 * Create a new soldier entity.
 * @param {object} opts
 * @param {'vehicle'|'infantry'|'officer'} opts.pool
 * @param {string} opts.role - 'tc','gunner','driver' or 'rifleman','medic','engineer','heavy_gunner'
 * @param {object} [opts.personality] - 6 traits, defaults to 0.5 each
 * @param {object} [opts.physicals] - { vision, strength, reflexes, endurance } (0-100)
 * @param {string} [opts.mos] - primary MOS, defaults to opts.role
 * @param {object} [opts.training] - role → proficiency map, auto-built from MOS if omitted
 * @param {object} [opts.name] - { first, last }, random if omitted
 * @param {number} [opts.rankIndex] - index into RANK_TABLE, default 0
 * @param {number} [opts.experience] - XP, default 0
 */
export function createSoldier(opts) {
  const p = opts.personality || {};
  const mos = opts.mos || opts.role || ALL_ROLES[0];
  return {
    id: generateId(),
    name: opts.name || { first: pick(LAST_NAMES), last: pick(FIRST_NAMES), nickname: null },
    callsign: null,
    rankIndex: opts.rankIndex ?? 0,
    experience: opts.experience ?? 0,

    // Personality — drives AI behavior (how they act)
    personality: {
      aggression:  clamp01(p.aggression  ?? 0.5),
      patience:    clamp01(p.patience    ?? 0.5),
      courage:     clamp01(p.courage     ?? 0.5),
      discipline:  clamp01(p.discipline  ?? 0.5),
      initiative:  clamp01(p.initiative  ?? 0.5),
      awareness:   clamp01(p.awareness   ?? 0.5)
    },

    // Physical attributes — drives combat performance (how well they perform)
    physicals: opts.physicals || generatePhysicals('recruit'),

    // MOS + cross-training
    mos,
    training: opts.training || buildTrainingMap(mos),

    pool: opts.pool,
    role: opts.role,
    insigniaSetId: opts.insigniaSetId || null,
    vehicleExpertise: opts.vehicleExpertise || {},

    status: 'active',        // 'active'|'wounded'|'kia'
    hpPercent: opts.hpPercent ?? 1.0,
    morale: opts.morale ?? 0.7,
    fatigue: opts.fatigue ?? 0,
    survivability: opts.survivability ?? 0.5,
    woundedBattlesLeft: 0,

    traits: [],
    commendations: [],
    mmr: 0,
    mmrFloor: 0,
    streak: 0,
    heroicActions: [],
    bonds: {},

    assignedVehicleId: null,
    assignedSlot: null,
    isSquadLeader: false,

    battlesServed: 0,
    kills: 0,
    missionsWithVehicle: {}
  };
}

/**
 * Generate a raw recruit — E-1, low stats, random name.
 */
export function generateRecruit(pool, role) {
  return createSoldier({
    pool,
    role,
    rankIndex: 0,
    personality: {
      aggression:  randRange(0.25, 0.35),
      patience:    randRange(0.25, 0.35),
      courage:     randRange(0.25, 0.35),
      discipline:  randRange(0.25, 0.35),
      initiative:  randRange(0.25, 0.35),
      awareness:   randRange(0.25, 0.35)
    },
    survivability: 0.5,
    morale: 0.6
  });
}

// ─── Roster capacity ─────────────────────────────────────────

const ROSTER_BASE_SLOTS = 15;
const ROSTER_WAVE_UNLOCKS = [
  { wave: 3,  slots: 20 },
  { wave: 5,  slots: 25 },
  { wave: 7,  slots: 30 },
  { wave: 10, slots: 40 },
  { wave: 15, slots: 50 }
];

/**
 * Get the current roster capacity based on highest wave completed.
 */
export function getRosterCapacity() {
  const highestWave = Game.stats?.highestWave || 0;
  let cap = ROSTER_BASE_SLOTS;
  for (const unlock of ROSTER_WAVE_UNLOCKS) {
    if (highestWave >= unlock.wave) cap = unlock.slots;
  }
  return cap;
}

/**
 * Get the next roster unlock info.
 * Returns { wave, slots } or null if maxed.
 */
export function getNextRosterUnlock() {
  const highestWave = Game.stats?.highestWave || 0;
  for (const unlock of ROSTER_WAVE_UNLOCKS) {
    if (highestWave < unlock.wave) return unlock;
  }
  return null;
}

/**
 * Check if there's room to add a soldier to the roster.
 */
export function hasRosterRoom() {
  const alive = ensureRoster().filter(s => s.status !== 'kia').length;
  return alive < getRosterCapacity();
}

// ─── Roster access ────────────────────────────────────────────

/**
 * Ensure Game.roster exists as an array.
 */
function ensureRoster() {
  if (!Array.isArray(Game.roster)) Game.roster = [];
  return Game.roster;
}

/** Get the full roster. */
export function getRoster() {
  return ensureRoster();
}

/** Get soldiers in a pool ('vehicle' or 'infantry'). */
export function getPool(pool) {
  return ensureRoster().filter(s => s.pool === pool && s.status !== 'kia');
}

/** Get unassigned soldiers matching pool + role. */
export function getAvailable(pool, role) {
  return ensureRoster().filter(s =>
    s.pool === pool &&
    s.role === role &&
    s.status === 'active' &&
    s.assignedVehicleId == null
  );
}

/** Find a soldier by ID. */
export function getSoldier(id) {
  return ensureRoster().find(s => s.id === id) || null;
}

// ─── Crew assignment ──────────────────────────────────────────

/**
 * Assign a soldier to a vehicle slot.
 * Unassigns any soldier currently in that slot first.
 */
export function assignToVehicle(soldierId, vehicleId, slot) {
  const roster = ensureRoster();
  const soldier = roster.find(s => s.id === soldierId);
  if (!soldier) return false;

  // Unassign anyone currently in this slot
  const existing = roster.find(s =>
    s.assignedVehicleId === vehicleId && s.assignedSlot === slot
  );
  if (existing) {
    existing.assignedVehicleId = null;
    existing.assignedSlot = null;
  }

  // Unassign this soldier from any previous slot
  soldier.assignedVehicleId = vehicleId;
  soldier.assignedSlot = slot;
  return true;
}

/** Remove a soldier from their vehicle assignment. */
export function unassignFromVehicle(soldierId) {
  const soldier = ensureRoster().find(s => s.id === soldierId);
  if (!soldier) return false;
  soldier.assignedVehicleId = null;
  soldier.assignedSlot = null;
  return true;
}

/** Get crew members assigned to a vehicle. Returns { tc, gunner, driver } or { tc, gunner } etc. */
export function getCrewForVehicle(vehicleId) {
  const roster = ensureRoster();
  const crew = {};
  for (const s of roster) {
    if (s.assignedVehicleId === vehicleId && s.assignedSlot) {
      crew[s.assignedSlot] = s;
    }
  }
  return crew;
}

/**
 * Get the crew schema for a unit type.
 * Returns the slot array from CREW_SCHEMAS or ['self'] for unknown types.
 */
export function getCrewSchema(unitId) {
  return CREW_SCHEMAS[unitId] || ['self'];
}

/**
 * Unassign all crew from a list of units.
 * Frees soldiers back to the available pool.
 */
export function unassignAllCrew(units) {
  for (const u of units) {
    if (!u) continue;
    const schema = CREW_SCHEMAS[u.unitId];
    if (!schema || schema[0] === 'self') continue;
    const vehicleId = u.id || u._crewVehicleId;
    if (!vehicleId) continue;
    const crew = getCrewForVehicle(vehicleId);
    for (const slot of schema) {
      if (crew[slot]) unassignFromVehicle(crew[slot].id);
    }
  }
}

// ─── Rank management ──────────────────────────────────────────

/** Get the rank table entry for a soldier (enlisted or officer). */
export function getRankInfo(soldier) {
  if (soldier.pool === 'officer') {
    return OFFICER_RANKS[soldier.rankIndex] || OFFICER_RANKS[0];
  }
  return RANK_TABLE[soldier.rankIndex] || RANK_TABLE[0];
}

/** Get the display string for a soldier's rank + name. */
export function getRankName(soldier) {
  const rank = getRankInfo(soldier);
  return `${rank.abbr} ${soldier.name.last}`;
}

/**
 * Get the soldier's effective MMR (floored by commendation ratchet).
 */
export function getMMR(soldier) {
  return Math.max(soldier.mmr || 0, soldier.mmrFloor || 0);
}

/**
 * Check if a soldier is eligible for promotion.
 * MMR must meet next rank threshold.
 * Returns the new rank index if eligible, or null.
 */
export function checkPromotion(soldier) {
  if (soldier.pool === 'officer') return checkOfficerPromotion(soldier);
  const nextIndex = soldier.rankIndex + 1;
  if (nextIndex >= RANK_TABLE.length) return null;
  const nextRank = RANK_TABLE[nextIndex];
  const mmr = getMMR(soldier);
  return mmr >= nextRank.mmr ? nextIndex : null;
}

/**
 * Check if a soldier should be demoted.
 * Demotes if MMR drops below current rank threshold.
 * Returns the new (lower) rank index, or null if no demotion.
 */
export function checkDemotion(soldier) {
  if (soldier.rankIndex <= 0) return null;
  const table = soldier.pool === 'officer' ? OFFICER_RANKS : RANK_TABLE;
  const currentRank = table[soldier.rankIndex];
  const mmr = getMMR(soldier);
  if (mmr < currentRank.mmr) {
    for (let i = soldier.rankIndex - 1; i >= 0; i--) {
      if (mmr >= table[i].mmr) return i;
    }
    return 0;
  }
  return null;
}

/**
 * Promote a soldier if eligible. Returns true if promoted.
 */
export function applyPromotion(soldier) {
  const newIndex = checkPromotion(soldier);
  if (newIndex == null) return false;
  soldier.rankIndex = newIndex;
  return true;
}

/**
 * Demote a soldier if performance dropped. Returns true if demoted.
 */
export function applyDemotion(soldier) {
  const newIndex = checkDemotion(soldier);
  if (newIndex == null) return false;
  soldier.rankIndex = newIndex;
  return true;
}

/**
 * Record a battle's score for a soldier — RL-style cumulative MMR.
 * Good performance raises MMR, bad performance lowers it.
 * Streaks amplify gains.
 */
export function recordBattleScore(soldier, battleScore, battleMetrics) {
  if (soldier.mmr === undefined) soldier.mmr = 0;
  if (soldier.streak === undefined) soldier.streak = 0;

  // Streak tracking
  const isGood = battleScore >= STREAK_CONFIG.threshold;
  if (isGood) {
    soldier.streak = Math.min((soldier.streak || 0) + 1, STREAK_CONFIG.maxStreak);
  } else {
    soldier.streak = 0; // Reset on bad performance
  }

  // Streak multiplier: 1.0 base + bonus per consecutive good battle
  const streakMult = 1.0 + soldier.streak * STREAK_CONFIG.bonusPerStreak;

  // Apply score to MMR (positive scores amplified by streak, negative scores applied directly)
  if (battleScore > 0) {
    soldier.mmr += Math.round(battleScore * streakMult * 10) / 10;
  } else {
    soldier.mmr += battleScore; // No streak multiplier on losses
  }

  // Floor: can never drop below commendation floor
  soldier.mmr = Math.max(soldier.mmr, soldier.mmrFloor || 0);

  // Check commendations
  _checkCommendations(soldier, battleScore, battleMetrics);
}

/**
 * Check and award commendations based on performance.
 */
function _checkCommendations(soldier, battleScore, metrics) {
  if (!soldier.commendations) soldier.commendations = [];
  const earned = new Set(soldier.commendations);

  // Combat Action: 10+ shots in one battle
  if (!earned.has('combatAction') && (metrics?.shotsFired || 0) >= 10) {
    soldier.commendations.push('combatAction');
    soldier.mmrFloor = (soldier.mmrFloor || 0) + (COMMENDATIONS.combatAction?.floorBoost || 10);
  }

  // Purple Heart: survived below 30% HP
  if (!earned.has('purpleHeart') && !metrics?.died && (metrics?.hpPercent || 1) < 0.3) {
    soldier.commendations.push('purpleHeart');
    soldier.mmrFloor = (soldier.mmrFloor || 0) + (COMMENDATIONS.purpleHeart?.floorBoost || 10);
  }

  // Veteran Service: 20+ battles
  if (!earned.has('veteranService') && (soldier.battlesServed || 0) >= 20) {
    soldier.commendations.push('veteranService');
    soldier.mmrFloor = (soldier.mmrFloor || 0) + (COMMENDATIONS.veteranService?.floorBoost || 30);
  }

  // Bronze Star: 3+ streak with score > 25
  if (!earned.has('bronzeStar') && (soldier.streak || 0) >= 3 && battleScore > 25) {
    soldier.commendations.push('bronzeStar');
    soldier.mmrFloor = (soldier.mmrFloor || 0) + (COMMENDATIONS.bronzeStar?.floorBoost || 20);
  }

  // Silver Star: 3+ streak with score > 40
  if (!earned.has('silverStar') && (soldier.streak || 0) >= 3 && battleScore > 40) {
    soldier.commendations.push('silverStar');
    soldier.mmrFloor = (soldier.mmrFloor || 0) + (COMMENDATIONS.silverStar?.floorBoost || 50);
  }
}

/**
 * Compute battle score from metrics — RL-style MMR delta.
 * Positive = gained rating, negative = lost rating.
 * NOTE: All weights are placeholder — needs playtesting
 */
export function computeBattleScore(metrics, result) {
  let score = 0;
  score += (metrics.kills || 0) * SCORE_WEIGHTS.kill;
  score += (metrics.shotsHit || 0) * SCORE_WEIGHTS.hit;
  score += (metrics.damageDealt || 0) * SCORE_WEIGHTS.damageDealt;
  score += (metrics.shotsFired || 0) * SCORE_WEIGHTS.shotFired;
  if (!metrics.died) score += SCORE_WEIGHTS.survived;
  if (metrics.died) score += SCORE_WEIGHTS.died;
  if (result === 'win') score += SCORE_WEIGHTS.waveCleared;

  // Heroic action bonuses
  if (metrics._heroics) {
    for (const actionId of metrics._heroics) {
      score += HEROIC_ACTIONS[actionId]?.score || 0;
    }
  }

  return Math.round(score * 10) / 10;
}

/**
 * Detect heroic actions from battle metrics.
 * Returns array of heroic action IDs earned this battle.
 */
export function detectHeroics(metrics, battleContext) {
  const heroics = [];

  // First Blood
  if (battleContext?.firstKillerId === metrics.soldierId) {
    heroics.push('firstBlood');
  }

  // Multi-Kill (3+ kills)
  if ((metrics.kills || 0) >= 3) {
    heroics.push('multiKill');
  }

  // Sharpshooter (70%+ accuracy with 5+ shots)
  if ((metrics.shotsFired || 0) >= 5) {
    const acc = metrics.shotsHit / metrics.shotsFired;
    if (acc >= 0.7) heroics.push('sharpshooter');
  }

  // Iron Will (survived below 20% HP)
  if (!metrics.died && (metrics.hpPercent || 1) < 0.2) {
    heroics.push('ironWill');
  }

  // Untouchable (0 damage taken in combat)
  if ((metrics.damageTaken || 0) === 0 && (metrics.shotsFired || 0) > 0) {
    heroics.push('untouchable');
  }

  // Last Stand (last unit alive, won)
  if (battleContext?.lastManStanding === metrics.soldierId && battleContext?.result === 'win') {
    heroics.push('lastStand');
  }

  return heroics;
}

// ─── Memorial system ─────────────────────────────────────────
// User-curated wall with 5 fixed slots. No time decay.
// Tiers based on legacy score quality (bronze/silver/gold).

const MEMORIAL_KEY = 'cr_memorial';
const RECENT_FALLEN_KEY = 'cr_recent_fallen';

/** Get slot-prefixed storage key (reads Game._activeSlot). */
function _slotKey(key) {
  const slot = Game._activeSlot;
  return slot != null ? `cr_s${slot}_${key}` : key;
}
export const MEMORIAL_THRESHOLD = 150;    // Minimum legacy score to qualify
export const MEMORIAL_MAX_SLOTS = 5;      // Fixed wall size
const RECENT_FALLEN_MAX = 10;             // FIFO cap on recent fallen list

// Legacy score tier thresholds
const TIER_GOLD = 400;
const TIER_SILVER = 250;

function ensureMemorial() {
  if (!Array.isArray(Game.memorial)) Game.memorial = [];
  return Game.memorial;
}

function ensureRecentFallen() {
  if (!Array.isArray(Game.recentFallen)) Game.recentFallen = [];
  return Game.recentFallen;
}

/**
 * Compute legacy score for a soldier.
 * Blends commendation-backed MMR floor (quality) with battles served (longevity).
 */
export function computeLegacyScore(soldier) {
  return (soldier.mmrFloor || 0) + (soldier.battlesServed || 0) * 3;
}

/**
 * Check if a KIA soldier qualifies for memorialization.
 */
export function qualifiesForMemorial(soldier) {
  return computeLegacyScore(soldier) >= MEMORIAL_THRESHOLD;
}

/**
 * Get the visual tier based on legacy score.
 * 'gold' = 400+, 'silver' = 250-399, 'bronze' = 150-249
 */
export function getMemorialTier(entry) {
  const score = entry.legacyScore || 0;
  if (score >= TIER_GOLD) return 'gold';
  if (score >= TIER_SILVER) return 'silver';
  return 'bronze';
}

/**
 * Create a memorial snapshot from a soldier.
 */
function _createMemorialEntry(soldier) {
  return {
    id: soldier.id,
    name: { ...soldier.name },
    rankIndex: soldier.rankIndex,
    role: soldier.role,
    pool: soldier.pool,
    mos: soldier.mos || soldier.role,
    personality: { ...soldier.personality },
    physicals: soldier.physicals ? { ...soldier.physicals } : null,
    training: soldier.training ? { ...soldier.training } : null,
    kills: soldier.kills || 0,
    battlesServed: soldier.battlesServed || 0,
    commendations: [...(soldier.commendations || [])],
    heroicActions: [...(soldier.heroicActions || [])],
    mmrFloor: soldier.mmrFloor || 0,
    legacyScore: computeLegacyScore(soldier),
    memorizedAt: Date.now()
  };
}

/**
 * Add a qualifying soldier to the memorial wall.
 * Returns the entry if added, null if wall is full or soldier doesn't qualify.
 */
export function addToMemorial(soldier) {
  if (!qualifiesForMemorial(soldier)) return null;
  const memorial = ensureMemorial();
  if (memorial.length >= MEMORIAL_MAX_SLOTS) return null;
  if (memorial.find(m => m.id === soldier.id)) return null;

  const entry = _createMemorialEntry(soldier);
  memorial.push(entry);
  saveMemorial();
  return entry;
}

/**
 * Replace an existing memorial entry with a new qualifying soldier.
 * The replaced soldier is gone forever.
 * Returns the new entry, or null if soldier doesn't qualify.
 */
export function replaceOnMemorial(oldSoldierId, newSoldier) {
  if (!qualifiesForMemorial(newSoldier)) return null;
  const memorial = ensureMemorial();
  const idx = memorial.findIndex(m => m.id === oldSoldierId);
  if (idx < 0) return null;

  const entry = _createMemorialEntry(newSoldier);
  memorial[idx] = entry;
  saveMemorial();
  return entry;
}

/**
 * Remove a memorial entry by soldier ID. Gone forever.
 */
export function removeFromMemorial(soldierId) {
  const memorial = ensureMemorial();
  const idx = memorial.findIndex(m => m.id === soldierId);
  if (idx >= 0) {
    memorial.splice(idx, 1);
    saveMemorial();
    return true;
  }
  return false;
}

/** Get all memorial wall entries. */
export function getMemorial() {
  return ensureMemorial();
}

/** Check if there's room on the wall. */
export function hasMemorialSlot() {
  return ensureMemorial().length < MEMORIAL_MAX_SLOTS;
}

/**
 * Track a recently fallen soldier (FIFO, max 10).
 * Call when a soldier dies. Stores a snapshot for the Legacy view.
 */
export function addRecentFallen(soldier) {
  const fallen = ensureRecentFallen();
  // Don't duplicate
  if (fallen.find(f => f.id === soldier.id)) return;
  const entry = _createMemorialEntry(soldier);
  entry.qualifies = qualifiesForMemorial(soldier);
  fallen.push(entry);
  // FIFO cap
  while (fallen.length > RECENT_FALLEN_MAX) fallen.shift();
  saveRecentFallen();
}

/**
 * Get recent fallen, split into qualifying and non-qualifying.
 * Excludes soldiers already on the memorial wall.
 */
export function getRecentFallen() {
  const fallen = ensureRecentFallen();
  const wallIds = new Set(ensureMemorial().map(m => m.id));
  const available = fallen.filter(f => !wallIds.has(f.id));
  return {
    qualifying: available.filter(f => f.qualifies),
    unqualifying: available.filter(f => !f.qualifies)
  };
}

/**
 * Remove a fallen soldier from the recent list (cleanup).
 */
export function removeRecentFallen(soldierId) {
  const fallen = ensureRecentFallen();
  const idx = fallen.findIndex(f => f.id === soldierId);
  if (idx >= 0) {
    fallen.splice(idx, 1);
    saveRecentFallen();
    return true;
  }
  return false;
}

/**
 * Process all KIA in roster into recent fallen list.
 * Call after battle results. Does NOT auto-add to wall.
 */
export function processKIAToFallen() {
  const roster = ensureRoster();
  for (const s of roster) {
    if (s.status === 'kia') addRecentFallen(s);
  }
}

/**
 * Get memorial wall entries for lineage influence on recruitment.
 */
export function getMemorialLineageInfluence() {
  return ensureMemorial().map(m => ({
    id: m.id,
    name: m.name,
    role: m.role,
    pool: m.pool,
    personality: m.personality,
    legacyScore: m.legacyScore
  }));
}

/** Save memorial to localStorage. */
export function saveMemorial() {
  try {
    localStorage.setItem(_slotKey(MEMORIAL_KEY), JSON.stringify(ensureMemorial()));
  } catch (e) {
    console.warn('Failed to save memorial:', e);
  }
}

/** Load memorial from localStorage + migrate legacy entries. */
export function loadMemorial() {
  try {
    const raw = localStorage.getItem(_slotKey(MEMORIAL_KEY));
    if (raw) Game.memorial = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load memorial:', e);
  }
  try {
    const raw = localStorage.getItem(_slotKey(RECENT_FALLEN_KEY));
    if (raw) Game.recentFallen = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load recent fallen:', e);
  }
  // Migrate legacy entries missing physicals/training
  _migrateMemorialEntries(ensureMemorial());
  _migrateMemorialEntries(ensureRecentFallen());
}

/** Backfill physicals + MOS + training on memorial/fallen entries. */
function _migrateMemorialEntries(entries) {
  let changed = false;
  for (const e of entries) {
    if (!e.physicals) {
      const p = e.personality || {};
      e.physicals = {
        vision:    Math.min(PHYSICAL_STAT_MAX, Math.max(0, Math.round(((p.awareness ?? 0.5) * 60) + randRange(10, 30)))),
        strength:  Math.min(PHYSICAL_STAT_MAX, Math.max(0, Math.round(((p.discipline ?? 0.5) * 60) + randRange(10, 30)))),
        reflexes:  Math.min(PHYSICAL_STAT_MAX, Math.max(0, Math.round(((p.initiative ?? 0.5) * 60) + randRange(10, 30)))),
        endurance: Math.min(PHYSICAL_STAT_MAX, Math.max(0, Math.round(((p.courage ?? 0.5) * 60) + randRange(10, 30))))
      };
      changed = true;
    }
    if (!e.mos) {
      e.mos = e.role || ALL_ROLES[0];
      changed = true;
    }
    if (!e.training) {
      e.training = buildTrainingMap(e.mos);
      const bonus = Math.min((e.battlesServed || 0) * TRAINING_GROWTH_PER_BATTLE, 0.4);
      if (e.training[e.mos] !== undefined) {
        e.training[e.mos] = Math.min(TRAINING_CAP, e.training[e.mos] + bonus);
      }
      changed = true;
    }
  }
  return changed;
}

/** Save recent fallen to localStorage. */
export function saveRecentFallen() {
  try {
    localStorage.setItem(_slotKey(RECENT_FALLEN_KEY), JSON.stringify(ensureRecentFallen()));
  } catch (e) {
    console.warn('Failed to save recent fallen:', e);
  }
}

// ─── Recruit dismiss lockout ─────────────────────────────────

const RECRUIT_LOCKOUT_RUNS = 10;

/**
 * Dismiss a recruit from the pool. Locks that slot for N runs.
 * @param {number} idx - index in Game.hqRecruitPool
 */
export function dismissRecruit(idx) {
  const pool = Game.hqRecruitPool;
  if (!pool || idx < 0 || idx >= pool.length) return;
  // Replace with a locked slot
  pool[idx] = { locked: true, runsLeft: RECRUIT_LOCKOUT_RUNS };
}

/**
 * Tick all locked recruit slots down by 1 run.
 * Unlocked slots get replaced with fresh recruits.
 * Call on run completion.
 */
export function tickRecruitLockouts() {
  const pool = Game.hqRecruitPool;
  if (!pool) return;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i]?.locked) {
      pool[i].runsLeft--;
      if (pool[i].runsLeft <= 0) {
        pool[i] = null; // Will be filled on next render
      }
    }
  }
}

/**
 * Fill any null slots in the recruit pool with fresh recruits.
 * Called before rendering the pool.
 */
export function fillRecruitSlots(generateFn) {
  const pool = Game.hqRecruitPool;
  if (!pool) return;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] === null) {
      const fresh = generateFn(1);
      pool[i] = fresh[0];
    }
  }
}

// ── Debug: manual rank control ───────────────────────────────

/** Force promote a soldier by 1 rank. */
export function debugPromote(soldier) {
  if (soldier.rankIndex < RANK_TABLE.length - 1) {
    soldier.rankIndex++;
    return true;
  }
  return false;
}

/** Force demote a soldier by 1 rank. */
export function debugDemote(soldier) {
  if (soldier.rankIndex > 0) {
    soldier.rankIndex--;
    return true;
  }
  return false;
}

/** Reset a soldier's rank, MMR, and commendations. */
export function debugClearRank(soldier) {
  soldier.rankIndex = 0;
  soldier.mmr = 0;
  soldier.mmrFloor = 0;
  soldier.streak = 0;
  soldier.commendations = [];
  soldier.heroicActions = [];
  soldier.experience = 0;
}

/** Check if a soldier is an NCO (eligible for TC). */
export function isNCO(soldier) {
  return getRankInfo(soldier).nco;
}

// ── Debug: physical stats + training ─────────────────────────

/** Set a soldier's rank to a specific index. */
export function debugSetRank(soldier, rankIndex) {
  const table = soldier.pool === 'officer' ? OFFICER_RANKS : RANK_TABLE;
  soldier.rankIndex = Math.max(0, Math.min(table.length - 1, rankIndex));
  soldier.mmr = table[soldier.rankIndex].mmr;
  soldier.mmrFloor = Math.max(soldier.mmrFloor || 0, soldier.mmr);
}

/** Set a soldier's MMR directly. */
export function debugSetMMR(soldier, mmr) {
  soldier.mmr = mmr;
  soldier.mmrFloor = Math.max(soldier.mmrFloor || 0, mmr);
}

/** Set a soldier's physical stats. Values 0-100. */
export function debugSetPhysicals(soldier, physicals) {
  if (!soldier.physicals) soldier.physicals = {};
  for (const [key, val] of Object.entries(physicals)) {
    soldier.physicals[key] = Math.max(0, Math.min(PHYSICAL_STAT_MAX, Math.round(val)));
  }
}

/** Set a soldier's training level for a specific role. Value 0-1. */
export function debugSetTraining(soldier, role, level) {
  if (!soldier.training) soldier.training = {};
  soldier.training[role] = Math.max(0, Math.min(TRAINING_CAP, level));
}

/** Set all training levels for a soldier. */
export function debugSetAllTraining(soldier, level) {
  if (!soldier.training) soldier.training = {};
  for (const role of ALL_ROLES) {
    soldier.training[role] = Math.max(0, Math.min(TRAINING_CAP, level));
  }
}

/** Max out a soldier for testing: rank 9, all physicals 90, all training 1.0. */
export function debugMaxSoldier(soldier) {
  const table = soldier.pool === 'officer' ? OFFICER_RANKS : RANK_TABLE;
  soldier.rankIndex = table.length - 1;
  soldier.mmr = table[soldier.rankIndex].mmr;
  soldier.mmrFloor = soldier.mmr;
  soldier.physicals = { vision: 90, strength: 90, reflexes: 90, endurance: 90 };
  debugSetAllTraining(soldier, TRAINING_CAP);
  soldier.battlesServed = 100;
  soldier.kills = 50;
}

/** Reset a soldier to fresh recruit state for testing. */
export function debugResetSoldier(soldier) {
  soldier.rankIndex = 0;
  soldier.mmr = 0;
  soldier.mmrFloor = 0;
  soldier.streak = 0;
  soldier.commendations = [];
  soldier.heroicActions = [];
  soldier.experience = 0;
  soldier.battlesServed = 0;
  soldier.kills = 0;
  soldier.physicals = generatePhysicals('recruit');
  soldier.training = buildTrainingMap(soldier.mos || soldier.role || ALL_ROLES[0]);
}

// ─── Officer system ──────────────────────────────────────────

/** Check if a soldier is an officer. */
export function isOfficer(soldier) {
  return soldier.pool === 'officer';
}

/** Get the OFFICER_RANKS entry for an officer. */
export function getOfficerRankInfo(soldier) {
  if (!isOfficer(soldier)) return null;
  return OFFICER_RANKS[soldier.rankIndex] || OFFICER_RANKS[0];
}

/**
 * Create a new officer (commander).
 * @param {object} [opts] - Same as createSoldier + officer-specific defaults
 */
export function createOfficer(opts = {}) {
  const s = createSoldier({
    ...opts,
    pool: 'officer',
    role: 'commander',
    rankIndex: opts.rankIndex ?? 0,
    personality: opts.personality || {
      aggression:  randRange(0.3, 0.6),
      patience:    randRange(0.4, 0.7),
      courage:     randRange(0.3, 0.6),
      discipline:  randRange(0.5, 0.8),
      initiative:  randRange(0.4, 0.7),
      awareness:   randRange(0.5, 0.8)
    },
    survivability: 1.0,  // Off-field, not at combat risk
    morale: 0.8
  });
  // Officer-specific tracking
  s.cmdMetrics = {
    runsCommanded: 0,
    wavesCompleted: 0,
    totalExtractions: 0,
    totalDeaths: 0,
    soldiersLost: 0,
    soldiersDeployed: 0,
    objectivesIssued: 0,
    objectivesCompleted: 0
  };
  return s;
}

/**
 * Check if an enlisted soldier can be promoted to officer (Green to Gold).
 * Must be E-5+ (rankIndex >= 5) and meet commendation requirements.
 * @returns {{ eligible, scrapCost, commendationsRequired, commendationsHave }} or null
 */
export function checkGreenToGold(soldier) {
  if (isOfficer(soldier)) return null;
  if (soldier.status !== 'active') return null;

  const rankIdx = soldier.rankIndex;
  const costs = GREEN_TO_GOLD[rankIdx];
  if (!costs) return null; // Below E-5

  const commCount = (soldier.commendations || []).length;
  const eligible = commCount >= costs.commendations;

  return {
    eligible,
    scrapCost: costs.scrap,
    commendationsRequired: costs.commendations,
    commendationsHave: commCount,
    enlistedRank: getRankInfo(soldier).abbr
  };
}

/**
 * Promote an enlisted soldier to officer. Irreversible.
 * Returns the modified soldier (now an officer), or null if ineligible.
 */
export function promoteToOfficer(soldier) {
  const check = checkGreenToGold(soldier);
  if (!check || !check.eligible) return null;
  if (Game.resources.scrap < check.scrapCost) return null;

  Game.resources.scrap -= check.scrapCost;

  // Convert to officer
  soldier.pool = 'officer';
  soldier.role = 'commander';
  soldier.rankIndex = 0; // O-1 (2LT)
  // MMR carries over — full career tracked
  soldier.assignedVehicleId = null;
  soldier.assignedSlot = null;
  soldier.isSquadLeader = false;

  // Initialize CMD metrics
  soldier.cmdMetrics = {
    runsCommanded: 0,
    wavesCompleted: 0,
    totalExtractions: 0,
    totalDeaths: 0,
    soldiersLost: 0,
    soldiersDeployed: 0,
    objectivesIssued: 0,
    objectivesCompleted: 0
  };

  // Track the promotion in history
  soldier.greenToGold = {
    enlistedMMR: soldier.mmr,
    promotedAt: Date.now(),
    battlesAsEnlisted: soldier.battlesServed
  };

  return soldier;
}

/**
 * Check if an officer is eligible for promotion to next officer rank.
 */
export function checkOfficerPromotion(soldier) {
  if (!isOfficer(soldier)) return null;
  const nextIdx = soldier.rankIndex + 1;
  if (nextIdx >= OFFICER_RANKS.length) return null;
  const mmr = getMMR(soldier);
  return mmr >= OFFICER_RANKS[nextIdx].mmr ? nextIdx : null;
}

/** Promote an officer if eligible. Returns true if promoted. */
export function applyOfficerPromotion(soldier) {
  const nextIdx = checkOfficerPromotion(soldier);
  if (nextIdx == null) return false;
  soldier.rankIndex = nextIdx;
  return true;
}

/**
 * Record a battle's CMD score for an officer.
 * Called after run completion with mission-level metrics.
 */
export function recordCmdScore(officer, missionMetrics) {
  if (!isOfficer(officer)) return;

  const w = CMD_SCORE_WEIGHTS;
  let score = 0;
  score += (missionMetrics.wavesCompleted || 0) * w.waveCompleted;
  score += missionMetrics.fullExtraction ? w.fullExtraction : 0;
  score += (missionMetrics.soldiersSurvived || 0) * w.soldierSurvived;
  score += (missionMetrics.soldiersLost || 0) * w.soldierLost;
  score += (missionMetrics.moraleAvg || 0) * w.moraleAvg;
  score += (missionMetrics.objectivesCompleted || 0) * w.objectiveCompleted;
  score += (missionMetrics.objectivesFailed || 0) * w.objectiveFailed;

  // Overkill penalty — diminishing returns for overpowered deployments
  if (missionMetrics.powerRatio > 2.0) {
    score += (missionMetrics.powerRatio - 2.0) * w.overkillPenalty;
  }

  // Apply to MMR (same system as enlisted)
  if (officer.mmr === undefined) officer.mmr = 0;
  officer.mmr += Math.round(score * 10) / 10;
  officer.mmr = Math.max(officer.mmr, officer.mmrFloor || 0);

  // Update CMD metrics
  const m = officer.cmdMetrics || {};
  m.runsCommanded = (m.runsCommanded || 0) + 1;
  m.wavesCompleted = (m.wavesCompleted || 0) + (missionMetrics.wavesCompleted || 0);
  m.soldiersLost = (m.soldiersLost || 0) + (missionMetrics.soldiersLost || 0);
  m.soldiersDeployed = (m.soldiersDeployed || 0) + (missionMetrics.soldiersDeployed || 0);
  m.objectivesIssued = (m.objectivesIssued || 0) + (missionMetrics.objectivesIssued || 0);
  m.objectivesCompleted = (m.objectivesCompleted || 0) + (missionMetrics.objectivesCompleted || 0);
  if (missionMetrics.extracted) m.totalExtractions = (m.totalExtractions || 0) + 1;
  if (missionMetrics.death) m.totalDeaths = (m.totalDeaths || 0) + 1;
  officer.cmdMetrics = m;

  // Check officer rank promotion
  applyOfficerPromotion(officer);
}

/**
 * Compute CMD effects for a battle based on officer stats and rank.
 * Returns passive modifiers applied to the deployed force.
 */
export function computeCmdEffects(officer) {
  if (!officer || !isOfficer(officer)) {
    return { maxSquads: 1, powerMult: 1.0, intelQuality: 0, moraleDegradationResist: 0, moraleRecovery: 0 };
  }
  const rank = OFFICER_RANKS[officer.rankIndex] || OFFICER_RANKS[0];
  const p = officer.personality || {};
  const rankBonus = officer.rankIndex * 0.15;

  return {
    maxSquads: rank.maxSquads,
    powerMult: rank.powerMult,
    intelQuality: (p.awareness || 0.5) * (0.5 + rankBonus),
    moraleDegradationResist: (p.discipline || 0.5) * (0.4 + officer.rankIndex * 0.1),
    moraleRecovery: (p.initiative || 0.5) * (0.3 + officer.rankIndex * 0.1),
    objectiveAggression: p.aggression || 0.5,
    responseSpeed: p.initiative || 0.5,
    riskTolerance: p.courage || 0.5
  };
}

/**
 * Compute SGT leadership score from personality traits.
 */
export function computeLeadership(soldier) {
  const p = soldier.personality || {};
  const w = SGT_LEADERSHIP_WEIGHTS;
  return (p.discipline || 0) * w.discipline
       + (p.initiative || 0) * w.initiative
       + (p.awareness || 0) * w.awareness
       + (p.courage || 0) * w.courage;
}

/**
 * Retire a soldier voluntarily. Different from dismiss (preserves for memorial).
 * Returns the retired soldier data, or null if can't retire.
 */
export function retireSoldier(soldierId) {
  const roster = ensureRoster();
  const idx = roster.findIndex(s => s.id === soldierId);
  if (idx < 0) return null;
  const soldier = roster[idx];
  if (soldier.isPlayerCharacter) return null; // Can't retire your own character

  // Mark as retired, remove from roster
  soldier.status = 'retired';
  roster.splice(idx, 1);

  // Add to recent fallen for memorial eligibility
  addRecentFallen(soldier);

  saveRoster();
  return soldier;
}

// ─── Crew modifiers ──────────────────────────────────────────

const PHYSICAL_STAT_MAX = 100; // max physical stat value

/**
 * Compute role effectiveness for a single physical stat.
 * physicalStat (0-100) × training proficiency (0-1) → effectiveness (0-1)
 */
function roleEffectiveness(physicalStat, trainingLevel) {
  const normalizedStat = (physicalStat || 0) / PHYSICAL_STAT_MAX;
  return normalizedStat * (0.5 + (trainingLevel || 0) * 0.5);
}

/**
 * Get crew modifiers for a soldier in a given role.
 * Returns multipliers (0-1) for each gameplay stat the role affects.
 * Downstream applies as: baseStat × (CREW_MOD_FLOOR + modifier × (CREW_MOD_CEILING - CREW_MOD_FLOOR))
 *
 * @param {object} soldier - Roster soldier with physicals + training
 * @param {string} role - Active role ('tc', 'gunner', 'driver', 'rifleman', etc.)
 * @returns {object} Modifier values (0-1 each)
 */
export function getCrewModifiers(soldier, role) {
  if (!soldier?.physicals) return _defaultCrewModifiers();
  const p = soldier.physicals;
  const t = soldier.training?.[role] ?? 0;
  const eff = (stat) => roleEffectiveness(stat, t);

  return {
    viewRange:             eff(p.vision),
    stabilityRecovery:     eff(p.reflexes),
    recoilManagement:      eff(p.strength),
    reloadSpeed:           eff(p.reflexes),
    suppressionResistance: eff(p.endurance),
    coverEffectiveness:    eff(p.endurance),
    terrainHandling:       eff(Math.round(Math.sqrt(p.reflexes * p.endurance))),
    turnRate:              eff(p.reflexes)
  };
}

/** Default modifiers for units without crew (recruit baseline). */
function _defaultCrewModifiers() {
  const baseline = 0.3;
  return {
    viewRange: baseline, stabilityRecovery: baseline, recoilManagement: baseline,
    reloadSpeed: baseline, suppressionResistance: baseline, coverEffectiveness: baseline, terrainHandling: baseline, turnRate: baseline
  };
}

// ─── Combat stats pipeline ───────────────────────────────────

/**
 * Get effective combat stats for a soldier.
 * Chains: base archetype → equipment modifiers → condition modifiers.
 * Returns { hp, maxHp, damage, fireRate, speed, range, special, modifiers[] }.
 *
 * @param {object} soldier - Roster soldier object
 * @param {object} [vehicle] - Vehicle inventory object (for vehicle crew)
 * @returns {object} Effective combat stats with modifier breakdown
 */
export function getEffectiveCombatStats(soldier, vehicle) {
  const modifiers = [];

  // Officers don't have combat stats — they're off-field
  if (soldier.pool === 'officer') {
    return { hp: 0, maxHp: 0, damage: 0, fireRate: 0, speed: 0, range: 0, special: null, modifiers: [], isOfficer: true };
  }

  // Base stats from archetype
  let base;
  if (soldier.pool === 'vehicle' && vehicle) {
    // Vehicle crew — stats come from the vehicle type
    const unitDef = UNITS.find(u => u.id === vehicle.unitId);
    const stats = UNIT_COMBAT_STATS[vehicle.unitId] || {};
    base = {
      hp: unitDef?.hp || 300,
      damage: unitDef?.damage || 30,
      fireRate: stats.fireRate || 1500,
      speed: stats.speed || 70,
      range: stats.range || 450,
      special: null
    };
  } else {
    // Infantry — stats from role archetype
    const archetype = INFANTRY_ARCHETYPES[soldier.role] || INFANTRY_ARCHETYPES.rifleman;
    base = { ...archetype };
  }

  let effective = {
    hp: base.hp,
    maxHp: base.hp,
    damage: base.damage,
    fireRate: base.fireRate,
    speed: base.speed,
    range: base.range,
    special: base.special || null
  };

  // ── Equipment modifiers (future — from soldier.equipment[]) ──
  if (soldier.equipment) {
    for (const item of soldier.equipment) {
      if (!item?.statMods) continue;
      for (const [stat, val] of Object.entries(item.statMods)) {
        if (effective[stat] !== undefined) {
          effective[stat] += val;
          modifiers.push({ source: item.name || 'Equipment', stat, value: val });
        }
      }
    }
  }

  // ── Physical stat modifiers ──
  // Each physical attribute modifies specific combat stats via roleEffectiveness
  if (soldier.physicals) {
    const ph = soldier.physicals;
    const t = soldier.training?.[soldier.role] ?? 0;
    const modRange = CREW_MOD_CEILING - CREW_MOD_FLOOR;

    // Strength → max HP bonus (tougher body absorbs more damage)
    const strMod = roleEffectiveness(ph.strength, t);
    const hpBonus = Math.round(effective.maxHp * strMod * modRange);
    if (hpBonus > 0) {
      effective.maxHp += hpBonus;
      effective.hp += hpBonus;
      modifiers.push({ source: 'Toughness', icon: '💪', stat: 'hp', value: hpBonus });
    }

    // Reflexes → fire rate reduction (faster reload — fast hands)
    const refMod = roleEffectiveness(ph.reflexes, t);
    const reloadReduction = Math.round(effective.fireRate * refMod * modRange);
    if (reloadReduction > 0) {
      effective.fireRate -= reloadReduction;
      modifiers.push({ source: 'Faster Reload', icon: '⚡', stat: 'fireRate', value: -reloadReduction });
    }

    // Vision → range bonus
    const visMod = roleEffectiveness(ph.vision, t);
    const rangeBonus = Math.round(effective.range * visMod * modRange);
    if (rangeBonus > 0) {
      effective.range += rangeBonus;
      modifiers.push({ source: 'Keen Eye', icon: '👁', stat: 'range', value: rangeBonus });
    }

    // Endurance → speed bonus (stamina for sustained movement)
    const endMod = roleEffectiveness(ph.endurance, t);
    const speedBonus = Math.round(effective.speed * endMod * modRange * 10) / 10;
    if (speedBonus > 0) {
      effective.speed = Math.round((effective.speed + speedBonus) * 10) / 10;
      modifiers.push({ source: 'Stamina', icon: '🏃', stat: 'speed', value: Math.round(speedBonus * 10) / 10 });
    }
  }

  // ── Condition modifiers ──
  // HP scales by soldier's persistent health
  const hpPercent = soldier.hpPercent ?? 1.0;
  if (hpPercent < 1.0) {
    const hpLoss = Math.round(effective.maxHp * (1 - hpPercent));
    effective.hp = effective.maxHp - hpLoss;
    if (hpLoss > 0) modifiers.push({ source: 'Wounded', stat: 'hp', value: -hpLoss });
  } else {
    effective.hp = effective.maxHp;
  }

  // Injury debuffs (future — from soldier.injuries[])
  if (soldier.injuries) {
    for (const injury of soldier.injuries) {
      if (!injury?.statMods) continue;
      for (const [stat, val] of Object.entries(injury.statMods)) {
        if (effective[stat] !== undefined) {
          effective[stat] += val;
          modifiers.push({ source: injury.name || 'Injury', stat, value: val });
        }
      }
    }
  }

  effective.modifiers = modifiers;

  // Derived display fields
  effective.dps = effective.fireRate > 0 ? Math.round(effective.damage * (1000 / effective.fireRate) * 10) / 10 : 0;
  effective.rpm = effective.fireRate > 0 ? Math.round(60000 / effective.fireRate) : 0;
  effective.rangeM = Math.round(effective.range * PIXELS_TO_METERS);
  effective.speedMs = Math.round(effective.speed * PIXELS_TO_METERS * 10) / 10;

  return effective;
}

// ─── Starter roster ───────────────────────────────────────────

/**
 * Seed a starter roster for new players.
 * Creates 6 vehicle crew + 4 infantry with slightly above-recruit stats.
 */
export function seedStarterRoster() {
  const roster = ensureRoster();

  // One-time expansion: disabled — roster grows through gameplay
  // TODO: re-enable when operations mode provides a natural path to larger rosters
  if (false) {
    const starterP = () => ({
      aggression:  randRange(0.35, 0.55), patience: randRange(0.35, 0.55),
      courage: randRange(0.35, 0.55), discipline: randRange(0.35, 0.55),
      initiative: randRange(0.35, 0.55), awareness: randRange(0.35, 0.55)
    });
    const extras = [
      'rifleman','rifleman','rifleman','rifleman','rifleman','rifleman','rifleman','rifleman',
      'medic','medic','engineer','engineer','heavy_gunner','heavy_gunner','heavy_gunner',
      'rifleman','rifleman','rifleman','rifleman','rifleman'
    ];
    for (const role of extras) {
      roster.push(createSoldier({
        pool: 'infantry', role,
        rankIndex: Math.random() < 0.5 ? 1 : 2,
        experience: Math.floor(randRange(30, 120)),
        personality: starterP(), physicals: generatePhysicals('starter'), survivability: 0.55
      }));
    }
    for (const role of ['tc','tc','tc','tc','tc', 'gunner','gunner','gunner','gunner','gunner', 'driver','driver','driver','driver','driver']) {
      roster.push(createSoldier({
        pool: 'vehicle', role, rankIndex: 0,
        experience: Math.floor(randRange(10, 50)),
        personality: starterP(), physicals: generatePhysicals('starter'), survivability: 0.45
      }));
    }
    saveRoster();
    return;
  }

  if (roster.length > 0) return; // Already seeded

  const starterPersonality = () => ({
    aggression:  randRange(0.35, 0.55),
    patience:    randRange(0.35, 0.55),
    courage:     randRange(0.35, 0.55),
    discipline:  randRange(0.35, 0.55),
    initiative:  randRange(0.35, 0.55),
    awareness:   randRange(0.35, 0.55)
  });

  // Vehicle crew — enough to fill 6 vehicles (18 slots) + spares
  const vehicleRoles = [
    'tc', 'tc', 'tc', 'tc', 'tc', 'tc', 'tc',
    'gunner', 'gunner', 'gunner', 'gunner', 'gunner', 'gunner', 'gunner',
    'driver', 'driver', 'driver', 'driver', 'driver', 'driver', 'driver'
  ];
  for (const role of vehicleRoles) {
    const s = createSoldier({
      pool: 'vehicle',
      role,
      rankIndex: Math.random() < 0.5 ? 1 : 2,
      experience: Math.floor(randRange(30, 120)),
      personality: starterPersonality(),
      physicals: generatePhysicals('starter'),
      survivability: 0.55
    });
    roster.push(s);
  }

  // Infantry — large platoon for scroll testing
  const infantryRoles = [
    'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman',
    'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman',
    'medic', 'medic', 'medic',
    'engineer', 'engineer', 'engineer',
    'heavy_gunner', 'heavy_gunner', 'heavy_gunner',
    'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman'
  ];
  for (const role of infantryRoles) {
    const s = createSoldier({
      pool: 'infantry',
      role,
      rankIndex: Math.random() < 0.5 ? 1 : 2,
      experience: Math.floor(randRange(30, 120)),
      personality: starterPersonality(),
      physicals: generatePhysicals('starter'),
      survivability: 0.55
    });
    roster.push(s);
  }

}

// ─── Persistence ──────────────────────────────────────────────

const ROSTER_KEY = 'cr_roster';

/** Export roster to a serializable format. */
export function exportRoster() {
  return ensureRoster();
}

/** Import roster from saved data. Migrates legacy soldiers missing physicals/training. */
export function importRoster(data) {
  if (!Array.isArray(data)) return;
  Game.roster = data;
  _migrateRoster();
}

/** Migrate legacy soldiers: add physicals + MOS + training if missing. */
function _migrateRoster() {
  // Migration config: how personality traits seed physical attributes
  const MIGRATION_TRAIT_MAP = {
    vision:    'awareness',
    strength:  'discipline',
    reflexes:  'initiative',
    endurance: 'courage'
  };
  const MIGRATION_TRAIT_SCALE = 60;    // personality (0-1) × scale = base physical
  const MIGRATION_TRAIT_DEFAULT = 0.5; // fallback trait value
  const MIGRATION_JITTER_MIN = 10;     // random variance range
  const MIGRATION_JITTER_MAX = 30;
  const MIGRATION_PHYSICAL_MIN = 0;
  const MIGRATION_PHYSICAL_MAX = 100;
  const MIGRATION_MAX_TRAINING_BONUS = 0.4;  // cap for battles-served training bonus

  for (const s of Game.roster) {
    if (!s.physicals) {
      const p = s.personality || {};
      s.physicals = {};
      for (const [physical, trait] of Object.entries(MIGRATION_TRAIT_MAP)) {
        const traitVal = p[trait] ?? MIGRATION_TRAIT_DEFAULT;
        const raw = Math.round(traitVal * MIGRATION_TRAIT_SCALE + randRange(MIGRATION_JITTER_MIN, MIGRATION_JITTER_MAX));
        s.physicals[physical] = Math.min(MIGRATION_PHYSICAL_MAX, Math.max(MIGRATION_PHYSICAL_MIN, raw));
      }
    }
    if (!s.mos) {
      s.mos = s.role || ALL_ROLES[0];
    }
    if (!s.training) {
      s.training = buildTrainingMap(s.mos);
      const bonus = Math.min((s.battlesServed || 0) * TRAINING_GROWTH_PER_BATTLE, MIGRATION_MAX_TRAINING_BONUS);
      if (s.training[s.mos] !== undefined) {
        s.training[s.mos] = Math.min(TRAINING_CAP, s.training[s.mos] + bonus);
      }
    }
  }
}

/** Save roster to localStorage + sync to debug server. */
export function saveRoster() {
  try {
    localStorage.setItem(_slotKey(ROSTER_KEY), JSON.stringify(exportRoster()));
    // Sync to debug endpoint (fire and forget)
    fetch('/api/debug/roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roster: exportRoster(), vehicles: Game.vehicles || [] })
    }).catch(() => {});
  } catch (e) {
    console.warn('Failed to save roster:', e);
  }
}

/** Load roster from localStorage. */
export function loadRoster() {
  try {
    const raw = localStorage.getItem(_slotKey(ROSTER_KEY));
    if (raw) {
      importRoster(JSON.parse(raw));
    }
  } catch (e) {
    console.warn('Failed to load roster:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// VEHICLE INVENTORY — Persistent vehicle entities
// ═══════════════════════════════════════════════════════════════

const VEHICLE_KEY = 'cr_vehicles';

/**
 * Create a persistent vehicle entity.
 * @param {string} unitId - Vehicle type (sherman, jeep, humvee, tiger, abrams, etc.)
 * @param {object} [opts] - Optional overrides
 */
export function createVehicle(unitId, opts = {}) {
  const v = {
    id: opts.id || `veh_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`,
    unitId,
    name: opts.name || null,        // Optional callsign (e.g., "Fury")
    hpPercent: opts.hpPercent ?? 1.0,
    condition: opts.condition ?? 1.0,  // Long-term durability (degrades over many battles)
    status: opts.status || 'active',   // 'active'|'damaged'|'destroyed'
    insigniaSetId: opts.insigniaSetId || null,
    battlesServed: 0,
    totalDamageTaken: 0
  };
  // Pass through custom flags (e.g., _isReinforcement for mission vehicles)
  if (opts._isReinforcement) v._isReinforcement = true;
  return v;
}

function ensureVehicles() {
  if (!Array.isArray(Game.vehicles)) Game.vehicles = [];
  return Game.vehicles;
}

/** Get all vehicles. */
export function getVehicles() {
  return ensureVehicles();
}

/** Get available (active, not destroyed) vehicles. */
export function getAvailableVehicles() {
  return ensureVehicles().filter(v => v.status !== 'destroyed');
}

/** Get a vehicle by ID. */
export function getVehicle(id) {
  return ensureVehicles().find(v => v.id === id) || null;
}

/** Save vehicles to localStorage. */
export function saveVehicles() {
  try {
    localStorage.setItem(_slotKey(VEHICLE_KEY), JSON.stringify(ensureVehicles()));
  } catch (e) {
    console.warn('Failed to save vehicles:', e);
  }
}

/** Load vehicles from localStorage. */
export function loadVehicles() {
  try {
    const raw = localStorage.getItem(_slotKey(VEHICLE_KEY));
    if (raw) {
      Game.vehicles = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to load vehicles:', e);
  }

  // Cleanup: unassign crew soldiers pointing to vehicles that no longer exist
  const vehicleIds = new Set((Game.vehicles || []).map(v => v.id));
  for (const s of ensureRoster()) {
    if (s.pool === 'vehicle' && s.assignedVehicleId && !vehicleIds.has(s.assignedVehicleId)) {
      s.assignedVehicleId = null;
      s.assignedSlot = null;
    }
  }
}

/**
 * Seed starter vehicles for new players.
 * Only runs if Game.vehicles is empty.
 */
export function seedStarterVehicles() {
  const vehicles = ensureVehicles();
  if (vehicles.length > 0) return;

  // Unassign all vehicle crew from stale IDs (previous sessions had different vehicle IDs)
  const roster = ensureRoster();
  for (const s of roster) {
    if (s.pool === 'vehicle' && s.assignedVehicleId != null) {
      s.assignedVehicleId = null;
      s.assignedSlot = null;
    }
  }

  const STARTER = [
    { unitId: 'sherman', count: 2 },
    { unitId: 'jeep', count: 1 },
    { unitId: 'humvee', count: 1 }
  ];

  for (const entry of STARTER) {
    for (let i = 0; i < entry.count; i++) {
      vehicles.push(createVehicle(entry.unitId));
    }
  }
  saveVehicles();
}

// ── Repair / Heal (temporary — placeholder until factory/math system) ──

/**
 * Passive heal all active soldiers by a percentage (between waves).
 * @param {number} amount - 0-1, fraction of max HP to restore
 */
export function healAllSoldiers(amount = 0.2) {
  for (const s of ensureRoster()) {
    if (s.status === 'active' || s.status === 'wounded') {
      s.hpPercent = Math.min(1.0, s.hpPercent + amount);
      // Tick recovery timer
      if (s.woundedBattlesLeft > 0) s.woundedBattlesLeft--;
      // Recover when HP high enough AND timer done
      if (s.status === 'wounded' && s.hpPercent > 0.5 && s.woundedBattlesLeft <= 0) {
        s.status = 'active';
      }
    }
  }
  saveRoster();
}

/**
 * Instantly heal a wounded soldier (spend scrap).
 * @param {string} soldierId
 * @param {number} cost - scrap to deduct
 * @returns {boolean} success
 */
export function rushHeal(soldierId, cost) {
  const roster = ensureRoster();
  const s = roster.find(r => r.id === soldierId);
  if (!s || s.status !== 'wounded') return false;
  s.status = 'active';
  s.hpPercent = 1.0;
  s.woundedBattlesLeft = 0;
  saveRoster();
  return true;
}

/**
 * Passive repair all non-destroyed vehicles by a percentage (between waves).
 * @param {number} amount - 0-1, fraction of max HP to restore
 */
export function repairAllVehicles(amount = 0.15) {
  for (const v of ensureVehicles()) {
    if (v.status !== 'destroyed') {
      v.hpPercent = Math.min(1.0, v.hpPercent + amount);
      if (v.status === 'damaged' && v.hpPercent > 0.5) v.status = 'active';
    }
  }
  saveVehicles();
}

/**
 * Debug: full heal all soldiers and repair all vehicles (including destroyed).
 */
export function debugHealAll() {
  for (const s of ensureRoster()) {
    if (s.status !== 'kia') {
      s.hpPercent = 1.0;
      s.status = 'active';
    }
  }
  for (const v of ensureVehicles()) {
    v.hpPercent = 1.0;
    v.status = 'active';
  }
  saveRoster();
  saveVehicles();
}
