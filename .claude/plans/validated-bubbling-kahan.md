# Squad-Based Campaign Battle System

## Overview
Redesign Campaign mode with a single squad:
- **Hero** (player-controlled, WASD)
- **5 Squad Members** (4 units + 1 artillery, AI-controlled)

Real-time combat with radio-style command system for issuing tactical orders.

---

## Squad Composition

```
YOUR SQUAD (6 total)
├── ★ Hero (you control directly)
├── ● Unit 1 (e.g., Infantry)
├── ● Unit 2 (e.g., Sherman)
├── ● Unit 3 (e.g., Specops)
├── ● Unit 4 (e.g., Medic)
└── ● Unit 5 (Artillery - Howitzer)
```

- Pick any 4 units + 1 artillery from roster
- Units have existing stats (damage, fire rate, speed, etc.)
- Death: Dead for current battle only, return next battle

---

## Command System (Radio)

### Command Flow
```
[Radio Button] → [Select Unit(s)] → [Select Action] → [Map Opens] → [Tap Target] → [Execute]
```

### Actions Available

| Action | Needs Target | Description |
|--------|--------------|-------------|
| **Move** | Location | Move to tapped position |
| **Attack** | Enemy/Area | Engage specific target |
| **Defend** | Location | Hold and defend position |
| **Concentrate Fire** | Enemy | All selected units focus one target |
| **Suppress** | Area | Pin down area, reduce enemy accuracy |
| **Flank** | Enemy | Circle around for bonus damage |
| **Dig In** | None | Fortify current position |
| **Search & Destroy** | Area | Hunt enemies in area (for unspotted) |
| **Fall Back** | Location | Retreat to position |

### Target Priority System
Each unit can have a standing priority:
```
Sherman: Priority → Armor (always targets tanks first)
Infantry: Priority → Nearest (default)
Specops: Priority → Infantry (hunt soft targets)
```

Set once, persists until changed. Overridden by direct orders.

---

## UI Layout (Mobile-First)

### Current Problems
- Position buttons too large/oddly placed
- Minimap too large
- Too much UI blocking the view

### New Layout
```
┌─────────────────────────────────────┐
│            BATTLEFIELD              │
│                                     │
│  ┌─────┐                           │
│  │Mini │ ← 50% smaller, tap to     │
│  │Map  │   expand or pan camera    │
│  └─────┘                           │
│                                     │
│         [Hero & Squad]              │
│                                     │
├─────────────────────────────────────┤
│ [Radio] [Move] [Shoot] [Stance]     │  ← Compact bottom bar
└─────────────────────────────────────┘
```

### Radio Panel (Collapsed by Default)
Tap [Radio] button → expands upward:
```
┌─────────────────────────────────────┐
│  RADIO COMMANDS                  [X]│
├─────────────────────────────────────┤
│  SELECT UNIT:                       │
│  [All] [#1 Inf] [#2 Shm] [#3 Spc]  │
│  [#4 Med] [#5 Art]                  │
├─────────────────────────────────────┤
│  ACTION:                            │
│  [Attack] [Defend] [Move] [Flank]   │
│  [Suppress] [Dig In] [Concentrate]  │
├─────────────────────────────────────┤
│  [Set Priorities...]                │
└─────────────────────────────────────┘
```

### Target Selection Mode
When action needs a target:
1. Radio panel minimizes to banner: "Select target on map"
2. Map becomes full interactive (pan/zoom enabled)
3. Spotted enemies highlighted with tap targets
4. Tap enemy OR location → confirms target
5. Command executes, returns to normal view

### Interactive Minimap
- **Tap**: Pan camera to that location
- **Tap enemy dot**: Select as target (if in targeting mode)
- **Long-press**: Place marker
- **Tap to expand**: Full-screen map view

### Spotted Enemy List (in targeting mode)
```
TARGETS:
[●] Scout (42m NW) ← tap to target
[●] Grunt (78m N)
[?] Heavy (last seen E) ← lost contact
[+ Search Area]
```

---

## Camera & Navigation

- **Tap minimap** → camera pans there
- **Tap unit portrait** → camera jumps to that unit
- **[Center Squad]** button → camera centers on hero
- **Drag** → pan camera (when not moving hero)

---

## Formations

Three options available:
1. **Auto-formation**: Squad arranges around hero by unit type
2. **Manual placement**: Position units during planning phase
3. **Presets**: Line, Wedge, Column, Spread

Toggle via radio menu or planning screen.

---

## Targeting Rules

- **Spotted enemies only**: Must be seen by hero or any squad member
- **Last known position**: Unspotted enemies show "?" at last location
- **Search & Destroy**: Units go to last known location, begin searching
- **Concentrate Fire**: All selected units attack same target

---

## Files to Modify

| File | Changes |
|------|---------|
| `js/constants.js` | SQUAD_ACTIONS, TARGET_PRIORITIES |
| `js/state.js` | Squad state, targeting state, command queue |
| `js/game.js` | Command execution, targeting system |
| `js/ai.js` | Priority-based targeting, tactical behaviors |
| `js/ui.js` | Radio panel, minimap, target selection UI |
| `js/main.js` | Radio button handlers, targeting mode |
| `index.html` | CSS for radio panel, compact bottom bar |

---

## Implementation Phases

### Phase 1: UI Cleanup
- [ ] Shrink minimap 50%, add tap-to-expand
- [ ] Redesign bottom bar (compact command buttons)
- [ ] Remove/relocate oversized position buttons

### Phase 2: Squad Data
- [ ] Define squad structure (hero + 5 members)
- [ ] Add squad to campaign battle state
- [ ] Initialize from planning phase

### Phase 3: Radio Panel
- [ ] Collapsible radio UI
- [ ] Unit selection buttons
- [ ] Action buttons (Attack, Defend, Move, etc.)

### Phase 4: Target Selection Mode
- [ ] "Select target" overlay state
- [ ] Interactive map (pan, tap to select)
- [ ] Enemy list with spotted/unspotted status
- [ ] Confirm and execute command

### Phase 5: Priority System
- [ ] Per-unit target priority setting
- [ ] Priority UI in radio panel
- [ ] AI respects priorities in targeting

### Phase 6: Tactical Actions
- [ ] Concentrate Fire (multi-unit focus)
- [ ] Suppress (area denial)
- [ ] Flank (pathfinding + damage bonus)
- [ ] Dig In (defense mode)
- [ ] Search & Destroy (hunt unspotted)

### Phase 7: Formations
- [ ] Auto-formation logic
- [ ] Preset formations (line, wedge, etc.)
- [ ] Formation picker in planning/radio

### Phase 8: Polish
- [ ] Sound effects for radio commands
- [ ] Visual feedback (order confirmations)
- [ ] Mobile testing and tweaks

---

## Future Ideas
- Persistent squad members with names
- Permadeath and recruitment
- Squad XP and leveling
- Voice lines for commands
- Math challenges for special call-ins
