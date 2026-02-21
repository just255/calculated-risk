// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Main Entry Point
// Wires all modules together
// ═══════════════════════════════════════════════════════════════

import { createEditorState } from './state.js';
import { createRenderer } from './renderer.js';
import { createToolManager } from './tools/tool-manager.js';
import { PaintTool } from './tools/paint-tool.js';
import { ClearTool } from './tools/clear-tool.js';
import { PCGTool } from './tools/pcg-tool.js';
import { Events } from './events.js';
import * as Presets from './presets.js';
import { BIOME_PRESETS, SEASON_BIOME_CONFIG, getSeasonBiomeConfig, getConfigSchema, exportConfigString, SCATTER_TYPES, generateForestItems, renderScatterItem, getSpriteKey } from '../world-builder/index.js';
import { setQualityPreset, getCurrentPreset, saveQualityPreset, loadQualityPreset, getLODSettings, applyLODSettings, resetToPreset, LOD_PRESETS, getCategoryMinZoom, BASE_SPRITE_SIZE } from './lod.js';
import { TestMode } from './test-mode.js';

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

    // Populate water dropdown from available sprites
    this._populateWaterDropdown();

    // Create tool manager and register tools
    this._toolManager = createToolManager(this._state, this._renderer);
    this._toolManager.register(PaintTool);
    this._toolManager.register(ClearTool);
    this._toolManager.register(PCGTool);
    // TODO: Register select, transform tools
    this._toolManager.attach(this._renderer.uiCanvas);

    // Test mode (walk around the map)
    this._testMode = new TestMode(this._state, this._renderer);
    this._toolManager.setKeyInterceptor((e) => this._testModeKeyHandler(e));

    // Bind UI events
    this._bindUIEvents();

    // Subscribe to state events for UI updates
    this._bindStateEvents();

    // Apply biome+season config to floor/particle/brush dropdowns on init
    this._applyBiomeSeasonToOutputs();

    // Refresh scatter preview now that state events are bound
    // (biome was applied during _bindUIEvents but preview listener wasn't ready yet)
    this._refreshScatterPreview();

    // Fit map to screen on load
    this._fitMapToView();

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
      groundPreviewCanvas: document.getElementById('ground-preview-canvas'),
      groundPreviewContainer: document.getElementById('ground-preview-container'),
      showGroundPreview: document.getElementById('show-ground-preview'),
      groundTextureType: document.getElementById('ground-texture-type'),
      groundTypeDropdown: document.getElementById('ground-type-dropdown'),
      groundTypeValue: document.getElementById('ground-type-value'),
      groundTypeMenu: document.getElementById('ground-type-menu'),
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
      waterPreviewCanvas: document.getElementById('water-preview-canvas'),
      waterPreviewContainer: document.getElementById('water-preview-container'),
      showWaterPreview: document.getElementById('show-water-preview'),
      waterTextureType: document.getElementById('water-texture-type'),
      waterFalloff: document.getElementById('water-falloff'),
      waterFalloffVal: document.getElementById('water-falloff-val'),
      waterDepth: document.getElementById('water-depth'),
      waterDepthVal: document.getElementById('water-depth-val'),
      waterDepthFalloff: document.getElementById('water-depth-falloff'),
      waterDepthFalloffVal: document.getElementById('water-depth-falloff-val'),
      waterDepthFalloffRow: document.getElementById('water-depth-falloff-row'),
      deepWaterDepthRow: document.getElementById('deep-water-depth-row'),
      // Water type dropdown
      waterTypeDropdown: document.getElementById('water-type-dropdown'),
      waterTypeValue: document.getElementById('water-type-value'),
      waterTypeMenu: document.getElementById('water-type-menu'),
      // Shore settings
      shoreTextureType: document.getElementById('shore-texture-type'),
      shoreWidth: document.getElementById('shore-width'),
      shoreWidthVal: document.getElementById('shore-width-val'),
      shoreFadeWidth: document.getElementById('shore-fade-width'),
      shoreFadeWidthVal: document.getElementById('shore-fade-width-val'),
      toggleShore: document.getElementById('toggle-shore'),
      // Shore type dropdown
      shoreTypeDropdown: document.getElementById('shore-type-dropdown'),
      shoreTypeValue: document.getElementById('shore-type-value'),
      shoreTypeMenu: document.getElementById('shore-type-menu'),
      treesInWater: document.getElementById('trees-in-water'),

      // Tree settings
      treeSettings: document.getElementById('tree-settings'),
      presetSelect: document.getElementById('preset-select'),
      customPresetsGroup: document.getElementById('custom-presets-group'),
      btnLoadPreset: document.getElementById('btn-load-preset'),
      btnSavePreset: document.getElementById('btn-save-preset'),
      btnDeletePreset: document.getElementById('btn-delete-preset'),
      // Tree species dropdown
      treeSpeciesDropdown: document.getElementById('tree-species-dropdown'),
      treeSpeciesValue: document.getElementById('tree-species-value'),
      treeSpeciesMenu: document.getElementById('tree-species-menu'),
      // Tree ages dropdown
      treeAgesDropdown: document.getElementById('tree-ages-dropdown'),
      treeAgesValue: document.getElementById('tree-ages-value'),
      treeAgesMenu: document.getElementById('tree-ages-menu'),
      // Dead ratio slider
      deadRatioRow: document.getElementById('dead-ratio-row'),
      deadRatio: document.getElementById('dead-ratio'),
      deadRatioVal: document.getElementById('dead-ratio-val'),
      // Legacy (kept for compatibility)
      treeBtns: document.querySelectorAll('.variant-btn[data-tree]'),
      ageBtns: document.querySelectorAll('.variant-btn[data-age]'),
      ageRatiosContainer: document.getElementById('age-ratios'),
      ageRatioSliders: document.getElementById('age-ratio-sliders'),
      treeScale: document.getElementById('tree-scale'),
      scaleVal: document.getElementById('scale-val'),
      treeDensity: document.getElementById('tree-density'),
      densityVal: document.getElementById('density-val'),
      animationStyle: document.getElementById('animation-style'),

      // Brush/Undergrowth settings (in forest output)
      brushSettings: document.getElementById('brush-settings'),
      brushTypesDropdown: document.getElementById('brush-types-dropdown'),
      brushTypesValue: document.getElementById('brush-types-value'),
      brushTypesMenu: document.getElementById('brush-types-menu'),
      brushTypeBtns: document.querySelectorAll('.variant-btn[data-brush]'), // Legacy
      brushRatiosContainer: document.getElementById('brush-ratios'),
      brushRatioSliders: document.getElementById('brush-ratio-sliders'),
      brushScale: document.getElementById('brush-scale'),
      brushScaleVal: document.getElementById('brush-scale-val'),
      brushDensity: document.getElementById('brush-density'),
      brushDensityVal: document.getElementById('brush-density-val'),
      brushInWater: document.getElementById('brush-in-water'),

      // Brush standalone settings (brush tool panel)
      brushStandaloneTypesDropdown: document.getElementById('brush-standalone-types-dropdown'),
      brushStandaloneTypesValue: document.getElementById('brush-standalone-types-value'),
      brushStandaloneTypesMenu: document.getElementById('brush-standalone-types-menu'),
      brushStandaloneDensity: document.getElementById('brush-standalone-density'),
      brushStandaloneDensityVal: document.getElementById('brush-standalone-density-val'),
      brushStandaloneScale: document.getElementById('brush-standalone-scale'),
      brushStandaloneScaleVal: document.getElementById('brush-standalone-scale-val'),
      brushStandaloneInWater: document.getElementById('brush-standalone-in-water'),
      toggleBrushFloor: document.getElementById('toggle-brush-floor'),
      toggleBrushParticles: document.getElementById('toggle-brush-particles'),

      // Boulder standalone settings (boulder tool panel)
      boulderSettings: document.getElementById('boulder-settings'),
      boulderStandaloneDensity: document.getElementById('boulder-standalone-density'),
      boulderStandaloneDensityVal: document.getElementById('boulder-standalone-density-val'),
      boulderStandaloneScale: document.getElementById('boulder-standalone-scale'),
      boulderStandaloneScaleVal: document.getElementById('boulder-standalone-scale-val'),
      boulderStandaloneScaleVariance: document.getElementById('boulder-standalone-scale-variance'),
      boulderStandaloneScaleVarianceVal: document.getElementById('boulder-standalone-scale-variance-val'),
      boulderInWater: document.getElementById('boulder-in-water'),
      boulderTypesDropdown: document.getElementById('boulder-types-dropdown'),
      boulderTypesMenu: document.getElementById('boulder-types-menu'),
      boulderTypesValue: document.getElementById('boulder-types-value'),
      boulderFloorTypesDropdown: document.getElementById('boulder-floor-types-dropdown'),
      boulderFloorTypesMenu: document.getElementById('boulder-floor-types-menu'),
      boulderFloorTypesValue: document.getElementById('boulder-floor-types-value'),
      boulderParticleTypesDropdown: document.getElementById('boulder-particle-types-dropdown'),
      boulderParticleTypesMenu: document.getElementById('boulder-particle-types-menu'),
      boulderParticleTypesValue: document.getElementById('boulder-particle-types-value'),
      boulderParticleDensity: document.getElementById('boulder-particle-density'),
      boulderParticleDensityVal: document.getElementById('boulder-particle-density-val'),
      boulderParticleScale: document.getElementById('boulder-particle-scale'),
      boulderParticleScaleVal: document.getElementById('boulder-particle-scale-val'),
      boulderParticleScaleVariance: document.getElementById('boulder-particle-scale-variance'),
      boulderParticleScaleVarianceVal: document.getElementById('boulder-particle-scale-variance-val'),
      toggleBoulderFloor: document.getElementById('toggle-boulder-floor'),
      toggleBoulderParticles: document.getElementById('toggle-boulder-particles'),

      // Floor types dropdown (category cards)
      floorTypesDropdown: document.getElementById('floor-types-dropdown'),
      floorTypesValue: document.getElementById('floor-types-value'),
      floorTypesMenu: document.getElementById('floor-types-menu'),
      floorTypeBtns: document.querySelectorAll('.variant-btn[data-floor]'), // Legacy
      floorRatiosContainer: document.getElementById('floor-ratios'),
      floorRatioSliders: document.getElementById('floor-ratio-sliders'),

      // Particle types dropdown (category cards)
      particleTypesDropdown: document.getElementById('particle-types-dropdown'),
      particleTypesValue: document.getElementById('particle-types-value'),
      particleTypesMenu: document.getElementById('particle-types-menu'),
      particleTypeBtns: document.querySelectorAll('.variant-btn[data-particle]'), // Legacy
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
      qualityPreset: document.getElementById('quality-preset'),
      // LOD settings modal
      lodSettingsBtn: document.getElementById('lod-settings-btn'),
      lodModal: document.getElementById('lod-modal'),
      lodModalClose: document.getElementById('lod-modal-close'),
      lodApply: document.getElementById('lod-apply'),
      lodReset: document.getElementById('lod-reset'),
      // Scatter environment (biome/season - for forest/brush in scatter mode)
      scatterEnvironment: document.getElementById('scatter-environment'),

      // Feature tools in toolbar
      featureTools: document.querySelectorAll('.tool-btn.feature-tool'),

      // Generation system toggle
      systemLegacy: document.getElementById('system-legacy'),
      systemScatter: document.getElementById('system-scatter'),

      // Display mode toggle
      displayCanvas2D: document.getElementById('display-canvas2d'),
      displayPixi: document.getElementById('display-pixi'),
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
      reseedPreview: document.getElementById('reseed-preview'),

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

    // Test mode button + unit selector
    const testBtn = document.getElementById('test-mode-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => this._toggleTestMode());
    }
    const testUnitSelect = document.getElementById('test-unit-select');
    if (testUnitSelect) {
      testUnitSelect.addEventListener('change', (e) => {
        this._testMode.setUnit(e.target.value);
      });
    }
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

          // Set default animation style per tool
          const defaultAnim = feature === 'water' ? 'ripple' : 'deploy';
          this._state.setToolOption('animationStyle', defaultAnim);
          if (this._elements.animationStyle) {
            this._elements.animationStyle.value = defaultAnim;
          }
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
      this._refreshGroundPreview();
      this._refreshWaterPreview();
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

    // Ground canvas preview toggle
    if (this._elements.showGroundPreview) {
      this._elements.showGroundPreview.addEventListener('change', (e) => {
        this._state.setViewSetting('showGroundPreview', e.target.checked);
      });
    }

    // Ground texture type (hidden select for compatibility)
    if (this._elements.groundTextureType) {
      this._elements.groundTextureType.addEventListener('change', (e) => {
        this._state.setToolOption('groundTextureType', e.target.value);
        this._refreshGroundPreview();
      });
    }

    // Ground type dropdown (visual dropdown UI)
    if (this._elements.groundTypeDropdown) {
      const dropdown = this._elements.groundTypeDropdown;
      const trigger = dropdown.querySelector('.dropdown-trigger');
      const menu = this._elements.groundTypeMenu;

      trigger.addEventListener('click', () => {
        menu.classList.toggle('open');
      });

      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;

        const groundType = item.dataset.ground;
        if (!groundType) return;

        // Update radio button
        const radio = item.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        // Update all labels
        menu.querySelectorAll('.dropdown-item-label').forEach(label => {
          label.classList.remove('checked');
        });
        item.querySelector('.dropdown-item-label').classList.add('checked');

        // Update display value
        const label = item.querySelector('.dropdown-item-label').textContent;
        this._elements.groundTypeValue.textContent = label;

        // Update hidden select and state
        this._elements.groundTextureType.value = groundType;
        this._state.setToolOption('groundTextureType', groundType);
        this._refreshGroundPreview();

        menu.classList.remove('open');
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
          menu.classList.remove('open');
        }
      });
    }

    // Fade width slider
    if (this._elements.fadeWidth) {
      this._elements.fadeWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('fadeWidth', value);
        this._elements.fadeWidthVal.textContent = `${value}px`;
        this._refreshGroundPreview();
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
        this._refreshWaterPreview();
      });
    }

    // Water canvas preview toggle
    if (this._elements.showWaterPreview) {
      this._elements.showWaterPreview.addEventListener('change', (e) => {
        this._state.setViewSetting('showWaterPreview', e.target.checked);
      });
    }

    // Water falloff (edge softness)
    if (this._elements.waterFalloff) {
      this._elements.waterFalloff.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('waterFalloff', value);
        this._elements.waterFalloffVal.textContent = `${value}%`;
        this._refreshWaterPreview();
      });
    }

    // Water depth (deep water opacity)
    if (this._elements.waterDepth) {
      this._elements.waterDepth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('waterDepth', value);
        this._elements.waterDepthVal.textContent = `${value}%`;
        this._updateDepthFalloffVisibility(value);
        this._refreshWaterPreview();
      });
    }

    // Water depth falloff (how depth fades from center)
    if (this._elements.waterDepthFalloff) {
      this._elements.waterDepthFalloff.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('waterDepthFalloff', value);
        this._elements.waterDepthFalloffVal.textContent = `${value}%`;
        this._refreshWaterPreview();
      });
    }

    // Shore texture type
    if (this._elements.shoreTextureType) {
      this._elements.shoreTextureType.addEventListener('change', (e) => {
        this._state.setToolOption('shoreTextureType', e.target.value);
        this._refreshWaterPreview();
      });
    }

    // Shore width
    if (this._elements.shoreWidth) {
      this._elements.shoreWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('shoreWidth', value);
        this._elements.shoreWidthVal.textContent = `${value}px`;
        this._refreshWaterPreview();
      });
    }

    // Shore fade width
    if (this._elements.shoreFadeWidth) {
      this._elements.shoreFadeWidth.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('shoreFadeWidth', value);
        this._elements.shoreFadeWidthVal.textContent = `${value}px`;
        this._refreshWaterPreview();
      });
    }

    // Shore toggle
    if (this._elements.toggleShore) {
      this._elements.toggleShore.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        const shoreBody = document.getElementById('cat-shore-body');
        const shoreCard = document.getElementById('cat-shore');
        if (shoreBody) shoreBody.style.display = enabled ? '' : 'none';
        if (shoreCard) shoreCard.classList.toggle('disabled', !enabled);
        // Update shore texture type to none if disabled
        if (!enabled) {
          this._state.setToolOption('shoreTextureType', 'none');
          if (this._elements.shoreTextureType) this._elements.shoreTextureType.value = 'none';
        } else {
          const currentType = this._elements.shoreTextureType?.value || 'mud';
          this._state.setToolOption('shoreTextureType', currentType === 'none' ? 'mud' : currentType);
          if (this._elements.shoreTextureType) this._elements.shoreTextureType.value = currentType === 'none' ? 'mud' : currentType;
        }
        this._refreshWaterPreview();
      });
    }

    // Water type dropdown (radio buttons)
    this._initRadioDropdown('waterType', (value) => {
      this._state.setToolOption('waterTextureType', value);
      if (this._elements.waterTextureType) this._elements.waterTextureType.value = value;

      // Always show depth slider (works for all water types now)
      if (this._elements.deepWaterDepthRow) {
        this._elements.deepWaterDepthRow.style.display = 'flex';
      }
      // Show depth falloff if depth > 0
      this._updateDepthFalloffVisibility(this._state.toolOptions.waterDepth);

      // Auto-disable shore for deep water (it's meant to be painted on top of existing water)
      const isDeep = value && value.includes('deep');
      if (isDeep) {
        if (this._elements.toggleShore) {
          this._elements.toggleShore.checked = false;
          this._state.setToolOption('shoreEnabled', false);
        }
      }

      this._refreshWaterPreview();
    });

    // Shore type dropdown (radio buttons)
    this._initRadioDropdown('shoreType', (value) => {
      this._state.setToolOption('shoreTextureType', value);
      if (this._elements.shoreTextureType) this._elements.shoreTextureType.value = value;
      this._refreshWaterPreview();
    });

    // Trees in water toggle
    if (this._elements.treesInWater) {
      this._elements.treesInWater.addEventListener('change', (e) => {
        this._state.setToolOption('treesInWater', e.target.checked);
      });
    }

    // Tree species dropdown
    this._initDropdown('treeSpecies', () => {
      this._updateSelectedTreeTypes();
      // In scatter mode, manual tree type change switches biome to "Custom"
      if (this._state.toolOptions.useScatterSystem) {
        this._switchBiomeToCustom();
      }
    });

    // Dead ratio slider
    if (this._elements.deadRatio) {
      this._elements.deadRatio.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this._state.setToolOption('deadRatio', value / 100);
        if (this._elements.deadRatioVal) {
          this._elements.deadRatioVal.textContent = `${value}%`;
        }
        this._refreshScatterPreview();
      });
    }

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

    // Tree ages dropdown
    this._initDropdown('treeAges', () => {
      this._updateSelectedAges();
      // In scatter mode, manual age change switches biome to "Custom"
      if (this._state.toolOptions.useScatterSystem) {
        this._switchBiomeToCustom();
      }
    });

    // Brush types dropdown
    this._initDropdown('brushTypes', () => {
      this._updateSelectedBrushTypes();
    });

    // Floor types dropdown
    this._initDropdown('floorTypes', () => {
      this._updateSelectedFloorTypes();
    });

    // Particle types dropdown
    this._initDropdown('particleTypes', () => {
      this._updateSelectedParticleTypes();
    });

    // Brush standalone types dropdown (for brush tool)
    this._initDropdown('brushStandaloneTypes', () => {
      this._updateSelectedBrushStandaloneTypes();
    });

    // Boulder types dropdown (variant selector)
    this._initDropdown('boulderTypes', () => {
      this._updateSelectedBoulderVariants();
    });

    // Boulder floor types dropdown
    this._initDropdown('boulderFloorTypes', () => {
      this._updateSelectedBoulderFloorTypes();
    });

    // Boulder particle types dropdown
    this._initDropdown('boulderParticleTypes', () => {
      this._updateSelectedBoulderParticleTypes();
    });

    // Brush standalone density
    if (this._elements.brushStandaloneDensity) {
      this._elements.brushStandaloneDensity.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this._state.setToolOption('brushDensity', value);
        this._elements.brushStandaloneDensityVal.textContent = `${value.toFixed(1)}×`;
      });
    }

    // Brush standalone scale
    if (this._elements.brushStandaloneScale) {
      this._elements.brushStandaloneScale.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('brushScale', value);
        this._elements.brushStandaloneScaleVal.textContent = `${e.target.value}%`;
      });
    }

    // Brush standalone in water toggle
    if (this._elements.brushStandaloneInWater) {
      this._elements.brushStandaloneInWater.addEventListener('change', (e) => {
        this._state.setToolOption('brushInWater', e.target.checked);
      });
    }

    // Brush floor toggle
    if (this._elements.toggleBrushFloor) {
      this._elements.toggleBrushFloor.addEventListener('change', (e) => {
        this._state.setToolOption('floorEnabled', e.target.checked);
      });
    }

    // Brush particles toggle
    if (this._elements.toggleBrushParticles) {
      this._elements.toggleBrushParticles.addEventListener('change', (e) => {
        this._state.setToolOption('particlesEnabled', e.target.checked);
      });
    }

    // Boulder standalone density
    if (this._elements.boulderStandaloneDensity) {
      this._elements.boulderStandaloneDensity.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this._state.setToolOption('boulderDensity', value);
        this._elements.boulderStandaloneDensityVal.textContent = `${value.toFixed(1)}×`;
      });
    }

    // Boulder standalone scale
    if (this._elements.boulderStandaloneScale) {
      this._elements.boulderStandaloneScale.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('boulderScale', value);
        this._elements.boulderStandaloneScaleVal.textContent = `${e.target.value}%`;
      });
    }

    // Boulder scale variance
    if (this._elements.boulderStandaloneScaleVariance) {
      this._elements.boulderStandaloneScaleVariance.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('boulderScaleVariance', value);
        this._elements.boulderStandaloneScaleVarianceVal.textContent = `${e.target.value}%`;
      });
    }

    // Boulder in water toggle
    if (this._elements.boulderInWater) {
      this._elements.boulderInWater.addEventListener('change', (e) => {
        this._state.setToolOption('boulderInWater', e.target.checked);
      });
    }

    // Boulder floor toggle
    if (this._elements.toggleBoulderFloor) {
      this._elements.toggleBoulderFloor.addEventListener('change', (e) => {
        this._state.setToolOption('boulderFloorEnabled', e.target.checked);
      });
    }

    // Boulder particles toggle
    if (this._elements.toggleBoulderParticles) {
      this._elements.toggleBoulderParticles.addEventListener('change', (e) => {
        this._state.setToolOption('boulderParticlesEnabled', e.target.checked);
      });
    }

    // Boulder particle density
    if (this._elements.boulderParticleDensity) {
      this._elements.boulderParticleDensity.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this._state.setToolOption('boulderParticleDensity', value);
        this._elements.boulderParticleDensityVal.textContent = `${value.toFixed(1)}×`;
      });
    }

    // Boulder particle scale
    if (this._elements.boulderParticleScale) {
      this._elements.boulderParticleScale.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('boulderParticleScale', value);
        this._elements.boulderParticleScaleVal.textContent = `${e.target.value}%`;
      });
    }

    // Boulder particle scale variance
    if (this._elements.boulderParticleScaleVariance) {
      this._elements.boulderParticleScaleVariance.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) / 100;
        this._state.setToolOption('boulderParticleScaleVariance', value);
        this._elements.boulderParticleScaleVarianceVal.textContent = `${e.target.value}%`;
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

        // Apply biome+season config to floor/particle/brush dropdowns
        this._applyBiomeSeasonToOutputs();

        this._refreshSeasonTuning();
        console.log(`[Editor] Biome set to: ${biome}`);
      });
    }

    // Season (affects debris density and colors for new strokes)
    if (this._elements.seasonSelect) {
      this._elements.seasonSelect.addEventListener('change', (e) => {
        this._state.setToolOption('season', e.target.value);

        // Apply biome+season config to floor/particle/brush dropdowns
        this._applyBiomeSeasonToOutputs();

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
          // Don't toggle if clicking on the toggle switch or slider areas
          if (e.target.tagName === 'INPUT') return;
          if (e.target.closest('.category-toggle')) return;
          if (e.target.closest('.category-slider-wrap')) return;

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

      // When switching to scatter, apply biome preset to tree types and output settings
      if (useScatter) {
        this._applyBiomeToTreeTypes();
        this._applyBiomeSeasonToOutputs();
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

    // Re-seed preview button
    if (this._elements.reseedPreview) {
      this._elements.reseedPreview.addEventListener('click', () => {
        const newSeed = Math.floor(Math.random() * 1000000);
        this._state.setToolOption('previewSeed', newSeed);
        // Directly refresh preview (previewSeed excluded from previewKeys for performance)
        this._refreshScatterPreview();
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // CHILD SPAWN CONTROLS
    // ═══════════════════════════════════════════════════════════════
    this._bindChildSpawnControls();

    // ═══════════════════════════════════════════════════════════════
    // PCG PANEL EVENTS
    // ═══════════════════════════════════════════════════════════════
    this._bindPCGEvents();

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
    this._state.on(Events.MAP_LOADED, () => { this._updateStrokeCount(); this._fitMapToView(); });
    this._state.on(Events.MAP_CLEARED, () => { this._updateStrokeCount(); this._fitMapToView(); });

    // Refresh scatter preview when painting finishes (new seed was generated)
    this._state.on(Events.PAINTING_FINISHED, () => this._refreshScatterPreview());

    // Refresh scatter preview when relevant options change
    this._state.on(Events.TOOL_OPTIONS_CHANGED, ({ key }) => {
      // Note: previewSeed intentionally excluded - it changes on every stroke and would
      // cause expensive preview regeneration during drag painting. The re-seed button
      // directly calls _refreshScatterPreview() instead.
      const scatterPreviewKeys = ['treeType', 'treeTypes', 'treeRatios', 'deadTypes', 'deadRatio',
        'treeScale', 'treeDensity', 'selectedAges', 'ageRatios',
        'brushTypes', 'brushRatios', 'brushDensity', 'brushScale',
        'season', 'biome', 'seasonOverrides', 'childSpawnOverrides', 'brushRadius',
        'useScatterSystem', 'treesEnabled', 'floorEnabled',
        'particlesEnabled', 'brushEnabled', 'floorTypes', 'particleTypes',
        'boulderTypes', 'boulderRatios', 'boulderDensity', 'boulderScale', 'boulderScaleVariance',
        'boulderFloorEnabled', 'boulderFloorTypes', 'boulderParticlesEnabled',
        'boulderParticleTypes', 'boulderParticleDensity', 'boulderParticleScale',
        'boulderParticleScaleVariance'];
      if (!key || scatterPreviewKeys.includes(key)) {
        this._refreshScatterPreview();
      }

      // Refresh water preview when water-related options change
      const waterPreviewKeys = [
        'waterTextureType', 'waterFalloff', 'waterDepth',
        'shoreTextureType', 'shoreWidth', 'shoreFadeWidth', 'brushRadius'
      ];
      if (!key || waterPreviewKeys.includes(key)) {
        this._refreshWaterPreview();
      }
    });
  }

  _updateStrokeCount() {
    this._elements.strokeCount.textContent = this._state.strokes.length;
  }

  // ═══════════════════════════════════════════════════════════════
  // PCG PANEL EVENTS
  // ═══════════════════════════════════════════════════════════════

  _bindPCGEvents() {
    // Generate button
    const generateBtn = document.getElementById('pcg-generate');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        const pcgTool = this._toolManager.get('pcg');
        if (pcgTool) {
          pcgTool.generate(this._state, this._renderer);
        }
      });
    }

    // Random seed button
    const randomSeedBtn = document.getElementById('pcg-random-seed');
    if (randomSeedBtn) {
      randomSeedBtn.addEventListener('click', () => {
        const seedInput = document.getElementById('pcg-seed');
        if (seedInput) {
          seedInput.value = '';  // Empty = random seed on next generate
        }
      });
    }

    // Wire all range sliders to update their value displays (preserving suffix)
    const pcgPanel = document.getElementById('pcg-settings');
    if (pcgPanel) {
      pcgPanel.querySelectorAll('input[type="range"]').forEach(slider => {
        const valSpan = document.getElementById(slider.id + '-val');
        if (valSpan) {
          // Detect suffix from initial text (e.g. "60%" → "%", "20px" → "px")
          const initial = valSpan.textContent.trim();
          const suffixMatch = initial.match(/[^\d.\-]+$/);
          const suffix = suffixMatch ? suffixMatch[0] : '';
          slider.addEventListener('input', () => {
            valSpan.textContent = slider.value + suffix;
          });
        }
      });
    }

    // Live mode: debounced auto-regenerate on any PCG input change
    this._pcgLiveTimer = null;
    const liveToggle = document.getElementById('pcg-live-mode');

    const triggerLiveGenerate = () => {
      if (!liveToggle || !liveToggle.checked) return;
      clearTimeout(this._pcgLiveTimer);
      this._pcgLiveTimer = setTimeout(() => {
        const pcgTool = this._toolManager.get('pcg');
        if (pcgTool) {
          pcgTool.generate(this._state, this._renderer, { _live: true });
        }
      }, 300);
    };

    if (pcgPanel) {
      // Sliders fire 'input' continuously while dragging
      pcgPanel.querySelectorAll('input[type="range"]').forEach(slider => {
        if (slider.id === 'pcg-live-mode') return;
        slider.addEventListener('input', triggerLiveGenerate);
      });

      // Checkboxes and selects fire 'change'
      pcgPanel.querySelectorAll('input[type="checkbox"], select').forEach(el => {
        if (el.id === 'pcg-live-mode') return;
        el.addEventListener('change', triggerLiveGenerate);
      });

      // Number inputs (seed) fire 'input'
      pcgPanel.querySelectorAll('input[type="number"]').forEach(el => {
        el.addEventListener('input', triggerLiveGenerate);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEWPORT HELPERS
  // ═══════════════════════════════════════════════════════════════

  _fitMapToView() {
    const sw = this._renderer.screenWidth;
    const sh = this._renderer.screenHeight;
    if (!sw || !sh) return;

    const mw = this._state.canvasWidth;
    const mh = this._state.canvasHeight;
    const padding = 20;

    const zoom = Math.min((sw - padding * 2) / mw, (sh - padding * 2) / mh);
    const x = (sw - mw * zoom) / 2;
    const y = (sh - mh * zoom) / 2;
    this._state.setViewport(x, y, zoom);
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

    if (this._elements.mapNameInput) this._elements.mapNameInput.value = 'Untitled Map';
    if (this._elements.mapName) this._elements.mapName.textContent = 'Untitled Map';
    if (this._elements.mapNameHeader) this._elements.mapNameHeader.value = 'Untitled Map';
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
    // biome: { 'tree-oak': 0.6, 'tree-dead': 0.1 } → preset: { oak: 0.6 }, deadTypes: [], deadRatio: 0
    // Note: Old biome format uses 'tree-dead' as a separate type, but we now use deadTypes/deadRatio
    // For now, we filter out 'dead' and don't enable dead variants (user can enable manually)
    const treeTypes = [];
    const treeRatios = {};
    for (const [key, ratio] of Object.entries(biomePreset.trees)) {
      const treeType = key.replace('tree-', '');
      // Skip 'dead' - it's handled separately via deadTypes/deadRatio now
      if (treeType === 'dead') continue;
      treeTypes.push(treeType);
      treeRatios[treeType] = ratio;
    }

    // Normalize ratios after removing 'dead' so they sum to 1
    const totalRatio = Object.values(treeRatios).reduce((sum, r) => sum + r, 0);
    if (totalRatio > 0 && totalRatio !== 1) {
      for (const type of Object.keys(treeRatios)) {
        treeRatios[type] = treeRatios[type] / totalRatio;
      }
    }

    // Build preset object compatible with _applyPreset
    const preset = {
      treeTypes,
      treeRatios,
      deadTypes: [],      // Don't enable dead variants by default
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
   * Apply biome+season config to floor/particle/brush dropdowns
   * Called when biome or season changes
   */
  _applyBiomeSeasonToOutputs() {
    const biome = this._state.toolOptions.biome || 'temperate';
    const season = this._state.toolOptions.season || 'summer';

    if (biome === 'custom') return; // Don't override in custom mode

    const biomePreset = BIOME_PRESETS[biome];
    const seasonConfig = getSeasonBiomeConfig(season, biome);

    if (!biomePreset || !seasonConfig) return;

    // Apply brush types from biome preset
    if (biomePreset.brush && biomePreset.brush.length > 0) {
      this._applyBrushTypesToDropdown(biomePreset.brush);
    }

    // Apply floor type from season+biome config
    if (seasonConfig.scatter?.floorType) {
      this._applyFloorTypeToDropdown(seasonConfig.scatter.floorType);
    }

    // Apply particle type from season+biome config
    if (seasonConfig.scatter?.particleType) {
      this._applyParticleTypeToDropdown(seasonConfig.scatter.particleType);
    }

    this._refreshScatterPreview();
  }

  /**
   * Apply brush types to dropdown (checking the matching items)
   */
  _applyBrushTypesToDropdown(brushTypes) {
    // Update forest tool's brush dropdown
    const menu = this._elements.brushTypesMenu;
    if (menu) {
      menu.querySelectorAll('.dropdown-item').forEach(item => {
        const brushType = item.dataset.brush;
        const checkbox = item.querySelector('input[type="checkbox"]');
        const label = item.querySelector('.dropdown-item-label');
        if (checkbox) {
          const shouldCheck = brushTypes.includes(brushType);
          checkbox.checked = shouldCheck;
          if (label) label.classList.toggle('checked', shouldCheck);
        }
      });
      this._updateSelectedBrushTypes();
      this._updateDropdownValue('brushTypes');
    }

    // Also update brush tool's standalone dropdown
    const standaloneMenu = this._elements.brushStandaloneTypesMenu;
    if (standaloneMenu) {
      standaloneMenu.querySelectorAll('.dropdown-item').forEach(item => {
        const brushType = item.dataset.brush;
        const checkbox = item.querySelector('input[type="checkbox"]');
        const label = item.querySelector('.dropdown-item-label');
        if (checkbox) {
          const shouldCheck = brushTypes.includes(brushType);
          checkbox.checked = shouldCheck;
          if (label) label.classList.toggle('checked', shouldCheck);
        }
      });
      this._updateSelectedBrushStandaloneTypes();
      this._updateDropdownValue('brushStandaloneTypes');
    }
  }

  /**
   * Apply floor type to dropdown (checking only the matching item)
   */
  _applyFloorTypeToDropdown(floorType) {
    const menu = this._elements.floorTypesMenu;
    if (!menu) return;

    // Uncheck all, then check the matching one
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const itemFloorType = item.dataset.floor;
      const checkbox = item.querySelector('input[type="checkbox"]');
      const label = item.querySelector('.dropdown-item-label');
      if (checkbox) {
        const shouldCheck = itemFloorType === floorType;
        checkbox.checked = shouldCheck;
        if (label) label.classList.toggle('checked', shouldCheck);
      }
    });

    this._updateSelectedFloorTypes();
    this._updateDropdownValue('floorTypes');
  }

  /**
   * Apply particle type to dropdown (checking only the matching item)
   */
  _applyParticleTypeToDropdown(particleType) {
    const menu = this._elements.particleTypesMenu;
    if (!menu) return;

    // Uncheck all, then check the matching one
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const itemParticleType = item.dataset.particle;
      const checkbox = item.querySelector('input[type="checkbox"]');
      const label = item.querySelector('.dropdown-item-label');
      if (checkbox) {
        const shouldCheck = itemParticleType === particleType;
        checkbox.checked = shouldCheck;
        if (label) label.classList.toggle('checked', shouldCheck);
      }
    });

    this._updateSelectedParticleTypes();
    this._updateDropdownValue('particleTypes');
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

      // Sync brush standalone UI with current state when showing
      if (feature === 'brush') {
        this._syncBrushStandaloneUI();
      }
    }

    // Show/hide boulder settings
    if (this._elements.boulderSettings) {
      this._elements.boulderSettings.style.display = feature === 'boulder' ? 'block' : 'none';
    }

    // Show/hide ground settings
    if (this._elements.groundSettings) {
      this._elements.groundSettings.style.display = feature === 'groundTexture' ? 'block' : 'none';
      if (feature === 'groundTexture') {
        this._refreshGroundPreview();
      }
    }

    // Show/hide water settings
    if (this._elements.waterSettings) {
      this._elements.waterSettings.style.display = feature === 'water' ? 'block' : 'none';
      if (feature === 'water') {
        this._refreshWaterPreview();
      }
    }

    // Show/hide scatter preview - only for forest/brush/boulder in scatter mode, hide for water/ground
    const showScatterPreview = useScatter && (feature === 'forest' || feature === 'brush' || feature === 'boulder');
    if (this._elements.scatterPreviewSection) {
      this._elements.scatterPreviewSection.style.display = showScatterPreview ? 'block' : 'none';
      if (showScatterPreview) this._refreshScatterPreview();
    }

    // Show/hide scatter environment (biome/season) - for forest, brush, or boulder in scatter mode
    const showEnvironment = useScatter && (feature === 'forest' || feature === 'brush' || feature === 'boulder');
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

    // Grid size: header -> hidden select (creates new map)
    if (el.gridSizeHeader) {
      el.gridSizeHeader.addEventListener('change', (e) => {
        const size = parseInt(e.target.value);
        if (el.gridSize) el.gridSize.value = e.target.value;
        if (confirm(`This will create a new ${size}x${size} map. Continue?`)) {
          this._state.newMap({
            gridWidth: size,
            gridHeight: size,
            cellSize: 64
          });
        } else {
          // Reset select to current value
          e.target.value = this._state.gridWidth;
          if (el.gridSize) el.gridSize.value = this._state.gridWidth;
        }
      });
    }

    // Base layer: header -> hidden select
    if (el.baseLayerHeader) {
      el.baseLayerHeader.addEventListener('change', (e) => {
        if (el.baseLayer) el.baseLayer.value = e.target.value;
        this._state.baseLayer = e.target.value;
      });
    }

    // Quality preset: change LOD settings
    if (el.qualityPreset) {
      // Load saved preset and sync UI
      loadQualityPreset();
      const currentPreset = getCurrentPreset();
      if (currentPreset !== 'custom') {
        el.qualityPreset.value = currentPreset;
      }

      el.qualityPreset.addEventListener('change', (e) => {
        setQualityPreset(e.target.value);
        saveQualityPreset();
        // Invalidate caches and request re-render
        this._renderer.invalidateAllCaches();
        this._state.requestRender();
      });
    }

    // LOD settings modal
    this._setupLODModal();

  }

  /**
   * Setup LOD settings modal
   */
  _setupLODModal() {
    const el = this._elements;

    // Open modal
    if (el.lodSettingsBtn) {
      el.lodSettingsBtn.addEventListener('click', () => {
        this._populateLODModal();
        el.lodModal.classList.add('open');
      });
    }

    // Close modal
    if (el.lodModalClose) {
      el.lodModalClose.addEventListener('click', () => {
        el.lodModal.classList.remove('open');
      });
    }

    // Close on overlay click
    if (el.lodModal) {
      el.lodModal.addEventListener('click', (e) => {
        if (e.target === el.lodModal) {
          el.lodModal.classList.remove('open');
        }
      });
    }

    // Reset button
    if (el.lodReset) {
      el.lodReset.addEventListener('click', () => {
        const preset = resetToPreset();
        if (el.qualityPreset) {
          el.qualityPreset.value = preset;
        }
        this._populateLODModal();
        saveQualityPreset();
        this._renderer.invalidateAllCaches();
        this._state.requestRender();
      });
    }

    // Apply button
    if (el.lodApply) {
      el.lodApply.addEventListener('click', () => {
        this._applyLODModal();
        el.lodModal.classList.remove('open');
      });
    }

    // Update hints when minPixels inputs change
    const categories = ['tree', 'brush', 'floor', 'particle'];
    for (const cat of categories) {
      const input = document.getElementById(`lod-minPixels-${cat}`);
      if (input) {
        input.addEventListener('input', () => this._updateMinPixelsHints());
      }
    }
  }

  /**
   * Populate LOD modal with current settings
   */
  _populateLODModal() {
    const settings = getLODSettings();

    // Helper to set input value
    const setInput = (id, value) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    };

    // Preview settings
    setInput('lod-previewMaxPixels', settings.previewMaxPixels);
    setInput('lod-previewMinScale', settings.previewMinScale);

    // Texture settings
    setInput('lod-textureScale', settings.textureScale);
    setInput('lod-textureScalePreview', settings.textureScalePreview);
    setInput('lod-spriteScale', settings.spriteScale);

    // Minimum pixel size LOD thresholds
    if (settings.minPixels) {
      setInput('lod-minPixels-tree', settings.minPixels.tree);
      setInput('lod-minPixels-brush', settings.minPixels.brush);
      setInput('lod-minPixels-floor', settings.minPixels.floor);
      setInput('lod-minPixels-particle', settings.minPixels.particle);
      this._updateMinPixelsHints();
    }

    // Viewport margins
    setInput('lod-cullMarginGround', settings.cullMarginGround);
    setInput('lod-cullMarginCanopy', settings.cullMarginCanopy);

    // Max items
    if (settings.maxItems) {
      setInput('lod-maxItems-tree', settings.maxItems.tree);
      setInput('lod-maxItems-brush', settings.maxItems.brush);
      setInput('lod-maxItems-floor', settings.maxItems.floor);
      setInput('lod-maxItems-particle', settings.maxItems.particle);
      setInput('lod-maxItems-total', settings.maxItems.total);
    }
  }

  /**
   * Apply LOD modal settings
   */
  _applyLODModal() {
    // Helper to get input value
    const getInput = (id, parser = parseFloat) => {
      const input = document.getElementById(id);
      return input ? parser(input.value) : null;
    };

    const settings = {
      name: 'Custom',
      description: 'User-defined settings',

      previewMaxPixels: getInput('lod-previewMaxPixels', parseInt),
      previewMinScale: getInput('lod-previewMinScale'),

      textureScale: getInput('lod-textureScale', parseInt),
      textureScalePreview: getInput('lod-textureScalePreview', parseInt),
      spriteScale: getInput('lod-spriteScale'),

      minPixels: {
        tree: getInput('lod-minPixels-tree', parseInt),
        brush: getInput('lod-minPixels-brush', parseInt),
        floor: getInput('lod-minPixels-floor', parseInt),
        particle: getInput('lod-minPixels-particle', parseInt),
      },

      cullMarginGround: getInput('lod-cullMarginGround', parseInt),
      cullMarginCanopy: getInput('lod-cullMarginCanopy', parseInt),

      maxItems: {
        tree: getInput('lod-maxItems-tree', parseInt),
        brush: getInput('lod-maxItems-brush', parseInt),
        floor: getInput('lod-maxItems-floor', parseInt),
        particle: getInput('lod-maxItems-particle', parseInt),
        total: getInput('lod-maxItems-total', parseInt)
      }
    };

    applyLODSettings(settings);
    saveQualityPreset();

    // Update preset dropdown to show custom (or closest preset if matches)
    if (this._elements.qualityPreset) {
      this._elements.qualityPreset.value = 'high'; // Will not match 'custom', just visual indicator
    }

    // Invalidate caches and re-render
    this._renderer.invalidateAllCaches();
    this._state.requestRender();

    console.log('[LOD] Applied custom settings:', settings);
  }

  /**
   * Update the zoom hints next to minPixels inputs
   * Shows the approximate zoom level where items become visible
   */
  _updateMinPixelsHints() {
    const categories = ['tree', 'brush', 'floor', 'particle'];
    const typicalScales = { tree: 0.4, brush: 0.25, floor: 0.15, particle: 0.08 };

    for (const cat of categories) {
      const input = document.getElementById(`lod-minPixels-${cat}`);
      const hint = document.getElementById(`lod-minPixels-${cat}-hint`);
      if (!input || !hint) continue;

      const minPixels = parseInt(input.value) || 8;
      const typicalScale = typicalScales[cat];
      // Calculate zoom where typical item becomes visible
      // renderedSize = BASE_SPRITE_SIZE * scale * zoom = minPixels
      // zoom = minPixels / (BASE_SPRITE_SIZE * scale)
      const minZoom = minPixels / (BASE_SPRITE_SIZE * typicalScale);
      hint.textContent = `≈ ${Math.round(minZoom * 100)}% zoom`;
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

    // Update tree species dropdown checkboxes
    const presetDeadTypes = preset.deadTypes || [];
    const speciesMenu = this._elements.treeSpeciesMenu;
    if (speciesMenu) {
      speciesMenu.querySelectorAll('.dropdown-item').forEach(item => {
        const species = item.dataset.species;
        const checkbox = item.querySelector(`#tree-${species}`);
        const label = item.querySelector('.dropdown-item-label');
        const deadToggle = item.querySelector('.dropdown-dead-toggle');
        const deadCheckbox = item.querySelector(`#tree-${species}-dead`);
        if (checkbox) {
          const isSelected = preset.treeTypes.includes(species);
          checkbox.checked = isSelected;
          if (label) label.classList.toggle('checked', isSelected);
          if (deadToggle) deadToggle.classList.toggle('disabled', !isSelected);
          // Set dead checkbox based on preset (or uncheck if preset doesn't include dead settings)
          if (deadCheckbox) {
            const deadKey = `${species}-dead`;
            const isDeadSelected = presetDeadTypes.includes(deadKey);
            deadCheckbox.checked = isDeadSelected;
            if (deadToggle) deadToggle.classList.toggle('checked', isDeadSelected);
          }
        }
      });
      this._updateDropdownValue('treeSpecies');
    }

    // Update dead types in state from preset
    this._state.setToolOption('deadTypes', presetDeadTypes);

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

    // Update age dropdown checkboxes
    const agesMenu = this._elements.treeAgesMenu;
    if (agesMenu) {
      agesMenu.querySelectorAll('.dropdown-item').forEach(item => {
        const age = item.dataset.age;
        const checkbox = item.querySelector(`#age-${age}`);
        const label = item.querySelector('.dropdown-item-label');
        if (checkbox) {
          const isSelected = preset.selectedAges.includes(age);
          checkbox.checked = isSelected;
          if (label) label.classList.toggle('checked', isSelected);
        }
      });
      this._updateDropdownValue('treeAges');
    }

    // Update age ratio sliders
    if (preset.selectedAges.length > 1 && this._elements.ageRatiosContainer) {
      this._elements.ageRatiosContainer.style.display = 'block';
      this._renderAgeRatioSliders(preset.selectedAges, preset.ageRatios);
    } else if (this._elements.ageRatiosContainer) {
      this._elements.ageRatiosContainer.style.display = 'none';
    }

    // Update scale slider
    const scalePercent = Math.round(preset.treeScale * 100);
    if (this._elements.treeScale) {
      this._elements.treeScale.value = scalePercent;
    }
    if (this._elements.scaleVal) {
      this._elements.scaleVal.textContent = `${scalePercent}%`;
    }

    // Update density slider
    if (this._elements.treeDensity) {
      this._elements.treeDensity.value = preset.treeDensity;
    }
    if (this._elements.densityVal) {
      this._elements.densityVal.textContent = preset.treeDensity;
    }

    // Update dead ratio slider visibility based on dead checkboxes
    this._updateDeadRatioVisibility();
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
  // DROPDOWN CHECKBOX COMPONENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize a dropdown checkbox component
   * @param {string} name - Dropdown name (e.g., 'treeSpecies', 'floorTypes')
   * @param {function} onChange - Callback when selection changes
   */
  _initDropdown(name, onChange) {
    const dropdown = this._elements[`${name}Dropdown`];
    const menu = this._elements[`${name}Menu`];
    if (!dropdown || !menu) return;

    const trigger = dropdown.querySelector('.dropdown-trigger');
    if (!trigger) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = trigger.classList.contains('open');

      // Close all other dropdowns first
      document.querySelectorAll('.dropdown-trigger.open').forEach(t => {
        t.classList.remove('open');
        t.closest('.dropdown-select')?.querySelector('.dropdown-menu')?.classList.remove('open');
      });

      if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
      }
    });

    // Handle checkbox changes
    menu.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      // Skip dead toggle checkboxes - they have their own handler
      if (checkbox.closest('.dropdown-dead-toggle')) return;

      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const label = checkbox.closest('.dropdown-item')?.querySelector('.dropdown-item-label');
        if (label) {
          label.classList.toggle('checked', checkbox.checked);
        }

        // For tree species: enable/disable dead toggle based on species selection
        if (name === 'treeSpecies') {
          const deadToggle = checkbox.closest('.dropdown-item-row')?.querySelector('.dropdown-dead-toggle');
          if (deadToggle) {
            deadToggle.classList.toggle('disabled', !checkbox.checked);
            // If species unchecked, also uncheck dead variant
            if (!checkbox.checked) {
              const deadCheckbox = deadToggle.querySelector('input[type="checkbox"]');
              if (deadCheckbox && deadCheckbox.checked) {
                deadCheckbox.checked = false;
                deadToggle.classList.remove('checked');
              }
            }
          }
          // Update dead ratio slider visibility
          this._updateDeadRatioVisibility();
        }

        onChange();
        this._updateDropdownValue(name);
        this._refreshScatterPreview();
      });
    });

    // For tree dead toggles - separate handler
    if (name === 'treeSpecies') {
      menu.querySelectorAll('.dropdown-dead-toggle input[type="checkbox"]').forEach(deadCheckbox => {
        deadCheckbox.addEventListener('change', (e) => {
          e.stopPropagation();
          const deadToggle = deadCheckbox.closest('.dropdown-dead-toggle');
          if (deadToggle) {
            deadToggle.classList.toggle('checked', deadCheckbox.checked);
          }
          this._updateDeadRatioVisibility();
          onChange();
          this._refreshScatterPreview();
        });
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        trigger.classList.remove('open');
        menu.classList.remove('open');
      }
    });

    // Initialize display value
    this._updateDropdownValue(name);

    // Sync state from HTML on init (so checked checkboxes update state)
    onChange();
  }

  /**
   * Populate water type dropdown from available sprites
   * Called after images are loaded to dynamically build options
   */
  _populateWaterDropdown() {
    const waterTypes = this._renderer.waterTypes;
    const menu = this._elements.waterTypeMenu;
    const hiddenSelect = this._elements.waterTextureType;

    if (!menu || waterTypes.length === 0) return;

    // Clear existing items
    menu.innerHTML = '';
    if (hiddenSelect) hiddenSelect.innerHTML = '';

    // Build dropdown items from available water sprites
    waterTypes.forEach((type, index) => {
      // Create display name: 'water-pond' -> 'Pond', 'water' -> 'Water'
      let displayName = type.replace('water-', '').replace(/-/g, ' ');
      displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
      if (type === 'water') displayName = 'Water';

      // Create dropdown item
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.dataset.water = type;
      item.innerHTML = `
        <input type="radio" name="water-type" id="water-type-${type}" ${index === 0 ? 'checked' : ''}>
        <span class="dropdown-item-label ${index === 0 ? 'checked' : ''}">${displayName}</span>
      `;
      menu.appendChild(item);

      // Also update hidden select for compatibility
      if (hiddenSelect) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = displayName;
        if (index === 0) option.selected = true;
        hiddenSelect.appendChild(option);
      }
    });

    // Update display value to first item
    if (this._elements.waterTypeValue && waterTypes.length > 0) {
      let displayName = waterTypes[0].replace('water-', '').replace(/-/g, ' ');
      displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
      if (waterTypes[0] === 'water') displayName = 'Water';
      this._elements.waterTypeValue.textContent = displayName;
    }

    console.log('[Editor] Water dropdown populated with:', waterTypes);
  }

  /**
   * Initialize a radio button dropdown (single selection)
   * @param {string} name - Dropdown name (e.g., 'waterType', 'shoreType')
   * @param {function} onChange - Callback when selection changes
   */
  _initRadioDropdown(name, onChange) {
    const dropdown = this._elements[`${name}Dropdown`];
    const menu = this._elements[`${name}Menu`];
    const valueEl = this._elements[`${name}Value`];
    if (!dropdown || !menu) return;

    const trigger = dropdown.querySelector('.dropdown-trigger');
    if (!trigger) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = trigger.classList.contains('open');

      // Close all other dropdowns first
      document.querySelectorAll('.dropdown-trigger.open').forEach(t => {
        t.classList.remove('open');
        t.closest('.dropdown-select')?.querySelector('.dropdown-menu')?.classList.remove('open');
      });

      if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
      }
    });

    // Handle radio changes
    menu.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        e.stopPropagation();
        const item = radio.closest('.dropdown-item');
        const value = item?.dataset.water || item?.dataset.shore || radio.value;

        // Update labels
        menu.querySelectorAll('.dropdown-item-label').forEach(l => l.classList.remove('checked'));
        const label = item?.querySelector('.dropdown-item-label');
        if (label) {
          label.classList.add('checked');
          if (valueEl) valueEl.textContent = label.textContent.trim();
        }

        // Close dropdown after selection
        trigger.classList.remove('open');
        menu.classList.remove('open');

        onChange(value);
      });
    });

    // Also handle clicking on the item row
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return; // Let radio handle it
        const radio = item.querySelector('input[type="radio"]');
        if (radio && !radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        trigger.classList.remove('open');
        menu.classList.remove('open');
      }
    });
  }

  /**
   * Update the display value of a dropdown
   * @param {string} name - Dropdown name
   */
  _updateDropdownValue(name) {
    const valueEl = this._elements[`${name}Value`];
    const menu = this._elements[`${name}Menu`];
    if (!valueEl || !menu) return;

    const selected = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const label = item.querySelector('.dropdown-item-label');
      if (checkbox?.checked && label) {
        selected.push(label.textContent.trim());
      }
    });

    if (selected.length === 0) {
      valueEl.textContent = 'None';
      valueEl.classList.add('empty');
    } else if (selected.length <= 2) {
      valueEl.textContent = selected.join(', ');
      valueEl.classList.remove('empty');
    } else {
      valueEl.textContent = `${selected.length} selected`;
      valueEl.classList.remove('empty');
    }
  }

  /**
   * Update dead ratio slider visibility based on dead variant selections
   */
  _updateDeadRatioVisibility() {
    const menu = this._elements.treeSpeciesMenu;
    if (!menu) return;

    let hasDeadSelected = false;
    menu.querySelectorAll('.dropdown-dead-toggle input[type="checkbox"]').forEach(cb => {
      if (cb.checked) hasDeadSelected = true;
    });

    if (this._elements.deadRatioRow) {
      this._elements.deadRatioRow.style.display = hasDeadSelected ? 'flex' : 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TREE TYPE SELECTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update selected tree types and ratio UI (from dropdown checkboxes)
   */
  _updateSelectedTreeTypes() {
    const menu = this._elements.treeSpeciesMenu;
    if (!menu) return;

    const selectedTypes = [];
    const deadTypes = [];

    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const species = item.dataset.species;
      const checkbox = item.querySelector(`#tree-${species}`);
      const deadCheckbox = item.querySelector(`#tree-${species}-dead`);

      if (checkbox?.checked) {
        selectedTypes.push(species);
      }
      if (deadCheckbox?.checked && checkbox?.checked) {
        deadTypes.push(`${species}-dead`);
      }
    });

    // Allow zero selection (no trees)

    // Update state with selected types (equal ratios by default)
    const ratios = {};
    if (selectedTypes.length > 0) {
      const equalRatio = 1 / selectedTypes.length;
      selectedTypes.forEach(type => {
        ratios[type] = equalRatio;
      });
    }

    // Set all tree-related options at once to avoid multiple event fires
    this._state.setToolOptions({
      treeTypes: selectedTypes,
      treeRatios: ratios,
      deadTypes: deadTypes
    });

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
   * Update selected ages and ratio UI (from dropdown checkboxes)
   */
  _updateSelectedAges() {
    const menu = this._elements.treeAgesMenu;
    if (!menu) return;

    const selectedAges = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const age = item.dataset.age;
      const checkbox = item.querySelector(`#age-${age}`);
      if (checkbox?.checked) {
        selectedAges.push(age);
      }
    });

    // Allow zero selection (defaults handled in generation)

    // Update state with selected ages (equal ratios by default)
    const ratios = {};
    if (selectedAges.length > 0) {
      const equalRatio = 1 / selectedAges.length;
      selectedAges.forEach(age => {
        ratios[age] = equalRatio;
      });
    }

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
   * Update selected brush types and ratio UI (from dropdown checkboxes)
   */
  _updateSelectedBrushTypes() {
    const menu = this._elements.brushTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const brushType = item.dataset.brush;
      const checkbox = item.querySelector(`input[type="checkbox"]`);
      if (checkbox?.checked) {
        selectedTypes.push(brushType);
      }
    });

    // Allow zero selection (no brush)

    // Update state with selected types (equal ratios by default)
    const ratios = {};
    if (selectedTypes.length > 0) {
      const equalRatio = 1 / selectedTypes.length;
      selectedTypes.forEach(type => {
        ratios[type] = equalRatio;
      });
    }

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
   * Update selected brush types from standalone brush dropdown (brush tool panel)
   * Uses the same state as forest brush dropdown
   */
  _updateSelectedBrushStandaloneTypes() {
    const menu = this._elements.brushStandaloneTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const brushType = item.dataset.brush;
      const checkbox = item.querySelector(`input[type="checkbox"]`);
      if (checkbox?.checked) {
        selectedTypes.push(brushType);
      }
    });

    // Require at least one brush type
    if (selectedTypes.length === 0) {
      // Re-check first type
      const firstItem = menu.querySelector('.dropdown-item');
      if (firstItem) {
        const checkbox = firstItem.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
        selectedTypes.push(firstItem.dataset.brush);
      }
    }

    // Update state with selected types (equal ratios by default)
    const ratios = {};
    const equalRatio = 1 / selectedTypes.length;
    selectedTypes.forEach(type => {
      ratios[type] = equalRatio;
    });

    this._state.setToolOption('brushTypes', selectedTypes);
    this._state.setToolOption('brushRatios', ratios);

    // Update display value
    const labels = {
      'bush-small': 'Bush S', 'bush-large': 'Bush L',
      'fern': 'Fern', 'reed': 'Reed', 'dead-brush': 'Dead'
    };
    if (this._elements.brushStandaloneTypesValue) {
      if (selectedTypes.length === 1) {
        this._elements.brushStandaloneTypesValue.textContent = labels[selectedTypes[0]] || selectedTypes[0];
      } else {
        this._elements.brushStandaloneTypesValue.textContent = `${selectedTypes.length} types`;
      }
    }

    this._refreshScatterPreview();
  }

  /**
   * Update selected boulder variants from dropdown checkboxes
   */
  _updateSelectedBoulderVariants() {
    const menu = this._elements.boulderTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const boulderType = item.dataset.boulder;
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox?.checked) {
        selectedTypes.push(boulderType);
      }
    });

    // Require at least one type
    if (selectedTypes.length === 0) {
      const firstItem = menu.querySelector('.dropdown-item');
      if (firstItem) {
        const checkbox = firstItem.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
        selectedTypes.push(firstItem.dataset.boulder);
      }
    }

    // Build equal ratios
    const ratios = {};
    const equalRatio = 1 / selectedTypes.length;
    selectedTypes.forEach(type => { ratios[type] = equalRatio; });

    this._state.setToolOption('boulderTypes', selectedTypes);
    this._state.setToolOption('boulderRatios', ratios);

    this._refreshScatterPreview();
  }

  /**
   * Update selected boulder floor types from dropdown checkboxes
   */
  _updateSelectedBoulderFloorTypes() {
    const menu = this._elements.boulderFloorTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const floorType = item.dataset.boulderFloor;
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox?.checked) {
        selectedTypes.push(floorType);
      }
    });

    this._state.setToolOption('boulderFloorTypes', selectedTypes);
    this._refreshScatterPreview();
  }

  /**
   * Update selected boulder particle types from dropdown checkboxes
   */
  _updateSelectedBoulderParticleTypes() {
    const menu = this._elements.boulderParticleTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const particleType = item.dataset.boulderParticle;
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox?.checked) {
        selectedTypes.push(particleType);
      }
    });

    this._state.setToolOption('boulderParticleTypes', selectedTypes);
    this._refreshScatterPreview();
  }

  /**
   * Sync brush standalone UI with current tool options state
   */
  _syncBrushStandaloneUI() {
    const options = this._state.toolOptions;

    // Sync brush types checkboxes
    const menu = this._elements.brushStandaloneTypesMenu;
    if (menu) {
      const selectedTypes = options.brushTypes || ['bush-small'];
      menu.querySelectorAll('.dropdown-item').forEach(item => {
        const brushType = item.dataset.brush;
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = selectedTypes.includes(brushType);
          const label = item.querySelector('.dropdown-item-label');
          if (label) label.classList.toggle('checked', checkbox.checked);
        }
      });

      // Update display value
      const labels = {
        'bush-small': 'Bush S', 'bush-large': 'Bush L',
        'fern': 'Fern', 'reed': 'Reed', 'dead-brush': 'Dead'
      };
      if (this._elements.brushStandaloneTypesValue) {
        if (selectedTypes.length === 1) {
          this._elements.brushStandaloneTypesValue.textContent = labels[selectedTypes[0]] || selectedTypes[0];
        } else {
          this._elements.brushStandaloneTypesValue.textContent = `${selectedTypes.length} types`;
        }
      }
    }

    // Sync density slider
    if (this._elements.brushStandaloneDensity) {
      const density = options.brushDensity ?? 1.0;
      this._elements.brushStandaloneDensity.value = density;
      if (this._elements.brushStandaloneDensityVal) {
        this._elements.brushStandaloneDensityVal.textContent = `${density.toFixed(1)}×`;
      }
    }

    // Sync scale slider
    if (this._elements.brushStandaloneScale) {
      const scale = (options.brushScale ?? 0.25) * 100;
      this._elements.brushStandaloneScale.value = scale;
      if (this._elements.brushStandaloneScaleVal) {
        this._elements.brushStandaloneScaleVal.textContent = `${Math.round(scale)}%`;
      }
    }

    // Sync floor/particle toggles
    if (this._elements.toggleBrushFloor) {
      this._elements.toggleBrushFloor.checked = options.floorEnabled ?? true;
    }
    if (this._elements.toggleBrushParticles) {
      this._elements.toggleBrushParticles.checked = options.particlesEnabled ?? true;
    }

    // Sync in water toggle
    if (this._elements.brushStandaloneInWater) {
      this._elements.brushStandaloneInWater.checked = options.brushInWater ?? false;
    }
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
   * Update selected floor types from dropdown checkboxes
   */
  _updateSelectedFloorTypes() {
    const menu = this._elements.floorTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const floorType = item.dataset.floor;
      const checkbox = item.querySelector(`input[type="checkbox"]`);
      if (checkbox?.checked) {
        selectedTypes.push(floorType);
      }
    });

    // Allow zero selection (no floor)

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
  }

  /**
   * Update selected particle types from dropdown checkboxes
   */
  _updateSelectedParticleTypes() {
    const menu = this._elements.particleTypesMenu;
    if (!menu) return;

    const selectedTypes = [];
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      const particleType = item.dataset.particle;
      const checkbox = item.querySelector(`input[type="checkbox"]`);
      if (checkbox?.checked) {
        selectedTypes.push(particleType);
      }
    });

    // Allow zero selection (no particles)

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

    // Invalidate paint tool's on-canvas preview cache so it regenerates
    PaintTool.invalidatePreviewCache();

    // Use shared forest generation function (single source of truth)
    const mockTerrain = { scatterItems: [], strokes: [] };
    const virtualCx = 1000;
    const virtualCy = 1000;
    const radius = options.brushRadius;

    // Boulder tool overrides brush types/ratios/density/scale
    const isBoulderTool = options.featureType === 'boulder';
    const pvBrushTypes = isBoulderTool ? (options.boulderTypes ?? ['boulder-erratic', 'boulder-field', 'boulder-outcrop']) : (options.brushTypes || ['bush-small']);
    const pvBrushRatios = isBoulderTool ? (options.boulderRatios ?? {}) : (options.brushRatios || {});
    const pvBrushDensity = isBoulderTool ? (options.boulderDensity ?? 0.8) : (options.brushDensity ?? 1.0);
    const pvBrushScale = isBoulderTool ? (options.boulderScale ?? 0.3) : (options.brushScale ?? 0.25);

    const previewItems = generateForestItems(mockTerrain,
      { x: virtualCx, y: virtualCy, radius, seed: options.previewSeed ?? 42 },
      {
        treeTypes: options.treeTypes || [options.treeType || 'oak'],
        treeRatios: options.treeRatios || {},
        deadTypes: options.deadTypes || [],
        deadRatio: options.deadRatio ?? 0,
        treeDensity: options.treeDensity ?? 1.0,
        treeScale: options.treeScale ?? 0.35,
        treeSpacing: options.treeSpacing ?? 1.0,
        selectedAges: options.selectedAges ?? ['young', 'transitional', 'old'],
        ageRatios: options.ageRatios ?? null,
        brushTypes: pvBrushTypes,
        brushRatios: pvBrushRatios,
        brushDensity: pvBrushDensity,
        brushScale: pvBrushScale,
        brushScaleVariance: isBoulderTool ? (options.boulderScaleVariance ?? 0.3) : undefined,
        season: options.season ?? 'summer',
        biome: options.biome ?? 'temperate',
        seasonOverrides: options.seasonOverrides ?? {},
        childSpawnOverrides: isBoulderTool
          ? {
              floor: {
                type: (options.boulderFloorTypes?.length === 1) ? options.boulderFloorTypes[0] : 'auto'
              },
              particle: {
                type: (options.boulderParticleTypes?.length === 1) ? options.boulderParticleTypes[0] : 'auto',
                densityMult: options.boulderParticleDensity ?? 1.0,
                scale: options.boulderParticleScale ?? 0.25,
                scaleVariance: options.boulderParticleScaleVariance ?? 0.35
              }
            }
          : (options.childSpawnOverrides ?? {}),
        // Category toggles - for brush/boulder tool, disable trees
        treesEnabled: (options.featureType === 'brush' || options.featureType === 'boulder') ? false : (options.treesEnabled ?? true),
        brushEnabled: options.brushEnabled ?? true,
        floorEnabled: isBoulderTool ? (options.boulderFloorEnabled ?? true) : (options.floorEnabled ?? true),
        particlesEnabled: isBoulderTool ? (options.boulderParticlesEnabled ?? true) : (options.particlesEnabled ?? true),
        images: this._renderer.getScatterImages()
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
    const images = this._renderer.getScatterImages();

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

  /**
   * Refresh the sidebar ground preview canvas
   * Uses same renderWaterPreview() as on-canvas hover preview (shared for texture rendering)
   */
  _refreshGroundPreview() {
    const canvas = this._elements.groundPreviewCanvas;
    if (!canvas) return;

    // Skip if preview is hidden
    if (this._elements.showGroundPreview && !this._elements.showGroundPreview.checked) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Clear with solid dark background for contrast
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const options = this._state.toolOptions;
    const brushRadius = options.brushRadius || 60;
    const fadeWidth = options.fadeWidth ?? 12;

    // Scale to fit preview with padding
    const padding = 10;
    const maxRadius = (canvas.width / 2) - padding;
    const totalRadius = brushRadius + fadeWidth;
    const scale = maxRadius / totalRadius;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Use shared renderWaterPreview (works for any texture)
    this._renderer.renderWaterPreview(ctx, centerX, centerY, {
      waterType: options.groundTextureType || 'grass-1',
      waterRadius: brushRadius * scale,
      waterFadeWidth: fadeWidth * scale,
      waterOpacity: 1.0,
      waterDepth: 0,
      shoreType: null,
      shoreWidth: 0,
      shoreFadeWidth: fadeWidth * scale,
      alpha: 1.0
    });

    // Draw subtle guide line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, brushRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Show/hide the depth falloff slider based on depth value
   */
  _updateDepthFalloffVisibility(depthValue) {
    if (this._elements.waterDepthFalloffRow) {
      this._elements.waterDepthFalloffRow.style.display = depthValue > 0 ? 'flex' : 'none';
    }
  }

  /**
   * Refresh the sidebar water preview canvas
   * Uses same renderWaterPreview() as on-canvas hover preview
   */
  _refreshWaterPreview() {
    const canvas = this._elements.waterPreviewCanvas;
    if (!canvas) return;

    // Skip if preview is hidden
    if (this._elements.showWaterPreview && !this._elements.showWaterPreview.checked) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background - use base ground texture
    const baseLayer = this._state.baseLayer || 'grass-1';
    const groundImg = this._renderer._images?.ground?.[baseLayer];
    if (groundImg) {
      const pattern = ctx.createPattern(groundImg, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#1a2f1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const options = this._state.toolOptions;
    const brushRadius = options.brushRadius || 60;
    const shoreWidth = options.shoreWidth || 0;
    // Falloff: 0% = hard edge (fadeWidth=0), 100% = very soft (fadeWidth=radius)
    const waterFalloff = (options.waterFalloff ?? 30) / 100;
    const waterFadeWidth = brushRadius * waterFalloff;
    const shoreFadeWidth = options.shoreFadeWidth ?? 12;
    const hasShore = options.shoreTextureType && options.shoreTextureType !== 'none' && shoreWidth > 0;

    // Scale to fit preview with padding
    const padding = 10;
    const maxRadius = (canvas.width / 2) - padding;
    const outerFade = hasShore ? shoreFadeWidth : waterFadeWidth;
    const totalRadius = brushRadius + (hasShore ? shoreWidth : 0) + outerFade;
    const scale = maxRadius / totalRadius;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Use shared renderWaterPreview (same as on-canvas hover)
    this._renderer.renderWaterPreview(ctx, centerX, centerY, {
      waterType: options.waterTextureType || 'water',
      waterRadius: brushRadius * scale,
      waterFadeWidth: waterFadeWidth * scale,
      waterOpacity: 1.0,
      waterDepth: (options.waterDepth ?? 0) / 100,  // Deep water opacity
      waterDepthFalloff: (options.waterDepthFalloff ?? 50) / 100,  // Depth falloff
      shoreType: options.shoreTextureType,
      shoreWidth: shoreWidth * scale,
      shoreFadeWidth: shoreFadeWidth * scale,
      alpha: 1.0
    });

    // Draw subtle guide lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, brushRadius * scale, 0, Math.PI * 2);
    ctx.stroke();

    if (hasShore) {
      ctx.strokeStyle = 'rgba(180, 140, 80, 0.4)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, (brushRadius + shoreWidth) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
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

  // ═══════════════════════════════════════════════════════════════
  // TEST MODE
  // ═══════════════════════════════════════════════════════════════

  _testModeKeyHandler(e) {
    const key = e.key.toLowerCase();

    // T toggles test mode on/off
    if (key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this._toggleTestMode();
      return true; // consumed
    }

    // When test mode is active, consume all keys (don't let tool manager handle them)
    if (this._testMode.active) {
      // Escape exits test mode
      if (key === 'escape') {
        e.preventDefault();
        this._toggleTestMode();
        return true;
      }
      // Consume WASD and arrows (test-mode.js handles via its own listeners)
      return true;
    }

    return false; // not consumed
  }

  async _toggleTestMode() {
    const container = document.querySelector('.editor-container');
    const toolbar = document.querySelector('.toolbar');
    const properties = document.querySelector('.properties');
    const header = document.querySelector('.header');
    const statusBar = document.querySelector('.status-bar');

    if (this._testMode.active) {
      // Exit test mode
      this._testMode.exit();

      // Restore editor layout
      toolbar.style.display = '';
      properties.style.display = '';
      header.style.display = '';
      if (statusBar) statusBar.style.display = '';
      container.style.gridTemplateColumns = '';
      container.style.gridTemplateRows = '';

      // Resize canvases to fit restored layout
      this._renderer.handleResize();

      const btn = document.getElementById('test-mode-btn');
      if (btn) btn.classList.remove('active');
    } else {
      // Enter test mode — canvas takes full screen
      toolbar.style.display = 'none';
      properties.style.display = 'none';
      header.style.display = 'none';
      if (statusBar) statusBar.style.display = 'none';
      container.style.gridTemplateColumns = '1fr';
      container.style.gridTemplateRows = '1fr';

      // Resize canvases to fill the expanded area
      this._renderer.handleResize();

      // Enter after resize so camera centers correctly
      await this._testMode.enter();

      const btn = document.getElementById('test-mode-btn');
      if (btn) btn.classList.add('active');
    }
  }
}

// Initialize when DOM is ready
const editor = new TerrainEditor();
editor.init().catch(err => {
  console.error('[TerrainEditor] Failed to initialize:', err);
});
