// ═══════════════════════════════════════════════════════════════
// GROUND RENDERER - Standalone ground texture + water rendering
// Extracted from terrain-editor/renderer.js patterns as pure functions.
// Used by battle-terrain.js to render PCG terrain for game battles.
// ═══════════════════════════════════════════════════════════════

import { renderScatterLayer } from './scatter-renderer.js';

// Ground texture scale (1 = native 256px, 0.25 = 64px tiles = matches cell size)
const GROUND_TEXTURE_SCALE = 0.25;

// Reusable temp canvases (module-level singletons, resized as needed)
let _tempCanvas = null;
let _tempCtx = null;
let _tempCanvasSize = 0;

let _noiseCanvas = null;
let _noiseCtx = null;
let _noiseCanvasSize = 0;

let _waterMaskCanvas = null;
let _waterBlurCanvas = null;
let _waterTexCanvas = null;

let _depthGradientCache = null;
let _depthGradientIntensity = -1;
let _depthGradientFalloff = -1;
let _depthTempCanvas = null;

// Fallback colors when texture images aren't available
const FALLBACK_COLORS = {
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
  'floor-oak': '#5a4a35',
  'floor-pine': '#5a3530',
  'floor-birch': '#6a6550',
  'floor-damp': '#3a3025',
  'floor-bare': '#4a4035',
  'floor-mixed': '#5a4a3a'
};

// ═══════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════

/**
 * Render the complete ground layer for a battle terrain.
 * Pipeline: base tile → ground texture strokes → scatter (ground + particle) →
 *           shore strokes → water (unified mask) → water depth
 *
 * @param {object} terrainMap - TerrainMap with strokes, scatterItems, baseLayer, etc.
 * @param {number} width - Canvas width in pixels
 * @param {number} height - Canvas height in pixels
 * @param {object} images - { ground: {type→img}, trees, brush, floor, particles, boulders }
 * @returns {HTMLCanvasElement} - Rendered ground canvas
 */
export function renderGroundLayer(terrainMap, width, height, images) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1) Tile base layer texture across entire canvas
  const groundImg = images.ground?.[terrainMap.baseLayer];
  if (groundImg) {
    const tileSize = 256 * GROUND_TEXTURE_SCALE;
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        ctx.drawImage(groundImg, x, y, tileSize, tileSize);
      }
    }
  } else {
    ctx.fillStyle = '#4a6a3a';
    ctx.fillRect(0, 0, width, height);
  }

  // 2) Render ground texture strokes (excluding shore)
  for (const stroke of terrainMap.strokes) {
    if (stroke.type === 'groundTexture' && !stroke.isShore) {
      renderGroundTextureStroke(ctx, stroke, images);
    }
  }

  // 3) Render ground scatter items (floor patches, particles)
  const scatterImages = {
    tree: images.trees,
    brush: { ...images.brush },
    boulder: images.boulders,
    floor: images.floor,
    particle: { ...images.brush, ...images.particles }
  };
  const viewport = { x: 0, y: 0, width, height };
  renderScatterLayer(ctx, terrainMap, 'ground', viewport, scatterImages, { skipFilters: true, skipAnimation: true });
  renderScatterLayer(ctx, terrainMap, 'particle', viewport, scatterImages, { skipFilters: true, skipAnimation: true });

  // 4) Render water layer (shore → water mask → depth) on top
  renderWaterLayer(ctx, terrainMap, width, height, images);

  return canvas;
}

// ═══════════════════════════════════════════════════════════════
// GROUND TEXTURE STROKES
// ═══════════════════════════════════════════════════════════════

/**
 * Render a ground texture stroke (multi-center wrapper).
 * Each stroke may have multiple centers for brush-painted strokes.
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas context
 * @param {object} stroke - Stroke with { radius, intensity, textureType, fadeWidth, centers, noiseAlpha, seed, x, y }
 * @param {object} images - Image collections (needs images.ground)
 */
export function renderGroundTextureStroke(ctx, stroke, images) {
  const { radius, intensity, textureType, fadeWidth, centers, noiseAlpha, seed } = stroke;
  const fade = fadeWidth ?? 12;
  const noiseOpts = noiseAlpha ? { seed: seed || 0 } : null;

  if (centers && centers.length > 0) {
    for (const center of centers) {
      renderTextureStroke(ctx, textureType, center.x, center.y, radius, intensity, fade, images, noiseOpts);
    }
  } else {
    renderTextureStroke(ctx, textureType, stroke.x, stroke.y, radius, intensity, fade, images, noiseOpts);
  }
}

