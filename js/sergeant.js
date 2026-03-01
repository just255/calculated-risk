// ═══════════════════════════════════════════════════════════════
// SERGEANT — Team-level AI commander
//
// State machine that issues commands, sets waypoints, and chooses
// formations for an entire team. Runs BEFORE formations and brains
// so units execute the sergeant's orders on the same frame.
//
// Phases: MARCH → CONTACT → ENGAGE → PRESS / FALLBACK → REGROUP
// ═══════════════════════════════════════════════════════════════

import { Command, issueCommand } from './ai.js';
import { Formation } from './constants.js';
import { findPathWorld } from './pathfinding.js';
import { getTerrainAt, TERRAIN_COVER_SCORE } from './terrain-utils.js';

// ── Phase constants ─────────────────────────────────────────

export const Phase = {
  MARCH:    'march',
  CONTACT:  'contact',
  ENGAGE:   'engage',
  PRESS:    'press',
  FALLBACK: 'fallback',
  REGROUP:  'regroup'
};

// ── Personality-driven speech callouts ────────────────────────
// Three flavors: aggressive (high aggression/courage), disciplined
// (high discipline), and casual (everyone else).
// Custom callouts can override via sgt.callouts = { phase: {...}, command: {...} }

const PHASE_CALLOUTS = {
  march: {
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
  fallback: {
    aggressive: ['This ain\'t over!', 'We\'ll be back!', 'Pull back, damn it!', 'Regroup and hit \'em again!', 'Not like this!', 'Fall back!'],
    disciplined: ['Tactical withdrawal.', 'Break contact.', 'Disengage and withdraw.', 'Orderly retreat.', 'Fall back to rally point.', 'Retrograde movement.'],
    casual: ['Fall back!', 'Get out of there!', 'Pull back!', 'Too hot! Move!', 'We need to move!', 'Bug out!']
  },
  regroup: {
    aggressive: ['Get it together!', 'On me, now!', 'We\'re going again!', 'Shake it off!', 'Round two!', 'Reform and reload!'],
    disciplined: ['Rally point here.', 'Consolidate positions.', 'Reform formation.', 'Regroup and reassess.', 'All units, rally.', 'Hold and reorganize.'],
    casual: ['Regroup!', 'Rally on me!', 'Form up!', 'Everyone here!', 'Tighten up!', 'Hold here a sec.']
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
  if (b._debugLog) {
    b._debugLog.push({
      t: now, who: sgtUnitId, team: sgt.teamKey,
      type: 'speech', action: text, detail: `sgt-${sgt.teamKey}`
    });
  }
}

// ── Default sergeant personality ─────────────────────────────

export const DEFAULT_SERGEANT = {
  aggression:   0.5,  // 0 = cautious, 1 = reckless
  patience:     0.5,  // 0 = impatient, 1 = waits for perfect opportunity
  courage:      0.5,  // 0 = retreats early, 1 = fights to the last
  discipline:   0.5,  // 0 = loose control, 1 = tight formations
  initiative:   0.5,  // 0 = follows doctrine, 1 = improvises (flanking, etc.)
  awareness:    0.5   // 0 = slow to react, 1 = re-evaluates frequently
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
  return {
    teamKey,
    personality: { ...DEFAULT_SERGEANT, ...personality },
    phase: Phase.MARCH,
    prevPhase: null,

    // Timing
    lastEval: 0,
    phaseStartTime: 0,
    contactTime: 0,

    // Waypoints / path
    objective: { x: enemySpawnZone.x, y: enemySpawnZone.y },
    rallyPoint: { x: spawnZone.x, y: spawnZone.y },
    path: null,         // World-coordinate waypoints from A*
    pathIndex: 0,       // Current waypoint index
    pathGoal: null,     // { x, y } the path was computed toward

    // Last issued state — prevent command thrashing
    _lastCommand: null,
    _lastFormation: null,

    // Emergency re-eval: set to a timestamp to force early re-eval
    _emergencyReeval: 0,
    // Track alive count for automatic death detection
    _lastAliveCount: 0,

    // Situational awareness (refreshed each eval)
    sitrep: null,
    squadId: squadId ?? null
  };
}

// ═══════════════════════════════════════════════════════════════
// SITUATIONAL REPORT — computed each eval tick
// ═══════════════════════════════════════════════════════════════

function buildSitrep(b, sgt, friendlies, hostiles) {
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

  // Center of mass
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  if (aliveCount > 0) { cx /= aliveCount; cy /= aliveCount; }

  let ecx = 0, ecy = 0;
  for (const e of enemyAlive) { ecx += e.x; ecy += e.y; }
  if (enemyAliveCount > 0) { ecx /= enemyAliveCount; ecy /= enemyAliveCount; }

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

  // Under fire? Any unit has active shock timer (set on receiving damage)
  const underFire = alive.some(u => (u._shockTimer ?? 0) > 0);

  // Max weapon range across alive units
  const maxRange = alive.reduce((mx, u) => Math.max(mx, u.range ?? 400), 0);

  return {
    alive, enemyAlive, aliveCount, enemyAliveCount,
    total, enemyTotal, casualties, casualtyRate,
    enemyCasualties, enemyCasualtyRate,
    forceRatio, distToEnemy, spotted, underFire,
    avgMorale, avgSuppression, maxRange,
    center: { x: cx, y: cy },
    enemyCenter: { x: ecx, y: ecy }
  };
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
  const sitrep = buildSitrep(b, sgt, friendlies, hostiles);
  sgt.sitrep = sitrep;

  const prevPhase = sgt.phase;

  // ── Phase transitions ──────────────────────────────────────
  switch (sgt.phase) {
    case Phase.MARCH:
      if (sitrep.spotted || sitrep.underFire) {
        transition(sgt, Phase.CONTACT, now, b);
      }
      break;

    case Phase.CONTACT:
      // Give the sergeant a moment to assess (patience-driven)
      if (now - sgt.contactTime > contactDelay(sgt)) {
        // Engage when enemy is within weapon range (or we're taking fire)
        const engageRange = sitrep.maxRange * 1.2;
        if (sitrep.distToEnemy < engageRange || sitrep.underFire) {
          transition(sgt, Phase.ENGAGE, now, b);
        } else if (!sitrep.spotted && !sitrep.underFire) {
          // Lost contact — resume march
          transition(sgt, Phase.MARCH, now, b);
        }
      }
      break;

    case Phase.ENGAGE:
      if (shouldFallback(sgt, sitrep)) {
        transition(sgt, Phase.FALLBACK, now, b);
      } else if (shouldPress(sgt, sitrep)) {
        transition(sgt, Phase.PRESS, now, b);
      } else if (!sitrep.spotted && !sitrep.underFire && sitrep.distToEnemy > sitrep.maxRange * 1.5) {
        transition(sgt, Phase.MARCH, now, b);
      }
      break;

    case Phase.PRESS:
      if (shouldFallback(sgt, sitrep)) {
        transition(sgt, Phase.FALLBACK, now, b);
      } else if (sitrep.enemyAliveCount === 0) {
        transition(sgt, Phase.MARCH, now, b);
      }
      break;

    case Phase.FALLBACK:
      // Retreat until near rally point, then regroup
      if (distTo(sitrep.center, sgt.rallyPoint) < 150) {
        transition(sgt, Phase.REGROUP, now, b);
      } else if (sitrep.forceRatio > 1.5 && sitrep.avgMorale > 0.6) {
        // Recovered advantage — re-engage
        transition(sgt, Phase.ENGAGE, now, b);
      }
      break;

    case Phase.REGROUP:
      // Brief pause to reform, then re-engage
      if (now - sgt.phaseStartTime > regroupDuration(sgt)) {
        if (sitrep.enemyAliveCount > 0) {
          transition(sgt, Phase.MARCH, now, b);
        }
      }
      break;
  }

  // ── Execute phase actions ──────────────────────────────────
  const phaseChanged = sgt.phase !== prevPhase;
  executePhase(b, sgt, sitrep, alive, now, phaseChanged);
}

// ── Phase transition helper ──────────────────────────────────

function transition(sgt, newPhase, now, b) {
  sgt.prevPhase = sgt.phase;
  sgt.phase = newPhase;
  sgt.phaseStartTime = now;
  if (newPhase === Phase.CONTACT) sgt.contactTime = now;
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

// ── Decision helpers ─────────────────────────────────────────

function contactDelay(sgt) {
  // Patience: 0 → 500ms, 1 → 3000ms
  return 500 + sgt.personality.patience * 2500;
}

function regroupDuration(sgt) {
  // Discipline: 0 → 2s, 1 → 5s (disciplined sergeants wait for proper formation)
  return (2000 + sgt.personality.discipline * 3000);
}

function shouldFallback(sgt, sitrep) {
  const p = sgt.personality;

  // Courage threshold — at what casualty/morale level do we pull back?
  // Courageous sergeants fight through more losses
  const casualtyThreshold = 0.3 + p.courage * 0.4; // 0.3–0.7
  const moraleThreshold = 0.2 + (1 - p.courage) * 0.3; // 0.2–0.5

  if (sitrep.casualtyRate > casualtyThreshold) return true;
  if (sitrep.avgMorale < moraleThreshold) return true;
  if (sitrep.forceRatio < 0.3 && p.aggression < 0.8) return true;

  return false;
}

function shouldPress(sgt, sitrep) {
  const p = sgt.personality;

  // Aggressive sergeants press with smaller advantages
  const ratioNeeded = 1.5 - p.aggression * 0.5; // 1.0–1.5
  const casualtyAdvantage = sitrep.enemyCasualtyRate > sitrep.casualtyRate + 0.15;

  if (sitrep.forceRatio >= ratioNeeded) return true;
  if (casualtyAdvantage && p.aggression > 0.5) return true;

  return false;
}

function distTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ═══════════════════════════════════════════════════════════════
// PHASE EXECUTION — issues commands, sets waypoints/formations
// ═══════════════════════════════════════════════════════════════

function executePhase(b, sgt, sitrep, alive, now, phaseChanged) {
  const p = sgt.personality;
  const teamKey = sgt.teamKey; // 'blue' or 'red'

  switch (sgt.phase) {
    case Phase.MARCH:
      executeMarch(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
    case Phase.CONTACT:
      executeContact(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
    case Phase.ENGAGE:
      executeEngage(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
    case Phase.PRESS:
      executePress(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
    case Phase.FALLBACK:
      executeFallback(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
    case Phase.REGROUP:
      executeRegroup(b, sgt, sitrep, alive, teamKey, phaseChanged);
      break;
  }
}

// ── MARCH: Advance toward objective in wedge ─────────────────

function executeMarch(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  // Compute path to objective if we don't have one
  if (!sgt.path || phaseChanged) {
    computePath(b, sgt, sitrep.center, sgt.objective, alive);
  }

  // Set waypoint to current path waypoint
  const wp = advancePath(sgt, sitrep.center);
  setWaypoint(b, teamKey, wp);

  // Issue advance command in wedge formation
  setCommand(b, sgt, alive, Command.ADVANCE);
  setFormation(sgt, alive, Formation.WEDGE);

  logPhase(b, sgt, sitrep, 'march', `wp:(${Math.round(wp.x)},${Math.round(wp.y)}) pathIdx:${sgt.pathIndex}/${sgt.path?.length ?? 0}`);
}

// ── CONTACT: First engagement, personality-driven response ───

function executeContact(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  const p = sgt.personality;

  if (p.aggression > 0.7) {
    // Aggressive: push through, keep advancing
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, Formation.WEDGE);
    setWaypoint(b, teamKey, sitrep.enemyCenter);
  } else if (p.initiative > 0.6 && p.aggression > 0.4) {
    // Flanker: try to get to the side
    const flankWp = computeFlankPoint(b, sgt, sitrep);
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, flankWp.side === 'left' ? Formation.ECHELON_L : Formation.ECHELON_R);
    setWaypoint(b, teamKey, flankWp);
  } else if (sitrep.distToEnemy > sitrep.maxRange) {
    // Out of effective range — cautiously advance to engagement distance
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, Formation.LINE);
    setWaypoint(b, teamKey, sitrep.enemyCenter);
  } else {
    // In range — hold position and engage from here
    setCommand(b, sgt, alive, Command.HOLD);
    setFormation(sgt, alive, Formation.LINE);
    setWaypoint(b, teamKey, sitrep.center);
  }

  logPhase(b, sgt, sitrep, 'contact', `dist:${Math.round(sitrep.distToEnemy)} agg:${p.aggression.toFixed(1)} init:${p.initiative.toFixed(1)}`);
}

// ── ENGAGE: Active firefight, monitor and adapt ──────────────

function executeEngage(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  const p = sgt.personality;

  // Check for flanking opportunity
  if (p.initiative > 0.6 && p.aggression > 0.4 && sitrep.forceRatio > 0.8) {
    const flankWp = computeFlankPoint(b, sgt, sitrep);
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, flankWp.side === 'left' ? Formation.ECHELON_L : Formation.ECHELON_R);
    setWaypoint(b, teamKey, flankWp);
  } else if (p.aggression > 0.6 && sitrep.forceRatio > 1.0) {
    // Aggressive with advantage — push
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, Formation.WEDGE);
    setWaypoint(b, teamKey, sitrep.enemyCenter);
  } else if (sitrep.distToEnemy > sitrep.maxRange) {
    // Out of effective range — close to firing distance
    setCommand(b, sgt, alive, Command.ADVANCE);
    setFormation(sgt, alive, Formation.LINE);
    setWaypoint(b, teamKey, sitrep.enemyCenter);
  } else {
    // In range — disciplined engagement, hold and fire
    setCommand(b, sgt, alive, Command.HOLD);
    setFormation(sgt, alive, Formation.LINE);
    setWaypoint(b, teamKey, sitrep.center);
  }

  logPhase(b, sgt, sitrep, 'engage', `ratio:${sitrep.forceRatio.toFixed(1)} cas:${(sitrep.casualtyRate * 100).toFixed(0)}% ecas:${(sitrep.enemyCasualtyRate * 100).toFixed(0)}%`);
}

// ── PRESS: Winning — push toward remaining enemies ───────────

function executePress(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  setCommand(b, sgt, alive, Command.ADVANCE);
  setFormation(sgt, alive, Formation.WEDGE);
  setWaypoint(b, teamKey, sitrep.enemyCenter);

  logPhase(b, sgt, sitrep, 'press', `ratio:${sitrep.forceRatio.toFixed(1)} enemies:${sitrep.enemyAliveCount}`);
}

// ── FALLBACK: Losing — retreat to rally point ────────────────

function executeFallback(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  if (!sgt.path || phaseChanged) {
    computePath(b, sgt, sitrep.center, sgt.rallyPoint, alive);
  }

  const wp = advancePath(sgt, sitrep.center);
  setWaypoint(b, teamKey, wp);

  setCommand(b, sgt, alive, Command.FALL_BACK);
  setFormation(sgt, alive, Formation.COLUMN);

  logPhase(b, sgt, sitrep, 'fallback', `morale:${sitrep.avgMorale.toFixed(2)} cas:${(sitrep.casualtyRate * 100).toFixed(0)}%`);
}

// ── REGROUP: Reform before re-engaging ───────────────────────

function executeRegroup(b, sgt, sitrep, alive, teamKey, phaseChanged) {
  setCommand(b, sgt, alive, Command.FOLLOW);
  setFormation(sgt, alive, Formation.WEDGE);
  setWaypoint(b, teamKey, sgt.rallyPoint);

  logPhase(b, sgt, sitrep, 'regroup', `elapsed:${Math.round((Date.now() - sgt.phaseStartTime) / 1000)}s`);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — command/formation/waypoint management
// ═══════════════════════════════════════════════════════════════

function setCommand(b, sgt, alive, command) {
  if (command === sgt._lastCommand) return;
  sgt._lastCommand = command;
  issueCommand(alive, command);

  // Emit command callout (only if not already showing a phase transition bubble)
  // Check custom callouts first, fall back to defaults
  const custom = sgt.callouts?.command?.[command];
  const defaults = COMMAND_CALLOUTS[command];
  const text = pickCallout(custom || defaults, sgt.personality);
  if (text) {
    // Find sergeant unit and check if there's already a recent bubble from a phase transition
    const squad = b._squads?.find(sq => sq.sergeant === sgt);
    const sgtUnitId = squad?.sergeantUnitId;
    if (sgtUnitId) {
      const allUnits = [...(b.units || []), ...(b.enemies || [])];
      const sgtUnit = allUnits.find(u => u.id === sgtUnitId);
      if (sgtUnit && !sgtUnit.dead) {
        const existing = sgtUnit._speechBubble;
        // Don't overwrite a bubble that was set < 500ms ago (phase callouts take priority)
        const now = Date.now();
        if (!existing || now - existing.t > 500) {
          sgtUnit._speechBubble = { text, t: now };
          if (b._debugLog) {
            b._debugLog.push({
              t: now, who: sgtUnitId, team: sgt.teamKey,
              type: 'speech', action: text, detail: `sgt-${sgt.teamKey}`
            });
          }
        }
      }
    }
  }
}

function setFormation(sgt, alive, formation) {
  if (formation === sgt._lastFormation) return;
  sgt._lastFormation = formation;
  for (const u of alive) {
    u._formationOverride = formation;
  }
}

function setWaypoint(b, teamKey, wp) {
  if (!b._teamWaypoints) b._teamWaypoints = {};
  b._teamWaypoints[teamKey] = { x: wp.x, y: wp.y };
}

// ── Pathfinding ──────────────────────────────────────────────

function computePath(b, sgt, from, to, alive) {
  // Determine unit category from the heaviest unit in the squad
  const category = getSquadCategory(alive);

  const path = findPathWorld(b, from.x, from.y, to.x, to.y, {
    category,
    maxIterations: 3000
  });

  if (path && path.length > 0) {
    sgt.path = path;
    sgt.pathIndex = 0;
    sgt.pathGoal = { x: to.x, y: to.y };
  }
}

function advancePath(sgt, center) {
  if (!sgt.path || sgt.path.length === 0) {
    return sgt.objective;
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
  if (!b._debugLog) return;
  const leader = sitrep.alive[0];
  if (!leader) return;

  b._debugLog.push({
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
