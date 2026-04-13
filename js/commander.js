import { logEvent } from './battle-log.js';

// ═══════════════════════════════════════════════════════════════
// COMMANDER — Strategic-level AI (Mode-Agnostic)
//
// Top of the command hierarchy: Commander → Sergeant → Unit.
// The commander evaluates the overall battlefield picture and
// assigns high-level objectives to sergeants. Sergeants translate
// objectives into tactics (commands, waypoints, formations).
// Units execute those tactics through their individual brains.
//
// The commander is mode-agnostic — it works with generic concepts:
// squads, budgets, objectives, map dimensions. Mode code (game.js,
// state.js) handles when/how to create and feed the commander.
//
// Commander API:
//   createCommander(config)              — create a new commander
//   planDeployment(cmdr, b, budget)      — plan squad deployment
//   updateCommander(cmdr, b, now)        — runtime brain (call each tick)
//   getUnitPref(cmdr, unitId, category)  — preference lookup
//   scaleCommanderByWave(cmdr, wave)     — progressive difficulty
// ═══════════════════════════════════════════════════════════════


// ── Objective types ───────────────────────────────────────────

export const Objective = {
  ATTACK:     'attack',
  DEFEND:     'defend',
  ADVANCE_TO: 'advance_to',
  FALL_BACK:  'fall_back',
  SUPPORT:    'support'
};


// ── Play types (tactical actions for squads) ────────────────

export const Play = {
  ASSAULT:    'assault',     // Direct push at target
  DEFEND:     'defend',      // Hold position, engage incoming
  FLANK:      'flank',       // Route wide, hit from the side
  FALL_BACK:  'fall_back',   // Withdraw to target position
  PROBE:      'probe',       // Small commit, test defenses
  OVERWHELM:  'overwhelm'    // Converge all squads on one point
};


// ── Deployment plays (pre-battle wave spawn strategy) ────────────

export const DeploymentPlay = {
  RUSH:           'rush',            // One big squad, all at once, center
  PROBE_AND_PUSH: 'probe_and_push',  // Scouts first, main force follows
  PINCER:         'pincer',          // Main center + flanker delayed
  FEINT:          'feint',           // Small distraction center, main flanks wide
  ECHELON:        'echelon',         // Staggered diagonal squads
  WAVE_ASSAULT:   'wave_assault'     // Many small squads, all at once, spread
};

// Static config per deployment play
// sizePct: fraction of total budget (0 = use fixedSize instead)
// delay: 0 or [min, max] ms range
// position: 'center' | 'flank' | 'wide_flank' | 'spread' | 'diagonal_N'
// objective: 'attack' | 'advance_then_attack'
// fixedSize: [min, max] unit count (overrides sizePct)
const DEPLOYMENT_PLAY_DEFS = {
  [DeploymentPlay.RUSH]: {
    squads: [{ sizePct: 1.0, delay: 0, position: 'center', objective: 'attack' }],
    minUnits: 2
  },
  [DeploymentPlay.PROBE_AND_PUSH]: {
    squads: [
      { sizePct: 0, delay: 0, position: 'center', objective: 'attack', fixedSize: [5, 5] },
      { sizePct: 1.0, delay: [5000, 8000], position: 'center', objective: 'attack' }
    ],
    minUnits: 10
  },
  [DeploymentPlay.PINCER]: {
    squads: [
      { sizePct: 0.6, delay: 0, position: 'center', objective: 'attack' },
      { sizePct: 0.4, delay: [3000, 5000], position: 'flank', objective: 'advance_then_attack' }
    ],
    minUnits: 10
  },
  [DeploymentPlay.FEINT]: {
    squads: [
      { sizePct: 0.25, delay: 0, position: 'center', objective: 'attack' },
      { sizePct: 0.75, delay: [4000, 6000], position: 'wide_flank', objective: 'advance_then_attack' }
    ],
    minUnits: 10
  },
  [DeploymentPlay.ECHELON]: {
    squads: [
      { sizePct: 0.34, delay: 0, position: 'diagonal_1', objective: 'attack' },
      { sizePct: 0.33, delay: [2000, 3000], position: 'diagonal_2', objective: 'attack' },
      { sizePct: 0.33, delay: [4000, 6000], position: 'diagonal_3', objective: 'attack' }
    ],
    minUnits: 15
  },
  [DeploymentPlay.WAVE_ASSAULT]: {
    squads: 'split_max',  // Special: split into as many squads as possible (min 5 each)
    minUnits: 5
  }
};

// Trait-weighted scoring for deployment play selection
const DEPLOYMENT_PLAY_WEIGHTS = {
  [DeploymentPlay.RUSH]:           { aggression: 0.5, resolve: 0.3, composure_inv: 0.2 },
  [DeploymentPlay.PROBE_AND_PUSH]: { composure: 0.5, aggression_inv: 0.3, acumen: 0.2 },
  [DeploymentPlay.PINCER]:         { acumen: 0.4, aggression: 0.2, composure: 0.2, resolve: 0.2 },
  [DeploymentPlay.FEINT]:          { acumen: 0.5, composure: 0.3, aggression_inv: 0.2 },
  [DeploymentPlay.ECHELON]:        { composure: 0.4, aggression_inv: 0.2, acumen: 0.2, resolve: 0.2 },
  [DeploymentPlay.WAVE_ASSAULT]:   { aggression: 0.4, composure_inv: 0.3, resolve: 0.3 }
};

/**
 * Select a deployment play based on commander traits and force context.
 * Called once per wave at spawn time.
 *
 * @param {object} cmdr - Commander state (has .traits)
 * @param {number} unitCount - Total units in this wave's budget
 * @param {object} [context] - { blueAlive } for force ratio scoring
 * @returns {{ play: string, score: number }}
 */
export function selectDeploymentPlay(cmdr, unitCount, context = {}) {
  const t = cmdr.traits || cmdr.personality || {};
  const blueAlive = context.blueAlive || 1;
  const forceRatio = unitCount / Math.max(1, blueAlive);

  let bestPlay = DeploymentPlay.RUSH;
  let bestScore = -Infinity;

  for (const [play, weights] of Object.entries(DEPLOYMENT_PLAY_WEIGHTS)) {
    const def = DEPLOYMENT_PLAY_DEFS[play];

    // Gate by minimum unit count
    if (unitCount < def.minUnits) continue;

    // Score from trait weights
    let score = 0;
    for (const [trait, weight] of Object.entries(weights)) {
      if (trait.endsWith('_inv')) {
        score += (1 - (t[trait.replace('_inv', '')] ?? 0.5)) * weight;
      } else {
        score += (t[trait] ?? 0.5) * weight;
      }
    }

    // Force ratio modifier: overwhelming numbers favor RUSH and WAVE_ASSAULT
    if (forceRatio > 3) {
      const ratioBonus = Math.min(0.3, (forceRatio - 3) * 0.05);
      if (play === DeploymentPlay.RUSH || play === DeploymentPlay.WAVE_ASSAULT) {
        score += ratioBonus;
      }
    }

    // Acumen noise: low acumen adds randomness (bad commanders pick suboptimal plays)
    const acumenNoise = (1 - (t.acumen ?? 0.5)) * 0.2;
    score += (Math.random() - 0.5) * acumenNoise;

    if (score > bestScore) {
      bestScore = score;
      bestPlay = play;
    }
  }

  // Store on commander for intel system
  cmdr._lastDeploymentPlay = bestPlay;

  return { play: bestPlay, score: bestScore };
}

// ── Blue commander intel prediction ─────────────────────────

const INTEL_MESSAGES = {
  [DeploymentPlay.RUSH]:           ["Enemy massing for a direct assault!", "They're coming straight at us, all at once!"],
  [DeploymentPlay.PROBE_AND_PUSH]: ["Scouts incoming — main force behind them!", "They're probing first. Expect the main body shortly."],
  [DeploymentPlay.PINCER]:         ["Enemy splitting — watch the flanks!", "They're flanking! Main force up the middle, second group on the side."],
  [DeploymentPlay.FEINT]:          ["Don't fall for the center push — main force is flanking!", "Decoy up the middle. Real threat coming from the side!"],
  [DeploymentPlay.ECHELON]:        ["Staggered approach — they'll hit us in waves!", "Echelon formation. Expect sequential contact."],
  [DeploymentPlay.WAVE_ASSAULT]:   ["Multiple groups incoming from all directions!", "They're rushing from everywhere — spread fire!"]
};

