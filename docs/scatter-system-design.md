# Scatter System - Comprehensive Design

> A realistic, cohesive system for procedural terrain generation with full customization support.

---

## Design Principles

1. **Cohesion** - Each environment has a consistent, realistic look
2. **Realism** - Tree age, health, and season affect what spawns
3. **Customization** - Users can override any default or free-paint anything
4. **Presets** - One-click forest types that "just work"

---

## 1. TREES - The Primary Feature

### Tree Types

| Type | Environment | Characteristics |
|------|-------------|-----------------|
| Oak | Temperate forest | Large canopy, sturdy, broad leaves |
| Pine | Conifer forest | Tall, narrow, needles year-round |
| Birch | Mixed forest | Slender, white bark, delicate leaves |
| Willow | Wetland/waterside | Drooping branches, near water |
| Dead | Any (stressed) | No leaves, bare branches |

### Tree Ages

| Age | Visual | Canopy Size | Debris | Particles |
|-----|--------|-------------|--------|-----------|
| Young | Small, thin | 60% of max | Minimal | Few |
| Transitional | Medium, filling out | 85% of max | Moderate | Moderate |
| Old/Mature | Full, established | 100% | Minimal (healthy) | Few |
| Stressed | Sparse, damaged | 70% | Heavy | Many (falling) |

### Tree Health (Future)

| Health | Leaf Density | Color | Debris | Particles |
|--------|--------------|-------|--------|-----------|
| Healthy | Full | Vibrant | Low | Few |
| Stressed | Sparse | Yellowing | High | Many |
| Dying | Very sparse | Brown/yellow | Very high | Many |
| Dead | None | N/A | Twigs/bark | Twigs only |

---

## 2. SEASONS - Environmental Context

### Season Effects

| Season | Deciduous Leaves | Conifer | Floor Debris | Particles | Colors |
|--------|------------------|---------|--------------|-----------|--------|
| Spring | Emerging (small) | Same | Old leaves decomposing | Pollen, petals | Light green, pink |
| Summer | Full, lush | Same | Minimal | Few leaves | Deep green |
| Fall | Changing, falling | Same | Heavy leaf litter | Many falling | Red, orange, yellow, brown |
| Winter | Bare | Same (maybe snow) | Bare, twigs | Few/none | Brown, gray |

### Season Presets

```javascript
SEASON_PRESETS = {
  'spring': {
    leafDensity: 0.6,
    leafColors: ['light-green', 'yellow-green'],
    floorDensity: 0.4,  // decomposing old leaves
    particleDensity: 0.3,
    particleTypes: ['petal', 'pollen']
  },
  'summer': {
    leafDensity: 1.0,
    leafColors: ['green', 'deep-green'],
    floorDensity: 0.2,
    particleDensity: 0.1,
    particleTypes: ['leaf']
  },
  'fall': {
    leafDensity: 0.7,  // some fallen
    leafColors: ['red', 'orange', 'yellow', 'brown'],
    floorDensity: 1.0,  // heavy leaf litter
    particleDensity: 0.8,  // lots falling
    particleTypes: ['leaf']
  },
  'winter': {
    leafDensity: 0.0,  // deciduous bare
    leafColors: [],
    floorDensity: 0.3,  // twigs, dead leaves
    particleDensity: 0.1,
    particleTypes: ['twig', 'snow']  // if snow enabled
  }
}
```

---

## 3. FLOOR - Ground Layer Debris

### What It Represents

Floor sprites are **static ground debris** under and around trees:
- Fallen leaves (deciduous)
- Needle carpet (conifer)
- Twigs and bark (dead/stressed)
- Mixed organic matter

### Floor Types

| Type | Visual Description | Used By | Variants |
|------|-------------------|---------|----------|
| `floor-leaf-green` | Fresh green fallen leaves | Summer deciduous | 3 |
| `floor-leaf-fall` | Orange/red/yellow leaves | Fall deciduous | 3 |
| `floor-leaf-dry` | Brown, dried leaves | Winter/spring deciduous | 3 |
| `floor-needle` | Pine needle carpet | Conifers (all seasons) | 3 |
| `floor-debris` | Twigs, bark pieces | Dead trees, stressed | 3 |
| `floor-mixed` | Mix of leaves and debris | Transitional areas | 3 |

