import { Team, UNITS, UNIT_TYPE_MAP } from './constants.js';

// Snapshot interval — 10 frames per second
const RECORD_INTERVAL = 100; // ms

/**
 * Create a recorder attached to a battle object.
 * Call once when battle starts.
 * @param {object} b - Battle object (has .units, .enemies, .terrainSeed, .mapWidth, .mapHeight, etc.)
 * @param {string} [mode] - Game mode label ('fire_range', 'campaign', 'endless')
 * @returns {object} Recorder state object
 */
export function createRecorder(b, mode) {
  const unitDefs = [];
  // Capture hero definition (endless/campaign)
  const hasHero = b.hero && !b.hero.observer;
  if (hasHero) {
    unitDefs.push({ id: 'hero', team: 'blue', unitId: b.hero.unitId, maxHp: b.hero.maxHp, isHero: true });
  }
  // Capture unit definitions for blue team
  if (b.units) {
    for (const u of b.units) {
      unitDefs.push({ id: u.id, team: 'blue', unitId: u.unitId, maxHp: u.maxHp, rank: u._rank ?? 0, insigniaSetId: u._insigniaSetId || null });
    }
  }
  // Capture unit definitions for red team
  if (b.enemies) {
    for (const e of b.enemies) {
      unitDefs.push({ id: e.id, team: 'red', unitId: e.unitId, maxHp: e.maxHp, rank: e._rank ?? 0, insigniaSetId: e._insigniaSetId || null });
    }
  }

  const recorder = {
    version: 2,
    mode: mode || (b.fireRange ? 'fire_range' : 'unknown'),
    seed: b.terrainSeed || null,
    mapWidth: b.mapWidth,
    mapHeight: b.mapHeight,
    terrainLabel: b.terrainLabel || '',
    blueSpawnZone: b.blueSpawnZone ? { x: b.blueSpawnZone.x, y: b.blueSpawnZone.y, radius: b.blueSpawnZone.radius } : null,
    redSpawnZone: b.redSpawnZone ? { x: b.redSpawnZone.x, y: b.redSpawnZone.y, radius: b.redSpawnZone.radius } : null,
    unitDefs,
    frames: [],
    _startTime: null,
    _lastFrameTime: 0,
    _active: true,
    _hasHero: hasHero
  };

  b._recorder = recorder;
  return recorder;
}

/**
 * Snapshot a single unit with full telemetry.
 */
function _snapshotUnit(u) {
  const snap = {
    x: Math.round(u.x),
    y: Math.round(u.y),
    ang: +((u.angle || 0).toFixed(2)),
    hull: +((u.hullAngle ?? u.angle ?? 0).toFixed(2)),
    hp: u.hp,
    dead: u.dead || false,
    anim: u.animId || null,
    st: u._dbg?.state || '',
    // Telemetry additions
    stab: +((u.stability ?? 0).toFixed(2)),
    sup: +((u._suppression ?? 0).toFixed(2)),
    mor: +((u.morale ?? 1).toFixed(2)),
    sqd: u._squadId ?? -1,
    cmd: u._dbg?.command || '',
    tgt: u._dbg?.targetId || '',
    slotDev: Math.round(u._dbg?.slotDev ?? 0),
    fmt: u._dbg?.formation || ''
  };
  return snap;
}

/**
 * Snapshot sergeant telemetry from all squads.
 * Only included when a sergeant has fresh telemetry (on eval tick, not every frame).
 */
function _snapshotSergeants(b, startTime) {
  if (!b._squads) return null;
  const sgts = [];
  for (const sq of b._squads) {
    const sgt = sq.sergeant;
    if (!sgt?._telemetry) continue;
    const tel = sgt._telemetry;
    // Only include if this telemetry is fresh (within this frame interval)
    sgts.push({
      sqId: sq.id,
      team: sq.team,
      ...tel,
      t: Math.round(tel.t - startTime)
    });
    sgt._telemetry = null; // Clear so we don't re-record
  }
  return sgts.length > 0 ? sgts : null;
}

/**
 * Record a frame snapshot. Call every frame — internally throttled to RECORD_INTERVAL.
 * @param {object} b - Battle object
 * @param {number} now - Current timestamp (Date.now())
 */
