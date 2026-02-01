# Brush/Undergrowth Sprite Prompts (256px Pixel Art)

**Structure:** 5 brush types, generate 3 variants from each prompt
- **Types:** Bush, Shrub, Bramble, Grass Clump, Fern

> Particle sprites (leaves, pebbles) in [particle-prompts.md](particle-prompts.md)

---

## BUSH

```
Single dense leafy bush viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- One small dense bush, centered
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees, NO angle or tilt
- IRREGULAR organic blob shape - NOT circular, NOT round, NOT donut-shaped
- Asymmetric silhouette - longer on one axis than the other
- Multiple distinct leaf cluster protrusions of varying sizes
- Small gaps/holes where you can see through to ground (10-15% internal transparency)
- Dense leafy texture but with visible individual leaf clusters
- Muted desaturated green tones - subdued military color palette
- NOT vibrant, NOT bright green
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a1a, #2a3a2a (nearly black-green depth)
  - Midtones: #3a4a35, #4a5a45 (dark olive-green)
  - Highlights: #5a6a55, #6a7a65 (lighter olive on top leaves)
- STRONG CONTRAST: Very deep dark shadows in recesses, brighter highlights on sun-facing top leaves
- Shadows should be nearly black-green, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Bush fills 50% of frame

Transparent PNG, no checkered background. Make sure that everything that is not the bush is an alpha channel.
```

---

## SHRUB

```
Single wild shrub viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- One small wild shrub, centered
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees, NO angle or tilt
- IRREGULAR organic blob shape - NOT circular, NOT symmetrical
- Bumpy, lumpy silhouette with varied leaf cluster protrusions
- Some gaps/holes showing through where branches diverge
- Asymmetric form - one side larger than the other
- Muted desaturated olive-green tones - subdued military color palette
- NOT vibrant, NOT bright green
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a1a, #2a3a2a (nearly black-green)
  - Midtones: #4a5a3a, #5a6a4a (olive-green)
  - Highlights: #6a7a5a, #7a8a6a (lighter olive)
- STRONG CONTRAST: Very deep dark shadows between leaf clusters, brighter highlights on sun-facing surfaces
- Shadows should be nearly black-green, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Shrub fills 45% of frame

Transparent PNG, no checkered background. Make sure that everything that is not the shrub is an alpha channel.
```

---

## BRAMBLE

```
Single bramble/thorny bush viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- One small bramble patch, centered
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees, NO angle or tilt
- SPIKY irregular silhouette with thorny protrusions pointing outward
- Tangled, chaotic crisscrossing branches visible
- Mix of dark woody branches and small clustered leaves
- Angular, aggressive shape - NOT soft or rounded
- 40-50% of frame is transparent - lots of gaps between thorny branches
- Muted dark green-brown tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a1a15, #2a2520 (nearly black-brown)
  - Midtones: #3a4a35, #4a5a40 (dark olive-brown)
  - Highlights: #5a6a50, #6a7a5a (muted green tips)
  - Thorns: #3a3530, #4a4035 (dark brown woody)
- STRONG CONTRAST: Dark tangled center, lighter leaf tips
- Chunky pixel art aesthetic, not photorealistic
- Bramble fills 50% of frame

Transparent PNG, no checkered background. Make sure that everything that is not the bramble is an alpha channel.
```

---

## GRASS CLUMP

```
Single tall grass tuft/clump viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- One grass clump, centered
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees, NO angle or tilt
- Radiating grass blades fanning outward from center
- Organic starburst shape, NOT perfectly symmetrical
- Individual blade tips visible at edges, sparse gaps between blades
- 40-50% of frame is transparent/empty between grass blades
- Muted desaturated yellow-green tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #2a3a2a, #3a4a3a (dark green at center)
  - Midtones: #5a6a4a, #6a7a5a (yellow-green blades)
  - Highlights: #7a8a6a, #8a9a7a (lighter blade tips)
- STRONG CONTRAST: Very deep dark shadows at base/center, brighter highlights on blade tips
- Chunky pixel art aesthetic, not photorealistic
- Grass fills 45% of frame

Transparent PNG, no checkered background. Make sure that everything that is not the grass is an alpha channel.
```

---

## FERN

```
Single fern plant viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- One fern plant, centered
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees, NO angle or tilt
- Radiating fronds fanning outward from central point
- Classic fern spiral/fiddle pattern visible, NOT perfectly symmetrical
- Feathery pinnate leaves with visible leaflet structure
- 50-60% of frame is transparent/empty between fronds
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Shadows: #1a2a1a, #2a3a2a (nearly black-green at center)
  - Midtones: #3a5a3a, #4a6a4a (dark olive-green fronds)
  - Highlights: #5a7a5a, #6a8a6a (lighter frond tips)
- STRONG CONTRAST: Very deep dark shadows at base/center, brighter highlights on frond tips
- Shadows should be nearly black-green, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Fern fills 50% of frame

Transparent PNG, no checkered background. Make sure that everything that is not the fern or fronds is an alpha channel.
```

---

## Post-Processing

See [imagemagick.md](imagemagick.md) for setup instructions.

### Resize to 256x256
```bash
magick input.png -filter point -resize 256x256 output.png
```

### File Naming
Generate 3 images from each prompt, name them:
```
brush/
  originals/
    bush-1.png, bush-2.png, bush-3.png
    shrub-1.png, shrub-2.png, shrub-3.png
    bramble-1.png, bramble-2.png, bramble-3.png
    grass-clump-1.png, grass-clump-2.png, grass-clump-3.png
    fern-small-1.png, fern-small-2.png, fern-small-3.png
  resized/
    (same names after processing)
```

---

## Code Integration

After generating sprites, update `js/world-builder/strokes.js` BRUSH_TYPES:

```javascript
export const BRUSH_TYPES = {
  'bush': {
    featureType: 'brush',
    baseScale: 0.85,
    spacing: 38,
    canopyRadius: 28,
    variants: 3
  },
  'shrub': {
    featureType: 'brush',
    baseScale: 0.8,
    spacing: 35,
    canopyRadius: 25,
    variants: 3
  },
  'bramble': {
    featureType: 'brush',
    baseScale: 0.9,
    spacing: 40,
    canopyRadius: 28,
    variants: 3
  },
  'grass-clump': {
    featureType: 'brush',
    baseScale: 0.7,
    spacing: 30,
    canopyRadius: 22,
    variants: 3
  },
  'fern-small': {
    featureType: 'brush',
    baseScale: 0.7,
    spacing: 30,
    canopyRadius: 22,
    variants: 3
  }
};
```
