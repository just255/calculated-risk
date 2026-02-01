# PCG Battlefield Generation - Design Doc

## Overview

Procedurally generate tactically interesting battlefields using military terrain principles.

**Goal:** Same seed = same map. Full slider control to tune until we find good presets.

---

## UI: PCG Tool Panel

New tool in toolbar (like forest/brush/water/ground) with dedicated panel.

### Panel Sections

```
┌─────────────────────────────────────────┐
│ PCG GENERATION                          │
├─────────────────────────────────────────┤
│ SEED                                    │
│ [12345______] [🎲 Random]               │
├─────────────────────────────────────────┤
│ TERRAIN MIX                             │
│ Open Ground    ████████░░░░  45%        │
│ Light Cover    █████░░░░░░░  25%        │
│ Heavy Cover    ███░░░░░░░░░  15%        │
│ Water          ██░░░░░░░░░░  10%        │
│ Clearings      █░░░░░░░░░░░   5%        │
├─────────────────────────────────────────┤
│ FOREST CLUSTERS                         │
│ Count          ███████░░░░░   6         │
│ Min Radius     ████░░░░░░░░  40         │
│ Max Radius     ██████░░░░░░  80         │
│ Min Spacing    █████░░░░░░░ 100         │
│ Edge Margin    ██░░░░░░░░░░  30         │
├─────────────────────────────────────────┤
│ FOREST PLACEMENT                        │
│ Flank Bias     ██████░░░░░░  60%        │
│   (0=random, 100=only flanks)           │
│ Center Avoid   ████░░░░░░░░  40%        │
│   (0=anywhere, 100=never center)        │
├─────────────────────────────────────────┤
│ WATER BODIES                            │
│ Count          ██░░░░░░░░░░   2         │
│ Min Radius     ███░░░░░░░░░  30         │
│ Max Radius     █████░░░░░░░  60         │
│ Flank Anchor   ████████░░░░  80%        │
│   (0=anywhere, 100=only flanks)         │
│ [ ] Deep (impassable)                   │
│ [x] Shallow crossings                   │
├─────────────────────────────────────────┤
│ TACTICAL FEATURES                       │
│ Chokepoints    ██░░░░░░░░░░   2         │
│ Chokepoint Width ███░░░░░░░  40         │
│ Approach Routes ███░░░░░░░░   3         │
├─────────────────────────────────────────┤
│ BIOME / SEASON                          │
│ Biome   [Conifer    ▼]                  │
│ Season  [Summer     ▼]                  │
├─────────────────────────────────────────┤
│ [      Generate Map      ]              │
│ [  Save as Preset  ] [Load Preset]      │
└─────────────────────────────────────────┘
```

---

## All Parameters (with ranges)

### Seed
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `seed` | int | 0-999999 | random | RNG seed for reproducibility |

### Terrain Mix (percentages, should roughly sum to 100)
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `openGround` | int | 20-70% | 45% | Open areas (kill zones) |
| `lightCover` | int | 10-40% | 25% | Brush, scattered trees |
| `heavyCover` | int | 5-30% | 15% | Dense forest clusters |
| `water` | int | 0-25% | 10% | Water bodies |
| `clearings` | int | 0-15% | 5% | Explicit clearings in forests |

### Forest Clusters
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `forestCount` | int | 1-15 | 6 | Number of forest clusters |
| `forestMinRadius` | int | 20-100 | 40 | Minimum cluster radius |
| `forestMaxRadius` | int | 40-200 | 80 | Maximum cluster radius |
| `forestMinSpacing` | int | 50-200 | 100 | Min distance between clusters |
| `forestEdgeMargin` | int | 0-100 | 30 | Keep clusters away from map edge |

### Forest Placement Bias
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `forestFlankBias` | int | 0-100% | 60% | Prefer placing forests on flanks |
| `forestCenterAvoid` | int | 0-100% | 40% | Avoid placing forests in center |

### Water Bodies
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `waterCount` | int | 0-5 | 2 | Number of water bodies |
| `waterMinRadius` | int | 20-80 | 30 | Minimum water radius |
| `waterMaxRadius` | int | 40-150 | 60 | Maximum water radius |
| `waterFlankAnchor` | int | 0-100% | 80% | Place water on flanks to anchor defense |
| `waterDeep` | bool | - | false | Deep water is impassable |
| `waterShallowCrossings` | bool | - | true | Add shallow crossing points |

### Tactical Features
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `chokepoints` | int | 0-4 | 2 | Number of chokepoints |
| `chokepointWidth` | int | 20-80 | 40 | Width of chokepoint gaps |
| `approachRoutes` | int | 1-5 | 3 | Number of approach routes to maintain |

### Biome/Season (uses existing system)
| Parameter | Type | Options | Default | Description |
|-----------|------|---------|---------|-------------|
| `biome` | string | conifer, temperate, wetland, etc. | conifer | Biome preset |
| `season` | string | spring, summer, fall, winter | summer | Season |

---

## Generation Algorithm

### Phase 1: Layout Planning
1. Divide map into zones: left flank, center, right flank
2. Mark approach routes (paths from bottom to top)
3. Identify chokepoint locations

### Phase 2: Water Placement
1. Place water bodies on flanks (based on `waterFlankAnchor`)
2. Water anchors defensive flanks
3. Add shallow crossings if enabled

### Phase 3: Forest Placement
1. Use Poisson disk sampling with `forestMinSpacing`
2. Apply `forestFlankBias` - weight positions toward left/right edges
3. Apply `forestCenterAvoid` - reduce probability in center zone
4. Respect `forestEdgeMargin` - keep away from map borders
5. For each cluster position:
   - Random radius between min/max
   - Call `generateForestItems()` with biome/season settings

### Phase 4: Chokepoints
1. Identify natural chokepoints created by forests/water
2. If fewer than `chokepoints` target, add forest extensions to create gaps
3. Ensure chokepoints are at least `chokepointWidth` wide

### Phase 5: Validation
1. Check approach routes are passable
2. Verify terrain percentages roughly match targets
3. Ensure no completely blocked paths

---

## File Structure

```
js/world-builder/
  pcg.js                      # NEW - PCG generation logic
    - seededRandom(seed)
    - poissonDiskSample(...)
    - generateBattlefield(seed, options)
    - placeForests(...)
    - placeWater(...)
    - createChokepoints(...)

js/terrain-editor/
  editor.js                   # Add PCG tool + panel bindings

terrain-editor.html           # Add PCG panel UI
```

---

## Implementation Order

1. **Add PCG tool button** to toolbar
2. **Add PCG panel** with all sliders
3. **Create `pcg.js`** with seededRandom + poissonDiskSample
4. **Implement `generateBattlefield()`** - start simple (just forests)
5. **Test with conifer biome** - tune defaults
6. **Add water placement**
7. **Add chokepoint logic**
8. **Add preset save/load**

---

## Questions Resolved

- ✅ UI: Dedicated tool with own panel
- ✅ Clear map on generate
- ✅ All parameters have sliders
- ✅ Placement: Military tactical principles (flanks, chokepoints, etc.)
