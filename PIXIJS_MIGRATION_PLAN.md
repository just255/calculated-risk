# PixiJS Migration Plan

## Overview

Migrate from Canvas 2D to PixiJS for GPU-accelerated rendering. This plan covers the terrain editor, in-game renderer, and sprite systems.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    RENDERING SYSTEMS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TERRAIN EDITOR              IN-GAME                SPRITE EDITOR│
│  ─────────────────           ───────                ─────────────│
│  renderer.js                 game.js                canvas.js    │
│  └─ 3 canvas layers          sprite-renderer.js    (pixel tools) │
│     └─ ground                sprites.js                          │
│     └─ features              terrain-renderer.js                 │
│     └─ ui                    scatter-renderer.js                 │
│                                                                  │
│  SHARED: world-builder/                                          │
│  ─────────────────────                                           │
│  scatter.js (data)                                               │
│  scatter-renderer.js (draw)                                      │
│  terrain-renderer.js (procedural)                                │
│  stroke-renderer.js (brush strokes)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

### What WILL migrate to PixiJS:
1. **In-game rendering** - Units, projectiles, battlefield
2. **Terrain editor viewport** - Scatter items, ground textures
3. **World-builder renderers** - Terrain, scatter, strokes

### What STAYS as Canvas 2D:
1. **Sprite editor tools** - Requires pixel manipulation (getImageData, putImageData)
2. **Clone stamp, bucket fill, blend brush** - Need direct pixel access

---

## Phase 1: Setup & Infrastructure

### 1.1 Install PixiJS
```bash
npm install pixi.js
```

### 1.2 Create PixiJS Application Wrapper
**File:** `js/rendering/pixi-app.js`

```javascript
import * as PIXI from 'pixi.js';

let app = null;

export function initPixiApp(container, options = {}) {
  app = new PIXI.Application({
    width: options.width || 800,
    height: options.height || 600,
    backgroundColor: options.backgroundColor || 0x1a1a2e,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: true
  });

  container.appendChild(app.view);
  return app;
}

export function getApp() {
  return app;
}

export function resizeApp(width, height) {
  if (app) {
    app.renderer.resize(width, height);
  }
}
```

### 1.3 Create Texture Manager
**File:** `js/rendering/texture-manager.js`

```javascript
import * as PIXI from 'pixi.js';

const textureCache = new Map();

export async function loadTexture(key, path) {
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const texture = await PIXI.Assets.load(path);
  textureCache.set(key, texture);
  return texture;
}

export function getTexture(key) {
  return textureCache.get(key);
}

export async function loadTextureAtlas(manifest) {
  // Batch load all textures
  const promises = Object.entries(manifest).map(([key, path]) =>
    loadTexture(key, path)
  );
  await Promise.all(promises);
}
```

---

## Phase 2: In-Game Renderer Migration

### 2.1 Migrate sprite-renderer.js
**Current:** Canvas 2D drawImage with transforms
**Target:** PixiJS Sprites in Containers

**File:** `js/sprite-renderer-pixi.js`

```javascript
import * as PIXI from 'pixi.js';
import { getTexture } from './rendering/texture-manager.js';

export function createUnitSprite(variantData) {
  const container = new PIXI.Container();

  // Sort parts by zIndex
  const sortedParts = [...variantData.parts].sort((a, b) => a.zIndex - b.zIndex);

  for (const part of sortedParts) {
    const texture = getTexture(part.image);
    if (!texture) continue;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(part.x, part.y);
    sprite.rotation = part.rotation * Math.PI / 180;
    sprite.scale.set(part.scale);
    sprite.alpha = part.opacity / 100;

    container.addChild(sprite);
  }

  return container;
}

export function renderUnitShadow(container, shadowConfig) {
  // Create shadow using ColorMatrixFilter
  const shadow = container.clone();
  const colorMatrix = new PIXI.ColorMatrixFilter();
  colorMatrix.brightness(0, false); // Make black
  shadow.filters = [colorMatrix];
  shadow.alpha = shadowConfig.opacity;
  shadow.position.y += shadowConfig.offsetY;
  return shadow;
}
```

