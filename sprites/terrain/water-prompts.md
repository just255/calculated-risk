# Water Texture Prompts (Seamless Pixel Art)

Generate at 1024x1024 (or AI's native size), then resize to 512x512 in GIMP using NoHalo/LoHalo interpolation.

**Structure:** 4 water types = 4 textures
- **Types:** Calm Pond, Marsh/Swamp, River, Ocean
- **Animation:** Code-based (UV scrolling, sine distortion) - no sprite sheets needed

---

## CALM POND

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, still pond water.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- PERFECTLY STILL water, NO ripples, NO disturbance
- Glassy smooth surface with subtle depth variation
- Slight color variation suggesting underwater features (rocks, plants, depth changes)
- NO concentric rings, NO wave patterns
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- NOT vibrant or tropical
- Light source directly overhead (noon), soft diffuse reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a3a4a, #1e3a5f (dark blue-gray)
  - Base: #2a4a5a, #3a5a6a (muted blue)
  - Highlights: #4a6a7a, #5a7a8a (gray-blue, subtle only)
- Consistent depth throughout - variation is from light/shadow only, not depth changes
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## MARSH/SWAMP

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, murky swamp water.

SAME STYLE AS CALM POND - but murky green with surface debris.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- STAGNANT STILL water, NO ripples, NO flow, NO directional patterns
- Dark murky water with low visibility
- Glassy but dirty surface with organic blob patterns
- Scattered algae patches and debris as irregular spots (NOT streaks)
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- NOT vibrant, appropriately murky and uninviting
- Light source directly overhead (noon), diffused reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a1a, #1a2a2a (nearly black-green)
  - Base: #2a3a2a, #3a4a3a (dark olive-green)
  - Debris/algae: #4a5a3a, #5a6a4a (yellow-green patches, scattered blobs)
  - Highlights: #5a6a5a, #6a7a6a (pale murky, subtle only)
- Consistent depth throughout - variation is from debris and light/shadow only
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## RIVER (Flowing Water)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, river water.

SAME STYLE AS CALM POND - but slightly more turbulent color variation.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- STILL water texture, NO directional patterns, NO wave lines, NO streaks
- Glassy surface with organic blob patterns suggesting subtle turbulence
- Flow animation will be added via code - texture must work scrolled ANY direction
- Top-down view, camera PERFECTLY perpendicular to water surface
- VERY DESATURATED, MUTED tones - subdued military color palette
- NOT vibrant, NOT tropical - muddy natural river
- Light source directly overhead (noon), soft diffuse reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a3a, #1e3040 (very dark gray-blue)
  - Base: #2a3a4a, #3a4a5a (dark muted blue-gray)
  - Highlights: #4a5a6a, #5a6a7a (gray-blue, subtle only)
- Consistent depth throughout - variation is from light/shadow only
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## OCEAN

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, open ocean water.

SAME STYLE AS CALM POND - but with deeper ocean blue colors.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- PERFECTLY STILL water, NO ripples, NO disturbance, NO wave patterns
- Glassy smooth surface with subtle color variation
- Slight color variation suggesting underwater depth changes
- NO concentric rings, NO directional patterns
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- NOT vibrant or tropical - cold North Atlantic ocean
- Light source directly overhead (noon), soft diffuse reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a3a, #1e2a4a (very dark navy)
  - Base: #2a3a4a, #3a4a5a (dark steel blue)
  - Highlights: #4a5a6a, #5a6a7a (gray-blue, subtle only)
- Consistent depth throughout - variation is from light/shadow only
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## Post-Processing Notes

1. Generate at AI native resolution
2. Resize to 512x512 using NoHalo/LoHalo interpolation
3. Test seamless tiling by placing copies edge-to-edge in GIMP
4. Verify color palette matches specification

## File Naming Convention

- `water-pond.png` (512x512)
- `water-marsh.png` (512x512)
- `water-river.png` (512x512)
- `water-ocean.png` (512x512)

## Code-Based Animation Notes

Animation will be handled in the renderer:

**Pond (clear weather):** Subtle slow color shift or none
```javascript
// Mostly static, maybe very slow brightness pulse
const shimmer = 1 + Math.sin(time * 0.0005) * 0.02;
```

**Marsh:** Slow drift
```javascript
const drift = Math.sin(time * 0.001) * 1;
```

**River:** UV offset scrolling for flow direction
```javascript
const flowOffset = (time * 0.05) % textureHeight;
```

**Ocean:** Slow rolling swell effect
```javascript
const swellX = Math.sin(time * 0.001) * 3;
const swellY = Math.cos(time * 0.0008) * 2;
```

**Rain Effect (overlay on any water):**
```javascript
// Spawn ripples at random positions
// Each ripple: expanding ring that fades out
// Can be drawn as circles with decreasing opacity
ripples.push({ x: rand(), y: rand(), age: 0, maxAge: 500 });
ripples.forEach(r => {
  const radius = r.age * 0.1;
  const alpha = 1 - (r.age / r.maxAge);
  ctx.strokeStyle = `rgba(150, 180, 200, ${alpha * 0.5})`;
  ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
});
```
