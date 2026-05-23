---
name: item
type: reference
status: stable
verified: 2026-05-22
verified_hash: 881d7ec
tags: [data, shape, armory, gear, items]
files:
  - js/armory.js
  - js/gear-templates.js
  - js/storage.js
  - js/roster.js
related:
  - systems/armory.md
  - systems/soldier-lifecycle.md
  - decisions/ADR-0004-armory-single-source-of-truth.md
---

# `Item` shape reference

An **Item** is a single piece of equipment instance in the armory pool (`Game.armory.items[]`). Constructed exclusively via `createItem(templateId, quality, opts)` at `js/armory.js:44`. Holds its own ownership state (`assignedTo` + `equipped`), making it the **single source of truth** for "what does soldier X have equipped?" — see [ADR-0004](../decisions/ADR-0004-armory-single-source-of-truth.md).

## Field reference

Every field on an item object, with set sites + read sites. Only 8 fields — items are deliberately compact.

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `id` | `string` | `createItem` (`armory.js:52`) via `_generateId` | `assignItem:84`, `equipItem:150`, `getEquipped:121`, `saveKit:195`, `loadKit:217`, `destroyItem:417`, `findKitForItem:270`, `isItemInAnyKit:283`, armory UI, dossier UI | Format: `<prefix>_<base36 ts>_<base36 counter>`. Prefix: `wpn` for primary/sidearm, else 3 chars of slot |
| `templateId` | `string` | `createItem:53` | combat-stat derivation (`roster.js:1318,1361,1378,1399`), repair cost (`repairItem:391`), condition penalty (`roster.js:1352`), UI name/icon lookup | Key into `WEAPON_TEMPLATES` / `OPTIC_TEMPLATES` / `ATTACHMENT_TEMPLATES` / `ARMOR_TEMPLATES` / `UTILITY_TEMPLATES` |
| `slot` | `'primary' \| 'sidearm' \| 'optic' \| 'attachment' \| 'armor' \| 'utility'` | `createItem:54` (from template or `_inferSlot:66-75`) | `assignItem:92`, `equipItem:154`, `unequipSlot:169`, `getEquipped:121`, `getLoadout:140`, `getOwnedItems:130`, `getAvailableItems:296-297`, slot-tabs UI | `_inferSlot` derives from template catalog membership when `template.slot` missing |
| `quality` | `'standard_issue' \| 'common' \| 'improved' \| 'rare'` | `createItem:55` | `QUALITY_TIERS` lookup (wearRate + mult), combat-stat scaling (`roster.js:1326/1365/1382`), repair cost, UI quality class | Per-tier `wearRate` controls degradation speed |
| `condition` | `number` (0.0–1.0) | `createItem:56` (default 1.0), `degradeItem:379`, `repairItem:394` (→ 1.0), `_migrateToArmorySOT:357` (legacy backfill) | combat accuracy penalty when `< 0.5` (`roster.js:1352-1356`), repair cost (`repairItem:389-393`), UI condition display, "damaged-only" filter (`ui.js:1810`) | Clamped to `[0, 1]`. Degradation scaled by quality's `wearRate` |
| `assignedTo` | `string \| null` | `createItem:57`, `assignItem:87` (set), `unassignItem:111` (clear), `_migrateToArmorySOT:356` (legacy reconcile) | `getEquipped:121`, `getLoadout:138`, `getOwnedItems:130`, `saveKit:194`, `loadKit:212/218`, `getAvailableItems:295` (unassigned filter), `findKitForItem:270` | Soldier `id` when owned; `null` when in unassigned pool |
| `equipped` | `boolean` | `createItem:58` (**explicit** `opts.equipped === true`, post-ADR-0004), `assignItem:96/98`, `equipItem:155/158`, `unequipSlot:169`, `loadKit:212/219`, `migrateItemsForKits:181` (legacy backfill: `!!assignedTo`) | `getEquipped:121`, `getLoadout:138`, `saveKit:194`, `kitIsDirty:246`, combat-stat derivation (via `getEquipped`), UI worn indicator (`ui.js:1920`) | Meaningful only when `assignedTo` is set. Legacy items without the field default to `!!assignedTo` via migration |
| `volume` | `number` | `createItem:59` (from `template.volume` or 1) | `getArmoryVolume:444`, `hasArmorySpace:450`, `rollLoot:487` capacity check | Items occupy space against `Game.armory.capacity` |

## Object construction sites

`createItem` is the **only** constructor — no code path pushes directly to `armory.items[]` (verified by grep of `armory.items.push` → returns only `armory.js:62`).

| Path | Where | What |
|---|---|---|
| `createStandardIssue(mos, soldierId)` | `armory.js:465` | Builds MOS-default loadout; calls `createItem` per slot with `{ assignedTo: soldierId, equipped: true }`. Returns map of `{slot: item}`. Called from `equipSoldierStandardIssue` |
| `rollLoot(killsByTier, wave)` | `armory.js:506` | Random loot from enemy kills. Items created with `assignedTo: null` (unassigned, in armory pool) |
| `equipSoldierStandardIssue` | `roster.js:~1612` | Wraps `createStandardIssue`. Single entry point for "give this soldier their starter gear" used by `generateRecruit`, `launchMission` hero creation, `generateMissionReinforcements`, and `seedStarterRoster` infantry |

