// ═══════════════════════════════════════════════════════════════
// MAIN - Entry point, event handlers, initialization
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UNITS, PROJECTILES, UNIT_PROJECTILES, SquadOrder, ENDLESS_VEHICLES, Team, GAME_VERSION_STRING, RANK_TABLE } from './constants.js';
import { Game, newBattlePlan, newCampaign, createAdvancingScenario, createFrontlineScenario, newZoneBattle, newEndlessRun, newFireRangeRun, ENDLESS_MAP_SIZES } from './state.js';
import { initAudio, sound } from './audio.js';
import { save, load, saveFRConfig, loadFRConfig, saveFRNamedConfig, loadFRNamedConfigs, deleteFRNamedConfig, migrateFRConfig } from './storage.js';
import { goto, deploy, switchUnit, stopLoop, stopFireRangeLoop, formatFireRangeLog, addH2HWave, removeH2HWave, setH2HWaveUnit, clearH2HWaveLane, setH2HDefense, nextH2HRound, resetH2H, campaignKeyDown, campaignKeyUp, campaignMouseMove, endlessKeyDown, endlessKeyUp, endlessMouseMove, endlessMouseDown, endlessMouseUp, handleDeployClick, fireRangeKeyDown, fireRangeKeyUp, fireRangeWheel, updateEventLog, extractFromRun, battleMouseDown, battleMouseUp, battleSetAimAngle, battleClearAimAngle, battleSetJoystick, battleClearJoystick, battleSetAimDepth, battleClearAimDepth, getActiveBattle, getHeroTouchConfig } from './game.js';
import { FR_PRESETS } from './fire-range-presets.js';
import { render, updateBarracksPanel, updateOpsPanel, setSubState, fetchAvailableVehicles, fetchUnitVariants, fetchVariantData, getUnitVariants, fireRangeResultsHTML, replayTheaterHTML, newGameSetupHTML, removeIntroSeed, saveIntroSeed } from './ui.js';
import { setActiveSlot, migrateLegacySave, updateActiveSlotMeta, deleteSlot } from './storage.js';
import { advanceDialog, isDialogPaused, launchFirstTimeMission } from './mission.js';
import { ReplayPlayer } from './replay-player.js';
import { cameraKeyDown, cameraKeyUp, cameraZoom, cameraPanStart, cameraPanMove, cameraPanEnd } from './camera.js';
import { initController, getControllerInput, updateButtonStates, setControllerCallbacks, isControllerConnected } from './controller.js';
import { initGestures, setResetJoysticksCallback } from './gestures.js';
import { generateRecruit, saveRoster, createSoldier, removeFromMemorial, addToMemorial, replaceOnMemorial, saveMemorial, getRecentFallen, hasRosterRoom, dismissRecruit, promoteToOfficer, retireSoldier, debugSetRank, debugSetMMR, debugSetPhysicals, debugSetTraining, debugSetAllTraining, debugMaxSoldier, debugResetSoldier, getSoldier, generatePhysicals, rushHeal } from './roster.js';
import { Objective, assignObjective } from './commander.js';
import { PERSONALITY_PRESETS } from './ai-pipeline.js';
import { EntityRenderer } from './entity-renderer.js';
import { moveJoystick, shootJoystick, getNearJoystickAnchor, setJoystickAnchor, getClosestJoystickSide, getDragThreshold } from './joystick.js';
import * as sprites from './sprites.js';
const { initSprites } = sprites;
import { loadTerrainImages } from './world-builder/battle-terrain.js';
import { initInsigniaTab, handleInsigniaClick, handleInsigniaInput, handleInsigniaKeyDown, handleInsigniaKeyUp } from './insignia-events.js';
import { cacheInsigniaSet } from './insignia-renderer.js';
import { handlePanelWheel } from './panel-scroll.js';
import { logEvent } from './battle-log.js';
import { handleCMDClick, handleCMDRightClick, handleCMDKey } from './cmd-mode.js';

// Expose sprites module for console testing
window.sprites = sprites;

// ═══════════════════════════════════════════════════════════════
// REPLAY PLAYER STATE
// ═══════════════════════════════════════════════════════════════
let replayPlayer = null;

function formatReplayTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// SQUAD COMMAND HELPERS
// ═══════════════════════════════════════════════════════════════

// Order icon/label mapping
const ORDER_INFO = {
  hold: { icon: '🛡️', label: 'HOLD' },
  advance: { icon: '⚔️', label: 'ADVANCE' },
  fallback: { icon: '🏃', label: 'FALLBACK' },
  suppress: { icon: '🔥', label: 'SUPPRESS' },
  flank: { icon: '↩️', label: 'FLANK' },
  digIn: { icon: '⛏️', label: 'DIG IN' },
  search: { icon: '🔍', label: 'SEARCH' }
};

// Set squad-wide or individual unit order
function setSquadOrder(battle, order) {
  if (!battle || !ORDER_INFO[order]) return;

  const info = ORDER_INFO[order];

  if (battle.squad.selectedUnitId) {
    // Apply to individual unit only
    const unit = battle.units.find(u => u.id === battle.squad.selectedUnitId);
    if (unit && unit.hp > 0) {
      unit.currentOrder = order;
      unit.hasIndividualOrder = true;
      battle.commandFeedback = { text: `${info.icon} Unit: ${info.label}`, time: Date.now() };
      console.log(`[ORDER] Unit ${unit.id} order set to: ${order}`);
    }
  } else {
    // Apply to entire squad
    battle.squad.currentOrder = order;
    battle.units.forEach(u => {
      if (u.hp > 0 && !u.hasIndividualOrder) {
        u.currentOrder = order;
        console.log(`[ORDER] Unit ${u.id} order set to: ${order}`);
      }
    });
    battle.commandFeedback = { text: `${info.icon} Squad: ${info.label}!`, time: Date.now() };
  }
}

// Set target priority for selected unit
function setUnitPriority(battle, priority) {
  if (!battle || !battle.squad.selectedUnitId) return;

  const unit = battle.units.find(u => u.id === battle.squad.selectedUnitId);
  if (unit && unit.hp > 0) {
    unit.targetPriority = priority;
    battle.commandFeedback = { text: `🎯 Priority: ${priority.toUpperCase()}`, time: Date.now() };
  }
}

// ═══════════════════════════════════════════════════════════════
// PASSWORD PROTECTION
// ═══════════════════════════════════════════════════════════════

const ACCESS_PASSWORD = 'simmons1986';
const AUTH_KEY = 'calculated_risk_auth';

