# Scatter System Verification Checklist

> **Purpose:** Track verification of all scatter system properties
> **Status:** In Progress

---

## 1. BRUSH STROKE SETTINGS (Tool Options Panel)

| Property | UI Control | Expected Behavior | Status | Notes |
|----------|-----------|-------------------|--------|-------|
| Brush Size | Slider (10-300) | Trees spawn within brush radius; children scale with brush size | [ ] | |
| Tree Density | Slider (1-20) | More trees spawn with higher density; collision spacing adjusts | [ ] | |
| Tree Scale | Slider (5-100%) | Trees visibly smaller/larger; children scale proportionally | [ ] | |
| Tree Types | Oak/Pine/Birch/Willow/Dead buttons | Correct species spawns; mix respects ratios | [ ] | |
| Tree Ratios | Sliders when multiple selected | Distribution matches slider percentages | [ ] | |
| Dead % | Ratio slider for "Dead" | Dead variants of selected species appear at correct rate | [ ] | |
| Ages | Young/Trans/Old buttons | Only selected ages spawn | [ ] | |
| Age Ratios | Sliders when multiple selected | Trees have correct age distribution | [ ] | |

---

## 2. SEASON SETTINGS

| Season | Floor Type | Particle Type | Visual | Status | Notes |
|--------|-----------|---------------|--------|--------|-------|
| Summer | floor-leaf | particle-leaf | Green, full foliage | [ ] | |
| Fall | floor-leaf-fall | particle-leaf-fall | Orange/amber, heavy litter | [ ] | |
| Winter | floor-leaf-dry | particle-leaf-dry | Sparse, desaturated | [ ] | |
| Spring | floor-leaf-dry | particle-petal | Petals, renewal | [ ] | |

---

## 3. BIOME PRESETS

| Biome | Tree Mix | Special Children | Status | Notes |
|-------|----------|------------------|--------|-------|
| Temperate | Oak 60%, Birch 30%, Dead 10% | Standard | [ ] | |
| Oak Forest | Oak 85%, Dead 15% | Denser floor | [ ] | |
| Birch Grove | Birch 80%, Oak 15%, Dead 5% | Lighter canopy | [ ] | |
| Conifer | Pine 90%, Dead 10% | Needle floor, ferns | [ ] | |
| Wetland | Willow 80%, Dead 20% | Reeds | [ ] | |
| Dead Forest | Dead 100% | Debris, twigs | [ ] | |
| Custom | Manual selection | - | [ ] | Auto-switches when editing |

---

## 4. SEASON TUNING PANEL

### 4a. Scatter Settings

| Property | Range | Expected Behavior | Status | Notes |
|----------|-------|-------------------|--------|-------|
| Floor Type | Dropdown | Changes floor sprite type for new strokes | [ ] | |
| Floor Density | 0-3 | More/fewer floor patches under trees | [ ] | |
| Particle Type | Dropdown | Changes particle sprite type for new strokes | [ ] | |
| Particle Density | 0-3 | More/fewer particles around trees | [ ] | |
| Brush Density | 0-2 | More/fewer bush children | [ ] | |

### 4b. Canopy Settings

| Property | Range | Expected Behavior | Status | Notes |
|----------|-------|-------------------|--------|-------|
| Hue Shift | -180 to 180 | Tree canopies tint accordingly | [ ] | |
| Saturation | 0-2 | Trees desaturated (low) or vivid (high) | [ ] | |
| Brightness | 0-2 | Trees darker (low) or brighter (high) | [ ] | |

### 4c. Ground Settings

| Property | Range | Expected Behavior | Status | Notes |
|----------|-------|-------------------|--------|-------|
| Tint Color | Color picker | Floor patches tint accordingly | [ ] | |
| Brightness | 0-2 | Floor patches darker/lighter | [ ] | |

### 4d. Environment Settings

