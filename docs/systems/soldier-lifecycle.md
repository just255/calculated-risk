---
name: soldier-lifecycle
type: system
status: stable
verified: 2026-05-22
verified_hash: 98fca20
tags: [roster, soldier, recruitment, memorial, lineage]
files:
  - js/roster.js
  - js/mission.js
  - js/storage.js
entry_points:
  - "roster.js:92 createSoldier"
  - "roster.js:158 generateRecruit"
  - "roster.js:1658 equipSoldierStandardIssue"
  - "mission.js:48 launchMission"
  - "mission.js:190 generateMissionReinforcements"
related:
  - systems/armory.md
  - systems/battle-phases.md
  - decisions/ADR-0001-s5-star-thresholds.md
---

# Soldier Lifecycle

## Purpose

Owns persistent soldier identity — name, rank, MOS, personality, physicals, training, MMR — across the full lifecycle from recruitment through retirement or KIA. Also owns vehicle crew assignments, loadout binding (item IDs in `soldier.loadout` and saved `soldier.kits`), memorial preservation (5-slot wall), and lineage influence on future recruits. Persistence is per save-slot.

## Quick Reference

- "Create a recruit" → `roster.js:158 generateRecruit()`
- "Create the hero / mission starter" → `mission.js:48 launchMission()` then `createSoldier` + `equipSoldierStandardIssue`
- "Equip standard issue" → `roster.js:1658 equipSoldierStandardIssue(soldier)` (single authoritative equip)
- "Read effective MMR" → `roster.js:348 getMMR(soldier)` (max of `mmr` and `mmrFloor`)
- "Post-battle stats application" → `game.js:5578` block, calls `recordBattleScore`, `applyPromotion`/`applyDemotion`
- "Move KIA to fallen" → `roster.js:728 processKIAToFallen()`
- "Add KIA to memorial wall" → `roster.js:627 addToMemorial()`
- "Save/load roster" → `roster.js:1699 saveRoster`, `storage.js:201 loadRoster`

## Call Graph

```
launchMission()  [mission.js:48]
  ├─ createSoldier({pool,role,physicals,rankIndex})  [roster.js:92]
  ├─ equipSoldierStandardIssue(soldier)              [roster.js:1658]
  │    ├─ createStandardIssue(mos, soldier.id)       [armory.js:465]
  │    │    └─ createItem(templateId, 'standard_issue', ...) per slot
  │    ├─ soldier.loadout[slot] = item.id            (denormalized cache)
  │    └─ saveArmory()
  └─ Game.roster.push(soldier)

generateRecruit()             [roster.js:158]   — UI recruit pool
generateMissionReinforcements()[mission.js:190] — 5 reinforcements per launch
```

Both `generateRecruit()` and `generateMissionReinforcements()` call `equipSoldierStandardIssue` **once, inside** the function. Callers must not re-equip — see Gotchas.

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
  - `loadout {primary, sidearm, optic, attachment, armor, utility}` — item IDs
  - `kits { [mos]: { [slot]: itemId } }` — saved per-MOS loadouts
  - `insigniaSetId`, `isPlayerCharacter`, `missionsWithVehicle`
- `Game.memorial[]` — preserved KIA, max 5 (`roster.js:556 MEMORIAL_MAX_SLOTS`)
- `Game.recentFallen[]` — FIFO of recent KIA, max 10

## Mutation Points

| Fn | File:Line | What it does |
|---|---|---|
| `createSoldier` | roster.js:92 | Allocates soldier with ID + defaults |
| `generateRecruit` | roster.js:158 | Recruit + equip |
| `seedStarterRoster` | roster.js:1462 | Seeds 41 starter soldiers (one-time) |
| `equipSoldierStandardIssue` | roster.js:1658 | Authoritative equip + `saveArmory()` |
| `stripGear` | roster.js:1674 | Unassign loadout items back to pool |
| `destroyGear` | roster.js:1688 | Destroy loadout items (KIA path) |
| `assignToVehicle` | roster.js:262 | Bind soldier to vehicle crew slot |
| `recordBattleScore` | roster.js:410 | Update mmr, streak, commendations |
| `applyPromotion` / `applyDemotion` | roster.js:388 / 398 | Rank shifts |
| `promoteToOfficer` | roster.js:1042 | Move to officer pool |
| `retireSoldier` | roster.js:1182 | Mark retired, move to fallen |
| `healAllSoldiers` / `rushHeal` | roster.js:1840 / 1861 | Restore HP, tick wounded counter |
| `addToMemorial` | roster.js:627 | Move qualifying KIA to wall |
| `processKIAToFallen` | roster.js:728 | Batch move KIA → recent fallen |
| `_migrateRoster` | roster.js:1573 | One-time backfills (with `_migrationDirty` save guard) |
| Post-battle block | game.js:5578 | `kills`, `battlesServed`, promotion/demotion |