function checkAuth() {
  // Check if already authenticated this session
  if (sessionStorage.getItem(AUTH_KEY) === 'true') return true;

  // Show login screen
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      font-family: 'Share Tech Mono', monospace;
      color: #fff;
    ">
      <h1 style="margin-bottom: 30px; color: #4a9eff;">CALCULATED RISK</h1>
      <div style="
        background: rgba(0,0,0,0.5);
        padding: 30px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.2);
        text-align: center;
      ">
        <p style="margin-bottom: 15px; color: #888;">Enter access code:</p>
        <input type="password" id="auth-password" style="
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.3);
          padding: 10px 15px;
          font-size: 16px;
          color: #fff;
          border-radius: 5px;
          width: 200px;
          text-align: center;
          font-family: inherit;
        " placeholder="Password">
        <br>
        <button id="auth-submit" style="
          margin-top: 15px;
          background: #4a9eff;
          border: none;
          padding: 10px 30px;
          font-size: 14px;
          color: #fff;
          border-radius: 5px;
          cursor: pointer;
          font-family: inherit;
        ">ENTER</button>
        <p id="auth-error" style="color: #ff4444; margin-top: 10px; display: none;">Incorrect password</p>
      </div>
    </div>
  `;

  const input = document.getElementById('auth-password');
  const btn = document.getElementById('auth-submit');
  const error = document.getElementById('auth-error');

  const tryLogin = () => {
    if (input.value === ACCESS_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      initApp();
    } else {
      error.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };

  btn.addEventListener('click', tryLogin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  input.focus();

  return false;
}

async function initApp() {
  // Migrate legacy save to slot 0 if needed
  migrateLegacySave();
  // Don't load yet — wait for slot selection. Just render title screen.
  // load(); — moved to slot-select action
  // Preload PNG sprites (non-blocking, falls back to SVG if missing)
  initSprites();
  // Preload terrain sprites for PCG battle terrain (non-blocking)
  loadTerrainImages().then(images => {
    Game.terrainImages = images;
    console.log('[main] Terrain sprites preloaded');
  }).catch(err => {
    console.warn('[main] Terrain sprite preload failed (battles will use fallback):', err);
  });
  // Preload insignia set for battle rendering (non-blocking)
  // If no set is selected, auto-detect the best available set
  const preloadInsignia = (setId) => {
    if (setId) {
      return fetch(`/api/insignia/${encodeURIComponent(setId)}`)
        .then(res => res.ok ? res.json() : null)
        .then(set => {
          if (set) { cacheInsigniaSet(set); console.log('[main] Insignia set preloaded:', set.name); }
          return set;
        });
    }
    // No set configured — find the best default from server
    return fetch('/api/insignia')
      .then(res => res.ok ? res.json() : [])
      .then(sets => {
        if (!sets.length) return null;
        // Prefer set with "US Army" in name, else first available
        const best = sets.find(s => /us army/i.test(s.name)) || sets[0];
        Game.settings.insigniaSetId = best.id;
        return fetch(`/api/insignia/${encodeURIComponent(best.id)}`)
          .then(r => r.ok ? r.json() : null)
          .then(set => {
            if (set) { cacheInsigniaSet(set); console.log('[main] Insignia set auto-selected:', set.name); }
            return set;
          });
      });
  };
  preloadInsignia(Game.settings.insigniaSetId).catch(err => console.warn('[main] Insignia preload failed:', err));
  // Render initial state
  render();
  setupEventHandlers();
  setupController();
  setupWakeLock();
  initGestures(); // Initialize touch gesture system
}

// ═══════════════════════════════════════════════════════════════
// SCREEN WAKE LOCK - Keep screen on while app is active
// ═══════════════════════════════════════════════════════════════

let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake lock active');

      wakeLock.addEventListener('release', () => {
        console.log('Wake lock released');
      });
    }
  } catch (err) {
    console.log('Wake lock error:', err.message);
  }
}

function setupWakeLock() {
  // Request wake lock on init
  requestWakeLock();

  // Re-acquire wake lock when page becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// CONTROLLER SUPPORT
// ═══════════════════════════════════════════════════════════════

function setupController() {
  initController();

  // Show notification when controller connects/disconnects
  setControllerCallbacks(
    (gp) => console.log('Controller ready:', gp.id),
    () => console.log('Controller disconnected')
  );

  // Start controller polling loop
  requestAnimationFrame(controllerLoop);
}

// Controller state tracking
let controllerShootHeld = false;

function controllerLoop() {
  requestAnimationFrame(controllerLoop);

  if (!isControllerConnected()) return;

  const input = getControllerInput();
  if (!input) return;

  // Process during any hero battle
  if (isHeroBattle()) {
    processControllerBattle(input);
  }

  // Update button states for next frame
  updateButtonStates();
}

function processControllerBattle(input) {
  // Movement (left stick) - translate to WASD
  if (input.isMoving) {
    // Horizontal
    if (input.moveX < -0.3) {
      campaignKeyDown('a');
    } else if (input.moveX > 0.3) {
      campaignKeyDown('d');
    } else {
      campaignKeyUp('a');
      campaignKeyUp('d');
    }
    // Vertical
    if (input.moveY < -0.3) {
      campaignKeyDown('w');
    } else if (input.moveY > 0.3) {
      campaignKeyDown('s');
    } else {
      campaignKeyUp('w');
      campaignKeyUp('s');
    }
  } else {
    // Release movement
    campaignKeyUp('w');
    campaignKeyUp('a');
    campaignKeyUp('s');
    campaignKeyUp('d');
  }

  // Aiming (right stick) - calculate aim position
  if (input.isAiming) {
    const bf = document.querySelector('.campaign-battlefield');
    if (bf) {
      const rect = bf.getBoundingClientRect();
      const heroBattle = Game.campaign?.heroBattle;
      if (heroBattle) {
        // Aim in direction of right stick from hero position
        const aimDist = 200; // How far to project aim
        const aimX = heroBattle.hero.x + input.aimX * aimDist;
        const aimY = heroBattle.hero.y + input.aimY * aimDist;
        campaignMouseMove(aimX, aimY);
      }
    }
  }

  // Shooting (RT trigger)
  if (input.shoot && !controllerShootHeld) {
    controllerShootHeld = true;
    battleMouseDown();
  } else if (!input.shoot && controllerShootHeld) {
    controllerShootHeld = false;
    battleMouseUp();
  }

  // Unit commands (face buttons)
  if (input.deploy) campaignKeyDown('1');  // Follow
  if (input.cancel) campaignKeyDown('5');  // Retreat
  if (input.switchUnit) campaignKeyDown('2');  // Hold
  if (input.artillery) campaignKeyDown('3');  // Attack

  // D-pad for commands
  if (input.dpadUp) campaignKeyDown('1');    // Follow
  if (input.dpadDown) campaignKeyDown('5');  // Retreat
  if (input.dpadLeft) campaignKeyDown('2');  // Hold
  if (input.dpadRight) campaignKeyDown('3'); // Attack

  // Pause
  if (input.pause) {
    goto(State.PAUSED);
  }
}

function setupEventHandlers() {
// ═══════════════════════════════════════════════════════════════
// EVENT HANDLING
// ═══════════════════════════════════════════════════════════════

document.getElementById('app').addEventListener('click', e => {
  // Mission dialog/speech advance: Space/Enter on desktop, tap on mobile
  if ('ontouchstart' in window && Game.state === State.ENDLESS_BATTLE) {
    const mb = Game.endless?.battle;
    if (mb?._missionWaitForClick) {
      mb._missionWaitForClick = false;
      if (mb.hero?._speechBubble?.persist) mb.hero._speechBubble = null;
      if (mb.mouse) mb.mouse.down = false;
      e.stopPropagation();
      return;
    }
    if (mb && isDialogPaused(mb)) {
      advanceDialog(mb);
      e.stopPropagation();
      return;
    }
  }

  // Toggle controls legend
  if (e.target.closest('[data-action="toggle-controls-legend"]')) {
    const legend = document.querySelector('.controls-legend');
    if (legend) legend.style.display = legend.style.display === 'none' ? '' : 'none';
    return;
  }

  if (e.target.closest('[data-action="zoom-in"]')) {
    const b = getActiveBattle();
    if (b?.camera) {
      b.camera.userZoom = Math.min(2.0, (b.camera.userZoom || 1) + 0.15);
    }
    return;
  }
  if (e.target.closest('[data-action="zoom-out"]')) {
    const b = getActiveBattle();
    if (b?.camera) {
      b.camera.userZoom = Math.max(0.5, (b.camera.userZoom || 1) - 0.15);
    }
    return;
  }

  // Toggle minimap expand/collapse
  if (e.target.closest('[data-action="toggle-minimap"]') && Game.state === State.CAMPAIGN_BATTLE) {
    const minimap = document.querySelector('.campaign-minimap');
    const overlay = document.querySelector('.minimap-overlay');
    if (minimap && overlay) {
      minimap.classList.toggle('expanded');
      overlay.classList.toggle('visible');
    }
    return;
  }

  // === RADIO PANEL HANDLERS ===
  if (Game.state === State.CAMPAIGN_BATTLE) {
    const b = Game.campaign?.heroBattle;
    if (!b) return;

    // Select entire squad (deselect individual unit)
    if (e.target.closest('[data-action="select-squad"]')) {
      b.squad.selectedUnitId = null;
      b.squad.selectionMode = 'squad';
      // Don't auto-open radio - require swipe
      render();
      return;
    }

    // Select individual unit - tap only selects (swipe opens radio)
    const unitSelectBtn = e.target.closest('[data-action="select-unit"]');
    if (unitSelectBtn) {
      const unitId = unitSelectBtn.dataset.unitId;
      const unit = b.units.find(u => u.id === unitId);
      if (unit && unit.hp > 0) {
        if (b.squad.selectedUnitId === unitId) {
          // Tapping same unit - deselect
          b.squad.selectedUnitId = null;
          b.squad.selectionMode = 'squad';
        } else {
          // Tapping different unit - select (no radio)
          b.squad.selectedUnitId = unitId;
          b.squad.selectionMode = 'unit';
        }
        // Close radio on any tap - swipe to open
        b.radioOpen = false;
        render();
      }
      return;
    }

    // Squad order buttons
    const orderBtn = e.target.closest('[data-squad-order]');
    if (orderBtn) {
      const order = orderBtn.dataset.squadOrder;
      setSquadOrder(b, order);
      render();
      return;
    }

    // Concentrate fire button
    if (e.target.closest('[data-action="concentrate-fire"]')) {
      if (b.squad.concentrateTarget) {
        // Cancel targeting
        b.squad.concentrateTarget = null;
        b.commandMode = null;
      } else {
        // Enter targeting mode
        b.commandMode = 'selectTarget';
        b.commandAction = 'concentrate';
      }
      render();
      return;
    }

    // Priority dropdown
    const prioritySelect = e.target.closest('[data-action="set-priority"]');
    if (prioritySelect && prioritySelect.tagName === 'SELECT') {
      // Handle in change event instead
      return;
    }
  }

  // Front line command buttons (legacy - keep for now)
  const frontLineBtn = e.target.closest('[data-front-line]');
  if (frontLineBtn && Game.state === State.CAMPAIGN_BATTLE) {
    const cmd = frontLineBtn.dataset.frontLine;
    // Trigger the keyboard command (Z, X, C)
    if (cmd === 'advance') campaignKeyDown('z');
    else if (cmd === 'hold') campaignKeyDown('x');
    else if (cmd === 'retreat') campaignKeyDown('c');
    return;
  }

  // Mobile command buttons (legacy - keep for now)
  const cmdBtn = e.target.closest('[data-cmd]');
  if (cmdBtn && Game.state === State.CAMPAIGN_BATTLE) {
    const cmd = cmdBtn.dataset.cmd;
    // Trigger the keyboard command
    if (cmd === 'follow') campaignKeyDown('1');
    else if (cmd === 'hold') campaignKeyDown('2');
    else if (cmd === 'attack') campaignKeyDown('3');
    else if (cmd === 'move') campaignKeyDown('4');
    else if (cmd === 'retreat') campaignKeyDown('5');
    return;
  }

  // Commander map targeting — intercept battlefield clicks when a positional order is pending
  if (Game.fireRange?.battle?._commanderUI?.pendingOrder) {
    const b = Game.fireRange.battle;
    const ui = b._commanderUI;
    const bf = e.target.closest('.endless-battlefield');
    if (bf && b.battleRenderer) {
      const rect = bf.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = b.battleRenderer.screenToWorld(sx, sy);
      if (world) {
        const sqId = ui.selectedSquadId;
        const squad = b._squads?.find(s => s.id === sqId);
        if (squad?.sergeant) {
          const cmdr = b._teamCommanders?.[squad.team];
          if (cmdr) {
            assignObjective(cmdr, squad.sergeant, {
              type: ui.pendingOrder,
              target: { x: world.x, y: world.y }
            }, performance.now(), b);
          }
          logEvent(b, {
            t: performance.now(), type: 'commander', team: squad.team,
            msg: `Commander orders Squad ${sqId}: ${ui.pendingOrder.toUpperCase()} at (${Math.round(world.x)}, ${Math.round(world.y)})`
          });
        }
        ui.pendingOrder = null;
        return;
      }
    }
  }

  // Insignia editor click events (HQ tab) — must be before generic data-action handler
  if (Game.state === State.HQ && Game.hqTab === HQTab.INSIGNIA) {
    if (handleInsigniaClick(e.target, e)) return;
  }

  // Actions
  const action = e.target.closest('[data-action]');
  if (action) {
    const a = action.dataset.action;
    if (a === 'campaign') { initAudio(); goto(State.CAMPAIGN_ERA_SELECT); }
    else if (a === 'endless') { Game.endless = newEndlessRun(); Game.endless._record = Game.settings?.autoRecord !== false; initAudio(); fetchUnitVariants().then(() => { goto(State.ENDLESS_LOADOUT); render(); }); }
    else if (a === 'classic') { Game.settings.mode = 'classic'; initAudio(); goto(State.COUNTDOWN); }
    else if (a === 'versus') { Game.settings.mode = 'versus'; initAudio(); goto(State.H2H_DESIGN); }
    else if (a === 'play') { initAudio(); goto(State.COUNTDOWN); }
    else if (a === 'settings') goto(State.SETTINGS);
    else if (a === 'stats') goto(State.STATS);
    else if (a === 'hq') { goto(State.HQ); if (Game.hqTab === HQTab.INSIGNIA) setTimeout(() => initInsigniaTab(), 0); }
    // Save slot actions
    else if (a === 'slot-select') {
      const idx = parseInt(action.dataset.slot);
      setActiveSlot(idx);
      load(); // Load this slot's data
      goto(State.HQ);
    }
    else if (a === 'slot-new') {
      const idx = parseInt(action.dataset.slot);
      // Show seed selection setup screen
      document.getElementById('app').innerHTML = newGameSetupHTML(idx);
    }
    else if (a === 'setup-back') {
      render(); // Back to title/menu
    }
    else if (a === 'setup-deploy') {
      const idx = parseInt(action.dataset.slot);
      // Read selected seed
      const selected = document.querySelector('input[name="intro-seed"]:checked')?.value;
      let seed;
      if (selected === 'random') {
        seed = Math.floor(Math.random() * 999999);
      } else if (selected === 'custom') {
        seed = parseInt(document.getElementById('seed-custom-val')?.value) || Math.floor(Math.random() * 999999);
      } else {
        seed = parseInt(selected);
      }

      setActiveSlot(idx);
      Game.roster = [];
      Game.vehicles = [];
      Game.memorial = [];
      Game.recentFallen = [];
      Game.resources = { scrap: 0, parts: 0 };
      Game.stats = { highestWave: 0, battles: 0, kills: 0 };
      Game.settings = Game.settings || {};
      Game.hqRecruitPool = null;
      Game.opsConfig = null;
      Game.hqSelectedSoldiers = [];
      Game.hqBarracksView = 'roster';
      Game.hqCollapsedGroups = {};
      Game._isFirstRun = true;
      Game._introSeed = seed;
      launchFirstTimeMission();
      updateActiveSlotMeta();
      initAudio();
      goto(State.ENDLESS_BATTLE);
    }
    else if (a === 'seed-remove') {
      const seed = parseInt(action.dataset.seed);
      removeIntroSeed(seed);
      // Re-render the setup screen (find slot from the deploy button)
      const deployBtn = document.querySelector('[data-action="setup-deploy"]');
      const slotIdx = deployBtn ? parseInt(deployBtn.dataset.slot) : 0;
      document.getElementById('app').innerHTML = newGameSetupHTML(slotIdx);
    }
    else if (a === 'slot-delete') {
      const idx = parseInt(action.dataset.slot);
      deleteSlot(idx);
      render();
    }
    // HQ actions
    else if (a === 'hq-deploy-endless') { Game.endless = newEndlessRun(); Game.endless._record = Game.settings?.autoRecord !== false; initAudio(); fetchUnitVariants().then(() => { goto(State.ENDLESS_LOADOUT); render(); }); }
    else if (a === 'hq-fire-range') { goto(State.FIRE_RANGE); }
    else if (a === 'hq-replays') {
      goto(State.REPLAY_THEATER);
      fetch('/api/replays').then(r => r.json()).then(list => {
        Game._replayCache = list.replays || list;
        Game._replayFilter = 'all';
        document.getElementById('app').innerHTML = replayTheaterHTML(Game._replayCache, 'all');
      }).catch(() => {
        Game._replayCache = [];
        document.getElementById('app').innerHTML = replayTheaterHTML([], 'all');
      });
    }
    // ── Operations actions ──
    else if (a === 'ops-view') {
      Game.opsView = action.dataset.view;
      render();
    }
    else if (a === 'ops-formation-squad') {
      Game.opsFormationSquad = parseInt(action.dataset.squad) || 0;
      render();
    }
    else if (a === 'ops-set-formation') {
      const sqIdx = parseInt(action.dataset.squad) || 0;
      const sq = Game.opsConfig?.squads?.[sqIdx];
      if (sq) {
        if (!sq.formation) sq.formation = { preset: 'wedge', positions: [], spacing: 80, facing: 0 };
        sq.formation.preset = action.dataset.preset;
        sq.formation.positions = []; // clear custom positions
      }
      render();
    }
    else if (a === 'ops-set-spacing') {
      const sqIdx = parseInt(action.dataset.squad) || 0;
      const sq = Game.opsConfig?.squads?.[sqIdx];
      if (sq?.formation) sq.formation.spacing = parseInt(action.value) || 80;
    }
    else if (a === 'ops-select-leader') {
      const sqIdx = parseInt(action.dataset.squad) || 0;
      const sq = Game.opsConfig?.squads?.[sqIdx];
      if (sq && sq.units.length > 0) {
        // Cycle to next unit as leader
        const currentIdx = sq.units.indexOf(sq.leaderId);
        const nextIdx = (currentIdx + 1) % sq.units.length;
        sq.leaderId = sq.units[nextIdx];
        render();
      }
    }
    else if (a === 'ops-step-down') {
      const sqIdx = parseInt(action.dataset.squad) || 0;
      const sq = Game.opsConfig?.squads?.[sqIdx];
      if (sq) {
        // Find next best leader (not the hero)
        const roster = (Game.roster || []).filter(s => s.status === 'active');
        const heroId = Game.opsConfig.heroUnit;
        const candidates = sq.units.filter(uid => uid !== heroId);
        if (candidates.length > 0) {
          // Pick highest leadership
          let best = candidates[0];
          let bestLead = 0;
          for (const uid of candidates) {
            const s = roster.find(r => r.id === uid);
            const lead = s?.personality?.discipline ?? 0;
            if (lead > bestLead) { bestLead = lead; best = uid; }
          }
          sq.leaderId = best;
        }
        render();
      }
    }
    else if (a === 'ops-set-map') {
      if (!Game.opsConfig) Game.opsConfig = { mapSize: 'small', startWave: 1, heroUnit: null, squads: [{ units: [], vehicleId: null }], record: true };
      Game.opsConfig.mapSize = action.dataset.size;
      // Trim squads if map size reduced
      const max = (ENDLESS_MAP_SIZES[Game.opsConfig.mapSize] || { maxSquads: 1 }).maxSquads;
      while (Game.opsConfig.squads.length > max) Game.opsConfig.squads.pop();
      render();
    }
    else if (a === 'ops-set-wave') {
      if (Game.opsConfig) Game.opsConfig.startWave = parseInt(action.value) || 1;
    }
    else if (a === 'ops-toggle-record') {
      if (Game.opsConfig) Game.opsConfig.record = !Game.opsConfig.record;
      render();
    }
    else if (a === 'ops-select-slot') {
      const slotType = action.dataset.slotType;
      const squad = parseInt(action.dataset.squad) || 0;
      const idx = parseInt(action.dataset.slotIdx) || 0;
      Game.opsSelectedSlot = { type: slotType, squad, idx, crewRole: action.dataset.crewRole };
      Game.opsPreviewSoldier = null;
      // Auto-filter to matching roles for the selected slot
      if (slotType === 'crew') Game.opsRoleFilter = action.dataset.crewRole || 'all';
      else if (slotType === 'infantry-add') Game.opsRoleFilter = 'infantry';
      else if (slotType === 'vehicle') Game.opsRoleFilter = 'all';
      // hero is no longer a slot type — it's a flag on an assigned unit
      render();
    }
    else if (a === 'ops-preview-unit') {
      Game.opsPreviewUnit = {
        type: action.dataset.unitType,
        squad: parseInt(action.dataset.squad) || 0,
        idx: parseInt(action.dataset.unitIdx) || 0,
        soldierId: action.dataset.soldier || null
      };
      Game.opsPreviewSoldier = null;
      updateOpsPanel();
    }
    else if (a === 'ops-set-hero') {
      if (Game.opsConfig) {
        Game.opsConfig.heroUnit = action.dataset.soldier;
      }
      updateOpsPanel();
    }
    else if (a === 'ops-preview-soldier') {
      Game.opsPreviewSoldier = action.dataset.soldier;
      Game.opsPreviewUnit = null;
      updateOpsPanel();
    }
    else if (a === 'ops-assign-soldier') {
      const soldierId = action.dataset.soldier;
      const slot = Game.opsSelectedSlot;
      if (!slot || !Game.opsConfig) { render(); return; }
      if (slot.type === 'hero') {
        Game.opsConfig.heroUnit = soldierId;
      } else if (slot.type === 'infantry-add') {
        Game.opsConfig.squads[slot.squad]?.units.push(soldierId);
      } else if (slot.type === 'crew') {
        // TODO: assign crew to vehicle slot
      }
      Game.opsPreviewSoldier = null;
      render();
    }
    else if (a === 'ops-swap-soldier') {
      const oldId = action.dataset.old;
      const newId = action.dataset.new;
      const sqIdx = parseInt(action.dataset.squad) || 0;
      const unitIdx = parseInt(action.dataset.idx) || 0;
      if (Game.opsConfig) {
        const sq = Game.opsConfig.squads[sqIdx];
        if (sq && sq.units[unitIdx] === oldId) {
          sq.units[unitIdx] = newId;
        }
        // If swapped unit was hero, transfer hero to new unit
        if (Game.opsConfig.heroUnit === oldId) Game.opsConfig.heroUnit = newId;
      }
      Game.opsPreviewSoldier = null;
      Game.opsPreviewUnit = null;
      render();
    }
    else if (a === 'ops-assign-cmd') {
      if (Game.opsConfig) {
        Game.opsConfig.cmdOfficerId = action.dataset.soldier;
        Game.opsSelectedSlot = null;
      }
      render();
    }
    else if (a === 'ops-assign-vehicle') {
      const vehicleId = action.dataset.vehicle;
      const slot = Game.opsSelectedSlot;
      if (slot?.type === 'vehicle' && Game.opsConfig) {
        Game.opsConfig.squads[slot.squad].vehicleId = vehicleId;
      }
      Game.opsSelectedSlot = null;
      render();
    }
    else if (a === 'ops-unassign') {
      const slotType = action.dataset.slotType;
      const squad = parseInt(action.dataset.squad) || 0;
      const idx = parseInt(action.dataset.slotIdx) || 0;
      if (!Game.opsConfig) { render(); return; }
      if (slotType === 'hero') Game.opsConfig.heroUnit = null;
      else if (slotType === 'vehicle') Game.opsConfig.squads[squad].vehicleId = null;
      else if (slotType === 'infantry') Game.opsConfig.squads[squad]?.units.splice(idx, 1);
      render();
    }
    else if (a === 'ops-add-squad') {
      if (Game.opsConfig) {
        Game.opsConfig.squads.push({ units: [], vehicleId: null });
        render();
      }
    }
    else if (a === 'ops-remove-squad') {
      const sqIdx = parseInt(action.dataset.squad);
      if (Game.opsConfig && sqIdx > 0) {
        Game.opsConfig.squads.splice(sqIdx, 1);
        render();
      }
    }
    else if (a === 'ops-filter-role') {
      Game.opsRoleFilter = action.dataset.role;
      render();
    }
    else if (a === 'hq-filter-role') {
      Game.hqRoleFilter = action.dataset.role;
      render();
    }
    else if (a === 'ops-deploy') {
      if (!Game.opsConfig?.heroUnit) return;
      const ops = Game.opsConfig;

      // Determine hero unit type from the selected soldier
      const heroSoldier = (Game.roster || []).find(s => s.id === ops.heroUnit);
      let heroVehicleId = 'infantry'; // default to infantry
      if (heroSoldier?.pool === 'vehicle') {
        // Hero is vehicle crew — find which vehicle they're in from opsConfig
        for (const sq of ops.squads) {
          if (sq.vehicleId) {
            const veh = (Game.vehicles || []).find(v => v.id === sq.vehicleId);
            if (veh) { heroVehicleId = veh.unitId; break; }
          }
        }
      }

      // Create endless run
      Game.endless = newEndlessRun();
      Game.endless.wave = ops.startWave;
      Game.endless.mapSize = ops.mapSize;
      Game.endless._record = ops.record;
      Game.endless.loadout.vehicle = heroVehicleId;
      // Attach opsConfig so newEndlessBattle can filter the deployment pool
      Game.endless._opsConfig = {
        heroUnit: ops.heroUnit,
        squads: JSON.parse(JSON.stringify(ops.squads)),
        cmdOfficerId: ops.cmdOfficerId
      };

      // Note: first-run missions launch directly from slot-new via launchMission(), not through ops-deploy

      initAudio();
      goto(State.ENDLESS_BATTLE);
    }
    else if (a === 'hq-settings') { goto(State.SETTINGS); }
    else if (a === 'hq-recruit') {
      const cost = 50;
      if (Game.resources.scrap >= cost) {
        Game.resources.scrap -= cost;
        const recruit = generateRecruit('infantry', 'rifleman');
        Game.roster.push(recruit);
        saveRoster();
        save();
        render();
      }
    }
    else if (a === 'hq-heal-all') {
      const wounded = (Game.roster || []).filter(s => s.status === 'wounded');
      const costPer = 25;
      const totalCost = wounded.length * costPer;
      if (wounded.length > 0 && Game.resources.scrap >= totalCost) {
        Game.resources.scrap -= totalCost;
        for (const s of wounded) { s.status = 'active'; s.hpPercent = 1.0; }
        saveRoster(); save(); render();
      }
    }
    else if (a === 'hq-barracks-view') {
      Game.hqBarracksView = action.dataset.view;
      Game.hqSelectedSoldiers = []; // Clear selection on view switch
      render();
    }
    else if (a === 'hq-rush-heal') {
      const soldierId = action.dataset.soldier;
      const cost = 50;
      if ((Game.resources?.scrap || 0) >= cost) {
        if (rushHeal(soldierId, cost)) {
          Game.resources.scrap -= cost;
          save();
          render();
        }
      }
    }
    else if (a === 'medevac-name-confirm') {
      const first = document.getElementById('medevac-first')?.value?.trim();
      const last = document.getElementById('medevac-last')?.value?.trim();
      if (!first || !last) return;
      // Update hero soldier name
      const pc = (Game.roster || []).find(s => s.isPlayerCharacter);
      if (pc) {
        pc.name = { first, last, nickname: null };
        saveRoster();
      }
      // Heal hero
      if (pc) {
        pc.status = 'active';
        pc.hpPercent = 1.0;
        pc.woundedBattlesLeft = 0;
        saveRoster();
      }
      // Advance dialog steps
      const dialog = document.querySelector('.medevac-dialog');
      if (dialog) {
        // Hide name input
        const nameInput = dialog.querySelector('[data-step="name"]');
        if (nameInput) nameInput.classList.remove('visible');
        // Get rank
        const rank = RANK_TABLE[pc?.rankIndex || 0]?.abbr || 'Private';
        // Show greeting
        const greeting = dialog.querySelector('[data-step="greeting"]');
        if (greeting) {
          greeting.textContent = `"Alright, ${rank} ${last}. Good to have you."`;
          greeting.classList.add('visible');
        }
        // Stagger remaining lines
        const steps = ['heal', 'squad1', 'squad2', 'done'];
        steps.forEach((step, i) => {
          setTimeout(() => {
            const el = dialog.querySelector(`[data-step="${step}"]`);
            if (el) el.classList.add('visible');
          }, 1200 + i * 1500);
        });
      }
    }
    else if (a === 'medevac-continue') {
      // Finish extraction and go to HQ
      extractFromRun();
    }
    else if (a === 'hq-purge-unseeded') {
      const before = Game.roster.length;
      Game.roster = Game.roster.filter(s => s.isPlayerCharacter || (s.battlesServed || 0) > 0 || s.status === 'kia');
      saveRoster();
      console.log(`[roster] Purged ${before - Game.roster.length} unseeded soldiers`);
      render();
    }
    else if (a === 'hq-select-memorial') {
      const soldierId = action.dataset.soldier;
      Game.hqSelectedSoldiers = [soldierId];
      render();
    }
    else if (a === 'hq-select-fallen') {
      const soldierId = action.dataset.soldier;
      Game.hqSelectedSoldiers = [`fallen_${soldierId}`];
      render();
    }
    else if (a === 'hq-add-to-wall') {
      const soldierId = action.dataset.soldier;
      const { qualifying } = getRecentFallen();
      const fallen = qualifying.find(f => f.id === soldierId);
      if (fallen) {
        addToMemorial(fallen);
        Game.hqSelectedSoldiers = [soldierId]; // Select the new wall entry
        render();
      }
    }
    else if (a === 'hq-replace-on-wall') {
      const oldId = action.dataset.old;
      const newId = action.dataset.new;
      const { qualifying } = getRecentFallen();
      const fallen = qualifying.find(f => f.id === newId);
      if (fallen) {
        replaceOnMemorial(oldId, fallen);
        Game.hqSelectedSoldiers = [newId];
        render();
      }
    }
    else if (a === 'hq-select-recruit') {
      const idx = action.dataset.recruit;
      Game.hqSelectedSoldiers = [`recruit_${idx}`];
      render();
    }
    else if (a === 'hq-toggle-soldier') {
      const soldierId = action.dataset.soldier;
      if (!Game.hqSelectedSoldiers) Game.hqSelectedSoldiers = [];
      const idx = Game.hqSelectedSoldiers.indexOf(soldierId);
      if (idx >= 0) {
        Game.hqSelectedSoldiers.splice(idx, 1);
      } else {
        if (Game.hqSelectedSoldiers.length >= 2) Game.hqSelectedSoldiers.shift();
        Game.hqSelectedSoldiers.push(soldierId);
      }
      updateBarracksPanel();
    }
    else if (a === 'hq-toggle-group') {
      const group = action.dataset.group;
      if (!Game.hqCollapsedGroups) Game.hqCollapsedGroups = {};
      Game.hqCollapsedGroups[group] = !Game.hqCollapsedGroups[group];
      render();
    }
    else if (a === 'hq-dismiss-recruit') {
      const idx = parseInt(action.dataset.recruit);
      const pool = Game.hqRecruitPool || [];
      if (pool[idx] && !pool[idx].locked) {
        dismissRecruit(idx);
        Game.hqSelectedSoldiers = [];
        save(); render();
      }
    }
    else if (a === 'stat-toggle-breakdown') {
      const stat = action.dataset.stat;
      Game._statBreakdownOpen = Game._statBreakdownOpen === stat ? null : stat;
      // Toggle breakdown visibility directly in DOM instead of full re-render
      document.querySelectorAll('.stat-breakdown').forEach(el => {
        el.classList.toggle('open', el.dataset.stat === Game._statBreakdownOpen);
      });
    }
    else if (a === 'hq-select-mos') {
      const idx = parseInt(action.dataset.recruit);
      const pool = Game.hqRecruitPool || [];
      const recruit = pool[idx];
      if (recruit && !recruit.locked) {
        recruit._selectedMOS = action.dataset.mos;
        render();
      }
    }
    else if (a === 'hq-recruit-specific') {
      const idx = parseInt(action.dataset.recruit);
      const pool = Game.hqRecruitPool || [];
      const recruit = pool[idx];
      if (recruit && !recruit.locked && Game.resources.scrap >= recruit.cost && hasRosterRoom()) {
        Game.resources.scrap -= recruit.cost;
        // Use selected MOS or default to recruit's role
        const mos = recruit._selectedMOS || recruit.role;
        const isVehicleRole = ['tc', 'gunner', 'driver'].includes(mos);
        const soldier = createSoldier({
          name: recruit.name,
          pool: isVehicleRole ? 'vehicle' : 'infantry',
          role: mos,
          mos,
          personality: recruit.personality,
          physicals: recruit.physicals
        });
        if (recruit.lineage) {
          soldier.lineage = { ...recruit.lineage, generation: 2 };
        }
        Game.roster.push(soldier);
        pool.splice(idx, 1);
        Game.hqSelectedSoldiers = [];
        saveRoster(); save(); render();
      }
    }
    else if (a === 'hq-heal-soldier') {
      const soldierId = action.dataset.soldier;
      const s = (Game.roster || []).find(r => r.id === soldierId);
      if (s && s.status === 'wounded' && Game.resources.scrap >= 25) {
        Game.resources.scrap -= 25;
        s.status = 'active'; s.hpPercent = 1.0;
        saveRoster(); save(); render();
      }
    }
    else if (a === 'hq-remove-kia') {
      const soldierId = action.dataset.soldier;
      const idx = (Game.roster || []).findIndex(r => r.id === soldierId);
      if (idx >= 0 && Game.roster[idx].status === 'kia') {
        Game.roster.splice(idx, 1);
        if (Game.hqSelectedSoldiers) {
          Game.hqSelectedSoldiers = Game.hqSelectedSoldiers.filter(id => id !== soldierId);
        }
        saveRoster(); save(); render();
      }
    }
    else if (a === 'hq-dismiss-memorial') {
      const soldierId = action.dataset.soldier;
      removeFromMemorial(soldierId);
      render();
    }
    else if (a === 'hq-promote-officer') {
      const soldierId = action.dataset.soldier;
      const soldier = (Game.roster || []).find(r => r.id === soldierId);
      if (soldier) {
        const result = promoteToOfficer(soldier);
        if (result) {
          Game.hqSelectedSoldiers = [soldierId];
          saveRoster(); save(); render();
        }
      }
    }
    else if (a === 'hq-retire-soldier') {
      const soldierId = action.dataset.soldier;
      retireSoldier(soldierId);
      Game.hqSelectedSoldiers = [];
      saveRoster(); save(); render();
    }
    else if (a === 'hq-dismiss-soldier') {
      const soldierId = action.dataset.soldier;
      const idx = (Game.roster || []).findIndex(r => r.id === soldierId);
      if (idx >= 0 && !Game.roster[idx].isPlayerCharacter) {
        Game.roster.splice(idx, 1);
        if (Game.hqSelectedSoldiers) {
          Game.hqSelectedSoldiers = Game.hqSelectedSoldiers.filter(id => id !== soldierId);
        }
        saveRoster(); save(); render();
      }
    }
    else if (a === 'sprite-editor') window.open('/sprite-editor.html', '_blank');
    else if (a === 'terrain-editor') window.open('/terrain-editor.html', '_blank');
    else if (a === 'menu') { stopLoop(); Game.h2h = null; Game.h2hDefenseSlot = undefined; Game.h2hWaveLane = undefined; Game.fireRange = null; if (replayPlayer) { replayPlayer.destroy(); replayPlayer = null; } goto(State.MENU); }
    else if (a === 'pause') goto(State.PAUSED);
    else if (a === 'resume') goto(State.BATTLE);
    else if (a === 'quit') { stopLoop(); goto(State.MENU); }
    else if (a === 'next') { Game.battle.wave++; goto(State.BATTLE); }
    else if (a === 'close') setSubState(SubState.PLAYING);
    else if (a === 'deploy' && Game.battle.selectedLane !== null) deploy(Game.battle.selectedLane);
    // H2H actions
    else if (a === 'h2h-start') { Game.h2hWaveLane = undefined; goto(State.H2H_BATTLE); }
    else if (a === 'h2h-next') nextH2HRound();
    else if (a === 'h2h-rematch') { resetH2H(); goto(State.H2H_DESIGN); }
    else if (a === 'add-wave') {
      const newIdx = addH2HWave();
      Game.h2h.selectedWave = newIdx;
      Game.h2hWaveLane = 0; // Focus first lane of new wave
      Game.h2hDefenseSlot = undefined;
      render();
    }
    else if (a === 'close-picker') { Game.h2h.selectedWave = null; Game.h2hWaveLane = undefined; render(); }
    // Campaign actions
    else if (a === 'select-era') {
      const era = parseInt(action.dataset.era);
      Game.campaign.era = era;
      goto(State.CAMPAIGN_MOS_SELECT);
    }
    else if (a === 'select-mos') {
      const mos = action.dataset.mos;
      Game.campaign.mos = mos;
      // Create battle plan for placement
      Game.campaign.battlePlan = newBattlePlan(Game.campaign.era, mos);
      goto(State.CAMPAIGN_PLANNING);
    }
    // Test zone battle buttons - go to vehicle select first
    else if (a === 'test-zone-battle' || a === 'test-frontline-battle') {
      // Fetch available vehicles, then show selection screen
      fetchAvailableVehicles().then(vehicles => {
        // Initialize vehicle selection state with first available vehicle
        const firstVehicle = vehicles[0] || { id: 'abrams', variants: ['default'] };
        Game.vehicleSelect = Game.vehicleSelect || {
          vehicle: firstVehicle.id,
          variant: firstVehicle.variants[0] || 'default'
        };
        goto(State.VEHICLE_SELECT);
      });
    }
    // Vehicle selection handlers
    else if (a === 'select-vehicle') {
      const vehicleId = action.dataset.vehicle;
      // Fetch vehicles to get correct first variant for selected vehicle
      fetchAvailableVehicles().then(vehicles => {
        const vehicle = vehicles.find(v => v.id === vehicleId);
        Game.vehicleSelect = Game.vehicleSelect || {};
        Game.vehicleSelect.vehicle = vehicleId;
        Game.vehicleSelect.variant = vehicle?.variants[0] || 'default';
        render();
      });
    }
    else if (a === 'select-variant') {
      const variant = action.dataset.variant;
      Game.vehicleSelect = Game.vehicleSelect || { vehicle: 'abrams' };
      Game.vehicleSelect.variant = variant;
      render();
    }
    else if (a === 'start-zone-battle') {
      const zones = parseInt(action.dataset.zones) || 3;
      const selection = Game.vehicleSelect || { vehicle: 'abrams', variant: 'default' };

      // Initialize campaign if needed
      if (!Game.campaign) { Game.campaign = newCampaign(); Game.campaign._record = Game.settings?.autoRecord !== false; }
      Game.campaign.era = 1;
      Game.campaign.mos = 'infantry';

      // Store vehicle selection for hero creation
      Game.campaign.heroVehicle = selection.vehicle;
      Game.campaign.heroVariant = selection.variant;

      // Create scenario based on zone count
      const scenario = zones === 5
        ? createFrontlineScenario('Test Frontline', 5)
        : createAdvancingScenario('Test Advance', zones);

      Game.campaign.heroBattle = newZoneBattle(1, 'infantry', scenario);
      goto(State.CAMPAIGN_BATTLE);
    }
    // Planning screen actions
    else if (a === 'select-plan-unit') {
      const unitId = action.dataset.unit;
      const plan = Game.campaign.battlePlan;
      if (plan) {
        // Toggle selection - tap same unit to deselect
        plan.selectedUnit = plan.selectedUnit === unitId ? null : unitId;
        // Clear placed unit selection when selecting from roster
        plan.selectedPlacedUnit = null;
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    // V2: Select unit from roster cards
    else if (a === 'select-roster-unit') {
      const unitId = action.dataset.unitId;
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        // Toggle selection - tap same unit to deselect
        plan.selectedUnit = plan.selectedUnit === unitId ? null : unitId;
        // Clear placed unit selection when selecting from roster
        plan.selectedPlacement = null;
        plan.placementMode = 'primary';
        render();
      }
    }
    // V2: Cycle through doctrine options
    else if (a === 'cycle-doctrine') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        const doctrines = ['frontal', 'flanking', 'defensive', 'blitz'];
        const currentIdx = doctrines.indexOf(plan.doctrine || 'frontal');
        plan.doctrine = doctrines[(currentIdx + 1) % doctrines.length];
        render();
      }
    }
    // V2: Toggle support
    else if (a === 'toggle-support') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.supportEnabled = !plan.supportEnabled;
        render();
      }
    }
    // V2: Artillery targeting (placeholder)
    else if (a === 'set-artillery') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        // TODO: Enter artillery targeting mode
        console.log('Artillery targeting mode - not yet implemented');
        render();
      }
    }
    else if (a === 'close-unit-detail') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.selectedUnit = null;
        render();
      }
    }
    // === PLACED UNIT DETAIL PANEL ACTIONS ===
    else if (a === 'close-placed-unit') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.selectedPlacedUnit = null;
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    else if (a === 'remove-placed-unit') {
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.selectedPlacedUnit) {
        const { row, col } = plan.selectedPlacedUnit;
        const cell = plan.grid[row]?.[col];
        if (cell && cell.owner === 'player') {
          // Restore count
          const unit = plan.availableUnits.find(u => u.id === cell.unitId);
          if (unit) unit.count++;
          plan.grid[row][col] = null;
        }
        plan.selectedPlacedUnit = null;
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    else if (a === 'start-set-path') {
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.selectedPlacedUnit) {
        const { row, col } = plan.selectedPlacedUnit;
        const cell = plan.grid[row]?.[col];
        // Start path from unit position
        plan.pathSetMode = true;
        plan.plannedPath = cell?.waypoints?.length > 0 ? [...cell.waypoints] : [];
        render();
      }
    }
    else if (a === 'cancel-set-path') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    else if (a === 'confirm-set-path') {
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.selectedPlacedUnit) {
        const { row, col } = plan.selectedPlacedUnit;
        const cell = plan.grid[row]?.[col];
        if (cell) {
          cell.waypoints = [...plan.plannedPath];
        }
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    else if (a === 'clear-path') {
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.selectedPlacedUnit) {
        const { row, col } = plan.selectedPlacedUnit;
        const cell = plan.grid[row]?.[col];
        if (cell) {
          cell.waypoints = [];
        }
        plan.pathSetMode = false;
        plan.plannedPath = [];
        render();
      }
    }
    else if (a === 'set-stance') {
      const stance = action.dataset.stance;
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.selectedPlacedUnit && stance) {
        const { row, col } = plan.selectedPlacedUnit;
        const cell = plan.grid[row]?.[col];
        if (cell) {
          cell.stance = stance;
        }
        render();
      }
    }
    else if (a === 'select-doctrine') {
      const doctrine = action.dataset.doctrine;
      const plan = Game.campaign.battlePlan;
      if (plan) {
        plan.doctrine = doctrine;
        render();
      }
    }
    else if (a === 'set-placement-mode') {
      const mode = action.dataset.mode;
      const plan = Game.campaign?.battlePlan;
      if (plan && mode) {
        plan.placementMode = mode;
        render();
      }
    }
    else if (a === 'set-position') {
      // User selected a position type from the popup
      const posType = action.dataset.posType;
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.positionPopup && posType) {
        const { row, col } = plan.positionPopup;
        const terrainType = plan.terrain[row]?.[col];

        // Can't place on impassable terrain or water
        if (terrainType === 'high' || terrainType === 'water') {
          plan.positionPopup = null;
          render();
          return;
        }

        if (posType === 'primary') {
          // Check if we have units available
          const unitToPlace = plan.availableUnits.find(u => u.id === plan.selectedUnit);
          if (!unitToPlace || unitToPlace.count <= 0) {
            plan.positionPopup = null;
            render();
            return;
          }
          // Check if there's already a placement at this position
          const existingIdx = plan.unitPlacements.findIndex(p =>
            p.primaryPos?.row === row && p.primaryPos?.col === col
          );
          if (existingIdx >= 0) {
            // Remove existing placement
            const existing = plan.unitPlacements[existingIdx];
            const existingUnit = plan.availableUnits.find(u => u.id === existing.unitId);
            if (existingUnit) existingUnit.count++;
            plan.unitPlacements.splice(existingIdx, 1);
          }
          // Add new placement
          const newPlacement = {
            unitId: plan.selectedUnit,
            primaryPos: { row, col },
            advancePos: null,
            fallbackPos: null,
            isSupport: false
          };
          plan.unitPlacements.push(newPlacement);
          unitToPlace.count--;
          plan.selectedPlacement = plan.unitPlacements.length - 1;
        } else if (posType === 'advance' && plan.selectedPlacement !== null) {
          const placement = plan.unitPlacements[plan.selectedPlacement];
          if (placement) {
            placement.advancePos = { row, col };
          }
        } else if (posType === 'fallback' && plan.selectedPlacement !== null) {
          const placement = plan.unitPlacements[plan.selectedPlacement];
          if (placement) {
            placement.fallbackPos = { row, col };
          }
        }
        plan.positionPopup = null;
        render();
      }
    }
    else if (a === 'close-position-popup') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.positionPopup = null;
        render();
      }
    }
    else if (a === 'deselect-placement') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.selectedPlacement = null;
        render();
      }
    }
    else if (a === 'toggle-support') {
      const placementIdx = parseInt(action.dataset.placement);
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.unitPlacements[placementIdx]) {
        plan.unitPlacements[placementIdx].isSupport = !plan.unitPlacements[placementIdx].isSupport;
        render();
      }
    }
    else if (a === 'remove-placement') {
      const placementIdx = parseInt(action.dataset.placement);
      const plan = Game.campaign?.battlePlan;
      if (plan && plan.unitPlacements[placementIdx]) {
        // Restore unit count to roster
        const placement = plan.unitPlacements[placementIdx];
        const unitType = plan.availableUnits.find(u => u.id === placement.unitId);
        if (unitType) unitType.count++;

        // Remove from array
        plan.unitPlacements.splice(placementIdx, 1);
        plan.selectedPlacement = null;
        plan.selectedUnit = null;
        render();
      }
    }
    else if (a === 'set-ctx-position') {
      // Set advance or fallback position from context menu
      const posType = action.dataset.posType;
      const plan = Game.campaign?.battlePlan;
      if (!plan || !plan.contextMenu || !plan.selectedPlacement) return;

      const { row, col } = plan.contextMenu;
      if (posType === 'advance') {
        plan.selectedPlacement.advancePos = { row, col };
      } else if (posType === 'fallback') {
        plan.selectedPlacement.fallbackPos = { row, col };
      }
      plan.contextMenu = null;
      render();
    }
    else if (a === 'close-context-menu') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.contextMenu = null;
        render();
      }
    }
    else if (a === 'toggle-roster') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.rosterExpanded = plan.rosterExpanded === false ? true : false;
        render();
      }
    }
    else if (a === 'toggle-doctrine') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.doctrineExpanded = plan.doctrineExpanded === false ? true : false;
        render();
      }
    }
    else if (a === 'roster-unit-click') {
      // Select a unit from roster to highlight on map
      const unitId = action.dataset.unitId;
      const plan = Game.campaign?.battlePlan;
      if (!plan) return;

      // Find first placement of this unit type
      const placement = plan.unitPlacements.find(p => p.unitId === unitId);
      if (placement) {
        plan.selectedPlacement = placement;
        // Scroll map to show this unit
        const cell = document.querySelector(`.plan-cell[data-row="${placement.primaryPos.row}"][data-col="${placement.primaryPos.col}"]`);
        if (cell) {
          cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
        render();
      }
    }
    else if (a === 'plan-cell') {
      const row = parseInt(action.dataset.row);
      const col = parseInt(action.dataset.col);
      const plan = Game.campaign.battlePlan;
      if (!plan) return;

      // Close context menu if open
      if (plan.contextMenu) {
        plan.contextMenu = null;
        render();
        return;
      }

      const isPlayerZone = row >= plan.playerStartRow;
      const isNoMansLand = row >= plan.enemyEndRow && row < plan.playerStartRow;
      const isHeroCell = plan.hero.row === row && plan.hero.col === col;
      const terrainType = plan.terrain[row]?.[col];

      // Can't place on impassable terrain
      if (terrainType === 'high') return;

      const placements = plan.unitPlacements || [];

      // === CHECK IF CLICKING ON EXISTING UNIT MARKER ===
      for (const p of placements) {
        if (p.primaryPos?.row === row && p.primaryPos?.col === col) {
          // Toggle selection (object reference)
          if (plan.selectedPlacement === p) {
            plan.selectedPlacement = null;
          } else {
            plan.selectedPlacement = p;
            plan.selectedUnit = null; // Clear roster selection
          }
          plan.placementMode = 'primary'; // Reset mode
          render();
          return;
        }
      }

      // === NEW UNIT FROM ROSTER: Place it ===
      if (plan.selectedUnit) {
        // Can only place in player zone or NML
        if (!isPlayerZone && !isNoMansLand) return;
        // Can't place on water or hero cell
        if (terrainType === 'water' || isHeroCell) return;

        // Check available count
        const unitType = plan.availableUnits.find(u => u.id === plan.selectedUnit);
        if (!unitType || unitType.count <= 0) return;

        // Check if cell is already occupied
        const existingAtPos = placements.find(p => p.primaryPos?.row === row && p.primaryPos?.col === col);
        if (existingAtPos) return;

        // Create new placement
        const newPlacement = {
          unitId: plan.selectedUnit,
          primaryPos: { row, col },
          advancePos: null,
          fallbackPos: null,
          isSupport: false,
          inSpawnZone: false
        };
        plan.unitPlacements.push(newPlacement);
        unitType.count--;

        // Clear roster selection, select the placed unit for position editing
        plan.selectedUnit = null;
        plan.selectedPlacement = newPlacement;
        plan.placementMode = 'primary';
        render();
        return;
      }

      // === PLACED UNIT SELECTED: Set position based on placement mode ===
      if (plan.selectedPlacement) {
        // Can only place in player zone or NML
        if (!isPlayerZone && !isNoMansLand) return;
        // Can't place on water or hero
        if (terrainType === 'water' || isHeroCell) return;

        const mode = plan.placementMode || 'primary';

        if (mode === 'primary') {
          // Check if there's another unit already at this position
          const existingAtPos = placements.find(p =>
            p !== plan.selectedPlacement &&
            p.primaryPos?.row === row && p.primaryPos?.col === col
          );
          if (existingAtPos) return; // Can't stack units

          // Move this unit's primary position to the new cell
          plan.selectedPlacement.primaryPos = { row, col };
          plan.selectedPlacement.inSpawnZone = false;  // No longer in spawn zone
        } else if (mode === 'advance') {
          plan.selectedPlacement.advancePos = { row, col };
        } else if (mode === 'fallback') {
          plan.selectedPlacement.fallbackPos = { row, col };
        }
        render();
        return;
      }

      // === CLICKING EMPTY CELL WITH NO SELECTION: Clear selection ===
      plan.selectedPlacement = null;
      render();
    }
    else if (a === 'plan-clear') {
      const plan = Game.campaign.battlePlan;
      if (plan) {
        // Restore unit counts from unitPlacements
        for (const placement of plan.unitPlacements) {
          const unit = plan.availableUnits.find(u => u.id === placement.unitId);
          if (unit) unit.count++;
        }
        // Clear all placements
        plan.unitPlacements = [];
        plan.selectedPlacement = null;

        // Also clear legacy grid for backwards compatibility
        for (let row = 0; row < plan.gridHeight; row++) {
          for (let col = 0; col < plan.gridWidth; col++) {
            const cell = plan.grid[row][col];
            if (cell && cell.owner === 'player') {
              const unit = plan.availableUnits.find(u => u.id === cell.unitId);
              if (unit) unit.count++;
              plan.grid[row][col] = null;
            }
          }
        }

        // Reset hero to default position
        plan.hero.row = plan.gridHeight - 2;
        plan.hero.col = Math.floor(plan.gridWidth / 2);

        // Clear all selection states
        plan.selectedUnit = null;
        plan.placementMode = 'primary';
        render();
      }
    }
    else if (a === 'plan-deploy') {
      // TODO: Generate enemy army, then start battle
      // For now, just go to battle
      Game.campaign.heroBattle = null;
      goto(State.CAMPAIGN_BATTLE);
    }
    // Grid zoom/pan controls
    else if (a === 'grid-zoom-in') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.zoom = Math.min(2.0, plan.zoom + 0.2);
        render();
      }
    }
    else if (a === 'grid-zoom-out') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.zoom = Math.max(0.3, plan.zoom - 0.2);
        render();
      }
    }
    else if (a === 'grid-center') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        // Center on hero position (convert grid coords to pixel offset)
        const cellSize = plan.cellSize;
        const heroPixelY = plan.hero.row * cellSize;
        const gridHeight = plan.gridHeight * cellSize;
        // Pan so hero is in center of viewport
        plan.panY = (gridHeight / 2 - heroPixelY) / plan.zoom;
        plan.panX = 0;
        render();
      }
    }
    else if (a === 'grid-reset') {
      const plan = Game.campaign?.battlePlan;
      if (plan) {
        plan.zoom = 1.0;
        plan.panX = 0;
        plan.panY = 0;
        render();
      }
    }
    else if (a === 'campaign-continue') {
      // Clear the battle and go back to era select for now
      Game.campaign.heroBattle = null;
      goto(State.CAMPAIGN_ERA_SELECT);
    }
    // Endless mode actions
    else if (a === 'endless-category') {
      const cat = action.dataset.category;
      if (Game.endless) {
        Game.endless.selectedCategory = cat;
        render();
      }
    }
    else if (a === 'toggle-vehicle-layout') {
      if (Game.endless) {
        Game.endless.vehicleLayout = Game.endless.vehicleLayout === 'grid' ? 'list' : 'grid';
        render();
      }
    }
    else if (a === 'preview-zoom') {
      if (Game.endless) {
        const dir = action.dataset.dir;
        const current = Game.endless.previewScale || 5;
        if (dir === 'in') Game.endless.previewScale = Math.min(current + 1, 30);
        else if (dir === 'out') Game.endless.previewScale = Math.max(current - 1, 1);
        render();
      }
    }
    else if (a === 'preview-pan') {
      if (Game.endless) {
        const dir = action.dataset.dir;
        const step = 2; // Pan step in %
        if (dir === 'up') Game.endless.previewPanY = (Game.endless.previewPanY || 8) - step;
        else if (dir === 'down') Game.endless.previewPanY = (Game.endless.previewPanY || 8) + step;
        else if (dir === 'left') Game.endless.previewPanX = (Game.endless.previewPanX || 0) - step;
        else if (dir === 'right') Game.endless.previewPanX = (Game.endless.previewPanX || 0) + step;
        else if (dir === 'reset') { Game.endless.previewPanX = 0; Game.endless.previewPanY = 8; Game.endless.previewScale = 5; }
        render();
      }
    }
    else if (a === 'endless-select-vehicle') {
      const vehicleId = action.dataset.vehicle;
      if (Game.endless) {
        Game.endless.loadout.vehicle = vehicleId;
        // Prefer 'default' variant if it exists, otherwise use first available
        const variants = getUnitVariants(vehicleId);
        const variantName = variants.includes('default') ? 'default' : (variants[0] || 'default');
        Game.endless.loadout.variant = variantName;
        // Fetch variant data for parts display
        fetchVariantData(vehicleId, variantName).then(() => render());
      }
    }
    else if (a === 'endless-select-variant') {
      if (Game.endless && action.value) {
        Game.endless.loadout.variant = action.value;
        render();
      }
    }
    else if (a === 'endless-toggle-insurance') {
      if (Game.endless) {
        const insuranceCost = 50;
        if (Game.endless.insuranceCost > 0) {
          // Turn off insurance, refund cost
          Game.resources.scrap += Game.endless.insuranceCost;
          Game.endless.insuranceCost = 0;
        } else if (Game.resources.scrap >= insuranceCost) {
          // Turn on insurance, deduct cost
          Game.resources.scrap -= insuranceCost;
          Game.endless.insuranceCost = insuranceCost;
        }
        render();
      }
    }
    else if (a === 'endless-set-seeded') {
      if (Game.endless) {
        // Generate weekly seed based on current week
        const now = new Date();
        const weekNum = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
        Game.endless.seed = `week-${weekNum}`;
        render();
      }
    }
    else if (a === 'endless-set-unseeded') {
      if (Game.endless) {
        Game.endless.seed = null;
        render();
      }
    }
    else if (a === 'toggle-vehicle-insurance') {
      if (Game.endless) {
        if (!Game.endless.loadout.insuredItems) {
          Game.endless.loadout.insuredItems = [];
        }
        const idx = Game.endless.loadout.insuredItems.indexOf('vehicle');
        if (idx >= 0) {
          Game.endless.loadout.insuredItems.splice(idx, 1);
        } else {
          Game.endless.loadout.insuredItems.push('vehicle');
        }
        render();
      }
    }
    else if (a === 'toggle-equipment-insurance') {
      if (Game.endless) {
        if (!Game.endless.loadout.insuredItems) {
          Game.endless.loadout.insuredItems = [];
        }
        const idx = Game.endless.loadout.insuredItems.indexOf('equipment');
        if (idx >= 0) {
          Game.endless.loadout.insuredItems.splice(idx, 1);
        } else {
          Game.endless.loadout.insuredItems.push('equipment');
        }
        render();
      }
    }
    else if (a === 'endless-start') {
      if (Game.endless && Game.endless.loadout.vehicle) {
        // Read debug wave selector (defaults to 1)
        const waveInput = document.querySelector('.header-wave-select');
        const startWave = waveInput ? Math.max(1, parseInt(waveInput.value, 10) || 1) : 1;
        Game.endless.wave = startWave;
        Game.endless.debugWave = startWave;
        Game.endless.runStartTime = Date.now();
        // Map size: read from selector or default to 'small'
        const sizeSelect = document.querySelector('.endless-map-size');
        Game.endless.mapSize = sizeSelect?.value || Game.endless.mapSize || 'small';
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'endless-continue') {
      if (Game.endless) {
        Game.endless.wave++;
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'endless-extract') {
      if (Game.endless) {
        extractFromRun();
      }
    }
    else if (a === 'endless-retry') {
      Game.endless = null;
      goto(State.HQ);
    }
    else if (a === 'endless-restart-intro') {
      // Reset roster for fresh intro restart
      Game.endless = null;
      // Remove non-hero soldiers (reinforcements from failed run) and heal the hero
      const pc = (Game.roster || []).find(s => s.isPlayerCharacter);
      Game.roster = (Game.roster || []).filter(s => s.isPlayerCharacter);
      if (pc) { pc.status = 'active'; pc.hpPercent = 1.0; pc.woundedBattlesLeft = 0; }
      launchFirstTimeMission();
      initAudio();
      goto(State.ENDLESS_BATTLE);
    }
    else if (a === 'endless-view-replay') {
      // Load the most recent replay
      fetch('/api/replays').then(r => r.json()).then(list => {
        const replays = list.replays || list;
        if (replays.length === 0) return;
        const latest = replays[0]; // Sorted by most recent
        fetch(`/api/replays/${encodeURIComponent(latest.name)}`).then(r2 => r2.json()).then(async replayData => {
          replayPlayer = new ReplayPlayer();
          await replayPlayer.load(replayData);
          goto(State.REPLAY_PLAYBACK);
          const container = document.getElementById('replay-battlefield');
          if (container) {
            replayPlayer.initRenderer(container);
            replayPlayer.onTimeUpdate((currentMs, durationMs) => {
              const scrubber = document.getElementById('replay-scrubber');
              if (scrubber) scrubber.value = (currentMs / durationMs) * 100;
              const timeEl = document.getElementById('replay-time');
              if (timeEl) {
                const cur = Math.floor(currentMs / 1000);
                const dur = Math.floor(durationMs / 1000);
                timeEl.textContent = `${Math.floor(cur/60)}:${(cur%60).toString().padStart(2,'0')} / ${Math.floor(dur/60)}:${(dur%60).toString().padStart(2,'0')}`;
              }
            });
            replayPlayer.play();
          }
        });
      });
    }
    else if (a === 'endless-next-wave') {
      // Advance to next wave — auto-deploy surviving squad on new map
      if (Game.endless) {
        Game.endless.wave++;
        Game.endless.battle = null;
        Game.endless._autoDeployNextWave = true;
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'endless-edit-deploy') {
      // Advance to next wave — open deploy panel for squad modification
      if (Game.endless) {
        Game.endless.wave++;
        Game.endless.battle = null;
        Game.endless._editDeployment = true;  // Force deploy phase on next battle
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'results-tab') {
      // Switch between Battle Report and Rank Report tabs
      if (Game.endless) {
        Game.endless._resultTab = action.dataset.tab || 'battle';
        render();
      }
    }
    else if (a === 'results-expand-vehicle') {
      // Toggle vehicle crew expand/collapse in battle report
      const vehId = action.dataset.vehicle;
      if (vehId) {
        const el = document.getElementById(`veh-expand-${vehId}`);
        if (el) el.classList.toggle('collapsed');
        // Toggle arrow
        const arrow = action.textContent.startsWith('\u25BC') ? '\u25B6' : '\u25BC';
        action.textContent = action.textContent.replace(/^[\u25B6\u25BC]/, arrow);
      }
    }
    // Fire Range actions
    else if (a === 'fire-range') {
      Game.fireRange = newFireRangeRun();
      // Restore last config if available
      const lastCfg = loadFRConfig();
      if (lastCfg && ((lastCfg.blueTeam && lastCfg.redTeam) || (lastCfg.blueSquads && lastCfg.redSquads))) {
        Game.fireRange.config = lastCfg;
      }
      initAudio();
      goto(State.FIRE_RANGE);
    }
    else if (a === 'fr-deploy') {
      if (Game.fireRange) {
        // Capture terrain seed from input
        const seedInput = document.getElementById('fr-terrain-seed');
        const seedVal = seedInput?.value?.trim();
        Game.fireRange.config.terrainSeed = seedVal ? parseInt(seedVal, 10) || 0 : null;

        saveFRConfig(Game.fireRange.config);
        stopFireRangeLoop(); // Destroy BattleRenderer BEFORE nulling battle
        Game.fireRange.battle = null;
        Game.fireRange.result = null;
        goto(State.FIRE_RANGE_BATTLE);
      }
    }
    else if (a === 'fr-config') {
      if (Game.fireRange) {
        // Preserve the seed from the current battle so config screen shows it
        if (Game.fireRange.battle?.terrainSeed) {
          Game.fireRange.config.terrainSeed = Game.fireRange.battle.terrainSeed;
        }
        stopFireRangeLoop(); // Destroy BattleRenderer BEFORE nulling battle
        Game.fireRange.battle = null;
        goto(State.FIRE_RANGE);
      }
    }
    else if (a === 'fr-results-dismiss') {
      if (Game.fireRange?.battle) Game.fireRange.battle._showResults = false;
      const el = document.getElementById('fr-results-container');
      if (el) el.remove();
    }
    else if (a === 'fr-toggle-report') {
      const el = document.getElementById('fr-results-container');
      if (el) {
        // Already showing — hide it
        el.remove();
        if (Game.fireRange?.battle) Game.fireRange.battle._showResults = false;
      } else {
        // Show it — generate live stats from current battle state
        const b = Game.fireRange?.battle;
        if (b) {
          b._showResults = true;
          const div = document.createElement('div');
          div.id = 'fr-results-container';
          div.innerHTML = fireRangeResultsHTML(b);
          document.getElementById('app').appendChild(div);
        }
      }
    }
    else if (a === 'fr-reset') {
      if (Game.fireRange) {
        saveFRConfig(Game.fireRange.config);
        stopFireRangeLoop(); // Destroy BattleRenderer BEFORE nulling battle
        Game.fireRange.battle = null;
        Game.fireRange.result = null;
        goto(State.FIRE_RANGE_BATTLE);
      }
    }
    else if (a === 'fr-speed') {
      if (Game.fireRange) {
        Game.fireRange.speed = parseFloat(action.dataset.speed);
        // Update active state on all speed buttons
        const bar = action.closest('.fr-speed-bar');
        if (bar) {
          bar.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === Game.fireRange.speed);
          });
        }
      }
    }
    else if (a === 'fr-map-size') {
      if (Game.fireRange) {
        Game.fireRange.config.mapSize = action.dataset.size;
        render();
      }
    }
    else if (a === 'fr-add') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const si = parseInt(action.dataset.squad || '0', 10);
        const squads = team === Team.BLUE ? (Game.fireRange.config.blueSquads || []) : (Game.fireRange.config.redSquads || []);
        if (squads[si]) {
          squads[si].units.push({ unitId: 'infantry', count: 2, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 });
          render();
        }
      }
    }
    else if (a === 'fr-remove') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        const si = parseInt(action.dataset.squad || '0', 10);
        const squads = team === Team.BLUE ? (Game.fireRange.config.blueSquads || []) : (Game.fireRange.config.redSquads || []);
        if (squads[si]) {
          squads[si].units.splice(idx, 1);
          render();
        }
      }
    }
    // Expand/collapse slot detail
    else if (a === 'fr-expand') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        const si = parseInt(action.dataset.squad || '0', 10);
        const squads = team === Team.BLUE ? (Game.fireRange.config.blueSquads || []) : (Game.fireRange.config.redSquads || []);
        if (squads[si] && squads[si].units[idx]) {
          squads[si].units[idx]._expanded = !squads[si].units[idx]._expanded;
          render();
        }
      }
    }
    // Leader toggle (only one per team)
    else if (a === 'fr-leader') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        const si = parseInt(action.dataset.squad || '0', 10);
        const squads = team === Team.BLUE ? (Game.fireRange.config.blueSquads || []) : (Game.fireRange.config.redSquads || []);
        if (squads[si] && squads[si].units[idx]) {
          const wasLeader = squads[si].units[idx].isLeader;
          for (const sq of squads) for (const slot of sq.units) slot.isLeader = false;
          squads[si].units[idx].isLeader = !wasLeader;
          render();
        }
      }
    }
    // Add new squad
    else if (a === 'fr-squad-add') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
        const squads = team === Team.BLUE ? Game.fireRange.config.blueSquads : Game.fireRange.config.redSquads;
        if (squads && squads.length < 6) {
          squads.push({
            name: SQUAD_NAMES[squads.length] || `Squad ${squads.length + 1}`,
            sergeant: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
            formation: 'line',
            units: [{ unitId: 'infantry', count: 3, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 }]
          });
          render();
        }
      }
    }
    // Remove squad
    else if (a === 'fr-squad-remove') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const si = parseInt(action.dataset.squad, 10);
        const squads = team === Team.BLUE ? Game.fireRange.config.blueSquads : Game.fireRange.config.redSquads;
        if (squads && squads.length > 1 && squads[si]) {
          squads.splice(si, 1);
          render();
        }
      }
    }
    // Expand/collapse squad
    else if (a === 'fr-squad-toggle') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const si = parseInt(action.dataset.squad, 10);
        const squads = team === Team.BLUE ? Game.fireRange.config.blueSquads : Game.fireRange.config.redSquads;
        if (squads && squads[si]) {
          squads[si]._expanded = squads[si]._expanded === false ? true : false;
          render();
        }
      }
    }
    // Debug option toggles on config screen
    else if (a === 'fr-debug-toggle') {
      if (Game.fireRange) {
        const key = action.dataset?.key || action.closest('[data-key]')?.dataset?.key;
        if (key) {
          if (!Game.fireRange.config.debug) Game.fireRange.config.debug = {};
          Game.fireRange.config.debug[key] = !Game.fireRange.config.debug[key];
        }
      }
    }
    // Record toggle on fire range config
    else if (a === 'fr-record-toggle') {
      if (Game.fireRange) {
        const checked = action.closest('label')?.querySelector('input')?.checked;
        Game.fireRange.config.record = checked;
      }
    }
    // Record toggle on campaign planning
    else if (a === 'campaign-record-toggle') {
      if (Game.campaign) {
        const checked = action.closest('label')?.querySelector('input')?.checked;
        Game.campaign._record = checked;
      }
    }
    // Record toggle on endless loadout
    else if (a === 'toggle-endless-record') {
      if (Game.endless) {
        Game.endless._record = !Game.endless._record;
        render();
      }
    }
    // Load test preset
    else if (a === 'fr-preset-load') {
      if (Game.fireRange) {
        const sel = document.querySelector('.fr-preset-select');
        const id = sel?.value;
        if (id && FR_PRESETS[id]) {
          Game.fireRange.config = migrateFRConfig(JSON.parse(JSON.stringify(FR_PRESETS[id])));
          Game.fireRange.scenarioName = id;
          render();
        }
      }
    }
    // Save named config
    else if (a === 'fr-save') {
      if (Game.fireRange) {
        const name = prompt('Save config as:');
        if (name && name.trim()) {
          saveFRNamedConfig(name.trim(), Game.fireRange.config);
          action.textContent = 'Saved!';
          setTimeout(() => { action.textContent = 'Save'; }, 1500);
        }
      }
    }
    // Load named config
    else if (a === 'fr-load') {
      if (Game.fireRange) {
        const saves = loadFRNamedConfigs();
        const names = Object.keys(saves);
        if (names.length === 0) {
          alert('No saved configs');
          return;
        }
        const choice = prompt('Load config:\\n' + names.map((n, i) => `${i + 1}. ${n}`).join('\\n') + '\\n\\nEnter name or number:');
        if (!choice) return;
        let key = choice.trim();
        // Allow selecting by number
        const num = parseInt(key, 10);
        if (num >= 1 && num <= names.length) key = names[num - 1];
        if (saves[key]) {
          Game.fireRange.config = migrateFRConfig(JSON.parse(JSON.stringify(saves[key].config)));
          render();
        } else {
          alert('Config not found: ' + key);
        }
      }
    }
    // Export config as JSON file
    else if (a === 'fr-export') {
      if (Game.fireRange) {
        const json = JSON.stringify(Game.fireRange.config, (k, v) => k === '_expanded' ? undefined : v, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a2 = document.createElement('a');
        a2.href = url;
        a2.download = 'fire-range-config.json';
        a2.click();
        URL.revokeObjectURL(url);
      }
    }
    // Import config from JSON file
    else if (a === 'fr-import') {
      if (Game.fireRange) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
          const file = input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const imported = JSON.parse(reader.result);
              if ((imported.blueTeam && imported.redTeam) || (imported.blueSquads && imported.redSquads)) {
                Game.fireRange.config = migrateFRConfig(imported);
                render();
              } else {
                alert('Invalid config file');
              }
            } catch (err) {
              alert('Failed to parse: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      }
    }
    // Fire Range debug toggles
    else if (a === 'fr-toggle-overlay') {
      const b = Game.fireRange?.battle;
      if (b) {
        b.debugOverlay = !b.debugOverlay;
        const btn = action;
        btn.classList.toggle('active', b.debugOverlay);
      }
    }
    else if (a === 'fr-toggle-terrain-grid') {
      const b = Game.fireRange?.battle;
      if (b) {
        // Cycle: 0 (off) → 1 (density) → 2 (A* grid) → 3 (water depth) → 0
        b.showTerrainGrid = ((b.showTerrainGrid || 0) + 1) % 4;
        const btn = action;
        btn.classList.toggle('active', b.showTerrainGrid >= 1);
        const labels = ['Map', 'Map:D', 'Map:A*', 'Map:W'];
        btn.textContent = labels[b.showTerrainGrid];
      }
    }
    else if (a === 'fr-toggle-panel') {
      const panel = document.getElementById('fr-debug-panel');
      if (panel) panel.classList.toggle('collapsed');
    }
    else if (a === 'event-filter') {
      const b = Game.fireRange?.battle || Game.endless?.battle || Game.campaign?.heroBattle || replayPlayer?.battle;
      if (b) {
        const type = action.dataset.type;
        if (!b._eventFilters) b._eventFilters = {};
        const wasOn = b._eventFilters[type] !== false;
        b._eventFilters[type] = !wasOn;
        action.classList.toggle('active', !wasOn);
      }
    }
    else if (a === 'fr-col-group') {
      const b = Game.fireRange?.battle;
      if (b) {
        const group = action.dataset.group;
        if (!b._hiddenColGroups) b._hiddenColGroups = {};
        b._hiddenColGroups[group] = !b._hiddenColGroups[group];
        action.classList.toggle('active', !b._hiddenColGroups[group]);
      }
    }
    else if (a === 'fr-copy-log') {
      const b = Game.fireRange?.battle;
      if (!b) return;
      const text = formatFireRangeLog(b);
      const name = Game.fireRange.scenarioName || null;
      fetch('/api/debug/fire-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: text, name })
      }).then(r => r.json()).then(() => {
        action.textContent = 'Saved!';
        setTimeout(() => { action.textContent = 'Copy Log'; }, 1500);
      }).catch(() => {
        navigator.clipboard.writeText(text);
        action.textContent = 'Copied!';
        setTimeout(() => { action.textContent = 'Copy Log'; }, 1500);
      });
    }
    // ── Commander overlay actions ──
    else if (a === 'cmdr-select-squad') {
      const b = Game.fireRange?.battle;
      if (!b?._commanderUI) return;
      const sqId = parseInt(action.dataset.squadId, 10);
      const ui = b._commanderUI;
      ui.selectedSquadId = ui.selectedSquadId === sqId ? null : sqId;
      ui.pendingOrder = null;
    }
    else if (a === 'cmdr-order') {
      const b = Game.fireRange?.battle;
      if (!b?._commanderUI) return;
      const ui = b._commanderUI;
      const orderType = action.dataset.order;
      const sqId = ui.selectedSquadId;
      if (sqId === null) return;

      const squad = b._squads?.find(s => s.id === sqId);
      if (!squad?.sergeant) return;

      // Positional orders need a map click target
      if (orderType === Objective.ADVANCE_TO || orderType === Objective.FALL_BACK || orderType === Objective.SUPPORT) {
        ui.pendingOrder = orderType;
        return;
      }

      // Non-positional: assign immediately
      const cmdr = b._teamCommanders?.[squad.team];
      if (cmdr) {
        assignObjective(cmdr, squad.sergeant, { type: orderType }, performance.now(), b);
      }
      // Radio log
      logEvent(b, {
        t: performance.now(), type: 'commander', team: squad.team,
        msg: `Commander orders Squad ${sqId}: ${orderType.toUpperCase()}`
      });
      ui.pendingOrder = null;
    }
    // Toggle collapsible panels
    else if (a === 'toggle-panel') {
      const panel = action.closest('.loadout-panel');
      if (panel) {
        panel.classList.toggle('collapsed');
      }
    }
    // ── Replay Theater actions ──
    else if (a === 'replay-theater') {
      initAudio();
      goto(State.REPLAY_THEATER);
      // Fetch replay list and render
      fetch('/api/replays').then(r => r.json()).then(list => {
        Game._replayCache = list.replays || list;
        Game._replayFilter = 'all';
        const app = document.getElementById('app');
        app.innerHTML = replayTheaterHTML(Game._replayCache, 'all');
      }).catch(() => {
        Game._replayCache = [];
        const app = document.getElementById('app');
        app.innerHTML = replayTheaterHTML([], 'all');
      });
    }
    else if (a === 'replay-filter') {
      const mode = action.dataset.mode || 'all';
      Game._replayFilter = mode;
      const app = document.getElementById('app');
      app.innerHTML = replayTheaterHTML(Game._replayCache || [], mode);
    }
    else if (a === 'replay-purge') {
      fetch('/api/replays?keep=20', { method: 'DELETE' })
        .then(r => r.json())
        .then(result => {
          console.log(`[replay] Purged: ${result.deleted} deleted, ${result.kept} kept`);
          // Refresh theater
          fetch('/api/replays').then(r => r.json()).then(list => {
            document.getElementById('app').innerHTML = replayTheaterHTML(list.replays || list);
          });
        });
    }
    else if (a === 'replay-back') {
      if (replayPlayer) { replayPlayer.destroy(); replayPlayer = null; }
      // Return to battle if we came from debug watch
      const b = Game.endless?.battle;
      if (b?._returnFromReplay) {
        b._returnFromReplay = false;
        b._debugPaused = false;
        goto(State.ENDLESS_BATTLE);
      } else {
        goto(State.MENU);
      }
    }
    else if (a === 'replay-watch') {
      const name = action.dataset.name;
      if (!name) return;
      fetch(`/api/replays/${encodeURIComponent(name)}`).then(r => r.json()).then(async replayData => {
        replayPlayer = new ReplayPlayer();
        await replayPlayer.load(replayData);
        goto(State.REPLAY_PLAYBACK);
        const container = document.getElementById('replay-battlefield');
        if (container) {
          replayPlayer.initRenderer(container);
          // Set up time update callback
          replayPlayer.onTimeUpdate((currentMs, durationMs) => {
            const scrubber = document.getElementById('replay-scrubber');
            const timeEl = document.getElementById('replay-time');
            if (scrubber && durationMs > 0) {
              scrubber.value = Math.round((currentMs / durationMs) * 1000);
            }
            if (timeEl) {
              const cur = formatReplayTime(currentMs);
              const dur = formatReplayTime(durationMs);
              timeEl.textContent = `${cur} / ${dur}`;
            }
            // Update play/pause button text
            const playBtn = document.getElementById('replay-play-btn');
            if (playBtn) playBtn.textContent = replayPlayer.playing ? 'Pause' : 'Play';
            // Update event log sidebar (filter to current playback time)
            const logEl = document.getElementById('replay-event-log');
            if (logEl && replayPlayer.battle) updateEventLog(logEl, replayPlayer.battle, currentMs);
          });
          replayPlayer.onEnd(() => {
            const playBtn = document.getElementById('replay-play-btn');
            if (playBtn) playBtn.textContent = 'Play';
          });
          replayPlayer.play();
        }
      }).catch(err => {
        console.error('Failed to load replay:', err);
      });
    }
    else if (a === 'replay-delete') {
      const name = action.dataset.name;
      if (!name) return;
      fetch(`/api/replays/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(() => {
        // Refresh the list
        return fetch('/api/replays').then(r => r.json());
      }).then(list => {
        Game._replayCache = list.replays || list;
        const app = document.getElementById('app');
        app.innerHTML = replayTheaterHTML(Game._replayCache, Game._replayFilter || 'all');
      }).catch(err => {
        console.error('Failed to delete replay:', err);
      });
    }
    else if (a === 'replay-play-pause') {
      if (replayPlayer) {
        if (replayPlayer.playing) {
          replayPlayer.pause();
          action.textContent = 'Play';
        } else {
          replayPlayer.play();
          action.textContent = 'Pause';
        }
      }
    }
    else if (a === 'replay-step-fwd') {
      if (replayPlayer) { replayPlayer.pause(); replayPlayer.stepForward(); }
    }
    else if (a === 'replay-step-back') {
      if (replayPlayer) { replayPlayer.pause(); replayPlayer.stepBackward(); }
    }
    else if (a === 'replay-skip-start') {
      if (replayPlayer) { replayPlayer.seekTo(0); }
    }
    else if (a === 'replay-skip-end') {
      if (replayPlayer) { replayPlayer.seekTo(replayPlayer.getDuration()); }
    }
    else if (a === 'replay-speed') {
      if (replayPlayer) {
        const spd = parseFloat(action.dataset.speed);
        replayPlayer.setSpeed(spd);
        // Update active state on speed buttons
        const bar = action.closest('.replay-speeds');
        if (bar) {
          bar.querySelectorAll('button[data-action="replay-speed"]').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === spd);
          });
        }
      }
    }
    else if (a === 'replay-toggle-overlay') {
      if (replayPlayer?.battle) {
        replayPlayer.battle.debugOverlay = !replayPlayer.battle.debugOverlay;
        action.classList.toggle('active', replayPlayer.battle.debugOverlay);
      }
    }
    else if (a === 'replay-toggle-vision') {
      if (replayPlayer?.battle) {
        replayPlayer.battle.showVision = !replayPlayer.battle.showVision;
        action.classList.toggle('active', replayPlayer.battle.showVision);
      }
    }
    else if (a === 'replay-toggle-terrain-grid') {
      const b = replayPlayer?.battle;
      if (b) {
        b.showTerrainGrid = ((b.showTerrainGrid || 0) + 1) % 4;
        action.classList.toggle('active', b.showTerrainGrid >= 1);
        action.textContent = ['Map', 'Map:D', 'Map:A*', 'Map:W'][b.showTerrainGrid];
      }
    }
    else if (a === 'replay-exit') {
      if (replayPlayer) { replayPlayer.destroy(); replayPlayer = null; }
      goto(State.REPLAY_THEATER);
      // Re-fetch and render list
      fetch('/api/replays').then(r => r.json()).then(list => {
        const app = document.getElementById('app');
        app.innerHTML = replayTheaterHTML(list.replays || list);
      }).catch(() => {
        const app = document.getElementById('app');
        app.innerHTML = replayTheaterHTML([]);
      });
    }
    return;
  }

  // Settings
  const set = e.target.closest('[data-set]');
  if (set) {
    Game.settings[set.dataset.set] = set.dataset.val;
    save();
    render();
    return;
  }

  // Toggle
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    if (tog.dataset.toggle === 'sound') Game.settings.sound = !Game.settings.sound;
    save();
    render();
    return;
  }

  // Lane slots
  const slot = e.target.closest('[data-slot]');
  if (slot && Game.state === State.BATTLE) {
    const i = parseInt(slot.dataset.slot);
    if (Game.subState === SubState.LANE_SELECT && Game.battle.selectedLane === i) {
      setSubState(SubState.PLAYING);
    } else {
      setSubState(SubState.LANE_SELECT, { lane: i });
    }
    return;
  }

  // Unit switch (battle)
  const sw = e.target.closest('[data-switch]');
  if (sw && Game.battle && Game.battle.selectedLane !== null) {
    switchUnit(Game.battle.selectedLane, parseInt(sw.dataset.switch));
    return;
  }

  // HQ Tab switching
  const hqTab = e.target.closest('[data-hq-tab]');
  if (hqTab && Game.state === State.HQ) {
    Game.hqTab = hqTab.dataset.hqTab;
    Game.hqSelectedUnit = null;  // Clear unit selection when switching tabs
    render();
    // Initialize insignia editor when tab opens
    if (Game.hqTab === HQTab.INSIGNIA) {
      setTimeout(() => initInsigniaTab(), 0);
    }
    return;
  }

  // HQ Lineup slot selection
  const lineupSlot = e.target.closest('[data-lineup-slot]');
  if (lineupSlot && Game.state === State.HQ) {
    const slot = parseInt(lineupSlot.dataset.lineupSlot);
    Game.hqSelectedSlot = Game.hqSelectedSlot === slot ? null : slot;
    render();
    return;
  }

  // HQ Lineup unit assignment
  const lineupUnit = e.target.closest('[data-lineup-unit]');
  if (lineupUnit && Game.state === State.HQ && Game.hqSelectedSlot !== null) {
    const unitIdx = parseInt(lineupUnit.dataset.lineupUnit);
    const unit = UNITS[unitIdx];
    // Check if unit is unlocked (or if in versus mode, all are available)
    const isUnlocked = unit.unlockCost === null ||
                       Game.player.unlockedUnits.includes(unit.id) ||
                       Game.settings.mode === 'versus';
    if (isUnlocked) {
      Game.player.lineup[Game.hqSelectedSlot] = unitIdx;
      Game.hqSelectedSlot = null;
      save();
      render();
    }
    return;
  }

  // HQ Unit unlock
  const unlock = e.target.closest('[data-unlock]');
  if (unlock && Game.state === State.HQ) {
    const unitId = unlock.dataset.unlock;
    const unit = UNITS.find(u => u.id === unitId);
    if (unit && unit.unlockCost) {
      const cost = unit.unlockCost;
      if (Game.resources.scrap >= cost.scrap && Game.resources.parts >= cost.parts) {
        Game.resources.scrap -= cost.scrap;
        Game.resources.parts -= cost.parts;
        Game.player.unlockedUnits.push(unitId);
        save();
        render();
      }
    }
    return;
  }

  // Firing Range - tap targets to fire (must be before unit card selection)
  const rangeTarget = e.target.closest('.range-target');
  if (rangeTarget && Game.state === State.HQ) {
    const range = rangeTarget.closest('.firing-range');
    const field = range.querySelector('.range-field');
    const projectilesContainer = range.querySelector('.range-projectiles');
    const unitEl = range.querySelector('.range-unit');

    // Get unit and projectile info
    const unitIdx = parseInt(range.dataset.rangeUnit);
    const unit = UNITS[unitIdx];
    const projType = UNIT_PROJECTILES[unit.id];
    const projDef = PROJECTILES[projType];

    // Get positions
    const fieldRect = field.getBoundingClientRect();
    const unitRect = unitEl.getBoundingClientRect();
    const targetRect = rangeTarget.getBoundingClientRect();

    const startX = unitRect.left + unitRect.width / 2 - fieldRect.left;
    const startY = unitRect.top - fieldRect.top + 10;
    const endX = targetRect.left + targetRect.width / 2 - fieldRect.left;
    const endY = targetRect.top + targetRect.height / 2 - fieldRect.top;

    // Calculate angle for projectile rotation
    const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI) + 90;

    // Play shoot sound
    sound('shoot');

    // Create muzzle flash
    const muzzle = document.createElement('div');
    muzzle.className = 'range-muzzle';
    muzzle.style.cssText = `
      left: ${startX}px;
      top: ${startY}px;
      width: ${projDef.muzzleFlash.size}px;
      height: ${projDef.muzzleFlash.size}px;
      background: ${projDef.color};
      box-shadow: 0 0 ${projDef.muzzleFlash.size}px ${projDef.color};
    `;
    projectilesContainer.appendChild(muzzle);
    setTimeout(() => muzzle.remove(), 150);

    // Create projectile
    const proj = document.createElement('div');
    proj.className = 'range-projectile';
    proj.style.cssText = `
      left: ${startX}px;
      top: ${startY}px;
      width: ${projDef.width}px;
      height: ${projDef.height}px;
      background: ${projDef.color};
      box-shadow: 0 0 ${projDef.width * 2}px ${projDef.color};
      transform: rotate(${angle}deg);
      transition: left 0.3s linear, top 0.3s linear;
    `;
    projectilesContainer.appendChild(proj);

    // Animate projectile to target
    requestAnimationFrame(() => {
      proj.style.left = `${endX}px`;
      proj.style.top = `${endY}px`;
    });

    // Impact effect
    setTimeout(() => {
      proj.remove();

      // Create impact
      const impact = document.createElement('div');
      impact.className = 'range-impact';
      impact.style.cssText = `
        left: ${endX}px;
        top: ${endY}px;
        width: ${12 + unit.damage * 0.3}px;
        height: ${12 + unit.damage * 0.3}px;
        background: ${projDef.color};
        box-shadow: 0 0 ${10 + unit.damage * 0.2}px ${projDef.color};
      `;
      projectilesContainer.appendChild(impact);
      setTimeout(() => impact.remove(), 250);

      // Shake target
      rangeTarget.classList.add('hit');
      setTimeout(() => rangeTarget.classList.remove('hit'), 300);
    }, 300);

    return;
  }

  // HQ Unit card selection (for details panel)
  const unitCard = e.target.closest('[data-unit-idx]');
  if (unitCard && Game.state === State.HQ) {
    const idx = parseInt(unitCard.dataset.unitIdx);
    Game.hqSelectedUnit = (Game.hqSelectedUnit === idx) ? null : idx;
    render();
    return;
  }

  // HQ Close details panel (X button or clicking overlay background)
  if (Game.state === State.HQ && Game.hqSelectedUnit !== null) {
    const closeBtn = e.target.closest('[data-close-details]');
    const overlay = e.target.closest('.unit-details-overlay');
    const modal = e.target.closest('.unit-details-modal');

    // Close if clicking X button OR clicking overlay but not inside modal
    if (closeBtn || (overlay && !modal)) {
      Game.hqSelectedUnit = null;
      render();
      return;
    }
  }

  // HQ Unit upgrade
  const upgrade = e.target.closest('[data-upgrade]');
  if (upgrade && Game.state === State.HQ) {
    const [unitId, stat] = upgrade.dataset.upgrade.split(':');
    const unit = UNITS.find(u => u.id === unitId);
    if (unit && unit.upgrades && unit.upgrades[stat]) {
      // Initialize upgrades for this unit if needed
      if (!Game.player.upgrades[unitId]) {
        Game.player.upgrades[unitId] = { damage: 0, fireRate: 0 };
      }
      const currentLevel = Game.player.upgrades[unitId][stat];
      const upgradeData = unit.upgrades[stat];
      if (currentLevel < upgradeData.levels.length - 1) {
        const cost = upgradeData.costs[currentLevel + 1];
        if (Game.resources.scrap >= cost) {
          Game.resources.scrap -= cost;
          Game.player.upgrades[unitId][stat]++;
          save();
          render();
        }
      }
    }
    return;
  }

  // H2H Remove wave
  const removeWave = e.target.closest('[data-wave-remove]');
  if (removeWave && Game.state === State.H2H_DESIGN) {
    e.stopPropagation();
    const index = parseInt(removeWave.dataset.waveRemove);
    removeH2HWave(index);
    // Clear selection if we removed the selected wave
    if (Game.h2h.selectedWave === index) {
      Game.h2h.selectedWave = null;
    } else if (Game.h2h.selectedWave > index) {
      Game.h2h.selectedWave--;
    }
    render();
    return;
  }

  // H2H Wave slot selection (tap slot to open picker)
  const waveSlot = e.target.closest('[data-wave-slot]');
  if (waveSlot && Game.state === State.H2H_DESIGN) {
    const [waveIdx, laneIdx] = waveSlot.dataset.waveSlot.split('-').map(Number);
    // Toggle selection if already selected
    if (Game.h2h.selectedWave === waveIdx && Game.h2hWaveLane === laneIdx) {
      Game.h2h.selectedWave = null;
      Game.h2hWaveLane = undefined;
    } else {
      Game.h2h.selectedWave = waveIdx;
      Game.h2hWaveLane = laneIdx;
      Game.h2hDefenseSlot = undefined;
    }
    render();
    return;
  }

  // H2H Set lane unit (in expanded editor)
  const setLane = e.target.closest('[data-set-lane]');
  if (setLane && Game.state === State.H2H_DESIGN) {
    const parts = setLane.dataset.setLane.split('-');
    const waveIdx = parseInt(parts[0]);
    const laneIdx = parseInt(parts[1]);
    const unitVal = parts[2];

    if (unitVal === 'none') {
      clearH2HWaveLane(waveIdx, laneIdx);
    } else {
      setH2HWaveUnit(waveIdx, laneIdx, parseInt(unitVal));
    }
    render();
    return;
  }

  // H2H Defense slot selection
  const defenseSlot = e.target.closest('[data-h2h-defense-slot]');
  if (defenseSlot && Game.state === State.H2H_DESIGN) {
    const slot = parseInt(defenseSlot.dataset.h2hDefenseSlot);
    Game.h2hDefenseSlot = Game.h2hDefenseSlot === slot ? undefined : slot;
    // Close wave picker if open
    Game.h2h.selectedWave = null;
    Game.h2hWaveLane = undefined;
    render();
    return;
  }

  // H2H Defense unit selection
  const defenseUnit = e.target.closest('[data-h2h-defense-unit]');
  if (defenseUnit && Game.state === State.H2H_DESIGN && Game.h2hDefenseSlot !== undefined) {
    const unitIdx = parseInt(defenseUnit.dataset.h2hDefenseUnit);
    setH2HDefense(Game.h2hDefenseSlot, unitIdx);
    Game.h2hDefenseSlot = undefined;
    render();
    return;
  }
});

