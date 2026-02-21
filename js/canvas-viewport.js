// ═══════════════════════════════════════════════════════════════
// CANVAS VIEWPORT - Shared multi-layer canvas system with viewport transforms
// Used by BattleRenderer (game) and potentially the terrain editor
// Extracted from patterns in terrain-editor/renderer.js
// ═══════════════════════════════════════════════════════════════

/**
 * Multi-layer canvas system with pan/zoom viewport and DPR handling.
 * Creates N stacked canvases in a container element, manages their
 * lifecycle, and provides coordinate transforms between screen and world space.
 */
export class CanvasViewport {
  /**
   * @param {HTMLElement} container - DOM element to hold the canvases
   * @param {string[]} layerNames - Names for each canvas layer, bottom to top
   */
  constructor(container, layerNames = ['ground', 'features', 'ui']) {
    this._container = container;
    this._layerNames = layerNames;
    this._canvases = {};
    this._contexts = {};
    this._dpr = window.devicePixelRatio || 1;
    this._viewportWidth = 0;
    this._viewportHeight = 0;

    // Viewport state
    this._viewport = { x: 0, y: 0, zoom: 1 };

    // Render loop
    this._frameRequest = null;
    this._needsRender = true;
    this._renderCallback = null;

    // Bound resize handler
    this._resizeHandler = () => this._handleResize();
  }

  // ═══════════════════════════════════════════════════════════════
  // CANVAS LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create all canvas layers and attach to container.
   * Bottom layer is position:relative (establishes stacking context),
   * others are position:absolute stacked on top.
   * Only the topmost layer receives pointer events.
   */
  createCanvases() {
    this._container.innerHTML = '';

    const rect = this._container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    this._dpr = window.devicePixelRatio || 1;

    this._layerNames.forEach((layer, index) => {
      const canvas = document.createElement('canvas');
      canvas.id = `cv-${layer}`;
      canvas.width = width * this._dpr;
      canvas.height = height * this._dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.position = index === 0 ? 'relative' : 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      // Only topmost layer receives pointer events
      canvas.style.pointerEvents = index === this._layerNames.length - 1 ? 'auto' : 'none';

      this._container.appendChild(canvas);
      this._canvases[layer] = canvas;

      const ctx = canvas.getContext('2d');
      ctx.scale(this._dpr, this._dpr);
      this._contexts[layer] = ctx;
    });

    this._viewportWidth = width;
    this._viewportHeight = height;

    window.addEventListener('resize', this._resizeHandler);
  }

  /**
   * Handle container/window resize — re-sizes all canvases and re-applies DPR.
   */
  _handleResize() {
    const rect = this._container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    this._dpr = window.devicePixelRatio || 1;

    for (const layer of this._layerNames) {
      const canvas = this._canvases[layer];
      if (!canvas) continue;
      canvas.width = width * this._dpr;
      canvas.height = height * this._dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      this._contexts[layer].scale(this._dpr, this._dpr);
    }

    this._viewportWidth = width;
    this._viewportHeight = height;
    this.requestRender();
  }

  handleResize() {
    this._handleResize();
  }

  /**
   * Clean up: remove resize listener, stop render loop, clear DOM.
   */
  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resizeHandler);
    this._container.innerHTML = '';
    this._canvases = {};
    this._contexts = {};
    this._renderCallback = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEWPORT STATE
  // ═══════════════════════════════════════════════════════════════

  setViewport(x, y, zoom) {
    this._viewport.x = x;
    this._viewport.y = y;
    this._viewport.zoom = zoom;
  }

  get viewport() { return this._viewport; }
  get dpr() { return this._dpr; }
  get screenWidth() { return this._viewportWidth; }
  get screenHeight() { return this._viewportHeight; }

  getCanvas(layer) { return this._canvases[layer] || null; }
  getContext(layer) { return this._contexts[layer] || null; }

  /** Returns the topmost canvas (for event attachment). */
  get topCanvas() {
    return this._canvases[this._layerNames[this._layerNames.length - 1]] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // TRANSFORMS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Apply the viewport transform (DPR + zoom + pan) to a single context.
   */
  applyViewportTransform(ctx) {
    const { x, y, zoom } = this._viewport;
    const dpr = this._dpr;
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, x * dpr, y * dpr);
  }

  /**
   * Clear all canvases, reset transforms, optionally fill background, then apply viewport.
   * @param {string} [bgColor] - Background fill color for bottom layer (null = transparent)
   */
  clearAndTransformAll(bgColor = null) {
    const { x, y, zoom } = this._viewport;
    const dpr = this._dpr;

    for (let i = 0; i < this._layerNames.length; i++) {
      const layer = this._layerNames[i];
      const ctx = this._contexts[layer];
      if (!ctx) continue;

      // Reset to identity and clear
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.imageSmoothingEnabled = false;

      // Fill background on bottom layer
      if (i === 0 && bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }

      // Apply viewport transform
      ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, x * dpr, y * dpr);
    }
  }

  /**
   * Convert screen coordinates (CSS pixels relative to container) to world coordinates.
   */
  screenToWorld(screenX, screenY) {
    const { x, y, zoom } = this._viewport;
    return {
      x: (screenX - x) / zoom,
      y: (screenY - y) / zoom
    };
  }

  /**
   * Convert world coordinates to screen coordinates (CSS pixels relative to container).
   */
  worldToScreen(worldX, worldY) {
    const { x, y, zoom } = this._viewport;
    return {
      x: worldX * zoom + x,
      y: worldY * zoom + y
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER LOOP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the RAF render loop. Calls callback when dirty.
   * @param {Function} callback - Called each frame when rendering is needed
   */
  startRenderLoop(callback) {
    this._renderCallback = callback;
    this._needsRender = true;

    const loop = () => {
      if (this._needsRender && this._renderCallback) {
        this._renderCallback();
        this._needsRender = false;
      }
      this._frameRequest = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Mark as needing a re-render on next frame. */
  requestRender() {
    this._needsRender = true;
  }

  /** Stop the render loop. */
  stop() {
    if (this._frameRequest) {
      cancelAnimationFrame(this._frameRequest);
      this._frameRequest = null;
    }
  }
}
