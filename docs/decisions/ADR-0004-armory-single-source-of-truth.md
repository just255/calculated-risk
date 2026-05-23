---
name: ADR-0004-armory-single-source-of-truth
type: adr
status: accepted
date: 2026-05-22
deciders: [dev, claude]
affected_files:
  - js/armory.js
  - js/roster.js
  - js/storage.js
  - js/mission.js
  - js/main.js
  - js/game.js
related:
  - systems/armory.md
  - systems/soldier-lifecycle.md
log:
  - date: 2026-05-22
    hash: 17f3bfe
    note: Initial decision and implementation. Removed soldier.loadout / soldier.kits; armory is now the only source of equipment ownership. Bandaid code from 0e7f782 deleted in the same change.
  - date: 2026-05-22
    hash: 14601d2
    note: Two regressions caught by chrome-devtools-driven smoke pass. (1) createSoldier still initialized empty soldier.loadout/kits fields, so fresh soldiers re-grew the cache after migration stripped it. (2) seedStarterRoster relied on the deleted _migrateRoster orphan-recovery block to equip infantry starters, leaving them naked. Both fixed; doc bodies still accurate (the rule "soldier object carries no equipment state" was always the intent).
  - date: 2026-05-22
    hash: 881d7ec
    note: Fixed one of two distinct orphan paths called out in the Consequences section. The "retry-orphan" path (setup-deploy resets roster but not armory, so failed-attempt items accumulate across retries on the same first-mission slot) is fully resolved by a new resetArmory() helper called from main.js setup-deploy. A "vehicle-crew-orphan" path was filed (Task #132) but later determined to be a non-issue — see 33fc203 log entry.
  - date: 2026-05-22
    hash: 33fc203
    note: Cleaned up the "intro vehicles persist in motor pool" complaint (user-flagged) — extractFromRun now filters out _isReinforcement vehicles before save(). Also retracted the "vehicle-crew-orphan-items" concern (was Task #132, deleted) — code inspection confirmed generateMissionReinforcements creates only infantry reinforcements and createVehicle does not produce crew soldier records, so there's no orphan-items path from vehicle crew. The original confusion came from me inferring without reading the code, exactly the failure CLAUDE.md principle #12 warns against.
  - date: 2026-05-22
    hash: e30f8c2
    note: Completed the retry-orphan fix. User-flagged 30 fresh orphan items appearing after intro-mission attempts despite 881d7ec. Root cause was game.js:2802's in-mission retry-on-death path calling launchFirstTimeMission() directly, bypassing setup-deploy and therefore my earlier resetArmory call. Moved the cleanup inside launchMission (the canonical gateway every mission launch passes through) as a roster-based prune of armory.items. setup-deploy's now-redundant resetArmory call was removed. Also added mission.js/main.js/game.js to this ADR's affected_files so the drift hook flags future commits.
---

# ADR-0004: Armory as single source of equipment ownership

## Context

Through `0e7f782`, the data model had **two parallel representations of "what does this soldier have equipped?"**:

1. `armory.items[]` filtered by `assignedTo === soldier.id && equipped !== false` (the authoritative form already used by all UI and combat reads via `getEquipped` / `getLoadout`)
2. `soldier.loadout = { [slot]: itemId }` (a denormalized cache written by `equipSoldierStandardIssue`, `stripGear`, `destroyGear`, and `_migrateRoster`)

Two sources must stay in sync. They didn't. A specific failure mode — `_migrateRoster` creating fresh standard-issue items when `soldier.loadout` referenced orphaned IDs, but not calling `saveRoster` afterward — caused every page load to detect the same orphan condition, generate another set of items, and stack duplicates in `armory.items`. Items accumulated indefinitely per save slot.

Commit `0e7f782` shipped two backstops for this:

- `dedupeArmoryByOwnerSlot` (`armory.js`) — one-shot pass that cleans accumulated duplicates, gated by `armory._dedupedV1`.
- `_migrationDirty` + owned-item recovery + terminal `saveRoster()` in `_migrateRoster` (`roster.js`) — stops the migration loop by persisting recovered loadouts.

Both worked, but neither attacked the underlying smell: the dual representation. The migration self-heals; the dedup cleans damage. The class of bug remains structurally possible because the second source of truth is still there.

A pre-flight grep + trace pass revealed:

- All UI, combat, and equip code already reads via `getEquipped(soldierId, slot)` and `getLoadout(soldierId)` (`armory.js:117`, `134`), which compute from `armory.items` directly. No external code reads `soldier.loadout`.
- All kit helpers (`saveKit`, `loadKit`, `kitIsDirty`, `findKitForItem`) already read equipped state from `armory.items`. Only the *kit storage location* lives on the soldier (`soldier.kits`).
- Replays don't capture either field.
- The combat hot path caches `unit.weapon` at spawn and does not re-derive from `soldier.loadout`.

So the dual-source design was already largely vestigial. `soldier.loadout` was a write-only cache that nothing read; `soldier.kits` was the only field that needed an actual relocation.

## Decision

Remove `soldier.loadout` and `soldier.kits` entirely. Make the armory the only source of equipment ownership:

- **`armory.items[].assignedTo`** + **`armory.items[].equipped`** are authoritative for "is this item equipped on a soldier?"
- **`armory.kits[soldierId][mos][slot] = itemId`** stores saved kits, replacing `soldier.kits`.
- `getEquipped(soldierId, slot)` and `getLoadout(soldierId)` (already exist) remain the canonical read API.
- `createStandardIssue` is updated to explicitly tag new items with `equipped: true`, removing reliance on the implicit "undefined-as-truthy" semantics of `equipped !== false`.
- A one-shot load-time migration (`_migrateToArmorySOT` in `storage.js`, gated by `armory._sotMigratedV1`) moves existing `soldier.kits` into `armory.kits[soldierId]`, defensively reconciles `armory.items` against `soldier.loadout` one last time, then strips both fields.
- The bandaid code from `0e7f782` (`dedupeArmoryByOwnerSlot`, `_migrationDirty`, the loadout-backfill block in `_migrateRoster`) is deleted in the same change — it's structurally unreachable once the dual source is gone.

## Alternatives Considered

- **Tighten the dual-write contract**: keep both fields, require every write site to update both atomically (likely via a single helper). Less code churn. Rejected — it preserves the class of bug. Any future write site or refactor that forgets to update one of the two stores reintroduces the desync. The contract is invisible to grep and easy to break.
- **Move to a separate ownership table** (e.g., `armory.assignments[soldierId][slot] = itemId`): full normalization, with items knowing nothing about ownership and an explicit mapping table. Cleaner in theory, but the existing `assignedTo`/`equipped` fields on items are already in use everywhere and adding a third structure would be more disruption for no additional safety. Rejected as premature.
- **Memoize `getLoadout` results**: keep `armory.items` as the canonical store but cache the computed loadout-per-soldier in a Map. Faster reads but reintroduces a cache to invalidate at every mutation site — partial revival of the very desync class we're trying to eliminate. Rejected; if a profile later shows `getLoadout` is hot, memoize at the call site (e.g., per-HUD), not at the armory layer.
- **Status quo (keep the bandaids)**: ship and forget. Rejected explicitly by the user — bandaids create tech debt.

## Consequences

**Easier:**
- The duplication bug class is structurally eliminated. There is no second source for `armory.items` to desync from.
- The soldier object is cleaner — identity, stats, status, but no equipment state.
- Mental model simplifies: "armory owns what soldiers have."
- The bandaid code (`dedupeArmoryByOwnerSlot`, `_migrationDirty`) is deleted in the same change, leaving a cleanly factored HEAD.

**Harder / accepted cost:**
- `getLoadout(soldierId)` filters `armory.items` per call. At current scale (~500 items, ~50 soldiers) this is invisible. If something hot proves to need it, memoize per call site, not at the armory.
- The soldier object lost two fields. Existing saves run a one-shot migration on first load.
- **Constraint (one-way migration)**: downgrading to a pre-refactor build will re-trigger duplication. An older `_migrateRoster` would see no `soldier.loadout`, treat soldiers as needing standard issue, and create duplicate items (the existing armory items would remain assigned + equipped, the new ones get added on top). Not a concern for solo play; documented here so a future contributor isn't surprised.
- Items that were assigned to a soldier who's now retired and removed from roster will keep their `assignedTo = soldier.id` (unchanged behavior). `retireSoldier` now also clears `armory.kits[soldier.id]`, but the items themselves persist until explicitly destroyed. Garbage collection of these is out of scope.

## Log

Append-only. Don't edit prior entries.

- **2026-05-22 @ 17f3bfe:** Initial decision and implementation. `soldier.loadout` and `soldier.kits` removed from the soldier object. Kit storage moved to `armory.kits[soldierId]`. One-shot load-time migration (`_migrateToArmorySOT`, gated by `armory._sotMigratedV1`) strips legacy fields. Bandaid code from `0e7f782` (`dedupeArmoryByOwnerSlot`, `_migrationDirty`, loadout-backfill block in `_migrateRoster`) deleted in the same change.
- **2026-05-22 @ 14601d2:** Two regressions caught by chrome-devtools smoke pass and fixed. (1) `createSoldier` still pre-initialized empty `soldier.loadout` and `soldier.kits` fields, so freshly-created soldiers re-grew the dead cache after migration stripped it. Removed the field initializers. (2) `seedStarterRoster` was relying on the deleted `_migrateRoster` orphan-recovery block to equip infantry starters on first load — without that block, starters spawned naked. Added an explicit `equipSoldierStandardIssue` call in the seed loop, plus a terminal `saveRoster()` so a reseed doesn't re-trigger. Doc bodies still accurate; the architectural rule ("soldier object carries no equipment state") was always the intent — these were missed write sites.
- **2026-05-22 @ 881d7ec:** Fixed one of two distinct orphan paths flagged under Consequences. The "retry-orphan" path — `setup-deploy` resetting `Game.roster` but not `Game.armory`, so failed-attempt items accumulated across retries on the same slot (3 retries had been leaving 30 orphan items at 100% capacity) — is **fully resolved** by a new `resetArmory()` helper in `armory.js` called from `setup-deploy`. A "vehicle-crew-orphan" path was *filed* as Task #132 but later **retracted** — see `33fc203` log entry.
- **2026-05-22 @ 33fc203:** Two corrections.
  1. **Vehicle-in-motor-pool cleanup (user-flagged real bug)**: intro-mission Sherman reinforcements were persisting in `Game.vehicles` post-mission. `extractFromRun()` now filters out `_isReinforcement: true` vehicles before `save()`. The `launchMission`-side filter (which removes prior reinforcements on next mission start) still exists; this adds the symmetric cleanup at mission-end.
  2. **Vehicle-crew-orphan-items was NOT a real bug** — Task #132 deleted. Code inspection confirmed `generateMissionReinforcements` only creates infantry reinforcements; `createVehicle` does not produce crew soldier records. Vehicle crew are synthesized at deploy-time as unit-level state with no persistent soldier identity, so they cannot orphan armory items. The original task description (and the corresponding gotcha in `armory.md`) was based on an unverified inference rather than reading the code. CLAUDE.md principle #12 captures the failure mode.
- **2026-05-22 @ e30f8c2:** Completed the retry-orphan fix that `881d7ec` only half-addressed. User reported 30 fresh orphan items appearing post-mission despite the earlier `resetArmory()` call. Root cause: `game.js:2802` has a separate in-mission retry-on-death code path (`b._isMission` branch) that calls `launchFirstTimeMission()` directly, **bypassing** `setup-deploy` and therefore the `resetArmory` I added there. Each death-restart leaked 3 reinforcements × 5 items = 15 orphans; 2 deaths + a survival = 30 orphans in the user's save. **Fix**: moved the cleanup into `launchMission` itself as a roster-based prune (`armory.items.filter(i => !i.assignedTo || rosterIds.has(i.assignedTo))`). `launchMission` is the canonical gateway every mission launch passes through, so both `setup-deploy` *and* the retry-on-death path now get clean armories. The earlier `resetArmory()` call in `setup-deploy` is now redundant and was removed (the export remains as a documented utility). Also extended this ADR's `affected_files:` list to include `mission.js`, `main.js`, and `game.js` so the drift hook catches future regressions.

---

*To append a log entry: add to body `## Log` AND to frontmatter `log:` array. Never edit prior entries.*