// Debug: expose Game + roster helpers to console
window._game = Game;
window._debug = {
  setRank: (id, rank) => { const s = getSoldier(id); if (s) { debugSetRank(s, rank); saveRoster(); } },
  setMMR: (id, mmr) => { const s = getSoldier(id); if (s) { debugSetMMR(s, mmr); saveRoster(); } },
  setPhysicals: (id, p) => { const s = getSoldier(id); if (s) { debugSetPhysicals(s, p); saveRoster(); } },
  setTraining: (id, role, lvl) => { const s = getSoldier(id); if (s) { debugSetTraining(s, role, lvl); saveRoster(); } },
  setAllTraining: (id, lvl) => { const s = getSoldier(id); if (s) { debugSetAllTraining(s, lvl); saveRoster(); } },
  maxSoldier: (id) => { const s = getSoldier(id); if (s) { debugMaxSoldier(s); saveRoster(); } },
  resetSoldier: (id) => { const s = getSoldier(id); if (s) { debugResetSoldier(s); saveRoster(); } },
  getSoldier,
  roster: () => Game.roster,
  godMode: (on = true) => {
    const b = Game.endless?.battle;
    if (b?.hero) { b.hero._godMode = on; console.log(`God mode ${on ? 'ON' : 'OFF'}`); }
    else console.warn('No active battle/hero');
  }
};