### 2.2 Migrate game.js Battle Canvas
**Current:** Multiple ctx.drawImage calls per frame
**Target:** PixiJS stage with unit containers

```javascript
// In game.js init
import { initPixiApp } from './rendering/pixi-app.js';

const battleApp = initPixiApp(document.getElementById('battle-container'), {
  width: battleWidth,
  height: battleHeight
});

// Layers
const terrainLayer = new PIXI.Container();
const shadowLayer = new PIXI.Container();
const unitLayer = new PIXI.Container();
const uiLayer = new PIXI.Container();

battleApp.stage.addChild(terrainLayer, shadowLayer, unitLayer, uiLayer);
```

---

## Phase 3: Terrain Editor Migration (CANCELLED)

> **Decision:** Terrain editor stays Canvas 2D. The bottleneck is CPU-bound cache
> building, not rendering. PixiJS provides no meaningful benefit here.
> See "Architecture Decision" section for details.

### 3.1 Layer Structure (Reference Only)
**File:** `js/terrain-editor/pixi-renderer.js`

```javascript
import * as PIXI from 'pixi.js';

export class PixiTerrainRenderer {
  constructor(container, state) {
    this.app = new PIXI.Application({
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: 0x1a1a2e,
      resolution: window.devicePixelRatio,
      autoDensity: true
    });

    container.appendChild(this.app.view);

    // Layer containers (replaces 3 canvases)
    this.groundLayer = new PIXI.Container();
    this.featuresLayer = new PIXI.Container();
    this.uiLayer = new PIXI.Container();

    this.app.stage.addChild(
      this.groundLayer,
      this.featuresLayer,
      this.uiLayer
    );

    // Caches (RenderTextures instead of off-screen canvases)
    this.groundCache = null;
    this.waterCache = null;
    this.canopyCache = null;

    this.state = state;
  }

  // Viewport transform (replaces ctx.setTransform)
  setViewport(x, y, zoom) {
    this.app.stage.position.set(x, y);
    this.app.stage.scale.set(zoom);
  }
}
```

### 3.2 Scatter Item Rendering
**Current:** Loop with ctx.drawImage per item
**Target:** ParticleContainer for batched rendering

```javascript
renderScatterItems(items, images) {
  // Use ParticleContainer for massive performance boost
  // (trees, brush, particles all similar sprites)
  const particleContainer = new PIXI.ParticleContainer(50000, {
    scale: true,
    position: true,
    rotation: true,
    alpha: true
  });

  for (const item of items) {
    const texture = this.getScatterTexture(item, images);
    const sprite = new PIXI.Sprite(texture);

    sprite.anchor.set(0.5, 1.0); // Bottom center
    sprite.position.set(item.x, item.y);
    sprite.scale.set(item.scale);
    sprite.rotation = item.rotation * Math.PI / 180;
    sprite.alpha = item.alpha;

    particleContainer.addChild(sprite);
  }

  return particleContainer;
}
```

### 3.3 Ground Textures (Tiled)
**Current:** ctx.drawImage in tiling loop
**Target:** TilingSprite

```javascript
renderGroundBase(baseTexture, width, height) {
  const texture = PIXI.Texture.from(baseTexture);
  const tilingSprite = new PIXI.TilingSprite(
    texture,
    width,
    height
  );
  tilingSprite.tileScale.set(0.25); // GROUND_TEXTURE_SCALE
  return tilingSprite;
}
```

### 3.4 Water & Gradients
**Current:** ctx.createRadialGradient
**Target:** PIXI.Graphics or pre-rendered textures

