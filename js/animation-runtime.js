// animation-runtime.js - Runtime animation state machine for game units
// Single responsibility: Manage animation state per unit and calculate transforms
//
// This module is PURE - no rendering, no DOM, just math and state.
// Import this in game.js to animate units.

// Animation state storage per unit
const unitAnimStates = new Map();

// Animation triggers
export const TRIGGERS = {
  IDLE: 'idle',
  MOVE: 'move',
  AIM: 'aim',
  FIRE: 'fire',
  HIT: 'hit'
};

// One-shot animation durations (ms)
const ONE_SHOT_DURATIONS = {
  fire: 300,
  hit: 200
};

// ============================================================================
// HIERARCHY HELPERS - Transform calculation for parent-child relationships
// ============================================================================

/**
 * Calculate world rotation for a child part
 * @param {object} part - Child part data
 * @param {object} parent - Parent's calculated transform
 * @param {number} localRotation - Child's local rotation (possibly animated)
 * @returns {number} World rotation in degrees
 */
function calculateWorldRotation(part, parent, localRotation) {
  return part.inheritRotation !== false ? parent.rotation + localRotation : localRotation;
}

/**
 * Calculate world scale for a child part
 * Children always inherit parent scale (local scale multiplies parent scale)
 * @param {object} parent - Parent's calculated transform
 * @param {number} localScale - Child's local scale (possibly animated)
 * @returns {number} World scale
 */
function calculateWorldScale(parent, localScale) {
  return parent.scale * localScale;
}

/**
 * Apply animation offset to a position
 * @param {number} baseX - Base X position
 * @param {number} baseY - Base Y position
 * @param {number} offsetX - Animation offset X
 * @param {number} offsetY - Animation offset Y
 * @param {number} worldRotation - World rotation in degrees
 * @param {number} scale - Scale factor
 * @param {boolean} offsetIsWorld - If true, offset is already in world coords
 * @returns {object} { x, y }
 */
function applyAnimOffset(baseX, baseY, offsetX, offsetY, worldRotation, scale, offsetIsWorld) {
  if (offsetX === 0 && offsetY === 0) return { x: baseX, y: baseY };

  if (offsetIsWorld) {
    // Offset is already in world coordinates (e.g., aim-based recoil)
    return {
      x: baseX + offsetX * scale,
      y: baseY + offsetY * scale
    };
  } else {
    // Offset is in local coordinates, rotate by worldRotation
    const worldRad = worldRotation * Math.PI / 180;
    return {
      x: baseX + (offsetX * Math.cos(worldRad) - offsetY * Math.sin(worldRad)) * scale,
      y: baseY + (offsetX * Math.sin(worldRad) + offsetY * Math.cos(worldRad)) * scale
    };
  }
}

/**
 * Apply parent-child hierarchy transform
 * @param {object} transform - Child's base transform (with animation applied)
 * @param {object} part - Child part data
 * @param {object} parent - Parent's calculated transform
 * @param {Array} parts - All parts in variant
 * @returns {object} Updated transform
 */
function applyHierarchyTransform(transform, part, parent, parts) {
  const parentPart = parts[part.parentIndex];
  const parentRad = parent.rotation * Math.PI / 180;

  // Check for snap point attachment
  const snapPoint = parentPart.snapPoints?.find(sp => sp.id === part.attachedTo);

  // Calculate world rotation and scale (common for both types)
  const worldRot = calculateWorldRotation(part, parent, part.rotation || 0);
  const worldScale = calculateWorldScale(parent, transform.scale);

  // Animation offset - use raw offsets tracked from first pass
  const animOffsetX = transform.animOffsetX || 0;
  const animOffsetY = transform.animOffsetY || 0;
  const offsetIsWorld = transform.offsetIsWorld || false;

  if (snapPoint) {
    // Snap point attached child
    const snapWorldX = parent.x + (snapPoint.x * Math.cos(parentRad) - snapPoint.y * Math.sin(parentRad)) * parent.scale;
    const snapWorldY = parent.y + (snapPoint.x * Math.sin(parentRad) + snapPoint.y * Math.cos(parentRad)) * parent.scale;

    const pos = applyAnimOffset(snapWorldX, snapWorldY, animOffsetX, animOffsetY, worldRot, worldScale, offsetIsWorld);
    transform.x = pos.x;
    transform.y = pos.y;

    // Find child's attachment origin (snap point of matching type)
    const originPoint = part.snapPoints?.find(sp => sp.type === snapPoint.type);
    transform.originOffsetX = originPoint?.x || 0;
    transform.originOffsetY = originPoint?.y || 0;
  } else {
    // Unattached child - use part's x/y as offset from parent center
    const rotatedX = part.x * Math.cos(parentRad) - part.y * Math.sin(parentRad);
    const rotatedY = part.x * Math.sin(parentRad) + part.y * Math.cos(parentRad);

    const baseX = parent.x + rotatedX * parent.scale;
    const baseY = parent.y + rotatedY * parent.scale;

    const pos = applyAnimOffset(baseX, baseY, animOffsetX, animOffsetY, worldRot, worldScale, offsetIsWorld);
    transform.x = pos.x;
    transform.y = pos.y;
  }

  // Update rotation and scale
  if (part.inheritRotation !== false) {
    transform.rotation = worldRot + (transform.rotation - (part.rotation || 0));
  }
  transform.scale = worldScale;

  return transform;
}

