---
name: ADR-0002-canvas-deploy-panel-to-html
type: adr
status: accepted
date: 2026-05-21
deciders: [dev, claude]
affected_files:
  - js/ui.js
  - js/main.js
  - js/game.js
  - index.html
related:
  - systems/deploy-panel.md
  - systems/battle-phases.md
log:
  - date: 2026-05-21
    hash: 98fca20
    note: Phases 1 (render) and 2 (actions) landed in 98fca20. Phases 3–5 pending.
  - date: 2026-05-22
    hash: 0e7f782
    note: Closed panel-not-hiding edge case — explicit .deploy-panel.remove() in updateDeployment + deployPanelHTML phase guard. Belt-and-suspenders safety on the deploying→countdown transition.
---

# ADR-0002: Move deploy panel from canvas to HTML (with surgical render)

## Context

The deploy panel — squad selector, zone chips, formation picker, loadout presets — was originally drawn directly on the battle canvas during the `deploying` phase. That coupling carried real costs:

- **Hit-testing was manual**: mouse/touch handlers ran geometry math against the canvas, fragile when layout changed.
- **Accessibility and platform features lost**: no native keyboard nav, no native scrolling on long lists, no easy a11y story, no CSS-driven hover/focus states.
- **Iteration was slow**: every visual tweak required canvas-draw code edits and pixel-perfect testing.
- **Mobile feedback** flagged the canvas-rendered controls as the weakest part of the deploy UX (touch targets too small, no scroll affordance).

The conventional answer is "render UI in HTML, render the world in canvas." But there's a sharp edge specific to this app: the battle canvas is appended imperatively by `BattleRenderer` into `.endless-battlefield`. The standard top-level `render()` function rebuilds `app.innerHTML` and **wipes the canvas element**, orphaning the renderer's reference. Calling `render()` during the `deploying` phase therefore can't be the answer — we needed an HTML panel that updates without re-rendering the screen wrapper.

## Decision

Move the deploy panel to HTML and ship a dedicated **surgical render helper** for it:

- `deployPanelHTML(b)` (`js/ui.js:7980`) generates the panel's HTML, returning `''` if `b.phase !== 'deploying'` so the panel auto-hides on phase transition.
- `renderDeployPanel()` (`js/ui.js:7960`) is the *only* function that mounts/updates the panel. It queries `.endless-battle-screen`, finds the existing `.deploy-panel`, and uses `.replaceWith()` to swap it. It never touches `.endless-battlefield` or the canvas.
- The panel is positioned `absolute` inside `.endless-battle-screen` (set to `position: relative`), as a sibling of the canvas wrapper and HUD layers.
- All `dp-*` event-delegation handlers in `main.js` call `renderDeployPanel()` (never `render()`) after mutating state.
- Phase transition (`deploying → countdown`) explicitly removes the panel in `updateDeployment` (`game.js:2312`), backed up by the empty-string return in `deployPanelHTML` if a stray call slips through.

Refactor is staged in 5 phases — phases 1 (render) and 2 (actions) are done; phases 3 (small unit canvases inside panel), 4 (delete dead canvas code), 5 (CSS port + cache bump) remain.

## Alternatives Considered

- **Status quo (keep canvas)** — preserves a single rendering surface but locks in the iteration cost, the mobile UX issues, and the manual hit-testing. Rejected on UX grounds.
- **Full `render()` during deploy phase** — straightforward HTML, but blows away the canvas and orphans the BattleRenderer reference, causing the battle to "disappear" until next mount. Rejected — would require restructuring how BattleRenderer holds canvas refs (a much larger change).
- **Rebuild the canvas reference each render** — possible but adds reattachment cost on every panel update and complicates BattleRenderer's lifecycle.
- **Render panel into a portal outside the battle screen** — workable but loses the natural absolute-positioning context and complicates z-index management for kill-feed/HUD overlays.

## Consequences

- **Easier:** rapid iteration on panel UX with HTML + CSS; native scroll, focus, keyboard support; trivial to add new controls.
- **Easier:** the `deploy-panel` is now testable / inspectable via DevTools like any other DOM element.
- **Harder:** developers must remember the **invariant** that handlers call `renderDeployPanel()`, not `render()`. We documented this in code comments at `ui.js:7955–7958` and in the [deploy-panel system doc](../systems/deploy-panel.md). A grep guardrail (`grep -nE "render\(\)" js/main.js` near `dp-` handlers) is a candidate for future tooling.
- **Accepted cost:** dead canvas code (`drawDeployZones` and helpers) still sits in `game.js` until phase 4. Adds noise but harmless.
- **Accepted cost:** during the in-flux phases (3–5), the panel mixes HTML structure with embedded small canvases (planned phase 3). Coexistence is fine — the surgical render boundary still holds.

## Log

Append-only. Don't edit prior entries.

- **2026-05-21 @ 98fca20:** Phases 1 (render) and 2 (actions) landed. Panel is in HTML, all `dp-*` handlers wired, surgical render confirmed not to disturb the battle canvas. Phases 3–5 pending (tasks #111–#113).
- **2026-05-22 @ 0e7f782:** Closed the panel-not-hiding edge case with belt-and-suspenders safety on the `deploying → countdown` transition: explicit `.deploy-panel.remove()` in `updateDeployment` (game.js:2311) + phase guard in `deployPanelHTML` that returns `''` when `b.phase !== 'deploying'` (ui.js:7982). Either alone would have closed it; both together survive future ordering changes.

---

*To append a log entry: add to body `## Log` AND to frontmatter `log:` array. Never edit prior entries.*