/**
 * Render a single textured circle: tile texture image, mask with radial gradient,
 * optionally apply noise for organic patches.
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas context
 * @param {string} textureType - Key into images.ground (e.g. 'dirt', 'forest-floor')
 * @param {number} x - Center X in world pixels
 * @param {number} y - Center Y in world pixels
 * @param {number} radius - Circle radius
 * @param {number} intensity - Opacity (0-1)
 * @param {number} fadeWidth - Soft edge width in pixels
 * @param {object} images - Image collections (needs images.ground)
 * @param {object|null} noiseOpts - { seed } for patchy noise, or null
 */
export function renderTextureStroke(ctx, textureType, x, y, radius, intensity, fadeWidth, images, noiseOpts) {
  const textureImg = images.ground?.[textureType];

  if (!textureImg) {
    // Fallback: draw colored circle if texture not loaded
    ctx.fillStyle = FALLBACK_COLORS[textureType] || '#4a4a3a';
    ctx.globalAlpha = intensity;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // For battle rendering we use scale=1 (no LOD needed — one-time render)
  const scale = 1;
  const tileSize = 256 * GROUND_TEXTURE_SCALE * scale;
  const scaledRadius = radius * scale;
  const scaledFadeWidth = fadeWidth * scale;

  // Reuse temp canvas (resize only if needed)
  const size = Math.ceil(scaledRadius * 2) + 2;
  if (!_tempCanvas || _tempCanvasSize < size) {
    _tempCanvas = document.createElement('canvas');
    _tempCanvas.width = size;
    _tempCanvas.height = size;
    _tempCtx = _tempCanvas.getContext('2d');
    _tempCanvasSize = size;
  }

  // Clear and configure
  _tempCtx.setTransform(1, 0, 0, 1, 0, 0);
  _tempCtx.clearRect(0, 0, _tempCanvas.width, _tempCanvas.height);
  _tempCtx.globalCompositeOperation = 'source-over';
  _tempCtx.imageSmoothingEnabled = false;

  // Tile texture
  const startX = (x - radius) * scale;
  const startY = (y - radius) * scale;
  const offsetX = ((startX % tileSize) + tileSize) % tileSize;
  const offsetY = ((startY % tileSize) + tileSize) % tileSize;

  for (let ty = -offsetY; ty < size; ty += tileSize) {
    for (let tx = -offsetX; tx < size; tx += tileSize) {
      _tempCtx.drawImage(textureImg, tx, ty, tileSize, tileSize);
    }
  }

  // Apply circular alpha mask with soft edges
  _tempCtx.globalCompositeOperation = 'destination-in';
  const innerRadius = Math.max(0, scaledRadius - scaledFadeWidth);
  const gradient = _tempCtx.createRadialGradient(
    scaledRadius, scaledRadius, innerRadius,
    scaledRadius, scaledRadius, scaledRadius
  );
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  _tempCtx.fillStyle = gradient;
  _tempCtx.fillRect(0, 0, size, size);

  // Noise alpha: break up the circular shape with patchy blobs
  if (noiseOpts) {
    applyNoiseAlpha(_tempCtx, size, scaledRadius, noiseOpts.seed);
  }

  // Draw to main canvas
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = intensity;
  ctx.drawImage(_tempCanvas, 0, 0, size, size, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * Apply patchy noise to break up circular ground textures.
 * Draws overlapping blobs as a destination-in mask so the texture
 * looks like irregular patches instead of a perfect circle.
 *
 * @param {CanvasRenderingContext2D} ctx - The temp canvas context (after radial gradient mask)
 * @param {number} size - Canvas size in pixels
 * @param {number} scaledRadius - Stroke radius at current scale
 * @param {number} seed - Deterministic seed for noise pattern
 */
export function applyNoiseAlpha(ctx, size, scaledRadius, seed) {
  // Simple LCG for deterministic per-stroke noise
  let s = (seed * 2654435761) >>> 0;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

  // Get or create noise canvas
  if (!_noiseCanvas || _noiseCanvasSize < size) {
    _noiseCanvas = document.createElement('canvas');
    _noiseCanvas.width = size;
    _noiseCanvas.height = size;
    _noiseCtx = _noiseCanvas.getContext('2d');
    _noiseCanvasSize = size;
  }
  _noiseCtx.setTransform(1, 0, 0, 1, 0, 0);
  _noiseCtx.clearRect(0, 0, _noiseCanvas.width, _noiseCanvas.height);

  // Base: moderate fill so texture is visible everywhere, just patchy
  _noiseCtx.fillStyle = 'rgba(255,255,255,0.45)';
  _noiseCtx.fillRect(0, 0, size, size);

  // Overlapping blobs of varying brightness create patchy pattern
  const blobCount = 5 + Math.floor(rand() * 5);
  for (let i = 0; i < blobCount; i++) {
    const bx = rand() * size;
    const by = rand() * size;
    const br = scaledRadius * (0.25 + rand() * 0.45);
    const alpha = 0.6 + rand() * 0.4;

    const grad = _noiseCtx.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.6})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    _noiseCtx.fillStyle = grad;
    _noiseCtx.fillRect(bx - br, by - br, br * 2, br * 2);
  }

  // Apply noise as alpha modulation
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(_noiseCanvas, 0, 0, size, size, 0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
}

// ═══════════════════════════════════════════════════════════════
// WATER RENDERING
// ═══════════════════════════════════════════════════════════════

/**
 * Render the complete water layer: shore strokes → water unified mask → depth gradients.
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas context (ground canvas)
 * @param {object} terrainMap - TerrainMap with strokes
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {object} images - Image collections (needs images.ground for water textures)
 */
export function renderWaterLayer(ctx, terrainMap, width, height, images) {
  const waterStrokes = terrainMap.strokes.filter(s => s.type === 'water');
  if (waterStrokes.length === 0) return;

  // Sort: regular water first, deep water last
  waterStrokes.sort((a, b) => {
    const aDeep = (a.textureType || '').includes('deep') ? 1 : 0;
    const bDeep = (b.textureType || '').includes('deep') ? 1 : 0;
    return aDeep - bDeep;
  });

  // Shore strokes (under water, reduced opacity)
  const shoreStrokes = terrainMap.strokes.filter(s => s.type === 'groundTexture' && s.isShore);
  if (shoreStrokes.length > 0) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (const stroke of shoreStrokes) {
      renderGroundTextureStroke(ctx, stroke, images);
    }
    ctx.restore();

    // Erase shore pixels where water exists
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const water of waterStrokes) {
      const { radius, fadeWidth } = water;
      const centers = water.centers;
      const innerRadius = Math.max(0, radius - (fadeWidth || 12));

      const drawErase = (cx, cy) => {
        const gradient = ctx.createRadialGradient(cx, cy, innerRadius * 0.8, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      };

      if (centers && centers.length > 0) {
        for (const c of centers) drawErase(c.x, c.y);
      } else {
        drawErase(water.x, water.y);
      }
    }
    ctx.restore();
  }

  // Water unified mask: solid circles → blur → clip tiled texture
  renderWaterUnifiedMask(ctx, waterStrokes, width, height, images);

  // Water depth gradients
  const depthStrokes = terrainMap.strokes.filter(s => s.type === 'waterDepth');
  if (depthStrokes.length > 0) {
    const intensity = depthStrokes[0].intensity || 0.5;
    const depthFade = depthStrokes[0].depthFalloff ?? 0.5;
    renderDepthGradients(ctx, depthStrokes, intensity, depthFade, width, height);
  }
}

/**
 * Render water using a unified mask approach.
 * 1) Draw solid white circles to mask canvas
 * 2) Blur the mask for uniform soft edges
 * 3) Tile water texture on a separate canvas
 * 4) Clip texture with blurred mask
 * 5) Draw result onto target
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas context
 * @param {object[]} waterStrokes - Array of water stroke objects
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {object} images - Image collections (needs images.ground for water textures)
 */
export function renderWaterUnifiedMask(ctx, waterStrokes, width, height, images) {
  if (waterStrokes.length === 0) return;

  // Average fadeWidth for blur radius
  let totalFade = 0;
  for (const s of waterStrokes) totalFade += (s.fadeWidth ?? 12);
  const blurRadius = Math.max(4, Math.round(totalFade / waterStrokes.length));

  // 1) Build solid union mask
  if (!_waterMaskCanvas || _waterMaskCanvas.width !== width || _waterMaskCanvas.height !== height) {
    _waterMaskCanvas = document.createElement('canvas');
    _waterMaskCanvas.width = width;
    _waterMaskCanvas.height = height;
  }
  const maskCtx = _waterMaskCanvas.getContext('2d');
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.fillStyle = '#fff';

  for (const stroke of waterStrokes) {
    const centers = stroke.centers;
    if (centers && centers.length > 0) {
      for (const c of centers) {
        maskCtx.beginPath();
        maskCtx.arc(c.x, c.y, stroke.radius, 0, Math.PI * 2);
        maskCtx.fill();
      }
    } else {
      maskCtx.beginPath();
      maskCtx.arc(stroke.x, stroke.y, stroke.radius, 0, Math.PI * 2);
      maskCtx.fill();
    }
  }

  // 2) Blur the mask for uniform soft edges
  if (!_waterBlurCanvas || _waterBlurCanvas.width !== width || _waterBlurCanvas.height !== height) {
    _waterBlurCanvas = document.createElement('canvas');
    _waterBlurCanvas.width = width;
    _waterBlurCanvas.height = height;
  }
  const blurCtx = _waterBlurCanvas.getContext('2d');
  blurCtx.clearRect(0, 0, width, height);
  blurCtx.filter = `blur(${blurRadius}px)`;
  blurCtx.drawImage(_waterMaskCanvas, 0, 0);
  blurCtx.filter = 'none';

  // 3) Tile water texture
  if (!_waterTexCanvas || _waterTexCanvas.width !== width || _waterTexCanvas.height !== height) {
    _waterTexCanvas = document.createElement('canvas');
    _waterTexCanvas.width = width;
    _waterTexCanvas.height = height;
  }
  const texCtx = _waterTexCanvas.getContext('2d');
  texCtx.clearRect(0, 0, width, height);

  const waterType = waterStrokes[0].textureType || 'water';
  const textureImg = images.ground?.[waterType];

  if (textureImg) {
    const tileSize = 256 * GROUND_TEXTURE_SCALE;
    texCtx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < height; ty += tileSize) {
      for (let tx = 0; tx < width; tx += tileSize) {
        texCtx.drawImage(textureImg, tx, ty, tileSize, tileSize);
      }
    }
  } else {
    texCtx.fillStyle = '#1e5a8c';
    texCtx.fillRect(0, 0, width, height);
  }

  // 4) Clip texture with blurred mask
  texCtx.globalCompositeOperation = 'destination-in';
  texCtx.drawImage(_waterBlurCanvas, 0, 0);
  texCtx.globalCompositeOperation = 'source-over';

  // 5) Draw masked texture onto target
  ctx.drawImage(_waterTexCanvas, 0, 0);
}