### Floor Spawn Rules by Context

| Tree Type | Tree Age | Season | Floor Type | Density |
|-----------|----------|--------|------------|---------|
| Oak | Young | Summer | floor-leaf-green | Low |
| Oak | Mature | Summer | floor-leaf-green | Very Low |
| Oak | Transitional | Summer | floor-leaf-green | Medium |
| Oak | Any | Fall | floor-leaf-fall | High |
| Oak | Any | Winter | floor-leaf-dry | Medium |
| Pine | Any | Any | floor-needle | Medium |
| Dead | Any | Any | floor-debris | High |

---

## 4. BRUSH - Undergrowth Layer

### What It Represents

Brush sprites are **plants growing around trees**:
- Small bushes
- Ferns (conifer forests)
- Reeds (wetlands)
- Grass clumps
- Dead brush (bare twigs)

### Brush Types

| Type | Visual Description | Environment | Variants |
|------|-------------------|-------------|----------|
| `bush-small` | Small leafy bush | Temperate | 3 |
| `bush-large` | Larger shrub | Temperate | 3 |
| `fern` | Fern fronds | Conifer forest | 3 |
| `reed` | Tall water reeds | Wetland | 3 |
| `grass-clump` | Bunch of grass | Open areas | 3 |
| `dead-brush` | Bare twigs/dead bush | Dead/winter | 3 |

### Brush by Environment

| Tree Type | Primary Brush | Secondary Brush |
|-----------|---------------|-----------------|
| Oak | bush-small | grass-clump |
| Pine | fern | bush-small |
| Birch | bush-small | grass-clump |
| Willow | reed | bush-small |
| Dead | dead-brush | - |

---

## 5. PARTICLES - Animated Floating Elements

### What It Represents

Particles are **animated elements** floating/falling around trees:
- Falling leaves
- Drifting needles
- Falling twigs
- Pollen/seeds (spring)
- Petals (spring)

### Particle Types

| Type | Visual | Animation | Used When |
|------|--------|-----------|-----------|
| `particle-leaf-green` | Green leaf | Gentle sway, slow fall | Summer, stressed trees |
| `particle-leaf-fall` | Colored leaf | Tumble, drift down | Fall season |
| `particle-needle` | Pine needle | Straight fall, slight drift | Conifers |
| `particle-twig` | Small twig | Fall, tumble | Dead/stressed trees |
| `particle-petal` | Flower petal | Flutter, drift | Spring |
| `particle-pollen` | Dust/pollen | Float, drift | Spring |

### Particle Spawn by Context

| Tree Type | Tree Age | Season | Particle Type | Density | Animation Speed |
|-----------|----------|--------|---------------|---------|-----------------|
| Oak | Mature | Summer | particle-leaf-green | Very Low | Slow |
| Oak | Transitional | Summer | particle-leaf-green | Medium | Medium |
| Oak | Stressed | Any | particle-leaf-green | High | Fast |
| Oak | Any | Fall | particle-leaf-fall | High | Medium |
| Pine | Any | Any | particle-needle | Low | Slow |
| Dead | Any | Any | particle-twig | Medium | Slow |

---

## 6. ANIMATION PROPERTIES

### Sway (Canopy/Brush Movement)

| Element | Base Sway | Factors |
|---------|-----------|---------|
| Oak canopy | Medium | Wind, size |
| Pine canopy | Low | Wind (rigid) |
| Birch canopy | High | Wind (flexible) |
| Willow canopy | Very High | Wind (drooping) |
| Bush | Medium | Wind |
| Fern | High | Wind (delicate) |
| Reed | Very High | Wind (tall, thin) |

### Particle Animation

