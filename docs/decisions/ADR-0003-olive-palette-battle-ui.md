---
name: ADR-0003-olive-palette-battle-ui
type: adr
status: accepted
date: 2026-05-21
deciders: [dev, claude]
affected_files:
  - index.html
  - js/ui.js
related:
  - systems/deploy-panel.md
  - systems/battle-phases.md
log:
  - date: 2026-05-21
    hash: 98fca20
    note: Olive palette scoped to battle UI surfaces (deploy panel, radio HUD); HQ remains blue-gray + green
---

# ADR-0003: Olive military palette scoped to battle UI

## Context

The HQ surfaces (Operations, Barracks, Armory, Insignia, Replays, Proving Ground) share a blue-gray + accent-green palette established in `index.html` CSS variables: `--bg-dark`, `--bg-medium`, `--bg-light` (cool grays) with `--accent-green`, `--accent-red`, `--accent-yellow`, `--accent-blue`, `--accent-orange`. That palette reads as a clean command-center UI — appropriate for planning surfaces.

The battle screen has different needs. When the player is mid-engagement, the UI should feel like field/combat tactical (browns, olives, muted khakis) — visually distinct from the planning surfaces. During the deploy panel HTML refactor we had a fresh opportunity to introduce a palette shift without disrupting HQ.

Constraints:
- The shared CSS variables (`--bg-*`, `--accent-*`) drive a lot of HQ — touching them globally is risky.
- Mobile and desktop must use the same palette.
- The shift should feel intentional, not "broken theme."
- Battle canvas itself doesn't change — terrain colors are already biome-driven. This is about UI chrome.

## Decision

Introduce an **olive military palette scoped to battle UI surfaces only**:

- Deploy panel (HTML) uses olive-tinted backgrounds, khaki accents, and muted gold highlights.
- Radio HUD adopts the same palette.
- HQ surfaces remain on the existing blue-gray + accent-green palette.
- The two palettes are not interpolated or shared via CSS variables — they are explicit color values on the battle-UI classes, kept localized to make the boundary clear.

Scope is *narrow on purpose*: no migration of all battle UI to olive in this commit — kill feed, end-of-battle result card, etc. stay on the existing colors until they're individually touched. The goal is to set the direction and let subsequent UI work move things over as it touches them.

## Alternatives Considered

- **Repaint everything olive** — bolder, but a much larger change and risks making HQ feel disconnected from the rest of the game's military-techy aesthetic.
- **Keep one palette** — simpler, but loses the planning-vs-fighting distinction the redesign was aiming for.
- **Per-biome battle UI palette** — interesting but overcomplicated; the canvas already shifts by biome, and the UI chrome doesn't need to.
- **Dark "tactical" mode toggle** — user-controlled instead of context-driven. Adds an option to maintain; doesn't actually fix the planning-vs-fighting distinction.

## Consequences

- **Easier:** new battle-UI components have an established palette to draw from. Future work (kill feed restyle, end-of-battle card) can pull from the same set.
- **Easier:** mental model is cleaner — "HQ blue-gray, battle olive" — and reinforces the planning-vs-fighting separation.
- **Harder:** there are now two color systems in the codebase. Components built for HQ won't drop straight into battle UI; either we add a battle-themed variant or document the palette explicitly.
- **Harder:** mid-refactor period. Until subsequent UI passes migrate older battle surfaces, the battle screen mixes olive (deploy panel, radio HUD) and the old palette (kill feed, result card). Accepted as transitional.
- **Accepted cost:** no CSS-variable abstraction for the olive palette yet — colors are inlined. If we later want runtime theming, this will need to be factored. We're not paying that abstraction cost preemptively.

## Log

Append-only. Don't edit prior entries.

- **2026-05-21 @ 98fca20:** Initial scope: olive palette applied to deploy panel (HTML refactor) and radio HUD. HQ unchanged. Other battle-UI surfaces (kill feed, result card) deferred to individual passes.

---

*To append a log entry: add to body `## Log` AND to frontmatter `log:` array. Never edit prior entries.*
