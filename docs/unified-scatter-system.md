# Unified Scatter System - Technical Reference

> A modular system for procedurally placing terrain elements (trees, floor patches, bushes, particles) with recursive child spawning.

---

## Implementation Status

### Toggle Switch
A "Use Scatter Rendering" checkbox in View Settings enables switching between:
- **Legacy rendering**: Uses `trees[]`, `brushes[]`, `particles[]`, `floorPatches[]` arrays
- **Scatter rendering**: Uses unified `scatterItems[]` array

**Note:** Both systems use dual-write - strokes populate both legacy arrays AND scatterItems. However, they use different random number generation, so the visual output differs between modes.

### Sprite Key Mapping

| Category | Scatter Type | Sprite Key | Example | Status |
|----------|-------------|------------|---------|--------|
| Tree | `tree-oak` | `{treeType}-{age}-{variant}` | `oak-old-2` | ✓ Exists |
| Floor | `floor-leaf` | `{type}-{variant}` | `floor-leaf-1` | Needs creation |
| Brush | `bush-small` | `{type}-{variant}` | `bush-small-1` | ✓ Exists |
| Brush | `fern` | `fern-small-{variant}` | `fern-small-1` | ✓ Exists |
| Particle | `particle-leaf` | `{particleType}-particles-{variant}` | `leaf-particles-1` | ✓ Exists |

### Current Sprite Status

| Category | Status | Notes |
|----------|--------|-------|
| Trees | ✓ Working | `oak`, `pine`, `birch`, `willow` with `young`, `old`, `transitional` ages |
| Floor | ✗ Missing | Directory empty - floor patches won't render |
| Brush | ✓ Working | `bush-small`, `bush-large`, `fern-small` |
| Particles | ✓ Working | `leaf-particles` in brush folder |

### Rotation Behavior

| Category | Rotation |
|----------|----------|
| Trees | 0° (upright) |
| Brush | 0° (upright) |
| Floor | Random 0-360° |
| Particles | Random 0-360° |

### Shared Category System

Children are shared by tree category (deciduous/conifer/dead), not per-tree-type:

| Tree Category | Trees | Floor | Brush | Particles |
|---------------|-------|-------|-------|-----------|
| Deciduous | oak, birch, willow | floor-leaf | bush-small, reed | particle-leaf |
| Conifer | pine | floor-needle | fern | particle-needle |
| Dead | dead | floor-debris | dead-brush | particle-twig |

### Required Sprites

Only 3 sets of floor/particle sprites needed:

```
sprites/terrain/
├── trees/resized/{type}/
│   └── {type}-{age}-{variant}.png     # oak-old-1.png (existing)
├── floor/
│   ├── floor-leaf-{variant}.png       # deciduous leaf litter
│   ├── floor-needle-{variant}.png     # pine needle carpet
│   └── floor-debris-{variant}.png     # dead twigs/bark
├── brush/resized/
│   ├── bush-small-{variant}.png       # (existing)
│   ├── bush-large-{variant}.png       # (existing)
│   ├── fern-small-{variant}.png       # (existing)
│   ├── reed-{variant}.png             # wetland brush
│   └── dead-brush-{variant}.png       # dead undergrowth
└── (particles in brush/resized/)
    ├── leaf-particles-{variant}.png   # (existing)
    ├── needle-particles-{variant}.png # conifer needles
    └── twig-particles-{variant}.png   # dead debris
```

### Scale Handling

Each spawn rule has built-in scale defaults:
```javascript
'tree-oak': {
  spawns: [
    { type: 'floor-leaf', scale: 0.12, density: 8, ... },
    { type: 'bush-small', scale: 0.08, density: 1, ... },
    { type: 'particle-leaf', scale: 0.12, density: 5, ... }
  ]
}
```

Final scale: `childConfig.baseScale * scaleRand * spawnRule.scale`

---

## Core Concept

All terrain scatter items share the same fundamental behavior:
1. **Scatter** sprites within or around an area
2. **Configure** density, scale, spacing, and layer
3. **Optionally spawn** child items recursively
4. **Transform** over time for animation (optional)

This system consolidates trees, floor patches, brushes, and particles into a single unified architecture.

---

## Data Structures

### ScatterItem

Every scattered element uses this structure:

