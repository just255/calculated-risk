---
name: soldier-lifecycle
type: system
status: stable
verified: 2026-05-22
verified_hash: 0e7f782
tags: [roster, soldier, recruitment, memorial, lineage]
files:
  - js/roster.js
  - js/mission.js
  - js/storage.js
entry_points:
  - "roster.js:92 createSoldier"
  - "roster.js:158 generateRecruit"
  - "roster.js:~1658 equipSoldierStandardIssue"
  - "mission.js:48 launchMission"
  - "mission.js:190 generateMissionReinforcements"
related:
  - systems/armory.md
  - systems/battle-phases.md
  - decisions/ADR-0001-s5-star-thresholds.md
  - decisions/ADR-0004-armory-single-source-of-truth.md
---

# Soldier Lifecycle

## Purpose

Owns persistent soldier identity — name, rank, MOS, personality, physicals, training, MMR — across the full lifecycle from recruitment through retirement or KIA. Also owns vehicle crew assignments, memorial preservation (5-slot wall), and lineage influence on future recruits. **Equipment state is owned by the [armory](armory.md), not the soldier** — see [ADR-0004](../decisions/ADR-0004-armory-single-source-of-truth.md). Persistence is per save-slot.

## Quick Reference

- "Create a recruit" → `roster.js:158 generateRecruit()`
- "Create the hero / mission starter" → `mission.js:48 launchMission()` then `createSoldier` + `equipSoldierStandardIssue`
- "Equip standard issue" → `roster.js:~1658 equipSoldierStandardIssue(soldier)` (creates items in armory; no soldier-side write)
- "Strip / destroy a soldier's gear" → `roster.js stripGear(soldier)` / `destroyGear(soldier)` (iterate `getOwnedItems`)
- "Read effective MMR" → `roster.js:348 getMMR(soldier)` (max of `mmr` and `mmrFloor`)
- "Post-battle stats application" → `game.js:5578` block, calls `recordBattleScore`, `applyPromotion`/`applyDemotion`
- "Move KIA to fallen" → `roster.js:728 processKIAToFallen()`
- "Add KIA to memorial wall" → `roster.js:627 addToMemorial()`
- "Retire soldier" → `roster.js:1182 retireSoldier(soldierId)` (also cleans `armory.kits[soldier.id]`)
- "Save/load roster" → `roster.js saveRoster`, `storage.js:201 loadRoster`

## Call Graph

```
launchMission()  [mission.js:48]
  ├─ createSoldier({pool,role,physicals,rankIndex})  [roster.js:92]
  ├─ equipSoldierStandardIssue(soldier)              [roster.js:~1658]
  │    ├─ createStandardIssue(mos, soldier.id)       [armory.js:465]
  │    │    └─ createItem(templateId, 'standard_issue',
  │    │                  { assignedTo, equipped: true }) per slot
  │    └─ saveArmory()
  └─ Game.roster.push(soldier)

generateRecruit()             [roster.js:158]   — UI recruit pool
generateMissionReinforcements()[mission.js:190] — 5 reinforcements per launch
```

`equipSoldierStandardIssue` no longer writes any field on the soldier object. Items hold their own ownership (`assignedTo` + `equipped`). Combat / UI reads use `getEquipped(soldier.id, slot)` from the armory.

## State Shape

- `Game.roster[]` — active + KIA soldier objects. Soldier shape (key fields):
  - `id` — `sol_<base36 timestamp>_<base36 counter>` (roster.js:42)
  - `name {first,last,nickname}`, `callsign`, `rankIndex` 0–9, `experience`
  - `personality {aggression, patience, courage, discipline, initiative, awareness}` 0–1 each
  - `physicals {vision, strength, reflexes, endurance}` 0–100 each
  - `mos`, `training { [role]: 0..1 }`, `vehicleExpertise`
  - `pool: 'infantry' | 'vehicle' | 'officer'`, `role`, `status: 'active' | 'wounded' | 'kia'`
  - `hpPercent`, `morale`, `fatigue`, `woundedBattlesLeft`
  - `mmr`, `mmrFloor`, `streak`, `battlesServed`, `kills`, `commendations[]`, `heroicActions[]`
  - `assignedVehicleId`, `assignedSlot`, `isSquadLeader`
  - `insigniaSetId`, `isPlayerCharacter`, `missionsWithVehicle`
