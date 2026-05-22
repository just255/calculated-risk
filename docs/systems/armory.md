---
name: armory
type: system
status: stable
verified: 2026-05-22
verified_hash: 17f3bfe
tags: [armory, gear, items, kits, loadout]
files:
  - js/armory.js
  - js/gear-templates.js
  - js/storage.js
entry_points:
  - "armory.js:44 createItem"
  - "armory.js:80 assignItem"
  - "armory.js:146 equipItem"
  - "armory.js:117 getEquipped"
  - "armory.js:134 getLoadout"
  - "armory.js:465 createStandardIssue"
related:
  - systems/soldier-lifecycle.md
  - decisions/ADR-0001-s5-star-thresholds.md
  - decisions/ADR-0004-armory-single-source-of-truth.md
---

# Armory

## Purpose

Owns the flat item pool (`Game.armory.items[]`), quality tiers, slot semantics, standard-issue creation, kit storage, equipped-state, and degradation. **Single source of truth for soldier equipment** — what a soldier has equipped is computed from `armory.items` (`assignedTo` + `equipped`), and saved kits live at `armory.kits[soldierId][mos]`. Soldiers no longer carry equipment state. See [ADR-0004](../decisions/ADR-0004-armory-single-source-of-truth.md).

## Quick Reference

- "Create item" → `armory.js:44 createItem(templateId, quality, opts)`
- "Assign to soldier" → `armory.js:80 assignItem(itemId, soldierId, opts)`
- "Equip (swap in slot)" → `armory.js:146 equipItem(soldierId, itemId)`
- "Unequip slot" → `armory.js:164 unequipSlot(soldierId, slot)`
- "Standard issue for MOS" → `armory.js:465 createStandardIssue(mos, soldierId)`
- "Read one equipped item" → `armory.js:117 getEquipped(soldierId, slot)`
- "Read full loadout" → `armory.js:134 getLoadout(soldierId)`
- "All owned items (any equipped state)" → `armory.js:126 getOwnedItems(soldierId, slot?)`
- "Save current as kit" → `armory.js:246 saveKit(soldier, mos)`
- "Load saved kit" → `armory.js:263 loadKit(soldier, mos)`
- "Is item referenced by any kit?" → `armory.js:isItemInAnyKit(itemId)`
- "Degrade after use" → `degradeItem(itemId, amount)`
- "Destroy item" → `destroyItem(itemId)`
- "Random loot drop" → `rollLoot()`

## Call Graph

Equipping a soldier (typical recruit path):

```
generateRecruit() [roster.js:158]
  └─ equipSoldierStandardIssue(soldier) [roster.js:~1658]
       ├─ createStandardIssue(mos, soldier.id)  [armory.js:465]
       │    └─ createItem(templateId, 'standard_issue',
       │                  { assignedTo, equipped: true }) per slot
       │         └─ Game.armory.items.push(item)
       └─ saveArmory()
```

No `soldier.loadout` write — items hold their own ownership state.

Load sequence (`storage.js` `load()`):

```
loadArmory → loadRoster → _migrateRoster
                       → _migrateToArmorySOT  [one-shot, gated by armory._sotMigratedV1]
                       → seedStarters
```

## State Shape

- `Game.armory` (object):
  - `items[]` — flat pool of all gear instances
  - `kits` — `{ [soldierId]: { [mos]: { [slot]: itemId } } }` — per-soldier saved kits
  - `capacity` — volume limit (default 50)
  - `_sotMigratedV1` — boolean flag; once true, the SOT migration short-circuits on subsequent loads
- Item object:
  - `id`, `templateId`, `slot` (`primary` | `sidearm` | `optic` | `attachment` | `armor` | `utility`)
  - `quality` (per `QUALITY_TIERS` in `gear-templates.js`)
  - `condition` 0.0–1.0
  - `assignedTo` — soldier ID or `null` (in pool)
  - `equipped` — `true` if worn now, `false` if owned-but-not-equipped (kit alternate); set explicitly at creation
- Soldier-side: **no equipment fields**. `soldier.loadout` and `soldier.kits` are deprecated and stripped by `_migrateToArmorySOT` on first load post-migration.

## Mutation Points

