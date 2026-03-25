// ═══════════════════════════════════════════════════════════════
// GAME - Battle logic, game loop, update, draw
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UNITS, ENEMIES, getTypeMultiplier, UNIT_COSTS, H2H_BUDGET, PROJECTILES, UNIT_PROJECTILES, UNIT_COMBAT_STATS, UNIT_DESCRIPTIONS, getTerrainSVG, getStanceModifier, getEnemyStance, ZoneOwner, ScenarioType, SHADOW_CONFIG, Team, Owner, FORMATION_OFFSETS, getFormationPositions, CREW_SCHEMAS, RANK_TABLE, DEFAULT_MAX_SPREAD_DEG } from './constants.js';
import { renderBaseTerrainToCanvas, renderCanopyToCanvas } from './world-builder/terrain-renderer.js';
import { Game, newBattle, newH2H, newCampaign, newCampaignBattle, newEndlessBattle, newFireRangeRun, newFireRangeBattle, createUnit } from './state.js';
import { sound } from './audio.js';
import { save, saveLastLoadout, loadLastLoadout } from './storage.js';
import { render, setSubState, getCustomizedSvg, getCustomizedSvgFrames, getEntitySvg, getEntitySvgFrames, drawCommandUI, drawCommanderOverlay, getUnitVisual, getUnitShadow, fireRangeResultsHTML } from './ui.js';
import * as sprites from './sprites.js';
import { BattleRenderer } from './battle-renderer.js';
import { getUnitSvgImage } from './entity-renderer.js';
import {
  isBlocked,
  findTargetsInRange,
  getClosestTarget,
  createProjectile,
  updateProjectiles
} from './combat.js';
import { isTerrainBlocked, getTerrainSpeedMod, findValidSpawnPos } from './terrain-utils.js';
import { clearQueryCache, getBridgeCoverMult, isBridgeDeckBlocking, queryTerrain } from './terrain-query.js';
// updateSergeant now called via ai-pipeline.js runBattleAI()
import {
  issueCommand,
  AIState,
  AIBehavior,
  EnemyAIType,
  setUnitBehavior,
  setEnemyAIType,
  TacticalCommand,
  addWaypoint,
  clearWaypoints,
  setWaypointsFromGrid,
  recordDamage,
  applyMoraleEvent,
  MoraleEvent,
  ENTITY_RADIUS,
  issueFrontLineCommand,
  assignSmartPositions,
  applySuppression,
  updateSuppression,
  getArmorTier,
  getTierDamageMultiplier
} from './ai.js';
import {
  VEHICLE_TURN_RATES,
  normalizeAngle,
  smoothRotateToward,
  parseTankInput as parseTankInputBase,
  applyTankMovement as applyTankMovementBase,
  applyTurretAim as applyTurretAimPure,
  calculateAimAngle as calculateAimAnglePure,
  parseTankInputExtended,
  applyTankMovementExtended
} from './movement.js';
import { rollModifier, applyModifier, getModifiedDamage } from './elite-modifiers.js';
import { runBattleAI, snapshotAiPerf, spawnSquad, createSquad, applyBrainDefaults, scaleBrainByWave, BRAIN_PRESETS } from './ai-pipeline.js';
import { planDeployment, scaleCommanderByWave, assignObjective } from './commander.js';
import { computeShotAccuracy, applyRecoilDrop, updateStability } from './fire-decision.js';
import { createRecorder, recordFrame, finalizeRecording, isRecording, saveReplay } from './replay-recorder.js';
import { updateFireRangeCamera, updateHeroCamera, cameraKeyDown, cameraKeyUp, cameraZoom, cameraFitMap, cameraFitMapImmediate } from './camera.js';
import { resolveProjectiles } from './projectile-resolver.js';
import { drawMinimap } from './minimap.js';
import { toggleDebugPanel, debugInspectAt, isDebugPanelVisible, destroyDebugPanel } from './debug-panel.js';
import { logEvent, EventCategory, EventSeverity } from './battle-log.js';
import { isCrewMode, drawCrewLineup, drawCrewAvailable, drawCrewCard, handleLineupClick, handleSectionHeaderClick, handleCrewAvailableClick, handleCrewAddClick, handlePoolTabClick, handleMotorPoolClick, handleCrewTransfer, clearCrewSelection } from './deploy-crew.js';
import { getSoldier, getCrewForVehicle, saveRoster, saveVehicles, getVehicle, healAllSoldiers, repairAllVehicles, computeBattleScore, detectHeroics, recordBattleScore, applyPromotion, applyDemotion, getRankName, getMMR } from './roster.js';
import { getEffectivePersonality } from './crew.js';
import { initCMDMode, updateCMDCamera, drawCMDOverlay, handleCMDClick, handleCMDRightClick, handleCMDKey, shouldHeroRunAI } from './cmd-mode.js';
import { drawPresetPanel, applyPreset } from './loadouts.js';

/** Format top N AI sub-costs for compact console output */
function _topCosts(ai, n) {
  const entries = Object.entries(ai).filter(([k]) => k !== 'frames');
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, n).map(([k, v]) => `${k}:${v.toFixed(1)}`);
  return top.length ? ' [' + top.join(' ') + ']' : '';
}

/**
 * Shared perf snapshot logger — called once per frame in all modes.
 * Every 5s: snapshots AI breakdown into b._perfLog ring buffer (max 60 entries).
 * Console output: one warn line only when frame budget exceeded.
 */
function _logPerfSnapshot(b, now) {
  const perfNow = performance.now();
  if (perfNow - b._perf.lastLog < 5000 || b._perf.samples === 0) return;

  if (!b._perfLog) b._perfLog = [];
  const n = b._perf.samples;
  const avgAi = b._perf.ai / n;
  const avgProj = b._perf.proj / n;
  const avgFrame = b._perf.frame / n;
  const blueAlive = b.units?.filter(u => !u.dead).length || 0;
  const redAlive = b.enemies?.filter(e => !e.dead).length || 0;

  // Get AI sub-timing breakdown (resets accumulator)
  const aiBreakdown = snapshotAiPerf(b);

  const snapshot = {
    t: now,
    wave: b.wave || 1,
    fps: +(n / 5).toFixed(0),
    avgAi: +avgAi.toFixed(2),
    avgProj: +avgProj.toFixed(2),
    avgFrame: +avgFrame.toFixed(2),
    blueAlive, redAlive,
    proj: b.projectiles?.length || 0,
    frames: n,
    ai: aiBreakdown
  };
  b._perfLog.push(snapshot);
  if (b._perfLog.length > 60) b._perfLog.shift();

  b._perf.ai = 0; b._perf.proj = 0; b._perf.frame = 0; b._perf.samples = 0; b._perf.lastLog = perfNow;
}

// Get effective unit stats with upgrades applied
function getUnitStats(unitIdx) {
  const unit = UNITS[unitIdx];
  const upgrades = Game.player.upgrades[unit.id] || { damage: 0, fireRate: 0 };

  const dmgLevel = upgrades.damage;
  const rateLevel = upgrades.fireRate;

  return {
    damage: unit.upgrades.damage.levels[dmgLevel],
    fireRate: unit.upgrades.fireRate.levels[rateLevel],
    deployCooldown: unit.deployCooldown,
    types: unit.types
  };
}

let loopId = null;
let lastT = 0;
let animFrame = 0; // Animation frame counter for track/wheel animation

// Canvas-based sprite rendering
let battleCanvas = null;
let battleCtx = null;
let useCanvasRendering = true; // Feature flag for canvas-based animated sprites
const USE_CANVAS_BATTLE = true; // Feature flag: full canvas battle rendering (BattleRenderer)

// Unique ID counter for units
let unitIdCounter = 0;

/**
 * Setup the canvas layer for animated sprite rendering
 */
function setupBattleCanvas() {
  const bf = document.querySelector('.battlefield');
  if (!bf) return;

  // Remove existing canvas if any
  const existing = bf.querySelector('#battle-canvas');
  if (existing) existing.remove();

  // Create canvas layer
  battleCanvas = document.createElement('canvas');
  battleCanvas.id = 'battle-canvas';
  battleCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';

  // Set canvas size to match battlefield
  battleCanvas.width = bf.offsetWidth;
  battleCanvas.height = bf.offsetHeight;

  bf.appendChild(battleCanvas);
  battleCtx = battleCanvas.getContext('2d');

  console.log(`[game] Battle canvas setup: ${battleCanvas.width}x${battleCanvas.height}`);
}

// Campaign canvas for hero and unit rendering
let campaignCanvas = null;
let campaignCtx = null;

/**
 * Setup the canvas layer for campaign animated sprite rendering
 */
function setupCampaignCanvas() {
  const bf = document.querySelector('.campaign-battlefield');
  if (!bf) return;

  // Remove existing canvas if any
  const existing = bf.querySelector('#campaign-canvas');
  if (existing) existing.remove();

  // Get device pixel ratio for crisp rendering on high-DPI screens
  const dpr = window.devicePixelRatio || 1;

  // Create canvas layer
  campaignCanvas = document.createElement('canvas');
  campaignCanvas.id = 'campaign-canvas';

  // Get display size
  const displayWidth = bf.offsetWidth || 800;
  const displayHeight = bf.offsetHeight || 600;

  // Set canvas buffer size scaled by DPR for sharpness
  campaignCanvas.width = displayWidth * dpr;
  campaignCanvas.height = displayHeight * dpr;

  // Set CSS size to match display
  campaignCanvas.style.cssText = `position:absolute;top:0;left:0;width:${displayWidth}px;height:${displayHeight}px;pointer-events:none;z-index:50;`;

  bf.appendChild(campaignCanvas);
  campaignCtx = campaignCanvas.getContext('2d');

  // Scale context to match DPR so drawing coordinates stay the same
  campaignCtx.scale(dpr, dpr);

  // Enable image smoothing for better quality
  campaignCtx.imageSmoothingEnabled = true;
  campaignCtx.imageSmoothingQuality = 'high';

  console.log(`[game] Campaign canvas setup: ${displayWidth}x${displayHeight} @ ${dpr}x DPR`);
}

// ═══════════════════════════════════════════════════════════════
// TANK CONTROLS - Modular vehicle control system
// ═══════════════════════════════════════════════════════════════

/**
 * Default turn rates for vehicles (radians per second)
 */
// NOTE: VEHICLE_TURN_RATES, normalizeAngle, smoothRotateToward imported from movement.js

// Default joystick control settings
const JOYSTICK_DEFAULTS = {
  deadzone: 0.25,
  reverseCone: 22
};

function getJoystickSettings() {
  const settings = Game.settings?.controls || {};
  return {
    deadzone: settings.joystickDeadzone ?? JOYSTICK_DEFAULTS.deadzone,
    reverseCone: (settings.joystickReverseCone ?? JOYSTICK_DEFAULTS.reverseCone) * Math.PI / 180
  };
}

/**
 * Parse input into tank control values (with joystick support)
 * Thin wrapper over shared parseTankInputExtended — passes game-specific joystick settings
 */
function parseTankInput(keys, joystickInput, currentHullAngle = 0) {
  return parseTankInputExtended(keys, joystickInput, currentHullAngle, getJoystickSettings());
}

/**
 * Apply tank controls to update hull angle and calculate movement
 * Thin wrapper — delegates to shared pure function, then mutates entity
 */
function applyTankMovement(entity, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec) {
  const result = applyTankMovementExtended(entity.hullAngle, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec);
  entity.hullAngle = result.hullAngle;
  return { dx: result.dx, dy: result.dy, isMoving: result.isMoving };
}

/**
 * Update turret aim with smooth rotation
 * Thin wrapper — delegates to shared pure function, then mutates entity
 */
function applyTurretAim(entity, targetWorldAngle, turretTurnRate, dtSec) {
  entity.angle = applyTurretAimPure(entity.angle, targetWorldAngle, turretTurnRate, dtSec);
}

/**
 * Calculate world aim angle from mouse position
 * Game-style: camera.x/y are world offsets, camera.zoom scales screen→world
 */
function calculateAimAngle(entity, mouse, camera) {
  const z = camera.zoom || 1;
  const worldMouseX = mouse.x / z + camera.x;
  const worldMouseY = mouse.y / z + camera.y;
  return Math.atan2(worldMouseY - entity.y, worldMouseX - entity.x);
}

/**
 * Generate unique ID for a unit
 */
function generateUnitId(type, isEnemy = false) {
  return `${isEnemy ? 'enemy' : 'unit'}-${type}-${++unitIdCounter}`;
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION HELPERS - Hooks between game state and sprite animations
// ═══════════════════════════════════════════════════════════════

/**
 * Update animation trigger based on movement
 */
function updateUnitMovementAnim(unit, prevY) {
  if (!useCanvasRendering || !unit.animId) return;

  const isNowMoving = Math.abs(unit.y - prevY) > 0.01;
  if (isNowMoving !== unit.isMoving) {
    unit.isMoving = isNowMoving;
    sprites.setUnitAnimTrigger(unit.animId, isNowMoving ? 'move' : 'idle');
  }
}

/**
 * Update turret aim toward a target
 */
function updateUnitAimAnim(unit, targetY, laneWidth) {
  if (!useCanvasRendering || !unit.animId) return;

  // Calculate angle to target (0 = up, 90 = right, etc.)
  // For now, just aim straight (0 for player units going up, 180 for enemies going down)
  // TODO: Calculate actual angle based on target position
  const aimAngle = targetY < unit.y ? 0 : 180;
  sprites.setUnitAimAngle(unit.animId, aimAngle);
}

/**
 * Trigger fire animation when unit shoots
 */
function triggerFireAnim(unit) {
  if (!useCanvasRendering || !unit.animId) return;
  sprites.triggerUnitAnim(unit.animId, 'fire');
}

/**
 * Trigger hit animation when unit takes damage
 */
function triggerHitAnim(unit) {
  if (!useCanvasRendering || !unit.animId) return;
  sprites.triggerUnitAnim(unit.animId, 'hit');
}

/**
 * Clean up animation state when unit is destroyed
 */
function cleanupUnitAnim(unit) {
  if (!useCanvasRendering || !unit.animId) return;
  sprites.destroyAnimatedUnit(unit.animId);
}

// Create a shadow element for a unit
function createShadowElement(x, y, rotation = 0) {
  if (!SHADOW_CONFIG.enabled) return null;

  const shadow = document.createElement('div');
  shadow.className = 'unit-shadow';

  // Simple drop shadow: small offset in direction away from sun
  const sunRad = (SHADOW_CONFIG.sunDirection * Math.PI) / 180;

  // Offset shadow away from sun direction (4px)
  const offsetX = -Math.cos(sunRad) * 4;
  const offsetY = -Math.sin(sunRad) * 4;

  shadow.style.left = `${x + offsetX}px`;
  shadow.style.top = `${y + offsetY}px`;
  shadow.style.transform = `rotate(${rotation}deg)`;
  // Note: opacity is applied inline for PNG sprites to preserve transparency

  return shadow;
}

// ═══════════════════════════════════════════════════════════════
// STATE TRANSITIONS
// ═══════════════════════════════════════════════════════════════

export function goto(newState, data = {}) {
  console.log(`[State] ${Game.state} → ${newState}`);
  const prev = Game.state;
  Game.state = newState;
  Game.subState = SubState.PLAYING;

  switch (newState) {
    case State.COUNTDOWN:
      Game.battle = newBattle();
      render();
      runCountdown();
      break;

    case State.BATTLE:
      if (prev === State.COUNTDOWN || prev === State.WAVE_COMPLETE) {
        spawnWave();
      }
      render();
      // Setup canvas for animated sprite rendering
      if (useCanvasRendering) {
        setupBattleCanvas();
      }
      startLoop();
      break;

    case State.WAVE_COMPLETE:
      stopLoop();
      render();
      break;

    case State.PAUSED:
      stopLoop();
      render();
      break;

    case State.VICTORY:
    case State.DEFEAT:
      stopLoop();
      finishBattle();
      render();
      break;

    case State.HQ:
      Game.hqTab = Game.hqTab || HQTab.LINEUP;
      render();
      break;

    case State.H2H_DESIGN:
      if (!Game.h2h) {
        Game.h2h = newH2H();
        // Auto-add first wave so user can start designing immediately
        Game.h2h.playerAttack.push({ delay: 0, lanes: [null, null, null] });
        // Focus first lane of first wave
        Game.h2h.selectedWave = 0;
        Game.h2hWaveLane = 0;
      }
      render();
      break;

    case State.H2H_BATTLE:
      // Generate AI pattern when battle starts
      generateAIPattern();
      Game.h2h.phase = 'battle';
      render();
      startH2HLoop();
      break;

    case State.H2H_RESULT:
      stopLoop();
      Game.h2h.phase = 'result';
      render();
      break;

    case State.H2H_MATCH_END:
      stopLoop();
      Game.h2h.phase = 'result';
      render();
      break;

    // Campaign States
    case State.CAMPAIGN_ERA_SELECT:
      if (!Game.campaign) {
        Game.campaign = newCampaign();
        Game.campaign._record = Game.settings?.autoRecord !== false;
      }
      render();
      break;

    case State.CAMPAIGN_MOS_SELECT:
      render();
      break;

    case State.CAMPAIGN_BATTLE:
      // Start campaign battle with current era, MOS, and battlePlan
      if (!Game.campaign.heroBattle) {
        Game.campaign.heroBattle = newCampaignBattle(
          Game.campaign.era,
          Game.campaign.mos,
          Game.campaign.battlePlan
        );
        // Assign smart positions to units without explicit positions
        assignSmartPositions(Game.campaign.heroBattle);
      }

      // Initialize animation for hero (use abrams variant for now)
      // This runs for all campaign battles including test zone battles
      {
        const hero = Game.campaign.heroBattle.hero;
        if (hero.animId && useCanvasRendering && !sprites.hasAnimatedUnit(hero.animId)) {
          sprites.initAnimatedUnit(hero.animId, 'abrams', 'default').then(variantData => {
            if (variantData) {
              console.log(`[campaign] Initialized hero animation: ${hero.animId}`);
            }
          });
        }
      }

      render();
      // Setup canvas after render creates the battlefield element
      if (USE_CANVAS_BATTLE) {
        setTimeout(() => {
          const bf = document.querySelector('.campaign-battlefield');
          if (bf) {
            const b = Game.campaign.heroBattle;
            b._battleStartTime = Date.now();
            b.battleRenderer = new BattleRenderer(bf);
            b.battleRenderer.init();
            if (b.terrainCanvases) {
              b.battleRenderer.setTerrainFromCanvases(
                b.terrainCanvases.terrainCanvas,
                b.terrainCanvases.canopyCanvas,
                b.mapWidth, b.mapHeight,
                b.terrainCanvases.bridgeDeckCanvas
              );
            } else {
              b.battleRenderer.setTerrain(b.terrain, b.cellSize);
            }
          }
        }, 0);
      } else {
        setTimeout(() => setupCampaignCanvas(), 0);
      }
      // Record if enabled
      if (Game.campaign._record) {
        createRecorder(Game.campaign.heroBattle, 'campaign');
      }
      startCampaignLoop();
      break;

    case State.CAMPAIGN_RESULT: {
      stopLoop();
      stopCampaignLoop();
      const cb = Game.campaign?.heroBattle;
      if (cb && isRecording(cb)) saveReplay(cb);
      render();
      break;
    }

    // Endless Mode States
    case State.ENDLESS_LOADOUT:
      render();
      break;

    case State.ENDLESS_BATTLE:
      // Initialize endless battle (wave is already set by the action that triggered this)
      if (Game.endless && !Game.endless.battle) {
        Game.endless.battle = newEndlessBattle(Game.endless.loadout, Game.endless.wave);
        // Carry play mode across waves
        if (Game.endless.playMode) {
          Game.endless.battle.playMode = Game.endless.playMode;
        }
        // Edit Deployment: clear flag (battle already starts in deploy phase)
        if (Game.endless._editDeployment) {
          Game.endless._editDeployment = false;
        }
        // For wave 2+ in CMD mode, init immediately (no countdown phase)
        if (Game.endless.battle.playMode === 'cmd' && Game.endless.battle.phase === 'active') {
          initCMDMode(Game.endless.battle);
          const hero = Game.endless.battle.hero;
          hero.isHero = true;
          hero.team = Team.BLUE;
          if (!hero.id) hero.id = `hero_${Date.now()}`;
        }
        console.log('[game] Created endless battle for wave', Game.endless.wave, 'mode:', Game.endless.battle.playMode);

        // Auto-deploy for wave 2+ — position in staging area and skip deploy phase
        if (Game.endless._autoDeployNextWave) {
          Game.endless._autoDeployNextWave = false;
          const b = Game.endless.battle;
          const stageDepth = b.stageDepth || Math.round(b.mapHeight * 0.1);

          // Position blue in off-map staging area (same as wave 1 deploy)
          const spawnX = b.mapWidth / 2;
          const stageY = b.mapHeight + stageDepth / 2;
          const units = b.units || [];

          // Hero at center of staging area
          b.hero.x = spawnX;
          b.hero.y = stageY;

          // Squad in formation around hero in staging area
          const spacing = 60;
          for (let i = 0; i < units.length; i++) {
            const offset = (i - units.length / 2) * spacing;
            units[i].x = spawnX + offset;
            units[i].y = stageY + (Math.random() - 0.5) * 40;
          }

          // Stamp roster data + create blue squad (same as deploy button)
          _stampRosterData(b);

          // Mark as deployed — skip deploy phase
          if (!b.deployReady) b.deployReady = {};
          b.deployReady.blue = true;
          b.phase = 'active';
        }
      }

      // Initialize hero sprite animation
      {
        const hero = Game.endless.battle.hero;
        if (hero.animId && useCanvasRendering && !sprites.hasAnimatedUnit(hero.animId)) {
          sprites.initAnimatedUnit(hero.animId, hero.unitId, hero.variantId || 'default').then(v => {
            if (v) console.log(`[endless] Hero sprite loaded: ${hero.animId}`);
          });
        }
      }

      render();
      if (USE_CANVAS_BATTLE) {
        setTimeout(() => {
          const bf = document.querySelector('.endless-battlefield');
          if (bf && Game.endless?.battle) {
            const b = Game.endless.battle;
            b._battleStartTime = Date.now();
            b.battleRenderer = new BattleRenderer(bf);
            b.battleRenderer.init();
            if (b.terrainCanvases) {
              b.battleRenderer.setTerrainFromCanvases(
                b.terrainCanvases.terrainCanvas,
                b.terrainCanvases.canopyCanvas,
                b.mapWidth, b.mapHeight,
                b.terrainCanvases.bridgeDeckCanvas
              );
            } else {
              b.battleRenderer.setTerrain(b.terrain, b.cellSize);
            }
          }
        }, 0);
      }
      // Record if enabled
      if (Game.endless._record) {
        createRecorder(Game.endless.battle, 'endless');
      }
      startEndlessLoop();
      break;

    case State.ENDLESS_BETWEEN:
      stopEndlessLoop();
      render();
      break;

    case State.ENDLESS_RESULT: {
      stopEndlessLoop();
      const eb = Game.endless?.battle;
      if (eb) saveReplay(eb);
      render();
      break;
    }

    // Fire Range States
    case State.FIRE_RANGE:
      stopFireRangeLoop();
      render();
      break;

    case State.FIRE_RANGE_BATTLE:
      // Create battle from config
      if (Game.fireRange && !Game.fireRange.battle) {
        Game.fireRange.battle = newFireRangeBattle(Game.fireRange.config);
        console.log('[fire-range] Battle created');
      }

      // Apply pending modifiers (needs ai imports)
      {
        const b = Game.fireRange.battle;
        for (const enemy of b.enemies) {
          if (enemy._pendingModifier) {
            applyModifier(enemy, enemy._pendingModifier);
            setEnemyAIType(enemy, enemy.aiTypeKey || 'BASIC');
            delete enemy._pendingModifier;
          } else {
            setEnemyAIType(enemy, enemy.aiTypeKey || 'BASIC');
          }
        }
      }

      render();
      if (USE_CANVAS_BATTLE) {
        setTimeout(() => {
          const bf = document.querySelector('.endless-battlefield');
          if (bf && Game.fireRange?.battle && !Game.fireRange.battle.battleRenderer) {
            const b = Game.fireRange.battle;
            b._battleStartTime = Date.now();
            b.battleRenderer = new BattleRenderer(bf);
            b.battleRenderer.init();
            if (b.terrainCanvases) {
              b.battleRenderer.setTerrainFromCanvases(
                b.terrainCanvases.terrainCanvas,
                b.terrainCanvases.canopyCanvas,
                b.mapWidth, b.mapHeight,
                b.terrainCanvases.bridgeDeckCanvas
              );
            } else {
              b.battleRenderer.setTerrain(b.terrain, b.cellSize);
            }
          }
        }, 0);
      }
      // Record if enabled (per-battle toggle or settings default)
      if (Game.fireRange.config.record !== false && Game.settings?.autoRecord !== false
          || Game.fireRange.config.record === true) {
        createRecorder(Game.fireRange.battle);
      }

      startFireRangeLoop();
      break;

    default:
      render();
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERRUPT POINTS - Where math can be injected later
// ═══════════════════════════════════════════════════════════════

function onDeploy(lane, callback) {
  // INTERRUPT: Math challenge before deploy
  callback(); // For now, just execute
}

function onSwitch(lane, unit, callback) {
  // INTERRUPT: Math challenge before switching
  callback();
}

export function onForge(item, callback) {
  // INTERRUPT: Mini-game determines quality
  callback({ quality: 'common' });
}

export function onRepair(unit, callback) {
  // INTERRUPT: Math determines repair quality
  callback({ restored: 100 });
}

export function onResearch(tech, callback) {
  // INTERRUPT: Math challenge to complete research
  callback();
}

// ═══════════════════════════════════════════════════════════════
// BATTLE LOGIC
// ═══════════════════════════════════════════════════════════════

function spawnWave() {
  const b = Game.battle;
  const wave = b.wave;
  const count = 3 + Math.floor(wave * 1.5);
  const bf = document.querySelector('.battlefield');
  const laneW = bf ? bf.offsetWidth / 3 : 100;

  for (let i = 0; i < count; i++) {
    let type = 0;
    const r = Math.random();
    if (wave >= 5 && r > 0.9) type = 3;
    else if (wave >= 3 && r > 0.7) type = 2;
    else if (wave >= 2 && r > 0.5) type = 1;

    const def = ENEMIES[type];
    const scale = 1 + (wave - 1) * 0.12;
    const enemyLane = Math.floor(Math.random() * 3);

    // Get unit ID for this enemy type (enemies use unit visuals)
    const unitDef = UNITS.find(u => u.id === def.unitId);
    const animId = generateUnitId(unitDef?.id || 'enemy', true);

    const enemy = {
      type,
      lane: enemyLane,
      x: enemyLane * laneW + laneW / 2,  // Center of lane
      y: -60 - i * 100,
      rotation: 180,  // Facing down (south)
      hp: Math.floor(def.health * scale),
      maxHp: Math.floor(def.health * scale),
      animId,  // For animation system
      lastY: -60 - i * 100,  // Track movement
      isMoving: true  // Enemies start moving
    };

    b.enemies.push(enemy);

    // Initialize animation state for this enemy (if it has a unit visual)
    if (useCanvasRendering && unitDef) {
      sprites.initAnimatedUnit(animId, unitDef.id, 'default').then(variantData => {
        if (variantData) {
          sprites.setUnitAnimTrigger(animId, 'move');  // Enemies start moving
        }
      });
    }
  }

  b.waveSize = count;
  b.killed = 0;
}

export function deploy(laneIdx) {
  const b = Game.battle;
  const lane = b.lanes[laneIdx];

  if (lane.cooldown > 0) return;

  onDeploy(laneIdx, () => {
    const def = UNITS[lane.unit];
    const bf = document.querySelector('.battlefield');
    const h = bf ? bf.offsetHeight : 400;
    const laneW = bf ? bf.offsetWidth / 3 : 100;

    // Generate unique animation ID for this unit
    const animId = generateUnitId(def.id, false);

    const newUnit = {
      type: lane.unit,
      y: h - 80,
      x: laneIdx * laneW + laneW / 2,  // Center of lane
      rotation: 0,  // Facing up (north)
      lastShot: 0,
      animId,  // For animation system
      lastY: h - 80,  // Track movement for animation triggers
      isMoving: false
    };

    lane.deployed.push(newUnit);

    // Initialize animation state for this unit (async, but don't block)
    if (useCanvasRendering) {
      sprites.initAnimatedUnit(animId, def.id, 'default').then(variantData => {
        if (variantData) {
          console.log(`[game] Initialized animation for ${animId}`);
        }
      });
    }

    lane.cooldown = def.deployCooldown;
    sound('deploy');
    setSubState(SubState.PLAYING);
  });
}

export function switchUnit(laneIdx, unitIdx) {
  onSwitch(laneIdx, unitIdx, () => {
    Game.battle.lanes[laneIdx].unit = unitIdx;
    render();
  });
}

function finishBattle() {
  Game.stats.gamesPlayed++;
  if (Game.battle.score > Game.stats.highScore) {
    Game.stats.highScore = Game.battle.score;
  }
  if (Game.battle.wave > Game.stats.highestWave) {
    Game.stats.highestWave = Game.battle.wave;
  }
  save();
}

// ═══════════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════════

function startLoop() {
  if (loopId) return;
  lastT = performance.now();
  loopId = requestAnimationFrame(loop);
}

export function stopLoop() {
  if (loopId) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
  // Stop fire range loop if running
  stopFireRangeLoop();
  // Clear all animation states when loop stops
  if (useCanvasRendering) {
    sprites.clearAllAnimatedUnits();
  }
}

function loop(t) {
  if (Game.state !== State.BATTLE) {
    loopId = null;
    return;
  }

  const dt = t - lastT;
  lastT = t;

  // Update animation frame every ~150ms (3 frames total, cycles through)
  animFrame = Math.floor(t / 150) % 3;

  update(dt);
  draw();

  loopId = requestAnimationFrame(loop);
}

function update(dt) {
  clearQueryCache();
  const b = Game.battle;
  const bf = document.querySelector('.battlefield');
  const bfH = bf ? bf.offsetHeight : 400;
  const bfW = bf ? bf.offsetWidth : 300;
  const laneW = bfW / 3;
  const dtSec = dt / 1000;
  const now = Date.now();

  // Cooldowns
  b.lanes.forEach(lane => {
    if (lane.cooldown > 0) lane.cooldown = Math.max(0, lane.cooldown - dt);
  });

  // Prepare enemy data with isAir property for blocking checks
  const enemiesWithAir = b.enemies.map(e => ({
    ...e,
    isAir: ENEMIES[e.type].isAir
  }));

  // Move player units (advance toward enemies - direction: -1 = up)
  b.lanes.forEach((lane, li) => {
    // Prepare deployed units with required properties
    const deployedWithProps = lane.deployed.map(u => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      return { ...u, lane: li, isAir: combatStats?.isAir || false };
    });

    lane.deployed.forEach((u, ui) => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      if (!combatStats) return;

      const unitWithProps = { ...u, lane: li, isAir: combatStats.isAir };

      // Use shared blocking function
      u.blocked = isBlocked(unitWithProps, enemiesWithAir, -1);

      const prevY = u.y;
      if (!u.blocked) {
        u.y = Math.max(50, u.y - combatStats.speed * dtSec);
      }

      // Update animation based on movement
      updateUnitMovementAnim(u, prevY);
    });
  });

  // Prepare player units for enemy blocking checks
  const allPlayerUnits = b.lanes.flatMap((lane, li) =>
    lane.deployed.map(u => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      return { ...u, lane: li, isAir: combatStats?.isAir || false };
    })
  );

  // Move enemies (advance toward player base - direction: 1 = down)
  b.enemies.forEach(e => {
    if (e.dead) return;

    const eDef = ENEMIES[e.type];
    const enemyWithProps = { ...e, isAir: eDef.isAir };

    // Use shared blocking function
    e.blocked = isBlocked(enemyWithProps, allPlayerUnits, 1);

    const prevY = e.y;
    if (!e.blocked) {
      e.y += eDef.speed * dt / 16;
    }

    // Update animation based on movement
    updateUnitMovementAnim(e, prevY);

    // Reached base
    if (e.y > bfH - 50) {
      b.health -= eDef.damage;
      e.dead = true;
      cleanupUnitAnim(e);  // Clean up animation state
      sound('hit');

      if (b.health <= 0) {
        b.health = 0;
        goto(State.DEFEAT);
      }
    }
  });

  // Combat - player units fire at enemies in range
  b.lanes.forEach((lane, li) => {
    lane.deployed.forEach(u => {
      const stats = getUnitStats(u.type);
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      if (!combatStats) return;

      const unitWithProps = { ...u, lane: li };

      // Use shared targeting function
      const targets = findTargetsInRange(unitWithProps, enemiesWithAir, combatStats.range, -1);

      // Update aim toward closest target (even if not firing)
      if (targets.length && u.animId) {
        const target = getClosestTarget(targets, -1);
        // Calculate aim angle: 0 = up, positive = clockwise
        const dx = (target.x || target.lane * laneW + laneW / 2) - (u.x || li * laneW + laneW / 2);
        const dy = target.y - u.y;
        const aimAngle = Math.atan2(dx, -dy) * 180 / Math.PI;  // -dy because up is negative
        sprites.setUnitAimAngle(u.animId, aimAngle);
      }

      if (targets.length && now - u.lastShot > stats.fireRate) {
        const target = getClosestTarget(targets, -1);
        u.lastShot = now;

        // Trigger fire animation
        triggerFireAnim(u);

        // Create projectile using shared function
        const proj = createProjectile({
          unitId: unitDef.id,
          x: li * laneW + laneW / 2,
          y: u.y - 20,
          lane: li,
          damage: stats.damage,
          attackerTypes: stats.types,
          direction: -1,
          owner: Owner.PLAYER
        });
        b.projectiles.push(proj);

        // Muzzle flash effect
        const projDef = PROJECTILES[proj.type];
        if (projDef) {
          b.effects.push({
            type: 'muzzle',
            x: li * laneW + laneW / 2,
            y: u.y - 25,
            size: projDef.muzzleFlash.size,
            color: projDef.color,
            t: now
          });
        }
        sound('shoot');
      }
    });
  });

  // Combat - enemies fire at player units in range
  b.enemies.forEach(e => {
    if (e.dead) return;

    const eDef = ENEMIES[e.type];
    if (!e.lastShot) e.lastShot = 0;

    // Find player units in this enemy's lane that are in range
    const enemyWithProps = { ...e, y: e.y };
    const targetsInLane = allPlayerUnits.filter(u => u.lane === e.lane);
    const targets = findTargetsInRange(enemyWithProps, targetsInLane, eDef.range, 1);

    // Fire rate based on enemy type (faster enemies shoot less frequently)
    const fireRate = 1500 - (eDef.speed * 100); // Slower enemies shoot faster

    if (targets.length && now - e.lastShot > fireRate) {
      e.lastShot = now;

      // Get the unit that this enemy type is based on for projectile type
      const linkedUnit = UNITS.find(u => u.id === eDef.unitId);
      const projUnitId = linkedUnit ? linkedUnit.id : 'infantry';

      const proj = createProjectile({
        unitId: projUnitId,
        x: e.lane * laneW + laneW / 2,
        y: e.y + 20,
        lane: e.lane,
        damage: eDef.damage,
        attackerTypes: eDef.types,
        direction: 1,
        owner: Owner.ENEMY
      });
      b.projectiles.push(proj);
      sound('shoot');
    }
  });

  // Prepare player units as targets for enemy projectiles
  // Add lane property directly to units and initialize HP
  b.lanes.forEach((lane, li) => {
    lane.deployed.forEach(u => {
      u.lane = li;  // Add lane reference directly
      // Initialize HP if not set
      if (!u.hp) {
        const unitDef = UNITS[u.type];
        u.hp = unitDef.upgrades.damage.levels[0] * 5;
        u.maxHp = u.hp;
      }
    });
  });

  // Flatten for targeting (these are references, not copies)
  const playerUnitsAsTargets = b.lanes.flatMap(lane => lane.deployed);

  // Track HP before projectile updates for hit animations
  const enemyHpBefore = new Map(b.enemies.map(e => [e, e.hp]));
  const playerHpBefore = new Map(playerUnitsAsTargets.map(u => [u, u.hp]));

  // Update player projectiles (hitting enemies) - using shared module
  const playerProjs = b.projectiles.filter(p => p.owner === Owner.PLAYER);
  const playerProjResult = updateProjectiles(
    playerProjs,
    b.enemies,
    dtSec,
    bfH,
    (target) => ENEMIES[target.type].types
  );

  // Update enemy projectiles (hitting player units) - using shared module
  const enemyProjs = b.projectiles.filter(p => p.owner === Owner.ENEMY);
  const enemyProjResult = updateProjectiles(
    enemyProjs,
    playerUnitsAsTargets,
    dtSec,
    bfH,
    (target) => UNITS[target.type].types
  );

  // Trigger hit animations for damaged units
  b.enemies.forEach(e => {
    const hpBefore = enemyHpBefore.get(e);
    if (hpBefore !== undefined && e.hp < hpBefore) {
      triggerHitAnim(e);
    }
  });
  playerUnitsAsTargets.forEach(u => {
    const hpBefore = playerHpBefore.get(u);
    if (hpBefore !== undefined && u.hp < hpBefore) {
      triggerHitAnim(u);
    }
  });

  // No sync needed - updateProjectiles modified the original units directly

  // Combine projectile results
  b.projectiles = [...playerProjResult.projectiles, ...enemyProjResult.projectiles];
  b.effects.push(...playerProjResult.effects, ...enemyProjResult.effects);

  // Clean up dead player units (with animation cleanup)
  b.lanes.forEach(lane => {
    lane.deployed.forEach(u => {
      if (u.dead) cleanupUnitAnim(u);
    });
    lane.deployed = lane.deployed.filter(u => !u.dead);
  });

  // Handle kills and loot (game-specific logic)
  b.enemies.forEach(e => {
    if (e.dead && !e.looted) {
      e.looted = true;
      b.killed++;
      const eDef = ENEMIES[e.type];

      Game.resources.scrap += eDef.scrap;
      b.score += eDef.scrap * 10;
      Game.stats.totalKills++;
      Game.stats.totalScrap += eDef.scrap;

      const ex = e.lane * laneW + laneW / 2 - 15;
      b.effects.push({ type: 'loot', x: ex + 20, y: e.y - 10, text: `+${eDef.scrap}`, cls: 'scrap', t: now });

      if (Math.random() < eDef.partsChance) {
        Game.resources.parts++;
        b.effects.push({ type: 'loot', x: ex + 40, y: e.y - 10, text: '+1', cls: 'parts', t: now });
      }
    }
  });

  // Cleanup dead enemies (with animation cleanup)
  b.enemies.forEach(e => {
    if (e.dead) cleanupUnitAnim(e);
  });
  b.enemies = b.enemies.filter(e => !e.dead);

  // Clean up effects
  b.effects = b.effects.filter(e => {
    const age = now - e.t;
    if (e.type === 'muzzle') return age < 80;
    if (e.type === 'impact') return age < 200;
    return age < 1000;
  });

  // Wave complete?
  if (b.enemies.length === 0 && b.killed >= b.waveSize) {
    if (Game.settings.mode === 'classic') {
      // Classic mode: infinite waves, no victory - just wave complete
      goto(State.WAVE_COMPLETE);
    } else if (Game.settings.mode === 'waves' && b.wave >= 10) {
      goto(State.VICTORY);
    } else {
      goto(State.WAVE_COMPLETE);
    }
  }
}