```javascript
{
  // === Identity ===
  id: 'scatter_abc123',           // Unique identifier
  type: 'tree-oak',               // Type key from SCATTER_TYPES

  // === Hierarchy ===
  strokeId: 'stroke_xyz789',      // Root stroke that created this item
  parentId: null,                 // Parent scatter item ID (for children)
                                  // null = top-level item

  // === Transform ===
  x: 300,                         // World X position
  y: 200,                         // World Y position
  scale: 0.35,                    // Size multiplier (1.0 = base size)
  rotation: 45,                   // Degrees (0-360)
  alpha: 1.0,                     // Opacity (0.0-1.0)

  // === Visual ===
  variant: 1,                     // Sprite variant (1, 2, 3...)
  hueShift: 5,                    // Degrees (-180 to 180)
  brightness: 1.05,               // Multiplier (1.0 = normal)
  saturation: 0.95,               // Multiplier (1.0 = normal)

  // === Type-Specific Metadata ===
  age: 'old',                     // Trees: 'young' | 'old' | 'transitional'
  isDead: false,                  // Trees: dead variant flag

  // === Runtime (not serialized) ===
  _animState: null,               // Animation phase/state
  _renderX: null,                 // Animated X position
  _renderY: null,                 // Animated Y position
  _renderRotation: null           // Animated rotation
}
```

### SCATTER_TYPES

Type definitions that control generation and rendering behavior:

```javascript
SCATTER_TYPES: {
  // === TREE TYPES ===
  'tree-oak': {
    category: 'tree',             // tree | brush | floor | particle
    layer: 'canopy',              // ground | canopy
    baseScale: 1.0,               // Default scale multiplier
    scaleVariance: 0.3,           // Random scale range (+/-)
    spacing: 50,                  // Minimum distance between items (px)
                                  // 0 = no collision checking
    variants: 3,                  // Number of sprite variants
    ages: ['young', 'old', 'transitional'],  // Age variants (trees only)

    // Sprite path pattern: sprites/terrain/{category}/{type}-{age}-{variant}.png
    // Example: sprites/terrain/trees/tree-oak-old-1.png

    spawns: ['floor-oak', 'bush-small', 'particle-leaf']  // Auto-spawn types
  },

  'tree-pine': {
    category: 'tree',
    layer: 'canopy',
    baseScale: 1.0,
    scaleVariance: 0.25,
    spacing: 45,
    variants: 3,
    ages: ['young', 'old', 'transitional'],
    spawns: ['floor-pine', 'bush-fern', 'particle-needle']
  },

  'tree-birch': {
    category: 'tree',
    layer: 'canopy',
    baseScale: 0.9,
    scaleVariance: 0.2,
    spacing: 40,
    variants: 3,
    ages: ['young', 'old', 'transitional'],
    spawns: ['floor-birch', 'bush-small']
  },

  'tree-willow': {
    category: 'tree',
    layer: 'canopy',
    baseScale: 1.1,
    scaleVariance: 0.3,
    spacing: 60,
    variants: 3,
    ages: ['young', 'old'],
    spawns: ['floor-damp', 'bush-reed']
  },

  'tree-dead': {
    category: 'tree',
    layer: 'canopy',
    baseScale: 0.85,
    scaleVariance: 0.35,
    spacing: 55,
    variants: 3,
    ages: null,                   // No age variants
    spawns: ['floor-bare']        // Minimal spawns
  },

  // === FLOOR TYPES ===
  'floor-oak': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.4,
    scaleVariance: 0.15,
    spacing: 0,                   // No collision
    variants: 3,
    fadeWithDistance: true,       // Alpha decreases toward edge
    spawns: []                    // Leaf node, no children
  },

  'floor-pine': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.35,
    scaleVariance: 0.1,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true,
    spawns: []
  },

  'floor-birch': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.38,
    scaleVariance: 0.12,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true,
    spawns: []
  },

  'floor-damp': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.42,
    scaleVariance: 0.18,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true,
    spawns: []
  },

  'floor-bare': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.35,
    scaleVariance: 0.2,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true,
    spawns: []
  },

  'floor-mixed': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.4,
    scaleVariance: 0.15,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true,
    spawns: []
  },

  // === BRUSH TYPES ===
  'bush-small': {
    category: 'brush',
    layer: 'canopy',
    baseScale: 0.25,
    scaleVariance: 0.1,
    spacing: 15,
    variants: 3,
    spawns: []
  },

  'bush-fern': {
    category: 'brush',
    layer: 'canopy',
    baseScale: 0.3,
    scaleVariance: 0.12,
    spacing: 12,
    variants: 3,
    spawns: []
  },

  'bush-reed': {
    category: 'brush',
    layer: 'canopy',
    baseScale: 0.35,
    scaleVariance: 0.15,
    spacing: 10,
    variants: 3,
    spawns: []
  },

  // === PARTICLE TYPES ===
  'particle-leaf': {
    category: 'particle',
    layer: 'canopy',
    baseScale: 0.08,
    scaleVariance: 0.03,
    spacing: 0,
    variants: 3,
    animate: {
      type: 'sway',
      speed: 0.5,
      amplitude: { x: 3, y: 1, rotation: 5 }
    },
    spawns: []
  },

  'particle-needle': {
    category: 'particle',
    layer: 'canopy',
    baseScale: 0.06,
    scaleVariance: 0.02,
    spacing: 0,
    variants: 3,
    animate: {
      type: 'drift',
      speed: 0.3,
      amplitude: { x: 2, y: 2, rotation: 3 }
    },
    spawns: []
  }
}
```

