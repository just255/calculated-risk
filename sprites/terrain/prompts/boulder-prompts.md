# Boulder & Rocky Terrain Sprite Prompts (256px Pixel Art)

## Design Goals

Boulders should be **visually interesting standalone features** on the terrain map. Each type must have a **dramatically different silhouette** so they're instantly distinguishable at any zoom level. Think of them as terrain landmarks, not background clutter.

**Priority order:**
1. **Strong, unique silhouette** — each type reads as a completely different shape
2. **Large on canvas** — these are BIG rocks, fill the frame
3. **Bold simple features** — one or two defining details, not surface noise
4. **Pixel art clarity** — chunky flat color blocks, readable at 64px

The three types are designed to look completely different from each other:

1. **Split megalith** — A massive angular boulder cracked nearly in two by a single dramatic fissure. The crack is THE feature. Big, imposing, blocky.

2. **Rock cluster** — A tight group of 3-4 different-sized rocks forming one compound shape. The interesting silhouette comes from the gaps and overlaps between rocks. Complex outline, simple individual rocks.

3. **Shelf outcrop** — A wide, flat slab of exposed bedrock with distinct stepped ledges. Reads as a natural platform. The most horizontal/flat of the three, with strong geometric stair-step edges.

**Rock particles** represent angular frost-shattered fragments, NOT smooth river-worn pebbles. Sharp angular pieces with flat fracture faces.

**Rock floor** textures represent exposed rocky ground — thin soil over bedrock with embedded stones showing through.

---

**Structure:** 4 sprite types
- **Boulder** (canopy sprite): Large rock cover feature, 3 types (3 distinct silhouettes)
- **Rock Particles** (particle sprite): Small angular rock fragments, 3 variants
- **Rock Floor** (floor sprite): Rocky ground texture, 3 variants
- **Rock Ground** (ground tile): Base terrain texture for rocky areas, 3 variants

Generate 3 images from each prompt for variants unless the prompt specifies a single variant.

---

## BOULDER — Type 1: Split Megalith (erratic)

```
A single massive angular boulder SPLIT by one dramatic crack, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

SHAPE AND SILHOUETTE:
- One LARGE angular rock that dominates the canvas — fills 70-80% of frame
- The outline is a ROUGH POLYGON with 5-7 straight-ish edges — like a chunky irregular pentagon
- NOT round, NOT oval — think of a rock that was cleaved from a cliff face
- Asymmetric: one axis about 1.3:1 longer than the other

THE CRACK (most important feature):
- ONE single bold dark crack runs diagonally across the entire boulder, nearly splitting it in two
- The crack is WIDE — 4-6 pixels wide at 256px scale
- The crack is the DARKEST element — nearly black (#1a1a18)
- The two halves are slightly offset — one half a slightly different tone than the other
- A thin line of dark moss/growth visible in the crack (#3a4030, muted dark green — very subtle)
- This crack is what makes the boulder visually interesting — it's the focal point

SURFACE:
- MINIMAL surface detail — just 2-3 large flat color zones per half
- Each zone is ONE solid tone with hard edges between them
- NO noise, NO dithering, NO small speckles
- The rock faces are large, clean, flat color blocks

STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees
NO visible sides, NO 3D perspective, NO isometric angle

COLOR PALETTE (use only these):
  - Crack/deepest shadow: #1a1a18, #252220
  - Crack moss hint: #3a4030 (only inside the crack)
  - Dark face: #3a3530, #454035
  - Mid stone: #5a5550, #605a55 (LARGEST area)
  - Light face: #706a65, #7a7570 (one or two faces only)
  - NO highlight brighter than #7a7570

STYLE:
- CHUNKY pixel art — large flat color areas, NOT smooth gradients
- High contrast between crack and stone surface
- Bold and simple — should read clearly even at 64x64
- Muted desaturated military tones, NOT vibrant

Transparent PNG, no checkered background. Everything that is not the boulder must be fully transparent alpha.
```

---

## BOULDER — Type 2: Rock Cluster (field)