```javascript
renderWaterStroke(stroke) {
  const graphics = new PIXI.Graphics();

  // Water fill with gradient approximation
  // PixiJS doesn't have native gradients, so we use multiple circles
  const steps = 10;
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const radius = stroke.radius * t;
    const alpha = 1 - (t * 0.3); // Fade toward edge

    graphics.beginFill(0x1e5a8c, alpha);
    graphics.drawCircle(stroke.x, stroke.y, radius);
    graphics.endFill();
  }

  return graphics;
}
```

### 3.5 Cache System (RenderTextures)
**Current:** Off-screen canvas caching
**Target:** RenderTexture caching

```javascript
rebuildGroundCache() {
  // Create RenderTexture at map size
  const width = this.state.gridWidth * this.state.cellSize;
  const height = this.state.gridHeight * this.state.cellSize;

  if (!this.groundCache) {
    this.groundCache = PIXI.RenderTexture.create({ width, height });
  }

  // Render ground layer to texture
  this.app.renderer.render(this.groundLayer, {
    renderTexture: this.groundCache
  });

  // Use cached texture as sprite
  const cachedSprite = new PIXI.Sprite(this.groundCache);
  this.groundLayer.removeChildren();
  this.groundLayer.addChild(cachedSprite);
}
```

---

## Phase 4: World Builder Renderers

### 4.1 scatter-renderer.js → pixi
- Replace `ctx.drawImage()` with `PIXI.Sprite`
- Use `PIXI.ParticleContainer` for batching
- Keep `getSpriteKey()` logic unchanged

### 4.2 terrain-renderer.js → pixi
- Replace `ctx.fillRect()`, `ctx.arc()` with `PIXI.Graphics`
- Replace gradients with stepped fills or pre-rendered textures

### 4.3 stroke-renderer.js → pixi
- Replace stroke painting with Graphics paths
- Use RenderTexture for stroke caching

---

## Phase 5: Paint Preview System

### 5.1 Preview During Drag
**Current:** Incremental canvas drawing
**Target:** Dynamic sprite updates

```javascript
updatePaintPreview(strokes) {
  this.previewLayer.removeChildren();

  for (const stroke of strokes) {
    if (stroke.type === 'water') {
      const waterGraphics = this.renderWaterStroke(stroke);
      this.previewLayer.addChild(waterGraphics);
    } else if (stroke.type === 'groundTexture') {
      const textureSprite = this.renderGroundTextureStroke(stroke);
      this.previewLayer.addChild(textureSprite);
    }
  }
}
```

### 5.2 Animation System
**Current:** Custom _renderRadius, _renderAlpha properties
**Target:** PixiJS ticker + tweening

```javascript
import { Ticker } from 'pixi.js';

// Animation update in ticker
this.app.ticker.add((delta) => {
  for (const stroke of this.animatingStrokes) {
    stroke.currentRadius += (stroke.targetRadius - stroke.currentRadius) * 0.1 * delta;
    stroke.graphics.clear();
    this.drawAnimatedWater(stroke);
  }
});
```

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Install PixiJS: `npm install pixi.js`
- [ ] Create `js/rendering/pixi-app.js`
- [ ] Create `js/rendering/texture-manager.js`
- [ ] Update build config if needed

### Phase 2: In-Game
- [ ] Create `js/sprite-renderer-pixi.js`
- [ ] Migrate `game.js` battle canvas to PixiJS
- [ ] Test unit rendering performance
- [ ] Migrate campaign canvas

### Phase 3: Terrain Editor
- [ ] Create `js/terrain-editor/pixi-renderer.js`
- [ ] Migrate ground layer (base + textures)
- [ ] Migrate water layer (strokes + depth)
- [ ] Migrate scatter rendering (ParticleContainer)
- [ ] Migrate canopy layer
- [ ] Implement RenderTexture caching
- [ ] Migrate paint preview system
- [ ] Migrate UI layer (grid, brush preview)

