---
name: battle
type: reference
status: stable
verified: 2026-05-23
verified_hash: fd2ce61
tags: [data, shape, battle, runtime]
files:
  - js/state.js
  - js/game.js
  - js/ai-pipeline.js
  - js/mission.js
  - js/replay-recorder.js
related:
  - systems/battle-phases.md
  - systems/deploy-panel.md
  - decisions/ADR-0002-canvas-deploy-panel-to-html.md
---

# `Battle` shape reference

The Battle object is the **transient runtime state** of an active engagement — what lives at `Game.endless.battle` (also constructed for campaign + fire range modes). Constructed by three factories in `js/state.js`: `newEndlessBattle` (state.js:1571, also used for first-time mission), `newCampaignBattle` (state.js:457), `newFireRangeBattle` (state.js:1899). **Not persisted** — recreated per battle; outcomes flow out to roster/armory/replays.

## Phase enum

Battle progresses through phases as strings (not enum constants). String-compare only.

- `'deploying'` — deploy panel open, awaiting user confirmation
- `'countdown'` — 3-second countdown, units marching in
- `'active'` — combat
- `'wave_complete'` — wave cleared, awaiting "Next Wave"
- `'victory'` / `'defeat'` — terminal results
- `'paused'` — implicit via `_missionDialogActive` / `_missionWaitForClick`; phase stays `'active'`, input gated separately

## Field reference — grouped

### Identity & configuration

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `mode` | string | state.js:1635, 2129 | UI rendering, mode switches | `'endless'`, `'fire_range'`, or null for campaign |
| `fireRange` | boolean | state.js:2129 | Fire-range-specific logic | True only in fire-range factory |
| `cellSize` | number | state.js:1638 | Map rendering, pathfinding | Always 64 |
| `gridWidth` / `gridHeight` | number | state.js:1639-1640 | Terrain gen, map bounds | From `ENDLESS_MAP_SIZES` |
| `mapWidth` / `mapHeight` | number | state.js:1648-1649 | Camera, spawn, UI | `grid* × cellSize` |
| `sizeTier` | string | state.js:1643 | UI tooltips | `'Small'` / `'Medium'` / `'Large'` |
| `_sizeTier` | object | state.js:1644 | Endless scaling | Cached `ENDLESS_MAP_SIZES[chosenSize]` |
| `enemyMult` | number | state.js:1645 | Wave scaling | Per-size multiplier |
| `_isFirstRun` | boolean | mission.js:70 (via Game.endless) | First-time UI / reinforcement gating | |
| `_isMission` | boolean | mission.js:180 | Wave gate, mission script | True when `initFirstTimeMission` ran |
| `_insigniaSetId` | string | ai-pipeline.js:426 | Unit insignia assignment | Active insignia set for blue |
| `_fromOpsConfig` | boolean | state.js:1810 | Deployment-pool filter | True if created from Operations squad config |

### Map & terrain

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `terrain` | `Array<Array>` | state.js:1652 | Fallback pathfinding, fire-range render | 2D type grid |
| `terrainCanvases` | `{terrainCanvas, canopyCanvas, bridgeDeckCanvas}` | state.js:1655 | `BattleRenderer.setTerrainFromCanvases` | Null if PCG fails |
| `terrainMap` | `Array<Array>` | state.js:1656 | `findValidSpawnPos` (terrain-aware spawn) | PCG collision grid |
| `pcgSpawnZones` | `Array<{x,y,radius}>` | state.js:1657 | Fire-range spawn zone assignment | |
| `terrainLabel` | string | state.js:1658 | Battle UI banner | `"Medium: Temperate Forest (Summer) #987654"` |
| `terrainSeed` | number | state.js:1659 | Replay determinism, display | |
| `terrainConfig` | `{biome, season, templateName, pcgParams}` | state.js:1660 | Replay/persistence | |
| `blueSpawnZone` / `redSpawnZone` | `{x,y,radius}` | state.js:2144-2145 | Fire-range spawn | Fire-range only |