```
A tight cluster of 3-4 rocks of different sizes forming one compound shape, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

SHAPE AND SILHOUETTE:
- NOT one single rock — this is 3-4 SEPARATE rocks pressed together
- The cluster fills 65-75% of the frame as a group
- One LARGE central rock (takes up about 50% of the cluster area)
- Two or three SMALLER rocks tucked against the large one at different sides
- VISIBLE DARK GAPS between the rocks — these gaps are what make the silhouette interesting
- The overall outline is COMPLEX and IRREGULAR because it's multiple shapes overlapping
- Each individual rock is simple (rough oval or angular blob) but together they create visual interest
- The gaps/shadows between rocks are 3-4px wide at 256px — clearly visible

INDIVIDUAL ROCKS:
- The large central rock: slightly angular, medium gray tones
- One smaller rock: slightly different tone (warmer brown-gray)
- Another smaller rock: slightly different tone (cooler blue-gray)
- Each rock is just 2-3 flat color zones — dead simple individually
- The CONTRAST between the rocks comes from slightly different color temperatures, not surface detail

GAPS AND SHADOWS:
- Deep dark shadows (#1a1a18) in the crevices between rocks — this is what defines the shapes
- The shadows are the second most important feature after the silhouette itself

STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees
NO visible sides, NO 3D perspective, NO isometric angle

COLOR PALETTE (use only these):
  - Crevice shadows: #1a1a18, #252220 (deep black between rocks)
  - Dark stone: #3a3530, #454035
  - Mid stone (warm): #5a5550, #605850 (main rock, slightly warm)
  - Mid stone (cool): #555558, #5a5a5e (secondary rock, slightly cool)
  - Light stone: #706a65, #7a7570
  - NO highlight brighter than #7a7570

STYLE:
- CHUNKY pixel art — each rock is just a few flat color blocks
- The visual interest comes from the SHAPE and GAPS, not surface texture
- High contrast in the crevices — deep black shadows
- Should read as "pile of rocks" even at 64x64
- Muted desaturated military tones, NOT vibrant

Transparent PNG, no checkered background. Everything that is not the rocks must be fully transparent alpha.
```

---

## BOULDER — Type 3: Shelf Outcrop (outcrop)

```
A wide flat slab of exposed bedrock with stepped ledge edges, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

SHAPE AND SILHOUETTE:
- A WIDE, FLAT rock shelf — clearly the widest/most horizontal of the boulder types
- Fills 70-80% of frame WIDTH, but only 40-50% of frame HEIGHT (landscape orientation)
- Roughly 2:1 width-to-height ratio — dramatically elongated
- The defining feature is STEPPED EDGES — the long sides have a stair-step silhouette
- The steps are GEOMETRIC and BOLD — 8-12px step depths at 256px scale
- Think of it like a top-down view of layered sedimentary rock breaking away in rectangular chunks
- The short ends are more irregular/rough
- Rotated roughly 15-25 degrees off horizontal (not perfectly aligned with canvas edges)

LEDGE STEPS:
- 2-3 distinct ledge levels visible from above
- Each level is a slightly different tone (representing height)
- The step edges cast BOLD dark shadows — the darkest lines in the sprite
- Shadow lines along step edges are 2-3px wide

SURFACE:
- Each ledge level is ONE flat color — no surface texture
- 3-4 visible strata lines (thin dark lines) running parallel across the surface
- Strata lines are thinner than ledge shadows (1-2px) but still clearly visible
- MINIMAL detail — the visual interest is all in the SHAPE and LEDGES

STRICTLY top-down view, camera PERFECTLY perpendicular to ground, exactly 90 degrees
NO visible sides — ledges shown ONLY through shadow lines and tone differences between levels

COLOR PALETTE (use only these):
  - Ledge shadow/strata: #1a1a18, #252220 (bold dark step edges)
  - Lowest level: #3a3530, #403a35 (darkest, deepest ledge)
  - Middle level: #555050, #5a5550 (mid tone)
  - Top level: #656058, #6a6560 (lightest, highest surface)
  - Step shadow: #1a1a18 (bold dark line along each step)
  - NO highlight brighter than #6a6560

STYLE:
- CHUNKY pixel art — geometric stepped edges are key
- The stair-step silhouette must be clearly readable
- High contrast at ledge edges
- Should read as "flat rock shelf" even at 64x64 — distinct from the other boulder types
- Muted desaturated military tones, NOT vibrant

Transparent PNG, no checkered background. Everything that is not the outcrop must be fully transparent alpha.
```

