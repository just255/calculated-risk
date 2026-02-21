// ═══════════════════════════════════════════════════════════════
// TEST MODE - Walk around the map to test terrain feel
// Tank controls: W=forward, S=reverse, A/D=turn
// Mouse aim: turret tracks cursor, click to fire
// Uses actual unit sprites from sprites.js
// ═══════════════════════════════════════════════════════════════

import { ensureRasterized } from '../world-builder/rasterize.js';
import {
  getTerrainAt,
  getTerrainSpeedMod,
  isTerrainBlocked,
  getCoverBonus,
  isConcealed
} from '../world-builder/terrain-query.js';
import { UNITS } from '../constants.js';
import {
  VEHICLE_TURN_RATES,
  normalizeAngle,
  parseTankInput,
  applyTankMovement,
  applyTurretAim,
  calculateAimAngle
} from '../movement.js';
import { createFreeProjectile, updateFreeProjectiles, renderProjectiles } from '../projectiles.js';
import * as sprites from '../sprites.js';

const UNIT_SCALE = 0.5;    // sprite scale (same as campaign — 256px canvas rendered at 128px)
const UNIT_RADIUS = 32;    // collision/clamp radius
const TEST_ZOOM = 1.5;     // locked zoom level
const CAMERA_LERP = 0.12;  // smooth follow speed (0-1)
const TURRET_ALIGN_THRESHOLD = 0.17; // ~10 degrees — must be this close to fire

export class TestMode {
  constructor(state, renderer) {
    this._state = state;
    this._renderer = renderer;
    this._active = false;

    // Hero state
    this._hero = { x: 0, y: 0, hullAngle: -Math.PI / 2, angle: -Math.PI / 2 };
    this._isMoving = false;

    // Unit selection
    this._unitId = 'abrams';
    this._unitDef = null;
    this._animId = 'test-hero';

    // Input state
    this._keys = {};
    this._mouse = { x: 0, y: 0, down: false };

    // Projectile state
    this._projectiles = [];
    this._lastShot = 0;

    // Saved viewport to restore on exit
    this._savedViewport = null;

    // Animation frame
    this._rafId = null;
    this._lastTime = 0;

    // Bound handlers
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    // DPR
    this._dpr = window.devicePixelRatio || 1;

    // FPS tracking
    this._fps = 0;
    this._frameCount = 0;
    this._fpsTime = 0;

    // Cached aim angle (for HUD display and firing checks)
    this._aimTarget = 0;
  }

  get active() {
    return this._active;
  }

  get unitId() {
    return this._unitId;
  }

  setUnit(unitId) {
    this._unitId = unitId;
    this._unitDef = UNITS.find(u => u.id === unitId) || null;

    // Re-initialize sprite if already in test mode
    if (this._active && this._unitDef) {
      this._initSprite();
    }
  }

  async enter() {
    if (this._active) return;
    this._active = true;

    const terrainMap = this._state.terrainMap;

    // Ensure terrain grid is rasterized for collision queries
    ensureRasterized(terrainMap);

    // Load selected unit
    this._unitDef = UNITS.find(u => u.id === this._unitId) || null;
    await this._initSprite();

    // Place hero at spawn zone (south or west), or map center as fallback
    const mapW = this._state.canvasWidth;
    const mapH = this._state.canvasHeight;
    const spawn = this._getPlayerSpawn(mapW, mapH);
    this._hero.x = spawn.x;
    this._hero.y = spawn.y;
    this._hero.hullAngle = spawn.angle;
    this._hero.angle = spawn.angle;
    this._isMoving = false;

    // Reset state
    this._keys = {};
    this._mouse = { x: 0, y: 0, down: false };
    this._projectiles = [];
    this._lastShot = 0;

    // Save current viewport
    const vp = this._state.viewport;
    this._savedViewport = { x: vp.x, y: vp.y, zoom: vp.zoom };

    // Register keyboard input
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    // Register mouse input on UI canvas (top layer, captures all mouse events)
    const canvas = this._renderer.uiCanvas;
    if (canvas) {
      canvas.addEventListener('mousemove', this._onMouseMove);
      canvas.addEventListener('mousedown', this._onMouseDown);
      canvas.addEventListener('mouseup', this._onMouseUp);
      canvas.addEventListener('contextmenu', this._onContextMenu);
    }

    // Set overlay callbacks: HUD on UI canvas, unit on features canvas (below canopy)
    this._renderer.setTestModeOverlay(
      (ctx) => this._renderHUD(ctx),
      (ctx) => this._renderUnit(ctx)
    );

    // Snap camera to hero immediately
    this._updateCamera(true);

    // Start game loop
    this._lastTime = performance.now();
    this._loop(this._lastTime);

    console.log(`[TestMode] Entered test mode with unit: ${this._unitId}`);
  }