// Change events (for dropdowns)
document.getElementById('app').addEventListener('change', e => {
  // Insignia editor checkboxes (flipX, flipY, fillEnabled)
  if (Game.state === State.HQ && Game.hqTab === HQTab.INSIGNIA) {
    if (handleInsigniaInput(e.target)) return;
  }

  // Operations wave select
  if (e.target.closest('.ops-wave-select') && Game.state === State.HQ) {
    if (Game.opsConfig) Game.opsConfig.startWave = parseInt(e.target.value) || 1;
    return;
  }

  // Priority dropdown in radio panel
  if (e.target.closest('.priority-dropdown') && Game.state === State.CAMPAIGN_BATTLE) {
    const b = Game.campaign?.heroBattle;
    if (b) {
      setUnitPriority(b, e.target.value);
      render();
    }
    return;
  }

  // Variant select in endless loadout
  if ((e.target.closest('.variant-select') || e.target.closest('.header-variant-select')) && Game.state === State.ENDLESS_LOADOUT) {
    if (Game.endless && Game.endless.loadout.vehicle) {
      const variantName = e.target.value;
      Game.endless.loadout.variant = variantName;
      // Fetch variant data for parts display
      fetchVariantData(Game.endless.loadout.vehicle, variantName).then(() => render());
    }
    return;
  }

  // Mode select in endless loadout
  if (e.target.closest('.header-mode-select') && Game.state === State.ENDLESS_LOADOUT) {
    if (Game.endless) {
      if (e.target.value === 'weekly') {
        const now = new Date();
        const weekNum = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
        Game.endless.seed = `week-${weekNum}`;
      } else {
        Game.endless.seed = null;
      }
      render();
    }
    return;
  }

  // Fire Range config selects, count inputs, and formation selects
  if (Game.state === State.FIRE_RANGE && Game.fireRange) {
    const cfg = Game.fireRange.config;
    const fmtSel = e.target.closest('.fr-squad-formation');
    if (fmtSel) {
      const team = fmtSel.dataset.team;
      const si = parseInt(fmtSel.dataset.squad, 10);
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si]) squads[si].formation = fmtSel.value;
    }
    const sel = e.target.closest('.fr-select');
    const cnt = e.target.closest('.fr-count');
    if (sel) {
      const team = sel.dataset.team;
      const idx = parseInt(sel.dataset.idx, 10);
      const si = parseInt(sel.dataset.squad || '0', 10);
      const field = sel.dataset.field;
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si] && squads[si].units[idx]) {
        squads[si].units[idx][field] = sel.value;
        if (field === 'unitId') delete squads[si].units[idx].enemyType;

        // Personality preset selected — fill trait sliders with preset values
        if (field === 'personalityPreset' && sel.value !== 'custom') {
          const preset = PERSONALITY_PRESETS[sel.value];
          if (preset) {
            const slot = squads[si].units[idx];
            for (const [k, v] of Object.entries(preset.traits)) {
              slot[k] = v;
            }
            // Update slider UI without full re-render
            const detail = sel.closest('.fr-slot-detail');
            if (detail) {
              detail.querySelectorAll('.fr-slider').forEach(s => {
                const f = s.dataset.field;
                if (preset.traits[f] !== undefined) {
                  s.value = preset.traits[f];
                  const valSpan = s.parentElement.querySelector('.fr-slider-val');
                  if (valSpan) valSpan.textContent = preset.traits[f].toFixed(2);
                }
              });
            }
          }
        }
      }
    }
    if (cnt) {
      const team = cnt.dataset.team;
      const idx = parseInt(cnt.dataset.idx, 10);
      const si = parseInt(cnt.dataset.squad || '0', 10);
      const val = Math.max(1, Math.min(20, parseInt(cnt.value, 10) || 1));
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si] && squads[si].units[idx]) squads[si].units[idx].count = val;
    }
    return;
  }
});