// ═══════════════════════════════════════════════════════════════
// WATER DEPTH
// ═══════════════════════════════════════════════════════════════

/**
 * Render water depth gradients onto the target canvas using 'darken' compositing.
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas context
 * @param {object[]} depthStrokes - Array of waterDepth stroke objects
 * @param {number} intensity - Depth opacity (0-1)
 * @param {number} depthFade - Falloff strength (0-1)
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function renderDepthGradients(ctx, depthStrokes, intensity, depthFade, width, height) {
  // Get or create depth gradient stamp
  const gradientStamp = getDepthGradientCache(intensity, depthFade);

  // Merge all depth strokes to a temp canvas first
  if (!_depthTempCanvas || _depthTempCanvas.width !== width || _depthTempCanvas.height !== height) {
    _depthTempCanvas = document.createElement('canvas');
    _depthTempCanvas.width = width;
    _depthTempCanvas.height = height;
  }
  const tempCtx = _depthTempCanvas.getContext('2d');
  tempCtx.clearRect(0, 0, width, height);

  for (const stroke of depthStrokes) {
    const { radius, centers } = stroke;
    const size = radius * 2;

    if (centers && centers.length > 0) {
      for (const center of centers) {
        tempCtx.drawImage(gradientStamp, center.x - radius, center.y - radius, size, size);
      }
    } else {
      tempCtx.drawImage(gradientStamp, stroke.x - radius, stroke.y - radius, size, size);
    }
  }

  // Composite merged result onto target with darken
  ctx.save();
  ctx.globalCompositeOperation = 'darken';
  ctx.drawImage(_depthTempCanvas, 0, 0);
  ctx.restore();
}

/**
 * Get or create a cached depth gradient stamp (128x128 reusable).
 */
