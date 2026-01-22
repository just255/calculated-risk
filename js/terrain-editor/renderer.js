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
      trees: {}
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

    // Paint preview layer (for showing strokes during drag painting)
    this._paintPreview = null;
    this._paintPreviewStrokes = [];

    // Cached canopy layer (trees rendered once, reused until changed)
    this._canopyCache = null;
    this._canopyCacheValid = false;
    this._canopyCacheTreeCount = 0;

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
   */
  _renderPaintPreviewStroke(stroke) {
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

    // Render the stroke based on type (use preview mode for faster rendering)
    if (stroke.type === 'groundTexture') {
      this._renderGroundTextureStroke(ctx, stroke, true);
    } else if (stroke.type === 'water') {
      this._renderWaterStroke(ctx, stroke, true);
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

    // Create each layer
    ['ground', 'features', 'ui'].forEach((layer, index) => {
      const canvas = document.createElement('canvas');
      canvas.id = `terrain-${layer}`;
      canvas.width = width;
      canvas.height = height;
      canvas.style.position = index === 0 ? 'relative' : 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = layer === 'ui' ? 'auto' : 'none';

      container.appendChild(canvas);
      this._canvases[layer] = canvas;
      this._contexts[layer] = canvas.getContext('2d');
    });

    // Store viewport dimensions
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

    // Resize all canvases
    Object.values(this._canvases).forEach(canvas => {
      canvas.width = width;
      canvas.height = height;
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
    let spriteManifest = { trees: {}, ground: [] };
    try {
      const response = await fetch('/api/terrain/sprites');
      spriteManifest = await response.json();
    } catch (err) {
      console.warn('[Renderer] Could not fetch sprite manifest, using defaults:', err);
      spriteManifest = {
        trees: {},
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

    await Promise.all(promises);
    console.log('[Renderer] Images loaded:', {
      ground: Object.keys(this._images.ground).length,
      trees: Object.keys(this._images.trees).length
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
      img.onerror = () => resolve(); // Silently skip missing images
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

    // Clear all canvases and apply viewport transform
    Object.entries(this._contexts).forEach(([layer, ctx]) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Only fill background on ground layer (others stay transparent)
      if (layer === 'ground') {
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }

      ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y);
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
    // Use terrainMap.dirty flag to detect stroke changes (avoids per-stroke event overhead)
    if (!this._groundCacheValid || terrainMap.dirty) {
      this._rebuildGroundCache();
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

    // Draw ground texture strokes
    ensureRasterized(terrainMap);
    for (const stroke of terrainMap.strokes) {
      if (stroke.type === 'groundTexture') {
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
    console.log(`[Renderer] Ground cache rebuilt (${terrainMap.strokes.length} strokes)`);
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
        'water': '#1e5a8c'
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
    const gradient = tempCtx.createRadialGradient(
      scaledRadius, scaledRadius, scaledRadius - scaledFadeWidth,
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

  _renderFeatures() {
    const ctx = this._contexts.features;
    const terrainMap = this._state.terrainMap;

    // Check if we need to rebuild the canopy cache
    // Use terrainMap.trees length change as a proxy for tree changes during painting
    const treeCount = terrainMap.trees?.length || 0;
    if (!this._canopyCacheValid || this._canopyCacheTreeCount !== treeCount) {
      this._rebuildCanopyCache();
    }

    // Draw cached canopy layer
    if (this._canopyCache) {
      ctx.drawImage(this._canopyCache, 0, 0);
    }
  }

  _rebuildCanopyCache() {
    const terrainMap = this._state.terrainMap;
    ensureRasterized(terrainMap);
    this._canopyCache = renderCanopyLayer(terrainMap, this._state.cellSize, this._images.trees);
    this._canopyCacheValid = true;
    this._canopyCacheTreeCount = terrainMap.trees?.length || 0;
    console.log(`[Renderer] Canopy cache rebuilt (${this._canopyCacheTreeCount} trees)`);
  }

  /**
   * Lightweight render - redraws ground from cache + preview, features, and UI
   * Skips expensive ground cache rebuild
   */
  _renderUIOnly() {
    const viewport = this._state.viewport;

    // Redraw ground from cache + preview (no rebuild)
    const groundCtx = this._contexts.ground;
    groundCtx.setTransform(1, 0, 0, 1, 0, 0);
    groundCtx.clearRect(0, 0, groundCtx.canvas.width, groundCtx.canvas.height);
    groundCtx.fillStyle = '#0d0d1a';
    groundCtx.fillRect(0, 0, groundCtx.canvas.width, groundCtx.canvas.height);
    groundCtx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y);

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
    featuresCtx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y);
    this._renderFeatures();
    // Restore dirty flag so ground cache rebuilds on mouse-up
    if (wasDirty) this._state.terrainMap.dirty = true;

    // Redraw UI
    const uiCtx = this._contexts.ui;
    uiCtx.setTransform(1, 0, 0, 1, 0, 0);
    uiCtx.clearRect(0, 0, uiCtx.canvas.width, uiCtx.canvas.height);
    uiCtx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y);

    this._renderUI();
  }

  _renderUI() {
    const ctx = this._contexts.ui;

    // Render map boundary
    this._renderBoundary(ctx);

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
    const { x, y, radius, color } = this._brushPreview;

    // Fill
    ctx.fillStyle = color || 'rgba(100, 200, 100, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2 / this._state.viewport.zoom;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1 / this._state.viewport.zoom;
    const size = 5 / this._state.viewport.zoom;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
  }

  setBrushPreview(x, y, radius, color) {
    this._brushPreview = { x, y, radius, color };
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