### Phase machinery

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `phase` | string | factories @ `state.js:1732`; transitions @ `game.js:2307` (→countdown), `game.js:2399` (→active) | universal | See phase enum above |
| `deployReady` | `{blue, red}` bools | state.js:1733; main.js (DEPLOY click → blue=true) | `updateDeployment` (`game.js:2306`) transition guard | Both must be true to advance to countdown |
| `countdownStart` | timestamp | game.js:2308 | Countdown timer display | Null until countdown |
| `playMode` | string | state.js:1735 | Hero control mode switch | `'unit' \| 'sgt' \| 'cmd'` (only unit implemented in endless) |
| `stageDepth` | number | state.js:1736 | Wave-1 hero off-map spawn | ~10% of mapHeight |
| `deployZones` | `{blue: Array<zone>, red: Array<zone>}` | state.js:1737 | Deploy panel UI + spawn placement | ALPHA / BRAVO / CHARLIE per side |
| `result` | string \| null | game.js:2809 (`'defeat'`), 7123 (`'victory'`), 3016 (extract) | Post-battle rewards, replay | **Terminal signal, NOT a phase.** See [battle-phases gotchas](../systems/battle-phases.md#gotchas) |

### Combat entities

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `hero` | unit object | state.js:1667 (via `createUnit`) + state.js:~1780 (opsConfig patch: `_soldierId`, `unitName`, `personality`, `_role`, and since `fd2ce61` the 7 gear-derived stats `_gearAccuracy` / `_gearSpread` / `_gearReloadTime` / `_gearMagSize` / `_gearCritChance` / `_gearPenetration` / `_gearEffectiveRange`) | hero input, render, damage, combat-stat lookup | See [unit shape] (TBD). Always non-null during battle. Gear stats only present when `Game.endless._opsConfig.heroUnit` resolves to a roster soldier |
| `units` | Array | state.js:1699; deploy panel; reinforcement spawn | render, AI, deaths | Blue team. Always array, never null |
| `enemies` | Array | state.js:1711; `spawnEndlessWave` | render, AI, targeting | Red team. Always array, never null |
| `projectiles` | Array | state.js:1716; fire events; per-frame physics | render, collision | Active in-flight projectiles |
| `effects` | Array | state.js:1717; explosions, hits | VFX render | Particles |
| `_squads` | Array of Squad | ai-pipeline.js:442 | commander → sergeant assignment, formation | Built from unit `_squadId`. May be empty |
| `_sergeants` | `{blue, red}` (legacy) | ai-pipeline.js:545 | Legacy fire-range code | First sergeant of each team |
| `_teamCommanders` | `{blue, red}` Commander | ai-pipeline.js:415 | Objective assignment, wave escalation | |
| `_teamWaypoints` | object | ai-pipeline.js:409 | Squad-coordination waypoints | |
| `_squadWaypoints` | object | ai-pipeline.js:410 | Sergeant path planning | |
| `_visibleEnemies` | `Set<enemyId> \| null` | ai-pipeline.js:414 | Fog-of-war system | **Null in fire range** (no FOW) |
| `_redFollowerOffset` | number | ai-pipeline.js:661 | Throttled brain rotation | Per-frame rotation index |
| `_soldierMetrics` | `Map<soldierId, {shotsFired, ...}>` | ai.js:5301 | Crew progression | Per-soldier per-battle metrics |
| `_teamLeaders` | `{blue, red}` | state.js:2221 | Fire-range only | Team leader reference |
| `enemyLeader` | unit object | state.js:2152 | Fire-range only | Red command structure |

### Input & control

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `keys` | `{w, a, s, d: bool}` | state.js:1705; main.js keydown | hero movement | Per-frame keydown state |
| `mouse` | `{x, y, down}` | state.js:1706; main.js | aim, deploy zone select | |
| `joystickInput` | `{moveX, moveY, aimX, aimY}` \| null | state.js:1707; mobile input | hero movement (mobile), aim | |
| `aimAngle` | number | state.js:1708 | turret rotation | Direct from joystick; null → computed from mouse |
| `_commanderUI` | `{selectedSquadId, pendingOrder, visible}` | state.js:2180 | CMD mode squad selection | Fire-range only currently |

### Wave & mission state

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `wave` | number | state.js:1720; `spawnEndlessWave` increment | enemy scaling, UI | |
| `waveStartTime` | timestamp | state.js:1721 | wave timer display | Set when wave begins |
| `waveComplete` | boolean | game.js:3046 | phase transition guard, UI | True when all enemies dead & no reserves |
| `enemiesSpawned` / `enemiesRemaining` | number | state.js:1712-1713; spawn + death events | wave progress UI | |
| `spawnQueue` | `Array<{enemy, spawnTime}>` | game.js:2930, state.js:2174 | delayed/staggered spawn | |
| `kills` | number | state.js:1726; per-kill increment | score calc, UI | Red unit death count |
| `commandFeedback` | string | state.js:1729 | command HUD text | Transient, cleared per frame |
| `_mission` | object | mission.js:142 | cutscene/dialog sequencing | `{phase, currentWave, waveKillsStart, fadeStartTime, zonePixelHeight, ...}` |
| `_missionDialogActive` | boolean | mission.js:401 | dialog UI, combat pause | |
| `_missionWaitForClick` | boolean | mission.js:394 | dialog fade, input block | |
| `_allowedEnemyTypes` | `Array<string> \| null` | mission.js:155 | spawn-type filter | First mission restricts enemy types |
| `_battleStartTime` | timestamp | game.js:579 | elapsed time | Set when entering active |
| `_now` | timestamp | ai-pipeline.js:573 | AI decision time ref | Per-frame snapshot |
| `_waveGateLogged` | boolean | game.js:3031 | one-shot debug log gate | |

### UI & camera

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `camera` | `{x, y, lookX, lookY}` | state.js:1663; per-frame update | world↔screen transforms | |
| `_cameraMinY` / `_cameraMaxY` | number | mission.js:355-176 | mission-zone camera clamp | First mission only |
| `_heroMinY` | number | mission.js:356 | hero walk-bounds (fog) | First mission only |
| `_fadeOverlay` | `{opacity, fadeStartTime, fadeDuration}` | mission.js:173 | fade VFX | Mission cutscene |
| `_dialog` | `{lines, currentIndex, active, paused, startTime}` | mission.js:125 | dialog renderer | |
| `_cutscene` | `{waypoints, currentIndex, startTime, active}` | mission.js:134 | cinematic camera path | |
| `_fogZones` | `Array<{id, y, height, revealed, revealStartTime}>` | mission.js:118 | mission visibility | First mission only |
| `battleRenderer` | `BattleRenderer` | game.js:580 | canvas rendering | Null pre-init |
| `reservePool` | Array | state.js (deploy panel) | deploy panel POOL column | Undeployed units; populated from opsConfig if provided |

### Deploy panel transient state

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `_selectedUnit` | unit ref | deploy-crew.js:964 | side drawer | Unit in detail drawer; null = closed |
| `_selectedPreset` | string | deploy-panel actions | loadout preset highlight | |
| `_deployFormation` | string | deploy-crew.js:621 | formation render, capacity | `'line'` / `'wedge'` / `'column'` / `'spread'` / `'staggered'` / `'echelon_l'` / `'echelon_r'` |
| `_poolTab` | string | deploy-crew.js:428 | pool tab toggle | `'infantry'` / `'vehicle'` |

### AI perf & debug

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `_perf` | `{ai, proj, frame, samples, lastLog}` | game.js:2778 | perf overlay | Per-frame metrics snapshot |
| `_perfLog` | Array | game.js:118 | perf graph | Ring buffer, last 60 snapshots |
| `_aiPerf` | object | ai-pipeline.js:765 | AI subsystem breakdown | |
| `_debugLog` | Array | ai-pipeline.js:411 | debug event trace | |
| `debugOverlay` / `showTerrainGrid` / `debug` | various | state.js:2159-2188 | debug visualization | Fire-range only |

### Persistence & integration

| Field | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `_recorder` | recorder object | `createRecorder` (`replay-recorder.js:55`) | per-frame `recordFrame` | Populated externally after battle init, not in constructor |

## Phase transitions

| From → To | Where | Trigger | Guard |
|---|---|---|---|
| `deploying → countdown` | `updateDeployment` (game.js:2307) | both `deployReady.blue` and `deployReady.red` true | Side effects: removes `.deploy-panel` from DOM, calls `createRadioHUD()` |
| `countdown → active` | `updateCountdown` (game.js:2399) | `now - countdownStart >= 5s` | Side effects: sets `_battleStartTime`, `_blueMarching` |
| `active → wave_complete` | game.js:3046 | all enemies dead, spawn queue empty | Sets `waveComplete = true` |
| `wave_complete → active` | `spawnEndlessWave` (game.js:2905) | "Next Wave" clicked | Increments `wave` |
| `wave_complete → victory` | game.js:3016 | extract threshold / final wave | Sets `result = 'victory'` |
| `active → defeat` | game.js:2809, 7107 | hero.hp ≤ 0 or home zone lost | Sets `result = 'defeat'` |
| `active ↔ paused` | mission.js dialog paths | `_missionDialogActive`/`_missionWaitForClick` flags | No phase mutation; gates input + AI per-frame |

## Construction sites

| Factory | Where | When |
|---|---|---|
| `newEndlessBattle(loadout, wave, mapOverrides)` | state.js:1571 | Endless mode + intro mission (`launchFirstTimeMission`). Most common |
| `newCampaignBattle(...)` | state.js:457 | Campaign mode; era-based hero stats from `CAMPAIGN_HERO_UNITS` |
| `newFireRangeBattle(config)` | state.js:1899 | Proving Ground test scenarios. Sets `fireRange: true`, `_visibleEnemies: null` |
| `initFirstTimeMission(b)` | mission.js | Decorates an endless battle: `_isMission`, `_fogZones`, `_dialog`, `_cutscene`, `_mission`, `_fadeOverlay` |
| `initBattleAI(b, opts)` | ai-pipeline.js | Decorates with `_squads`, `_teamCommanders`, `_sergeants`, `_teamWaypoints`, `_squadWaypoints` |
| `createRecorder(b, mode)` | replay-recorder.js:13 | Adds `_recorder` after AI init |

## Invariants

- **`phase` is a string, not an enum constant** — no `Phase.ACTIVE`; string-compare only
- **`units`, `enemies`, `projectiles`, `effects` are always arrays** (possibly empty) — never null/undefined
- **`hero` is non-null during a battle** — except observer-mode fire range scenarios where `hero.observer = true`
- **`deployReady` requires BOTH sides** to be true for the transition — single-side ready is insufficient
- **`_recorder` is populated externally**, after the constructor — null during the deploying phase typically, set when `createRecorder` runs
- **`result` is the terminal signal, NOT a phase value** — terminal flow is gated by `result` being set, not by `phase` going to `'victory'`/`'defeat'` (those values appear too, but `result` is the canonical signal). See [battle-phases.md](../systems/battle-phases.md)
- **`_isMission` only true for first-time mission** — regular endless leaves it undefined
- **`_visibleEnemies` is `null` for fire range, `Set<id>` for endless/campaign** — FOW gating depends on this
- **`spawnQueue` defaults to empty** — non-staggered spawns push directly into `enemies`

## Persistence

**Battle is not persisted.** Recreated from scratch on each new engagement.

Outflows from a completed battle:
- **Soldier progression** → `progression.js` → `recordBattleScore` (`roster.js:410`) → `saveRoster()`
- **Item degradation** → per-shot `degradeItem` on units → `saveArmory()` at battle end
- **Replay** → `_recorder.frames` → POST `/api/replays` (`replay-recorder.js:438`) → `data/replays/<timestamp>-<seed>.json`
- **Mission stats** → `Game.endless.wave`, `Game.endless.kills` → `save()` on run end

## Gotchas

- **Phase is a string, not enum** — see [battle-phases.md gotcha](../systems/battle-phases.md#gotchas)
- **Don't confuse `result` with `phase`** — `result` is the terminal flag; `phase` is the state machine value
- **`_recorder` populated externally** — constructor doesn't set it. Code that reads `b._recorder` must null-check
- **First-time mission decorates an endless battle** — `_isMission`, `_fogZones`, `_mission`, etc. only exist when `initFirstTimeMission` has run. Regular endless leaves them undefined
- **`_visibleEnemies: null` in fire range** — combat code that iterates this must handle null
- **`spawnQueue` is for delayed spawns only** — pre-deployed reinforcements/squads go directly into `enemies` or `units`. Don't expect everything to flow through spawnQueue
- **`_squads` may be empty** — if `initBattleAI` ran with no units, squads is `[]`
- **`countdownStart` may be null mid-deploy** — set on transition to countdown
- **`paused` isn't a real phase value** — it's `phase === 'active' && (_missionDialogActive || _missionWaitForClick || _debugPaused)`. The combat loop guards on those flags, not on a `paused` string
- **Fields prefixed with `_`** are convention-private — but not enforced. Many cross-file reads use them anyway. Treat them as part of the public shape

## Cross-references

- [Battle Phases system](../systems/battle-phases.md) — state machine details + transition guards
- [Deploy Panel system](../systems/deploy-panel.md) — what runs during `phase === 'deploying'`
- [Soldier reference](soldier.md) — what `hero._soldierId` points at
- [Item reference](item.md) — what gear units bring into combat
- [ADR-0002 — Canvas deploy panel to HTML](../decisions/ADR-0002-canvas-deploy-panel-to-html.md) — `deploy-panel.md`'s parent decision
- Code: `js/state.js` (constructors), `js/game.js` (transitions, per-frame), `js/ai-pipeline.js` (squad/commander init), `js/mission.js` (first-mission decoration), `js/replay-recorder.js`

---

*Update by running `/update-ref battle` after touching `js/state.js`, `js/game.js`, `js/ai-pipeline.js`, `js/mission.js`, or `js/replay-recorder.js`. Always refresh `verified` + `verified_hash`.*
