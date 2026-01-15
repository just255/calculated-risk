# Snap Points & Part Hierarchy - Changelog

## Overview
Implementation of snap points system allowing parts to attach together and move as a unit.

## Quick Test Checklist

### Part Editor (Phase 1)
- [ ] Select part category from dropdown
- [ ] Add snap point by clicking "+ Add Point" then clicking canvas
- [ ] Edit snap point name, type, x, y
- [ ] Delete snap point
- [ ] Snap points visible as colored dots
- [ ] Save/load preserves snap points
- [ ] Undo/redo works

### Variant Builder (Phases 2-4)
- [ ] Add parts with snap points to canvas
- [ ] Drag part near compatible snap point → green highlight
- [ ] Drag part near incompatible snap point → red highlight
- [ ] Drop on compatible snap point → attaches
- [ ] Drag attached part away → detaches (30+ px)
- [ ] Rotate parent → children follow
- [ ] Parts list shows tree hierarchy with indentation
- [ ] Attached parts show "→ snapPointId" suffix
- [ ] Category badges visible

### Files Changed
| File | Changes |
|------|---------|
| `js/sprite-editor/constants.js` | SNAP_POINT_TYPES, PART_CATEGORIES |
| `js/sprite-editor/state.js` | Snap point state fields |
| `js/sprite-editor/variants.js` | Part attachment fields |
| `js/sprite-editor/canvas.js` | Snap point rendering, drag feedback |
| `js/sprite-editor/main.js` | Event handling, save/load |
| `js/sprite-editor/history.js` | Undo/redo support |
| `js/sprite-editor/ui.js` | Hierarchy tree display |
| `js/sprite-editor/snap-points.js` | NEW - Attachment logic |
| `js/sprites.js` | Runtime variant rendering |
| `sprite-editor.html` | UI for snap points |

---

## Phase 1: Snap Point Data & Editor (COMPLETE)

### Files Modified:
- `js/sprite-editor/constants.js` - Added SNAP_POINT_TYPES and PART_CATEGORIES
- `js/sprite-editor/state.js` - Added snap point state fields, reset logic
- `js/sprite-editor/variants.js` - Added category, snapPoints, parentIndex, attachedTo fields to parts
- `js/sprite-editor/canvas.js` - Added drawSnapPoints() for Part Editor visualization
- `js/sprite-editor/main.js` - Added snap point UI handlers, save/load support
- `js/sprite-editor/history.js` - Added snap points to undo/redo
- `sprite-editor.html` - Added Part Category dropdown and Snap Points panel

### What to Test (Part Editor):
1. Open Part Editor for any part type
2. **Part Category dropdown** - Select a category (hull, turret, cannon, etc.)
3. **Add Snap Point** - Click "+ Add Point" button, then click on canvas to place
4. **Snap Point List** - Points appear in list with name and type
5. **Edit Snap Point** - Click a point to select, edit name/type/x/y in properties
6. **Delete Snap Point** - Select a point and click Delete
7. **Visual** - Snap points show as colored dots on canvas (color matches type)
8. **Save/Load** - Save project, reload, snap points persist
9. **Undo/Redo** - Ctrl+Z/Y works for snap point changes

---

## Phase 2: Attachment System (COMPLETE)

### Files Added:
- `js/sprite-editor/snap-points.js` - NEW MODULE for attachment logic

### Files Modified:
- `js/sprite-editor/main.js` - Integrated snap detection, attach/detach on drag
- `js/sprite-editor/canvas.js` - Added visual feedback during drag, hierarchy transforms

### What to Test (Variant Builder):
1. Add a part with snap points (e.g., hull with turret_mount)
2. Add a compatible part (e.g., turret with category "turret")
3. **Drag near snap point** - See green highlight when compatible, red when not
4. **Drop to attach** - Part snaps to position, status shows "Attached to [snapPointId]"
5. **Drag to detach** - Drag attached part away (30+ px), status shows "Detached"
6. **Hierarchy transforms** - Rotate parent, attached children follow
7. **Incompatible parts** - Try attaching cannon to turret_mount (should show red, won't attach)

---

## Phase 3: Transform Inheritance (COMPLETE - merged into Phase 2)

Implemented in `snap-points.js`:
- `getWorldTransform(partIndex)` - Recursive calculation of world position/rotation/scale
- Attached parts inherit parent rotation by default
- Scale inheritance optional (off by default)

---

## Phase 4: Hierarchy UI (COMPLETE)

### Files Modified:
- `js/sprite-editor/ui.js` - Rewrote renderPartsInUse() with tree rendering

### New Functions:
- `buildPartTree(partsInVariant)` - Builds tree structure from flat list
- `renderPartTreeItems()` - Recursively renders tree with indentation

### What to Test:
1. **Open Variant Builder** with parts that have attachments
2. **Hierarchy display** - Parts list shows tree structure:
   - Root parts at left edge
   - Children indented with `├─` or `└─` prefix
3. **Attachment indicator** - Attached parts show `→ [snapPointId]` suffix
4. **Category badge** - Parts show their category (e.g., `turret`, `cannon`)
5. **Selection** - Click still selects correctly at any depth
6. **Visibility toggle** - Eye icon still works for all parts

---

## Phase 5: Runtime Integration (COMPLETE)

### Files Modified:
- `js/sprites.js` - Added variant loading and hierarchy-aware rendering

### New Functions:
- `loadVariant(unitId, variantName)` - Load variant JSON from server
- `getPartWorldTransform(parts, partIndex)` - Calculate world position/rotation/scale
- `renderVariant(variantData, canvas)` - Render variant with hierarchy transforms
- `loadPartImage(unitId, partId)` - Load individual part images

### What to Test:
1. **Load variant** - `await loadVariant('tank', 'default')` returns variant data
2. **Variant includes hierarchy** - Data has parts with parentIndex, attachedTo fields
3. **Render variant** - `await renderVariant(data, canvas)` draws all parts correctly
4. **Hierarchy transforms** - Child parts position/rotate relative to parents

---

## Known Limitations
- One part per snap point (no stacking)
- Stats/weight constraints deferred to future
- No required snap points validation yet