### SPAWN_RULES

Defines how parent items spawn child items:

```javascript
SPAWN_RULES: {
  'tree-oak': {
    spawns: [
      {
        type: 'floor-oak',
        density: 8,                    // Items per parent
        densityVariance: 3,            // Random variance (+/-)
        distribution: 'under-canopy',  // Placement pattern
        radiusMultiplier: 1.2,         // Relative to parent size
        alphaFade: true                // Fade toward edges
      },
      {
        type: 'bush-small',
        density: 2,
        densityVariance: 1,
        distribution: 'ring',          // Around edge
        minRadius: 0.8,                // Inner boundary (% of parent)
        maxRadius: 1.3                 // Outer boundary
      },
      {
        type: 'particle-leaf',
        density: 5,
        densityVariance: 2,
        distribution: 'ring',
        minRadius: 0.9,
        maxRadius: 1.5,
        animate: true
      }
    ]
  },

  'tree-pine': {
    spawns: [
      { type: 'floor-pine', density: 10, distribution: 'under-canopy' },
      { type: 'bush-fern', density: 3, distribution: 'ring', minRadius: 0.7 },
      { type: 'particle-needle', density: 4, distribution: 'ring' }
    ]
  },

  'tree-birch': {
    spawns: [
      { type: 'floor-birch', density: 6, distribution: 'under-canopy' },
      { type: 'bush-small', density: 1, distribution: 'ring', minRadius: 0.9 }
    ]
  },

  'tree-willow': {
    spawns: [
      { type: 'floor-damp', density: 12, distribution: 'under-canopy' },
      { type: 'bush-reed', density: 4, distribution: 'ring', minRadius: 0.6 }
    ]
  },

  'tree-dead': {
    spawns: [
      { type: 'floor-bare', density: 4, distribution: 'under-canopy' }
    ]
  }
}
```

---

## Distribution Patterns

### under-canopy
Items placed randomly within the parent's coverage area, concentrated toward center.

```
      . . .
    . . . . .
   . . [P] . .    P = Parent center
    . . . . .     . = Possible child positions
      . . .
```

### ring
Items placed in a ring around the parent, between minRadius and maxRadius.

```
    .   .   .
  .           .
 .     [P]     .   P = Parent center
  .           .    . = Possible child positions
    .   .   .
```

### scatter
Pure random distribution within radius (no center bias).

### cluster
Grouped clusters at random positions within radius.

---

## API Reference

### Generation Functions

#### generateScatter(terrainMap, source, type, options)

Main entry point for generating scatter items.

**Parameters:**
- `terrainMap` - The terrain map object containing scatterItems[]
- `source` - Area definition: `{ x, y, radius }` or stroke object
- `type` - Type key from SCATTER_TYPES (e.g., 'tree-oak')
- `options` - Generation options:
  ```javascript
  {
    density: 5,           // Items per unit area (overrides type default)
    scale: 1.0,           // Scale multiplier
    seed: 12345,          // Random seed for reproducibility
    parent: null,         // Parent ScatterItem (for recursive spawning)
    spawnChildren: true,  // Whether to auto-spawn children
    maxDepth: 3           // Maximum recursion depth
  }
  ```

**Returns:** Array of created ScatterItem objects

