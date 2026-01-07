// sprite-editor/animation.js - Transform animation system for Variant Builder
// Single responsibility: Manage part animations (rotation, oscillate, scale-pulse)

import { state } from './state.js';

// Animation state
let animationTimer = null;
let currentState = 'idle';  // idle, move, aim, fire, hit
let animationTime = 0;
let onFrameCallback = null;  // Store callback for reset
let previewAimAngle = 0;  // Manual aim angle for preview (degrees)
let loopAnimation = true;  // Whether to loop or play once
let loopDuration = 1.0;  // Duration of one loop in seconds

// Get animation value at current time for a given animation config
// extra param used for dynamic values like aim angle
export function getAnimatedValue(animation, time, extra = {}) {
  if (!animation || animation.type === 'none') return null;

  const { type, params } = animation;
  const speed = params.speed || 1;
  const t = time * speed;

  switch (type) {
    case 'rotation': {
      const min = params.min || -45;
      const max = params.max || 45;
      const range = max - min;
      // Sine wave oscillation between min and max
      const normalized = (Math.sin(t * Math.PI * 2) + 1) / 2;
      return { rotation: min + normalized * range };
    }

    case 'oscillate': {
      const xRange = params.xRange || 0;
      const yRange = params.yRange || 0;
      // Sine wave for smooth oscillation
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
      // Recoil animation: quick snap back, slow return
      // Distance: how far back in pixels
      // Direction: angle in LOCAL degrees (will be rotated by hierarchy):
      //   - number: fixed local angle (0 = forward/up, 180 = backward/down)
      //   - "aim": forward along barrel (0° local, rotated to aim direction by hierarchy)
      //   - "aim-opposite": backward along barrel (180° local, for cannon recoil)
      // Decay: how fast it returns (higher = faster)
      // angleScale: if true, scale recoil by turret angle (more when perpendicular to hull)
      const distance = params.distance || 10;
      const decay = params.decay || 8;

      // Resolve direction - can be number or special string
      let direction = params.direction || 0;
      const aimAngle = extra.aimAngle || 0;
      let offsetIsWorld = false;  // Flag to tell hierarchy not to rotate again

      if (params.direction === 'aim') {
        // Use aim angle directly as WORLD direction (don't rely on hierarchy)
        direction = aimAngle;
        offsetIsWorld = true;
      } else if (params.direction === 'aim-opposite') {
        // Use opposite of aim angle as WORLD direction
        direction = aimAngle + 180;
        offsetIsWorld = true;
      }
      // Fixed numeric directions remain LOCAL (will be rotated by hierarchy)


      // Calculate recoil multiplier based on turret angle relative to hull
      // More recoil when perpendicular (90°/270°), less when aligned (0°/180°)
      let recoilMultiplier = 1.0;
      if (params.angleScale) {
        const minMult = params.angleScaleMin ?? 0.5;
        const maxMult = params.angleScaleMax ?? 1.0;
        // sin(aimAngle) is 0 at 0°/180° and ±1 at 90°/270°
        const aimRad = aimAngle * Math.PI / 180;
        const perpFactor = Math.abs(Math.sin(aimRad)); // 0 when aligned, 1 when perpendicular
        recoilMultiplier = minMult + (maxMult - minMult) * perpFactor;
      }

      // Use modulo for looping preview (one cycle per second * speed)
      const cycle = t % 1;

      // Exponential decay from initial displacement
      const offset = distance * recoilMultiplier * Math.exp(-cycle * decay);

      // Convert direction to x/y offset
      // Direction 0 means "up" (-Y), 90 means "right" (+X)
      const rad = (direction - 90) * Math.PI / 180;
      return {
        offsetX: Math.cos(rad) * offset,
        offsetY: Math.sin(rad) * offset,
        offsetIsWorld  // If true, snap-points should NOT rotate by hierarchy
      };
    }

    default:
      return null;
  }
}

