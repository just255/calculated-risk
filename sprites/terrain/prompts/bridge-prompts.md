# Bridge Truss Sprite Prompts (Pixel Art)

Overhead truss framework that renders as a canopy layer on top of the existing deck/ground texture at river crossings. From top-down you see the truss girders running along both edges with repeating diagonal cross-bracing between them. The ground/deck is visible through the gaps in the bracing.

**Structure:** 1 sprite type, 2-3 variants
- **Truss** (canopy sprite): Overhead framework, transparent gaps, shadow-casting
- **Deck** uses existing ground textures (dirt, wood, etc.) — no new deck sprite needed

Generate at 1024x1024. Transparent PNG. Must tile seamlessly VERTICALLY (top edge matches bottom edge).

---

## BRIDGE TRUSS

```
Overhead bridge truss framework viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel. MUST TILE SEAMLESSLY vertically.

RESOLUTION: 1024x1024 pixels (resize to 256x256 with nearest-neighbor)

LAYOUT - Read carefully:
- TWO parallel vertical girder beams running from TOP edge to BOTTOM edge along the LEFT side and RIGHT side of the frame
- Each girder approximately 24-32px wide at 256px scale (96-128px at 1024px)
- REPEATING X-CROSS-BRACING fills the space BETWEEN the two girders along the ENTIRE length from top to bottom
- The cross-bracing is diagonal struts forming a continuous repeating pattern of X shapes (or diamond/zigzag) between the girders
- Cross braces approximately 8-12px thick at 256px scale (32-48px at 1024px)
- The bracing repeats EVENLY along the full height - NOT bunched at top and bottom
- 5-7 complete X-brace cells stacked vertically between the girders, filling the whole sprite
- The triangular/diamond gaps BETWEEN the braces and girders are TRANSPARENT - this is where the deck below shows through
- There is NO large empty rectangle in the middle - the cross-bracing pattern fills the full height
- Do NOT put horizontal cross-members only at top and bottom like a picture frame - the X pattern must repeat continuously

TILING: Top edge and bottom edge must match so the pattern continues seamlessly when tiled vertically. The X-brace pattern should be cut at a point where it repeats.

STYLE:
- Chunky pixel art aesthetic, not photorealistic
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees
- Weathered dark wood or iron look - military/industrial field bridge
- NOT decorative, NOT ornate - functional military engineering
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- STRONG CONTRAST: Very deep dark shadows on undersides of beams, brighter highlights on sun-facing top surfaces
- Shadows should be nearly black, not washed out

EXACT COLOR PALETTE (use only these colors):
  - Deep shadow: #1a1815, #2a2520 (nearly black - undersides of beams)
  - Dark structure: #3a3530, #4a4035 (dark weathered wood/iron)
  - Mid structure: #5a5045, #5a5550 (main beam body)
  - Highlights: #6a6055, #6a6560 (sun-facing surfaces, sparse)

Everything that is NOT the truss beams or cross-bracing must be transparent alpha channel.

Transparent PNG, no checkered background.
```

---

## Post-Processing

Save originals (1024x1024) to `sprites/terrain/bridge/originals/`, then resize:

```bash
# Resize with nearest-neighbor
magick originals/bridge-truss-1.png -filter point -resize 256x256 resized/bridge-truss-1.png
magick originals/bridge-truss-2.png -filter point -resize 256x256 resized/bridge-truss-2.png
magick originals/bridge-truss-3.png -filter point -resize 256x256 resized/bridge-truss-3.png
```

Generate 2-3 variants with slightly different cross-brace angles or girder widths for variety.

### Quality Checklist
1. **Generate chunky** - Use 4x4 pixel blocks at 1024x1024
2. **Use nearest-neighbor** - `-filter point` preserves hard pixel edges
3. **Check transparency** - Gaps between braces must be fully transparent
4. **Test vertical tiling** - Place two copies stacked and verify the X-pattern continues seamlessly across the seam
5. **Verify NO empty center** - Cross-bracing must fill the entire height, not just top and bottom
6. **Verify color palette** - Should match the muted military tones specified
7. **Layer test** - Place truss on top of a dirt/ground texture to verify the deck is visible through the brace gaps

### Troubleshooting
- **Big empty rectangle in middle**: Regenerate - cross-bracing must repeat along the FULL height
- **Cross-members only at top/bottom**: Regenerate - this is a continuous truss, not a picture frame
- **Blurry result**: Ensure `-filter point` is used, not default bicubic
- **Gaps not transparent**: Regenerate with emphasis on alpha channel
- **Doesn't tile vertically**: Check that the brace pattern aligns at top/bottom seam

## File Naming Convention

```
sprites/terrain/bridge/
  originals/
    bridge-truss-1.png   (1024x1024, variant 1)
    bridge-truss-2.png   (1024x1024, variant 2)
    bridge-truss-3.png   (1024x1024, variant 3)
  resized/
    bridge-truss-1.png   (256x256, variant 1)
    bridge-truss-2.png   (256x256, variant 2)
    bridge-truss-3.png   (256x256, variant 3)
```

## How It Renders

The PCG system places the bridge at the river crossing:
1. **Deck** uses `terrain-bridge-wood.png` ground texture tiled along the bridge length
2. **Truss** sprite tiled on top as a canopy/overlay along the bridge length