function draw() {
  const b = Game.battle;
  const bf = document.querySelector('.battlefield');
  if (!bf) return;

  const laneW = bf.offsetWidth / 3;

  // Update HUD
  const hpFill = document.querySelector('.health-fill');
  const hpText = document.querySelector('.health-text');
  const scoreTxt = document.querySelector('.score-display');
  const scrapTxt = document.querySelector('.hud-scrap');

  if (hpFill) hpFill.style.width = `${(b.health / b.maxHealth) * 100}%`;
  if (hpText) hpText.textContent = b.health;
  if (scoreTxt) scoreTxt.textContent = b.score.toLocaleString();
  if (scrapTxt) scrapTxt.textContent = `⬡ ${Game.resources.scrap}`;

  // Update cooldown bars
  b.lanes.forEach((lane, i) => {
    const slot = document.querySelector(`[data-slot="${i}"]`);
    if (!slot) return;

    const def = UNITS[lane.unit];
    const ready = lane.cooldown <= 0;
    const pct = ready ? 100 : (1 - lane.cooldown / def.deployCooldown) * 100;

    const fill = slot.querySelector('.cooldown-fill');
    if (fill) fill.style.width = `${pct}%`;

    let dot = slot.querySelector('.deploy-ready');
    if (ready && !dot) {
      slot.insertAdjacentHTML('afterbegin', '<div class="deploy-ready"></div>');
    } else if (!ready && dot) {
      dot.remove();
    }
  });

  // Clear entities (including shadows) - but not canvas
  bf.querySelectorAll('.enemy, .unit, .unit-shadow, .explosion, .loot-drop, .projectile, .muzzle-flash, .impact').forEach(el => el.remove());

  // Canvas-based animated sprite rendering
  if (useCanvasRendering && battleCtx) {
    const gameTime = performance.now();

    // Clear canvas
    battleCtx.clearRect(0, 0, battleCanvas.width, battleCanvas.height);

    // Shadow config for canvas rendering
    const shadowConfig = SHADOW_CONFIG.enabled ? {
      offsetAngle: SHADOW_CONFIG.sunDirection + 180,
      offsetDistance: 4,
      opacity: 0.3
    } : null;

    // Helper: check if unit has animation ready
    const hasAnimReady = (animId) => animId && sprites.hasAnimatedUnit(animId);

    // Render enemies - canvas if ready, DOM fallback if not
    b.enemies.forEach(e => {
      const x = e.x || (e.lane * laneW + laneW / 2);

      if (hasAnimReady(e.animId)) {
        // Canvas rendering
        sprites.renderAnimatedUnit(battleCtx, e.animId, x, e.y, e.rotation || 180, 0.4, gameTime, shadowConfig);
      } else {
        // DOM fallback
        const enemyDef = ENEMIES[e.type];
        const unitDef = UNITS.find(u => u.id === enemyDef.unitId);
        const rotation = e.rotation ?? 180;

        if (SHADOW_CONFIG.enabled) {
          const shadow = createShadowElement(x - 25, e.y, rotation);
          if (shadow && unitDef) {
            shadow.innerHTML = getUnitShadow(unitDef, animFrame);
            bf.appendChild(shadow);
          }
        }

        const el = document.createElement('div');
        el.className = 'enemy';
        el.style.left = `${x - 25}px`;
        el.style.top = `${e.y}px`;
        el.style.transform = `rotate(${rotation}deg)`;
        el.innerHTML = `
          ${unitDef ? getUnitVisual(unitDef, 'enemy', animFrame) : ''}
          <div class="health-pip" style="transform: rotate(${-rotation}deg);"><div class="health-pip-fill" style="width:${(e.hp/e.maxHp)*100}%"></div></div>
        `;
        bf.appendChild(el);
        return;  // Skip canvas health bar below
      }

      // Health bar for canvas-rendered enemy
      const el = document.createElement('div');
      el.className = 'enemy';
      el.style.left = `${x - 25}px`;
      el.style.top = `${e.y}px`;
      el.style.width = '50px';
      el.style.height = '50px';
      el.innerHTML = `<div class="health-pip"><div class="health-pip-fill" style="width:${(e.hp/e.maxHp)*100}%"></div></div>`;
      bf.appendChild(el);
    });

    // Render player units - canvas if ready, DOM fallback if not
    b.lanes.forEach((lane, li) => {
      lane.deployed.forEach(u => {
        const x = u.x || (li * laneW + laneW / 2);
        const def = UNITS[u.type];
        const rotation = u.rotation ?? 0;

        if (hasAnimReady(u.animId)) {
          // Canvas rendering
          sprites.renderAnimatedUnit(battleCtx, u.animId, x, u.y, rotation, 0.4, gameTime, shadowConfig);

          // Health bar if damaged
          if (u.hp && u.hp < u.maxHp) {
            const el = document.createElement('div');
            el.className = 'unit';
            el.style.left = `${x - 25}px`;
            el.style.top = `${u.y}px`;
            el.style.width = '50px';
            el.style.height = '50px';
            const hpPercent = (u.hp / u.maxHp) * 100;
            el.innerHTML = `<div class="health-pip player-hp"><div class="health-pip-fill" style="width:${hpPercent}%"></div></div>`;
            bf.appendChild(el);
          }
        } else {
          // DOM fallback
          if (SHADOW_CONFIG.enabled) {
            const shadow = createShadowElement(x - 25, u.y, rotation);
            if (shadow) {
              shadow.innerHTML = getUnitShadow(def, animFrame);
              bf.appendChild(shadow);
            }
          }

          const el = document.createElement('div');
          el.className = 'unit';
          el.style.left = `${x - 25}px`;
          el.style.top = `${u.y}px`;
          el.style.transform = `rotate(${rotation}deg)`;

          const hpPercent = u.hp && u.maxHp ? (u.hp / u.maxHp) * 100 : 100;
          const showHealthBar = u.hp && u.hp < u.maxHp;
          el.innerHTML = `
            ${getUnitVisual(def, 'player', animFrame)}
            ${showHealthBar ? `<div class="health-pip player-hp" style="transform: rotate(${-rotation}deg);"><div class="health-pip-fill" style="width:${hpPercent}%"></div></div>` : ''}
          `;
          bf.appendChild(el);
        }
      });
    });
  } else {
    // Fallback: DOM-based rendering (original code)

    // Draw shadows first (behind all units)
    if (SHADOW_CONFIG.enabled) {
      // Enemy shadows
      b.enemies.forEach(e => {
        const enemyDef = ENEMIES[e.type];
        const unitDef = UNITS.find(u => u.id === enemyDef.unitId);
        const x = e.lane * laneW + (laneW - 50) / 2;
        const content = unitDef ? getUnitShadow(unitDef, animFrame) : '';

        const shadow = createShadowElement(x, e.y, e.rotation || 180);
        if (shadow) {
          shadow.innerHTML = content;
          bf.appendChild(shadow);
        }
      });

      // Player unit shadows
      b.lanes.forEach((lane, li) => {
        lane.deployed.forEach(u => {
          const def = UNITS[u.type];
          const x = li * laneW + (laneW - 50) / 2;
          const content = getUnitShadow(def, animFrame);

          const shadow = createShadowElement(x, u.y, u.rotation || 0);
          if (shadow) {
            shadow.innerHTML = content;
            bf.appendChild(shadow);
          }
        });
      });
    }

    // Draw enemies using their linked unit visuals (PNG or SVG)
    b.enemies.forEach(e => {
      const enemyDef = ENEMIES[e.type];
      const unitDef = UNITS.find(u => u.id === enemyDef.unitId);
      const rotation = e.rotation ?? 180;

      const el = document.createElement('div');
      el.className = 'enemy';
      el.style.left = `${e.lane * laneW + (laneW - 50) / 2}px`;
      el.style.top = `${e.y}px`;
      el.style.transform = `rotate(${rotation}deg)`;

      const content = unitDef ? getUnitVisual(unitDef, 'enemy', animFrame) : '';
      // Counter-rotate health bar so it stays upright
      el.innerHTML = `
        ${content}
        <div class="health-pip" style="transform: rotate(${-rotation}deg);"><div class="health-pip-fill" style="width:${(e.hp/e.maxHp)*100}%"></div></div>
      `;
      bf.appendChild(el);
    });

    // Draw player units (PNG or SVG)
    b.lanes.forEach((lane, li) => {
      lane.deployed.forEach(u => {
        const def = UNITS[u.type];
        const rotation = u.rotation ?? 0;

        const el = document.createElement('div');
        el.className = 'unit';
        el.style.left = `${li * laneW + (laneW - 50) / 2}px`;
        el.style.top = `${u.y}px`;
        el.style.transform = `rotate(${rotation}deg)`;

        // Show health bar if unit has taken damage
      const hpPercent = u.hp && u.maxHp ? (u.hp / u.maxHp) * 100 : 100;
      const showHealthBar = u.hp && u.hp < u.maxHp;

      // Counter-rotate health bar so it stays upright
      el.innerHTML = `
        ${getUnitVisual(def, 'player', animFrame)}
        ${showHealthBar ? `<div class="health-pip player-hp" style="transform: rotate(${-rotation}deg);"><div class="health-pip-fill" style="width:${hpPercent}%"></div></div>` : ''}
      `;
      bf.appendChild(el);
    });
  });
  } // End of DOM-based rendering else block

  // Draw projectiles
  b.projectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) return;
    const el = document.createElement('div');
    el.className = 'projectile';
    el.style.left = `${p.x - projDef.width / 2}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${Math.max(projDef.width, 6)}px`;
    el.style.height = `${Math.max(projDef.height, 12)}px`;
    el.style.backgroundColor = projDef.color;
    el.style.borderRadius = '2px';
    el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}`;

    if (projDef.trail) {
      el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}, 0 ${projDef.height}px ${projDef.height * 2}px ${projDef.trailColor}`;
    }

    bf.appendChild(el);
  });

  // Draw effects
  const now = Date.now();
  b.effects.forEach(fx => {
    const age = now - fx.t;
    const el = document.createElement('div');

    if (fx.type === 'explosion') {
      el.className = 'explosion';
      el.style.left = `${fx.x}px`;
      el.style.top = `${fx.y}px`;
    } else if (fx.type === 'muzzle') {
      // Muzzle flash - very short duration
      if (age > 80) return;
      el.className = 'muzzle-flash';
      const scale = 1 - (age / 80);
      const size = fx.size * scale;
      el.style.left = `${fx.x - size / 2}px`;
      el.style.top = `${fx.y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.backgroundColor = fx.color;
      el.style.borderRadius = '50%';
      el.style.boxShadow = `0 0 ${size}px ${fx.color}, 0 0 ${size * 2}px ${fx.color}`;
      el.style.opacity = scale;
    } else if (fx.type === 'impact') {
      // Impact effect - scales with damage
      if (age > 200) return;
      el.className = 'impact';
      const scale = 1 - (age / 200);
      const size = fx.size * (1 + (1 - scale) * 0.5);
      el.style.left = `${fx.x - size / 2}px`;
      el.style.top = `${fx.y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.backgroundColor = fx.color;
      el.style.borderRadius = '50%';
      el.style.boxShadow = `0 0 ${size / 2}px ${fx.color}`;
      el.style.opacity = scale * 0.8;
    } else if (fx.type === 'loot') {
      el.className = `loot-drop ${fx.cls}`;
      el.style.left = `${fx.x}px`;
      el.style.top = `${fx.y}px`;
      el.textContent = fx.text;
    }

    bf.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════════
// COUNTDOWN
// ═══════════════════════════════════════════════════════════════

function runCountdown() {
  const interval = setInterval(() => {
    Game.battle.countdown--;
    const el = document.getElementById('countdown-num');
    if (el) el.textContent = Game.battle.countdown || 'GO!';

    if (Game.battle.countdown <= 0) {
      clearInterval(interval);
      setTimeout(() => goto(State.BATTLE), 400);
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// H2H - Head to Head Mode
// ═══════════════════════════════════════════════════════════════

// Get list of unlocked unit indices
function getUnlockedUnitIndices() {
  const unlocked = Game.player.unlockedUnits;
  return UNITS.map((u, i) => unlocked.includes(u.id) ? i : -1).filter(i => i >= 0);
}

// Calculate cost of a wave (sum of all non-null lanes)
function getWaveCost(wave) {
  return wave.lanes.reduce((sum, unitIdx) => {
    if (unitIdx === null) return sum;
    return sum + UNIT_COSTS[UNITS[unitIdx].id];
  }, 0);
}

// Recalculate total spent from all waves
function recalculateSpent() {
  const h2h = Game.h2h;
  h2h.spent = h2h.playerAttack.reduce((sum, wave) => sum + getWaveCost(wave), 0);
}

// Generate AI attack pattern and defense lineup
function generateAIPattern() {
  const h2h = Game.h2h;
  const difficulty = Game.settings.difficulty;
  const round = h2h.round;

  // Get available units (AI uses all units regardless of player unlock)
  const unitIndices = UNITS.map((_, i) => i);

  // Pick a unit based on difficulty
  function pickUnit() {
    if (difficulty === 'easy') {
      const cheapUnits = unitIndices.filter(idx => UNIT_COSTS[UNITS[idx].id] <= 25);
      return cheapUnits[Math.floor(Math.random() * cheapUnits.length)];
    } else if (difficulty === 'hard' && round > 1 && Math.random() > 0.5) {
      // Try to counter player's defense types
      const playerTypes = h2h.playerDefense.flatMap(idx => UNITS[idx].types);
      const counters = unitIndices.filter(idx => {
        const unitTypes = UNITS[idx].types;
        return unitTypes.some(t => playerTypes.some(pt => getTypeMultiplier([t], [pt]) > 1));
      });
      return counters.length > 0
        ? counters[Math.floor(Math.random() * counters.length)]
        : unitIndices[Math.floor(Math.random() * unitIndices.length)];
    }
    return unitIndices[Math.floor(Math.random() * unitIndices.length)];
  }

  // Build attack waves - each wave has all 3 lanes
  const attack = [];
  let budget = H2H_BUDGET;
  let delay = 0;

  const waveCount = difficulty === 'easy' ? 4 : difficulty === 'hard' ? 8 : 6;

  for (let i = 0; i < waveCount && budget > 0; i++) {
    const lanes = [null, null, null];
    let waveCost = 0;

    // Fill lanes randomly (more lanes filled on higher difficulty)
    const lanesToFill = difficulty === 'easy' ? 1 + Math.floor(Math.random() * 2) :
                        difficulty === 'hard' ? 2 + Math.floor(Math.random() * 2) :
                        1 + Math.floor(Math.random() * 3);

    const laneOrder = [0, 1, 2].sort(() => Math.random() - 0.5);

    for (let j = 0; j < lanesToFill && j < 3; j++) {
      const laneIdx = laneOrder[j];
      const unitIdx = pickUnit();
      const cost = UNIT_COSTS[UNITS[unitIdx].id];

      if (waveCost + cost <= budget) {
        lanes[laneIdx] = unitIdx;
        waveCost += cost;
      }
    }

    if (waveCost > 0) {
      attack.push({
        delay: delay * 1000,
        lanes
      });
      budget -= waveCost;
      delay += 2 + Math.random() * 2; // 2-4s between waves
    }
  }

  h2h.aiAttack = attack;

  // Generate defense lineup
  const defensePool = difficulty === 'easy'
    ? unitIndices.slice(0, 6)
    : unitIndices;

  h2h.aiDefense = [
    defensePool[Math.floor(Math.random() * defensePool.length)],
    defensePool[Math.floor(Math.random() * defensePool.length)],
    defensePool[Math.floor(Math.random() * defensePool.length)]
  ];
}

// H2H wave management functions

// Add a new empty wave
export function addH2HWave() {
  const h2h = Game.h2h;

  // Calculate delay based on existing waves
  const maxDelay = h2h.playerAttack.reduce((max, w) => Math.max(max, w.delay), 0);

  h2h.playerAttack.push({
    delay: h2h.playerAttack.length === 0 ? 0 : maxDelay + 2000, // 2 seconds after last wave
    lanes: [null, null, null]
  });

  return h2h.playerAttack.length - 1; // Return new wave index
}

// Remove a wave
export function removeH2HWave(index) {
  const h2h = Game.h2h;
  if (index < 0 || index >= h2h.playerAttack.length) return;

  h2h.playerAttack.splice(index, 1);
  recalculateSpent();
}

// Set a unit in a specific wave/lane (or null to clear)
export function setH2HWaveUnit(waveIndex, laneIndex, unitIdx) {
  const h2h = Game.h2h;
  if (waveIndex < 0 || waveIndex >= h2h.playerAttack.length) return false;
  if (laneIndex < 0 || laneIndex > 2) return false;

  const wave = h2h.playerAttack[waveIndex];
  const oldUnitIdx = wave.lanes[laneIndex];

  // Calculate cost change
  const oldCost = oldUnitIdx !== null ? UNIT_COSTS[UNITS[oldUnitIdx].id] : 0;
  const newCost = unitIdx !== null ? UNIT_COSTS[UNITS[unitIdx].id] : 0;
  const diff = newCost - oldCost;

  if (h2h.spent + diff > h2h.budget) {
    return false; // Would exceed budget
  }

  wave.lanes[laneIndex] = unitIdx;
  h2h.spent += diff;
  return true;
}

// Clear a lane in a wave
export function clearH2HWaveLane(waveIndex, laneIndex) {
  return setH2HWaveUnit(waveIndex, laneIndex, null);
}

export function setH2HDefense(laneIdx, unitIdx) {
  Game.h2h.playerDefense[laneIdx] = unitIdx;
}

// H2H Battle Loop
let h2hLoopId = null;
let h2hStartTime = 0;
let h2hPlayerSpawned = [];
let h2hAISpawned = [];

// Player's attacking units (going up toward AI base)
let playerAttackers = [];
// AI's attacking units (going down toward player base)
let aiAttackers = [];

function startH2HLoop() {
  if (h2hLoopId) return;

  h2hStartTime = Date.now();
  h2hPlayerSpawned = [];
  h2hAISpawned = [];
  playerAttackers = [];
  aiAttackers = [];
  h2hProjectiles = [];

  // Reset HP for this round
  Game.h2h.playerHP = 100;
  Game.h2h.aiHP = 100;

  // Reset defender shot timers
  Game.h2h.playerDefLastShot = [0, 0, 0];
  Game.h2h.aiDefLastShot = [0, 0, 0];

  lastT = performance.now();
  h2hLoopId = requestAnimationFrame(h2hLoop);
}

function stopH2HLoop() {
  if (h2hLoopId) {
    cancelAnimationFrame(h2hLoopId);
    h2hLoopId = null;
  }
}

function h2hLoop(t) {
  if (Game.state !== State.H2H_BATTLE) {
    h2hLoopId = null;
    return;
  }

  const dt = t - lastT;
  lastT = t;

  // Update animation frame every ~150ms
  animFrame = Math.floor(t / 150) % 3;

  updateH2H(dt);
  drawH2H();

  h2hLoopId = requestAnimationFrame(h2hLoop);
}

// H2H projectiles array
let h2hProjectiles = [];

function updateH2H(dt) {
  const h2h = Game.h2h;
  const elapsed = Date.now() - h2hStartTime;
  const bf = document.querySelector('.h2h-battlefield');
  const bfH = bf ? bf.offsetHeight : 400;
  const bfW = bf ? bf.offsetWidth : 300;
  const laneW = bfW / 3;
  const dtSec = dt / 1000;
  const now = Date.now();

  // Spawn player's attack waves (going toward AI base at top)
  h2h.playerAttack.forEach((wave, i) => {
    if (!h2hPlayerSpawned.includes(i) && elapsed >= wave.delay) {
      h2hPlayerSpawned.push(i);
      wave.lanes.forEach((unitIdx, laneIdx) => {
        if (unitIdx === null) return;
        const unit = UNITS[unitIdx];
        const combatStats = UNIT_COMBAT_STATS[unit.id];
        playerAttackers.push({
          unitIdx,
          lane: laneIdx,
          y: bfH - 60,
          hp: unit.upgrades.damage.levels[0] * 3,
          maxHp: unit.upgrades.damage.levels[0] * 3,
          lastShot: 0,
          isAir: combatStats.isAir
        });
      });
    }
  });

  // Spawn AI's attack waves (going toward player base at bottom)
  h2h.aiAttack.forEach((wave, i) => {
    if (!h2hAISpawned.includes(i) && elapsed >= wave.delay) {
      h2hAISpawned.push(i);
      wave.lanes.forEach((unitIdx, laneIdx) => {
        if (unitIdx === null) return;
        const unit = UNITS[unitIdx];
        const combatStats = UNIT_COMBAT_STATS[unit.id];
        aiAttackers.push({
          unitIdx,
          lane: laneIdx,
          y: 60,
          hp: unit.upgrades.damage.levels[0] * 3,
          maxHp: unit.upgrades.damage.levels[0] * 3,
          lastShot: 0,
          isAir: combatStats.isAir
        });
      });
    }
  });

  // Move player attackers up (toward AI base) - using shared blocking
  playerAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];

    a.blocked = isBlocked(a, aiAttackers, -1); // Moving up

    if (!a.blocked) {
      a.y -= combatStats.speed * dtSec;
    }

    // Reached AI base
    if (a.y < 50) {
      h2h.aiHP -= unit.upgrades.damage.levels[0];
      a.dead = true;
      sound('hit');
    }
  });

  // Move AI attackers down (toward player base) - using shared blocking
  aiAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];

    a.blocked = isBlocked(a, playerAttackers, 1); // Moving down

    if (!a.blocked) {
      a.y += combatStats.speed * dtSec;
    }

    // Reached player base
    if (a.y > bfH - 50) {
      h2h.playerHP -= unit.upgrades.damage.levels[0];
      a.dead = true;
      sound('hit');
    }
  });

  // Combat: Player attackers fire at AI attackers AND AI defenders
  playerAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];
    const stats = getUnitStats(a.unitIdx);

    // First check for AI attackers in range
    let targets = findTargetsInRange(a, aiAttackers, combatStats.range, -1);

    // If no AI attackers, check if close to AI defenders (at top)
    if (!targets.length) {
      // Create defender targets from AI defense lineup
      const defenderTargets = h2h.aiDefense.map((defIdx, lane) => ({
        y: 30,
        lane,
        dead: false,
        defIdx
      }));
      targets = findTargetsInRange(a, defenderTargets, combatStats.range, -1);
    }

    if (targets.length && now - a.lastShot > stats.fireRate) {
      a.lastShot = now;
      h2hProjectiles.push(createProjectile({
        unitId: unit.id,
        x: a.lane * laneW + laneW / 2,
        y: a.y - 20,
        lane: a.lane,
        damage: stats.damage,
        attackerTypes: stats.types,
        direction: -1,
        owner: Owner.PLAYER
      }));
      sound('shoot');
    }
  });

  // Combat: AI attackers fire at player attackers AND player defenders
  aiAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];
    const stats = getUnitStats(a.unitIdx);

    // First check for player attackers in range
    let targets = findTargetsInRange(a, playerAttackers, combatStats.range, 1);

    // If no player attackers, check if close to player defenders (at bottom)
    if (!targets.length) {
      // Create defender targets from player defense lineup
      const defenderTargets = h2h.playerDefense.map((defIdx, lane) => ({
        y: bfH - 30,
        lane,
        dead: false,
        defIdx
      }));
      targets = findTargetsInRange(a, defenderTargets, combatStats.range, 1);
    }

    if (targets.length && now - a.lastShot > stats.fireRate) {
      a.lastShot = now;
      h2hProjectiles.push(createProjectile({
        unitId: unit.id,
        x: a.lane * laneW + laneW / 2,
        y: a.y + 20,
        lane: a.lane,
        damage: stats.damage,
        attackerTypes: stats.types,
        direction: 1,
        owner: 'ai'
      }));
      sound('shoot');
    }
  });

  // Defense combat - player defenders vs AI attackers (static defenders at bottom)
  h2h.playerDefense.forEach((defIdx, lane) => {
    const defStats = getUnitStats(defIdx);
    const defUnit = UNITS[defIdx];
    const defCombat = UNIT_COMBAT_STATS[defUnit.id];
    const defender = { y: bfH - 30, lane };

    const targets = findTargetsInRange(defender, aiAttackers, defCombat.range, -1);

    if (!h2h.playerDefLastShot) h2h.playerDefLastShot = [0, 0, 0];

    if (targets.length && now - h2h.playerDefLastShot[lane] > defStats.fireRate) {
      h2h.playerDefLastShot[lane] = now;
      h2hProjectiles.push(createProjectile({
        unitId: defUnit.id,
        x: lane * laneW + laneW / 2,
        y: defender.y - 20,
        lane,
        damage: defStats.damage,
        attackerTypes: defStats.types,
        direction: -1,
        owner: Owner.PLAYER
      }));
      sound('shoot');
    }
  });

  // AI defense vs player attackers (static defenders at top)
  h2h.aiDefense.forEach((defIdx, lane) => {
    const defUnit = UNITS[defIdx];
    const defCombat = UNIT_COMBAT_STATS[defUnit.id];
    const baseDmg = defUnit.upgrades.damage.levels[0];
    const defender = { y: 30, lane };

    const targets = findTargetsInRange(defender, playerAttackers, defCombat.range, 1);

    if (!h2h.aiDefLastShot) h2h.aiDefLastShot = [0, 0, 0];

    if (targets.length && now - h2h.aiDefLastShot[lane] > 1000) {
      h2h.aiDefLastShot[lane] = now;
      h2hProjectiles.push(createProjectile({
        unitId: defUnit.id,
        x: lane * laneW + laneW / 2,
        y: defender.y + 20,
        lane,
        damage: baseDmg,
        attackerTypes: defUnit.types,
        direction: 1,
        owner: 'ai'
      }));
      sound('shoot');
    }
  });

  // Update projectiles - handle both directions
  h2hProjectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) { p.hit = true; return; }

    p.y += p.direction * projDef.speed * dtSec;

    // Check for impact based on projectile owner
    const targetList = p.owner === Owner.PLAYER ? aiAttackers : playerAttackers;
    const target = targetList.find(a => a.lane === p.lane && !a.dead && Math.abs(a.y - p.y) < 25);

    if (target) {
      const targetUnit = UNITS[target.unitIdx];
      const mult = getTypeMultiplier(p.attackerTypes, targetUnit.types);
      target.hp -= Math.round(p.damage * mult);
      p.hit = true;

      if (target.hp <= 0) {
        target.dead = true;
        sound('explosion');
      }
    }

    // Off screen
    if (p.y < -20 || p.y > bfH + 20) p.hit = true;
  });

  // Cleanup
  h2hProjectiles = h2hProjectiles.filter(p => !p.hit);
  playerAttackers = playerAttackers.filter(a => !a.dead);
  aiAttackers = aiAttackers.filter(a => !a.dead);

  // Clamp HP
  h2h.playerHP = Math.max(0, h2h.playerHP);
  h2h.aiHP = Math.max(0, h2h.aiHP);

  // Check win conditions
  const allSpawned = h2hPlayerSpawned.length >= h2h.playerAttack.length &&
                     h2hAISpawned.length >= h2h.aiAttack.length;
  const allDead = playerAttackers.length === 0 && aiAttackers.length === 0;

  if (h2h.playerHP <= 0 || h2h.aiHP <= 0 || (allSpawned && allDead)) {
    stopH2HLoop();
    endH2HRound();
  }
}