// Apply animation to a part, returns modified transform values
// Supports both new multi-trigger format (part.animations) and legacy single format (part.animation)
// extra: optional object with dynamic values like { aimAngle: 45 } for aim-based animations
export function applyAnimation(part, time, activeState, extra = {}) {
  // Get animation config for the active state
  let animation = null;

  // New multi-trigger format: part.animations = { idle: {...}, move: {...}, ... }
  if (part.animations) {
    animation = part.animations[activeState];
    // Fall back to idle if no animation for current state
    // But DON'T fall back to idle when in 'aim' state (used when not animating but aim angle is set)
    // We only want aim rotation applied, not time-based idle animations
    if (!animation && activeState !== 'idle' && activeState !== 'aim') {
      animation = part.animations.idle;
    }
  }
  // Legacy single animation format: part.animation = { type, params, trigger }
  else if (part.animation) {
    if (part.animation.trigger === activeState || part.animation.trigger === 'idle') {
      animation = part.animation;
    }
  }

  // Return new values without mutating original
  const result = { ...part };

  // Apply aimAngle to parts that have an aim animation
  // The aim angle IS the rotation (not additive) for parts with aim animations
  const hasAimAnimation = part.animations?.aim && part.animations.aim.type !== 'none';
  const aimAngle = extra.aimAngle || 0;

  if (hasAimAnimation && aimAngle !== 0) {
    // Aim angle directly sets rotation (relative to part's base rotation)
    result.animatedRotation = (part.rotation || 0) + aimAngle;
  }

  if (!animation) return result;

  const animated = getAnimatedValue(animation, time, extra);
  if (!animated) return result;

  if (animated.rotation !== undefined) {
    // Skip rotation animation if we already applied aim angle
    // (aim angle takes precedence over rotation animations)
    if (!(hasAimAnimation && aimAngle !== 0)) {
      result.animatedRotation = (part.rotation || 0) + animated.rotation;
    }
  }
  if (animated.offsetX !== undefined) {
    result.animatedX = part.x + animated.offsetX;
    result.animOffsetX = animated.offsetX;  // Raw offset for hierarchy
  }
  if (animated.offsetY !== undefined) {
    result.animatedY = part.y + animated.offsetY;
    result.animOffsetY = animated.offsetY;  // Raw offset for hierarchy
  }
  if (animated.offsetIsWorld) {
    result.offsetIsWorld = true;  // Pass flag to hierarchy
  }
  if (animated.scale !== undefined) {
    result.animatedScale = part.scale * animated.scale;
  }

  return result;
}

// Start animation preview
export function startAnimationPreview(onFrame) {
  if (animationTimer) return;

  animationTime = 0;
  onFrameCallback = onFrame;  // Store for reset
  const startTime = performance.now();

  const tick = () => {
    const elapsed = (performance.now() - startTime) / 1000;  // Time in seconds

    if (loopAnimation) {
      // Loop: wrap time within loop duration
      animationTime = elapsed % loopDuration;
    } else {
      // Play once: stop at loop duration
      if (elapsed >= loopDuration) {
        // Animation complete - show rest position
        // Use time slightly before 1.0 to avoid t%1=0 edge case in recoil
        // At t=0.999, recoil is fully decayed (rest position)
        // At t=1.0, t%1=0 would show full displacement (wrong!)
        animationTime = loopDuration * 0.999;
        if (onFrame) onFrame(animationTime, currentState);
        cancelAnimationFrame(animationTimer);
        animationTimer = null;
        return;
      }
      animationTime = elapsed;
    }

    if (onFrame) onFrame(animationTime, currentState);
    animationTimer = requestAnimationFrame(tick);
  };

  animationTimer = requestAnimationFrame(tick);
}

// Stop animation preview
export function stopAnimationPreview() {
  if (animationTimer) {
    cancelAnimationFrame(animationTimer);
    animationTimer = null;
  }
  animationTime = 0;
}

// Reset animation preview - stops and renders at time 0
export function resetAnimationPreview() {
  stopAnimationPreview();
  // Trigger one final render at time 0 to show original positions
  if (onFrameCallback) {
    onFrameCallback(0, currentState);
  }
}

// Check if preview is playing
export function isPreviewPlaying() {
  return animationTimer !== null;
}

// Set current animation state (idle, move, aim, fire, hit)
export function setAnimationState(newState) {
  currentState = newState;
}

// Get current animation state
export function getAnimationState() {
  return currentState;
}

// Get current animation time
export function getAnimationTime() {
  return animationTime;
}

// Set preview aim angle (degrees, 0 = up/north)
export function setPreviewAimAngle(degrees) {
  previewAimAngle = degrees;
}

// Get preview aim angle
export function getPreviewAimAngle() {
  return previewAimAngle;
}

// Set loop mode
export function setLoopAnimation(loop) {
  loopAnimation = loop;
}

// Get loop mode
export function getLoopAnimation() {
  return loopAnimation;
}

// Set loop duration in seconds
export function setLoopDuration(seconds) {
  loopDuration = Math.max(0.1, seconds);
}

// Get loop duration
export function getLoopDuration() {
  return loopDuration;
}

// Create default animation config for a type
export function createAnimationConfig(type, trigger = 'idle') {
  const configs = {
    none: { type: 'none' },
    aim: {
      type: 'aim',
      params: {},  // No params needed - directly tracks aim angle
      trigger: 'aim'
    },
    rotation: {
      type: 'rotation',
      params: { min: -30, max: 30, speed: 0.5 },
      trigger
    },
    oscillate: {
      type: 'oscillate',
      params: { xRange: 0, yRange: 3, speed: 1 },
      trigger
    },
    'scale-pulse': {
      type: 'scale-pulse',
      params: { min: 0.95, max: 1.05, speed: 2 },
      trigger
    },
    recoil: {
      type: 'recoil',
      params: { distance: 10, direction: 0, decay: 8, speed: 1 },
      trigger: 'fire'  // Default to fire trigger for recoil
    },
    'frame-cycle': {
      type: 'frame-cycle',
      params: { fps: 12, loop: true },
      trigger
    }
  };

  return configs[type] || configs.none;
}

