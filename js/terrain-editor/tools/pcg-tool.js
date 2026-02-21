// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - PCG Tool
// Procedural battlefield generation via slider panel
// ═══════════════════════════════════════════════════════════════

import { generateBattlefield, PCG_DEFAULTS } from '../pcg.js';
import { randomizeBattleConfig } from '../../world-builder/battle-terrain.js';

// Stroke type → preview color
const PREVIEW_COLORS = {
  forest:        '#2d5a27',
  brush:         '#6b8f3c',
  water:         '#2563eb',
  groundTexture: '#8b7355'
};

/**
 * Set up generic min/max slider coupling.
 * Any slider with data-coupled-max="otherId" will enforce: this.value <= other.value
 * Any slider with data-coupled-min="otherId" will enforce: this.value >= other.value
 * Updates both the partner slider value and its displayed label.
 */
function setupSliderCoupling() {
  const coupled = document.querySelectorAll('[data-coupled-min], [data-coupled-max]');
  for (const slider of coupled) {
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);

      // This slider has a max partner: ensure max >= this value
      const maxId = slider.dataset.coupledMax;
      if (maxId) {
        const maxSlider = document.getElementById(maxId);
        if (maxSlider && parseFloat(maxSlider.value) < val) {
          maxSlider.value = val;
          const maxLabel = document.getElementById(maxId + '-val');
          if (maxLabel) maxLabel.textContent = maxSlider.value;
        }
      }

      // This slider has a min partner: ensure min <= this value
      const minId = slider.dataset.coupledMin;
      if (minId) {
        const minSlider = document.getElementById(minId);
        if (minSlider && parseFloat(minSlider.value) > val) {
          minSlider.value = val;
          const minLabel = document.getElementById(minId + '-val');
          if (minLabel) minLabel.textContent = minSlider.value;
        }
      }
    });
  }
}

/**
 * PCG Tool - generates terrain from parameters instead of mouse input
 */
