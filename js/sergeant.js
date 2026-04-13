// ═══════════════════════════════════════════════════════════════
// SERGEANT — Team-level AI commander
//
// State machine that issues commands, sets waypoints, and chooses
// formations for an entire team. Runs BEFORE formations and brains
// so units execute the sergeant's orders on the same frame.
//
// Phases: SEARCH, CONTACT, ENGAGE, PRESS, PURSUE, DISENGAGE, REGROUP, AMBUSH, FLANK, HOLD
// Phase selection via scoring model — objective, personality, sitrep, inertia
// ═══════════════════════════════════════════════════════════════

import { Command, issueCommand, getArmorTier, getTierDamageMultiplier } from './ai.js';
import { Objective } from './commander.js';
import { Formation } from './constants.js';
import { getDamageFalloff } from './fire-decision.js';
import { findPathWorld } from './pathfinding.js';
import { getTerrainAt, isTerrainBlocked, TERRAIN_COVER_SCORE } from './terrain-utils.js';
import { logEvent } from './battle-log.js';

// ── Phase constants ─────────────────────────────────────────

export const Phase = {
  SEARCH:     'search',      // was MARCH
  CONTACT:    'contact',
  ENGAGE:     'engage',
  PRESS:      'press',
  PURSUE:     'pursue',      // NEW
  DISENGAGE:  'disengage',   // was FALLBACK
  REGROUP:    'regroup',
  AMBUSH:     'ambush',      // NEW
  FLANK:      'flank',       // NEW
  HOLD:       'hold'         // NEW
};

// ── Personality-driven speech callouts ────────────────────────
// Three flavors: aggressive (high aggression/courage), disciplined
// (high discipline), and casual (everyone else).
// Custom callouts can override via sgt.callouts = { phase: {...}, command: {...} }

const PHASE_CALLOUTS = {
  search: {
    aggressive: ['Move it!', 'Double time!', 'Hustle up!', 'Let\'s hunt!', 'Get moving, now!', 'Time to fight!'],
    disciplined: ['Forward march!', 'Advance to objective.', 'Proceed to waypoint.', 'Moving out.', 'Column advance.', 'On the march.'],
    casual: ['Let\'s go!', 'Move out!', 'On the move!', 'Here we go.', 'Alright, push up.', 'We\'re oscar mike.']
  },
  contact: {
    aggressive: ['There they are!', 'I see \'em! Let\'s go!', 'Fresh meat!', 'Finally!', 'About time!', 'Targets!'],
    disciplined: ['Contact front.', 'Hostiles spotted.', 'Enemy visual confirmed.', 'Tango bearing ahead.', 'Multiple contacts.', 'Eyes on.'],
    casual: ['Contact!', 'Eyes up!', 'Heads up!', 'We\'ve got company!', 'Enemy spotted!', 'I see them!']
  },
  engage: {
    aggressive: ['Light \'em up!', 'Waste \'em!', 'Tear \'em apart!', 'Smoke \'em!', 'Let \'em have it!', 'Kill \'em all!'],
    disciplined: ['Weapons free.', 'Engage at will.', 'Open fire.', 'Commence firing.', 'All units, engage.', 'Fire on my mark. Mark.'],
    casual: ['Open fire!', 'Engage!', 'Fire at will!', 'Send it!', 'Take \'em out!', 'Here we go!']
  },
  press: {
    aggressive: ['No mercy!', 'Crush them!', 'They\'re running!', 'Finish them!', 'Don\'t let any escape!', 'Run them down!'],
    disciplined: ['Press the advantage.', 'Maintain pressure.', 'Continue advance.', 'Pursue and destroy.', 'Keep formation, push.', 'Exploit the gap.'],
    casual: ['Keep pushing!', 'They\'re breaking!', 'Don\'t let up!', 'We\'ve got \'em!', 'Stay on them!', 'Almost there!']
  },
  pursue: {
    aggressive: ['Run them down!', 'No one escapes!', 'Chase them!', 'Don\'t stop!', 'After them!', 'Finish it!'],
    disciplined: ['Pursue and eliminate.', 'Maintain contact.', 'Do not let them regroup.', 'Follow and engage.', 'Press pursuit.', 'Stay on target.'],
    casual: ['After them!', 'They\'re running!', 'Keep on them!', 'Don\'t lose them!', 'Chase!', 'Stay close!']
  },
  disengage: {
    aggressive: ['This ain\'t over!', 'We\'ll be back!', 'Pull back, damn it!', 'Regroup and hit \'em again!', 'Not like this!', 'Fall back!'],
    disciplined: ['Tactical withdrawal.', 'Break contact.', 'Disengage and withdraw.', 'Orderly retreat.', 'Fall back to rally point.', 'Retrograde movement.'],
    casual: ['Fall back!', 'Get out of there!', 'Pull back!', 'Too hot! Move!', 'We need to move!', 'Bug out!']
  },
  regroup: {
    aggressive: ['Get it together!', 'On me, now!', 'We\'re going again!', 'Shake it off!', 'Round two!', 'Reform and reload!'],
    disciplined: ['Rally point here.', 'Consolidate positions.', 'Reform formation.', 'Regroup and reassess.', 'All units, rally.', 'Hold and reorganize.'],
    casual: ['Regroup!', 'Rally on me!', 'Form up!', 'Everyone here!', 'Tighten up!', 'Hold here a sec.']
  },
  ambush: {
    aggressive: ['Quiet! Wait for it...', 'Steady... steady...', 'Let them come closer!', 'Hold... hold...', 'Wait for my signal!', 'Not yet...'],
    disciplined: ['Set ambush positions.', 'Hold fire until ordered.', 'Concealment, weapons ready.', 'Ambush formation.', 'Wait for the kill zone.', 'Discipline. Hold fire.'],
    casual: ['Shh, get ready.', 'Hold your fire.', 'Wait for it...', 'Easy... easy...', 'Nobody shoot yet.', 'Get set up here.']
  },
  flank: {
    aggressive: ['Go around and hit \'em!', 'Flank and destroy!', 'Get their side!', 'Move around!', 'Hit \'em where it hurts!', 'Swing wide!'],
    disciplined: ['Execute flanking maneuver.', 'Envelop from the side.', 'Maneuver element, advance.', 'Flank and suppress.', 'Echelon movement.', 'Swing to their flank.'],
    casual: ['Flank them!', 'Go around!', 'Hit their side!', 'Swing out!', 'Get around them!', 'Move to the flank!']
  },
  hold: {
    aggressive: ['Dig in and fight!', 'Nobody moves!', 'Stand your ground!', 'Not one step back!', 'Hold the line!', 'Make them come to us!'],
    disciplined: ['Establish defensive positions.', 'Fortify and hold.', 'All-round defense.', 'Hold this ground.', 'Defensive posture.', 'Stand fast.'],
    casual: ['Hold here!', 'Dig in!', 'Stay put!', 'Don\'t move!', 'Hold position!', 'We hold here.']
  }
};

const COMMAND_CALLOUTS = {
  follow: {
    aggressive: ['Keep up!', 'With me, let\'s go!', 'Stay on my ass!', 'Move with me!'],
    disciplined: ['Form on me.', 'Follow my lead.', 'Maintain formation.', 'On me.'],
    casual: ['On me!', 'Stay close!', 'Follow me!', 'With me!']
  },
  advance: {
    aggressive: ['Go go go!', 'Push up!', 'Charge!', 'Move it, move it!'],
    disciplined: ['Advance.', 'Move to next position.', 'Push forward.', 'Proceed.'],
    casual: ['Move up!', 'Let\'s push!', 'Forward!', 'Advance!']
  },
  hold: {
    aggressive: ['Nobody moves!', 'Stand your ground!', 'Not one step back!', 'Hold the line!'],
    disciplined: ['Hold position.', 'Stand fast.', 'Maintain position.', 'All halt.'],
    casual: ['Hold here!', 'Dig in!', 'Stay put!', 'Don\'t move!']
  },
  fall_back: {
    aggressive: ['Get back, now!', 'Move your ass!', 'Out, out, out!', 'Run!'],
    disciplined: ['Withdraw to cover.', 'Fall back by bounds.', 'Retrograde.', 'Disengage.'],
    casual: ['Fall back!', 'Pull back!', 'Get back!', 'Retreat!']
  },
  cover_me: {
    aggressive: ['Lay it on \'em!', 'Suppress those bastards!', 'Pin them down!', 'Blast \'em!'],
    disciplined: ['Provide covering fire.', 'Suppressive fire.', 'Cover my movement.', 'Fire support.'],
    casual: ['Cover me!', 'Covering fire!', 'Keep their heads down!', 'Suppress them!']
  },
  focus_fire: {
    aggressive: ['Kill that one!', 'All guns, that target!', 'Burn it down!', 'Focus! Now!'],
    disciplined: ['Concentrate fire on target.', 'All units, priority target.', 'Converge fire.', 'Designating target.'],
    casual: ['Focus fire!', 'Hit that one!', 'Everyone on that target!', 'Take it out!']
  },
  flank_left: {
    aggressive: ['Swing left, hit \'em hard!', 'Go left, now!', 'Left hook!', 'Flank and destroy!'],
    disciplined: ['Maneuver left.', 'Left flank, execute.', 'Envelop from the left.', 'Left echelon.'],
    casual: ['Flank left!', 'Go left!', 'Hook left!', 'Left side, move!']
  },
  flank_right: {
    aggressive: ['Swing right, hit \'em hard!', 'Go right, now!', 'Right hook!', 'Flank and destroy!'],
    disciplined: ['Maneuver right.', 'Right flank, execute.', 'Envelop from the right.', 'Right echelon.'],
    casual: ['Flank right!', 'Go right!', 'Hook right!', 'Right side, move!']
  }
};