// Generate HTML for animation parameters based on type
export function getAnimationParamsHTML(type, currentParams = {}) {
  switch (type) {
    case 'aim':
      return `
        <div class="prop-row" style="color: var(--text-dim); font-style: italic;">
          Rotates to match aim angle. Use the Aim slider in Preview to test.
        </div>
      `;

    case 'rotation':
      return `
        <div class="prop-row">
          <span class="prop-label">Min Angle</span>
          <input type="number" class="prop-input" id="animParamMin" value="${currentParams.min ?? -30}" step="5">
        </div>
        <div class="prop-row">
          <span class="prop-label">Max Angle</span>
          <input type="number" class="prop-input" id="animParamMax" value="${currentParams.max ?? 30}" step="5">
        </div>
        <div class="prop-row">
          <span class="prop-label">Speed</span>
          <input type="number" class="prop-input" id="animParamSpeed" value="${currentParams.speed ?? 0.5}" step="0.1" min="0.1" max="10">
        </div>
      `;

    case 'oscillate':
      return `
        <div class="prop-row">
          <span class="prop-label">X Range</span>
          <input type="number" class="prop-input" id="animParamXRange" value="${currentParams.xRange ?? 0}" step="1">
        </div>
        <div class="prop-row">
          <span class="prop-label">Y Range</span>
          <input type="number" class="prop-input" id="animParamYRange" value="${currentParams.yRange ?? 3}" step="1">
        </div>
        <div class="prop-row">
          <span class="prop-label">Speed</span>
          <input type="number" class="prop-input" id="animParamSpeed" value="${currentParams.speed ?? 1}" step="0.1" min="0.1" max="10">
        </div>
      `;

    case 'scale-pulse':
      return `
        <div class="prop-row">
          <span class="prop-label">Min Scale</span>
          <input type="number" class="prop-input" id="animParamMin" value="${currentParams.min ?? 0.95}" step="0.05" min="0.1" max="2">
        </div>
        <div class="prop-row">
          <span class="prop-label">Max Scale</span>
          <input type="number" class="prop-input" id="animParamMax" value="${currentParams.max ?? 1.05}" step="0.05" min="0.1" max="2">
        </div>
        <div class="prop-row">
          <span class="prop-label">Speed</span>
          <input type="number" class="prop-input" id="animParamSpeed" value="${currentParams.speed ?? 2}" step="0.1" min="0.1" max="10">
        </div>
      `;

    case 'recoil': {
      // Determine current direction mode
      const dirValue = currentParams.direction;
      const isAim = dirValue === 'aim';
      const isAimOpposite = dirValue === 'aim-opposite';
      const isFixed = !isAim && !isAimOpposite;
      const fixedAngle = isFixed ? (dirValue ?? 0) : 0;
      const angleScale = currentParams.angleScale ?? false;

      return `
        <div class="prop-row">
          <span class="prop-label">Distance</span>
          <input type="number" class="prop-input" id="animParamDistance" value="${currentParams.distance ?? 10}" step="1" min="1" max="50">
          <span class="prop-unit">px</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Dir Mode</span>
          <select class="prop-input" id="animParamDirMode" onchange="spriteEditor.onRecoilDirModeChange()">
            <option value="fixed" ${isFixed ? 'selected' : ''}>Fixed Angle</option>
            <option value="aim" ${isAim ? 'selected' : ''}>Follow Aim</option>
            <option value="aim-opposite" ${isAimOpposite ? 'selected' : ''}>Opposite to Aim</option>
          </select>
        </div>
        <div class="prop-row" id="fixedDirectionRow" style="${isFixed ? '' : 'display: none;'}">
          <span class="prop-label">Angle</span>
          <input type="number" class="prop-input" id="animParamDirection" value="${fixedAngle}" step="15" min="-180" max="180">
          <span class="prop-unit">°</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Decay</span>
          <input type="number" class="prop-input" id="animParamDecay" value="${currentParams.decay ?? 8}" step="1" min="1" max="20">
        </div>
        <div class="prop-row">
          <span class="prop-label">Speed</span>
          <input type="number" class="prop-input" id="animParamSpeed" value="${currentParams.speed ?? 1}" step="0.1" min="0.1" max="10">
        </div>
        <div class="prop-row">
          <label class="prop-checkbox">
            <input type="checkbox" id="animParamAngleScale" ${angleScale ? 'checked' : ''} onchange="spriteEditor.onRecoilAngleScaleChange()">
            <span>Scale by turret angle</span>
          </label>
        </div>
        <div id="angleScaleParams" style="${angleScale ? '' : 'display: none;'}">
          <div class="prop-row">
            <span class="prop-label">Min (aligned)</span>
            <input type="number" class="prop-input" id="animParamAngleScaleMin" value="${currentParams.angleScaleMin ?? 0.5}" step="0.1" min="0" max="2">
          </div>
          <div class="prop-row">
            <span class="prop-label">Max (perp)</span>
            <input type="number" class="prop-input" id="animParamAngleScaleMax" value="${currentParams.angleScaleMax ?? 1.0}" step="0.1" min="0" max="2">
          </div>
        </div>
      `;
    }

    case 'frame-cycle':
      return `
        <div class="prop-row">
          <span class="prop-label">FPS</span>
          <input type="number" class="prop-input" id="animParamFps" value="${currentParams.fps ?? 12}" min="1" max="60">
        </div>
        <div class="prop-row">
          <label class="prop-checkbox">
            <input type="checkbox" id="animParamLoop" ${currentParams.loop !== false ? 'checked' : ''}>
            <span>Loop</span>
          </label>
        </div>
      `;

    default:
      return '';
  }
}

