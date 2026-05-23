---
name: deploy-panel
type: system
status: in-flux
verified: 2026-05-23
verified_hash: fd2ce61
tags: [battle, deploy, ui, html-refactor]
files:
  - js/ui.js
  - js/main.js
  - js/game.js
  - js/state.js
entry_points:
  - "ui.js:7960 renderDeployPanel"
  - "ui.js:7980 deployPanelHTML"
  - "game.js:5854 confirmDeployment"
  - "game.js:5892 selectDeployZone"
  - "game.js:2306 updateDeployment (phase transition)"
related:
  - systems/battle-phases.md
  - systems/soldier-lifecycle.md
  - decisions/ADR-0002-canvas-deploy-panel-to-html.md
---

# Deploy Panel

## Purpose

Owns squad/leader selection, mission loadout configuration, deploy-zone selection, and the DEPLOY trigger during the `deploying` battle phase. Currently in the middle of a canvas-to-HTML refactor (phases 1–2 landed, phases 3–5 pending). The panel is an absolutely-positioned overlay inside `.endless-battle-screen` and is *surgically* updated via `renderDeployPanel()` to avoid wiping the battle canvas.

## Quick Reference

- "Render the panel (surgical DOM swap)" → `ui.js:7960 renderDeployPanel()`
- "Generate panel HTML (phase-gated)" → `ui.js:7980 deployPanelHTML(b)`
- "Confirm and deploy squad" → `game.js:5854 confirmDeployment(b)`
- "Select a deploy zone" → `game.js:5892 selectDeployZone(b, zoneName)`
- "Transition deploying → countdown" → `game.js:2306 updateDeployment(b)`
- "Event delegation for `dp-*` actions" → `main.js:2185–2270`

## Call Graph

```
HQ Operations DEPLOY click
  → createEndlessBattle() (uses opsConfig)
  → battle.phase = 'deploying'  [state.js:1732]
  → endlessBattleHTML render
  → first frame: renderDeployPanel() inserts panel beforeend of .endless-battle-screen

user interacts (zone select, preset, unit add/remove)
  → main.js:2185+ event delegation
  → mutation fn (selectDeployZone / confirmDeployment / etc.)
  → renderDeployPanel()  [SURGICAL: queries .deploy-panel, replaces innerHTML]
  → canvas in .endless-battlefield untouched

user clicks DEPLOY
  → confirmDeployment(b)  [game.js:5854]
       sets b.deployReady.blue = true; positions hero + units
  → next frame: updateDeployment(b)  [game.js:2306]
       both teams ready → b.phase = 'countdown'
       document.querySelector('.deploy-panel')?.remove()
       createRadioHUD()

countdown → active (after ~5s)
```

## State Shape

All panel state lives on the battle object `b`:

- `b.phase` — must equal `'deploying'` for panel to render
- `b.units[]` — current squad lineup (excluding hero)
- `b.hero` — leader unit
- `b.deployZones.blue` — 3 zones (ALPHA / BRAVO / CHARLIE), each with `selected`, `_expanded`, `units[]`
- `b.reservePool[]` — undeployed units available to add
- `b._selectedUnit` — unit open in side drawer (null = closed)
- `b._selectedPreset` — applied loadout preset ID
- `b._deployFormation` — `'line' | 'wedge' | 'column' | 'spread' | 'staggered' | 'echelon_l' | 'echelon_r'`
- `b._poolTab` — `'infantry' | 'vehicle' | ...`
- `b.playMode` — `'unit' | 'cmd'`
- `b.deployReady.{blue,red}` — gate transition to countdown

UI-internal state (expansion, selection) is transient; the panel re-renders from `b` on every mutation.

## Mutation Points

| Fn / Action | File:Line | What it mutates |
|---|---|---|
| `confirmDeployment` | game.js:5854 | hero/unit positions, `deployReady.blue` |
| `selectDeployZone` | game.js:5892 | zone `selected`, `_expanded` |
| `dp-pool-select` | main.js:2220 | `b._selectedUnit` |
| `dp-pool-add` | main.js:2228 | move unit from pool → lineup |
| `dp-lineup-remove` | main.js:2240 | move unit lineup → pool |
| `dp-lineup-select` | main.js:2252 | `b._selectedUnit` |
| `dp-drawer-close` | main.js:2259 | `b._selectedUnit = null` |
| `dp-mode` | main.js:2263 | `b.playMode`, `Game.endless.playMode` |
| `dp-collapse` | main.js:2203 | `zone._expanded` |
| `dp-pool-tab` | main.js:2214 | `b._poolTab` |
| `dp-formation` change | (main.js) | `b._deployFormation` |
| Phase transition | game.js:2307 | `b.phase = 'countdown'` + panel `.remove()` |

