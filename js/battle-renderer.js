// ═══════════════════════════════════════════════════════════════
// BATTLE RENDERER - Canvas-based rendering for hero battle mode
// Composes CanvasViewport + EntityRenderer to replace DOM-heavy drawHeroBattle()
// ═══════════════════════════════════════════════════════════════

import { CanvasViewport } from './canvas-viewport.js';
import { EntityRenderer } from './entity-renderer.js';
import { renderBaseTerrainToCanvas, renderCanopyToCanvas } from './world-builder/terrain-renderer.js';
import { queryTerrain } from './terrain-query.js';
import { buildCostFn } from './pathfinding.js';

/**
 * BattleRenderer manages the full canvas rendering pipeline for hero battle mode.
 * Mounts into a container element (e.g. .campaign-battlefield) and replaces all
 * DOM-based entity rendering with canvas drawing.
 *
 * Layer stack (bottom to top):
 *   terrain  — pre-rendered base terrain (ground, water)
 *   entities — units, hero, enemies, projectiles (redrawn each frame)
 *   effects  — canopy overlay, targeting indicators, HUD overlays
 */
export class BattleRenderer {
  constructor(container) {
    this._container = container;
    this._viewport = new CanvasViewport(container, ['terrain', 'entities', 'effects']);
    this._entityRenderer = new EntityRenderer();

    // Cached pre-rendered layers (rendered once from battle terrain data)
    this._terrainCache = null; // Canvas element from renderBaseTerrainToCanvas
    this._canopyCache = null;  // Canvas element from renderCanopyToCanvas
    this._mapWidth = 0;
    this._mapHeight = 0;

    // Camera state (offset-only, no zoom — matches existing game camera)
    this._camera = { x: 0, y: 0 };

    // Targeting mode overlay
    this._commandMode = null;

    this._initialized = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // SETUP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize: create canvases and start render loop.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    this._viewport.createCanvases();
    this._viewport.startRenderLoop(() => this._render());
  }

  /**
   * Pre-render terrain and canopy from battle terrain data.
   * Called once when battle starts (same data as current renderBaseTerrainToCanvas calls).
   * @param {string[][]} terrain - 2D grid of terrain type strings
   * @param {number} cellSize - Cell size in pixels
   */
  setTerrain(terrain, cellSize) {
    if (!terrain || !terrain.length) return;

    const rows = terrain.length;
    const cols = terrain[0]?.length || 0;
    this._mapWidth = cols * cellSize;
    this._mapHeight = rows * cellSize;

    // Pre-render terrain and canopy to offscreen canvases
    this._terrainCache = renderBaseTerrainToCanvas(terrain, cellSize);
    this._canopyCache = renderCanopyToCanvas(terrain, cellSize);

    this._viewport.requestRender();
  }

  /**
   * Set terrain from pre-rendered canvases (from PCG pipeline).
   * @param {HTMLCanvasElement} terrainCanvas - Pre-rendered ground layer
   * @param {HTMLCanvasElement} canopyCanvas - Pre-rendered canopy layer
   * @param {number} mapWidth - Map width in pixels
   * @param {number} mapHeight - Map height in pixels
   */
  setTerrainFromCanvases(terrainCanvas, canopyCanvas, mapWidth, mapHeight) {
    this._terrainCache = terrainCanvas;
    this._canopyCache = canopyCanvas;
    this._terrainGridCache = null;   // Invalidate grid overlay
    this._terrainGridCacheKey = null;
    this._mapWidth = mapWidth;
    this._mapHeight = mapHeight;
    this._viewport.requestRender();
  }