**Example:**
```javascript
// Generate oak trees for a stroke
const trees = generateScatter(terrainMap, stroke, 'tree-oak', {
  density: 5,
  scale: 0.8
});

// Generate floor patches around a specific tree
const floor = generateScatter(terrainMap,
  { x: tree.x, y: tree.y, radius: 60 },
  'floor-oak',
  { parent: tree, density: 8 }
);
```

#### spawnChildren(terrainMap, parent, options)

Recursively spawns child items based on SPAWN_RULES.

**Parameters:**
- `terrainMap` - The terrain map object
- `parent` - Parent ScatterItem
- `options` - Spawn options:
  ```javascript
  {
    depth: 1,             // Current recursion depth
    maxDepth: 3,          // Maximum depth
    seed: null            // Random seed
  }
  ```

**Returns:** Array of all spawned child items (flattened)

### Removal Functions

#### removeScatterByStroke(terrainMap, strokeId)

Removes all scatter items associated with a stroke (cascades to children).

**Returns:** Number of items removed

#### removeScatterByParent(terrainMap, parentId)

Removes all items with the given parentId.

**Returns:** Number of items removed

#### removeScatterInRadius(terrainMap, x, y, radius, options)

Removes items within a circular area.

**Options:**
```javascript
{
  categories: ['tree'],   // Only remove these categories (null = all)
  cascade: true           // Also remove children of removed items
}
```

**Returns:** Number of items removed

### Query Functions

#### getScatterByLayer(terrainMap, layer)

Returns all items for a render layer ('ground' or 'canopy').

#### getScatterByCategory(terrainMap, category)

Returns all items of a category ('tree', 'floor', 'brush', 'particle').

#### getScatterSorted(terrainMap, sortBy)

Returns items sorted for rendering.

**sortBy options:**
- `'y'` - Sort by Y position (back to front)
- `'scale'` - Sort by scale (small to large)
- `'scale-y'` - Sort by scale, then Y (default for canopy)

---

## Rendering

### Layer Order

```
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: CANOPY (Trees + Brush)                         │
│   Tree crowns, large bushes - the "ceiling"             │
│   Animate: Optional wind sway (future polish)           │
│   Baking: Per-tree (fast edits)                         │
├─────────────────────────────────────────────────────────┤
│ LAYER 2: PARTICLES (Under canopy)                       │
│   Floating/falling leaves, dust, drifting debris        │
│   Animate: YES - sway, drift (core visual life)         │
├─────────────────────────────────────────────────────────┤
│ LAYER 1: UNITS (Game entities - not scatter system)     │
│   Tanks, soldiers - move through the space              │
├─────────────────────────────────────────────────────────┤
│ LAYER 0: GROUND (Floor patches)                         │
│   Fallen leaves, pine needles, debris                   │
│   Animate: NO - static                                  │
│   Baking: Single layer cache (rarely changes)           │
└─────────────────────────────────────────────────────────┘
```

### Baking Strategy (Hybrid)

| Layer | Baking Approach | Reason |
|-------|-----------------|--------|
| Ground | Single layer cache | Static, no animation, rarely edited independently |
| Canopy | Per-tree baking | Fast edits (only re-render changed trees) |

### Render Function

```javascript
renderScatterLayer(ctx, items, images, options = {}) {
  const { animate = false, time = 0 } = options;

  for (const item of items) {
    const config = SCATTER_TYPES[item.type];
    const spriteKey = getSpriteKey(item);
    const img = images[config.category][spriteKey];

    if (!img) continue;

    // Get render position (animated or static)
    let rx = item.x, ry = item.y, rrot = item.rotation;
    if (animate && config.animate) {
      updateScatterAnimation(item, time);
      rx = item._renderX ?? item.x;
      ry = item._renderY ?? item.y;
      rrot = item._renderRotation ?? item.rotation;
    }

    // Calculate dimensions
    const baseSize = img.width;
    const size = baseSize * item.scale * config.baseScale;

    // Apply transforms and draw
    ctx.save();
    ctx.globalAlpha = item.alpha;
    ctx.translate(rx, ry);
    ctx.rotate(rrot * Math.PI / 180);

    // Color adjustments
    if (item.hueShift || item.brightness !== 1 || item.saturation !== 1) {
      ctx.filter = `
        hue-rotate(${item.hueShift || 0}deg)
        brightness(${item.brightness || 1})
        saturate(${item.saturation || 1})
      `;
    }

    ctx.drawImage(img, -size/2, -size/2, size, size);
    ctx.restore();
  }
}
```

### Sprite Key Resolution

