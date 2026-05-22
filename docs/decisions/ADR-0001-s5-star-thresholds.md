---
name: ADR-0001-s5-star-thresholds
type: adr
status: accepted
date: 2026-05-21
deciders: [dev, claude]
affected_files:
  - js/ui.js
related:
  - systems/soldier-lifecycle.md
log:
  - date: 2026-05-21
    hash: 98fca20
    note: Initial decision, landed in dossier redesign (commit 98fca20)
---

# ADR-0001: S5 proficiency star thresholds

## Context

The soldier dossier needed a quick-read indicator of role mastery, and the underlying signal was a continuous `0.0–1.0` proficiency float on `soldier.training[role]`. A single percentage was numerically precise but visually cold; a binary "skilled / not skilled" lost meaningful gradation. We wanted an at-a-glance icon that scanned in <0.5s and conveyed both the absolute tier and the position within that tier.

Constraints:
- Mobile landscape and desktop both need the same compact visual.
- No external icon dependencies — match the existing Oxanium/tactical aesthetic.
- Must be derivable purely from the existing `training[role]` field; no new persistent state.
- Tier labels should feel military, not arcade.

## Decision

Map the `0.0–1.0` proficiency range to a 5-star tier system at 20% intervals:

| Range | Tier | Stars |
|---|---|---|
| 0.00–0.19 | **TRAINEE** | ★☆☆☆☆ |
| 0.20–0.39 | **RECRUIT** | ★★☆☆☆ |
| 0.40–0.59 | **REGULAR** | ★★★☆☆ |
| 0.60–0.79 | **VETERAN** | ★★★★☆ |
| 0.80–1.00 | **MASTER** | ★★★★★ |

The tier helper is centralized so any UI surface (dossier header pill, expanded panel, MOS dropdown) renders consistently. The expanded panel shows the underlying percentage in addition to the star icon for users who want precision.

## Alternatives Considered

- **10-star (10% per star)** — finer resolution, but stars become hard to count at small sizes, and the labels stop feeling meaningful (a "3 of 10 specialist" reads worse than "RECRUIT").
- **Letter grades (F → A+)** — academic feel clashed with the military theme; also less visually distinct at a glance.
- **Numeric % only** — precise but cold; user feedback flagged it as a UX miss versus the icon-pill in the mockup.
- **Status quo (no tier)** — leaves the dossier feeling unfinished and forces users to mentally bin the percentage themselves.

## Consequences

- **Easier:** all proficiency UI now derives from one helper. Adding new surfaces (e.g., recruit picker, mission debrief) gets the tier mapping for free.
- **Easier:** the rank/tier vocabulary now matches military tone (TRAINEE → MASTER) instead of generic UX tiers (Bronze/Silver/Gold).
- **Harder:** tuning. Changing the thresholds later means re-balancing what feels like "MASTER" content. We accepted this — the 20% cuts are deliberately coarse to absorb small tuning swings.
- **Accepted cost:** users who want a precise number must open the expanded panel. The pill alone gives tier + position-in-tier via the fill state, not exact %.

## Log

Append-only. Don't edit prior entries.

- **2026-05-21 @ 98fca20:** Initial decision, landed in the dossier redesign commit (Dossier redesign, deploy panel HTML refactor (phase 1+2), battle UX fixes).

---

*To append a log entry: add to body `## Log` AND to frontmatter `log:` array. Never edit prior entries.*
