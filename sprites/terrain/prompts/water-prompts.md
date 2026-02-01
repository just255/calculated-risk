# Water Texture Prompts (Seamless Pixel Art)

**Structure:** 5 water types = 5 textures
- **Types:** Pond, River, Ocean, Marsh, Deep
- **Animation:** Code-based (UV scrolling, sine distortion) - no sprite sheets needed

**CRITICAL:** All water textures must have NO diagonal lines, NO crosshatch patterns, NO grid patterns. Only organic, cloud-like color variation.

---

## POND (calm forest pond)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, still forest pond.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- PERFECTLY STILL water - VERY SUBTLE variation only
- Glassy smooth surface, MINIMAL texture
- NO busy patterns, NO diagonal lines, NO crosshatch, NO grid, NO heavy ripples
- Calm, serene, reflective quality
- Organic cloud-like color variation ONLY
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- Light source directly overhead (noon), soft diffuse reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Base: #2a4a5a, #2e4e5e (muted teal-blue)
  - Variation: #304f5f, #354f5a (very subtle shifts)
  - Highlights: #3a5a6a (sparse, subtle only)
- VERY LOW CONTRAST - almost uniform color with gentle organic variation
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## RIVER (flowing water)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, river water.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- STILL water texture - NO directional patterns, NO wave lines, NO streaks
- NO diagonal lines, NO crosshatch, NO grid patterns
- Glassy surface with organic blob patterns suggesting subtle turbulence
- Flow animation will be added via code - texture must work scrolled ANY direction
- Top-down view, camera PERFECTLY perpendicular to water surface
- VERY DESATURATED, MUTED tones - subdued military color palette
- NOT vibrant, NOT tropical - muddy natural river
- Light source directly overhead (noon), soft diffuse reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Darks: #1a2a3a, #1e3040 (very dark gray-blue)
  - Base: #2a3a4a, #3a4a5a (dark muted blue-gray)
  - Variation: #2e3e4e, #323848 (subtle organic blobs)
- LOW CONTRAST - uniform with gentle organic variation
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## OCEAN (deep open water)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, open ocean water.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- Still water surface - NO waves, NO diagonal patterns, NO crosshatch, NO grid
- Organic color variation only - subtle cloud-like blobs of slightly different shades
- Deep blue suggesting depth, cold North Atlantic feel
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- NOT tropical, NOT vibrant - cold and foreboding
- Light source directly overhead (noon), minimal reflections
- EXACT COLOR PALETTE (use only these colors):
  - Darks: #1a2a3a, #1e2e40 (deep navy shadows)
  - Base: #2a3a4a, #2e3e4e (dark steel blue)
  - Variation: #323e4a, #2a3640 (subtle organic blobs)
- LOW CONTRAST - uniform dark blue with gentle organic variation
- NO repeating patterns, NO geometric shapes
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## MARSH (murky swamp water)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, murky swamp water.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- STAGNANT STILL water - NO flow lines, NO diagonal patterns, NO crosshatch, NO grid
- Dark murky water with low visibility
- Organic blob patterns suggesting algae and sediment - NOT geometric
- Scattered darker patches as irregular organic spots
- Top-down view, camera PERFECTLY perpendicular to water surface
- Muted desaturated tones - subdued military color palette
- Murky and uninviting, NOT vibrant green
- Light source directly overhead (noon), diffused reflections only
- EXACT COLOR PALETTE (use only these colors):
  - Darks: #1a2a1a, #1e2a20 (nearly black-green)
  - Base: #2a3a2a, #2e3e2e (dark olive-green)
  - Variation: #323a30, #2a3228 (organic blobs)
  - Algae hints: #3a4a35 (sparse, scattered)
- LOW CONTRAST - uniformly dark with subtle organic variation
- NO repeating patterns, NO geometric shapes
- Chunky pixel art aesthetic, not photorealistic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## DEEP (impassable dark water)

```
Seamless tiling water texture, modern pixel art style with chunky defined pixels. Top-down view, deep dangerous water.

- SEAMLESS TILING: edges must match perfectly when placed side by side
- VERY DARK, nearly black water suggesting dangerous depth
- Subtle dark blue undertones, ominous feeling
- Minimal surface detail - depth absorbs light
- NO patterns, NO diagonal lines, NO crosshatch, NO grid, NO bright reflections
- Top-down view, camera PERFECTLY perpendicular to water surface
- EXACT COLOR PALETTE (use only these colors):
  - Darks: #0a1520, #0e1825 (nearly black)
  - Base: #121e28, #151f2a (very dark blue)
  - Subtle variation: #181f28 (sparse organic blobs only)
- VERY LOW CONTRAST - uniformly dark and foreboding
- Almost solid dark color with barely perceptible variation
- Chunky pixel art aesthetic
- 512x512 pixels, seamless tiling

Transparent PNG not needed - this is a solid fill texture.
```

---

## Post-Processing

### Resize (keep at 512x512 for water)
Water textures tile better at larger sizes. Keep at 512x512.

```bash
# If needed, resize with nearest-neighbor (point) filter
magick input.png -filter point -resize 512x512 output.png
```

### Quality Checklist
1. **NO diagonal/crosshatch patterns** - This is the #1 issue to watch for
2. **Test seamless tiling** - Place copies edge-to-edge in GIMP/Photoshop
3. **Verify color palette** - Should match the muted military tones specified
4. **Organic variation only** - Cloud-like blobs, not geometric patterns

### Troubleshooting
- **Diagonal patterns**: Regenerate - this is unacceptable
- **Visible seams**: Original wasn't truly seamless - regenerate
- **Too busy/noisy**: Regenerate with emphasis on LOW CONTRAST, MINIMAL variation

## File Naming Convention

Save to `sprites/terrain/ground/`:
```
terrain-water-pond.png
terrain-water-river.png
terrain-water-ocean.png
terrain-water-marsh.png
terrain-water-deep.png
```

## Code-Based Animation Notes

Animation will be handled in the renderer:

**Pond:** Subtle slow shimmer
```javascript
const shimmer = 1 + Math.sin(time * 0.0005) * 0.02;
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

**Marsh:** Very slow drift
```javascript
const drift = Math.sin(time * 0.001) * 1;
```

**Deep:** Static (no animation - ominous stillness)