/**
 * Create animation state for a unit
 * @param {string} unitId - Unique unit identifier
 * @param {object} variantData - Loaded variant JSON with parts and animations
 */
export function createUnitAnimState(unitId, variantData) {
  const state = {
    variantData,
    trigger: TRIGGERS.IDLE,
    triggerStartTime: performance.now(),
    aimAngle: 0,
    // One-shot tracking
    fireTime: null,
    hitTime: null,
    // Per-part animation time offsets (for staggered animations)
    partOffsets: {}
  };

  unitAnimStates.set(unitId, state);
  return state;
}

/**
 * Set the current animation trigger for a unit
 * @param {string} unitId - Unit identifier
 * @param {string} trigger - One of TRIGGERS values
 */
export function setUnitTrigger(unitId, trigger) {
  const state = unitAnimStates.get(unitId);
  if (!state) return false;

  if (state.trigger !== trigger) {
    state.trigger = trigger;
    state.triggerStartTime = performance.now();
  }
  return true;
}

/**
 * Set turret aim angle for a unit
 * @param {string} unitId - Unit identifier
 * @param {number} degrees - Angle in degrees (0 = up/north)
 */
export function setUnitAimAngle(unitId, degrees) {
  const state = unitAnimStates.get(unitId);
  if (!state) return false;

  state.aimAngle = degrees;
  return true;
}

/**
 * Trigger a one-shot animation (fire, hit)
 * @param {string} unitId - Unit identifier
 * @param {string} type - 'fire' or 'hit'
 */
export function triggerOneShot(unitId, type) {
  const state = unitAnimStates.get(unitId);
  if (!state) return false;

  const now = performance.now();

  if (type === 'fire') {
    state.fireTime = now;
  } else if (type === 'hit') {
    state.hitTime = now;
  }
  return true;
}

/**
 * Get animation state for a unit
 * @param {string} unitId - Unit identifier
 */
export function getUnitAnimState(unitId) {
  return unitAnimStates.get(unitId);
}

/**
 * Destroy animation state when unit is removed
 * @param {string} unitId - Unit identifier
 */
export function destroyUnitAnimState(unitId) {
  return unitAnimStates.delete(unitId);
}

/**
 * Calculate animated value for a given animation config and time
 * @param {object} animation - Animation config { type, params }
 * @param {number} time - Time in seconds
 * @param {object} extra - Extra params like aimAngle
 * @returns {object|null} - Transform deltas { rotation, offsetX, offsetY, scale }
 */
