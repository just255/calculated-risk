---
name: proving-ground
type: system
status: stable
verified: 2026-05-23
verified_hash: HEAD
tags: [proving-ground, fire-range, ai-test-bed, combat, debug]
files:
  - js/main.js
  - js/state.js
  - js/game.js
  - js/ui.js
  - js/fire-range-presets.js
  - js/storage.js
  - js/projectile-resolver.js
  - js/ai-pipeline.js
  - js/replay-recorder.js
entry_points:
  - "main.js:2356 fire-range handler (title screen)"
  - "main.js:667 hq-fire-range handler (HQ tab)"
  - "main.js:~2377 fr-deploy handler (start battle)"
  - "state.js:1872 newFireRangeRun"
  - "state.js:1899 newFireRangeBattle"
  - "ui.js:8879 fireRangeConfigHTML"
related:
  - systems/battle-phases.md
  - references/battle.md
  - decisions/ADR-0002-canvas-deploy-panel-to-html.md
---

# Proving Ground

Internally still called "fire range" in code (`Game.fireRange`, `FIRE_RANGE` state, `fr-*` actions). The UI label is **Proving Ground** since the rename. Treat the two names as interchangeable; new code/comments should prefer "Proving Ground" but be aware grep needs `fire.?range`.

## Purpose

An AI battle test bed for isolating combat behavior, unit balance, and squad-level tactics — distinct from campaign, endless, and intro mission. The player configures two custom squads (blue + red), tunes commander and sergeant personality sliders, picks a map size + terrain seed, optionally enables debug toggles (invincibility, no cooldowns, range overlays), then watches the AI fight without needing to drive a hero. Hero is in observer mode by default (off-map, unreachable), so combat math + AI decisions can be studied in isolation. ~25 named test presets (Tier Damage, Behavior, Vision, Morale, Combined Arms, etc.) provide canonical scenarios.

## Quick Reference

- "Open from title screen" → `main.js:2356 fire-range` handler (`Game.fireRange = newFireRangeRun()` + `loadFRConfig` restore)
- "Open from HQ tab" → `main.js:667 hq-fire-range` handler (mirror of title path; was broken until commit `5c98eea`)
- "Configure squads" → `fireRangeConfigHTML()` (`ui.js:8879`) + action handlers `fr-add` / `fr-remove` / `fr-squad-add` (`main.js:~2452`)
- "Apply test preset" → `fr-preset-load` (`main.js:~2576`) → `FR_PRESETS[id]` (`fire-range-presets.js`)
- "Save / load / export / import named config" → `saveFRNamedConfig` / `loadFRNamedConfigs` / `deleteFRNamedConfig` (`storage.js:295-322`)
- "Start battle (DEPLOY)" → `fr-deploy` (`main.js:~2377`) → `Game.fireRange.battle = newFireRangeBattle(config)` (`state.js:1899`)
- "Back to config / reset" → `fr-config` / `fr-reset` (`main.js:~2391-2432`); `stopFireRangeLoop` (`game.js:~6269`)
- "Toggle debug flags" → `fr-debug-toggle` (`main.js:~2545`)
- "Toggle replay recording" → `fr-record-toggle` (`main.js:~2555`) — writes `Game.fireRange.config.record`
- "Use my roster hero in Proving Ground" → `fr-toggle-use-hero` (`main.js:~2562`) — writes `Game.fireRange.config.useRosterHero`. Checkbox is disabled if no `isPlayerCharacter` soldier exists yet (e.g. before intro mission). See Gotchas for the hero-spawn path order.
- "Personality sliders" → `fr-commander-slider` (`main.js:3416`) / `fr-sergeant-slider`

## Call Graph

User → DEPLOY click → battle launch:

```
fr-deploy click [main.js:~2377]
  ├─ Game.fireRange.config.terrainSeed = parseInt(seedInput.value)
  ├─ saveFRConfig(config)  [storage.js:277]
  ├─ stopFireRangeLoop()
  ├─ goto(State.FIRE_RANGE_BATTLE)
  │
  └─ [game.js:779 case State.FIRE_RANGE_BATTLE]
       ├─ Game.fireRange.battle = newFireRangeBattle(config)  [state.js:1899]
       │    ├─ FR_MAP_SIZES[config.mapSize] → grid dimensions
       │    ├─ generateBattleTerrain({ seed, biome, season })
       │    ├─ Spawn blue squads from config.blueSquads:
       │    │    └─ per unit slot: FR_UNIT_STATS lookup, personality, targeting,
       │    │       command, leadership, position within blueSpawnZone
       │    ├─ Spawn red squads from config.redSquads (supports legacy enemyType too)
       │    ├─ Hero: observer mode at (-9999, -9999) unless config.includeHero
       │    ├─ initBattleAI(b, { ..., config: { blueCommander, redCommander } })
       │    │    └─ creates b._squads, populates sergeants
       │    └─ Restore per-squad sergeant.personality from config.blueSquads[i].sergeant
       │       and config.redSquads[i].sergeant
       │
       ├─ Apply pending modifiers on enemies (applyModifier, setEnemyAIType)
       ├─ render()
       ├─ new BattleRenderer(bf).init() + setTerrainFromCanvases
       ├─ if (config.record !== false && autoRecord) createRecorder(b, 'fire_range')
       └─ startFireRangeLoop()
```

Battle ends when one team is wiped (or other win condition in `updateFireRangeBattle`). User clicks "Back" → `fr-config` → returns to config screen. `Game.fireRange.battle = null`. Renderer destroyed.

## State Shape

`Game.fireRange` (created by `newFireRangeRun()` at `state.js:1872`):

```js
Game.fireRange = {
  config: {
    blueSquads: [Squad, ...],          // Per-squad config (see below)
    redSquads:  [Squad, ...],
    blueCommander: { personality: { aggression, patience, courage, discipline, initiative, adaptation } },
    redCommander:  { personality: {...} },
    mapSize: 'small' | 'medium' | 'large',
    terrainSeed: number | null,        // null = randomize per battle
    timeLimit: number,                 // ms. Default 300000 (5 min). 0 = unlimited.
                                       // Captured at fr-deploy from #fr-time-limit input.
                                       // Battle auto-ends as 'draw' on expiry.
    debug: {
      blueInvincible: bool,
      redInvincible: bool,
      noCooldowns: bool,
      showRanges: bool,
    },
    record: bool,                      // Per-battle replay-record override
    // Legacy compat (migrated to squads by migrateFRConfig):
    blueTeam?: [...], blueSergeant?: {...}, redTeam?: [...], redSergeant?: {...}
  },
  battle: object | null,               // Populated at FIRE_RANGE_BATTLE state
  result: 'blue_wins' | 'red_wins' | 'draw' | null,
  speed: number,                       // Playback multiplier
  elapsed: number,
  scenarioName: string | null,         // Set when a preset is loaded
  _record: bool                        // Persisted toggle for next session
};
```

**Squad shape:**
```js
{
  name: 'Alpha',                       // 'Alpha' / 'Bravo' / ...
  sergeant: {                          // 6 personality sliders, 0-1 each
    aggression, patience, courage, discipline, initiative, awareness
  },
  formation: 'line' | 'wedge' | 'column' | 'spread' | 'staggered' | 'echelon_l' | 'echelon_r',
  units: [
    {
      unitId: 'infantry' | 'sherman' | ...,
      count: number,
      command: 'advance' | 'hold' | 'defend' | ...,
      // Per-unit personality (5 traits + extras):
      aggression, patience, courage, discipline, initiative,
      veterancy, morale, awareness, leadership,
      isLeader: bool,
      // Targeting preference weights (0-1 each):
      tgtDistance, tgtWeakness, tgtThreat, tgtValue,
      _expanded: bool                  // UI state (not persisted)
    }
  ],
  _expanded: bool                      // UI state (not persisted)
}
```

**Battle object** — see [battle reference](../references/battle.md). Fire-range battles set `mode: 'fire_range'`, `fireRange: true`, `_visibleEnemies: null` (no fog of war), and add a `debug` field copied from `config.debug`.

## Mutation Points