  /**
   * Clean up: stop render loop, remove canvases, release caches.
   */
  destroy() {
    this._viewport.destroy();
    this._terrainCache = null;
    this._canopyCache = null;
    this._terrainGridCache = null;
    this._terrainGridCacheKey = null;
    this._battleState = null;
    this._entityRenderer = null;
    this._initialized = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // PER-FRAME
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update camera position and zoom (game.js calls this each frame).
   * @param {number} x - Camera X offset in world pixels
   * @param {number} y - Camera Y offset in world pixels
   * @param {number} [zoom=1] - Zoom level (>1 = zoomed in)
   */
  setCamera(x, y, zoom = 1) {
    this._camera.x = x;
    this._camera.y = y;
    this._zoom = zoom;
    this._viewport.setViewport(-x * zoom, -y * zoom, zoom);
  }

  /**
   * Render a full frame of the battle. Called by game loop.
   * @param {object} b - Battle state { hero, units, enemies, projectiles, squad, commandMode }
   */
  render(b) {
    if (!this._initialized) return;

    this._commandMode = b.commandMode || null;

    // Mark viewport dirty so the render loop fires
    this._viewport.requestRender();

    // Store battle state for the render callback
    this._battleState = b;
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNAL RENDER PIPELINE
  // ═══════════════════════════════════════════════════════════════

  _render() {
    const b = this._battleState;
    if (!b) return;

    const now = performance.now();

    // FPS tracking
    if (!this._fpsFrames) this._fpsFrames = [];
    this._fpsFrames.push(now);
    while (this._fpsFrames.length > 0 && this._fpsFrames[0] < now - 1000) this._fpsFrames.shift();

    // Clear all canvases, apply viewport transform (camera offset)
    this._viewport.clearAndTransformAll('#0d0d1a');

    // Layer 1: Terrain (pre-rendered, just blit with camera offset)
    this._renderTerrain();

    // Layer 2: Entities (units, hero, enemies, projectiles)
    this._renderEntities(b, now);

    // Layer 3: Effects (canopy on top, targeting indicator, terrain label)
    this._renderCanopy();
    if (b.showTerrainGrid >= 1) this._renderTerrainGrid(b);
    this._renderTargetingOverlay(b);
    this._renderTerrainLabel(b);
    this._renderFPS();
  }

  _renderTerrain() {
    if (!this._terrainCache) return;
    const ctx = this._viewport.getContext('terrain');
    if (!ctx) return;

    // Draw pre-rendered terrain at world origin (viewport transform handles camera offset)
    ctx.drawImage(this._terrainCache, 0, 0);
  }

  _renderEntities(b, now) {
    const ctx = this._viewport.getContext('entities');
    if (!ctx) return;

    // Spawn zone indicators (below entities)
    if (b.blueSpawnZone || b.redSpawnZone) {
      this._entityRenderer.renderSpawnZones(ctx, b);
    }

    this._entityRenderer.renderAll(ctx, b, now);

    // Debug overlays (fire range telemetry)
    if (b.debugOverlay) {
      this._entityRenderer.renderDebugOverlays(ctx, b, now);
    }
  }

  _renderCanopy() {
    if (!this._canopyCache) return;
    const ctx = this._viewport.getContext('effects');
    if (!ctx) return;

    // Draw canopy at world origin (above entities)
    ctx.drawImage(this._canopyCache, 0, 0);
  }

  _renderTargetingOverlay(b) {
    if (this._commandMode !== 'selectTarget') return;

    const ctx = this._viewport.getContext('effects');
    if (!ctx) return;

    // Draw targeting indicator in screen space (not world space)
    const dpr = this._viewport.dpr;
    const sw = this._viewport.screenWidth;
    const sh = this._viewport.screenHeight;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to screen space

    const text = '🎯 TAP AN ENEMY TO TARGET';
    ctx.font = 'bold 16px sans-serif';
    const metrics = ctx.measureText(text);
    const tw = metrics.width + 40;
    const th = 40;
    const tx = (sw - tw) / 2;
    const ty = (sh - th) / 2;

    // Background pill
    ctx.fillStyle = 'rgba(255, 100, 100, 0.9)';
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 8);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sw / 2, sh / 2);

    ctx.restore();
  }

  _renderTerrainLabel(b) {
    if (!b.terrainLabel) return;

    // Fade out after 5 seconds
    const elapsed = (Date.now() - (b._battleStartTime || Date.now())) / 1000;
    if (elapsed > 6) return;
    const alpha = elapsed < 4 ? 1.0 : Math.max(0, 1.0 - (elapsed - 4) / 2);

    const ctx = this._viewport.getContext('effects');
    if (!ctx) return;

    const dpr = this._viewport.dpr;
    const sw = this._viewport.screenWidth;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Screen space
    ctx.globalAlpha = alpha;

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Shadow for readability
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(b.terrainLabel, sw / 2 + 1, 31);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(b.terrainLabel, sw / 2, 30);

    ctx.restore();
  }