// Input events (for range sliders and fire range counts)
document.getElementById('app').addEventListener('input', e => {
  // Replay scrubber
  if (e.target.id === 'replay-scrubber' && replayPlayer) {
    const pct = parseInt(e.target.value, 10) / 1000;
    const targetMs = pct * replayPlayer.getDuration();
    replayPlayer.seekTo(targetMs);
    return;
  }
  // Insignia editor sliders / toggles / color pickers
  if (Game.state === State.HQ && Game.hqTab === HQTab.INSIGNIA) {
    if (handleInsigniaInput(e.target)) return;
  }

  // Fire Range slider + count inputs
  if (Game.state === State.FIRE_RANGE && Game.fireRange) {
    const cfg = Game.fireRange.config;
    // Commander trait sliders
    const cmdSlider = e.target.closest('.fr-cmd-slider');
    if (cmdSlider) {
      const team = cmdSlider.dataset.cmdTeam;
      const trait = cmdSlider.dataset.cmdTrait;
      const val = parseFloat(cmdSlider.value);
      const cmdConfig = team === Team.BLUE ? cfg.blueCommander : cfg.redCommander;
      if (cmdConfig) {
        if (!cmdConfig.personality) cmdConfig.personality = {};
        cmdConfig.personality[trait] = val;
      }
      const valSpan = cmdSlider.parentElement.querySelector('.fr-slider-val');
      if (valSpan) valSpan.textContent = val.toFixed(2);
      return;
    }
    // Sergeant trait sliders
    const sgtSlider = e.target.closest('.fr-sgt-slider');
    if (sgtSlider) {
      const team = sgtSlider.dataset.sgtTeam;
      const trait = sgtSlider.dataset.sgtTrait;
      const val = parseFloat(sgtSlider.value);
      const si = parseInt(sgtSlider.dataset.squad || '0', 10);
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si]) {
        if (!squads[si].sergeant) squads[si].sergeant = {};
        squads[si].sergeant[trait] = val;
      }
      const valSpan = sgtSlider.parentElement.querySelector('.fr-slider-val');
      if (valSpan) valSpan.textContent = val.toFixed(2);
      return;
    }

    const slider = e.target.closest('.fr-slider');
    if (slider) {
      const team = slider.dataset.team;
      const idx = parseInt(slider.dataset.idx, 10);
      const si = parseInt(slider.dataset.squad || '0', 10);
      const field = slider.dataset.field;
      const val = parseFloat(slider.value);
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si] && squads[si].units[idx]) {
        squads[si].units[idx][field] = val;
        const valSpan = slider.parentElement.querySelector('.fr-slider-val');
        if (valSpan) valSpan.textContent = val.toFixed(2);
        // If user manually changes a personality trait, switch preset to Custom
        const traitKeys = ['aggression','patience','courage','discipline','initiative','awareness'];
        if (traitKeys.includes(field)) {
          squads[si].units[idx].personalityPreset = 'custom';
          const presetSel = slider.closest('.fr-slot-detail')?.querySelector('.fr-personality-preset');
          if (presetSel) presetSel.value = 'custom';
        }
      }
      return;
    }
    // Count inputs
    const cnt = e.target.closest('.fr-count');
    if (cnt) {
      const team = cnt.dataset.team;
      const idx = parseInt(cnt.dataset.idx, 10);
      const si = parseInt(cnt.dataset.squad || '0', 10);
      const val = Math.max(1, Math.min(20, parseInt(cnt.value, 10) || 1));
      const squads = team === Team.BLUE ? cfg.blueSquads : cfg.redSquads;
      if (squads && squads[si] && squads[si].units[idx]) squads[si].units[idx].count = val;
      return;
    }
  }
  // Control settings sliders
  const slider = e.target.closest('[data-control]');
  if (slider && Game.state === State.SETTINGS) {
    const key = slider.dataset.control;
    const value = parseInt(slider.value);
    Game.settings.controls = Game.settings.controls || {};
    Game.settings.controls[key] = value;
    save();
    render();
    return;
  }
});

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN INPUT HANDLERS
// ═══════════════════════════════════════════════════════════════
// NOTE: Touch gestures moved to gestures.js module

