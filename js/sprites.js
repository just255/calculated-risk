// sprites.js - Sprite loading and caching
// Single responsibility: Load and cache PNG sprites. No rendering, no DOM.

import { UNITS } from './constants.js';
import * as animRuntime from './animation-runtime.js';
import * as spriteRenderer from './sprite-renderer.js';

const spriteCache = new Map();  // unitId → { img, frameCount, frameWidth, frameHeight, loaded }
const partCache = new Map();    // "unitId:partId:variant" → { img, loaded }
let manifestData = null;        // Cached manifest from server

/**
 * Preload all PNG sprites defined in UNITS[].sprite
 * Call this during game initialization
 * @returns {Promise<void>}
 */
export async function initSprites() {
  const loadPromises = [];

  for (const unit of UNITS) {
    if (unit.sprite && unit.sprite.src) {
      const promise = loadSprite(unit.id, unit.sprite);
      loadPromises.push(promise);
    }
  }

  // Wait for all sprites to load (or fail gracefully)
  await Promise.allSettled(loadPromises);

  console.log(`[sprites] Loaded ${spriteCache.size} sprites`);
}

/**
 * Load a single sprite image
 * @param {string} unitId
 * @param {Object} spriteConfig - { src, frameCount, frameWidth, frameHeight }
 * @returns {Promise<void>}
 */
function loadSprite(unitId, spriteConfig) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      spriteCache.set(unitId, {
        img,
        frameCount: spriteConfig.frameCount || 1,
        frameWidth: spriteConfig.frameWidth || 256,
        frameHeight: spriteConfig.frameHeight || 256,
        loaded: true
      });
      console.log(`[sprites] Loaded: ${unitId}`);
      resolve();
    };

    img.onerror = () => {
      // Sprite not found - game will use SVG fallback
      console.log(`[sprites] Not found: ${unitId} (will use SVG fallback)`);
      resolve();
    };

    img.src = spriteConfig.src;
  });
}

/**
 * Get cached sprite data for a unit
 * @param {string} unitId
 * @returns {{ img: HTMLImageElement, frameCount: number, frameWidth: number, frameHeight: number } | undefined}
 */
export function getSprite(unitId) {
  return spriteCache.get(unitId);
}

/**
 * Check if a PNG sprite exists for a unit
 * @param {string} unitId
 * @returns {boolean}
 */
export function hasSprite(unitId) {
  const sprite = spriteCache.get(unitId);
  return sprite && sprite.loaded;
}

// ========================================
// Part Variant System
// ========================================

/**
 * Fetch the sprite manifest from the server
 * Manifest format: { "unitId": "infantry", "parts": { "helmet": ["standard", "woodland"], "body": ["camo"] } }
 * @returns {Promise<Object|null>}
 */
async function fetchManifest() {
  if (manifestData) return manifestData;  // Use cached

  try {
    const response = await fetch('/sprites/manifest.json');
    if (!response.ok) {
      console.log('[sprites] No manifest found on server');
      return null;
    }
    manifestData = await response.json();
    console.log('[sprites] Loaded sprite manifest');
    return manifestData;
  } catch (error) {
    console.log('[sprites] Failed to fetch manifest:', error.message);
    return null;
  }
}

/**
 * Load a single part sprite
 * @param {string} unitId
 * @param {string} partId
 * @param {string} variant
 * @returns {Promise<HTMLImageElement|null>}
 */
function loadPartSprite(unitId, partId, variant) {
  const cacheKey = `${unitId}:${partId}:${variant}`;

  // Check cache first
  const cached = partCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached.loaded ? cached.img : null);
  }

  return new Promise((resolve) => {
    const img = new Image();
    const src = `/sprites/units/${unitId}/${partId}/${variant}.png`;

    img.onload = () => {
      partCache.set(cacheKey, { img, loaded: true });
      console.log(`[sprites] Loaded part: ${cacheKey}`);
      resolve(img);
    };

    img.onerror = () => {
      partCache.set(cacheKey, { img: null, loaded: false });
      console.log(`[sprites] Part not found: ${cacheKey}`);
      resolve(null);
    };

    img.src = src;
  });
}

