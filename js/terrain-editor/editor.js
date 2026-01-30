// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Main Entry Point
// Wires all modules together
// ═══════════════════════════════════════════════════════════════

import { createEditorState } from './state.js';
import { createRenderer } from './renderer.js';
import { createToolManager } from './tools/tool-manager.js';
import { PaintTool } from './tools/paint-tool.js';
import { ClearTool } from './tools/clear-tool.js';
import { Events } from './events.js';
import * as Presets from './presets.js';
import { BIOME_PRESETS, SEASON_BIOME_CONFIG, getSeasonBiomeConfig, getConfigSchema, exportConfigString, SCATTER_TYPES, generateForestItems, renderScatterItem, getSpriteKey } from '../world-builder/index.js';

/**
 * Terrain Editor Application
 */
class TerrainEditor {
  constructor() {
    this._state = null;
    this._renderer = null;
    this._toolManager = null;
    this._elements = {};
  }

  async init() {
    console.log('[TerrainEditor] Initializing...');

    // Cache DOM elements
    this._cacheElements();

    // Create state (uses DEFAULT_CONFIG from state.js)
    this._state = createEditorState();

    // Create renderer
    this._renderer = createRenderer(this._state, {
      canvas: this._elements.canvasContainer
    });

    // Load images
    await this._renderer.loadImages();

    // Create tool manager and register tools
    this._toolManager = createToolManager(this._state, this._renderer);
    this._toolManager.register(PaintTool);
    this._toolManager.register(ClearTool);
    // TODO: Register select, transform tools
    this._toolManager.attach(this._renderer.uiCanvas);

    // Bind UI events
    this._bindUIEvents();

    // Subscribe to state events for UI updates
    this._bindStateEvents();

    // Refresh scatter preview now that state events are bound
    // (biome was applied during _bindUIEvents but preview listener wasn't ready yet)
    this._refreshScatterPreview();

    // Initial render
    this._state.emit(Events.RENDER_REQUESTED);

    console.log('[TerrainEditor] Ready!');
  }

  _cacheElements() {
    this._elements = {
      canvasContainer: document.getElementById('canvas-container'),
      mapName: document.getElementById('map-name'),
      mapNameInput: document.getElementById('map-name-input'),

      // Header buttons
      btnNew: document.getElementById('btn-new'),
      btnLoad: document.getElementById('btn-load'),
      btnSave: document.getElementById('btn-save'),
      btnExport: document.getElementById('btn-export'),
      fileInput: document.getElementById('file-input'),

      // Tool buttons
      toolBtns: document.querySelectorAll('.tool-btn[data-tool]'),

      // Brush settings
      brushSize: document.getElementById('brush-size'),
      brushSizeVal: document.getElementById('brush-size-val'),
      falloff: document.getElementById('falloff'),

      // Clear tool settings
      clearSettings: document.getElementById('clear-settings'),
      clearMode: document.getElementById('clear-mode'),

      // Feature buttons
      featureBtns: document.querySelectorAll('.feature-btn'),

      // Ground settings
      groundSettings: document.getElementById('ground-settings'),
      groundTextureType: document.getElementById('ground-texture-type'),
      fadeWidth: document.getElementById('fade-width'),
      fadeWidthVal: document.getElementById('fade-width-val'),
      autoGroundSettings: document.getElementById('auto-ground-settings'),
      autoGroundTexture: document.getElementById('auto-ground-texture'),
      floorRadius: document.getElementById('floor-radius'),
      floorRadiusVal: document.getElementById('floor-radius-val'),
      floorFade: document.getElementById('floor-fade'),
      floorFadeVal: document.getElementById('floor-fade-val'),
      floorIntensity: document.getElementById('floor-intensity'),
      floorIntensityVal: document.getElementById('floor-intensity-val'),

      // Water settings
      waterSettings: document.getElementById('water-settings'),
      waterTextureType: document.getElementById('water-texture-type'),
      waterFadeWidth: document.getElementById('water-fade-width'),
      waterFadeWidthVal: document.getElementById('water-fade-width-val'),
      shoreTextureType: document.getElementById('shore-texture-type'),
      shoreWidth: document.getElementById('shore-width'),
      shoreWidthVal: document.getElementById('shore-width-val'),
      treesInWater: document.getElementById('trees-in-water'),

      // Tree settings
      treeSettings: document.getElementById('tree-settings'),
      presetSelect: document.getElementById('preset-select'),
      customPresetsGroup: document.getElementById('custom-presets-group'),
      btnLoadPreset: document.getElementById('btn-load-preset'),
      btnSavePreset: document.getElementById('btn-save-preset'),
      btnDeletePreset: document.getElementById('btn-delete-preset'),
      treeBtns: document.querySelectorAll('.variant-btn[data-tree]'),
      ageBtns: document.querySelectorAll('.variant-btn[data-age]'),
      ageRatiosContainer: document.getElementById('age-ratios'),
      ageRatioSliders: document.getElementById('age-ratio-sliders'),
      treeScale: document.getElementById('tree-scale'),
      scaleVal: document.getElementById('scale-val'),
      treeDensity: document.getElementById('tree-density'),
      densityVal: document.getElementById('density-val'),
      animationStyle: document.getElementById('animation-style'),

      // Brush/Undergrowth settings
      brushSettings: document.getElementById('brush-settings'),
      brushTypeBtns: document.querySelectorAll('.variant-btn[data-brush]'),
      brushRatiosContainer: document.getElementById('brush-ratios'),
      brushRatioSliders: document.getElementById('brush-ratio-sliders'),
      brushScale: document.getElementById('brush-scale'),
      brushScaleVal: document.getElementById('brush-scale-val'),
      brushDensity: document.getElementById('brush-density'),
      brushDensityVal: document.getElementById('brush-density-val'),
      brushInWater: document.getElementById('brush-in-water'),

      // Floor variant buttons (category cards)
      floorTypeBtns: document.querySelectorAll('.variant-btn[data-floor]'),
      floorRatiosContainer: document.getElementById('floor-ratios'),
      floorRatioSliders: document.getElementById('floor-ratio-sliders'),

      // Particle variant buttons (category cards)
      particleTypeBtns: document.querySelectorAll('.variant-btn[data-particle]'),
      particleRatiosContainer: document.getElementById('particle-ratios'),
      particleRatioSliders: document.getElementById('particle-ratio-sliders'),

      // Particle settings (legacy)
      autoParticles: document.getElementById('auto-particles'),
      particleDensity: document.getElementById('particle-density'),
      particleDensityVal: document.getElementById('particle-density-val'),
      particleSpread: document.getElementById('particle-spread'),
      particleSpreadVal: document.getElementById('particle-spread-val'),
      particleFalloff: document.getElementById('particle-falloff'),
      particleFalloffVal: document.getElementById('particle-falloff-val'),
      particleScale: document.getElementById('particle-scale'),
      particleScaleVal: document.getElementById('particle-scale-val'),
      cascadeDelete: document.getElementById('cascade-delete'),

      // Map settings (hidden panel elements)
      baseLayer: document.getElementById('base-layer'),
      gridSize: document.getElementById('grid-size'),
      biomeSelect: document.getElementById('biome-select'),
      seasonSelect: document.getElementById('season-select'),
      biomeDescription: document.getElementById('biome-description'),
      mapNameInput: document.getElementById('map-name-input'),

      // Header elements (top bar)
      mapNameHeader: document.getElementById('map-name-header'),
      gridSizeHeader: document.getElementById('grid-size-header'),
      baseLayerHeader: document.getElementById('base-layer-header'),
      // Scatter environment (biome/season - for forest/brush in scatter mode)
      scatterEnvironment: document.getElementById('scatter-environment'),

      // Feature tools in toolbar
      featureTools: document.querySelectorAll('.tool-btn.feature-tool'),

      // Generation system toggle
      systemLegacy: document.getElementById('system-legacy'),
      systemScatter: document.getElementById('system-scatter'),
      legacySystemSettings: document.getElementById('legacy-system-settings'),
      scatterSystemSettings: document.getElementById('scatter-system-settings'),
      legacyPresetsSection: document.getElementById('legacy-presets-section'),
      legacyParticleSettings: document.getElementById('legacy-particle-settings'),
      legacyDensityRow: document.getElementById('legacy-density-row'),

      // Scatter Stroke Output controls
      scatterTreeCount: document.getElementById('scatter-tree-count'),
      scatterTreeCountVal: document.getElementById('scatter-tree-count-val'),
      treeSpacing: document.getElementById('tree-spacing'),
      treeSpacingVal: document.getElementById('tree-spacing-val'),

      // Category toggles
      toggleTrees: document.getElementById('toggle-trees'),
      toggleFloor: document.getElementById('toggle-floor'),
      toggleParticles: document.getElementById('toggle-particles'),
      toggleBrush: document.getElementById('toggle-brush'),

      // View settings
      showGrid: document.getElementById('show-grid'),
      gridOpacity: document.getElementById('grid-opacity'),
      gridOpacityVal: document.getElementById('grid-opacity-val'),
      showBoundary: document.getElementById('show-boundary'),
      showParticleDebug: document.getElementById('show-particle-debug'),
      particleDebugRow: document.getElementById('particle-debug-row'),
      useScatterRendering: document.getElementById('use-scatter-rendering'),

      // Scatter preview
      scatterPreviewSection: document.getElementById('scatter-preview-section'),
      scatterPreviewCanvas: document.getElementById('scatter-preview-canvas'),
      scatterPreviewInfo: document.getElementById('scatter-preview-info'),
      showScatterPreview: document.getElementById('show-scatter-preview'),

      // Status bar
      zoomLevel: document.getElementById('zoom-level'),
      cursorPos: document.getElementById('cursor-pos'),
      strokeCount: document.getElementById('stroke-count'),

      // Season Tuning panel
      seasonTuningPanel: document.getElementById('season-tuning-panel'),
      seasonTuningToggle: document.getElementById('season-tuning-toggle'),
      seasonTuningArrow: document.getElementById('season-tuning-arrow'),
      seasonTuningBody: document.getElementById('season-tuning-body'),
      seasonTuningLabel: document.getElementById('season-tuning-label'),
      // Scatter tuning
      tuneFloorType: document.getElementById('tune-floor-type'),
      tuneFloorDensity: document.getElementById('tune-floor-density'),
      tuneFloorDensityVal: document.getElementById('tune-floor-density-val'),
      tuneParticleType: document.getElementById('tune-particle-type'),
      tuneParticleDensity: document.getElementById('tune-particle-density'),
      tuneParticleDensityVal: document.getElementById('tune-particle-density-val'),
      tuneBrushDensity: document.getElementById('tune-brush-density'),
      tuneBrushDensityVal: document.getElementById('tune-brush-density-val'),
      // Canopy tuning
      tuneCanopyHue: document.getElementById('tune-canopy-hue'),
      tuneCanopyHueVal: document.getElementById('tune-canopy-hue-val'),
      tuneCanopySat: document.getElementById('tune-canopy-sat'),
      tuneCanopySatVal: document.getElementById('tune-canopy-sat-val'),
      tuneCanopyBright: document.getElementById('tune-canopy-bright'),
      tuneCanopyBrightVal: document.getElementById('tune-canopy-bright-val'),
      // Ground tuning
      tuneGroundTint: document.getElementById('tune-ground-tint'),
      tuneGroundTintVal: document.getElementById('tune-ground-tint-val'),
      tuneGroundBright: document.getElementById('tune-ground-bright'),
      tuneGroundBrightVal: document.getElementById('tune-ground-bright-val'),
      // Environment tuning
      tuneEnvSnow: document.getElementById('tune-env-snow'),
      tuneEnvPuddles: document.getElementById('tune-env-puddles'),
      tuneEnvFog: document.getElementById('tune-env-fog'),
      tuneEnvFogVal: document.getElementById('tune-env-fog-val'),
      tuneEnvFrost: document.getElementById('tune-env-frost'),
      // Atmosphere tuning
      tuneAtmAmbient: document.getElementById('tune-atm-ambient'),
      tuneAtmAmbientVal: document.getElementById('tune-atm-ambient-val'),
      tuneAtmShadow: document.getElementById('tune-atm-shadow'),
      tuneAtmShadowVal: document.getElementById('tune-atm-shadow-val'),
      tuneAtmWind: document.getElementById('tune-atm-wind'),
      tuneAtmWindVal: document.getElementById('tune-atm-wind-val'),
      // Tuning actions
      tuneReset: document.getElementById('tune-reset'),
      tuneExport: document.getElementById('tune-export'),
      tuneModifiedList: document.getElementById('tune-modified-list'),
      tuneModifiedFields: document.getElementById('tune-modified-fields'),

      // View Options (now in header)
      showGridHeader: document.getElementById('show-grid-header'),
      showBoundaryHeader: document.getElementById('show-boundary-header'),
      showGridPanel: document.getElementById('show-grid-panel'),
      showBoundaryPanel: document.getElementById('show-boundary-panel'),

      // Category cards
      categoryHeaders: document.querySelectorAll('.category-header'),
      catTreesBody: document.getElementById('cat-trees-body'),
      catFloorBody: document.getElementById('cat-floor-body'),
      catParticlesBody: document.getElementById('cat-particles-body'),
      catBrushBody: document.getElementById('cat-brush-body'),

      // Floor spawn (in category card)
      floorSpawnDensity: document.getElementById('floor-spawn-density'),
      floorSpawnDensityVal: document.getElementById('floor-spawn-density-val'),
      floorSpawnScale: document.getElementById('floor-spawn-scale'),
      floorSpawnScaleVal: document.getElementById('floor-spawn-scale-val'),
      floorSpawnRadius: document.getElementById('floor-spawn-radius'),
      floorSpawnRadiusVal: document.getElementById('floor-spawn-radius-val'),
      floorSpawnFalloff: document.getElementById('floor-spawn-falloff'),
      floorSpawnFalloffVal: document.getElementById('floor-spawn-falloff-val'),
      // Particle spawn (in category card)
      particleSpawnDensity: document.getElementById('particle-spawn-density'),
      particleSpawnDensityVal: document.getElementById('particle-spawn-density-val'),
      particleSpawnScale: document.getElementById('particle-spawn-scale'),
      particleSpawnScaleVal: document.getElementById('particle-spawn-scale-val'),
      particleSpawnRadius: document.getElementById('particle-spawn-radius'),
      particleSpawnRadiusVal: document.getElementById('particle-spawn-radius-val'),
      // Brush spawn (in category card)
      brushSpawnDensity: document.getElementById('brush-spawn-density'),
      brushSpawnDensityVal: document.getElementById('brush-spawn-density-val'),
      brushSpawnScale: document.getElementById('brush-spawn-scale'),
      brushSpawnScaleVal: document.getElementById('brush-spawn-scale-val')
    };
  }