export function recordFrame(b, now) {
  const rec = b._recorder;
  if (!rec || !rec._active) return;

  // Set start time on first call
  if (rec._startTime === null) rec._startTime = now;

  // Throttle to 10fps
  if (now - rec._lastFrameTime < RECORD_INTERVAL) return;
  rec._lastFrameTime = now;

  const t = now - rec._startTime;

  // Snapshot hero (endless/campaign)
  let hero = null;
  if (rec._hasHero && b.hero) {
    hero = {
      x: Math.round(b.hero.x),
      y: Math.round(b.hero.y),
      ang: +((b.hero.angle || 0).toFixed(2)),
      hull: +((b.hero.hullAngle || 0).toFixed(2)),
      hp: b.hero.hp,
      dead: b.hero.dead || false,
      stab: +((b.hero.stability ?? 0).toFixed(2)),
      sup: +((b.hero._suppression ?? 0).toFixed(2))
    };
  }

  // Snapshot units (blue team)
  const units = [];
  if (b.units) {
    for (const u of b.units) {
      units.push(_snapshotUnit(u));
    }
  }

  // Snapshot enemies (red team)
  const enemies = [];
  if (b.enemies) {
    for (const e of b.enemies) {
      enemies.push(_snapshotUnit(e));
    }
  }

  // Snapshot projectiles
  const projectiles = [];
  if (b.projectiles) {
    for (const p of b.projectiles) {
      if (p.dead) continue;
      projectiles.push({
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        owner: p.owner || '',
        type: p.type || 'bullet'
      });
    }
  }

  const frameData = { t, units, enemies, projectiles };
  if (hero) frameData.hero = hero;

  // Sergeant telemetry (only present on eval ticks)
  const sgtSnap = _snapshotSergeants(b, rec._startTime);
  if (sgtSnap) frameData.sgts = sgtSnap;

  rec.frames.push(frameData);
}

// Tier values for weighting "punching above your weight" kills
const UNIT_TIER = {
  infantry: 1, medic: 1, specops: 1.5, stinger: 1.5,
  jeep: 2, humvee: 2, brdm: 2, fennek: 2,
  sherman: 3, tiger: 3, panzer4: 3, t34: 3, pershing: 3,
  leopard: 4, challenger: 4, t90: 4, abrams: 4, merkava: 4,
  maus: 5, tog2: 5, kv2: 5,
  helicopter: 3, drone: 2, howitzer: 3
};

/**
 * Get the tier of a unit (higher = heavier). Defaults to 2 for unknown units.
 */
function getTier(unitId) {
  return UNIT_TIER[unitId] || 2;
}

/**
 * Compute per-unit and per-team battle stats from the event log.
 * MVP uses contextual scoring that considers:
 *  - Damage share: % of team's total damage dealt by this unit
 *  - Kill weight: kills weighted by victim tier (killing a tank > killing infantry)
 *  - Punching up: bonus for kills on higher-tier enemies
 *  - Accuracy: efficiency under fire
 *  - Survival context: surviving matters more on the losing team
 *  - Team carry: bonus if you dealt a disproportionate share of your team's output
 */