  /**
   * Render terrain debug overlay. Mode cycles: 1 = density heatmap, 2 = A* grid.
   */
  _renderTerrainGrid(b) {
    const tm = b.terrainMap;
    if (!tm) return;

    const mode = b.showTerrainGrid; // 1 or 2
    const ctx = this._viewport.getContext('effects');
    if (!ctx) return;

    // Cache key includes mode so switching modes regenerates
    const cacheKey = `${mode}_${tm.version || 0}`;
    if (!this._terrainGridCache || this._terrainGridCacheKey !== cacheKey) {
      this._terrainGridCache = mode === 1
        ? this._buildDensityHeatmap(b)
        : this._buildPathGrid(b);
      this._terrainGridCacheKey = cacheKey;
    }

    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this._terrainGridCache, 0, 0);
    ctx.restore();

    // Draw legend in screen space (top-right corner)
    const dpr = this._viewport.dpr;
    const sw = this._viewport.screenWidth;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const legendItems = mode === 1
      ? [
          ['#1a6b1a', 'Forest'],
          ['#8b7d3c', 'Brush'],
          ['#2266cc', 'Water'],
          ['#888888', 'Open'],
          ['#ff2222', 'Blocked'],
          ['#ff8800', 'Bridge'],
        ]
      : [
          ['#22cc44', 'Fast'],
          ['#cccc22', 'Medium'],
          ['#cc4422', 'Slow'],
          ['#111111', 'Blocked'],
          ['#2266cc', 'Water'],
          ['#ff8800', 'Bridge'],
        ];
    const title = mode === 1 ? 'DENSITY' : 'A* GRID';
    const lx = sw - 90;
    const ly = 8;
    const lh = legendItems.length * 14 + 22;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(lx - 4, ly - 4, 88, lh);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(title, lx, ly + 7);

    ctx.font = '10px monospace';
    legendItems.forEach(([color, label], i) => {
      const iy = ly + (i + 1) * 14 + 7;
      ctx.fillStyle = color;
      ctx.fillRect(lx, iy - 5, 10, 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx + 14, iy);
    });