const BUBBLE_DURATION = 2500; // ms

/**
 * Pick a callout flavor based on sergeant personality traits.
 * High aggression+courage → aggressive, high discipline → disciplined, else casual.
 * @param {object} flavorPool - { aggressive: [...], disciplined: [...], casual: [...] }
 * @param {object} personality - Sergeant personality traits
 * @returns {string} Random callout text from the chosen flavor
 */
function pickCallout(flavorPool, personality) {
  if (!flavorPool) return null;

  // If it's a flat array (custom callouts), pick directly
  if (Array.isArray(flavorPool)) {
    return flavorPool[Math.floor(Math.random() * flavorPool.length)];
  }

  const p = personality || {};
  const agg = p.aggression ?? 0.5;
  const courage = p.courage ?? 0.5;
  const disc = p.discipline ?? 0.5;

  // Aggressive: high aggression OR high courage+aggression combo
  // Disciplined: high discipline AND not dominated by aggression
  // Casual: everything else
  let flavor;
  if (agg > 0.65 || (agg > 0.5 && courage > 0.65)) {
    flavor = 'aggressive';
  } else if (disc > 0.65) {
    flavor = 'disciplined';
  } else {
    flavor = 'casual';
  }

  const pool = flavorPool[flavor] || flavorPool.casual || [];
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Attach a speech bubble to the sergeant's unit.
 * @param {object} b - Battle object (has ._squads)
 * @param {object} sgt - Sergeant state
 * @param {string} text - What the sergeant says
 */
function emitBubble(b, sgt, text) {
  // Find the sergeant's unit via squad
  const squad = b._squads?.find(sq => sq.sergeant === sgt);
  const sgtUnitId = squad?.sergeantUnitId;
  if (!sgtUnitId) return;

  const allUnits = [...(b.units || []), ...(b.enemies || [])];
  const sgtUnit = allUnits.find(u => u.id === sgtUnitId);
  if (!sgtUnit || sgtUnit.dead) return;
  const now = Date.now();
  sgtUnit._speechBubble = { text, t: now };

  // Log to event log so replay can reconstruct bubbles
  logEvent(b, {
    t: now, who: sgtUnitId, team: sgt.teamKey,
    type: 'speech', action: text, detail: `sgt-${sgt.teamKey}`
  });
}

// ── Default sergeant personality ─────────────────────────────

export const DEFAULT_SERGEANT = {
  aggression:   0.5,  // 0 = cautious, 1 = reckless
  patience:     0.5,  // 0 = impatient, 1 = waits for perfect opportunity
  courage:      0.5,  // 0 = retreats early, 1 = fights to the last
  discipline:   0.5,  // 0 = loose control, 1 = tight formations
  initiative:   0.5,  // 0 = follows doctrine, 1 = improvises (flanking, etc.)
  awareness:    0.5,  // 0 = slow to react, 1 = re-evaluates frequently
  adaptability: 0.5   // 0 = rigid plans, 1 = willing to change approach
};

// ── Evaluation interval ──────────────────────────────────────

// awareness scales from 3s (low) to 1s (high)
function evalInterval(sgt) {
  return 3.0 - ((sgt.personality.awareness ?? 0.5) * 2.0);
}

// ═══════════════════════════════════════════════════════════════
// CREATE SERGEANT STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Create a sergeant state object for a team.
 * @param {string} teamKey - 'blue' or 'red'
 * @param {Object} personality - Sergeant personality traits
 * @param {Object} spawnZone - { x, y, radius } — rally point
 * @param {Object} enemySpawnZone - { x, y, radius } — objective
 * @param {number} [squadId] - Optional squad ID this sergeant belongs to
 * @returns {Object} Sergeant state
 */
export function createSergeant(teamKey, personality, spawnZone, enemySpawnZone, squadId) {
  const p = { ...DEFAULT_SERGEANT, ...personality };
  // Personality-seeded eval offset: awareness + initiative determine initial phase
  const awarenessDelay = (1 - (p.awareness ?? 0.5)) * 2000;
  const initiativeOffset = (p.initiative ?? 0.5) * 1000;

  return {
    teamKey,
    personality: p,
    phase: Phase.SEARCH,
    prevPhase: null,

    // Timing — seeded from personality + squadId to desynchronize multiple sergeants
    lastEval: -(awarenessDelay + initiativeOffset + (squadId || 0) * 500),
    phaseStartTime: 0,
    contactTime: 0,

    // Waypoints / path
    waypoint: { x: enemySpawnZone.x, y: enemySpawnZone.y },
    rallyPoint: { x: spawnZone.x, y: spawnZone.y },
    spawnZone: { x: spawnZone.x, y: spawnZone.y },
    enemyZone: { x: enemySpawnZone.x, y: enemySpawnZone.y },
    path: null,         // World-coordinate waypoints from A*
    pathIndex: 0,       // Current waypoint index
    pathGoal: null,     // { x, y } the path was computed toward

    // Objective — set by commander via assignObjective()
    objective: null,
    _objectivePressure: 0,    // Escalating urgency (0-1)
    _lastPressureUpdate: 0,

    // Last issued state — prevent command thrashing
    _lastCommand: null,
    _lastFormation: null,

    // Emergency re-eval: set to a timestamp to force early re-eval
    _emergencyReeval: 0,
    // Track alive count for automatic death detection
    _lastAliveCount: 0,

    // Ambush state
    _ambushHoldFire: false,
    _ambushSet: 0,

    // Search canvassing state
    _searchTarget: null,      // Current bound target position
    _searchBoundCount: 0,     // Number of completed bounds (drives adaptation)

    // Situational awareness (refreshed each eval)
    sitrep: null,
    sitrepHistory: [],  // Ring buffer of recent sitreps for trend analysis
    lastEngagementTime: 0, // Timestamp of last fire event — stalemate detection
    squadId: squadId ?? null
  };
}

// ═══════════════════════════════════════════════════════════════
// SITUATIONAL REPORT — computed each eval tick
// ═══════════════════════════════════════════════════════════════

function buildSitrep(b, sgt, friendlies, hostiles, now) {
  const alive = friendlies.filter(u => !u.dead);
  const enemyAlive = hostiles.filter(u => !u.dead);

  const total = friendlies.length;
  const aliveCount = alive.length;
  const enemyTotal = hostiles.length;
  const enemyAliveCount = enemyAlive.length;

  // Force ratio: >1 = we outnumber them
  const forceRatio = enemyAliveCount > 0
    ? aliveCount / enemyAliveCount
    : aliveCount > 0 ? 99 : 0;

  // Casualties
  const casualties = total - aliveCount;
  const casualtyRate = total > 0 ? casualties / total : 0;
  const enemyCasualties = enemyTotal - enemyAliveCount;
  const enemyCasualtyRate = enemyTotal > 0 ? enemyCasualties / enemyTotal : 0;

  // Center of mass + terrain cover quality
  let cx = 0, cy = 0, coverSum = 0;
  for (const u of alive) {
    cx += u.x; cy += u.y;
    coverSum += sampleCover(b, u);
  }
  if (aliveCount > 0) { cx /= aliveCount; cy /= aliveCount; }
  const avgCover = aliveCount > 0 ? coverSum / aliveCount : 0;

  let ecx = 0, ecy = 0;
  for (const e of enemyAlive) { ecx += e.x; ecy += e.y; }
  if (enemyAliveCount > 0) { ecx /= enemyAliveCount; ecy /= enemyAliveCount; }
  const enemyCenter = enemyAliveCount > 0 ? { x: ecx, y: ecy } : null;

  // Distance to enemy center
  const distToEnemy = aliveCount > 0 && enemyAliveCount > 0
    ? Math.hypot(ecx - cx, ecy - cy)
    : Infinity;

  // Check if any friendly has spotted enemies
  const spotted = alive.some(u => (u._spotted?.length ?? 0) > 0);

  // Average morale
  const avgMorale = aliveCount > 0
    ? alive.reduce((s, u) => s + (u.morale ?? 1.0), 0) / aliveCount
    : 0;

  // Average suppression
  const avgSuppression = aliveCount > 0
    ? alive.reduce((s, u) => s + (u._suppression ?? 0), 0) / aliveCount
    : 0;

  // Under fire intensity: 0-1 ratio of squad under active shock (smooth, not binary)
  const underFireCount = alive.filter(u => (u._shockTimer ?? 0) > 0).length;
  const underFireRatio = aliveCount > 0 ? underFireCount / aliveCount : 0;
  const underFire = underFireRatio > 0; // boolean for backward compat

  // Max weapon range across alive units
  const maxRange = alive.reduce((mx, u) => Math.max(mx, u.range ?? 400), 0);

  // Effective firepower ratio — accounts for accuracy, range, armor, suppression, HP
  let friendlyEDPS = 0, enemyEDPS = 0;

  // Pre-compute average armor tier per side for cross-matchup estimation
  let friendlyTierSum = 0, enemyTierSum = 0;
  for (const u of alive) friendlyTierSum += getArmorTier(u);
  for (const e of enemyAlive) enemyTierSum += getArmorTier(e);
  const avgFriendlyTier = aliveCount > 0 ? friendlyTierSum / aliveCount : 0;
  const avgEnemyTier = enemyAliveCount > 0 ? enemyTierSum / enemyAliveCount : 0;

  for (const u of alive) {
    const rawDPS = (u.damage || 10) / ((u.fireRate || 2000) / 1000);
    const stability = 0.5 + (u.stability ?? 0.5) * 0.5;       // 0.5–1.0
    const suppPenalty = 1 - (u._suppression ?? 0) * 0.3;       // 0.7–1.0
    const falloff = getDamageFalloff(distToEnemy, u.range || 400);
    const armorMult = getTierDamageMultiplier(getArmorTier(u), avgEnemyTier);
    const hpWeight = Math.min(2.0, (u.hp || 60) / 60);         // Tougher units sustain DPS longer
    friendlyEDPS += rawDPS * stability * suppPenalty * falloff * armorMult * hpWeight;
  }
  for (const e of enemyAlive) {
    const rawDPS = (e.damage || 10) / ((e.fireRate || 2000) / 1000);
    const stability = 0.5 + (e.stability ?? 0.5) * 0.5;
    const suppPenalty = 1 - (e._suppression ?? 0) * 0.3;
    const falloff = getDamageFalloff(distToEnemy, e.range || 400);
    const armorMult = getTierDamageMultiplier(getArmorTier(e), avgFriendlyTier);
    const hpWeight = Math.min(2.0, (e.hp || 60) / 60);
    enemyEDPS += rawDPS * stability * suppPenalty * falloff * armorMult * hpWeight;
  }
  const firepowerRatio = enemyEDPS > 0
    ? friendlyEDPS / enemyEDPS
    : friendlyEDPS > 0 ? 99 : 0;

  // Suppression distribution — fraction of squad heavily suppressed
  let heavilySuppressed = 0;
  for (const u of alive) {
    if ((u._suppression ?? 0) > 0.5) heavilySuppressed++;
  }
  const suppressedRate = aliveCount > 0 ? heavilySuppressed / aliveCount : 0;

  // ── Enemy posture detection (spotted-only + last known) ─────
  // Track center-of-mass of SPOTTED enemies only — posture is gated by vision.
  // When contact is lost, retain last known posture with decaying confidence.
  let enemyPosture = 'unknown';   // 'advancing' | 'holding' | 'retreating' | 'unknown'
  let enemyApproachRate = 0;      // px/s, positive = closing

  // Collect spotted enemy refs from all alive friendlies in this squad
  const spottedEnemies = new Set();
  for (const u of alive) {
    for (const s of (u._spotted || [])) {
      if (s.enemy && !s.enemy.dead) spottedEnemies.add(s.enemy);
    }
  }
  const spottedCount = spottedEnemies.size;

  // Compute spotted enemy center-of-mass
  let secx = 0, secy = 0;
  if (spottedCount > 0) {
    for (const e of spottedEnemies) { secx += e.x; secy += e.y; }
    secx /= spottedCount;
    secy /= spottedCount;
  }
  const spottedEnemyCenter = spottedCount > 0 ? { x: secx, y: secy } : null;

  const curTime = now || Date.now();

  if (spottedCount > 0 && aliveCount > 0 && sgt._prevSpottedCenter) {
    // ── Live tracking: we can see enemies right now ──
    const dt = (curTime - (sgt._prevSpottedCenterTime || 0)) / 1000;
    if (dt > 0.3 && dt < 10) {
      const prevDist = Math.hypot(
        sgt._prevSpottedCenter.x - sgt._prevOwnCenter.x,
        sgt._prevSpottedCenter.y - sgt._prevOwnCenter.y
      );
      const curDist = Math.hypot(secx - cx, secy - cy);
      enemyApproachRate = (prevDist - curDist) / dt;

      // Smooth with previous reading
      const prevRate = sgt._enemyApproachRate || 0;
      enemyApproachRate = prevRate * 0.4 + enemyApproachRate * 0.6;

      // Classify posture — awareness modulates sensitivity
      const awareness = sgt.personality?.awareness ?? 0.5;
      const advanceThreshold = 8 - awareness * 4;   // 4-8 px/s
      const retreatThreshold = -(8 - awareness * 4);

      if (enemyApproachRate > advanceThreshold) {
        enemyPosture = 'advancing';
      } else if (enemyApproachRate < retreatThreshold) {
        enemyPosture = 'retreating';
      } else {
        enemyPosture = 'holding';
      }
    }

    // Fresh data — store as last known intel (including movement vector)
    sgt._lastKnownPosture = enemyPosture;
    sgt._lastKnownCenter = { x: secx, y: secy };
    sgt._lastKnownTime = curTime;
    // Movement vector: direction + speed the enemy center was traveling
    if (dt > 0) {
      sgt._lastKnownVector = {
        dx: (secx - sgt._prevSpottedCenter.x) / dt,
        dy: (secy - sgt._prevSpottedCenter.y) / dt
      };
    }

  } else if (spottedCount === 0 && sgt._lastKnownPosture && sgt._lastKnownPosture !== 'unknown') {
    // ── Contact lost — use last known posture with decaying confidence ──
    // Discipline determines how long the sergeant trusts stale intel.
    // High discipline: trusts last known for up to 8s. Low: 3s.
    const discipline = sgt.personality?.discipline ?? 0.5;
    const maxStaleAge = 3 + discipline * 5; // 3-8 seconds
    const staleAge = (curTime - (sgt._lastKnownTime || 0)) / 1000;

    if (staleAge < maxStaleAge) {
      enemyPosture = sgt._lastKnownPosture;
      enemyApproachRate = (sgt._enemyApproachRate || 0) * 0.5; // Halve confidence on stale data
    } else {
      // Intel too old — clear it
      sgt._lastKnownPosture = null;
      sgt._lastKnownCenter = null;
      sgt._lastKnownVector = null;
    }
  }

  // Store spotted center for next eval tick (null if no contact)
  sgt._prevSpottedCenter = spottedEnemyCenter;
  sgt._prevOwnCenter = aliveCount > 0 ? { x: cx, y: cy } : null;
  sgt._prevSpottedCenterTime = curTime;
  sgt._enemyApproachRate = enemyApproachRate;

  // Last known enemy intel — available even after contact is lost
  // Extrapolate position along last known vector (capped to stale window)
  let lastKnownEnemyPos = null;
  if (sgt._lastKnownCenter) {
    const v = sgt._lastKnownVector;
    if (v && spottedCount === 0) {
      // Extrapolate, but cap at 3s of projection to avoid wild guesses
      const staleAge = Math.min(3, (curTime - (sgt._lastKnownTime || 0)) / 1000);
      lastKnownEnemyPos = {
        x: sgt._lastKnownCenter.x + v.dx * staleAge,
        y: sgt._lastKnownCenter.y + v.dy * staleAge
      };
    } else {
      lastKnownEnemyPos = sgt._lastKnownCenter;
    }
  }

  return {
    alive, enemyAlive, aliveCount, enemyAliveCount,
    total, enemyTotal, casualties, casualtyRate,
    enemyCasualties, enemyCasualtyRate,
    forceRatio, firepowerRatio, friendlyEDPS, enemyEDPS,
    distToEnemy, spotted, underFire, underFireRatio,
    avgMorale, avgSuppression, suppressedRate, avgCover, maxRange,
    center: { x: cx, y: cy },
    enemyCenter,
    enemyPosture, enemyApproachRate,
    lastKnownEnemyPos,                      // extrapolated if contact lost
    lastKnownVector: sgt._lastKnownVector   // px/s { dx, dy }
  };
}

// ═══════════════════════════════════════════════════════════════
// PHASE SCORING — replaces hardcoded transition logic
// Every eval tick, sergeant scores all phases and picks the highest.
// ═══════════════════════════════════════════════════════════════

function getObjectiveScore(phase, objective, pressure) {
  const type = objective?.type || Objective.ATTACK;

  // ATTACK objective scores
  const ATTACK_SCORES = {
    [Phase.PRESS]:      0.7,
    [Phase.ENGAGE]:     0.6,
    [Phase.PURSUE]:     0.6,
    [Phase.FLANK]:      0.5,
    [Phase.SEARCH]:     0.4,
    [Phase.AMBUSH]:     0.3,
    [Phase.CONTACT]:    0.3,
    [Phase.HOLD]:       0.2,
    [Phase.REGROUP]:    0.2,
    [Phase.DISENGAGE]:  0.1
  };

  // ADVANCE_TO scores — changes based on distance to target
  const atTarget = objective?.reached || false;
  const ADVANCE_TO_SCORES_FAR = {
    [Phase.SEARCH]:     0.7,
    [Phase.ENGAGE]:     0.4,
    [Phase.PRESS]:      0.1,
    [Phase.PURSUE]:     0.2,
    [Phase.FLANK]:      0.3,
    [Phase.AMBUSH]:     0.2,
    [Phase.CONTACT]:    0.3,
    [Phase.HOLD]:       0.2,
    [Phase.REGROUP]:    0.2,
    [Phase.DISENGAGE]:  0.1
  };
  const ADVANCE_TO_SCORES_NEAR = {
    [Phase.HOLD]:       0.7,
    [Phase.AMBUSH]:     0.6,
    [Phase.ENGAGE]:     0.5,
    [Phase.PRESS]:      0.3,
    [Phase.SEARCH]:     0.1,
    [Phase.CONTACT]:    0.3,
    [Phase.FLANK]:      0.2,
    [Phase.PURSUE]:     0.2,
    [Phase.REGROUP]:    0.3,
    [Phase.DISENGAGE]:  0.2
  };

  // DEFEND objective scores — hold ground, repel attackers
  const DEFEND_SCORES = {
    [Phase.HOLD]:       0.8,
    [Phase.AMBUSH]:     0.6,
    [Phase.ENGAGE]:     0.5,
    [Phase.PRESS]:      0.2,
    [Phase.FLANK]:      0.3,
    [Phase.PURSUE]:     0.1,
    [Phase.SEARCH]:     0.2,
    [Phase.CONTACT]:    0.4,
    [Phase.REGROUP]:    0.4,
    [Phase.DISENGAGE]:  0.2
  };

  // FALL_BACK objective scores — withdraw, preserve force
  const FALL_BACK_SCORES = {
    [Phase.DISENGAGE]:  0.8,
    [Phase.REGROUP]:    0.6,
    [Phase.HOLD]:       0.3,
    [Phase.SEARCH]:     0.4,
    [Phase.AMBUSH]:     0.2,
    [Phase.ENGAGE]:     0.2,
    [Phase.PRESS]:      0.1,
    [Phase.FLANK]:      0.1,
    [Phase.PURSUE]:     0.0,
    [Phase.CONTACT]:    0.3
  };

  let scores;
  if (type === Objective.ADVANCE_TO) {
    scores = atTarget ? ADVANCE_TO_SCORES_NEAR : ADVANCE_TO_SCORES_FAR;
  } else if (type === Objective.DEFEND) {
    scores = DEFEND_SCORES;
  } else if (type === Objective.FALL_BACK) {
    scores = FALL_BACK_SCORES;
  } else {
    scores = ATTACK_SCORES;
  }

  let score = scores[phase] ?? 0.3;

  // Pressure modifies non-productive phases
  if (type === Objective.ATTACK) {
    if (phase === Phase.SEARCH) score += pressure * 0.3;
    if (phase === Phase.DISENGAGE) score -= pressure * 0.3;
    if (phase === Phase.REGROUP) score -= pressure * 0.2;
  } else if (type === Objective.ADVANCE_TO) {
    // Pressure builds when not moving toward target
    if (phase === Phase.HOLD && !atTarget) score -= pressure * 0.3;
    if (phase === Phase.SEARCH && !atTarget) score += pressure * 0.2;
  } else if (type === Objective.DEFEND) {
    // Under pressure, HOLD becomes even more important
    if (phase === Phase.HOLD) score += pressure * 0.2;
    if (phase === Phase.DISENGAGE) score -= pressure * 0.4;
  } else if (type === Objective.FALL_BACK) {
    // Under pressure, DISENGAGE becomes urgent
    if (phase === Phase.DISENGAGE) score += pressure * 0.3;
    if (phase === Phase.ENGAGE) score -= pressure * 0.3;
  }

  return score;
}

function getPersonalityScore(phase, p) {
  switch (phase) {
    case Phase.PRESS:     return p.aggression * 0.3 + p.courage * 0.2;
    case Phase.PURSUE:    return p.aggression * 0.3 - p.patience * 0.1;
    case Phase.AMBUSH:    return p.patience * 0.3 + p.discipline * 0.2;
    case Phase.FLANK:     return p.initiative * 0.3 + p.adaptability * 0.2;
    case Phase.HOLD:      return p.discipline * 0.2 + p.courage * 0.2;
    case Phase.DISENGAGE: return (1 - p.courage) * 0.3 + (1 - p.aggression) * 0.1;
    case Phase.ENGAGE:    return p.discipline * 0.2;
    case Phase.REGROUP:   return p.discipline * 0.2 + p.patience * 0.1;
    case Phase.CONTACT:   return p.patience * 0.2 + p.discipline * 0.1;
    case Phase.SEARCH:    return p.initiative * 0.2;
    default: return 0;
  }
}

function getSitrepScore(phase, sitrep, personality) {
  if (!sitrep) return 0;
  let score = 0;

  const inContact = sitrep.spotted || sitrep.underFire;
  const inRange = sitrep.distToEnemy < (sitrep.maxRange || 400);
  const winning = (sitrep.firepowerRatio || 1) > 1.5;
  const losing = (sitrep.firepowerRatio || 1) < 0.5;
  const pinned = (sitrep.suppressedRate || 0) > 0.5;
  const highCover = (sitrep.avgCover || 0) > 30;
  const nearRally = false; // TODO: compute distance to rally point
  // Enemy posture from center-of-mass tracking (replaces crude casualty heuristic)
  const enemyRetreating = sitrep.enemyPosture === 'retreating';
  const enemyAdvancing  = sitrep.enemyPosture === 'advancing';
  const enemyHolding    = sitrep.enemyPosture === 'holding';
  const stalemate = inContact && !winning && !losing;

  switch (phase) {
    case Phase.SEARCH:
      score += inContact ? -0.5 : 0.5;
      break;
    case Phase.CONTACT:
      score += (sitrep.spotted && !sitrep.underFire) ? 0.4 : -0.3;
      break;
    case Phase.ENGAGE:
      if (!inContact) { score -= 0.5; break; }
      if (inRange) score += 0.4;
      score += (sitrep.underFireRatio ?? 0) * 0.25; // smooth 0-0.25 (was binary +0.2)
      // Enemy advancing into us — hold ground and engage
      if (enemyAdvancing) score += 0.2;
      break;
    case Phase.PRESS:
      if (!inContact) { score -= 0.4; break; }
      if (winning) score += 0.4;
      if (losing) score -= 0.3;
      // Enemy retreating — push forward even if not clearly winning by firepower
      if (enemyRetreating) score += 0.35;
      // Enemy advancing — less need to press, they're coming to us
      if (enemyAdvancing) score -= 0.15;
      break;
    case Phase.PURSUE:
      if (enemyRetreating) score += 0.5;
      else score -= 0.5;
      break;
    case Phase.DISENGAGE:
      if (losing) score += 0.4;
      if (pinned) score += 0.3;
      if ((sitrep.casualtyRate || 0) > 0.3) score += 0.2;
      // Enemy retreating — no reason to disengage, they're pulling back
      if (enemyRetreating) score -= 0.3;
      // Enemy advancing aggressively — disengage might be needed more
      if (enemyAdvancing && losing) score += 0.15;
      break;
    case Phase.REGROUP:
      if (!inContact) score += 0.3;
      else score -= 0.3;
      break;
    case Phase.AMBUSH: {
      // Patient SGTs value ambush setups more
      const ambushCoverWeight = 0.1 + (personality?.patience ?? 0.5) * 0.3;
      if (highCover) score += ambushCoverWeight;
      if (!inContact && sitrep.spotted) score += 0.2;
      if (inContact) score -= 0.5;
      // Enemy advancing toward us — good ambush opportunity
      if (enemyAdvancing && !inContact) score += 0.25;
      break;
    }
    case Phase.FLANK:
      if (stalemate) score += 0.3;
      if (!sitrep.spotted) score -= 0.6; // Can't flank what you can't see — strongly prefer SEARCH
      // Enemy holding/stalemate — flanking breaks the deadlock
      if (enemyHolding && inContact) score += 0.2;
      break;
    case Phase.HOLD: {
      const coverWeight = 0.1 + (1 - (personality?.aggression ?? 0.5)) * 0.2 + (personality?.discipline ?? 0.5) * 0.1;
      if (highCover) score += coverWeight;
      if ((sitrep.avgCover || 0) < 10) score -= 0.3;
      // Enemy advancing — holding ground makes tactical sense
      if (enemyAdvancing) score += 0.2;
      // Enemy retreating — holding wastes the opportunity to press
      if (enemyRetreating) score -= 0.25;
      break;
    }
  }
  return score;
}

// Categorize phases by temperament for hysteresis
const OFFENSIVE_PHASES = new Set([Phase.PRESS, Phase.PURSUE, Phase.ENGAGE, Phase.FLANK, Phase.SEARCH]);
const DEFENSIVE_PHASES = new Set([Phase.HOLD, Phase.DISENGAGE, Phase.REGROUP, Phase.AMBUSH]);
// CONTACT is neutral — transitional by nature

/**
 * Personality-driven hysteresis: how much a new phase must win by to
 * overcome the sergeant's resistance to switching.
 * Aggressive SGTs switch easily toward offense, resist switching to defense.
 * Cautious SGTs are the opposite. Discipline raises baseline, initiative lowers it.
 */
function getSwitchThreshold(fromPhase, toPhase, personality) {
  const p = personality;
  // Base threshold — discipline makes you commit, initiative makes you adapt
  let threshold = 0.08 + p.discipline * 0.1 - p.initiative * 0.06;

  const leavingOffensive = OFFENSIVE_PHASES.has(fromPhase);
  const goingOffensive = OFFENSIVE_PHASES.has(toPhase);
  const leavingDefensive = DEFENSIVE_PHASES.has(fromPhase);
  const goingDefensive = DEFENSIVE_PHASES.has(toPhase);

  if (leavingDefensive && goingOffensive) {
    // Defensive → Offensive: aggression lowers threshold, caution raises it
    threshold += (1 - p.aggression) * 0.1 - p.aggression * 0.05;
  } else if (leavingOffensive && goingDefensive) {
    // Offensive → Defensive: courage resists retreating, low courage accepts it
    threshold += p.courage * 0.1 - (1 - p.courage) * 0.05;
  }
  // Same-category transitions (offense→offense, defense→defense) use base threshold

  return Math.max(0.02, threshold); // Always require at least a tiny margin
}

// Score all phases, return the best one (hysteresis-based)
function pickBestPhase(sgt, sitrep) {
  const phases = Object.values(Phase);
  const p = sgt.personality;
  let bestPhase = null;
  let bestScore = -Infinity;
  let currentScore = -Infinity;
  const scores = {};

  for (const phase of phases) {
    const obj = getObjectiveScore(phase, sgt.objective, sgt._objectivePressure);
    const pers = getPersonalityScore(phase, p);
    const sit = getSitrepScore(phase, sitrep, p);
    const score = obj + pers + sit;
    scores[phase] = { obj, pers, sit, total: score };
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
    if (phase === sgt.phase) {
      currentScore = score;
    }
  }

  // Hysteresis: only switch if winner beats current phase by personality-driven margin
  let threshold = 0;
  let switched = true;
  if (bestPhase !== sgt.phase) {
    threshold = getSwitchThreshold(sgt.phase, bestPhase, p);
    if (bestScore - currentScore < threshold) {
      switched = false;
      bestPhase = sgt.phase; // Not enough conviction to switch
    }
  }

  // Store scoring snapshot for telemetry
  sgt._lastScoring = {
    scores,
    picked: bestPhase,
    threshold: +threshold.toFixed(3),
    margin: +(bestScore - currentScore).toFixed(3),
    switched,
    pressure: +sgt._objectivePressure.toFixed(3)
  };

  return bestPhase;
}

// ── Objective productivity check ────────────────────────────

function isPhaseProductiveForObjective(phase, objType, sitrep, objective) {
  if (objType === 'attack') {
    // Always productive: actively moving toward enemy or fighting
    if ([Phase.SEARCH, Phase.PRESS, Phase.PURSUE, Phase.FLANK].includes(phase)) return true;
    // CONTACT: productive only briefly (spotted but assessing)
    if (phase === Phase.CONTACT) return true;
    // ENGAGE: only productive if actually in range and fighting
    if (phase === Phase.ENGAGE) {
      const inRange = sitrep && sitrep.distToEnemy < (sitrep.maxRange || 400);
      return inRange && (sitrep.underFire || sitrep.spotted);
    }
    // AMBUSH: only productive if enemies are nearby (setting up a kill zone)
    if (phase === Phase.AMBUSH) {
      return sitrep && sitrep.spotted && sitrep.distToEnemy < (sitrep.maxRange || 400) * 1.5;
    }
    return false;
  }
  if (objType === 'advance_to') {
    const atTarget = objective?.reached || false;
    // SEARCH productive if moving toward target (not at target yet)
    if (phase === Phase.SEARCH) return !atTarget;
    // HOLD/AMBUSH productive if at target
    if (phase === Phase.HOLD || phase === Phase.AMBUSH) return atTarget;
    // ENGAGE/CONTACT productive if under fire (deal with threats on the way)
    if (phase === Phase.ENGAGE || phase === Phase.CONTACT) return sitrep?.underFire || sitrep?.spotted;
    return false;
  }
  if (objType === 'defend') {
    return [Phase.HOLD, Phase.AMBUSH, Phase.ENGAGE, Phase.CONTACT].includes(phase);
  }
  return true; // Unknown objective = everything is productive
}

// ═══════════════════════════════════════════════════════════════
// UPDATE SERGEANT — called once per frame, throttled internally
// ═══════════════════════════════════════════════════════════════

/**
 * Update sergeant state machine for one team.
 * @param {Object} b - Battle object
 * @param {Object} sgt - Sergeant state (from createSergeant)
 * @param {Array} friendlies - Team unit array (b.units or b.enemies)
 * @param {Array} hostiles - Enemy unit array
 * @param {number} now - Current timestamp (ms)
 */
export function updateSergeant(b, sgt, friendlies, hostiles, now) {
  if (!sgt) return;

  const alive = friendlies.filter(u => !u.dead);
  if (alive.length === 0) return;

  // Detect unit deaths → schedule emergency re-eval
  // Re-eval delay: (1 - awareness) × 3 seconds. awareness=1.0 → instant. awareness=0.0 → 3s delay.
  if (alive.length < sgt._lastAliveCount && !sgt._emergencyReeval) {
    const awareness = sgt.personality.awareness ?? 0.5;
    const delay = (1 - awareness) * 3000;
    sgt._emergencyReeval = now + delay;
  }
  sgt._lastAliveCount = alive.length;

  // Throttle evaluation — emergency re-eval bypasses normal interval
  const interval = evalInterval(sgt) * 1000;
  const normalReady = now - sgt.lastEval >= interval;
  const emergencyReady = sgt._emergencyReeval > 0 && now >= sgt._emergencyReeval;
  if (!normalReady && !emergencyReady) return;
  sgt.lastEval = now;
  sgt._emergencyReeval = 0; // Clear emergency flag

  // Build situational report
  const _sgtT0 = performance.now();
  const sitrep = buildSitrep(b, sgt, friendlies, hostiles, now);
  const _sitrepTime = performance.now() - _sgtT0;
  sgt.sitrep = sitrep;

  // Record sitrep history for trend analysis
  sgt.sitrepHistory.push({
    t: now,
    casualtyRate: sitrep.casualtyRate,
    enemyCasualtyRate: sitrep.enemyCasualtyRate,
    forceRatio: sitrep.forceRatio,
    firepowerRatio: sitrep.firepowerRatio,
    avgMorale: sitrep.avgMorale,
    suppressedRate: sitrep.suppressedRate
  });
  if (sgt.sitrepHistory.length > 5) sgt.sitrepHistory.shift();

  const prevPhase = sgt.phase;

  // Track last engagement for stalemate detection
  if (sitrep.underFire || sitrep.spotted) {
    sgt.lastEngagementTime = now;
  }

  // Update objective pressure
  if (sgt.objective) {
    const objType = sgt.objective.type || 'attack';
    const isProductive = isPhaseProductiveForObjective(sgt.phase, objType, sitrep, sgt.objective);
    const dtSec = (now - (sgt._lastPressureUpdate || now)) / 1000;
    sgt._lastPressureUpdate = now;

    if (isProductive) {
      sgt._objectivePressure = Math.max(0, sgt._objectivePressure - dtSec * 0.2);
    } else {
      const growthRate = (1 - sgt.personality.patience) * 0.1;
      sgt._objectivePressure = Math.min(1, sgt._objectivePressure + dtSec * growthRate);
    }
  }

  // ── ADVANCE_TO arrival detection ─────────────────────────────
  if (sgt.objective?.type === Objective.ADVANCE_TO && sgt.objective.position && !sgt.objective.reached) {
    const pos = sgt.objective.position;
    const dx = sitrep.center.x - pos.x;
    const dy = sitrep.center.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 150) {
      sgt.objective.reached = true;
    }
  }

  // ── Phase selection via scoring ──────────────────────────────
  // Minimum phase duration: discipline-driven cooldown prevents rapid oscillation
  // High discipline = longer commitment (6-10s), low discipline = shorter (4-6s)
  const phaseDiscipline = sgt.personality.discipline ?? 0.5;
  const minPhaseDuration = (4.0 + phaseDiscipline * 6.0) * 1000; // 4s - 10s
  const phaseAge = now - (sgt.phaseStartTime || 0);
  const phaseCooldownMet = phaseAge >= minPhaseDuration;

  // Allow evaluation but only permit phase switch after cooldown
  const bestPhase = pickBestPhase(sgt, sitrep);
  if (bestPhase !== sgt.phase && phaseCooldownMet) {
    transition(sgt, bestPhase, now, b);
  }

  // ── Store telemetry snapshot for replay recording ─────────
  sgt._telemetry = {
    t: now,
    phase: sgt.phase,
    prevPhase: prevPhase !== sgt.phase ? prevPhase : null,
    pressure: +sgt._objectivePressure.toFixed(3),
    objective: sgt.objective?.type || null,
    sitrep: {
      aliveCount: sitrep.aliveCount,
      enemyAliveCount: sitrep.enemyAliveCount,
      forceRatio: +(sitrep.forceRatio || 0).toFixed(2),
      firepowerRatio: +(sitrep.firepowerRatio || 0).toFixed(2),
      distToEnemy: Math.round(sitrep.distToEnemy || 0),
      casualtyRate: +(sitrep.casualtyRate || 0).toFixed(2),
      enemyCasualtyRate: +(sitrep.enemyCasualtyRate || 0).toFixed(2),
      spotted: sitrep.spotted || false,
      underFire: sitrep.underFire || false,
      avgCover: Math.round(sitrep.avgCover || 0),
      avgMorale: +(sitrep.avgMorale || 0).toFixed(2),
      suppressedRate: +(sitrep.suppressedRate || 0).toFixed(2),
      enemyPosture: sitrep.enemyPosture || 'unknown',
      enemyApproachRate: Math.round(sitrep.enemyApproachRate || 0)
    },
    scoring: sgt._lastScoring || null
  };

  // ── Execute phase actions ──────────────────────────────────
  const phaseChanged = sgt.phase !== prevPhase;
  const _phaseT0 = performance.now();
  executePhase(b, sgt, sitrep, alive, now, phaseChanged);
  const _phaseTime = performance.now() - _phaseT0;
  const _totalSgtTime = performance.now() - _sgtT0;
  if (_totalSgtTime > 5) {
    console.warn(`[SGT SPIKE] ${sgt.teamKey} sq:${sgt.squadId} total:${_totalSgtTime.toFixed(1)}ms sitrep:${_sitrepTime.toFixed(1)}ms phase:${_phaseTime.toFixed(1)}ms (${sgt.phase}) members:${alive.length} enemies:${hostiles.length}`);
  }
}

