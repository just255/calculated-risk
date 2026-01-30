# Canopy Collision System

## Overview

A unified visibility/collision system for scatter items (trees, brush, floor, particles) that prevents wasted draw calls by ensuring items are never fully hidden under another item's canopy.

---

## Core Concept

Every tree and brush type has a `canopyRadius` value that defines its visual footprint. When placing items, we check if they would be fully hidden under an existing item's canopy.

**Universal Rule:**
```
distance > (A.canopyRadius * A.scale) - (B.canopyRadius * B.scale)
```

This ensures item B always "sticks out" from under item A's canopy (at least partially visible).

---

## canopyRadius Values

Each type defines its own `canopyRadius` in `SCATTER_TYPES`:

### Trees
| Type | canopyRadius | Notes |
|------|--------------|-------|
| tree-oak | 45 | Large full canopy |
| tree-pine | 30 | Narrower conical canopy |
| tree-birch | 28 | Medium canopy |
| tree-willow | 50 | Wide drooping canopy |
| tree-dead | 10 | Minimal - bare branches don't hide much |

### Brush
| Type | canopyRadius | Notes |
|------|--------------|-------|
| bush-small | 12 | Small shrub |
| bush-large | 18 | Larger shrub |
| fern | 10 | Low ground cover |
| reed | 8 | Thin vertical |

---

## Collision Rules by Category

### 1. Tree vs Tree
- Uses `spacing` value (not canopyRadius) for density packing
- **Spacing slider** (50%-150%) lets user scale tree-to-tree spacing
- Higher spacing = more room between trees
- Lower spacing = trees can be packed closer

### 2. Brush vs Brush
- Uses canopyRadius visibility rule
- Small canopyRadius values = can be close together
- Example: two bush-small items need `distance > 12 - 12 = 0` (can touch)

### 3. Brush vs Tree
- Brush must stick out from tree canopy
- Uses canopyRadius visibility rule
- Example: bush-small near oak needs `distance > (45 * oakScale) - (12 * bushScale)`
- Brush can be partially under canopy, but not fully hidden

### 4. Floor/Particles vs Trees
- Floor and particles check ALL nearby tree canopies (not just parent)
- If fully under any tree's canopy, skip placement (wasted draw call)
- Floor/particles from parent tree are fine (intended to be under parent)
- But if they'd be hidden under a NEIGHBORING tree, reject them

---

## UI Controls

### Trees Panel
- **Density** (0.5× to 2.0×) - How many trees we attempt to place
- **Spacing** (50% to 150%) - Scales tree-to-tree spacing (NEW)
- **Scale** - Size of trees

### Brush Panel
- **Density** (0× to 2.0×) - How many brush we attempt to place
- **Scale** - Size of brush
- (No spacing slider - brush respects tree canopies automatically)

### Floor/Particles Panels
- Unchanged - they spawn as children and respect canopy occlusion

---

## Implementation Checklist

### 1. season-config.js
- [ ] Add `canopyRadius` to all tree types (oak: 45, pine: 30, birch: 28, willow: 50, dead: 10)
- [ ] Add `canopyRadius` to all brush types (bush-small: 12, bush-large: 18, fern: 10, reed: 8)

### 2. scatter.js - generateScatter()
- [ ] Tree vs Tree: use existing spacing logic (affected by new spacing slider)
- [ ] Brush vs Brush: use canopyRadius visibility rule
- [ ] Brush vs Tree: use canopyRadius visibility rule

### 3. scatter.js - spawnChildren()
- [ ] Floor/particles: check if fully under ANY tree's canopy (not just parent)
- [ ] Query spatial hash for nearby trees
- [ ] Skip if `distance < treeCanopy * treeScale - childCanopy * childScale`

### 4. terrain-editor.html
- [ ] Add Spacing slider to Trees panel (50% to 150%, default 100%)

### 5. editor.js
- [ ] Add element reference for spacing slider
- [ ] Add event handler: `setToolOption('treeSpacing', value)`

### 6. state.js
- [ ] Add `treeSpacing: 1.0` to DEFAULT_TOOL_OPTIONS
- [ ] Pass treeSpacing to generateScatter()

---

## Performance Notes

- Spatial hash already exists for O(1) nearby item lookup
- Canopy occlusion check for children adds minimal overhead
- Net result: FEWER items placed = FEWER draw calls = better performance

---

## Example Scenarios

### Dense Forest
- Density: 2.0×, Spacing: 75%
- Many tree attempts, packed tightly
- Brush fills gaps between trees
- Floor/particles only where visible

### Sparse Grove
- Density: 0.7×, Spacing: 125%
- Fewer trees, more spread out
- More room for brush
- Visible floor coverage

### Undergrowth Focus
- Tree Density: 0.5×, Brush Density: 2.0×
- Few trees, lots of brush
- Brush fills the space between sparse trees