| Property | Type | Expected Behavior | Status | Notes |
|----------|------|-------------------|--------|-------|
| Snow | Checkbox | Snow effects visible | [ ] | Not yet implemented? |
| Puddles | Checkbox | Puddle effects visible | [ ] | Not yet implemented? |
| Fog Density | 0-1 | Fog overlay intensity | [ ] | Not yet implemented? |
| Frost | Checkbox | Frost effects visible | [ ] | Not yet implemented? |

### 4e. Atmosphere Settings

| Property | Range | Expected Behavior | Status | Notes |
|----------|-------|-------------------|--------|-------|
| Ambient Color | Color picker | Scene tint changes | [ ] | |
| Shadow Intensity | 0-1 | Shadows fainter/darker | [ ] | |
| Wind Speed | 0-1 | Animation speed | [ ] | Animation not yet implemented? |

---

## 5. SPAWN RULES (Automatic Children)

| Parent Type | Floor | Brush | Particles | Status | Notes |
|-------------|-------|-------|-----------|--------|-------|
| tree-oak | floor-leaf (under canopy) | bush-small (ring) | particle-leaf (ring) | [ ] | |
| tree-pine | floor-needle (under canopy) | fern (ring) | particle-needle (ring) | [ ] | |
| tree-birch | floor-leaf (under canopy) | bush-small (ring) | particle-leaf (ring) | [ ] | |
| tree-willow | floor-leaf (under canopy) | reed (ring) | particle-leaf (ring) | [ ] | |
| tree-dead | floor-debris (under canopy) | dead-brush (ring) | particle-twig (ring) | [ ] | |

---

## 6. PREVIEW ACCURACY

| Test | Expected | Status | Notes |
|------|----------|--------|-------|
| Sidebar Preview | Shows same items that would spawn | [ ] | |
| On-Canvas Preview | Ghost items match painted result | [ ] | |
| Preview Info Text | Correct breakdown (e.g., "1 oak, 2 floor, 3 leaf-ptc") | [ ] | |
| Preview matches actual stroke | Items spawn at same positions/types | [ ] | |

---

## 7. DELETION / CLEAR TOOL

| Test | Expected | Status | Notes |
|------|----------|--------|-------|
| Delete stroke | All scatter items for that stroke removed | [ ] | |
| Clear trees in radius | Trees + their children cascade delete | [ ] | |
| Clear floor only | Only floor items removed | [ ] | |
| Clear particles only | Only particle items removed | [ ] | |

---

## Issues Found

| Issue | Category | Severity | Fixed? |
|-------|----------|----------|--------|
| Children spawn under canopy (invisible) | Spawn Rules | High | YES - Added `childSpawnStart` to tree configs |

---

## Changes Made During Verification

### childSpawnStart System (2026-01-28)
Children now spawn OUTSIDE the canopy for live trees, visible at the "drip line":

| Tree Type | childSpawnStart | Behavior |
|-----------|-----------------|----------|
| tree-oak | 0.9 | Children at canopy edge and beyond |
| tree-pine | 0.85 | Slightly closer (sparser canopy) |
| tree-birch | 0.9 | At canopy edge |
| tree-willow | 0.7 | Closer to trunk (drooping branches) |
| tree-dead | 0 | From trunk outward (visible through bare branches) |

### Stroke Output UI (2026-01-28)
Reorganized density controls into hierarchical "Stroke Output" section showing tree→children relationship:

```
STROKE OUTPUT
├─ 🌳 Trees ─────────── [====|----] 5
│  ├─ Floor × ───────── [==|------] 0.6
│  ├─ Particles × ───── [=|-------] 0.3
│  └─ Brush × ────────── [====|----] 1.0
```

- **Trees** = count per stroke (was "Density")
- **Floor/Particles/Brush** = multipliers on base spawn count (uses × prefix)
- Season Tuning now only has Sprite Types + visual settings (no density sliders)
- Legacy system still shows old "Density" slider when active

---

## Legend

- `[ ]` = Not tested
- `[x]` = Working as expected
- `[!]` = Issue found (see Issues section)
- `[?]` = Unclear / needs investigation
- `[~]` = Partially working
- `[-]` = Not implemented yet