function endH2HRound() {
  const h2h = Game.h2h;

  // Determine round winner
  if (h2h.aiHP <= 0 && h2h.playerHP > 0) {
    h2h.score.player++;
  } else if (h2h.playerHP <= 0 && h2h.aiHP > 0) {
    h2h.score.ai++;
  } else if (h2h.playerHP > h2h.aiHP) {
    h2h.score.player++;
  } else if (h2h.aiHP > h2h.playerHP) {
    h2h.score.ai++;
  }
  // Tie: no one scores

  // Check match end
  const winScore = Math.ceil(h2h.bestOf / 2);
  if (h2h.score.player >= winScore || h2h.score.ai >= winScore) {
    goto(State.H2H_MATCH_END);
  } else {
    goto(State.H2H_RESULT);
  }
}

export function nextH2HRound() {
  const h2h = Game.h2h;
  h2h.round++;
  h2h.phase = 'design';
  h2h.playerAttack = [{ delay: 0, lanes: [null, null, null] }];
  h2h.spent = 0;
  h2h.selectedWave = 0;
  Game.h2hWaveLane = 0;
  h2h.playerHP = 100;
  h2h.aiHP = 100;
  goto(State.H2H_DESIGN);
}

export function resetH2H() {
  Game.h2h = null;
  goto(State.MENU);
}