/**
 * Predict the red commander's deployment play.
 * Acumen = probability of correct prediction. Always gives a prediction — may be wrong.
 *
 * @param {object} blueCmdr - Blue commander (has .traits.acumen)
 * @param {object} redCmdr - Red commander (has ._lastDeploymentPlay)
 * @returns {{ correct: boolean, play: string, message: string } | null}
 */
export function predictDeploymentPlay(blueCmdr, redCmdr) {
  if (!blueCmdr || !redCmdr?._lastDeploymentPlay) return null;

  const acumen = blueCmdr.traits?.acumen ?? blueCmdr.personality?.acumen ?? 0.5;
  const actualPlay = redCmdr._lastDeploymentPlay;
  const correct = Math.random() < acumen;

  let predictedPlay;
  if (correct) {
    predictedPlay = actualPlay;
  } else {
    // Pick a random different play
    const allPlays = Object.values(DeploymentPlay);
    const others = allPlays.filter(p => p !== actualPlay);
    predictedPlay = others[Math.floor(Math.random() * others.length)];
  }

  const messages = INTEL_MESSAGES[predictedPlay] || INTEL_MESSAGES[DeploymentPlay.RUSH];
  const message = messages[Math.floor(Math.random() * messages.length)];

  return { correct, play: predictedPlay, message };
}

// ── Commander traits (strategic-level, derived from unit traits) ──

/**
 * Derive 4 commander traits from 6 unit personality traits.
 * Used when a unit promotes to commander.
 */
export function deriveCommanderTraits(unitPersonality) {
  const p = unitPersonality;
  return {
    aggression: p.aggression ?? 0.5,
    composure:  ((p.discipline ?? 0.5) + (p.patience ?? 0.5)) / 2,
    acumen:     ((p.adaptability ?? 0.5) + (p.initiative ?? 0.5) + (p.awareness ?? 0.5)) / 3,
    resolve:    p.courage ?? 0.5
  };
}

/**
 * Commander trait presets for AI-generated commanders.
 * Each has 4 commander traits (not 6 unit traits).
 */
export const COMMANDER_TRAIT_PRESETS = {
  blitz:      { aggression: 0.9, composure: 0.5, acumen: 0.4, resolve: 0.6 },
  strategist: { aggression: 0.3, composure: 0.8, acumen: 0.9, resolve: 0.5 },
  bulldog:    { aggression: 0.8, composure: 0.3, acumen: 0.3, resolve: 0.9 },
  fox:        { aggression: 0.5, composure: 0.7, acumen: 0.8, resolve: 0.3 },
  rookie:     { aggression: 0.5, composure: 0.2, acumen: 0.2, resolve: 0.3 }
};


// ── Unit category mapping (mirrors ai.js UnitCategory values) ──

const UNIT_CATEGORY = {
  infantry: 'infantry', medic: 'infantry', specops: 'infantry', stinger: 'infantry',
  jeep: 'light_vehicle', humvee: 'light_vehicle', brdm: 'light_vehicle', fennek: 'light_vehicle',
  sherman: 'medium_tank', panzer4: 'medium_tank', t34: 'medium_tank', pershing: 'medium_tank',
  tiger: 'heavy_tank', abrams: 'heavy_tank', leopard: 'heavy_tank', challenger: 'heavy_tank',
  t90: 'heavy_tank', merkava: 'heavy_tank', maus: 'heavy_tank', tog2: 'heavy_tank',
  kv2: 'heavy_tank',
  howitzer: 'heavy_tank', helicopter: 'light_vehicle', drone: 'light_vehicle'
};

/**
 * Get unit category from unitId string.
 */
export function getUnitCategory(unitId) {
  return UNIT_CATEGORY[unitId] || 'infantry';
}


// ── Commander personality presets ─────────────────────────────

export const COMMANDER_PRESETS = {
  balanced: {
    aggression:   0.5,
    patience:     0.5,
    courage:      0.5,
    discipline:   0.5,
    initiative:   0.5,
    adaptability: 0.5
  },
  aggressive: {
    aggression:   0.8,
    patience:     0.3,
    courage:      0.7,
    discipline:   0.5,
    initiative:   0.7,
    adaptability: 0.5
  },
  cautious: {
    aggression:   0.3,
    patience:     0.8,
    courage:      0.4,
    discipline:   0.7,
    initiative:   0.5,
    adaptability: 0.6
  }
};


// ── Origin-based unit preference generation ──────────────────

/**
 * Generate unitPrefs from an origin unit type and personality.
 * Origin category gets a +0.3 boost. Other categories derived from personality.
 */
function generateUnitPrefs(originUnit, personality) {
  const p = personality;
  const originCat = getUnitCategory(originUnit);

  // Base prefs from personality
  const prefs = {
    infantry:      0.4 + (1 - p.aggression) * 0.2 + p.patience * 0.1,
    light_vehicle: 0.3 + p.initiative * 0.2 + p.adaptability * 0.1,
    medium_tank:   0.4 + p.aggression * 0.15 + p.discipline * 0.1,
    heavy_tank:    0.3 + p.aggression * 0.25 + p.courage * 0.15
  };

  // Origin affinity boost
  if (prefs[originCat] != null) {
    prefs[originCat] = Math.min(1.0, prefs[originCat] + 0.3);
  }

  return prefs;
}


// ── Random origin unit picker ────────────────────────────────

const ORIGIN_POOL = [
  'infantry', 'infantry', 'infantry',   // weighted toward infantry
  'medic', 'specops',
  'jeep', 'humvee',
  'sherman', 'panzer4', 't34',
  'tiger', 'abrams'
];

function pickRandomOrigin() {
  return ORIGIN_POOL[Math.floor(Math.random() * ORIGIN_POOL.length)];
}


// ── Factory ───────────────────────────────────────────────────

/**
 * Create a new commander state object.
 * @param {object} config
 * @param {string} config.team - 'blue' or 'red'
 * @param {object} config.personality - 6 traits (0-1 each)
 * @param {string} [config.originUnit] - unit type this commander came from (random if not set)
 * @param {number} [config.maxSquads] - max squads this commander can manage (default 3)
 * @param {string} [config.spawnEdge] - which edge to spawn on ('top'|'left'|'right'|'bottom')
 * @param {string} [config.driver] - 'ai' or 'player'
 */
export function createCommander(config) {
  const personality = {
    aggression:   config.personality?.aggression   ?? 0.5,
    patience:     config.personality?.patience     ?? 0.5,
    courage:      config.personality?.courage      ?? 0.5,
    discipline:   config.personality?.discipline   ?? 0.5,
    initiative:   config.personality?.initiative   ?? 0.5,
    adaptability: config.personality?.adaptability ?? 0.5
  };

  const originUnit = config.originUnit || pickRandomOrigin();
  const unitPrefs = generateUnitPrefs(originUnit, personality);

  // Commander-level traits (strategic brain)
  const traits = config.commanderTraits
    || deriveCommanderTraits(personality);

  return {
    team:          config.team,
    personality,
    traits,            // { aggression, composure, acumen, resolve }
    originUnit,
    unitPrefs,
    maxSquads:     config.maxSquads ?? 3,
    spawnEdge:     config.spawnEdge || 'top',
    squads:        [],
    reserves:      [],          // Undeployed unit definitions
    evalInterval:  2000 + (1 - personality.initiative) * 4000,
    lastEval:      0,
    driver:        config.driver || 'ai',

    // Defense zone brain
    defenseZones:  [],          // Populated by initDefenseZones()
    panic:         0,           // 0-1, derived from zone threats
    _lastBlueDPS:  0,          // For momentum tracking
    _reinforceTimer: 0,        // Countdown to next reinforcement check

    // Runtime state
    _startTime:    null,        // Set on first updateCommander call
    _destroyedSinceLastDeploy: 0,
    _totalDeployed: 0
  };
}