---

## ROCK PARTICLES (Angular Frost-Shattered Fragments)

```
Small scattered angular rock fragments in 4 corners on a 256x256 pixel canvas, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- 256x256 pixel image
- EXACTLY 4 small rock clusters, ONE in each corner
- Each cluster: 1 larger fragment (8-12px) + 2-3 smaller chips (3-6px)
- Clusters positioned near corners, not touching edges
- CENTER IS EMPTY — no rocks in the middle 60% of the frame
- Clusters spread loosely — fragments are NOT touching, leave small gaps
- These are NOT smooth river pebbles — they are ANGULAR fragments from freeze-thaw weathering
- Each piece has FLAT FACES meeting at SHARP ANGLES — like broken pottery, not like marbles
- Shapes should be: triangular, trapezoidal, rhomboid — NEVER circular or oval
- Each fragment shows one light face and one dark face (two-tone minimum per rock)
- Some fragments are THIN AND FLAT (like slate chips), others are chunky
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- NO perspective, NO angle, NO 3D depth - completely flat overhead view
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)

EXACT CLUSTER COMPOSITIONS:
- TOP-LEFT: One elongated triangular shard + two small chips
- TOP-RIGHT: One chunky trapezoidal piece + one thin flat chip + one small chunk
- BOTTOM-LEFT: One broad flat fragment + two tiny angular chips
- BOTTOM-RIGHT: One angular rhomboid piece + one thin shard + one small chip

EXACT COLOR PALETTE (use only these colors):
  - Dark faces/cracks: #2a2520, #353030 (shadow side of fragments)
  - Mid stone: #555050, #5a5550 (main fragment body)
  - Light faces: #706a65, #7a7570 (sun-facing fracture surfaces)

- STRONG CONTRAST: Very deep dark shadows on shadow faces of fragments, brighter highlights on sun-facing fracture surfaces
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Angular silhouettes — SHARP CORNERS, not rounded blobs
- 70% of frame is transparent/empty (center area)

Transparent PNG, no checkered background.
```

---

## ROCK FLOOR (Rocky Ground Texture)

These replace the debris sprites currently used as boulder floor textures. They represent exposed rocky ground — thin soil over bedrock with embedded stones, gravel patches, and weathering cracks.

### Rock Floor — Variant 1: Embedded Stones

```
Rocky ground texture with small stones partially embedded in dirt in 4 corners on a 256x256 pixel canvas, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- 256x256 pixel image
- EXACTLY 4 clusters of embedded stones, ONE in each corner
- Each cluster: 2-3 partially buried stones + a few gravel specks
- CENTER IS EMPTY — this is a floor sprite, items overlap to create continuous coverage
- Clusters positioned near corners, not touching edges
- Thin soil layer with 5-7 small stones PARTIALLY BURIED, only their top surfaces exposed
- Stones are flush with the ground surface — NOT sitting on top, they're embedded IN the dirt
- Each stone: irregular angular shape, 8-15px at 256px scale
- A few tiny gravel specks (2-3px) scattered between the larger stones
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)

EXACT COLOR PALETTE (use only these colors):
  - Dirt: #3a3025, #453a30 (brown earth around stones)
  - Stone shadow: #2a2520, #353030 (where stone meets dirt — shadow line)
  - Stone mid: #555050, #5a5550 (exposed stone surfaces)
  - Stone light: #656058, #6a6560 (sun-facing stone tops)
  - Gravel specks: #4a4540 (tiny scattered dots)

- STRONG CONTRAST: Very deep dark shadows where stones meet dirt, brighter highlights on sun-facing stone tops
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Each embedded stone is 2-3 flat colors, NOT smooth gradients
- 65% of frame is transparent/empty (center area)

PLACEMENT: 4 corners only. Center empty.

Transparent PNG, no checkered background.
```

### Rock Floor — Variant 2: Cracked Bedrock