function computeStats(b) {
  const log = b._debugLog || [];
  const unitMap = {};

  // Include hero in stats (same pipeline as regular units)
  if (b.hero && !b.hero.observer) {
    unitMap[b.hero.id] = {
      id: b.hero.id, team: 'blue', unitId: b.hero.unitId,
      kills: 0, damage: 0, shots: 0, hits: 0,
      alive: !b.hero.dead, maxHp: b.hero.maxHp || 200,
      killDetails: []
    };
  }
  for (const u of (b.units || [])) {
    unitMap[u.id] = {
      id: u.id, team: 'blue', unitId: u.unitId,
      kills: 0, damage: 0, shots: 0, hits: 0,
      alive: !u.dead, maxHp: u.maxHp || 100,
      killDetails: []
    };
  }
  for (const e of (b.enemies || [])) {
    unitMap[e.id] = {
      id: e.id, team: 'red', unitId: e.unitId,
      kills: 0, damage: 0, shots: 0, hits: 0,
      alive: !e.dead, maxHp: e.maxHp || 100,
      killDetails: []
    };
  }

  for (const ev of log) {
    const who = unitMap[ev.who];
    if (!who) continue;
    const isBlast = ev.detail?.includes('blast');
    if (ev.type === 'fire') who.shots++;
    else if (ev.type === 'hit') {
      if (!isBlast) who.hits++;  // Only direct hits count for accuracy
      who.damage += (ev.dmg || 0);
    }
    else if (ev.type === 'kill') {
      who.kills++;
      if (!isBlast) who.hits++;  // Direct kill = hit. Blast kill = bonus, not accuracy.
      who.damage += (ev.dmg || 0);
      const victim = unitMap[ev.target];
      if (victim) who.killDetails.push({ unitId: victim.unitId, tier: getTier(victim.unitId) });
    }
  }

  // Accumulate team totals (first pass)
  const blue = { kills: 0, damage: 0, shots: 0, hits: 0, survivors: 0, total: 0 };
  const red  = { kills: 0, damage: 0, shots: 0, hits: 0, survivors: 0, total: 0 };
  const units = Object.values(unitMap);

  for (const u of units) {
    u.accuracy = u.shots > 0 ? Math.round((u.hits / u.shots) * 100) : 0;
    const team = u.team === 'blue' ? blue : red;
    team.kills += u.kills; team.damage += u.damage;
    team.shots += u.shots; team.hits += u.hits;
    team.total++;
    if (u.alive) team.survivors++;
  }
  blue.accuracy = blue.shots > 0 ? Math.round((blue.hits / blue.shots) * 100) : 0;
  red.accuracy  = red.shots > 0  ? Math.round((red.hits / red.shots) * 100) : 0;

  // Determine battle outcome context
  const result = b.result || 'unknown';
  const blueWon = result === 'blue_wins' || result === 'victory';
  const redWon  = result === 'red_wins'  || result === 'defeat';

  // Second pass: contextual MVP scoring
  for (const u of units) {
    const myTeam = u.team === 'blue' ? blue : red;
    const myTier = getTier(u.unitId);
    const teamWon = (u.team === 'blue' && blueWon) || (u.team === 'red' && redWon);
    const teamLost = (u.team === 'blue' && redWon) || (u.team === 'red' && blueWon);

    // 1. Kill weight — kills scored by victim tier (killing heavy units scores higher)
    let killScore = 0;
    for (const k of u.killDetails) {
      const victimTier = k.tier;
      // Base: 20 per kill, scaled by victim tier
      let pts = 20 * victimTier;
      // Punching-up bonus: extra points for killing units above your tier
      if (victimTier > myTier) pts += 15 * (victimTier - myTier);
      killScore += pts;
    }

    // 2. Damage share — what % of team damage did this unit contribute
    const damageShare = myTeam.damage > 0 ? u.damage / myTeam.damage : 0;
    // 0-40 points based on share (carrying the team = high score)
    const damageShareScore = damageShare * 40;

    // 3. Team carry — bonus for dealing disproportionate damage
    //    If team has 6 units but you dealt 50% of damage, you carried
    const expectedShare = myTeam.total > 0 ? 1 / myTeam.total : 0;
    const carryMultiplier = expectedShare > 0 ? damageShare / expectedShare : 1;
    const carryScore = Math.max(0, (carryMultiplier - 1)) * 15; // 0-30 bonus

    // 4. Accuracy — efficiency points (0-15)
    const accuracyScore = u.accuracy * 0.15;

    // 5. Survival context — more valuable on losing team or as sole survivor
    let survivalScore = 0;
    if (u.alive) {
      survivalScore = 10; // base survival
      if (teamLost) survivalScore += 15; // surviving despite loss — notable
      if (myTeam.survivors === 1) survivalScore += 10; // sole survivor
    }

    // 6. Raw damage — small flat contribution so high-damage units aren't ignored
    const rawDamageScore = u.damage * 0.1;

    u.mvpScore = killScore + damageShareScore + carryScore + accuracyScore + survivalScore + rawDamageScore;

    // Clean up internal tracking before output
    delete u.killDetails;
  }

  // MVP = highest contextual score
  units.sort((a, b2) => b2.mvpScore - a.mvpScore);
  const mvp = units.length > 0 ? { id: units[0].id, score: Math.round(units[0].mvpScore) } : null;

  return { blue, red, units, mvp };
}

/**
 * Finalize the recording — stamp result, duration, compute stats, copy full event log.
 * @param {object} b - Battle object
 * @returns {object|null} Complete replay data ready to save, or null if no recorder
 */
export function finalizeRecording(b) {
  const rec = b._recorder;
  if (!rec) return null;

  rec._active = false;
  const startT = rec._startTime || 0;

  // Rebuild unitDefs from current battle state (captures dynamically spawned units)
  const unitDefs = [];
  if (b.hero && !b.hero.observer) {
    unitDefs.push({ id: 'hero', team: 'blue', unitId: b.hero.unitId, maxHp: b.hero.maxHp, isHero: true });
  }
  if (b.units) {
    for (const u of b.units) {
      unitDefs.push({ id: u.id, team: 'blue', unitId: u.unitId, maxHp: u.maxHp, rank: u._rank ?? 0, insigniaSetId: u._insigniaSetId || null });
    }
  }
  if (b.enemies) {
    for (const e of b.enemies) {
      unitDefs.push({ id: e.id, team: 'red', unitId: e.unitId, maxHp: e.maxHp, rank: e._rank ?? 0, insigniaSetId: e._insigniaSetId || null });
    }
  }

  // Full event log with relative timestamps
  const events = [];
  if (b._debugLog) {
    for (const ev of b._debugLog) {
      events.push({
        t: ev.t ? ev.t - startT : 0,
        who: ev.who || '',
        team: ev.team || '',
        type: ev.type || '',
        action: ev.action || '',
        target: ev.target || '',
        detail: ev.detail || '',
        dmg: ev.dmg || 0,
        source: ev.source || '',
        category: ev.category || '',
        severity: ev.severity || '',
        x: ev.x || 0,
        y: ev.y || 0,
        acc: ev.acc || 0
      });
    }
  }

  // Compute battle stats
  const stats = computeStats(b);

  // Capture perf snapshots if available
  const perfLog = b._perfLog && b._perfLog.length > 0 ? b._perfLog : undefined;

  return {
    version: rec.version,
    mode: rec.mode,
    seed: rec.seed,
    mapWidth: rec.mapWidth,
    mapHeight: rec.mapHeight,
    terrainLabel: rec.terrainLabel,
    result: b.result || 'unknown',
    duration: rec.frames.length > 0 ? rec.frames[rec.frames.length - 1].t / 1000 : 0,
    recordedAt: new Date().toISOString(),
    blueSpawnZone: rec.blueSpawnZone,
    redSpawnZone: rec.redSpawnZone,
    unitDefs,
    stats,
    perfLog,
    frames: rec.frames,
    events
  };
}