// ── Phase transition helper ──────────────────────────────────

function transition(sgt, newPhase, now, b) {
  sgt.prevPhase = sgt.phase;
  sgt.phase = newPhase;
  sgt.phaseStartTime = now;
  if (newPhase === Phase.CONTACT) sgt.contactTime = now;
  // Clear ambush hold-fire when leaving AMBUSH
  if (newPhase !== Phase.AMBUSH) sgt._ambushHoldFire = false;
  // Clear path when changing phases — will be recomputed
  sgt.path = null;

  // Emit speech bubble for phase transition
  // Custom per-sergeant callouts override defaults
  if (b) {
    const custom = sgt.callouts?.phase?.[newPhase];
    const defaults = PHASE_CALLOUTS[newPhase];
    const text = pickCallout(custom || defaults, sgt.personality);
    if (text) emitBubble(b, sgt, text);
  }
  sgt.pathIndex = 0;
  sgt.pathGoal = null;
}

// ── Trend analysis ──────────────────────────────────────────

/**
 * Compute the trend (slope per second) of a metric from sitrep history.
 * Positive = metric increasing, negative = decreasing, 0 = stable/insufficient data.
 */
function getTrend(history, field) {
  if (history.length < 2) return 0;
  const first = history[0][field];
  const last = history[history.length - 1][field];
  const dt = (history[history.length - 1].t - history[0].t) / 1000;
  return dt > 0 ? (last - first) / dt : 0;
}

