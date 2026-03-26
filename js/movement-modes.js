// ═══════════════════════════════════════════════════════════════
// MOVEMENT MODES — Scoring, context building, mode resolution
// Pure computation — no side effects, no movement execution.
// Used by: ai.js (updateBrain calls buildMovementContext → resolveMovementMode)
// ═══════════════════════════════════════════════════════════════

import {
  getTerrainAt, TERRAIN_COVER_SCORE, getTerrainSpeedMod,
  getWaterDepth, findNearbyCoverPos, distanceBetween
} from './terrain-utils.js';

// ── Movement Mode Enum ────────────────────────────────────────

export const MovementMode = {
  PANIC_FLEE:      'panic_flee',
  URGENT_COVER:    'urgent_cover',
  SURVIVAL_ACTION: 'survival_action',
  TACTICAL_BOUND:  'tactical_bound',
  COMMAND_EXECUTE:  'command_execute',
  REGROUP:         'regroup'
};

// ── Threat-Based Speed ────────────────────────────────────────

/**
 * Compute threat-based speed modifier. Personality modulates the slowdown.
 * Call with the movement context built by buildMovementContext().
 */
export function computeThreatSpeed(unit, ctx) {
  if (!ctx) return 1.0;

  const { courage, aggression } = ctx.personality;

  // Rushing to cover — no speed bonus, just normal speed
  // Speed comes from unit stats only, not adrenaline
  if (unit._movementMode === 'urgent_cover') {
    return 1.0;
  }

  // No enemies spotted — full speed
  if (ctx.enemiesSpotted.length === 0) return 1.0;

  // Enemies spotted but not under fire — cautious
  if (!ctx.underFire) {
    return 0.85 + aggression * 0.1;
  }

  // Under fire, can see shooter — careful
  if (ctx.canSeeShooter) {
    return 0.70 + courage * 0.15;
  }

  // Suppressed — slow down significantly
  if (ctx.suppressionLevel > 0.3) {
    return 0.60 + ctx.personality.discipline * 0.1;
  }

  return 0.75;
}

// ── Movement Context Builder ──────────────────────────────────

/**
 * Build movement context — all situational data gathered once per brain tick.
 */
export function buildMovementContext(b, unit, target, targetDist, hostiles, friendlies, now, leader) {
  const p = unit.personality || {};
  const courage = p.courage ?? 0.5;
  const aggression = p.aggression ?? 0.5;
  const discipline = p.discipline ?? 0.5;
  const patience = p.patience ?? 0.5;
  const awareness = unit._awareness ?? 0.5;

  // Under fire: shock timer > 0 means recently hit
  const underFire = (unit._shockTimer ?? 0) > 0;

  // Recent damage: shock timer tells us how recently (starts at 2, decays per sec)
  const recentDamageTimeAgo = underFire ? (2 - (unit._shockTimer ?? 0)) * 1000 : Infinity;

  // Can see shooter: target is in our spotted list
  const spotted = unit._spotted || [];
  const canSeeShooter = target ? spotted.some(s => s.enemy === target) : false;

  // HP status
  const hpPercent = (unit.hp || 0) / (unit.maxHp || 100);

  // Suppression
  const suppressionLevel = unit._suppression ?? 0;

  // Formation status
  const inFormation = !!unit._inFormation && !!unit._slotTarget && unit !== unit._formationLeader;
  const formationIntact = !!unit._inFormation && !unit._formationBroken;

  // Command + commander (use string literal to avoid circular dep on Command enum)
  const command = unit.command || 'advance';
  const commanderAlive = leader ? !leader.dead : false;

  // Terrain at current position
  const terrain = getTerrainAt(b, unit.x, unit.y);
  const coverScore = TERRAIN_COVER_SCORE[terrain] || 0;
  const speedMod = getTerrainSpeedMod(b, unit.x, unit.y);
  const waterDepth = getWaterDepth(b, unit.x, unit.y);
  const inWater = !!waterDepth;

  // Nearest cover (cached to avoid scanning every frame)
  let nearestCover = null;
  if (coverScore < 15) {  // Not already in cover
    const searchRadius = Math.round(2 + awareness * 2);
    nearestCover = findNearbyCoverPos(b, unit, searchRadius, friendlies);
  }

  // Unit capabilities (inline — avoids circular dep on ai.js CATEGORY_SKILLS)
  const uid = unit.unitId || 'infantry';
  const canUseCover = (uid === 'infantry' || uid === 'medic' || uid === 'specops');

  // Friendlies nearby
  let friendliesNearby = 0;
  let nearestAllyDist = Infinity;
  let nearestAlly = null;
  for (const f of friendlies) {
    if (f === unit || f.dead) continue;
    const d = distanceBetween(unit, f);
    if (d < 120) friendliesNearby++;
    if (d < nearestAllyDist) { nearestAllyDist = d; nearestAlly = f; }
  }
  const isolated = friendliesNearby === 0;

  // Effective morale band (computed in updateBrain, cached on unit)
  const effectiveMorale = unit._effectiveMorale ?? 0.8;
  const routThreshold = unit._routThreshold ?? 0.15;
  const survivalThreshold = unit._survivalThreshold ?? 0.35;
  const obeyThreshold = unit._obeyThreshold ?? 0.50;
  const isRouted = !!unit._routed;

  // Sergeant movement posture (set by executePhase in sergeant.js)
  const sgtPosture = unit._sgtPosture || 'normal';

  return {
    target, targetDist,
    underFire, recentDamageTimeAgo, canSeeShooter,
    hpPercent, suppressionLevel,
    enemiesSpotted: spotted,
    inFormation, formationIntact,
    command, commanderAlive, leader,
    terrain, coverScore, speedMod,
    nearestCover,
    friendliesNearby, isolated,
    nearestAlly, nearestAllyDist,
    personality: { courage, aggression, discipline, patience, awareness },
    coverBias: unit._coverBias ?? 0.3,
    inCover: coverScore >= 15,
    canUseCover,
    inWater, waterDepth,
    effectiveMorale, routThreshold, survivalThreshold, obeyThreshold,
    isRouted, sgtPosture
  };
}