/**
 * Load selected part variants for a unit
 * @param {string} unitId - e.g., "infantry"
 * @param {Object} selections - e.g., { helmet: "woodland", body: "camo" }
 * @returns {Promise<Object>} - Map of partId → HTMLImageElement (or null if failed)
 */
export async function loadPartSprites(unitId, selections) {
  const manifest = await fetchManifest();
  if (!manifest) {
    console.log('[sprites] No manifest available for part loading');
    return {};
  }

  // Find unit in manifest
  const unitManifest = manifest.find(u => u.unitId === unitId);
  if (!unitManifest || !unitManifest.parts) {
    console.log(`[sprites] No parts defined for unit: ${unitId}`);
    return {};
  }

  // Load each selected part
  const loadPromises = [];
  const partIds = Object.keys(selections);

  for (const partId of partIds) {
    const variant = selections[partId];
    if (variant && unitManifest.parts[partId]) {
      loadPromises.push(
        loadPartSprite(unitId, partId, variant).then(img => ({ partId, img }))
      );
    }
  }

  const results = await Promise.allSettled(loadPromises);
  const partMap = {};

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.img) {
      partMap[result.value.partId] = result.value.img;
    }
  }

  console.log(`[sprites] Loaded ${Object.keys(partMap).length} parts for ${unitId}`);
  return partMap;
}

/**
 * Get a cached part image
 * @param {string} unitId
 * @param {string} partId
 * @param {string} variant
 * @returns {HTMLImageElement|null}
 */
export function getPartImage(unitId, partId, variant) {
  const cacheKey = `${unitId}:${partId}:${variant}`;
  const cached = partCache.get(cacheKey);
  return cached && cached.loaded ? cached.img : null;
}

/**
 * Composite unit parts into a complete sprite
 * Draws all part images onto the provided canvas in order
 * @param {Object} unitDef - Unit definition from UNITS (contains sprite config)
 * @param {Object} selections - e.g., { helmet: "woodland", body: "camo" }
 * @param {HTMLCanvasElement} canvas - Target canvas to draw on
 * @returns {boolean} - True if composited successfully, false if parts missing
 */