// ── Decision helpers ─────────────────────────────────────────

function contactDelay(sgt) {
  // Patience: 0 → 500ms, 1 → 3000ms
  return 500 + sgt.personality.patience * 2500;
}

function regroupDuration(sgt) {
  // Discipline: 0 → 2s, 1 → 5s (disciplined sergeants wait for proper formation)
  return (2000 + sgt.personality.discipline * 3000);
}

/** Return the formation leader of a squad (the unit that follows the waypoint). */
function getSquadLeader(alive) {
  return alive.find(u => u._formationLeader === u) || alive[0] || null;
}

/** Return {x, y} of the squad's formation leader, or fallback center. */
function getSquadLeaderPos(alive, fallback) {
  const leader = getSquadLeader(alive);
  return leader ? { x: leader.x, y: leader.y } : (fallback || { x: 0, y: 0 });
}

function distTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ═══════════════════════════════════════════════════════════════
// SEARCH CANVASSING — personality-driven sweep waypoints
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a sweep path from squad position toward the enemy zone.
 * Awareness controls search intelligence (cone width):
 *   awareness 0.0 → random points across the map (clueless wandering)
 *   awareness 0.5 → wide cone toward enemy side (right direction, sloppy)
 *   awareness 1.0 → tight cone toward enemy zone (knows where to look)
 * Other traits shape execution style:
 *   initiative:  high = fewer waypoints (decisive), low = more (cautious)
 *   patience:    high = more waypoints (thorough), low = fewer (rushed)
 *   discipline:  high = regular pattern, low = erratic jitter
 *
 * Each call produces a different path (randomized offsets).
 * When the squad finishes a pass, call again for a new sweep.
 */
