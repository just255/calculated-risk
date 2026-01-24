// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Paint Tool
// Brush-based terrain painting
// ═══════════════════════════════════════════════════════════════

import { createStroke, FEATURE_DEFS, BRUSH_TYPES } from '../../world-builder/strokes.js';

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

  onActivate(state, renderer) {
    console.log('[PaintTool] Activated');
  },

  onDeactivate(state, renderer) {
    this._isPainting = false;
    this._lastPaintPos = null;
    renderer.clearBrushPreview();
  },

  onMouseDown(e, state, renderer) {
    if (e.button === 0) {
      // Left click - start painting
      this._isPainting = true;
      this._lastPaintPos = { x: e.x, y: e.y };
      this._strokesAddedDuringDrag = 0;
      this._renderer = renderer;  // Store for preview rendering
      // First stroke renders immediately
      this._paint(e.x, e.y, state, false);
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

    // Drag painting (only in bounds)
    if (this._isPainting && e.buttons === 1 && inBounds) {
      const dx = e.x - this._lastPaintPos.x;
      const dy = e.y - this._lastPaintPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Dynamic spacing: 60% of brush radius (min 30px)
      // Larger spacing = fewer strokes = less GC pressure during painting
      const paintSpacing = Math.max(30, options.brushRadius * 0.6);

      if (dist >= paintSpacing) {
        // Skip render during drag - batch them up, render on mouse up
        // But show in preview layer for visual feedback
        this._paint(e.x, e.y, state, true, renderer);
        this._lastPaintPos = { x: e.x, y: e.y };
        this._strokesAddedDuringDrag++;
      }
    }
  },

  onMouseUp(e, state, renderer) {
    // Final render after drag painting
    if (this._isPainting && this._strokesAddedDuringDrag > 0) {
      renderer.clearPaintPreview();  // Clear preview before full render
      state.requestRender();
    }
    this._isPainting = false;
    this._lastPaintPos = null;
    this._strokesAddedDuringDrag = 0;
  },

  onMouseLeave(state, renderer) {
    // Final render if we were painting when leaving
    if (this._isPainting && this._strokesAddedDuringDrag > 0) {
      renderer.clearPaintPreview();
      state.requestRender();
    }
    this._isPainting = false;
    this._lastPaintPos = null;
    this._strokesAddedDuringDrag = 0;
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
            fadeWidth: options.fadeWidth ?? 12,
            isShore: true  // Mark as shore so it renders after regular ground textures
          }
        );
        state.addStroke(shoreStroke, true);  // Always skip, render with water stroke
      }

      // Paint water on top
      const waterStroke = createStroke(
        'water',
        x,
        y,
        options.brushRadius,
        {
          intensity: options.intensity || 1.0,
          falloff: options.falloff,
          textureType: options.waterTextureType || 'water',
          fadeWidth: options.waterFadeWidth ?? 12,
          shoreWidth: options.shoreWidth || 0  // Store shore width for forest avoidance
        }
      );
      state.addStroke(waterStroke, skipRender);

      // Both shore and water render via ground cache rebuild (stroke count detection)
      // Don't add shore to paint preview - it would be drawn ON TOP of water from cache
      if (skipRender && renderer) {
        renderer.requestUIRender();
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
      // Pick tree type based on ratios (may include dead variants like "oak-dead")
      const selectedType = this._pickTreeType(options);

      // Parse dead variants: "oak-dead" → treeType="oak", isDead=true
      const isDeadVariant = selectedType.endsWith('-dead');
      stroke.treeType = isDeadVariant ? selectedType.replace('-dead', '') : selectedType;
      stroke.forceAllDead = isDeadVariant;  // Force all trees in this stroke to be dead

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

    // If painting brush/undergrowth, add brush-specific properties
    if (options.featureType === 'brush') {
      // Pick brush type based on ratios
      const selectedType = this._pickBrushType(options);
      stroke.brushType = selectedType;
      stroke.density = options.brushDensity || 8;
      stroke.brushScale = options.brushScale || 0.12;
      stroke.allowBrushInWater = options.brushInWater || false;
    }

    // Auto-paint ground texture if enabled (paint first so it's behind trees)
    // NOTE: For forests, we skip stroke-based floor - tree-based ground layer handles it
    let autoGroundStroke = null;
    if (options.autoGroundTexture) {
      const featureDef = FEATURE_DEFS[options.featureType];
      const autoTexture = featureDef?.autoGroundTexture;

      // Skip forest-floor strokes - tree-based system renders floor radiating from each tree
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
   */
  _pickTreeType(options) {
    const types = options.treeTypes || [options.treeType || 'oak'];
    const ratios = options.treeRatios || {};

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