export function compositeUnitSprite(unitDef, selections, canvas) {
  if (!canvas || !unitDef || !selections) {
    console.warn('[sprites] Invalid parameters for compositeUnitSprite');
    return false;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  // Get sprite dimensions from unit definition (or use defaults)
  const width = unitDef.sprite?.frameWidth || 256;
  const height = unitDef.sprite?.frameHeight || 256;

  // Set canvas size
  canvas.width = width;
  canvas.height = height;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Define part draw order (background to foreground)
  const drawOrder = ['body', 'legs', 'armor', 'helmet', 'weapon', 'accessory'];

  let drawnCount = 0;

  for (const partId of drawOrder) {
    const variant = selections[partId];
    if (!variant) continue;

    const img = getPartImage(unitDef.id, partId, variant);
    if (img) {
      ctx.drawImage(img, 0, 0, width, height);
      drawnCount++;
    }
  }

  // Also draw any parts not in the standard order
  for (const partId of Object.keys(selections)) {
    if (drawOrder.includes(partId)) continue;

    const variant = selections[partId];
    const img = getPartImage(unitDef.id, partId, variant);
    if (img) {
      ctx.drawImage(img, 0, 0, width, height);
      drawnCount++;
    }
  }

  if (drawnCount === 0) {
    console.warn(`[sprites] No parts drawn for ${unitDef.id}`);
    return false;
  }

  return true;
}

// ========================================
// Variant Hierarchy Rendering
// ========================================

const variantCache = new Map();  // "unitId:variantName" → variant data

/**
 * Load a variant configuration from the server
 * @param {string} unitId - e.g., "abrams"
 * @param {string} variantName - e.g., "default" or "woodland_camo"
 * @returns {Promise<Object|null>} - Variant data including parts with hierarchy
 */
export async function loadVariant(unitId, variantName) {
  // Variant ID format is "unitId-variantName"
  const variantId = `${unitId}-${variantName}`;
  const cacheKey = variantId;

  // Check cache first
  if (variantCache.has(cacheKey)) {
    return variantCache.get(cacheKey);
  }

  try {
    const response = await fetch(`/api/variants/${variantId}`);
    if (!response.ok) {
      console.log(`[sprites] Variant not found: ${cacheKey}`);
      return null;
    }
    const result = await response.json();

    // Transform API response to expected format
    const variantData = {
      id: variantId,
      unitId,
      canvasSize: {
        width: result.data.canvasWidth || 256,
        height: result.data.canvasHeight || 256
      },
      parts: result.data.parts || []
    };

    variantCache.set(cacheKey, variantData);
    console.log(`[sprites] Loaded variant: ${cacheKey}`);
    return variantData;
  } catch (error) {
    console.log(`[sprites] Failed to load variant: ${cacheKey}`, error.message);
    return null;
  }
}

/**
 * Calculate world transform for a part in a variant (hierarchy-aware)
 * @param {Array} parts - Array of parts from variant data
 * @param {number} partIndex - Index of the part to calculate transform for
 * @returns {{ x: number, y: number, rotation: number, scale: number }}
 */
function getPartWorldTransform(parts, partIndex) {
  const part = parts[partIndex];
  if (!part) return { x: 0, y: 0, rotation: 0, scale: 1 };

  // If no parent, return direct values
  if (part.parentIndex === null || part.parentIndex === undefined) {
    return {
      x: part.x || 0,
      y: part.y || 0,
      rotation: part.rotation || 0,
      scale: part.scale || 1
    };
  }

  // Get parent's world transform (recursive)
  const parentWorld = getPartWorldTransform(parts, part.parentIndex);
  const parent = parts[part.parentIndex];
  if (!parent) {
    return {
      x: part.x || 0,
      y: part.y || 0,
      rotation: part.rotation || 0,
      scale: part.scale || 1
    };
  }

  // Find the snap point on parent
  const snapPoint = parent.snapPoints?.find(sp => sp.id === part.attachedTo);
  const snapX = snapPoint?.x || 0;
  const snapY = snapPoint?.y || 0;

  // Rotate snap point by parent's world rotation
  const rad = parentWorld.rotation * Math.PI / 180;
  const rotatedSnapX = snapX * Math.cos(rad) - snapY * Math.sin(rad);
  const rotatedSnapY = snapX * Math.sin(rad) + snapY * Math.cos(rad);

  const localRotation = part.rotation || 0;

  return {
    x: parentWorld.x + rotatedSnapX,
    y: parentWorld.y + rotatedSnapY,
    rotation: part.inheritRotation !== false ? parentWorld.rotation + localRotation : localRotation,
    scale: part.inheritScale ? parentWorld.scale * (part.scale || 1) : (part.scale || 1)
  };
}

/**
 * Render a variant with full hierarchy support
 * @param {Object} variantData - Loaded variant data (from loadVariant)
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {number} [canvasWidth=256] - Canvas width
 * @param {number} [canvasHeight=256] - Canvas height
 * @returns {Promise<boolean>} - True if rendered successfully
 */
export async function renderVariant(variantData, canvas, canvasWidth = 256, canvasHeight = 256) {
  if (!variantData || !variantData.parts || !canvas) {
    console.warn('[sprites] Invalid parameters for renderVariant');
    return false;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  // Set canvas size
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Sort parts by zIndex
  const sortedParts = [...variantData.parts]
    .map((part, index) => ({ ...part, originalIndex: index }))
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  // Load and draw each part
  for (const part of sortedParts) {
    // Skip if not visible
    if (part.visible === false) continue;

    // Get world transform
    const world = getPartWorldTransform(variantData.parts, part.originalIndex);

    // Load part image (assumes part has a partId that maps to image path)
    const img = await loadPartImage(variantData.unitId, part.partId);
    if (!img) continue;

    // Draw with transform
    ctx.save();

    // Move to part position
    ctx.translate(world.x, world.y);
    ctx.rotate(world.rotation * Math.PI / 180);
    ctx.scale(world.scale, world.scale);

    // Apply opacity
    ctx.globalAlpha = (part.opacity || 100) / 100;

    // Draw centered on position
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);

    ctx.restore();
  }

  return true;
}

/**
 * Load a part image by ID
 * @param {string} unitId
 * @param {string} partId
 * @returns {Promise<HTMLImageElement|null>}
 */
async function loadPartImage(unitId, partId) {
  const cacheKey = `${unitId}:${partId}:default`;

  // Check cache first
  const cached = partCache.get(cacheKey);
  if (cached && cached.loaded) {
    return cached.img;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const src = `/sprites/units/${unitId}/parts/${partId}.png`;

    img.onload = () => {
      partCache.set(cacheKey, { img, loaded: true });
      resolve(img);
    };

    img.onerror = () => {
      partCache.set(cacheKey, { img: null, loaded: false });
      resolve(null);
    };

    img.src = src;
  });
}

