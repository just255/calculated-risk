// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Renderer
// Multi-layer canvas rendering with viewport transforms
// ═══════════════════════════════════════════════════════════════

import { Events } from './events.js';
import { renderCanopyLayer, renderBaseLayer, ensureRasterized } from '../world-builder/index.js';
// NEW: Unified scatter system rendering
import { renderScatterLayer, renderScatterItem, getVisibleScatter, SCATTER_TYPES } from '../world-builder/index.js';
// NEW: Animation system
import { updateAnimations, hasActiveAnimations, getActiveAnimationCount, animateStrokes } from '../world-builder/scatter-animation.js';

// Ground texture scale (1 = native 256px, 0.25 = 64px tiles = matches cell size)
const GROUND_TEXTURE_SCALE = 0.25;

/**
 * Editor renderer - manages all canvas layers
 */
export class Renderer {
  constructor(state, containers) {
    this._state = state;
    this._containers = containers;

    // Canvas layers
    this._canvases = {
      ground: null,
      features: null,
      ui: null
    };
    this._contexts = {};

    // Loaded images
    this._images = {
      ground: {},
      trees: {},
      brush: {},
      floor: {},     // Floor patch sprites (discrete sprites with variants)
      particle: {},  // Particle sprites (leaves, needles, twigs)
      // NEW: Category-based images for scatter system
      tree: {},      // Alias for trees (scatter uses 'tree' category)
    };

    // Animation frame handle
    this._frameRequest = null;
    this._needsRender = true;
    this._needsUIRender = false;

    // Reusable temp canvas for texture stroke rendering (avoids memory churn)
    this._tempCanvas = null;
    this._tempCtx = null;
    this._tempCanvasSize = 0;

    // Cached ground layer (strokes rendered once, reused until changed)
    this._groundCache = null;
    this._groundCacheValid = false;
    this._groundCacheIsPreview = false;  // Whether cache was built at preview quality
    this._groundCacheStrokeCount = 0;
    this._groundCacheTreeCount = 0;
    this._groundCacheFloorPatchCount = 0;
    this._groundCacheScatterCount = 0;  // NEW: Track scatterItems for cache invalidation

    // Paint preview layer (for showing strokes during drag painting)
    this._paintPreview = null;
    this._paintPreviewStrokes = [];

    // Animating strokes (between drag end and cache bake)
    this._animatingStrokes = [];

    // Cached canopy layer (trees/brush rendered once, reused until changed)
    this._canopyCache = null;
    this._canopyCacheValid = false;
    this._canopyCacheTreeCount = 0;
    this._canopyCacheBrushCount = 0;
    this._canopyCacheParticleCount = 0;
    this._canopyCacheScatterCount = 0;  // NEW: Track scatterItems for cache invalidation

    // Track current rendering mode to invalidate caches when it changes
    this._useScatterRendering = false;

    // Drag painting mode - defer cache rebuilds until drag ends
    this._isDragPainting = false;

    // Scatter preview (shown on UI layer when hovering with preview enabled)
    this._scatterPreview = null;

    // Texture hover preview (shown during hover for water/ground texture)
    this._textureHoverPreview = null;

    // Canvas pool for pre-rendering strokes (reduces GC pressure)
    this._canvasPool = [];
    this._maxPoolSize = 20;

    this._init();
  }

  /**
   * Get a canvas from the pool or create a new one
   */
  _acquireCanvas(size) {
    // Try to find a canvas that's big enough
    for (let i = 0; i < this._canvasPool.length; i++) {
      const canvas = this._canvasPool[i];
      if (canvas.width >= size && canvas.height >= size) {
        this._canvasPool.splice(i, 1);
        return canvas;
      }
    }
    // Create new canvas if none available
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }

  /**
   * Return a canvas to the pool for reuse
   */
  _releaseCanvas(canvas) {
    if (this._canvasPool.length < this._maxPoolSize) {
      // Clear it before pooling
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this._canvasPool.push(canvas);
    }
    // If pool is full, just let it get GC'd
  }

  /**
   * Begin drag painting mode - uses preview quality (2x) for ground cache rebuilds
   */
  beginDragPaint() {
    this._isDragPainting = true;
  }

  /**
   * End drag painting mode - let animations finish, then rebuild cache
   */
  endDragPaint() {
    this._isDragPainting = false;

    // If no animations running, rebuild cache immediately
    if (this._animatingStrokes.length === 0) {
      this._invalidateGroundCache();
    }
    // Otherwise, cache rebuild happens when animations complete (in _renderAnimatingStrokes)

    this._invalidateCanopyCache();
  }


  _init() {
    // Create canvas layers
    this._createCanvases();

    // Subscribe to state events
    this._state.on(Events.RENDER_REQUESTED, () => this.requestRender());

    // Invalidate ground cache on major changes (not individual strokes during painting)
    this._state.on(Events.STROKES_CLEARED, () => { this._invalidateGroundCache(); this._invalidateCanopyCache(); });
    this._state.on(Events.MAP_LOADED, () => { this._invalidateGroundCache(); this._invalidateCanopyCache(); });
    this._state.on(Events.MAP_CLEARED, () => { this._invalidateGroundCache(); this._invalidateCanopyCache(); });
    this._state.on(Events.BASE_LAYER_CHANGED, () => this._invalidateGroundCache());

    // Invalidate caches when post-processing settings change (seasonOverrides)
    this._state.on(Events.TOOL_OPTIONS_CHANGED, ({ key }) => {
      if (key === 'seasonOverrides') {
        this._invalidateGroundCache();
        this._invalidateCanopyCache();
      }
    });

    // Start render loop
    this._startRenderLoop();
  }

  _invalidateGroundCache() {
    this._groundCacheValid = false;
  }

  _invalidateCanopyCache() {
    this._canopyCacheValid = false;
  }

  /**
   * Add a stroke to the paint preview (shown during drag painting)
   * Water/shore strokes animate in during painting for smooth feel
   */
  addToPaintPreview(stroke) {
    // Only groundTexture and water use the paint preview canvas
    if (stroke.type !== 'groundTexture' && stroke.type !== 'water') {
      return;
    }

    // Water strokes animate during painting (shore doesn't - it's not "poured")
    if (stroke.type === 'water') {
      // Start animation for this stroke
      const animStyle = this._state.toolOptions?.animationStyle ?? 'none';
      if (animStyle !== 'none') {
        animateStrokes([stroke], animStyle);
        this._animatingStrokes.push(stroke);

        // Start pre-rendering the texture in the background
        // By the time the animation finishes, this will be ready
        this._preRenderStroke(stroke);
      } else {
        // No animation - add to regular preview
        this._paintPreviewStrokes.push(stroke);
        this._rebuildPaintPreview();
      }
      this._requestUIRender();
      return;
    }

    // Shore strokes don't animate - just add to preview
    if (stroke.isShore) {
      this._paintPreviewStrokes.push(stroke);
      this._rebuildPaintPreview();
      this._requestUIRender();
      return;
    }

    // Non-water strokes use incremental preview
    const prevCount = this._paintPreviewStrokes.length;
    this._paintPreviewStrokes.push(stroke);

    // Check if ground textures need water masking (forces full rebuild)
    const terrainMap = this._state.terrainMap;
    const hasExistingWater = terrainMap.strokes && terrainMap.strokes.some(s => s.type === 'water');
    const hasPreviewWater = this._paintPreviewStrokes.some(s => s.type === 'water');
    const needsWaterMasking = stroke.type === 'groundTexture' && !stroke.isShore && (hasExistingWater || hasPreviewWater);

    // Incremental render: if new stroke is same layer as previous and no water masking needed
    if (prevCount > 0 && this._paintPreview && !needsWaterMasking) {
      const prevStroke = this._paintPreviewStrokes[prevCount - 1];
      const sameLayer = this._getStrokeLayer(stroke) === this._getStrokeLayer(prevStroke);

      if (sameLayer) {
        // Same layer - draw incrementally on top
        const ctx = this._paintPreview.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        this._renderStrokeToPreview(ctx, stroke);
        this._requestUIRender();
        return;
      }
    }

    // Different layer, first stroke, or needs water masking - full rebuild
    this._rebuildPaintPreview();
    this._requestUIRender();
  }

  /**
   * Get the rendering layer for a stroke (for incremental render optimization)
   */
  _getStrokeLayer(stroke) {
    if (stroke.type === 'water') return 2;
    if (stroke.type === 'groundTexture' && stroke.isShore) return 1;
    return 0; // regular ground texture
  }

  /**
   * Render a single stroke to the preview canvas
   * Note: Water masking for ground textures is handled by full rebuild path
   */
  _renderStrokeToPreview(ctx, stroke) {
    if (stroke.type === 'water') {
      this._renderWaterStroke(ctx, stroke, true);
    } else {
      this._renderGroundTextureStroke(ctx, stroke, true);
    }
  }

  /**
   * Clear the paint preview (called after mouse up)
   */
  clearPaintPreview() {
    this._paintPreviewStrokes = [];
    if (this._paintPreview) {
      const ctx = this._paintPreview.getContext('2d');
      ctx.clearRect(0, 0, this._paintPreview.width, this._paintPreview.height);
    }
  }

