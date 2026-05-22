---
name: armory
type: system
status: stable
verified: 2026-05-22
verified_hash: 0e7f782
tags: [armory, gear, items, kits, loadout, dedup]
files:
  - js/armory.js
  - js/gear-templates.js
  - js/storage.js
entry_points:
  - "armory.js:44 createItem"
  - "armory.js:80 assignItem"
  - "armory.js:146 equipItem"
  - "armory.js:194 dedupeArmoryByOwnerSlot"
  - "armory.js:465 createStandardIssue"
related:
  - systems/soldier-lifecycle.md
  - decisions/ADR-0001-s5-star-thresholds.md
---

# Armory

## Purpose

Owns the flat item pool (`Game.armory.items[]`), quality tiers, slot semantics, standard-issue creation, kit/loadout management, deduplication, and degradation. Soldiers reference items by ID via `soldier.loadout` (currently equipped) and `soldier.kits` (saved per-MOS templates). Items live in one place; ownership is tracked by `assignedTo` + `slot` + `equipped` fields on the item itself.

## Quick Reference

- "Create item" → `armory.js:44 createItem(templateId, quality, opts)`
- "Assign to soldier" → `armory.js:80 assignItem(itemId, soldierId, opts)`
- "Equip (swap in slot)" → `armory.js:146 equipItem(soldierId, itemId)`
- "Unequip slot" → `armory.js:164 unequipSlot(soldierId, slot)`
- "Standard issue for MOS" → `armory.js:465 createStandardIssue(mos, soldierId)`
- "Read equipped loadout" → `armory.js:134 getLoadout(soldierId)`
- "Save current as kit" → `armory.js:246 saveKit(soldierId, mos)`
- "Load saved kit" → `armory.js:263 loadKit(soldierId, mos)`
- "Degrade after use" → `armory.js:412 degradeItem(itemId, amount)`
- "Destroy item" → `armory.js:453 destroyItem(itemId)`
- "Random loot drop" → `armory.js:506 rollLoot()`
- "Dedup (one-shot on load)" → `armory.js:194 dedupeArmoryByOwnerSlot(roster)`

## Call Graph

Equipping a soldier (typical recruit path):

```
generateRecruit() [roster.js:158]
  └─ equipSoldierStandardIssue(soldier) [roster.js:1658]
       ├─ createStandardIssue(mos, soldier.id)  [armory.js:465]
       │    └─ createItem(templateId, 'standard_issue', {assignedTo}) per slot
       │         └─ Game.armory.items.push(item)
       ├─ soldier.loadout[slot] = item.id
       └─ saveArmory()
```

Load sequence (`storage.js:159–227`):

```
load() → loadArmory() → loadRoster() → _migrateRoster()
  → dedupeArmoryByOwnerSlot(Game.roster)   [one-shot, gated by armory._dedupedV1]
  → saveArmory() if dedup mutated
```

## State Shape

- `Game.armory` (object):
  - `items[]` — flat pool of all gear instances
  - `capacity` — volume limit (default 50)
  - `_dedupedV1` — boolean flag; once true, dedup pass is skipped on future loads
- Item object:
  - `id`, `templateId`, `slot` (`primary` | `sidearm` | `optic` | `attachment` | `armor` | `utility`)
  - `quality` (per `QUALITY_TIERS` in `gear-templates.js:8`)
  - `condition` 0.0–1.0
  - `assignedTo` — soldier ID or `null`
  - `equipped` — boolean (denormalized; also reflected in soldier.loadout)
- Soldier-side (denormalized cache):
  - `soldier.loadout { [slot]: itemId }` — currently equipped
  - `soldier.kits { [mos]: { [slot]: itemId } }` — saved alternate loadouts

## Mutation Points