/**
 * Pick the next search bound — ONE position toward the suspected enemy.
 * Sergeant picks a spot, squad bounds there, then re-evaluates on arrival.
 *
 * Personality drives everything:
 * - initiative  → bound distance (far leaps vs short hops)
 * - awareness   → how accurately the bound aims toward the real enemy position
 * - courage     → cover-seeking vs direct rush to the spot
 * - patience    → (unused here, but affects phase scoring — patient sgts stay in SEARCH longer)
 *
 * On each call: if we've arrived at _searchTarget, pick a new one. Otherwise keep going.
 */
/**
 * Generate a systematic map sweep waypoint. Divides the map into a 3x3 grid
 * and visits sectors in order of nearest-unvisited. Resets after all visited.
 * @returns {{ x: number, y: number }} Next sector center to sweep
 */
function _pickSweepWaypoint(b, sgt, origin) {
  const mapW = b.mapWidth || 1600;
  const mapH = b.mapHeight || 1600;
  const margin = 120;
  const cols = 3, rows = 3;
  const cellW = (mapW - margin * 2) / cols;
  const cellH = (mapH - margin * 2) / rows;

  // Init sweep state
  if (!sgt._sweepVisited) sgt._sweepVisited = new Set();

  // Build sector centers
  const sectors = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;
      const x = margin + (c + 0.5) * cellW;
      const y = margin + (r + 0.5) * cellH;
      sectors.push({ id, x, y });
    }
  }

  // Mark current sector as visited if squad is within it
  for (const s of sectors) {
    if (Math.abs(origin.x - s.x) < cellW * 0.6 && Math.abs(origin.y - s.y) < cellH * 0.6) {
      sgt._sweepVisited.add(s.id);
    }
  }

  // Reset if all visited
  if (sgt._sweepVisited.size >= sectors.length) {
    sgt._sweepVisited.clear();
  }

  // Pick nearest unvisited sector
  let best = null, bestDist = Infinity;
  for (const s of sectors) {
    if (sgt._sweepVisited.has(s.id)) continue;
    const d = Math.hypot(s.x - origin.x, s.y - origin.y);
    if (d < bestDist) { bestDist = d; best = s; }
  }

  return best || sectors[0];
}

