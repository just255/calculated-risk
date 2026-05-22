---
name: battle-phases
type: system
status: stable
verified: 2026-05-22
verified_hash: 98fca20
tags: [battle, state-machine, phase, deploying, countdown, active]
files:
  - js/game.js
  - js/state.js
  - js/constants.js
  - js/ui.js
entry_points:
  - "game.js:2306 updateDeployment (deploying → countdown)"
  - "game.js:2399 updateCountdown (countdown → active)"
  - "state.js:1192 newBattle (initial phase setup)"
related:
  - systems/deploy-panel.md
  - systems/soldier-lifecycle.md
---

# Battle Phases

## Purpose

The single state machine that governs a live battle. `battle.phase` is the source of truth for which systems run (AI, projectiles, wave spawning), what UI is visible (deploy panel, radio HUD, kill feed, result card), what input is enabled (zone selection vs. hero control), and when soldier progression is applied. Phases are plain string values used directly in code — no enum constant.

## Quick Reference

- "Read current phase" → `battle.phase` (string)
- "Initial setup" → `state.js:1192 newBattle` (caller sets `phase = 'deploying'`)
- "Trigger countdown" → `game.js:2306 updateDeployment` — when both teams `deployReady`
- "Start active" → `game.js:2399 updateCountdown` — at ~5.0s elapsed
- "Mark defeat" → `game.js:2809 / 7107` (set `b.result = 'defeat'`)
- "Mark victory" → `game.js:7123 / 7432` (set `b.result = 'victory'`)
- "Camera by phase" → `game.js:3823 drawDeploymentPhase`

## Call Graph

```
deploying  ── both deployReady ──→ countdown ── 5s elapsed ──→ active
   ↑                                    ↑                         │
   │                                    │ (returns possible)      │
   └────────── (rare: redeploy) ────────┘                         │
                                                                  ├─→ wave_complete
                                                                  ├─→ victory
                                                                  └─→ defeat

active ⇌ paused (mission cutscene, dialog, debug)
```

## State Shape

- `battle.phase` — string: `'deploying' | 'countdown' | 'active' | 'wave_complete' | 'victory' | 'defeat'`
- `battle.deployReady` — `{ blue: bool, red: bool }` — gates `deploying → countdown`
- `battle.countdownStart` — timestamp set when countdown begins
- `battle.result` — `'victory' | 'defeat'` (also acts as terminal-state marker)
- `battle._blueMarching` — bool, set ~2s into countdown to start blue march
- `battle._debugPaused` — bool, for debugger pause
- `Game.subState` — `SubState.PLAYING | SubState.LANE_SELECT` — input routing only, independent of phase
- `isDialogPaused(b)` — mission/dialog system can suppress AI/projectile updates without changing phase

## Mutation Points

| From → To | File:Line | Trigger |
|---|---|---|
| `deploying → countdown` | game.js:2307 | `updateDeployment`: both `deployReady` true; also calls `createRadioHUD()` and removes `.deploy-panel` |
| `countdown → active` | game.js:2399 | `updateCountdown`: `elapsed >= 5.0s` |
| `active → defeat` | game.js:2809, 7107 | Home zone lost / hero dead → set `b.result = 'defeat'` |
| `active → victory` | game.js:7123, 7432 | Scenario win condition → set `b.result = 'victory'` |
| `active → wave_complete` | game.js:3068 | Wave cleared (endless mode) |
| `active ↔ paused` | mission/debug paths | Via `isDialogPaused(b)` or `_debugPaused` (no phase mutation; behaves as pause overlay) |

## Phase-Specific Behavior

| Phase | AI/projectiles | Deploy panel | Radio HUD | Camera | Hero input |
|---|---|---|---|---|---|
| `deploying` | frozen | shown | hidden | overview | zone select only |
| `countdown` | running (blue frozen until `_blueMarching` flips at 2s) | removed | shown (created at transition) | lerps to hero | blocked |
| `active` | full loop | gone | visible | hero follow | full control |
| `wave_complete` | paused (`result` set) | n/a | visible | frozen | review UI only |
| `victory` / `defeat` | paused | n/a | visible | frozen | result screen only |
| `paused` (overlay) | paused | n/a | visible | frozen | dialog/menu only |

Phase-gated logic lives in:
- `game.js:2499–2503` — early-return guards in main update
- `game.js:3674` — combat cursor hide excludes deploying/countdown
- `game.js:3823 drawDeploymentPhase` — camera logic gates on phase

## Persistence

N/A. Phase is transient battle state, not saved. The persistent side effects (soldier stats, MMR, KIA → fallen) are applied when the battle ends (`victory`/`defeat`/`wave_complete` block in game.js:5578 area), and those go through the [soldier-lifecycle](soldier-lifecycle.md) save path.

## Lifecycle

1. **newBattle** (`state.js:1192`) — battle object created; caller sets `phase = 'deploying'`.
2. **Mount** — `endlessBattleHTML` renders screen; deploy panel inserted by `renderDeployPanel`.
3. **Deploy interaction** — user picks zone, squad, formation; presses DEPLOY → `deployReady.blue = true` (red set in `updateDeployment`).
4. **deploying → countdown** — `updateDeployment` (game.js:2306) flips phase, removes panel, creates radio HUD, starts `countdownStart` timer.
5. **Countdown** — units march in from spawn (`_blueMarching` flips at ~2s); camera lerps to hero zone; input blocked.
6. **countdown → active** — at ~5s, `updateCountdown` sets `phase = 'active'`; full loop starts.
7. **Active combat** — AI, projectiles, waves, hero control all live.
8. **End condition** — wave clear sets `result = wave_complete`; full mission win sets `result = 'victory'`; hero death / objective loss sets `result = 'defeat'`.
9. **Post-battle** — stats applied (`game.js:5578` block calls `recordBattleScore`, promotion/demotion, KIA → fallen).

## Gotchas

- **Phase is a string, not an enum.** Both `State` (the screen-level state machine in `constants.js`) and `battle.phase` are strings. Don't import a `BATTLE_PHASES` enum — it doesn't exist. Always string-compare.
- **Radio HUD during deploy** (resolved): historically the radio HUD was created on screen mount, overlapping the deploy panel. Fix: `createRadioHUD()` is only called from `updateDeployment` at the `deploying → countdown` transition (game.js:2310). Endless mode has a fallback creation when `phase === 'active'` for restarted battles that skip countdown.
- **Blue march delay**: `_blueMarching` doesn't flip immediately on countdown — there's a ~2s pre-march pause so the camera lerp completes before units start moving. AI for red runs throughout countdown.
- **`paused` is not a phase mutation.** Pause is implemented via `isDialogPaused(b)` and `_debugPaused` flags that short-circuit updates. `phase` stays `'active'`. UI checks the flag separately.
- **Wave-complete uses `result` field, not phase string.** Endless mode wave-complete sets `b.result = 'wave_complete'` rather than mutating `phase` (game.js:3068). Treat `result` as the terminal signal, not phase.

## Cross-references

- [Deploy Panel](deploy-panel.md) — lives entirely in the `deploying` phase
- [Soldier Lifecycle](soldier-lifecycle.md) — post-battle stats applied at end-of-battle
- [Glossary: battle phases, hero](../glossary.md)
- Code: `js/game.js` (`updateDeployment`, `updateCountdown`, main update guards), `js/state.js` (`newBattle`), `js/ui.js` (`endlessBattleHTML`, `renderDeployPanel`)

---

*Update by running `/update-doc battle-phases` after touching the listed files. Always refresh `verified` and `verified_hash`.*