  _bindUIEvents() {
    // Header buttons
    this._elements.btnNew.addEventListener('click', () => this._newMap());
    this._elements.btnLoad.addEventListener('click', () => this._elements.fileInput.click());
    this._elements.btnSave.addEventListener('click', () => this._saveMap());
    this._elements.btnExport.addEventListener('click', () => this._exportPNG());
    this._elements.fileInput.addEventListener('change', (e) => this._loadMap(e));

    // Tool buttons (including feature tools)
    this._elements.toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        const feature = btn.dataset.feature;

        // Set active tool
        this._state.activeTool = tool;

        // If this is a feature tool, also set the feature type
        if (feature) {
          this._state.setToolOption('featureType', feature);
          this._updateFeaturePanels(feature);
        }
      });
    });

    // Feature tools in toolbar (separate from utility tools)
    this._elements.featureTools.forEach(btn => {
      btn.addEventListener('click', () => {
        // Update active state for feature tools only
        this._elements.featureTools.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Brush size
    this._elements.brushSize.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this._state.setToolOption('brushRadius', value);
      this._elements.brushSizeVal.textContent = value;
    });

    // Falloff
    this._elements.falloff.addEventListener('change', (e) => {
      this._state.setToolOption('falloff', e.target.value);
    });

    // Clear mode (for clear tool)
    if (this._elements.clearMode) {
      this._elements.clearMode.addEventListener('change', (e) => {
        this._state.setToolOption('clearMode', e.target.value);
      });
    }

    // Header element syncing (top bar to hidden panel elements)
    this._bindHeaderSync();

    // Legacy feature buttons (for backwards compatibility, if they still exist)
    if (this._elements.featureBtns) {
      this._elements.featureBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this._elements.featureBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const feature = btn.dataset.feature;
          this._state.setToolOption('featureType', feature);
          this._updateFeaturePanels(feature);
        });
      });
    }

    // Initialize feature panels based on default (forest)
    this._updateFeaturePanels('forest');

    // Ground texture type
    if (this._elements.groundTextureType) {
      this._elements.groundTextureType.addEventListener('change', (e) => {
        this._state.setToolOption('groundTextureType', e.target.value);
      });
    }

    // Fade width slider
    if (this._elements.fadeWidth) {
      this._elements.fadeWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('fadeWidth', value);
        this._elements.fadeWidthVal.textContent = `${value}px`;
      });
    }

    // Auto-ground texture checkbox
    if (this._elements.autoGroundTexture) {
      this._elements.autoGroundTexture.addEventListener('change', (e) => {
        this._state.setToolOption('autoGroundTexture', e.target.checked);
      });
    }

    // Floor radius slider (percentage beyond canopy) - affects NEW trees only
    if (this._elements.floorRadius) {
      this._elements.floorRadius.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('floorRadiusPercent', value);
        this._elements.floorRadiusVal.textContent = `${value}%`;
      });
    }

    // Floor fade slider - affects NEW trees only
    // 0% = hard edge, 100% = entire ring fades
    if (this._elements.floorFade) {
      this._elements.floorFade.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('floorFade', value);
        this._elements.floorFadeVal.textContent = `${value}%`;
      });
    }

    // Floor intensity slider - affects NEW trees only
    if (this._elements.floorIntensity) {
      this._elements.floorIntensity.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('floorIntensity', value);
        this._elements.floorIntensityVal.textContent = `${value}%`;
      });
    }

    // Water texture type
    if (this._elements.waterTextureType) {
      this._elements.waterTextureType.addEventListener('change', (e) => {
        this._state.setToolOption('waterTextureType', e.target.value);
      });
    }

    // Water fade width
    if (this._elements.waterFadeWidth) {
      this._elements.waterFadeWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('waterFadeWidth', value);
        this._elements.waterFadeWidthVal.textContent = `${value}px`;
      });
    }

    // Shore texture type
    if (this._elements.shoreTextureType) {
      this._elements.shoreTextureType.addEventListener('change', (e) => {
        this._state.setToolOption('shoreTextureType', e.target.value);
      });
    }

    // Shore width
    if (this._elements.shoreWidth) {
      this._elements.shoreWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('shoreWidth', value);
        this._elements.shoreWidthVal.textContent = `${value}px`;
      });
    }

    // Trees in water toggle
    if (this._elements.treesInWater) {
      this._elements.treesInWater.addEventListener('change', (e) => {
        this._state.setToolOption('treesInWater', e.target.checked);
      });
    }

    // Tree type buttons (multi-select)
    this._elements.treeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this._updateSelectedTreeTypes();

        // In scatter mode, manual tree type change switches biome to "Custom"
        if (this._state.toolOptions.useScatterSystem) {
          this._switchBiomeToCustom();
        }
      });
    });

    // Tree scale
    this._elements.treeScale.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) / 100;
      this._state.setToolOption('treeScale', value);
      this._elements.scaleVal.textContent = `${e.target.value}%`;
    });

    // Tree density - affects NEW trees only
    this._elements.treeDensity.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this._state.setToolOption('treeDensity', value);
      this._elements.densityVal.textContent = value;
      // Sync to scatter tree count slider
      if (this._elements.scatterTreeCount) {
        this._elements.scatterTreeCount.value = value;
        if (this._elements.scatterTreeCountVal) this._elements.scatterTreeCountVal.textContent = value;
      }
    });

    // Animation style
    if (this._elements.animationStyle) {
      this._elements.animationStyle.addEventListener('change', (e) => {
        this._state.setToolOption('animationStyle', e.target.value);
      });
    }

    // Preset buttons
    if (this._elements.btnLoadPreset) {
      this._elements.btnLoadPreset.addEventListener('click', () => this._loadPreset());
    }
    if (this._elements.btnSavePreset) {
      this._elements.btnSavePreset.addEventListener('click', () => this._savePreset());
    }
    if (this._elements.btnDeletePreset) {
      this._elements.btnDeletePreset.addEventListener('click', () => this._deletePreset());
    }
    if (this._elements.presetSelect) {
      this._elements.presetSelect.addEventListener('change', () => this._updateDeleteButton());
    }

    // Load custom presets into dropdown on init
    this._loadCustomPresetsIntoDropdown();

    // Age toggles (multiselect)
    this._elements.ageBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this._updateSelectedAges();

        // In scatter mode, manual age change switches biome to "Custom"
        if (this._state.toolOptions.useScatterSystem) {
          this._switchBiomeToCustom();
        }
      });
    });

    // Brush type buttons (multi-select)
    if (this._elements.brushTypeBtns) {
      this._elements.brushTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          this._updateSelectedBrushTypes();
        });
      });
    }

    // Floor type buttons (multi-select)
    if (this._elements.floorTypeBtns) {
      this._elements.floorTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          this._updateSelectedFloorTypes();
        });
      });
    }

    // Particle type buttons (multi-select)
    if (this._elements.particleTypeBtns) {
      this._elements.particleTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          this._updateSelectedParticleTypes();
        });
      });
    }

    // Brush scale
    if (this._elements.brushScale) {
      this._elements.brushScale.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('brushScale', value);
        this._elements.brushScaleVal.textContent = `${e.target.value}%`;
      });
    }

    // Brush density
    if (this._elements.brushDensity) {
      this._elements.brushDensity.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('brushDensity', value);
        this._elements.brushDensityVal.textContent = value;
      });
    }

    // Brush in water toggle
    if (this._elements.brushInWater) {
      this._elements.brushInWater.addEventListener('change', (e) => {
        this._state.setToolOption('brushInWater', e.target.checked);
      });
    }

    // Auto particles checkbox
    if (this._elements.autoParticles) {
      this._elements.autoParticles.addEventListener('change', (e) => {
        this._state.setToolOption('autoParticles', e.target.checked);
        // Show/hide particle settings based on auto-particles toggle
        const display = e.target.checked ? 'block' : 'none';
        ['particle-density-row', 'particle-spread-row', 'particle-falloff-row', 'particle-scale-row'].forEach(id => {
          const row = document.getElementById(id);
          if (row) row.style.display = display;
        });
      });
    }

    // Particle density slider
    if (this._elements.particleDensity) {
      this._elements.particleDensity.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('particleDensity', value);
        this._elements.particleDensityVal.textContent = value;
      });
    }

    // Particle spread slider
    if (this._elements.particleSpread) {
      this._elements.particleSpread.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('particleSpread', value);
        this._elements.particleSpreadVal.textContent = `${value}%`;
      });
    }

    // Particle falloff slider (converts 20-100 range to 0.2-1.0)
    if (this._elements.particleFalloff) {
      this._elements.particleFalloff.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('particleFalloff', value);
        this._elements.particleFalloffVal.textContent = value.toFixed(1);
      });
    }

    // Particle scale slider (converts 5-40 range to 0.05-0.40)
    if (this._elements.particleScale) {
      this._elements.particleScale.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('particleScale', value);
        this._elements.particleScaleVal.textContent = `${e.target.value}%`;
      });
    }

    // Cascade delete checkbox
    if (this._elements.cascadeDelete) {
      this._elements.cascadeDelete.addEventListener('change', (e) => {
        this._state.setToolOption('cascadeDelete', e.target.checked);
      });
    }

    // Base layer
    this._elements.baseLayer.addEventListener('change', (e) => {
      this._state.baseLayer = e.target.value;
    });

    // Biome preset (sets tree ratios, brush types, density defaults)
    if (this._elements.biomeSelect) {
      this._elements.biomeSelect.addEventListener('change', (e) => {
        const biome = e.target.value;
        this._state.setToolOption('biome', biome);

        // Update description text
        const biomePreset = BIOME_PRESETS[biome];
        if (this._elements.biomeDescription && biomePreset) {
          this._elements.biomeDescription.textContent = biomePreset.description;
        }

        // Apply biome settings to tree UI (unless custom)
        if (biome !== 'custom' && biomePreset) {
          // Convert biome tree format to preset format
          // biome: { 'tree-oak': 0.6 } → preset: { oak: 0.6 }
          const treeTypes = [];
          const treeRatios = {};
          for (const [key, ratio] of Object.entries(biomePreset.trees)) {
            const treeType = key.replace('tree-', '');
            treeTypes.push(treeType);
            treeRatios[treeType] = ratio;
          }

          // Build preset object compatible with _applyPreset
          const preset = {
            treeTypes,
            treeRatios,
            selectedAges: Object.keys(biomePreset.ageRatios),
            ageRatios: biomePreset.ageRatios,
            treeScale: this._state.toolOptions.treeScale || 0.08,
            treeDensity: this._state.toolOptions.treeDensity || 5
          };

          this._applyPreset(preset);
        }

        this._refreshSeasonTuning();
        console.log(`[Editor] Biome set to: ${biome}`);
      });
    }

    // Season (affects debris density and colors for new strokes)
    if (this._elements.seasonSelect) {
      this._elements.seasonSelect.addEventListener('change', (e) => {
        this._state.setToolOption('season', e.target.value);
        this._refreshSeasonTuning();
        console.log(`[Editor] Season set to: ${e.target.value}`);
      });
    }

    // Season Tuning panel
    this._bindSeasonTuning();

    // Map name
    this._elements.mapNameInput.addEventListener('change', (e) => {
      this._state.setMetadata({ name: e.target.value });
      this._elements.mapName.textContent = e.target.value;
    });

    // Grid size (creates new map)
    this._elements.gridSize.addEventListener('change', (e) => {
      const size = parseInt(e.target.value);
      if (confirm(`This will create a new ${size}x${size} map. Continue?`)) {
        this._state.newMap({
          gridWidth: size,
          gridHeight: size,
          cellSize: 64
        });
      } else {
        // Reset select to current value
        e.target.value = this._state.gridWidth;
      }
    });

    // View settings (hidden elements - bound for compatibility)
    this._elements.showGrid.addEventListener('change', (e) => {
      this._state.setViewSetting('showGrid', e.target.checked);
      // Sync panel checkbox
      if (this._elements.showGridPanel) {
        this._elements.showGridPanel.checked = e.target.checked;
      }
    });

    this._elements.gridOpacity.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) / 100;
      this._state.setViewSetting('gridOpacity', value);
      this._elements.gridOpacityVal.textContent = `${e.target.value}%`;
    });

    this._elements.showBoundary.addEventListener('change', (e) => {
      this._state.setViewSetting('showBoundary', e.target.checked);
      // Sync panel checkbox
      if (this._elements.showBoundaryPanel) {
        this._elements.showBoundaryPanel.checked = e.target.checked;
      }
    });

    // View Options - header checkboxes (primary)
    if (this._elements.showGridHeader) {
      this._elements.showGridHeader.addEventListener('change', (e) => {
        this._state.setViewSetting('showGrid', e.target.checked);
        this._elements.showGrid.checked = e.target.checked;
        if (this._elements.showGridPanel) this._elements.showGridPanel.checked = e.target.checked;
      });
    }
    if (this._elements.showBoundaryHeader) {
      this._elements.showBoundaryHeader.addEventListener('change', (e) => {
        this._state.setViewSetting('showBoundary', e.target.checked);
        this._elements.showBoundary.checked = e.target.checked;
        if (this._elements.showBoundaryPanel) this._elements.showBoundaryPanel.checked = e.target.checked;
      });
    }

    // Category card collapse/expand toggles
    if (this._elements.categoryHeaders) {
      this._elements.categoryHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
          // Don't toggle if clicking on the toggle switch area (input, label, or slider span)
          if (e.target.tagName === 'INPUT') return;
          if (e.target.closest('.category-toggle')) return;

          const category = header.dataset.category;
          const body = document.getElementById(`cat-${category}-body`);
          if (body) {
            header.classList.toggle('collapsed');
            body.classList.toggle('collapsed');
          }
        });
      });
    }

    // Particle debug rings toggle
    if (this._elements.showParticleDebug) {
      this._elements.showParticleDebug.addEventListener('change', (e) => {
        this._state.setViewSetting('showParticleDebug', e.target.checked);
      });
    }

    // Generation system toggle (Legacy vs Scatter)
    const updateSystemUI = (useScatter) => {
      // Update state first
      this._state.setViewSetting('useScatterRendering', useScatter);
      this._state.setToolOption('useScatterSystem', useScatter);

      // Update hidden checkbox that renderer uses
      if (this._elements.useScatterRendering) {
        this._elements.useScatterRendering.checked = useScatter;
      }

      // System-level panels (not feature-specific)
      if (this._elements.scatterSystemSettings) {
        this._elements.scatterSystemSettings.style.display = useScatter ? 'block' : 'none';
      }
      if (this._elements.seasonTuningPanel) {
        this._elements.seasonTuningPanel.style.display = useScatter ? 'block' : 'none';
        if (useScatter) this._refreshSeasonTuning();
      }
      if (this._elements.scatterPreviewSection) {
        this._elements.scatterPreviewSection.style.display = useScatter ? 'block' : 'none';
        if (useScatter) this._refreshScatterPreview();
      }
      if (this._elements.particleDebugRow) {
        this._elements.particleDebugRow.style.display = useScatter ? 'none' : 'flex';
      }

      // Category cards (scatter) vs legacy density row
      const categoryCards = document.querySelectorAll('.category-card');
      categoryCards.forEach(card => {
        // Trees card is always shown, others only in scatter mode
        if (card.id === 'cat-trees') {
          card.style.display = 'block';
        } else {
          card.style.display = useScatter ? 'block' : 'none';
        }
      });
      if (this._elements.legacyDensityRow) {
        this._elements.legacyDensityRow.style.display = useScatter ? 'none' : 'block';
      }

      // When switching to scatter, apply biome preset to tree types
      if (useScatter) {
        this._applyBiomeToTreeTypes();
      }

      // Feature panel visibility depends on system mode, so re-run it
      const feature = this._state.toolOptions.featureType || 'forest';
      this._updateFeaturePanels(feature);
    };

    if (this._elements.systemLegacy) {
      this._elements.systemLegacy.addEventListener('change', (e) => {
        if (e.target.checked) updateSystemUI(false);
      });
    }
    if (this._elements.systemScatter) {
      this._elements.systemScatter.addEventListener('change', (e) => {
        if (e.target.checked) updateSystemUI(true);
      });
    }

    // Initialize system UI based on default (scatter)
    updateSystemUI(true);

    // Scatter rendering toggle (hidden, controlled by system toggle above)
    if (this._elements.useScatterRendering) {
      this._elements.useScatterRendering.addEventListener('change', (e) => {
        // Set BOTH the view setting (for renderer) AND the tool option (for generation)
        this._state.setViewSetting('useScatterRendering', e.target.checked);
        this._state.setToolOption('useScatterSystem', e.target.checked);
      });
    }

    // Scatter preview "On Canvas" toggle
    if (this._elements.showScatterPreview) {
      this._elements.showScatterPreview.addEventListener('change', (e) => {
        this._state.setViewSetting('showScatterPreview', e.target.checked);
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // CHILD SPAWN CONTROLS
    // ═══════════════════════════════════════════════════════════════
    this._bindChildSpawnControls();

    // Track cursor position
    this._renderer.uiCanvas.addEventListener('mousemove', (e) => {
      const coords = this._renderer.screenToCanvas(e.clientX, e.clientY);
      this._elements.cursorPos.textContent =
        `${Math.round(coords.x)}, ${Math.round(coords.y)}`;
    });
  }

  _bindStateEvents() {
    // Tool changed
    this._state.on(Events.TOOL_CHANGED, ({ tool }) => {
      const featureTools = ['forest', 'brush', 'water', 'ground'];
      const isFeatureTool = featureTools.includes(tool);

      // Update all tool buttons (utility tools)
      this._elements.toolBtns.forEach(btn => {
        // Feature tools have special handling (green border instead of red)
        if (btn.classList.contains('feature-tool')) {
          btn.classList.toggle('active', btn.dataset.tool === tool);
        } else {
          // Utility tools: active if tool matches AND it's not a feature tool
          btn.classList.toggle('active', btn.dataset.tool === tool && !isFeatureTool);
        }
      });

      // Show/hide clear settings panel
      if (this._elements.clearSettings) {
        this._elements.clearSettings.style.display = tool === 'clear' ? 'block' : 'none';
      }

      // Update feature panels based on tool
      if (isFeatureTool) {
        const feature = this._state.toolOptions.featureType || tool;
        this._updateFeaturePanels(feature);
      }
    });

    // Viewport changed
    this._state.on(Events.VIEWPORT_CHANGED, ({ viewport }) => {
      this._elements.zoomLevel.textContent =
        `${Math.round(viewport.zoom * 100)}%`;
    });

    // Strokes changed
    this._state.on(Events.STROKE_ADDED, () => this._updateStrokeCount());
    this._state.on(Events.STROKE_REMOVED, () => this._updateStrokeCount());
    this._state.on(Events.STROKES_CLEARED, () => this._updateStrokeCount());
    this._state.on(Events.MAP_LOADED, () => this._updateStrokeCount());
    this._state.on(Events.MAP_CLEARED, () => this._updateStrokeCount());

    // Refresh scatter preview when relevant options change
    this._state.on(Events.TOOL_OPTIONS_CHANGED, ({ key }) => {
      const previewKeys = ['treeType', 'treeTypes', 'treeRatios', 'treeScale', 'treeDensity',
        'selectedAges', 'ageRatios', 'brushTypes', 'brushRatios', 'brushDensity', 'brushScale',
        'season', 'biome', 'seasonOverrides', 'childSpawnOverrides', 'brushRadius',
        'useScatterSystem', 'previewSeed'];
      if (!key || previewKeys.includes(key)) {
        this._refreshScatterPreview();
      }
    });
  }

  _updateStrokeCount() {
    this._elements.strokeCount.textContent = this._state.strokes.length;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHILD SPAWN CONTROLS
  // ═══════════════════════════════════════════════════════════════

  _bindChildSpawnControls() {
    const el = this._elements;
    const state = this._state;

    // Helper to update child spawn overrides in state
    const updateOverride = (category, key, value) => {
      const overrides = { ...state.toolOptions.childSpawnOverrides };
      overrides[category] = { ...overrides[category], [key]: value };
      state.setToolOption('childSpawnOverrides', overrides);
      this._refreshScatterPreview();
    };

    // ═══ FLOOR SPAWN ═══
    if (el.floorSpawnDensity) {
      el.floorSpawnDensity.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.floorSpawnDensityVal.textContent = v;
        updateOverride('floor', 'density', v);
      });
    }
    if (el.floorSpawnScale) {
      el.floorSpawnScale.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.floorSpawnScaleVal.textContent = `${v}%`;
        updateOverride('floor', 'scale', v / 100);
      });
    }
    if (el.floorSpawnRadius) {
      el.floorSpawnRadius.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.floorSpawnRadiusVal.textContent = `${v}%`;
        updateOverride('floor', 'radius', v / 100);
      });
    }
    if (el.floorSpawnFalloff) {
      el.floorSpawnFalloff.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.floorSpawnFalloffVal.textContent = `${v}%`;
        updateOverride('floor', 'falloff', v / 100);
      });
    }

    // ═══ PARTICLE SPAWN ═══
    if (el.particleSpawnDensity) {
      el.particleSpawnDensity.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.particleSpawnDensityVal.textContent = v;
        updateOverride('particle', 'density', v);
      });
    }
    if (el.particleSpawnScale) {
      el.particleSpawnScale.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.particleSpawnScaleVal.textContent = `${v}%`;
        updateOverride('particle', 'scale', v / 100);
      });
    }
    if (el.particleSpawnRadius) {
      el.particleSpawnRadius.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.particleSpawnRadiusVal.textContent = `${v}%`;
        updateOverride('particle', 'radius', v / 100);
      });
    }

    // ═══ BRUSH SPAWN ═══
    // Brush density is now a multiplier (0-2.0×) like tree density
    if (el.brushSpawnDensity) {
      el.brushSpawnDensity.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        el.brushSpawnDensityVal.textContent = v.toFixed(1) + '×';
        this._state.setToolOption('brushDensity', v);
      });
    }
    if (el.brushSpawnScale) {
      el.brushSpawnScale.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        el.brushSpawnScaleVal.textContent = `${v}%`;
        this._state.setToolOption('brushScale', v / 100);
      });
    }

  }

  // ═══════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  _newMap() {
    if (this._state.isDirty) {
      if (!confirm('You have unsaved changes. Create new map anyway?')) {
        return;
      }
    }

    const size = parseInt(this._elements.gridSize.value);
    this._state.newMap({
      gridWidth: size,
      gridHeight: size,
      cellSize: 64,
      baseLayer: this._elements.baseLayer.value
    });

    this._elements.mapNameInput.value = 'Untitled Map';
    this._elements.mapName.textContent = 'Untitled Map';
  }

  _saveMap() {
    const data = this._state.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.metadata.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    this._state.markClean();
  }

  _loadMap(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        this._state.loadFromJSON(data);

        // Update UI
        this._elements.mapNameInput.value = data.metadata?.name || 'Untitled Map';
        this._elements.mapName.textContent = data.metadata?.name || 'Untitled Map';
        this._elements.baseLayer.value = data.baseLayer || 'grass';
        this._elements.gridSize.value = data.gridWidth || 12;

        console.log('[TerrainEditor] Map loaded:', data.metadata?.name);
      } catch (err) {
        alert('Failed to load map: ' + err.message);
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    e.target.value = '';
  }

  _exportPNG() {
    // Create a combined canvas
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    // Draw all layers (ground, then features)
    const groundCanvas = document.getElementById('terrain-ground');
    const featuresCanvas = document.getElementById('terrain-features');

    if (groundCanvas) ctx.drawImage(groundCanvas, 0, 0);
    if (featuresCanvas) ctx.drawImage(featuresCanvas, 0, 0);

    // Download
    const url = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this._state.metadata.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
    a.click();
  }

  // ═══════════════════════════════════════════════════════════════
  // PRESETS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load custom presets into the dropdown
   */
  _loadCustomPresetsIntoDropdown() {
    const customPresets = Presets.loadCustomPresets();
    const group = this._elements.customPresetsGroup;
    group.innerHTML = '';

    Object.entries(customPresets).forEach(([id, preset]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = preset.name;
      group.appendChild(option);
    });

    this._updateDeleteButton();
  }

  /**
   * Update delete button state (only enabled for custom presets)
   */
  _updateDeleteButton() {
    if (!this._elements.presetSelect || !this._elements.btnDeletePreset) return;
    const selectedId = this._elements.presetSelect.value;
    const isCustom = !Presets.isBuiltInPreset(selectedId);
    this._elements.btnDeletePreset.style.opacity = isCustom ? '1' : '0.4';
    this._elements.btnDeletePreset.disabled = !isCustom;
  }

  /**
   * Apply current biome preset to tree type UI
   * Called when switching to scatter system or when biome changes
   */
  _applyBiomeToTreeTypes() {
    const biome = this._elements.biomeSelect?.value || 'temperate';
    const biomePreset = BIOME_PRESETS[biome];

    if (!biomePreset || biome === 'custom') return;

    // Convert biome tree format to preset format
    // biome: { 'tree-oak': 0.6 } → preset: { oak: 0.6 }
    const treeTypes = [];
    const treeRatios = {};
    for (const [key, ratio] of Object.entries(biomePreset.trees)) {
      const treeType = key.replace('tree-', '');
      treeTypes.push(treeType);
      treeRatios[treeType] = ratio;
    }

    // Build preset object compatible with _applyPreset
    const preset = {
      treeTypes,
      treeRatios,
      selectedAges: Object.keys(biomePreset.ageRatios),
      ageRatios: biomePreset.ageRatios,
      treeScale: this._state.toolOptions.treeScale || 0.08,
      treeDensity: this._state.toolOptions.treeDensity || 5
    };

    this._applyPreset(preset);

    // Update description
    if (this._elements.biomeDescription) {
      this._elements.biomeDescription.textContent = biomePreset.description;
    }
  }

  /**
   * Switch biome to custom (called when user manually edits tree types in scatter mode)
   */
  _switchBiomeToCustom() {
    if (this._elements.biomeSelect) {
      this._elements.biomeSelect.value = 'custom';
      this._state.setToolOption('biome', 'custom');
      if (this._elements.biomeDescription) {
        this._elements.biomeDescription.textContent = BIOME_PRESETS.custom.description;
      }
    }
  }

  /**
   * Load the selected preset
   */
  _loadPreset() {
    const presetId = this._elements.presetSelect.value;
    const preset = Presets.getPreset(presetId);

    if (!preset) {
      console.warn('[Editor] Preset not found:', presetId);
      return;
    }

    this._applyPreset(preset);
    console.log('[Editor] Loaded preset:', preset.name);
  }

  /**
   * Update feature-specific panels based on selected feature
   */
  _updateFeaturePanels(feature) {
    const useScatter = this._elements.systemScatter?.checked ?? false;

    // Show/hide tree settings (forest feature)
    if (this._elements.treeSettings) {
      this._elements.treeSettings.style.display = feature === 'forest' ? 'block' : 'none';
    }

    // Show/hide brush settings
    if (this._elements.brushSettings) {
      this._elements.brushSettings.style.display = feature === 'brush' ? 'block' : 'none';
    }

    // Show/hide ground settings
    if (this._elements.groundSettings) {
      this._elements.groundSettings.style.display = feature === 'groundTexture' ? 'block' : 'none';
    }

    // Show/hide water settings
    if (this._elements.waterSettings) {
      this._elements.waterSettings.style.display = feature === 'water' ? 'block' : 'none';
    }

    // Show/hide scatter environment (biome/season) - for forest OR brush in scatter mode
    const showEnvironment = useScatter && (feature === 'forest' || feature === 'brush');
    if (this._elements.scatterEnvironment) {
      this._elements.scatterEnvironment.style.display = showEnvironment ? 'block' : 'none';
    }

    // Show/hide legacy settings - only for forest in legacy mode
    if (this._elements.legacySystemSettings) {
      this._elements.legacySystemSettings.style.display =
        (!useScatter && feature === 'forest') ? 'block' : 'none';
    }
    if (this._elements.legacyParticleSettings) {
      this._elements.legacyParticleSettings.style.display =
        (!useScatter && feature === 'forest') ? 'block' : 'none';
    }
    if (this._elements.legacyPresetsSection) {
      this._elements.legacyPresetsSection.style.display =
        (!useScatter && feature === 'forest') ? 'block' : 'none';
    }
  }

  /**
   * Bind header elements to sync with hidden panel elements
   */
  _bindHeaderSync() {
    const el = this._elements;

    // Map name: header <-> hidden input
    if (el.mapNameHeader) {
      el.mapNameHeader.addEventListener('input', (e) => {
        if (el.mapNameInput) el.mapNameInput.value = e.target.value;
        this._state.mapName = e.target.value;
      });
    }

    // Grid size: header -> hidden select
    if (el.gridSizeHeader) {
      el.gridSizeHeader.addEventListener('change', (e) => {
        if (el.gridSize) el.gridSize.value = e.target.value;
        this._state.setGridSize(parseInt(e.target.value));
      });
    }

    // Base layer: header -> hidden select
    if (el.baseLayerHeader) {
      el.baseLayerHeader.addEventListener('change', (e) => {
        if (el.baseLayer) el.baseLayer.value = e.target.value;
        this._state.baseLayer = e.target.value;
      });
    }

  }

  /**
   * Apply a preset to the current state and UI
   */
  _applyPreset(preset) {
    // Update state
    this._state.setToolOption('treeTypes', preset.treeTypes);
    this._state.setToolOption('treeRatios', preset.treeRatios);
    this._state.setToolOption('selectedAges', preset.selectedAges);
    this._state.setToolOption('ageRatios', preset.ageRatios);
    this._state.setToolOption('treeScale', preset.treeScale);
    this._state.setToolOption('treeDensity', preset.treeDensity);

    // Update tree type buttons
    this._elements.treeBtns.forEach(btn => {
      const isSelected = preset.treeTypes.includes(btn.dataset.tree);
      btn.classList.toggle('active', isSelected);
    });

    // Update tree ratio sliders
    if (preset.treeTypes.length > 1) {
      const ratioContainer = document.getElementById('tree-ratios');
      if (ratioContainer) {
        ratioContainer.style.display = 'block';
        this._renderRatioSliders(preset.treeTypes, preset.treeRatios);
      }
    } else {
      const ratioContainer = document.getElementById('tree-ratios');
      if (ratioContainer) ratioContainer.style.display = 'none';
    }

    // Update age buttons
    this._elements.ageBtns.forEach(btn => {
      const isSelected = preset.selectedAges.includes(btn.dataset.age);
      btn.classList.toggle('active', isSelected);
    });

    // Update age ratio sliders
    if (preset.selectedAges.length > 1) {
      this._elements.ageRatiosContainer.style.display = 'block';
      this._renderAgeRatioSliders(preset.selectedAges, preset.ageRatios);
    } else {
      this._elements.ageRatiosContainer.style.display = 'none';
    }

    // Update scale slider
    const scalePercent = Math.round(preset.treeScale * 100);
    this._elements.treeScale.value = scalePercent;
    this._elements.scaleVal.textContent = `${scalePercent}%`;

    // Update density slider
    this._elements.treeDensity.value = preset.treeDensity;
    this._elements.densityVal.textContent = preset.treeDensity;
  }

  /**
   * Save current settings as a new custom preset
   */
  _savePreset() {
    const name = prompt('Enter a name for this preset:');
    if (!name || !name.trim()) return;

    const settings = Presets.extractPresetSettings(this._state.toolOptions);
    const id = Presets.savePreset(name.trim(), settings);

    // Add to dropdown
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name.trim();
    this._elements.customPresetsGroup.appendChild(option);

    // Select the new preset
    this._elements.presetSelect.value = id;
    this._updateDeleteButton();

    console.log('[Editor] Saved preset:', name);
  }

  /**
   * Delete the selected custom preset
   */
  _deletePreset() {
    const presetId = this._elements.presetSelect.value;

    if (Presets.isBuiltInPreset(presetId)) {
      return; // Can't delete built-in presets
    }

    const preset = Presets.getPreset(presetId);
    if (!preset) return;

    if (!confirm(`Delete preset "${preset.name}"?`)) return;

    Presets.deletePreset(presetId);

    // Remove from dropdown
    const option = this._elements.presetSelect.querySelector(`option[value="${presetId}"]`);
    if (option) option.remove();

    // Select first built-in preset
    this._elements.presetSelect.value = 'temperate';
    this._updateDeleteButton();

    console.log('[Editor] Deleted preset:', preset.name);
  }

  // ═══════════════════════════════════════════════════════════════
  // TREE TYPE SELECTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update selected tree types and ratio UI
   */
  _updateSelectedTreeTypes() {
    const selectedTypes = [];
    this._elements.treeBtns.forEach(b => {
      if (b.classList.contains('active')) {
        selectedTypes.push(b.dataset.tree);
      }
    });

    // Ensure at least one is selected
    if (selectedTypes.length === 0) {
      const firstBtn = this._elements.treeBtns[0];
      firstBtn.classList.add('active');
      selectedTypes.push(firstBtn.dataset.tree);
    }

    // Update state with selected types (equal ratios by default)
    const ratios = {};
    const equalRatio = 1 / selectedTypes.length;
    selectedTypes.forEach(type => {
      ratios[type] = equalRatio;
    });

    this._state.setToolOption('treeTypes', selectedTypes);
    this._state.setToolOption('treeRatios', ratios);

    // Show/hide ratio sliders
    const ratioContainer = document.getElementById('tree-ratios');
    const ratioSliders = document.getElementById('ratio-sliders');

    if (selectedTypes.length > 1 && ratioContainer && ratioSliders) {
      ratioContainer.style.display = 'block';
      this._renderRatioSliders(selectedTypes, ratios);
    } else if (ratioContainer) {
      ratioContainer.style.display = 'none';
    }
  }

  /**
   * Update selected ages and ratio UI
   */
  _updateSelectedAges() {
    const selectedAges = [];
    this._elements.ageBtns.forEach(b => {
      if (b.classList.contains('active')) {
        selectedAges.push(b.dataset.age);
      }
    });

    // Ensure at least one is selected
    if (selectedAges.length === 0) {
      const firstBtn = this._elements.ageBtns[0];
      firstBtn.classList.add('active');
      selectedAges.push(firstBtn.dataset.age);
    }

    // Update state with selected ages (equal ratios by default)
    const ratios = {};
    const equalRatio = 1 / selectedAges.length;
    selectedAges.forEach(age => {
      ratios[age] = equalRatio;
    });

    this._state.setToolOption('selectedAges', selectedAges);
    this._state.setToolOption('ageRatios', ratios);

    // Show/hide ratio sliders
    if (selectedAges.length > 1 && this._elements.ageRatiosContainer) {
      this._elements.ageRatiosContainer.style.display = 'block';
      this._renderAgeRatioSliders(selectedAges, ratios);
    } else if (this._elements.ageRatiosContainer) {
      this._elements.ageRatiosContainer.style.display = 'none';
    }
  }

  /**
   * Update selected brush types and ratio UI
   */
  _updateSelectedBrushTypes() {
    const selectedTypes = [];
    this._elements.brushTypeBtns.forEach(b => {
      if (b.classList.contains('active')) {
        selectedTypes.push(b.dataset.brush);
      }
    });

    // Ensure at least one is selected
    if (selectedTypes.length === 0) {
      const firstBtn = this._elements.brushTypeBtns[0];
      firstBtn.classList.add('active');
      selectedTypes.push(firstBtn.dataset.brush);
    }

    // Update state with selected types (equal ratios by default)
    const ratios = {};
    const equalRatio = 1 / selectedTypes.length;
    selectedTypes.forEach(type => {
      ratios[type] = equalRatio;
    });

    this._state.setToolOption('brushTypes', selectedTypes);
    this._state.setToolOption('brushRatios', ratios);

    // Update childSpawnOverrides.brush.type
    const overrides = { ...this._state.toolOptions.childSpawnOverrides };
    overrides.brush = { ...overrides.brush, type: selectedTypes.length === 1 ? selectedTypes[0] : 'auto' };
    this._state.setToolOption('childSpawnOverrides', overrides);

    // Show/hide ratio sliders
    if (selectedTypes.length > 1 && this._elements.brushRatiosContainer) {
      this._elements.brushRatiosContainer.style.display = 'block';
      this._renderBrushRatioSliders(selectedTypes, ratios);
    } else if (this._elements.brushRatiosContainer) {
      this._elements.brushRatiosContainer.style.display = 'none';
    }

    this._refreshScatterPreview();
  }

  /**
   * Render ratio sliders for selected brush types
   */
  _renderBrushRatioSliders(types, ratios) {
    const container = this._elements.brushRatioSliders;
    if (!container) return;

    const labels = {
      'bush-small': 'Bush S',
      'bush-large': 'Bush L',
      'fern-small': 'Fern'
    };

    container.innerHTML = types.map(type => `
      <div class="ratio-row">
        <span class="ratio-label">${labels[type] || type}</span>
        <input type="range" class="ratio-slider brush-ratio-slider" data-brush="${type}"
               min="0" max="100" value="${Math.round(ratios[type] * 100)}">
        <span class="ratio-value brush-ratio-val" data-brush="${type}">${Math.round(ratios[type] * 100)}%</span>
      </div>
    `).join('');

    // Add listeners to ratio sliders
    container.querySelectorAll('.brush-ratio-slider').forEach(slider => {
      slider.addEventListener('input', (e) => this._onBrushRatioChange(e, types));
    });
  }

  /**
   * Handle brush ratio slider change - adjust others so total stays at 100%
   */
  _onBrushRatioChange(e, types) {
    const changedType = e.target.dataset.brush;
    const newValue = parseInt(e.target.value) / 100;
    const currentRatios = this._state.toolOptions.brushRatios || {};

    // Calculate what others should sum to
    const remaining = 1 - newValue;
    const otherTypes = types.filter(t => t !== changedType);
    const otherSum = otherTypes.reduce((sum, t) => sum + (currentRatios[t] || 0), 0);

    // Distribute remaining proportionally among others
    const newRatios = { [changedType]: newValue };
    if (otherSum > 0 && remaining > 0) {
      otherTypes.forEach(t => {
        newRatios[t] = ((currentRatios[t] || 0) / otherSum) * remaining;
      });
    } else if (remaining > 0) {
      // Equal split for others
      const equalShare = remaining / otherTypes.length;
      otherTypes.forEach(t => {
        newRatios[t] = equalShare;
      });
    } else {
      // Zero out others
      otherTypes.forEach(t => {
        newRatios[t] = 0;
      });
    }

    this._state.setToolOption('brushRatios', newRatios);

    // Update all sliders and labels
    const container = this._elements.brushRatioSliders;
    types.forEach(type => {
      const slider = container.querySelector(`[data-brush="${type}"]`);
      const label = container.querySelector(`.brush-ratio-val[data-brush="${type}"]`);
      if (slider && type !== changedType) {
        slider.value = Math.round(newRatios[type] * 100);
      }
      if (label) {
        label.textContent = `${Math.round(newRatios[type] * 100)}%`;
      }
    });
  }

  /**
   * Update selected floor types from variant buttons
   */
  _updateSelectedFloorTypes() {
    const selectedTypes = [];
    this._elements.floorTypeBtns.forEach(b => {
      if (b.classList.contains('active')) {
        selectedTypes.push(b.dataset.floor);
      }
    });

    // Ensure at least one is selected
    if (selectedTypes.length === 0) {
      const firstBtn = this._elements.floorTypeBtns[0];
      if (firstBtn) {
        firstBtn.classList.add('active');
        selectedTypes.push(firstBtn.dataset.floor);
      }
    }

    // Update state
    this._state.setToolOption('floorTypes', selectedTypes);

    // Update childSpawnOverrides.floor.type
    const overrides = { ...this._state.toolOptions.childSpawnOverrides };
    overrides.floor = { ...overrides.floor, type: selectedTypes.length === 1 ? selectedTypes[0] : 'auto' };
    this._state.setToolOption('childSpawnOverrides', overrides);

    // Show/hide ratio sliders
    if (selectedTypes.length > 1 && this._elements.floorRatiosContainer) {
      this._elements.floorRatiosContainer.style.display = 'block';
    } else if (this._elements.floorRatiosContainer) {
      this._elements.floorRatiosContainer.style.display = 'none';
    }

    this._refreshScatterPreview();
  }

  /**
   * Update selected particle types from variant buttons
   */
  _updateSelectedParticleTypes() {
    const selectedTypes = [];
    this._elements.particleTypeBtns.forEach(b => {
      if (b.classList.contains('active')) {
        selectedTypes.push(b.dataset.particle);
      }
    });

    // Ensure at least one is selected
    if (selectedTypes.length === 0) {
      const firstBtn = this._elements.particleTypeBtns[0];
      if (firstBtn) {
        firstBtn.classList.add('active');
        selectedTypes.push(firstBtn.dataset.particle);
      }
    }

    // Update state
    this._state.setToolOption('particleTypes', selectedTypes);

    // Update childSpawnOverrides.particle.type
    const overrides = { ...this._state.toolOptions.childSpawnOverrides };
    overrides.particle = { ...overrides.particle, type: selectedTypes.length === 1 ? selectedTypes[0] : 'auto' };
    this._state.setToolOption('childSpawnOverrides', overrides);

    // Show/hide ratio sliders
    if (selectedTypes.length > 1 && this._elements.particleRatiosContainer) {
      this._elements.particleRatiosContainer.style.display = 'block';
    } else if (this._elements.particleRatiosContainer) {
      this._elements.particleRatiosContainer.style.display = 'none';
    }

    this._refreshScatterPreview();
  }

  /**
   * Format age for display
   */
  _formatAge(age) {
    const labels = {
      young: 'Young',
      transitional: 'Trans',
      old: 'Old'
    };
    return labels[age] || age;
  }

  /**
   * Render ratio sliders for selected ages
   */
  _renderAgeRatioSliders(ages, ratios) {
    const container = this._elements.ageRatioSliders;
    if (!container) return;

    container.innerHTML = ages.map(age => `
      <div class="ratio-row">
        <span class="ratio-label">${this._formatAge(age)}</span>
        <input type="range" class="ratio-slider age-ratio-slider" data-age="${age}"
               min="0" max="100" value="${Math.round(ratios[age] * 100)}">
        <span class="ratio-value age-ratio-val" data-age="${age}">${Math.round(ratios[age] * 100)}%</span>
      </div>
    `).join('');

    // Add listeners to ratio sliders
    container.querySelectorAll('.age-ratio-slider').forEach(slider => {
      slider.addEventListener('input', (e) => this._onAgeRatioChange(e, ages));
    });
  }

  /**
   * Handle age ratio slider change - adjust others so total stays at 100%
   */
  _onAgeRatioChange(e, ages) {
    const changedAge = e.target.dataset.age;
    const newValue = parseInt(e.target.value);

    const sliders = document.querySelectorAll('.age-ratio-slider');
    const otherSliders = [...sliders].filter(s => s.dataset.age !== changedAge);

    // Calculate how much the others need to share
    const remaining = 100 - newValue;

    // Get current total of other sliders
    let otherTotal = 0;
    otherSliders.forEach(s => {
      otherTotal += parseInt(s.value);
    });

    // Distribute remaining among others proportionally
    const ratios = {};
    ratios[changedAge] = newValue / 100;

    if (otherTotal > 0 && remaining > 0) {
      otherSliders.forEach(s => {
        const age = s.dataset.age;
        const proportion = parseInt(s.value) / otherTotal;
        const newVal = Math.round(remaining * proportion);
        s.value = newVal;
        ratios[age] = newVal / 100;
      });
    } else {
      // If others are all 0 or remaining is 0, distribute equally
      const equalShare = remaining / otherSliders.length;
      otherSliders.forEach(s => {
        const age = s.dataset.age;
        s.value = Math.round(equalShare);
        ratios[age] = equalShare / 100;
      });
    }

    // Update all displays
    sliders.forEach(s => {
      const age = s.dataset.age;
      const valSpan = document.querySelector(`.age-ratio-val[data-age="${age}"]`);
      if (valSpan) valSpan.textContent = `${Math.round(ratios[age] * 100)}%`;
    });

    this._state.setToolOption('ageRatios', ratios);

    // In scatter mode, manual age ratio change switches biome to "Custom"
    if (this._state.toolOptions.useScatterSystem) {
      this._switchBiomeToCustom();
    }
  }

  /**
   * Format tree type for display (oak-dead → ☠ Oak)
   */
  _formatTreeType(type) {
    if (type.endsWith('-dead')) {
      const base = type.replace('-dead', '');
      return `☠ ${base.charAt(0).toUpperCase() + base.slice(1)}`;
    }
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /**
   * Render ratio sliders for selected tree types
   */
  _renderRatioSliders(types, ratios) {
    const container = document.getElementById('ratio-sliders');
    if (!container) return;

    container.innerHTML = types.map(type => `
      <div class="ratio-row">
        <span class="ratio-label">${this._formatTreeType(type)}</span>
        <input type="range" class="ratio-slider" data-type="${type}"
               min="0" max="100" value="${Math.round(ratios[type] * 100)}">
        <span class="ratio-value ratio-val" data-type="${type}">${Math.round(ratios[type] * 100)}%</span>
      </div>
    `).join('');

    // Add listeners to ratio sliders
    container.querySelectorAll('.ratio-slider').forEach(slider => {
      slider.addEventListener('input', (e) => this._onRatioChange(e, types));
    });
  }

  /**
   * Handle ratio slider change - adjust others so total stays at 100%
   */
  _onRatioChange(e, types) {
    const changedType = e.target.dataset.type;
    const newValue = parseInt(e.target.value);

    // Only select tree ratio sliders (not density or other sliders)
    const container = document.getElementById('ratio-sliders');
    if (!container) return;
    const sliders = container.querySelectorAll('.ratio-slider[data-type]');
    const otherSliders = [...sliders].filter(s => s.dataset.type !== changedType);

    // Calculate how much the others need to share
    const remaining = 100 - newValue;

    // Get current total of other sliders
    let otherTotal = 0;
    otherSliders.forEach(s => {
      otherTotal += parseInt(s.value);
    });

    // Distribute remaining among others proportionally
    const ratios = {};
    ratios[changedType] = newValue / 100;

    if (otherTotal > 0 && remaining > 0) {
      otherSliders.forEach(s => {
        const type = s.dataset.type;
        const proportion = parseInt(s.value) / otherTotal;
        const newVal = Math.round(remaining * proportion);
        s.value = newVal;
        ratios[type] = newVal / 100;
      });
    } else {
      // If others are all 0 or remaining is 0, distribute equally
      const equalShare = remaining / otherSliders.length;
      otherSliders.forEach(s => {
        const type = s.dataset.type;
        s.value = Math.round(equalShare);
        ratios[type] = equalShare / 100;
      });
    }

    // Update all displays
    sliders.forEach(s => {
      const type = s.dataset.type;
      const valSpan = document.querySelector(`.ratio-val[data-type="${type}"]`);
      if (valSpan) valSpan.textContent = `${Math.round(ratios[type] * 100)}%`;
    });

    this._state.setToolOption('treeRatios', ratios);

    // In scatter mode, manual ratio change switches biome to "Custom"
    if (this._state.toolOptions.useScatterSystem) {
      this._switchBiomeToCustom();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SEASON TUNING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Bind all season tuning panel events
   */
  _bindSeasonTuning() {
    const el = this._elements;
    if (!el.seasonTuningPanel) return;

    // Track overrides locally
    this._seasonOverrides = {};

    // Toggle collapse for Season Tuning (starts collapsed via CSS)
    if (el.seasonTuningToggle) {
      el.seasonTuningToggle.addEventListener('click', () => {
        const isCollapsed = el.seasonTuningToggle.classList.toggle('collapsed');
        el.seasonTuningBody.classList.toggle('collapsed', isCollapsed);
      });
    }

    // Toggle collapse for View Options
    if (el.viewOptionsToggle) {
      el.viewOptionsToggle.addEventListener('click', () => {
        const isCollapsed = el.viewOptionsToggle.classList.toggle('collapsed');
        el.viewOptionsBody.classList.toggle('collapsed', isCollapsed);
      });
    }

    // Scatter controls (type selects in Season Tuning panel)
    this._bindTuneSelect(el.tuneFloorType, 'scatter', 'floorType');
    this._bindTuneSelect(el.tuneParticleType, 'scatter', 'particleType');

    // Stroke Output sliders (new hierarchical density controls)
    this._bindStrokeOutputControls();

    // Canopy controls
    this._bindTuneSlider(el.tuneCanopyHue, el.tuneCanopyHueVal, 'canopy', 'hueShift', 0, '°');
    this._bindTuneSlider(el.tuneCanopySat, el.tuneCanopySatVal, 'canopy', 'saturation', 2);
    this._bindTuneSlider(el.tuneCanopyBright, el.tuneCanopyBrightVal, 'canopy', 'brightness', 2);

    // Ground controls
    this._bindTuneColor(el.tuneGroundTint, el.tuneGroundTintVal, 'ground', 'tintColor');
    this._bindTuneSlider(el.tuneGroundBright, el.tuneGroundBrightVal, 'ground', 'brightness', 2);

    // Environment controls
    this._bindTuneCheckbox(el.tuneEnvSnow, 'environment', 'snow');
    this._bindTuneCheckbox(el.tuneEnvPuddles, 'environment', 'puddles');
    this._bindTuneSlider(el.tuneEnvFog, el.tuneEnvFogVal, 'environment', 'fogDensity', 2);
    this._bindTuneCheckbox(el.tuneEnvFrost, 'environment', 'frost');

    // Atmosphere controls
    this._bindTuneColor(el.tuneAtmAmbient, el.tuneAtmAmbientVal, 'atmosphere', 'ambientColor');
    this._bindTuneSlider(el.tuneAtmShadow, el.tuneAtmShadowVal, 'atmosphere', 'shadowIntensity', 2);
    this._bindTuneSlider(el.tuneAtmWind, el.tuneAtmWindVal, 'atmosphere', 'windSpeed', 2);

    // Reset button
    if (el.tuneReset) {
      el.tuneReset.addEventListener('click', () => {
        this._seasonOverrides = {};
        this._state.setToolOption('seasonOverrides', {});
        this._refreshSeasonTuning();
        console.log('[Editor] Season tuning reset to defaults');
      });
    }

    // Export button
    if (el.tuneExport) {
      el.tuneExport.addEventListener('click', () => {
        this._exportSeasonConfig();
      });
    }

    // +/- buttons for fine tuning
    document.querySelectorAll('.tune-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const delta = parseFloat(btn.dataset.delta);
        const slider = document.getElementById(targetId);
        if (!slider) return;

        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const step = parseFloat(slider.step) || 1;
        let newVal = parseFloat(slider.value) + delta;

        // Clamp to min/max and round to step
        newVal = Math.max(min, Math.min(max, newVal));
        newVal = Math.round(newVal / step) * step;

        slider.value = newVal;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  /**
   * Bind a slider tuning control
   */
  _bindTuneSlider(slider, valEl, group, field, decimals = 2, suffix = '') {
    if (!slider) return;
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (valEl) valEl.textContent = val.toFixed(decimals) + suffix;
      this._setSeasonOverride(group, field, val);
    });
  }

  /**
   * Bind a select tuning control
   */
  _bindTuneSelect(select, group, field) {
    if (!select) return;
    select.addEventListener('change', (e) => {
      this._setSeasonOverride(group, field, e.target.value);
    });
  }

  /**
   * Bind a color input tuning control
   */
  _bindTuneColor(colorInput, valEl, group, field) {
    if (!colorInput) return;
    colorInput.addEventListener('input', (e) => {
      if (valEl) valEl.textContent = e.target.value;
      this._setSeasonOverride(group, field, e.target.value);
    });
  }

  /**
   * Bind a checkbox tuning control
   */
  _bindTuneCheckbox(checkbox, group, field) {
    if (!checkbox) return;
    checkbox.addEventListener('change', (e) => {
      this._setSeasonOverride(group, field, e.target.checked);
    });
  }

  /**
   * Bind Stroke Output controls (hierarchical density sliders)
   */
  _bindStrokeOutputControls() {
    const el = this._elements;

    // Tree count → treeDensity tool option (now a multiplier: 0.5 to 2.0)
    if (el.scatterTreeCount) {
      el.scatterTreeCount.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (el.scatterTreeCountVal) el.scatterTreeCountVal.textContent = val.toFixed(1) + '×';
        this._state.setToolOption('treeDensity', val);
      });
    }

    // Tree spacing → treeSpacing tool option (50% to 150%, affects tree-to-tree collision)
    if (el.treeSpacing) {
      el.treeSpacing.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        if (el.treeSpacingVal) el.treeSpacingVal.textContent = val + '%';
        this._state.setToolOption('treeSpacing', val / 100); // Store as multiplier (0.5-1.5)
      });
    }

    // Category toggles - ON = expanded, OFF = collapsed
    if (el.toggleTrees) {
      el.toggleTrees.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        this._state.setToolOption('treesEnabled', enabled);
        // Expand/collapse the panel based on toggle state
        const header = el.toggleTrees.closest('.category-header');
        if (header) header.classList.toggle('collapsed', !enabled);
        if (el.catTreesBody) el.catTreesBody.classList.toggle('collapsed', !enabled);
        this._refreshScatterPreview();
      });
    }
    if (el.toggleFloor) {
      el.toggleFloor.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        this._state.setToolOption('floorEnabled', enabled);
        // Also update childSpawnOverrides for floor
        const overrides = { ...this._state.toolOptions.childSpawnOverrides };
        overrides.floor = { ...overrides.floor, enabled };
        this._state.setToolOption('childSpawnOverrides', overrides);
        // Expand/collapse the panel based on toggle state
        const header = el.toggleFloor.closest('.category-header');
        if (header) header.classList.toggle('collapsed', !enabled);
        if (el.catFloorBody) el.catFloorBody.classList.toggle('collapsed', !enabled);
        this._refreshScatterPreview();
      });
    }
    if (el.toggleParticles) {
      el.toggleParticles.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        this._state.setToolOption('particlesEnabled', enabled);
        // Also update childSpawnOverrides for particles
        const overrides = { ...this._state.toolOptions.childSpawnOverrides };
        overrides.particle = { ...overrides.particle, enabled };
        this._state.setToolOption('childSpawnOverrides', overrides);
        // Expand/collapse the panel based on toggle state
        const header = el.toggleParticles.closest('.category-header');
        if (header) header.classList.toggle('collapsed', !enabled);
        if (el.catParticlesBody) el.catParticlesBody.classList.toggle('collapsed', !enabled);
        this._refreshScatterPreview();
      });
    }
    if (el.toggleBrush) {
      el.toggleBrush.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        this._state.setToolOption('brushEnabled', enabled);
        // Expand/collapse the panel based on toggle state
        const header = el.toggleBrush.closest('.category-header');
        if (header) header.classList.toggle('collapsed', !enabled);
        if (el.catBrushBody) el.catBrushBody.classList.toggle('collapsed', !enabled);
        this._refreshScatterPreview();
      });
    }

  }

  /**
   * Sync Stroke Output sliders with current values (called when season/biome changes)
   */
  _syncStrokeOutputValues() {
    const el = this._elements;

    // Get current values from state/config
    const treeDensity = this._state.toolOptions?.treeDensity ?? 5;
    const season = el.seasonSelect?.value || 'summer';
    const biome = el.biomeSelect?.value || 'temperate';
    const config = getSeasonBiomeConfig(season, biome);
    const overrides = this._seasonOverrides || {};

    // Get effective values (override or config default)
    const floorDensity = overrides.scatter?.floorDensity ?? config?.scatter?.floorDensity ?? 0.6;
    const particleDensity = overrides.scatter?.particleDensity ?? config?.scatter?.particleDensity ?? 0.3;
    const brushDensity = overrides.scatter?.brushDensity ?? config?.scatter?.brushDensity ?? 1.0;

    // Update sliders and values (treeDensity is now a multiplier: 0.5 to 2.0)
    if (el.scatterTreeCount) {
      el.scatterTreeCount.value = treeDensity;
      if (el.scatterTreeCountVal) el.scatterTreeCountVal.textContent = treeDensity.toFixed(1) + '×';
    }
  }

  /**
   * Set a season override value and push to state
   */
  _setSeasonOverride(group, field, value) {
    if (!this._seasonOverrides[group]) {
      this._seasonOverrides[group] = {};
    }
    this._seasonOverrides[group][field] = value;

    // Push to state for scatter generation
    this._state.setToolOption('seasonOverrides', { ...this._seasonOverrides });

    // Update modified indicator
    this._updateModifiedIndicator();
  }

  /**
   * Refresh the tuning panel with current season x biome values
   */
  _refreshSeasonTuning() {
    const el = this._elements;
    if (!el.seasonTuningPanel) return;

    const season = el.seasonSelect?.value || 'summer';
    const biome = el.biomeSelect?.value || 'temperate';
    const config = getSeasonBiomeConfig(season, biome);

    if (!config) return;

    // Update label
    const biomeName = BIOME_PRESETS[biome]?.name || biome;
    const seasonName = season.charAt(0).toUpperCase() + season.slice(1);
    if (el.seasonTuningLabel) {
      el.seasonTuningLabel.textContent = `${seasonName} × ${biomeName}`;
    }

    // Apply overrides on top of config
    const overrides = this._seasonOverrides || {};
    const get = (group, field) => {
      return overrides[group]?.[field] ?? config[group]?.[field];
    };

    // Scatter
    this._setTuneSelect(el.tuneFloorType, get('scatter', 'floorType'));
    this._setTuneSlider(el.tuneFloorDensity, el.tuneFloorDensityVal, get('scatter', 'floorDensity'), 2);
    this._setTuneSelect(el.tuneParticleType, get('scatter', 'particleType'));
    this._setTuneSlider(el.tuneParticleDensity, el.tuneParticleDensityVal, get('scatter', 'particleDensity'), 2);
    this._setTuneSlider(el.tuneBrushDensity, el.tuneBrushDensityVal, get('scatter', 'brushDensity'), 2);

    // Canopy
    this._setTuneSlider(el.tuneCanopyHue, el.tuneCanopyHueVal, get('canopy', 'hueShift'), 0, '°');
    this._setTuneSlider(el.tuneCanopySat, el.tuneCanopySatVal, get('canopy', 'saturation'), 2);
    this._setTuneSlider(el.tuneCanopyBright, el.tuneCanopyBrightVal, get('canopy', 'brightness'), 2);

    // Ground
    this._setTuneColor(el.tuneGroundTint, el.tuneGroundTintVal, get('ground', 'tintColor'));
    this._setTuneSlider(el.tuneGroundBright, el.tuneGroundBrightVal, get('ground', 'brightness'), 2);

    // Environment
    this._setTuneCheckbox(el.tuneEnvSnow, get('environment', 'snow'));
    this._setTuneCheckbox(el.tuneEnvPuddles, get('environment', 'puddles'));
    this._setTuneSlider(el.tuneEnvFog, el.tuneEnvFogVal, get('environment', 'fogDensity'), 2);
    this._setTuneCheckbox(el.tuneEnvFrost, get('environment', 'frost'));

    // Atmosphere
    this._setTuneColor(el.tuneAtmAmbient, el.tuneAtmAmbientVal, get('atmosphere', 'ambientColor'));
    this._setTuneSlider(el.tuneAtmShadow, el.tuneAtmShadowVal, get('atmosphere', 'shadowIntensity'), 2);
    this._setTuneSlider(el.tuneAtmWind, el.tuneAtmWindVal, get('atmosphere', 'windSpeed'), 2);

    // Sync Stroke Output sliders (hierarchical density controls)
    this._syncStrokeOutputValues();

    // Update modified indicator
    this._updateModifiedIndicator();
  }

  /**
   * Refresh the sidebar scatter preview canvas (Tetris-style "next piece" preview)
   * Generates a preview cluster using current settings and renders to the preview canvas.
   * Auto-zooms to fit the full brush radius + child overflow.
   */
  _refreshScatterPreview() {
    const canvas = this._elements.scatterPreviewCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background - use base ground texture if available
    const baseLayer = this._state.baseLayer || 'grass-1';
    const groundImg = this._renderer._images?.ground?.[baseLayer];
    if (groundImg) {
      // Tile the ground texture across the preview
      const pattern = ctx.createPattern(groundImg, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#1a2f1a';  // Dark green fallback
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const options = this._state.toolOptions;
    if (!options.useScatterSystem) return;

    // Use shared forest generation function (single source of truth)
    const mockTerrain = { scatterItems: [], strokes: [] };
    const virtualCx = 1000;
    const virtualCy = 1000;
    const radius = options.brushRadius;

    const previewItems = generateForestItems(mockTerrain,
      { x: virtualCx, y: virtualCy, radius, seed: options.previewSeed ?? 42 },
      {
        treeTypes: options.treeTypes || [options.treeType || 'oak'],
        treeRatios: options.treeRatios || {},
        treeDensity: options.treeDensity ?? 1.0,
        treeScale: options.treeScale ?? 0.35,
        treeSpacing: options.treeSpacing ?? 1.0,
        selectedAges: options.selectedAges ?? ['young', 'transitional', 'old'],
        ageRatios: options.ageRatios ?? null,
        brushTypes: options.brushTypes || ['bush-small'],
        brushRatios: options.brushRatios || {},
        brushDensity: options.brushDensity ?? 1.0,
        brushScale: options.brushScale ?? 0.25,
        season: options.season ?? 'summer',
        biome: options.biome ?? 'temperate',
        seasonOverrides: options.seasonOverrides ?? {},
        childSpawnOverrides: options.childSpawnOverrides ?? {},
        // Category toggles
        treesEnabled: options.treesEnabled ?? true,
        brushEnabled: options.brushEnabled ?? true,
        floorEnabled: options.floorEnabled ?? true,
        particlesEnabled: options.particlesEnabled ?? true,
        images: {
          tree: this._renderer._images.trees,
          brush: this._renderer._images.brush,
          floor: this._renderer._images.floor,
          particle: this._renderer._images.brush
        }
      }
    );

    if (previewItems.length === 0) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No items generated', canvas.width / 2, canvas.height / 2);
      this._updatePreviewInfo([], 1);
      return;
    }

    // Calculate bounding box of all items (including their rendered size)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of previewItems) {
      const imgSize = (256 * item.scale) / 2; // half the rendered size
      minX = Math.min(minX, item.x - imgSize);
      minY = Math.min(minY, item.y - imgSize);
      maxX = Math.max(maxX, item.x + imgSize);
      maxY = Math.max(maxY, item.y + imgSize);
    }

    // Also include the brush radius circle
    minX = Math.min(minX, virtualCx - radius);
    minY = Math.min(minY, virtualCy - radius);
    maxX = Math.max(maxX, virtualCx + radius);
    maxY = Math.max(maxY, virtualCy + radius);

    // Calculate zoom to fit with padding
    const padding = 10;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = canvas.width - padding * 2;
    const availH = canvas.height - padding * 2;
    const zoom = Math.min(1.5, availW / contentW, availH / contentH); // cap at 1.5x

    // Center offset
    const contentCx = (minX + maxX) / 2;
    const contentCy = (minY + maxY) / 2;
    const canvasCx = canvas.width / 2;
    const canvasCy = canvas.height / 2;

    // Prepare images
    const images = {
      tree: this._renderer._images.trees,
      brush: this._renderer._images.brush,
      floor: this._renderer._images.floor,
      particle: this._renderer._images.brush
    };

    // Build list of canopy occluders (trees) with their occlusion radii
    const occluders = [];
    for (const item of previewItems) {
      const config = SCATTER_TYPES[item.type];
      if (config && config.category === 'tree') {
        // Calculate visual canopy radius from actual loaded sprite dimensions
        const spriteKey = getSpriteKey(item);
        const img = images.tree?.[spriteKey];
        const spriteWidth = img?.width || 256;
        const canopyFill = config.canopyFill ?? 0.8;
        const occlusionRadius = (spriteWidth / 2) * canopyFill * item.scale;
        occluders.push({ x: item.x, y: item.y, radius: occlusionRadius });
      }
    }

    // Check if an item is completely occluded by any tree canopy
    // Only ground and particle layer items can be occluded (not canopy layer)
    const isOccluded = (item) => {
      const config = SCATTER_TYPES[item.type];
      if (!config) return false;
      // Canopy layer items (trees, bushes) don't get occluded
      if (config.layer === 'canopy') return false;
      // Approximate item radius based on scale
      const itemRadius = 20 * item.scale; // rough estimate
      for (const occ of occluders) {
        const dx = item.x - occ.x;
        const dy = item.y - occ.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Item is occluded if its center + radius is inside the occluder
        if (dist + itemRadius < occ.radius * 0.85) { // 85% to allow edge visibility
          return true;
        }
      }
      return false;
    };

    // Filter out occluded items
    const visibleItems = previewItems.filter(item => !isOccluded(item));

    // Sort: smaller scale first, then by Y
    const sorted = [...visibleItems].sort((a, b) => (a.scale - b.scale) || (a.y - b.y));

    // Apply zoom transform
    ctx.save();
    ctx.translate(canvasCx, canvasCy);
    ctx.scale(zoom, zoom);
    ctx.translate(-contentCx, -contentCy);

    // Render layers in order: ground → particle → canopy
    for (const item of sorted) {
      const config = SCATTER_TYPES[item.type];
      if (config && config.layer === 'ground') {
        renderScatterItem(ctx, item, images, { skipFilters: true });
      }
    }
    for (const item of sorted) {
      const config = SCATTER_TYPES[item.type];
      if (config && config.layer === 'particle') {
        renderScatterItem(ctx, item, images, { skipFilters: true });
      }
    }
    for (const item of sorted) {
      const config = SCATTER_TYPES[item.type];
      if (config && config.layer === 'canopy') {
        renderScatterItem(ctx, item, images, { skipFilters: true });
      }
    }

    // Draw brush radius circle (dashed outline)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1 / zoom; // constant screen-space width
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.arc(virtualCx, virtualCy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // Update info text with detailed breakdown (visible items only)
    this._updatePreviewInfo(visibleItems, zoom);
  }

  _updatePreviewInfo(items, zoom) {
    const el = this._elements.scatterPreviewInfo;
    if (!el) return;

    if (!items || items.length === 0) {
      el.textContent = 'No items (collision?)';
      return;
    }

    // Group by layer, then by category/type with scale tracking
    const layers = {
      ground: { items: [], byType: {} },
      particle: { items: [], byType: {} },
      canopy: { items: [], byType: {} }
    };

    for (const item of items) {
      const config = SCATTER_TYPES[item.type];
      if (!config) continue;

      const layer = config.layer || 'canopy';
      layers[layer].items.push(item);

      // Extract readable type name
      const typeName = item.type.replace(/^(tree|floor|particle|brush)-/, '');
      const displayName = config.category === 'particle' ? `${typeName}-ptc` : typeName;

      if (!layers[layer].byType[displayName]) {
        layers[layer].byType[displayName] = { count: 0, scales: [], category: config.category };
      }
      layers[layer].byType[displayName].count++;
      layers[layer].byType[displayName].scales.push(item.scale);
    }

    // Build layer-based summary with per-type scales
    const lines = [];

    // Canopy layer - split into Trees and Brush for readability
    if (layers.canopy.items.length > 0) {
      const treeParts = [];
      const brushParts = [];
      for (const [name, data] of Object.entries(layers.canopy.byType)) {
        const minS = Math.min(...data.scales);
        const maxS = Math.max(...data.scales);
        const scaleStr = minS === maxS
          ? `${(minS * 100).toFixed(0)}%`
          : `${(minS * 100).toFixed(0)}-${(maxS * 100).toFixed(0)}%`;
        const part = `${data.count} ${name} @${scaleStr}`;
        if (data.category === 'tree') {
          treeParts.push(part);
        } else {
          brushParts.push(part);
        }
      }
      if (treeParts.length > 0) {
        lines.push(`<b>Trees:</b> ${treeParts.join(', ')}`);
      }
      if (brushParts.length > 0) {
        lines.push(`<b>Brush:</b> ${brushParts.join(', ')}`);
      }
    }

    // Particle layer (leaves, needles, debris)
    if (layers.particle.items.length > 0) {
      const parts = [];
      for (const [name, data] of Object.entries(layers.particle.byType)) {
        const minS = Math.min(...data.scales);
        const maxS = Math.max(...data.scales);
        const scaleStr = minS === maxS
          ? `${(minS * 100).toFixed(0)}%`
          : `${(minS * 100).toFixed(0)}-${(maxS * 100).toFixed(0)}%`;
        parts.push(`${data.count} ${name} @${scaleStr}`);
      }
      lines.push(`<b>Particles:</b> ${parts.join(', ')}`);
    }

    // Ground layer (floor)
    if (layers.ground.items.length > 0) {
      const parts = [];
      for (const [name, data] of Object.entries(layers.ground.byType)) {
        const minS = Math.min(...data.scales);
        const maxS = Math.max(...data.scales);
        const scaleStr = minS === maxS
          ? `${(minS * 100).toFixed(0)}%`
          : `${(minS * 100).toFixed(0)}-${(maxS * 100).toFixed(0)}%`;
        parts.push(`${data.count} ${name} @${scaleStr}`);
      }
      lines.push(`<b>Ground:</b> ${parts.join(', ')}`);
    }

    const zoomStr = zoom && zoom < 0.99 ? `<br><i>Preview zoom: ${Math.round(zoom * 100)}%</i>` : '';
    el.innerHTML = lines.join('<br>') + zoomStr;
  }

  _setTuneSlider(slider, valEl, value, decimals = 2, suffix = '') {
    if (slider && value !== undefined) {
      slider.value = value;
      if (valEl) valEl.textContent = Number(value).toFixed(decimals) + suffix;
    }
  }

  _setTuneSelect(select, value) {
    if (select && value !== undefined) select.value = value;
  }

  _setTuneColor(colorInput, valEl, value) {
    if (colorInput && value) {
      colorInput.value = value;
      if (valEl) valEl.textContent = value;
    }
  }

  _setTuneCheckbox(checkbox, value) {
    if (checkbox && value !== undefined) checkbox.checked = !!value;
  }

  /**
   * Update the "Modified: ..." indicator
   */
  _updateModifiedIndicator() {
    const el = this._elements;
    if (!el.tuneModifiedList) return;

    const overrides = this._seasonOverrides || {};
    const fields = [];
    for (const [group, vals] of Object.entries(overrides)) {
      for (const field of Object.keys(vals)) {
        fields.push(`${group}.${field}`);
      }
    }

    if (fields.length > 0) {
      el.tuneModifiedList.style.display = '';
      el.tuneModifiedFields.textContent = fields.join(', ');
    } else {
      el.tuneModifiedList.style.display = 'none';
    }
  }

  /**
   * Export current season config values to clipboard
   */
  _exportSeasonConfig() {
    const season = this._elements.seasonSelect?.value || 'summer';
    const biome = this._elements.biomeSelect?.value || 'temperate';
    const config = getSeasonBiomeConfig(season, biome);

    // Merge overrides into config
    const merged = {};
    for (const group of ['scatter', 'canopy', 'ground', 'environment', 'atmosphere']) {
      merged[group] = { ...config[group], ...(this._seasonOverrides?.[group] || {}) };
    }

    const output = exportConfigString(season, biome, merged);
    const header = `// ${season} × ${biome}\n`;

    navigator.clipboard.writeText(header + output).then(() => {
      console.log('[Editor] Season config copied to clipboard');
      // Brief visual feedback
      const btn = this._elements.tuneExport;
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    }).catch(err => {
      console.error('[Editor] Failed to copy:', err);
      // Fallback: log to console
      console.log('Season config export:\n' + header + output);
    });
  }
}

// Initialize when DOM is ready
const editor = new TerrainEditor();
editor.init().catch(err => {
  console.error('[TerrainEditor] Failed to initialize:', err);
});