// ── Unit preference lookup ──────────────────────────────────

/**
 * Get commander's preference for a unit type. Checks specific unitId first,
 * falls back to category, defaults to 0.5.
 * @param {object} cmdr - commander object
 * @param {string} unitId - specific unit type (e.g. 'abrams')
 * @param {string} [category] - unit category (e.g. 'heavy_tank')
 * @returns {number} preference 0-1
 */
export function getUnitPref(cmdr, unitId, category) {
  if (cmdr.unitPrefs[unitId] != null) return cmdr.unitPrefs[unitId];
  const cat = category || getUnitCategory(unitId);
  return cmdr.unitPrefs[cat] ?? 0.5;
}


// ── Objective assignment ──────────────────────────────────────

/**
 * Push an objective down to a sergeant.
 * @param {object} commander
 * @param {object} sgt - sergeant state from sergeant.js
 * @param {object} objectiveData - { type, target?, position?, ... }
 * @param {number} now - current timestamp (ms)
 * @returns {object} the assigned objective
 */
export function assignObjective(commander, sgt, objectiveData, now, b) {
  const objective = { ...objectiveData, assignedAt: now, status: 'active', reached: false };
  sgt.objective = objective;
  sgt._objectivePressure = 0;
  if (b) {
    const pos = objective.position ? ` toward (${Math.round(objective.position.x)}, ${Math.round(objective.position.y)})` : '';
    _logEvent(b, commander, now, 'objective',
      `Assigned ${objective.type} to Squad ${sgt.squadId}${pos}`);
  }
  return objective;
}


// ── Commander Sitrep (Fog of War) ────────────────────────────

/**
 * Build the commander's strategic picture from sergeant reports.
 * The commander only knows:
 *   - Own force: full knowledge (squads, strength, casualties, reserves)
 *   - Enemy: only what sergeants report (spotted enemies, contact, kills)
 *
 * @param {object} cmdr - commander state
 * @param {object} b - battle state
 * @param {number} now - current timestamp
 * @returns {object} commander sitrep
 */
export function buildCommanderSitrep(cmdr, b, now) {
  const team = cmdr.team;
  const unitPool = team === 'blue' ? (b.units || []) : (b.enemies || []);

  // ── Own force (full knowledge) ──────────────────────────
  const totalOwn = unitPool.length;
  const aliveOwn = unitPool.filter(u => !u.dead);
  const ownCasualties = totalOwn - aliveOwn.length;

  // Per-squad status
  const squadReports = [];
  let contactReported = false;
  let underFireReported = false;
  const spottedEnemyIds = new Set();
  let contactBearingX = 0, contactBearingY = 0, contactSources = 0;

  // Build ID→unit lookup for O(1) member checks (avoid O(n²) find loops)
  const unitById = new Map();
  for (const u of unitPool) unitById.set(u.id, u);

  for (const sq of (b._squads || [])) {
    if (sq.team !== team) continue;

    const aliveMembers = sq.members.filter(id => {
      const u = unitById.get(id);
      return u && !u.dead;
    });

    const sgt = sq.sergeant;
    const sitrep = sgt?.sitrep;
    const inContact = sitrep?.spotted || sitrep?.underFire;

    if (sitrep?.spotted) contactReported = true;
    if (sitrep?.underFire) underFireReported = true;

    // Collect spotted enemies from unit _spotted arrays
    for (const memberId of sq.members) {
      const u = unitById.get(memberId);
      if (!u || u.dead) continue;
      for (const s of (u._spotted || [])) {
        if (s.enemy && !s.enemy.dead) spottedEnemyIds.add(s.enemy.id);
      }
    }

    // Track where contact is coming from
    if (inContact && sitrep?.enemyCenter) {
      contactBearingX += sitrep.enemyCenter.x;
      contactBearingY += sitrep.enemyCenter.y;
      contactSources++;
    }

    squadReports.push({
      squadId:   sq.id,
      alive:     aliveMembers.length,
      total:     sq.members.length,
      strength:  aliveMembers.length / Math.max(1, sq.members.length),
      inContact,
      center:    sitrep?.center || null,
      phase:     sgt?.phase || null,
      objective: sgt?.objective?.type || null,
      reached:   sgt?.objective?.reached || false,
      enemyPosture:     sitrep?.enemyPosture || 'unknown',
      enemyApproachRate: sitrep?.enemyApproachRate || 0
    });
  }

  // ── Enemy intel (fog of war — only what's been reported) ──
  const knownEnemyCount = spottedEnemyIds.size;

  // Direction of enemy concentration (average of contact reports)
  const contactBearing = contactSources > 0
    ? { x: contactBearingX / contactSources, y: contactBearingY / contactSources }
    : null;

  // ── Battle tempo ────────────────────────────────────────
  const elapsed = cmdr._startTime ? (now - cmdr._startTime) / 1000 : 0;
  const driftRate = 0.003 + (1 - cmdr.personality.patience) * 0.005;
  const effectiveAggression = Math.min(1, cmdr.personality.aggression + elapsed * driftRate);

  const activeSquads = squadReports.filter(r => r.alive > 0);
  const squadsInContact = squadReports.filter(r => r.inContact);

  // ── Enemy posture consensus (from sergeant reports) ──
  // Acumen gates how reliably the commander reads enemy posture.
  // Low acumen → may misread or ignore posture signals.
  const postureVotes = { advancing: 0, holding: 0, retreating: 0 };
  for (const r of squadsInContact) {
    if (r.enemyPosture && r.enemyPosture !== 'unknown') {
      postureVotes[r.enemyPosture] = (postureVotes[r.enemyPosture] || 0) + 1;
    }
  }
  let enemyPosture = 'unknown';
  let topVotes = 0;
  for (const [posture, votes] of Object.entries(postureVotes)) {
    if (votes > topVotes) { topVotes = votes; enemyPosture = posture; }
  }
  // Low acumen may misread — require stronger consensus
  const acumen = cmdr.traits?.acumen ?? 0.5;
  const requiredVotes = acumen > 0.6 ? 1 : 2; // Sharp commanders read it from 1 squad
  if (topVotes < requiredVotes) enemyPosture = 'unknown';

  return {
    // Own force
    ownStrength:         aliveOwn.length,
    ownCasualties,
    totalSquads:         activeSquads.length,
    squadsInContact:     squadsInContact.length,
    squadReports,
    hasReserves:         cmdr.reserves.length > 0,

    // Enemy intel (fog of war)
    contactReported,
    underFireReported,
    knownEnemyCount,
    contactBearing,      // { x, y } average direction of reported contact
    enemyPosture,        // 'advancing' | 'holding' | 'retreating' | 'unknown'

    // Battle tempo
    elapsed,
    effectiveAggression,

    // Defense zone brain
    panic:               cmdr.panic,
    defenseZones:        cmdr.defenseZones || []
  };
}


// ── Defense Zone System ──────────────────────────────────────

/**
 * Initialize defense zones for a commander. Two zones on their half of the map.
 * Zone boundaries are personality-driven (aggression pushes outer zone further,
 * resolve makes outer zone stickier).
 *
 * @param {object} cmdr - commander state
 * @param {number} mapWidth
 * @param {number} mapHeight
 */