  exit() {
    if (!this._active) return;
    this._active = false;

    // Stop loop
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // Remove keyboard input
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);

    // Remove mouse input
    const canvas = this._renderer.uiCanvas;
    if (canvas) {
      canvas.removeEventListener('mousemove', this._onMouseMove);
      canvas.removeEventListener('mousedown', this._onMouseDown);
      canvas.removeEventListener('mouseup', this._onMouseUp);
      canvas.removeEventListener('contextmenu', this._onContextMenu);
    }

    // Clear overlay callbacks
    this._renderer.setTestModeOverlay(null, null);

    // Clean up sprite
    sprites.destroyAnimatedUnit(this._animId);

    // Clear projectiles
    this._projectiles = [];

    // Restore viewport
    if (this._savedViewport) {
      this._state.setViewport(
        this._savedViewport.x,
        this._savedViewport.y,
        this._savedViewport.zoom
      );
    }

    // Force a full re-render to clean up
    this._renderer.requestRender();

    console.log('[TestMode] Exited test mode');
  }

  // ═══════════════════════════════════════════════════════════════
  // SPRITE INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  async _initSprite() {
    // Clean up previous
    sprites.destroyAnimatedUnit(this._animId);

    if (!this._unitDef) return;

    try {
      await sprites.initAnimatedUnit(this._animId, this._unitId, 'default');
      sprites.setUnitAnimTrigger(this._animId, 'idle');
      console.log(`[TestMode] Sprite loaded for ${this._unitId}`);
    } catch (err) {
      console.warn(`[TestMode] Failed to load sprite for ${this._unitId}:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SPAWN PLACEMENT
  // ═══════════════════════════════════════════════════════════════

  _getPlayerSpawn(mapW, mapH) {
    const zones = this._state.terrainMap.spawnZones;

    if (zones && zones.length >= 2) {
      // Vertical orientation: zone[1] is south (player), face north
      // Horizontal orientation: zone[0] is west (player), face east
      if (zones.orientation === 'horizontal') {
        return { x: zones[0].x, y: zones[0].y, angle: 0 };           // face east
      } else {
        return { x: zones[1].x, y: zones[1].y, angle: -Math.PI / 2 }; // face north
      }
    }

    // Fallback: map center, face north
    return { x: mapW / 2, y: mapH / 2, angle: -Math.PI / 2 };
  }

  // ═══════════════════════════════════════════════════════════════
  // GAME LOOP
  // ═══════════════════════════════════════════════════════════════

  _loop(timestamp) {
    if (!this._active) return;

    const dt = Math.min(timestamp - this._lastTime, 50); // cap dt at 50ms
    this._lastTime = timestamp;
    const dtSec = dt / 1000;

    // FPS counter (update once per second)
    this._frameCount++;
    this._fpsTime += dt;
    if (this._fpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._fpsTime -= 1000;
    }

    this._moveHero(dtSec);
    this._updateFiring(timestamp);
    this._updateProjectiles(dtSec);
    this._updateCamera(false);

    // Request renderer to draw (it will call our overlay)
    this._renderer.requestRender();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  // ═══════════════════════════════════════════════════════════════
  // INPUT
  // ═══════════════════════════════════════════════════════════════

  _handleKeyDown(e) {
    const key = e.key.toLowerCase();
    this._keys[key] = true;

    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
    }
  }

  _handleKeyUp(e) {
    const key = e.key.toLowerCase();
    this._keys[key] = false;
  }

  _handleMouseMove(e) {
    const canvas = this._renderer.uiCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this._mouse.x = e.clientX - rect.left;
    this._mouse.y = e.clientY - rect.top;
  }

  _handleMouseDown(e) {
    if (e.button === 0) { // left click only
      this._mouse.down = true;
    }
  }

  _handleMouseUp(e) {
    if (e.button === 0) {
      this._mouse.down = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MOVEMENT & COLLISION (tank controls from movement.js)
  // ═══════════════════════════════════════════════════════════════

  _moveHero(dtSec) {
    const hero = this._hero;
    const terrainMap = this._state.terrainMap;

    // Parse keyboard into tank input
    const { moveInput, turnInput } = parseTankInput(this._keys);

    // Get turn rate for this unit type
    const unitDef = this._unitDef;
    const isLight = unitDef && (unitDef.id === 'jeep' || unitDef.id === 'infantry');
    const turnRates = isLight ? VEHICLE_TURN_RATES.light : VEHICLE_TURN_RATES.tank;

    // Apply tank movement (returns new hull angle + direction)
    const result = applyTankMovement(hero.hullAngle, moveInput, turnInput, turnRates.hull, dtSec);
    hero.hullAngle = result.hullAngle;

    // Turret aims independently toward mouse
    this._aimTarget = calculateAimAngle(
      hero.x, hero.y,
      this._mouse.x, this._mouse.y,
      this._state.viewport
    );
    hero.angle = applyTurretAim(hero.angle, this._aimTarget, turnRates.turret, dtSec);

    // Update sprite turret aim (relative angle in degrees)
    const relativeAim = (hero.angle - hero.hullAngle) * 180 / Math.PI;
    sprites.setUnitAimAngle(this._animId, relativeAim);

    const wasMoving = this._isMoving;
    this._isMoving = result.isMoving;

    // Update animation trigger
    if (this._isMoving !== wasMoving) {
      sprites.setUnitAnimTrigger(this._animId, this._isMoving ? 'move' : 'idle');
    }

    if (!result.isMoving) return;

    // Speed by unit type (matches ERAS hero speeds in constants.js)
    const UNIT_SPEEDS = { infantry: 130, jeep: 180, sherman: 100, tiger: 90, abrams: 120 };
    const heroSpeed = UNIT_SPEEDS[this._unitId] || 120;
    const speedMod = getTerrainSpeedMod(terrainMap, hero.x, hero.y);
    const actualSpeed = heroSpeed * speedMod;

    const newX = hero.x + result.dx * actualSpeed * dtSec;
    const newY = hero.y + result.dy * actualSpeed * dtSec;

    // Per-axis collision
    if (!isTerrainBlocked(terrainMap, newX, hero.y)) {
      hero.x = newX;
    }
    if (!isTerrainBlocked(terrainMap, hero.x, newY)) {
      hero.y = newY;
    }

    // Clamp to map bounds
    const half = UNIT_RADIUS;
    const mapW = this._state.canvasWidth;
    const mapH = this._state.canvasHeight;
    hero.x = Math.max(half, Math.min(mapW - half, hero.x));
    hero.y = Math.max(half, Math.min(mapH - half, hero.y));
  }

  // ═══════════════════════════════════════════════════════════════
  // FIRING
  // ═══════════════════════════════════════════════════════════════

  _updateFiring(timestamp) {
    if (!this._mouse.down) return;
    if (!this._unitDef) return;

    // Check turret alignment
    const aimDiff = normalizeAngle(this._hero.angle - this._aimTarget);
    if (Math.abs(aimDiff) > TURRET_ALIGN_THRESHOLD) return;

    // Check fire cooldown (use unit's fireRate in ms)
    const fireRate = this._unitDef.fireRate || 1000;
    if (timestamp - this._lastShot < fireRate) return;

    this._lastShot = timestamp;

    // Spawn projectile from hero position in turret direction
    const hero = this._hero;
    const muzzleOffset = UNIT_RADIUS + 8; // slightly in front of unit
    const proj = createFreeProjectile({
      x: hero.x + Math.cos(hero.angle) * muzzleOffset,
      y: hero.y + Math.sin(hero.angle) * muzzleOffset,
      angle: hero.angle,
      unitType: this._unitId,
      damage: this._unitDef.damage || 10,
      owner: 'hero'
    });
    this._projectiles.push(proj);

    // Trigger fire animation on sprite
    sprites.triggerUnitAnim(this._animId, 'fire');
  }

  _updateProjectiles(dtSec) {
    if (this._projectiles.length === 0) return;

    const bounds = {
      width: this._state.canvasWidth,
      height: this._state.canvasHeight
    };

    // No targets in test mode (just free-fire for now)
    const result = updateFreeProjectiles(this._projectiles, dtSec, bounds);
    this._projectiles = result.projectiles;
  }

  // ═══════════════════════════════════════════════════════════════
  // CAMERA
  // ═══════════════════════════════════════════════════════════════

  _updateCamera(snap) {
    const screenW = this._renderer.screenWidth;
    const screenH = this._renderer.screenHeight;
    const zoom = TEST_ZOOM;

    const targetX = -(this._hero.x * zoom - screenW / 2);
    const targetY = -(this._hero.y * zoom - screenH / 2);

    if (snap) {
      this._state.setViewport(targetX, targetY, zoom);
    } else {
      const vp = this._state.viewport;
      const newX = vp.x + (targetX - vp.x) * CAMERA_LERP;
      const newY = vp.y + (targetY - vp.y) * CAMERA_LERP;
      this._state.setViewport(newX, newY, zoom);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER — unit + projectiles on features canvas, HUD on UI canvas
  // ═══════════════════════════════════════════════════════════════

  _renderUnit(ctx) {
    const hero = this._hero;
    const hasSprite = sprites.hasAnimatedUnit(this._animId);

    if (hasSprite) {
      const rotation = (hero.hullAngle * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, this._animId, hero.x, hero.y, rotation, UNIT_SCALE, performance.now());
    } else {
      // Fallback: colored circle with turret line
      ctx.save();
      ctx.beginPath();
      ctx.arc(hero.x, hero.y, UNIT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = this._unitDef?.color || '#4a9eff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Hull direction indicator
      const hullX = hero.x + Math.cos(hero.hullAngle) * (UNIT_RADIUS + 4);
      const hullY = hero.y + Math.sin(hero.hullAngle) * (UNIT_RADIUS + 4);
      ctx.beginPath();
      ctx.arc(hullX, hullY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();
      // Turret direction indicator (longer line)
      const turretX = hero.x + Math.cos(hero.angle) * (UNIT_RADIUS + 10);
      const turretY = hero.y + Math.sin(hero.angle) * (UNIT_RADIUS + 10);
      ctx.beginPath();
      ctx.moveTo(hero.x, hero.y);
      ctx.lineTo(turretX, turretY);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Render projectiles in world space (same canvas as unit, below canopy)
    renderProjectiles(ctx, this._projectiles);
  }

  _renderHUD(ctx) {
    const dpr = this._dpr;
    const terrainMap = this._state.terrainMap;
    const hero = this._hero;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const screenW = this._renderer.screenWidth;
    const screenH = this._renderer.screenHeight;

    // Top bar
    const barH = 32;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, screenW, barH);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#50c878';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const unitName = this._unitDef?.name || this._unitId;
    ctx.fillText(`TEST MODE  -  ${unitName}`, 12, barH / 2);

    // FPS counter
    ctx.fillStyle = this._fps >= 55 ? '#50c878' : this._fps >= 30 ? '#f0c040' : '#f06040';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this._fps} FPS`, screenW / 2, barH / 2);

    ctx.fillStyle = '#888';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('ESC exit | WASD move | Mouse aim | Click fire', screenW - 12, barH / 2);

    // Bottom-left terrain info
    const terrain = getTerrainAt(terrainMap, hero.x, hero.y);
    const speed = getTerrainSpeedMod(terrainMap, hero.x, hero.y);
    const cover = getCoverBonus(terrainMap, hero.x, hero.y);
    const concealed = isConcealed(terrainMap, hero.x, hero.y);

    const infoX = 12;
    const infoY = screenH - 80;
    const lineH = 18;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, infoY - 8, 200, 88);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText(`Terrain: ${terrain}`, infoX, infoY + lineH * 0);

    const speedColor = speed >= 1.0 ? '#50c878' : speed >= 0.7 ? '#f0c040' : '#f06040';
    ctx.fillStyle = speedColor;
    ctx.fillText(`Speed:   ${speed.toFixed(1)}x`, infoX, infoY + lineH * 1);

    const coverPct = Math.round(cover * 100);
    ctx.fillStyle = coverPct > 0 ? '#50c878' : '#666';
    ctx.fillText(`Cover:   ${coverPct}%`, infoX, infoY + lineH * 2);

    ctx.fillStyle = concealed ? '#50c878' : '#666';
    ctx.fillText(`Conceal: ${concealed ? 'yes' : 'no'}`, infoX, infoY + lineH * 3);

    // Crosshair at mouse position
    this._renderCrosshair(ctx);

    ctx.restore();
  }

  _renderCrosshair(ctx) {
    const mx = this._mouse.x;
    const my = this._mouse.y;
    const size = 10;
    const gap = 4;

    // Check turret alignment for color
    const aimDiff = normalizeAngle(this._hero.angle - this._aimTarget);
    const aligned = Math.abs(aimDiff) < TURRET_ALIGN_THRESHOLD;

    ctx.strokeStyle = aligned ? '#50c878' : '#f06040';
    ctx.lineWidth = 1.5;

    // Top
    ctx.beginPath();
    ctx.moveTo(mx, my - size);
    ctx.lineTo(mx, my - gap);
    ctx.stroke();
    // Bottom
    ctx.beginPath();
    ctx.moveTo(mx, my + gap);
    ctx.lineTo(mx, my + size);
    ctx.stroke();
    // Left
    ctx.beginPath();
    ctx.moveTo(mx - size, my);
    ctx.lineTo(mx - gap, my);
    ctx.stroke();
    // Right
    ctx.beginPath();
    ctx.moveTo(mx + gap, my);
    ctx.lineTo(mx + size, my);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