export const PCGTool = {
  name: 'pcg',
  icon: '🌍',
  cursor: 'default',

  /** Strokes from last generation (for preview) */
  _lastResult: null,
  /** Seed from last generation (reused in live mode) */
  _lastSeed: null,
  /** Whether coupling has been set up */
  _couplingReady: false,

  onActivate(state, renderer) {
    console.log('[PCGTool] Activated');

    // Set up slider coupling on first activation
    if (!this._couplingReady) {
      setupSliderCoupling();
      // Debug checkbox redraws preview
      const debugCb = document.getElementById('pcg-preview-debug');
      if (debugCb) {
        debugCb.addEventListener('change', () => {
          if (this._lastResult) {
            this._drawPreview(this._lastResult.strokes, this._lastResult.mapBounds, this._lastResult.spawnZones, this._lastResult.riverData);
          }
        });
      }
      this._couplingReady = true;
    }

    // Hide all normal property panel sections
    const properties = document.querySelector('.properties');
    if (properties) {
      for (const child of properties.children) {
        if (child.id === 'pcg-settings') continue;
        if (child.style) child.dataset.pcgHidden = child.style.display;
        child.style.display = 'none';
      }
    }

    // Show PCG panel
    const panel = document.getElementById('pcg-settings');
    if (panel) panel.style.display = 'block';

    // Draw existing preview if we have one
    if (this._lastResult) {
      this._drawPreview(this._lastResult.strokes, this._lastResult.mapBounds, this._lastResult.spawnZones, this._lastResult.riverData);
    }
  },

  onDeactivate(state, renderer) {
    // Hide PCG panel
    const panel = document.getElementById('pcg-settings');
    if (panel) panel.style.display = 'none';

    // Restore normal property panel sections
    const properties = document.querySelector('.properties');
    if (properties) {
      for (const child of properties.children) {
        if (child.id === 'pcg-settings') continue;
        const prev = child.dataset.pcgHidden;
        if (prev !== undefined) {
          child.style.display = prev;
          delete child.dataset.pcgHidden;
        }
      }
    }
  },

  /**
   * Run PCG generation
   * @param {Object} state - EditorState
   * @param {Object} renderer - Renderer instance
   * @param {Object} [paramOverrides] - Override specific params
   */
  generate(state, renderer, paramOverrides = {}) {
    const params = this._getParamsFromUI(state);
    Object.assign(params, paramOverrides);

    const mapBounds = {
      width: state.canvasWidth,
      height: state.canvasHeight
    };

    // Show loading overlay, then run generation after it paints
    renderer._showLoadingOverlay('Generating battlefield...');

    // Double rAF ensures the overlay actually renders before we block
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this._doGenerate(state, renderer, params, paramOverrides, mapBounds);

      // Force synchronous render (including cache rebuilds) so overlay stays visible
      renderer._render();
      renderer._needsRender = false;

      renderer._hideLoadingOverlay();
    }));
  },

  /**
   * Internal: run the actual generation (called after overlay is visible)
   */
  _doGenerate(state, renderer, params, paramOverrides, mapBounds) {
    console.log('[PCG] Generating battlefield...', { seed: params.seed, biome: params.biome });
    const startTime = performance.now();

    // Save current tool options that we need to override for scatter generation
    const savedOptions = {
      useScatterSystem: state.toolOptions.useScatterSystem,
      season: state.toolOptions.season,
      biome: state.toolOptions.biome,
      floorEnabled: state.toolOptions.floorEnabled
    };

    // Seed logic: live mode reuses last seed, Generate button rolls fresh
    const userEnteredSeed = params.seed !== null;
    if (paramOverrides._live && this._lastSeed !== null && params.seed === null) {
      params.seed = this._lastSeed;
    } else if (params.seed === null) {
      params.seed = Math.floor(Math.random() * 999999);
    }

    // If seed was explicitly entered, resolve battle template and apply to UI + params
    let templateApplied = false;
    if (userEnteredSeed && !paramOverrides._live) {
      const resolved = randomizeBattleConfig(params.seed);
      if (resolved) {
        // Merge template defaults with resolved pcgParams (template only overrides a subset)
        const templateParams = { ...PCG_DEFAULTS, ...resolved.pcgParams };
        this._applyConfigToUI(templateParams, resolved.biome, resolved.season);
        // Override params with resolved values (keep seed)
        const seed = params.seed;
        Object.assign(params, templateParams);
        params.seed = seed;
        params.biome = resolved.biome;
        params.season = resolved.season;
        templateApplied = true;
      }
    }

    // Ensure scatter system is active and biome/season match PCG params.
    // Disable sprite-based floor — PCG uses groundTexture strokes for floor instead.
    state.setToolOptions({
      useScatterSystem: true,
      season: params.season || 'summer',
      biome: params.biome || 'conifer',
      floorEnabled: false
    });

    // Clear existing terrain
    state.clearStrokes();

    // Generate strokes
    const result = generateBattlefield(params, mapBounds);

    // Stash seed for live mode reuse
    this._lastSeed = result.seed;

    // Clear seed input so next Generate rolls fresh (seed shown in preview label)
    const seedInput = document.getElementById('pcg-seed');
    if (seedInput && !paramOverrides._live) seedInput.value = '';

    // Add all strokes to state (batch mode, skip animation)
    for (const stroke of result.strokes) {
      state.addStroke(stroke, true, { skipAnimation: true });
    }

    // Clear trees/brush along path spines (must happen after scatter spawns)
    const pd = result.pathData;
    if (pd && pd.spines.length > 0) {
      for (const spine of pd.spines) {
        // Clear the full visual path width (diameter), or clearWidth slider, whichever is larger
        const clearR = Math.max(pd.clearWidth, spine.width);
        for (const pt of spine.points) {
          state.clearTreesAt(pt.x, pt.y, clearR, 'soft');
          state.clearBrushAt(pt.x, pt.y, clearR, 'soft');
          state.clearBouldersAt(pt.x, pt.y, clearR, 'soft');
        }
      }
    }

    // Store spawn zones on terrainMap for test mode
    state.terrainMap.spawnZones = result.spawnZones || [];

    // Store bridge data on terrainMap for renderer truss overlay
    if (result.riverData?.bridge) {
      const bridge = result.riverData.bridge;
      state.terrainMap.bridges = [bridge];

      // Clear trees/brush along bridge centerline
      const clearR = bridge.width / 2;
      const steps = Math.ceil(bridge.length / 4);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps - 0.5;
        const px = bridge.x + bridge.dirX * bridge.length * t;
        const py = bridge.y + bridge.dirY * bridge.length * t;
        state.clearTreesAt(px, py, clearR, 'soft');
        state.clearBrushAt(px, py, clearR, 'soft');
        state.clearBouldersAt(px, py, clearR, 'soft');
      }
    } else {
      state.terrainMap.bridges = [];
    }

    // Restore original tool options (keep biome/season if template was applied from seed)
    if (templateApplied) {
      savedOptions.biome = params.biome;
      savedOptions.season = params.season;
    }
    state.setToolOptions(savedOptions);

    // Single render
    state.requestRender();

    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`[PCG] Generated ${result.strokes.length} strokes in ${elapsed}ms (seed: ${result.seed})`);

    // Update status with stats
    const status = document.getElementById('pcg-status');
    if (status) {
      const s = result.stats;
      if (s) {
        status.textContent = `${s.total} strokes ${elapsed}ms | 🌲${s.forestPrimaries}+${s.forestSatellites} 🌳${s.treeLines} 💧${s.water} 🌿${s.brush}+${s.approach} 🔗${s.bridges} ⚔${s.chokepoints}${s.paths ? ' 🛤' + s.paths : ''}${s.rocky ? ' 🪨' + s.rocky : ''}${s.boulders ? ' ⛰' + s.boulders : ''}${s.balance ? ' ⚖' + s.balance : ''}${s.waterVeg ? ' 🌱' + s.waterVeg : ''}${s.riverBridge ? ' 🌉' + s.riverBridge : ''}`;
      } else {
        status.textContent = `${result.strokes.length} strokes in ${elapsed}ms`;
      }
    }

    // Draw minimap preview
    this._lastResult = { strokes: result.strokes, mapBounds, spawnZones: result.spawnZones, riverData: result.riverData };
    this._drawPreview(result.strokes, mapBounds, result.spawnZones, result.riverData);

    // Update preview label
    const label = document.getElementById('pcg-preview-label');
    if (label) label.textContent = `Seed: ${result.seed}`;
  },

  /**
   * Draw minimap preview of stroke positions
   */
  _drawPreview(strokes, mapBounds, spawnZones, riverData) {
    const canvas = document.getElementById('pcg-preview-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Scale factor from map coords to preview coords
    const scaleX = w / mapBounds.width;
    const scaleY = h / mapBounds.height;

    // Background (dark terrain base)
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(0, 0, w, h);

    // Draw a subtle grid
    ctx.strokeStyle = '#253525';
    ctx.lineWidth = 0.5;
    const gridStep = 100;
    for (let gx = 0; gx < mapBounds.width; gx += gridStep) {
      const px = gx * scaleX;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < mapBounds.height; gy += gridStep) {
      const py = gy * scaleY;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Draw strokes by layer: ground → forest → brush → paths → bridges → water on top
    // Separate paths (isPath) and bridges (isBridge) from regular ground textures
    const ground = [];
    const paths = [];
    const bridges = [];
    const forests = [];
    const brushes = [];
    const waters = [];

    for (const s of strokes) {
      const type = s.type || 'groundTexture';
      if (type === 'groundTexture' && s.isBridge) bridges.push(s);
      else if (type === 'groundTexture' && s.isPath) paths.push(s);
      else if (type === 'groundTexture') ground.push(s);
      else if (type === 'forest') forests.push(s);
      else if (type === 'brush') brushes.push(s);
      else if (type === 'water' || type === 'waterDepth') waters.push(s);
    }

    const layers = [
      { list: ground,  color: '#8b7355', fillAlpha: 0.25, borderAlpha: 0.3 },
      { list: forests, color: '#2d5a27', fillAlpha: 0.5,  borderAlpha: 0.7 },
      { list: brushes, color: '#6b8f3c', fillAlpha: 0.5,  borderAlpha: 0.7 },
      { list: paths,   color: '#a0845c', fillAlpha: 0.6,  borderAlpha: 0.8 },
      { list: waters,  color: '#2563eb', fillAlpha: 0.8,  borderAlpha: 0.9 },
      { list: bridges, color: '#c4956a', fillAlpha: 0.8,  borderAlpha: 0.9 },
    ];

    for (const layer of layers) {
      if (layer.list.length === 0) continue;
      for (const s of layer.list) {
        const cx = s.x * scaleX;
        const cy = s.y * scaleY;
        const r = s.radius * Math.min(scaleX, scaleY);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);

        ctx.globalAlpha = layer.fillAlpha;
        ctx.fillStyle = layer.color;
        ctx.fill();

        ctx.globalAlpha = layer.borderAlpha;
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1.0;

    // Draw spawn zones (dashed circles)
    if (spawnZones) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      for (const zone of spawnZones) {
        const zx = zone.x * scaleX;
        const zy = zone.y * scaleY;
        const zr = zone.radius * Math.min(scaleX, scaleY);
        ctx.beginPath();
        ctx.arc(zx, zy, zr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }

    // Debug overlay: river entry/exit, bridges, spawn-to-spawn line
    if (document.getElementById('pcg-preview-debug')?.checked && riverData && spawnZones && spawnZones.length >= 2) {
      const s = Math.min(scaleX, scaleY);

      // Spawn-to-spawn line (yellow dashed)
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(spawnZones[0].x * scaleX, spawnZones[0].y * scaleY);
      ctx.lineTo(spawnZones[1].x * scaleX, spawnZones[1].y * scaleY);
      ctx.stroke();
      ctx.setLineDash([]);

      // River entry (green diamond) and exit (red diamond)
      const drawDiamond = (px, py, color) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        const sz = 4;
        ctx.beginPath();
        ctx.moveTo(px, py - sz);
        ctx.lineTo(px + sz, py);
        ctx.lineTo(px, py + sz);
        ctx.lineTo(px - sz, py);
        ctx.closePath();
        ctx.fill();
      };
      if (riverData.entry) drawDiamond(riverData.entry.x * scaleX, riverData.entry.y * scaleY, '#22c55e');
      if (riverData.exit) drawDiamond(riverData.exit.x * scaleX, riverData.exit.y * scaleY, '#ef4444');

      // Bridge position (cyan rectangle)
      if (riverData.bridge) {
        const b = riverData.bridge;
        const bx = b.x * scaleX;
        const by = b.y * scaleY;
        const bw = b.width * s;
        const bl = b.length * s;
        ctx.strokeStyle = '#06b6d4';
        ctx.fillStyle = '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        // Draw rotated rectangle for bridge
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(Math.atan2(b.dirY, b.dirX));
        ctx.fillRect(-bl / 2, -bw / 2, bl, bw);
        ctx.strokeRect(-bl / 2, -bw / 2, bl, bw);
        ctx.restore();
      }
      ctx.globalAlpha = 1.0;
    }

    // Draw map border
    ctx.strokeStyle = '#4a6a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  },

  /**
   * Apply resolved battle config to UI sliders/dropdowns so they reflect the template values.
   */
  _applyConfigToUI(params, biome, season) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el || val === undefined) return;
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else {
        el.value = val;
      }
      // Fire input event for any linked range/number pairs
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Biome + Season
    set('pcg-biome', biome);
    set('pcg-season', season);
    // Forest
    set('pcg-forest-count', params.forestCount);
    set('pcg-forest-min-radius', params.forestMinRadius);
    set('pcg-forest-max-radius', params.forestMaxRadius);
    set('pcg-forest-spacing', params.forestMinSpacing);
    set('pcg-forest-margin', params.forestEdgeMargin);
    set('pcg-flank-bias', params.forestFlankBias);
    set('pcg-center-avoid', params.forestCenterAvoid);
    // Water bodies
    set('pcg-water-count', params.waterCount);
    set('pcg-water-min-radius', params.waterMinRadius);
    set('pcg-water-max-radius', params.waterMaxRadius);
    set('pcg-water-flank', params.waterFlankAnchor);
    set('pcg-water-irregularity', params.waterIrregularity);
    set('pcg-water-depth', params.waterMaxDepth);
    set('pcg-water-depth-falloff', params.waterDepthFalloff);
    set('pcg-water-falloff', params.waterFalloff);
    set('pcg-water-shore-type', params.waterShoreType);
    set('pcg-water-shore-min', params.waterShoreMin);
    set('pcg-water-shore-max', params.waterShoreMax);
    // River
    set('pcg-river-enabled', params.riverEnabled);
    set('pcg-river-width', params.riverWidth);
    set('pcg-river-windiness', params.riverWindiness);
    set('pcg-river-depth', params.riverMaxDepth);
    set('pcg-river-depth-falloff', params.riverDepthFalloff);
    set('pcg-river-falloff', params.riverFalloff);
    set('pcg-river-shore-type', params.riverShoreType);
    set('pcg-river-shore-min', params.riverShoreMin);
    set('pcg-river-shore-max', params.riverShoreMax);
    // Water vegetation
    set('pcg-water-veg-density', params.waterVegDensity);
    set('pcg-water-veg-tree-ratio', params.waterVegTreeRatio);
    // Brush
    set('pcg-brush-count', params.brushCount);
    set('pcg-brush-min-radius', params.brushMinRadius);
    set('pcg-brush-max-radius', params.brushMaxRadius);
    // Particles
    set('pcg-forest-particles', params.forestParticleDensity);
    set('pcg-brush-particles', params.brushParticleDensity);
    // Ground
    set('pcg-ground-amount', params.groundAmount);
    set('pcg-ground-open-intensity', Math.round((params.groundOpenIntensity ?? 0.3) * 100));
    // Paths
    set('pcg-path-enabled', params.pathEnabled);
    set('pcg-path-width', params.pathWidth);
    set('pcg-path-dirt', params.pathDirtIntensity);
    set('pcg-path-grass', params.pathGrassIntensity);
    set('pcg-path-windiness', params.pathWindiness);
    set('pcg-path-clear', params.pathClearWidth);
    // Bridge
    set('pcg-bridge-enabled', params.bridgeEnabled);
    set('pcg-bridge-style', params.bridgeStyle);
    // Rocky ground
    set('pcg-rocky-count', params.rockyCount);
    set('pcg-rocky-intensity', params.rockyIntensity);
    // Boulders
    set('pcg-boulder-count', params.boulderCount);
    set('pcg-boulder-min-radius', params.boulderMinRadius);
    set('pcg-boulder-max-radius', params.boulderMaxRadius);
    // Tactical
    set('pcg-chokepoints', params.chokepoints);
    set('pcg-choke-width', params.chokepointWidth);
  },

  /**
   * Read current parameter values from the UI panel
   */
  _getParamsFromUI(state) {
    const val = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      if (el.type === 'checkbox') return el.checked;
      return el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value;
    };

    const seedRaw = val('pcg-seed', '');
    const seed = (seedRaw === '' || seedRaw === null || isNaN(seedRaw)) ? null : parseInt(seedRaw);

    return {
      seed,
      biome: val('pcg-biome', PCG_DEFAULTS.biome),
      season: val('pcg-season', PCG_DEFAULTS.season),
      // Forest
      forestCount: val('pcg-forest-count', PCG_DEFAULTS.forestCount),
      forestMinRadius: val('pcg-forest-min-radius', PCG_DEFAULTS.forestMinRadius),
      forestMaxRadius: val('pcg-forest-max-radius', PCG_DEFAULTS.forestMaxRadius),
      forestMinSpacing: val('pcg-forest-spacing', PCG_DEFAULTS.forestMinSpacing),
      forestEdgeMargin: val('pcg-forest-margin', PCG_DEFAULTS.forestEdgeMargin),
      forestFlankBias: val('pcg-flank-bias', PCG_DEFAULTS.forestFlankBias),
      forestCenterAvoid: val('pcg-center-avoid', PCG_DEFAULTS.forestCenterAvoid),
      // Water bodies
      waterCount: val('pcg-water-count', PCG_DEFAULTS.waterCount),
      waterMinRadius: val('pcg-water-min-radius', PCG_DEFAULTS.waterMinRadius),
      waterMaxRadius: val('pcg-water-max-radius', PCG_DEFAULTS.waterMaxRadius),
      waterFlankAnchor: val('pcg-water-flank', PCG_DEFAULTS.waterFlankAnchor),
      waterIrregularity: val('pcg-water-irregularity', PCG_DEFAULTS.waterIrregularity),
      waterMaxDepth: val('pcg-water-depth', PCG_DEFAULTS.waterMaxDepth),
      waterDepthFalloff: val('pcg-water-depth-falloff', PCG_DEFAULTS.waterDepthFalloff),
      waterFalloff: val('pcg-water-falloff', PCG_DEFAULTS.waterFalloff),
      waterShoreType: val('pcg-water-shore-type', PCG_DEFAULTS.waterShoreType),
      waterShoreMin: val('pcg-water-shore-min', PCG_DEFAULTS.waterShoreMin),
      waterShoreMax: val('pcg-water-shore-max', PCG_DEFAULTS.waterShoreMax),
      // River
      riverEnabled: val('pcg-river-enabled', PCG_DEFAULTS.riverEnabled),
      riverWidth: val('pcg-river-width', PCG_DEFAULTS.riverWidth),
      riverWindiness: val('pcg-river-windiness', PCG_DEFAULTS.riverWindiness),
      riverMaxDepth: val('pcg-river-depth', PCG_DEFAULTS.riverMaxDepth),
      riverDepthFalloff: val('pcg-river-depth-falloff', PCG_DEFAULTS.riverDepthFalloff),
      riverFalloff: val('pcg-river-falloff', PCG_DEFAULTS.riverFalloff),
      riverShoreType: val('pcg-river-shore-type', PCG_DEFAULTS.riverShoreType),
      riverShoreMin: val('pcg-river-shore-min', PCG_DEFAULTS.riverShoreMin),
      riverShoreMax: val('pcg-river-shore-max', PCG_DEFAULTS.riverShoreMax),
      // Water vegetation
      waterVegDensity: val('pcg-water-veg-density', PCG_DEFAULTS.waterVegDensity),
      waterVegTreeRatio: val('pcg-water-veg-tree-ratio', PCG_DEFAULTS.waterVegTreeRatio),
      // Brush
      brushCount: val('pcg-brush-count', PCG_DEFAULTS.brushCount),
      brushMinRadius: val('pcg-brush-min-radius', PCG_DEFAULTS.brushMinRadius),
      brushMaxRadius: val('pcg-brush-max-radius', PCG_DEFAULTS.brushMaxRadius),
      // Particles (per-feature density %)
      forestParticleDensity: val('pcg-forest-particles', PCG_DEFAULTS.forestParticleDensity),
      brushParticleDensity: val('pcg-brush-particles', PCG_DEFAULTS.brushParticleDensity),
      // Ground texture (open area variation)
      groundAmount: val('pcg-ground-amount', PCG_DEFAULTS.groundAmount),
      groundOpenIntensity: val('pcg-ground-open-intensity', PCG_DEFAULTS.groundOpenIntensity * 100) / 100,
      // Worn paths
      pathEnabled: val('pcg-path-enabled', PCG_DEFAULTS.pathEnabled),
      pathWidth: val('pcg-path-width', PCG_DEFAULTS.pathWidth),
      pathDirtIntensity: val('pcg-path-dirt', PCG_DEFAULTS.pathDirtIntensity),
      pathGrassIntensity: val('pcg-path-grass', PCG_DEFAULTS.pathGrassIntensity),
      pathWindiness: val('pcg-path-windiness', PCG_DEFAULTS.pathWindiness),
      pathClearWidth: val('pcg-path-clear', PCG_DEFAULTS.pathClearWidth),
      // Bridge
      bridgeEnabled: val('pcg-bridge-enabled', PCG_DEFAULTS.bridgeEnabled),
      bridgeStyle: val('pcg-bridge-style', PCG_DEFAULTS.bridgeStyle),
      // Rocky ground
      rockyCount: val('pcg-rocky-count', PCG_DEFAULTS.rockyCount),
      rockyIntensity: val('pcg-rocky-intensity', PCG_DEFAULTS.rockyIntensity),
      // Boulders
      boulderCount: val('pcg-boulder-count', PCG_DEFAULTS.boulderCount),
      boulderMinRadius: val('pcg-boulder-min-radius', PCG_DEFAULTS.boulderMinRadius),
      boulderMaxRadius: val('pcg-boulder-max-radius', PCG_DEFAULTS.boulderMaxRadius),
      boulderTypes: state.toolOptions.boulderTypes ?? ['boulder-erratic', 'boulder-field', 'boulder-outcrop'],
      boulderRatios: state.toolOptions.boulderRatios ?? {},
      boulderFloorTypes: state.toolOptions.boulderFloorTypes ?? ['floor-rock'],
      boulderParticleTypes: state.toolOptions.boulderParticleTypes ?? ['particle-rock'],
      // Tactical
      chokepoints: val('pcg-chokepoints', PCG_DEFAULTS.chokepoints),
      chokepointWidth: val('pcg-choke-width', PCG_DEFAULTS.chokepointWidth)
    };
  }
};