function getAnimatedValue(animation, time, extra = {}) {
  if (!animation || animation.type === 'none') return null;

  const { type, params } = animation;
  const speed = params.speed || 1;
  const t = time * speed;

  switch (type) {
    case 'rotation': {
      const min = params.min || -45;
      const max = params.max || 45;
      const range = max - min;
      // Sine wave oscillation
      const normalized = (Math.sin(t * Math.PI * 2) + 1) / 2;
      return { rotation: min + normalized * range };
    }

    case 'oscillate': {
      const xRange = params.xRange || 0;
      const yRange = params.yRange || 0;
      const xOffset = Math.sin(t * Math.PI * 2) * xRange;
      const yOffset = Math.cos(t * Math.PI * 2) * yRange;
      return { offsetX: xOffset, offsetY: yOffset };
    }

    case 'scale-pulse': {
      const min = params.min || 0.9;
      const max = params.max || 1.1;
      const range = max - min;
      const normalized = (Math.sin(t * Math.PI * 2) + 1) / 2;
      return { scale: min + normalized * range };
    }

    case 'recoil': {
      const distance = params.distance || 10;
      const decay = params.decay || 8;

      // Direction can be a number or special string:
      // - number: fixed LOCAL angle in degrees (will be rotated by hierarchy)
      // - "aim": same direction as turret aim (WORLD coordinates)
      // - "aim-opposite": opposite to turret aim (WORLD coordinates)
      const aimAngle = extra.aimAngle || 0;
      let direction = params.direction || 0;
      let offsetIsWorld = false;

      if (params.direction === 'aim') {
        direction = aimAngle;
        offsetIsWorld = true;
      } else if (params.direction === 'aim-opposite') {
        direction = aimAngle + 180;
        offsetIsWorld = true;
      }

      // Calculate recoil multiplier based on turret angle relative to hull
      // More recoil when perpendicular (90°/270°), less when aligned (0°/180°)
      let recoilMultiplier = 1.0;
      if (params.angleScale) {
        const minMult = params.angleScaleMin ?? 0.5;
        const maxMult = params.angleScaleMax ?? 1.0;
        const aimRad = aimAngle * Math.PI / 180;
        const perpFactor = Math.abs(Math.sin(aimRad));
        recoilMultiplier = minMult + (maxMult - minMult) * perpFactor;
      }

      // For one-shot, time is elapsed since fire
      // Exponential decay from initial displacement
      const offset = distance * recoilMultiplier * Math.exp(-time * decay);

      // Convert direction to x/y offset
      const rad = (direction - 90) * Math.PI / 180;
      return {
        offsetX: Math.cos(rad) * offset,
        offsetY: Math.sin(rad) * offset,
        offsetIsWorld  // If true, don't rotate by hierarchy
      };
    }

    case 'aim': {
      // Dynamic aim - rotate toward target angle
      // extra.aimAngle is the target angle
      return { rotation: extra.aimAngle || 0 };
    }

    default:
      return null;
  }
}

/**
 * Calculate transforms for all parts of a unit at a given time
 * @param {string} unitId - Unit identifier
 * @param {number} gameTime - Current game time (performance.now())
 * @returns {Array} - Array of { partIndex, x, y, rotation, scale, opacity }
 */