## Persistence

- **Saved by:** `saveRoster()` (roster.js:1699), called after loadout changes and at battle end via `saveRosterAndVehicles()` (game.js:5693).
- **Loaded by:** `loadRoster()` (storage.js:201) → calls `_migrateRoster()` (roster.js:1573).
- **Storage keys (slot-prefixed via `_slotKey`):**
  - `cr_s<slot>_cr_roster` — active + KIA soldiers
  - `cr_s<slot>_cr_vehicles` — vehicle inventory
  - `cr_s<slot>_cr_memorial` — memorial wall (5 fixed)
  - `cr_s<slot>_cr_recent_fallen` — recent KIA FIFO (10)
- **Load sequence:** reset state → `loadArmory` → `loadRoster` → `_migrateRoster` → `loadVehicles` → `loadMemorial` → seed starters if first-time → cleanup stale vehicle assignments.
- **Migration safety:** `_migrateRoster` sets `_migrationDirty = true` if it recovered/re-equipped any soldier, then `saveRoster()` runs at end (roster.js:1652-1654). Prevents the historic re-migrate-every-load bug.

## Lifecycle

1. **Recruit** — `generateRecruit()` creates E-1 with standard issue gear bound, pushes to roster.
2. **Train** — Battles accumulate `battlesServed`, `kills`, role-specific `training[role]`.
3. **Deploy** — `launchMission()` or crew assignment binds soldier to vehicle/squad.
4. **Return** — `game.js:5578` block runs `recordBattleScore`, applies promotion/demotion.
5. **Wound/KIA** — `status = 'wounded'` (HP regen + `woundedBattlesLeft`) or `'kia'`.
6. **Process fallen** — `processKIAToFallen()` moves KIA to `recentFallen`.
7. **Memorialize** — qualifying KIA (legacy score `mmrFloor + 3×battlesServed` ≥ 150) eligible for `addToMemorial`.
8. **Lineage** — `getMemorialLineageInfluence()` seeds new recruit personality from memorial entries.

## Gotchas

- **Equip exactly once** (resolved): `createSoldier` does *not* equip. `generateRecruit`, `generateMissionReinforcements`, and `launchMission` all call `equipSoldierStandardIssue` once internally. Callers must not call it again — duplicate items will be created with no guard. Confirmed clean as of `verified_hash`.
- **Migration re-run loop** (resolved): `_migrateRoster` historically didn't `saveRoster` after recovering orphaned loadouts, so every load re-migrated and stacked items. Fix: `_migrationDirty` flag + `saveRoster()` at end of migration (roster.js:1652).
- **Soldier ID collision** (theoretical): `sol_<timestamp36>_<counter36>`. Counter is module-scoped; survives a single session. Not cryptographically safe against rapid recreate-on-different-tab edge cases. In practice fine.
- **Vehicle assignment refs stale across reloads** (guarded): `loadVehicles` (roster.js:1793) and `seedStarterVehicles` (roster.js:1811) unassign soldiers whose `assignedVehicleId` no longer exists.
- **Reinforcement orphaning**: `generateMissionReinforcements` creates 5 soldiers + 30 items per `launchMission`. If mission ends without persisting them, items are orphaned with `assignedTo` set but no roster owner. Cleaned by `dedupeArmoryByOwnerSlot` on next load (see [armory](armory.md#gotchas)).

## Cross-references

- [Armory](armory.md) — item pool, standard issue creation, dedup, kit/loadout slots
- [Battle Phases](battle-phases.md) — stats applied post-battle in `active → wave_complete` transition
- [ADR-0001 — S5 star thresholds](../decisions/ADR-0001-s5-star-thresholds.md) — proficiency tier display tied to `training` field
- [Glossary: MMR, MOS, lineage, memorial, kit, loadout](../glossary.md)
- Code: `js/roster.js`, `js/mission.js`, `js/storage.js`, post-battle in `js/game.js:5578`

---

*Update by running `/update-doc soldier-lifecycle` after touching the listed files. Always refresh `verified` and `verified_hash`.*