| Fn | File:Line | Effect |
|---|---|---|
| `createItem` | armory.js:44 | Push new item to pool (with explicit `equipped` if opts says so) |
| `assignItem` | armory.js:80 | Set `assignedTo`, optionally `equipped` |
| `unassignItem` | armory.js:105 | Clear `assignedTo` (item returns to pool) |
| `equipItem` | armory.js:146 | Mark target equipped, others in slot unequipped |
| `unequipSlot` | armory.js:164 | All items in slot → `equipped=false` |
| `saveKit` | armory.js:246 | Snapshot currently equipped → `armory.kits[soldier.id][mos]` |
| `loadKit` | armory.js:263 | Unequip all soldier-owned items, then equip per saved kit |
| `degradeItem` | armory.js | Reduce `condition` by amount × quality wearRate |
| `destroyItem` | armory.js | Splice from `items[]` |
| `createStandardIssue` | armory.js:465 | Build MOS-default loadout, items pre-tagged equipped |
| `rollLoot` | armory.js | Add random unassigned items to pool |
| `_migrateToArmorySOT` | storage.js | One-shot: move `soldier.kits` → `armory.kits`, strip `soldier.loadout` + `soldier.kits`, defensive item reconcile |

## Persistence

- **Saved by:** `saveArmory()` — called after `createItem`, `equipSoldierStandardIssue`, kit save/load, end-of-battle.
- **Loaded by:** `loadArmory()` → `migrateItemsForKits()` (armory.js) backfills missing `equipped` on legacy items.
- **Storage key:** `cr_s<slot>_cr_armory` (slot-prefixed via `_slotKey`).
- **Migration:** `migrateItemsForKits` for item-field backfill; `_migrateToArmorySOT` one-shot gated by `_sotMigratedV1`.

## Lifecycle

1. **Create** — `createItem` (manual / loot / standard issue) appends to `items[]`.
2. **Assign + equip** — `assignItem` sets owner; `equipItem` enforces slot exclusivity.
3. **Use** — combat reads weapon stats via `getEquipped(soldier.id, slot)` at unit spawn; `degradeItem` after engagements.
4. **Maintain** — `repairItem` / unequip / swap kits via `saveKit`/`loadKit`.
5. **Destroy** — `destroyItem` removes from pool; KIA path destroys via `roster.js destroyGear`.

## Gotchas

- **Single source of truth (ADR-0004)** — equipment ownership lives only on items (`assignedTo` + `equipped`) and `armory.kits[soldierId]`. Never add a `soldier.loadout` field back — it caused a class of duplication bugs that took two passes to clear.
- **Orphaned items from reinforcement churn**: `generateMissionReinforcements` (`mission.js:190`) creates ~30 items per `launchMission`. Reinforcements live on `Game.endless._reinforcements`, not roster. If they don't get added to roster (mission abandoned, defeat), their items remain in `Game.armory.items[]` with `assignedTo` pointing to a non-existent soldier. No automatic GC; cleanup only via explicit destroy. Out-of-scope for ADR-0004.
- **`equipped` is now explicit**: `createItem` sets `equipped: false` by default; callers that want the item equipped pass `{ equipped: true }`. `createStandardIssue` does this. Legacy items missing the field default to `equipped = !!assignedTo` via `migrateItemsForKits`.
- **Kit cleanup on retire**: `retireSoldier` (`roster.js`) explicitly calls `delete Game.armory.kits[soldier.id]` and `saveArmory()` so retired soldiers don't leave orphaned kit entries.
- **Standard issue wear multiplier**: `'standard_issue'` quality has `wearRate: 1.5` (gear-templates.js). Standard kit degrades faster than `common`. Repair cost scales `0.8–1.2×` by quality, with `2×` penalty if `condition ≤ 0`.
- **`rollLoot` is wave-end pending wiring**: Task #105 — drops generated but not yet awarded at wave-end. Future work.

## Cross-references

- [Soldier Lifecycle](soldier-lifecycle.md) — soldier object no longer carries equipment state; equip API still lives in `equipSoldierStandardIssue`
- [ADR-0004 — Armory as single source of equipment ownership](../decisions/ADR-0004-armory-single-source-of-truth.md)
- [Glossary: kit, loadout, standard issue, save slot](../glossary.md)
- Code: `js/armory.js`, `js/gear-templates.js`, `js/storage.js`

---

*Update by running `/update-doc armory` after touching the listed files. Always refresh `verified` and `verified_hash`.*
