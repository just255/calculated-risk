// ═══════════════════════════════════════════════════════════════
// STROKE RENDERER - Render strokes to canvas
// ═══════════════════════════════════════════════════════════════

import { ensureRasterized } from './rasterize.js';
import { FEATURE_DEFS, FALLOFF, TREE_TYPES, TREE_AGES, TREE_AGE_THRESHOLD, BRUSH_TYPES, COLOR_VARIATION, getTreesSortedByScale, getBrushSortedByScale } from './strokes.js';

/**
 * Color definitions for features
 */
const FEATURE_COLORS = {
  forest: {
    base: 'rgba(30, 74, 40, 0.85)',
    gradient: ['rgba(40, 90, 50, 0.9)', 'rgba(25, 60, 30, 0.7)']
  },
  brush: {
    base: 'rgba(58, 106, 42, 0.7)',
    gradient: ['rgba(70, 120, 55, 0.75)', 'rgba(45, 85, 35, 0.5)']
  },
  water: {
    base: 'rgba(30, 90, 140, 0.8)',
    gradient: ['rgba(40, 110, 160, 0.85)', 'rgba(25, 70, 110, 0.6)']
  }
};

/**
 * Base layer colors
 */
const BASE_COLORS = {
  grass: '#4a6a3a',
  dirt: '#5a5045',
  sand: '#c4a86a',
  snow: '#e8e8f0'
};

/**
 * Simple seeded random for consistent rendering
 */
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Render base terrain layer (ground underneath everything)
 * @param {object} terrainMap - TerrainMap object
 * @param {number} cellSize - Cell size for rendering
 * @returns {HTMLCanvasElement} Canvas with base layer
 */
