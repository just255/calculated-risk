# Layered Forest Floor System

## Overview

A multi-layer rendering system for forest floors that provides:
- **Performance**: Single texture draws instead of hundreds of particles
- **Flexibility**: Mix and match layers per biome/area
- **Manual Control**: Edit individual trees/brush after bulk painting

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    RENDER ORDER                          │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Tree Canopies    (z-sorted by scale)          │
│  Layer 3: Brush/Undergrowth (ferns, shrubs)             │
│  Layer 2: Particles         (leaves, needles, twigs)    │
│  Layer 1: Ground Texture    (grass, dirt, mud)          │
│  Layer 0: Base Layer        (map default - grass-1)     │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### TerrainMap (Enhanced)
```javascript
{
  // Existing
  strokes: [],           // Paint strokes (source of truth for areas)
  trees: [],             // Tree registry
  brushes: [],           // Brush/undergrowth registry
  baseLayer: 'grass-1',  // Default ground

  // New
  particles: []          // Particle registry (leaves, needles, etc.)
}
```

### Tree Entry
```javascript
{
  id: 'tree_001',
  strokeId: 'stroke_123',    // Parent stroke (for bulk operations)
  treeType: 'oak',
  x: 150, y: 200,
  scale: 0.8,
  rotation: 45,
  variant: 2,
  age: 'old'
}
```

### Particle Entry
```javascript
{
  id: 'particle_001',
  strokeId: 'stroke_123',    // Parent stroke (for bulk delete)
  parentId: 'tree_001',      // Parent tree/brush (for optional cascading delete)
  particleType: 'leaf-particles',
  x: 145, y: 195,
  scale: 0.5,
  rotation: 120,
  variant: 1
}
```

### Brush Entry
```javascript
{
  id: 'brush_001',
  strokeId: 'stroke_123',
  parentId: null,            // null = manually placed, or tree_id if auto-generated
  brushType: 'fern-small',
  x: 160, y: 210,
  scale: 0.7,
  rotation: 30,
  variant: 2
}
```

## Auto-Generation Mappings

### Tree Type → Particle Type
```javascript
export const TREE_TO_PARTICLES = {
  'oak': ['leaf-particles'],
  'pine': ['pine-needles'],
  'birch': ['leaf-particles'],
  'willow': ['leaf-particles', 'twigs'],
  'dead': ['twigs']
};
```

### Tree Type → Suggested Brush
```javascript
export const TREE_TO_BRUSH = {
  'oak': ['fern-small', 'bush'],
  'pine': ['fern-small'],
  'birch': ['fern-small', 'grass-clump'],
  'willow': ['fern-small', 'marsh-reeds'],
  'dead': ['bramble', 'grass-clump']
};
```

### Tree Type → Ground Texture
```javascript
export const TREE_TO_GROUND = {
  'oak': 'forest-floor',
  'pine': 'forest-floor',
  'birch': 'forest-floor',
  'willow': 'mud',
  'dead': 'dirt'
};
```

## Stroke Behavior

When a forest stroke is painted:

```javascript
function addForestStroke(terrainMap, stroke, options) {
  // 1. Add the stroke
  terrainMap.strokes.push(stroke);

  // 2. Generate trees
  const trees = generateTreesForStroke(terrainMap, stroke);

  // 3. Auto-generate particles for each tree (if enabled)
  if (options.particleDensity > 0) {
    for (const tree of trees) {
      const particleTypes = TREE_TO_PARTICLES[tree.treeType];
      generateParticlesForTree(terrainMap, tree, particleTypes, options.particleDensity);
    }
  }

  // 4. Auto-generate brush (if enabled)
  if (options.brushDensity > 0) {
    generateBrushForStroke(terrainMap, stroke, options);
  }

  // 5. Paint ground texture (if enabled)
  if (options.autoGroundTexture) {
    const groundType = TREE_TO_GROUND[stroke.treeType];
    // Ground texture applied to stroke area
  }
}
```

## Deletion Behavior

### Delete Single Tree
```javascript
function deleteTree(terrainMap, treeId, options = {}) {
  const { cascadeParticles = true, cascadeBrush = true } = options;

  // Remove the tree
  terrainMap.trees = terrainMap.trees.filter(t => t.id !== treeId);

  // Optional cascade: remove particles spawned by this tree
  if (cascadeParticles) {
    terrainMap.particles = terrainMap.particles.filter(p => p.parentId !== treeId);
  }

  // Optional cascade: remove brush spawned by this tree
  if (cascadeBrush) {
    terrainMap.brushes = terrainMap.brushes.filter(b => b.parentId !== treeId);
  }
}
```

### Delete Single Brush
```javascript
function deleteBrush(terrainMap, brushId, options = {}) {
  const { cascadeParticles = true } = options;

  terrainMap.brushes = terrainMap.brushes.filter(b => b.id !== brushId);

  if (cascadeParticles) {
    terrainMap.particles = terrainMap.particles.filter(p => p.parentId !== brushId);
  }
}
```

