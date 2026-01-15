// ═══════════════════════════════════════════════════════════════
// GAME - Battle logic, game loop, update, draw
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UNITS, ENEMIES, getTypeMultiplier, UNIT_COSTS, H2H_BUDGET, PROJECTILES, UNIT_PROJECTILES, UNIT_COMBAT_STATS, getTerrainSVG, getStanceModifier, getEnemyStance, ZoneOwner, ScenarioType, SHADOW_CONFIG } from './constants.js';
import { Game, newBattle, newH2H, newCampaign, newCampaignBattle } from './state.js';
import { sound } from './audio.js';
import { save } from './storage.js';
import { render, setSubState, getCustomizedSvg, getCustomizedSvgFrames, getEntitySvg, getEntitySvgFrames, drawCommandUI, getUnitVisual, getUnitShadow } from './ui.js';
import * as sprites from './sprites.js';
import {
  isBlocked,
  findTargetsInRange,
  getClosestTarget,
  createProjectile,
  updateProjectiles
} from './combat.js';
import {
  isTerrainBlocked,
  getTerrainSpeedMod,
  updateUnitAI,
  updateEnemyAI,
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
  ENTITY_RADIUS,
  issueFrontLineCommand,
  assignSmartPositions
} from './ai.js';

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
const VEHICLE_TURN_RATES = {
  tank: {
    hull: Math.PI * 0.8,    // ~144 deg/sec - tanks turn slowly
    turret: Math.PI * 1.5   // ~270 deg/sec - turrets turn faster
  },
  light: {
    hull: Math.PI * 1.2,    // ~216 deg/sec - light vehicles turn faster
    turret: Math.PI * 2.0   // ~360 deg/sec
  }
};

/**
 * Normalize angle to -PI to PI range
 * @param {number} angle - Angle in radians
 * @returns {number} Normalized angle
 */
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Smoothly rotate an angle toward a target angle at a max speed
 * Handles angle wrapping correctly (takes shortest path)
 * @param {number} current - Current angle in radians
 * @param {number} target - Target angle in radians
 * @param {number} maxDelta - Maximum rotation this frame in radians
 * @returns {number} New angle in radians
 */