  /**
   * Check if a circular stroke is completely occluded by another stroke
   * A stroke is occluded if it's entirely inside another stroke of the same type
   * @param {object} stroke - The stroke to check
   * @param {object[]} otherStrokes - Array of strokes that might occlude it
   * @returns {boolean} True if stroke is completely hidden
   */
  _isStrokeOccluded(stroke, otherStrokes) {
    for (const other of otherStrokes) {
      if (other === stroke) continue;
      // Only cull if same texture type (don't cull deep water inside regular water)
      if (stroke.textureType !== other.textureType) continue;
      // Check if stroke is entirely inside other
      // stroke is inside other if: distance(centers) + stroke.radius <= other.radius
      const dx = stroke.x - other.x;
      const dy = stroke.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist + stroke.radius <= other.radius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a stroke is visible within the viewport
   * @param {object} stroke - Stroke with x, y, radius
   * @param {object} viewport - Viewport bounds {x, y, width, height} in canvas coords
   * @returns {boolean} True if stroke overlaps viewport
   */
  _isStrokeInViewport(stroke, viewport) {
    // Stroke is visible if its bounding box overlaps viewport
    return stroke.x + stroke.radius >= viewport.x &&
           stroke.x - stroke.radius <= viewport.x + viewport.width &&
           stroke.y + stroke.radius >= viewport.y &&
           stroke.y - stroke.radius <= viewport.y + viewport.height;
  }

  /**
   * Rebuild paint preview canvas with proper layering
   * Renders all strokes with correct z-order: ground textures, then shores (isShore), then water
   * Applies occlusion culling (skip strokes hidden by others) and viewport culling
   */
  _rebuildPaintPreview() {
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    // Create preview canvas if needed
    if (!this._paintPreview || this._paintPreview.width !== width || this._paintPreview.height !== height) {
      this._paintPreview = document.createElement('canvas');
      this._paintPreview.width = width;
      this._paintPreview.height = height;
    }

    const ctx = this._paintPreview.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);

    const strokes = this._paintPreviewStrokes;
    const len = strokes.length;
    if (len === 0) return;

    // Single pass: categorize and render in order
    // Ground textures first, then shores, then water
    // Uses inline occlusion check to avoid creating filter arrays

    // Collect all water strokes (existing + being painted) for masking ground textures
    const terrainMap = this._state.terrainMap;
    const existingWater = terrainMap.strokes ? terrainMap.strokes.filter(s => s.type === 'water') : [];
    const previewWater = strokes.filter(s => s.type === 'water');
    const allWaterStrokes = [...existingWater, ...previewWater];

    // Pass 1: Ground textures (non-shore) - then erase water areas
    for (let i = 0; i < len; i++) {
      const s = strokes[i];
      if (s.type !== 'groundTexture' || s.isShore) continue;
      if (!this._isStrokeInViewportFast(s, width, height)) continue;
      this._renderGroundTextureStroke(ctx, s, true);
    }

    // Erase water areas from ground textures using destination-out
    if (allWaterStrokes.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const water of allWaterStrokes) {
        const effectiveRadius = water.radius + (water.shoreWidth || 0);
        ctx.beginPath();
        ctx.arc(water.x, water.y, effectiveRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Pass 2: Shore textures with inline occlusion check
    for (let i = 0; i < len; i++) {
      const s = strokes[i];
      if (s.type !== 'groundTexture' || !s.isShore) continue;
      if (!this._isStrokeInViewportFast(s, width, height)) continue;
      // Inline occlusion: check if any later shore stroke completely covers this one
      let occluded = false;
      for (let j = i + 1; j < len; j++) {
        const other = strokes[j];
        if (other.type !== 'groundTexture' || !other.isShore) continue;
        const dx = s.x - other.x;
        const dy = s.y - other.y;
        if (Math.sqrt(dx * dx + dy * dy) + s.radius <= other.radius) {
          occluded = true;
          break;
        }
      }
      if (!occluded) this._renderGroundTextureStroke(ctx, s, true);
    }

    // Pass 3: Water strokes with inline occlusion check
    // Render regular water first, then deep water on top
    const waterStrokes = [];
    for (let i = 0; i < len; i++) {
      const s = strokes[i];
      if (s.type !== 'water') continue;
      if (!this._isStrokeInViewportFast(s, width, height)) continue;
      // Inline occlusion: check if any later water stroke of SAME texture completely covers this one
      // (don't cull deep water that's inside regular water - they should layer)
      let occluded = false;
      for (let j = i + 1; j < len; j++) {
        const other = strokes[j];
        if (other.type !== 'water') continue;
        if (s.textureType !== other.textureType) continue; // Only cull same texture types
        const dx = s.x - other.x;
        const dy = s.y - other.y;
        if (Math.sqrt(dx * dx + dy * dy) + s.radius <= other.radius) {
          occluded = true;
          break;
        }
      }
      if (!occluded) waterStrokes.push(s);
    }
    // Sort: regular water first, deep water last
    waterStrokes.sort((a, b) => {
      const aDeep = (a.textureType || '').includes('deep') ? 1 : 0;
      const bDeep = (b.textureType || '').includes('deep') ? 1 : 0;
      return aDeep - bDeep;
    });
    for (const s of waterStrokes) {
      this._renderWaterStroke(ctx, s, true);
    }
  }

  /**
   * Fast viewport check without object allocation
   */
  _isStrokeInViewportFast(stroke, width, height) {
    return stroke.x + stroke.radius >= 0 &&
           stroke.x - stroke.radius <= width &&
           stroke.y + stroke.radius >= 0 &&
           stroke.y - stroke.radius <= height;
  }

  /**
   * Pre-render a stroke's texture to an offscreen canvas
   * Called at animation start so the cached result is ready by animation end
   * @param {object} stroke - The stroke to pre-render
   */
  _preRenderStroke(stroke) {
    const radius = stroke.radius;

    // For very large strokes, skip pre-rendering (too expensive)
    // They'll use the fallback preview-mode rendering
    if (radius > 200) {
      stroke._skipCache = true;
      this._precalcDotPositions(stroke);
      return;
    }

    const size = Math.ceil(radius * 2) + 4;

    // Get canvas from pool (reduces GC pressure)
    const cache = this._acquireCanvas(size);
    const ctx = cache.getContext('2d');
    ctx.clearRect(0, 0, cache.width, cache.height);
    ctx.imageSmoothingEnabled = false;

    // Render the texture centered in the cache canvas
    // Use full quality (not preview mode) since we have time during animation
    ctx.save();
    ctx.translate(size / 2, size / 2);

    // Reuse a temporary object instead of spreading
    this._cacheStrokeTemp = this._cacheStrokeTemp || {};
    const temp = this._cacheStrokeTemp;
    temp.x = 0;
    temp.y = 0;
    temp.radius = stroke.radius;
    temp.intensity = stroke.intensity;
    temp.fadeWidth = stroke.fadeWidth;
    temp.textureType = stroke.textureType;
    temp.depthFade = stroke.depthFade;
    temp.type = stroke.type;

    if (stroke.type === 'water') {
      this._renderWaterStroke(ctx, temp, false);  // false = full quality
    } else {
      this._renderGroundTextureStroke(ctx, temp, false);
    }

    ctx.restore();

    // Store the cached canvas on the stroke for later use
    stroke._cachedTexture = cache;
    stroke._cacheSize = size;

    // Pre-calculate dot positions for this stroke (avoid recalculating each frame)
    this._precalcDotPositions(stroke);
  }

  /**
   * Pre-calculate foam dot positions for a stroke
   */
  _precalcDotPositions(stroke) {
    // Fewer dots for large strokes (diminishing returns visually, big perf cost)
    const baseCount = Math.floor(stroke.radius * 0.5);
    const dotCount = stroke.radius > 150 ? Math.min(40, baseCount) : Math.min(80, baseCount);
    const seed = stroke.id ? parseInt(stroke.id.replace(/\D/g, '')) || 0 : 0;

    const dots = new Float32Array(dotCount * 3); // x, y, size per dot

    for (let i = 0; i < dotCount; i++) {
      const r1 = Math.abs(Math.sin(seed + i * 127.1) * 43758.5453 % 1);
      const r2 = Math.abs(Math.sin(seed + i * 269.5) * 43758.5453 % 1);
      const r3 = Math.abs(Math.sin(seed + i * 183.3) * 43758.5453 % 1);

      const angle = r1 * Math.PI * 2;
      const distRatio = Math.sqrt(r2); // Store ratio, multiply by animatedRadius at render time

      dots[i * 3] = Math.cos(angle) * distRatio;     // x ratio
      dots[i * 3 + 1] = Math.sin(angle) * distRatio; // y ratio
      dots[i * 3 + 2] = 2 + r3 * 3;                  // size
    }

    stroke._dotPositions = dots;
    stroke._dotCount = dotCount;
  }

  /**
   * Render strokes that are currently animating
   * Ripple effect: texture fills in behind the expanding ripple edge
   * Uses pre-rendered cache when available for better performance
   */
  _renderAnimatingStrokes(ctx) {
    const completed = [];

    for (const stroke of this._animatingStrokes) {
      // Get animated radius (ripple expanding outward)
      const animatedRadius = stroke._renderRadius ?? stroke.radius;
      const alpha = stroke._renderAlpha ?? stroke.intensity ?? 1.0;

      // Skip if radius is too small
      if (animatedRadius < 2) continue;

      // Use pre-rendered cache if available (much faster than re-rendering each frame)
      if (stroke._cachedTexture && !stroke._skipCache) {
        const cache = stroke._cachedTexture;
        const size = stroke._cacheSize;

        // Clip to animated radius circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(stroke.x, stroke.y, animatedRadius, 0, Math.PI * 2);
        ctx.clip();

        // Draw the pre-rendered texture (centered on stroke position)
        ctx.globalAlpha = alpha;
        ctx.drawImage(cache, stroke.x - size / 2, stroke.y - size / 2);

        ctx.restore();
      } else {
        // Fallback for large strokes or cache not ready: render directly in preview mode
        this._cacheStrokeTemp = this._cacheStrokeTemp || {};
        const temp = this._cacheStrokeTemp;
        temp.x = stroke.x;
        temp.y = stroke.y;
        temp.radius = animatedRadius;
        temp.intensity = stroke.intensity ?? 1.0;
        temp.fadeWidth = stroke.fadeWidth;
        temp.textureType = stroke.textureType;
        temp.depthFade = stroke.depthFade;
        temp.type = stroke.type;

        if (stroke.type === 'water') {
          this._renderWaterStroke(ctx, temp, true);
        } else {
          this._renderGroundTextureStroke(ctx, temp, true);
        }
      }


      // Render ripples: expand out, bounce back to 60%, fade throughout
      if (animatedRadius > 10) {
        const progress = (animatedRadius / stroke.radius - 0.5) / 0.5; // 0 at start, 1 at end
        // Fewer ripples for large strokes
        const rippleCount = stroke.radius > 150 ? 2 : 4;
        ctx.lineWidth = 1.5;

        for (let r = 0; r < rippleCount; r++) {
          // Stagger each ring's timing
          const ringDelay = r * 0.15;
          const ringProgress = Math.max(0, Math.min(1, (progress - ringDelay) / (1 - ringDelay)));

          if (ringProgress <= 0) continue;

          // Phase 1 (0-0.5): expand from center to edge
          // Phase 2 (0.5-1): bounce back to 60%
          let rippleRadius;
          if (ringProgress < 0.5) {
            // Expanding out: 0% -> 100%
            const expandProgress = ringProgress / 0.5;
            rippleRadius = animatedRadius * expandProgress;
          } else {
            // Bouncing back: 100% -> 60%
            const bounceProgress = (ringProgress - 0.5) / 0.5;
            rippleRadius = animatedRadius * (1 - 0.4 * bounceProgress);
          }

          // Fade quickly - gone by 60% progress
          const rippleAlpha = Math.max(0, 1 - ringProgress * 2.5) * alpha;

          if (rippleRadius > 5 && rippleAlpha > 0.02) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${rippleAlpha})`;
            ctx.beginPath();
            ctx.arc(stroke.x, stroke.y, rippleRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // Render foam/turbulence dots (fade out as water settles)
      const foamProgress = 1 - (animatedRadius / stroke.radius - 0.5) / 0.5; // 1 at start, 0 at end
      if (foamProgress > 0.05 && stroke._dotPositions) {
        const foamAlpha = foamProgress * 1.0; // Bright white foam
        ctx.fillStyle = `rgba(255, 255, 255, ${foamAlpha})`;

        // Use pre-calculated dot positions
        const dots = stroke._dotPositions;
        const dotCount = stroke._dotCount;
        const sx = stroke.x;
        const sy = stroke.y;

        ctx.beginPath();
        for (let i = 0; i < dotCount; i++) {
          const idx = i * 3;
          const dotX = sx + dots[idx] * animatedRadius;
          const dotY = sy + dots[idx + 1] * animatedRadius;
          const size = dots[idx + 2];

          ctx.rect(dotX - size * 0.5, dotY - size * 0.5, size, size);
        }
        ctx.fill();
      }

      // Check if animation is complete
      if (!stroke._animating) {
        completed.push(stroke);
      }
    }

    // Move completed strokes to paint preview so they stay visible
    if (completed.length > 0) {
      // Add completed strokes to paint preview (they'll show at full quality)
      for (const stroke of completed) {
        // Return canvas to pool and clean up
        if (stroke._cachedTexture) {
          this._releaseCanvas(stroke._cachedTexture);
          delete stroke._cachedTexture;
        }
        delete stroke._cacheSize;
        delete stroke._dotPositions;
        delete stroke._dotCount;
        this._paintPreviewStrokes.push(stroke);
      }

      // Rebuild paint preview with the newly completed strokes
      if (this._paintPreviewStrokes.length > 0) {
        this._rebuildPaintPreview();
      }

      this._animatingStrokes = this._animatingStrokes.filter(s => s._animating);

      // If all animations done and not drag painting, rebuild cache at full quality
      if (this._animatingStrokes.length === 0 && !this._isDragPainting) {
        // Clear paint preview now that all strokes will be in the cache
        this.clearPaintPreview();
        this._invalidateGroundCache();
      }
    }
  }

  _createCanvases() {
    const container = this._containers.canvas;

    // Clear container
    container.innerHTML = '';

    // Size canvas to fill container (not map size)
    const rect = container.parentElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Account for high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;

    // Create each layer
    ['ground', 'features', 'ui'].forEach((layer, index) => {
      const canvas = document.createElement('canvas');
      canvas.id = `terrain-${layer}`;
      // Set actual pixel dimensions (device pixels)
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      // Set CSS display size (CSS pixels)
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.position = index === 0 ? 'relative' : 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = layer === 'ui' ? 'auto' : 'none';

      container.appendChild(canvas);
      this._canvases[layer] = canvas;
      const ctx = canvas.getContext('2d');
      // Scale context to account for DPR
      ctx.scale(dpr, dpr);
      this._contexts[layer] = ctx;
    });

    // Store viewport dimensions (in CSS pixels)
    this._viewportWidth = width;
    this._viewportHeight = height;

    // Handle window resize
    this._resizeHandler = () => this._handleResize();
    window.addEventListener('resize', this._resizeHandler);

    // UI canvas handles input
    return this._canvases.ui;
  }

  _handleResize() {
    const container = this._containers.canvas;
    const rect = container.parentElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const newDpr = window.devicePixelRatio || 1;

    // Check if DPR changed (e.g., moved to different display)
    const dprChanged = this._dpr !== newDpr;
    if (dprChanged) {
      this._dpr = newDpr;
      // Canopy cache uses 1x DPR always, no invalidation needed
    }

    // Resize all canvases with DPR scaling
    Object.entries(this._canvases).forEach(([layer, canvas]) => {
      canvas.width = width * this._dpr;
      canvas.height = height * this._dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Re-apply DPR scale to context (gets reset when canvas resizes)
      this._contexts[layer].scale(this._dpr, this._dpr);
    });

    this._viewportWidth = width;
    this._viewportHeight = height;
    this.requestRender();
  }

  get uiCanvas() {
    return this._canvases.ui;
  }

  /**
   * Get list of available water types (populated after loadImages)
   * @returns {string[]} Array of water type names (e.g., ['water', 'water-pond', 'water-river'])
   */
  get waterTypes() {
    return this._waterTypes || [];
  }

  // ═══════════════════════════════════════════════════════════════
  // IMAGE LOADING
  // ═══════════════════════════════════════════════════════════════

  async loadImages() {
    // Fetch available sprites from server
    let spriteManifest = { trees: {}, brush: {}, ground: [], water: [], floor: {} };
    try {
      const response = await fetch('/api/terrain/sprites');
      spriteManifest = await response.json();
    } catch (err) {
      console.warn('[Renderer] Could not fetch sprite manifest, using defaults:', err);
      spriteManifest = {
        trees: {},
        brush: {},
        ground: ['grass', 'open'],
        water: ['water', 'water-pond', 'water-river'],
        floor: {}
      };
    }

    // Store water types for dropdown population
    this._waterTypes = spriteManifest.water || [];

    const promises = [];

    // Ground textures - only load what exists
    spriteManifest.ground.forEach(type => {
      promises.push(this._loadImage(
        `ground-${type}`,
        `/sprites/terrain/ground/terrain-${type}.png`,
        this._images.ground,
        type
      ));
    });

    // Water textures - load separately (stored in ground folder but tracked separately)
    (spriteManifest.water || []).forEach(type => {
      promises.push(this._loadImage(
        `ground-${type}`,
        `/sprites/terrain/ground/terrain-${type}.png`,
        this._images.ground,
        type
      ));
    });

    // Tree sprites - only load what exists
    for (const [key, path] of Object.entries(spriteManifest.trees)) {
      promises.push(this._loadImage(key, path, this._images.trees));
    }

    // Brush sprites - only load what exists
    console.log('[Renderer] Brush sprites from API:', spriteManifest.brush);
    for (const [key, path] of Object.entries(spriteManifest.brush || {})) {
      promises.push(this._loadImage(key, path, this._images.brush));
    }

    // Floor patch sprites - discrete sprites with variants
    console.log('[Renderer] Floor sprites from API:', spriteManifest.floor);
    for (const [key, path] of Object.entries(spriteManifest.floor || {})) {
      promises.push(this._loadImage(key, path, this._images.floor));
    }

    await Promise.all(promises);
    console.log('[Renderer] Images loaded:', {
      ground: Object.keys(this._images.ground).length,
      trees: Object.keys(this._images.trees).length,
      brush: Object.keys(this._images.brush).length,
      floor: Object.keys(this._images.floor).length
    });

    // Invalidate caches now that images are loaded
    this._invalidateGroundCache();
    this._invalidateCanopyCache();
    this.requestRender();
  }

  _loadImage(name, path, target, key = null) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        target[key || name] = img;
        resolve();
      };
      img.onerror = (err) => {
        console.error(`[Renderer] Failed to load image: ${path}`, err);
        resolve();
      };
      img.src = path;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER LOOP
  // ═══════════════════════════════════════════════════════════════

  _startRenderLoop() {
    const loop = () => {
      // Update animations (returns true if any are still active)
      const animating = hasActiveAnimations();
      if (animating) {
        updateAnimations();
        // Request render to show animated items (don't invalidate cache)
        this._needsRender = true;
      }

      if (this._needsRender) {
        this._render();
        this._needsRender = false;
        this._needsUIRender = false;  // Full render includes UI
      } else if (this._needsUIRender) {
        // Lightweight UI-only render (brush preview, selection)
        this._renderUIOnly();
        this._needsUIRender = false;
      }
      this._frameRequest = requestAnimationFrame(loop);
    };
    loop();
  }

  requestRender() {
    this._needsRender = true;
  }

  stop() {
    if (this._frameRequest) {
      cancelAnimationFrame(this._frameRequest);
      this._frameRequest = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════════════════════════

  _render() {
    const viewport = this._state.viewport;
    const dpr = this._dpr || 1;

    // Check if rendering mode changed - invalidate caches if so
    const useScatter = this._state.viewSettings.useScatterRendering || false;
    if (this._useScatterRendering !== useScatter) {
      this._useScatterRendering = useScatter;
      this._invalidateGroundCache();
      this._invalidateCanopyCache();
      console.log(`[Renderer] Rendering mode changed to: ${useScatter ? 'scatter' : 'legacy'}`);
    }

    // Clear all canvases and apply viewport transform (with DPR scaling)
    Object.entries(this._contexts).forEach(([layer, ctx]) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Disable image smoothing for crisp pixel art
      ctx.imageSmoothingEnabled = false;

      // Only fill background on ground layer (others stay transparent)
      if (layer === 'ground') {
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }

      // Apply DPR-scaled viewport transform
      ctx.setTransform(
        viewport.zoom * dpr, 0, 0, viewport.zoom * dpr,
        viewport.x * dpr, viewport.y * dpr
      );
    });

    this._renderGround();
    this._renderFeatures();
    this._renderUI();
  }

  _renderGround() {
    const ctx = this._contexts.ground;
    ctx.imageSmoothingEnabled = false;
    const terrainMap = this._state.terrainMap;

    // Check if we need to rebuild the ground cache
    const strokeCount = terrainMap.strokes?.length || 0;
    const treeCount = terrainMap.trees?.length || 0;
    const floorPatchCount = terrainMap.floorPatches?.length || 0;
    const scatterCount = terrainMap.scatterItems?.length || 0;

    const needsRebuild = !this._groundCacheValid || terrainMap.dirty ||
        this._groundCacheStrokeCount !== strokeCount ||
        this._groundCacheTreeCount !== treeCount ||
        this._groundCacheFloorPatchCount !== floorPatchCount ||
        this._groundCacheScatterCount !== scatterCount;

    // Skip ground cache rebuild during drag painting (too expensive even at preview quality)
    // New strokes are shown via the paint preview canvas instead
    // Full rebuild happens on mouseup via endDragPaint()
    if (needsRebuild && !this._isDragPainting) {
      this._rebuildGroundCache();
      this._groundCacheStrokeCount = strokeCount;
      this._groundCacheTreeCount = treeCount;
      this._groundCacheFloorPatchCount = floorPatchCount;
      this._groundCacheScatterCount = scatterCount;
      terrainMap.dirty = false;
    }

    // Draw cached ground layer
    if (this._groundCache) {
      ctx.drawImage(this._groundCache, 0, 0);
    }

    // During drag painting, render uncached floor items (not in ground cache yet)
    if (this._isDragPainting && this._state.viewSettings.useScatterRendering) {
      this._renderUncachedFloorItems(ctx);
    }

    // Draw paint preview layer (strokes being painted, not yet in cache)
    if (this._paintPreview && this._paintPreviewStrokes.length > 0) {
      ctx.drawImage(this._paintPreview, 0, 0);
    }

    // Draw animating strokes (between drag end and cache bake)
    if (this._animatingStrokes.length > 0) {
      this._renderAnimatingStrokes(ctx);
    }

    // Draw texture hover preview (semi-transparent preview of water/ground texture)
    if (this._textureHoverPreview) {
      this._renderTextureHoverPreview(ctx);
    }

    // Draw grid (on top, not cached)
    this._renderGrid(ctx);
  }

  /**
   * Rebuild the cached ground layer with all strokes
   * @param {boolean} previewMode - Use lower resolution for faster rendering during drag painting
   */
  _rebuildGroundCache(previewMode = false) {
    const terrainMap = this._state.terrainMap;
    const viewSettings = this._state.viewSettings;
    const groundImg = this._images.ground[terrainMap.baseLayer];
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    // Create or resize cache canvas
    if (!this._groundCache || this._groundCache.width !== width || this._groundCache.height !== height) {
      this._groundCache = document.createElement('canvas');
      this._groundCache.width = width;
      this._groundCache.height = height;
    }

    const cacheCtx = this._groundCache.getContext('2d');
    cacheCtx.imageSmoothingEnabled = false;
    cacheCtx.clearRect(0, 0, width, height);

    // Draw base layer
    if (groundImg) {
      const tileSize = 256 * GROUND_TEXTURE_SCALE;
      for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
          cacheCtx.drawImage(groundImg, x, y, tileSize, tileSize);
        }
      }
    } else {
      cacheCtx.fillStyle = '#4a6a3a';
      cacheCtx.fillRect(0, 0, width, height);
    }

    // Draw ground texture strokes (excluding shore)
    ensureRasterized(terrainMap);
    for (const stroke of terrainMap.strokes) {
      if (stroke.type === 'groundTexture' && !stroke.isShore) {
        this._renderGroundTextureStroke(cacheCtx, stroke, previewMode);
      }
    }

    // Draw forest floor (ground texture radiating from each tree)
    if (viewSettings.useScatterRendering) {
      // SCATTER SYSTEM: Discrete floor sprites
      const viewport = { x: 0, y: 0, width, height };
      const images = {
        tree: this._images.trees,
        brush: this._images.brush,
        floor: this._images.floor,
        particle: this._images.brush
      };
      // Get post-processing settings from state (applied at render time)
      const postProcessing = this._state.toolOptions?.seasonOverrides || {};
      renderScatterLayer(cacheCtx, terrainMap, 'ground', viewport, images, { postProcessing });
    } else {
      // LEGACY SYSTEM: Forest-floor ground texture radiating from each tree
      this._renderTreeBasedGroundLayer(cacheCtx, previewMode);
    }

    // Draw shore strokes with occlusion culling (on top of regular ground textures, under water)
    const shoreStrokes = terrainMap.strokes.filter(s => s.type === 'groundTexture' && s.isShore);
    const visibleShoreStrokes = shoreStrokes.filter(s => !this._isStrokeOccluded(s, shoreStrokes));
    for (const stroke of visibleShoreStrokes) {
      this._renderGroundTextureStroke(cacheCtx, stroke, previewMode);
    }

    // Draw water strokes with occlusion culling
    // Sort so deep water always renders on top of regular water
    const waterStrokes = terrainMap.strokes.filter(s => s.type === 'water');
    const visibleWaterStrokes = waterStrokes.filter(s => !this._isStrokeOccluded(s, waterStrokes));
    visibleWaterStrokes.sort((a, b) => {
      const aDeep = (a.textureType || '').includes('deep') ? 1 : 0;
      const bDeep = (b.textureType || '').includes('deep') ? 1 : 0;
      return aDeep - bDeep;  // Regular water first, deep water last
    });
    for (const stroke of visibleWaterStrokes) {
      this._renderWaterStroke(cacheCtx, stroke, previewMode);
    }

    this._groundCacheValid = true;
    this._groundCacheIsPreview = previewMode;
  }

  /**
   * Core texture stroke renderer - renders any texture with alpha fade
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   * @param {string} textureType - Texture key in this._images.ground
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} radius - Stroke radius
   * @param {number} intensity - Alpha intensity (0-1)
   * @param {number} fadeWidth - Edge fade width in display pixels (default 12)
   * @param {boolean} previewMode - Use lower resolution for faster preview rendering
   */
  _renderTextureStroke(ctx, textureType, x, y, radius, intensity, fadeWidth = 12, previewMode = false) {
    const textureImg = this._images.ground[textureType];

    if (!textureImg) {
      // Fallback: draw colored circle if texture not loaded
      const fallbackColors = {
        'forest-floor': '#3a3025',
        'dirt': '#5a5045',
        'mud': '#3a3530',
        'sand': '#8a8070',
        'grass': '#5a6a4a',
        'water': '#1e5a8c',
        'water-pond': '#2a4a5a',
        'water-river': '#2a3a4a',
        'water-ocean': '#2a3a4a',
        'water-marsh': '#2a3a2a',
        // Floor patch types (tree-specific)
        'floor-oak': '#5a4a35',
        'floor-pine': '#5a3530',
        'floor-birch': '#6a6550',
        'floor-damp': '#3a3025',
        'floor-bare': '#4a4035',
        'floor-mixed': '#5a4a3a'
      };
      ctx.fillStyle = fallbackColors[textureType] || '#4a4a3a';
      ctx.globalAlpha = intensity;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // Use 1x for preview (fast), 4x for final render (crisp)
    // Preview is temporary during drag - full quality on mouseup
    let scale = previewMode ? 1 : 4;
    if (!previewMode && radius > 200) scale = 2;
    if (!previewMode && radius > 400) scale = 1;
    const tileSize = 256 * GROUND_TEXTURE_SCALE * scale; // = 256 (native)
    const scaledRadius = radius * scale;
    const scaledFadeWidth = fadeWidth * scale;

    // Reuse temp canvas (resize only if needed)
    const size = Math.ceil(scaledRadius * 2) + 2;
    if (!this._tempCanvas || this._tempCanvasSize < size) {
      // Create or resize temp canvas (only when needed)
      this._tempCanvas = document.createElement('canvas');
      this._tempCanvas.width = size;
      this._tempCanvas.height = size;
      this._tempCtx = this._tempCanvas.getContext('2d');
      this._tempCanvasSize = size;
    }
    const tempCanvas = this._tempCanvas;
    const tempCtx = this._tempCtx;

    // Clear and configure
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.imageSmoothingEnabled = false;

    // Tile texture at 4x scale
    const startX = (x - radius) * scale;
    const startY = (y - radius) * scale;
    const offsetX = ((startX % tileSize) + tileSize) % tileSize;
    const offsetY = ((startY % tileSize) + tileSize) % tileSize;

    for (let ty = -offsetY; ty < size; ty += tileSize) {
      for (let tx = -offsetX; tx < size; tx += tileSize) {
        tempCtx.drawImage(textureImg, tx, ty, tileSize, tileSize);
      }
    }

    // Apply circular alpha mask with soft edges at 4x resolution
    tempCtx.globalCompositeOperation = 'destination-in';
    const innerRadius = Math.max(0, scaledRadius - scaledFadeWidth);
    const gradient = tempCtx.createRadialGradient(
      scaledRadius, scaledRadius, innerRadius,
      scaledRadius, scaledRadius, scaledRadius
    );
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    tempCtx.fillStyle = gradient;
    tempCtx.fillRect(0, 0, size, size);

    // Draw to main canvas, scaling down from 4x
    // Use source rect to handle cases where temp canvas is larger than needed
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = intensity;
    ctx.drawImage(tempCanvas, 0, 0, size, size, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  /**
   * Render floor patches as discrete sprites
   * Floor patches are pre-generated and stored in terrainMap.floorPatches
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   */
  _renderFloorPatches(ctx) {
    const terrainMap = this._state.terrainMap;
    const patches = terrainMap.floorPatches || [];

    if (patches.length === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    for (const patch of patches) {
      this._renderFloorPatch(ctx, patch);
    }

    ctx.restore();
  }

  /**
   * Render a single floor patch sprite
   */
  _renderFloorPatch(ctx, patch) {
    // Get sprite image: floor-oak-1, floor-pine-2, etc.
    const spriteKey = `${patch.floorType}-${patch.variant}`;
    const img = this._images.floor[spriteKey];

    if (!img) {
      // Fallback: draw colored circle if sprite not loaded
      const fallbackColors = {
        'floor-leaf': '#4a6a40',
        'floor-leaf-fall': '#7a5540',
        'floor-leaf-dry': '#5a4a35',
        'floor-needle': '#5a3530',
        'floor-debris': '#4a4035'
      };
      ctx.globalAlpha = patch.alpha;
      ctx.fillStyle = fallbackColors[patch.floorType] || '#4a4a3a';
      ctx.beginPath();
      ctx.arc(patch.x, patch.y, 10 * patch.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // Calculate sprite size (256px base, scaled by patch.scale)
    const baseSize = 256;
    const size = baseSize * patch.scale;
    const halfSize = size / 2;

    ctx.save();
    ctx.globalAlpha = patch.alpha;

    // Apply color variation via filter
    if (patch.hueShift || patch.brightness !== 1 || patch.saturation !== 1) {
      ctx.filter = `hue-rotate(${patch.hueShift || 0}deg) brightness(${patch.brightness || 1}) saturate(${patch.saturation || 1})`;
    }

    // Translate to patch center, rotate, then draw
    ctx.translate(patch.x, patch.y);
    ctx.rotate((patch.rotation || 0) * Math.PI / 180);
    ctx.drawImage(img, -halfSize, -halfSize, size, size);

    ctx.restore();
  }

  /**
   * Render tree-based ground layer (LEGACY SYSTEM)
   * Each tree creates a circular forest-floor texture radiating outward
   * Uses tree.floorRadiusPercent, tree.floorIntensity, tree.floorFade for settings
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   */
  _renderTreeBasedGroundLayer(ctx, previewMode = false) {
    const terrainMap = this._state.terrainMap;
    const trees = terrainMap.trees || [];

    if (trees.length === 0) return;

    // Sort trees by scale (smaller first) so larger trees' floors render on top
    const sortedTrees = [...trees].sort((a, b) => a.scale - b.scale);

    for (const tree of sortedTrees) {
      // Get floor settings baked on tree (or use defaults for legacy trees)
      const floorRadiusPercent = tree.floorRadiusPercent ?? 30;
      const floorIntensity = tree.floorIntensity ?? 70;

      // Calculate floor radius based on canopy size
      // Canopy radius = 115 * tree.scale (same as particle system)
      const canopyRadius = 115 * tree.scale;
      const floorRadiusMultiplier = floorRadiusPercent / 100 + 1;
      const floorRadius = canopyRadius * floorRadiusMultiplier;

      // Skip very small floors
      if (floorRadius < 10) continue;

      // Intensity from tree's baked setting, with slight variation by size
      const baseIntensity = floorIntensity / 100;
      const sizeVariation = (tree.scale - 0.5) * 0.1;
      const intensity = Math.min(0.95, Math.max(0.3, baseIntensity + sizeVariation));

      // Floor fade as percentage (0% = hard edge, 100% = entire floor fades)
      const floorFadePercent = tree.floorFade ?? 100;

      // Render from center (innerRadius=0) to floor radius
      this._renderTextureRing(
        ctx,
        'forest-floor',
        tree.x,
        tree.y,
        0,  // Start from center
        floorRadius,
        intensity,
        floorFadePercent,
        'source-over',
        previewMode
      );
    }
  }

  /**
   * Simple seeded random for consistent patch placement
   */
  _seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  /**
   * Render a textured ring (donut shape) with gradient from inner to outer edge
   * Note: Pass innerRadius=0 to render a filled circle instead of a ring
   * Used for tree-based floor that radiates from canopy edge outward
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   * @param {string} textureType - Texture key
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} innerRadius - Inner edge (canopy edge)
   * @param {number} outerRadius - Outer edge (floor extent)
   * @param {number} intensity - Max alpha at inner edge
   * @param {number} fadePercent - Percentage of ring that fades (0=hard edge, 100=full fade)
   * @param {string} blendMode - Composite operation (default 'source-over', use 'multiply' for darkening overlaps)
   */
  _renderTextureRing(ctx, textureType, x, y, innerRadius, outerRadius, intensity, fadePercent = 100, blendMode = 'source-over', previewMode = false) {
    const textureImg = this._images.ground[textureType];

    if (!textureImg) {
      // Fallback: draw colored ring
      ctx.save();
      ctx.globalAlpha = intensity;
      ctx.fillStyle = '#3a3025';
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
      ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true); // counter-clockwise for hole
      ctx.fill();
      ctx.restore();
      return;
    }

    const scale = previewMode ? 1 : 2; // Lower resolution during drag painting
    const tileSize = 256 * GROUND_TEXTURE_SCALE * scale;
    const scaledOuter = outerRadius * scale;
    const scaledInner = innerRadius * scale;

    // Create temp canvas for the ring
    const size = Math.ceil(scaledOuter * 2) + 2;
    if (!this._tempCanvas || this._tempCanvasSize < size) {
      this._tempCanvas = document.createElement('canvas');
      this._tempCanvas.width = size;
      this._tempCanvas.height = size;
      this._tempCtx = this._tempCanvas.getContext('2d');
      this._tempCanvasSize = size;
    }
    const tempCanvas = this._tempCanvas;
    const tempCtx = this._tempCtx;

    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.imageSmoothingEnabled = false;

    // Tile texture (ensure source-over mode for tiling)
    tempCtx.globalCompositeOperation = 'source-over';
    const startX = (x - outerRadius) * scale;
    const startY = (y - outerRadius) * scale;
    const offsetX = ((startX % tileSize) + tileSize) % tileSize;
    const offsetY = ((startY % tileSize) + tileSize) % tileSize;

    for (let ty = -offsetY; ty < size; ty += tileSize) {
      for (let tx = -offsetX; tx < size; tx += tileSize) {
        tempCtx.drawImage(textureImg, tx, ty, tileSize, tileSize);
      }
    }

    // Apply circular mask with fade
    // fadePercent controls the width of the fade zone at the outer edge
    // 100% = fade starts from center, 50% = outer half fades, 0% = hard edge (no fade)
    tempCtx.globalCompositeOperation = 'destination-in';

    const ringWidth = scaledOuter - scaledInner;
    const solidPortion = 1 - (fadePercent / 100);
    const fadeStartRadius = scaledInner + (ringWidth * solidPortion);

    // Hard edge case (fade < 1%): just fill solid circle, no gradient
    if (fadePercent < 1) {
      tempCtx.fillStyle = 'rgba(0,0,0,1)';
      tempCtx.beginPath();
      tempCtx.arc(scaledOuter, scaledOuter, scaledOuter, 0, Math.PI * 2);
      if (scaledInner > 0) {
        tempCtx.arc(scaledOuter, scaledOuter, scaledInner, 0, Math.PI * 2, true);
      }
      tempCtx.fill();
    } else {
      // Gradient fade case
      // The radial gradient automatically handles the solid inner portion:
      // - Inside fadeStartRadius: uses first color stop (fully opaque)
      // - Between fadeStartRadius and scaledOuter: fades from opaque to transparent
      // - Outside scaledOuter: uses last color stop (fully transparent)
      const gradient = tempCtx.createRadialGradient(
        scaledOuter, scaledOuter, fadeStartRadius,
        scaledOuter, scaledOuter, scaledOuter
      );
      gradient.addColorStop(0, 'rgba(0,0,0,1)');  // Full opacity at fade start
      gradient.addColorStop(1, 'rgba(0,0,0,0)');  // Transparent at outer edge

      // Apply gradient mask to entire canvas - no separate solid fill needed
      tempCtx.fillStyle = gradient;
      tempCtx.fillRect(0, 0, size, size);
    }

    // Draw to main canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = intensity;
    if (blendMode && blendMode !== 'source-over') {
      ctx.globalCompositeOperation = blendMode;
    }
    ctx.drawImage(tempCanvas, 0, 0, size, size, x - outerRadius, y - outerRadius, outerRadius * 2, outerRadius * 2);
    ctx.restore();
  }

  _renderGroundTextureStroke(ctx, stroke, previewMode = false) {
    const { x, y, radius, intensity, textureType, fadeWidth } = stroke;
    this._renderTextureStroke(ctx, textureType, x, y, radius, intensity, fadeWidth ?? 12, previewMode);
  }

  _renderWaterStroke(ctx, stroke, previewMode = false) {
    const { x, y, radius, intensity, fadeWidth, textureType, depthFade, waterDepth } = stroke;
    const type = textureType || 'water';

    // Deep water gets special full-radius depth gradient
    // (shaded throughout, not just at edges)
    if (type.includes('deep')) {
      this._renderDeepWaterStroke(ctx, type, x, y, radius, waterDepth ?? 0.7, fadeWidth ?? 12, previewMode);
    } else if (depthFade && depthFade > 0) {
      // Use depth-aware rendering for deeper center effect
      this._renderTextureStrokeWithDepth(ctx, type, x, y, radius, intensity, fadeWidth ?? 12, depthFade, previewMode);
    } else {
      this._renderTextureStroke(ctx, type, x, y, radius, intensity, fadeWidth ?? 12, previewMode);
    }
  }

  /**
   * Render uncached floor items during drag painting
   * Floor patches are on the 'ground' layer and need to appear on the ground canvas
   */
  _renderUncachedFloorItems(ctx) {
    const terrainMap = this._state.terrainMap;
    const scatterCount = terrainMap.scatterItems?.length || 0;

    // Only render items added after the last cache build
    if (!terrainMap.scatterItems || scatterCount <= this._groundCacheScatterCount) {
      return;
    }

    const uncachedItems = terrainMap.scatterItems.slice(this._groundCacheScatterCount);

    // Filter to floor items only (ground layer)
    const floorItems = uncachedItems.filter(item => {
      const config = SCATTER_TYPES[item.type];
      return config && config.layer === 'ground';
    });

    if (floorItems.length === 0) return;

    // Viewport culling
    const vp = this._state.viewport;
    const vpLeft = -vp.x / vp.zoom;
    const vpTop = -vp.y / vp.zoom;
    const vpRight = vpLeft + this._viewportWidth / vp.zoom;
    const vpBottom = vpTop + this._viewportHeight / vp.zoom;
    const margin = 100;

    const visibleFloor = floorItems.filter(item => {
      return item.x > vpLeft - margin && item.x < vpRight + margin &&
             item.y > vpTop - margin && item.y < vpBottom + margin;
    });

    if (visibleFloor.length === 0) return;

    // Prepare images
    const images = {
      tree: this._images.trees,
      brush: this._images.brush,
      floor: this._images.floor,
      particle: this._images.brush
    };

    // Render floor items
    for (const item of visibleFloor) {
      renderScatterItem(ctx, item, images, { skipFilters: true });
    }
  }

  _renderGrid(ctx) {
    const viewSettings = this._state.viewSettings;
    if (!viewSettings.showGrid) return;

    const cellSize = this._state.cellSize;
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;
    const opacity = viewSettings.gridOpacity || 0.1;

    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.lineWidth = 1 / this._state.viewport.zoom;

    for (let x = 0; x <= width; x += cellSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y += cellSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  _renderParticleDebugRings(ctx) {
    const terrainMap = this._state.terrainMap;
    if (!terrainMap.trees || terrainMap.trees.length === 0) return;

    const toolOptions = this._state.toolOptions;
    const spreadPercent = toolOptions.particleSpread ?? 40;

    ctx.lineWidth = 2;

    for (const tree of terrainMap.trees) {
      // Calculate the same values as generateParticlesForTree
      const canopyRadius = 115 * tree.scale;
      const minRadius = canopyRadius * 0.95;
      // Spread scales proportionally with canopy size
      const maxRadius = canopyRadius * (1 + spreadPercent / 100);

      // Draw canopy edge (yellow - thick)
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, canopyRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw min radius (green - where particles start)
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, minRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw max radius (red - where particles end)
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, maxRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw center point
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _renderFeatures() {
    const ctx = this._contexts.features;
    const terrainMap = this._state.terrainMap;

    // Check if we need to rebuild the canopy cache
    // Use terrainMap.trees, brushes, particles, and scatterItems length change as proxy for changes during painting
    const treeCount = terrainMap.trees?.length || 0;
    const brushCount = terrainMap.brushes?.length || 0;
    const particleCount = terrainMap.particles?.length || 0;
    const scatterCount = terrainMap.scatterItems?.length || 0;

    // Throttle cache rebuild during drag painting, skip during animations
    const animating = hasActiveAnimations();
    const needsRebuild = !this._canopyCacheValid ||
        this._canopyCacheTreeCount !== treeCount ||
        this._canopyCacheBrushCount !== brushCount ||
        this._canopyCacheParticleCount !== particleCount ||
        this._canopyCacheScatterCount !== scatterCount;

    if (needsRebuild && !this._isDragPainting && !animating) {
      this._rebuildCanopyCache();
    }

    // Draw cached canopy layer (rendered at 1x DPR / map size)
    if (this._canopyCache) {
      const width = this._state.canvasWidth;
      const height = this._state.canvasHeight;
      ctx.drawImage(this._canopyCache, 0, 0, width, height);
    }

    // Render items that aren't in the cache yet (added since last cache rebuild)
    // This includes both currently animating items AND items that finished animating
    // but cache hasn't been rebuilt yet
    if (terrainMap.scatterItems && scatterCount > this._canopyCacheScatterCount) {
      // Items with index >= cachedCount are not in the cache
      const uncachedItems = terrainMap.scatterItems.slice(this._canopyCacheScatterCount);
      if (uncachedItems.length > 0) {
        // Prepare images for scatter renderer
        const images = {
          tree: this._images.trees,
          brush: this._images.brush,
          floor: this._images.floor,
          particle: this._images.brush
        };

        // Filter to canopy/particle layer items only (floor is handled by _renderUncachedFloorItems)
        const canopyItems = uncachedItems.filter(item => {
          const config = SCATTER_TYPES[item.type];
          return config && (config.layer === 'canopy' || config.layer === 'particle');
        });

        if (canopyItems.length > 0) {
          // PERFORMANCE: Get current viewport for culling
          const vp = this._state.viewport;
          const vpLeft = -vp.x / vp.zoom;
          const vpTop = -vp.y / vp.zoom;
          const vpRight = vpLeft + this._viewportWidth / vp.zoom;
          const vpBottom = vpTop + this._viewportHeight / vp.zoom;
          const margin = 150; // Extra margin for large sprites

          // Filter to visible items only (viewport culling)
          const visibleItems = canopyItems.filter(item => {
            const x = item._renderX ?? item.x;
            const y = item._renderY ?? item.y;
            return x > vpLeft - margin && x < vpRight + margin &&
                   y > vpTop - margin && y < vpBottom + margin;
          });

          // PERFORMANCE: Zoom-based LOD
          // When zoomed out, skip particles entirely - they're too small to see
          const zoom = vp.zoom;
          let itemsToRender = visibleItems;

          // LOD: When zoomed out, skip small detail items
          if (zoom < 0.5) {
            // Very zoomed out: only trees
            itemsToRender = visibleItems.filter(i => SCATTER_TYPES[i.type]?.category === 'tree');
          } else if (zoom < 0.75) {
            // Moderately zoomed out: trees + brush, skip particles
            itemsToRender = visibleItems.filter(i => {
              const cat = SCATTER_TYPES[i.type]?.category;
              return cat === 'tree' || cat === 'brush';
            });
          }

          // Sort items to render (smaller scale first, then by Y for proper layering)
          itemsToRender.sort((a, b) => {
            const scaleA = a._renderScale ?? a.scale;
            const scaleB = b._renderScale ?? b.scale;
            return (scaleA - scaleB) || (a.y - b.y);
          });

          // Render each item
          // Skip CSS filters for live rendering - filters applied during cache rebuild
          for (const item of itemsToRender) {
            renderScatterItem(ctx, item, images, { skipFilters: true });
          }
        }
      }
    }
  }

  _rebuildCanopyCache() {
    const terrainMap = this._state.terrainMap;
    const viewSettings = this._state.viewSettings;
    ensureRasterized(terrainMap);

    // Always render canopy at 1x DPR - pixel art doesn't need subpixel rendering
    // This saves 4x memory and GPU work on 2x displays
    const canopyDpr = 1;

    // Check which rendering system to use
    if (viewSettings.useScatterRendering) {
      // NEW: Scatter system rendering with viewport culling
      this._canopyCache = this._buildScatterCanopyCache(terrainMap);
    } else {
      // LEGACY: Old rendering system
      // Pass tree, brush, and particle images for rendering
      // Particles use brush images folder, so pass brush images as particleImages too
      this._canopyCache = renderCanopyLayer(terrainMap, this._state.cellSize, this._images.trees, canopyDpr, this._images.brush, this._images.brush);
    }

    this._canopyCacheValid = true;
    this._canopyCacheTreeCount = terrainMap.trees?.length || 0;
    this._canopyCacheBrushCount = terrainMap.brushes?.length || 0;
    this._canopyCacheParticleCount = terrainMap.particles?.length || 0;
    this._canopyCacheScatterCount = terrainMap.scatterItems?.length || 0;
    const scatterCount = terrainMap.scatterItems?.length || 0;
    const mode = viewSettings.useScatterRendering ? 'scatter' : 'legacy';
    console.log(`[Renderer] Canopy cache rebuilt [${mode}] (${this._canopyCacheTreeCount} trees, ${this._canopyCacheBrushCount} brush, ${this._canopyCacheParticleCount} particles, ${scatterCount} scatter, dpr=${canopyDpr})`);
  }

  /**
   * Build canopy cache using the new scatter system
   * @param {object} terrainMap - TerrainMap with scatterItems[]
   * @returns {HTMLCanvasElement} - Rendered canopy cache
   */
  _buildScatterCanopyCache(terrainMap) {
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    // Create cache canvas at 1x resolution (pixel art doesn't need subpixel rendering)
    const cache = document.createElement('canvas');
    cache.width = width;
    cache.height = height;
    const ctx = cache.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Full map viewport (render everything for the cache)
    const viewport = { x: 0, y: 0, width, height };

    // Prepare images for scatter renderer
    // Map legacy image collections to scatter categories
    const images = {
      tree: this._images.trees,      // trees → tree category
      brush: this._images.brush,     // brush → brush category
      floor: this._images.floor,     // floor patches
      particle: this._images.brush   // particles use brush sprites for now
    };

    // Get post-processing settings from state (applied at render time, not generation)
    const postProcessing = this._state.toolOptions?.seasonOverrides || {};

    // Render layers in order: particle (under trees) → canopy (trees, brush)
    renderScatterLayer(ctx, terrainMap, 'particle', viewport, images, { postProcessing });
    renderScatterLayer(ctx, terrainMap, 'canopy', viewport, images, { postProcessing });

    return cache;
  }

  /**
   * Lightweight render - only redraws what's needed
   * Fast path: if only brush cursor moved, only redraws UI canvas
   * Full path: if data changed (paint preview, counts), redraws affected layers
   */
  _renderUIOnly() {
    const viewport = this._state.viewport;
    const dpr = this._dpr || 1;
    const terrainMap = this._state.terrainMap;

    // Check if ground or features data changed
    const strokeCount = terrainMap.strokes?.length || 0;
    const treeCount = terrainMap.trees?.length || 0;
    const floorPatchCount = terrainMap.floorPatches?.length || 0;

    const groundDataChanged = !this._groundCacheValid ||
        this._groundCacheStrokeCount !== strokeCount ||
        this._groundCacheTreeCount !== treeCount ||
        this._groundCacheFloorPatchCount !== floorPatchCount;

    const hasPaintPreview = this._paintPreview && this._paintPreviewStrokes.length > 0;

    // Rebuild ground cache if data changed (skip during drag painting)
    if (groundDataChanged && !this._isDragPainting) {
      this._rebuildGroundCache();
      this._groundCacheStrokeCount = strokeCount;
      this._groundCacheTreeCount = treeCount;
      this._groundCacheFloorPatchCount = floorPatchCount;
    }

    // Redraw ground canvas if cache was rebuilt or paint/hover preview needs showing
    const hasTextureHover = this._textureHoverPreview !== null;
    const needsGroundRedraw = (groundDataChanged && !this._isDragPainting) || hasPaintPreview || hasTextureHover;
    if (needsGroundRedraw) {
      const groundCtx = this._contexts.ground;
      groundCtx.setTransform(1, 0, 0, 1, 0, 0);
      groundCtx.clearRect(0, 0, groundCtx.canvas.width, groundCtx.canvas.height);
      groundCtx.imageSmoothingEnabled = false;
      groundCtx.fillStyle = '#0d0d1a';
      groundCtx.fillRect(0, 0, groundCtx.canvas.width, groundCtx.canvas.height);
      groundCtx.setTransform(
        viewport.zoom * dpr, 0, 0, viewport.zoom * dpr,
        viewport.x * dpr, viewport.y * dpr
      );

      if (this._groundCache) {
        groundCtx.drawImage(this._groundCache, 0, 0);
      }
      if (hasPaintPreview) {
        groundCtx.drawImage(this._paintPreview, 0, 0);
      }
      // Render texture hover preview (semi-transparent)
      if (hasTextureHover) {
        this._renderTextureHoverPreview(groundCtx);
      }
      this._renderGrid(groundCtx);
    }

    // Only redraw features if counts changed (skip during drag painting)
    const scatterCount = terrainMap.scatterItems?.length || 0;
    const featuresDataChanged = !this._canopyCacheValid ||
        this._canopyCacheTreeCount !== treeCount ||
        this._canopyCacheBrushCount !== (terrainMap.brushes?.length || 0) ||
        this._canopyCacheParticleCount !== (terrainMap.particles?.length || 0) ||
        this._canopyCacheScatterCount !== scatterCount;

    if (featuresDataChanged && !this._isDragPainting) {
      const wasDirty = this._state.terrainMap.dirty;
      const featuresCtx = this._contexts.features;
      featuresCtx.setTransform(1, 0, 0, 1, 0, 0);
      featuresCtx.clearRect(0, 0, featuresCtx.canvas.width, featuresCtx.canvas.height);
      featuresCtx.imageSmoothingEnabled = false;
      featuresCtx.setTransform(
        viewport.zoom * dpr, 0, 0, viewport.zoom * dpr,
        viewport.x * dpr, viewport.y * dpr
      );
      this._renderFeatures();
      if (wasDirty) this._state.terrainMap.dirty = true;
    }

    // Always redraw UI canvas (brush preview, selection, boundary)
    const uiCtx = this._contexts.ui;
    uiCtx.setTransform(1, 0, 0, 1, 0, 0);
    uiCtx.clearRect(0, 0, uiCtx.canvas.width, uiCtx.canvas.height);
    uiCtx.imageSmoothingEnabled = false;
    uiCtx.setTransform(
      viewport.zoom * dpr, 0, 0, viewport.zoom * dpr,
      viewport.x * dpr, viewport.y * dpr
    );

    this._renderUI();
  }

  _renderUI() {
    const ctx = this._contexts.ui;

    // Render map boundary
    this._renderBoundary(ctx);

    // Render particle debug rings (on top of terrain, below selection)
    if (this._state.viewSettings.showParticleDebug) {
      this._renderParticleDebugRings(ctx);
    }

    // Render scatter preview (semi-transparent preview of next stroke)
    if (this._scatterPreview && this._scatterPreview.length > 0) {
      this._renderScatterPreview(ctx);
    }

    // Render selection highlights
    this._renderSelection(ctx);

    // Render brush preview (set by tool)
    if (this._brushPreview) {
      this._renderBrushPreview(ctx);
    }
  }

  /**
   * Render scatter preview items (semi-transparent preview of what will spawn)
   */
  _renderScatterPreview(ctx) {
    const items = this._scatterPreview;
    if (!items || items.length === 0) return;

    const images = {
      tree: this._images.trees,
      brush: this._images.brush,
      floor: this._images.floor,
      particle: this._images.brush
    };

    ctx.save();
    ctx.globalAlpha = 0.45;

    // Sort: smaller scale first, then by Y for proper layering
    const sorted = [...items].sort((a, b) => (a.scale - b.scale) || (a.y - b.y));

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

    ctx.restore();
  }

  /**
   * Render texture hover preview (semi-transparent preview of water/ground texture)
   * Ground textures are masked to not render over water strokes
   */
  _renderTextureHoverPreview(ctx) {
    const preview = this._textureHoverPreview;
    if (!preview) return;

    // For ground textures, check if we need water masking
    const isGroundTexture = !preview.isWater;
    const terrainMap = this._state.terrainMap;
    const waterStrokes = isGroundTexture && terrainMap.strokes
      ? terrainMap.strokes.filter(s => s.type === 'water')
      : [];

    if (isGroundTexture && waterStrokes.length > 0) {
      // Use temp canvas for masked preview
      const size = (preview.radius + preview.fadeWidth + 20) * 2;
      const tempCanvas = this._acquireCanvas(size);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.clearRect(0, 0, size, size);

      // Render preview centered in temp canvas
      const cx = size / 2;
      const cy = size / 2;
      this.renderWaterPreview(tempCtx, cx, cy, {
        waterType: preview.textureType,
        waterRadius: preview.radius,
        waterFadeWidth: preview.fadeWidth,
        waterOpacity: preview.waterOpacity ?? 1.0,
        waterDepthFade: preview.waterDepthFade ?? 0,
        waterDepth: preview.waterDepth ?? 0.7,
        shoreType: null,
        shoreWidth: 0,
        shoreFadeWidth: preview.fadeWidth,
        alpha: 0.7
      });

      // Erase water areas from temp canvas
      tempCtx.globalCompositeOperation = 'destination-out';
      for (const water of waterStrokes) {
        const effectiveRadius = water.radius + (water.shoreWidth || 0);
        // Transform water position to temp canvas coords
        const wx = water.x - preview.x + cx;
        const wy = water.y - preview.y + cy;
        tempCtx.beginPath();
        tempCtx.arc(wx, wy, effectiveRadius, 0, Math.PI * 2);
        tempCtx.fill();
      }

      // Draw masked preview to main canvas
      ctx.drawImage(tempCanvas, preview.x - cx, preview.y - cy);
      this._releaseCanvas(tempCanvas);
    } else {
      // No water masking needed - render directly
      this.renderWaterPreview(ctx, preview.x, preview.y, {
        waterType: preview.textureType,
        waterRadius: preview.radius,
        waterFadeWidth: preview.fadeWidth,
        waterOpacity: preview.waterOpacity ?? 1.0,
        waterDepthFade: preview.waterDepthFade ?? 0,
        waterDepth: preview.waterDepth ?? 0.7,
        shoreType: preview.isWater ? preview.shoreType : null,
        shoreWidth: preview.isWater ? preview.shoreWidth : 0,
        shoreFadeWidth: preview.shoreFadeWidth ?? preview.fadeWidth,
        alpha: 0.7
      });
    }
  }

  /**
   * Render water/texture preview at a specific position
   * Shared by on-canvas hover preview and panel preview
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {object} options - Render options
   */
  renderWaterPreview(ctx, x, y, options = {}) {
    const {
      waterType = 'water',
      waterRadius = 60,
      waterFadeWidth = 12,
      waterOpacity = 1.0,
      waterDepthFade = 0,
      waterDepth = 0.7,  // Deep water opacity (0.1-1.0)
      shoreType = null,
      shoreWidth = 0,
      shoreFadeWidth = 12,
      alpha = 1.0
    } = options;

    const hasShore = shoreType && shoreType !== 'none' && shoreWidth > 0;

    // Render shore first (larger radius), then water on top
    if (hasShore) {
      this._renderTextureStroke(
        ctx,
        shoreType,
        x, y,
        waterRadius + shoreWidth,
        alpha,
        shoreFadeWidth,
        true // preview mode
      );
    }

    // Render water with opacity and optional depth fade
    const effectiveWaterAlpha = alpha * waterOpacity;

    // Deep water gets full-radius depth gradient (shaded throughout)
    if (waterType.includes('deep')) {
      this._renderDeepWaterStroke(
        ctx,
        waterType,
        x, y,
        waterRadius,
        waterDepth * alpha,  // Use waterDepth to control darkness
        waterFadeWidth,
        true // preview mode
      );
    } else if (waterDepthFade > 0) {
      // Depth fade: render water with gradient opacity (edges more transparent)
      this._renderTextureStrokeWithDepth(
        ctx,
        waterType,
        x, y,
        waterRadius,
        effectiveWaterAlpha,
        waterFadeWidth,
        waterDepthFade,
        true // preview mode
      );
    } else {
      // Normal water rendering
      this._renderTextureStroke(
        ctx,
        waterType,
        x, y,
        waterRadius,
        effectiveWaterAlpha,
        waterFadeWidth,
        true // preview mode
      );
    }
  }

  /**
   * Render texture stroke with depth fade effect (center more opaque than edges)
   * Used for water depth effect. Reuses _tempCanvas for performance.
   */
  _renderTextureStrokeWithDepth(ctx, textureType, x, y, radius, intensity, fadeWidth, depthFade, previewMode = false) {
    const textureImg = this._images.ground[textureType];

    // Calculate edge opacity: at edges, opacity is reduced by depthFade amount
    const edgeOpacity = intensity * (1 - depthFade);
    const centerOpacity = intensity;

    if (!textureImg) {
      // Fallback: draw colored circle with depth gradient
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(30, 90, 140, ${centerOpacity})`);
      const fadeStop = Math.max(0, 1 - (fadeWidth / radius));
      gradient.addColorStop(fadeStop, `rgba(30, 90, 140, ${edgeOpacity})`);
      gradient.addColorStop(1, 'rgba(30, 90, 140, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Use 1x for preview (fast), 2x for final render
    // Preview is temporary during drag - full quality on mouseup
    let scale = previewMode ? 1 : 2;
    if (!previewMode && radius > 150) scale = 1;
    const tileSize = 256 * GROUND_TEXTURE_SCALE * scale;
    const scaledRadius = radius * scale;
    const scaledFadeWidth = fadeWidth * scale;

    // Reuse temp canvas (resize only if needed)
    const size = Math.ceil(scaledRadius * 2) + 2;
    if (!this._tempCanvas || this._tempCanvasSize < size) {
      this._tempCanvas = document.createElement('canvas');
      this._tempCanvas.width = size;
      this._tempCanvas.height = size;
      this._tempCtx = this._tempCanvas.getContext('2d');
      this._tempCanvasSize = size;
    }
    const tempCanvas = this._tempCanvas;
    const tempCtx = this._tempCtx;

    // Clear and configure
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.imageSmoothingEnabled = false;

    // Tile texture
    const startX = (x - radius) * scale;
    const startY = (y - radius) * scale;
    const offsetX = ((startX % tileSize) + tileSize) % tileSize;
    const offsetY = ((startY % tileSize) + tileSize) % tileSize;

    for (let ty = -offsetY; ty < size; ty += tileSize) {
      for (let tx = -offsetX; tx < size; tx += tileSize) {
        tempCtx.drawImage(textureImg, tx, ty, tileSize, tileSize);
      }
    }

    // Apply circular mask with depth-aware opacity gradient
    tempCtx.globalCompositeOperation = 'destination-in';
    const innerRadius = Math.max(0, scaledRadius - scaledFadeWidth);

    // Create gradient that goes from center opacity to edge opacity to transparent
    const gradient = tempCtx.createRadialGradient(
      scaledRadius, scaledRadius, 0,
      scaledRadius, scaledRadius, scaledRadius
    );
    // Center is full opacity
    gradient.addColorStop(0, `rgba(0,0,0,${centerOpacity})`);
    // Just before fade zone, use edge opacity
    const fadeStart = innerRadius / scaledRadius;
    gradient.addColorStop(Math.max(0, fadeStart), `rgba(0,0,0,${edgeOpacity})`);
    // Fade to transparent
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    tempCtx.fillStyle = gradient;
    tempCtx.fillRect(0, 0, size, size);

    // Draw to main canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, size, size, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  /**
   * Render deep water as a dark gradient overlay (no texture needed)
   * Deep water darkens existing water - darkest at center, transparent at edges
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   * @param {string} textureType - Unused (kept for API compatibility)
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} radius - Stroke radius
   * @param {number} intensity - Base alpha intensity (0-1)
   * @param {number} fadeWidth - Edge fade zone width
   * @param {boolean} previewMode - Unused (gradient is fast)
   */
  _renderDeepWaterStroke(ctx, textureType, x, y, radius, intensity, fadeWidth, previewMode = false) {
    // Deep water is just a dark gradient overlay - no texture
    // Darkest at center, fades to transparent at edges
    const centerAlpha = intensity * 0.85;  // Dark but not fully opaque
    const fadeStop = Math.max(0.1, 1 - (fadeWidth / radius));

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    // Dark blue-black at center
    gradient.addColorStop(0, `rgba(5, 15, 25, ${centerAlpha})`);
    // Gradual fade through the stroke
    gradient.addColorStop(fadeStop * 0.4, `rgba(10, 25, 40, ${centerAlpha * 0.7})`);
    gradient.addColorStop(fadeStop, `rgba(15, 35, 55, ${centerAlpha * 0.3})`);
    // Transparent at edge
    gradient.addColorStop(1, 'rgba(20, 45, 70, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  _renderBoundary(ctx) {
    const viewSettings = this._state.viewSettings;
    if (!viewSettings.showBoundary) return;

    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    // Draw boundary rectangle
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2 / this._state.viewport.zoom;
    ctx.strokeRect(0, 0, width, height);
  }

  _renderSelection(ctx) {
    const selection = this._state.selection;
    if (selection.length === 0) return;

    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3 / this._state.viewport.zoom;
    ctx.setLineDash([5 / this._state.viewport.zoom, 5 / this._state.viewport.zoom]);

    selection.forEach(stroke => {
      ctx.beginPath();
      ctx.arc(stroke.x, stroke.y, stroke.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(stroke.x, stroke.y, 5 / this._state.viewport.zoom, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.setLineDash([]);
  }

  _renderBrushPreview(ctx) {
    const { x, y, radius, color, outerRadius, outerColor, shape } = this._brushPreview;
    const zoom = this._state.viewport.zoom;
    const isSquare = shape === 'square';

    // Draw outer ring first (shore/floor extend) if specified
    if (outerRadius && outerRadius > radius) {
      // Outer fill
      ctx.fillStyle = outerColor || 'rgba(139, 90, 43, 0.2)';
      ctx.beginPath();
      if (isSquare) {
        ctx.rect(x - outerRadius, y - outerRadius, outerRadius * 2, outerRadius * 2);
      } else {
        ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
      }
      ctx.fill();

      // Outer outline (dashed)
      ctx.strokeStyle = 'rgba(180, 140, 80, 0.6)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      if (isSquare) {
        ctx.rect(x - outerRadius, y - outerRadius, outerRadius * 2, outerRadius * 2);
      } else {
        ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Main brush fill
    ctx.fillStyle = color || 'rgba(100, 200, 100, 0.3)';
    ctx.beginPath();
    if (isSquare) {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();

    // Main brush outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    if (isSquare) {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1 / zoom;
    const size = 5 / zoom;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
  }

  /**
   * Set brush preview with optional outer ring and shape
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} radius - Main brush radius
   * @param {string} color - Main brush color
   * @param {object} options - Optional: { outerRadius, outerColor, shape }
   */
  setBrushPreview(x, y, radius, color, options = {}) {
    this._brushPreview = {
      x, y, radius, color,
      outerRadius: options.outerRadius || null,
      outerColor: options.outerColor || null,
      shape: options.shape || 'circle'
    };
    // Lightweight UI-only update (no ground/feature re-render)
    this._requestUIRender();
  }

  clearBrushPreview() {
    this._brushPreview = null;
    this._requestUIRender();
  }

  /**
   * Set scatter preview items (shown semi-transparent on UI layer)
   * @param {object[]} items - Array of ScatterItem objects to preview
   */
  setScatterPreview(items) {
    this._scatterPreview = items;
    this._requestUIRender();
  }

  /**
   * Clear scatter preview
   */
  clearScatterPreview() {
    this._scatterPreview = null;
    this._requestUIRender();
  }

  /**
   * Set texture hover preview (shown during hover for water/ground texture)
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} radius - Brush radius
   * @param {string} textureType - Texture type (e.g., 'water', 'grass-1')
   * @param {object} options - Additional options (fadeWidth, intensity, isWater)
   */
  setTexturePreview(x, y, radius, textureType, options = {}) {
    this._textureHoverPreview = {
      x, y, radius, textureType,
      fadeWidth: options.fadeWidth ?? 12,
      intensity: options.intensity ?? 1.0,
      isWater: options.isWater ?? false,
      // Water-specific options
      waterOpacity: options.waterOpacity ?? 1.0,
      waterDepthFade: options.waterDepthFade ?? 0,
      waterDepth: options.waterDepth ?? 0.7,  // Deep water opacity
      // Shore options
      shoreType: options.shoreType || null,
      shoreWidth: options.shoreWidth || 0,
      shoreFadeWidth: options.shoreFadeWidth ?? options.fadeWidth ?? 12
    };
    this._requestUIRender();
  }

  /**
   * Clear texture hover preview
   */
  clearTexturePreview() {
    this._textureHoverPreview = null;
    this._requestUIRender();
  }

  /**
   * Request UI layer only render (for brush preview, selection, etc.)
   * Much cheaper than full render - doesn't touch ground cache or features
   */
  _requestUIRender() {
    this._needsUIRender = true;
  }

  /**
   * Public method to request UI render (for tools to call)
   * Triggers stroke count detection which will rebuild ground cache if needed
   */
  requestUIRender() {
    this._needsUIRender = true;
  }

  // ═══════════════════════════════════════════════════════════════
  // COORDINATE TRANSFORMS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Convert screen coordinates to canvas coordinates
   */
  screenToCanvas(screenX, screenY) {
    const viewport = this._state.viewport;
    const rect = this._canvases.ui.getBoundingClientRect();

    const x = (screenX - rect.left - viewport.x) / viewport.zoom;
    const y = (screenY - rect.top - viewport.y) / viewport.zoom;

    return { x, y };
  }

  /**
   * Convert canvas coordinates to screen coordinates
   */
  canvasToScreen(canvasX, canvasY) {
    const viewport = this._state.viewport;
    const rect = this._canvases.ui.getBoundingClientRect();

    const x = canvasX * viewport.zoom + viewport.x + rect.left;
    const y = canvasY * viewport.zoom + viewport.y + rect.top;

    return { x, y };
  }
}

/**
 * Create renderer instance
 */
export function createRenderer(state, containers) {
  return new Renderer(state, containers);
}