**Rule:** every `dp-*` action must call `renderDeployPanel()`, never `render()`. See [ADR-0002](../decisions/ADR-0002-canvas-deploy-panel-to-html.md).

## Persistence

N/A. Deploy panel state is transient (lives only on the battle object during the `deploying` phase). Squad composition coming *in* via `opsConfig` is persisted by the [Operations](../glossary.md) tab on the HQ side; deploy-time decisions don't write to localStorage.

## Lifecycle

1. **Battle init** — `newBattle()` (`state.js:1732`) sets `phase: 'deploying'`, creates `deployZones`, `deployReady = {blue:false, red:false}`, populates `reservePool` from `opsConfig`.
2. **Screen mount** — `endlessBattleHTML()` renders the screen; canvas appended imperatively by BattleRenderer.
3. **First panel render** — `renderDeployPanel()` queries `.endless-battle-screen` and inserts panel via `insertAdjacentHTML('beforeend')`.
4. **Interaction loop** — every mutation triggers `renderDeployPanel()` → surgical `.replaceWith()` swap. Canvas in `.endless-battlefield` is never touched.
5. **DEPLOY click** — `confirmDeployment` sets `deployReady.blue = true`, positions units; next frame `updateDeployment` flips phase to `countdown` and explicitly `.remove()`s the panel.
6. **Phase-gate safety** — `deployPanelHTML(b)` returns `''` if `b.phase !== 'deploying'`, so any stray render call after transition is a no-op that removes the DOM node.

## Gotchas

- **Canvas-disappearing bug** (resolved 2026-05-21): full-screen `render()` during `deploying` re-built `app.innerHTML` and orphaned the canvas reference held by `BattleRenderer`. Fix: `renderDeployPanel()` (ui.js:7960–7978) does a surgical query + `.replaceWith()` — never touches `.endless-battlefield`. Rule documented on lines 7955–7958.
- **Panel-not-hiding after DEPLOY** (resolved): two-layer safety — `updateDeployment` (game.js:2312) explicitly removes the panel on phase transition; `deployPanelHTML` (ui.js:7985) returns empty string if `phase !== 'deploying'`, so a stray render call still removes the node.
- **Wrong container positioning** (resolved): panel is `position:absolute` inside `.endless-battle-screen` (which is `position:relative`, set at index.html:10404). Panel is a sibling of `.endless-controls`, NOT inside it. Z-index 10; kill feed is 300+ but only renders during combat.
- **Phase-gate on all `dp-*` handlers**: if a handler runs after phase transitioned to `countdown`, `renderDeployPanel()` produces empty HTML and the panel disappears as expected. Never call `render()` from a deploy handler — it will redraw the battle screen and destroy the canvas.

## Pending Work (Phases 3–5)

- **Phase 3** (task #111) — small unit-thumbnail canvases inside the SQUAD column (replacing text-only lineup rows with mini portraits).
- **Phase 4** (task #112) — delete dead canvas code (`drawDeployZones` and related helpers now bypassed).
- **Phase 5** (task #113) — CSS port from mockup + service-worker cache bump.

## Cross-references

- [Battle Phases](battle-phases.md) — the `deploying` phase that owns this panel
- [Soldier Lifecycle](soldier-lifecycle.md) — units shown in lineup
- [ADR-0002 — Canvas deploy panel to HTML](../decisions/ADR-0002-canvas-deploy-panel-to-html.md)
- Code: `js/ui.js` (`renderDeployPanel`, `deployPanelHTML` + `_*ColHTML` helpers), `js/main.js:2185–2270` (event delegation), `js/game.js:2306` (transition), `index.html:10404+` (CSS for `.endless-battle-screen` and `.deploy-panel`)

---

*Update by running `/update-doc deploy-panel` after touching the listed files. Always refresh `verified` and `verified_hash`. Status will move to `stable` once phases 3–5 land.*