function drawH2H() {
  const h2h = Game.h2h;
  const bf = document.querySelector('.h2h-battlefield');
  if (!bf) return;

  const laneW = bf.offsetWidth / 3;
  const bfH = bf.offsetHeight;

  // Update health bars
  const playerHpFill = document.querySelector('.player-hp-fill');
  const aiHpFill = document.querySelector('.ai-hp-fill');
  const playerHpText = document.querySelector('.player-hp-text');
  const aiHpText = document.querySelector('.ai-hp-text');

  if (playerHpFill) playerHpFill.style.width = `${h2h.playerHP}%`;
  if (aiHpFill) aiHpFill.style.width = `${h2h.aiHP}%`;
  if (playerHpText) playerHpText.textContent = Math.ceil(h2h.playerHP);
  if (aiHpText) aiHpText.textContent = Math.ceil(h2h.aiHP);

  // Clear entities
  bf.querySelectorAll('.h2h-unit, .h2h-projectile').forEach(el => el.remove());

  // Draw player attackers (going up) - uses player faction colors
  playerAttackers.forEach(a => {
    const unit = UNITS[a.unitIdx];
    const el = document.createElement('div');
    el.className = 'h2h-unit player-attacker';
    el.style.left = `${a.lane * laneW + (laneW - 40) / 2}px`;
    el.style.top = `${a.y}px`;
    el.innerHTML = getUnitVisual(unit, 'player', animFrame);
    bf.appendChild(el);
  });

  // Draw AI attackers (going down) - uses enemy faction colors
  aiAttackers.forEach(a => {
    const unit = UNITS[a.unitIdx];
    const el = document.createElement('div');
    el.className = 'h2h-unit ai-attacker';
    el.style.left = `${a.lane * laneW + (laneW - 40) / 2}px`;
    el.style.top = `${a.y}px`;
    el.innerHTML = getUnitVisual(unit, 'enemy', animFrame);
    el.style.transform = 'rotate(180deg)';
    bf.appendChild(el);
  });

  // Draw projectiles
  h2hProjectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) return;

    const el = document.createElement('div');
    el.className = 'h2h-projectile';
    el.style.position = 'absolute';
    el.style.left = `${p.x - projDef.width / 2}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${Math.max(projDef.width, 6)}px`;
    el.style.height = `${Math.max(projDef.height, 12)}px`;
    el.style.backgroundColor = projDef.color;
    el.style.borderRadius = '2px';
    el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}`;
    el.style.zIndex = '15';
    bf.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN BATTLE SYSTEM - Hero 2D combat
// ═══════════════════════════════════════════════════════════════

let campaignLoopId = null;
let campaignLastT = 0;

function startCampaignLoop() {
  if (campaignLoopId) return;
  _lastFeedIndex = 0;

  // Activate initial zone spawning for zone battles
  const b = Game.campaign?.heroBattle;
  if (b?.scenario && !b.zoneSpawningStarted) {
    activateInitialZone(b);
    b.zoneSpawningStarted = true;
  }

  campaignLastT = performance.now();
  campaignLoopId = requestAnimationFrame(campaignLoop);
}

function stopCampaignLoop() {
  if (campaignLoopId) {
    cancelAnimationFrame(campaignLoopId);
    campaignLoopId = null;
  }
  // Destroy BattleRenderer to stop its RAF loop and resize observer
  const b = Game.campaign?.heroBattle;
  if (b?.battleRenderer) {
    b.battleRenderer.destroy();
    b.battleRenderer = null;
  }
}

function campaignLoop(t) {
  if (Game.state !== State.CAMPAIGN_BATTLE) {
    campaignLoopId = null;
    return;
  }

  const dt = t - campaignLastT;
  campaignLastT = t;

  updateCampaignBattle(dt);
  drawCampaignBattle();

  campaignLoopId = requestAnimationFrame(campaignLoop);
}

// ═══════════════════════════════════════════════════════════════
// ENDLESS BATTLE LOOP
// ═══════════════════════════════════════════════════════════════

let endlessLoopId = null;
let endlessLastT = 0;

// ── Deployment phase update ─────────────────────────────────
function updateDeployment(b, now) {
  // Red auto-readies immediately (AI plans instantly)
  if (!b.deployReady.red) {
    b.deployReady.red = true;
  }

  // Transition to countdown when both sides ready
  if (b.deployReady.blue && b.deployReady.red) {
    b.phase = 'countdown';
    b.countdownStart = now;
  }
}

// ── Countdown phase update ──────────────────────────────────
function updateCountdown(b, now, dtSec) {
  const elapsed = (now - b.countdownStart) / 1000;
  const COUNTDOWN_DURATION = 5.0;

  // Red gets ~1s head start on marching
  if (elapsed >= 1.0 && !b._redMarching) {
    b._redMarching = true;
    // Set red waypoints to 20-25% map depth
    if (b._squads) {
      for (const sq of b._squads) {
        if (sq.team === 'red' && sq.sergeant) {
          const targetY = b.mapHeight * 0.2 + (Math.random() - 0.5) * 50;
          const sgt = sq.sergeant;
          const wp = { x: sgt.spawnZone?.x || b.mapWidth / 2, y: targetY };
          if (!b._squadWaypoints) b._squadWaypoints = {};
          b._squadWaypoints[sq.id] = wp;
          sgt.waypoint = wp;
          if (!b._teamWaypoints) b._teamWaypoints = {};
          b._teamWaypoints.red = wp;
        }
      }
    }
  }

  // Blue starts marching at ~2s (after camera pan)
  const selectedZone = b.deployZones?.blue?.find(z => z.selected);
  const marchTargetX = selectedZone ? selectedZone.x + selectedZone.width / 2 : b.mapWidth / 2;
  const marchTargetY = b.mapHeight - b.cellSize * 3;

  if (elapsed >= 2.0 && !b._blueMarching) {
    b._blueMarching = true;
    if (!b._teamWaypoints) b._teamWaypoints = {};
    b._teamWaypoints.blue = { x: marchTargetX, y: marchTargetY };
    if (b._squads) {
      for (const sq of b._squads) {
        if (sq.team === 'blue' && sq.sergeant) {
          if (!b._squadWaypoints) b._squadWaypoints = {};
          b._squadWaypoints[sq.id] = { x: marchTargetX, y: marchTargetY };
          sq.sergeant.waypoint = { x: marchTargetX, y: marchTargetY };
        }
      }
    }
  }

  // March hero alongside the squad (same pace, same direction)
  if (b._blueMarching && b.hero.y > marchTargetY) {
    const marchSpeed = b.hero.speed || 80;
    const dx = marchTargetX - b.hero.x;
    const dy = marchTargetY - b.hero.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) {
      const step = marchSpeed * dtSec;
      b.hero.x += (dx / dist) * step;
      b.hero.y += (dy / dist) * step;
      b.hero.hullAngle = Math.atan2(dy, dx);
      b.hero.angle = b.hero.hullAngle;
      b.hero.isMoving = true;
    } else {
      b.hero.isMoving = false;
    }
  }

  // Freeze blue units until march starts — save positions, run AI, restore
  const bluePositions = [];
  if (!b._blueMarching) {
    for (const u of (b.units || [])) {
      if (u.team !== 'red') bluePositions.push({ u, x: u.x, y: u.y, angle: u.angle });
    }
  }

  // Run AI pipeline during countdown so units march
  runBattleAI(b, now, dtSec);

  // Restore frozen blue positions
  for (const snap of bluePositions) {
    snap.u.x = snap.x;
    snap.u.y = snap.y;
    snap.u.angle = snap.angle;
  }

  // Transition to active
  if (elapsed >= COUNTDOWN_DURATION) {
    b.phase = 'active';
    b.hero.isMoving = false;

    if (b.playMode === 'cmd') {
      // CMD mode: free-pan camera, hero is AI-driven
      initCMDMode(b);
      b.hero.isHero = true;
      b.hero.team = Team.BLUE;
      // Give hero an id for debug tracking
      if (!b.hero.id) b.hero.id = `hero_${Date.now()}`;
    } else {
      // Unit mode: reset camera for hero auto-follow
      b.camera._manualPan = false;
      b.camera.userZoom = 1;
    }

    // Keep a small staging margin so subsequent waves can spawn off-map and march in
    b.stageDepth = 200;
  }
}

function startEndlessLoop() {
  if (endlessLoopId) return;
  _lastFeedIndex = 0;

  const b = Game.endless?.battle;
  if (b) {
    // Spawn initial enemies
    spawnEndlessWave(b);
  }

  endlessLastT = performance.now();
  endlessLoopId = requestAnimationFrame(endlessLoop);
}

function stopEndlessLoop() {
  if (endlessLoopId) {
    cancelAnimationFrame(endlessLoopId);
    endlessLoopId = null;
  }
  // Destroy BattleRenderer to stop its RAF loop and resize observer
  const b = Game.endless?.battle;
  if (b?.battleRenderer) {
    b.battleRenderer.destroy();
    b.battleRenderer = null;
  }
  destroyDebugPanel();
}

function endlessLoop(t) {
  if (Game.state !== State.ENDLESS_BATTLE) {
    endlessLoopId = null;
    return;
  }

  const dt = t - endlessLastT;
  endlessLastT = t;

  const b = Game.endless?.battle;
  if (b?._debugPaused) {
    // Frozen — still draw (with overlay) but don't update
    drawEndlessBattle();
  } else {
    const scaledDt = dt * (b?._debugTimeScale || 1);
    updateEndlessBattle(scaledDt);
    drawEndlessBattle();
  }

  endlessLoopId = requestAnimationFrame(endlessLoop);
}

// Update endless battle (reuses campaign battle logic)
function updateEndlessBattle(dt) {
  clearQueryCache();
  const b = Game.endless?.battle;
  if (!b || b.result) return;

  const dtSec = dt / 1000;
  const now = Date.now();

  // --- DEPLOYMENT PHASE GATING ---
  if (b.phase === 'deploying') {
    updateDeployment(b, now);
    return;
  }
  if (b.phase === 'countdown') {
    updateCountdown(b, now, dtSec);
    return;
  }

  // --- CMD MODE: skip hero controls, hero is AI-driven ---
  const hero = b.hero;
  const isCMD = b.playMode === 'cmd';

  if (isCMD) {
    // Hero movement/aiming/shooting handled by AI brain in runBattleAI
    // Just track velocity for fire decision pipeline
    const velDx = hero.x - (hero.lastX || hero.x);
    const velDy = hero.y - (hero.lastY || hero.y);
    hero.velocity = dtSec > 0 ? Math.sqrt(velDx * velDx + velDy * velDy) / dtSec : 0;
    hero.lastX = hero.x;
    hero.lastY = hero.y;
  }

  if (!isCMD) {
  // --- HERO MOVEMENT (Tank Controls) ---

  const hullTurnRate = VEHICLE_TURN_RATES.tank.hull;
  const turretTurnRate = VEHICLE_TURN_RATES.tank.turret;

  // Parse input from keyboard/joystick
  const { moveInput, turnInput, targetHullAngle } = parseTankInput(b.keys, b.joystickInput, hero.hullAngle);

  // Apply tank movement
  const { dx, dy, isMoving } = applyTankMovement(hero, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec);

  // Get terrain speed modifier
  const speedMod = getTerrainSpeedMod(b, hero.x, hero.y);

  // Acceleration/deceleration — per-unit power-to-weight ratio
  const targetSpeed = isMoving ? hero.speed * speedMod : 0;
  if (hero._currentSpeed == null) hero._currentSpeed = 0;
  const heroCS = UNIT_COMBAT_STATS[hero.unitId];
  const heroAccelRate = targetSpeed >= hero._currentSpeed ? (heroCS?.accel ?? 2.5) : (heroCS?.decel ?? 4.0);
  const heroBlend = 1 - Math.exp(-heroAccelRate * dtSec);
  hero._currentSpeed += (targetSpeed - hero._currentSpeed) * heroBlend;

  // Calculate new position using ramped speed
  const newX = hero.x + dx * hero._currentSpeed * dtSec;
  const newY = hero.y + dy * hero._currentSpeed * dtSec;

  // Check terrain collision
  const xBlocked = isTerrainBlocked(b, newX, hero.y);
  const yBlocked = isTerrainBlocked(b, hero.x, newY);
  if (!xBlocked) {
    hero.x = newX;
  }
  if (!yBlocked) {
    hero.y = newY;
  }
  // DEBUG: log when hero hits blocked terrain
  if ((xBlocked || yBlocked) && !hero._lastBlockLog || (Date.now() - hero._lastBlockLog > 2000)) {
    hero._lastBlockLog = Date.now();
    const qx = xBlocked ? queryTerrain(b.terrainMap, newX, hero.y) : null;
    const qy = yBlocked ? queryTerrain(b.terrainMap, hero.x, newY) : null;
    console.warn(`[HERO BLOCKED] pos=(${Math.round(hero.x)},${Math.round(hero.y)})`,
      xBlocked ? `X→${Math.round(newX)}: boulder=${qx?.hasBoulder} water=${qx?.water?.toFixed(2)} depth=${qx?.depth} forest=${qx?.cover?.toFixed(2)} dom=${qx?.dominant}` : '',
      yBlocked ? `Y→${Math.round(newY)}: boulder=${qy?.hasBoulder} water=${qy?.water?.toFixed(2)} depth=${qy?.depth} forest=${qy?.cover?.toFixed(2)} dom=${qy?.dominant}` : '');
  }

  // Clamp to map bounds
  hero.x = Math.max(30, Math.min(b.mapWidth - 30, hero.x));
  hero.y = Math.max(30, Math.min(b.mapHeight - 30, hero.y));

  // Track hero velocity (pixels/sec) — used by fire decision pipeline
  const velDx = hero.x - (hero.lastX || hero.x);
  const velDy = hero.y - (hero.lastY || hero.y);
  hero.velocity = dtSec > 0 ? Math.sqrt(velDx * velDx + velDy * velDy) / dtSec : 0;

  // Stability — must run AFTER movement so position delta is accurate
  updateHeroStability(b, hero, dtSec);


  // Update movement animation
  if (useCanvasRendering && hero.animId) {
    if (isMoving !== hero.isMoving) {
      hero.isMoving = isMoving;
      sprites.setUnitAnimTrigger(hero.animId, isMoving ? 'move' : 'idle');
    }
    hero.lastX = hero.x;
    hero.lastY = hero.y;
  } else {
    hero.lastX = hero.x;
    hero.lastY = hero.y;
  }

  // --- AIMING ---
  let targetAimAngle;
  if (b.aimAngle !== null && b.aimAngle !== undefined) {
    targetAimAngle = b.aimAngle;
  } else {
    targetAimAngle = calculateAimAngle(hero, b.mouse, b.camera);
  }

  // Apply turret aiming
  applyTurretAim(hero, targetAimAngle, turretTurnRate, dtSec);

  // Update aim angle for animation
  if (useCanvasRendering && hero.animId) {
    const relativeAim = hero.angle - hero.hullAngle;
    sprites.setUnitAimAngle(hero.animId, relativeAim * 180 / Math.PI);
  }

  // --- HERO SHOOTING ---
  let aimDiff = hero.angle - targetAimAngle;
  while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
  while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
  const turretAligned = Math.abs(aimDiff) < 0.17;

  if (b.mouse.down && turretAligned) {
    heroFire(b, hero, now);
  }

  // --- UPDATE CAMERA (unit mode only — CMD camera handled in drawHeroBattle) ---
  const screenW = 800;
  const screenH = 600;

  const lookAheadDist = 80;
  let lookX = 0, lookY = 0;

  if (dx !== 0 || dy !== 0) {
    lookX = dx * lookAheadDist;
    lookY = dy * lookAheadDist;
  } else if (b.mouse.down) {
    lookX = Math.cos(hero.angle) * lookAheadDist * 0.5;
    lookY = Math.sin(hero.angle) * lookAheadDist * 0.5;
  }

  if (!b.camera.lookX) b.camera.lookX = 0;
  if (!b.camera.lookY) b.camera.lookY = 0;
  const lookSmooth = 0.08;
  b.camera.lookX += (lookX - b.camera.lookX) * lookSmooth;
  b.camera.lookY += (lookY - b.camera.lookY) * lookSmooth;

  const targetX = hero.x + b.camera.lookX - screenW / 2;
  const targetY = hero.y + b.camera.lookY - screenH * 0.75;
  b.camera.x = Math.max(0, Math.min(b.mapWidth - screenW, targetX));
  b.camera.y = Math.max(0, Math.min(b.mapHeight - screenH, targetY));
  } // end if (!isCMD) — hero controls + unit-mode camera

  // --- PROCESS SPAWN QUEUE (staggered reinforcements) ---
  if (b.spawnQueue && b.spawnQueue.length > 0) {
    const readyEntries = [];
    const stillWaiting = [];
    for (const entry of b.spawnQueue) {
      if (now >= entry.spawnTime) {
        readyEntries.push(entry);
      } else {
        stillWaiting.push(entry);
      }
    }
    if (readyEntries.length > 0) {
      for (const entry of readyEntries) {
        // Stamp insignia on late-spawned reinforcements
        if (b._insigniaSetId && !entry.enemy._insigniaSetId) {
          entry.enemy._insigniaSetId = b._insigniaSetId;
        }
        b.enemies.push(entry.enemy);
      }

      // Group by squad: entries with _squadId join their existing squad
      const joinExisting = readyEntries.filter(e => e._squadId);
      const needNewSquad = readyEntries.filter(e => !e._squadId);

      // Add to existing squads
      for (const entry of joinExisting) {
        const squad = b._squads?.find(s => s.id === entry._squadId);
        if (squad) {
          squad.members.push(entry.enemy.id);
          entry.enemy._squadId = squad.id;
          // Apply brain defaults
          const wave = Game.endless?.wave || 1;
          const preset = scaleBrainByWave(BRAIN_PRESETS.endlessEnemy, wave);
          applyBrainDefaults(entry.enemy, preset);
        }
      }

      // Create new squad for orphaned entries (no planned squad)
      if (needNewSquad.length > 0) {
        const wave = Game.endless?.wave || 1;
        const firstEntry = needNewSquad[0];
        const queueZone = firstEntry.squadZone || { x: b.mapWidth / 2, y: b.cellSize * 3, radius: b.mapWidth / 3 };
        const hasPlannedObjective = !!firstEntry.objective;
        const enemies = needNewSquad.map(e => e.enemy);
        const sq = spawnSquad(b, 'red', enemies, queueZone, {
          preset: scaleBrainByWave(BRAIN_PRESETS.endlessEnemy, wave),
          sgtPersonality: firstEntry.sgtPersonality,
          skipObjective: hasPlannedObjective
        });
        if (hasPlannedObjective) {
          const redCmdr2 = b._teamCommanders?.red;
          if (sq && sq.sergeant && redCmdr2) {
            assignObjective(redCmdr2, sq.sergeant, firstEntry.objective, now, b);
          }
        }
      }
    }
    b.spawnQueue = stillWaiting;
  }

  // --- PROCESS COMMANDER PENDING DEPLOYMENTS (reserves) ---
  const redCmdr = b._teamCommanders?.red;
  if (redCmdr?._pendingDeployments?.length > 0) {
    const wave = Game.endless?.wave || 1;
    let enemyIndex = b.enemies.length;

    for (const plan of redCmdr._pendingDeployments) {
      const squadEnemies = [];
      const zone = plan.spawnZone;
      const reserveOffY = -(b.stageDepth || 100) / 2;

      for (const unitDef of plan.units) {
        const offsetX = (Math.random() - 0.5) * zone.radius * 2;
        const offsetY = (Math.random() - 0.5) * 40;
        // Spawn off-map (top edge) so reserves march in like initial wave
        const pos = { x: zone.x + offsetX, y: reserveOffY + offsetY };
        const enemy = createEndlessEnemy(b, unitDef.type, pos.x, pos.y, wave, b.enemyMult || 1, enemyIndex++);
        b.enemies.push(enemy);
        squadEnemies.push(enemy);
      }

      if (squadEnemies.length > 0) {
        const sq = spawnSquad(b, 'red', squadEnemies, zone, {
          preset: scaleBrainByWave(BRAIN_PRESETS.endlessEnemy, wave),
          sgtPersonality: plan.sgtPersonality,
          skipObjective: !!plan.objective
        });
        if (sq && sq.sergeant && plan.objective) {
          assignObjective(redCmdr, sq.sergeant, plan.objective, Date.now(), b);
        }
      }
    }

    // Kill feed message
    const total = redCmdr._pendingDeployments.reduce((n, p) => n + p.units.length, 0);
    logEvent(b, {
      t: Date.now(), who: 'cmd-red', team: 'red', type: 'commander',
      action: 'reserve', detail: `Reinforcements: ${total} units deployed`
    });

    redCmdr._pendingDeployments = [];
  }

  // --- PERFORMANCE MONITORING ---
  if (!b._perf) b._perf = { ai: 0, proj: 0, frame: 0, samples: 0, lastLog: 0 };
  const _perfFrameStart = performance.now();

  // --- UNIFIED AI PIPELINE ---
  const _perfAiStart = performance.now();
  runBattleAI(b, now, dtSec);
  b._perf.ai += performance.now() - _perfAiStart;

  // --- RECORD REPLAY FRAME ---
  if (b._recorder) recordFrame(b, now);

  // --- CHECK HERO DEFEAT ---
  if (hero.hp <= 0) {
    hero.hp = 0;
    b.result = 'defeat';
    Game.endless.result = 'death';
    Game.endless.exitWave = Game.endless.wave;
    // Post-battle: update roster durability + progression on defeat
    _processPostBattle(b, 'loss');
    saveReplay(b);
    goto(State.ENDLESS_RESULT);
  }

  // --- UPDATE PROJECTILES ---
  const _perfProjStart = performance.now();
  resolveProjectiles(b, now, dtSec, {
    heroRef: hero,
    heroHitRadiusSq: 625, // ~25px
    onEnemyKill(e) {
      Game.endless.kills++;
      Game.endless.score += 100;
      Game.endless.loot.scrap += 5 + Math.floor(Math.random() * 10);
    },
    onHeroHit(h, dmg, p) {
      if (useCanvasRendering && h.animId) sprites.triggerUnitAnim(h.animId, 'hit');
      if (h.hp <= 0) {
        h.hp = 0;
        b.result = 'defeat';
        Game.endless.result = 'death';
        Game.endless.exitWave = Game.endless.wave;
        goto(State.ENDLESS_RESULT);
      }
    }
  });

  b._perf.proj += performance.now() - _perfProjStart;
  b._perf.frame += performance.now() - _perfFrameStart;
  b._perf.samples++;
  _logPerfSnapshot(b, now);

  // --- CHECK WAVE COMPLETE ---
  const aliveEnemies = b.enemies.filter(e => !e.dead).length;
  const queuedEnemies = b.spawnQueue ? b.spawnQueue.length : 0;
  const redCmdrCheck = b._teamCommanders?.red;
  const hasReserves = redCmdrCheck && (redCmdrCheck.reserves.length > 0 || redCmdrCheck._pendingDeployments?.length > 0);
  if (aliveEnemies === 0 && queuedEnemies === 0 && !hasReserves && !b.waveComplete) {
    b.waveComplete = true;

    // Post-battle: update roster durability + progression
    _processPostBattle(b, 'win');

    // Short delay then go to results screen
    setTimeout(() => {
      if (Game.state === State.ENDLESS_BATTLE) {
        // Save replay before clearing battle for next wave
        const ob = Game.endless?.battle;
        if (ob && isRecording(ob)) {
          ob.result = ob.result || `wave_${Game.endless.wave}_complete`;
          saveReplay(ob);
        }
        // Keep battle ref for results screen stats
        Game.endless._lastBattle = Game.endless.battle;
        Game.endless.battle = null;
        Game.endless._resultTab = 'rank'; // Default to rank report tab
        goto(State.ENDLESS_RESULT);
      }
    }, 1500);
  }
}

// ═══════════════════════════════════════════════════════════════
// WAVE TEMPLATES — Diablo-style composition variety
// ═══════════════════════════════════════════════════════════════

const WAVE_TEMPLATES = {
  swarmer_rush: {
    groups: [
      { type: 'swarmer', count: [6, 8], delay: 0, cluster: true },
      { type: 'grunt', count: [2, 3], delay: 2500 }
    ],
    minWave: 1
  },
  heavy_advance: {
    groups: [
      { type: 'heavy', count: [1, 2], delay: 0 },
      { type: 'grunt', count: [3, 4], delay: 1000 }
    ],
    minWave: 3
  },
  mixed_assault: {
    groups: [
      { type: 'grunt', count: [3, 4], delay: 0 },
      { type: 'swarmer', count: [3, 5], delay: 1500, cluster: true },
      { type: 'heavy', count: [1, 1], delay: 3000 }
    ],
    minWave: 2
  },
  elite_strike: {
    groups: [
      { type: 'swarmer', count: [4, 6], delay: 0, cluster: true },
      { type: 'grunt', count: [2, 2], delay: 1000 },
      { type: 'elite', count: [1, 1], delay: 2000 }
    ],
    minWave: 5
  },
  swarm: {
    groups: [
      { type: 'swarmer', count: [10, 15], delay: 0, cluster: true }
    ],
    minWave: 1
  }
};

// Pick 1-2 templates for a wave based on wave number
function pickWaveTemplates(wave, sizeMult) {
  const eligible = Object.entries(WAVE_TEMPLATES)
    .filter(([, t]) => wave >= t.minWave);

  if (eligible.length === 0) return [WAVE_TEMPLATES.swarmer_rush];

  // Shuffle and pick 1-2
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const count = wave >= 4 ? 2 : 1;
  return shuffled.slice(0, count).map(([, t]) => t);
}

// Create a single enemy from definition
function createEndlessEnemy(b, enemyType, spawnX, spawnY, wave, sizeMult, index) {
  const CELL_SIZE = b.cellSize;
  const enemyDef = ENEMIES.find(e => e.id === enemyType) || ENEMIES.find(e => e.id === 'grunt');
  const hpScale = (1 + wave * 0.1) * (1 + (sizeMult - 1) * 0.3);
  const isArmored = enemyType === 'heavy' || enemyType === 'elite';
  const isSwarmer = enemyType === 'swarmer';
  const unitId = enemyDef.unitId || 'infantry';
  const unitStats = UNIT_COMBAT_STATS[unitId];
  const baseSpeed = unitStats?.speed || (isSwarmer ? 90 : (isArmored ? 50 : 70));
  const animId = `enemy-${unitId}-${index}-${Date.now()}`;

  // Assign AI type based on enemy type
  let aiTypeKey;
  if (enemyType === 'swarmer') {
    aiTypeKey = 'SWARMER';
  } else if (enemyType === 'grunt') {
    aiTypeKey = Math.random() < 0.2 ? 'RUSHER' : 'BASIC';
  } else if (enemyType === 'heavy') {
    aiTypeKey = 'CAUTIOUS';
  } else if (enemyType === 'elite') {
    aiTypeKey = Math.random() < 0.3 ? 'FLANKER' : 'HUNTER';
  } else {
    aiTypeKey = 'BASIC';
  }

  const enemy = createUnit(unitId, {
    id: `enemy_${index}_${Date.now()}`,
    type: enemyType,
    x: spawnX,
    y: spawnY,
    hp: Math.floor(enemyDef.health * hpScale),
    maxHp: Math.floor(enemyDef.health * hpScale),
    damage: enemyDef.damage,
    speed: baseSpeed * (0.9 + Math.random() * 0.2),
    fireRate: isSwarmer ? 3000 : (enemyType === 'elite' ? 1500 : 2000),
    angle: Math.PI / 2,
    hullAngle: Math.PI / 2,
    lastAttack: 0,
    aiType: EnemyAIType[aiTypeKey],
    aiTypeKey,
    animId
  });

  // Apply elite modifier
  if (enemyType === 'elite' && wave >= 5) {
    applyModifier(enemy, rollModifier(wave));
  } else if (enemyType === 'heavy' && wave >= 8 && Math.random() < 0.3) {
    applyModifier(enemy, rollModifier(wave));
  }

  // Initialize sprite
  if (useCanvasRendering) {
    sprites.initAnimatedUnit(animId, unitId, 'default').then(v => {
      if (v) sprites.setUnitAnimTrigger(animId, 'move');
    });
  }

  return enemy;
}

// Build the wave budget — list of unit definitions from templates (not yet spawned)
function buildWaveBudget(b, wave, sizeMult) {
  const templates = pickWaveTemplates(wave, sizeMult);
  const budget = [];

  for (const template of templates) {
    for (const group of template.groups) {
      const count = group.count[0] + Math.floor(Math.random() * (group.count[1] - group.count[0] + 1));
      const scaledCount = Math.round(count * sizeMult);

      for (let i = 0; i < scaledCount; i++) {
        const enemyDef = ENEMIES.find(e => e.id === group.type) || ENEMIES.find(e => e.id === 'grunt');
        budget.push({
          type: group.type,
          unitId: enemyDef.unitId || 'infantry',
          delay: group.delay || 0,
          cluster: group.cluster || false
        });
      }
    }
  }

  return budget;
}

// Spawn enemies for endless wave using commander planning system
function spawnEndlessWave(b) {
  const wave = b.wave;
  const CELL_SIZE = b.cellSize;
  const sizeMult = b.enemyMult || 1.0;
  const now = Date.now();

  // Scale red commander by wave
  const redCmdr = b._teamCommanders?.red;
  if (redCmdr) {
    scaleCommanderByWave(redCmdr, wave);
    // Update maxSquads from size tier
    if (b._sizeTier?.maxSquads) {
      redCmdr.maxSquads = b._sizeTier.maxSquads;
    }
  }

  // Build budget from templates
  const budget = buildWaveBudget(b, wave, sizeMult);
  const totalEnemies = budget.length;

  // Initialize spawn queue for staggered spawns
  if (!b.spawnQueue) b.spawnQueue = [];

  // If we have a commander, use planDeployment
  if (redCmdr) {
    // Clear previous reserves
    redCmdr.reserves = [];

    const plans = planDeployment(redCmdr, b, budget, now);

    let enemyIndex = 0;

    // First group spawns at 25% from red edge (on-map), reinforcements from off-map edge
    const onMapY = b.mapHeight * 0.25;  // 25% from top = initial enemy position
    const offMapY = -(b.stageDepth || 100) / 2;  // Off-map — reinforcements march in
    let isFirstGroup = true;

    for (const plan of plans) {
      const squadEnemies = [];
      const zone = plan.spawnZone;
      // First group spawns on-map at 25%, subsequent groups from edge
      const groupY = isFirstGroup ? onMapY : offMapY;
      isFirstGroup = false;

      for (const unitDef of plan.units) {
        // Spawn position: use zone X spread, group-appropriate Y
        const offsetX = (Math.random() - 0.5) * zone.radius * 2;
        const offsetY = (Math.random() - 0.5) * 40;
        const pos = { x: zone.x + offsetX, y: groupY + offsetY };

        const enemy = createEndlessEnemy(b, unitDef.type, pos.x, pos.y, wave, sizeMult, enemyIndex++);

        if (unitDef.delay > 0) {
          b.spawnQueue.push({
            enemy,
            spawnTime: now + unitDef.delay + Math.random() * 500,
            squadZone: zone,
            objective: plan.objective,
            sgtPersonality: plan.sgtPersonality
          });
        } else {
          b.enemies.push(enemy);
          squadEnemies.push(enemy);
        }
      }

      // Create squad for immediately spawned enemies in this plan
      const preset = scaleBrainByWave(BRAIN_PRESETS.endlessEnemy, wave);
      if (squadEnemies.length > 0) {
        const sq = spawnSquad(b, 'red', squadEnemies, zone, {
          preset,
          sgtPersonality: plan.sgtPersonality,
          skipObjective: !!plan.objective
        });

        // Assign commander's planned objective to the squad's sergeant
        if (sq && sq.sergeant && plan.objective) {
          assignObjective(redCmdr, sq.sergeant, plan.objective, now, b);
        }

        // Tag queued entries with this squad's ID so they join it on spawn
        if (sq) {
          for (const entry of b.spawnQueue) {
            if (entry.squadZone === zone && !entry._squadId) {
              entry._squadId = sq.id;
            }
          }
        }
      }
    }

    // Log commander deployment
    logEvent(b, {
      t: now, who: 'cmd-red', team: 'red', type: 'commander',
      action: 'deploy',
      detail: `Wave ${wave}: ${plans.length} squad(s), ${totalEnemies} enemies, ${redCmdr.reserves.length} reserves`
    });
  } else {
    // Fallback: no commander, old single-squad behavior
    let enemyIndex = 0;
    const enemiesBeforeSpawn = b.enemies.length;
    const fallbackOffY = -(b.stageDepth || 100) / 2;

    for (const unitDef of budget) {
      const spawnX = CELL_SIZE * 2 + Math.random() * (b.mapWidth - CELL_SIZE * 4);
      const spawnY = fallbackOffY + (Math.random() - 0.5) * 40;

      const enemy = createEndlessEnemy(b, unitDef.type, spawnX, spawnY, wave, sizeMult, enemyIndex++);

      if (unitDef.delay > 0) {
        b.spawnQueue.push({ enemy, spawnTime: now + unitDef.delay + Math.random() * 500 });
      } else {
        b.enemies.push(enemy);
      }
    }

    const immediateEnemies = b.enemies.slice(enemiesBeforeSpawn);
    if (immediateEnemies.length > 0) {
      const waveSpawnZone = { x: b.mapWidth / 2, y: CELL_SIZE * 3, radius: b.mapWidth / 3 };
      spawnSquad(b, 'red', immediateEnemies, waveSpawnZone, {
        preset: scaleBrainByWave(BRAIN_PRESETS.endlessEnemy, wave)
      });
    }
  }

  b.enemiesRemaining = totalEnemies - b.enemies.filter(e => !e.dead).length;

  // Log wave event for kill feed
  logEvent(b, { t: now, type: 'wave', action: `Wave ${wave} — ${totalEnemies} enemies`, team: null });
}

// Draw endless battle - uses shared hero battle rendering
function drawEndlessBattle() {
  const b = Game.endless?.battle;
  if (!b) return;

  const bf = document.querySelector('.endless-battlefield');
  if (!bf) return;

  // Hide browser cursor only during live combat in unit mode (not CMD, not deploying)
  const heroAlive = b.hero && !b.hero.dead && !b.hero.observer;
  const inCombat = b.phase !== 'deploying' && b.phase !== 'countdown';
  const isCMD = b.playMode === 'cmd';
  if (heroAlive && inCombat && !isCMD) {
    if (!bf.classList.contains('hero-crosshair')) bf.classList.add('hero-crosshair');
  } else {
    bf.classList.remove('hero-crosshair');
  }

  // During deploying/countdown, use deployment camera instead of hero camera
  if (b.phase === 'deploying' || b.phase === 'countdown') {
    drawDeploymentPhase(bf, b);
    return;
  }

  // Clear deployment hook — edge fade will be re-installed by drawHeroBattle
  if (b.battleRenderer?._postRenderHook) b.battleRenderer._postRenderHook = null;

  // Use shared drawing function
  drawHeroBattle(bf, b);

  // Endless-specific HUD updates
  const hpBar = document.querySelector('.endless-hp-fill');
  if (hpBar) {
    hpBar.style.width = `${(b.hero.hp / b.hero.maxHp) * 100}%`;
  }

  const hpText = document.querySelector('.endless-hp-text');
  if (hpText) {
    hpText.textContent = `${Math.ceil(b.hero.hp)} / ${b.hero.maxHp}`;
  }

  const waveEl = document.querySelector('.wave-display');
  const killsEl = document.querySelector('.kills-display');
  const scoreEl = document.querySelector('.score-display');

  if (waveEl) waveEl.textContent = `Wave ${Game.endless.wave}`;
  if (killsEl) killsEl.textContent = `Kills: ${Game.endless.kills}`;
  if (scoreEl) scoreEl.textContent = Game.endless.score.toLocaleString();

  // Update kill feed
  updateKillFeed(b);
}

// ── Deployment phase rendering ──────────────────────────────
function drawDeploymentPhase(bf, b) {
  const screenW = bf.offsetWidth;
  const screenH = bf.offsetHeight;

  // Camera: during deploying, fit whole map. During countdown, lerp to player zone.
  let zoom;
  if (b.phase === 'deploying') {
    // Fit whole map — use overview zoom
    if (!b._deployOverviewSet) {
      cameraFitMapImmediate(b, screenW, screenH);
      b._deployOverviewSet = true;
      b._overviewCam = { x: b.camera.x, y: b.camera.y, zoom: b.camera.userZoom || 1 };
    }
    zoom = updateDeploymentCamera(b, screenW, screenH);
  } else {
    // Countdown: lerp from overview to player zone
    zoom = updateCountdownCamera(b, screenW, screenH);
  }

  // Render terrain + entities via BattleRenderer
  if (USE_CANVAS_BATTLE && b.battleRenderer) {
    b.battleRenderer.setCamera(b.camera.x, b.camera.y, zoom);

    // Install post-render hook for deployment overlays (drawn INSIDE the render callback)
    const sw = screenW, sh = screenH;
    b.battleRenderer._postRenderHook = (ctx, battle) => {
      // Edge fade on all map boundaries
      _drawMapEdgeFade(ctx, battle);
      // Staging canopy (extra dark roof over off-map staging area)
      if (battle.stageDepth > 0) {
        _drawStagingCanopy(ctx, battle);
      }
      drawDeployZones(ctx, battle, sw, sh, zoom);
      if (battle.phase === 'countdown') {
        drawCountdownOverlay(ctx, battle, sw, sh);
      }
    };

    b.battleRenderer.render(b);
    drawMinimap(b);
  }
}

// ── Deployment camera helpers ────────────────────────────────

function updateDeploymentCamera(b, screenW, screenH) {
  // During deploying: static overview (already set by cameraFitMap)
  const TACTICAL_RADIUS = 600;
  const baseZoom = Math.min(screenW, screenH) / (TACTICAL_RADIUS * 2);
  const zoom = baseZoom * (b.camera.userZoom || 1);
  b._lastDeployZoom = zoom;
  return zoom;
}

function updateCountdownCamera(b, screenW, screenH) {
  const elapsed = b.countdownStart ? (Date.now() - b.countdownStart) / 1000 : 0;

  // Must match updateHeroCamera exactly so transition is seamless
  const HERO_TACTICAL_RADIUS = 450;
  const heroBaseZoom = Math.min(screenW, screenH) / (HERO_TACTICAL_RADIUS * 2);

  // Overview used a different tactical radius
  const OVERVIEW_TACTICAL_RADIUS = 600;
  const overviewBaseZoom = Math.min(screenW, screenH) / (OVERVIEW_TACTICAL_RADIUS * 2);

  // Phase 1 (0-2s): Lerp from overview to hero camera
  // Phase 2 (2s+): Follow hero exactly as updateHeroCamera would
  const zoomT = Math.min(1, elapsed / 2.0);
  const ease = zoomT * zoomT * (3 - 2 * zoomT); // smoothstep

  const overviewUserZoom = b._overviewCam?.zoom || 1;
  const overviewX = b._overviewCam?.x || 0;
  const overviewY = b._overviewCam?.y || 0;

  // Target userZoom is 1 (default hero camera)
  const targetUserZoom = 1;
  const currentUserZoom = overviewUserZoom + (targetUserZoom - overviewUserZoom) * ease;
  b.camera.userZoom = currentUserZoom;

  // Compute final zoom using hero camera's base zoom (not overview's)
  // During lerp, blend between overview base and hero base
  const currentBaseZoom = overviewBaseZoom + (heroBaseZoom - overviewBaseZoom) * ease;
  const zoom = currentBaseZoom * currentUserZoom;
  const viewW = screenW / zoom;
  const viewH = screenH / zoom;

  // Target position: exactly what updateHeroCamera computes — hero centered
  const targetCamX = b.hero.x - viewW / 2;
  const targetCamY = b.hero.y - viewH / 2;

  if (elapsed < 2.0) {
    b.camera.x = overviewX + (targetCamX - overviewX) * ease;
    b.camera.y = overviewY + (targetCamY - overviewY) * ease;
  } else {
    // Smooth follow — same as updateHeroCamera's auto-follow
    b.camera.x = targetCamX;
    b.camera.y = targetCamY;
  }

  b.camera.zoom = zoom;
  return zoom;
}

// ── Deployment zone rendering (canvas, via post-render hook) ─

// ── Staging canopy — dark roof over off-map staging area ──────
// Drawn in world-space (viewport transform already applied)
// ── Map edge fade — dark fade on all 4 edges beyond the map ──
// Drawn in world-space (viewport transform already applied)
function _drawMapEdgeFade(ctx, b) {
  const mapW = b.mapWidth;
  const mapH = b.mapHeight;
  const fadeW = 150;  // gradient width inside the map
  const ext = 3000;
  const dark = '#0c0f0a';

  // 1. Fill all 4 outer regions with solid dark (covers the void)
  ctx.fillStyle = dark;
  ctx.fillRect(-ext, -ext, mapW + ext * 2, ext);          // top
  ctx.fillRect(-ext, mapH, mapW + ext * 2, ext);           // bottom
  ctx.fillRect(-ext, 0, ext, mapH);                        // left
  ctx.fillRect(mapW, 0, ext, mapH);                        // right

  // 2. Draw inner gradients on top of the terrain, fading INTO the map
  // Top
  const topGrad = ctx.createLinearGradient(0, 0, 0, fadeW);
  topGrad.addColorStop(0, dark);
  topGrad.addColorStop(1, 'rgba(12, 15, 10, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, mapW, fadeW);

  // Bottom
  const botGrad = ctx.createLinearGradient(0, mapH, 0, mapH - fadeW);
  botGrad.addColorStop(0, dark);
  botGrad.addColorStop(1, 'rgba(12, 15, 10, 0)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, mapH - fadeW, mapW, fadeW);

  // Left
  const leftGrad = ctx.createLinearGradient(0, 0, fadeW, 0);
  leftGrad.addColorStop(0, dark);
  leftGrad.addColorStop(1, 'rgba(12, 15, 10, 0)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(0, 0, fadeW, mapH);

  // Right
  const rightGrad = ctx.createLinearGradient(mapW, 0, mapW - fadeW, 0);
  rightGrad.addColorStop(0, dark);
  rightGrad.addColorStop(1, 'rgba(12, 15, 10, 0)');
  ctx.fillStyle = rightGrad;
  ctx.fillRect(mapW - fadeW, 0, fadeW, mapH);
}

function _drawStagingCanopy(ctx, b) {
  const mapH = b.mapHeight;
  const stageD = b.stageDepth || 0;
  if (stageD <= 0) return;

  const mapW = b.mapWidth;
  const canopyTop = mapH;          // starts at bottom map edge
  const canopyBottom = mapH + stageD + 200; // extend past staging area
  const fadeH = 60;                // gradient fade zone height

  // Solid dark area (the "roof")
  ctx.fillStyle = 'rgba(15, 18, 12, 0.92)';
  ctx.fillRect(-200, canopyTop + fadeH, mapW + 400, canopyBottom - canopyTop);

  // Gradient fade at the top edge (shadow emerging effect)
  const grad = ctx.createLinearGradient(0, canopyTop, 0, canopyTop + fadeH);
  grad.addColorStop(0, 'rgba(15, 18, 12, 0.0)');
  grad.addColorStop(0.4, 'rgba(15, 18, 12, 0.5)');
  grad.addColorStop(1, 'rgba(15, 18, 12, 0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(-200, canopyTop, mapW + 400, fadeH);

  // Subtle horizontal line at map edge (threshold marker)
  ctx.fillStyle = 'rgba(80, 100, 60, 0.3)';
  ctx.fillRect(0, mapH - 1, mapW, 2);
}

function drawDeployZones(ctx, b, screenW, screenH, zoom) {
  if (b.phase !== 'deploying' || !b.deployZones?.blue) return;

  const zones = b.deployZones.blue;

  // ── Compute panel layout (needed for gradient positioning) ──
  const anyExpanded = zones.some(z => z.selected && z._expanded);
  const collapsedH = 130;
  const maxExpandH = Math.floor(screenH * 0.5);
  const promptH = 26;
  const gap = 2;
  const margin = 4;

  // ── Map zone highlights (world-space) ──
  // Gradient starts above panels so it's always visible
  const mapH = b.mapHeight || 1536;

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const sel = zone.selected;

    // Only the selected zone gets the highlight — pulsing edge glow
    if (sel) {
      const edgeW = 80 / zoom;
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 600);
      const a = (0.6 * pulse).toFixed(3);

      // Left edge: solid at edge, fades inward
      const glowL = ctx.createLinearGradient(zone.x, 0, zone.x + edgeW, 0);
      glowL.addColorStop(0, `rgba(200, 60, 40, ${a})`);
      glowL.addColorStop(1, 'rgba(200, 60, 40, 0.0)');
      ctx.fillStyle = glowL;
      ctx.fillRect(zone.x, 0, edgeW, mapH);

      // Right edge: solid at edge, fades inward
      const glowR = ctx.createLinearGradient(zone.x + zone.width, 0, zone.x + zone.width - edgeW, 0);
      glowR.addColorStop(0, `rgba(200, 60, 40, ${a})`);
      glowR.addColorStop(1, 'rgba(200, 60, 40, 0.0)');
      ctx.fillStyle = glowR;
      ctx.fillRect(zone.x + zone.width - edgeW, 0, edgeW, mapH);
    }

    // Vertical divider lines between zones
    ctx.strokeStyle = sel ? 'rgba(160, 100, 80, 0.4)' : 'rgba(110, 80, 65, 0.2)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([12 / zoom, 8 / zoom]);
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(zone.x, 0);
      ctx.lineTo(zone.x, mapH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Spawn area highlight at bottom
    ctx.fillStyle = sel ? 'rgba(160, 90, 60, 0.25)' : 'rgba(120, 70, 55, 0.08)';
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);

    // Spawn area border
    ctx.strokeStyle = sel ? 'rgba(180, 110, 80, 0.6)' : 'rgba(120, 80, 65, 0.25)';
    ctx.lineWidth = sel ? 2 / zoom : 1 / zoom;
    ctx.setLineDash(sel ? [] : [6 / zoom, 4 / zoom]);
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    ctx.setLineDash([]);
  }

  // ── Panel UI (screen-space) ──
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const FORMATIONS = ['Line', 'Wedge', 'Column', 'Spread', 'Staggered', 'Echelon L', 'Echelon R'];
  const FORMATION_IDS = ['line', 'wedge', 'column', 'spread', 'staggered', 'echelon_l', 'echelon_r'];
  const colW = Math.floor((screenW - margin * 2 - gap * (zones.length - 1)) / zones.length);
  const currentFmt = b._deployFormation || 'line';

  // ── Expanded panel (full-width, drawn FIRST so collapsed tabs sit on top) ──
  const expandedZone = zones.find(z => z.selected && z._expanded);
  if (expandedZone) {
    _drawExpandedDeployPanel(ctx, b, expandedZone, screenW, screenH, margin, maxExpandH,
      FORMATIONS, FORMATION_IDS, currentFmt);
  }

  // ── Collapsed panels (drawn on top for quick zone switching) ──
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const px = margin + i * (colW + gap);
    const sel = zone.selected;
    const expanded = sel && zone._expanded;

    const panelH = collapsedH;
    const panelY = screenH - panelH;

    // Store screen rect for hit-testing
    zone._screenRect = { x: px, y: panelY, w: colW, h: panelH };
    zone._fmtBtnRects = null;

    // ── Panel background ──
    ctx.fillStyle = sel ? 'rgba(50, 70, 40, 0.92)' : 'rgba(38, 45, 32, 0.9)';
    ctx.fillRect(px, panelY, colW, panelH);

    // Top border accent
    ctx.fillStyle = sel ? '#8cb060' : '#5a6e48';
    ctx.fillRect(px, panelY, colW, 2);

    // Side borders
    ctx.fillStyle = sel ? 'rgba(140, 176, 96, 0.4)' : 'rgba(80, 100, 65, 0.3)';
    ctx.fillRect(px, panelY, 1, panelH);
    ctx.fillRect(px + colW - 1, panelY, 1, panelH);

    // ── Zone header row ──
    const zoneHeaderH = 26;
    ctx.fillStyle = sel ? 'rgba(70, 95, 55, 0.6)' : 'rgba(45, 55, 38, 0.5)';
    ctx.fillRect(px, panelY + 2, colW, zoneHeaderH);

    ctx.fillStyle = sel ? '#e0e8d0' : '#a0a890';
    ctx.font = 'bold 14px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(zone.name, px + 10, panelY + 2 + zoneHeaderH / 2);

    if (sel) {
      // DEPLOY button in header
      const btnW = 80, btnH = 22;
      const btnX = px + colW - btnW - 8;
      const btnY = panelY + 2 + (zoneHeaderH - btnH) / 2;
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);
      ctx.fillStyle = `rgba(100, 150, 60, ${0.6 * pulse})`;
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#a0d060';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#e0f0c0';
      ctx.font = 'bold 12px Oxanium, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DEPLOY', btnX + btnW / 2, btnY + btnH / 2);
      zone._deployBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };
    } else {
      zone._deployBtnRect = null;
      ctx.textAlign = 'right';
      ctx.font = '11px Oxanium, monospace';
      ctx.fillStyle = '#6a7560';
      ctx.fillText('AVAILABLE', px + colW - 10, panelY + 2 + zoneHeaderH / 2);
    }

    // ── Collapsed body ──
    const bodyTop = panelY + 2 + zoneHeaderH + 6;
    const bodyX = px + 10;

    if (sel && (b.units?.length || b.hero)) {
      // Squad composition (left side)
      ctx.textAlign = 'left';
      ctx.font = '11px monospace';
      ctx.fillStyle = '#b0b8a0';
      const heroType = (b.hero?.unitId || 'hero').toUpperCase();
      ctx.fillText(`▶ ${heroType}  (YOU)`, bodyX, bodyTop + 10);

      const counts = {};
      for (const u of (b.units || [])) {
        const id = (u.unitId || 'unit').toUpperCase();
        counts[id] = (counts[id] || 0) + 1;
      }
      let row = 1;
      for (const [type, count] of Object.entries(counts)) {
        ctx.fillStyle = '#8a9478';
        ctx.fillText(`  ${count}× ${type}`, bodyX, bodyTop + 10 + row * 15);
        row++;
      }
      const total = 1 + (b.units?.length || 0);
      ctx.fillStyle = '#607050';
      ctx.font = '10px monospace';
      ctx.fillText(`${total} units`, bodyX, panelY + panelH - 10);

      // Formation preview (right side)
      const previewCx = px + colW - 55;
      const previewCy = bodyTop + 40;
      const offsets = FORMATION_OFFSETS[currentFmt] || FORMATION_OFFSETS.line;
      const unitCount = 1 + (b.units?.length || 0);
      const scale = 0.16;

      ctx.fillStyle = '#708060';
      ctx.font = '9px Oxanium, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const fmtLabel = FORMATIONS[FORMATION_IDS.indexOf(currentFmt)] || 'Line';
      ctx.fillText(fmtLabel, previewCx, previewCy - 28);

      for (let di = 0; di < Math.min(unitCount, offsets.length); di++) {
        const dotX = previewCx + offsets[di][0] * scale;
        const dotY = previewCy + offsets[di][1] * scale;
        ctx.beginPath();
        ctx.arc(dotX, dotY, di === 0 ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = di === 0 ? '#a0c870' : '#708860';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Expand hint
      ctx.fillStyle = '#506040';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ click to edit squad ▲', px + colW / 2, panelY + panelH - 10);
    } else {
      // Unselected: show composition summary
      const comp = getZoneComposition(b, zone);
      const zoneLabel = i === 0 ? 'Left flank' : i === 1 ? 'Center' : 'Right flank';

      if (comp === 'EMPTY') {
        ctx.textAlign = 'center';
        ctx.font = '11px Oxanium, monospace';
        ctx.fillStyle = '#7a8570';
        ctx.fillText('Empty', px + colW / 2, bodyTop + 14);
        ctx.font = '10px monospace';
        ctx.fillStyle = '#556048';
        ctx.fillText(zoneLabel, px + colW / 2, bodyTop + 32);
      } else {
        ctx.textAlign = 'left';
        ctx.font = '10px monospace';
        ctx.fillStyle = '#8a9478';
        // Word-wrap composition into the collapsed panel
        const compWords = comp.split(', ');
        let compY = bodyTop + 10;
        for (const cw of compWords) {
          if (compY + 14 > panelY + panelH - 16) break;
          ctx.fillText(cw, bodyX, compY);
          compY += 14;
        }
        ctx.fillStyle = '#556048';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(zoneLabel, bodyX, panelY + panelH - 12);
      }

      ctx.fillStyle = '#506040';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('click to select', px + colW / 2, panelY + panelH - 2);
    }
  }

  // Prompt bar (only when no zone selected)
  if (!b.deployReady?.blue && !zones.some(z => z.selected)) {
    const topPanelY = screenH - collapsedH;
    const promptY = topPanelY - promptH;
    ctx.fillStyle = 'rgba(30, 38, 25, 0.9)';
    ctx.fillRect(0, promptY, screenW, promptH);
    ctx.fillStyle = 'rgba(100, 130, 70, 0.4)';
    ctx.fillRect(0, promptY + promptH - 1, screenW, 1);

    ctx.fillStyle = 'rgba(200, 220, 180, 0.85)';
    ctx.font = 'bold 14px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▼  SELECT DEPLOYMENT ZONE  ▼', screenW / 2, promptY + promptH / 2);
  }

  ctx.restore();
}

// ── Radar chart for unit comparison ──────────────────────────
const RADAR_LABELS = ['FPW', 'DUR', 'SPD', 'RNG', 'RCN', 'ACC'];
const RADAR_COLORS = [
  { fill: 'rgba(120, 170, 70, 0.18)', stroke: 'rgba(140, 190, 80, 0.7)', dot: '#a0d060' },
  { fill: 'rgba(90, 140, 200, 0.18)', stroke: 'rgba(100, 160, 220, 0.7)', dot: '#70b0e0' },
  { fill: 'rgba(200, 140, 70, 0.18)', stroke: 'rgba(220, 160, 90, 0.7)', dot: '#e0b060' },
  { fill: 'rgba(180, 90, 140, 0.18)', stroke: 'rgba(200, 110, 160, 0.7)', dot: '#d080b0' }
];

// Max values for normalization (individual unit scale)
const RADAR_MAX = { dps: 75, hp: 500, speed: 70, range: 900, recon: 1100, accuracy: 1.0 };

function _getUnitRadarValues(unitId) {
  const def = UNITS.find(d => d.id === unitId);
  const combat = UNIT_COMBAT_STATS[unitId];
  if (!def || !combat) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

  const dmg = def.damage || 10;
  const rate = def.fireRate || 1000;
  const dps = (dmg / rate) * 1000;

  // Estimate HP from unit type (heavier = more HP)
  const hpMap = { infantry: 100, medic: 80, specops: 90, stinger: 85,
    jeep: 120, humvee: 160, sherman: 250, tiger: 350, abrams: 500,
    howitzer: 150, drone: 60, apache: 180 };
  const hp = hpMap[unitId] || 100;

  // Accuracy approximation from fire rate (faster = more accurate/sustained)
  const accuracy = Math.min(1, 800 / rate);

  return [
    Math.min(1, dps / RADAR_MAX.dps),
    Math.min(1, hp / RADAR_MAX.hp),
    Math.min(1, (combat.speed || 30) / RADAR_MAX.speed),
    Math.min(1, (combat.range || 400) / RADAR_MAX.range),
    Math.min(1, (combat.viewRange || 600) / RADAR_MAX.recon),
    Math.min(1, accuracy / RADAR_MAX.accuracy)
  ];
}

function _getSquadRadarValues(b) {
  const allUnits = [];
  if (b.hero) allUnits.push(b.hero);
  for (const u of (b.units || [])) allUnits.push(u);
  if (allUnits.length === 0) return [0, 0, 0, 0, 0, 0];

  let totalDps = 0, totalHp = 0, avgSpeed = 0, avgRange = 0, avgRecon = 0, avgAcc = 0;
  for (const u of allUnits) {
    const vals = _getUnitRadarValues(u.unitId);
    totalDps += vals[0];
    totalHp += vals[1];
    avgSpeed += vals[2];
    avgRange += vals[3];
    avgRecon += vals[4];
    avgAcc += vals[5];
  }
  const n = allUnits.length;
  // Squad: average most stats, sum firepower and durability (capped)
  return [
    Math.min(1, totalDps / 4),
    Math.min(1, totalHp / 4),
    avgSpeed / n,
    avgRange / n,
    avgRecon / n,
    avgAcc / n
  ];
}

const PERSONALITY_RADAR_LABELS = ['AGG', 'PAT', 'CRG', 'DIS', 'INI', 'AWR'];

function _drawRadarChart(ctx, cx, cy, radius, datasets, labels) {
  labels = labels || RADAR_LABELS;
  const count = labels.length;
  const angleStep = (Math.PI * 2) / count;
  const startAngle = -Math.PI / 2;

  // Grid rings
  for (let ring = 1; ring <= 4; ring++) {
    const r = radius * (ring / 4);
    ctx.beginPath();
    for (let i = 0; i <= count; i++) {
      const angle = startAngle + i * angleStep;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(80, 100, 65, ${ring === 4 ? 0.4 : 0.15})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Axis lines + labels
  for (let i = 0; i < count; i++) {
    const angle = startAngle + i * angleStep;
    const ex = cx + Math.cos(angle) * radius;
    const ey = cy + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(80, 100, 65, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const lx = cx + Math.cos(angle) * (radius + 14);
    const ly = cy + Math.sin(angle) * (radius + 14);
    ctx.fillStyle = '#708060';
    ctx.font = '8px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[i], lx, ly);
  }

  // Data polygons (multiple overlaid)
  for (let d = 0; d < datasets.length; d++) {
    const values = datasets[d].values;
    const color = RADAR_COLORS[d % RADAR_COLORS.length];

    ctx.beginPath();
    for (let i = 0; i <= count; i++) {
      const idx = i % count;
      const angle = startAngle + idx * angleStep;
      const r = radius * (values[idx] || 0);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color.fill;
    ctx.fill();
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Data points
    for (let i = 0; i < count; i++) {
      const angle = startAngle + i * angleStep;
      const r = radius * (values[i] || 0);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = color.dot;
      ctx.fill();
    }
  }
}

/**
 * Draw a comparison radar chart with header and legend in the card panel area.
 */
function _drawComparisonChart(ctx, x4, colW_4, cy, bodyBottom, datasets, labels, title) {
  // Header
  ctx.fillStyle = '#90a880';
  ctx.font = 'bold 9px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title, x4, cy);
  cy += 16;

  const chartSpace = bodyBottom - cy;
  const radarR = Math.min((colW_4 - 30) / 2, (chartSpace - 50) / 2, 70);
  const chartCx = x4 + colW_4 / 2;
  const chartCy = cy + radarR + 4;

  if (radarR > 20) {
    _drawRadarChart(ctx, chartCx, chartCy, radarR, datasets, labels);

    // Legend below chart
    let ly = chartCy + radarR + 14;
    for (let i = 0; i < datasets.length && ly + 12 < bodyBottom; i++) {
      const color = RADAR_COLORS[i % RADAR_COLORS.length];
      ctx.fillStyle = color.stroke;
      ctx.fillRect(x4, ly + 2, 8, 8);
      ctx.fillStyle = '#a0b090';
      ctx.font = '9px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(datasets[i].label, x4 + 12, ly);
      ly += 14;
    }
  }
}

// ── Expanded deploy panel (full-width, 4-column) ─────────────
// COL 1: Radar chart   COL 2: Formation dropdown + unit lineup
// ── Unit weight category lookup ──
const UNIT_WEIGHT = {
  infantry: 0, medic: 0, specops: 0, stinger: 0,
  jeep: 1, humvee: 1, drone: 1, apache: 1,
  sherman: 2, howitzer: 2,
  tiger: 3, abrams: 3
};

/**
 * Draw weight icon: │ (infantry), ││ (light), │││ (medium), ████ (heavy)
 */
function _drawWeightIcon(ctx, x, y, weight, color) {
  ctx.fillStyle = color;
  const barW = 2, barH = 10, gap = 3;
  if (weight === 3) {
    ctx.fillRect(x, y, 12, barH);
  } else {
    const count = weight + 1;
    for (let i = 0; i < count; i++) {
      ctx.fillRect(x + i * (barW + gap), y, barW, barH);
    }
  }
}

// COL 1: Radar  COL 2: Lineup  COL 3: Available  COL 4: Unit Card (flippable)
function _drawExpandedDeployPanel(ctx, b, zone, screenW, screenH, margin, maxExpandH,
    FORMATIONS, FORMATION_IDS, currentFmt) {
  const expW = screenW - margin * 2;
  const expX = margin;
  const panelH = maxExpandH;
  const panelY = screenH - panelH;

  zone._expandedRect = { x: expX, y: panelY, w: expW, h: panelH };

  // Background
  ctx.fillStyle = 'rgba(40, 55, 32, 0.95)';
  ctx.fillRect(expX, panelY, expW, panelH);
  ctx.fillStyle = '#8cb060';
  ctx.fillRect(expX, panelY, expW, 2);
  ctx.fillStyle = 'rgba(140, 176, 96, 0.4)';
  ctx.fillRect(expX, panelY, 1, panelH);
  ctx.fillRect(expX + expW - 1, panelY, 1, panelH);

  // ── Header row ──
  const zoneHeaderH = 30;
  ctx.fillStyle = 'rgba(70, 95, 55, 0.6)';
  ctx.fillRect(expX, panelY + 2, expW, zoneHeaderH);

  ctx.fillStyle = '#e0e8d0';
  ctx.font = 'bold 15px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(zone.name, expX + 14, panelY + 2 + zoneHeaderH / 2);

  // DEPLOY button in header
  const btnW = 90, btnH = 24;
  const btnX = expX + expW - btnW - 12;
  const btnY = panelY + 2 + (zoneHeaderH - btnH) / 2;
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);
  ctx.fillStyle = `rgba(100, 150, 60, ${0.6 * pulse})`;
  ctx.fillRect(btnX, btnY, btnW, btnH);
  ctx.strokeStyle = '#a0d060';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(btnX, btnY, btnW, btnH);
  ctx.fillStyle = '#e0f0c0';
  ctx.font = 'bold 13px Oxanium, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DEPLOY', btnX + btnW / 2, btnY + btnH / 2);
  zone._deployBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };

  // Play mode toggle (CMD / UNIT)
  const PLAY_MODES = [
    { id: 'unit', label: 'UNIT' },
    { id: 'cmd',  label: 'CMD' }
  ];
  const modeTabW = 40, modeTabH = 20;
  const modeTabGap = 2;
  const modeTotalW = PLAY_MODES.length * (modeTabW + modeTabGap) - modeTabGap;
  const modeStartX = btnX - modeTotalW - 50;
  const modeTabY = panelY + 2 + (zoneHeaderH - modeTabH) / 2;

  if (!zone._modeRects) zone._modeRects = [];
  zone._modeRects.length = 0;

  for (let mi = 0; mi < PLAY_MODES.length; mi++) {
    const mode = PLAY_MODES[mi];
    const mx = modeStartX + mi * (modeTabW + modeTabGap);
    const isActive = b.playMode === mode.id;

    ctx.fillStyle = isActive ? 'rgba(100, 150, 60, 0.5)' : 'rgba(40, 55, 30, 0.4)';
    ctx.fillRect(mx, modeTabY, modeTabW, modeTabH);
    ctx.strokeStyle = isActive ? '#a0d060' : 'rgba(80, 100, 60, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, modeTabY, modeTabW, modeTabH);

    ctx.fillStyle = isActive ? '#e0f0c0' : '#708060';
    ctx.font = 'bold 9px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mode.label, mx + modeTabW / 2, modeTabY + modeTabH / 2);

    zone._modeRects.push({ x: mx, y: modeTabY, w: modeTabW, h: modeTabH, mode: mode.id });
  }

  // Collapse arrow (▼) left of DEPLOY button
  const collapseW = 28, collapseH = 24;
  const collapseX = btnX - collapseW - 6;
  const collapseY = btnY;
  ctx.fillStyle = 'rgba(60, 80, 45, 0.5)';
  ctx.fillRect(collapseX, collapseY, collapseW, collapseH);
  ctx.strokeStyle = 'rgba(120, 160, 80, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(collapseX, collapseY, collapseW, collapseH);
  ctx.fillStyle = '#b0c0a0';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▼', collapseX + collapseW / 2, collapseY + collapseH / 2);
  zone._collapseRect = { x: collapseX, y: collapseY, w: collapseW, h: collapseH };

  // ── Body layout: 5 columns (radar | lineup | arrows | available | card) ──
  const collapsedTabH = 130;
  const bodyTop = panelY + 2 + zoneHeaderH + 8;
  const bodyBottom = screenH - collapsedTabH - 6;
  const bodyH = bodyBottom - bodyTop;
  const colGap = 8;
  const transferStripW = 28;
  const pad = 14;
  const innerW = expW - pad * 2;
  // 5 columns: 4 content + 1 arrow strip, 4 gaps between them
  const contentW = innerW - transferStripW - colGap * 4;
  const colW_1 = Math.floor(contentW * 0.18);      // Radar
  const colW_2 = Math.floor(contentW * 0.27);      // Lineup
  const colW_3 = Math.floor(contentW * 0.27);      // Available
  const colW_4 = contentW - colW_1 - colW_2 - colW_3; // Card
  const x1 = expX + pad;
  const x2 = x1 + colW_1 + colGap;
  const xTransfer = x2 + colW_2 + colGap;
  const x3 = xTransfer + transferStripW + colGap;
  const x4 = x3 + colW_3 + colGap;

  if (!b._radarSelection) b._radarSelection = [];
  if (!zone._unitBtnRects) zone._unitBtnRects = [];
  zone._unitBtnRects.length = 0;
  if (!zone._fmtBtnRects) zone._fmtBtnRects = [];
  zone._fmtBtnRects.length = 0;
  if (!zone._rosterBtnRects) zone._rosterBtnRects = [];
  zone._rosterBtnRects.length = 0;
  if (!zone._removeUnitRects) zone._removeUnitRects = [];
  zone._removeUnitRects.length = 0;
  if (!zone._addUnitRects) zone._addUnitRects = [];
  zone._addUnitRects.length = 0;

  // Column dividers
  ctx.fillStyle = 'rgba(100, 130, 70, 0.2)';
  ctx.fillRect(x2 - colGap / 2, bodyTop, 1, bodyH);
  ctx.fillRect(xTransfer - colGap / 2, bodyTop, 1, bodyH);
  ctx.fillRect(x3 - colGap / 2, bodyTop, 1, bodyH);
  ctx.fillRect(x4 - colGap / 2, bodyTop, 1, bodyH);

  // ════════════════════════════════════════════════════
  // COL 1: Preset loadout selector
  // ════════════════════════════════════════════════════
  const heroUnitId = b.hero?.unitId || 'abrams';
  drawPresetPanel(ctx, b, zone, x1, colW_1, bodyTop, bodyBottom, heroUnitId);

  // ════════════════════════════════════════════════════
  // COL 2: Formation dropdown + unit lineup + ghost slots
  // ════════════════════════════════════════════════════
  let my = bodyTop;

  // ── Formation dropdown ──
  ctx.fillStyle = '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FORMATION', x2, my);
  my += 16;

  const fmtDropH = 24;
  const fmtIdx = FORMATION_IDS.indexOf(currentFmt);
  const fmtLabel = FORMATIONS[fmtIdx >= 0 ? fmtIdx : 0];

  if (!b._fmtDropdownOpen) {
    ctx.fillStyle = 'rgba(60, 80, 50, 0.6)';
    ctx.fillRect(x2, my, colW_2, fmtDropH);
    ctx.strokeStyle = 'rgba(120, 160, 80, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x2, my, colW_2, fmtDropH);

    ctx.fillStyle = '#d0e0b0';
    ctx.font = '11px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtLabel, x2 + 8, my + fmtDropH / 2);

    // Formation preview dots
    const offsets = FORMATION_OFFSETS[currentFmt] || FORMATION_OFFSETS.line;
    const unitCount = 1 + (b.units?.length || 0);
    const dotCx = x2 + colW_2 - 24;
    const dotCy = my + fmtDropH / 2;
    const dotScale = 0.06;
    for (let di = 0; di < Math.min(unitCount, offsets.length); di++) {
      ctx.beginPath();
      ctx.arc(dotCx + offsets[di][0] * dotScale, dotCy + offsets[di][1] * dotScale,
        di === 0 ? 2.5 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = di === 0 ? '#a0c870' : '#708860';
      ctx.fill();
    }

    ctx.fillStyle = '#90a880';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('▼', x2 + colW_2 - 6, my + fmtDropH / 2);

    zone._fmtDropdownRect = { x: x2, y: my, w: colW_2, h: fmtDropH };
    my += fmtDropH + 8;
  } else {
    for (let fi = 0; fi < FORMATIONS.length; fi++) {
      const active = FORMATION_IDS[fi] === currentFmt;
      const fby = my + fi * (fmtDropH + 2);
      if (fby + fmtDropH > bodyBottom) break;

      ctx.fillStyle = active ? 'rgba(90, 130, 60, 0.5)' : 'rgba(50, 65, 42, 0.5)';
      ctx.fillRect(x2, fby, colW_2, fmtDropH);
      ctx.strokeStyle = active ? 'rgba(140, 180, 90, 0.5)' : 'rgba(70, 85, 58, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x2, fby, colW_2, fmtDropH);

      ctx.fillStyle = active ? '#d0e0b0' : '#8a9478';
      ctx.font = '11px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(FORMATIONS[fi], x2 + 8, fby + fmtDropH / 2);

      const offsets = FORMATION_OFFSETS[FORMATION_IDS[fi]] || FORMATION_OFFSETS.line;
      const unitCount = 1 + (b.units?.length || 0);
      const dotCx = x2 + colW_2 - 24;
      const dotScale = 0.06;
      for (let di = 0; di < Math.min(unitCount, offsets.length); di++) {
        ctx.beginPath();
        ctx.arc(dotCx + offsets[di][0] * dotScale, fby + fmtDropH / 2 + offsets[di][1] * dotScale,
          di === 0 ? 2.5 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = active ? (di === 0 ? '#a0c870' : '#80a060') : (di === 0 ? '#708060' : '#586848');
        ctx.fill();
      }

      zone._fmtBtnRects.push({ x: x2, y: fby, w: colW_2, h: fmtDropH, id: FORMATION_IDS[fi] });
    }
    zone._fmtDropdownRect = { x: x2, y: my, w: colW_2, h: FORMATIONS.length * (fmtDropH + 2) };
    my += FORMATIONS.length * (fmtDropH + 2) + 6;
  }

  // ── Unit lineup with count ──
  const capacity = FORMATION_OFFSETS[currentFmt]?.length || 7;
  const filled = 1 + (b.units?.length || 0);

  ctx.fillStyle = '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`LINEUP ${filled}/${capacity}`, x2, my);
  ctx.fillStyle = 'rgba(100, 130, 70, 0.3)';
  ctx.fillRect(x2, my + 14, colW_2, 1);
  my += 20;

  const rowH = 17;
  const typeHeaderH = 16;

  // ── Crew tree-view (when roster exists) ──
  if (isCrewMode()) {
    my = drawCrewLineup(ctx, b, zone, b.units, b.hero, x2, colW_2, my, bodyBottom, rowH);
  } else {
  // Hero row
  if (b.hero) {
    const hSel = b._selectedUnit === b.hero;
    const selIdx = b._radarSelection.indexOf(b.hero.unitId);
    const isSel = selIdx >= 0;

    if (hSel) {
      ctx.fillStyle = 'rgba(160, 200, 110, 0.15)';
      ctx.fillRect(x2 - 2, my - 1, colW_2 + 2, rowH);
    } else if (isSel) {
      const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
      ctx.fillStyle = color.fill.replace('0.18', '0.2');
      ctx.fillRect(x2 - 2, my - 1, colW_2 + 2, rowH);
    }

    ctx.fillStyle = hSel ? '#e0e8d0' : (isSel ? '#d0d8c0' : '#b0b8a0');
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`★ ${b.hero.unitName?.display || 'LT Commander'}`, x2 + 4, my);

    ctx.fillStyle = '#607050';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(b.hero.unitId.toUpperCase(), x2 + colW_2 - 4, my + 1);

    // Radar comparison dot
    if (isSel) {
      const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
      ctx.beginPath();
      ctx.arc(x2 + colW_2 - 2, my + rowH / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = color.dot;
      ctx.fill();
    }

    zone._unitBtnRects.push({ x: x2 - 2, y: my - 1, w: colW_2 + 2, h: rowH, unitId: b.hero.unitId, unitRef: b.hero });
    my += rowH + 2;
  }

  // Grouped allies with weight icons + dark header bands
  const typeGroups = {};
  for (const u of (b.units || [])) {
    const tid = u.unitId || 'unit';
    if (!typeGroups[tid]) typeGroups[tid] = [];
    typeGroups[tid].push(u);
  }

  for (const [tid, groupUnits] of Object.entries(typeGroups)) {
    if (my + typeHeaderH > bodyBottom) break;

    // Dark header band
    ctx.fillStyle = 'rgba(40, 55, 30, 0.4)';
    ctx.fillRect(x2 - 2, my - 1, colW_2 + 4, typeHeaderH);

    // Weight icon
    const weight = UNIT_WEIGHT[tid] ?? 0;
    _drawWeightIcon(ctx, x2 + 2, my + 2, weight, '#708060');

    // Type header text (shifted right for icon)
    const iconW = weight === 3 ? 16 : (weight + 1) * 5 + 2;
    ctx.fillStyle = '#90a880';
    ctx.font = 'bold 9px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${tid.toUpperCase()} (${groupUnits.length})`, x2 + iconW + 4, my + 2);
    my += typeHeaderH;

    for (const u of groupUnits) {
      if (my + rowH > bodyBottom) break;

      const uSel = b._selectedUnit === u;
      const selIdx = b._radarSelection.indexOf(u.unitId);
      const isSel = selIdx >= 0;

      if (uSel) {
        ctx.fillStyle = 'rgba(160, 200, 110, 0.15)';
        ctx.fillRect(x2 - 2, my - 1, colW_2 + 2, rowH);
      } else if (isSel) {
        const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
        ctx.fillStyle = color.fill.replace('0.18', '0.2');
        ctx.fillRect(x2 - 2, my - 1, colW_2 + 2, rowH);
      }

      ctx.fillStyle = uSel ? '#d0e0b0' : (isSel ? '#c0c8b0' : '#8a9478');
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`  ${u.unitName?.display || u.id}`, x2 + 4, my);

      // Radar comparison dot
      if (isSel) {
        const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
        ctx.beginPath();
        ctx.arc(x2 + colW_2 - 2, my + rowH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = color.dot;
        ctx.fill();
      }

      // ✕ remove button (right edge)
      const rmSize = 13;
      const rmX = x2 + colW_2 - rmSize - 1;
      const rmY = my + (rowH - rmSize) / 2 - 1;
      ctx.fillStyle = uSel ? 'rgba(200, 80, 60, 0.25)' : 'rgba(120, 60, 50, 0.15)';
      ctx.fillRect(rmX, rmY, rmSize, rmSize);
      ctx.fillStyle = uSel ? '#e08070' : '#806050';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', rmX + rmSize / 2, rmY + rmSize / 2);
      zone._removeUnitRects.push({ x: rmX, y: rmY, w: rmSize, h: rmSize, unitRef: u });

      zone._unitBtnRects.push({ x: x2 - 2, y: my - 1, w: colW_2 - rmSize - 4, h: rowH, unitId: u.unitId, unitRef: u });
      my += rowH;
    }
    my += 3;
  }

  // Ghost slots (empty formation positions)
  const emptySlots = Math.max(0, capacity - filled);
  for (let gi = 0; gi < emptySlots; gi++) {
    if (my + rowH > bodyBottom) break;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(100, 130, 70, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x2, my, colW_2, rowH - 2);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(100, 130, 70, 0.3)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', x2 + colW_2 / 2, my + rowH / 2 - 1);
    my += rowH;
  }
  } // end else (non-crew lineup)

  // ════════════════════════════════════════════════════
  // TRANSFER ARROWS (between lineup and available)
  // ════════════════════════════════════════════════════
  const arrowBtnSize = 22;
  const arrowCx = xTransfer + transferStripW / 2;
  const arrowMidY = bodyTop + bodyH / 2;

  // Determine if arrows should be active
  let canPullIn, canPushOut;
  if (isCrewMode()) {
    // Crew mode: arrows work for crew slot + soldier swap, or whole unit transfer
    const lineSel = b._lineupSelection;
    const isSlotSel = lineSel?.type === 'crew-slot';
    const isUnitSel = lineSel?.type === 'vehicle' || lineSel?.type === 'infantry';
    canPullIn = !!(isSlotSel && b._selectedCrewSoldier && b._selectedCrewSoldier.role === lineSel.slot);
    canPushOut = !!(isSlotSel && lineSel.soldier) ||
                 !!(isUnitSel && lineSel.unitRef !== b.hero && (b.units || []).includes(lineSel.unitRef));
  } else {
    const selUnit = b._selectedUnit;
    const selInLineup = selUnit && (selUnit === b.hero || (b.units || []).includes(selUnit));
    const selInRoster = selUnit && (b.reservePool || []).includes(selUnit);
    canPullIn = selInRoster && filled < capacity;
    canPushOut = selInLineup && selUnit !== b.hero; // Can't push hero out
  }

  // ◀ Pull into lineup (top arrow)
  const pullY = arrowMidY - arrowBtnSize - 4;
  ctx.fillStyle = canPullIn ? 'rgba(80, 120, 55, 0.6)' : 'rgba(40, 55, 30, 0.3)';
  ctx.fillRect(arrowCx - arrowBtnSize / 2, pullY, arrowBtnSize, arrowBtnSize);
  ctx.strokeStyle = canPullIn ? 'rgba(140, 180, 90, 0.5)' : 'rgba(70, 85, 58, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(arrowCx - arrowBtnSize / 2, pullY, arrowBtnSize, arrowBtnSize);
  ctx.fillStyle = canPullIn ? '#c0e0a0' : '#405030';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◀', arrowCx, pullY + arrowBtnSize / 2);
  zone._transferLeftRect = { x: arrowCx - arrowBtnSize / 2, y: pullY, w: arrowBtnSize, h: arrowBtnSize };

  // ▶ Push to available (bottom arrow)
  const pushY = arrowMidY + 4;
  ctx.fillStyle = canPushOut ? 'rgba(80, 120, 55, 0.6)' : 'rgba(40, 55, 30, 0.3)';
  ctx.fillRect(arrowCx - arrowBtnSize / 2, pushY, arrowBtnSize, arrowBtnSize);
  ctx.strokeStyle = canPushOut ? 'rgba(140, 180, 90, 0.5)' : 'rgba(70, 85, 58, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(arrowCx - arrowBtnSize / 2, pushY, arrowBtnSize, arrowBtnSize);
  ctx.fillStyle = canPushOut ? '#c0e0a0' : '#405030';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▶', arrowCx, pushY + arrowBtnSize / 2);
  zone._transferRightRect = { x: arrowCx - arrowBtnSize / 2, y: pushY, w: arrowBtnSize, h: arrowBtnSize };

  // ════════════════════════════════════════════════════
  // COL 3: Available roster with weight icons + dark headers
  // ════════════════════════════════════════════════════
  let ry = bodyTop;

  if (isCrewMode()) {
    ry = drawCrewAvailable(ctx, b, zone, x3, colW_3, ry, bodyBottom, 17);
  } else {
  ctx.fillStyle = '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const reserves = b.reservePool || [];
  ctx.fillText(`AVAILABLE (${reserves.length})`, x3, ry);
  ctx.fillStyle = 'rgba(100, 130, 70, 0.3)';
  ctx.fillRect(x3, ry + 14, colW_3, 1);
  ry += 20;

  // Group reserves by type
  const resGroups = {};
  for (const r of reserves) {
    const tid = r.unitId;
    if (!resGroups[tid]) resGroups[tid] = [];
    resGroups[tid].push(r);
  }

  const resRowH = 17;
  const resHeaderH = 16;

  for (const [tid, group] of Object.entries(resGroups)) {
    if (ry + resHeaderH > bodyBottom) break;

    // Dark header band
    ctx.fillStyle = 'rgba(40, 55, 30, 0.4)';
    ctx.fillRect(x3 - 2, ry - 1, colW_3 + 4, resHeaderH);

    // Weight icon
    const weight = UNIT_WEIGHT[tid] ?? 0;
    _drawWeightIcon(ctx, x3 + 2, ry + 2, weight, '#708060');

    const iconW = weight === 3 ? 16 : (weight + 1) * 5 + 2;
    const typeName = UNITS.find(u => u.id === tid)?.name || tid.toUpperCase();
    ctx.fillStyle = '#90a880';
    ctx.font = 'bold 9px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${typeName.toUpperCase()} (${group.length})`, x3 + iconW + 4, ry + 2);
    ry += resHeaderH;

    for (const r of group) {
      if (ry + resRowH > bodyBottom) break;

      const rSel = b._selectedUnit === r;
      const selIdx = b._radarSelection.indexOf(r.unitId);
      const isSel = selIdx >= 0;

      if (rSel) {
        ctx.fillStyle = 'rgba(160, 200, 110, 0.15)';
        ctx.fillRect(x3 - 2, ry - 1, colW_3 + 2, resRowH);
      } else if (isSel) {
        const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
        ctx.fillStyle = color.fill.replace('0.18', '0.2');
        ctx.fillRect(x3 - 2, ry - 1, colW_3 + 2, resRowH);
      }

      ctx.fillStyle = rSel ? '#c0d0a0' : '#7a8568';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`  ${r.unitName?.display || r.id}`, x3 + 4, ry);

      // Radar comparison dot
      if (isSel) {
        const color = RADAR_COLORS[selIdx % RADAR_COLORS.length];
        ctx.beginPath();
        ctx.arc(x3 + colW_3 - 2, ry + resRowH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = color.dot;
        ctx.fill();
      }

      // + add button (right edge)
      if (filled < capacity) {
        const addSize = 13;
        const addX = x3 + colW_3 - addSize - 1;
        const addY = ry + (resRowH - addSize) / 2 - 1;
        ctx.fillStyle = rSel ? 'rgba(80, 160, 60, 0.25)' : 'rgba(60, 100, 50, 0.15)';
        ctx.fillRect(addX, addY, addSize, addSize);
        ctx.fillStyle = rSel ? '#80c060' : '#506040';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', addX + addSize / 2, addY + addSize / 2);
        zone._addUnitRects.push({ x: addX, y: addY, w: addSize, h: addSize, unitRef: r });
      }

      zone._rosterBtnRects.push({ x: x3 - 2, y: ry - 1, w: colW_3 - 16, h: resRowH, unitRef: r, unitId: r.unitId });
      ry += resRowH;
    }
    ry += 3;
  }

  if (reserves.length === 0) {
    ctx.fillStyle = '#506040';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('No reserves', x3 + 4, ry);
  }
  } // end else (non-crew available)

  // ════════════════════════════════════════════════════
  // COL 4: Unit Card (flippable baseball card)
  // ════════════════════════════════════════════════════
  let cy = bodyTop;

  // Context-aware header based on lineup selection
  const lineSel = b._lineupSelection;
  let cardHeader = 'UNIT CARD';
  if (isCrewMode() && lineSel) {
    const hasComparison = (lineSel.type === 'crew-slot' && lineSel.soldier && b._selectedCrewSoldier) ||
                          ((lineSel.type === 'vehicle' || lineSel.type === 'infantry') && b._selectedUnit);
    if (hasComparison) cardHeader = 'COMPARISON';
    else if (lineSel.type === 'crew-slot') cardHeader = lineSel.soldier ? 'CREW MEMBER' : 'CREW SLOT';
    else if (lineSel.type === 'vehicle') cardHeader = 'VEHICLE';
    else if (lineSel.type === 'infantry') cardHeader = 'SOLDIER';
    else if (lineSel.type === 'group') cardHeader = lineSel.group === 'vehicles' ? 'VEHICLES' : 'SOLDIERS';
  } else if (b._selectedCrewSoldier) {
    cardHeader = 'SOLDIER';
  }

  ctx.fillStyle = '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(cardHeader, x4, cy);
  ctx.fillStyle = 'rgba(100, 130, 70, 0.3)';
  ctx.fillRect(x4, cy + 14, colW_4, 1);
  cy += 20;

  // Card area hit rect for flip
  zone._cardRect = { x: x4, y: cy, w: colW_4, h: bodyBottom - cy };

  // Bridge lineup selection → legacy fields for card rendering

  // ── Comparison: lineup crew vs barracks candidate ──
  if (isCrewMode() && lineSel?.type === 'crew-slot' && lineSel.soldier && b._selectedCrewSoldier) {
    const axes = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];
    const cur = lineSel.soldier;
    const cand = b._selectedCrewSoldier;
    const curRank = RANK_TABLE[cur.rankIndex]?.abbr || '';
    const candRank = RANK_TABLE[cand.rankIndex]?.abbr || '';
    const datasets = [
      { values: axes.map(a => cur.personality?.[a] ?? 0.5), label: `${curRank} ${cur.name.last}` },
      { values: axes.map(a => cand.personality?.[a] ?? 0.5), label: `${candRank} ${cand.name.last}` }
    ];
    _drawComparisonChart(ctx, x4, colW_4, cy, bodyBottom, datasets, PERSONALITY_RADAR_LABELS, 'CREW COMPARISON');

  } else if (isCrewMode() && (lineSel?.type === 'vehicle' || lineSel?.type === 'infantry') && b._selectedUnit) {
    // ── Comparison: lineup unit vs motor pool unit ──
    const curUid = lineSel.unitRef?.unitId || 'unknown';
    const candUid = b._selectedUnit?.unitId || 'unknown';
    const curDef = UNITS.find(d => d.id === curUid);
    const candDef = UNITS.find(d => d.id === candUid);
    const datasets = [
      { values: _getUnitRadarValues(curUid), label: curDef?.name || curUid.toUpperCase() },
      { values: _getUnitRadarValues(candUid), label: candDef?.name || candUid.toUpperCase() }
    ];
    _drawComparisonChart(ctx, x4, colW_4, cy, bodyBottom, datasets, undefined, 'UNIT COMPARISON');

  } else if (isCrewMode() && lineSel?.type === 'crew-slot' && lineSel.soldier) {
    // Single crew slot selected → show soldier card
    b._selectedCrewSlot = { vehicleId: lineSel.vehicleId, slot: lineSel.slot, unitRef: lineSel.unitRef, soldier: lineSel.soldier };
    drawCrewCard(ctx, b, x4, colW_4, cy, bodyBottom);

  } else if (isCrewMode() && b._selectedCrewSoldier) {
    // Barracks soldier selected → show soldier card
    const s = b._selectedCrewSoldier;
    b._selectedCrewSlot = { soldier: s, slot: s.role, vehicleId: null, unitRef: null };
    drawCrewCard(ctx, b, x4, colW_4, cy, bodyBottom);
    b._selectedCrewSlot = null;
  } else if (isCrewMode() && lineSel?.type === 'group' && (lineSel.unitRefs?.length > 0 || lineSel.soldiers?.length > 0)) {
    // Group selected → radar chart comparing all units/soldiers in the group
    const datasets = [];
    if (lineSel.soldiers?.length > 0) {
      // Crew-slot multi-select → personality radar
      const axes = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];
      for (const s of lineSel.soldiers) {
        const vals = axes.map(a => s.personality?.[a] ?? 0.5);
        const rankAbbr = RANK_TABLE[s.rankIndex]?.abbr || '';
        datasets.push({ values: vals, label: `${rankAbbr} ${s.name.last}` });
      }
    } else {
      for (const u of lineSel.unitRefs) {
        const uid = u.unitId || 'unknown';
        const unitDef = UNITS.find(d => d.id === uid);
        const label = unitDef?.name || uid.toUpperCase();
        datasets.push({ values: _getUnitRadarValues(uid), label });
      }
    }

    // Draw radar chart centered in card area
    const chartSpace = bodyBottom - cy;
    const radarR = Math.min((colW_4 - 30) / 2, (chartSpace - 60) / 2, 70);
    const chartCx = x4 + colW_4 / 2;
    const chartCy = cy + radarR + 20;

    if (radarR > 20) {
      const radarLabels = lineSel.soldiers?.length > 0 ? PERSONALITY_RADAR_LABELS : undefined;
      _drawRadarChart(ctx, chartCx, chartCy, radarR, datasets, radarLabels);
    }
  } else

  // Vehicle or infantry selected → show unit card
  {const sel = (lineSel?.type === 'vehicle' || lineSel?.type === 'infantry') ? lineSel.unitRef : b._selectedUnit;
  if (sel) {
    const uid = sel.unitId || 'unknown';
    const unitDef = UNITS.find(u => u.id === uid);
    const stats = UNIT_COMBAT_STATS[uid];
    const desc = UNIT_DESCRIPTIONS?.[uid];
    const isFlipped = b._cardFlipped || false;

    if (!isFlipped) {
      // ── CARD FRONT: metadata + key stats + unit image ──

      // Unit name
      ctx.fillStyle = '#d0e0b0';
      ctx.font = 'bold 12px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(sel.unitName?.display || uid.toUpperCase(), x4, cy);
      cy += 16;

      // Type label + weight icon
      const weight = UNIT_WEIGHT[uid] ?? 0;
      _drawWeightIcon(ctx, x4, cy + 2, weight, '#708060');
      const iconW = weight === 3 ? 16 : (weight + 1) * 5 + 2;
      ctx.fillStyle = '#90a880';
      ctx.font = '10px Oxanium, monospace';
      ctx.fillText(unitDef?.name || uid.toUpperCase(), x4 + iconW + 4, cy);
      cy += 18;

      // Unit SVG image
      const svgImg = getUnitSvgImage(uid, 'blue');
      const imgSize = Math.min(colW_4 - 8, 80);
      if (svgImg && svgImg._loaded) {
        const imgX = x4 + (colW_4 - imgSize) / 2;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(svgImg, imgX, cy, imgSize, imgSize);
        ctx.restore();
        cy += imgSize + 8;
      } else {
        cy += 8;
      }

      // Stats table (2-column layout)
      const statPairs = [];
      if (unitDef) {
        statPairs.push(['DMG', `${unitDef.damage}`, 'ROF', `${unitDef.fireRate}ms`]);
      }
      if (sel.hp != null && stats) {
        statPairs.push(['HP', `${sel.hp}/${sel.maxHp || sel.hp}`, 'RNG', `${stats.range}`]);
        statPairs.push(['SPD', `${stats.speed}`, 'VIEW', `${stats.viewRange}`]);
      } else if (stats) {
        statPairs.push(['RNG', `${stats.range}`, 'SPD', `${stats.speed}`]);
        statPairs.push(['VIEW', `${stats.viewRange}`, '', '']);
      }

      const halfW = (colW_4 - 8) / 2;
      for (const pair of statPairs) {
        if (cy + 14 > bodyBottom) break;
        // Left stat
        ctx.fillStyle = '#708060';
        ctx.font = '9px Oxanium, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(pair[0], x4, cy);
        ctx.fillStyle = '#b0c0a0';
        ctx.textAlign = 'right';
        ctx.fillText(pair[1], x4 + halfW, cy);
        // Right stat
        if (pair[2]) {
          ctx.fillStyle = '#708060';
          ctx.textAlign = 'left';
          ctx.fillText(pair[2], x4 + halfW + 8, cy);
          ctx.fillStyle = '#b0c0a0';
          ctx.textAlign = 'right';
          ctx.fillText(pair[3], x4 + colW_4, cy);
        }
        cy += 14;
      }
      cy += 6;

      // Personality preset label
      const personality = sel.personality || sel._personality || {};
      const presetName = sel.personalityPreset || 'default';
      if (presetName && presetName !== 'default') {
        ctx.fillStyle = '#708060';
        ctx.font = '9px Oxanium, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PRESET', x4, cy);
        ctx.fillStyle = '#b0c0a0';
        ctx.textAlign = 'right';
        ctx.fillText(presetName.toUpperCase(), x4 + colW_4, cy);
        cy += 14;
      }

      // Description (word-wrapped)
      if (desc && cy + 12 < bodyBottom) {
        cy += 4;
        ctx.fillStyle = '#607050';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        const words = desc.split(' ');
        let line = '';
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > colW_4 - 4) {
            if (cy + 12 > bodyBottom) break;
            ctx.fillText(line, x4, cy);
            cy += 12;
            line = word;
          } else {
            line = test;
          }
        }
        if (line && cy + 12 <= bodyBottom) {
          ctx.fillText(line, x4, cy);
          cy += 12;
        }
      }

      // Flip hint at bottom
      ctx.fillStyle = '#506040';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('click to flip ↻', x4 + colW_4 / 2, bodyBottom);

    } else {
      // ── CARD BACK: radar chart + personality bars ──

      // Back header
      ctx.fillStyle = '#90a880';
      ctx.font = '10px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`← ${unitDef?.name || uid.toUpperCase()}`, x4, cy);
      cy += 18;

      // Mini radar chart for this unit
      const cardRadarR = Math.min((colW_4 - 20) / 2, 55);
      if (cardRadarR > 15) {
        const crCx = x4 + colW_4 / 2;
        const crCy = cy + cardRadarR + 6;
        _drawRadarChart(ctx, crCx, crCy, cardRadarR, [
          { label: uid.toUpperCase(), values: _getUnitRadarValues(uid) }
        ]);
        cy += cardRadarR * 2 + 18;
      }

      // Personality trait bars
      const personality = sel.personality || sel._personality || {};
      const traits = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];
      const labels = ['AGGR', 'PAT ', 'COUR', 'DISC', 'INIT', 'AWAR'];
      const barW = colW_4 - 60;

      ctx.fillStyle = '#90a880';
      ctx.font = 'bold 9px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('PERSONALITY', x4, cy);
      cy += 14;

      for (let ti = 0; ti < traits.length; ti++) {
        if (cy + 14 > bodyBottom) break;
        const val = personality[traits[ti]] ?? 0.5;

        // Label
        ctx.fillStyle = '#708060';
        ctx.font = '9px Oxanium, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(labels[ti], x4, cy);

        // Bar background
        const barX = x4 + 36;
        ctx.fillStyle = 'rgba(60, 80, 45, 0.4)';
        ctx.fillRect(barX, cy, barW, 10);

        // Bar fill
        ctx.fillStyle = 'rgba(140, 176, 96, 0.7)';
        ctx.fillRect(barX, cy, barW * val, 10);

        // Value
        ctx.fillStyle = '#90a080';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(2), x4 + colW_4, cy);

        cy += 14;
      }

      // Flip hint at bottom
      ctx.fillStyle = '#506040';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('click to flip ↻', x4 + colW_4 / 2, bodyBottom);
    }
  } else {
    // No unit selected
    ctx.fillStyle = '#506040';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Select a unit', x4 + 4, cy);
    ctx.fillText('to view details', x4 + 4, cy + 14);
  }
  } // end else (non-crew card block)
}

