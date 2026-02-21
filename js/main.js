// ═══════════════════════════════════════════════════════════════
// MAIN - Entry point, event handlers, initialization
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UNITS, PROJECTILES, UNIT_PROJECTILES, SquadOrder, ENDLESS_VEHICLES } from './constants.js';
import { Game, newBattlePlan, newCampaign, createAdvancingScenario, createFrontlineScenario, newZoneBattle, newEndlessRun, newFireRangeRun } from './state.js';
import { initAudio, sound } from './audio.js';
import { save, load, saveFRConfig, loadFRConfig, saveFRNamedConfig, loadFRNamedConfigs, deleteFRNamedConfig, migrateFRConfig } from './storage.js';
import { goto, deploy, switchUnit, stopLoop, stopFireRangeLoop, formatFireRangeLog, addH2HWave, removeH2HWave, setH2HWaveUnit, clearH2HWaveLane, setH2HDefense, nextH2HRound, resetH2H, campaignKeyDown, campaignKeyUp, campaignMouseMove, campaignMouseDown, campaignMouseUp, campaignSetAimAngle, campaignClearAimAngle, campaignSetJoystick, campaignClearJoystick, endlessKeyDown, endlessKeyUp, endlessMouseMove, endlessMouseDown, endlessMouseUp, fireRangeKeyDown, fireRangeKeyUp, fireRangeWheel } from './game.js';
import { FR_PRESETS } from './fire-range-presets.js';
import { render, setSubState, fetchAvailableVehicles, fetchUnitVariants, fetchVariantData, getUnitVariants } from './ui.js';
import { initController, getControllerInput, updateButtonStates, setControllerCallbacks, isControllerConnected } from './controller.js';
import { initGestures, setResetJoysticksCallback } from './gestures.js';
import { moveJoystick, shootJoystick, getNearJoystickAnchor, setJoystickAnchor, getClosestJoystickSide, getDragThreshold } from './joystick.js';
import * as sprites from './sprites.js';
const { initSprites } = sprites;
import { loadTerrainImages } from './world-builder/battle-terrain.js';