```
Cracked bedrock surface patches in 4 corners on a 256x256 pixel canvas, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- 256x256 pixel image
- EXACTLY 4 rock surface patches, ONE in each corner
- Each patch: an irregular polygon of exposed bedrock with cracks running through it
- Patches are 40-60px across at 256px scale
- CENTER IS EMPTY
- Patches not touching edges
- Flat rock surface with a network of WEATHERING CRACKS (joint patterns)
- Cracks divide the surface into 3-5 irregular polygonal sections
- Cracks are DARK and BOLD — 2-3px wide at 256px
- Each polygon section between cracks is a slightly different tone (weathering variation)
- One or two small dark pits (weathering holes) in the surface
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)

EXACT COLOR PALETTE (use only these colors):
  - Cracks/pits: #1a1a18, #252220 (dark fracture lines)
  - Dark rock: #3a3530, #454040 (shadowed sections)
  - Mid rock: #555050, #5a5550 (main surface)
  - Light rock: #605a55, #656058 (lighter sections)

- STRONG CONTRAST: Very deep dark shadows in cracks and pits, brighter highlights on sun-facing rock surfaces
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Each polygon between cracks is ONE flat color (no gradients)
- 65% of frame is transparent/empty (center area)

PLACEMENT: 4 corners only. Center empty.

Transparent PNG, no checkered background.
```

### Rock Floor — Variant 3: Gravel Scatter

```
Loose gravel and small angular rock scatter in 4 corners on a 256x256 pixel canvas, viewed from directly above, modern pixel art style with chunky defined pixels. Transparent PNG with alpha channel.

- 256x256 pixel image
- EXACTLY 4 gravel clusters, ONE in each corner
- Each cluster: a loose group of 4-7 gravel pieces of mixed sizes
- Pieces within each cluster are NOT tightly packed — visible gaps between them
- CENTER IS EMPTY
- Clusters near corners, not touching edges
- Loose angular gravel pieces — like the base of a cliff or eroding hillside
- Mix of sizes: some 6-10px, many 3-5px, a few tiny 2px specks
- ALL pieces are ANGULAR — sharp edges, flat faces, NOT rounded
- Varied orientations — rotated randomly
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)

EXACT COLOR PALETTE (use only these colors):
  - Dark faces: #2a2520, #353030 (shadow sides)
  - Mid stone: #4a4540, #555050 (mid tones)
  - Light faces: #656058, #706a65 (sun-facing surfaces)
  - Tiny specks: #454040 (smallest gravel, single color)

- STRONG CONTRAST: Very deep dark shadows on shadow faces, brighter highlights on sun-facing surfaces
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Larger pieces get 2 tones (light face + dark face), smallest are single color
- 75% of frame is transparent/empty (center area)

PLACEMENT: 4 corners only. Center empty.

Transparent PNG, no checkered background.
```

---

## ROCK GROUND (Base Terrain Tile — Future)

These are for potential future rocky ground tiles (like terrain-grass or terrain-dirt but for rocky terrain). NOT needed for the current boulder tool — included here for reference.

### Rock Ground — Variant 1: Rocky Dirt

```
Rocky dirt ground tile viewed from directly above, modern pixel art style with chunky defined pixels. FULL COVERAGE — NO transparency, the entire 256x256 canvas is filled.

- Compacted dirt with many small stones embedded throughout
- NOT transparent — this is a ground TILE that fills the entire square
- 60% dirt, 40% visible stone surface
- Stones are irregularly distributed — some clustered, some isolated
- Stone sizes: 4-12px at 256px scale
- Angular stone shapes, NOT rounded
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Dirt dark: #302a22, #3a3028 (shadow dirt)
  - Dirt mid: #453a30, #4a4035 (main dirt)
  - Dirt light: #554a3a, #5a5040 (lighter dirt patches)
  - Stone dark: #353030, #403a35 (shadowed stone)
  - Stone mid: #555050, #5a5550 (exposed stone)
  - Stone light: #605a55, #656058 (lit stone surfaces)
- STRONG CONTRAST: Very deep dark shadows around embedded stones, brighter highlights on sun-facing stone surfaces
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Stones are simple 2-3 flat color shapes, NOT smooth gradients

MUST TILE SEAMLESSLY. Entire canvas filled — no transparency.
```