// ── Countdown overlay ───────────────────────────────────────

function drawCountdownOverlay(ctx, b, screenW, screenH) {
  const elapsed = b.countdownStart ? (Date.now() - b.countdownStart) / 1000 : 0;

  let text = '';
  let alpha = 1;
  if (elapsed >= 2.0 && elapsed < 3.0) {
    text = '3'; alpha = 1 - (elapsed - 2.0);
  } else if (elapsed >= 3.0 && elapsed < 4.0) {
    text = '2'; alpha = 1 - (elapsed - 3.0);
  } else if (elapsed >= 4.0 && elapsed < 4.7) {
    text = '1'; alpha = 1 - (elapsed - 4.0) / 0.7;
  } else if (elapsed >= 4.7 && elapsed < 5.0) {
    text = 'GO!'; alpha = 1 - (elapsed - 4.7) / 0.3;
  }

  if (!text) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.globalAlpha = Math.max(0.1, alpha);
  ctx.fillStyle = '#e0e8d0';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 3;
  ctx.font = `bold ${text === 'GO!' ? 72 : 96}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const scale = 1 + (1 - alpha) * 0.2;
  ctx.translate(screenW / 2, screenH / 2);
  ctx.scale(scale, scale);
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function getZoneComposition(b, zone) {
  if (!zone.units || zone.units.length === 0) return 'EMPTY';
  const counts = {};
  for (const u of zone.units) {
    const label = (u.unitId || 'unit').toUpperCase().slice(0, 4);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
}

// ── Roster → battle unit stamping ─────────────────────────

/**
 * Stamp roster soldier data onto battle units at deploy time.
 * - Infantry: copy personality from roster soldier
 * - Vehicles: blend crew personality via getEffectivePersonality()
 * - Initialize battle metrics tracking for post-battle progression
 */
function _stampRosterData(b) {
  const allUnits = [...(b.units || [])];
  if (b.hero && !b.hero.observer) allUnits.push(b.hero);

  // Create blue squad + sergeant now that units are deployed
  // (skipped during initBattleAI because units weren't placed yet)
  if (b.mode === 'endless' && allUnits.length > 0) {
    // Remove any stale blue squads
    b._squads = (b._squads || []).filter(s => s.team !== 'blue');

    // Stamp brain defaults + insignia on all blue units
    const insigniaSetId = b._insigniaSetId || Game?.settings?.insigniaSetId || null;
    for (const u of allUnits) {
      applyBrainDefaults(u, 'endlessAlly');
      u.team = 'blue';
      if (insigniaSetId) u._insigniaSetId = insigniaSetId;
    }

    // Create the blue squad with a sergeant
    const blueSpawnZone = { x: b.mapWidth / 2, y: b.mapHeight - (b.cellSize || 64) * 3, radius: 100 };
    const redSpawnZone = { x: b.mapWidth / 2, y: (b.cellSize || 64) * 3, radius: 100 };
    const squad = createSquad('blue', allUnits.filter(u => !u.isHero), {
      spawnZone: blueSpawnZone,
      enemyZone: redSpawnZone
    });
    b._squads.push(squad);

    // Assign ATTACK objective to the new sergeant
    if (squad.sergeant) {
      squad.sergeant.objective = { type: 'attack' };
    }

    // Re-sync sergeant lookup
    if (!b._teamWaypoints) b._teamWaypoints = {};
    if (!b._squadWaypoints) b._squadWaypoints = {};
  }

  // Initialize metrics map for post-battle progression
  b._soldierMetrics = new Map();

  for (const unit of allUnits) {
    // Infantry with roster link
    if (unit._soldierId) {
      const soldier = getSoldier(unit._soldierId);
      if (soldier) {
        unit.personality = { ...soldier.personality };
        // Init metrics for this soldier
        b._soldierMetrics.set(soldier.id, {
          soldierId: soldier.id,
          unitId: unit.id,
          role: unit._role || soldier.role,
          shotsFired: 0, shotsHit: 0, damageDealt: 0,
          kills: 0, died: false, damageTaken: 0
        });
      }
    }

    // Vehicle with roster link (or hero vehicle)
    if (unit._vehicleId || unit.isHero) {
      const crew = getCrewForVehicle(unit.id);
      // Store crew soldier IDs on the unit
      unit._crewSoldierIds = {};
      for (const [slot, soldier] of Object.entries(crew)) {
        if (soldier) {
          unit._crewSoldierIds[slot] = soldier.id;
          // Init metrics for each crew member
          b._soldierMetrics.set(soldier.id, {
            soldierId: soldier.id,
            unitId: unit.id,
            role: slot,
            shotsFired: 0, shotsHit: 0, damageDealt: 0,
            kills: 0, died: false, damageTaken: 0
          });
        }
      }

      // Blend crew personality onto vehicle
      const blended = getEffectivePersonality(unit.id, unit.unitId);
      if (blended) unit.personality = blended;
    }
  }
}

/**
 * Post-battle: update roster soldiers and vehicles with battle results.
 * - Durability: carry forward HP damage
 * - KIA/destroyed marking
 * - XP awards + promotion checks
 * - Passive healing/repair between waves
 */
function _processPostBattle(b, result) {
  if (!b._soldierMetrics) return;

  const allUnits = [...(b.units || [])];
  if (b.hero && !b.hero.observer) allUnits.push(b.hero);

  // Determine first killer for heroic action detection
  const firstKill = b._debugLog?.find(e => e.type === 'kill' && e.team === 'blue');
  const firstKillerId = firstKill ? _findSoldierId(allUnits, firstKill.who) : null;

  // Check for last-man-standing
  const blueAlive = allUnits.filter(u => !u.dead);
  const lastManStanding = blueAlive.length === 1 && result === 'win' ? _findSoldierId(allUnits, blueAlive[0].id) : null;

  const battleContext = { firstKillerId, lastManStanding, result };
  const progressionResults = [];

  // Process each soldier's metrics and capture before/after for results screen
  function _processSoldier(soldier, metrics, unit, vehicleContext) {
    if (!soldier || !metrics) return;

    // Capture before state
    const mmrBefore = soldier.mmr || 0;
    const rankBefore = soldier.rankIndex || 0;

    // Durability
    if (unit?.dead || metrics.died) {
      soldier.status = 'kia';
      soldier.hpPercent = 0;
    } else if (unit) {
      soldier.hpPercent = Math.max(0, unit.hp / (unit.maxHp || 1));
      if (soldier.hpPercent < 0.3) soldier.status = 'wounded';
      metrics.hpPercent = soldier.hpPercent;
    }

    // Detect heroic actions
    const heroics = detectHeroics(metrics, battleContext);
    metrics._heroics = heroics;
    if (!soldier.heroicActions) soldier.heroicActions = [];
    for (const h of heroics) {
      if (!soldier.heroicActions.includes(h)) soldier.heroicActions.push(h);
    }

    // Compute battle score and update MMR
    const battleScore = computeBattleScore(metrics, result);
    const commsBefore = [...(soldier.commendations || [])];
    recordBattleScore(soldier, battleScore, metrics);

    // Update lifetime stats
    soldier.kills = (soldier.kills || 0) + (metrics.kills || 0);
    soldier.battlesServed = (soldier.battlesServed || 0) + 1;

    // Check promotion/demotion
    applyPromotion(soldier);
    applyDemotion(soldier);

    // Capture after state and build result entry
    const commsAfter = soldier.commendations || [];
    const newComms = commsAfter.filter(c => !commsBefore.includes(c));

    progressionResults.push({
      soldierId: soldier.id,
      name: getRankName(soldier),
      role: soldier.role,
      unitType: vehicleContext ? vehicleContext.unitId : (unit?.unitId || 'infantry'),
      // Battle stats
      kills: metrics.kills || 0,
      shotsHit: metrics.shotsHit || 0,
      shotsFired: metrics.shotsFired || 0,
      damageDealt: metrics.damageDealt || 0,
      died: !!metrics.died || !!unit?.dead,
      hpPercent: soldier.hpPercent,
      // Progression
      battleScore,
      mmrBefore,
      mmrAfter: soldier.mmr || 0,
      mmrDelta: (soldier.mmr || 0) - mmrBefore,
      streak: soldier.streak || 0,
      rankBefore,
      rankAfter: soldier.rankIndex || 0,
      promoted: soldier.rankIndex > rankBefore,
      demoted: soldier.rankIndex < rankBefore,
      heroics,
      commendationsEarned: newComms,
      // Vehicle context (for crew grouping in results)
      vehicleId: vehicleContext?.vehicleId || null,
      vehicleUnitId: vehicleContext?.unitId || null,
      crewSlot: vehicleContext?.slot || null
    });
  }

  for (const unit of allUnits) {
    // Infantry soldiers
    if (unit._soldierId) {
      const soldier = getSoldier(unit._soldierId);
      const metrics = b._soldierMetrics.get(unit._soldierId);
      _processSoldier(soldier, metrics, unit, null);
    }

    // Vehicle durability + crew (including hero vehicle)
    if (unit._vehicleId || (unit.isHero && unit._crewSoldierIds)) {
      const vehicle = unit._vehicleId ? getVehicle(unit._vehicleId) : null;
      // Update persistent vehicle durability (if it exists)
      if (vehicle) {
        if (unit.dead) {
          vehicle.status = 'destroyed';
          vehicle.hpPercent = 0;
        } else {
          vehicle.hpPercent = Math.max(0, unit.hp / (unit.maxHp || 1));
          if (vehicle.hpPercent < 0.3) vehicle.status = 'damaged';
        }
        vehicle.battlesServed++;
      }

      // Process crew members (works for roster vehicles AND hero vehicle)
      if (unit._crewSoldierIds) {
          const vehCtx = { vehicleId: unit._vehicleId || unit.id, unitId: unit.unitId };
          for (const [slot, soldierId] of Object.entries(unit._crewSoldierIds)) {
            const crewSoldier = getSoldier(soldierId);
            const metrics = b._soldierMetrics.get(soldierId);
            if (unit.dead) {
              // Vehicle destroyed — crew is knocked out, not KIA
              // They survive but are wounded (hpPercent set low)
              if (crewSoldier) {
                crewSoldier.status = 'wounded';
                crewSoldier.hpPercent = Math.max(0.1, (crewSoldier.hpPercent || 1) * 0.3);
              }
              // Record result for knocked-out crew
              const crewMmrBefore = crewSoldier?.mmr || 0;
              progressionResults.push({
                soldierId, name: crewSoldier ? getRankName(crewSoldier) : soldierId,
                role: slot, unitType: unit.unitId,
                kills: metrics?.kills || 0, shotsHit: metrics?.shotsHit || 0,
                shotsFired: metrics?.shotsFired || 0, damageDealt: metrics?.damageDealt || 0,
                died: false, hpPercent: crewSoldier?.hpPercent || 0.1,
                battleScore: 0, mmrBefore: crewMmrBefore, mmrAfter: crewMmrBefore, mmrDelta: 0,
                streak: 0, rankBefore: crewSoldier?.rankIndex || 0, rankAfter: crewSoldier?.rankIndex || 0,
                promoted: false, demoted: false, heroics: [], commendationsEarned: [],
                vehicleId: unit._vehicleId || unit.id, vehicleUnitId: unit.unitId, crewSlot: slot
              });
            } else {
              _processSoldier(crewSoldier, metrics, unit, { ...vehCtx, slot });
            }
          }
        }
      }
    }

  // Store progression results for the results screen
  if (Game.endless) {
    Game.endless._progressionResults = progressionResults;
  }

  // Passive healing/repair between waves (on win only)
  if (result === 'win') {
    healAllSoldiers(0.2);
    repairAllVehicles(0.15);
  }

  saveRoster();
  saveVehicles();
}

/** Find the soldier ID linked to a battle unit ID. */
function _findSoldierId(allUnits, unitId) {
  const unit = allUnits.find(u => u.id === unitId);
  if (!unit) return null;
  if (unit._soldierId) return unit._soldierId;
  if (unit._crewSoldierIds?.gunner) return unit._crewSoldierIds.gunner;
  return null;
}

// ── Hero stability — call AFTER hero movement each frame ─────

/**
 * Track hero movement and update stability.
 * Must be called AFTER the hero position is updated (not in the AI pipeline,
 * which runs before hero movement).
 */
function updateHeroStability(b, hero, dtSec) {
  if (!hero || hero.dead || hero.observer) return;

  // Use velocity for movement detection — frame-rate independent
  const velocity = hero.velocity ?? 0;
  hero._movedThisFrame = velocity > 5;
  hero._moveDistThisFrame = velocity * dtSec;

  // Same physics as AI units
  updateStability(hero, dtSec, hero.unitId);
  updateSuppression(hero, dtSec, b);
}

// ── Hero fire — shared by endless + campaign ─────────────────

/**
 * Hero fire: player controls WHEN, physics controls accuracy.
 * No AI gates (stability threshold, acquisition delay, fire probability).
 * @param {object} b - Battle state
 * @param {object} hero - Hero unit
 * @param {number} now - Current timestamp
 * @param {object} [targetEntity] - Auto-attack target entity (for range calc)
 * @returns {boolean} true if shot was fired
 */
function heroFire(b, hero, now, targetEntity) {
  if (now - hero.lastShot <= hero.fireRate) return false;

  // Use actual target position for range calculation, or mouse aim in world space
  let aimTarget;
  if (targetEntity && !targetEntity.dead) {
    aimTarget = { x: targetEntity.x, y: targetEntity.y };
  } else {
    // Fall back to world-space aim point from mouse + camera
    const zoom = b.camera?.zoom || 1;
    const camX = b.camera?.x || 0;
    const camY = b.camera?.y || 0;
    const worldX = (b.mouse?.x || 0) / zoom + camX;
    const worldY = (b.mouse?.y || 0) / zoom + camY;
    aimTarget = { x: worldX, y: worldY };
  }
  const shot = computeShotAccuracy(hero, aimTarget);

  hero.lastShot = now;
  const baseAngle = hero.angle;
  const maxSpreadDeg = UNIT_COMBAT_STATS[hero.unitId]?.maxSpreadDeg ?? DEFAULT_MAX_SPREAD_DEG;
  const maxSpread = maxSpreadDeg * Math.PI / 180;
  const spread = (1.0 - shot.accuracy) * maxSpread;
  const angle = baseAngle + (Math.random() - 0.5) * 2 * spread;

  const damage = hero.damage || 40;
  const finalDamage = Math.round(damage * (shot.damageMod ?? 1.0));
  const projSpeed = hero.projectileSpeed || 500;
  const projType = UNIT_PROJECTILES[hero.unitId] || 'bullet';
  const blastRadius = UNIT_COMBAT_STATS[hero.unitId]?.blastRadius || 0;
  // Impact point: where the shell will land (aim point with spread applied)
  const aimDist = Math.sqrt((aimTarget.x - hero.x) ** 2 + (aimTarget.y - hero.y) ** 2);
  const impactX = hero.x + Math.cos(angle) * aimDist;
  const impactY = hero.y + Math.sin(angle) * aimDist;

  b.projectiles.push({
    x: hero.x, y: hero.y,
    originX: hero.x, originY: hero.y,
    vx: Math.cos(angle) * projSpeed,
    vy: Math.sin(angle) * projSpeed,
    damage: finalDamage,
    owner: Owner.PLAYER,
    sourceId: hero.id,
    attackerTier: getArmorTier(hero),
    type: projType,
    blastRadius,
    impactTarget: blastRadius > 0 ? { x: impactX, y: impactY } : null,
    _bridgeElevation: hero._bridgeElevation || null
  });

  // Log fire event
  const factorStr = shot.factors.map(f => `${f.name}:${f.value.toFixed(2)}`).join(' ');
  logEvent(b, {
    t: now, who: hero.id, team: 'blue', type: 'fire',
    x: Math.round(hero.x), y: Math.round(hero.y),
    action: 'fire', target: hero.autoAttackTarget || '?',
    acc: shot.accuracy.toFixed(2), dmg: finalDamage,
    detail: `${factorStr} dist:${Math.round(shot.dist)} falloff:${(shot.damageMod ?? 1).toFixed(2)}`
  });

  // Post-fire recoil
  applyRecoilDrop(hero);

  // Track metrics for roster progression
  if (b._soldierMetrics && hero._crewSoldierIds?.gunner) {
    const m = b._soldierMetrics.get(hero._crewSoldierIds.gunner);
    if (m) m.shotsFired++;
  }

  // Fire animation
  if (useCanvasRendering && hero.animId) {
    sprites.triggerUnitAnim(hero.animId, 'fire');
  }
  sound('shoot');
  return true;
}

// ── Deployment click handler ────────────────────────────────

export function handleDeployClick(b, screenX, screenY, ctrlKey) {
  if (!b || b.phase !== 'deploying' || !b.deployZones?.blue) return false;

  const zones = b.deployZones.blue;
  const selZone = zones.find(z => z.selected);
  const _hit = (r) => r && screenX >= r.x && screenX <= r.x + r.w && screenY >= r.y && screenY <= r.y + r.h;

  // 0. Play mode toggle
  if (selZone?._modeRects) {
    for (const mr of selZone._modeRects) {
      if (_hit(mr)) {
        b.playMode = mr.mode;
        // Persist play mode across waves
        if (Game.endless) Game.endless.playMode = mr.mode;
        return true;
      }
    }
  }

  // 1. DEPLOY button (works in both collapsed and expanded)
  if (selZone && _hit(selZone._deployBtnRect)) {
    const zoneCenter = selZone.x + selZone.width / 2;
    const stageY = b.mapHeight + b.stageDepth / 2;
    const fmt = b._deployFormation || 'line';
    const totalUnits = 1 + (b.units?.length || 0);
    const positions = getFormationPositions(fmt, zoneCenter, stageY, totalUnits);

    // Position 0 is leader (hero), rest are squad
    b.hero.x = positions[0]?.x ?? zoneCenter;
    b.hero.y = positions[0]?.y ?? stageY;

    selZone.units = b.units || [];
    const units = b.units || [];
    for (let i = 0; i < units.length; i++) {
      const pos = positions[i + 1];
      if (pos) {
        units[i].x = pos.x;
        units[i].y = pos.y;
      } else {
        units[i].x = zoneCenter + (Math.random() - 0.5) * 120;
        units[i].y = stageY + 100 + (i - positions.length + 1) * 40;
      }
    }
    // Stamp roster personality onto battle units at deploy time
    _stampRosterData(b);

    // Save loadout for next battle auto-restore
    saveLastLoadout(b);

    b.deployReady.blue = true;
    return true;
  }

  // 2. Collapsed tab clicks — always clickable, toggle open/close
  for (const zone of zones) {
    const r = zone._screenRect;
    if (!r) continue;
    if (_hit(r)) {
      if (zone.selected && zone._expanded) {
        // Currently open — collapse
        zone._expanded = false;
        b._fmtDropdownOpen = false;
      } else if (zone.selected && !zone._expanded) {
        // Selected but collapsed — expand
        zone._expanded = true;
      } else {
        // Different zone — switch to it
        for (const z of zones) { z.selected = false; z._expanded = false; }
        b._fmtDropdownOpen = false;
        zone.selected = true;
        zone._expanded = true;
      }
      return true;
    }
  }

  // 3. Expanded panel interactions
  if (selZone?._expanded) {
    // Preset loadout clicks (Col 1)
    if (selZone._presetRects) {
      for (const pr of selZone._presetRects) {
        if (_hit(pr)) {
          applyPreset(b, pr.presetId);
          return true;
        }
      }
    }

    // Formation dropdown toggle / selection
    if (b._fmtDropdownOpen && selZone._fmtBtnRects) {
      for (const fb of selZone._fmtBtnRects) {
        if (_hit(fb)) {
          b._deployFormation = fb.id;
          b._fmtDropdownOpen = false;
          return true;
        }
      }
      if (selZone._fmtDropdownRect && !_hit(selZone._fmtDropdownRect)) {
        b._fmtDropdownOpen = false;
        return true;
      }
    } else if (selZone._fmtDropdownRect && _hit(selZone._fmtDropdownRect)) {
      b._fmtDropdownOpen = !b._fmtDropdownOpen;
      return true;
    }

    // Transfer arrows — ◀ pull into lineup, ▶ push to available
    if (_hit(selZone._transferLeftRect)) {
      if (isCrewMode()) {
        handleCrewTransfer(b, 'left');
      } else {
        // Pull selected available unit into lineup
        const sel = b._selectedUnit;
        const reserves = b.reservePool || [];
        const capacity = FORMATION_OFFSETS[b._deployFormation || 'line']?.length || 7;
        const filled = 1 + (b.units?.length || 0);
        if (sel && reserves.includes(sel) && filled < capacity) {
          const idx = reserves.indexOf(sel);
          reserves.splice(idx, 1);
          if (!b.units) b.units = [];
          b.units.push(sel);
          b._selectedUnit = sel; // Keep selected
        }
      }
      return true;
    }
    if (_hit(selZone._transferRightRect)) {
      if (isCrewMode()) {
        handleCrewTransfer(b, 'right');
      } else {
        // Push selected lineup unit to available
        const sel = b._selectedUnit;
        if (sel && sel !== b.hero && (b.units || []).includes(sel)) {
          const idx = b.units.indexOf(sel);
          b.units.splice(idx, 1);
          if (!b.reservePool) b.reservePool = [];
          b.reservePool.push(sel);
          b._selectedUnit = sel; // Keep selected
        }
      }
      return true;
    }

    // ✕ Remove unit from lineup
    if (selZone._removeUnitRects) {
      for (const rm of selZone._removeUnitRects) {
        if (_hit(rm)) {
          const u = rm.unitRef;
          if (u && (b.units || []).includes(u)) {
            b.units.splice(b.units.indexOf(u), 1);
            if (!b.reservePool) b.reservePool = [];
            b.reservePool.push(u);
            if (b._selectedUnit === u) b._selectedUnit = null;
            clearCrewSelection(b);
          }
          return true;
        }
      }
    }

    // + Add unit to lineup from reserves
    if (selZone._addUnitRects) {
      for (const ar of selZone._addUnitRects) {
        if (_hit(ar)) {
          const u = ar.unitRef;
          const reserves = b.reservePool || [];
          const capacity = FORMATION_OFFSETS[b._deployFormation || 'line']?.length || 7;
          const filled = 1 + (b.units?.length || 0);
          if (u && reserves.includes(u) && filled < capacity) {
            reserves.splice(reserves.indexOf(u), 1);
            if (!b.units) b.units = [];
            b.units.push(u);
            b._selectedUnit = u;
          }
          return true;
        }
      }
    }

    // Unit card click — flip
    if (selZone._cardRect && _hit(selZone._cardRect) && b._selectedUnit) {
      b._cardFlipped = !b._cardFlipped;
      return true;
    }

    // Pool tab clicks (Barracks / Motor Pool)
    if (isCrewMode() && handlePoolTabClick(b, selZone, screenX, screenY)) {
      return true;
    }

    // ── Col 2: Lineup clicks (unified — one handler for all row types) ──
    if (isCrewMode() && handleLineupClick(b, selZone, screenX, screenY, ctrlKey)) {
      return true;
    }

    // ── Col 3: Barracks / Motor Pool clicks ──
    if (isCrewMode() && handleCrewAddClick(b, selZone, screenX, screenY)) {
      return true;
    }
    if (isCrewMode() && handleCrewAvailableClick(b, selZone, screenX, screenY)) {
      return true;
    }
    if (isCrewMode() && handleMotorPoolClick(b, selZone, screenX, screenY)) {
      return true;
    }

    // Section collapse (Barracks tree TC/GNR/DRV headers)
    if (isCrewMode() && handleSectionHeaderClick(b, selZone, screenX, screenY)) {
      return true;
    }

    // Non-crew mode: unit lineup + roster clicks
    if (selZone._unitBtnRects) {
      for (const ub of selZone._unitBtnRects) {
        if (_hit(ub)) {
          const wasSelected = b._selectedUnit === ub.unitRef;
          b._selectedUnit = wasSelected ? null : (ub.unitRef || null);
          return true;
        }
      }
    }
    if (selZone._rosterBtnRects) {
      for (const rb of selZone._rosterBtnRects) {
        if (_hit(rb)) {
          const wasSelected = b._selectedUnit === rb.unitRef;
          b._selectedUnit = wasSelected ? null : (rb.unitRef || null);
          return true;
        }
      }
    }

    // Collapse arrow button in header
    if (_hit(selZone._collapseRect)) {
      selZone._expanded = false;
      b._fmtDropdownOpen = false;
      return true;
    }

    // Absorb clicks on the expanded panel so they don't fall through
    if (_hit(selZone._expandedRect)) {
      return true;
    }
  }

  return false;
}

// Endless input handlers
export function endlessKeyDown(key) {
  const b = Game.endless?.battle;
  if (!b) return;

  // DEBUG: backtick toggles debug panel
  if (key === '`' || key === 'Backquote') {
    toggleDebugPanel(() => Game.endless?.battle);
    return;
  }

  // Deployment phase: F to flip unit card
  if (b.phase === 'deploying' && (key === 'f' || key === 'F') && b._selectedUnit) {
    b._cardFlipped = !b._cardFlipped;
    return;
  }

  // CMD mode keys (1-5 commands, Tab cycle, Escape cancel, F center)
  if (b.playMode === 'cmd' && b.phase === 'active') {
    if (handleCMDKey(b, key)) return;
  }

  cameraKeyDown(b, key);
}