| Function | File:Line | Effect |
|---|---|---|
| `newFireRangeRun` | state.js:1872 | Allocates `Game.fireRange` with default config |
| `newFireRangeBattle` | state.js:1899 | Builds the battle object: terrain, spawns blue/red units, hero (observer), AI init, debug flag copy |
| `fr-deploy` handler | main.js:~2377 | Captures seed, saves config, transitions to FIRE_RANGE_BATTLE |
| `fr-config` / `fr-reset` | main.js:~2391/2432 | Returns to config screen, nulls battle |
| Slider handlers (`fr-commander-slider`, `fr-sergeant-slider`, etc.) | main.js:3416+ | Mutates `config.*.personality[trait]` |
| `fr-add` / `fr-remove` / `fr-squad-add` | main.js:~2452-2531 | Mutates squad / unit slots in config |
| `fr-debug-toggle` | main.js:~2545 | Flips `config.debug[flag]` |
| `fr-record-toggle` | main.js:~2555 | Flips `config.record` |
| `fr-preset-load` | main.js:~2576 | Replaces `config` with deep-cloned `FR_PRESETS[id]` |
| `saveFRConfig` (auto-save) | storage.js:277 | Persists `config` to `cr_s<slot>_cr_fr_last_config` |
| `applyModifier` / `setEnemyAIType` | game.js:~792 (FIRE_RANGE_BATTLE entry) | Per-enemy modifier application (rare; for advanced tests) |

## Persistence

- **Last-used config**: auto-saved on DEPLOY via `saveFRConfig()` (`storage.js:277`). Key: `cr_s<slot>_cr_fr_last_config` (slot-prefixed). Restored on next Proving Ground open via `loadFRConfig()` (`storage.js:285`).
- **Named saves**: SAVE button (`fr-save` action) prompts for a name; `saveFRNamedConfig(name, config)` writes to `cr_s<slot>_cr_fr_saves` (dict of `{name: {config, savedAt}}`). LOAD picks from this dict; EXPORT serializes to clipboard/JSON; IMPORT reads JSON.
- **Migration**: `migrateFRConfig()` (`storage.js:255-275`) wraps legacy flat `blueTeam`/`redTeam` arrays into the squad structure on load. Also migrates old `enemyType` → `unitId` field on red slots.
- **Battle state is transient** — `Game.fireRange.battle` is created fresh per DEPLOY and never persisted. Replay file IS persisted if `config.record` is on (`createRecorder` → `data/replays/<ts>-<seed>.json`).

## Lifecycle

1. **Open** (title or HQ) — `Game.fireRange = newFireRangeRun()`, restore `loadFRConfig()` if present, render `fireRangeConfigHTML()`.
2. **Configure** — user adjusts squads, sliders, debug flags, optionally loads a preset (`FR_PRESETS[id]`).
3. **Deploy** — `fr-deploy` → save config → `newFireRangeBattle(config)` → BattleRenderer init → recorder (if enabled) → loop starts.
4. **Combat** — `updateFireRangeBattle()` (`game.js`) runs every frame: AI ticks, projectile updates, kill detection, win-condition check.
5. **End** — one team wiped → `Game.fireRange.result` set → results modal (`fireRangeResultsHTML`). User can rematch (`fr-reset`) or return to config (`fr-config`).
6. **Back out** — title-menu navigation nulls `Game.fireRange` entirely (`main.js:1471 menu` action). HQ-tab navigation leaves it allocated.

## Debug flags

Each toggle in the DEBUG section of the config screen maps to a specific code path:

| Flag | Where read | Effect |
|---|---|---|
| `blueInvincible` | `projectile-resolver.js:170-171, 432-433` | After damage is applied to a blue unit, `unit.hp` is reset to `unit.maxHp` (effectively immortal but damage events still register) |
| `redInvincible` | Same place, opposite team | Same for red |
| `noCooldowns` | `game.js:~6469` in `updateFireRangeBattle` | Every frame: `unit.lastShot = 0; unit.lastAttack = 0`. Removes reload/cooldown gating — all units fire instantly |
| `showRanges` | `entity-renderer.js:1257`, `battle-renderer.js:259` | Renders vision cones + weapon range circles as canvas overlays |
| `record` | `game.js:823` in FIRE_RANGE_BATTLE entry | If true (or unset with global autoRecord), `createRecorder(b, 'fire_range')` runs and frames stream to `_recorder` |

## Test presets

Source: `js/fire-range-presets.js`. Exports two structures:

- `FR_PRESETS` — object keyed by preset ID. Each value is a config-shaped object (`blueTeam` / `redTeam` arrays + `mapSize` + `debug`). The arrays are flat (legacy shape) — `migrateFRConfig` wraps them into squad form on load.
- `FR_PRESET_LIST` — metadata for the UI dropdown. Used by `fireRangeConfigHTML()` to render the categorized scenario picker.

