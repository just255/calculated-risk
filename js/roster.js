// ═══════════════════════════════════════════════════════════════
// ROSTER - Persistent soldier management for the crew system
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { RANK_TABLE, CREW_SCHEMAS, VEHICLE_ROLES, SCORE_WEIGHTS, STREAK_CONFIG, HEROIC_ACTIONS, COMMENDATIONS } from './constants.js';

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

// ─── Soldier factory ──────────────────────────────────────────

/**
 * Create a new soldier entity.
 * @param {object} opts
 * @param {'vehicle'|'infantry'} opts.pool
 * @param {string} opts.role - 'tc','gunner','driver' or 'rifleman','medic','engineer','heavy_gunner'
 * @param {object} [opts.personality] - 6 traits, defaults to 0.5 each
 * @param {object} [opts.name] - { first, last }, random if omitted
 * @param {number} [opts.rankIndex] - index into RANK_TABLE, default 0
 * @param {number} [opts.experience] - XP, default 0
 */
export function createSoldier(opts) {
  const p = opts.personality || {};
  return {
    id: generateId(),
    name: opts.name || { first: pick(LAST_NAMES), last: pick(FIRST_NAMES), nickname: null },
    callsign: null,
    rankIndex: opts.rankIndex ?? 0,
    experience: opts.experience ?? 0,

    personality: {
      aggression:  clamp01(p.aggression  ?? 0.5),
      patience:    clamp01(p.patience    ?? 0.5),
      courage:     clamp01(p.courage     ?? 0.5),
      discipline:  clamp01(p.discipline  ?? 0.5),
      initiative:  clamp01(p.initiative  ?? 0.5),
      awareness:   clamp01(p.awareness   ?? 0.5)
    },

    pool: opts.pool,
    role: opts.role,
    insigniaSetId: opts.insigniaSetId || null,
    vehicleExpertise: opts.vehicleExpertise || {},

    status: 'active',        // 'active'|'wounded'|'kia'
    hpPercent: opts.hpPercent ?? 1.0,  // persistent health 0-1 (deploys at this % of max HP)
    morale: opts.morale ?? 0.7,
    fatigue: opts.fatigue ?? 0,
    survivability: opts.survivability ?? 0.5,
    woundedBattlesLeft: 0,

    traits: [],
    commendations: [],      // earned commendation IDs (permanent MMR floor boosts)
    mmr: 0,                  // cumulative rating — goes up/down each battle (RL-style)
    mmrFloor: 0,             // permanent minimum MMR from commendations (ratchet)
    streak: 0,               // consecutive "good" battle count (amplifies gains)
    heroicActions: [],       // lifetime heroic action IDs earned
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

/** Get the RANK_TABLE entry for a soldier. */
export function getRankInfo(soldier) {
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
  const currentRank = RANK_TABLE[soldier.rankIndex];
  const mmr = getMMR(soldier);
  if (mmr < currentRank.mmr) {
    for (let i = soldier.rankIndex - 1; i >= 0; i--) {
      if (mmr >= RANK_TABLE[i].mmr) return i;
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

// ─── Starter roster ───────────────────────────────────────────

/**
 * Seed a starter roster for new players.
 * Creates 6 vehicle crew + 4 infantry with slightly above-recruit stats.
 */
export function seedStarterRoster() {
  const roster = ensureRoster();

  // One-time expansion: if roster exists but is small, bulk up
  if (roster.length > 0 && roster.length < 40) {
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
        personality: starterP(), survivability: 0.55
      }));
    }
    // Ensure enough vehicle crew for all presets
    for (const role of ['tc','tc','tc','tc','tc', 'gunner','gunner','gunner','gunner','gunner', 'driver','driver','driver','driver','driver']) {
      roster.push(createSoldier({
        pool: 'vehicle', role, rankIndex: 0,
        experience: Math.floor(randRange(10, 50)),
        personality: starterP(), survivability: 0.45
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
      rankIndex: Math.random() < 0.5 ? 1 : 2, // PV2 or PFC
      experience: Math.floor(randRange(30, 120)),
      personality: starterPersonality(),
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

/** Import roster from saved data. */
export function importRoster(data) {
  if (!Array.isArray(data)) return;
  Game.roster = data;
}

/** Save roster to localStorage. */
export function saveRoster() {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(exportRoster()));
  } catch (e) {
    console.warn('Failed to save roster:', e);
  }
}

/** Load roster from localStorage. */
export function loadRoster() {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
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
  return {
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
    localStorage.setItem(VEHICLE_KEY, JSON.stringify(ensureVehicles()));
  } catch (e) {
    console.warn('Failed to save vehicles:', e);
  }
}

/** Load vehicles from localStorage. */
export function loadVehicles() {
  try {
    const raw = localStorage.getItem(VEHICLE_KEY);
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
      if (s.hpPercent > 0.5 && s.status === 'wounded') s.status = 'active';
    }
  }
  saveRoster();
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
