// ═══════════════════════════════════════════════════════════════
// MISSION - Scripted mission definitions and cinematic events
// ═══════════════════════════════════════════════════════════════

import { Game, newEndlessRun } from './state.js';
import { FIRST_MISSION, FIRST_MISSION_DIALOG, Team } from './constants.js';
import { createSoldier, generatePhysicals, saveRoster, createVehicle, equipSoldierStandardIssue } from './roster.js';
import { save } from './storage.js';
import { cameraSetZoomTarget, cameraUpdateTransition, cameraStartTransition, cameraIsTransitioning } from './camera.js';
import { radioMessage, setRadioObjective, setRadioFocus } from './radio-hud.js';

// ─── Mission launcher ────────────────────────────────────────

// ─── Mission definitions ─────────────────────────────────────

const MISSION_DEFS = {
  firstTime: {
    mode: 'endless',
    gridWidth: FIRST_MISSION.gridWidth,
    gridHeight: FIRST_MISSION.gridHeight,
    mapSize: 'small',
    startWave: 1,
    seed: 750569,           // Fixed seed for consistent terrain layout
    createRoster: true,     // Create a starter soldier if roster is empty
    reinforcements: true,   // Generate reinforcement soldiers
    isFirstRun: true,
    heroVehicle: 'infantry'
  }
  // Future: campaign missions, tutorial, etc.
  // ambush: { mode: 'campaign', gridWidth: 32, gridHeight: 48, ... }
};

/**
 * Launch a mission by ID. Sets up Game state and creates the run.
 * Caller should call goto(State.ENDLESS_BATTLE) after this returns.
 *
 * @param {string} missionId — key into MISSION_DEFS
 * @returns {object} { soldier, missionDef }
 */
export function launchMission(missionId) {
  const def = MISSION_DEFS[missionId];
  if (!def) throw new Error(`Unknown mission: ${missionId}`);

  // Prune orphan items from any prior mission attempt. Items whose assignedTo
  // points at a soldier no longer in roster are leftover from a prior launch
  // (failed attempts, retry-on-death paths, abandoned missions). They never
  // get cleaned up otherwise. This is the canonical gateway for all mission
  // launches — setup-deploy AND the in-mission retry path at game.js:2802
  // both pass through here. See ADR-0004 + Task #130.
  if (Game.armory?.items) {
    const rosterIds = new Set((Game.roster || []).map(s => s.id));
    Game.armory.items = Game.armory.items.filter(i => !i.assignedTo || rosterIds.has(i.assignedTo));
  }

  let soldier = null;

  // Create starter soldier if needed
  if (def.createRoster && (!Game.roster || Game.roster.length === 0)) {
    soldier = createSoldier({
      pool: 'infantry',
      role: 'rifleman',
      physicals: generatePhysicals('starter'),
      rankIndex: 0,
    });
    soldier.isPlayerCharacter = true;
    equipSoldierStandardIssue(soldier);
    Game.roster.push(soldier);
    save();
  } else {
    soldier = (Game.roster || []).find(s => s.status === 'active');
  }

  // Create the run
  Game.endless = newEndlessRun();
  Game.endless.wave = def.startWave || 1;
  Game.endless.mapSize = def.mapSize || 'small';
  Game.endless._record = true;

  // Use player-selected seed if available, otherwise mission default
  Game.endless.seed = Game._introSeed || def.seed || null;
  if (def.isFirstRun) Game.endless._isFirstRun = true;
  if (def.reinforcements) {
    Game.endless._reinforcements = generateMissionReinforcements();
    // Add reinforcement vehicles through the vehicle system
    if (!Game.vehicles) Game.vehicles = [];
    // Remove old reinforcement vehicles from previous runs
    Game.vehicles = Game.vehicles.filter(v => !v._isReinforcement);
    const reinfVehicles = [
      createVehicle('sherman', { name: 'Fury', _isReinforcement: true }),
      createVehicle('sherman', { name: 'Warhorse', _isReinforcement: true })
    ];
    for (const v of reinfVehicles) Game.vehicles.push(v);
  }
  if (def.gridWidth || def.gridHeight) {
    Game.endless._mapOverrides = { gridWidth: def.gridWidth, gridHeight: def.gridHeight };
  }

  Game.endless.loadout.vehicle = def.heroVehicle || 'infantry';

  // Auto-configure opsConfig with the hero
  if (soldier) {
    Game.endless._opsConfig = {
      heroUnit: soldier.id,
      squads: [{ units: [], vehicleId: null }],
      cmdOfficerId: null
    };
  }

  return { soldier, missionDef: def };
}