// ── Mode Scoring Functions ────────────────────────────────────

/**
 * Score how urgently the unit needs to rush to cover.
 * High when: under fire + can't see shooter + low HP + suppressed + defensive command
 * Low when: courageous + aggressive + offensive command
 * Command-aware: defensive commands boost cover, offensive commands reduce it.
 */
function scoreUrgentCover(unit, ctx) {
  let score = 0;
  const { courage, aggression } = ctx.personality;

  if (ctx.underFire && !ctx.canSeeShooter) score += 40;

  // HP threshold scales with courage — brave wait longer before seeking cover
  const coverHpThreshold = 0.2 + courage * 0.3;
  if (ctx.hpPercent < coverHpThreshold) score += 30;

  if (ctx.recentDamageTimeAgo < 1000) score += 20;
  score += ctx.suppressionLevel * 15;

  // Personality reduces urgency
  score -= courage * 20;
  score -= aggression * 10;

  // Command modifier — defensive posture values cover, offensive values engagement
  const cmd = ctx.command;
  if (cmd === 'hold' || cmd === 'fall_back' || cmd === 'cover_me') {
    score += 15;
  } else if (cmd === 'advance' || cmd === 'focus_fire') {
    score -= 20;
  }

  // Vehicles/tanks can't use cover (they use hull-down/concealment instead)
  // Only allow UCvr rush-to-cover for infantry units
  if (!ctx.canUseCover && !ctx.inCover) {
    score = Math.min(score, 0);
  }

  // Requires cover to exist nearby
  if (!ctx.nearestCover && !ctx.inCover) score = Math.min(score, 0);

  // Already in cover? Less urgent
  if (ctx.inCover) score -= 25;

  // Water: UCvr doesn't know how to exit water — it seeks cover.
  // Let the command executor handle water (moveBrainUnit has water avoidance steering).

  return Math.max(0, score);
}

/**
 * Score whether the unit should execute a survival action.
 * Band-gated: above obeyThreshold, survival is capped at 20 (orders dominate).
 * In the survival band, normal competition. Below routThreshold, survival dominates.
 */
function scoreSurvival(unit, ctx) {
  if (!ctx.target || ctx.target.dead) return 0;
  if (ctx.isRouted) return 70; // Routed units are pure survival

  const survival = unit._lastSurvival;
  if (!survival || !survival.inDanger) return 0;

  let score = 50;

  if (ctx.canSeeShooter) score += 20;
  score -= ctx.personality.courage * 15;
  if (ctx.inFormation && ctx.personality.discipline > 0.6) score -= 10;

  // Band-based gating: effectiveMorale suppresses survival when following orders
  const em = ctx.effectiveMorale;
  if (em > ctx.obeyThreshold) {
    // Above obey band — orders dominate, cap survival
    // Lerp cap from 20 (well above) to uncapped (at threshold)
    const t = Math.min((em - ctx.obeyThreshold) / 0.05, 1);
    const cap = 100 - t * 80; // 100 at threshold → 20 well above
    score = Math.min(score, cap);
  } else if (em < ctx.routThreshold) {
    // Below rout — survival dominates
    score += 20;
  }

  return Math.max(0, score);
}