- **No equipment fields**: `soldier.loadout` and `soldier.kits` are deprecated and stripped on first load post-migration by `_migrateToArmorySOT` (`storage.js`). Equipment ownership lives in `armory.items` (`assignedTo` + `equipped`) and `armory.kits[soldier.id]`. See [armory.md State Shape](armory.md#state-shape).
- `Game.memorial[]` — preserved KIA, max 5 (`roster.js:556 MEMORIAL_MAX_SLOTS`)
- `Game.recentFallen[]` — FIFO of recent KIA, max 10

## Mutation Points

| Fn | File:Line | What it does |
|---|---|---|
| `createSoldier` | roster.js:92 | Allocates soldier with ID + defaults |
| `generateRecruit` | roster.js:158 | Recruit + equip |
| `seedStarterRoster` | roster.js:1462 | Seeds 41 starter soldiers (one-time) |
| `equipSoldierStandardIssue` | roster.js:~1658 | Calls `createStandardIssue` (items take ownership); `saveArmory()` |
| `stripGear` | roster.js | Iterate `getOwnedItems(soldier.id)`, `unassignItem` each |
| `destroyGear` | roster.js | Iterate `getOwnedItems(soldier.id)`, `destroyItem` each |
| `assignToVehicle` | roster.js:262 | Bind soldier to vehicle crew slot |
| `recordBattleScore` | roster.js:410 | Update mmr, streak, commendations |
| `applyPromotion` / `applyDemotion` | roster.js:388 / 398 | Rank shifts |
| `promoteToOfficer` | roster.js:1042 | Move to officer pool |
| `retireSoldier` | roster.js:1182 | Mark retired, move to fallen, delete `armory.kits[soldier.id]` |
| `healAllSoldiers` / `rushHeal` | roster.js | Restore HP, tick wounded counter |
| `addToMemorial` | roster.js:627 | Move qualifying KIA to wall |
| `processKIAToFallen` | roster.js:728 | Batch move KIA → recent fallen |
| `_migrateRoster` | roster.js | One-time backfills (physicals/MOS/training only) |
| Post-battle block | game.js:5578 | `kills`, `battlesServed`, promotion/demotion |

## Persistence

- **Saved by:** `saveRoster()` (roster.js), called after stat changes and at battle end via `saveRosterAndVehicles()` (game.js:5693).
- **Loaded by:** `loadRoster()` (storage.js:201) → `_migrateRoster()` (roster.js).
- **Storage keys (slot-prefixed via `_slotKey`):**
  - `cr_s<slot>_cr_roster` — active + KIA soldiers
  - `cr_s<slot>_cr_vehicles` — vehicle inventory
  - `cr_s<slot>_cr_memorial` — memorial wall (5 fixed)
  - `cr_s<slot>_cr_recent_fallen` — recent KIA FIFO (10)
- **Load sequence:** reset state → `loadArmory` → `loadRoster` → `_migrateRoster` → `_migrateToArmorySOT` (one-shot SOT migration in storage.js) → `loadVehicles` → `loadMemorial` → seed starters if first-time → cleanup stale vehicle assignments.

## Lifecycle

1. **Recruit** — `generateRecruit()` creates E-1; `equipSoldierStandardIssue` creates items in armory tagged to the soldier.
2. **Train** — Battles accumulate `battlesServed`, `kills`, role-specific `training[role]`.
3. **Deploy** — `launchMission()` or crew assignment binds soldier to vehicle/squad.
4. **Return** — `game.js:5578` runs `recordBattleScore`, applies promotion/demotion.
5. **Wound/KIA** — `status = 'wounded'` (HP regen + `woundedBattlesLeft`) or `'kia'`.
6. **Process fallen** — `processKIAToFallen()` moves KIA to `recentFallen`.
7. **Memorialize** — qualifying KIA (legacy score `mmrFloor + 3×battlesServed` ≥ 150) eligible for `addToMemorial`.
8. **Lineage** — `getMemorialLineageInfluence()` seeds new recruit personality from memorial entries.

## Gotchas

- **Armory is the source of truth for equipment** ([ADR-0004](../decisions/ADR-0004-armory-single-source-of-truth.md)): the soldier object no longer carries `loadout` or `kits` fields. Adding them back would reintroduce a class of duplication bugs. To read "what does soldier X have?" call `getLoadout(soldier.id)` / `getEquipped(soldier.id, slot)`.
- **Retire cleans armory.kits**: `retireSoldier` deletes `Game.armory.kits[soldier.id]` and calls `saveArmory()` so retired soldiers don't leak kit storage. Items they owned stay in armory with `assignedTo = soldier.id` — they become unreachable through normal UI (no soldier to query) but persist as data; a future GC pass could prune these.
- **Soldier ID collision** (theoretical): `sol_<timestamp36>_<counter36>`. Counter is module-scoped; survives a single session. Not cryptographically safe against rapid recreate-on-different-tab edge cases. In practice fine.
- **Vehicle assignment refs stale across reloads** (guarded): `loadVehicles` and `seedStarterVehicles` unassign soldiers whose `assignedVehicleId` no longer exists.
- **Reinforcement orphaning**: `generateMissionReinforcements` creates 5 soldiers + ~30 items per `launchMission`. If a mission ends without persisting them to roster, items remain in armory with `assignedTo` pointing to a non-existent soldier. No automatic GC; this is a separate concern from the dual-source bug ADR-0004 fixed. Future work.

## Cross-references

- [Armory](armory.md) — owns equipment state (`armory.items`, `armory.kits`); soldier reads via `getEquipped` / `getLoadout`
- [Battle Phases](battle-phases.md) — stats applied post-battle in `active → wave_complete` transition
- [ADR-0001 — S5 star thresholds](../decisions/ADR-0001-s5-star-thresholds.md) — proficiency tier display tied to `training` field
- [ADR-0004 — Armory as single source of equipment ownership](../decisions/ADR-0004-armory-single-source-of-truth.md)
- [Glossary: MMR, MOS, lineage, memorial, kit, loadout](../glossary.md)
- Code: `js/roster.js`, `js/mission.js`, `js/storage.js`, post-battle in `js/game.js:5578`

---

*Update by running `/update-doc soldier-lifecycle` after touching the listed files. Always refresh `verified` and `verified_hash`.*