// Legacy alias
export function launchFirstTimeMission() { return launchMission('firstTime'); }

// ─── Mission state machine ───────────────────────────────────

/**
 * Initialize the first-time mission on a battle object.
 * Adds fog zones, dialog state, cutscene camera, and mission script.
 * Call after newEndlessBattle() creates the base battle.
 *
 * @param {object} b - Battle object from newEndlessBattle()
 */
export function initFirstTimeMission(b) {
  const cfg = FIRST_MISSION;
  const zonePixelHeight = cfg.zoneHeight * cfg.cellSize;

  // Fog zones — zone 1 visible, zones 2 and 3 fogged
  b._fogZones = [
    { id: 0, y: zonePixelHeight * 2, height: zonePixelHeight, revealed: true,  revealStartTime: null },  // Zone 1 (bottom)
    { id: 1, y: zonePixelHeight,     height: zonePixelHeight, revealed: false, revealStartTime: null },  // Zone 2 (middle)
    { id: 2, y: 0,                   height: zonePixelHeight, revealed: false, revealStartTime: null }   // Zone 3 (top)
  ];

  // Dialog state
  b._dialog = {
    lines: [],
    currentIndex: 0,
    active: false,
    paused: false,
    startTime: null
  };

  // Cutscene camera state
  b._cutscene = {
    waypoints: [],
    currentIndex: 0,
    startTime: null,
    active: false
  };

  // Mission script state
  b._mission = {
    phase: 'fadeIn',         // fadeIn → intro → wave1 → zone2reveal → wave2 → zone3reveal → wave3 → rescue → extraction
    currentWave: 0,
    waveKillsStart: 0,
    surgeSpawned: false,
    reinforcementsSpawned: false,
    warningTime: null,
    surgeTime: null,
    fadeStartTime: Date.now(),
    zonePixelHeight
  };

  // Restrict enemies to infantry-only for the tutorial
  b._allowedEnemyTypes = ['swarmer', 'grunt'];

  // Red commander: aggressive — hunt the player, don't retreat
  const redCmdr = b._teamCommanders?.red || b._teamCommanders?.['red'];
  if (redCmdr) {
    redCmdr.personality = {
      aggression: 0.9, patience: 0.2, courage: 0.9,
      discipline: 0.8, initiative: 0.8, adaptability: 0.4
    };
  }

  // Blue commander: high acumen for reliable intel during tutorial
  const blueCmdr = b._teamCommanders?.blue || b._teamCommanders?.['blue'];
  if (blueCmdr && blueCmdr.traits) {
    blueCmdr.traits.acumen = 0.9;
  }

  // Start with full black overlay
  b._fadeOverlay = { opacity: 1.0, fadeStartTime: Date.now(), fadeDuration: 2500 };

  // Camera starts clamped to zone 1
  b._cameraMaxY = 0; // Will be computed from revealed zones
  _updateCameraClamp(b);

  // Mark as mission battle
  b._isMission = true;
}

/**
 * Generate 5 reinforcement soldiers for the first-time mission.
 * Stored on Game.endless._reinforcements.
 */
export function generateMissionReinforcements() {
  const reinforcements = [];
  for (let i = 0; i < FIRST_MISSION.reinforcementCount; i++) {
    const soldier = createSoldier({
      pool: 'infantry',
      role: 'rifleman',
      physicals: generatePhysicals('starter'),
      personality: {
        aggression: 0.3 + Math.random() * 0.4,
        patience: 0.3 + Math.random() * 0.4,
        courage: 0.3 + Math.random() * 0.4,
        discipline: 0.3 + Math.random() * 0.4,
        initiative: 0.3 + Math.random() * 0.4,
        awareness: 0.3 + Math.random() * 0.4
      }
    });
    equipSoldierStandardIssue(soldier);
    reinforcements.push(soldier);
  }
  return reinforcements;
}

// ─── Dialog system ───────────────────────────────────────────

/**
 * Show a sequence of dialog lines.
 * @param {object} b - Battle object
 * @param {string} key - Key into FIRST_MISSION_DIALOG
 */