### Rock Ground — Variant 2: Bare Bedrock

```
Bare bedrock ground tile viewed from directly above, modern pixel art style with chunky defined pixels. FULL COVERAGE — NO transparency, the entire 256x256 canvas is filled.

- A continuous flat rock surface — like a mountain path or exposed rock shelf
- Network of weathering cracks dividing surface into irregular polygons
- Cracks are 2px wide, dark, forming a subtle grid/web pattern
- Each polygon slightly different tone — natural color variation in rock
- No soil visible — this is pure exposed rock
- Occasional dark pit or stain (lichen, water stain)
- STRICTLY top-down view, camera PERFECTLY perpendicular to ground, EXACTLY 90 degrees
- Muted desaturated tones - subdued military color palette
- NOT vibrant
- Light source directly overhead (noon)
- EXACT COLOR PALETTE (use only these colors):
  - Crack lines: #1a1a18, #252220 (bold dark cracks)
  - Dark rock: #3a3530, #403a35 (darker polygon sections)
  - Mid rock: #4a4540, #555050 (main surface — LARGEST area)
  - Light rock: #5a5550, #605a55 (lighter sections)
  - Stain/lichen: #3a3d30 (rare muted green-gray spots)
- STRONG CONTRAST: Very deep dark shadows in crack network and pits, brighter highlights on sun-facing polygon surfaces
- Shadows should be nearly black, not washed out
- Chunky pixel art aesthetic, not photorealistic
- Each polygon is one flat color — no gradients

MUST TILE SEAMLESSLY. Entire canvas filled — no transparency.
```

---

## Post-Processing

Save originals (1024x1024) to their respective `originals/` folder, then resize:

```bash
# Boulders (in sprites/terrain/boulders/)
cd sprites/terrain/boulders
magick originals/erratic-1.png -filter point -resize 256x256 resized/erratic-1.png
magick originals/field-1.png -filter point -resize 256x256 resized/field-1.png
magick originals/outcrop-1.png -filter point -resize 256x256 resized/outcrop-1.png

# Rock particles (in sprites/terrain/particles/)
cd sprites/terrain/particles
magick originals/rock-1.png -filter point -resize 256x256 resized/rock-1.png
magick originals/rock-2.png -filter point -resize 256x256 resized/rock-2.png
magick originals/rock-3.png -filter point -resize 256x256 resized/rock-3.png

# Rock floor (in sprites/terrain/floor/) — uses 'rock-' prefix
cd sprites/terrain/floor
magick originals/rock-1.png -filter point -resize 256x256 resized/rock-1.png
magick originals/rock-2.png -filter point -resize 256x256 resized/rock-2.png
magick originals/rock-3.png -filter point -resize 256x256 resized/rock-3.png

# Rock ground tiles (in sprites/terrain/ground/) — for future use
cd sprites/terrain/ground
magick originals/terrain-rock-1.png -filter point -resize 256x256 resized/terrain-rock-1.png
magick originals/terrain-rock-2.png -filter point -resize 256x256 resized/terrain-rock-2.png
magick originals/terrain-rock-3.png -filter point -resize 256x256 resized/terrain-rock-3.png
```

### Quality Checklist
1. **Chunky pixels** — Generate at 1024x1024 using 4x4 pixel blocks, then resize
2. **Use nearest-neighbor** — `-filter point` preserves hard pixel edges
3. **Check transparency** — Background must be fully transparent (except ground tiles)
4. **Verify color palette** — Muted military stone tones only, no vibrant colors
5. **Top-down only** — No visible rock sides or 3D perspective
6. **Distinct silhouettes** — Each boulder type must have a COMPLETELY different outline shape
7. **Big on canvas** — Boulders fill 65-80% of frame, not small blobs
8. **Bold simple features** — One or two defining details per rock, not surface noise
9. **Flat color areas** — No smooth gradients; stepped tones with hard transitions
10. **Readable at small size** — Test at 64x64; shapes should still be clearly identifiable and distinguishable from each other