export function initDefenseZones(cmdr, mapWidth, mapHeight) {
  const t = cmdr.traits;

  // Outer zone: how far forward the commander claims territory
  // Aggressive commanders push further south (lower yMin %)
  // Resolute commanders also push forward (they won't give ground)
  const outerMinPct = 0.35 - t.aggression * 0.1 + t.resolve * 0.05;
  const outerMaxPct = 0.55; // Fixed mid-map boundary

  // Inner zone: 20% of map height above outer zone
  const innerMinPct = Math.max(0.05, outerMinPct - 0.20);
  const innerMaxPct = outerMinPct;

  // For red (spawns top), zones are in the top half
  // For blue (spawns bottom), zones are in the bottom half — mirror Y
  const isTop = cmdr.spawnEdge === 'top';

  cmdr.defenseZones = [
    {
      id: 'outer',
      yMin: isTop ? mapHeight * outerMinPct : mapHeight * (1 - outerMaxPct),
      yMax: isTop ? mapHeight * outerMaxPct : mapHeight * (1 - outerMinPct),
      threatLevel: 0,
      blueDPS: 0,
      redDPS: 0,
      blueCount: 0,
      redCount: 0,
      breached: false
    },
    {
      id: 'inner',
      yMin: isTop ? mapHeight * innerMinPct : mapHeight * (1 - innerMaxPct),
      yMax: isTop ? mapHeight * innerMaxPct : mapHeight * (1 - innerMinPct),
      threatLevel: 0,
      blueDPS: 0,
      redDPS: 0,
      blueCount: 0,
      redCount: 0,
      breached: false
    }
  ];
}


/**
 * Assess threats in defense zones and update panic level.
 * Called each updateCommander() eval tick.
 *
 * @param {object} cmdr - commander state
 * @param {object} b - battle state
 * @param {number} dtSec - seconds since last eval
 */
export function assessZoneThreats(cmdr, b, dtSec) {
  if (!cmdr.defenseZones || cmdr.defenseZones.length === 0) return;

  const t = cmdr.traits;
  const team = cmdr.team;
  const friendlies = team === 'red' ? (b.enemies || []) : (b.units || []);
  const hostiles = team === 'red' ? (b.units || []) : (b.enemies || []);

  // Alive units
  const aliveFriendly = friendlies.filter(u => !u.dead);
  const aliveHostile = hostiles.filter(u => !u.dead);

  // Acumen gates awareness: low acumen only counts spotted hostiles
  const visibleHostiles = t.acumen > 0.6
    ? aliveHostile  // High acumen: sees everything
    : aliveHostile.filter(u => {
      // Only count hostiles that our units have spotted
      for (const f of aliveFriendly) {
        if (f._spotted?.some(s => s.enemy?.id === u.id)) return true;
      }
      return false;
    });

  // ── Scan each zone ─────────────────────────────────────
  let totalBlueDPS = 0;

  for (const zone of cmdr.defenseZones) {
    let blueDPS = 0, redDPS = 0;
    let blueCount = 0, redCount = 0;

    for (const u of visibleHostiles) {
      if (u.y >= zone.yMin && u.y <= zone.yMax) {
        blueDPS += (u.damage || 10) / Math.max(u.fireRate || 1000, 100) * 1000;
        blueCount++;
      }
    }
    for (const u of aliveFriendly) {
      if (u.y >= zone.yMin && u.y <= zone.yMax) {
        redDPS += (u.damage || 10) / Math.max(u.fireRate || 1000, 100) * 1000;
        redCount++;
      }
    }

    zone.blueDPS = blueDPS;
    zone.redDPS = redDPS;
    zone.blueCount = blueCount;
    zone.redCount = redCount;
    zone.threatLevel = blueDPS / Math.max(redDPS, 1);
    zone.breached = blueCount > 0 && redCount === 0;

    totalBlueDPS += blueDPS;
  }

  // ── Compute zone threat (max across zones, normalized) ──
  const outerZone = cmdr.defenseZones[0];
  const innerZone = cmdr.defenseZones[1];
  // Inner zone breach is scarier — weight it 1.5x
  const zoneThreat = Math.min(1,
    Math.max(outerZone.threatLevel * 0.5, innerZone.threatLevel * 0.75));

  // ── Attrition (tempered by live force ratio) ──────────
  const startingForce = friendlies.length || 1;
  const rawAttrition = 1 - (aliveFriendly.length / startingForce);
  // Force ratio dampens attrition panic — if you've lost units but still outnumber the enemy,
  // attrition shouldn't drive panic as hard
  const liveForceRatio = aliveFriendly.length / (aliveHostile.length || 1); // >1 = advantage
  const forceRatioDampen = Math.min(1, Math.max(0, 1 - (liveForceRatio - 1) * 0.5)); // 2:1 → 0.5x, 1:1 → 1.0x
  const attrition = rawAttrition * forceRatioDampen;

  // ── Momentum (change in hostile DPS since last eval) ──
  const momentum = totalBlueDPS > cmdr._lastBlueDPS
    ? Math.min(1, (totalBlueDPS - cmdr._lastBlueDPS) / 20) // Rising threat
    : 0;
  cmdr._lastBlueDPS = totalBlueDPS;

  // ── Key losses (heavy/elite units destroyed recently) ──
  // Approximation: check if any dead friendly was heavy_tank category
  let keyLosses = 0;
  for (const u of friendlies) {
    if (u.dead && u._justDied) {
      const cat = UNIT_CATEGORY[u.unitId];
      if (cat === 'heavy_tank' || cat === 'medium_tank') keyLosses += 0.3;
    }
  }
  keyLosses = Math.min(1, keyLosses);

  // ── Target panic ──────────────────────────────────────
  const targetPanic = Math.min(1, Math.max(0,
    zoneThreat * 0.4 + attrition * 0.3 + momentum * 0.2 + keyLosses * 0.1
  ));

  // Composure smooths transitions
  const smoothRate = (1 - t.composure * 0.7) * Math.min(dtSec, 2);
  cmdr.panic += (targetPanic - cmdr.panic) * smoothRate;
  cmdr.panic = Math.min(1, Math.max(0, cmdr.panic));
}


/**
 * Get the reinforcement interval based on personality + panic.
 * @param {object} cmdr
 * @returns {number} interval in seconds
 */
export function getReinforcementInterval(cmdr) {
  const t = cmdr.traits;
  const baseInterval = 20 * (t.composure * 0.4 + (1 - t.aggression) * 0.3 + t.acumen * 0.3);
  return baseInterval * (1 - cmdr.panic * 0.7);
}


/**
 * Select a play (tactical action) for a squad based on situation + personality.
 *
 * @param {object} cmdr - commander state
 * @param {object} sitrep - from buildCommanderSitrep()
 * @param {object|null} squadReport - specific squad's report
 * @returns {{ play: string, score: number }}
 */