| Particle | Fall Speed | Drift | Rotation | Pattern |
|----------|------------|-------|----------|---------|
| Leaf (green) | Slow | Medium | Tumble | Sway down |
| Leaf (fall) | Medium | High | Tumble | Spiral down |
| Needle | Fast | Low | Slight | Straight down |
| Twig | Medium | Low | End over end | Fall |
| Petal | Very Slow | Very High | Flutter | Float/drift |

---

## 7. COLOR VARIATIONS

### Leaf Colors by Season

| Season | Primary Colors | Variation Range |
|--------|----------------|-----------------|
| Spring | Light green, yellow-green | Hue ±10° |
| Summer | Green, deep green | Hue ±5°, Saturation ±10% |
| Fall | Red, orange, yellow, brown | Hue ±30° (wide variety) |
| Winter | Brown, gray | Saturation -50% |

### Tree-Specific Colors

| Tree | Spring | Summer | Fall | Winter |
|------|--------|--------|------|--------|
| Oak | Light green | Deep green | Red, brown | Bare |
| Birch | Yellow-green | Green | Yellow, gold | Bare |
| Willow | Light green | Green | Yellow | Bare |
| Pine | Green | Green | Green | Green |

---

## 8. PRESET SYSTEM

### Forest Presets

```javascript
FOREST_PRESETS = {
  'temperate-summer': {
    season: 'summer',
    trees: {
      types: ['oak', 'birch'],
      weights: [0.7, 0.3],
      ageDistribution: { young: 0.2, transitional: 0.3, mature: 0.5 }
    },
    floor: { type: 'floor-leaf-green', density: 0.3 },
    brush: { types: ['bush-small'], density: 0.4 },
    particles: { type: 'particle-leaf-green', density: 0.1 }
  },

  'temperate-fall': {
    season: 'fall',
    trees: {
      types: ['oak', 'birch'],
      weights: [0.7, 0.3],
      ageDistribution: { young: 0.2, transitional: 0.3, mature: 0.5 }
    },
    floor: { type: 'floor-leaf-fall', density: 0.9 },
    brush: { types: ['bush-small'], density: 0.3 },
    particles: { type: 'particle-leaf-fall', density: 0.7 }
  },

  'conifer': {
    season: 'any',
    trees: {
      types: ['pine'],
      weights: [1.0],
      ageDistribution: { young: 0.3, transitional: 0.3, mature: 0.4 }
    },
    floor: { type: 'floor-needle', density: 0.6 },
    brush: { types: ['fern'], density: 0.5 },
    particles: { type: 'particle-needle', density: 0.2 }
  },

  'wetland': {
    season: 'summer',
    trees: {
      types: ['willow'],
      weights: [1.0],
      ageDistribution: { young: 0.2, transitional: 0.4, mature: 0.4 }
    },
    floor: { type: 'floor-leaf-green', density: 0.4 },
    brush: { types: ['reed', 'bush-small'], density: 0.6, weights: [0.7, 0.3] },
    particles: { type: 'particle-leaf-green', density: 0.2 }
  },

  'dead-forest': {
    season: 'winter',
    trees: {
      types: ['dead', 'oak'],
      weights: [0.6, 0.4],
      ageDistribution: { stressed: 0.5, transitional: 0.3, mature: 0.2 }
    },
    floor: { type: 'floor-debris', density: 0.7 },
    brush: { types: ['dead-brush'], density: 0.3 },
    particles: { type: 'particle-twig', density: 0.3 }
  }
}
```

---

## 9. CUSTOMIZATION LAYERS

### Level 1: Use Preset
User selects "Temperate Fall Forest" - everything configured automatically.

### Level 2: Modify Preset
User starts with preset, then adjusts:
- More/fewer particles
- Different brush density
- Custom color tints

### Level 3: Custom Configuration
User builds from scratch:
- Pick tree types and ratios
- Pick floor/brush/particle types
- Set all densities and scales
- Configure animations

