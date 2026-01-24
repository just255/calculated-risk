// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Renderer
// Multi-layer canvas rendering with viewport transforms
// ═══════════════════════════════════════════════════════════════

import { Events } from './events.js';
import { renderCanopyLayer, renderBaseLayer, ensureRasterized } from '../world-builder/index.js';

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
      brush: {}
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
    this._groundCacheStrokeCount = 0;
    this._groundCacheTreeCount = 0;

    // Paint preview layer (for showing strokes during drag painting)
    this._paintPreview = null;
    this._paintPreviewStrokes = [];

    // Cached canopy layer (trees/brush rendered once, reused until changed)
    this._canopyCache = null;
    this._canopyCacheValid = false;
    this._canopyCacheTreeCount = 0;
    this._canopyCacheBrushCount = 0;
    this._canopyCacheParticleCount = 0;

    this._init();
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
   */
  addToPaintPreview(stroke) {
    this._paintPreviewStrokes.push(stroke);
    this._renderPaintPreviewStroke(stroke);
    this._requestUIRender();  // Lightweight update to show preview
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
   * Render a single stroke to the paint preview canvas
   * Note: Water and forest strokes render via cache rebuild (stroke/tree count detection).
   * Only groundTexture strokes use the preview canvas.
   */
  _renderPaintPreviewStroke(stroke) {
    // Water renders via ground cache (stroke count detection triggers rebuild)
    // Only groundTexture uses the paint preview canvas
    if (stroke.type !== 'groundTexture') {
      return;
    }

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

    this._renderGroundTextureStroke(ctx, stroke, true);
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
      // Invalidate caches that were rendered at old DPR
      this._invalidateCanopyCache();
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

  // ═══════════════════════════════════════════════════════════════
  // IMAGE LOADING
  // ═══════════════════════════════════════════════════════════════

  async loadImages() {
    // Fetch available sprites from server
    let spriteManifest = { trees: {}, brush: {}, ground: [] };
    try {
      const response = await fetch('/api/terrain/sprites');
      spriteManifest = await response.json();
    } catch (err) {
      console.warn('[Renderer] Could not fetch sprite manifest, using defaults:', err);
      spriteManifest = {
        trees: {},
        brush: {},
        ground: ['grass', 'open', 'water']
      };
    }

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

    // Tree sprites - only load what exists
    for (const [key, path] of Object.entries(spriteManifest.trees)) {
      promises.push(this._loadImage(key, path, this._images.trees));
    }

    // Brush sprites - only load what exists
    console.log('[Renderer] Brush sprites from API:', spriteManifest.brush);
    for (const [key, path] of Object.entries(spriteManifest.brush || {})) {
      promises.push(this._loadImage(key, path, this._images.brush));
    }

    await Promise.all(promises);
    console.log('[Renderer] Images loaded:', {
      ground: Object.keys(this._images.ground).length,
      trees: Object.keys(this._images.trees).length,
      brush: Object.keys(this._images.brush).length
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
    const width = this._state.canvasWidth;
    const height = this._state.canvasHeight;

    // Check if we need to rebuild the ground cache
    // Rebuild when strokes or trees change (trees affect forest floor layer)
    const strokeCount = terrainMap.strokes?.length || 0;
    const treeCount = terrainMap.trees?.length || 0;
    if (!this._groundCacheValid || terrainMap.dirty ||
        this._groundCacheStrokeCount !== strokeCount ||
        this._groundCacheTreeCount !== treeCount) {
      this._rebuildGroundCache();
      this._groundCacheStrokeCount = strokeCount;
      this._groundCacheTreeCount = treeCount;
      terrainMap.dirty = false;  // Reset dirty flag after rebuild
    }

    // Draw cached ground layer
    if (this._groundCache) {
      ctx.drawImage(this._groundCache, 0, 0);
    }

    // Draw paint preview layer (strokes being painted, not yet in cache)
    if (this._paintPreview && this._paintPreviewStrokes.length > 0) {
      ctx.drawImage(this._paintPreview, 0, 0);
    }

    // Draw grid (on top, not cached)
    this._renderGrid(ctx);
  }

  /**
   * Rebuild the cached ground layer with all strokes
   */
  _rebuildGroundCache() {
    const terrainMap = this._state.terrainMap;
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
        this._renderGroundTextureStroke(cacheCtx, stroke);
      }
    }

    // Draw tree-based forest floor (radiating from each tree)
    this._renderTreeBasedGroundLayer(cacheCtx);

    // Draw shore strokes (on top of regular ground textures, under water)
    for (const stroke of terrainMap.strokes) {
      if (stroke.type === 'groundTexture' && stroke.isShore) {
        this._renderGroundTextureStroke(cacheCtx, stroke);
      }
    }

    // Draw water strokes
    for (const stroke of terrainMap.strokes) {
      if (stroke.type === 'water') {
        this._renderWaterStroke(cacheCtx, stroke);
      }
    }

    this._groundCacheValid = true;
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
        'water-marsh': '#2a3a2a'
      };
      ctx.fillStyle = fallbackColors[textureType] || '#4a4a3a';
      ctx.globalAlpha = intensity;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // Use 2x for preview (faster), 4x for final render (crisp)
    // Also reduce for very large strokes
    let scale = previewMode ? 2 : 4;
    if (radius > 200) scale = Math.min(scale, 2);
    if (radius > 400) scale = 1;
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
   * Render tree-based ground layer
   * Each tree creates a circular forest-floor texture radiating outward
   * @param {CanvasRenderingContext2D} ctx - Target canvas context
   */
  _renderTreeBasedGroundLayer(ctx) {
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
      // A ring with inner radius 0 is just a filled circle
      this._renderTextureRing(
        ctx,
        'forest-floor',
        tree.x,
        tree.y,
        0,  // Start from center
        floorRadius,
        intensity,
        floorFadePercent
      );
    }
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
   */
  _renderTextureRing(ctx, textureType, x, y, innerRadius, outerRadius, intensity, fadePercent = 100) {
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

    const scale = 2; // Resolution scale
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

    // Apply ring mask with gradient
    // fadePercent controls how much of the ring fades vs stays solid
    // 100% = entire ring fades, 50% = inner half solid + outer half fades, 0% = hard edge
    tempCtx.globalCompositeOperation = 'destination-in';

    const ringWidth = scaledOuter - scaledInner;
    const solidPortion = 1 - (fadePercent / 100);
    const fadeStartRadius = scaledInner + (ringWidth * solidPortion);

    const gradient = tempCtx.createRadialGradient(
      scaledOuter, scaledOuter, fadeStartRadius,
      scaledOuter, scaledOuter, scaledOuter
    );
    gradient.addColorStop(0, 'rgba(0,0,0,1)');  // Full opacity at fade start
    gradient.addColorStop(1, 'rgba(0,0,0,0)');  // Transparent at outer edge

    // If there's a solid portion, fill it first
    if (solidPortion > 0.01) {
      tempCtx.fillStyle = 'rgba(0,0,0,1)';
      tempCtx.beginPath();
      tempCtx.arc(scaledOuter, scaledOuter, fadeStartRadius, 0, Math.PI * 2);
      tempCtx.arc(scaledOuter, scaledOuter, scaledInner, 0, Math.PI * 2, true);
      tempCtx.fill();
    }

    // Apply the gradient fade
    tempCtx.fillStyle = gradient;
    tempCtx.fillRect(0, 0, size, size);

    // Draw to main canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = intensity;
    ctx.drawImage(tempCanvas, 0, 0, size, size, x - outerRadius, y - outerRadius, outerRadius * 2, outerRadius * 2);
    ctx.restore();
  }

  _renderGroundTextureStroke(ctx, stroke, previewMode = false) {
    const { x, y, radius, intensity, textureType, fadeWidth } = stroke;
    this._renderTextureStroke(ctx, textureType, x, y, radius, intensity, fadeWidth ?? 12, previewMode);
  }

  _renderWaterStroke(ctx, stroke, previewMode = false) {
    const { x, y, radius, intensity, fadeWidth, textureType } = stroke;
    this._renderTextureStroke(ctx, textureType || 'water', x, y, radius, intensity, fadeWidth ?? 12, previewMode);
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
    // Use terrainMap.trees, brushes, and particles length change as a proxy for changes during painting
    const treeCount = terrainMap.trees?.length || 0;
    const brushCount = terrainMap.brushes?.length || 0;
    const particleCount = terrainMap.particles?.length || 0;
    if (!this._canopyCacheValid || this._canopyCacheTreeCount !== treeCount || this._canopyCacheBrushCount !== brushCount || this._canopyCacheParticleCount !== particleCount) {
      this._rebuildCanopyCache();
    }

    // Draw cached canopy layer
    // Cache is at DPR-scaled resolution, draw at map size (transform handles scaling)
    if (this._canopyCache) {
      const width = this._state.canvasWidth;
      const height = this._state.canvasHeight;
      ctx.drawImage(this._canopyCache, 0, 0, width, height);
    }
  }

  _rebuildCanopyCache() {
    const terrainMap = this._state.terrainMap;
    const dpr = this._dpr || 1;
    ensureRasterized(terrainMap);
    // Pass DPR for high-resolution rendering on high-DPI displays
    // Pass tree, brush, and particle images for rendering
    // Particles use brush images folder, so pass brush images as particleImages too
    this._canopyCache = renderCanopyLayer(terrainMap, this._state.cellSize, this._images.trees, dpr, this._images.brush, this._images.brush);
    this._canopyCacheValid = true;
    this._canopyCacheTreeCount = terrainMap.trees?.length || 0;
    this._canopyCacheBrushCount = terrainMap.brushes?.length || 0;
    this._canopyCacheParticleCount = terrainMap.particles?.length || 0;
    console.log(`[Renderer] Canopy cache rebuilt (${this._canopyCacheTreeCount} trees, ${this._canopyCacheBrushCount} brush, ${this._canopyCacheParticleCount} particles, dpr=${dpr})`);
  }

  /**
   * Lightweight render - redraws ground, features, and UI
   * Rebuilds caches if stroke/tree counts changed (for live preview during painting)
   */
  _renderUIOnly() {
    const viewport = this._state.viewport;
    const dpr = this._dpr || 1;
    const terrainMap = this._state.terrainMap;

    // Check if ground cache needs rebuild (stroke or tree count changed during painting)
    const strokeCount = terrainMap.strokes?.length || 0;
    const treeCount = terrainMap.trees?.length || 0;
    if (!this._groundCacheValid ||
        this._groundCacheStrokeCount !== strokeCount ||
        this._groundCacheTreeCount !== treeCount) {
      this._rebuildGroundCache();
      this._groundCacheStrokeCount = strokeCount;
      this._groundCacheTreeCount = treeCount;
    }

    // Redraw ground from cache + preview
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
    if (this._paintPreview && this._paintPreviewStrokes.length > 0) {
      groundCtx.drawImage(this._paintPreview, 0, 0);
    }
    this._renderGrid(groundCtx);

    // Redraw features (trees) - this uses pre-generated tree data, not expensive
    // Preserve dirty flag since ensureRasterized() clears it
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
    // Restore dirty flag so ground cache rebuilds on mouse-up
    if (wasDirty) this._state.terrainMap.dirty = true;

    // Redraw UI
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

    // Render selection highlights
    this._renderSelection(ctx);

    // Render brush preview (set by tool)
    if (this._brushPreview) {
      this._renderBrushPreview(ctx);
    }
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
