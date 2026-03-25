// ═══════════════════════════════════════════════════════════════
// REPLAY PLAYER - Playback engine for battle replays
// Takes recorded frame data and drives the existing BattleRenderer
// ═══════════════════════════════════════════════════════════════

import { Team } from './constants.js';
import { Game } from './state.js';
import { BattleRenderer } from './battle-renderer.js';
import { randomizeBattleConfig, generateBattleTerrain } from './world-builder/battle-terrain.js';
import { updateFireRangeCamera, updateHeroCamera } from './camera.js';
import { cacheInsigniaSet } from './insignia-renderer.js';
import * as sprites from './sprites.js';

export class ReplayPlayer {
  constructor() {
    this.replay = null;          // The loaded replay data
    this.battle = null;          // Fake battle object for renderer
    this.renderer = null;        // BattleRenderer instance
    this.playing = false;
    this.speed = 1;              // Playback speed multiplier
    this.currentTime = 0;        // Current playback time in ms
    this._lastRafTime = 0;
    this._loopId = null;
    this._onFrame = null;        // Callback per render frame
    this._onTimeUpdate = null;   // Callback for time updates (for UI)
    this._onEnd = null;          // Callback when replay reaches end
  }

  /**
   * Load a replay and reconstruct terrain.
   * @param {object} replayData - Parsed replay JSON
   * @returns {Promise<void>}
   */
  async load(replayData) {
    this.replay = replayData;
    this.currentTime = 0;
    this.playing = false;

    // Build the fake battle object
    this.battle = await this._buildBattle(replayData);

    // Initialize camera near first frame's blue leader position
    // so auto-follow doesn't start from map center and slide
    if (replayData.frames?.length > 0) {
      const firstFrame = replayData.frames[0];
      const firstAlive = firstFrame.units?.find(u => !u.dead);
      if (firstAlive) {
        // Set camera top-left so leader is roughly centered (actual centering
        // happens in updateFireRangeCamera, but this prevents a large initial slide)
        this.battle.camera.x = firstAlive.x - 400;
        this.battle.camera.y = firstAlive.y - 300;
      }
    }
  }