### Phase 4: World Builder
- [ ] Migrate `scatter-renderer.js`
- [ ] Migrate `terrain-renderer.js`
- [ ] Migrate `stroke-renderer.js`

### Phase 5: Polish
- [ ] Implement LOD system with PixiJS culling
- [ ] Add toggle to switch between Canvas/PixiJS (A/B testing)
- [ ] Performance benchmarking
- [ ] Remove old Canvas 2D code (after validation)

---

## Canvas 2D → PixiJS API Mapping

| Canvas 2D | PixiJS | Notes |
|-----------|--------|-------|
| `ctx.drawImage()` | `PIXI.Sprite` | Add to container |
| `ctx.fillRect()` | `Graphics.drawRect()` | Vector drawing |
| `ctx.arc()` | `Graphics.drawCircle()` | Vector drawing |
| `ctx.beginPath()/fill()` | `Graphics.beginFill()/endFill()` | Path drawing |
| `ctx.createRadialGradient()` | Stepped fills or texture | No native gradient |
| `ctx.globalAlpha` | `sprite.alpha` | Per-object |
| `ctx.globalCompositeOperation` | `sprite.blendMode` | Limited modes |
| `ctx.setTransform()` | `container.position/scale/rotation` | Hierarchical |
| `ctx.clip()` | `sprite.mask` | Mask property |
| `ctx.save()/restore()` | Container hierarchy | Natural in scene graph |
| Off-screen canvas | `RenderTexture` | GPU-cached |
| `ctx.filter` (CSS) | `sprite.filters` | ColorMatrixFilter |

---

## Performance Expectations

| Metric | Canvas 2D | PixiJS | Improvement |
|--------|-----------|--------|-------------|
| 10,000 sprites | ~15 FPS | ~60 FPS | 4x |
| 50,000 sprites | ~3 FPS | ~45 FPS | 15x |
| Large map pan | Stuttery | Smooth | Significant |
| Zoom in/out | Rebuilds cache | GPU scaled | Much faster |
| Memory (sprites) | JS heap | GPU VRAM | Offloaded |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gradient rendering differs | Pre-render gradients as textures |
| Blend mode limitations | Test all modes, use shaders if needed |
| Pixel-perfect rendering | Set `roundPixels: true` in app config |
| Large texture memory | Implement texture atlas, unload unused |
| Filter performance | Apply filters to cached textures, not per-sprite |
| Learning curve | Start with isolated sprite-renderer.js |

---

## Files to Create

```
js/
├── rendering/
│   ├── pixi-app.js           # Application wrapper
│   ├── texture-manager.js    # Texture loading/caching
│   └── pixi-utils.js         # Shared utilities
├── sprite-renderer-pixi.js   # Unit rendering (PixiJS)
├── terrain-editor/
│   └── pixi-renderer.js      # Editor viewport (PixiJS)
└── world-builder/
    ├── scatter-renderer-pixi.js
    ├── terrain-renderer-pixi.js
    └── stroke-renderer-pixi.js
```

---

## Getting Started

1. Run `npm install pixi.js`
2. Create `js/rendering/pixi-app.js` with basic setup
3. Create a test page that renders a few sprites
4. Once working, migrate `sprite-renderer.js` first (isolated, high impact)
5. Then tackle terrain editor (complex but biggest performance gain)

---

## Current Implementation Status (Feb 2026)

### What's Already Done

1. **PixiJS Display Mode** - `js/rendering/terrain-viewport-pixi.js`
   - Terrain editor can toggle between Canvas 2D and PixiJS display
   - Both modes use the same caching architecture
   - PixiJS mode displays cached textures as sprites

2. **LOD System** - `js/terrain-editor/lod.js`
   - Centralized quality/performance configuration
   - Quality presets: Low, Medium, High, Ultra
   - Pixel-size based culling (see below)
   - Persistence via localStorage

3. **Chunked Cache Rebuilding**
   - Deferred cache rebuilds to avoid blocking UI
   - 200-item chunks with `requestAnimationFrame`
   - ~8 seconds for 300K items (non-blocking)