export function showDialog(b, key) {
  const lines = FIRST_MISSION_DIALOG[key];
  if (!lines || lines.length === 0) return;

  b._dialog = {
    lines: [...lines],
    currentIndex: 0,
    active: true,
    paused: lines[0].pauseGame || false,
    startTime: Date.now()
  };

  // Route all dialog lines to the radio HUD
  for (const line of lines) {
    const isRadio = line.type === 'radio';
    radioMessage({
      sender: isRadio ? 'cmd' : 'unit',
      name: isRadio ? 'HQ' : 'You',
      text: line.text,
      priority: key === 'wave3warning' ? 'critical' : 'normal'
    });
  }
}

/**
 * Advance to next dialog line (click-to-advance).
 * Returns true if dialog is still active, false if finished.
 */
export function advanceDialog(b) {
  if (!b._dialog?.active) return false;

  b._dialog.currentIndex++;
  if (b._dialog.currentIndex >= b._dialog.lines.length) {
    b._dialog.active = false;
    b._dialog.paused = false;
    return false;
  }

  const line = b._dialog.lines[b._dialog.currentIndex];
  b._dialog.paused = line.pauseGame || false;
  b._dialog.startTime = Date.now();
  return true;
}

/**
 * Get the current active dialog line, or null.
 */
export function getCurrentDialog(b) {
  if (!b._dialog?.active) return null;
  const line = b._dialog.lines[b._dialog.currentIndex];
  if (!line) return null;

  // For timed (non-paused) dialog, check if duration expired
  if (!line.pauseGame && line.duration) {
    if (Date.now() - b._dialog.startTime > line.duration) {
      advanceDialog(b);
      return getCurrentDialog(b); // Recurse to next line or null
    }
  }

  return line;
}

/**
 * Check if the game should be paused for dialog.
 */
export function isDialogPaused(b) {
  return b._dialog?.active && b._dialog.paused;
}

// ─── Cutscene camera ─────────────────────────────────────────

/**
 * Start a cutscene camera sequence. Delegates to camera transition system.
 * @param {object} b - Battle object
 * @param {Array} waypoints - [{ x, y, zoom, duration }]
 */
export function startCutscene(b, waypoints) {
  cameraStartTransition(b, waypoints);
}

/**
 * Update cutscene camera each frame. Returns true if cutscene is active.
 */
export function updateCutscene(b) {
  return cameraUpdateTransition(b);
}

/**
 * Check if a cutscene is currently running.
 */
export function isCutsceneActive(b) {
  return cameraIsTransitioning(b);
}

// ─── Fog zone management ─────────────────────────────────────

const FOG_REVEAL_DURATION = 1500; // ms for fog lift animation

/**
 * Reveal a fog zone by index.
 */
export function revealZone(b, zoneIndex) {
  const zone = b._fogZones?.[zoneIndex];
  if (!zone || zone.revealed) return;
  zone.revealed = true;
  zone.revealStartTime = Date.now();
  _updateCameraClamp(b);
}

/**
 * Get fog opacity for a zone (0 = clear, 1 = fully fogged).
 */
export function getZoneFogOpacity(zone) {
  if (zone.revealed) {
    if (!zone.revealStartTime) return 0;
    const elapsed = Date.now() - zone.revealStartTime;
    return Math.max(0, 1 - elapsed / FOG_REVEAL_DURATION);
  }
  return 1;
}

/**
 * Get all fog zones for rendering.
 */
export function getFogZones(b) {
  return b._fogZones || [];
}

/**
 * Update camera Y clamp based on revealed zones.
 */
function _updateCameraClamp(b) {
  if (!b._fogZones) return;
  // Find the highest (smallest Y) revealed zone
  let minY = b.mapHeight;
  for (const zone of b._fogZones) {
    if (zone.revealed && zone.y < minY) minY = zone.y;
  }
  b._cameraMinY = minY;
  b._heroMinY = minY; // Hero can walk to the actual zone edge
}

/**
 * Clamp camera to revealed zones only.
 */
export function clampCameraToRevealed(b, screenH) {
  if (b._cameraMinY !== undefined) {
    b.camera.y = Math.max(b._cameraMinY, b.camera.y);
  }
}

// ─── Mission per-frame update ─────────────────────────────────