// Read current params from the UI inputs
export function readAnimationParamsFromUI(type) {
  const params = {};

  switch (type) {
    case 'rotation':
      params.min = parseFloat(document.getElementById('animParamMin')?.value) || -30;
      params.max = parseFloat(document.getElementById('animParamMax')?.value) || 30;
      params.speed = parseFloat(document.getElementById('animParamSpeed')?.value) || 0.5;
      break;

    case 'oscillate':
      params.xRange = parseFloat(document.getElementById('animParamXRange')?.value) || 0;
      params.yRange = parseFloat(document.getElementById('animParamYRange')?.value) || 3;
      params.speed = parseFloat(document.getElementById('animParamSpeed')?.value) || 1;
      break;

    case 'scale-pulse':
      params.min = parseFloat(document.getElementById('animParamMin')?.value) || 0.95;
      params.max = parseFloat(document.getElementById('animParamMax')?.value) || 1.05;
      params.speed = parseFloat(document.getElementById('animParamSpeed')?.value) || 2;
      break;

    case 'recoil': {
      params.distance = parseFloat(document.getElementById('animParamDistance')?.value) || 10;
      params.decay = parseFloat(document.getElementById('animParamDecay')?.value) || 8;
      params.speed = parseFloat(document.getElementById('animParamSpeed')?.value) || 1;

      // Handle direction mode - can be fixed angle, 'aim', or 'aim-opposite'
      const dirMode = document.getElementById('animParamDirMode')?.value || 'fixed';
      if (dirMode === 'aim') {
        params.direction = 'aim';
      } else if (dirMode === 'aim-opposite') {
        params.direction = 'aim-opposite';
      } else {
        params.direction = parseFloat(document.getElementById('animParamDirection')?.value) || 0;
      }

      // Handle angle scale (recoil varies by turret angle)
      params.angleScale = document.getElementById('animParamAngleScale')?.checked || false;
      if (params.angleScale) {
        params.angleScaleMin = parseFloat(document.getElementById('animParamAngleScaleMin')?.value) ?? 0.5;
        params.angleScaleMax = parseFloat(document.getElementById('animParamAngleScaleMax')?.value) ?? 1.0;
      }
      break;
    }

    case 'frame-cycle':
      params.fps = parseInt(document.getElementById('animParamFps')?.value) || 12;
      params.loop = document.getElementById('animParamLoop')?.checked !== false;
      break;
  }

  return params;
}

// Debug: Log recoil info for all parts (call once at animation start)
export function debugLogRecoilInfo(parts, animState, aimAngle) {
  console.log(`\n=== Recoil Debug (state: ${animState}, aim: ${aimAngle}°) ===`);

  parts.forEach((part, index) => {
    const anim = part.animations?.[animState];
    if (!anim || anim.type !== 'recoil') return;

    const params = anim.params || {};
    const dirMode = params.direction;

    let worldDir, coordType;
    if (dirMode === 'aim') {
      worldDir = aimAngle;
      coordType = 'WORLD (aim-based)';
    } else if (dirMode === 'aim-opposite') {
      worldDir = aimAngle + 180;
      coordType = 'WORLD (aim-based)';
    } else {
      worldDir = `local ${dirMode || 0}° + hierarchy rot`;
      coordType = 'LOCAL (fixed)';
    }

    console.log(`  [${index}] "${part.partId}": mode=${dirMode}, ${coordType}, dir=${worldDir}°`);
  });

  console.log('===\n');
}