// Keyboard events for campaign battle
// Debug panel: watch replay event
window.addEventListener('debug-watch-replay', async (e) => {
  const name = e.detail?.name;
  if (!name) return;
  try {
    const replayData = await fetch(`/api/replays/${encodeURIComponent(name)}`).then(r => r.json());
    replayPlayer = new ReplayPlayer();
    await replayPlayer.load(replayData);
    stopLoop();
    goto(State.REPLAY_PLAYBACK);
    const container = document.getElementById('replay-battlefield');
    if (container) {
      replayPlayer.initRenderer(container);
      replayPlayer.onTimeUpdate((currentMs, durationMs) => {
        const scrubber = document.getElementById('replay-scrubber');
        if (scrubber) scrubber.value = (currentMs / durationMs) * 100;
        const timeEl = document.getElementById('replay-time');
        if (timeEl) {
          const cur = Math.floor(currentMs / 1000);
          const dur = Math.floor(durationMs / 1000);
          timeEl.textContent = `${Math.floor(cur/60)}:${(cur%60).toString().padStart(2,'0')} / ${Math.floor(dur/60)}:${(dur%60).toString().padStart(2,'0')}`;
        }
      });
      replayPlayer.play();
    }
  } catch (err) {
    console.error('[debug] Failed to load replay:', err);
  }
});

document.addEventListener('keydown', e => {
  // Insignia editor keyboard shortcuts (Ctrl+C/V/A/D, Delete)
  if (Game.state === State.HQ && Game.hqTab === HQTab.INSIGNIA) {
    if (handleInsigniaKeyDown(e)) return;
  }
  if (Game.state === State.CAMPAIGN_BATTLE) {
    campaignKeyDown(e.key);
  }
  // Endless mode keyboard
  if (Game.state === State.ENDLESS_BATTLE) {
    // Prevent Tab from switching focus in CMD mode
    const eb = Game.endless?.battle;
    if (eb?.playMode === 'cmd' && (e.key === 'Tab' || e.key === 'Escape')) {
      e.preventDefault();
    }
    endlessKeyDown(e.key);
  }
  // Fire Range keyboard (camera pan)
  if (Game.state === State.FIRE_RANGE_BATTLE) {
    fireRangeKeyDown(e.key);
  }
  // Replay playback camera
  if (Game.state === State.REPLAY_PLAYBACK && replayPlayer?.battle) {
    cameraKeyDown(replayPlayer.battle, e.key);
  }
});