/**
 * Single entry point for all per-frame mission logic.
 * Handles fade animation, dialog pause, cutscene, and script processing.
 * Returns true if the game loop should be blocked (paused/cutscene).
 *
 * @param {object} b - Battle object
 * @param {number} now - Current timestamp
 * @returns {boolean} True if game logic should be skipped this frame
 */
export function updateMissionFrame(b, now) {
  const m = b._mission;

  // ── Always run: animations that don't affect game logic ──
  cameraUpdateTransition(b);
  _updateFade(b, now);

  // ── Determine if game logic should be blocked this frame ──
  // FadeIn: block everything until fade completes
  if (m?.phase === 'fadeIn') {
    const fadeElapsed = now - m.fadeStartTime;
    if (fadeElapsed >= (b._fadeOverlay?.fadeDuration || 2500)) {
      if (b.hero) {
        b.hero._speechBubble = { text: "Where's my unit...? What happened?", t: now, persist: true };
      }
      b._missionWaitForClick = true;
      setMissionPhase(b, 'intro');
    }
    return true;
  }

  // Dialog/input wait: flag it but don't block (AI + enemies keep running)
  b._missionDialogActive = !!(isDialogPaused(b) || b._missionWaitForClick);

  return false;
}

function _updateFade(b, now) {
  if (!b._fadeOverlay) return;
  const elapsed = now - b._fadeOverlay.fadeStartTime;
  const t = Math.min(1, elapsed / b._fadeOverlay.fadeDuration);
  b._fadeOverlay.opacity = b._fadeOverlay.direction === 'out' ? Math.min(1, t) : Math.max(0, 1 - t);
}

// ─── Mission phase helpers ───────────────────────────────────

/**
 * Get the current mission phase.
 */
export function getMissionPhase(b) {
  return b._mission?.phase || null;
}

/**
 * Set the mission phase.
 */
export function setMissionPhase(b, phase) {
  if (b._mission) {
    b._mission.phase = phase;
    console.log(`[mission] Phase → ${phase}`);

    // Update radio HUD objective based on phase
    const objectives = {
      intro: 'Move north through enemy territory',
      wave1: 'Engage hostiles — clear the area',
      advance2: 'Push forward to next zone',
      wave2: 'Neutralize enemy contacts',
      advance3: 'Advance to final zone',
      wave3: 'Hold position — reinforcements inbound',
      wave3warning: 'Warning — multiple hostiles inbound',
      wave3surge: 'Survive the assault',
      wave3combined: 'Eliminate remaining hostiles',
      extraction: 'Mission complete — extract',
      complete: 'RTB — Return to base'
    };
    if (objectives[phase]) setRadioObjective(objectives[phase]);
  }
}

// ─── Mission script state machine ────────────────────────────

/**
 * Process the mission script each frame.
 * Called from updateEndlessBattle when b._isMission is true.
 * Handles phase transitions, dialog triggers, fog reveals, and wave spawning.
 *
 * @param {object} b - Battle object
 * @param {number} now - Current timestamp
 * @param {object} callbacks - { spawnWave, spawnSurge, spawnReinforcements }
 */