export function selectPlay(cmdr, sitrep, squadReport) {
  const t = cmdr.traits;
  const panic = cmdr.panic;

  // ── Base scores from trait affinity ────────────────
  const scores = {
    [Play.ASSAULT]:   t.aggression * 0.4 + t.resolve * 0.2,
    [Play.DEFEND]:    t.composure * 0.3 + (1 - t.aggression) * 0.2,
    [Play.FLANK]:     t.acumen * 0.4 + t.composure * 0.1,
    [Play.FALL_BACK]: (1 - t.resolve) * 0.3 + (1 - t.aggression) * 0.1,
    [Play.PROBE]:     t.acumen * 0.3 + t.composure * 0.2,
    [Play.OVERWHELM]: t.aggression * 0.3 + t.resolve * 0.3
  };

  // ── Situational modifiers ─────────────────────────
  const outerZone = cmdr.defenseZones?.[0];
  const innerZone = cmdr.defenseZones?.[1];

  // Outer zone breached → boost Assault/Overwhelm
  if (outerZone?.breached) {
    scores[Play.ASSAULT] += 0.2;
    scores[Play.OVERWHELM] += 0.15;
  }

  // Inner zone has hostiles → desperate
  if (innerZone?.blueCount > 0) {
    scores[Play.OVERWHELM] += 0.3;
    scores[Play.FALL_BACK] -= 0.2;
  }

  // High panic → aggression-dependent response
  if (panic > 0.6) {
    if (t.aggression > 0.6) {
      scores[Play.OVERWHELM] += panic * 0.3;
      scores[Play.ASSAULT] += panic * 0.2;
    } else {
      scores[Play.DEFEND] += panic * 0.2;
      scores[Play.FALL_BACK] += panic * 0.15;
    }
  }

  // Low panic + high aggression → push
  if (panic < 0.3 && t.aggression > 0.5) {
    scores[Play.ASSAULT] += 0.15;
    scores[Play.PROBE] += 0.1;
  }

  // Squad is weak → bias toward defensive plays
  if (squadReport && squadReport.strength < 0.4) {
    scores[Play.FALL_BACK] += 0.25;
    scores[Play.DEFEND] += 0.15;
    scores[Play.ASSAULT] -= 0.15;
  }

  // Lateral awareness: if enemy is concentrated on one side, Flank scores higher
  if (sitrep.contactBearing && outerZone) {
    const mapCenter = (outerZone.yMax + outerZone.yMin) / 2;
    scores[Play.FLANK] += 0.1;
  }

  // ── Enemy posture reaction ──────────────────────────
  // Commander reads enemy movement and adjusts play accordingly.
  // Aggressive commanders exploit retreats; cautious ones exploit advances.
  if (sitrep.enemyPosture === 'retreating') {
    scores[Play.ASSAULT]   += 0.2 + t.aggression * 0.15;
    scores[Play.PROBE]     += 0.15;
    scores[Play.FALL_BACK] -= 0.25;  // Don't fall back when enemy is retreating
    scores[Play.DEFEND]    -= 0.1;
  } else if (sitrep.enemyPosture === 'advancing') {
    scores[Play.DEFEND]    += 0.15 + t.composure * 0.1;
    scores[Play.FLANK]     += 0.1;   // Let them come, hit the side
    // Resolute commanders don't back off just because enemy is advancing
    if (t.resolve < 0.5) {
      scores[Play.FALL_BACK] += 0.1;
    }
  } else if (sitrep.enemyPosture === 'holding') {
    scores[Play.FLANK]     += 0.1 + t.acumen * 0.1;  // Break the stalemate
    scores[Play.PROBE]     += 0.1;
  }

  // ── Acumen noise (low acumen = bad reads) ─────────
  const noise = (1 - t.acumen) * 0.3;
  for (const key of Object.keys(scores)) {
    scores[key] += (Math.random() - 0.5) * noise;
  }

  // ── Panic noise (panicked + low composure = worse decisions) ──
  const panicNoise = panic * (1 - t.composure) * 0.25;
  for (const key of Object.keys(scores)) {
    scores[key] += (Math.random() - 0.5) * panicNoise;
  }

  // ── Pick best ─────────────────────────────────────
  let bestPlay = Play.ASSAULT;
  let bestScore = -Infinity;
  for (const [play, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestPlay = play;
    }
  }

  return { play: bestPlay, score: bestScore };
}


/**
 * Map a Play to an Objective type for sergeant consumption.
 */
export function playToObjective(play, targetPosition) {
  switch (play) {
    case Play.ASSAULT:
    case Play.OVERWHELM:
      return { type: Objective.ATTACK };
    case Play.DEFEND:
      return targetPosition
        ? { type: Objective.ADVANCE_TO, position: targetPosition }
        : { type: Objective.DEFEND };
    case Play.FLANK:
      return targetPosition
        ? { type: Objective.ADVANCE_TO, position: targetPosition }
        : { type: Objective.ATTACK };
    case Play.FALL_BACK:
      return { type: Objective.FALL_BACK };
    case Play.PROBE:
      return { type: Objective.ATTACK };
    default:
      return { type: Objective.ATTACK };
  }
}


// ── Weighted objective scoring ────────────────────────────────

/**
 * Score possible objectives for a squad based on commander personality + sitrep.
 *
 * ATTACK:      "find and destroy" — default aggressive posture, personality-driven
 * ADVANCE_TO:  "move to position" — tactical positioning, needs multi-squad reason
 * DEFEND:      "hold where you are" — squad is weak or overwhelmed
 * FALL_BACK:   "retreat" — desperate, losing badly
 *
 * @param {object} cmdr - commander state
 * @param {object} cmdSitrep - from buildCommanderSitrep()
 * @param {object|null} squadReport - specific squad's report from cmdSitrep.squadReports
 */
function scoreObjectives(cmdr, cmdSitrep, squadReport) {
  const p = cmdr.personality;
  const s = cmdSitrep;
  const effAgg = s.effectiveAggression;

  // Squad-specific factors
  const sqWeak = squadReport ? (1 - squadReport.strength) : 0;
  const sqOverwhelmed = squadReport && s.knownEnemyCount > squadReport.alive * 2 ? 1 : 0;

  // ATTACK: personality-driven, doesn't need contact to score well.
  // The sergeant handles SEARCH when executing ATTACK without contact.
  const attackScore = effAgg * 0.3 + p.courage * 0.2 + p.initiative * 0.2
    + (s.contactReported ? 0.2 : 0)       // contact boosts but isn't required
    + (s.squadsInContact > 0 ? 0.1 : 0);  // coordination bonus

  // ADVANCE_TO: tactical positioning — only valuable with multiple squads.
  // Single squad should almost never get this (just go ATTACK).
  const multiSquadBonus = s.totalSquads > 1 ? 0.3 : 0;
  const advanceScore = p.initiative * 0.2 + (1 - p.aggression) * 0.1
    + multiSquadBonus
    + (!s.contactReported ? 0.1 : 0);     // slight bonus before contact (flanking setup)

  // DEFEND: squad is hurt or overwhelmed. Not a default choice.
  const defendScore = p.discipline * 0.1 + p.patience * 0.1
    + sqWeak * 0.4 + sqOverwhelmed * 0.3;

  // FALL_BACK: desperate — losing badly, no reserves, overwhelmed.
  const fallBackScore = (1 - p.courage) * 0.15 + sqOverwhelmed * 0.3
    + sqWeak * 0.3 + (!s.hasReserves ? 0.1 : 0);

  // ── Enemy posture adjustments ──────────────────────
  // Commander-level posture read adjusts objective weights.
  let attackAdj = 0, defendAdj = 0, fallBackAdj = 0, advanceAdj = 0;

  if (s.enemyPosture === 'retreating') {
    attackAdj   += 0.2;   // Press the advantage
    fallBackAdj -= 0.2;   // Don't retreat when they're retreating
    advanceAdj  += 0.1;   // Advance to claim ground
  } else if (s.enemyPosture === 'advancing') {
    defendAdj   += 0.15;  // Dig in for the incoming push
    attackAdj   -= 0.1;   // They're coming to us, less need to attack
  } else if (s.enemyPosture === 'holding') {
    advanceAdj  += 0.1;   // Maneuver to break stalemate
    attackAdj   += 0.05;
  }

  return {
    [Objective.ATTACK]:     attackScore  + attackAdj,
    [Objective.ADVANCE_TO]: advanceScore + advanceAdj,
    [Objective.DEFEND]:     defendScore  + defendAdj,
    [Objective.FALL_BACK]:  fallBackScore + fallBackAdj
  };
}

/**
 * Pick the highest-scoring objective from a scores object.
 */
function pickBestObjective(scores) {
  let best = Objective.ATTACK;
  let bestScore = -Infinity;
  for (const [obj, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = obj;
    }
  }
  return { type: best, score: bestScore };
}


// ── Spawn position helpers ──────────────────────────────────

/**
 * Get spawn zones spread across an edge for N squads.
 * @param {string} edge - 'top', 'bottom', 'left', 'right'
 * @param {number} mapW
 * @param {number} mapH
 * @param {number} squadCount
 * @param {number} cellSize
 * @returns {Array<{x,y,radius}>}
 */
