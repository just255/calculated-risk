---
name: REPLACE-WITH-KEBAB-CASE-NAME
type: system
status: stable
verified: YYYY-MM-DD
verified_hash: REPLACE-WITH-SHORT-HASH
tags: [tag1, tag2]
files:
  - js/path/to/file.js
entry_points:
  - "file.js:NN functionName"
related:
  - systems/other-system.md
  - decisions/ADR-NNNN-slug.md
---

# System Name

## Purpose

One paragraph. Why this subsystem exists, what problem it solves, what its boundary is.

## Quick Reference

Common operations with `file:line` refs. Write "N/A" if the system isn't operation-heavy.

- "Create a new X" → `file.js:N createX()`
- "Persist Y" → `file.js:M saveY()`
- "Migrate legacy Z" → `file.js:K _migrateZ()`

## Call Graph

Text tree or Mermaid showing how calls flow when the system is exercised. Write "N/A" if there's no meaningful graph.

```
entryPoint()
  ├─ helperA()
  │  └─ helperA1()
  ├─ helperB()
  └─ persistResult()
```

## State Shape

Where state lives. One line per location.

- `Game.foo` — array of foo objects, see `file.js:N`
- `Game.bar.items` — flat pool with `assignedTo` field
- `localStorage['cr_foo_<slot>']` — persisted JSON; written by `saveFoo()`

Write "N/A" for stateless utilities.

## Mutation Points

Every function that changes state, with a code ref. Helps trace "who wrote this field?".

- `file.js:42 createFoo` — adds entry to `Game.foo`
- `file.js:78 assignBar` — flips `bar.assignedTo` from null to soldierId
- `other.js:100 _migrateFoo` — backfills missing fields; called from `loadFoo`

Write "N/A" if this system doesn't mutate shared state.

## Persistence

- **Saved by:** function names + when triggered
- **Loaded by:** function names + load order + dependencies
- **Storage key(s):** `cr_xxx_<slot>` etc.
- **Migration:** any one-time cleanup logic

Write "N/A" if nothing is persisted.

## Lifecycle

Step-by-step from start to finish, for flow-shaped systems. Write "N/A" if the system is purely event-driven.

1. User does X
2. State Y mutates
3. Effect Z fires
4. ...

## Gotchas

Known sharp edges. Each has a date, code ref, and one-line mitigation. Write "None known" if there genuinely aren't any (rare).

- **Double-equip bug** (resolved 2026-05-21): `mission.js:48-55` calls `equipSoldierStandardIssue` after `createSoldier`. Required — `createSoldier` doesn't equip by itself. Removing those calls strips mission gear. See [ADR-NNNN].
- **Migration timing** (resolved 2026-05-21): `_migrateRoster` previously didn't call `saveRoster`, causing every load to re-trigger migration and accumulate duplicate items. Fix: `_migrationDirty` flag + `saveRoster()` at end of migration.

## Cross-references

- Related systems: [Other System](other-system.md)
- ADRs: [ADR-NNNN — Decision title](../decisions/ADR-NNNN-slug.md)
- Code paths: `file.js`, `other.js`

---

*To update this doc: re-verify against current code, refresh `verified` date + `verified_hash` in frontmatter, add any new gotchas.*