function smoothRotateToward(current, target, maxDelta) {
  current = normalizeAngle(current);
  target = normalizeAngle(target);

  // Calculate shortest rotation direction
  let diff = target - current;
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;

  // Clamp rotation to max speed
  if (Math.abs(diff) <= maxDelta) {
    return target; // Close enough, snap to target
  }

  // Rotate toward target at max speed
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

// Default joystick control settings
const JOYSTICK_DEFAULTS = {
  deadzone: 0.25,        // 0-25% = rotate only
  reverseCone: 22        // degrees from rear that triggers reverse
};

/**
 * Get joystick control settings (from Game.settings or defaults)
 */
function getJoystickSettings() {
  const settings = Game.settings?.controls || {};
  return {
    deadzone: settings.joystickDeadzone ?? JOYSTICK_DEFAULTS.deadzone,
    reverseCone: (settings.joystickReverseCone ?? JOYSTICK_DEFAULTS.reverseCone) * Math.PI / 180
  };
}

/**
 * Parse input into tank control values
 * @param {object} keys - Keyboard state { w, a, s, d }
 * @param {object} joystickInput - Optional joystick { dx, dy }
 * @param {number} currentHullAngle - Current hull angle in radians (for joystick drive-toward)
 * @returns {object} { moveInput, turnInput, targetHullAngle } moveInput/turnInput -1 to 1, targetHullAngle in radians or null
 */
function parseTankInput(keys, joystickInput, currentHullAngle = 0) {
  let moveInput = 0;  // -1 = backward, 0 = none, 1 = forward
  let turnInput = 0;  // -1 = left, 0 = none, 1 = right
  let targetHullAngle = null;  // For joystick drive-toward mode

  // Check for analog joystick input first (drive-toward mode)
  if (joystickInput && (joystickInput.dx !== 0 || joystickInput.dy !== 0)) {
    const magnitude = Math.sqrt(joystickInput.dx * joystickInput.dx + joystickInput.dy * joystickInput.dy);
    const { deadzone, reverseCone } = getJoystickSettings();

    // Calculate target angle from joystick (screen coords: up = -Y)
    targetHullAngle = Math.atan2(joystickInput.dy, joystickInput.dx);

    // Calculate angle difference to determine if we should reverse
    let angleDiff = targetHullAngle - currentHullAngle;
    // Normalize to -PI to PI
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Check if target is within reverse cone (close to directly behind)
    const isReverseZone = Math.abs(angleDiff) > Math.PI - reverseCone;

    if (isReverseZone) {
      // Reverse: flip target angle so we turn the rear toward target
      targetHullAngle = normalizeAngle(targetHullAngle + Math.PI);
      // Move backward if past deadzone
      if (magnitude > deadzone) {
        moveInput = -((magnitude - deadzone) / (1 - deadzone));  // -1 to 0 scaled
      }
    } else {
      // Forward: move toward target if past deadzone
      if (magnitude > deadzone) {
        moveInput = (magnitude - deadzone) / (1 - deadzone);  // 0 to 1 scaled
      }
    }
  } else if (keys) {
    // WASD tank controls (unchanged)
    if (keys.w) moveInput = 1;   // Forward
    if (keys.s) moveInput = -1;  // Backward
    if (keys.a) turnInput = -1;  // Turn left
    if (keys.d) turnInput = 1;   // Turn right
  }

  return { moveInput, turnInput, targetHullAngle };
}

/**
 * Apply tank controls to update hull angle and calculate movement
 * @param {object} entity - Entity with hullAngle property
 * @param {number} moveInput - Forward/backward input (-1 to 1)
 * @param {number} turnInput - Left/right turn input (-1 to 1) for keyboard
 * @param {number|null} targetHullAngle - Target hull angle in radians (for joystick drive-toward)
 * @param {number} hullTurnRate - Hull turn rate in radians/sec
 * @param {number} dtSec - Delta time in seconds
 * @returns {object} { dx, dy, isMoving } - Movement direction and state
 */
function applyTankMovement(entity, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec) {
  // Apply hull turning - either toward target angle (joystick) or via turn input (keyboard)
  if (targetHullAngle !== null) {
    // Joystick: smooth rotate toward target angle
    entity.hullAngle = smoothRotateToward(entity.hullAngle, targetHullAngle, hullTurnRate * dtSec);
  } else if (turnInput !== 0) {
    // Keyboard: direct turn rate control
    entity.hullAngle = normalizeAngle(entity.hullAngle + turnInput * hullTurnRate * dtSec);
  }

  // Calculate movement in hull direction
  const isMoving = moveInput !== 0;
  let dx = 0, dy = 0;
  if (isMoving) {
    dx = Math.cos(entity.hullAngle) * moveInput;
    dy = Math.sin(entity.hullAngle) * moveInput;
  }

  return { dx, dy, isMoving };
}

/**
 * Update turret aim with smooth rotation
 * @param {object} entity - Entity with angle (turret) and hullAngle
 * @param {number} targetWorldAngle - Target aim angle in world space (radians)
 * @param {number} turretTurnRate - Turret turn rate in radians/sec
 * @param {number} dtSec - Delta time in seconds
 */
function applyTurretAim(entity, targetWorldAngle, turretTurnRate, dtSec) {
  entity.angle = smoothRotateToward(entity.angle, targetWorldAngle, turretTurnRate * dtSec);
}

/**
 * Calculate world aim angle from mouse position
 * @param {object} entity - Entity with x, y position
 * @param {object} mouse - Mouse position { x, y } in screen coords
 * @param {object} camera - Camera position { x, y }
 * @returns {number} World angle in radians
 */
function calculateAimAngle(entity, mouse, camera) {
  const worldMouseX = mouse.x + camera.x;
  const worldMouseY = mouse.y + camera.y;
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
      setTimeout(() => setupCampaignCanvas(), 0);
      startCampaignLoop();
      break;

    case State.CAMPAIGN_RESULT:
      stopLoop();
      render();
      break;

    // Endless Mode States
    case State.ENDLESS_LOADOUT:
      render();
      break;

    case State.ENDLESS_BATTLE:
      // TODO: Initialize endless battle with hero combat
      render();
      // For now, just go to between-wave screen after a delay (placeholder)
      setTimeout(() => {
        if (Game.state === State.ENDLESS_BATTLE && Game.endless) {
          // Simulate wave complete
          Game.endless.kills += Math.floor(Math.random() * 10) + 5;
          Game.endless.score += Game.endless.kills * 100;
          Game.endless.loot.scrap += Math.floor(Math.random() * 50) + 20;
          goto(State.ENDLESS_BETWEEN);
        }
      }, 2000);
      break;

    case State.ENDLESS_BETWEEN:
      stopLoop();
      render();
      break;

    case State.ENDLESS_RESULT:
      stopLoop();
      render();
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
          owner: 'player'
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
        owner: 'enemy'
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
  const playerProjs = b.projectiles.filter(p => p.owner === 'player');
  const playerProjResult = updateProjectiles(
    playerProjs,
    b.enemies,
    dtSec,
    bfH,
    (target) => ENEMIES[target.type].types
  );

  // Update enemy projectiles (hitting player units) - using shared module
  const enemyProjs = b.projectiles.filter(p => p.owner === 'enemy');
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
        owner: 'player'
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
        owner: 'player'
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
    const targetList = p.owner === 'player' ? aiAttackers : playerAttackers;
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
  const baseSpeed = isArmored ? 50 : 70;

  // Scale based on zone (later zones = harder)
  const zoneScale = 1 + zone.id * 0.2;

  const enemy = {
    id: `zone${zone.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    x: spawn.x,
    y: spawn.y,
    hp: Math.round((baseHp + zone.id * 10) * zoneScale),
    maxHp: Math.round((baseHp + zone.id * 10) * zoneScale),
    speed: baseSpeed + Math.random() * 30,
    damage: Math.round((baseDamage + zone.id * 2) * zoneScale),
    aiType: selectEnemyAIType(zone),
    unitId: spawn.type,
    angle: Math.PI / 2,  // Face downward
    zoneId: zone.id
  };

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

  // Calculate new position
  const newX = hero.x + dx * hero.speed * speedMod * dtSec;
  const newY = hero.y + dy * hero.speed * speedMod * dtSec;

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
  if ((b.mouse.down || autoAttacking) && turretAligned && now - hero.lastShot > hero.fireRate) {
    hero.lastShot = now;

    // Create projectile moving in aim direction
    const projSpeed = 500;
    b.projectiles.push({
      x: hero.x,
      y: hero.y,
      vx: Math.cos(hero.angle) * projSpeed,
      vy: Math.sin(hero.angle) * projSpeed,
      damage: hero.damage,
      owner: 'player',
      type: 'bullet'
    });

    // Trigger fire animation
    if (useCanvasRendering && hero.animId) {
      sprites.triggerUnitAnim(hero.animId, 'fire');
    }

    sound('shoot');
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

  // --- UPDATE ENEMIES (using modular AI) ---
  b.enemies.forEach(e => {
    updateEnemyAI(b, e, hero, b.units, now, dtSec);

    // Check if hero is defeated
    if (hero.hp <= 0) {
      hero.hp = 0;
      b.result = 'defeat';
      goto(State.CAMPAIGN_RESULT);
    }
  });

  // --- UPDATE ALLY UNITS (using modular AI) ---
  b.units.forEach(unit => {
    updateUnitAI(b, unit, hero, b.enemies, now, dtSec);
  });

  // --- UPDATE PROJECTILES ---
  b.projectiles.forEach(p => {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;

    // Check bounds
    if (p.x < 0 || p.x > b.mapWidth || p.y < 0 || p.y > b.mapHeight) {
      p.hit = true;
      return;
    }

    // Check hit on enemies (player and ally projectiles)
    if (p.owner === 'player' || p.owner === 'ally') {
      for (const e of b.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        // Use actual entity radius for hit detection (projectile + enemy)
        const hitRadius = ENTITY_RADIUS.projectile + ENTITY_RADIUS.enemy;
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          // Apply stance modifiers to damage
          let attackerStance = 'autonomous';

          // Get attacker stance
          if (p.owner === 'ally' && p.sourceUnitId) {
            const sourceUnit = b.units.find(u => u.id === p.sourceUnitId);
            if (sourceUnit) {
              attackerStance = sourceUnit.stance || 'autonomous';
            }
          } else if (p.owner === 'player') {
            // Hero uses aggressive stance by default
            attackerStance = 'aggressive';
          }

          // Get target stance from enemy AI type
          const targetStance = getEnemyStance(e.aiType);

          // Apply stance modifier
          const stanceMod = getStanceModifier(attackerStance, targetStance);
          const finalDamage = Math.round(p.damage * stanceMod.damageMod);

          e.hp -= finalDamage;
          p.hit = true;

          // Record damage for aggro system
          if (p.owner === 'player') {
            recordDamage(e, 'hero', finalDamage);
          } else if (p.owner === 'ally' && p.sourceUnitId) {
            recordDamage(e, p.sourceUnitId, finalDamage);
          }

          if (e.hp <= 0) {
            e.dead = true;
            b.kills++;
            b.enemiesRemaining--;
            sound('explosion');
          }
          break;
        }
      }
    }
  });

  // Remove hit projectiles
  b.projectiles = b.projectiles.filter(p => !p.hit);

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
    const baseSpeed = isArmored ? 50 : 70;

    const enemy = {
      id: `wave${b.wave}_${i}`,
      x,
      y,
      hp: baseHp + b.wave * 10,
      maxHp: baseHp + b.wave * 10,
      speed: baseSpeed + Math.random() * 30,
      damage: baseDamage + b.wave * 2,
      aiType: EnemyAIType[aiTypeKey],
      unitId,  // For armor class determination
      angle: Math.PI / 2  // Face downward initially
    };

    b.enemies.push(enemy);
  }

  b.wave++;
}

function drawCampaignBattle() {
  const bf = document.querySelector('.campaign-battlefield');
  if (!bf) return;

  const b = Game.campaign.heroBattle;
  if (!b) return;

  const screenW = bf.offsetWidth;
  const screenH = bf.offsetHeight;
  const cellSize = b.cellSize;

  // Update camera with hero in lower 1/4 of screen
  b.camera.x = Math.max(0, Math.min(b.mapWidth - screenW, b.hero.x - screenW / 2));
  b.camera.y = Math.max(0, Math.min(b.mapHeight - screenH, b.hero.y - screenH * 0.75));

  // Clear previous entities (but keep terrain if already drawn)
  bf.querySelectorAll('.campaign-entity').forEach(el => el.remove());

  // Ensure campaign canvas exists (may have been destroyed by render() call)
  if (!campaignCanvas || !bf.contains(campaignCanvas)) {
    setupCampaignCanvas();
  }

  // Clear campaign canvas for animated sprites
  // Note: context is scaled by DPR, so use screenW/screenH (display size)
  if (campaignCanvas && campaignCtx) {
    campaignCtx.clearRect(0, 0, screenW, screenH);
  }

  // Draw terrain grid (only once, then cache)
  if (!bf.querySelector('.campaign-terrain')) {
    const terrainContainer = document.createElement('div');
    terrainContainer.className = 'campaign-terrain';
    terrainContainer.style.position = 'absolute';
    terrainContainer.style.width = `${b.mapWidth}px`;
    terrainContainer.style.height = `${b.mapHeight}px`;
    terrainContainer.style.left = '0';
    terrainContainer.style.top = '0';

    // Draw each terrain cell with SVG graphics
    for (let row = 0; row < b.gridHeight; row++) {
      for (let col = 0; col < b.gridWidth; col++) {
        const terrainType = b.terrain[row]?.[col] || 'open';
        const cell = document.createElement('div');
        cell.className = `campaign-cell terrain-${terrainType}`;
        cell.style.position = 'absolute';
        cell.style.left = `${col * cellSize}px`;
        cell.style.top = `${row * cellSize}px`;
        cell.style.width = `${cellSize}px`;
        cell.style.height = `${cellSize}px`;
        cell.style.boxSizing = 'border-box';

        // Use SVG terrain tiles
        cell.innerHTML = getTerrainSVG(terrainType, row, b.gridHeight);
        terrainContainer.appendChild(cell);
      }
    }
    bf.appendChild(terrainContainer);
  }

  // Update terrain position based on camera
  const terrainEl = bf.querySelector('.campaign-terrain');
  if (terrainEl) {
    terrainEl.style.transform = `translate(${-b.camera.x}px, ${-b.camera.y}px)`;
  }

  // Draw player units
  b.units.forEach(unit => {
    const el = document.createElement('div');
    const isSelected = b.squad?.selectedUnitId === unit.id;
    el.className = `campaign-entity campaign-unit ${isSelected ? 'selected' : ''}`;
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

  // Draw hero
  const hero = b.hero;
  const heroHasAnim = useCanvasRendering && hero.animId && sprites.hasAnimatedUnit(hero.animId);

  if (heroHasAnim && campaignCtx) {
    // Render animated sprite on canvas
    const screenX = hero.x - b.camera.x;
    const screenY = hero.y - b.camera.y;
    // Hull rotation is based on movement direction (hullAngle), not aim direction
    // +90 degrees to align sprite (sprite default faces right, we want up to be 0)
    const hullRotation = (hero.hullAngle * 180 / Math.PI) + 90;
    const scale = 0.5; // Scale to reasonable game size
    sprites.renderAnimatedUnit(campaignCtx, hero.animId, screenX, screenY, hullRotation, scale);
  } else {
    // Fallback to DOM rendering
    const heroEl = document.createElement('div');
    heroEl.className = 'campaign-entity campaign-hero';
    heroEl.style.left = `${hero.x - b.camera.x - 20}px`;
    heroEl.style.top = `${hero.y - b.camera.y - 20}px`;
    heroEl.style.width = '40px';
    heroEl.style.height = '40px';
    heroEl.style.transform = `rotate(${hero.angle + Math.PI / 2}rad)`;
    heroEl.style.backgroundColor = '#4a9eff';
    heroEl.style.borderRadius = '5px';
    heroEl.style.border = '2px solid #fff';
    bf.appendChild(heroEl);
  }

  // Draw enemies
  b.enemies.forEach(e => {
    if (e.dead) return;

    const el = document.createElement('div');
    el.className = 'campaign-entity campaign-enemy';
    el.style.left = `${e.x - b.camera.x - 15}px`;
    el.style.top = `${e.y - b.camera.y - 15}px`;
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.backgroundColor = '#ff4444';
    el.style.borderRadius = '50%';

    // Check if this is the concentrate target
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

  // Draw targeting mode indicator
  if (b.commandMode === 'selectTarget') {
    const indicator = document.createElement('div');
    indicator.className = 'campaign-entity targeting-indicator';
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
    el.className = 'campaign-entity campaign-projectile';
    el.style.left = `${p.x - b.camera.x - 4}px`;
    el.style.top = `${p.y - b.camera.y - 4}px`;
    el.style.width = '8px';
    el.style.height = '8px';
    el.style.backgroundColor = '#ffcc00';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 10px #ffcc00';
    bf.appendChild(el);
  });

  // Update HUD
  const hpBar = bf.querySelector('.campaign-hp-fill');
  if (hpBar) {
    hpBar.style.width = `${(hero.hp / hero.maxHP) * 100}%`;
  }

  const timerEl = bf.querySelector('.campaign-timer');
  if (timerEl) {
    timerEl.textContent = `${Math.ceil(b.timer)}s`;
  }

  const killsEl = bf.querySelector('.campaign-kills');
  if (killsEl) {
    killsEl.textContent = `Kills: ${b.kills}`;
  }

  // Draw zone-specific UI if this is a zone battle
  if (b.scenario && b.zones) {
    drawZoneUI(bf, b);
  }

  // Draw minimap
  drawMinimap(b);

  // Draw command feedback
  drawCommandUI(bf, b);
}

// Draw minimap showing terrain, units, and enemies
function drawMinimap(b) {
  const canvas = document.querySelector('.minimap-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Scale factor: map to minimap
  const scaleX = w / b.mapWidth;
  const scaleY = h / b.mapHeight;

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Draw terrain (simplified colors)
  const terrainColors = {
    open: '#4a4035',
    grass: '#3a5a2a',
    brush: '#2a4a1a',
    forest: '#1e3a18',
    high: '#5a4a3a',
    water: '#1a4a65',
    trench: '#3a2a1a',
    pillbox: '#5a5a5a'
  };

  const cellW = (b.cellSize * scaleX);
  const cellH = (b.cellSize * scaleY);

  for (let row = 0; row < b.gridHeight; row++) {
    for (let col = 0; col < b.gridWidth; col++) {
      const terrainType = b.terrain[row]?.[col] || 'open';
      ctx.fillStyle = terrainColors[terrainType] || terrainColors.open;
      ctx.fillRect(col * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
    }
  }

  // Draw player units (green dots, selected = blue ring)
  b.units.forEach(unit => {
    const x = unit.x * scaleX;
    const y = unit.y * scaleY;
    const isSelected = b.squad?.selectedUnitId === unit.id;

    if (isSelected) {
      // Draw selection ring first
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isSelected ? '#7ab87a' : '#5a8a5a';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw enemies (red dots)
  ctx.fillStyle = '#ff4444';
  b.enemies.forEach(e => {
    if (e.dead) return;
    const x = e.x * scaleX;
    const y = e.y * scaleY;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw hero (blue dot with ring)
  const heroX = b.hero.x * scaleX;
  const heroY = b.hero.y * scaleY;
  ctx.fillStyle = '#4a9eff';
  ctx.beginPath();
  ctx.arc(heroX, heroY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw view range circle around hero
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(heroX, heroY, 200 * scaleX, 0, Math.PI * 2); // ~200px view range
  ctx.stroke();
}

// Campaign input handlers (called from main.js)
export function campaignKeyDown(key) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  const k = key.toLowerCase();

  // Movement keys
  if (k === 'w' || k === 'arrowup') b.keys.w = true;
  if (k === 'a' || k === 'arrowleft') b.keys.a = true;
  if (k === 's' || k === 'arrowdown') b.keys.s = true;
  if (k === 'd' || k === 'arrowright') b.keys.d = true;

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

  const k = key.toLowerCase();
  if (k === 'w' || k === 'arrowup') b.keys.w = false;
  if (k === 'a' || k === 'arrowleft') b.keys.a = false;
  if (k === 's' || k === 'arrowdown') b.keys.s = false;
  if (k === 'd' || k === 'arrowright') b.keys.d = false;
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

  // Handle pending move command
  if (b.pendingCommand === 'MOVE') {
    const worldX = b.mouse.x + b.camera.x;
    const worldY = b.mouse.y + b.camera.y;

    // Issue move command to all units with target position
    issueCommand(b.units, 'move', { x: worldX, y: worldY });
    b.commandFeedback = { text: '🎯 Moving to target!', time: Date.now() };
    b.pendingCommand = null;
    return; // Don't fire weapon when issuing move command
  }

  // Handle concentrate fire targeting mode
  if (b.commandMode === 'selectTarget' && b.commandAction === 'concentrate') {
    const worldX = b.mouse.x + b.camera.x;
    const worldY = b.mouse.y + b.camera.y;

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
