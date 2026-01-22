# Ground Texture Prompts (Seamless Pixel Art)

Generate at 1024x1024, then resize to 256x256 using nearest-neighbor:
```
magick input.png -filter point -resize 256x256 output.png
```

**Structure:** 5 ground types = 5 textures
- **Types:** Grass, Dirt, Forest Floor, Mud, Sand
- **Animation:** Code-based (subtle color shift) - no sprite sheets needed
- **Display scale:** 0.25 (64px tiles in editor)

---

## GRASS

```
Seamless tiling ground texture, pixel art style. Top-down grass field.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

STYLE REFERENCE: Match forest floor texture density - small irregular color patches ~4-8px, fine grain texture

- Subtle pixel art texture - fine color variation
- FLAT grass seen from directly above - NO 3D blades, NO bushes
- Small irregular patches of color variation (like dappled light through leaves)
- SEAMLESS TILING: all edges must match perfectly
- Top-down view, camera PERFECTLY perpendicular to ground
- Muted desaturated tones - subdued military color palette
- NOT vibrant lawn green - natural wild grass, slightly dry
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dark: #3a4a2a, #4a5a3a (dark olive)
  - Mid: #5a6a4a, #6a7a5a (muted green)
  - Light: #7a8a6a (sparse highlights only)
- 1024x1024 pixels, seamless tiling
```

---

## DIRT

```
Seamless tiling ground texture, pixel art style. Top-down bare dirt/earth.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

STYLE REFERENCE: Match forest floor texture density - small irregular color patches ~4-8px, fine grain texture

- Subtle pixel art texture - fine color variation
- FLAT dirt texture - NOT detailed pebbles or rocks
- Small irregular patches of color variation
- SEAMLESS TILING: all edges must match perfectly
- Top-down view, camera PERFECTLY perpendicular to ground
- Muted desaturated tones - subdued military color palette
- Neutral brown earth, slightly dry
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dark: #3a3530, #4a4540 (dark brown)
  - Mid: #5a5550, #6a6560 (muted brown)
  - Light: #7a7570 (sparse highlights only)
- 1024x1024 pixels, seamless tiling
```

---

## FOREST FLOOR

```
Seamless tiling ground texture, pixel art style. Top-down forest floor with fallen leaves.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

- Subtle pixel art texture - fine color variation
- FLAT texture suggesting leaf litter and debris
- NO detailed individual leaves, NO realistic twigs - just color noise
- Mix of brown/tan color patches
- SEAMLESS TILING: all edges must match perfectly
- Top-down view, camera PERFECTLY perpendicular to ground
- Muted desaturated tones - subdued military color palette
- Autumn/decay colors, NOT bright fall foliage
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dark: #2a2520, #3a3025 (dark brown)
  - Mid: #4a4030, #5a4a35 (brown)
  - Accent: #5a5040, #6a5a45 (tan patches)
  - Light: #6a6050 (sparse highlights only)
- 1024x1024 pixels, seamless tiling

Note: This texture auto-paints under forest/tree areas.
```

---

## MUD

```
Seamless tiling ground texture, pixel art style. Top-down wet mud.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

- Subtle pixel art texture - fine color variation
- FLAT texture suggesting wet ground
- NO realistic puddles, NO 3D reflections - just darker color areas
- SEAMLESS TILING: all edges must match perfectly
- Top-down view, camera PERFECTLY perpendicular to ground
- Muted desaturated tones - subdued military color palette
- Dark and wet looking
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dark: #2a2520, #3a3025 (very dark brown)
  - Mid: #3a3530, #4a4035 (dark mud)
  - Wet: #3a3a35, #4a4a40 (slightly darker patches)
  - Light: #5a5550 (sparse highlights only)
- 1024x1024 pixels, seamless tiling

Note: This texture auto-paints under water/marsh areas.
```

---

## SAND

```
Seamless tiling ground texture, pixel art style. Top-down sandy ground.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

- Subtle pixel art texture - fine color variation
- FLAT texture suggesting sand
- NO dunes, NO wind streaks, NO realistic sand ripples
- SEAMLESS TILING: all edges must match perfectly
- Top-down view, camera PERFECTLY perpendicular to ground
- Muted desaturated tones - subdued military color palette
- NOT bright beach sand - muted tan/beige
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dark: #6a6555, #7a7565 (darker tan)
  - Mid: #8a8575, #9a9585 (muted tan)
  - Light: #aaa595 (sparse highlights only)
- 1024x1024 pixels, seamless tiling

Note: Use for beaches, desert, river banks.
```

---

## Post-Processing Notes

1. Generate at 1024x1024 with chunky 4x4 pixel blocks
2. Resize to 256x256 using NEAREST-NEIGHBOR (preserves hard pixels):
   ```
   magick input.png -filter point -resize 256x256 output.png
   ```
3. Test seamless tiling by placing copies edge-to-edge
4. Verify color palette matches specification
5. If result is blurry, regenerate with chunkier blocks

## File Naming Convention

- `terrain-grass.png` (256x256)
- `terrain-dirt.png` (256x256)
- `terrain-forest-floor.png` (256x256)
- `terrain-mud.png` (256x256)
- `terrain-sand.png` (256x256)

## Auto-Paint Features

When implementing in terrain editor:
- **Forest floor** auto-paints under tree strokes (toggle option)
- **Mud** auto-paints at marsh/swamp edges
- **Sand** can auto-paint at river/water edges