document.addEventListener('keyup', e => {
  if (Game.state === State.HQ && Game.hqTab === HQTab.INSIGNIA) {
    handleInsigniaKeyUp(e);
  }
  if (Game.state === State.CAMPAIGN_BATTLE) {
    campaignKeyUp(e.key);
  }
  // Endless mode keyboard
  if (Game.state === State.ENDLESS_BATTLE) {
    endlessKeyUp(e.key);
  }
  // Fire Range keyboard
  if (Game.state === State.FIRE_RANGE_BATTLE) {
    fireRangeKeyUp(e.key);
  }
  // Replay playback
  if (Game.state === State.REPLAY_PLAYBACK && replayPlayer?.battle) {
    cameraKeyUp(replayPlayer.battle, e.key);
  }
});

// Mouse events for campaign battle
document.addEventListener('mousemove', e => {
  if (Game.state === State.CAMPAIGN_BATTLE) {
    const bf = document.querySelector('.campaign-battlefield');
    if (bf) {
      const rect = bf.getBoundingClientRect();
      campaignMouseMove(e.clientX - rect.left, e.clientY - rect.top);
    }
  }
  // Endless mode mouse
  if (Game.state === State.ENDLESS_BATTLE) {
    const bf = document.querySelector('.endless-battlefield');
    if (bf) {
      const rect = bf.getBoundingClientRect();
      endlessMouseMove(e.clientX - rect.left, e.clientY - rect.top);
    }
  }
});

document.addEventListener('mousedown', e => {
  if (Game.state === State.CAMPAIGN_BATTLE && e.button === 0) {
    battleMouseDown();
  }
  // Endless mode mouse
  if (Game.state === State.ENDLESS_BATTLE && e.button === 0) {
    const eb = Game.endless?.battle;
    if (eb?.phase === 'deploying') {
      // Deployment phase: route clicks to zone selection
      const bf = document.querySelector('.endless-battlefield');
      if (bf) {
        const rect = bf.getBoundingClientRect();
        handleDeployClick(eb, e.clientX - rect.left, e.clientY - rect.top, e.ctrlKey);
      }
    } else if (eb?.playMode === 'cmd' && eb?.phase === 'active') {
      // CMD mode: route clicks to squad selection / commands
      const bf = document.querySelector('.endless-battlefield');
      if (bf) {
        const rect = bf.getBoundingClientRect();
        handleCMDClick(eb, e.clientX - rect.left, e.clientY - rect.top, e.ctrlKey);
      }
    } else {
      endlessMouseDown();
    }
  }
});

document.addEventListener('mouseup', e => {
  if (Game.state === State.CAMPAIGN_BATTLE && e.button === 0) {
    battleMouseUp();
  }
  // Endless mode mouse
  if (Game.state === State.ENDLESS_BATTLE && e.button === 0) {
    endlessMouseUp();
  }
  // End grid panning
  if (Game.state === State.CAMPAIGN_PLANNING) {
    const plan = Game.campaign?.battlePlan;
    if (plan) plan.isPanning = false;
  }
});

// Mouse wheel zoom for fire range and replay
document.addEventListener('wheel', e => {
  // Scrollable panel regions — works in any battle mode
  {
    const bf = document.querySelector('.endless-battlefield');
    if (bf && bf.contains(e.target)) {
      let b = null;
      if (Game.state === State.FIRE_RANGE_BATTLE) b = Game.fireRange?.battle;
      else if (Game.state === State.ENDLESS_BATTLE) b = Game.endless?.battle;
      else if (Game.state === State.CAMPAIGN_BATTLE) b = Game.campaign?.heroBattle;
      if (b) {
        const rect = bf.getBoundingClientRect();
        const canvas = bf.querySelector('canvas') || bf;
        const scaleX = (canvas.width || rect.width) / rect.width;
        const scaleY = (canvas.height || rect.height) / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top) * scaleY;
        if (handlePanelWheel(b, cx, cy, e.deltaY)) {
          e.preventDefault();
          return;
        }
      }
    }
  }
  if (Game.state === State.FIRE_RANGE_BATTLE) {
    const bf = document.querySelector('.endless-battlefield');
    if (bf && bf.contains(e.target)) {
      e.preventDefault();
      fireRangeWheel(e.deltaY);
    }
  }
  if (Game.state === State.ENDLESS_BATTLE) {
    const bf = document.querySelector('.endless-battlefield');
    if (bf && bf.contains(e.target)) {
      const b = Game.endless?.battle;
      if (b) {
        e.preventDefault();
        // Clamp zoom between 1.0 and 1.5 for hero mode
        const current = b.camera.userZoom || 1;
        const step = e.deltaY > 0 ? -0.05 : 0.05;
        b.camera.userZoom = Math.max(0.8, Math.min(1.5, current + step));
      }
    }
  }
  if (Game.state === State.REPLAY_PLAYBACK && replayPlayer?.battle) {
    const bf = document.getElementById('replay-battlefield');
    if (bf && bf.contains(e.target)) {
      e.preventDefault();
      cameraZoom(replayPlayer.battle, e.deltaY);
    }
  }
}, { passive: false });

// Middle-mouse drag pan for all battle modes + replay
function getBattleForPan() {
  if (Game.state === State.FIRE_RANGE_BATTLE) return Game.fireRange?.battle;
  if (Game.state === State.CAMPAIGN_BATTLE)   return Game.campaign?.heroBattle;
  if (Game.state === State.ENDLESS_BATTLE)    return Game.endless?.battle;
  if (Game.state === State.REPLAY_PLAYBACK)   return replayPlayer?.battle;
  return null;
}

document.addEventListener('mousedown', e => {
  if (e.button !== 1) return; // middle mouse only
  const b = getBattleForPan();
  if (!b) return;
  e.preventDefault();
  cameraPanStart(b, e.clientX, e.clientY);
});

document.addEventListener('mousemove', e => {
  const b = getBattleForPan();
  if (!b || !b.camera._dragPan) return;
  cameraPanMove(b, e.clientX, e.clientY);
});

document.addEventListener('mouseup', e => {
  if (e.button !== 1) return;
  const b = getBattleForPan();
  if (!b) return;
  cameraPanEnd(b);
});

// ═══════════════════════════════════════════════════════════════
// MOBILE TOUCH CONTROLS
// ═══════════════════════════════════════════════════════════════

// Detect mobile
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

// Aim joystick settings
const AIM_JOYSTICK_MAX_RANGE = 80;  // Max drag distance in pixels
const AIM_FIRE_DEADZONE = 0.3;      // 0-30% = aim only, 30-100% = aim + fire

// Hold timer for repositioning joysticks
let joystickHoldTimer = null;
let joystickHoldTouchId = null;
let joystickHoldX = 0;
let joystickHoldY = 0;
const JOYSTICK_HOLD_MS = 1000;  // 1 second hold to reposition

function isHeroBattle() {
  return Game.state === State.CAMPAIGN_BATTLE || Game.state === State.ENDLESS_BATTLE;
}

// Handle joystick touch start - set PENDING if near anchor (activate on drag)
document.addEventListener('touchstart', e => {
  if (!isHeroBattle()) return;

  for (const touch of e.changedTouches) {
    const nearAnchor = getNearJoystickAnchor(touch.clientX, touch.clientY);

    if (nearAnchor === 'move' && !moveJoystick.active && !moveJoystick.pending) {
      // Set pending - will activate if user drags
      moveJoystick.pending = true;
      moveJoystick.startX = touch.clientX;
      moveJoystick.startY = touch.clientY;
      moveJoystick.currentX = touch.clientX;
      moveJoystick.currentY = touch.clientY;
      moveJoystick.touchId = touch.identifier;
      // Don't preventDefault - let gesture system also see this touch
    } else if (nearAnchor === 'shoot' && !shootJoystick.active && !shootJoystick.pending) {
      // Set pending - will activate if user drags
      shootJoystick.pending = true;
      shootJoystick.startX = touch.clientX;
      shootJoystick.startY = touch.clientY;
      shootJoystick.currentX = touch.clientX;
      shootJoystick.currentY = touch.clientY;
      shootJoystick.touchId = touch.identifier;
      shootJoystick.firing = false;
      // Don't preventDefault - let gesture system also see this touch
    } else if (!nearAnchor && !joystickHoldTimer) {
      // Not near a joystick - start hold timer for repositioning
      joystickHoldTouchId = touch.identifier;
      joystickHoldX = touch.clientX;
      joystickHoldY = touch.clientY;
      joystickHoldTimer = setTimeout(() => {
        // Determine which joystick to move based on screen side
        const which = getClosestJoystickSide(joystickHoldX);
        setJoystickAnchor(which, joystickHoldX, joystickHoldY);

        // Visual feedback
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

        // Show brief feedback
        const b = Game.campaign?.heroBattle;
        if (b) {
          b.commandFeedback = {
            text: which === 'move' ? '🕹️ Move joystick placed' : '🎯 Aim joystick placed',
            time: Date.now()
          };
        }

        joystickHoldTimer = null;
        joystickHoldTouchId = null;
      }, JOYSTICK_HOLD_MS);
    }
  }
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!isHeroBattle()) return;

  for (const touch of e.changedTouches) {
    // Cancel joystick repositioning if touch moves
    if (joystickHoldTimer && touch.identifier === joystickHoldTouchId) {
      const dx = touch.clientX - joystickHoldX;
      const dy = touch.clientY - joystickHoldY;
      if (Math.sqrt(dx * dx + dy * dy) > 15) {
        clearTimeout(joystickHoldTimer);
        joystickHoldTimer = null;
        joystickHoldTouchId = null;
      }
    }

    // Check if pending move joystick should activate (dragged enough)
    if (moveJoystick.pending && touch.identifier === moveJoystick.touchId) {
      const dx = touch.clientX - moveJoystick.startX;
      const dy = touch.clientY - moveJoystick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > getDragThreshold()) {
        // Activate the joystick
        moveJoystick.pending = false;
        moveJoystick.active = true;
        moveJoystick.currentX = touch.clientX;
        moveJoystick.currentY = touch.clientY;
        updateJoystickInput();
        e.preventDefault();
      }
    }

    // Check if pending shoot joystick should activate (dragged enough)
    if (shootJoystick.pending && touch.identifier === shootJoystick.touchId) {
      const dx = touch.clientX - shootJoystick.startX;
      const dy = touch.clientY - shootJoystick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > getDragThreshold()) {
        // Activate the joystick
        shootJoystick.pending = false;
        shootJoystick.active = true;
        shootJoystick.currentX = touch.clientX;
        shootJoystick.currentY = touch.clientY;
        updateShootJoystickVisual();
        e.preventDefault();
      }
    }

    // Update movement joystick
    if (moveJoystick.active && touch.identifier === moveJoystick.touchId) {
      moveJoystick.currentX = touch.clientX;
      moveJoystick.currentY = touch.clientY;
      updateJoystickInput();
      e.preventDefault();
    }

    // Update shoot joystick
    if (shootJoystick.active && touch.identifier === shootJoystick.touchId) {
      shootJoystick.currentX = touch.clientX;
      shootJoystick.currentY = touch.clientY;
      updateShootJoystickVisual();
      e.preventDefault();

      // Calculate drag distance and angle
      const dx = shootJoystick.currentX - shootJoystick.startX;
      const dy = shootJoystick.currentY - shootJoystick.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Get unit-type-specific touch config
      const touchCfg = getHeroTouchConfig();
      const magnitude = Math.min(dist / AIM_JOYSTICK_MAX_RANGE, 1.0);

      // Always set aim angle when joystick is moved (even in deadzone)
      if (dist > 5) {
        const angle = Math.atan2(dy, dx);
        battleSetAimAngle(angle);
      }

      // Past deadzone: set aim depth + fire (behavior varies by unit type)
      if (magnitude > touchCfg.aimDeadzone) {
        const depthPct = (magnitude - touchCfg.aimDeadzone) / (1.0 - touchCfg.aimDeadzone);
        battleSetAimDepth(depthPct);
        // Infantry: fire continuously while held past deadzone
        if (touchCfg.fireTrigger === 'hold' && !shootJoystick.firing) {
          shootJoystick.firing = true;
          battleMouseDown();
        }
      } else {
        battleClearAimDepth();
        // Inside deadzone - aim but don't fire
        if (shootJoystick.firing) {
          shootJoystick.firing = false;
          battleMouseUp();
        }
      }
    }
  }
}, { passive: false });

document.addEventListener('touchend', e => {
  if (!isHeroBattle()) return;

  for (const touch of e.changedTouches) {
    // Cancel joystick repositioning
    if (joystickHoldTimer && touch.identifier === joystickHoldTouchId) {
      clearTimeout(joystickHoldTimer);
      joystickHoldTimer = null;
      joystickHoldTouchId = null;
    }

    // Release movement joystick (pending or active)
    if (touch.identifier === moveJoystick.touchId) {
      moveJoystick.pending = false;
      moveJoystick.active = false;
      moveJoystick.touchId = null;
      updateJoystickInput();
    }

    // Release shoot joystick (pending or active)
    if (touch.identifier === shootJoystick.touchId) {
      const touchCfg = getHeroTouchConfig();
      const wasAiming = shootJoystick.active;
      shootJoystick.pending = false;
      shootJoystick.active = false;
      shootJoystick.touchId = null;
      if (shootJoystick.firing) {
        shootJoystick.firing = false;
        battleMouseUp();
      } else if (touchCfg.fireTrigger === 'release' && wasAiming) {
        // Tank: fire single shot on release
        battleMouseDown();
        requestAnimationFrame(() => battleMouseUp());
      }
      battleClearAimAngle();
      battleClearAimDepth();
      updateShootJoystickVisual();
    }
  }
});

document.addEventListener('touchcancel', e => {
  // Cancel joystick repositioning
  if (joystickHoldTimer) {
    clearTimeout(joystickHoldTimer);
    joystickHoldTimer = null;
    joystickHoldTouchId = null;
  }

  // Reset movement joystick
  moveJoystick.pending = false;
  moveJoystick.active = false;
  moveJoystick.touchId = null;
  updateJoystickInput();

  // Reset shoot joystick
  shootJoystick.pending = false;
  shootJoystick.active = false;
  shootJoystick.touchId = null;
  if (shootJoystick.firing) {
    shootJoystick.firing = false;
    battleMouseUp();
  }
  battleClearAimAngle();
  battleClearAimDepth();
  updateShootJoystickVisual();
});

// Visual joystick elements
let moveJoystickEl = null;
let shootJoystickEl = null;

