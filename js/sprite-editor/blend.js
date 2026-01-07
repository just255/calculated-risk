// sprite-editor/blend.js - Layer blend mode calculations
// Single responsibility: Pixel-level blend operations

// Blend formula implementations
const blendFormulas = {
  multiply: (src, dst) => (src * dst) / 255,
  screen: (src, dst) => 255 - ((255 - src) * (255 - dst)) / 255,
  overlay: (src, dst) => dst < 128
    ? (2 * src * dst) / 255
    : 255 - (2 * (255 - src) * (255 - dst)) / 255
};

/**
 * Apply blend mode between two canvases
 * @param {CanvasRenderingContext2D} destCtx - Destination context (modified in place)
 * @param {CanvasRenderingContext2D} srcCtx - Source layer context
 * @param {string} blendMode - Blend mode name (multiply, screen, overlay)
 * @param {number} opacity - Layer opacity 0-1
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
export function applyBlend(destCtx, srcCtx, blendMode, opacity, width, height) {
  const formula = blendFormulas[blendMode];
  if (!formula) {
    console.warn('Unknown blend mode:', blendMode);
    return;
  }

  const destData = destCtx.getImageData(0, 0, width, height);
  const srcData = srcCtx.getImageData(0, 0, width, height);
  const dest = destData.data;
  const src = srcData.data;

  for (let i = 0; i < dest.length; i += 4) {
    const srcAlpha = src[i + 3] / 255;
    if (srcAlpha === 0) continue; // Skip transparent pixels

    const srcR = src[i], srcG = src[i + 1], srcB = src[i + 2];
    const dstR = dest[i], dstG = dest[i + 1], dstB = dest[i + 2];

    // Apply blend formula
    const outR = formula(srcR, dstR);
    const outG = formula(srcG, dstG);
    const outB = formula(srcB, dstB);

    // Mix blended color with destination based on layer alpha and opacity
    const alpha = srcAlpha * opacity;
    dest[i] = Math.round(outR * alpha + dstR * (1 - alpha));
    dest[i + 1] = Math.round(outG * alpha + dstG * (1 - alpha));
    dest[i + 2] = Math.round(outB * alpha + dstB * (1 - alpha));
    dest[i + 3] = Math.max(dest[i + 3], Math.round(srcAlpha * 255 * opacity));
  }

  destCtx.putImageData(destData, 0, 0);
}

/**
 * Check if a blend mode requires pixel-level processing
 */
export function needsPixelBlend(blendMode) {
  return blendMode && blendMode !== 'normal' && blendFormulas[blendMode];
}