### Delete Stroke (Bulk)
```javascript
function deleteStroke(terrainMap, strokeId) {
  // Remove stroke and ALL associated items (always cascades)
  terrainMap.strokes = terrainMap.strokes.filter(s => s.id !== strokeId);
  terrainMap.trees = terrainMap.trees.filter(t => t.strokeId !== strokeId);
  terrainMap.particles = terrainMap.particles.filter(p => p.strokeId !== strokeId);
  terrainMap.brushes = terrainMap.brushes.filter(b => b.strokeId !== strokeId);
}
```

### Eraser Tool
```javascript
function eraseAtPosition(terrainMap, x, y, radius, options) {
  const {
    clearTrees = true,
    clearBrush = true,
    clearParticles = true,
    cascadeParticles = true  // UI toggle
  } = options;

  if (clearTrees) {
    const treesToRemove = findItemsInRadius(terrainMap.trees, x, y, radius);
    treesToRemove.forEach(tree => deleteTree(terrainMap, tree.id, { cascadeParticles }));
  }

  if (clearBrush) {
    const brushToRemove = findItemsInRadius(terrainMap.brushes, x, y, radius);
    brushToRemove.forEach(brush => deleteBrush(terrainMap, brush.id, { cascadeParticles }));
  }

  if (clearParticles) {
    // Direct particle removal (orphaned or targeted)
    terrainMap.particles = terrainMap.particles.filter(p =>
      distance(p.x, p.y, x, y) > radius
    );
  }
}
```

## UI Controls

### Forest Tool Panel
```
┌─────────────────────────────────────┐
│ FOREST TOOL                         │
├─────────────────────────────────────┤
│ Tree Type: [Oak ▾]                  │
│ Tree Density: [────●────] 5         │
│                                     │
│ ☑ Auto Particles                    │
│   Density: [──●──────] 3            │
│                                     │
│ ☑ Auto Brush                        │
│   Types: [Fern] [Bush]              │
│   Density: [────●────] 4            │
│                                     │
│ ☑ Auto Ground Texture               │
└─────────────────────────────────────┘
```

### Eraser Tool Panel
```
┌─────────────────────────────────────┐
│ ERASER TOOL                         │
├─────────────────────────────────────┤
│ Clear:                              │
│   ☑ Trees                           │
│   ☑ Brush                           │
│   ☑ Particles                       │
│                                     │
│ ☑ Cascade delete particles          │
│   (remove particles when removing   │
│    their parent tree/brush)         │
└─────────────────────────────────────┘
```

### Selection Tool (Future)
- Click to select individual tree/brush/particle
- Delete key removes selected
- Properties panel shows details
- Multi-select with Shift+Click

## Rendering

```javascript
function renderTerrain(ctx, terrainMap, viewport) {
  // Layer 0: Base layer (full map)
  renderBaseLayer(ctx, terrainMap.baseLayer);

  // Layer 1: Ground texture strokes
  renderGroundStrokes(ctx, terrainMap.strokes);

  // Layer 2: Particles (z-sorted)
  const sortedParticles = sortByDepth(terrainMap.particles);
  renderParticles(ctx, sortedParticles);

  // Layer 3: Brush (z-sorted)
  const sortedBrush = sortByDepth(terrainMap.brushes);
  renderBrush(ctx, sortedBrush);

  // Layer 4: Trees (z-sorted)
  const sortedTrees = sortByDepth(terrainMap.trees);
  renderTrees(ctx, sortedTrees);
}

function sortByDepth(items) {
  return [...items].sort((a, b) => a.y - b.y || a.scale - b.scale);
}
```

## Sprite Organization

```
sprites/terrain/
├── trees/
│   └── resized/          # Tree canopies
├── brush/
│   └── resized/          # Undergrowth (ferns, shrubs)
├── particles/
│   └── resized/          # Scatter items (leaves, needles)
├── ground/
│   └── resized/          # Base textures (grass, dirt, mud)
└── *-prompts.md          # Generation prompts for each category
```

## Performance Notes

- **Particle budget**: ~50-100 per forest stroke (sparse, not dense)
- **Viewport culling**: Skip items outside camera bounds
- **Ground texture**: Provides "filled" look without particle spam

## Implementation Status

### Done
- [x] Tree registry and generation
- [x] Brush registry and generation
- [x] Tree-to-brush collision avoidance
- [x] Z-ordering by scale

### TODO
- [ ] Particle registry
- [ ] Particle generation from trees
- [ ] Parent linking (parentId field)
- [ ] Cascading delete (with toggle)
- [ ] TREE_TO_PARTICLES mapping
- [ ] Auto-particle on forest stroke
- [ ] UI: Particle density slider
- [ ] UI: Cascade delete toggle
- [ ] Individual item selection tool
- [ ] Ground texture layer rendering

### Future (UI Pass)
- [ ] Full UI redesign for forest tool
- [ ] Selection tool with properties panel
- [ ] Keyboard shortcuts (Delete, Shift+Delete)
- [ ] Multi-select support

## Related Files

- `js/world-builder/strokes.js` - Type definitions and mappings
- `js/world-builder/stroke-renderer.js` - Rendering layers
- `js/terrain-editor/state.js` - Registries and delete functions
- `js/terrain-editor/tools/` - Tool implementations
- `sprites/terrain/*-prompts.md` - Sprite generation prompts
