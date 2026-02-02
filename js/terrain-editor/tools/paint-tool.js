// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Paint Tool
// Brush-based terrain painting
// ═══════════════════════════════════════════════════════════════

import { createStroke, FEATURE_DEFS, BRUSH_TYPES } from '../../world-builder/strokes.js';
import { generateForestItems, SCATTER_TYPES } from '../../world-builder/scatter.js';
import { hasActiveAnimations } from '../../world-builder/scatter-animation.js';
import { Events } from '../events.js';

/**
 * Simple seeded random (matches scatter.js seededRandom)
 */
function _seededRand(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Feature type colors for brush preview
 */
const FEATURE_COLORS = {
  forest: 'rgba(30, 74, 40, 0.4)',
  brush: 'rgba(58, 106, 42, 0.4)',
  water: 'rgba(30, 90, 140, 0.4)',
  groundTexture: 'rgba(90, 70, 50, 0.4)'
};

/**
 * Paint tool - paints terrain features with brush strokes
 */
export const PaintTool = {
  name: 'paint',
  icon: '🖌️',
  cursor: 'crosshair',

  // Internal state
  _isPainting: false,
  _lastPaintPos: null,
  _strokesAddedDuringDrag: 0,  // Track strokes for batch render
  _lastPreviewPos: null,        // Throttle scatter preview repositioning
  _cachedPreviewItems: null,    // Cached preview items (regenerated on settings change)
  _cachedPreviewKey: null,      // Key to detect when settings changed
  _cachedPreviewGenPos: null,   // Position where cached items were generated

  onActivate(state, renderer) {
    console.log('[PaintTool] Activated');
  },

  onDeactivate(state, renderer) {
    this._isPainting = false;
    this._lastPaintPos = null;
    this._lastPreviewPos = null;
    this._cachedPreviewItems = null;
    this._cachedPreviewKey = null;
    renderer.clearTexturePreview();
    this._cachedPreviewGenPos = null;
    renderer.clearBrushPreview();
    renderer.clearScatterPreview();
  },

  /**
   * Invalidate the cached preview so it regenerates on next mouse move
   */
  invalidatePreviewCache() {
    this._cachedPreviewKey = null;
    this._cachedPreviewItems = null;
  },

  onMouseDown(e, state, renderer) {
    if (e.button === 0) {
      // Left click - start painting
      this._isPainting = true;
      this._lastPaintPos = { x: e.x, y: e.y };
      this._strokesAddedDuringDrag = 0;
      this._renderer = renderer;  // Store for preview rendering
      this._dragModeStarted = false;  // Track if we've started drag mode
      this._state = state;  // Store for event emission
      // Clear hover preview when painting starts
      renderer.clearTexturePreview();

      const options = state.toolOptions;
      // Track if painting a scatter feature (for preview refresh on mouse up)
      this._paintingScatterFeature = options.featureType === 'forest' || options.featureType === 'brush';
      // For water, use preview mode even for first stroke to ensure proper shore/water layering
      if (options.featureType === 'water') {
        renderer.beginDragPaint();
        this._dragModeStarted = true;
        this._paint(e.x, e.y, state, true, renderer);
        this._strokesAddedDuringDrag++;
      } else {
        // First stroke renders immediately (NOT in drag mode)
        this._paint(e.x, e.y, state, false);
      }
    }
  },

  onMouseMove(e, state, renderer) {
    const options = state.toolOptions;

    // Check if within bounds
    const inBounds = e.x >= 0 && e.x <= state.canvasWidth &&
                     e.y >= 0 && e.y <= state.canvasHeight;

    // Update brush preview with outer ring for shore/floor extend
    if (inBounds) {
      const color = this._getPreviewColor(options);
      const previewOptions = this._getPreviewOptions(options);
      renderer.setBrushPreview(e.x, e.y, options.brushRadius, color, previewOptions);
    } else {
      renderer.setBrushPreview(e.x, e.y, options.brushRadius, 'rgba(255, 50, 50, 0.3)', {
        shape: options.brushShape || 'circle'
      });
    }

    // Scatter preview on canvas (shows what would spawn at cursor position)
    const showPreview = state.viewSettings.showScatterPreview;
    const isScatterFeature = options.featureType === 'forest' || options.featureType === 'brush';
    if (showPreview && inBounds && !this._isPainting && isScatterFeature) {
      this._updateScatterPreview(e.x, e.y, state, renderer);
    } else if (this._lastPreviewPos && !isScatterFeature) {
      renderer.clearScatterPreview();
      this._lastPreviewPos = null;
    }

    // Texture preview for water/ground (shows what texture would be painted)
    const isTextureFeature = options.featureType === 'water' || options.featureType === 'groundTexture';
    const showWaterPreview = state.viewSettings.showWaterPreview;
    const showGroundPreview = state.viewSettings.showGroundPreview;

    if (inBounds && !this._isPainting && isTextureFeature) {
      if (options.featureType === 'water' && showWaterPreview) {
        // Falloff: 0% = hard edge (fadeWidth=0), 100% = very soft (fadeWidth=radius)
        const waterFalloff = (options.waterFalloff ?? 30) / 100;
        const waterFadeWidth = options.brushRadius * waterFalloff;
        const textureType = options.waterTextureType || 'water';
        renderer.setTexturePreview(e.x, e.y, options.brushRadius, textureType, {
          fadeWidth: waterFadeWidth,
          intensity: 1.0,
          isWater: true,
          // Water-specific options
          waterOpacity: 1.0,
          waterDepthFade: 0,
          waterDepth: textureType.includes('deep') ? (options.waterDepth ?? 70) / 100 : 1.0,
          // Shore options
          shoreType: options.shoreTextureType,
          shoreWidth: options.shoreWidth || 0,
          shoreFadeWidth: options.shoreFadeWidth ?? 12
        });
      } else if (options.featureType === 'groundTexture' && showGroundPreview) {
        renderer.setTexturePreview(e.x, e.y, options.brushRadius, options.groundTextureType || 'grass-1', {
          fadeWidth: options.fadeWidth ?? 12,
          intensity: options.intensity || 1.0,
          isWater: false
        });
      } else {
        renderer.clearTexturePreview();
      }
    } else {
      renderer.clearTexturePreview();
    }

    // Drag painting (only in bounds)
    if (this._isPainting && e.buttons === 1 && inBounds) {
      const dx = e.x - this._lastPaintPos.x;
      const dy = e.y - this._lastPaintPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Dynamic spacing: 60% of brush radius (min 30px)
      // Larger spacing = fewer strokes = less GC pressure during painting
      const paintSpacing = Math.max(30, options.brushRadius * 0.6);

      if (dist >= paintSpacing) {
        // Start drag mode on first drag stroke (not on initial click)
        // This ensures single clicks get immediate cache rebuild
        if (!this._dragModeStarted) {
          renderer.beginDragPaint();
          this._dragModeStarted = true;
        }
        // Skip render during drag - batch them up, render on mouse up
        // But show in preview layer for visual feedback
        this._paint(e.x, e.y, state, true, renderer);
        this._lastPaintPos = { x: e.x, y: e.y };
        this._strokesAddedDuringDrag++;
      }
    }
  },

  onMouseUp(e, state, renderer) {
    // End drag paint mode only if it was started (i.e., user actually dragged)
    if (this._dragModeStarted) {
      renderer.endDragPaint();
      // Final render after drag painting
      if (this._isPainting && this._strokesAddedDuringDrag > 0) {
        // Only clear preview if no animations running - otherwise let animations complete
        // and the renderer will clear it when cache is rebuilt
        if (!hasActiveAnimations()) {
          renderer.clearPaintPreview();
        }
        state.requestRender();
      }
    }

    // For scatter features (forest/brush), regenerate seed and notify for preview refresh
    // This happens ONCE at the end of painting, not per stroke during drag
    if (this._paintingScatterFeature && this._state) {
      this._state.setToolOption('previewSeed', Math.floor(Math.random() * 1000000));
      this._state.emit(Events.PAINTING_FINISHED, { featureType: state.toolOptions.featureType });
    }

    this._isPainting = false;
    this._lastPaintPos = null;
    this._strokesAddedDuringDrag = 0;
    this._dragModeStarted = false;
    this._paintingScatterFeature = false;
  },

  onMouseLeave(state, renderer) {
    // End drag paint mode if it was started
    if (this._dragModeStarted) {
      renderer.endDragPaint();
      // Final render if we were painting when leaving
      if (this._strokesAddedDuringDrag > 0) {
        // Only clear preview if no animations running
        if (!hasActiveAnimations()) {
          renderer.clearPaintPreview();
        }
        state.requestRender();
      }
    }

    // For scatter features (forest/brush), regenerate seed and notify for preview refresh
    if (this._paintingScatterFeature && this._state) {
      this._state.setToolOption('previewSeed', Math.floor(Math.random() * 1000000));
      this._state.emit(Events.PAINTING_FINISHED, { featureType: state.toolOptions.featureType });
    }

    this._isPainting = false;
    this._lastPaintPos = null;
    this._lastPreviewPos = null;
    this._strokesAddedDuringDrag = 0;
    this._dragModeStarted = false;
    this._paintingScatterFeature = false;
    renderer.clearScatterPreview();
  },

  onContextMenu(e, state, renderer) {
    // Right-click to erase
    this._erase(e.x, e.y, state);
  },

  // ═══════════════════════════════════════════════════════════════
  // PAINTING LOGIC
  // ═══════════════════════════════════════════════════════════════

  _paint(x, y, state, skipRender = false, renderer = null) {
    const options = state.toolOptions;

    // Clamp to canvas bounds
    const maxX = state.canvasWidth;
    const maxY = state.canvasHeight;
    if (x < 0 || x > maxX || y < 0 || y > maxY) {
      return; // Outside bounds
    }

    // Manual ground texture painting mode
    if (options.featureType === 'groundTexture') {
      const groundStroke = createStroke(
        'groundTexture',
        x,
        y,
        options.brushRadius,
        {
          intensity: options.intensity || 1.0,
          falloff: options.falloff,
          textureType: options.groundTextureType || 'grass-1',
          fadeWidth: options.fadeWidth ?? 12
        }
      );
      state.addStroke(groundStroke, skipRender);
      if (skipRender && renderer) {
        renderer.addToPaintPreview(groundStroke);
      }
      return;
    }

    // Water painting with shore texture
    if (options.featureType === 'water') {
      // Paint shore texture first (larger radius)
      let shoreStroke = null;
      if (options.shoreTextureType && options.shoreTextureType !== 'none' && options.shoreWidth > 0) {
        shoreStroke = createStroke(
          'groundTexture',
          x,
          y,
          options.brushRadius + options.shoreWidth,
          {
            intensity: 1.0,
            falloff: options.falloff,
            textureType: options.shoreTextureType,
            fadeWidth: options.shoreFadeWidth ?? 12,
            isShore: true  // Mark as shore so it renders after regular ground textures
          }
        );
        state.addStroke(shoreStroke, true);  // Always skip, render with water stroke
      }

      // Paint water on top
      // Falloff: 0% = hard edge (fadeWidth=0), 100% = very soft (fadeWidth=radius)
      const waterFalloff = (options.waterFalloff ?? 30) / 100;
      const waterFadeWidth = options.brushRadius * waterFalloff;
      const textureType = options.waterTextureType || 'water';
      const waterStroke = createStroke(
        'water',
        x,
        y,
        options.brushRadius,
        {
          intensity: 1.0,
          falloff: options.falloff,
          textureType: textureType,
          fadeWidth: waterFadeWidth,
          // Depth effect: 0 = no darkening, 100 = max darkening at center
          waterDepth: (options.waterDepth ?? 0) / 100,
          shoreWidth: options.shoreWidth || 0  // Store shore width for forest avoidance
        }
      );
      state.addStroke(waterStroke, skipRender);

      // Add shore and water to paint preview for live feedback during drag painting
      // Preview rebuilds with proper layering: all shores first, then all waters
      if (skipRender && renderer) {
        if (shoreStroke) {
          renderer.addToPaintPreview(shoreStroke);
        }
        renderer.addToPaintPreview(waterStroke);
      }
      return;
    }

    // Create stroke based on feature type
    const stroke = createStroke(
      options.featureType,
      x,
      y,
      options.brushRadius,
      {
        intensity: options.intensity,
        falloff: options.falloff
      }
    );

    // If painting trees, add tree-specific properties
    if (options.featureType === 'forest') {
      // First click uses previewSeed to match preview, subsequent strokes get fresh seeds
      stroke.seed = options.previewSeed ?? Math.floor(Math.random() * 1000000);

      // Store all selected tree types and their ratios for mixed generation
      const treeTypes = options.treeTypes || [options.treeType || 'oak'];
      const treeRatios = options.treeRatios || {};

      // Filter out 'dead' as it's a modifier, not a real type
      stroke.treeTypes = treeTypes.filter(t => t !== 'dead');
      stroke.treeRatios = { ...treeRatios };

      // Legacy single type for backwards compatibility (use first type)
      const firstType = stroke.treeTypes[0] || 'oak';
      const isDeadVariant = firstType.endsWith('-dead');
      stroke.treeType = isDeadVariant ? firstType.replace('-dead', '') : firstType;
      stroke.forceAllDead = isDeadVariant;

      stroke.density = options.treeDensity;
      stroke.treeScale = options.treeScale || 0.35;
      stroke.selectedAges = options.selectedAges || ['young', 'transitional', 'old'];
      stroke.ageRatios = options.ageRatios || { young: 0.333, transitional: 0.333, old: 0.334 };
      stroke.allowTreesInWater = options.treesInWater || false;

      // Floor settings baked at paint time
      stroke.floorRadiusPercent = options.floorRadiusPercent ?? 30;
      stroke.floorFade = options.floorFade ?? 100;  // Percentage: 0=hard edge, 100=full fade
      stroke.floorIntensity = options.floorIntensity ?? 70;
      // For backwards compat with renderer, derive min/max from selected
      const ageOrder = ['young', 'transitional', 'old'];
      const selected = stroke.selectedAges;
      stroke.minAge = ageOrder.find(a => selected.includes(a)) || 'young';
      stroke.maxAge = [...ageOrder].reverse().find(a => selected.includes(a)) || 'old';
    }

    // If painting brush/undergrowth, add brush-specific properties (like forest)
    if (options.featureType === 'brush') {
      // First click uses previewSeed to match preview, subsequent strokes get fresh seeds
      stroke.seed = options.previewSeed ?? Math.floor(Math.random() * 1000000);

      // Store all selected brush types and their ratios for mixed generation
      const brushTypes = options.brushTypes || [options.brushType || 'bush-small'];
      const brushRatios = options.brushRatios || {};

      stroke.brushTypes = brushTypes;
      stroke.brushRatios = { ...brushRatios };

      // Legacy single type for backwards compatibility (use first type)
      stroke.brushType = brushTypes[0] || 'bush-small';

      stroke.density = options.brushDensity ?? 1.0;
      stroke.brushScale = options.brushScale ?? 0.25;
      stroke.allowBrushInWater = options.brushInWater || false;

      // Floor/particle toggles
      stroke.floorEnabled = options.floorEnabled ?? true;
      stroke.particlesEnabled = options.particlesEnabled ?? true;
    }

    // Auto-paint ground texture if enabled (paint first so it's behind trees)
    // NOTE: For forests, skip stroke-based floor - tree-based system renders floor radiating from each tree
    let autoGroundStroke = null;
    if (options.autoGroundTexture) {
      const featureDef = FEATURE_DEFS[options.featureType];
      const autoTexture = featureDef?.autoGroundTexture;

      // Skip forest-floor strokes - tree-based system handles floor per-tree
      // Other auto textures (like mud around water) still use strokes
      if (autoTexture && autoTexture !== 'forest-floor') {
        const floorRadius = options.brushRadius + (options.floorExtend ?? 0);
        const floorFade = options.floorFade ?? 16;

        autoGroundStroke = createStroke(
          'groundTexture',
          x,
          y,
          floorRadius,
          {
            intensity: 1.0,
            falloff: options.falloff,
            textureType: autoTexture,
            fadeWidth: floorFade
          }
        );
        state.addStroke(autoGroundStroke, true);  // Always skip, render with main stroke
      }
    }

    state.addStroke(stroke, skipRender);

    // Regenerate seed for next stroke (gives variation during drag painting)
    if (options.featureType === 'forest' || options.featureType === 'brush') {
      state.setToolOption('previewSeed', Math.floor(Math.random() * 1000000));
    }

    // Add ground texture to preview for visual feedback during drag
    if (skipRender && renderer && autoGroundStroke) {
      renderer.addToPaintPreview(autoGroundStroke);
    }
  },

  _erase(x, y, state) {
    // Clamp to canvas bounds
    const maxX = state.canvasWidth;
    const maxY = state.canvasHeight;
    if (x < 0 || x > maxX || y < 0 || y > maxY) {
      return;
    }

    const options = state.toolOptions;
    state.removeStrokesAt(x, y, options.brushRadius);
  },

  /**
   * Show cached scatter preview at cursor position.
   * Generates at actual cursor position using real terrain (for accurate collision/water checks).
   * Caches results and shifts for small cursor movements; regenerates for large moves or settings changes.
   */
  _updateScatterPreview(x, y, state, renderer) {
    // Throttle minor movement
    if (this._lastPreviewPos) {
      const dx = x - this._lastPreviewPos.x;
      const dy = y - this._lastPreviewPos.y;
      if (dx * dx + dy * dy < 9) return; // Less than 3px movement
    }
    this._lastPreviewPos = { x, y };

    const options = state.toolOptions;
    const useScatter = options.useScatterSystem ?? false;
    if (!useScatter) {
      renderer.clearScatterPreview();
      return;
    }

    // Build settings key (position-independent)
    const seed = options.previewSeed ?? 42;
    const settingsKey = [
      options.featureType,  // Include feature type so brush/forest have separate caches
      (options.treeTypes || ['oak']).join(','),
      JSON.stringify(options.treeRatios || {}),
      (options.deadTypes || []).join(','),
      options.deadRatio ?? 0,
      options.treeDensity, options.treeScale, options.treeSpacing,
      (options.selectedAges || []).join(','),
      (options.brushTypes || ['bush-small']).join(','),
      JSON.stringify(options.brushRatios || {}),
      options.brushDensity, options.brushScale,
      options.floorEnabled ?? true, options.particlesEnabled ?? true,
      options.season, options.biome, options.brushRadius, seed,
      JSON.stringify(options.seasonOverrides || {}),
      JSON.stringify(options.childSpawnOverrides || {})
    ].join('|');

    // Regenerate when settings change OR cursor moves significantly
    // (collision context changes over distance - water strokes, existing trees)
    const radius = options.brushRadius;
    const needsRegen = settingsKey !== this._cachedPreviewKey ||
      !this._cachedPreviewGenPos ||
      Math.abs(x - this._cachedPreviewGenPos.x) > radius ||
      Math.abs(y - this._cachedPreviewGenPos.y) > radius;

    if (needsRegen) {
      this._cachedPreviewKey = settingsKey;
      this._cachedPreviewGenPos = { x, y };

      // Use shared forest generation function (single source of truth)
      const mockTerrain = { scatterItems: [], strokes: [] };

      const allItems = generateForestItems(mockTerrain,
        { x, y, radius, seed },
        {
          treeTypes: options.treeTypes || ['oak'],
          treeRatios: options.treeRatios || {},
          deadTypes: options.deadTypes || [],
          deadRatio: options.deadRatio ?? 0,
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
          // Category toggles - for brush tool, trees are disabled
          treesEnabled: options.featureType === 'brush' ? false : (options.treesEnabled ?? true),
          floorEnabled: options.floorEnabled ?? true,
          particlesEnabled: options.particlesEnabled ?? true,
          brushEnabled: options.brushEnabled ?? true,
          images: {
            tree: renderer._images.trees,
            brush: renderer._images.brush,
            floor: renderer._images.floor,
            particle: renderer._images.brush
          }
        }
      );

      this._cachedPreviewItems = allItems;
    }

    if (!this._cachedPreviewItems || this._cachedPreviewItems.length === 0) {
      renderer.clearScatterPreview();
      return;
    }

    // Shift cached items from generation position to current cursor
    const dx = x - this._cachedPreviewGenPos.x;
    const dy = y - this._cachedPreviewGenPos.y;

    if (dx === 0 && dy === 0) {
      renderer.setScatterPreview(this._cachedPreviewItems);
    } else {
      const positioned = this._cachedPreviewItems.map(item => ({
        ...item,
        x: item.x + dx,
        y: item.y + dy
      }));
      renderer.setScatterPreview(positioned);
    }
  },

  _getPreviewColor(options) {
    if (options.featureType === 'forest') {
      return 'rgba(100, 200, 100, 0.4)';
    }
    return FEATURE_COLORS[options.featureType] || 'rgba(100, 100, 100, 0.4)';
  },

  /**
   * Get preview options including outer ring for shore/floor extend
   */
  _getPreviewOptions(options) {
    const result = {
      shape: options.brushShape || 'circle'
    };

    // Water with shore - show outer ring for shore area
    if (options.featureType === 'water') {
      const shoreWidth = options.shoreWidth || 0;
      if (shoreWidth > 0 && options.shoreTextureType && options.shoreTextureType !== 'none') {
        result.outerRadius = options.brushRadius + shoreWidth;
        result.outerColor = 'rgba(139, 90, 43, 0.25)'; // Mud/shore color
      }
    }

    // Forest floor preview removed - tree-based system handles floor now
    // Floor radiates from each tree, not from brush stroke
    if (false && options.featureType === 'forest' && options.autoGroundTexture) {
      // Legacy: stroke-based floor extend preview (disabled)
      const floorExtend = options.floorExtend || 0;
      if (floorExtend !== 0) {
        result.outerRadius = options.brushRadius + floorExtend;
        result.outerColor = 'rgba(60, 40, 20, 0.25)'; // Forest floor color
      }
    }

    return result;
  },

  /**
   * Pick a tree type based on configured ratios
   * "Dead" ratio is distributed proportionally across selected species
   * @param {object} options - Tool options
   * @param {number} [seed] - Optional seed for deterministic pick (matches preview)
   * @returns {string} Tree type (e.g., 'oak', 'pine-dead', 'birch')
   */
  _pickTreeType(options, seed) {
    const allTypes = options.treeTypes || [options.treeType || 'oak'];
    const ratios = options.treeRatios || {};

    // Separate real species from the generic 'dead' type
    // 'dead' ratio gets distributed proportionally across species as dead variants
    const deadRatio = ratios['dead'] || 0;
    const speciesTypes = allTypes.filter(t => t !== 'dead' && !t.endsWith('-dead'));
    const deadVariants = allTypes.filter(t => t.endsWith('-dead'));

    // Build effective types list: species + their dead variants based on deadRatio
    // If user selected specific dead variants (oak-dead), include those directly
    const effectiveTypes = [...speciesTypes, ...deadVariants];

    // If only dead variants selected (no live species), use them directly
    if (speciesTypes.length === 0) {
      if (deadVariants.length === 1) return deadVariants[0];
      const rand = seed != null ? _seededRand(seed) : Math.random();
      let cumulative = 0;
      for (const type of deadVariants) {
        cumulative += ratios[type] || (1 / deadVariants.length);
        if (rand < cumulative) return type;
      }
      return deadVariants[0] || 'oak-dead';
    }

    // Calculate species weights (excluding 'dead' which is a modifier)
    let speciesTotal = 0;
    for (const type of speciesTypes) {
      speciesTotal += ratios[type] || 0;
    }
    // If no ratios defined, distribute evenly
    if (speciesTotal === 0) speciesTotal = speciesTypes.length;

    // First roll: pick a species
    const rand1 = seed != null ? _seededRand(seed) : Math.random();
    let cumulative = 0;
    let selectedSpecies = speciesTypes[0];

    for (const type of speciesTypes) {
      const weight = ratios[type] || (1 / speciesTypes.length);
      cumulative += weight / (speciesTotal || 1) * (1 - deadRatio);
      if (rand1 < cumulative) {
        selectedSpecies = type;
        break;
      }
    }

    // Second roll: should this be dead? (using deadRatio)
    // Use a different seed derivative for independence
    const rand2 = seed != null ? _seededRand(seed + 7777) : Math.random();
    if (deadRatio > 0 && rand2 < deadRatio) {
      // Return dead variant of the selected species
      return `${selectedSpecies}-dead`;
    }

    return selectedSpecies;
  },

  /**
   * Pick a brush type based on configured ratios
   */
  _pickBrushType(options) {
    const types = options.brushTypes || [options.brushType || 'bush-small'];
    const ratios = options.brushRatios || {};

    // If only one type, return it
    if (types.length === 1) {
      return types[0];
    }

    // Pick based on ratio (weighted random)
    const rand = Math.random();
    let cumulative = 0;

    for (const type of types) {
      cumulative += ratios[type] || (1 / types.length);
      if (rand < cumulative) {
        return type;
      }
    }

    // Fallback
    return types[0];
  },

  /**
   * Check if a position is inside any water stroke (including shore area)
   * Used by tree generation to avoid water
   */
  _isInWater(x, y, state) {
    const terrainMap = state.terrainMap;
    if (!terrainMap || !terrainMap.strokes) return false;

    return terrainMap.strokes.some(s => {
      if (s.type !== 'water') return false;
      const dx = s.x - x;
      const dy = s.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Include shore area in the check
      const effectiveRadius = s.radius + (s.shoreWidth || 0);
      return dist < effectiveRadius;
    });
  }
};