export function getEdgeSpawnZones(edge, mapW, mapH, squadCount, cellSize = 64) {
  const zones = [];
  const margin = cellSize * 2;

  for (let i = 0; i < squadCount; i++) {
    const frac = squadCount === 1 ? 0.5 : (i + 0.5) / squadCount;
    let x, y, radius;

    switch (edge) {
      case 'top':
        x = mapW * frac;
        y = margin;
        radius = (mapW / squadCount) * 0.3;
        break;
      case 'bottom':
        x = mapW * frac;
        y = mapH - margin;
        radius = (mapW / squadCount) * 0.3;
        break;
      case 'left':
        x = margin;
        y = mapH * frac;
        radius = (mapH / squadCount) * 0.3;
        break;
      case 'right':
        x = mapW - margin;
        y = mapH * frac;
        radius = (mapH / squadCount) * 0.3;
        break;
      default:
        x = mapW * frac;
        y = margin;
        radius = 100;
    }

    zones.push({ x: Math.round(x), y: Math.round(y), radius: Math.round(Math.max(60, radius)) });
  }

  return zones;
}

/**
 * Pick an ADVANCE_TO target position for a squad.
 *
 * @param {object} cmdr - commander state
 * @param {object} b - battle state (mapWidth, mapHeight)
 * @param {number} squadIndex - this squad's index in the commander's squad list
 * @param {number} squadCount - total squads the commander is managing
 * @param {object} [cmdSitrep] - commander sitrep (for contact bearing + squad position)
 */
function pickAdvanceTarget(cmdr, b, squadIndex, squadCount, cmdSitrep) {
  const p = cmdr.personality;
  const mapW = b.mapWidth;
  const mapH = b.mapHeight;

  // If we know where the enemy is, direct flanking squads toward the contact bearing
  const bearing = cmdSitrep?.contactBearing;

  // Base depth: personality-driven (0.3 cautious to 0.7 aggressive)
  let depth = 0.3 + p.aggression * 0.4;

  // Spread laterally based on squad index
  let lateralFrac = squadCount === 1 ? 0.5 : (squadIndex + 0.5) / squadCount;

  // If contact bearing is known, bias lateral position toward it for flanking
  if (bearing) {
    const bearingFrac = bearing.x / mapW; // 0-1 across map width
    // Non-primary squads offset from bearing to create a flanking angle
    if (squadIndex > 0) {
      const flankDir = (squadIndex % 2 === 1) ? 0.2 : -0.2;
      lateralFrac = Math.max(0.1, Math.min(0.9, bearingFrac + flankDir));
    }
  }

  const x = mapW * (0.15 + lateralFrac * 0.7);

  // If this squad already has a position, ensure the new target is deeper
  const squadReport = cmdSitrep?.squadReports?.find(
    r => r.squadId === cmdr.squads?.[squadIndex]);
  if (squadReport?.center) {
    let currentDepth;
    switch (cmdr.spawnEdge) {
      case 'top':    currentDepth = squadReport.center.y / mapH; break;
      case 'bottom': currentDepth = 1 - squadReport.center.y / mapH; break;
      default:       currentDepth = squadReport.center.y / mapH; break;
    }
    // Push at least 12-20% deeper than current position
    const step = 0.12 + p.aggression * 0.08;
    depth = Math.max(depth, currentDepth + step);
  }

  // Cap at 85% — beyond that just use ATTACK
  depth = Math.min(0.85, depth);

  let y;
  switch (cmdr.spawnEdge) {
    case 'top':    y = mapH * depth; break;
    case 'bottom': y = mapH * (1 - depth); break;
    default:       y = mapH * depth; break;
  }

  return { x: Math.round(x), y: Math.round(y) };
}


// ── Deployment play execution ────────────────────────────────

/**
 * Get spawn zone positions for a deployment play.
 * Wraps getEdgeSpawnZones for standard layouts, adds flank/diagonal positions.
 *
 * @param {string} edge - 'top'|'bottom'|'left'|'right'
 * @param {number} mapW
 * @param {number} mapH
 * @param {Array} squadDefs - play squad definitions with position keys
 * @param {number} cellSize
 * @returns {Array<{x,y,radius}>}
 */
function getPlaySpawnZones(edge, mapW, mapH, squadDefs, cellSize = 64) {
  const margin = cellSize * 2;
  const zones = [];

  // Pick flank side (random, could be acumen-driven later)
  const flankRight = Math.random() > 0.5;

  for (const def of squadDefs) {
    const pos = def.position || 'center';
    let x, y, radius;

    // All positions assume 'top' edge, we'll transform at the end
    const edgeY = margin;
    radius = Math.max(60, mapW * 0.12);

    switch (pos) {
      case 'center':
        x = mapW * 0.5;
        y = edgeY;
        break;
      case 'flank':
        x = flankRight ? mapW * 0.8 : mapW * 0.2;
        y = edgeY;
        break;
      case 'wide_flank':
        x = flankRight ? mapW * 0.9 : mapW * 0.1;
        y = edgeY;
        break;
      case 'diagonal_1':
        x = mapW * 0.25;
        y = edgeY;
        break;
      case 'diagonal_2':
        x = mapW * 0.5;
        y = edgeY;
        break;
      case 'diagonal_3':
        x = mapW * 0.75;
        y = edgeY;
        break;
      default:
        x = mapW * 0.5;
        y = edgeY;
    }

    // Transform for non-top edges
    if (edge === 'bottom') {
      y = mapH - margin;
    } else if (edge === 'left') {
      const tmp = x; x = margin; y = tmp * (mapH / mapW);
    } else if (edge === 'right') {
      const tmp = x; x = mapW - margin; y = tmp * (mapH / mapW);
    }

    zones.push({ x: Math.round(x), y: Math.round(y), radius: Math.round(radius) });
  }

  return zones;
}

/**
 * Split a budget array into N groups by percentage, enforcing minimum squad size.
 * @param {Array} budget - unit definitions
 * @param {Array<number>} pcts - target percentages per squad (should sum to ~1)
 * @param {Array<Array<number>>} [fixedSizes] - optional [min,max] override per squad
 * @returns {Array<Array>} - split buckets
 */
function splitBudget(budget, pcts, fixedSizes = [], minSize = 2) {
  const buckets = pcts.map(() => []);
  const units = [...budget];

  // First pass: allocate fixed-size squads
  for (let i = 0; i < pcts.length; i++) {
    const fixed = fixedSizes[i];
    if (fixed) {
      const count = Math.min(fixed[1], Math.max(fixed[0], Math.min(units.length - (pcts.length - i - 1) * minSize, fixed[1])));
      for (let j = 0; j < count && units.length > 0; j++) {
        buckets[i].push(units.shift());
      }
    }
  }

  // Second pass: allocate remaining by percentage
  const remaining = units.length;
  for (let i = 0; i < pcts.length; i++) {
    if (fixedSizes[i]) continue; // Already filled
    const count = Math.max(minSize, Math.round(remaining * pcts[i]));
    for (let j = 0; j < count && units.length > 0; j++) {
      buckets[i].push(units.shift());
    }
  }

  // Overflow: distribute remaining units to the largest squad
  while (units.length > 0) {
    const largest = buckets.reduce((a, b) => a.length >= b.length ? a : b);
    largest.push(units.shift());
  }

  // Remove empty buckets — but always keep at least one bucket if we have any units
  const filtered = buckets.filter(b => b.length >= minSize);
  if (filtered.length === 0 && buckets.some(b => b.length > 0)) {
    // All buckets below minSize — merge everything into one
    const merged = buckets.flat();
    return merged.length > 0 ? [merged] : [];
  }
  return filtered;
}

/**
 * Build squad plans from a chosen deployment play.
 *
 * @param {object} cmdr - Commander state
 * @param {object} b - Battle state
 * @param {string} play - DeploymentPlay value
 * @param {Array} budget - Unit definitions from spendPowerBudget
 * @param {number} now - Current timestamp
 * @returns {Array<object>} Squad plans: [{ units, spawnZone, objective, sgtPersonality, delay }]
 */