export function renderBaseLayer(terrainMap, cellSize) {
  ensureRasterized(terrainMap);

  const width = terrainMap.gridWidth * cellSize;
  const height = terrainMap.gridHeight * cellSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fill with base color
  ctx.fillStyle = BASE_COLORS[terrainMap.baseLayer] || BASE_COLORS.grass;
  ctx.fillRect(0, 0, width, height);

  // Add some texture variation
  for (let i = 0; i < width * height / 500; i++) {
    const x = seededRandom(i * 7) * width;
    const y = seededRandom(i * 13) * height;
    const r = 2 + seededRandom(i * 19) * 4;

    ctx.fillStyle = `rgba(0, 0, 0, ${0.03 + seededRandom(i * 23) * 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw water features (on base layer, not canopy)
  for (const stroke of terrainMap.strokes) {
    if (stroke.type === 'water') {
      drawWaterStroke(ctx, stroke);
    }
  }

  return canvas;
}

/**
 * Render canopy layer (forest/brush above units)
 * @param {object} terrainMap - TerrainMap object
 * @param {number} cellSize - Cell size for rendering
 * @param {object} treeImages - Optional preloaded tree images
 * @param {number} dpr - Device pixel ratio for high-DPI rendering (default 1)
 * @param {object} brushImages - Optional preloaded brush images
 * @returns {HTMLCanvasElement} Canvas with canopy layer (transparent background)
 */
export function renderCanopyLayer(terrainMap, cellSize, treeImages = null, dpr = 1, brushImages = null) {
  ensureRasterized(terrainMap);

  const width = terrainMap.gridWidth * cellSize;
  const height = terrainMap.gridHeight * cellSize;

  const canvas = document.createElement('canvas');
  // Scale canvas by DPR for crisp rendering on high-DPI displays
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');

  // Scale context to draw at map coordinates but render at DPR resolution
  ctx.scale(dpr, dpr);

  // Disable image smoothing for crisp pixel art
  ctx.imageSmoothingEnabled = false;

  // Start transparent
  ctx.clearRect(0, 0, width, height);

  // Check if we have brush in the global registry
  const hasGlobalBrush = terrainMap.brushes && terrainMap.brushes.length > 0;

  // Render brush FIRST (under trees) - sorted by scale for z-ordering
  if (hasGlobalBrush) {
    const sortedBrush = getBrushSortedByScale(terrainMap);
    drawBrushFromRegistry(ctx, sortedBrush, brushImages);
  }

  // Check if we have trees in the global registry
  const hasGlobalTrees = terrainMap.trees && terrainMap.trees.length > 0;

  if (hasGlobalTrees) {
    // Render from global tree registry (sorted by scale for z-ordering)
    const sortedTrees = getTreesSortedByScale(terrainMap);
    drawTreesFromRegistry(ctx, sortedTrees, treeImages);
  } else {
    // LEGACY: Render from stroke data (for backwards compatibility)
    for (const stroke of terrainMap.strokes) {
      const def = FEATURE_DEFS[stroke.type];
      if (!def || !def.isCanopy) continue;

      // Skip brush strokes if they've been processed into the global registry
      if (stroke.brushType && hasGlobalBrush) continue;

      // Check if this is a tree-based stroke
      if (isTreeStroke(stroke)) {
        const images = getTreeImages(treeImages, stroke.treeType);
        if (Object.keys(images).length > 0) {
          drawTreeStroke(ctx, stroke, images);
          continue;
        }
      }

      // Fallback: Try to get density variant based on intensity
      const image = getDensityVariant(treeImages, stroke.type, stroke.intensity);
      if (image) {
        drawImageStroke(ctx, stroke, image);
      } else {
        drawCanopyStroke(ctx, stroke);
      }
    }
  }

  return canvas;
}

/**
 * Draw trees from the global registry (pre-calculated positions)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object[]} trees - Array of tree objects sorted by scale
 * @param {object} images - Loaded tree images
 */
function drawTreesFromRegistry(ctx, trees, images) {
  for (const tree of trees) {
    const { treeType, x, y, scale, age, isDead, variant, hueShift, brightness, saturation } = tree;

    // Build image key - dead variants use format: oak-young-dead-1
    const deadSuffix = isDead ? '-dead' : '';
    const imageKey = `${treeType}-${age}${deadSuffix}-${variant}`;
    let treeImage = images?.[imageKey];

    if (!treeImage) {
      // Try without variant number
      const fallbackKey = `${treeType}-${age}${deadSuffix}`;
      treeImage = images?.[fallbackKey];
    }

    if (!treeImage && isDead) {
      // If dead variant not found, fall back to live version
      const liveKey = `${treeType}-${age}-${variant}`;
      treeImage = images?.[liveKey] || images?.[`${treeType}-${age}`];
    }

    if (!treeImage) continue;

    drawSingleTree(ctx, treeImage, x, y, scale, hueShift, brightness, saturation);
  }
}

/**
 * Draw brush items from the global registry (pre-calculated positions)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object[]} brushItems - Array of brush objects sorted by scale
 * @param {object} images - Loaded brush images
 */
function drawBrushFromRegistry(ctx, brushItems, images) {
  for (const brush of brushItems) {
    const { brushType, x, y, scale, variant, hueShift, brightness, saturation } = brush;

    // Build image key: bush-small-1, bush-large-2, fern-small-3, etc.
    const imageKey = `${brushType}-${variant}`;
    let brushImage = images?.[imageKey];

    if (!brushImage) {
      // Try first variant as fallback
      brushImage = images?.[`${brushType}-1`];
    }

    if (!brushImage) continue;

    drawSingleBrush(ctx, brushImage, x, y, scale, hueShift, brightness, saturation);
  }
}

/**
 * Draw a single brush item with transforms
 */
function drawSingleBrush(ctx, image, x, y, scale, hueShift, brightness, saturation) {
  // Round to integers for crisp pixel art rendering
  const brushWidth = Math.round(image.width * scale);
  const brushHeight = Math.round(image.height * scale);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  // Ensure smoothing stays disabled
  ctx.imageSmoothingEnabled = false;

  // Draw brush centered at position (use integer offsets)
  ctx.drawImage(image, Math.round(-brushWidth / 2), Math.round(-brushHeight / 2), brushWidth, brushHeight);

  ctx.restore();
}

/**
 * Draw a single tree with transforms
 */
function drawSingleTree(ctx, image, x, y, scale, hueShift, brightness, saturation) {
  // Round to integers for crisp pixel art rendering
  const treeWidth = Math.round(image.width * scale);
  const treeHeight = Math.round(image.height * scale);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  // Ensure smoothing stays disabled
  ctx.imageSmoothingEnabled = false;

  // Color variation filter disabled for testing - may cause blur
  // ctx.filter = `hue-rotate(${hueShift}deg) brightness(${brightness}) saturate(${saturation})`;

  // Draw tree centered at position (use integer offsets)
  ctx.drawImage(image, Math.round(-treeWidth / 2), Math.round(-treeHeight / 2), treeWidth, treeHeight);

  ctx.filter = 'none';
  ctx.restore();
}

/**
 * Draw a canopy stroke with procedural detail
 */
function drawCanopyStroke(ctx, stroke) {
  const { x, y, radius, type, intensity, falloff, seed } = stroke;
  const colors = FEATURE_COLORS[type] || FEATURE_COLORS.forest;

  // Create radial gradient
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

  const falloffFn = FALLOFF[falloff] || FALLOFF.smooth;

  // Add color stops based on falloff
  gradient.addColorStop(0, colors.gradient[0]);
  gradient.addColorStop(0.6, colors.base);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.globalAlpha = intensity;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Add detail (tree crowns or bush clusters)
  if (type === 'forest') {
    addForestDetail(ctx, x, y, radius, intensity, seed);
  } else if (type === 'brush') {
    addBrushDetail(ctx, x, y, radius, intensity, seed);
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw a water stroke
 */
function drawWaterStroke(ctx, stroke) {
  const { x, y, radius, intensity, seed } = stroke;
  const colors = FEATURE_COLORS.water;

  // Create radial gradient
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colors.gradient[0]);
  gradient.addColorStop(0.7, colors.base);
  gradient.addColorStop(1, 'rgba(30, 90, 140, 0.2)');

  ctx.globalAlpha = intensity;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Add ripple effects
  ctx.strokeStyle = 'rgba(100, 160, 200, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const rippleR = radius * (0.3 + i * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, rippleR, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw stroke using preloaded image sprite
 */
function drawImageStroke(ctx, stroke, image) {
  const { x, y, radius, intensity, seed } = stroke;

  ctx.globalAlpha = 1; // Image already has alpha, don't double-apply

  // Draw image centered at stroke position, scaled to diameter
  const diameter = radius * 2;
  ctx.drawImage(image, x - radius, y - radius, diameter, diameter);
}

/**
 * Get the appropriate density variant for a stroke (legacy support)
 * @param {object} images - Object with density variants (e.g., forest-dense, forest-medium, etc.)
 * @param {string} type - Feature type (forest, brush)
 * @param {number} intensity - Stroke intensity (0-1)
 * @returns {Image|null} The appropriate image variant
 */
function getDensityVariant(images, type, intensity) {
  if (!images) return null;

  // Check for density variants
  const denseKey = `${type}-dense`;
  const mediumKey = `${type}-medium`;
  const sparseKey = `${type}-sparse`;
  const singleKey = `${type}-single`;

  // Select based on intensity
  if (intensity > 0.75 && images[denseKey]) {
    return images[denseKey];
  } else if (intensity > 0.5 && images[mediumKey]) {
    return images[mediumKey];
  } else if (intensity > 0.25 && images[sparseKey]) {
    return images[sparseKey];
  } else if (images[singleKey]) {
    return images[singleKey];
  }

  // Fallback to non-variant or any available
  return images[type] || images[denseKey] || images[mediumKey] || images[sparseKey] || null;
}

/**
 * Draw trees within a stroke using individual tree sprites
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} stroke - Stroke object with tree painting properties
 * @param {object} treeImages - Object with tree images keyed by "treeType-age-variant" (e.g., "oak-young-1", "pine-old-2")
 */
function drawTreeStroke(ctx, stroke, treeImages) {
  const { x, y, radius, intensity, seed, treeType, density, minAge, maxAge, treeScale } = stroke;

  // Get tree type config
  const treeConfig = TREE_TYPES[treeType];
  if (!treeConfig) return;

  // Global scale multiplier (default 0.08 for reasonable size relative to units)
  const globalScale = treeScale || 0.08;

  // Calculate number of trees based on density and radius
  // density is trees per 100px radius, scaled by stroke size
  const treeCount = Math.max(1, Math.floor((density || 5) * (radius / 100)));

  // Get age scale range
  const minScale = TREE_AGES[minAge] || TREE_AGES.young;
  const maxScale = TREE_AGES[maxAge] || TREE_AGES.old;

  // Get available variants for each age
  const youngVariants = getVariantsForAge(treeImages, treeType, 'young');
  const oldVariants = getVariantsForAge(treeImages, treeType, 'old');
  const transitionalVariants = getVariantsForAge(treeImages, treeType, 'transitional');

  // If no variants available, skip
  if (youngVariants.length === 0 && oldVariants.length === 0 && transitionalVariants.length === 0) return;

  // Check if using transitional mode (both min and max set to transitional)
  const useTransitionalOnly = minAge === 'transitional' && maxAge === 'transitional';

  for (let i = 0; i < treeCount; i++) {
    // Use seeded random for consistent placement
    const treeSeed = seed + i * 1000;

    // Random position within stroke circle (sqrt for uniform distribution)
    const angle = seededRandom(treeSeed) * Math.PI * 2;
    const distFactor = Math.sqrt(seededRandom(treeSeed + 1)); // sqrt = uniform in circle
    const dist = distFactor * radius * 0.95;
    const tx = x + Math.cos(angle) * dist;
    const ty = y + Math.sin(angle) * dist;

    // Forest edge gradient: older trees at center, younger at edges
    // Normalize distance (0 = center, 1 = edge)
    const normalizedDist = dist / radius;

    // Invert: age HIGH at center, LOW at edge
    let ageFactor = 1 - normalizedDist;

    // Apply smooth S-curve falloff (Hermite interpolation) for natural transition
    ageFactor = ageFactor * ageFactor * (3 - 2 * ageFactor);

    // Add controlled randomness (±15% variance) to avoid "rings"
    const randomVariance = 0.15;
    const noise = (seededRandom(treeSeed + 4) - 0.5) * 2 * randomVariance;
    ageFactor = Math.max(0, Math.min(1, ageFactor + noise));

    // Map to age scale range
    const ageScale = minScale + ageFactor * (maxScale - minScale);
    const finalScale = treeConfig.baseScale * ageScale * globalScale;

    // Select variants based on mode
    let variants;
    if (useTransitionalOnly) {
      // Transitional mode - only use transitional images
      variants = transitionalVariants;
    } else {
      // Normal mode - select young or old image based on scale threshold
      const useYoung = ageScale < TREE_AGE_THRESHOLD;
      variants = useYoung ? youngVariants : oldVariants;

      // Fallback to other age if preferred age has no variants
      if (variants.length === 0) {
        variants = useYoung ? oldVariants : youngVariants;
      }
    }
    if (variants.length === 0) continue;

    // Random variant from available
    const variantIndex = Math.floor(seededRandom(treeSeed + 3) * variants.length);
    const treeImage = variants[variantIndex];

    if (!treeImage) continue;

    // Rotation disabled - trees have slight perspective that looks wrong when rotated
    // To re-enable: const rotation = seededRandom(treeSeed + 5) * Math.PI * 2;
    const rotation = 0;

    // Color variation
    const hueShift = (seededRandom(treeSeed + 6) - 0.5) * COLOR_VARIATION.hueRange;
    const brightness = 1 + (seededRandom(treeSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange;
    const saturation = 1 + (seededRandom(treeSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange;

    // Calculate tree size (round for crisp pixel art)
    const treeWidth = Math.round(treeImage.width * finalScale);
    const treeHeight = Math.round(treeImage.height * finalScale);

    // Save context state
    ctx.save();

    // Move to tree position (round to integers)
    ctx.translate(Math.round(tx), Math.round(ty));

    // Apply rotation
    ctx.rotate(rotation);

    // Ensure smoothing stays disabled
    ctx.imageSmoothingEnabled = false;

    // Color variation filter disabled for testing - may cause blur
    // ctx.filter = `hue-rotate(${hueShift}deg) brightness(${brightness}) saturate(${saturation})`;

    // Draw tree centered at position (use integer offsets)
    ctx.drawImage(treeImage, Math.round(-treeWidth / 2), Math.round(-treeHeight / 2), treeWidth, treeHeight);

    // Restore context
    ctx.filter = 'none';
    ctx.restore();
  }
}

/**
 * Get all variant images for a specific tree type and age
 * @param {object} treeImages - All tree images
 * @param {string} treeType - Tree type (oak, pine, etc.)
 * @param {string} age - Age (young, old)
 * @returns {Image[]} Array of available variant images
 */
function getVariantsForAge(treeImages, treeType, age) {
  const variants = [];
  const prefix = `${treeType}-${age}-`;

  for (const key in treeImages) {
    if (key.startsWith(prefix)) {
      variants.push(treeImages[key]);
    }
  }

  return variants;
}

/**
 * Check if stroke has tree painting properties
 */
function isTreeStroke(stroke) {
  return stroke.treeType && TREE_TYPES[stroke.treeType];
}

/**
 * Get all tree images for a tree type (young and old variants)
 * Auto-detects available variants from loaded images
 * @param {object} images - All loaded images
 * @param {string} treeType - Tree type (oak, pine, etc.)
 * @returns {object} Object with tree images keyed by age-variant
 */
function getTreeImages(images, treeType) {
  if (!images) return {};

  const result = {};
  const prefix = `${treeType}-`;

  // Find all images matching this tree type
  for (const key in images) {
    if (key.startsWith(prefix)) {
      result[key] = images[key];
    }
  }

  return result;
}

/**
 * Add procedural tree detail to forest stroke
 */
function addForestDetail(ctx, cx, cy, radius, intensity, seed) {
  const treeCount = Math.floor(radius / 15);

  for (let i = 0; i < treeCount; i++) {
    const angle = seededRandom(seed + i * 7) * Math.PI * 2;
    const dist = seededRandom(seed + i * 13) * radius * 0.8;
    const tx = cx + Math.cos(angle) * dist;
    const ty = cy + Math.sin(angle) * dist;
    const treeRadius = 8 + seededRandom(seed + i * 19) * 12;

    // Tree shadow
    ctx.fillStyle = 'rgba(0, 30, 0, 0.3)';
    ctx.beginPath();
    ctx.arc(tx + 2, ty + 2, treeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Tree crown
    const green = 30 + Math.floor(seededRandom(seed + i * 23) * 40);
    ctx.fillStyle = `rgba(${green}, ${60 + green}, ${20 + green / 2}, ${0.7 * intensity})`;
    ctx.beginPath();
    ctx.arc(tx, ty, treeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = `rgba(${green + 30}, ${80 + green}, ${30 + green / 2}, ${0.4 * intensity})`;
    ctx.beginPath();
    ctx.arc(tx - treeRadius * 0.3, ty - treeRadius * 0.3, treeRadius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Add procedural bush detail to brush stroke
 */
function addBrushDetail(ctx, cx, cy, radius, intensity, seed) {
  const bushCount = Math.floor(radius / 20);

  for (let i = 0; i < bushCount; i++) {
    const angle = seededRandom(seed + i * 11) * Math.PI * 2;
    const dist = seededRandom(seed + i * 17) * radius * 0.85;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const bushRadius = 5 + seededRandom(seed + i * 23) * 8;

    // Bush cluster (multiple small circles)
    const green = 50 + Math.floor(seededRandom(seed + i * 29) * 30);
    ctx.fillStyle = `rgba(${green}, ${80 + green}, ${30 + green / 3}, ${0.6 * intensity})`;

    for (let j = 0; j < 3; j++) {
      const offX = (seededRandom(seed + i * 31 + j) - 0.5) * bushRadius;
      const offY = (seededRandom(seed + i * 37 + j) - 0.5) * bushRadius;
      ctx.beginPath();
      ctx.arc(bx + offX, by + offY, bushRadius * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Render full terrain (base + features, NOT canopy - canopy separate for layering)
 * @param {object} terrainMap - TerrainMap object
 * @param {number} cellSize - Cell size for rendering
 * @returns {HTMLCanvasElement} Canvas with terrain
 */
export function renderTerrain(terrainMap, cellSize) {
  const base = renderBaseLayer(terrainMap, cellSize);
  // Note: Canopy is rendered separately via renderCanopyLayer()
  // so units can be drawn between base and canopy
  return base;
}