function pickSearchBound(b, sgt, squadCenter, leaderPos) {
  const p = sgt.personality;
  const mapW = b.mapWidth || 1600;
  const mapH = b.mapHeight || 1600;
  const enemy = sgt.enemyZone;
  const margin = 80;
  const cellSize = b.terrainMap?.cellSize || b.cellSize || 64;

  const awareness = p.awareness ?? 0.5;
  const initiative = p.initiative ?? 0.5;
  const courage = p.courage ?? 0.5;

  // Use leader position for arrival check and bound origin — the leader is who
  // actually follows the waypoint. Squad center can be skewed by stuck/outlier units.
  const origin = leaderPos || squadCenter;

  // Check if we need a new bound (first call, or arrived at current target)
  const current = sgt._searchTarget;
  if (current && distTo(current, origin) > 80) {
    return current; // Still moving to current target
  }

  // Track bounds for adaptation — after several, widen search if nothing found
  const bounds = (sgt._searchBoundCount || 0) + 1;
  sgt._searchBoundCount = bounds;
  const adaptAfter = Math.round(2 + (1 - awareness) * 3); // 2 (aware) to 5 (clueless)
  const adapting = bounds > adaptAfter;

  // After adapting threshold: switch to systematic map sweep
  // instead of rotating around the suspected enemy zone
  if (adapting) {
    const sweepTarget = _pickSweepWaypoint(b, sgt, origin);
    sgt._searchTarget = sweepTarget;
    return sweepTarget;
  }

  // Bound distance: initiative controls how far we leap (150-400px)
  const boundDist = 150 + initiative * 250;

  // Direction toward suspected enemy, with awareness-driven accuracy
  let dirX, dirY;
  const toEnemyDist = Math.hypot(enemy.x - origin.x, enemy.y - origin.y);
  if (toEnemyDist > 10) {
    dirX = (enemy.x - origin.x) / toEnemyDist;
    dirY = (enemy.y - origin.y) / toEnemyDist;
  } else {
    dirX = 0; dirY = -1; // Default: advance north
  }

  // Normal: awareness controls angular spread (0 = ±45°, 1 = ±5°)
  const spreadAngle = (1 - awareness) * 0.8; // radians: 0 to ~45°

  // Apply spread
  const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 2 * spreadAngle;
  const rawX = origin.x + Math.cos(angle) * boundDist;
  const rawY = origin.y + Math.sin(angle) * boundDist;

  // Clamp to map
  const targetX = Math.max(margin, Math.min(mapW - margin, rawX));
  const targetY = Math.max(margin, Math.min(mapH - margin, rawY));

  // Courage determines: snap to cover near the target, or go direct?
  // Low courage → find cover near the target point to bound to
  // High courage → rush straight to the raw position
  let finalPos = { x: targetX, y: targetY };

  if (courage < 0.7) {
    const coverPos = _findCoverNear(b, targetX, targetY, cellSize,
      Math.cos(angle), Math.sin(angle), courage, mapW, mapH);
    if (coverPos) {
      finalPos = coverPos;
    }
  }

  sgt._searchTarget = finalPos;
  return finalPos;
}