function buildDeploymentFromPlay(cmdr, b, play, budget, now) {
  const def = DEPLOYMENT_PLAY_DEFS[play];
  if (!def) return [];

  const p = cmdr.personality;
  const mapW = b.mapWidth;
  const mapH = b.mapHeight;

  // WAVE_ASSAULT: special handling — split into max squads
  if (def.squads === 'split_max') {
    const maxSquads = Math.min(cmdr.maxSquads || 3, Math.floor(budget.length / 5));
    const squadCount = Math.max(1, maxSquads);
    const zones = getEdgeSpawnZones(cmdr.spawnEdge, mapW, mapH, squadCount, b.cellSize || 64);
    const perSquad = Math.floor(budget.length / squadCount);
    const plans = [];
    let idx = 0;
    for (let i = 0; i < squadCount; i++) {
      const count = perSquad + (i < budget.length % squadCount ? 1 : 0);
      const units = budget.slice(idx, idx + count);
      idx += count;
      plans.push({
        units,
        spawnZone: zones[i],
        objective: { type: Objective.ATTACK },
        sgtPersonality: { ...p, initiative: Math.min(1, p.initiative + 0.05 * i) },
        delay: 0
      });
    }
    return plans;
  }

  // Standard plays: use squad definitions
  const squadDefs = def.squads;
  const pcts = squadDefs.map(s => s.sizePct);
  const fixedSizes = squadDefs.map(s => s.fixedSize || null);
  const minSquadSize = cmdr.team === 'red' ? 5 : 1;
  const buckets = splitBudget(budget, pcts, fixedSizes, minSquadSize);

  // Get spawn zones for this play's positioning
  const zones = getPlaySpawnZones(cmdr.spawnEdge, mapW, mapH, squadDefs, b.cellSize || 64);

  const plans = [];
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].length === 0) continue;
    const sDef = squadDefs[i] || squadDefs[squadDefs.length - 1];

    // Delay: 0 or random within range
    let delay = 0;
    if (Array.isArray(sDef.delay)) {
      delay = sDef.delay[0] + Math.random() * (sDef.delay[1] - sDef.delay[0]);
      delay = Math.round(delay);
    } else {
      delay = sDef.delay || 0;
    }

    // Objective
    let objective;
    if (sDef.objective === 'advance_then_attack') {
      // Flanking: advance to a waypoint at 60-70% map depth on the flank side
      const zone = zones[i] || zones[0];
      const depth = cmdr.spawnEdge === 'top' ? mapH * 0.6 : mapH * 0.4;
      objective = {
        type: Objective.ADVANCE_TO,
        position: { x: zone.x, y: Math.round(depth) }
      };
    } else {
      objective = { type: Objective.ATTACK };
    }

    // Sergeant personality variation
    const sgtPers = { ...p };
    if (i > 0) {
      sgtPers.initiative = Math.min(1, sgtPers.initiative + 0.1);
      sgtPers.aggression = Math.max(0, sgtPers.aggression - 0.05 * i);
    }

    plans.push({
      units: buckets[i],
      spawnZone: zones[i] || zones[0],
      objective,
      sgtPersonality: sgtPers,
      delay
    });
  }

  return plans;
}

// ── Deployment planning ──────────────────────────────────────

/**
 * Plan a single deployment from the budget.
 * Commander decides squad count, composition, positions, and initial objectives.
 *
 * @param {object} cmdr - commander object
 * @param {object} b - battle state (reads mapWidth, mapHeight, cellSize)
 * @param {Array<object>} budget - array of unit definitions { unitId, ... }
 * @param {number} now - current timestamp
 * @returns {Array<object>} squad plans: [{ units, spawnZone, objective, sgtPersonality }]
 */
export function planDeployment(cmdr, b, budget, now) {
  if (!budget || budget.length === 0) return [];

  // Select deployment play based on commander personality + force context
  const blueAlive = (b.units || []).filter(u => !u.dead).length + (b.hero && !b.hero.dead ? 1 : 0);
  const { play } = selectDeploymentPlay(cmdr, budget.length, { blueAlive });

  // Sort budget by commander's unit preferences (heavy units first for main squad)
  const sorted = [...budget].sort((a, b2) => {
    return getUnitPref(cmdr, b2.unitId) - getUnitPref(cmdr, a.unitId);
  });

  // Build squad plans from the chosen play
  const plans = buildDeploymentFromPlay(cmdr, b, play, sorted, now);

  // Log the chosen play
  _logEvent(b, cmdr, now, 'deployment_play',
    `${play} — ${budget.length} units, ${plans.length} squad(s)${plans.some(p => p.delay > 0) ? `, delayed: ${plans.filter(p => p.delay > 0).map(p => Math.round(p.delay / 1000) + 's').join('+')}` : ''}`);

  return plans;
}


// ── Per-frame evaluation ──────────────────────────────────────

/**
 * Periodic strategic evaluation. Manages squads, deploys reserves,
 * reassigns objectives based on personality + situation.
 *
 * Commander ONLY:
 *  - Deploys/creates squads from reserves
 *  - Assigns objectives to squads (ATTACK, ADVANCE_TO + position)
 *  - Reassigns objectives when situation changes
 *
 * Commander does NOT: pick phases, issue unit commands, choose formations.
 */