```javascript
function getSpriteKey(item) {
  const config = SCATTER_TYPES[item.type];

  // Trees have age variants
  if (config.ages && item.age) {
    return `${item.type}-${item.age}-${item.variant}`;
  }

  // Other types just have numbered variants
  return `${item.type}-${item.variant}`;
}
```

---

## Animation System

### Animation Types

| Type | Description | Use Case |
|------|-------------|----------|
| `sway` | Gentle back-and-forth motion | Leaves, light bushes |
| `drift` | Slow floating movement | Falling particles |
| `pulse` | Scale oscillation | Glowing effects |
| `flicker` | Random alpha changes | Fireflies, sparks |

### Animation Config

```javascript
animate: {
  type: 'sway',
  speed: 0.5,              // Cycles per second
  amplitude: {
    x: 3,                  // Pixels of X movement
    y: 1,                  // Pixels of Y movement
    rotation: 5            // Degrees of rotation
  }
}
```

### Runtime Animation

```javascript
function updateScatterAnimation(item, time) {
  const config = SCATTER_TYPES[item.type].animate;
  if (!config) return;

  // Initialize phase once (creates variation between items)
  if (!item._animState) {
    item._animState = { phase: Math.random() * Math.PI * 2 };
  }

  const t = time * config.speed * 0.001 + item._animState.phase;

  switch (config.type) {
    case 'sway':
      item._renderX = item.x + Math.sin(t) * config.amplitude.x;
      item._renderY = item.y + Math.cos(t * 0.7) * config.amplitude.y;
      item._renderRotation = item.rotation +
        Math.sin(t * 1.3) * config.amplitude.rotation;
      break;

    case 'drift':
      item._renderX = item.x + Math.sin(t * 0.8) * config.amplitude.x;
      item._renderY = item.y + (t % 100) * 0.1;  // Slow downward drift
      item._renderRotation = item.rotation +
        Math.sin(t * 0.5) * config.amplitude.rotation;
      break;

    case 'pulse':
      item._renderScale = item.scale *
        (1 + Math.sin(t) * 0.1);  // 10% scale oscillation
      break;

    case 'flicker':
      item._renderAlpha = item.alpha *
        (0.7 + Math.random() * 0.3);
      break;
  }
}
```

---

## Collision Detection

### Spacing Algorithm

Items with `spacing > 0` use collision detection to prevent overlap:

```javascript
function canPlaceItem(terrainMap, x, y, type) {
  const config = SCATTER_TYPES[type];
  if (config.spacing === 0) return true;  // No collision

  const minDist = config.spacing;

  // Check against existing items of same category
  for (const item of terrainMap.scatterItems) {
    if (SCATTER_TYPES[item.type].category !== config.category) continue;

    const dx = item.x - x;
    const dy = item.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) return false;
  }

  return true;
}
```

### Placement Retry

When placing items with collision:

```javascript
const MAX_PLACEMENT_ATTEMPTS = 20;

function placeWithCollision(terrainMap, bounds, type, rng) {
  for (let i = 0; i < MAX_PLACEMENT_ATTEMPTS; i++) {
    const x = bounds.x + (rng() - 0.5) * bounds.radius * 2;
    const y = bounds.y + (rng() - 0.5) * bounds.radius * 2;

    if (canPlaceItem(terrainMap, x, y, type)) {
      return { x, y };
    }
  }
  return null;  // Failed to place
}
```

---

## Serialization

### Save Format (Version 5)

```javascript
{
  version: 5,
  strokes: [...],
  scatterItems: [
    {
      id: 'scatter_abc',
      type: 'tree-oak',
      strokeId: 'stroke_xyz',
      parentId: null,
      x: 300,
      y: 200,
      scale: 0.35,
      rotation: 45,
      alpha: 1.0,
      variant: 1,
      hueShift: 5,
      brightness: 1.05,
      saturation: 0.95,
      age: 'old'
    },
    // ... more items
  ]
}
```

### Migration from Version 4