export function endlessKeyUp(key) {
  const b = Game.endless?.battle;
  if (!b) return;
  cameraKeyUp(b, key);
}

export function endlessMouseMove(x, y) {
  const b = Game.endless?.battle;
  if (!b) return;

  b.mouse.x = x;
  b.mouse.y = y;
}

export function endlessMouseDown() {
  const b = Game.endless?.battle;
  if (!b) return;

  // Debug panel unit inspect — intercept click to select unit
  if (isDebugPanelVisible()) {
    const z = b.camera.zoom || 1;
    const worldX = b.mouse.x / z + b.camera.x;
    const worldY = b.mouse.y / z + b.camera.y;
    if (debugInspectAt(b, worldX, worldY)) return;
  }

  b.mouse.down = true;
}

export function endlessMouseUp() {
  const b = Game.endless?.battle;
  if (!b) return;

  b.mouse.down = false;
}

// ═══════════════════════════════════════════════════════════════
// FIRE RANGE — AI battle observer loop
// ═══════════════════════════════════════════════════════════════

let fireRangeLoopId = null;
let fireRangeLastT = 0;

function startFireRangeLoop() {
  if (fireRangeLoopId) return;
  fireRangeLastT = 0; // Will be set on first frame
  fireRangeLoopId = requestAnimationFrame(fireRangeLoop);
}

export function stopFireRangeLoop() {
  if (fireRangeLoopId) {
    cancelAnimationFrame(fireRangeLoopId);
    fireRangeLoopId = null;
  }
  const b = Game.fireRange?.battle;
  if (b?.battleRenderer) {
    b.battleRenderer.destroy();
    b.battleRenderer = null;
  }
  destroyDebugPanel();
}

/** Format a fire range battle state + event log into a human-readable snapshot string. */
export function formatFireRangeLog(b) {
  const lines = ['=== FIRE RANGE SNAPSHOT ==='];
  lines.push(`Result: ${b.result || 'in progress'}`);
  lines.push(`Map: ${b.gridWidth}x${b.gridHeight} cells, cellSize=${b.cellSize}`);
  if (b.terrainSeed != null) lines.push(`Seed: ${b.terrainSeed}`);
  if (Game.fireRange?.scenarioName) lines.push(`Scenario: ${Game.fireRange.scenarioName}`);
  lines.push('');

  lines.push('BLUE TEAM:');
  if (b.units) {
    for (const u of b.units) {
      const d = u._dbg || {};
      lines.push(`  ${u.id} [${u.unitId}] | hp:${u.hp}/${u.maxHp} | pos:(${Math.round(u.x)},${Math.round(u.y)}) | state:${d.state||'-'} | mMode:${d.movementMode||'-'} | sup:${d.suppression??0} | target:${d.targetId||'-'} | dist:${d.targetDist||'-'} | stab:${d.stability??'-'} | behavior:${d.behavior||'-'} | range:${u.range||'?'} | fireRate:${u.fireRate||'?'} | dmg:${u.damage||'?'} | spd:${u.speed||'?'} | terrain:${d.terrain||'-'} | cover:${d.cover??0}${d.inCover?' [IN COVER]':''} | vr:${d.viewRange??'?'} | spt:${d.spotted??0} | awr:${d.awareness??'-'} | cvBias:${d.coverBias??'-'} | fmt:${d.formation||'-'}${d.isLead?' [LEAD]':''} slot:${d.formationSlot??'-'} dev:${d.slotDev??'-'} slotXY:${d.slotX!=null?d.slotX+','+d.slotY:'-'}${u.dead?' | DEAD':''}`);
    }
  }
  lines.push('');

  lines.push('RED TEAM:');
  if (b.enemies) {
    for (const e of b.enemies) {
      const d = e._dbg || {};
      lines.push(`  ${e.id} [${e.unitId||'?'}] | hp:${e.hp}/${e.maxHp} | pos:(${Math.round(e.x)},${Math.round(e.y)}) | state:${d.state||'-'} | mMode:${d.movementMode||'-'} | sup:${d.suppression??0} | target:${d.targetId||'-'} | dist:${d.targetDist||'-'} | stab:${d.stability??'-'} | type:${d.typeKey||'-'} | range:${e.range||'?'} | fireRate:${e.fireRate||'?'} | dmg:${e.damage||'?'} | spd:${e.speed||'?'} | terrain:${d.terrain||'-'} | cover:${d.cover??0}${d.inCover?' [IN COVER]':''} | vr:${d.viewRange??'?'} | spt:${d.spotted??0} | awr:${d.awareness??'-'} | cvBias:${d.coverBias??'-'} | fmt:${d.formation||'-'}${d.isLead?' [LEAD]':''} slot:${d.formationSlot??'-'} dev:${d.slotDev??'-'} slotXY:${d.slotX!=null?d.slotX+','+d.slotY:'-'}${e.dead?' | DEAD':''}${e.modifier?' | mod:'+e.modifier:''}`);
    }
  }
  lines.push('');

  // ── Terrain diagnostics ──────────────────────────────────────
  const tm = b.terrainMap;
  if (tm) {
    lines.push('TERRAIN MAP:');
    lines.push(`  mapSize: ${b.mapWidth || '?'}x${b.mapHeight || '?'}`);
    lines.push(`  strokes: ${tm.strokes?.length || 0}`);
    lines.push(`  scatterItems: ${tm.scatterItems?.length || 0}`);

    // Spawn zones
    if (b.blueSpawnZone) {
      const z = b.blueSpawnZone;
      lines.push(`  blueSpawn: (${Math.round(z.x)},${Math.round(z.y)}) r=${Math.round(z.radius)}`);
    }
    if (b.redSpawnZone) {
      const z = b.redSpawnZone;
      lines.push(`  redSpawn: (${Math.round(z.x)},${Math.round(z.y)}) r=${Math.round(z.radius)}`);
    }

    // Bridges
    if (tm.bridges?.length > 0) {
      for (const br of tm.bridges) {
        lines.push(`  bridge: center=(${Math.round(br.x)},${Math.round(br.y)}) w=${Math.round(br.width)} len=${Math.round(br.length)} dir=(${br.dirX?.toFixed(2)},${br.dirY?.toFixed(2)}) deck=${br.deckTexture||'?'}`);
        lines.push(`    start=(${Math.round(br.startX)},${Math.round(br.startY)}) end=(${Math.round(br.endX)},${Math.round(br.endY)})`);
      }
    }

    // Water strokes summary
    const waterStrokes = tm.strokes?.filter(s => s.type === 'water') || [];
    if (waterStrokes.length > 0) {
      for (const ws of waterStrokes) {
        const pts = ws.points;
        if (pts?.length > 0) {
          const first = pts[0], last = pts[pts.length - 1];
          lines.push(`  water: ${pts.length} pts from (${Math.round(first.x)},${Math.round(first.y)}) to (${Math.round(last.x)},${Math.round(last.y)}) w=${Math.round(ws.width || 0)}`);
        }
      }
    }

    // Sample terrain queries along a grid for spatial awareness
    lines.push('  terrain samples (8x8 grid):');
    const mw = b.mapWidth || 1792, mh = b.mapHeight || 1792;
    const sampleRow = [];
    for (let gy = 0; gy < 8; gy++) {
      const row = [];
      for (let gx = 0; gx < 8; gx++) {
        const sx = (gx + 0.5) * (mw / 8);
        const sy = (gy + 0.5) * (mh / 8);
        const r = queryTerrain(tm, sx, sy);
        let ch = '.'; // open
        if (r.isBlocked) ch = '#';
        else if (r.isBridge) ch = '=';
        else if (r.depth === 'deep') ch = 'D';
        else if (r.depth === 'medium') ch = 'M';
        else if (r.depth === 'shallow') ch = '~';
        else if (r.dominant === 'forest') ch = 'T';
        else if (r.dominant === 'brush') ch = 'b';
        else if (r.water > 0.1) ch = 'w';
        row.push(ch);
      }
      sampleRow.push('    ' + row.join(' '));
    }
    lines.push(sampleRow.join('\n'));

    // Detailed samples around each bridge for navigation analysis
    if (tm.bridges?.length > 0) {
      for (const br of tm.bridges) {
        lines.push(`  bridge nav samples around (${Math.round(br.x)},${Math.round(br.y)}):`);
        for (let dy = -2; dy <= 2; dy++) {
          const row = [];
          for (let dx = -4; dx <= 4; dx++) {
            const sx = br.x + dx * 32;
            const sy = br.y + dy * 32;
            const r = queryTerrain(tm, sx, sy);
            let ch = '.';
            if (r.isBlocked) ch = '#';
            else if (r.isBridge) ch = '=';
            else if (r.depth === 'deep') ch = 'D';
            else if (r.depth === 'medium') ch = 'M';
            else if (r.depth === 'shallow') ch = '~';
            else if (r.dominant === 'forest') ch = 'T';
            else if (r.dominant === 'brush') ch = 'b';
            else if (r.water > 0.1) ch = 'w';
            row.push(ch);
          }
          lines.push(`    ${row.join(' ')}  y=${Math.round(br.y + dy * 32)}`);
        }
      }
    }

    lines.push('');
  }

  const logLen = b._debugLog?.length || 0;
  lines.push(`EVENT LOG (${logLen} events):`);
  if (b._debugLog) {
    for (const ev of b._debugLog) {
      const ts = ev.t ? ((ev.t - b._debugLog[0]?.t) / 1000).toFixed(1) + 's' : '?';
      const parts = [`[${ts}]`];
      if (ev.type) parts.push(`[${ev.type}]`);
      if (ev.team) parts.push(`(${ev.team})`);
      parts.push(ev.who || '?');
      if (ev.x !== undefined) parts.push(`@(${ev.x},${ev.y})`);
      parts.push(ev.action || '');
      if (ev.target) parts.push(`\u2192 ${ev.target}`);
      if (ev.dmg) parts.push(`dmg:${ev.dmg}`);
      if (ev.acc) parts.push(`acc:${ev.acc}`);
      if (ev.detail) parts.push(`| ${ev.detail}`);
      lines.push(`  ${parts.join(' ')}`);
    }
  }
  return lines.join('\n');
}