export function calculateUnitTransforms(unitId, gameTime) {
  const state = unitAnimStates.get(unitId);
  if (!state || !state.variantData) return [];

  const { variantData, trigger, triggerStartTime, aimAngle, fireTime, hitTime } = state;
  const parts = variantData.parts || [];

  // Time since trigger started (in seconds)
  const triggerElapsed = (gameTime - triggerStartTime) / 1000;

  // Check for active one-shots
  const fireActive = fireTime && (gameTime - fireTime) < ONE_SHOT_DURATIONS.fire;
  const hitActive = hitTime && (gameTime - hitTime) < ONE_SHOT_DURATIONS.hit;
  const fireElapsed = fireTime ? (gameTime - fireTime) / 1000 : 0;
  const hitElapsed = hitTime ? (gameTime - hitTime) / 1000 : 0;

  // Cache for computed world transforms (handles any part order via recursion)
  const worldTransforms = new Map();

  // Helper: get animated local values for a part
  const getAnimatedLocal = (part, index) => {
    let x = part.x;
    let y = part.y;
    let rotation = part.rotation || 0;
    let scale = part.scale || 1;
    let opacity = part.opacity ?? 100;

    // Determine which animation to apply
    let activeAnim = null;
    let animTime = triggerElapsed;

    // Priority: fire > hit > current trigger > idle
    if (fireActive && part.animations?.fire) {
      activeAnim = part.animations.fire;
      animTime = fireElapsed;
    } else if (hitActive && part.animations?.hit) {
      activeAnim = part.animations.hit;
      animTime = hitElapsed;
    } else if (part.animations?.[trigger]) {
      activeAnim = part.animations[trigger];
      animTime = triggerElapsed;
    } else if (part.animations?.idle && trigger !== 'idle') {
      activeAnim = part.animations.idle;
      animTime = triggerElapsed;
    }

    // Aim animation is always applied if part has one (turret aiming is independent of state)
    if (part.animations?.aim && part.animations.aim.type === 'aim') {
      activeAnim = part.animations.aim;
    }

    // Apply animation - track raw offsets separately
    let offsetIsWorld = false;
    let animOffsetX = 0;
    let animOffsetY = 0;
    if (activeAnim) {
      const animated = getAnimatedValue(activeAnim, animTime, { aimAngle });
      if (animated) {
        if (animated.rotation !== undefined) rotation += animated.rotation;
        if (animated.offsetX !== undefined) animOffsetX = animated.offsetX;
        if (animated.offsetY !== undefined) animOffsetY = animated.offsetY;
        if (animated.scale !== undefined) scale *= animated.scale;
        if (animated.offsetIsWorld) offsetIsWorld = true;
      }
    }

    return { partIndex: index, x, y, rotation, scale, opacity, offsetIsWorld, animOffsetX, animOffsetY };
  };

  // Recursive function to get world transform for any part
  const getWorldTransform = (partIndex) => {
    // Return cached if already computed
    if (worldTransforms.has(partIndex)) {
      return worldTransforms.get(partIndex);
    }

    const part = parts[partIndex];
    const local = getAnimatedLocal(part, partIndex);

    // Root part - no hierarchy needed
    if (part.parentIndex === null || part.parentIndex < 0) {
      const result = {
        partIndex,
        x: local.x + local.animOffsetX,
        y: local.y + local.animOffsetY,
        rotation: local.rotation,
        scale: local.scale,
        opacity: local.opacity
      };
      worldTransforms.set(partIndex, result);
      return result;
    }

    // Get parent's world transform (recursive)
    const parent = getWorldTransform(part.parentIndex);
    const parentPart = parts[part.parentIndex];
    const parentRad = parent.rotation * Math.PI / 180;

    // Check for snap point attachment
    const snapPoint = parentPart.snapPoints?.find(sp => sp.id === part.attachedTo);

    // Calculate world rotation and scale
    const worldRot = part.inheritRotation !== false ? parent.rotation + local.rotation : local.rotation;
    const worldScale = parent.scale * local.scale;

    // Animation offset handling
    const { animOffsetX, animOffsetY, offsetIsWorld } = local;

    let worldX, worldY;
    let originOffsetX = 0, originOffsetY = 0;

    if (snapPoint) {
      // Snap point attached child - position from parent's snap point
      const snapWorldX = parent.x + (snapPoint.x * Math.cos(parentRad) - snapPoint.y * Math.sin(parentRad)) * parent.scale;
      const snapWorldY = parent.y + (snapPoint.x * Math.sin(parentRad) + snapPoint.y * Math.cos(parentRad)) * parent.scale;

      const pos = applyAnimOffset(snapWorldX, snapWorldY, animOffsetX, animOffsetY, worldRot, worldScale, offsetIsWorld);
      worldX = pos.x;
      worldY = pos.y;

      // Find child's attachment origin
      const originPoint = part.snapPoints?.find(sp => sp.type === snapPoint.type);
      originOffsetX = originPoint?.x || 0;
      originOffsetY = originPoint?.y || 0;
    } else {
      // Unattached child - offset from parent center
      const rotatedX = part.x * Math.cos(parentRad) - part.y * Math.sin(parentRad);
      const rotatedY = part.x * Math.sin(parentRad) + part.y * Math.cos(parentRad);

      const baseX = parent.x + rotatedX * parent.scale;
      const baseY = parent.y + rotatedY * parent.scale;

      const pos = applyAnimOffset(baseX, baseY, animOffsetX, animOffsetY, worldRot, worldScale, offsetIsWorld);
      worldX = pos.x;
      worldY = pos.y;
    }

    const result = {
      partIndex,
      x: worldX,
      y: worldY,
      rotation: worldRot,
      scale: worldScale,
      opacity: local.opacity,
      originOffsetX,
      originOffsetY
    };
    worldTransforms.set(partIndex, result);
    return result;
  };

  // Calculate transforms for all parts
  const transforms = [];
  for (let i = 0; i < parts.length; i++) {
    transforms.push(getWorldTransform(i));
  }

  return transforms;
}

/**
 * Clear all animation states (e.g., on game reset)
 */
export function clearAllAnimStates() {
  unitAnimStates.clear();
}

/**
 * Get count of active animation states (for debugging)
 */
export function getAnimStateCount() {
  return unitAnimStates.size;
}