### Level 4: Free Paint
User manually paints individual elements:
- Paint specific tree at specific location
- Paint floor patches where wanted
- Add particles manually

---

## 10. SPRITE REQUIREMENTS

### Trees (Existing)
```
sprites/terrain/trees/resized/{type}/
  {type}-young-{1,2,3}.png
  {type}-transitional-{1,2,3}.png
  {type}-old-{1,2,3}.png
```

### Floor (Needed)
```
sprites/terrain/floor/
  floor-leaf-green-{1,2,3}.png    # Fresh green leaves
  floor-leaf-fall-{1,2,3}.png     # Fall colored leaves
  floor-leaf-dry-{1,2,3}.png      # Dried brown leaves
  floor-needle-{1,2,3}.png        # Pine needles
  floor-debris-{1,2,3}.png        # Twigs, bark
  floor-mixed-{1,2,3}.png         # Mixed debris
```

### Brush (Partial)
```
sprites/terrain/brush/resized/
  bush-small-{1,2,3}.png          # (existing)
  bush-large-{1,2,3}.png          # (existing)
  fern-small-{1,2,3}.png          # (existing, rename to fern-{1,2,3})
  reed-{1,2,3}.png                # (needed)
  grass-clump-{1,2,3}.png         # (needed)
  dead-brush-{1,2,3}.png          # (needed)
```

### Particles (Partial)
```
sprites/terrain/brush/resized/    # or particles/
  leaf-particles-{1,2,3}.png      # (existing - green leaves)
  leaf-fall-particles-{1,2,3}.png # (needed - fall colors)
  needle-particles-{1,2,3}.png    # (needed)
  twig-particles-{1,2,3}.png      # (needed)
  petal-particles-{1,2,3}.png     # (needed - spring)
```

---

## 11. DATA STRUCTURE UPDATES

### Enhanced ScatterItem

```javascript
{
  // Existing
  id, type, strokeId, parentId,
  x, y, scale, rotation, alpha,
  variant, hueShift, brightness, saturation,

  // New: Context
  season: 'fall',           // Season context
  treeAge: 'transitional',  // Parent tree's age (for children)
  treeHealth: 'healthy',    // Parent tree's health

  // New: Animation
  swayAmount: 1.0,          // Multiplier for sway animation
  swaySpeed: 1.0,           // Speed of sway
  fallSpeed: 1.0,           // For particles: fall rate

  // New: Color
  colorVariant: 'orange',   // Specific color variant
  tint: '#ff9944'           // Optional color tint override
}
```

### Enhanced SPAWN_RULES

```javascript
SPAWN_RULES = {
  'tree-oak': {
    spawns: [
      {
        type: 'floor-leaf',
        density: { base: 6, byAge: { young: 0.5, transitional: 1.2, mature: 0.3 } },
        scale: 0.12,
        distribution: 'under-canopy',
        seasonOverride: {
          fall: { type: 'floor-leaf-fall', density: 1.5 },
          winter: { type: 'floor-leaf-dry', density: 0.8 }
        }
      },
      {
        type: 'particle-leaf',
        density: { base: 3, byAge: { young: 0.3, transitional: 1.0, mature: 0.2, stressed: 2.0 } },
        scale: 0.12,
        distribution: 'ring',
        seasonOverride: {
          fall: { type: 'particle-leaf-fall', density: 2.0 },
          winter: { density: 0.1 }
        }
      }
    ]
  }
}
```

---

## Summary

| Aspect | Approach |
|--------|----------|
| Tree types | 5 base types (oak, pine, birch, willow, dead) |
| Tree ages | 4 states (young, transitional, mature, stressed) |
| Seasons | 4 seasons affecting colors, density, particles |
| Floor types | 6 types (3 leaf states, needle, debris, mixed) |
| Brush types | 6 types (2 bush sizes, fern, reed, grass, dead) |
| Particle types | 5 types (2 leaf states, needle, twig, petal) |
| Presets | 5+ forest presets for quick setup |
| Customization | 4 levels from preset to free-paint |