/**
 * Find the best cover position near (cx, cy).
 * Courage biases: brave → forward of point, cautious → best cover quality.
 * Uses TERRAIN_COVER_SCORE from terrain-utils.js.
 */
function _findCoverNear(b, cx, cy, cellSize, dirX, dirY, courage, mapW, mapH) {
  const searchR = 3;
  const col = Math.floor(cx / cellSize);
  const row = Math.floor(cy / cellSize);

  let bestPos = null;
  let bestScore = -Infinity;

  for (let dr = -searchR; dr <= searchR; dr++) {
    for (let dc = -searchR; dc <= searchR; dc++) {
      const px = (col + dc + 0.5) * cellSize;
      const py = (row + dr + 0.5) * cellSize;
      if (px < 0 || px > mapW || py < 0 || py > mapH) continue;
      if (isTerrainBlocked(b, px, py)) continue;

      const terrain = getTerrainAt(b, px, py);
      const cover = TERRAIN_COVER_SCORE[terrain] || 0;
      if (cover < 10) continue;

      const dist = Math.hypot(px - cx, py - cy);
      if (dist > searchR * cellSize) continue;

      let score = cover * 0.5;
      score += (1 - dist / (searchR * cellSize)) * 10;
      // Forward bias scaled by courage
      if (dist > 0) {
        const dot = ((px - cx) * dirX + (py - cy) * dirY) / dist;
        score += dot * (5 + courage * 15);
      }

      if (score > bestScore) {
        bestScore = score;
        bestPos = { x: px, y: py };
      }
    }
  }

  return bestPos;
}

// ═══════════════════════════════════════════════════════════════
// PHASE EXECUTION — issues commands, sets waypoints/formations
// ═══════════════════════════════════════════════════════════════

/**
 * Pick offensive command based on SGT discipline + situation.
 * Disciplined SGTs call FOCUS_FIRE to concentrate firepower.
 * Mop-up (few enemies) always focuses regardless of discipline.
 */
function _pickOffensiveCommand(sgt, sitrep) {
  const discipline = sgt.personality.discipline ?? 0.5;
  const enemiesAlive = sitrep.enemyAliveCount || 0;

  // Mop-up: always focus fire on remaining enemies
  if (enemiesAlive > 0 && enemiesAlive <= 3) return Command.FOCUS_FIRE;

  // Disciplined SGT: coordinate fire
  if (discipline > 0.5) return Command.FOCUS_FIRE;

  // Undisciplined: units pick own targets
  return Command.ADVANCE;
}

/**
 * Determine movement posture for current phase + personality.
 * Sets sgt._movementPosture which propagates to unit scoring.
 */
function _setMovementPosture(sgt, phase) {
  const p = sgt.personality;
  let posture = 'normal';

  switch (phase) {
    case Phase.SEARCH:    posture = (p.aggression ?? 0.5) > 0.6 ? 'normal' : 'bound'; break;
    case Phase.CONTACT:   posture = (p.aggression ?? 0.5) > 0.7 ? 'normal' : 'bound'; break;
    case Phase.ENGAGE:    posture = (p.patience ?? 0.5) > 0.6 ? 'bound' : 'normal'; break;
    case Phase.PRESS:     posture = (p.courage ?? 0.5) < 0.4 ? 'normal' : 'rush'; break;
    case Phase.PURSUE:    posture = (p.patience ?? 0.5) > 0.6 ? 'normal' : 'rush'; break;
    case Phase.FLANK:     posture = (p.aggression ?? 0.5) > 0.7 ? 'rush' : 'bound'; break;
    case Phase.DISENGAGE: posture = (p.discipline ?? 0.5) > 0.6 ? 'bound' : 'rush'; break;
    case Phase.REGROUP:   posture = (p.discipline ?? 0.5) > 0.6 ? 'bound' : 'normal'; break;
    case Phase.AMBUSH:    posture = 'bound'; break;
    case Phase.HOLD:      posture = (p.patience ?? 0.5) > 0.6 ? 'bound' : 'normal'; break;
  }

  sgt._movementPosture = posture;
}

