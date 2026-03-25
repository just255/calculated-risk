// ═══════════════════════════════════════════════════════════════
// PCG RULES — Declarative generation rules (pure data)
//
// All behavioral thresholds, depth semantics, and geometric
// constants. Change these to alter generation behavior without
// touching pcg.js.
//
// Depth class: getDepthClass(width, depth) derives shallow/medium/full
// from the width + depth sliders directly.
// ═══════════════════════════════════════════════════════════════

export const PCG_RULES = {

  // ── Spawn zone geometry ──────────────────────────────────────
  spawn: {
    sizeFraction: 0.15,        // zone radius = min(w,h) × this
    insetMultiplier: 0.8,      // distance from edge = radius × this
    positionRange: [0.3, 0.7], // random fraction along edge
  },

  // ── River shape / meander ────────────────────────────────────
  river: {
    // Endpoint placement
    endpointMargin: 0.15,            // min fraction from edge corners
    endpointJitter: [-0.1, 0.1],     // ± randomness on "away" placement
    overshootMultiplier: 4,           // bleed past edge = riverW × this

    // Center pull (bias midpoint toward map center)
    centerPullStrength: 0.35,         // fraction of distance to pull
    centerPullFalloff: 8,             // bell curve steepness

    // Spine sampling
    spineSpacingMultiplier: 0.5,      // spine step = riverW × this
    clampMarginMultiplier: 0.5,       // control point clamp = riverW × this

    // Meander geometry (all multiplied by riverW)
    wavelengthRange: [10, 14],        // meander wavelength
    amplitudeRange: [2.5, 4.5],       // meander amplitude (× windiness)
    amplitudeVariation: [0.7, 1.3],   // per-bend amplitude jitter
    asymmetryRange: [0.02, 0.06],     // downstream bend asymmetry
    minBends: 2,                      // minimum meander bends

    // Width variation
    poolRiffleRange: [5, 7],          // pool-riffle wavelength (× riverW)
    bendWidthFactor: 0.28,            // wider at bends
    poolWidthFactor: 0.28,            // wider at pools
    minWidthFactor: 0.5,              // never less than 50% base width
    bankNoiseFactor: 0.18,            // per-side random bank variation
    perpExpansionFactor: 0.35,        // perpendicular bank expansion
    bumpChance: 0.4,                  // one-sided widening probability
    bumpRange: [0.25, 0.55],          // bump distance (× riverW × widthFactor)

    // Deep layer rendering
    deepBrushRadiusMultiplier: 1.3,   // deep layer radius = riverW × this
  },

  // ── Depth thresholds: slider-driven depth class ────────────
  //
  // Depth class derived from width + depth sliders:
  //   width: 20-80, depth: 0-100
  depthThresholds: {
    shallowMaxWidth: 35,     // width ≤ 35 → shallow regardless
    shallowMaxDepth: 25,     // depth ≤ 25 → shallow regardless
    fullMinWidth: 55,        // width ≥ 55 AND depth ≥ 60 → full
    fullMinDepth: 60,
    // else → medium
  },

  // ── Depth classes: what each label means for rendering ───────
  //
  // shallowFraction: all spine points get this × depthSlider × 0.5
  // deepFraction:    deep points get this × depthSlider × 0.5
  // deepLayer:       whether to generate deep waterDepth strokes at all
  //
  depthClasses: {
    shallow: { deepLayer: false, shallowFraction: 0.15 },
    medium:  { deepLayer: true,  deepFraction: 0.5,  shallowFraction: 0.15 },
    full:    { deepLayer: true,  deepFraction: 1.0,  shallowFraction: 0.15 },
  },

  // ── Bridge (river crossing) ────────────────────────────────
  bridge: {
    deckTexture: 'bridge-wood',        // default deck ground texture
    overhang: 0.5,                     // fraction of path width added to each end past shore edge
    stoneAnchor: 1.5,                  // extra overhang multiplier for stone (simulates abutments)
    minLengthMult: 1.4,               // minimum deck length as multiple of deck width (ensures deck > truss)
  },

  // ── Path routing (river interaction) ─────────────────────────
  path: {
    riverProbeRange: [0.2, 0.8],       // fraction of spawn-to-spawn line to probe
    riverProbeStep: 0.1,               // probe step size
    riverProbeThreshold: 0.8,          // riverBrushR × this = blocking distance
    riverExclusionZone: 1.5,           // riverBrushR × this = exclusion zone
    approachDistanceMultiplier: 1.2,   // (riverBrushR + pathWidth) × this
  },

  // ── Connectivity validation ──────────────────────────────────
  connectivity: {
    cellSize: 32,                      // BFS grid cell size (px)
    deepWaterThreshold: 0.6,           // depth ≥ this blocks movement
    blockingRadiusFraction: 0.7,       // inner 70% of stroke radius blocks
  },
};

// ── Depth class helper ──────────────────────────────────────────
/**
 * Derive depth class from width and depth slider values.
 * @param {number} width - river width slider value (20-80)
 * @param {number} depth - river depth slider value (0-100)
 * @returns {'shallow'|'medium'|'full'}
 */
export function getDepthClass(width, depth) {
  const t = PCG_RULES.depthThresholds;
  if (width <= t.shallowMaxWidth || depth <= t.shallowMaxDepth) return 'shallow';
  if (width >= t.fullMinWidth && depth >= t.fullMinDepth) return 'full';
  return 'medium';
}