## Invariants

- **`id` uniqueness**: per save slot, never reused. Counter resets on module reload but timestamps disambiguate
- **`slot` enum**: must be one of the six valid values. `_inferSlot` returns `'unknown'` if it can't determine — that's a code bug, not a valid state
- **`quality` enum**: must be one of the four `QUALITY_TIERS` keys
- **`condition` bounds**: `[0, 1]`. `degradeItem` doesn't clamp explicitly — code should not push below 0 (broken state is `condition <= 0`, with 2× repair-cost penalty)
- **`equipped` pairing**: `equipped: true` is only valid when `assignedTo` is set. `assignedTo: null && equipped: true` is an inconsistent state — should never occur. `assignItem` and `equipItem` enforce this on the write side; reads through `getEquipped` filter on `equipped !== false` so a stray `equipped: undefined` is treated as equipped (legacy backstop)
- **Slot exclusivity per soldier**: at most one item per `(assignedTo, slot)` can have `equipped: true`. `equipItem` enforces by unequipping siblings (`armory.js:151-155`). The OS-level invariant: `getEquipped(soldierId, slot)` should never return more than one item
- **Multiple owned items per slot are allowed** (kit alternates). The invariant is "at most one *equipped* per slot", not "at most one *owned* per slot"

## Persistence

- **Saved by**: `saveArmory()` at `armory.js:516`. Full JSON-stringify of `Game.armory`. Called from many sites (any code that mutates items should call this; convention: caller-saves)
- **Loaded by**: `loadArmory()` at `armory.js:525` → `migrateItemsForKits()` at `armory.js:176` (backfills missing `equipped` on legacy items)
- **Storage key**: `cr_s<slot>_cr_armory`
- **Persisted shape**: `{ items: [...], kits: { [soldierId]: {...} }, capacity, _sotMigratedV1 }`
- **Migrations**:
  - `migrateItemsForKits` — backfills `equipped = !!assignedTo` for items missing the field (legacy saves predating the explicit-equipped fix)
  - `_migrateToArmorySOT` (in `storage.js`) — one-shot per slot. Reconciles items against legacy `soldier.loadout` references, moves `soldier.kits` to `armory.kits[soldier.id]`, sets `_sotMigratedV1` flag

## Gotchas

- **`equipped` is explicit since post-ADR-0004**: `createItem` now sets `equipped: opts.equipped === true` (explicit boolean). Pre-fix, items had `equipped: undefined` and relied on the `equipped !== false` truthy semantics in read sites. Both still coexist — legacy items get `equipped: undefined` backfilled via `migrateItemsForKits`, and read sites still use `!== false` rather than `=== true` to remain compatible. If you change the read logic to `=== true`, audit all migration paths first
- **Orphaned items after soldier retirement**: items still `assignedTo: <retiredSoldierId>` are not auto-cleaned. `retireSoldier` (`roster.js:1182`) clears the soldier's kits but doesn't unassign their items. Known limitation per [ADR-0004 Consequences](../decisions/ADR-0004-armory-single-source-of-truth.md). Future GC task
- **Mission reinforcement orphans**: `generateMissionReinforcements` creates ~30 items per `launchMission` call. If the mission isn't persisted (player abandons, defeat without save), those items remain with `assignedTo` pointing to soldiers that never made it to `Game.roster`. No automatic cleanup; this was previously masked by `dedupeArmoryByOwnerSlot` (removed in ADR-0004)
- **Kit-referenced items must not be destroyed silently**: `destroyItem` doesn't check kit references. Callers responsible for guarding via `isItemInAnyKit(itemId)` first. The destruction UI in the dossier handles this
- **Condition is multi-mission**: degrades during combat, persists across missions. An item at `0.4` in mission 1 stays at `0.4` going into mission 2. No automatic repair between battles
- **`templateId` is the source of all stat lookups** — if a template is renamed or removed, items pointing to the old ID become useless. Migration helpers don't yet handle template renames; treat template IDs as a stable API surface
- **`assignItem` defaults to `equipped: true`** unless `opts.equipped === false`. This is intentional — most "give item to soldier" flows want it equipped immediately. Kit-load is the one path that explicitly passes `equipped: false`

## Cross-references

- [Armory system](../systems/armory.md) — overall armory ownership model + lifecycle
- [Soldier reference](soldier.md) — soldier object (where `assignedTo` points)
- [Soldier Lifecycle system](../systems/soldier-lifecycle.md) — how soldiers acquire/lose items
- [ADR-0004 — Armory single source of truth](../decisions/ADR-0004-armory-single-source-of-truth.md) — why items are authoritative
- [Glossary: kit, loadout, standard issue](../glossary.md)

---

*Update by running `/update-ref item` after touching `js/armory.js`, `js/gear-templates.js`, or item-related code in `js/storage.js` / `js/roster.js`. Always refresh `verified` + `verified_hash`.*
