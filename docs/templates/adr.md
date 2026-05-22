---
name: ADR-NNNN-slug
type: adr
status: proposed     # proposed | accepted | superseded-by-ADR-NNNN | deprecated
date: YYYY-MM-DD
deciders: [dev, claude]
affected_files:
  - js/path/to/file.js
related:
  - systems/related-system.md
log:
  - date: YYYY-MM-DD
    hash: REPLACE-WITH-SHORT-HASH
    note: Initial decision
---

# ADR-NNNN: Title

## Context

What problem prompted this decision. What constraints exist. Why now.

## Decision

What we chose, in one paragraph. Direct, declarative.

## Alternatives Considered

- **Option A** — pros / cons / why not
- **Option B** — pros / cons / why not
- **Status quo** — what happens if we don't act

## Consequences

- What this makes easier
- What this makes harder
- What we accepted as cost

## Log

Append-only record of significant follow-ups. Don't edit prior entries; add new ones.

- **2026-MM-DD @ hash:** Initial decision (this commit).
- **YYYY-MM-DD @ hash:** What changed and why (e.g., "Phase 1 implementation landed; ADR still accurate.")

---

*To append a log entry: add to the body's Log section AND to frontmatter `log:` array. Never edit prior entries.*