function executePhase(b, sgt, sitrep, alive, now, phaseChanged) {
  const p = sgt.personality;

  // Set movement posture for this phase (propagates to unit scoring)
  _setMovementPosture(sgt, sgt.phase);

  // Propagate SGT posture to all alive squad members
  for (const u of alive) {
    u._sgtPosture = sgt._movementPosture;
  }

  switch (sgt.phase) {
    case Phase.SEARCH: {
      const leaderPos = getSquadLeaderPos(alive, sitrep.center);

      // ADVANCE_TO objective: go directly to target position (no canvassing)
      if (sgt.objective?.type === Objective.ADVANCE_TO && sgt.objective.position && !sgt.objective.reached) {
        setPathWaypoint(b, sgt, sgt.objective.position, alive, sitrep.center);
      }
      // If enemies spotted, go straight to them
      else if (sitrep.enemyCenter?.x != null && sitrep.enemyAliveCount > 0 && sitrep.spotted) {
        setPathWaypoint(b, sgt, sitrep.enemyCenter, alive, sitrep.center);
        sgt._searchTarget = null; // Clear bound — we found them
        // Update last known position so search heads here if contact is lost
        sgt.enemyZone = { x: sitrep.enemyCenter.x, y: sitrep.enemyCenter.y };
      } else if (sitrep.underFire && sitrep.enemyCenter?.x != null) {
        // Taking fire but can't see them — update suspected enemy position
        if ((p.awareness ?? 0.5) > 0.3) {
          sgt.enemyZone = { x: sitrep.enemyCenter.x, y: sitrep.enemyCenter.y };
          sgt._searchTarget = null; // Force new bound toward threat
          sgt._searchBoundCount = 0;
        }
        const wp = pickSearchBound(b, sgt, sitrep.center, leaderPos);
        setPathWaypoint(b, sgt, wp, alive, sitrep.center);
      } else {
        // Pick next bound toward suspected enemy
        if (phaseChanged) {
          sgt._searchTarget = null;
          sgt._searchBoundCount = 0;
        }
        const wp = pickSearchBound(b, sgt, sitrep.center, leaderPos);
        setPathWaypoint(b, sgt, wp, alive, sitrep.center);
      }
      setCommand(sgt, alive, Command.ADVANCE);
      if (phaseChanged) sgt._formationOverride = Formation.WEDGE;
      break;
    }

    case Phase.CONTACT: {
      // Hold and assess
      if (phaseChanged) {
        setCommand(sgt, alive, Command.HOLD);
        sgt._formationOverride = Formation.LINE;
      }
      break;
    }

    case Phase.ENGAGE: {
      // Fight from current position — discipline-driven focus fire
      const closeRange = sitrep.distToEnemy < (sitrep.maxRange || 400) * 0.5;
      const engageCmd = _pickOffensiveCommand(sgt, sitrep);
      // If not focusing fire, use positional command (close → advance, far → hold)
      setCommand(sgt, alive, engageCmd === Command.FOCUS_FIRE ? engageCmd : (closeRange ? Command.ADVANCE : Command.HOLD));
      if (phaseChanged) sgt._formationOverride = Formation.LINE;
      if (closeRange && sitrep.enemyCenter) {
        setPathWaypoint(b, sgt, sitrep.enemyCenter, alive, sitrep.center);
      }
      break;
    }

    case Phase.PRESS: {
      // Push toward enemy aggressively — disciplined SGTs focus fire while pressing
      if (sitrep.enemyCenter) {
        setPathWaypoint(b, sgt, sitrep.enemyCenter, alive, sitrep.center);
      }
      setCommand(sgt, alive, _pickOffensiveCommand(sgt, sitrep));
      if (phaseChanged) sgt._formationOverride = Formation.WEDGE;
      break;
    }

    case Phase.PURSUE: {
      // Chase retreating enemy — focus fire to finish them off
      if (sitrep.enemyCenter) {
        setPathWaypoint(b, sgt, sitrep.enemyCenter, alive, sitrep.center);
      }
      setCommand(sgt, alive, _pickOffensiveCommand(sgt, sitrep));
      if (phaseChanged) sgt._formationOverride = Formation.COLUMN;
      break;
    }

    case Phase.DISENGAGE: {
      // Pull back to rally point — clamped to map bounds (never off-map)
      if (phaseChanged) {
        const margin = 100;
        const rallyX = Math.max(margin, Math.min(b.mapWidth - margin, sgt.spawnZone.x));
        const rallyY = Math.max(margin, Math.min(b.mapHeight - margin, sgt.spawnZone.y));
        sgt.rallyPoint = { x: rallyX, y: rallyY };
        setPathWaypoint(b, sgt, sgt.rallyPoint, alive, sitrep.center);
        sgt._formationOverride = Formation.COLUMN;
      }

      // If squad reached the rally point (within 150px of map edge), cornered behavior:
      // Courageous units charge, cautious units dig in
      const distToRally = distTo(sitrep.center, sgt.rallyPoint || sgt.spawnZone);
      if (distToRally < 100) {
        const courage = p.courage ?? 0.5;
        if (courage > 0.6) {
          // Desperate charge — switch to PRESS (offensive)
          setCommand(sgt, alive, Command.ADVANCE);
          if (sitrep.enemyCenter) setPathWaypoint(b, sgt, sitrep.enemyCenter, alive, sitrep.center);
        } else {
          // Find cover and fight — hold position
          setCommand(sgt, alive, Command.HOLD);
        }
      } else {
        setCommand(sgt, alive, Command.FALL_BACK);
      }
      break;
    }

    case Phase.REGROUP: {
      // Hold at rally and reform
      setCommand(sgt, alive, Command.HOLD);
      if (phaseChanged) sgt._formationOverride = Formation.LINE;
      break;
    }

    case Phase.AMBUSH: {
      // Hold position, don't fire (units check sgt phase for fire permission)
      setCommand(sgt, alive, Command.HOLD);
      if (phaseChanged) {
        sgt._formationOverride = Formation.LINE;
        sgt._ambushSet = now;
        sgt._ambushHoldFire = true;
      }
      // Check trigger conditions
      const patienceLimit = 5000 + p.patience * 15000; // 5-20 seconds
      const inKillZone = sitrep.distToEnemy < (sitrep.maxRange || 400) * 0.6;
      const coverBlown = sitrep.underFire;
      const patienceExpired = (now - (sgt._ambushSet || now)) > patienceLimit;
      if (inKillZone || coverBlown || patienceExpired) {
        sgt._ambushTriggered = true;
        // Scoring will pick ENGAGE on next tick due to inContact scoring
      }
      break;
    }

    case Phase.FLANK: {
      // Maneuver around enemy — issue FLANK_LEFT or FLANK_RIGHT based on flank side
      // Only compute flank point on phase entry, then use raw waypoint (no A* for short moves)
      if (phaseChanged && sitrep.enemyCenter) {
        const flankPt = computeFlankPoint(b, sgt, sitrep);
        if (flankPt) {
          // Skip A* for flank — just set raw waypoint. Flank distances are short (200-350px).
          sgt.waypoint = { x: flankPt.x, y: flankPt.y };
          setTeamWaypoint(b, sgt, sgt.waypoint);
          sgt._flankSide = flankPt.side || 'left';
        }
      }
      // Don't re-pathfind on subsequent evals — hold the flank waypoint
      const flankCmd = sgt._flankSide === 'right' ? Command.FLANK_RIGHT : Command.FLANK_LEFT;
      setCommand(sgt, alive, flankCmd);
      if (phaseChanged) sgt._formationOverride = Formation.COLUMN;
      break;
    }

    case Phase.HOLD: {
      // Dig in at current position
      setCommand(sgt, alive, Command.HOLD);
      if (phaseChanged) sgt._formationOverride = Formation.LINE;
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — command/formation/waypoint management
// ═══════════════════════════════════════════════════════════════

function setCommand(sgt, alive, command) {
  if (command === sgt._lastCommand) return;
  sgt._lastCommand = command;
  issueCommand(alive, command);
}

export function setTeamWaypoint(b, sgt, wp) {
  if (!b._teamWaypoints) b._teamWaypoints = {};
  if (!b._squadWaypoints) b._squadWaypoints = {};
  const point = { x: wp.x, y: wp.y };
  if (sgt.squadId != null) b._squadWaypoints[sgt.squadId] = point;
  b._teamWaypoints[sgt.teamKey] = point; // backwards compat
}

// ── Pathfinding ──────────────────────────────────────────────

function computePath(b, sgt, from, to, alive) {
  // Determine unit category from the heaviest unit in the squad
  const category = getSquadCategory(alive);

  // Clamp pathfinding goal to SGT's effective vision range (no point pathfinding beyond what we can see)
  const maxPathDist = 800; // Don't pathfind further than this
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let goalX = to.x, goalY = to.y;
  if (dist > maxPathDist) {
    goalX = from.x + (dx / dist) * maxPathDist;
    goalY = from.y + (dy / dist) * maxPathDist;
  }

  const path = findPathWorld(b, from.x, from.y, goalX, goalY, {
    category,
    maxIterations: 800
  });

  if (path && path.length > 0) {
    sgt.path = path;
    sgt.pathIndex = 0;
    sgt.pathGoal = { x: to.x, y: to.y };
  }
}

function advancePath(sgt, center) {
  if (!sgt.path || sgt.path.length === 0) {
    return null;
  }

  // Advance path index when we're close to current waypoint
  while (sgt.pathIndex < sgt.path.length - 1) {
    const wp = sgt.path[sgt.pathIndex];
    if (distTo(center, wp) < 80) {
      sgt.pathIndex++;
    } else {
      break;
    }
  }

  return sgt.path[Math.min(sgt.pathIndex, sgt.path.length - 1)];
}

/**
 * Path-aware waypoint setter.
 * Computes an A* path from squad center to target, then sets the waypoint
 * to the next node along that path. This routes squads around water/obstacles
 * instead of sending them directly into impassable terrain.
 *
 * Falls back to raw target if no terrainMap or pathfinding fails.
 */
function setPathWaypoint(b, sgt, target, alive, center) {
  if (!b.terrainMap || !target) {
    // No terrain data — set raw waypoint
    sgt.waypoint = target;
    if (target) setTeamWaypoint(b, sgt, target);
    return;
  }

  // Recompute path only if goal moved significantly AND enough time has passed
  const goalDist = sgt.pathGoal
    ? Math.hypot(target.x - sgt.pathGoal.x, target.y - sgt.pathGoal.y)
    : Infinity;
  const pathAge = Date.now() - (sgt._pathComputeTime || 0);
  const needsRecompute = !sgt.pathGoal || (goalDist > 200 && pathAge > 3000);

  if (needsRecompute) {
    computePath(b, sgt, center, target, alive);
    sgt._pathComputeTime = Date.now();
  }

  // Advance along the path
  const nextWp = advancePath(sgt, center);
  if (nextWp) {
    sgt.waypoint = nextWp;
    setTeamWaypoint(b, sgt, nextWp);
  } else {
    // Path failed — fall back to raw target
    sgt.waypoint = target;
    setTeamWaypoint(b, sgt, target);
  }
}

function getSquadCategory(alive) {
  // Return the most restrictive category (heaviest vehicle determines water passability)
  let heaviest = 'infantry';
  const WEIGHT = { infantry: 0, light_vehicle: 1, medium_tank: 2, heavy_tank: 3 };
  for (const u of alive) {
    const cat = u.category || 'infantry';
    if ((WEIGHT[cat] ?? 0) > (WEIGHT[heaviest] ?? 0)) {
      heaviest = cat;
    }
  }
  return heaviest;
}

// ── Flanking ─────────────────────────────────────────────────

function computeFlankPoint(b, sgt, sitrep) {
  const cx = sitrep.center.x;
  const cy = sitrep.center.y;
  const ex = sitrep.enemyCenter.x;
  const ey = sitrep.enemyCenter.y;

  // Bearing to enemy
  const bearing = Math.atan2(ey - cy, ex - cx);

  // Perpendicular directions (left and right)
  const flankDist = 200 + sgt.personality.initiative * 150; // 200–350px offset

  const leftPoint = {
    x: (cx + ex) / 2 + Math.cos(bearing - Math.PI / 2) * flankDist,
    y: (cy + ey) / 2 + Math.sin(bearing - Math.PI / 2) * flankDist,
    side: 'left'
  };
  const rightPoint = {
    x: (cx + ex) / 2 + Math.cos(bearing + Math.PI / 2) * flankDist,
    y: (cy + ey) / 2 + Math.sin(bearing + Math.PI / 2) * flankDist,
    side: 'right'
  };

  // Clamp to map bounds
  const mw = b.mapWidth || 1792;
  const mh = b.mapHeight || 1792;
  clampPoint(leftPoint, mw, mh);
  clampPoint(rightPoint, mw, mh);

  // Pick the side with better cover
  const leftCover = sampleCover(b, leftPoint);
  const rightCover = sampleCover(b, rightPoint);

  return leftCover >= rightCover ? leftPoint : rightPoint;
}

function sampleCover(b, point) {
  const terrain = getTerrainAt(b, point.x, point.y);
  return TERRAIN_COVER_SCORE[terrain] ?? 0;
}

function clampPoint(pt, mapW, mapH) {
  const margin = 64;
  pt.x = Math.max(margin, Math.min(mapW - margin, pt.x));
  pt.y = Math.max(margin, Math.min(mapH - margin, pt.y));
}

// ── Logging ──────────────────────────────────────────────────

function logPhase(b, sgt, sitrep, action, detail) {
  const leader = sitrep.alive[0];
  if (!leader) return;

  logEvent(b, {
    t: Date.now(),
    who: `sgt-${sgt.teamKey}`,
    team: sgt.teamKey,
    type: 'sergeant',
    x: Math.round(sitrep.center.x),
    y: Math.round(sitrep.center.y),
    action,
    detail: `[${sgt.phase}] ${detail} | alive:${sitrep.aliveCount}/${sitrep.total} enemy:${sitrep.enemyAliveCount}/${sitrep.enemyTotal}`
  });
}
