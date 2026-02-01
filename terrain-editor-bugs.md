# Terrain Editor - Bug Tracker

## Fixed

### Water type selection wrong
- **Issue:** All water types referenced same sprite (water-deep, water-shallow didn't exist)
- **Fix:** Updated options to match actual sprites: water, water-pond, water-river, water-ocean, water-marsh
- **Status:** FIXED

### Grid opacity slider not reaching 100%
- **Issue:** Slider had `max="50"` instead of `max="100"`
- **Fix:** Changed max to 100, min to 0
- **Status:** FIXED

### Allow trees in water not working
- **Issue:** `allowTreesInWater = false` doesn't prevent trees from spawning in water
- **Fix:** Added water collision check in `generateTreesForStroke()` and wired `treesInWater` option from paint-tool.js to stroke
- **Status:** FIXED

### Water painting preview broken
- **Issue:** Shore texture shows for entire stroke preview, but water texture only shows at cursor location until mouseup
- **Fix:** `createStroke()` wasn't storing `textureType` for water strokes. Added water property handling in strokes.js
- **Status:** FIXED

### Clearing mode should be its own tool
- **Issue:** Clearing mode was a toggle on paint tool
- **Fix:** Created dedicated ClearTool with options to clear: all, trees only, water only, ground textures only, forest coverage only
- **Status:** FIXED

### Tree sprite sharpness
- **Issue:** Trees don't look as sharp as ground textures
- **Investigation:**
  - Resize scripts use `-filter point` (nearest-neighbor) which is correct for pixel art
  - Original tree sprites are 128px, resized to 256px
  - Problem was in rendering code: non-integer pixel sizes cause blurriness
- **Fix:**
  - Added Math.round() to tree dimensions in stroke-renderer.js
  - Added ctx.imageSmoothingEnabled = false before each tree draw
  - Fixed both drawSingleTree() and drawTreeStroke() functions
- **Status:** FIXED

---

## Pending

### Sliders should be modular
- **Issue:** Grid opacity had wrong max, similar issues happened with other sliders before
- **Request:** Create consistent slider component/pattern so all sliders work the same way

---

## Feature Requests

### Stroke grouping/combining
- **Request:** Option to combine strokes of the same kind for editing
- **Use cases:**
  - Group all strokes for a "lake" to edit shore texture together
  - Group forest strokes to edit forest floor falloff together
  - Group river strokes to edit water type together
- **Behavior:** Select multiple strokes, combine into a group, edit group properties

---

## Notes

- Brush sprites still need to be generated using prompts in `sprites/terrain/brush-prompts.md`
- Once brush sprites exist, need to implement brush rendering (similar to trees but no age system)