### Why Canvas 2D and PixiJS Have Similar Performance

**Current bottleneck is CPU-bound cache building, not GPU rendering:**

```
┌─────────────────────────────────────────────────────────────────┐
│           CACHE BUILDING (CPU-bound, ~8 seconds)                │
│  - Generate 300K scatter items (JavaScript)                     │
│  - Filter/sort items (JavaScript)                               │
│  - Draw to offscreen Canvas 2D (still Canvas API!)              │
│  - This is identical for both display modes                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│           DISPLAY (trivially fast for both)                     │
│  Canvas 2D: ctx.drawImage(cachedCanvas) ← one draw call         │
│  PixiJS: sprite.texture = cachedTexture ← one draw call         │
└─────────────────────────────────────────────────────────────────┘
```

**To get real PixiJS benefits, need to:**
- Build caches using WebGL RenderTextures (not Canvas 2D)
- Or skip caching entirely and use PixiJS ParticleContainer batching
- Use GPU-based culling instead of JavaScript filtering

---

## LOD (Level of Detail) System

### Pixel-Size Based Culling

Instead of arbitrary zoom thresholds, items are culled based on their rendered pixel size:

```javascript
// Formula
renderedSize = BASE_SPRITE_SIZE * itemScale * zoom
visible = renderedSize >= minPixels[category]

// Example: 256px sprite at scale 0.1 at 25% zoom
// renderedSize = 256 * 0.1 * 0.25 = 6.4px
// If minPixels.particle = 8, this item is hidden
```

### Quality Presets

| Preset | Tree | Brush | Floor | Particle | Use Case |
|--------|------|-------|-------|----------|----------|
| Low    | 16px | 20px  | 16px  | 12px     | Large maps, weak hardware |
| Medium | 12px | 14px  | 12px  | 8px      | Balanced |
| High   | 8px  | 10px  | 8px   | 5px      | Good hardware |
| Ultra  | 4px  | 6px   | 4px   | 3px      | Maximum quality |

### Benefits Over Zoom Thresholds

1. **Size-aware** - Small items hide first, large items stay visible
2. **Intuitive** - "Hide items smaller than 8px" is meaningful
3. **Per-item** - Same category can have different visibility based on scale
4. **Consistent** - Same visual result regardless of map size

### LOD Files

```
js/terrain-editor/
├── lod.js              # LOD system (presets, functions, persistence)
├── renderer.js         # Uses shouldRenderItem() for culling
└── editor.js           # Graphics Settings UI for LOD
```

### Key Functions

```javascript
// Per-item culling (used in render loops)
shouldRenderItem(item, zoom, category) → boolean

// Quick category-level check (uses typical scale)
shouldRenderCategory(zoom, category) → boolean

// Get minimum zoom for visibility (for UI hints)
getCategoryMinZoom(category) → number
```

---

## Performance Guidelines

### For Terrain Editor

1. **Cache static content** - Ground textures, water, canopy
2. **Defer rebuilds** - Use chunked rebuilding for large changes
3. **LOD culling** - Filter items before rendering
4. **Viewport culling** - Only render visible items

### For Battle Mode (Future)

1. **Use ParticleContainer** - Batch similar sprites (units, projectiles)
2. **Object pooling** - Reuse sprites instead of create/destroy
3. **GPU culling** - Use PixiJS built-in culling for off-screen sprites
4. **Sprite sheets** - Pack unit sprites into atlases

### Memory Management

| Content | Strategy |
|---------|----------|
| Terrain cache | RenderTexture, rebuild on edit |
| Unit sprites | Texture atlas, keep loaded |
| Projectiles | ParticleContainer, pool sprites |
| Particles | ParticleContainer, auto-remove |

---

## Updated Implementation Checklist