```javascript
function migrateV4ToV5(data) {
  const scatterItems = [];

  // Convert trees
  for (const tree of data.trees || []) {
    scatterItems.push({
      id: tree.id || generateId(),
      type: `tree-${tree.type}`,
      strokeId: tree.strokeId,
      parentId: null,
      x: tree.x,
      y: tree.y,
      scale: tree.scale,
      rotation: tree.rotation || 0,
      alpha: 1.0,
      variant: tree.variant,
      hueShift: tree.hueShift,
      brightness: tree.brightness,
      saturation: tree.saturation,
      age: tree.age
    });
  }

  // Convert floor patches
  for (const patch of data.floorPatches || []) {
    scatterItems.push({
      id: patch.id || generateId(),
      type: patch.floorType,
      strokeId: patch.strokeId,
      parentId: patch.treeId || null,
      x: patch.x,
      y: patch.y,
      scale: patch.scale,
      rotation: patch.rotation,
      alpha: patch.alpha,
      variant: patch.variant,
      hueShift: 0,
      brightness: 1,
      saturation: 1
    });
  }

  // Convert brushes and particles similarly...

  return {
    version: 5,
    strokes: data.strokes,
    scatterItems
  };
}
```

---

## PCG Integration

### Seed-Based Generation

```javascript
function generateBattlefield(seed, biome, options = {}) {
  const terrainMap = createTerrainMap(options.width, options.height);
  const rng = seededRandom(seed);

  // 1. Generate feature cluster positions
  const clusterSeeds = poissonDiskSample(
    options.width, options.height,
    options.minClusterSpacing || 80,
    rng
  );

  // 2. For each cluster, generate trees (recursive spawning handles rest)
  for (const pos of clusterSeeds) {
    const treeType = selectBiomeTree(biome, rng);
    const radius = 60 + rng() * 80;
    const density = 4 + rng() * 4;

    generateScatter(terrainMap, {
      x: pos.x,
      y: pos.y,
      radius,
      seed: Math.floor(rng() * 1000000)
    }, treeType, {
      density,
      spawnChildren: true  // Auto-generates floor, bushes, particles
    });
  }

  return terrainMap;
}
```

### Biome Configuration

```javascript
const BIOMES = {
  'temperate-forest': {
    trees: ['tree-oak', 'tree-birch'],
    weights: [0.7, 0.3],
    density: 1.0
  },
  'conifer-forest': {
    trees: ['tree-pine'],
    weights: [1.0],
    density: 1.2
  },
  'wetland': {
    trees: ['tree-willow'],
    weights: [1.0],
    density: 0.8
  },
  'dead-forest': {
    trees: ['tree-dead', 'tree-oak'],
    weights: [0.6, 0.4],
    density: 0.6
  }
};

function selectBiomeTree(biome, rng) {
  const config = BIOMES[biome];
  const roll = rng();
  let cumulative = 0;

  for (let i = 0; i < config.trees.length; i++) {
    cumulative += config.weights[i];
    if (roll < cumulative) {
      return config.trees[i];
    }
  }

  return config.trees[0];
}
```

---

## Performance Considerations

### Baking

For large numbers of scatter items, render to cached canvases:

```javascript
// Bake ground layer once when terrain changes
if (terrainMap._groundDirty) {
  const groundItems = getScatterByLayer(terrainMap, 'ground');
  renderScatterLayer(groundCache.ctx, groundItems, images);
  terrainMap._groundDirty = false;
}

// Canopy may need per-frame updates for animation
const canopyItems = getScatterByLayer(terrainMap, 'canopy');
renderScatterLayer(canopyCtx, canopyItems, images, { animate: true });
```

### Spatial Indexing

For large maps, use spatial indexing for queries:

```javascript
// Simple grid-based spatial hash
const CELL_SIZE = 100;

function getSpatialKey(x, y) {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
}

function buildSpatialIndex(scatterItems) {
  const index = new Map();
  for (const item of scatterItems) {
    const key = getSpatialKey(item.x, item.y);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  }
  return index;
}
```

### Item Limits

Recommended limits per terrain map:
- Trees: 500-1000
- Floor patches: 5000-10000
- Brushes: 1000-2000
- Particles: 2000-5000

Total scatter items: ~15,000 max for 60fps rendering

---

## Adding New Types

### 1. Define the Type

Add to SCATTER_TYPES:

```javascript
'tree-maple': {
  category: 'tree',
  layer: 'canopy',
  baseScale: 0.95,
  scaleVariance: 0.25,
  spacing: 48,
  variants: 3,
  ages: ['young', 'old', 'transitional'],
  spawns: ['floor-maple', 'bush-small']
}
```

### 2. Define Spawn Rules

Add to SPAWN_RULES:

```javascript
'tree-maple': {
  spawns: [
    { type: 'floor-maple', density: 7, distribution: 'under-canopy' },
    { type: 'bush-small', density: 2, distribution: 'ring', minRadius: 0.8 }
  ]
}
```