function getDepthGradientCache(intensity, falloff) {
  const CACHE_SIZE = 128;

  if (_depthGradientCache &&
      _depthGradientIntensity === intensity &&
      _depthGradientFalloff === falloff) {
    return _depthGradientCache;
  }

  if (!_depthGradientCache) {
    _depthGradientCache = document.createElement('canvas');
    _depthGradientCache.width = CACHE_SIZE;
    _depthGradientCache.height = CACHE_SIZE;
  }

  const cacheCtx = _depthGradientCache.getContext('2d');
  const center = CACHE_SIZE / 2;
  const radius = CACHE_SIZE / 2;

  cacheCtx.clearRect(0, 0, CACHE_SIZE, CACHE_SIZE);
  cacheCtx.beginPath();
  cacheCtx.arc(center, center, radius, 0, Math.PI * 2);

  if (falloff < 0.05) {
    cacheCtx.fillStyle = `rgba(0, 10, 25, ${intensity})`;
  } else {
    const gradient = cacheCtx.createRadialGradient(center, center, 0, center, center, radius);
    const falloffStrength = falloff * 4;
    const numStops = 8;

    for (let i = 0; i <= numStops; i++) {
      const t = i / numStops;
      const alpha = intensity * Math.exp(-t * t * falloffStrength);
      gradient.addColorStop(t, `rgba(0, 10, 25, ${alpha})`);
    }
    cacheCtx.fillStyle = gradient;
  }

  cacheCtx.fill();

  _depthGradientIntensity = intensity;
  _depthGradientFalloff = falloff;

  return _depthGradientCache;
}