### Phase 1: LOD System ✅
- [x] Create lod.js with presets
- [x] Implement pixel-size based culling
- [x] Per-item shouldRenderItem()
- [x] Graphics Settings UI
- [x] Persistence (localStorage)

### Phase 2: Cache Optimization ✅
- [x] Chunked cache rebuilding
- [x] Deferred mode during painting
- [x] Floor direct rendering (>10K items)
- [x] Ground cache skip during deferred mode

### Phase 3: Terrain Editor Cleanup (TODO)
- [ ] Remove terrain-viewport-pixi.js
- [ ] Remove PixiJS display toggle from editor
- [ ] Remove PixiJS texture update code from renderer.js
- [ ] Keep Canvas 2D as only rendering mode
- [ ] Verify LOD system still works

### Phase 4: Battle Mode PixiJS (TODO)
- [ ] Create game-renderer-pixi.js
- [ ] Migrate unit rendering to PixiJS
- [ ] Implement ParticleContainer for projectiles
- [ ] Add particle effects system (explosions, muzzle flash)
- [ ] Implement sprite batching for units/enemies

### Phase 5: Battle Mode Polish (TODO)
- [ ] Object pooling for projectiles
- [ ] Texture atlases for unit sprites
- [ ] GPU-based viewport culling
- [ ] Performance benchmarking vs Canvas 2D

---

## Architecture Decision: Hybrid Approach

**Recommendation: PixiJS for battle mode only, Canvas 2D for editors**

### Key Insight: Terrain Editor Doesn't Need PixiJS

The terrain editor's bottleneck is **CPU-bound cache building**, not rendering:
- Building caches: ~8 seconds for 300K items (JavaScript/Canvas 2D)
- Displaying caches: ~1ms (just 1-2 draw calls)

PixiJS provides no benefit when you're just drawing a few cached textures.
The complexity isn't worth it. If we need PixiJS later, we can add it back.

### System-by-System Breakdown

| System | Renderer | Why |
|--------|----------|-----|
| **Terrain editor** | Canvas 2D | Cache-based, no real-time sprites |
| **Sprite editor** | Canvas 2D | Needs `getImageData`/`putImageData` for pixel tools |
| **Battle units** | PixiJS | Many moving sprites need batching |
| **Projectiles** | PixiJS | ParticleContainer for bullets/missiles |
| **Explosions/effects** | PixiJS | GPU particle systems, blend modes |
| **Minimap** | Canvas 2D | Simple, small, doesn't need GPU overhead |
| **UI/Menus/HUD** | DOM/CSS | Native browser, accessibility, easier styling |
| **Math problems** | DOM/CSS | Text input, keyboard handling |

### Summary by Renderer

**PixiJS (WebGL)** → Battle mode only (real-time gameplay)
- Battle scene (units, enemies, projectiles)
- Particle effects (explosions, muzzle flash, smoke)
- Animated combat sprites

**Canvas 2D** → Editors and static content
- Terrain editor (cache-based rendering)
- Sprite editor (pixel manipulation tools)
- Minimap rendering
- Thumbnail/preview generation

**DOM/CSS** → User interface
- Main menu, settings, pause screen
- HUD (health bars, score, wave counter)
- Math problem interface
- Tooltips, modals, notifications

### Benefits of This Approach

1. **Simplicity** - No PixiJS complexity in terrain editor
2. **Performance where it matters** - GPU rendering for battle mode
3. **Easy to add back** - PixiJS can be added to any system later if needed
4. **Less code to maintain** - Remove terrain-viewport-pixi.js
5. **Faster iteration** - Canvas 2D is easier to debug

### Deprecated: Terrain Editor PixiJS Mode

The following can be removed from the terrain editor:
- `js/rendering/terrain-viewport-pixi.js` - No longer needed
- PixiJS display toggle in editor settings
- Related PixiJS texture update code in renderer.js

Keep the LOD system (`lod.js`) - it benefits Canvas 2D rendering too.
