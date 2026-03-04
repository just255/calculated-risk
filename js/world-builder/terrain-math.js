// ═══════════════════════════════════════════════════════════════
// TERRAIN MATH — Shared pure functions for terrain property computation
// Used by: rasterize.js (grid), terrain-query.js (point queries)
// ═══════════════════════════════════════════════════════════════

import { FEATURE_DEFS, FALLOFF } from './strokes.js';

// Re-export for consumers
export { FEATURE_DEFS, FALLOFF };

/**
 * Calculate coverage contribution from a stroke to a point
 * @param {object} stroke - Stroke object
 * @param {number} wx - World X coordinate
 * @param {number} wy - World Y coordinate
 * @returns {number} Coverage value (0-1)
 */
export function calcStrokeCoverage(stroke, wx, wy) {
  // Multi-center strokes: find minimum distance to any center
  let dist;
  if (stroke.centers && stroke.centers.length > 0) {
    dist = Infinity;
    for (const c of stroke.centers) {
      const d = Math.hypot(c.x - wx, c.y - wy);
      if (d < dist) dist = d;
    }
  } else {
    dist = Math.hypot(stroke.x - wx, stroke.y - wy);
  }

  if (dist >= stroke.radius) return 0;

  // If stroke has fadeWidth, use solid-core + edge-fade model.
  // This matches the visual renderer: solid circle at radius, blur only in fadeWidth band.
  // Without this, smooth falloff across the entire radius causes gameplay effects
  // (e.g. deep water blocking vehicles) far beyond the visible water edge.
  if (stroke.fadeWidth > 0) {
    const innerRadius = stroke.radius - stroke.fadeWidth;
    if (dist <= innerRadius) {
      return stroke.intensity;
    }
    // Fade from full intensity to 0 across the fadeWidth band
    const fadeDist = (dist - innerRadius) / stroke.fadeWidth; // 0 at inner edge, 1 at outer edge
    const falloffFn = FALLOFF[stroke.falloff] || FALLOFF.linear;
    return stroke.intensity * falloffFn(fadeDist);
  }

  // Legacy: falloff across entire radius (for strokes without fadeWidth)
  const normalizedDist = dist / stroke.radius;
  const falloffFn = FALLOFF[stroke.falloff] || FALLOFF.linear;
  const falloffMult = falloffFn(normalizedDist);

  return stroke.intensity * falloffMult;
}

/**
 * Compute combined speed modifier from coverage values
 * @param {object} coverage - Object with feature coverages { forest, brush, water }
 * @returns {number} Speed multiplier (0-1)
 */
export function computeSpeedMod(coverage) {
  let totalWeight = 0;
  let weightedSpeed = 0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    const effectiveCov = Math.min(cov, 1.0);

    // Blockers override everything
    if (def.isBlocker && cov >= def.minCoverageForEffect) {
      return 0;
    }

    // Only apply effect if above threshold
    if (cov >= def.minCoverageForEffect) {
      weightedSpeed += def.speedMod * effectiveCov;
      totalWeight += effectiveCov;
    }
  }

  if (totalWeight === 0) return 1.0;

  // Blend toward base speed based on coverage
  const blendedSpeed = weightedSpeed / totalWeight;
  const coverageInfluence = Math.min(totalWeight, 1.0);

  return 1.0 * (1 - coverageInfluence) + blendedSpeed * coverageInfluence;
}

/**
 * Compute cover/defense bonus from coverage values
 * @param {object} coverage - Object with feature coverages
 * @returns {number} Defense bonus (0-1)
 */
export function computeCoverBonus(coverage) {
  let maxBonus = 0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    if (cov >= def.minCoverageForEffect) {
      // Proportional bonus based on coverage
      const bonus = def.coverBonus * Math.min(cov, 1.0);
      maxBonus = Math.max(maxBonus, bonus);
    }
  }

  return maxBonus;
}

/**
 * Compute visibility from coverage values
 * @param {object} coverage - Object with feature coverages
 * @returns {number} Visibility multiplier (0-1, lower = more concealed)
 */
export function computeVisibility(coverage) {
  let minVis = 1.0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    if (cov >= def.minCoverageForEffect) {
      // Blend visibility based on coverage
      const effectiveCov = Math.min(cov, 1.0);
      const vis = 1.0 - (1.0 - def.visibility) * effectiveCov;
      minVis = Math.min(minVis, vis);
    }
  }

  return minVis;
}

/**
 * Classify water coverage into depth categories
 * @param {number} waterCoverage - Water coverage value (0-1+)
 * @returns {string|null} 'shallow' | 'medium' | 'deep' | null
 */
export function computeWaterDepth(waterCoverage) {
  if (!waterCoverage || waterCoverage < 0.1) return null;
  if (waterCoverage < 0.3) return 'shallow';
  if (waterCoverage < 0.7) return 'medium';
  return 'deep';
}