// ========================================
// Animated Unit System
// ========================================

/**
 * Initialize animated rendering for a unit
 * Loads variant, preloads images, creates animation state
 * @param {string} unitId - Unit's unique ID
 * @param {string} unitType - Unit type (e.g., 'abrams', 'infantry')
 * @param {string} variantName - Variant name (e.g., 'default')
 * @returns {Promise<Object|null>} - Variant data or null if failed
 */
export async function initAnimatedUnit(unitId, unitType, variantName = 'default') {
  // Load variant data
  const variantData = await loadVariant(unitType, variantName);
  if (!variantData) {
    console.log(`[sprites] Failed to load variant for ${unitType}:${variantName}`);
    return null;
  }

  // Preload all part images
  await spriteRenderer.loadVariantImages(variantData);

  // Create animation state
  animRuntime.createUnitAnimState(unitId, variantData);

  return variantData;
}

/**
 * Set animation trigger for a unit (idle, move, aim, fire, hit)
 * @param {string} unitId - Unit's unique ID
 * @param {string} trigger - Animation trigger
 */
export function setUnitAnimTrigger(unitId, trigger) {
  animRuntime.setUnitTrigger(unitId, trigger);
}

/**
 * Set aim angle for unit turret
 * @param {string} unitId - Unit's unique ID
 * @param {number} angle - Angle in degrees
 */
export function setUnitAimAngle(unitId, angle) {
  animRuntime.setUnitAimAngle(unitId, angle);
}

/**
 * Trigger one-shot animation (fire or hit)
 * @param {string} unitId - Unit's unique ID
 * @param {string} type - 'fire' or 'hit'
 */
export function triggerUnitAnim(unitId, type) {
  animRuntime.triggerOneShot(unitId, type);
}

/**
 * Render an animated unit to canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} unitId - Unit's unique ID
 * @param {number} worldX - World X position
 * @param {number} worldY - World Y position
 * @param {number} rotation - World rotation in degrees
 * @param {number} scale - World scale
 * @param {number} gameTime - Current game time (performance.now())
 * @param {object} shadowConfig - Optional shadow config
 */
