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
      treeBtns: document.querySelectorAll('.tree-btn[data-tree]'),
      ageBtns: document.querySelectorAll('.tree-btn[data-age]'),
      ageRatiosContainer: document.getElementById('age-ratios'),
      ageRatioSliders: document.getElementById('age-ratio-sliders'),
      treeScale: document.getElementById('tree-scale'),
      scaleVal: document.getElementById('scale-val'),
      treeDensity: document.getElementById('tree-density'),
      densityVal: document.getElementById('density-val'),

      // Brush/Undergrowth settings
      brushSettings: document.getElementById('brush-settings'),
      brushTypeBtns: document.querySelectorAll('.brush-type-btn[data-brush]'),
      brushRatiosContainer: document.getElementById('brush-ratios'),
      brushRatioSliders: document.getElementById('brush-ratio-sliders'),
      brushScale: document.getElementById('brush-scale'),
      brushScaleVal: document.getElementById('brush-scale-val'),
      brushDensity: document.getElementById('brush-density'),
      brushDensityVal: document.getElementById('brush-density-val'),
      brushInWater: document.getElementById('brush-in-water'),

      // Particle settings
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

      // Map settings
      baseLayer: document.getElementById('base-layer'),
      gridSize: document.getElementById('grid-size'),

      // View settings
      showGrid: document.getElementById('show-grid'),
      gridOpacity: document.getElementById('grid-opacity'),
      gridOpacityVal: document.getElementById('grid-opacity-val'),
      showBoundary: document.getElementById('show-boundary'),
      showParticleDebug: document.getElementById('show-particle-debug'),

      // Status bar
      zoomLevel: document.getElementById('zoom-level'),
      cursorPos: document.getElementById('cursor-pos'),
      strokeCount: document.getElementById('stroke-count')
    };
  }

  _bindUIEvents() {
    // Header buttons
    this._elements.btnNew.addEventListener('click', () => this._newMap());
    this._elements.btnLoad.addEventListener('click', () => this._elements.fileInput.click());
    this._elements.btnSave.addEventListener('click', () => this._saveMap());
    this._elements.btnExport.addEventListener('click', () => this._exportPNG());
    this._elements.fileInput.addEventListener('change', (e) => this._loadMap(e));

    // Tool buttons
    this._elements.toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this._state.activeTool = tool;
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

    // Feature buttons
    this._elements.featureBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._elements.featureBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const feature = btn.dataset.feature;
        this._state.setToolOption('featureType', feature);

        // Show/hide tree settings
        this._elements.treeSettings.style.display =
          feature === 'forest' ? 'block' : 'none';

        // Show/hide brush settings
        if (this._elements.brushSettings) {
          this._elements.brushSettings.style.display =
            feature === 'brush' ? 'block' : 'none';
        }

        // Show/hide ground settings
        if (this._elements.groundSettings) {
          this._elements.groundSettings.style.display =
            feature === 'groundTexture' ? 'block' : 'none';
        }

        // Show/hide water settings
        if (this._elements.waterSettings) {
          this._elements.waterSettings.style.display =
            feature === 'water' ? 'block' : 'none';
        }

        // Show/hide auto-ground settings (for features that support auto-paint)
        if (this._elements.autoGroundSettings) {
          const supportsAutoGround = feature === 'forest';
          this._elements.autoGroundSettings.style.display =
            supportsAutoGround ? 'block' : 'none';
        }
      });
    });

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
    });

    // Preset buttons
    this._elements.btnLoadPreset.addEventListener('click', () => this._loadPreset());
    this._elements.btnSavePreset.addEventListener('click', () => this._savePreset());
    this._elements.btnDeletePreset.addEventListener('click', () => this._deletePreset());
    this._elements.presetSelect.addEventListener('change', () => this._updateDeleteButton());

    // Load custom presets into dropdown on init
    this._loadCustomPresetsIntoDropdown();

    // Age toggles (multiselect)
    this._elements.ageBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this._updateSelectedAges();
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

    // View settings
    this._elements.showGrid.addEventListener('change', (e) => {
      this._state.setViewSetting('showGrid', e.target.checked);
    });

    this._elements.gridOpacity.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) / 100;
      this._state.setViewSetting('gridOpacity', value);
      this._elements.gridOpacityVal.textContent = `${e.target.value}%`;
    });

    this._elements.showBoundary.addEventListener('change', (e) => {
      this._state.setViewSetting('showBoundary', e.target.checked);
    });

    // Particle debug rings toggle
    if (this._elements.showParticleDebug) {
      this._elements.showParticleDebug.addEventListener('change', (e) => {
        this._state.setViewSetting('showParticleDebug', e.target.checked);
      });
    }

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
      this._elements.toolBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
      });

      // Show/hide clear settings panel
      if (this._elements.clearSettings) {
        this._elements.clearSettings.style.display = tool === 'clear' ? 'block' : 'none';
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
  }

  _updateStrokeCount() {
    this._elements.strokeCount.textContent = this._state.strokes.length;
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
    const selectedId = this._elements.presetSelect.value;
    const isCustom = !Presets.isBuiltInPreset(selectedId);
    this._elements.btnDeletePreset.style.opacity = isCustom ? '1' : '0.4';
    this._elements.btnDeletePreset.disabled = !isCustom;
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

    // Show/hide ratio sliders
    if (selectedTypes.length > 1 && this._elements.brushRatiosContainer) {
      this._elements.brushRatiosContainer.style.display = 'block';
      this._renderBrushRatioSliders(selectedTypes, ratios);
    } else if (this._elements.brushRatiosContainer) {
      this._elements.brushRatiosContainer.style.display = 'none';
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
      <div class="prop-row" style="margin-bottom: 4px;">
        <label class="prop-label" style="font-size: 11px;">
          ${labels[type] || type} <span class="brush-ratio-val" data-brush="${type}">${Math.round(ratios[type] * 100)}%</span>
        </label>
        <input type="range" class="prop-range brush-ratio-slider" data-brush="${type}"
               min="0" max="100" value="${Math.round(ratios[type] * 100)}" style="height: 4px;">
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
      <div class="prop-row" style="margin-bottom: 4px;">
        <label class="prop-label" style="font-size: 11px;">
          ${this._formatAge(age)} <span class="age-ratio-val" data-age="${age}">${Math.round(ratios[age] * 100)}%</span>
        </label>
        <input type="range" class="prop-range age-ratio-slider" data-age="${age}"
               min="0" max="100" value="${Math.round(ratios[age] * 100)}" style="height: 4px;">
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
      <div class="prop-row" style="margin-bottom: 4px;">
        <label class="prop-label" style="font-size: 11px;">
          ${this._formatTreeType(type)} <span class="ratio-val" data-type="${type}">${Math.round(ratios[type] * 100)}%</span>
        </label>
        <input type="range" class="prop-range ratio-slider" data-type="${type}"
               min="0" max="100" value="${Math.round(ratios[type] * 100)}" style="height: 4px;">
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

    const sliders = document.querySelectorAll('.ratio-slider');
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
  }
}

// Initialize when DOM is ready
const editor = new TerrainEditor();
editor.init().catch(err => {
  console.error('[TerrainEditor] Failed to initialize:', err);
});