function fireRangeLoop(t) {
  if (Game.state !== State.FIRE_RANGE_BATTLE) {
    fireRangeLoopId = null;
    return;
  }

  // First frame: initialize lastT to current time (dt=0, no movement)
  if (!fireRangeLastT) fireRangeLastT = t;
  const dt = Math.max(0, Math.min(t - fireRangeLastT, 100)); // Clamp: no negatives, max 100ms
  fireRangeLastT = t;

  const b = Game.fireRange?.battle;
  if (b?._debugPaused) {
    drawFireRangeBattle();
    fireRangeLoopId = requestAnimationFrame(fireRangeLoop);
    return;
  }

  // Speed multiplier: 0=paused, <1=slow-mo, 1=normal, >1=fast-forward
  const debugScale = b?._debugTimeScale || 1;
  const speed = (Game.fireRange?.speed ?? 1) * debugScale;
  if (speed > 0) {
    if (speed >= 1) {
      for (let i = 0; i < speed; i++) {
        updateFireRangeBattle(dt);
      }
    } else {
      // Fractional speed: scale dt down
      updateFireRangeBattle(dt * speed);
    }
  }
  drawFireRangeBattle();

  fireRangeLoopId = requestAnimationFrame(fireRangeLoop);
}

function updateFireRangeBattle(dt) {
  clearQueryCache();
  const fr = Game.fireRange;
  const b = fr?.battle;
  if (!b || b.result) return;

  const dtSec = dt / 1000;
  const now = Date.now();
  const hero = b.hero;

  // --- DEBUG: NO COOLDOWNS ---
  if (b.debug?.noCooldowns) {
    if (b.units) for (const u of b.units) { u.lastShot = 0; u.lastAttack = 0; }
    if (b.enemies) for (const e of b.enemies) { e.lastShot = 0; e.lastAttack = 0; }
  }

  // --- PERFORMANCE MONITORING ---
  if (!b._perf) b._perf = { ai: 0, proj: 0, frame: 0, samples: 0, lastLog: 0 };
  const _perfFrameStartFR = performance.now();

  // --- UNIFIED AI PIPELINE ---
  const _perfAiStartFR = performance.now();
  runBattleAI(b, now, dtSec);
  b._perf.ai += performance.now() - _perfAiStartFR;

  // --- RECORD REPLAY FRAME ---
  if (b._recorder) recordFrame(b, now);

  // --- UPDATE PROJECTILES ---
  const _perfProjStartFR = performance.now();
  resolveProjectiles(b, now, dtSec, {
    useTierDamage: true,
    debugInvincible: b.debug
  });
  b._perf.proj += performance.now() - _perfProjStartFR;

  // --- CLEAN UP EFFECTS ---
  b.effects = b.effects.filter(e => {
    const age = now - e.t;
    if (e.type === 'muzzle') return age < 80;
    if (e.type === 'impact') return age < 200;
    return age < 1000;
  });

  // --- CAP DEBUG LOG (prevent unbounded memory growth) ---
  if (b._debugLog && b._debugLog.length > 2000) {
    b._debugLog = b._debugLog.slice(-1000);
  }

  b._perf.frame += performance.now() - _perfFrameStartFR;
  b._perf.samples++;
  _logPerfSnapshot(b, now);

  // --- AUTO-CAMERA: handled in drawHeroBattle (fit-to-view) ---

  // --- CHECK BATTLE END ---
  const blueAlive = b.units ? b.units.filter(u => !u.dead).length : 0;
  const redAlive = b.enemies.filter(e => !e.dead).length;

  if (blueAlive === 0 && redAlive > 0) {
    b.result = 'red_wins';
    fr.result = 'red_wins';
  } else if (redAlive === 0 && blueAlive > 0) {
    b.result = 'blue_wins';
    fr.result = 'blue_wins';
  } else if (blueAlive === 0 && redAlive === 0) {
    b.result = 'draw';
    fr.result = 'draw';
  }

  // Save replay
  if (b.result) saveReplay(b);

  // Show results modal when battle first ends
  if (b.result && !b._resultShown) {
    b._resultShown = true;
    b._showResults = true;
    // Inject overlay into DOM since the template isn't re-rendered
    const app = document.getElementById('app');
    if (app) {
      const div = document.createElement('div');
      div.id = 'fr-results-container';
      div.innerHTML = fireRangeResultsHTML(b);
      app.appendChild(div);
    }
  }

  // Auto-save log when battle ends
  if (b.result && !b._logSaved) {
    b._logSaved = true;
    const now = new Date();
    const ts = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const name = fr.scenarioName || `manual-${ts}`;
    const snapshot = formatFireRangeLog(b);
    fetch('/api/debug/fire-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot, name })
    }).catch(() => { /* silent — debug only */ });
  }
}

let _lastDebugPanelUpdate = 0;

function drawFireRangeBattle() {
  const b = Game.fireRange?.battle;
  if (!b) return;

  const bf = document.querySelector('.endless-battlefield');
  if (!bf) return;

  drawHeroBattle(bf, b);

  // Update HUD
  const blueAlive = b.units ? b.units.filter(u => !u.dead).length : 0;
  const blueTotal = b.units ? b.units.length : 0;
  const redAlive = b.enemies.filter(e => !e.dead).length;
  const redTotal = b.enemies.length;

  const blueEl = document.querySelector('.fr-team-count.blue');
  const redEl = document.querySelector('.fr-team-count.red');
  const statusEl = document.querySelector('.fr-status');

  if (blueEl) blueEl.textContent = `${blueAlive} / ${blueTotal} Blue`;
  if (redEl) redEl.textContent = `${redAlive} / ${redTotal} Red`;

  // Update phase displays
  const bluePhaseEl = document.querySelector('.fr-sgt-phase.blue');
  const redPhaseEl = document.querySelector('.fr-sgt-phase.red');
  if (bluePhaseEl && b._squads) bluePhaseEl.textContent = b._squads.filter(s => s.team === 'blue').map(s => s.sergeant?.phase || '—').join(' | ');
  if (redPhaseEl && b._squads) redPhaseEl.textContent = b._squads.filter(s => s.team === 'red').map(s => s.sergeant?.phase || '—').join(' | ');

  if (statusEl) {
    if (b.result === 'blue_wins') statusEl.textContent = 'BLUE WINS';
    else if (b.result === 'red_wins') statusEl.textContent = 'RED WINS';
    else if (b.result === 'draw') statusEl.textContent = 'DRAW';
    else statusEl.textContent = 'BATTLE';
  }

  // Update zoom display
  const zoomEl = document.querySelector('.fr-zoom-display');
  if (zoomEl) {
    const uz = b.camera.userZoom || 1;
    zoomEl.textContent = uz !== 1 ? `${Math.round(uz * 100)}%` : '';
  }

  // Update live report overlay (throttled to 1 fps)
  const now = performance.now();
  if (b._showResults && now - (b._lastReportUpdate || 0) > 1000) {
    b._lastReportUpdate = now;
    const el = document.getElementById('fr-results-container');
    if (el) el.innerHTML = fireRangeResultsHTML(b);
  }

  // Commander overlay
  drawCommanderOverlay(bf, b);

  // Update debug panel (throttled to 4 fps for DOM perf)
  if (now - _lastDebugPanelUpdate > 250) {
    _lastDebugPanelUpdate = now;
    _updateDebugPanel(b);
  }
}

// Column groups for debug panel — togglable
const DEBUG_COL_GROUPS = {
  core:    [
    { key: 'state',    hdr: 'State',  fn: (u, d) => d.state || '-' },
    { key: 'cmd',      hdr: 'Cmd',    fn: (u, d) => (d.command || '-').slice(0, 6) },
    { key: 'hp',       hdr: 'HP',     fn: (u) => u.maxHp ? Math.round(u.hp / u.maxHp * 100) + '%' : '-' },
    { key: 'target',   hdr: 'Target', fn: (u, d) => d.targetId || '-' },
    { key: 'dist',     hdr: 'Dist',   fn: (u, d) => d.targetDist ?? '-' }
  ],
  brain:   [
    { key: 'agg',      hdr: 'Agg',   fn: (u, d) => d.aggression ?? '-' },
    { key: 'pat',      hdr: 'Pat',   fn: (u, d) => d.patience ?? '-' },
    { key: 'crg',      hdr: 'Crg',   fn: (u, d) => d.courage ?? '-' },
    { key: 'dis',      hdr: 'Dis',   fn: (u, d) => d.discipline ?? '-' },
    { key: 'mrl',      hdr: 'Mrl',   fn: (u, d) => d.morale ?? '-' },
    { key: 'vet',      hdr: 'Vet',   fn: (u, d) => d.veterancy ?? '-' },
    { key: 'panic',    hdr: '!',     fn: (u, d) => d.panicking ? 'PNC' : '' }
  ],
  fire:    [
    { key: 'stab',     hdr: 'Stab',  fn: (u, d) => d.stability ?? '-' },
    { key: 'cd',       hdr: 'CD',    fn: (u, d) => d.cooldown ?? '-' },
    { key: 'aim',      hdr: 'Aim ms', fn: (u, d) => d.aimTime ?? '-' },
    { key: 'acc',      hdr: 'Acc',   fn: (u, d) => d.accuracy ?? '-' },
    { key: 'canfire',  hdr: 'Fire?', fn: (u, d) => d.canFire == null ? '-' : d.canFire ? 'Y' : 'N' }
  ],
  terrain: [
    { key: 'terrain',  hdr: 'Terr',  fn: (u, d) => (d.terrain || '-') + (d.inCover ? '*' : '') },
    { key: 'cover',    hdr: 'Cov',   fn: (u, d) => d.cover ?? 0 }
  ],
  awareness: [
    { key: 'awr',      hdr: 'Awr',   fn: (u, d) => d.awareness ?? '-' },
    { key: 'ini',      hdr: 'Ini',   fn: (u, d) => d.initiative ?? '-' },
    { key: 'spotted',  hdr: 'Spt',   fn: (u, d) => d.spotted ?? 0 },
    { key: 'vr',       hdr: 'VR',    fn: (u, d) => d.viewRange ?? '-' },
    { key: 'cvbias',   hdr: 'CvB',  fn: (u, d) => d.coverBias ?? '-' },
    { key: 'surv',     hdr: 'Surv',  fn: (u, d) => d.survivalAction || '-' },
    { key: 'ratio',    hdr: 'S.Rat', fn: (u, d) => d.survivalRatio ?? '-' },
    { key: 'prone',    hdr: 'Prn',   fn: (u, d) => d.isProne ? 'Y' : (d.isHullDown ? 'HD' : '') },
    { key: 'cvr',      hdr: 'Cvr',   fn: (u, d) => d.inCover ? 'Y' : '' }
  ],
  formation: [
    { key: 'fmt',      hdr: 'Fmt',   fn: (u, d) => d.formation || '-' },
    { key: 'slot',     hdr: 'Slot',  fn: (u, d) => d.formationSlot ?? '-' },
    { key: 'lead',     hdr: 'Lead',  fn: (u, d) => d.isLead ? 'Y' : '' },
    { key: 'sdev',     hdr: 'SDev',  fn: (u, d) => d.slotDev ?? '-' },
    { key: 'slotxy',   hdr: 'SlotXY', fn: (u, d) => d.slotX != null ? `${d.slotX},${d.slotY}` : '-' },
    // waitMult removed — formations are now a steering nudge, no leader throttle
    { key: 'fang',     hdr: 'FAng',  fn: (u, d) => d.fmtAngle != null ? `${d.fmtAngle}°` : '' }
  ],
  movement: [
    { key: 'mmode',    hdr: 'MMode', fn: (u, d) => {
      const m = d.movementMode;
      if (!m) return '-';
      // Short abbreviation for display
      const abbr = { panic_flee: 'PNC', urgent_cover: 'UCvr', survival_action: 'Surv',
        tactical_bound: 'Bnd', command_execute: 'Cmd', regroup: 'Rgrp' };
      return abbr[m] || m;
    }},
    { key: 'sup',      hdr: 'Sup',   fn: (u, d) => d.suppression ?? 0 }
  ]
};

function _updateDebugPanel(b) {
  const blueTable = document.getElementById('fr-blue-table');
  const redTable = document.getElementById('fr-red-table');
  const logEl = document.getElementById('fr-event-log');

  // Build visible columns from toggled groups
  const hidden = b._hiddenColGroups || {};
  const cols = [];
  for (const [group, groupCols] of Object.entries(DEBUG_COL_GROUPS)) {
    if (!hidden[group]) cols.push(...groupCols);
  }

  const headerHtml = '<tr><th>ID</th>' + cols.map(c => `<th>${c.hdr}</th>`).join('') + '</tr>';

  if (blueTable && b.units) {
    let html = headerHtml;
    for (const u of b.units) {
      const d = u._dbg || {};
      const dead = u.dead ? ' style="opacity:0.3"' : '';
      html += `<tr${dead}><td>${u.id}</td>` + cols.map(c => `<td>${c.fn(u, d)}</td>`).join('') + '</tr>';
    }
    blueTable.innerHTML = html;
  }

  if (redTable && b.enemies) {
    let html = headerHtml;
    for (const e of b.enemies) {
      const d = e._dbg || {};
      const dead = e.dead ? ' style="opacity:0.3"' : '';
      html += `<tr${dead}><td>${e.id}</td>` + cols.map(c => `<td>${c.fn(e, d)}</td>`).join('') + '</tr>';
    }
    redTable.innerHTML = html;
  }

  if (logEl) updateEventLog(logEl, b);
}

/** Render _debugLog entries into an event log DOM element. Shared by fire range, endless, replay.
 *  @param {number} [maxTime] - If set, only show events with t <= maxTime (for replay scrubbing) */
export function updateEventLog(logEl, b, maxTime) {
  if (!b._debugLog) return;
  let log = b._debugLog;
  if (maxTime !== undefined) log = log.filter(ev => ev.t <= maxTime);
  const filters = b._eventFilters;
  const filtered = filters
    ? log.filter(ev => !ev.type || filters[ev.type] !== false)
    : log;
  const events = filtered.slice(-40);
  let html = '';
  for (const ev of events) {
    const color = ev.team === Team.BLUE ? '#4a9eff' : ev.team === Team.RED ? '#ff4444' : '#888';
    const tag = ev.type ? `<span class="fr-log-tag fr-log-${ev.type}">${ev.type}</span> ` : '';
    html += `<div class="fr-log-entry">${tag}<span style="color:${color}">${ev.who}</span> ${ev.action} <span style="color:#aaa">${ev.target || ''}</span>${ev.dmg ? ` (${ev.dmg} dmg)` : ''}${ev.acc ? ` acc:${ev.acc}` : ''}${ev.detail ? ` <span style="color:#555">${ev.detail}</span>` : ''}</div>`;
  }
  logEl.innerHTML = html;
  logEl.scrollTop = logEl.scrollHeight;
}

/** Kill feed for endless mode — shows kills, deaths, wave events. */
let _lastFeedIndex = 0;

// ── Kill feed event formatting ──────────────────────────────
// Each entry maps a filter match to a CSS class + text formatter.
// Checked in order — first match wins. Return null text to skip.
const KILL_FEED_RULES = [
  // Kills (supports both tagged and legacy events)
  {
    match: ev => ev.type === 'kill' || (ev.category === 'combat' && ev.action === 'kill'),
    format: ev => {
      const who = ev.who || '?';
      const target = ev.target || '?';
      return ev.team === Team.BLUE
        ? { css: 'feed-kill', text: `${who} killed ${target}` }
        : { css: 'feed-death', text: `${target} killed by ${who}` };
    }
  },
  // Wave start
  {
    match: ev => ev.type === 'wave',
    format: ev => ({ css: 'feed-wave', text: ev.action })
  },
  // Commander: critical events (panic deploy, escalation)
  {
    match: ev => (ev.source === 'commander' || ev.type === 'commander') && (ev.severity === 'critical' || ev.action === 'escalate' || ev.action === 'panic_deploy'),
    format: ev => {
      const side = ev.team === 'red' ? 'Red CMD' : 'Blue CMD';
      if (ev.action === 'escalate') return { css: 'feed-commander feed-critical', text: `${side} orders all-out assault` };
      if (ev.action === 'panic_deploy') return { css: 'feed-commander feed-critical', text: `${side}: ${ev.detail}` };
      return null;
    }
  },
  // Commander: logistics (reserves, deployment)
  {
    match: ev => (ev.source === 'commander' || ev.type === 'commander') && (ev.action === 'reserve' || ev.action === 'deploy'),
    format: ev => {
      const side = ev.team === 'red' ? 'Red CMD' : 'Blue CMD';
      if (ev.action === 'reserve') return { css: 'feed-commander', text: `${side} sends reinforcements` };
      if (ev.action === 'deploy') return { css: 'feed-commander', text: `${side}: ${ev.detail}` };
      return null;
    }
  },
  // Commander: tactical (plays, reassignments)
  {
    match: ev => (ev.source === 'commander' || ev.type === 'commander') && (ev.action === 'play' || ev.action === 'reassign'),
    format: ev => {
      const side = ev.team === 'red' ? 'Red CMD' : 'Blue CMD';
      return { css: 'feed-commander', text: `${side}: ${ev.detail}` };
    }
  }
];

function updateKillFeed(b) {
  const feedEl = document.getElementById('kill-feed');
  if (!feedEl || !b._debugLog) return;

  const log = b._debugLog;
  // Process only new events since last check
  for (let i = Math.max(_lastFeedIndex, log.length - 50); i < log.length; i++) {
    const ev = log[i];

    let result = null;
    for (const rule of KILL_FEED_RULES) {
      if (rule.match(ev)) {
        result = rule.format(ev);
        break;
      }
    }
    if (!result || !result.text) continue;

    const entry = document.createElement('div');
    entry.className = `kill-feed-entry ${result.css}`;
    entry.textContent = result.text;
    feedEl.appendChild(entry);

    // Remove after animation completes (4s)
    setTimeout(() => entry.remove(), 4100);
  }
  _lastFeedIndex = log.length;

  // Safety cap: remove excess entries if somehow stacking
  while (feedEl.children.length > 6) {
    feedEl.firstChild.remove();
  }
}

// Fire Range input handlers (WASD = camera pan only)
export function fireRangeKeyDown(key) {
  const b = Game.fireRange?.battle;
  if (!b) return;
  if (key === '`' || key === 'Backquote') {
    toggleDebugPanel(() => Game.fireRange?.battle);
    return;
  }
  cameraKeyDown(b, key);
}

export function fireRangeKeyUp(key) {
  const b = Game.fireRange?.battle;
  if (!b) return;
  cameraKeyUp(b, key);
}

export function fireRangeWheel(deltaY) {
  const b = Game.fireRange?.battle;
  if (!b) return;
  cameraZoom(b, deltaY);
}

// ═══════════════════════════════════════════════════════════════
// ZONE BATTLE SYSTEM - Spawning, capture, and zone management
// ═══════════════════════════════════════════════════════════════

// Initialize zone spawning for the active zone
function beginZoneSpawning(b, zone) {
  const CELL_SIZE = b.cellSize || 64;

  // Generate spawn schedule
  zone.spawnSchedule = [];
  zone.spawnIndex = 0;
  zone.nextSpawnTime = 2000;  // Initial delay

  let time = 2000;
  const totalEnemies = zone.enemiesRemaining;

  for (let i = 0; i < totalEnemies; i++) {
    const spawnPoint = zone.spawnPoints[i % zone.spawnPoints.length];

    zone.spawnSchedule.push({
      time,
      x: (spawnPoint.col + 0.5) * CELL_SIZE,
      y: (zone.startRow + spawnPoint.row + 0.5) * CELL_SIZE,
      type: selectEnemyType(zone, i)
    });

    // Cluster spawns in groups of 3-5
    if ((i + 1) % 4 === 0) {
      time += 5000 + Math.random() * 3000;  // 5-8 second gap between groups
    } else {
      time += 500 + Math.random() * 1000;  // 0.5-1.5 second gap within group
    }
  }

  zone.spawnStartTime = Date.now();
}

// Select enemy type based on zone and progression
function selectEnemyType(zone, index) {
  // Later enemies in zone are stronger
  const progression = index / Math.max(1, zone.enemiesRemaining);

  // Basic distribution - adjust based on zone difficulty
  const types = ['infantry', 'infantry', 'jeep'];
  if (progression > 0.3) types.push('infantry', 'jeep');
  if (progression > 0.5) types.push('sherman');
  if (progression > 0.7) types.push('sherman', 'tiger');

  return types[Math.floor(Math.random() * types.length)];
}

// Update zone spawning - spawn enemies on schedule
function updateZoneSpawning(b, dt) {
  if (!b.scenario || !b.zones) return;

  const zone = b.zones[b.activeZoneIndex];
  if (!zone || !zone.spawnSchedule || zone.spawnIndex >= zone.spawnSchedule.length) return;

  const elapsed = Date.now() - zone.spawnStartTime;

  // Spawn enemies that are due
  while (zone.spawnIndex < zone.spawnSchedule.length) {
    const spawn = zone.spawnSchedule[zone.spawnIndex];
    if (elapsed < spawn.time) break;

    // Spawn the enemy
    spawnZoneEnemy(b, spawn, zone);
    zone.enemiesRemaining--;
    zone.spawnIndex++;
  }
}

// Spawn a single enemy for zone battle
function spawnZoneEnemy(b, spawn, zone) {
  const isArmored = spawn.type === 'sherman' || spawn.type === 'tiger';
  const baseHp = isArmored ? 60 : 30;
  const baseDamage = isArmored ? 10 : 5;
  const zoneUnitStats = UNIT_COMBAT_STATS[spawn.type];
  const baseSpeed = zoneUnitStats?.speed || (isArmored ? 50 : 70);

  // Scale based on zone (later zones = harder)
  const zoneScale = 1 + zone.id * 0.2;

  const enemy = createUnit(spawn.type, {
    id: `zone${zone.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    x: spawn.x,
    y: spawn.y,
    hp: Math.round((baseHp + zone.id * 10) * zoneScale),
    maxHp: Math.round((baseHp + zone.id * 10) * zoneScale),
    speed: baseSpeed * (0.9 + Math.random() * 0.2),
    damage: Math.round((baseDamage + zone.id * 2) * zoneScale),
    aiType: selectEnemyAIType(zone),
    angle: Math.PI / 2,
    hullAngle: Math.PI / 2,
    zoneId: zone.id
  });

  b.enemies.push(enemy);
  zone.enemiesActive++;
}

// Select AI type for enemy based on zone
function selectEnemyAIType(zone) {
  const types = ['BASIC', 'BASIC', 'BASIC'];
  if (zone.id >= 1) types.push('RUSHER');
  if (zone.id >= 2) types.push('HUNTER', 'CAUTIOUS');

  return types[Math.floor(Math.random() * types.length)];
}

// Update zone timers
function updateZoneTimers(b, dt) {
  if (!b.scenario || !b.zones) return;

  const zone = b.zones[b.activeZoneIndex];
  if (!zone || zone.timer === null) return;

  if (zone.timerStarted) {
    zone.timer -= dt;

    if (zone.timer <= 0) {
      // Timer expired
      if (b.scenario.type === ScenarioType.ADVANCING) {
        // Spawn reinforcements, reset timer (harder)
        zone.enemiesRemaining += 5;
        beginZoneSpawning(b, zone);
        zone.timer = 60000;  // Shorter timer next time
        b.commandFeedback = { text: 'Enemy reinforcements arriving!', time: Date.now() };
      } else {
        // Frontline: lose the zone
        loseZone(b, zone.id);
      }
    }
  }
}

// Check if active zone is captured
function checkZoneCapture(b) {
  if (!b.scenario || !b.zones) return;

  const zone = b.zones[b.activeZoneIndex];
  if (!zone || zone.owner === ZoneOwner.PLAYER) return;

  // Count live enemies in zone bounds
  const CELL_SIZE = b.cellSize || 64;
  const zoneStartY = zone.startRow * CELL_SIZE;
  const zoneEndY = (zone.endRow + 1) * CELL_SIZE;

  const enemiesInZone = b.enemies.filter(e =>
    e.y >= zoneStartY && e.y < zoneEndY && !e.dead
  );

  zone.enemiesActive = enemiesInZone.length;

  // Capture condition: no enemies left AND no more to spawn
  if (zone.enemiesActive === 0 && zone.enemiesRemaining === 0 &&
      (!zone.spawnSchedule || zone.spawnIndex >= zone.spawnSchedule.length)) {
    captureZone(b, zone.id);
  }
}

// Handle zone capture
function captureZone(b, zoneIndex) {
  const zone = b.zones[zoneIndex];
  zone.owner = ZoneOwner.PLAYER;
  zone.captureProgress = 0;

  // Award rewards
  if (zone.rewards) {
    Game.resources.scrap += zone.rewards.scrap || 0;
    Game.resources.parts += zone.rewards.parts || 0;
  }

  // Trigger celebration animation
  b.zoneTransition = {
    type: 'capture',
    zoneIndex,
    zoneName: zone.name,
    rewards: zone.rewards,
    progress: 0,
    duration: 2000
  };

  sound('victory');
  b.commandFeedback = { text: `Zone captured: ${zone.name}!`, time: Date.now() };

  // Advance to next zone if exists
  const nextZoneIndex = zoneIndex + 1;
  if (nextZoneIndex < b.zones.length) {
    b.activeZoneIndex = nextZoneIndex;
    const nextZone = b.zones[nextZoneIndex];

    // Start spawning and timer for next zone
    beginZoneSpawning(b, nextZone);
    nextZone.timerStarted = true;
  } else {
    // All zones captured - victory!
    checkZoneVictory(b);
  }
}

// Check zone loss (for frontline mode)
function checkZoneLoss(b) {
  if (!b.scenario || !b.scenario.allowZoneLoss) return;

  const CELL_SIZE = b.cellSize || 64;

  // Check player-owned zones for enemy presence
  for (const zone of b.zones) {
    if (zone.owner !== ZoneOwner.PLAYER) continue;

    const zoneStartY = zone.startRow * CELL_SIZE;
    const zoneEndY = (zone.endRow + 1) * CELL_SIZE;

    const enemiesInZone = b.enemies.filter(e =>
      e.y >= zoneStartY && e.y < zoneEndY && !e.dead
    ).length;

    const alliesInZone = b.units.filter(u =>
      u.y >= zoneStartY && u.y < zoneEndY && !u.dead
    ).length;

    // Hero counts as ally if in zone
    const heroInZone = b.hero.y >= zoneStartY && b.hero.y < zoneEndY;

    // Enemies holding zone with no resistance
    if (enemiesInZone >= 3 && alliesInZone === 0 && !heroInZone) {
      zone.captureProgress += 0.02;  // ~50 seconds to lose at 60fps

      if (zone.captureProgress >= 100) {
        loseZone(b, zone.id);
      }
    } else {
      zone.captureProgress = Math.max(0, zone.captureProgress - 0.01);
    }
  }
}

// Handle zone loss
function loseZone(b, zoneIndex) {
  const zone = b.zones[zoneIndex];
  zone.owner = ZoneOwner.ENEMY;
  zone.captureProgress = 0;

  // Trigger loss animation
  b.zoneTransition = {
    type: 'loss',
    zoneIndex,
    zoneName: zone.name,
    progress: 0,
    duration: 1500
  };

  sound('defeat');
  b.commandFeedback = { text: `Zone lost: ${zone.name}!`, time: Date.now() };

  // Check defeat condition
  if (zoneIndex === 0 && b.scenario.defeatCondition === 'lose_home_zone') {
    b.result = 'defeat';
    goto(State.CAMPAIGN_RESULT);
  }

  // Enemies will now spawn from this zone
  zone.enemiesRemaining = 8 + zoneIndex * 3;
  beginZoneSpawning(b, zone);
}

// Check victory conditions for zone battle
function checkZoneVictory(b) {
  if (!b.scenario) return;

  const allCaptured = b.zones.every(z => z.owner === ZoneOwner.PLAYER);

  if (allCaptured && b.scenario.victoryCondition === 'capture_all') {
    b.result = 'victory';
    saveReplay(b);
    goto(State.CAMPAIGN_RESULT);
  }
}

// Update zone transition animation
function updateZoneTransition(b, dt) {
  if (!b.zoneTransition) return;

  b.zoneTransition.progress += dt;

  if (b.zoneTransition.progress >= b.zoneTransition.duration) {
    b.zoneTransition = null;
  }
}

// Activate zone spawning when battle starts
function activateInitialZone(b) {
  if (!b.scenario || !b.zones) return;

  const zone = b.zones[b.activeZoneIndex];
  if (zone && zone.owner !== ZoneOwner.PLAYER) {
    beginZoneSpawning(b, zone);
    zone.timerStarted = true;
  }
}

// Draw zone-specific UI elements
function drawZoneUI(bf, b) {
  // Get or create zone UI container
  let zoneUI = bf.querySelector('.zone-ui');
  if (!zoneUI) {
    zoneUI = document.createElement('div');
    zoneUI.className = 'zone-ui';
    zoneUI.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      width: 40px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      z-index: 100;
    `;
    bf.appendChild(zoneUI);
  }

  // Draw zone progress bar
  drawZoneProgressBar(zoneUI, b);

  // Draw zone timer
  drawZoneTimer(bf, b);

  // Draw zone boundaries on the map
  drawZoneBoundaries(bf, b);

  // Draw zone transition overlay
  if (b.zoneTransition) {
    drawZoneTransitionOverlay(bf, b);
  }
}

// Draw vertical zone progress bar
function drawZoneProgressBar(container, b) {
  let progressBar = container.querySelector('.zone-progress-bar');

  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.className = 'zone-progress-bar';
    progressBar.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      border: 2px solid #555;
      border-radius: 5px;
      padding: 5px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    `;
    container.appendChild(progressBar);
  }

  // Clear and rebuild
  progressBar.innerHTML = '';

  // Draw zones from top (enemy) to bottom (player)
  for (let i = b.zones.length - 1; i >= 0; i--) {
    const zone = b.zones[i];
    const isActive = i === b.activeZoneIndex;

    const segment = document.createElement('div');
    segment.style.cssText = `
      width: 25px;
      height: 20px;
      border-radius: 3px;
      border: ${isActive ? '2px solid #fff' : '1px solid #333'};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      color: #fff;
      position: relative;
    `;

    // Color based on ownership
    if (zone.owner === ZoneOwner.PLAYER) {
      segment.style.background = '#3a7a3a';
    } else if (zone.owner === ZoneOwner.ENEMY) {
      segment.style.background = '#7a3a3a';
    } else {
      segment.style.background = '#7a7a3a';
    }

    // Show capture progress for contested zones
    if (zone.captureProgress > 0 && zone.captureProgress < 100) {
      const progress = document.createElement('div');
      progress.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: ${zone.captureProgress}%;
        background: rgba(255, 255, 0, 0.5);
        border-radius: 0 0 2px 2px;
      `;
      segment.appendChild(progress);
    }

    segment.textContent = i + 1;
    segment.title = zone.name;
    progressBar.appendChild(segment);
  }

  // Hero position indicator
  const heroZoneProgress = 1 - (b.hero.y / b.mapHeight);
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: absolute;
    left: -8px;
    top: ${(1 - heroZoneProgress) * 100}%;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid #4a9eff;
  `;
  progressBar.style.position = 'relative';
  progressBar.appendChild(indicator);
}

// Draw zone timer in top center
function drawZoneTimer(bf, b) {
  const zone = b.zones[b.activeZoneIndex];
  if (!zone || zone.timer === null) return;

  let timerEl = bf.querySelector('.zone-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.className = 'zone-timer';
    timerEl.style.cssText = `
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      padding: 8px 15px;
      border-radius: 5px;
      text-align: center;
      z-index: 100;
    `;
    bf.appendChild(timerEl);
  }

  const seconds = Math.ceil(zone.timer / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  // Color based on urgency
  let color = '#fff';
  if (zone.timer < 30000) color = '#f44';
  else if (zone.timer < 60000) color = '#fa4';

  timerEl.innerHTML = `
    <div style="font-size: 12px; color: #aaa;">${zone.name}</div>
    <div style="font-size: 20px; font-weight: bold; color: ${color};">
      ${minutes}:${secs.toString().padStart(2, '0')}
    </div>
    <div style="font-size: 11px; color: #aaa;">
      ${zone.enemiesActive} enemies remaining
    </div>
  `;
}

// Draw zone boundary lines on the map
function drawZoneBoundaries(bf, b) {
  // Remove old boundaries
  bf.querySelectorAll('.zone-boundary').forEach(el => el.remove());

  const CELL_SIZE = b.cellSize || 64;

  for (const zone of b.zones) {
    const boundaryY = zone.startRow * CELL_SIZE - b.camera.y;

    // Only draw if boundary is on screen
    if (boundaryY < -20 || boundaryY > bf.offsetHeight + 20) continue;

    const line = document.createElement('div');
    line.className = 'zone-boundary campaign-entity';
    line.style.cssText = `
      position: absolute;
      left: 0;
      top: ${boundaryY}px;
      width: 100%;
      height: 3px;
      background: ${zone.owner === ZoneOwner.PLAYER ? 'rgba(74, 180, 74, 0.6)' :
                    zone.owner === ZoneOwner.ENEMY ? 'rgba(180, 74, 74, 0.6)' :
                    'rgba(180, 180, 74, 0.6)'};
      pointer-events: none;
      z-index: 50;
    `;

    // Zone name label
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      left: 10px;
      top: -18px;
      font-size: 11px;
      color: #fff;
      background: rgba(0, 0, 0, 0.6);
      padding: 2px 6px;
      border-radius: 3px;
    `;
    label.textContent = zone.name;
    line.appendChild(label);

    bf.appendChild(line);
  }
}