    ctx.restore();
  }

  /**
   * Mode 1: Density heatmap — 8px grid, colored by queryTerrain() results.
   */
  _buildDensityHeatmap(b) {
    const tm = b.terrainMap;
    const mapW = tm.gridWidth * tm.cellSize;
    const mapH = tm.gridHeight * tm.cellSize;
    const step = 8;
    const cols = Math.ceil(mapW / step);
    const rows = Math.ceil(mapH / step);

    const canvas = document.createElement('canvas');
    canvas.width = mapW;
    canvas.height = mapH;
    const ctx = canvas.getContext('2d');

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = (col + 0.5) * step;
        const wy = (row + 0.5) * step;
        const result = queryTerrain(tm, wx, wy);

        let r, g, bl;

        if (result.isBlocked) {
          r = 255; g = 34; bl = 34; // Red — blocked
        } else if (result.isBridge) {
          r = 255; g = 136; bl = 0; // Orange — bridge
        } else if (result.water >= 0.3) {
          // Water depth gradient — deeper = darker blue
          const d = Math.min(result.water, 1.0);
          r = Math.round(20 * (1 - d));
          g = Math.round(60 + 40 * (1 - d));
          bl = Math.round(140 + 115 * d);
        } else if (result.dominant === 'forest') {
          // Forest — green intensity by cover
          const c = Math.min(result.cover * 4, 1.0); // 0-1 range
          r = Math.round(20 + 6 * (1 - c));
          g = Math.round(60 + 47 * c);
          bl = Math.round(20 + 6 * (1 - c));
        } else if (result.dominant === 'brush') {
          // Brush — olive/tan intensity by cover
          const c = Math.min(result.cover * 10, 1.0);
          r = Math.round(100 + 39 * c);
          g = Math.round(100 + 25 * c);
          bl = Math.round(50 + 10 * c);
        } else {
          // Open — gray
          r = 136; g = 136; bl = 136;
        }

        ctx.fillStyle = `rgb(${r},${g},${bl})`;
        ctx.fillRect(col * step, row * step, step, step);
      }
    }

    return canvas;
  }

  /**
   * Mode 2: A* pathfinding grid — 32px cells colored by movement cost.
   */
  _buildPathGrid(b) {
    const { costFn, gridWidth: gridW, gridHeight: gridH, cellSize } = buildCostFn(b);
    const mapW = gridW * cellSize;
    const mapH = gridH * cellSize;

    const canvas = document.createElement('canvas');
    canvas.width = mapW;
    canvas.height = mapH;
    const ctx = canvas.getContext('2d');

    const fontSize = Math.max(7, cellSize * 0.28);
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const cost = costFn(row, col);
        const x = col * cellSize;
        const y = row * cellSize;

        let r, g, bl;
        if (cost === Infinity) {
          r = 17; g = 17; bl = 17; // Black — blocked
        } else if (cost >= 3.0) {
          // Water costs (3-25) — blue gradient
          const t = Math.min((cost - 3) / 22, 1.0);
          r = Math.round(20 * (1 - t));
          g = Math.round(60 + 40 * (1 - t));
          bl = Math.round(140 + 115 * t);
        } else {
          // Speed-based cost (1.0 = fast green, 2.0+ = slow red)
          const t = Math.min((cost - 1.0) / 1.0, 1.0); // 0=fast, 1=slow
          r = Math.round(34 + 170 * t);
          g = Math.round(204 - 170 * t);
          bl = Math.round(68 * (1 - t));
        }

        ctx.fillStyle = `rgb(${r},${g},${bl})`;
        ctx.fillRect(x, y, cellSize, cellSize);

        // Cost label
        if (cost !== Infinity) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          const tw = cellSize * 0.85;
          const th = fontSize + 2;
          const cx = x + cellSize / 2;
          const cy = y + cellSize / 2;
          ctx.fillRect(cx - tw / 2, cy - th / 2, tw, th);

          ctx.fillStyle = '#fff';
          ctx.fillText(cost.toFixed(1), cx, cy);
        }
      }
    }

    // Grid lines
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.5;
    for (let row = 0; row <= gridH; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * cellSize);
      ctx.lineTo(mapW, row * cellSize);
      ctx.stroke();
    }
    for (let col = 0; col <= gridW; col++) {
      ctx.beginPath();
      ctx.moveTo(col * cellSize, 0);
      ctx.lineTo(col * cellSize, mapH);
      ctx.stroke();
    }

    return canvas;
  }

  _renderFPS() {
    const fps = this._fpsFrames ? this._fpsFrames.length : 0;
    const el = this._container.parentElement?.querySelector('.fps-display');
    if (el) {
      el.textContent = `${fps} FPS`;
      el.style.color = fps >= 55 ? '#0f0' : fps >= 30 ? '#ff0' : '#f00';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // INPUT / ACCESS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns the topmost canvas element (for event attachment: mouse, touch).
   */
  get canvas() {
    return this._viewport.topCanvas;
  }

  get containerElement() {
    return this._container;
  }

  get screenWidth() { return this._viewport.screenWidth; }
  get screenHeight() { return this._viewport.screenHeight; }
  get mapWidth() { return this._mapWidth; }
  get mapHeight() { return this._mapHeight; }

  /**
   * Hit-test a screen position against battle entities.
   * @param {number} screenX - X in CSS pixels relative to container
   * @param {number} screenY - Y in CSS pixels relative to container
   * @returns {{ type: string, id: string, entity: object }|null}
   */
  hitTest(screenX, screenY) {
    if (!this._battleState) return null;
    const world = this._viewport.screenToWorld(screenX, screenY);
    return this._entityRenderer.hitTest(world.x, world.y, this._battleState);
  }

  /**
   * Convert screen coords (relative to container) to world coords.
   */
  screenToWorld(screenX, screenY) {
    return this._viewport.screenToWorld(screenX, screenY);
  }
}