/**
 * Score whether the unit should advance cover-to-cover (bounding).
 * High when: high cover bias + enemies spotted + patient
 * Low when: aggressive + no enemies spotted
 */
function scoreTacticalBound(unit, ctx) {
  // SGT posture override: rush = no bounding, bound = encourage bounding
  if (ctx.sgtPosture === 'rush') return 0;

  // Must have an objective to bound toward and some cover preference
  if (ctx.coverBias <= 0.2) return 0;
  const cmd = ctx.command;
  // Only bound on movement commands (string comparisons to avoid circular dep)
  if (cmd !== 'advance' && cmd !== 'follow' && cmd !== 'focus_fire' && cmd !== 'fall_back') return 0;

  let score = ctx.coverBias * 40;

  if (ctx.enemiesSpotted.length > 0) score += 20;
  score += ctx.personality.patience * 10;
  score -= ctx.personality.aggression * 25;

  // No enemies spotted = less reason to bound
  if (ctx.enemiesSpotted.length === 0) score -= 15;

  // In water — don't linger to bound, keep moving through
  if (ctx.inWater) score -= 20;

  // SGT posture: bound encourages tactical movement
  if (ctx.sgtPosture === 'bound') score += 20;

  return Math.max(0, score);
}

/**
 * Score whether the unit should directly execute its command.
 * Baseline mode — always available, boosted by discipline and valid commander.
 */
function scoreCommand(unit, ctx) {
  if (ctx.isRouted) return 0; // Routed units don't follow orders

  let score = 25;  // Baseline — orders matter

  if (ctx.commanderAlive) score += 15;
  score += ctx.personality.discipline * 10;

  // Under fire reduces willingness to just follow orders
  if (ctx.underFire) score -= 10;

  // Suppression makes advancing orders harder to follow
  score -= ctx.suppressionLevel * 10;

  // In water — don't stop to execute commands, push through
  if (ctx.inWater) score -= 15;

  // Band-based bonus: effectiveMorale above obeyThreshold = strong command authority
  const em = ctx.effectiveMorale;
  if (em > ctx.obeyThreshold) {
    // Lerp bonus from 0 (at threshold) to +30 (well above)
    const t = Math.min((em - ctx.obeyThreshold) / 0.05, 1);
    score += t * 30;
  } else if (em < ctx.survivalThreshold) {
    // Below survival band — commands lose authority
    const t = Math.min((ctx.survivalThreshold - em) / 0.10, 1);
    score -= t * 15;
  }

  return Math.max(0, score);
}

/**
 * Score whether the unit should fall back to regroup with allies.
 * High when: isolated + damaged + falling back
 * Low when: courageous + aggressive (lone wolves)
 */
function scoreRegroup(unit, ctx) {
  let score = 0;

  if (ctx.isolated) score += 30;
  if (ctx.command === 'fall_back') score += 20;
  if (ctx.hpPercent < 0.5) score += 15;
  score += ctx.personality.discipline * 10;

  score -= ctx.personality.courage * 15;
  score -= ctx.personality.aggression * 10;

  // Need allies to regroup with
  if (!ctx.nearestAlly) score = 0;

  return Math.max(0, score);
}

// ── Mode Resolution ───────────────────────────────────────────

/**
 * Resolve which movement mode wins this frame.
 * Evaluates all modes, returns the highest-scoring one.
 * Hysteresis: current mode gets a bonus to prevent frame-to-frame oscillation.
 */