function createJoystickVisual(isShoot = false) {
  const el = document.createElement('div');
  el.className = isShoot ? 'joystick-visual shoot-joystick' : 'joystick-visual move-joystick';
  el.innerHTML = `
    <div class="joystick-base"></div>
    <div class="joystick-knob"></div>
  `;
  el.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 1000;
    display: none;
  `;

  const base = el.querySelector('.joystick-base');
  base.style.cssText = `
    position: absolute;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: ${isShoot ? 'rgba(255,100,100,0.2)' : 'rgba(100,150,255,0.2)'};
    border: 2px solid ${isShoot ? 'rgba(255,100,100,0.5)' : 'rgba(100,150,255,0.5)'};
    transform: translate(-50%, -50%);
  `;

  const knob = el.querySelector('.joystick-knob');
  knob.style.cssText = `
    position: absolute;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: ${isShoot ? 'rgba(255,100,100,0.6)' : 'rgba(100,150,255,0.6)'};
    border: 2px solid ${isShoot ? 'rgba(255,150,150,0.8)' : 'rgba(150,180,255,0.8)'};
    transform: translate(-50%, -50%);
    transition: transform 0.05s ease-out;
  `;

  document.body.appendChild(el);
  return el;
}

function updateJoystickVisual(el, startX, startY, currentX, currentY, active) {
  if (!el) return;

  if (!active) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.style.left = startX + 'px';
  el.style.top = startY + 'px';

  // Limit knob movement to base radius
  const dx = currentX - startX;
  const dy = currentY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = 40;

  let knobX = dx;
  let knobY = dy;
  if (dist > maxDist) {
    knobX = (dx / dist) * maxDist;
    knobY = (dy / dist) * maxDist;
  }

  const knob = el.querySelector('.joystick-knob');
  if (knob) {
    knob.style.left = knobX + 'px';
    knob.style.top = knobY + 'px';
  }
}

// Convert joystick position to smooth analog movement
function updateJoystickInput() {
  // Update visual
  if (!moveJoystickEl) moveJoystickEl = createJoystickVisual(false);
  updateJoystickVisual(moveJoystickEl, moveJoystick.startX, moveJoystick.startY, moveJoystick.currentX, moveJoystick.currentY, moveJoystick.active);

  if (!moveJoystick.active) {
    // Clear joystick input
    battleClearJoystick();
    return;
  }

  const rawDx = moveJoystick.currentX - moveJoystick.startX;
  const rawDy = moveJoystick.currentY - moveJoystick.startY;
  const deadzone = 15;
  const maxDistance = 60;  // Maximum drag distance for full speed

  // Apply deadzone
  let dx = 0, dy = 0;
  const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

  if (dist > deadzone) {
    // Normalize to -1 to 1 range based on distance
    const adjustedDist = Math.min(dist - deadzone, maxDistance - deadzone);
    const magnitude = adjustedDist / (maxDistance - deadzone);

    // Get direction and apply magnitude
    dx = (rawDx / dist) * magnitude;
    dy = (rawDy / dist) * magnitude;
  }

  // Send analog values to game
  battleSetJoystick(dx, dy);
}

// Update shoot joystick visual
function updateShootJoystickVisual() {
  if (!shootJoystickEl) shootJoystickEl = createJoystickVisual(true);
  updateJoystickVisual(shootJoystickEl, shootJoystick.startX, shootJoystick.startY, shootJoystick.currentX, shootJoystick.currentY, shootJoystick.active);
}

// Force reset all joysticks (call when other touch actions take over)
function resetAllJoysticks() {
  // Reset movement joystick
  moveJoystick.pending = false;
  moveJoystick.active = false;
  moveJoystick.touchId = null;
  battleClearJoystick();
  if (moveJoystickEl) moveJoystickEl.style.display = 'none';

  // Reset shoot joystick
  if (shootJoystick.firing) {
    battleMouseUp();
  }
  shootJoystick.pending = false;
  shootJoystick.active = false;
  shootJoystick.touchId = null;
  shootJoystick.firing = false;
  battleClearAimAngle();
  if (shootJoystickEl) shootJoystickEl.style.display = 'none';
}

// Register the callback with gestures module
setResetJoysticksCallback(resetAllJoysticks);

// ═══════════════════════════════════════════════════════════════
// PLANNING GRID - ZOOM & PAN
// ═══════════════════════════════════════════════════════════════

// Prevent context menu on planning grid / CMD mode battlefield
document.addEventListener('contextmenu', e => {
  // CMD mode right-click: advance to position
  if (Game.state === State.ENDLESS_BATTLE) {
    const eb = Game.endless?.battle;
    if (eb?.playMode === 'cmd' && eb?.phase === 'active') {
      e.preventDefault();
      const bf = document.querySelector('.endless-battlefield');
      if (bf) {
        const rect = bf.getBoundingClientRect();
        handleCMDRightClick(eb, e.clientX - rect.left, e.clientY - rect.top);
      }
      return;
    }
  }
  if (Game.state !== State.CAMPAIGN_PLANNING) return;
  const cell = e.target.closest('.plan-cell');
  if (cell) {
    e.preventDefault();
  }
});

// Right-click handler for context menu in planning (set advance/fallback)
document.addEventListener('mousedown', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;
  if (e.button !== 2) return; // Only right-click

  const cell = e.target.closest('.plan-cell');
  if (!cell) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  // Need a unit selected to set advance/fallback
  if (!plan.selectedPlacement) return;

  const row = parseInt(cell.dataset.row);
  const col = parseInt(cell.dataset.col);

  // Show context menu at this position
  plan.contextMenu = {
    row,
    col,
    screenX: e.clientX,
    screenY: e.clientY
  };
  render();
});

// Mouse wheel zoom on grid viewport
document.addEventListener('wheel', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const viewport = e.target.closest('.planning-grid-viewport, .planning-grid-viewport-v2');
  if (!viewport) return;

  e.preventDefault();

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  // Zoom in/out
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  plan.zoom = Math.max(0.3, Math.min(2.0, plan.zoom + delta));
  render();
}, { passive: false });

// Mouse drag to pan
document.addEventListener('mousedown', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const viewport = e.target.closest('.planning-grid-viewport, .planning-grid-viewport-v2');
  if (!viewport) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  const cell = e.target.closest('.plan-cell');
  const marker = e.target.closest('.dest-marker');

  // Don't pan if clicking on a unit marker (for selection)
  if (marker) return;

  // Don't pan if clicking on a cell AND we have a unit selected to place
  if (cell && plan.selectedUnit) return;

  // Don't pan if clicking on a cell with an existing unit placement
  if (cell) {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const placements = plan.unitPlacements || [];
    const hasUnit = placements.some(p => p.primaryPos?.row === row && p.primaryPos?.col === col);
    if (hasUnit) return;
  }

  // Start panning
  plan.isPanning = true;
  plan.lastPanX = e.clientX;
  plan.lastPanY = e.clientY;
});

document.addEventListener('mousemove', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan || !plan.isPanning) return;

  const dx = e.clientX - plan.lastPanX;
  const dy = e.clientY - plan.lastPanY;

  plan.panX += dx / plan.zoom;
  plan.panY += dy / plan.zoom;

  plan.lastPanX = e.clientX;
  plan.lastPanY = e.clientY;

  // Update grid transform directly for smooth panning (no full re-render)
  const grid = document.getElementById('planning-grid');
  if (grid) {
    grid.style.transform = `scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px)`;
  }
});

// ═══════════════════════════════════════════════════════════════
// PLANNING GRID - TOUCH PAN & PINCH ZOOM
// ═══════════════════════════════════════════════════════════════

// Track touch state for planning grid
let planningTouches = {
  panning: false,
  pinching: false,
  lastX: 0,
  lastY: 0,
  lastDist: 0,
  touchId: null
};

// Helper: get distance between two touches
function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Helper: get center point between two touches
function getTouchCenter(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
}

// Touch start on planning grid
document.addEventListener('touchstart', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const viewport = e.target.closest('.planning-grid-viewport, .planning-grid-viewport-v2');
  if (!viewport) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  const cell = e.target.closest('.plan-cell');
  const marker = e.target.closest('.dest-marker');
  const touches = e.touches;

  if (touches.length === 2) {
    // Two fingers = pinch zoom
    e.preventDefault();
    planningTouches.pinching = true;
    planningTouches.panning = false;
    planningTouches.lastDist = getTouchDistance(touches[0], touches[1]);
    const center = getTouchCenter(touches[0], touches[1]);
    planningTouches.lastX = center.x;
    planningTouches.lastY = center.y;
  } else if (touches.length === 1) {
    // Check if we should pan or let tap through for interaction
    let shouldPan = true;

    // Don't pan if tapping on a unit marker
    if (marker) shouldPan = false;

    // Don't pan if tapping on a cell AND we have a unit selected to place
    if (cell && plan.selectedUnit) shouldPan = false;

    // Don't pan if tapping on a cell with an existing unit
    if (cell && shouldPan) {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      const placements = plan.unitPlacements || [];
      const hasUnit = placements.some(p => p.primaryPos?.row === row && p.primaryPos?.col === col);
      if (hasUnit) shouldPan = false;
    }

    if (shouldPan) {
      e.preventDefault();
      planningTouches.panning = true;
      planningTouches.pinching = false;
      planningTouches.touchId = touches[0].identifier;
      planningTouches.lastX = touches[0].clientX;
      planningTouches.lastY = touches[0].clientY;
    }
  }
}, { passive: false });

// Touch move on planning grid
document.addEventListener('touchmove', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  const touches = e.touches;

  // Pinch zoom
  if (planningTouches.pinching && touches.length === 2) {
    e.preventDefault();

    const newDist = getTouchDistance(touches[0], touches[1]);
    const center = getTouchCenter(touches[0], touches[1]);

    // Zoom based on pinch distance change
    const scale = newDist / planningTouches.lastDist;
    const newZoom = Math.max(0.3, Math.min(2.0, plan.zoom * scale));

    // Pan while pinching (follow center point)
    const dx = center.x - planningTouches.lastX;
    const dy = center.y - planningTouches.lastY;
    plan.panX += dx / plan.zoom;
    plan.panY += dy / plan.zoom;

    plan.zoom = newZoom;
    planningTouches.lastDist = newDist;
    planningTouches.lastX = center.x;
    planningTouches.lastY = center.y;

    // Update transform directly for smooth interaction
    const grid = document.getElementById('planning-grid');
    if (grid) {
      grid.style.transform = `scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px)`;
    }
  }
  // Single finger pan
  else if (planningTouches.panning && touches.length === 1) {
    const touch = touches[0];
    if (touch.identifier !== planningTouches.touchId) return;

    e.preventDefault();

    const dx = touch.clientX - planningTouches.lastX;
    const dy = touch.clientY - planningTouches.lastY;

    plan.panX += dx / plan.zoom;
    plan.panY += dy / plan.zoom;

    planningTouches.lastX = touch.clientX;
    planningTouches.lastY = touch.clientY;

    // Update transform directly
    const grid = document.getElementById('planning-grid');
    if (grid) {
      grid.style.transform = `scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px)`;
    }
  }
}, { passive: false });

// Touch end
document.addEventListener('touchend', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  // If we were pinching and now have 1 finger, switch to panning
  if (planningTouches.pinching && e.touches.length === 1) {
    planningTouches.pinching = false;
    planningTouches.panning = true;
    planningTouches.touchId = e.touches[0].identifier;
    planningTouches.lastX = e.touches[0].clientX;
    planningTouches.lastY = e.touches[0].clientY;
    return;
  }

  // Reset if no touches left
  if (e.touches.length === 0) {
    planningTouches.panning = false;
    planningTouches.pinching = false;
    planningTouches.touchId = null;
  }
});

// Touch cancel
document.addEventListener('touchcancel', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;
  planningTouches.panning = false;
  planningTouches.pinching = false;
  planningTouches.touchId = null;
  // Clear long-press timer
  clearTimeout(longPressTimer);
  longPressTimer = null;
});

// ═══════════════════════════════════════════════════════════════
// PLANNING GRID - LONG PRESS FOR CONTEXT MENU (MOBILE)
// ═══════════════════════════════════════════════════════════════

let longPressTimer = null;
const LONG_PRESS_MS = 500;

// Track touch on planning cells for long-press detection
document.addEventListener('touchstart', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const cell = e.target.closest('.plan-cell');
  if (!cell || e.touches.length !== 1) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan || !plan.selectedPlacement) return; // Need selection for context menu

  const touch = e.touches[0];
  const row = parseInt(cell.dataset.row);
  const col = parseInt(cell.dataset.col);

  // Start long-press timer
  longPressTimer = setTimeout(() => {
    // Show context menu
    plan.contextMenu = {
      row,
      col,
      screenX: touch.clientX,
      screenY: touch.clientY
    };
    render();
    longPressTimer = null;
  }, LONG_PRESS_MS);
}, { passive: true });

// Cancel long-press on touch move (user is dragging)
document.addEventListener('touchmove', e => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}, { passive: true });

// Clear long-press timer on touch end
document.addEventListener('touchend', e => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}, { passive: true });

// ═══════════════════════════════════════════════════════════════
// PLANNING GRID - DRAG AND DROP (DESKTOP + MOBILE)
// ═══════════════════════════════════════════════════════════════

let dragState = {
  active: false,
  placementIdx: null,
  startX: 0,
  startY: 0,
  ghostEl: null,
  edgePanInterval: null
};

// Create ghost element for dragging
function createDragGhost(unitIcon, x, y) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = unitIcon;
  ghost.style.cssText = `
    position: fixed;
    left: ${x - 16}px;
    top: ${y - 16}px;
    width: 32px;
    height: 32px;
    background: rgba(74, 158, 255, 0.8);
    border: 2px solid #4a9eff;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    pointer-events: none;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(ghost);
  return ghost;
}

// Edge panning - pan map when dragging near viewport edge
function startEdgePan(x, y, viewport, plan) {
  if (dragState.edgePanInterval) return;

  const rect = viewport.getBoundingClientRect();
  const EDGE_ZONE = 50; // Pixels from edge to trigger pan
  const PAN_SPEED = 5;

  dragState.edgePanInterval = setInterval(() => {
    let panX = 0, panY = 0;

    if (x < rect.left + EDGE_ZONE) panX = PAN_SPEED;
    if (x > rect.right - EDGE_ZONE) panX = -PAN_SPEED;
    if (y < rect.top + EDGE_ZONE) panY = PAN_SPEED;
    if (y > rect.bottom - EDGE_ZONE) panY = -PAN_SPEED;

    if (panX !== 0 || panY !== 0) {
      plan.panX += panX / plan.zoom;
      plan.panY += panY / plan.zoom;
      const grid = document.getElementById('planning-grid');
      if (grid) {
        grid.style.transform = `scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px)`;
      }
    }
  }, 16);
}

function stopEdgePan() {
  if (dragState.edgePanInterval) {
    clearInterval(dragState.edgePanInterval);
    dragState.edgePanInterval = null;
  }
}

// Desktop: Mouse drag start on markers
document.addEventListener('mousedown', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;
  if (e.button !== 0) return; // Left click only

  const marker = e.target.closest('.dest-marker[data-draggable="true"]');
  if (!marker) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  const placementIdx = parseInt(marker.dataset.placement);
  const placement = plan.unitPlacements[placementIdx];
  if (!placement) return;

  e.preventDefault();

  // Select this unit
  plan.selectedPlacement = placement;

  // Start drag
  dragState.active = true;
  dragState.placementIdx = placementIdx;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;

  const unit = UNITS.find(u => u.id === placement.unitId);
  dragState.ghostEl = createDragGhost(unit?.icon || '●', e.clientX, e.clientY);

  marker.classList.add('dragging');
  render();
});

// Desktop: Mouse drag move
document.addEventListener('mousemove', e => {
  if (!dragState.active || Game.state !== State.CAMPAIGN_PLANNING) return;

  // Update ghost position
  if (dragState.ghostEl) {
    dragState.ghostEl.style.left = `${e.clientX - 16}px`;
    dragState.ghostEl.style.top = `${e.clientY - 16}px`;
  }

  // Edge panning
  const viewport = document.querySelector('.planning-grid-viewport, .planning-grid-viewport-v2');
  const plan = Game.campaign?.battlePlan;
  if (viewport && plan) {
    startEdgePan(e.clientX, e.clientY, viewport, plan);
  }
});

// Desktop: Mouse drag end
document.addEventListener('mouseup', e => {
  if (!dragState.active || Game.state !== State.CAMPAIGN_PLANNING) return;

  const plan = Game.campaign?.battlePlan;

  // Remove ghost
  if (dragState.ghostEl) {
    dragState.ghostEl.remove();
    dragState.ghostEl = null;
  }

  stopEdgePan();

  // Find cell under cursor
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.plan-cell');
  if (cell && plan) {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const placement = plan.unitPlacements[dragState.placementIdx];

    if (placement) {
      const isPlayerZone = row >= plan.playerStartRow;
      const isNoMansLand = row >= plan.enemyEndRow && row < plan.playerStartRow;
      const terrainType = plan.terrain[row]?.[col];
      const isHeroCell = plan.hero.row === row && plan.hero.col === col;

      // Check valid drop location
      if ((isPlayerZone || isNoMansLand) && terrainType !== 'high' && terrainType !== 'water' && !isHeroCell) {
        // Check no other unit there
        const existingAtPos = plan.unitPlacements.find((p, i) =>
          i !== dragState.placementIdx &&
          p.primaryPos?.row === row && p.primaryPos?.col === col
        );
        if (!existingAtPos) {
          placement.primaryPos = { row, col };
          placement.inSpawnZone = false;
        }
      }
    }
  }

  // Reset drag state
  dragState.active = false;
  dragState.placementIdx = null;

  render();
});

// Mobile: Tap-and-hold to drag (uses modified long-press)
let mobileDragState = {
  active: false,
  placementIdx: null,
  ghostEl: null,
  touchId: null
};

// Update the touch handlers for drag support
document.addEventListener('touchstart', e => {
  if (Game.state !== State.CAMPAIGN_PLANNING) return;

  const marker = e.target.closest('.dest-marker[data-draggable="true"]');
  if (!marker || e.touches.length !== 1) return;

  const plan = Game.campaign?.battlePlan;
  if (!plan) return;

  const placementIdx = parseInt(marker.dataset.placement);
  const placement = plan.unitPlacements[placementIdx];
  if (!placement) return;

  const touch = e.touches[0];

  // Select this unit
  plan.selectedPlacement = placement;

  // Start long-press timer for drag
  mobileDragState.touchId = touch.identifier;
  mobileDragState.placementIdx = placementIdx;

  longPressTimer = setTimeout(() => {
    // Start mobile drag
    mobileDragState.active = true;
    const unit = UNITS.find(u => u.id === placement.unitId);
    mobileDragState.ghostEl = createDragGhost(unit?.icon || '●', touch.clientX, touch.clientY);
    marker.classList.add('dragging');

    // Vibrate if supported
    if (navigator.vibrate) navigator.vibrate(50);

    render();
    longPressTimer = null;
  }, LONG_PRESS_MS);
}, { passive: true });

document.addEventListener('touchmove', e => {
  // Cancel long-press timer if moving before hold completes
  if (longPressTimer && !mobileDragState.active) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    return;
  }

  // Handle active mobile drag
  if (!mobileDragState.active || Game.state !== State.CAMPAIGN_PLANNING) return;

  const touch = Array.from(e.touches).find(t => t.identifier === mobileDragState.touchId);
  if (!touch) return;

  e.preventDefault();

  // Update ghost position
  if (mobileDragState.ghostEl) {
    mobileDragState.ghostEl.style.left = `${touch.clientX - 16}px`;
    mobileDragState.ghostEl.style.top = `${touch.clientY - 16}px`;
  }

  // Edge panning
  const viewport = document.querySelector('.planning-grid-viewport, .planning-grid-viewport-v2');
  const plan = Game.campaign?.battlePlan;
  if (viewport && plan) {
    startEdgePan(touch.clientX, touch.clientY, viewport, plan);
  }
}, { passive: false });

document.addEventListener('touchend', e => {
  // Clear long-press timer
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // Handle mobile drag end
  if (!mobileDragState.active || Game.state !== State.CAMPAIGN_PLANNING) {
    mobileDragState.active = false;
    mobileDragState.placementIdx = null;
    return;
  }

  const plan = Game.campaign?.battlePlan;
  const touch = e.changedTouches[0];

  // Remove ghost
  if (mobileDragState.ghostEl) {
    mobileDragState.ghostEl.remove();
    mobileDragState.ghostEl = null;
  }

  stopEdgePan();

  // Find cell under touch point
  const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.plan-cell');
  if (cell && plan) {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const placement = plan.unitPlacements[mobileDragState.placementIdx];

    if (placement) {
      const isPlayerZone = row >= plan.playerStartRow;
      const isNoMansLand = row >= plan.enemyEndRow && row < plan.playerStartRow;
      const terrainType = plan.terrain[row]?.[col];
      const isHeroCell = plan.hero.row === row && plan.hero.col === col;

      // Check valid drop location
      if ((isPlayerZone || isNoMansLand) && terrainType !== 'high' && terrainType !== 'water' && !isHeroCell) {
        // Check no other unit there
        const existingAtPos = plan.unitPlacements.find((p, i) =>
          i !== mobileDragState.placementIdx &&
          p.primaryPos?.row === row && p.primaryPos?.col === col
        );
        if (!existingAtPos) {
          placement.primaryPos = { row, col };
          placement.inSpawnZone = false;
        }
      }
    }
  }

  // Reset mobile drag state
  mobileDragState.active = false;
  mobileDragState.placementIdx = null;
  mobileDragState.touchId = null;

  render();
}, { passive: true });

} // End setupEventHandlers

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

// Check authentication before initializing
if (checkAuth()) {
  initApp();
}
console.log(`Calculated Risk v${GAME_VERSION_STRING}`);