### Common AI Generation Mistakes to Watch For
- **Too small on canvas** — The #1 problem. Boulders should DOMINATE the frame, not sit in the middle with lots of empty space.
- **All same shape** — If you squint and can't tell the three types apart, regenerate. They need DRAMATICALLY different outlines.
- **Too much surface detail** — Keep it CHUNKY. One big crack beats ten small ones.
- **Smooth gradients** — Each face should be ONE flat color. If you see smooth shading, regenerate.
- **Visible sides/3D** — Must be strictly top-down. If you can see the side of the rock, regenerate.
- **Potato shapes** — Rocks should NOT be smooth oval blobs. Angular edges, stepped ledges, complex outlines.
- **Anti-aliased edges** — Silhouette edges must be crisp pixel staircase, no soft/blurred edges.

---

## File Naming

```
sprites/terrain/boulders/
  originals/
    erratic-1.png        (1024x1024, split megalith)
    field-1.png          (1024x1024, rock cluster)
    outcrop-1.png        (1024x1024, shelf outcrop)
  resized/
    erratic-1.png        (256x256, split megalith)
    field-1.png          (256x256, rock cluster)
    outcrop-1.png        (256x256, shelf outcrop)

sprites/terrain/particles/
  originals/
    rock-1.png           (1024x1024, angular fragments variant 1)
    rock-2.png           (1024x1024, angular fragments variant 2)
    rock-3.png           (1024x1024, angular fragments variant 3)
  resized/
    rock-1.png           (256x256, angular fragments variant 1)
    rock-2.png           (256x256, angular fragments variant 2)
    rock-3.png           (256x256, angular fragments variant 3)

sprites/terrain/floor/
  originals/
    rock-1.png           (1024x1024, embedded stones)
    rock-2.png           (1024x1024, cracked bedrock)
    rock-3.png           (1024x1024, gravel scatter)
  resized/
    rock-1.png           (256x256, embedded stones)
    rock-2.png           (256x256, cracked bedrock)
    rock-3.png           (256x256, gravel scatter)

sprites/terrain/ground/  (future — not needed yet)
  originals/
    terrain-rock-1.png   (1024x1024, rocky dirt)
    terrain-rock-2.png   (1024x1024, bare bedrock)
    terrain-rock-3.png   (1024x1024, variant 3 TBD)
  resized/
    terrain-rock-1.png   (256x256, rocky dirt)
    terrain-rock-2.png   (256x256, bare bedrock)
    terrain-rock-3.png   (256x256, variant 3 TBD)
```

## Code Integration Notes

The boulder tool and scatter system are already wired up with the current filenames (`erratic-1`, `field-1`, `outcrop-1`). After regenerating sprites:

1. **Boulder sprites** — Drop-in replacement. Same filenames. No code changes needed.
2. **Rock particles** (`rock-{1,2,3}.png`) — Drop-in replacement. Already served via `spriteBase: 'rock'` in `SCATTER_TYPES['particle-rock']`.
3. **Rock floor** (`rock-{1,2,3}.png` in floor/) — NEW sprites. Update `SCATTER_TYPES['floor-rock']` to use `spriteBase: 'rock'` instead of `spriteBase: 'debris'`:
   ```javascript
   'floor-rock': {
     category: 'floor', layer: 'ground',
     baseScale: 0.35, scaleVariance: 0.2,
     spacing: 0, variants: 3,
     fadeWithDistance: true, spriteBase: 'rock'  // was 'debris'
   }
   ```
4. **Rock ground tiles** — Future feature.

## Why Each Type Matters

- **Split megalith (erratic)** — The dramatic focal point. The big crack makes it instantly recognizable and visually interesting even alone. Reads as "massive immovable rock."
- **Rock cluster (field)** — Complex silhouette from multiple rocks creates visual variety. The gaps between rocks catch the eye. Reads as "rocky terrain" rather than a single object.
- **Shelf outcrop (outcrop)** — The wide horizontal shape contrasts strongly with the other two. Stepped ledge edges are geometric and distinctive. Reads as "natural platform" or "exposed bedrock."
- **Three completely different silhouettes** — Megalith is blocky, cluster is complex/lumpy, shelf is wide/flat. Instantly distinguishable at any zoom level.
