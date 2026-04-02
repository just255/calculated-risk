# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A military-themed math training game for a 12-year-old struggling with times tables and basic operations. Players solve math problems to deploy units that defend against enemy waves advancing toward their base.

## Development Principles

**IMPORTANT: Follow these rules when implementing features:**

1. **Check before coding** - Always search the codebase first to verify a feature doesn't already exist before implementing it
2. **No assumptions** - Never assume how something works or what the user wants:
   - Trace the full code path before making changes
   - Verify data actually flows where you think it does (check function signatures, property copying, etc.)
   - Ask the user for expected behavior before implementing design decisions
   - When a fix doesn't work, READ the code and investigate - don't guess
3. **Modular by default** - All systems must be modular and reusable:
   - Shared logic belongs in shared functions (never duplicate between hero/AI/modes)
   - Constants and config live in `constants.js` (one source of truth, import everywhere)
   - Physics/accuracy/stability systems are unit-agnostic (hero and AI use the same functions)
   - New features should work across all game modes without mode-specific forks
   - If code is duplicated in 2+ places, extract it into a shared function
4. **Separation of concerns** - Keep files focused:
   - `constants.js` - Data definitions (units, enemies, state enums)
   - `state.js` - Game state object only
   - `game.js` - Game logic and loop
   - `ui.js` - Rendering only
   - `audio.js` - Sound only
   - `storage.js` - Persistence only
   - `main.js` - Event handling and initialization