### 3. Create Floor Type (if needed)

```javascript
'floor-maple': {
  category: 'floor',
  layer: 'ground',
  baseScale: 0.4,
  scaleVariance: 0.15,
  spacing: 0,
  variants: 3,
  fadeWithDistance: true,
  spawns: []
}
```

### 4. Create Sprites

Place sprites in:
```
sprites/terrain/trees/
  tree-maple-young-1.png
  tree-maple-young-2.png
  tree-maple-young-3.png
  tree-maple-old-1.png
  tree-maple-old-2.png
  tree-maple-old-3.png
  tree-maple-transitional-1.png
  tree-maple-transitional-2.png
  tree-maple-transitional-3.png

sprites/terrain/floor/
  floor-maple-1.png
  floor-maple-2.png
  floor-maple-3.png
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Scatter Item** | Any procedurally placed terrain element |
| **Category** | Classification: tree, floor, brush, particle |
| **Layer** | Render layer: ground (below units) or canopy (above ground) |
| **Spawn** | Automatic child generation from parent |
| **Spacing** | Minimum distance between items of same category |
| **Variant** | Visual variation (1, 2, 3) of same type |
| **Age** | Tree growth stage: young, old, transitional |
| **Distribution** | Placement pattern: under-canopy, ring, scatter, cluster |

---

## Future Enhancements (Post-MVP)

### 1. Unit Disturbance System

When units move through terrain, they disturb nearby scatter items, spawning temporary particles.

**Architecture:**
```
Unit moves → Unit calls scatterSystem.disturbAt(x, y, options) → Temporary particles spawn
```

**Why unit triggers (not floor detects):**
- Unit knows its speed, direction, weight
- Can customize per unit type (tank kicks more debris than infantry)
- Avoids polling all unit positions every frame

**Implementation:**
```javascript
// In unit movement code
unit.move(dx, dy) {
  this.x += dx;
  this.y += dy;

  // Tell scatter system to disturb ground
  scatterSystem.disturbAt(this.x, this.y, {
    radius: this.size * 2,
    intensity: this.weight,    // Tank = high, infantry = low
    direction: Math.atan2(dy, dx)
  });
}

// Scatter system creates temporary particle effects
disturbAt(x, y, options) {
  const { radius, intensity, direction } = options;

  // Find floor items in radius (use spatial hash for O(1))
  const nearbyFloor = this.spatialHash.query(x, y, radius);

  // Spawn kicked-up debris particles
  const particleCount = Math.floor(intensity * 3);
  for (let i = 0; i < particleCount; i++) {
    const p = this.particlePool.acquire();  // Reuse from pool
    p.reset({
      x: x + (Math.random() - 0.5) * radius,
      y: y + (Math.random() - 0.5) * radius,
      vx: Math.cos(direction) * intensity * 2,
      vy: Math.sin(direction) * intensity * 2 - 3,  // Upward kick
      life: 500 + Math.random() * 500,  // ms
      type: nearbyFloor[0]?.type || 'particle-dust'
    });
  }
}
```

**Performance optimizations:**
- **Spatial hash**: O(1) lookup for nearby items instead of O(n) scan
- **Object pool**: Pre-allocate particles, reuse instead of allocating
- **Hybrid rendering**: Only render active disturbances when present
- **Realistic load**: ~40 active particles max (4 units × 10 particles) = trivial

### 2. Rock/Ledge Categories

Add after MVP for terrain variety:

```javascript
'rock-small': {
  category: 'rock',
  layer: 'ground',           // Rocks sit on ground
  baseScale: 0.3,
  spacing: 20,               // Some collision
  variants: 4,
  spawns: []
},

'ledge-dirt': {
  category: 'ledge',
  layer: 'ground',
  baseScale: 1.0,
  spacing: 0,                // Can overlap
  variants: 3,
  elevation: true,           // Affects unit pathing
  spawns: ['rock-small']     // Rocks spawn on ledges
}
```

### 3. Canopy Wind Animation

Subtle scale/rotation oscillation on trees and bushes to simulate wind:

```javascript
'tree-oak': {
  // ... existing config
  animate: {
    type: 'breathe',
    speed: 0.2,              // Slow, gentle
    amplitude: {
      scale: 0.02,           // 2% size variation
      rotation: 1            // 1 degree sway
    }
  }
}
```

Lower priority than particle animation - add as polish after core system works.