export function updateMissionScript(b, now, callbacks) {
  const m = b._mission;
  if (!m) return;

  const cfg = FIRST_MISSION;
  const waveKills = (Game.endless?.kills || 0) - m.waveKillsStart;

  switch (m.phase) {

    case 'fadeIn':
      // Handled by updateMissionFrame — this phase should not reach here
      break;

    case 'intro':
      // Waiting for player to click after seeing the thought bubble
      if (!b._missionWaitForClick) {
        // Click received — show second thought, then start wave
        if (!m._secondThought) {
          if (b.hero) {
            b.hero._speechBubble = { text: "Need to push north. Keep your eyes open...", t: now, persist: true };
          }
          b._missionWaitForClick = true;
          m._secondThought = true;
        } else {
          // All intro thoughts done — zoom out to normal and start wave 1
          cameraSetZoomTarget(b, 1.0, 1200);
          m.currentWave = 1;
          m.waveKillsStart = Game.endless?.kills || 0;
          setMissionPhase(b, 'wave1');
          if (callbacks.spawnWave) callbacks.spawnWave(1);
        }
      }
      break;

    case 'wave1':
      if (b.waveComplete) {
        b.waveComplete = false;
        m._savedZoom = b.camera.userZoom || 1;
        cameraSetZoomTarget(b, 1.5, 800);
        setMissionPhase(b, 'zone2reveal');
      }
      break;

    case 'zone2reveal':
      if (!b._missionWaitForClick) {
        if (!m._zone2DialogShown) {
          if (b.hero) b.hero._speechBubble = { text: "Clear. Need to push forward.", t: now, persist: true };
          b._missionWaitForClick = true;
          m._zone2DialogShown = true;
        } else {
          cameraSetZoomTarget(b, m._savedZoom || 1.0, 800);
          revealZone(b, 1);
          setMissionPhase(b, 'advance2');
        }
      }
      break;

    case 'advance2':
      if (b.hero && b.hero.y < m.zonePixelHeight * 2) {
        m.currentWave = 2;
        m.waveKillsStart = Game.endless?.kills || 0;
        setMissionPhase(b, 'wave2');
        if (callbacks.spawnWave) callbacks.spawnWave(2);
      }
      break;

    case 'wave2':
      if (b.waveComplete) {
        b.waveComplete = false;
        m._savedZoom = b.camera.userZoom || 1;
        cameraSetZoomTarget(b, 1.5, 800);
        setMissionPhase(b, 'zone3reveal');
      }
      break;

    case 'zone3reveal':
      if (!b._missionWaitForClick) {
        if (!m._zone3DialogShown) {
          if (b.hero) b.hero._speechBubble = { text: "Almost through. One more push.", t: now, persist: true };
          b._missionWaitForClick = true;
          m._zone3DialogShown = true;
        } else {
          cameraSetZoomTarget(b, m._savedZoom || 1.0, 800);
          revealZone(b, 2);
          setMissionPhase(b, 'advance3');
        }
      }
      break;

    case 'advance3':
      if (b.hero && b.hero.y < m.zonePixelHeight) {
        m.currentWave = 3;
        m.waveKillsStart = Game.endless?.kills || 0;
        setMissionPhase(b, 'wave3');
        if (callbacks.spawnWave) callbacks.spawnWave(3);
      }
      break;

    case 'wave3':
      // Spawn reinforcements when hero first spots a wave 3 enemy
      if (!m.reinforcementsSpawned && b.hero?._spotted?.length > 0) {
        m.reinforcementsSpawned = true;
        showDialog(b, 'reinforcements');
        if (callbacks.spawnReinforcements) callbacks.spawnReinforcements();
      }
      // Phase A: player gets kills, feels confident
      if (waveKills >= cfg.killThreshold && !m.warningTime) {
        m.warningTime = now;
        showDialog(b, 'wave3warning');
        setMissionPhase(b, 'wave3surge');
      }
      break;

    case 'wave3surge':
      // Wait for warning dialog/timer, then spawn surge
      if (!b._dialog?.active && !m.surgeSpawned && now - m.warningTime >= cfg.surgeDelay) {
        m.surgeSpawned = true;
        m.surgeTime = now;
        if (callbacks.spawnSurge) callbacks.spawnSurge();
      }
      // After surge, transition to combined phase (reinforcements already spawned on first contact)
      if (m.surgeSpawned && now - m.surgeTime >= cfg.reinfDelay) {
        setMissionPhase(b, 'wave3combined');
      }
      break;

    case 'wave3combined':
      // Wait for wave complete
      if (b.waveComplete) {
        b.waveComplete = false;
        // Freeze all AI — extraction cutscene takes over
        b._aiPaused = true;
        setMissionPhase(b, 'extraction');
      }
      break;

    case 'extraction': {
      // Determine squad outcome once
      if (!m._extStep) {
        const aliveAllies = (b.units || []).filter(u => !u.dead);
        const totalAllies = (b.units || []).length;
        const knockedOut = totalAllies - aliveAllies.length;

        if (knockedOut === 0 && totalAllies > 0) {
          m._extOutcome = 'all_alive';
        } else if (aliveAllies.length > 0) {
          m._extOutcome = 'some_down';
        } else {
          m._extOutcome = 'all_down';
        }

        m._extStep = 'hero_bubble';
        b._heroFrozen = true;

        // Zoom in on hero (camera already follows hero, just change zoom)
        cameraSetZoomTarget(b, 1.8, 800);

        // Hero's line depends on outcome
        const heroLine = m._extOutcome === 'all_alive'
          ? "Thought that was it for me."
          : m._extOutcome === 'some_down'
            ? "...they went down covering me."
            : "They're all down... every last one of them.";
        b.hero._speechBubble = { text: heroLine, t: now, persist: true };
        b._missionWaitForClick = true;
      }

      // Step 1: Space on hero bubble → branch by outcome
      if (m._extStep === 'hero_bubble' && !b._missionWaitForClick) {
        b.hero._speechBubble = null;

        if (m._extOutcome === 'all_down') {
          // All down: second hero line
          m._extStep = 'hero_resolve';
          b.hero._speechBubble = { text: "Hang tight, brothers. I'm getting you out of here.", t: now, persist: true };
          b._missionWaitForClick = true;
        } else {
          // All alive or some down: zoom to ally
          m._extStep = 'ally_bubble';
          const blueSquads = b._squads?.filter(sq => sq.team === 'blue') || [];
          let allyUnit = null;
          for (const sq of blueSquads) {
            if (sq.sergeantUnitId) {
              allyUnit = b.units?.find(u => u.id === sq.sergeantUnitId && !u.dead);
              if (allyUnit) break;
            }
          }
          if (!allyUnit) allyUnit = b.units?.find(u => !u.dead);
          m._extAllyUnit = allyUnit;

          if (allyUnit) {
            const sw = window.innerWidth;
            const sh = window.innerHeight;
            // Pan to ally and hold there (duration long enough to outlast the wait)
            cameraStartTransition(b, [{
              x: allyUnit.x - sw / 2 / 1.8,
              y: allyUnit.y - sh / 2 / 1.8,
              zoom: 1.8,
              duration: 1200
            }, {
              x: allyUnit.x - sw / 2 / 1.8,
              y: allyUnit.y - sh / 2 / 1.8,
              zoom: 1.8,
              duration: 60000
            }]);
            const allyLine = m._extOutcome === 'all_alive'
              ? "That's what we're here for. Stay close — we'll get you home."
              : "We don't leave our own. Medevac's coming.";
            allyUnit._speechBubble = { text: allyLine, t: now, persist: true };
          }
          b._missionWaitForClick = true;
        }
      }

      // Step 2a: Space on ally bubble (all_alive) → fade
      if (m._extStep === 'ally_bubble' && m._extOutcome === 'all_alive' && !b._missionWaitForClick) {
        m._extStep = 'fadeout';
        if (m._extAllyUnit) m._extAllyUnit._speechBubble = null;
        if (b.camera._transition) b.camera._transition.active = false;
        m._extFadeStart = now;
        b._fadeOverlay = { opacity: 0, fadeStartTime: now, fadeDuration: 2000, direction: 'out' };
      }

      // Step 2b: Space on ally bubble (some_down) → radio medevac, then fade
      if (m._extStep === 'ally_bubble' && m._extOutcome === 'some_down' && !b._missionWaitForClick) {
        m._extStep = 'fadeout';
        if (m._extAllyUnit) m._extAllyUnit._speechBubble = null;
        if (b.camera._transition) b.camera._transition.active = false;
        radioMessage({ sender: 'cmd', name: 'HQ', text: 'Medevac inbound. Hang tight.', priority: 'urgent' });
        m._extFadeStart = now;
        b._fadeOverlay = { opacity: 0, fadeStartTime: now, fadeDuration: 2500, direction: 'out' };
      }

      // Step 2c: Space on hero resolve (all_down) → radio response, then fade
      if (m._extStep === 'hero_resolve' && !b._missionWaitForClick) {
        m._extStep = 'fadeout';
        b.hero._speechBubble = null;
        radioMessage({ sender: 'cmd', name: 'HQ', text: "Copy that. Hold your ground, medevac's on the way.", priority: 'urgent' });
        m._extFadeStart = now;
        b._fadeOverlay = { opacity: 0, fadeStartTime: now, fadeDuration: 2500, direction: 'out' };
      }

      // Final: Fade complete → end mission
      if (m._extStep === 'fadeout' && now - m._extFadeStart >= 2700) {
        setMissionPhase(b, 'complete');
        if (callbacks.onComplete) callbacks.onComplete();
      }
      break;
    }

    case 'complete':
      // Mission done — handled by callback
      break;
  }
}