  /**
   * Build a minimal battle object that BattleRenderer can render.
   * Reconstructs terrain from seed.
   */
  async _buildBattle(replay) {
    const b = {
      mapWidth: replay.mapWidth,
      mapHeight: replay.mapHeight,
      gridWidth: Math.ceil(replay.mapWidth / 64),
      gridHeight: Math.ceil(replay.mapHeight / 64),
      cellSize: 64,
      terrainSeed: replay.seed,
      terrainLabel: replay.terrainLabel || '',
      blueSpawnZone: replay.blueSpawnZone,
      redSpawnZone: replay.redSpawnZone,
      fireRange: replay.mode === 'fire_range',
      _isReplay: true,
      debugOverlay: false,
      showTerrainGrid: 0,
      units: [],
      enemies: [],
      projectiles: [],
      hero: null,
      effects: [],
      camera: { x: replay.mapWidth / 2, y: replay.mapHeight / 2, zoom: 1, userZoom: 1, _manualPan: false },
      keys: { w: false, a: false, s: false, d: false },
      squad: {},
      commandMode: null,
      _debugLog: replay.events || [],
      _teamWaypoints: {},
      _sergeants: {},
      debug: {},
      result: null,
      _visibleEnemies: null  // Replay = spectator mode, show all enemies
    };

    // Create unit objects from unitDefs
    for (const def of replay.unitDefs) {
      if (def.isHero) {
        // Reconstruct hero for endless/campaign replays
        const heroAnimId = `replay-hero-${def.unitId}-${Date.now()}`;
        b.hero = {
          x: 0, y: 0, angle: 0, hullAngle: 0,
          hp: def.maxHp, maxHp: def.maxHp,
          unitId: def.unitId,
          dead: false,
          isHero: true,
          animId: heroAnimId
        };
        // Load hero sprite
        sprites.initAnimatedUnit(heroAnimId, def.unitId, 'default');
        continue;
      }
      const unit = {
        id: def.id,
        team: def.team === 'blue' ? Team.BLUE : Team.RED,
        unitId: def.unitId,
        maxHp: def.maxHp,
        hp: def.maxHp,
        x: 0, y: 0, angle: 0,
        dead: false,
        animId: null,
        _dbg: {},
        _suppression: 0,
        _rank: def.rank ?? 0,
        _insigniaSetId: def.insigniaSetId || null,
        range: 400,
        speed: 30
      };
      if (def.team === 'blue') {
        b.units.push(unit);
      } else {
        b.enemies.push(unit);
      }
    }

    // Cache insignia sets used by units
    const insigniaIds = new Set();
    for (const def of replay.unitDefs) {
      if (def.insigniaSetId) insigniaIds.add(def.insigniaSetId);
    }
    for (const setId of insigniaIds) {
      fetch(`/api/insignia/${encodeURIComponent(setId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(set => { if (set) cacheInsigniaSet(set); })
        .catch(() => {});
    }

    // Reconstruct terrain from seed if terrain images are available
    if (replay.seed != null && Game.terrainImages) {
      try {
        const varied = randomizeBattleConfig(replay.seed);
        // generateBattleTerrain is synchronous — returns result directly
        const pcg = generateBattleTerrain({
          mapWidth: replay.mapWidth,
          mapHeight: replay.mapHeight,
          cellSize: 64,
          biome: varied.biome,
          season: varied.season,
          seed: replay.seed,
          images: Game.terrainImages,
          pcgParams: varied.pcgParams
        });
        if (pcg) {
          b.terrainCanvases = {
            terrainCanvas: pcg.terrainCanvas,
            canopyCanvas: pcg.canopyCanvas,
            bridgeDeckCanvas: pcg.bridgeDeckCanvas || null
          };
          b.terrainMap = pcg.terrainMap || null;
        }
      } catch (err) {
        console.warn('Replay: Failed to reconstruct terrain from seed:', err);
      }
    }

    return b;
  }

  /**
   * Initialize the BattleRenderer on a container element.
   * BattleRenderer constructor takes only the container element.
   * @param {HTMLElement} container - DOM element to render into
   */
  initRenderer(container) {
    if (this.renderer) this.renderer.destroy();

    const b = this.battle;
    // BattleRenderer(container) — no mapWidth/mapHeight args
    this.renderer = new BattleRenderer(container);
    this.renderer.init();

    // Set terrain from pre-rendered canvases (matches game.js pattern)
    if (b.terrainCanvases) {
      this.renderer.setTerrainFromCanvases(
        b.terrainCanvases.terrainCanvas,
        b.terrainCanvases.canopyCanvas,
        b.mapWidth,
        b.mapHeight,
        b.terrainCanvases.bridgeDeckCanvas
      );
    }

    b.battleRenderer = this.renderer;
  }

  play() {
    if (!this.replay) return;
    this.playing = true;
    if (!this._loopId) {
      this._lastRafTime = performance.now();
      this._loopId = requestAnimationFrame(t => this._loop(t));
    }
  }

  pause() {
    this.playing = false;
  }

  stop() {
    this.playing = false;
    if (this._loopId) {
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
    }
  }

  setSpeed(s) {
    this.speed = s;
  }

  seekTo(timeMs) {
    this.currentTime = Math.max(0, Math.min(timeMs, this.getDuration()));
    this._applyFrame();
    this._renderFrame();
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration() {
    if (!this.replay || !this.replay.frames.length) return 0;
    return this.replay.frames[this.replay.frames.length - 1].t;
  }

  /** Step forward one recorded frame (for frame-by-frame when paused) */
  stepForward() {
    const idx = this._findFrameIndex(this.currentTime);
    if (idx < this.replay.frames.length - 1) {
      this.currentTime = this.replay.frames[idx + 1].t;
      this._applyFrame();
      this._renderFrame();
    }
  }

  /** Step backward one recorded frame */
  stepBackward() {
    const idx = this._findFrameIndex(this.currentTime);
    if (idx > 0) {
      this.currentTime = this.replay.frames[idx - 1].t;
      this._applyFrame();
      this._renderFrame();
    }
  }

  onTimeUpdate(cb) { this._onTimeUpdate = cb; }
  onEnd(cb) { this._onEnd = cb; }

  destroy() {
    this.stop();
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.battle = null;
    this.replay = null;
  }

  // ── Internal ──────────────────────────────────────

  _loop(t) {
    if (!this.replay) return;

    const dt = t - this._lastRafTime;
    this._lastRafTime = t;

    if (this.playing) {
      this.currentTime += dt * this.speed;
      const duration = this.getDuration();
      if (this.currentTime >= duration) {
        this.currentTime = duration;
        this.playing = false;
        if (this._onEnd) this._onEnd();
      }
    }

    this._applyFrame();
    this._renderFrame();

    if (this._onTimeUpdate) {
      this._onTimeUpdate(this.currentTime, this.getDuration());
    }

    this._loopId = requestAnimationFrame(t2 => this._loop(t2));
  }

  /**
   * Find the frame index for a given time (binary search).
   * Returns the index of the frame at or just before `time`.
   */
  _findFrameIndex(time) {
    const frames = this.replay.frames;
    if (frames.length === 0) return 0;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].t <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Apply the current time to the battle object by interpolating between frames.
   */
  _applyFrame() {
    const b = this.battle;
    const frames = this.replay.frames;
    if (!b || frames.length === 0) return;

    const idx = this._findFrameIndex(this.currentTime);
    const frame = frames[idx];
    const nextFrame = frames[idx + 1] || null;

    // Interpolation factor (0-1 between current frame and next)
    let lerp = 0;
    if (nextFrame) {
      const gap = nextFrame.t - frame.t;
      if (gap > 0) lerp = (this.currentTime - frame.t) / gap;
    }

    // Apply unit positions (blue team)
    for (let i = 0; i < b.units.length && i < frame.units.length; i++) {
      const u = b.units[i];
      const f = frame.units[i];
      const n = nextFrame?.units[i];

      if (n && lerp > 0 && !f.dead) {
        u.x = f.x + (n.x - f.x) * lerp;
        u.y = f.y + (n.y - f.y) * lerp;
        u.angle = _lerpAngle(f.ang, n.ang, lerp);
        u.hullAngle = f.hull != null && n.hull != null
          ? _lerpAngle(f.hull, n.hull, lerp)
          : u.angle;
      } else {
        u.x = f.x;
        u.y = f.y;
        u.angle = f.ang;
        u.hullAngle = f.hull ?? f.ang;
      }
      u.hp = f.hp;
      u.dead = f.dead;
      u.animId = f.anim;
      u._dbg = { state: f.st };
    }

    // Apply enemy positions (red team)
    for (let i = 0; i < b.enemies.length && i < frame.enemies.length; i++) {
      const e = b.enemies[i];
      const f = frame.enemies[i];
      const n = nextFrame?.enemies[i];

      if (n && lerp > 0 && !f.dead) {
        e.x = f.x + (n.x - f.x) * lerp;
        e.y = f.y + (n.y - f.y) * lerp;
        e.angle = _lerpAngle(f.ang, n.ang, lerp);
        e.hullAngle = f.hull != null && n.hull != null
          ? _lerpAngle(f.hull, n.hull, lerp)
          : e.angle;
      } else {
        e.x = f.x;
        e.y = f.y;
        e.angle = f.ang;
        e.hullAngle = f.hull ?? f.ang;
      }
      e.hp = f.hp;
      e.dead = f.dead;
      e.animId = f.anim;
      e._dbg = { state: f.st };
    }

    // Apply hero position (endless/campaign replays)
    if (b.hero && frame.hero) {
      const fh = frame.hero;
      const nh = nextFrame?.hero;
      const prevX = b.hero.x;
      const prevY = b.hero.y;
      if (nh && lerp > 0 && !fh.dead) {
        b.hero.x = fh.x + (nh.x - fh.x) * lerp;
        b.hero.y = fh.y + (nh.y - fh.y) * lerp;
        b.hero.angle = _lerpAngle(fh.ang, nh.ang, lerp);
        b.hero.hullAngle = _lerpAngle(fh.hull, nh.hull, lerp);
      } else {
        b.hero.x = fh.x;
        b.hero.y = fh.y;
        b.hero.angle = fh.ang;
        b.hero.hullAngle = fh.hull;
      }
      b.hero.hp = fh.hp;
      b.hero.dead = fh.dead;

      // Drive hero animation from movement + fire/hit events
      if (b.hero.animId && sprites.hasAnimatedUnit(b.hero.animId)) {
        const dx = b.hero.x - prevX;
        const dy = b.hero.y - prevY;
        const isMoving = (dx * dx + dy * dy) > 1;
        if (isMoving !== b.hero._wasMoving) {
          b.hero._wasMoving = isMoving;
          sprites.setUnitAnimTrigger(b.hero.animId, isMoving ? 'move' : 'idle');
        }
        // Drive turret aim (relative angle in degrees, same as live gameplay)
        const relativeAim = (b.hero.angle || 0) - (b.hero.hullAngle || 0);
        sprites.setUnitAimAngle(b.hero.animId, relativeAim * 180 / Math.PI);
      }
    }

    // Drive fire/hit animation triggers from event log
    this._applyAnimTriggers(b, this.currentTime);

    // Apply projectiles — no interpolation, just show current frame's projectiles
    b.projectiles = (frame.projectiles || []).map(p => ({
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      owner: p.owner,
      type: p.type,
      dead: false
    }));

    // Reconstruct speech bubbles from event log
    this._applySpeechBubbles(b, this.currentTime);
  }

  /**
   * Scan event log for speech events near the current time and apply
   * _speechBubble to the corresponding unit objects.
   */
  _applySpeechBubbles(b, currentTime) {
    const BUBBLE_DURATION = 2500;
    const events = this.replay.events || [];
    const allUnits = [...b.units, ...b.enemies];

    // Clear expired or future bubbles (handles seeking backwards)
    for (const u of allUnits) {
      if (!u._speechBubble) continue;
      const age = currentTime - u._speechBubble._replayT;
      if (age < 0 || age > BUBBLE_DURATION) {
        u._speechBubble = null;
      }
    }

    // Find speech events within the bubble window
    for (const ev of events) {
      if (ev.type !== 'speech') continue;
      const age = currentTime - ev.t;
      if (age < 0 || age > BUBBLE_DURATION) continue;

      // Find the unit this bubble belongs to
      const unit = allUnits.find(u => u.id === ev.who);
      if (!unit || unit.dead) continue;

      // Only apply if this is newer than any existing bubble
      if (unit._speechBubble && unit._speechBubble._replayT >= ev.t) continue;

      // Use Date.now() offset so the renderer's fade timing works correctly
      unit._speechBubble = {
        text: ev.action,
        t: Date.now() - age,  // set as if it started `age` ms ago
        _replayT: ev.t        // replay-relative timestamp for comparison
      };
    }
  }

  /**
   * Scan event log for fire/hit events near the current time and
   * trigger one-shot animations on the corresponding units.
   */
  _applyAnimTriggers(b, currentTime) {
    const events = this.replay.events || [];
    const TRIGGER_WINDOW = 150; // ms — only trigger if event is very recent

    // Track last processed event index to avoid re-triggering on the same frame
    if (this._lastTriggerIdx === undefined) this._lastTriggerIdx = -1;

    // On seek backwards, reset so we don't skip events
    if (this._lastTriggerTime > currentTime) this._lastTriggerIdx = -1;
    this._lastTriggerTime = currentTime;

    for (let i = Math.max(0, this._lastTriggerIdx + 1); i < events.length; i++) {
      const ev = events[i];
      if (ev.t > currentTime) break; // future events
      if (currentTime - ev.t > TRIGGER_WINDOW) continue; // too old

      this._lastTriggerIdx = i;

      if (ev.type === 'fire' || ev.type === 'hit') {
        // Find the unit that did the action
        if (ev.who === 'hero' && b.hero?.animId) {
          sprites.triggerUnitAnim(b.hero.animId, ev.type);
        } else {
          const unit = b.units.find(u => u.id === ev.who) || b.enemies.find(u => u.id === ev.who);
          if (unit?.animId && sprites.hasAnimatedUnit(unit.animId)) {
            sprites.triggerUnitAnim(unit.animId, ev.type);
          }
        }
      }
    }
  }

  _renderFrame() {
    const b = this.battle;
    if (!b || !this.renderer) return;

    const container = this.renderer._container;
    if (!container) return;

    // Use hero camera for replays with a hero, fire range camera otherwise
    const zoom = (b.hero && !b.hero.observer)
      ? updateHeroCamera(b, container.offsetWidth, container.offsetHeight)
      : updateFireRangeCamera(b, container.offsetWidth, container.offsetHeight);
    this.renderer.setCamera(b.camera.x, b.camera.y, zoom);
    this.renderer.render(b);
  }
}

/**
 * Lerp between two angles using shortest path.
 */
function _lerpAngle(a, b, t) {
  let diff = b - a;
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