export function resolveMovementMode(unit, ctx) {
  // Panic always wins — bypass scoring
  if (unit._panicking) {
    unit._coverTarget = null; // Panic breaks cover commitment
    unit._coverHolding = false;
    return { mode: MovementMode.PANIC_FLEE, score: 100 };
  }

  // Urgent cover latch — once committed to a cover position, finish the rush.
  // Clear latch when: arrived, threat resolved, or stuck too long.
  if (unit._coverTarget) {
    const atCover = distanceBetween(unit, unit._coverTarget) < 10;
    // Threat resolved: not under fire AND low suppression.
    // Don't require zero spotted enemies — seeing enemies from safety isn't urgent.
    const threatResolved = !ctx.underFire && ctx.suppressionLevel < 0.1;
    // Stuck detection: if unit hasn't made progress toward cover for 3s, abandon
    const stuckOnCover = (unit._coverStuckTime || 0) > 3;
    if (atCover) {
      // Arrived at cover — transition to cover hold (fire from cover until safe)
      unit._coverTarget = null;
      unit._coverHolding = true;
      unit._coverStuckTime = 0;
    } else if (threatResolved || stuckOnCover) {
      unit._coverTarget = null;
      unit._coverStuckTime = 0;
      // If stuck-abandoned, cooldown before trying a new cover target
      if (stuckOnCover) {
        unit._coverFailedUntil = Date.now() + 5000;
      }
    } else {
      // Still committed — urgent_cover wins, but compute other scores for logging
      const scores = {
        [MovementMode.URGENT_COVER]:    scoreUrgentCover(unit, ctx),
        [MovementMode.SURVIVAL_ACTION]: scoreSurvival(unit, ctx),
        [MovementMode.TACTICAL_BOUND]:  scoreTacticalBound(unit, ctx),
        [MovementMode.COMMAND_EXECUTE]: scoreCommand(unit, ctx),
        [MovementMode.REGROUP]:         scoreRegroup(unit, ctx)
      };
      scores[MovementMode.URGENT_COVER] = Math.max(scores[MovementMode.URGENT_COVER], 80);
      return { mode: MovementMode.URGENT_COVER, score: 80, scores };
    }
  }

  // Cover hold — unit arrived at cover, holds and fires until threat subsides
  if (unit._coverHolding) {
    const safeToMove = !ctx.underFire && ctx.suppressionLevel < 0.15;
    if (safeToMove) {
      unit._coverHolding = false;
    } else {
      // Stay in cover — execute command as "hold" from current position
      const scores = {
        [MovementMode.URGENT_COVER]:    scoreUrgentCover(unit, ctx),
        [MovementMode.SURVIVAL_ACTION]: scoreSurvival(unit, ctx),
        [MovementMode.TACTICAL_BOUND]:  scoreTacticalBound(unit, ctx),
        [MovementMode.COMMAND_EXECUTE]: scoreCommand(unit, ctx),
        [MovementMode.REGROUP]:         scoreRegroup(unit, ctx)
      };
      scores[MovementMode.COMMAND_EXECUTE] = Math.max(scores[MovementMode.COMMAND_EXECUTE], 60);
      return { mode: MovementMode.COMMAND_EXECUTE, score: 60, scores };
    }
  }

  const scores = {
    [MovementMode.URGENT_COVER]:    scoreUrgentCover(unit, ctx),
    [MovementMode.SURVIVAL_ACTION]: scoreSurvival(unit, ctx),
    [MovementMode.TACTICAL_BOUND]:  scoreTacticalBound(unit, ctx),
    [MovementMode.COMMAND_EXECUTE]: scoreCommand(unit, ctx),
    [MovementMode.REGROUP]:         scoreRegroup(unit, ctx)
  };

  // Hysteresis: current mode gets +15 bonus so a new mode must win convincingly
  const currentMode = unit._movementMode;
  if (currentMode && scores[currentMode] !== undefined) {
    scores[currentMode] += 15;
  }

  // Minimum mode duration: discipline-driven commitment prevents rapid oscillation
  // Units stay in their current mode for at least 1.5-3s before switching
  // Exception: urgent_cover and panic can always override (life-threatening)
  const discipline = ctx.personality?.discipline ?? 0.5;
  const minModeDuration = (1.5 + discipline * 1.5) * 1000; // 1.5-3.0s
  const modeAge = Date.now() - (unit._movementModeStart || 0);
  if (currentMode && modeAge < minModeDuration
      && currentMode !== MovementMode.PANIC_FLEE) {
    // Still in cooldown — only allow urgent_cover to override if score is very high
    const urgentScore = scores[MovementMode.URGENT_COVER] || 0;
    if (urgentScore < 60) {
      return { mode: currentMode, score: scores[currentMode] || 0, scores };
    }
  }

  // Find highest score
  let bestMode = MovementMode.COMMAND_EXECUTE;
  let bestScore = 0;
  for (const [mode, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestMode = mode;
    }
  }

  return { mode: bestMode, score: bestScore, scores };
}