// Draw zone capture/loss celebration overlay
function drawZoneTransitionOverlay(bf, b) {
  const transition = b.zoneTransition;

  let overlay = bf.querySelector('.zone-transition-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'zone-transition-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 200;
    `;
    bf.appendChild(overlay);
  }

  const progress = transition.progress / transition.duration;
  const opacity = Math.max(0, 1 - progress);

  if (transition.type === 'capture') {
    overlay.style.background = `rgba(0, 100, 0, ${0.4 * opacity})`;
    overlay.innerHTML = `
      <div style="font-size: 32px; font-weight: bold; color: #fff; text-shadow: 2px 2px 4px #000;">
        ZONE CAPTURED
      </div>
      <div style="font-size: 24px; color: #4f4; margin-top: 10px;">
        ${transition.zoneName}
      </div>
      <div style="font-size: 18px; color: #fc0; margin-top: 15px;">
        +${transition.rewards?.scrap || 0} Scrap
      </div>
    `;
  } else if (transition.type === 'loss') {
    overlay.style.background = `rgba(100, 0, 0, ${0.4 * opacity})`;
    overlay.innerHTML = `
      <div style="font-size: 32px; font-weight: bold; color: #fff; text-shadow: 2px 2px 4px #000;">
        ZONE LOST
      </div>
      <div style="font-size: 24px; color: #f44; margin-top: 10px;">
        ${transition.zoneName}
      </div>
    `;
  }

  // Remove overlay when transition is complete
  if (progress >= 1) {
    overlay.remove();
  }
}

function updateCampaignBattle(dt) {
  const b = Game.campaign.heroBattle;
  if (!b || b.result) return;

  const dtSec = dt / 1000;
  const now = Date.now();

  // Update timer
  b.timer -= dtSec;
  if (b.timer <= 0 && b.objective === 'survive') {
    b.result = 'victory';
    saveReplay(b);
    goto(State.CAMPAIGN_RESULT);
    return;
  }

  // --- HERO MOVEMENT (Tank Controls) ---
  const hero = b.hero;

  // Get vehicle stats (use defaults if not specified on entity)
  const hullTurnRate = hero.hullTurnRate || VEHICLE_TURN_RATES.tank.hull;
  const turretTurnRate = hero.turretTurnRate || VEHICLE_TURN_RATES.tank.turret;

  // Parse input from keyboard/joystick (pass hull angle for drive-toward logic)
  const { moveInput, turnInput, targetHullAngle } = parseTankInput(b.keys, b.joystickInput, hero.hullAngle);

  // Apply tank movement (updates hullAngle, returns movement vector)
  const { dx, dy, isMoving } = applyTankMovement(hero, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec);

  // Get terrain speed modifier
  const speedMod = getTerrainSpeedMod(b, hero.x, hero.y);

  // Acceleration/deceleration — per-unit power-to-weight ratio
  const cTargetSpeed = isMoving ? hero.speed * speedMod : 0;
  if (hero._currentSpeed == null) hero._currentSpeed = 0;
  const cHeroCS = UNIT_COMBAT_STATS[hero.unitId];
  const cHeroRate = cTargetSpeed >= hero._currentSpeed ? (cHeroCS?.accel ?? 2.5) : (cHeroCS?.decel ?? 4.0);
  const cHeroBlend = 1 - Math.exp(-cHeroRate * dtSec);
  hero._currentSpeed += (cTargetSpeed - hero._currentSpeed) * cHeroBlend;

  // Calculate new position using ramped speed
  const newX = hero.x + dx * hero._currentSpeed * dtSec;
  const newY = hero.y + dy * hero._currentSpeed * dtSec;

  // Check terrain collision only (no unit collision for now)
  if (!isTerrainBlocked(b, newX, hero.y)) {
    hero.x = newX;
  }
  if (!isTerrainBlocked(b, hero.x, newY)) {
    hero.y = newY;
  }

  // Clamp to map bounds
  hero.x = Math.max(30, Math.min(b.mapWidth - 30, hero.x));
  hero.y = Math.max(30, Math.min(b.mapHeight - 30, hero.y));

  // Stability — must run AFTER movement so position delta is accurate
  updateHeroStability(b, hero, dtSec);

  // --- HERO ANIMATION ---
  if (useCanvasRendering && hero.animId) {
    // Update movement animation trigger
    if (isMoving !== hero.isMoving) {
      hero.isMoving = isMoving;
      sprites.setUnitAnimTrigger(hero.animId, isMoving ? 'move' : 'idle');
    }
    hero.lastX = hero.x;
    hero.lastY = hero.y;
  }

  // --- AIMING ---
  // Calculate target aim angle (where we want turret to point)
  let targetAimAngle;
  if (b.aimAngle !== null && b.aimAngle !== undefined) {
    targetAimAngle = b.aimAngle;  // Direct angle from aim joystick
  } else {
    targetAimAngle = calculateAimAngle(hero, b.mouse, b.camera);  // Mouse aim
  }

  // --- HERO AUTO-ATTACK TARGET ---
  let autoAttacking = false;
  if (hero.autoAttackTarget) {
    const target = b.enemies.find(e => e.id === hero.autoAttackTarget && !e.dead);
    if (target) {
      targetAimAngle = Math.atan2(target.y - hero.y, target.x - hero.x);
      autoAttacking = true;

      // Check if target is in range (400px)
      const tdx = target.x - hero.x;
      const tdy = target.y - hero.y;
      if (Math.sqrt(tdx * tdx + tdy * tdy) > 400) {
        hero.autoAttackTarget = null;
        autoAttacking = false;
      }
    } else {
      hero.autoAttackTarget = null;
    }
  }

  // Apply turret aiming (smooth rotation toward target)
  applyTurretAim(hero, targetAimAngle, turretTurnRate, dtSec);

  // Update turret aim angle for animation (relative to hull)
  if (useCanvasRendering && hero.animId) {
    const relativeAim = hero.angle - hero.hullAngle;
    sprites.setUnitAimAngle(hero.animId, relativeAim * 180 / Math.PI);
  }

  // --- HERO SHOOTING ---
  // Check if turret is aligned with target (within ~10 degrees)
  let aimDiff = hero.angle - targetAimAngle;
  while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
  while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
  const turretAligned = Math.abs(aimDiff) < 0.17; // ~10 degrees

  // Fire if: (manual shooting OR auto-attacking) AND turret is aligned with target
  if ((b.mouse.down || autoAttacking) && turretAligned) {
    const autoTarget = hero.autoAttackTarget ? b.enemies.find(e => e.id === hero.autoAttackTarget && !e.dead) : null;
    heroFire(b, hero, now, autoTarget);
  }

  // --- UPDATE CAMERA WITH LOOK-AHEAD ---
  const screenW = 800;  // Will be updated from actual element
  const screenH = 600;

  // Calculate look-ahead offset based on movement and aim
  const lookAheadDist = 80; // How far ahead to look
  let lookX = 0, lookY = 0;

  // Movement-based look-ahead (primary)
  if (dx !== 0 || dy !== 0) {
    lookX = dx * lookAheadDist;
    lookY = dy * lookAheadDist;
  }
  // Aim-based look-ahead when shooting (secondary, adds to movement)
  else if (b.mouse.down) {
    lookX = Math.cos(hero.angle) * lookAheadDist * 0.5;
    lookY = Math.sin(hero.angle) * lookAheadDist * 0.5;
  }

  // Smoothly interpolate camera look-ahead
  if (!b.camera.lookX) b.camera.lookX = 0;
  if (!b.camera.lookY) b.camera.lookY = 0;
  const lookSmooth = 0.08; // Lower = smoother/slower
  b.camera.lookX += (lookX - b.camera.lookX) * lookSmooth;
  b.camera.lookY += (lookY - b.camera.lookY) * lookSmooth;

  // Position camera with hero in lower 1/4 of screen (see more ahead)
  const targetX = hero.x + b.camera.lookX - screenW / 2;
  const targetY = hero.y + b.camera.lookY - screenH * 0.75;
  b.camera.x = Math.max(0, Math.min(b.mapWidth - screenW, targetX));
  b.camera.y = Math.max(0, Math.min(b.mapHeight - screenH, targetY));

  // --- SPAWN ENEMIES ---
  if (b.scenario) {
    // Zone-based spawning
    updateZoneSpawning(b, dt);
    updateZoneTimers(b, dt);
    checkZoneCapture(b);
    checkZoneLoss(b);
    updateZoneTransition(b, dt);
  } else {
    // Simple wave spawning for non-zone battles
    if (b.enemies.length === 0 && b.enemiesRemaining === 0) {
      spawnCampaignWave(b);
    }
  }

  // --- PERFORMANCE MONITORING ---
  if (!b._perf) b._perf = { ai: 0, proj: 0, frame: 0, samples: 0, lastLog: 0 };
  const _perfFrameStartCmp = performance.now();

  // --- UNIFIED AI PIPELINE ---
  const _perfAiStartCmp = performance.now();
  runBattleAI(b, now, dtSec);
  b._perf.ai += performance.now() - _perfAiStartCmp;

  // --- RECORD REPLAY FRAME ---
  if (b._recorder) recordFrame(b, now);

  // --- CHECK HERO DEFEAT ---
  if (hero.hp <= 0) {
    hero.hp = 0;
    b.result = 'defeat';
    saveReplay(b);
    goto(State.CAMPAIGN_RESULT);
  }

  // --- UPDATE PROJECTILES ---
  const _perfProjStartCmp = performance.now();
  resolveProjectiles(b, now, dtSec, {
    heroRef: hero,
    heroHitRadiusSq: (ENTITY_RADIUS.projectile + ENTITY_RADIUS.enemy) ** 2,
    useStanceModifiers: true,
    onEnemyKill(e) {
      b.enemiesRemaining--;
      sound('explosion');
    }
  });
  b._perf.proj += performance.now() - _perfProjStartCmp;
  b._perf.frame += performance.now() - _perfFrameStartCmp;
  b._perf.samples++;
  _logPerfSnapshot(b, now);

  // Clear concentrate target if enemy is dead
  if (b.squad?.concentrateTarget) {
    const target = b.enemies.find(e => e.id === b.squad.concentrateTarget);
    if (!target || target.dead) {
      b.squad.concentrateTarget = null;
      b.commandFeedback = { text: 'Target eliminated!', time: Date.now() };
    }
  }

  // Remove dead enemies
  b.enemies = b.enemies.filter(e => !e.dead);
}

function spawnCampaignWave(b) {
  const count = 5 + b.wave * 2;
  b.enemiesRemaining = count;

  // AI type distribution changes with wave number
  const aiTypes = ['BASIC', 'BASIC', 'BASIC'];
  if (b.wave >= 2) aiTypes.push('RUSHER');
  if (b.wave >= 3) aiTypes.push('HUNTER', 'CAUTIOUS');
  if (b.wave >= 4) aiTypes.push('FLANKER');

  // Enemy unit types distribution (for armor class)
  // Early: infantry/jeep (soft), later: sherman/tiger (armored)
  const unitTypes = ['infantry', 'infantry', 'jeep'];
  if (b.wave >= 2) unitTypes.push('infantry', 'jeep');
  if (b.wave >= 3) unitTypes.push('sherman');
  if (b.wave >= 4) unitTypes.push('sherman', 'tiger');
  if (b.wave >= 5) unitTypes.push('tiger');

  // Enemy spawn zone is the top 4 rows (enemy territory)
  const enemyZoneHeight = 4 * b.cellSize;

  for (let i = 0; i < count; i++) {
    // Spawn from enemy zone (top of map only)
    const x = 50 + Math.random() * (b.mapWidth - 100);
    const y = 30 + Math.random() * (enemyZoneHeight - 60);

    // Randomly select AI type and unit type from available pools
    const aiTypeKey = aiTypes[Math.floor(Math.random() * aiTypes.length)];
    const unitId = unitTypes[Math.floor(Math.random() * unitTypes.length)];

    // Scale HP and damage based on unit type
    const isArmored = unitId === 'sherman' || unitId === 'tiger';
    const baseHp = isArmored ? 60 : 30;
    const baseDamage = isArmored ? 10 : 5;
    const campUnitStats = UNIT_COMBAT_STATS[unitId];
    const baseSpeed = campUnitStats?.speed || (isArmored ? 50 : 70);

    const enemy = createUnit(unitId, {
      id: `wave${b.wave}_${i}`,
      x,
      y,
      hp: baseHp + b.wave * 10,
      maxHp: baseHp + b.wave * 10,
      speed: baseSpeed * (0.9 + Math.random() * 0.2),
      damage: baseDamage + b.wave * 2,
      aiType: EnemyAIType[aiTypeKey],
      angle: Math.PI / 2,
      hullAngle: Math.PI / 2
    });

    b.enemies.push(enemy);
  }

  b.wave++;

  // Create a new squad for this wave's enemies
  const waveEnemies = b.enemies.slice(-count);
  const spawnZone = { x: b.mapWidth / 2, y: 2 * b.cellSize, radius: b.mapWidth / 3 };
  spawnSquad(b, 'red', waveEnemies, spawnZone, {
    preset: scaleBrainByWave(BRAIN_PRESETS.campaignEnemy, b.wave)
  });
}

function drawCampaignBattle() {
  const bf = document.querySelector('.campaign-battlefield');
  if (!bf) return;

  const b = Game.campaign.heroBattle;
  if (!b) return;

  // Use shared drawing function
  drawHeroBattle(bf, b);

  // Kill feed overlay
  updateKillFeed(b);

  // Campaign-specific HUD updates
  const hpBar = document.querySelector('.campaign-hp-fill');
  if (hpBar) {
    hpBar.style.width = `${(b.hero.hp / b.hero.maxHp) * 100}%`;
  }

  const hpText = document.querySelector('.campaign-hp-text');
  if (hpText) {
    hpText.textContent = `${Math.ceil(b.hero.hp)} / ${b.hero.maxHp}`;
  }

  const timerEl = document.querySelector('.campaign-timer');
  if (timerEl) {
    timerEl.textContent = `${Math.ceil(b.timer)}s`;
  }

  const killsEl = document.querySelector('.campaign-kills');
  if (killsEl) {
    killsEl.textContent = `Kills: ${b.kills}`;
  }

  // Draw zone-specific UI if this is a zone battle
  if (b.scenario && b.zones) {
    drawZoneUI(bf, b);
  }

  // Draw command feedback (squad commands)
  drawCommandUI(bf, b);
}

// Shared hero battle rendering - used by campaign and endless modes
function drawHeroBattle(bf, b) {
  if (!bf || !b) return;

  const screenW = bf.offsetWidth;
  const screenH = bf.offsetHeight;

  // Shared camera update (fire range auto-follow vs CMD free-pan vs hero-center)
  let zoom;
  if (b.fireRange) {
    zoom = updateFireRangeCamera(b, screenW, screenH);
  } else if (b.playMode === 'cmd') {
    zoom = updateCMDCamera(b, screenW, screenH);
  } else {
    zoom = updateHeroCamera(b, screenW, screenH);
  }

  // ── Canvas rendering path (BattleRenderer) ──
  if (USE_CANVAS_BATTLE && b.battleRenderer) {
    b.battleRenderer.setCamera(b.camera.x, b.camera.y, zoom);

    // Post-render hook: edge fade + CMD overlay
    const sw = screenW, sh = screenH;
    b.battleRenderer._postRenderHook = (ctx, battle) => {
      _drawMapEdgeFade(ctx, battle);
      if (battle.playMode === 'cmd') {
        drawCMDOverlay(ctx, battle, sw, sh);
      }
    };

    b.battleRenderer.render(b);
    drawMinimap(b);
    return;
  }

  // ── Legacy DOM rendering path ──
  const cellSize = b.cellSize;

  // Clear previous entities (but keep terrain if already drawn)
  bf.querySelectorAll('.battle-entity').forEach(el => el.remove());

  // Setup canvas for animated sprites if needed
  let canvas = bf.querySelector('.battle-canvas');
  let ctx = null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'battle-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    canvas.width = screenW;
    canvas.height = screenH;
    bf.appendChild(canvas);
  }
  ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, screenW, screenH);
  }

  // Draw base terrain layer (ground - below units)
  let terrainCanvas = bf.querySelector('.terrain-canvas');
  if (!terrainCanvas) {
    // Pre-render base terrain to canvas once
    const renderedTerrain = renderBaseTerrainToCanvas(b.terrain, cellSize);
    renderedTerrain.className = 'terrain-canvas';
    renderedTerrain.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1;';
    bf.appendChild(renderedTerrain);
    terrainCanvas = renderedTerrain;
  }

  // Update terrain position based on camera
  if (terrainCanvas) {
    terrainCanvas.style.transform = `translate(${-b.camera.x}px, ${-b.camera.y}px)`;
  }

  // Draw player units (if any - endless mode has none)
  if (b.units) {
    b.units.forEach(unit => {
      const el = document.createElement('div');
      const isSelected = b.squad?.selectedUnitId === unit.id;
      el.className = `battle-entity battle-unit ${isSelected ? 'selected' : ''}`;
      el.style.position = 'absolute';
      el.style.left = `${unit.x - b.camera.x - 20}px`;
      el.style.top = `${unit.y - b.camera.y - 20}px`;
      el.style.width = '40px';
      el.style.height = '40px';
      el.style.transform = `rotate(${unit.angle + Math.PI / 2}rad)`;
      el.style.backgroundColor = isSelected ? '#7ab87a' : '#5a8a5a';
      el.style.borderRadius = '5px';
      el.style.border = isSelected ? '3px solid #4a9eff' : '2px solid #3a6a3a';
      if (isSelected) {
        el.style.boxShadow = '0 0 15px #4a9eff, 0 0 25px rgba(74, 158, 255, 0.5)';
        el.style.animation = 'pulse-selected 1s ease-in-out infinite';
      }
      el.dataset.unitId = unit.unitId;
      bf.appendChild(el);
    });
  }

  // Draw hero
  const hero = b.hero;
  const heroHasAnim = useCanvasRendering && hero.animId && sprites.hasAnimatedUnit(hero.animId);

  if (heroHasAnim && ctx) {
    // Render animated sprite on canvas
    const screenX = hero.x - b.camera.x;
    const screenY = hero.y - b.camera.y;
    const hullRotation = (hero.hullAngle * 180 / Math.PI) + 90;
    const scale = 0.5;
    sprites.renderAnimatedUnit(ctx, hero.animId, screenX, screenY, hullRotation, scale);
  } else {
    // Fallback to DOM rendering
    const heroEl = document.createElement('div');
    heroEl.className = 'battle-entity battle-hero';
    heroEl.style.position = 'absolute';
    heroEl.style.left = `${hero.x - b.camera.x - 20}px`;
    heroEl.style.top = `${hero.y - b.camera.y - 20}px`;
    heroEl.style.width = '40px';
    heroEl.style.height = '40px';
    heroEl.style.transform = `rotate(${hero.hullAngle + Math.PI / 2}rad)`;
    heroEl.style.backgroundColor = '#4a9eff';
    heroEl.style.borderRadius = '5px';
    heroEl.style.border = '2px solid #fff';
    bf.appendChild(heroEl);
  }

  // Draw enemies
  b.enemies.forEach(e => {
    if (e.dead) return;

    const el = document.createElement('div');
    el.className = 'battle-entity battle-enemy';
    el.style.position = 'absolute';
    el.style.left = `${e.x - b.camera.x - 15}px`;
    el.style.top = `${e.y - b.camera.y - 15}px`;
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.backgroundColor = '#ff4444';
    el.style.borderRadius = '50%';

    const isConcentrateTarget = b.squad?.concentrateTarget === e.id;
    if (isConcentrateTarget) {
      el.style.border = '3px solid #ffff00';
      el.style.boxShadow = '0 0 15px #ffff00, 0 0 30px rgba(255, 255, 0, 0.5)';
      el.style.animation = 'pulse-target 0.8s ease-in-out infinite';
    } else {
      el.style.border = '2px solid #aa0000';
    }

    bf.appendChild(el);
  });

  // Draw targeting mode indicator (campaign only)
  if (b.commandMode === 'selectTarget') {
    const indicator = document.createElement('div');
    indicator.className = 'battle-entity targeting-indicator';
    indicator.style.position = 'fixed';
    indicator.style.top = '50%';
    indicator.style.left = '50%';
    indicator.style.transform = 'translate(-50%, -50%)';
    indicator.style.padding = '10px 20px';
    indicator.style.background = 'rgba(255, 100, 100, 0.9)';
    indicator.style.color = '#fff';
    indicator.style.borderRadius = '8px';
    indicator.style.fontWeight = 'bold';
    indicator.style.zIndex = '500';
    indicator.style.border = '2px solid #ff4444';
    indicator.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.5)';
    indicator.textContent = '🎯 TAP AN ENEMY TO TARGET';
    bf.appendChild(indicator);
  }

  // Draw projectiles
  b.projectiles.forEach(p => {
    const el = document.createElement('div');
    el.className = 'battle-entity battle-projectile';
    el.style.position = 'absolute';
    el.style.left = `${p.x - b.camera.x - 4}px`;
    el.style.top = `${p.y - b.camera.y - 4}px`;
    el.style.width = '8px';
    el.style.height = '8px';
    el.style.backgroundColor = p.owner === Owner.PLAYER ? '#ffcc00' : '#ff6666';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 10px #ffcc00';
    bf.appendChild(el);
  });

  // Draw canopy layer (forest/brush - above units)
  let canopyCanvas = bf.querySelector('.canopy-canvas');
  if (!canopyCanvas) {
    // Pre-render canopy to canvas once
    const renderedCanopy = renderCanopyToCanvas(b.terrain, cellSize);
    renderedCanopy.className = 'canopy-canvas';
    renderedCanopy.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:100;';
    bf.appendChild(renderedCanopy);
    canopyCanvas = renderedCanopy;
  }

  // Update canopy position based on camera
  if (canopyCanvas) {
    canopyCanvas.style.transform = `translate(${-b.camera.x}px, ${-b.camera.y}px)`;
  }

  // Draw minimap (shared across modes)
  drawMinimap(b);
}

// Draw minimap showing terrain, units, and enemies
// drawMinimap — imported from minimap.js

// Campaign input handlers (called from main.js)
export function campaignKeyDown(key) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  // Movement + camera keys
  cameraKeyDown(b, key);

  // Tactical command keys (1-5)
  for (const [cmdKey, cmd] of Object.entries(TacticalCommand)) {
    if (key === cmd.key) {
      if (cmd.needsTarget) {
        // Enter move target mode
        b.pendingCommand = cmdKey;
        b.commandFeedback = { text: `Click to set ${cmd.label} target`, time: Date.now() };
      } else {
        // Issue command immediately to all units
        issueCommand(b.units, cmdKey.toLowerCase());
        b.commandFeedback = { text: `${cmd.icon} ${cmd.label}!`, time: Date.now() };
      }
      break;
    }
  }

  // Quick behavior changes (hold shift + number for behavior presets)
  if (key === 'q') {
    // Toggle aggressive mode
    b.units.forEach(u => setUnitBehavior(u, 'AGGRESSIVE'));
    b.commandFeedback = { text: '🔥 Aggressive Mode', time: Date.now() };
  }
  if (key === 'e') {
    // Toggle defensive mode
    b.units.forEach(u => setUnitBehavior(u, 'DEFENSIVE'));
    b.commandFeedback = { text: '🛡️ Defensive Mode', time: Date.now() };
  }

  // Front Line Commands (Z, X, C keys)
  if (key === 'z' || key === 'Z') {
    issueFrontLineCommand(b.units, 'advance');
    b.frontLineState = 'advance';
    b.commandFeedback = { text: '⚔️ ADVANCE!', time: Date.now() };
  }
  if (key === 'x' || key === 'X') {
    issueFrontLineCommand(b.units, 'hold');
    b.frontLineState = 'hold';
    b.commandFeedback = { text: '🛡️ FALL BACK!', time: Date.now() };
  }
  if (key === 'c' || key === 'C') {
    issueFrontLineCommand(b.units, 'retreat');
    b.frontLineState = 'retreat';
    b.commandFeedback = { text: '🏃 RETREAT!', time: Date.now() };
  }
}

export function campaignKeyUp(key) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;
  cameraKeyUp(b, key);
}

export function campaignMouseMove(x, y) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.mouse.x = x;
  b.mouse.y = y;
}

export function campaignMouseDown() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  const z = b.camera.zoom || 1;

  // Handle pending move command
  if (b.pendingCommand === 'MOVE') {
    const worldX = b.mouse.x / z + b.camera.x;
    const worldY = b.mouse.y / z + b.camera.y;

    // Issue move command to all units with target position
    issueCommand(b.units, 'move', { x: worldX, y: worldY });
    b.commandFeedback = { text: '🎯 Moving to target!', time: Date.now() };
    b.pendingCommand = null;
    return; // Don't fire weapon when issuing move command
  }

  // Handle concentrate fire targeting mode
  if (b.commandMode === 'selectTarget' && b.commandAction === 'concentrate') {
    const worldX = b.mouse.x / z + b.camera.x;
    const worldY = b.mouse.y / z + b.camera.y;

    // Find enemy at click position (check within 40px radius for easier targeting)
    const targetEnemy = findEnemyAtPosition(b, worldX, worldY, 40);

    if (targetEnemy) {
      // Set as concentrate target
      b.squad.concentrateTarget = targetEnemy.id;
      b.commandFeedback = { text: '🎯 FOCUS FIRE!', time: Date.now() };

      // Add to spotted enemies if not already there
      if (!b.spottedEnemies.find(se => se.enemyId === targetEnemy.id)) {
        b.spottedEnemies.push({
          enemyId: targetEnemy.id,
          lastSeenX: targetEnemy.x,
          lastSeenY: targetEnemy.y,
          lastSeenTime: Date.now(),
          isVisible: true
        });
      }
    } else {
      // No enemy found, cancel targeting
      b.commandFeedback = { text: 'No target found', time: Date.now() };
    }

    // Exit targeting mode
    b.commandMode = null;
    b.commandAction = null;

    // Need to re-render UI to update button state
    import('./ui.js').then(ui => ui.render());
    return;
  }

  b.mouse.down = true;
}

// Helper: Find enemy at given world position
function findEnemyAtPosition(battle, x, y, radius = 30) {
  if (!battle || !battle.enemies) return null;

  for (const enemy of battle.enemies) {
    if (enemy.hp <= 0) continue; // Skip dead enemies

    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Use enemy's size or default radius for hit detection
    const hitRadius = enemy.size || radius;
    if (dist <= hitRadius) {
      return enemy;
    }
  }
  return null;
}

export function campaignMouseUp() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.mouse.down = false;
}

// Set aim angle directly (for mobile joystick)
export function campaignSetAimAngle(angle) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.aimAngle = angle;
}

// Clear aim angle (revert to mouse-based aiming)
export function campaignClearAimAngle() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.aimAngle = null;
}

// Set analog joystick input for smooth movement
export function campaignSetJoystick(dx, dy) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  // Initialize joystickInput if needed
  if (!b.joystickInput) {
    b.joystickInput = { dx: 0, dy: 0 };
  }

  // Normalize if magnitude > 1
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > 1) {
    dx /= mag;
    dy /= mag;
  }

  b.joystickInput.dx = dx;
  b.joystickInput.dy = dy;
}

// Clear joystick input
export function campaignClearJoystick() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  if (b.joystickInput) {
    b.joystickInput.dx = 0;
    b.joystickInput.dy = 0;
  }
}