export function updateCommander(b, commander, now) {
  // Player-controlled commanders don't auto-evaluate
  if (commander.driver === 'player') return;

  // Set start time on first call
  if (commander._startTime === null) {
    commander._startTime = now;
    // Initialize defense zones on first call if not already done
    if (commander.defenseZones.length === 0 && b.mapWidth && b.mapHeight) {
      initDefenseZones(commander, b.mapWidth, b.mapHeight);
    }
  }

  // Throttle by initiative-driven interval
  if (now - commander.lastEval < commander.evalInterval) return;
  const dtSec = (now - commander.lastEval) / 1000;
  commander.lastEval = now;

  const squads = b._squads;
  if (!squads) return;

  const team = commander.team;
  const cmdSquads = commander.squads;

  // ── Assess defense zone threats + update panic ──────
  if (commander.defenseZones.length > 0) {
    assessZoneThreats(commander, b, dtSec);
  }

  if (!cmdSquads || cmdSquads.length === 0) {
    // No active squads — check if we should deploy reserves
    if (commander.reserves.length > 0) {
      _deployReserves(b, commander, now);
    }
    return;
  }

  // Build commander sitrep (fog of war)
  const cmdSitrep = buildCommanderSitrep(commander, b, now);

  // Track destroyed squads
  let activeCount = 0;
  let destroyedThisCheck = 0;

  for (let i = 0; i < cmdSquads.length; i++) {
    const squadId = cmdSquads[i];
    const squad = squads.find(s => s.id === squadId);
    if (!squad) {
      destroyedThisCheck++;
      continue;
    }

    // Find this squad's report from the commander sitrep
    const squadReport = cmdSitrep.squadReports.find(r => r.squadId === squadId);
    if (!squadReport || squadReport.alive === 0) {
      destroyedThisCheck++;
      continue;
    }

    activeCount++;
    const sgt = squad.sergeant;
    if (!sgt) continue;

    const objective = sgt.objective;
    if (!objective || objective.status !== 'active') continue;

    // ── Play-based reassignment (defense zone brain) ──
    // Re-evaluate plays when panic changes significantly or objective reached
    // Composure-driven cooldown: composed commanders wait longer between reassignments (5-12s)
    const composure = commander.traits?.composure ?? 0.5;
    const reassignCooldown = (5 + composure * 7) * 1000; // 5-12s
    const timeSinceReassign = now - (commander._lastReassignTime || 0);
    const cooldownMet = timeSinceReassign >= reassignCooldown;

    const panicShift = Math.abs(commander.panic - (commander._lastPlayPanic ?? 0));
    const shouldReeval = cooldownMet && (panicShift > 0.15
      || (objective.type === Objective.ADVANCE_TO && objective.reached)
      || (objective.type === Objective.ATTACK && !cmdSitrep.contactReported && cmdSitrep.elapsed > 10));

    if (shouldReeval && commander.defenseZones.length > 0) {
      const { play } = selectPlay(commander, cmdSitrep, squadReport);

      // Find most-threatened zone for targeting
      const targetZone = _getMostThreatenedZone(commander);
      const targetPos = targetZone
        ? { x: b.mapWidth / 2, y: (targetZone.yMin + targetZone.yMax) / 2 }
        : null;

      const newObjective = playToObjective(play, targetPos);

      // Only reassign if the play changed meaningfully
      if (newObjective.type !== objective.type) {
        assignObjective(commander, sgt, newObjective, now, b);
        commander._lastReassignTime = now;
        // Tag the play on the sergeant for downstream consumption
        sgt._currentPlay = play;
        _logEvent(b, commander, now, 'play',
          `Squad ${squadId}: ${play} (panic: ${commander.panic.toFixed(2)})`);
      }

      commander._lastPlayPanic = commander.panic;
    }

    // ── Check ADVANCE_TO completion ────────────────────
    if (objective.type === Objective.ADVANCE_TO && objective.reached) {
      const scores = scoreObjectives(commander, cmdSitrep, squadReport);
      const best = pickBestObjective(scores);

      let newObjective;
      if (best.type === Objective.ADVANCE_TO) {
        newObjective = {
          type: Objective.ADVANCE_TO,
          position: pickAdvanceTarget(commander, b,
            cmdSquads.indexOf(squadId), cmdSquads.length, cmdSitrep)
        };
      } else {
        newObjective = { type: best.type };
      }

      assignObjective(commander, sgt, newObjective, now, b);
      _logEvent(b, commander, now, 'reassign',
        `Squad ${squadId}: ${objective.type} → ${newObjective.type}`);
    }

    // ── Check ATTACK completion ────────────────────────
    if (objective.type === Objective.ATTACK) {
      const enemyPool = team === 'blue' ? b.enemies : b.units;
      const poolDead = !enemyPool || enemyPool.length === 0 || enemyPool.every(e => e.dead);
      // Red attacking blue: also check if hero is alive
      const heroAlive = team === 'red' && b.hero && !b.hero.dead;
      const allDead = poolDead && !heroAlive;
      if (allDead) {
        objective.status = 'complete';
        _logEvent(b, commander, now, 'complete',
          `Squad ${squadId} objective ${objective.type} complete`);
      }
    }
  }

  // ── Reserve deployment (panic-driven tempo) ─────────
  commander._destroyedSinceLastDeploy += destroyedThisCheck;

  if (commander.reserves.length > 0) {
    // Panic-driven reinforcement tempo
    const reinforceInterval = getReinforcementInterval(commander);
    commander._reinforceTimer += dtSec;

    const shouldDeploy =
      commander._reinforceTimer >= reinforceInterval
      || commander._destroyedSinceLastDeploy > 0 && activeCount === 0
      || commander.panic > 0.8;  // Critical: dump everything

    if (shouldDeploy) {
      // Squad sizing: personality-driven commit size
      const t = commander.traits;
      let commitFraction;
      if (commander.panic > 0.8 && t.composure < 0.4) {
        commitFraction = 1.0;  // Dump everything
        _logEvent(b, commander, now, 'panic_deploy',
          `CRITICAL PANIC (${commander.panic.toFixed(2)}): committing all reserves`);
      } else if (commander.panic > 0.6) {
        commitFraction = 0.5 + t.aggression * 0.3;
      } else {
        commitFraction = 0.3 + (1 - t.composure) * 0.2;
      }

      const commitCount = Math.max(5, Math.ceil(commander.reserves.length * commitFraction));
      const toCommit = commander.reserves.splice(0, commitCount);

      // Not enough for a new squad — reinforce an existing one
      if (toCommit.length < 5) {
        // Find the smallest active squad to absorb these units
        const activeSquads = (b._squads || []).filter(sq =>
          sq.team === commander.team && sq.members.some(id => {
            const pool = commander.team === 'red' ? (b.enemies || []) : (b.units || []);
            return pool.some(u => u.id === id && !u.dead);
          })
        );
        if (activeSquads.length > 0) {
          const smallest = activeSquads.reduce((a, c) => a.members.length < c.members.length ? a : c);
          // Queue as pending reinforcements to the smallest squad
          commander._pendingReinforcements = { squadId: smallest.id, units: toCommit };
          _logEvent(b, commander, now, 'reserve',
            `Reinforcing Squad ${smallest.id} with ${toCommit.length} units`);
        } else {
          // No active squads — push back and wait
          commander.reserves.unshift(...toCommit);
        }
        commander._reinforceTimer = 0;
      } else {
        const plans = planDeployment(commander, b, toCommit, now);
        commander._reinforceTimer = 0;
        commander._destroyedSinceLastDeploy = 0;

        _logEvent(b, commander, now, 'reserve',
          `Deploying reserves: ${plans.reduce((n, p) => n + p.units.length, 0)} units in ${plans.length} squad(s) (panic: ${commander.panic.toFixed(2)})`);

        commander._pendingDeployments = plans;
      }
    }
  }

  // ── Escalation check (time-driven aggression drift) ──
  if (cmdSitrep.effectiveAggression > 0.7 && commander.reserves.length > 0 && !commander._pendingDeployments) {
    _deployReserves(b, commander, now);
    _logEvent(b, commander, now, 'escalate', 'Escalating: committing all reserves');
  }

  // Clean up destroyed squad IDs (use Map for O(1) lookups)
  {
    const pool = team === 'blue' ? (b.units || []) : (b.enemies || []);
    const poolById = new Map();
    for (const u of pool) poolById.set(u.id, u);
    const squadMap = new Map();
    for (const s of squads) squadMap.set(s.id, s);

    commander.squads = cmdSquads.filter(sqId => {
      const sq = squadMap.get(sqId);
      if (!sq) return false;
      return sq.members.some(id => {
        const u = poolById.get(id);
        return u && !u.dead;
      });
    });
  }
}


/**
 * Find the most-threatened defense zone.
 */
function _getMostThreatenedZone(cmdr) {
  if (!cmdr.defenseZones || cmdr.defenseZones.length === 0) return null;
  let best = null;
  let bestThreat = -1;
  for (const zone of cmdr.defenseZones) {
    // Inner zone threats weighted 1.5x
    const weight = zone.id === 'inner' ? 1.5 : 1.0;
    const weighted = zone.threatLevel * weight;
    if (weighted > bestThreat) {
      bestThreat = weighted;
      best = zone;
    }
  }
  return bestThreat > 0 ? best : null;
}


// ── Reserve deployment ──────────────────────────────────────

function _deployReserves(b, commander, now) {
  if (commander.reserves.length === 0) return;

  const plans = planDeployment(commander, b, commander.reserves, now);
  commander.reserves = []; // planDeployment may put leftovers back
  commander._destroyedSinceLastDeploy = 0;

  _logEvent(b, commander, now, 'reserve',
    `Deploying reserves: ${plans.reduce((n, p) => n + p.units.length, 0)} units in ${plans.length} squad(s)`);

  // Return plans for mode code to spawn
  // Store on commander for mode code to pick up
  commander._pendingDeployments = plans;
}


// ── Event logging ───────────────────────────────────────────

function _logEvent(b, commander, now, action, detail) {
  // Clamp negative timestamps (init events before battle clock starts)
  const t = Math.max(0, now);
  logEvent(b, {
    t,
    who: `cmd-${commander.team}`,
    team: commander.team,
    type: 'commander',
    action,
    detail
  });
}


// ── Wave scaling ────────────────────────────────────────────

/**
 * Scale commander personality by wave number for progressive difficulty.
 * Mutates the commander's personality in place.
 * @param {object} cmdr - commander object
 * @param {number} wave
 */
export function scaleCommanderByWave(cmdr, wave) {
  const scale = Math.min(0.3, wave * 0.02);
  const p = cmdr.personality;
  for (const key of Object.keys(p)) {
    p[key] = Math.min(1.0, p[key] + scale);
  }
  // Scale commander traits too
  if (cmdr.traits) {
    for (const key of Object.keys(cmdr.traits)) {
      cmdr.traits[key] = Math.min(1.0, cmdr.traits[key] + scale);
    }
  }
  // Update eval interval based on new initiative
  cmdr.evalInterval = 2000 + (1 - p.initiative) * 4000;
}
