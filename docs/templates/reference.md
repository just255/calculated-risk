---
name: REPLACE-WITH-OBJECT-NAME
type: reference
status: stable
verified: YYYY-MM-DD
verified_hash: REPLACE-WITH-SHORT-HASH
tags: [data, shape]
files:
  - js/path/to/file.js
related:
  - systems/related-system.md
---

# `<Object>` shape reference

One-paragraph description of what this object represents and where it lives (e.g., `Game.roster[]`, `Game.armory.items[]`, `Game.endless.battle`).

## Field reference

Every field on the object. Group logically (identity / state / ownership / etc.) when long. Each row: name, type, set sites (function + file:line), read sites (or "many — see notes"), notes.

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `id` | string | `createX` (file.js:N) | universal | format / invariants |
| `field2` | type | sites | sites | |

For removed fields, keep a row marked **REMOVED** and point at the ADR — prevents reintroduction.

| `loadout` | — | **REMOVED** ([ADR-NNNN](../decisions/ADR-NNNN-slug.md)) | — | Use `getEquipped(soldier.id, slot)` |

## Object construction sites

Where objects of this shape get *created*, with which path each fills in which fields. Useful for spotting when one site forgets a field another sets.

- `createX` (file.js:N) — primary constructor; sets identity + defaults
- `migrateX` (file.js:N) — backfills field Y on legacy data
- ...

## Invariants

Rules that must hold across all instances. Each enforced (or not) by which code path.

- `id` is globally unique within a save slot — enforced by `_generateId` counter
- ...

## Persistence

How instances reach localStorage and back, plus migration version flags.

- Saved by: `saveX()` (file.js:N) — full JSON serialize of the array/object
- Loaded by: `loadX()` (file.js:N) — calls `_migrateX()` on legacy entries
- Storage key: `cr_s<slot>_cr_xxx` (slot-prefixed)
- Migration flags: `_migratedXxxV1` etc.

## Gotchas

- Specific landmines: dual-write hazards, denormalization concerns, ordering requirements
- Removed fields that older saves might still carry
- Edge cases that bit us before

## Cross-references

- [Related System](../systems/related-system.md)
- [ADR-NNNN](../decisions/ADR-NNNN-slug.md)

---

*Update by running `/update-ref <name>` after touching the listed files. Always refresh `verified` and `verified_hash`.*