// Expose sprites module for console testing
window.sprites = sprites;

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
  // Load saved data
  load();
  // Preload PNG sprites (non-blocking, falls back to SVG if missing)
  initSprites();
  // Preload terrain sprites for PCG battle terrain (non-blocking)
  loadTerrainImages().then(images => {
    Game.terrainImages = images;
    console.log('[main] Terrain sprites preloaded');
  }).catch(err => {
    console.warn('[main] Terrain sprite preload failed (battles will use fallback):', err);
  });
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

  // Only process during campaign battle
  if (Game.state === State.CAMPAIGN_BATTLE) {
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
    campaignMouseDown();
  } else if (!input.shoot && controllerShootHeld) {
    controllerShootHeld = false;
    campaignMouseUp();
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

  // Actions
  const action = e.target.closest('[data-action]');
  if (action) {
    const a = action.dataset.action;
    if (a === 'campaign') { initAudio(); goto(State.CAMPAIGN_ERA_SELECT); }
    else if (a === 'endless') { Game.endless = newEndlessRun(); initAudio(); fetchUnitVariants().then(() => { goto(State.ENDLESS_LOADOUT); render(); }); }
    else if (a === 'classic') { Game.settings.mode = 'classic'; initAudio(); goto(State.COUNTDOWN); }
    else if (a === 'versus') { Game.settings.mode = 'versus'; initAudio(); goto(State.H2H_DESIGN); }
    else if (a === 'play') { initAudio(); goto(State.COUNTDOWN); }
    else if (a === 'settings') goto(State.SETTINGS);
    else if (a === 'stats') goto(State.STATS);
    else if (a === 'hq') goto(State.HQ);
    else if (a === 'sprite-editor') window.open('/sprite-editor.html', '_blank');
    else if (a === 'terrain-editor') window.open('/terrain-editor.html', '_blank');
    else if (a === 'menu') { stopLoop(); Game.h2h = null; Game.h2hDefenseSlot = undefined; Game.h2hWaveLane = undefined; Game.fireRange = null; goto(State.MENU); }
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
      if (!Game.campaign) Game.campaign = newCampaign();
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
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'endless-continue') {
      if (Game.endless) {
        Game.endless.wave++;
        goto(State.ENDLESS_BATTLE);
      }
    }
    else if (a === 'endless-exit') {
      if (Game.endless) {
        Game.endless.result = 'exit';
        Game.endless.exitWave = Game.endless.wave;
        // Add loot to player resources
        Game.resources.scrap += Game.endless.loot.scrap;
        // TODO: Handle parts properly
        save();
        goto(State.ENDLESS_RESULT);
      }
    }
    else if (a === 'endless-retry') {
      Game.endless = newEndlessRun();
      fetchUnitVariants().then(() => { goto(State.ENDLESS_LOADOUT); render(); });
    }
    // Fire Range actions
    else if (a === 'fire-range') {
      Game.fireRange = newFireRangeRun();
      // Restore last config if available
      const lastCfg = loadFRConfig();
      if (lastCfg && lastCfg.blueTeam && lastCfg.redTeam) {
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
        if (team === 'blue') {
          Game.fireRange.config.blueTeam.push({ unitId: 'infantry', count: 2, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 });
        } else {
          Game.fireRange.config.redTeam.push({ unitId: 'infantry', count: 4, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 });
        }
        render();
      }
    }
    else if (a === 'fr-remove') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        if (team === 'blue') Game.fireRange.config.blueTeam.splice(idx, 1);
        else Game.fireRange.config.redTeam.splice(idx, 1);
        render();
      }
    }
    // Expand/collapse slot detail
    else if (a === 'fr-expand') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        const arr = team === 'blue' ? Game.fireRange.config.blueTeam : Game.fireRange.config.redTeam;
        if (arr[idx]) {
          arr[idx]._expanded = !arr[idx]._expanded;
          render();
        }
      }
    }
    // Leader toggle (only one per team)
    else if (a === 'fr-leader') {
      if (Game.fireRange) {
        const team = action.dataset.team;
        const idx = parseInt(action.dataset.idx, 10);
        const arr = team === 'blue' ? Game.fireRange.config.blueTeam : Game.fireRange.config.redTeam;
        if (arr[idx]) {
          const wasLeader = arr[idx].isLeader;
          // Clear all leaders on this team
          for (const slot of arr) slot.isLeader = false;
          // Toggle: if it was the leader, it's now off; otherwise set it
          arr[idx].isLeader = !wasLeader;
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
    // Load test preset
    else if (a === 'fr-preset-load') {
      if (Game.fireRange) {
        const sel = document.querySelector('.fr-preset-select');
        const id = sel?.value;
        if (id && FR_PRESETS[id]) {
          Game.fireRange.config = JSON.parse(JSON.stringify(FR_PRESETS[id]));
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
              if (imported.blueTeam && imported.redTeam) {
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
        b.showTerrainGrid = !b.showTerrainGrid;
        const btn = action;
        btn.classList.toggle('active', b.showTerrainGrid);
      }
    }
    else if (a === 'fr-toggle-panel') {
      const panel = document.getElementById('fr-debug-panel');
      if (panel) panel.classList.toggle('collapsed');
    }
    else if (a === 'fr-event-filter') {
      const b = Game.fireRange?.battle;
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
    // Toggle collapsible panels
    else if (a === 'toggle-panel') {
      const panel = action.closest('.loadout-panel');
      if (panel) {
        panel.classList.toggle('collapsed');
      }
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

// Change events (for dropdowns)
document.getElementById('app').addEventListener('change', e => {
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

  // Fire Range config selects and count inputs
  if (Game.state === State.FIRE_RANGE && Game.fireRange) {
    const cfg = Game.fireRange.config;
    const sel = e.target.closest('.fr-select');
    const cnt = e.target.closest('.fr-count');
    if (sel) {
      const team = sel.dataset.team;
      const idx = parseInt(sel.dataset.idx, 10);
      const field = sel.dataset.field;
      if (team === 'blue' && cfg.blueTeam[idx]) cfg.blueTeam[idx][field] = sel.value;
      else if (team === 'red' && cfg.redTeam[idx]) {
        cfg.redTeam[idx][field] = sel.value;
        // Migrate: if setting unitId, clear old enemyType key
        if (field === 'unitId') delete cfg.redTeam[idx].enemyType;
      }
    }
    if (cnt) {
      const team = cnt.dataset.team;
      const idx = parseInt(cnt.dataset.idx, 10);
      const val = Math.max(1, Math.min(20, parseInt(cnt.value, 10) || 1));
      if (team === 'blue' && cfg.blueTeam[idx]) cfg.blueTeam[idx].count = val;
      else if (team === 'red' && cfg.redTeam[idx]) cfg.redTeam[idx].count = val;
    }
    return;
  }
});

// Input events (for range sliders and fire range counts)
document.getElementById('app').addEventListener('input', e => {
  // Fire Range slider + count inputs
  if (Game.state === State.FIRE_RANGE && Game.fireRange) {
    const cfg = Game.fireRange.config;
    // Personality / veterancy / morale sliders
    // Sergeant trait sliders
    const sgtSlider = e.target.closest('.fr-sgt-slider');
    if (sgtSlider) {
      const team = sgtSlider.dataset.sgtTeam;
      const trait = sgtSlider.dataset.sgtTrait;
      const val = parseFloat(sgtSlider.value);
      const sgtKey = team === 'blue' ? 'blueSergeant' : 'redSergeant';
      if (!cfg[sgtKey]) cfg[sgtKey] = {};
      cfg[sgtKey][trait] = val;
      const valSpan = sgtSlider.parentElement.querySelector('.fr-slider-val');
      if (valSpan) valSpan.textContent = val.toFixed(2);
      return;
    }

    const slider = e.target.closest('.fr-slider');
    if (slider) {
      const team = slider.dataset.team;
      const idx = parseInt(slider.dataset.idx, 10);
      const field = slider.dataset.field;
      const val = parseFloat(slider.value);
      const arr = team === 'blue' ? cfg.blueTeam : cfg.redTeam;
      if (arr[idx]) {
        arr[idx][field] = val;
        // Update value label
        const valSpan = slider.parentElement.querySelector('.fr-slider-val');
        if (valSpan) valSpan.textContent = val.toFixed(2);
      }
      return;
    }
    // Count inputs
    const cnt = e.target.closest('.fr-count');
    if (cnt) {
      const team = cnt.dataset.team;
      const idx = parseInt(cnt.dataset.idx, 10);
      const val = Math.max(1, Math.min(20, parseInt(cnt.value, 10) || 1));
      if (team === 'blue' && cfg.blueTeam[idx]) cfg.blueTeam[idx].count = val;
      else if (team === 'red' && cfg.redTeam[idx]) cfg.redTeam[idx].count = val;
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
document.addEventListener('keydown', e => {
  if (Game.state === State.CAMPAIGN_BATTLE) {
    campaignKeyDown(e.key);
  }
  // Endless mode keyboard
  if (Game.state === State.ENDLESS_BATTLE) {
    endlessKeyDown(e.key);
  }
  // Fire Range keyboard (camera pan)
  if (Game.state === State.FIRE_RANGE_BATTLE) {
    fireRangeKeyDown(e.key);
  }
});

document.addEventListener('keyup', e => {
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
    campaignMouseDown();
  }
  // Endless mode mouse
  if (Game.state === State.ENDLESS_BATTLE && e.button === 0) {
    endlessMouseDown();
  }
});

document.addEventListener('mouseup', e => {
  if (Game.state === State.CAMPAIGN_BATTLE && e.button === 0) {
    campaignMouseUp();
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

// Mouse wheel zoom for fire range
document.addEventListener('wheel', e => {
  if (Game.state === State.FIRE_RANGE_BATTLE) {
    const bf = document.querySelector('.endless-battlefield');
    if (bf && bf.contains(e.target)) {
      e.preventDefault();
      fireRangeWheel(e.deltaY);
    }
  }
}, { passive: false });

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

// Handle joystick touch start - set PENDING if near anchor (activate on drag)
document.addEventListener('touchstart', e => {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

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
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

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

      // Calculate magnitude as percentage of max range (capped at 1.0)
      const magnitude = Math.min(dist / AIM_JOYSTICK_MAX_RANGE, 1.0);

      // Always set aim angle when joystick is moved (even in deadzone)
      if (dist > 5) {  // Small threshold to avoid jitter at center
        const angle = Math.atan2(dy, dx);
        campaignSetAimAngle(angle);
      }

      // Fire only when past the deadzone (50% of range)
      if (magnitude > AIM_FIRE_DEADZONE) {
        if (!shootJoystick.firing) {
          shootJoystick.firing = true;
          campaignMouseDown();
        }
      } else {
        // Inside deadzone - aim but don't fire
        if (shootJoystick.firing) {
          shootJoystick.firing = false;
          campaignMouseUp();
        }
      }
    }
  }
}, { passive: false });

document.addEventListener('touchend', e => {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

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
      shootJoystick.pending = false;
      shootJoystick.active = false;
      shootJoystick.touchId = null;
      if (shootJoystick.firing) {
        shootJoystick.firing = false;
        campaignMouseUp();
      }
      campaignClearAimAngle();
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
    campaignMouseUp();
  }
  campaignClearAimAngle();
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
    campaignClearJoystick();
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
  campaignSetJoystick(dx, dy);
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
  campaignClearJoystick();
  if (moveJoystickEl) moveJoystickEl.style.display = 'none';

  // Reset shoot joystick
  if (shootJoystick.firing) {
    campaignMouseUp();
  }
  shootJoystick.pending = false;
  shootJoystick.active = false;
  shootJoystick.touchId = null;
  shootJoystick.firing = false;
  campaignClearAimAngle();
  if (shootJoystickEl) shootJoystickEl.style.display = 'none';
}

// Register the callback with gestures module
setResetJoysticksCallback(resetAllJoysticks);

// ═══════════════════════════════════════════════════════════════
// PLANNING GRID - ZOOM & PAN
// ═══════════════════════════════════════════════════════════════

// Prevent context menu on planning grid (for right-click waypoint selection)
document.addEventListener('contextmenu', e => {
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
console.log('Calculated Risk v3 - Modular');