| Fn | File:Line | Effect |
|---|---|---|
| `createItem` | armory.js:44 | Push new item to pool |
| `assignItem` | armory.js:80 | Set `assignedTo`, optionally `equipped` |
| `unassignItem` | armory.js:105 | Clear `assignedTo` |
| `equipItem` | armory.js:146 | Mark target equipped, others in slot unequipped |
| `unequipSlot` | armory.js:164 | All items in slot → `equipped=false` |
| `saveKit` | armory.js:246 | Snapshot currently equipped → `soldier.kits[mos]` |
| `loadKit` | armory.js:263 | Unequip all, then equip items per saved kit |
| `degradeItem` | armory.js:412 | Reduce `condition` by amount × quality wearRate |
| `destroyItem` | armory.js:453 | Splice from `items[]` |
| `createStandardIssue` | armory.js:465 | Build MOS-default loadout, return item map |
| `rollLoot` | armory.js:506 | Add random unassigned items to pool |
| `dedupeArmoryByOwnerSlot` | armory.js:194 | Remove duplicate items per `(assignedTo, slot)`, preserving kit refs |

## Persistence

- **Saved by:** `saveArmory()` (armory.js:554) — called after `createItem`, `equipSoldierStandardIssue`, end-of-battle persistence.
- **Loaded by:** `loadArmory()` (armory.js:563) → `migrateItemsForKits()` (armory.js:176) backfills `equipped` on legacy items.
- **Storage key:** `cr_s<slot>_cr_armory` (slot-prefixed via `_slotKey`).
- **Migration:** `migrateItemsForKits` for kit-field backfill; `dedupeArmoryByOwnerSlot` one-shot gated by `_dedupedV1`.

## Lifecycle

1. **Create** — `createItem` (manual / loot / standard issue) appends to `items[]`.
2. **Assign + equip** — `assignItem` (sets owner) + `equipItem` (slot exclusivity).
3. **Use** — item participates in combat via soldier loadout lookup; `degradeItem` after engagements.
4. **Maintain** — `repairItem` / unequip / swap kits.
5. **Destroy** — `destroyItem` removes from pool; KIA path strips/destroys via `roster.js:1674/1688`.

## Gotchas

- **Orphaned items from reinforcement churn**: `generateMissionReinforcements` (`mission.js:190`) creates ~30 items per `launchMission`. Reinforcements live on `Game.endless._reinforcements`, not roster. If they don't get added to roster (mission abandoned, defeat), their items remain in `Game.armory.items[]` with `assignedTo` pointing to a non-existent soldier. `dedupeArmoryByOwnerSlot` won't touch these (it dedupes by `(owner, slot)`, doesn't garbage-collect). Cleanup happens only via explicit destroy or future GC.
- **`equipped` field is denormalized**: `item.equipped` and `soldier.loadout[slot]` must stay in sync. All equip/unequip paths go through `assignItem` / `equipItem` / `unequipSlot` to keep them aligned. Don't mutate one without the other.
- **Dedup preserves kit refs**: `dedupeArmoryByOwnerSlot` (armory.js:199–208) checks every soldier's `kits` and skips deleting items referenced by any saved kit, even if a duplicate is also present. This is intentional — kits are the user's saved alternates.
- **Standard issue wear multiplier**: `'standard_issue'` quality has `wearRate: 1.5` (gear-templates.js:8–13). Standard kit degrades faster than `common`. Repair cost scales `0.8–1.2×` by quality, with `2×` penalty if `condition ≤ 0`.
- **Migration save-guard**: `_migrateRoster` (roster.js:1573) tracks `_migrationDirty` so that any recovered/re-equipped items are persisted by an explicit `saveRoster()` at end of migration. Historic bug was re-migrating every load and stacking items — see [soldier-lifecycle gotchas](soldier-lifecycle.md#gotchas).
- **`rollLoot` is wave-end pending wiring**: Task #105 — drops are generated but not yet awarded at wave-end. Future work.

## Cross-references

- [Soldier Lifecycle](soldier-lifecycle.md) — owns loadout/kit fields, calls `equipSoldierStandardIssue`
- [Glossary: kit, loadout, standard issue, save slot](../glossary.md)
- Code: `js/armory.js`, `js/gear-templates.js`, `js/storage.js`

---

*Update by running `/update-doc armory` after touching the listed files. Always refresh `verified` and `verified_hash`.*
