// ═══════════════════════════════════════════════════════════════
// SCATTER ANIMATION - Animation system for scatter items
// ═══════════════════════════════════════════════════════════════
// Handles placement animations for newly placed items.
// Military tech aesthetic: digital materialization effect.
// ═══════════════════════════════════════════════════════════════

/**
 * Available animation styles (military/tech themed)
 */
export const ANIMATION_STYLES = {
  none: { label: 'Instant', description: 'No animation' },
  digitize: { label: 'Digitize', description: 'Stepped alpha fade' },
  scan: { label: 'Scan', description: 'Top-down reveal' },
  drop: { label: 'Drop', description: 'Falls into position from above' },
  deploy: { label: 'Deploy', description: 'Scale overshoot, settles into place' },
  flash: { label: 'Flash', description: 'Bright flash in' }
};

/**
 * Base durations per category (in ms)
 */
const BASE_DURATION = {
  tree: 500,
  brush: 400,
  floor: 350,
  particle: 400
};

/**
 * Easing functions
 */
const EASING = {
  linear: t => t,
  easeOutQuad: t => 1 - (1 - t) * (1 - t),
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  // Overshoot: goes past 1.0 then settles back
  easeOutBack: t => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  // Stepped function for scanline effect
  stepped: (t, steps) => Math.floor(t * steps) / (steps - 1)
};

/**
 * Active animations tracking
 */
let activeAnimations = new Map(); // itemId -> animation state

/**
 * Start a placement animation for a scatter item
 * @param {object} item - ScatterItem to animate
 * @param {string} category - 'tree', 'brush', 'floor', 'particle'
 */
/**
 * Start a placement animation for a scatter item
 * @param {object} item - ScatterItem to animate
 * @param {string} category - 'tree', 'brush', 'floor', 'particle'
 * @param {string} style - Animation style from ANIMATION_STYLES
 */
export function startPlacementAnimation(item, category, style = 'digitize') {
  // No animation requested
  if (style === 'none' || !style) return;

  const duration = BASE_DURATION[category] || 400;

  const animState = {
    style,
    startTime: performance.now(),
    duration,
    targetAlpha: item.alpha ?? 1.0,
    targetScale: item.scale,
    targetY: item.y
  };

  // Set initial render values based on style
  switch (style) {
    case 'digitize':
      item._renderAlpha = 0;
      break;
    case 'scan':
      item._renderAlpha = 0;
      item._renderClipY = 0;
      break;
    case 'drop':
      item._renderY = item.y - 40;
      item._renderAlpha = 0;
      break;
    case 'deploy':
      item._renderScale = item.scale * 0.3;
      item._renderAlpha = 0.5;
      break;
    case 'flash':
      item._renderAlpha = 2.0;
      item._renderBrightness = 2.0;
      break;
  }

  item._animating = true;
  activeAnimations.set(item.id, { item, state: animState });
}

// Legacy alias
export const startGrowInAnimation = startPlacementAnimation;

/**
 * Update all active animations
 * @returns {boolean} True if any animations are still active
 */
export function updateAnimations() {
  if (activeAnimations.size === 0) return false;

  const now = performance.now();
  const completed = [];

  for (const [itemId, { item, state }] of activeAnimations) {
    const elapsed = now - state.startTime;
    const progress = Math.min(1, elapsed / state.duration);

    const eased = EASING.easeOutQuad(progress);

    switch (state.style) {
      case 'digitize':
        // Stepped alpha for scanline/rasterize feel
        const steppedAlpha = EASING.stepped(progress, 5);
        item._renderAlpha = steppedAlpha * state.targetAlpha;
        break;

      case 'scan':
        // Top-down reveal (alpha increases as "scan line" passes)
        item._renderAlpha = eased * state.targetAlpha;
        item._renderClipY = eased;  // 0 to 1 clip progress
        break;

      case 'drop':
        // Falls from above into position
        item._renderY = state.targetY - 40 * (1 - eased);
        item._renderAlpha = eased * state.targetAlpha;
        break;

      case 'deploy':
        // Scale overshoot (grows past 100%, settles back)
        const overshoot = EASING.easeOutBack(progress);
        item._renderScale = state.targetScale * overshoot;
        item._renderAlpha = Math.min(1, progress * 2) * state.targetAlpha;
        break;

      case 'flash':
        // Start bright, settle to normal
        const flashDecay = 1 + (1 - eased) * 1.5;  // 2.5 → 1.0
        item._renderAlpha = Math.min(1, flashDecay) * state.targetAlpha;
        item._renderBrightness = flashDecay;
        break;
    }

    // Check if animation is complete
    if (progress >= 1) {
      // Clear all render overrides
      delete item._renderX;
      delete item._renderY;
      delete item._renderAlpha;
      delete item._renderScale;
      delete item._renderClipY;
      delete item._renderBrightness;
      item._animating = false;
      completed.push(itemId);
    }
  }

  // Clean up completed animations
  for (const itemId of completed) {
    activeAnimations.delete(itemId);
  }

  return activeAnimations.size > 0;
}

/**
 * Check if there are any active animations
 * @returns {boolean}
 */
export function hasActiveAnimations() {
  return activeAnimations.size > 0;
}

/**
 * Get count of active animations
 * @returns {number}
 */
export function getActiveAnimationCount() {
  return activeAnimations.size;
}

/**
 * Clear all animations (e.g., when switching tools)
 */
export function clearAnimations() {
  for (const { item } of activeAnimations.values()) {
    delete item._renderX;
    delete item._renderY;
    delete item._renderAlpha;
    delete item._renderScale;
    delete item._renderClipY;
    delete item._renderBrightness;
    delete item._animating;
  }
  activeAnimations.clear();
}

/**
 * Start placement animations for newly added scatter items
 * @param {object[]} items - Array of newly created ScatterItems
 * @param {object} SCATTER_TYPES - Type definitions to get category
 * @param {string} style - Animation style to use
 */
export function animateNewItems(items, SCATTER_TYPES, style = 'digitize') {
  for (const item of items) {
    const config = SCATTER_TYPES[item.type];
    if (config) {
      // Skip animation for ground layer items - they're baked into a static cache
      // Animating them causes invisible items in the cache (alpha 0 at bake time)
      if (config.layer === 'ground') continue;

      startPlacementAnimation(item, config.category, style);
    }
  }
}