5. **No monolith files** - If a module grows too large, split it further
6. **Single responsibility** - Each function/module should do one thing well
7. **Post-change review** - After implementing changes, check for:
   - Duplicated logic that should be extracted into a shared function
   - Hardcoded values that should be in `constants.js`
   - Inline type checks (e.g. `=== 'infantry' || === 'medic'`) that should use a shared utility
   - Dead code from refactoring (old action names, unused imports, orphaned functions)
   - Cross-module concerns that should be encapsulated (e.g. don't call private functions across modules)

## Development Commands

```bash
npm install          # Install dependencies
npm start            # Start server at http://localhost:3000
```

The server automatically detects the local network IP for mobile device access (same WiFi required).

## Server Management (for Claude)

**When to restart the server:**
- After modifying `server.js` (server-side code changes require restart)
- Client-side changes (HTML, CSS, JS in `/js/`) do NOT require restart - just refresh browser

**How to restart the server (Windows PowerShell):**
```powershell
# Kill existing node processes and restart
taskkill /f /im node.exe; npm start
```

**Or as separate commands:**
```powershell
taskkill /f /im node.exe    # Stop the server
npm start                    # Start the server
```

**Note:** The user typically has the server running in their own terminal. Ask them to restart it rather than trying to manage the process remotely.

**Starting ngrok tunnel (for remote access):**
```powershell
npx ngrok http 3000
```

**Full restart (server + ngrok):**
```powershell
# Terminal 1: Server
taskkill /f /im node.exe; npm start

# Terminal 2: ngrok tunnel
npx ngrok http 3000
```

## Architecture

### Two-Mode Design (Future Vision)
```
┌─────────────────────────────────────────────┐
│              FACTORY MODE                    │
│         (Math is the gameplay)              │
├─────────────────────────────────────────────┤
│  • Build units (solve to manufacture)       │
│  • Repair/maintain (solve to restore)       │
│  • Research upgrades (solve to unlock)      │
│  • Forge equipment (mini-game → quality)    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼ "Deploy"
┌─────────────────────────────────────────────┐
│              BATTLE MODE                     │
│         (Test your preparation)             │
├─────────────────────────────────────────────┤
│  • Deploy units you built                   │
│  • Tactical lane decisions                  │
│  • Collect resources from kills             │
│  • Minimal/optional math                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼ Wave complete
┌─────────────────────────────────────────────┐
│           RESULTS / LOOT                     │
├─────────────────────────────────────────────┤
│  • Resources collected → back to Factory    │
└─────────────────────────────────────────────┘
```

### File Structure
```
calculated-risk/
├── index.html          # HTML + CSS only
├── js/
│   ├── main.js         # Entry point, event handlers
│   ├── constants.js    # State enum, UNITS, ENEMIES
│   ├── state.js        # Game object, newBattle()
│   ├── game.js         # Battle logic, loop, update, draw
│   ├── ui.js           # HTML render functions
│   ├── audio.js        # Web Audio API sounds
│   └── storage.js      # LocalStorage save/load
├── server.js           # Express + Socket.io server
├── package.json        # Dependencies (express, socket.io)
└── README.md           # User-facing instructions
```

### Server (`server.js`)
- Express static file server
- Socket.io with multiplayer matchmaking infrastructure (ready for future use)
- Runs on port 3000, binds to 0.0.0.0 for network access

### Client (ES6 Modules)
Uses `<script type="module">` for clean separation of concerns.

**State Machine**
```javascript
const State = {
  MENU: 'menu',
  SETTINGS: 'settings',
  STATS: 'stats',
  COUNTDOWN: 'countdown',      // Pre-wave prep (3, 2, 1, GO!)
  BATTLE: 'battle',            // Core gameplay
  WAVE_COMPLETE: 'wave_complete',
  PAUSED: 'paused',
  VICTORY: 'victory',
  DEFEAT: 'defeat'
};

const SubState = {
  PLAYING: 'playing',
  LANE_SELECT: 'lane_select'   // Unit panel open
};
```

**Interrupt Points (Ready for Math)**
These hooks exist - currently just call callback() immediately:
```javascript
onDeploy(lane, callback)           // Before deploying unit
onSwitch(lane, unit, callback)     // Before switching unit type
onForge(item, callback)            // Manufacturing mini-game
onRepair(unit, callback)           // Repair challenge
onResearch(tech, callback)         // Research unlock
onManufacture(blueprint, callback) // Factory mode building
```

**Key Subsystems (by module)**
- `state.js` - `Game` object, `newBattle()` factory
- `game.js` - `goto()`, `loop()`, `update()`, `draw()`, `deploy()`, `switchUnit()`
- `ui.js` - `render()`, `setSubState()`, all HTML template functions
- `audio.js` - `initAudio()`, `sound()`
- `storage.js` - `save()`, `load()`
- `main.js` - Event delegation on #app, initialization

## Data Structures

### Unit Roster
| Unit | Damage | Fire Rate | Cooldown | Difficulty |
|------|--------|-----------|----------|------------|
| Infantry | 10 | 1000ms | 2000ms | easy |
| Willys Jeep | 15 | 800ms | 3000ms | easy |
| M4 Sherman | 35 | 1500ms | 4000ms | medium |
| Tiger I | 50 | 2000ms | 5000ms | hard |
| M1 Abrams | 75 | 1800ms | 6000ms | expert |

### Enemy Types
| Type | Health | Speed | Damage | Scrap | Parts Chance |
|------|--------|-------|--------|-------|--------------|
| Scout | 30 | 1.8 | 10 | 5 | 0% |
| Grunt | 60 | 1.3 | 15 | 10 | 10% |
| Heavy | 120 | 0.9 | 25 | 20 | 25% |
| Elite | 200 | 1.1 | 40 | 50 | 50% |

### Resource System
```javascript
resources: { scrap: 0, parts: 0 }  // Persistent across sessions
```
- **Scrap** - Basic currency from kills, used for upgrades
- **Parts** - Rare drops, used for crafting new units

### Mastery Tracking (Future)
```javascript
Game.stats.mastery  // e.g., "6×7": { correct: 5, total: 6 }
```

## Game Mechanics

- **Deploy cooldown**: Each unit type has a cooldown after deployment (2-6 seconds)
- **Wave progression**: Campaign mode has 10 waves; Endless mode continues indefinitely
- **Resource drops**: Enemies drop scrap on death, with chance for parts (rarer)
- **Scaling**: Enemy health scales with wave number (12% per wave)

## Design Philosophy

- **Math is the WORK, not the GATE** - Math happens in Factory mode as manufacturing
- **Battle tests your preparation** - Deploy what you built
- **Resources create the loop** - Kill enemies → get scrap/parts → build better → harder battles
- Speed AND accuracy matter (timed challenges)
- Harder math = better rewards (risk/reward)

## Future Features (Not Implemented)

### Math as Reward Path
- Special weapons unlocked by solving problems
- New unit types earned through mastery ("Solve 20 division problems to unlock Panzer IV")
- Stage access gated by fact family mastery
- Mastery-based permanent upgrades (90% on 6×7 = +5% damage)

### Math Mini-Game → Reward Quality
```
Performance tiers:
- 5/5 fast, hard problems → Legendary item
- 5/5 or 4/5 medium → Rare item
- 3/5 or slow → Common item
- Failed (<3) → Nothing, cooldown
```

### Maintenance System
- Units degrade with use (shots fired, damage taken)
- Worn units = reduced stats
- Math problems to repair (harder = better repair)

### Manufacturing Problems (Factory Mode)
- **Supply/Logistics:** "Each Sherman needs 24 steel. Building 6 tanks. Total?"
- **Alloy Ratios:** "Steel to tungsten 3:1. Using 45 steel. Tungsten needed?"
- **Calibration:** "Cut 144cm bar into 12 pieces. Length each?"
- **Production Time:** "Each unit: 7 minutes. Building 8. Total time?"

### Multiplayer (Socket.io Ready)
Server infrastructure exists in server.js:
- Matchmaking (find-match, waiting-for-opponent, match-found)
- Game state sync (game-update, opponent-update)
- Cross-deployment (deploy-unit sends enemy to opponent)
- Score tracking per player