/**
 * Check if battle is currently recording.
 */
export function isRecording(b) {
  return !!(b._recorder && b._recorder._active);
}

/**
 * Finalize and upload the replay to the server.
 * No-op if not recording or already saved.
 * @param {object} b - Battle object
 */
export function saveReplay(b) {
  if (!b._recorder) { console.warn('[replay] No recorder on battle object'); return; }
  if (b._replaySaved) { console.warn('[replay] Already saved, skipping'); return; }
  b._replaySaved = true;
  const replay = finalizeRecording(b);
  if (!replay) { console.warn('[replay] finalizeRecording returned null'); return; }
  const body = JSON.stringify(replay);
  console.log(`[replay] Saving ${replay.mode} replay: ${replay.frames?.length} frames, ${(body.length / 1024 / 1024).toFixed(1)}MB`);
  fetch('/api/replays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
  .then(r => {
    if (!r.ok) { console.error(`[replay] Server error: ${r.status} ${r.statusText}`); return null; }
    return r.json();
  })
  .then(res => { if (res?.success) console.log('Replay saved:', res.name); else if (res) console.warn('[replay] Save failed:', res); })
  .catch(err => console.warn('[replay] Failed to save:', err));
}

/**
 * Save a mid-battle snapshot replay without stopping the recorder.
 * Marked with debugSave: true so it shows differently in the theater.
 * @param {object} b - Battle object
 * @returns {Promise<boolean>} true if saved successfully
 */
export function saveDebugReplay(b) {
  const rec = b._recorder;
  if (!rec) return Promise.resolve(false);

  // Build a snapshot of the current recording state
  const unitDefs = [];
  if (b.hero && !b.hero.observer) {
    unitDefs.push({ id: 'hero', team: 'blue', unitId: b.hero.unitId, maxHp: b.hero.maxHp, isHero: true });
  }
  if (b.units) {
    for (const u of b.units) {
      unitDefs.push({ id: u.id, team: 'blue', unitId: u.unitId, maxHp: u.maxHp, rank: u._rank ?? 0, insigniaSetId: u._insigniaSetId || null });
    }
  }
  if (b.enemies) {
    for (const e of b.enemies) {
      unitDefs.push({ id: e.id, team: 'red', unitId: e.unitId, maxHp: e.maxHp, rank: e._rank ?? 0, insigniaSetId: e._insigniaSetId || null });
    }
  }

  const startT = rec._startTime || 0;
  const events = [];
  if (b._debugLog) {
    for (const ev of b._debugLog) {
      events.push({
        t: ev.t ? ev.t - startT : 0,
        who: ev.who || '', team: ev.team || '', type: ev.type || '',
        action: ev.action || '', target: ev.target || '', detail: ev.detail || '',
        dmg: ev.dmg || 0,
        source: ev.source || '', category: ev.category || '', severity: ev.severity || '',
        x: ev.x || 0, y: ev.y || 0, acc: ev.acc || 0
      });
    }
  }

  const stats = computeStats(b);
  const replay = {
    version: rec.version,
    mode: rec.mode,
    seed: rec.seed,
    mapWidth: rec.mapWidth,
    mapHeight: rec.mapHeight,
    terrainLabel: rec.terrainLabel,
    result: b.result || 'in_progress',
    duration: rec.frames.length > 0 ? rec.frames[rec.frames.length - 1].t / 1000 : 0,
    recordedAt: new Date().toISOString(),
    debugSave: true,
    blueSpawnZone: rec.blueSpawnZone,
    redSpawnZone: rec.redSpawnZone,
    unitDefs,
    stats,
    frames: rec.frames.slice(),
    events
  };

  return fetch('/api/replays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(replay)
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) console.log('Debug replay saved:', res.name);
    return res.success;
  })
  .catch(err => { console.warn('Failed to save debug replay:', err); return false; });
}