export function renderAnimatedUnit(ctx, unitId, worldX, worldY, rotation = 0, scale = 1, gameTime = performance.now(), shadowConfig = null) {
  const state = animRuntime.getUnitAnimState(unitId);
  if (!state || !state.variantData) return;

  // Calculate current transforms
  const transforms = animRuntime.calculateUnitTransforms(unitId, gameTime);

  // Render shadow if configured
  if (shadowConfig) {
    spriteRenderer.renderUnitShadow(
      ctx,
      state.variantData,
      transforms,
      worldX,
      worldY,
      rotation,
      scale,
      shadowConfig
    );
  }

  // Render unit
  spriteRenderer.renderUnit(
    ctx,
    state.variantData,
    transforms,
    worldX,
    worldY,
    rotation,
    scale
  );
}

/**
 * Clean up animation state when unit is destroyed
 * @param {string} unitId - Unit's unique ID
 */
export function destroyAnimatedUnit(unitId) {
  animRuntime.destroyUnitAnimState(unitId);
}

/**
 * Clear all animation states (e.g., on game reset)
 */
export function clearAllAnimatedUnits() {
  animRuntime.clearAllAnimStates();
}

// Re-export animation triggers for convenience
export const ANIM_TRIGGERS = animRuntime.TRIGGERS;

// Note: Animation functions already exported as:
// - setUnitAnimTrigger(unitId, trigger)
// - setUnitAimAngle(unitId, angle)
// - triggerUnitAnim(unitId, type)

/**
 * Test function - renders an animated unit on a test canvas
 * Call from console: await sprites.testAnimatedUnit('abrams', 'default')
 */
export async function testAnimatedUnit(unitType = 'abrams', variantName = 'default') {
  // Create or get test canvas
  let canvas = document.getElementById('test-anim-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'test-anim-canvas';
    canvas.width = 400;
    canvas.height = 400;
    canvas.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);border:2px solid #0f0;background:#222;z-index:9999;';
    document.body.appendChild(canvas);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = 'position:fixed;top:calc(50% - 220px);left:50%;transform:translateX(-50%);z-index:10000;padding:5px 15px;';
    closeBtn.onclick = () => {
      canvas.remove();
      closeBtn.remove();
      if (window._testAnimLoop) cancelAnimationFrame(window._testAnimLoop);
    };
    document.body.appendChild(closeBtn);
  }

  const ctx = canvas.getContext('2d');
  const unitId = `test-${Date.now()}`;

  // Initialize animated unit
  console.log(`[test] Loading variant ${unitType}-${variantName}...`);
  const variantData = await initAnimatedUnit(unitId, unitType, variantName);

  if (!variantData) {
    console.error('[test] Failed to load variant');
    return;
  }

  console.log('[test] Variant loaded, starting render loop');
  console.log('[test] Controls:');
  console.log('  - sprites.setUnitAimAngle("' + unitId + '", 45)  // Aim at 45°');
  console.log('  - sprites.triggerUnitAnim("' + unitId + '", "fire")  // Fire!');
  console.log('  - sprites.setUnitAnimTrigger("' + unitId + '", "move")  // Move');
  console.log('  - sprites.setUnitAnimTrigger("' + unitId + '", "idle")  // Idle');

  // Render loop
  let aimAngle = 0;
  const render = () => {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw crosshairs
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(200, 0); ctx.lineTo(200, 400);
    ctx.moveTo(0, 200); ctx.lineTo(400, 200);
    ctx.stroke();

    // Render the animated unit
    renderAnimatedUnit(ctx, unitId, 200, 200, 0, 0.8, performance.now(), {
      offsetAngle: 135,
      offsetDistance: 6,
      opacity: 0.3
    });

    // Show current aim angle
    ctx.fillStyle = '#0f0';
    ctx.font = '14px monospace';
    ctx.fillText(`Aim: ${animRuntime.getUnitAnimState(unitId)?.aimAngle || 0}°`, 10, 20);
    ctx.fillText(`Trigger: ${animRuntime.getUnitAnimState(unitId)?.trigger || 'idle'}`, 10, 40);

    window._testAnimLoop = requestAnimationFrame(render);
  };

  render();
  return unitId;
}