Presets cover 8+ categories: Tier Damage (Infantry Swarm vs Tanks, Tank Duel, David vs Goliath), Behavior (Aggression / Discipline / Patience / Initiative / Bounding Overwatch), Vision (Range Advantage, Awareness Mismatch), Morale (Suppression, Courage, Morale Cascade), Combined Arms (Mixed Arms Mirror, Asymmetric Combined, Fire Support), Targeting (Focus Weakest, Threat Priority), Sergeant AI (Aggressive vs Cautious, Flanker vs Line, Brave vs Coward, Adaptive vs Rigid), Performance (20v20, 30v30, 50v50, 10v50 Defense).

To add a new preset: define a new entry in `FR_PRESETS` and add metadata to `FR_PRESET_LIST`. The UI picks it up on next render.

## Gotchas

- **Two names**: code uses `fire_range` / `fireRange` / `fr-*`; UI says "Proving Ground". Grep for `fire.?range` (regex with optional separator) to catch both styles.
- **HQ-tab init was broken until `5c98eea`**: handler used to just `goto(State.FIRE_RANGE)` without first calling `Game.fireRange = newFireRangeRun()` + `loadFRConfig()`, which crashed the render. Fixed by mirroring the title-screen init pattern.
- **Hero spawn has three paths** (state.js:~2116, priority order):
  1. **`config.useRosterHero`** + roster has `isPlayerCharacter` — spawns the player's actual PC at the blue spawn zone, with full gear-derived stats injected via `getEffectiveCombatStats(playerHero)` (same seven `_gear*` fields as endless mode). Hero is player-controlled. UI checkbox added in `5ca8487`. This is the loadout-testing path: edit gear in the Armory tab, then come back to Proving Ground to test against a configured AI.
  2. **`config.includeHero`** + `blueLeader` — promotes the auto-selected blue squad leader to hero (synthesized stats from squad config, no soldier link, no gear). Legacy.
  3. **Default** — observer hero at `(-9999, -9999)` with `observer: true`. Combat skips it.
- **No fog of war** — `_visibleEnemies: null` in fire-range battles. AI sees all enemies always. This is intentional for AI testing (isolates targeting decisions from spotting decisions) but means fire-range results don't reflect real engagement detection dynamics.
- **No deploying / countdown phases** — fire-range battles start directly in active phase. `_battleStartTime` set at battle creation, not at countdown-end.
- **Distinct battle factory** — `newFireRangeBattle` (`state.js:1899`) is NOT `newEndlessBattle`. Changes to endless behavior don't automatically apply to Proving Ground. Note: the hero gear-stat injection that landed for endless at `state.js:~1780` (`fd2ce61`) is now mirrored in Proving Ground for the `useRosterHero` path at `state.js:~2116` (`5ca8487`) — but they're separate code paths, so any future change to one needs a deliberate copy to the other if you want feature parity.
- **Per-unit personality has 5 traits, not 6** — units lack `adaptation` (only commanders + sergeants have it). The slider UI elides it for unit slots.
- **Sergeant slider override happens AFTER `initBattleAI`** — `state.js:~2225` overwrites the sergeant.personality default with the config slider values. Don't initialize sergeants twice or you'll lose the override.
- **Legacy `enemyType` → `unitId` migration** is lazy (only fires on `migrateFRConfig` during config load). New code should always write `unitId`.
- **`speed` field exists but isn't currently wired** to any time-scaling code I could find. Likely future-feature.

## Cross-references

- [Battle Phases](battle-phases.md) — note the fire-range exception (no deploying/countdown)
- [Battle reference](../references/battle.md) — battle object shape, fire-range-specific fields
- [Glossary: insignia, MOS, command](../glossary.md)
- Code: `js/main.js` (handlers), `js/state.js` (factories), `js/game.js` (loop), `js/ui.js` (config render), `js/fire-range-presets.js` (scenarios), `js/storage.js` (persistence)

---

*Update by running `/update-doc proving-ground` after touching `js/main.js` `fr-*` handlers, `js/state.js newFireRangeBattle`, `js/fire-range-presets.js`, or `js/storage.js` fire-range helpers. Always refresh `verified` + `verified_hash`.*
