# Battle System Overhaul Plan

> **Related Plans:**
> - [Enemy AI Aggro System](/.claude/plans/validated-bubbling-kahan.md) - How enemies select targets, threat calculation, aggro decay

## Overview
Redesign the battle planning and execution system to be more tactical, realistic, and engaging.

---

## 1. Destination-Based Deployment

### Concept
Units spawn at base and pathfind to assigned destinations rather than being placed directly on the battlefield.

### Planning Phase
- Place **Primary Position** (required) - where unit moves to at battle start
- Place **Advance Position** (optional) - where unit goes on "Advance" command
- Place **Fallback Position** (optional) - where unit retreats to on "Retreat" command

### Visual Markers
- Green = Primary position
- Blue = Advance position
- Yellow = Fallback position
- Lines connecting showing the planned route

### Autonomous Fallbacks
If positions not set:
- Advance → Push toward nearest enemy / forward X meters
- Retreat → Fall back toward spawn / behind hero

---

## 2. Support Units System

### Concept
1-2 units can be assigned as "Support" to follow the hero instead of holding positions.

### Assignment
- During planning, tap unit to toggle "Support" mode
- Shows link icon connecting to hero
- Limited slots based on hero MOS:
  - Infantry: 2 support slots
  - Cavalry: 1 support slot
  - Artillery: 1 support slot

### Support Unit Commands (during battle)
- **Follow** - Stay close to hero (default)
- **Hold Here** - Stop and hold current position
- **Attack Target** - Focus fire what hero is shooting
- **Flank** - Circle around to enemy's side
- **Regroup** - Return to hero if spread out

### UI
Quick-access buttons near shoot joystick for support commands.

---

## 3. Front Line Commands

### Concept
Simple high-level commands that control all position units at once.

### Commands
- **ADVANCE** - All units move to their advance positions
- **HOLD** - Units maintain current positions
- **RETREAT** - All units fall back to fallback positions

### UI
Three buttons at top of battle screen.

---

## 4. Artillery System

### Placement & Range
- Artillery has visible range when placing
- Safe position (at base): ~75% of No Man's Land coverage
- Forward deployed: Full range but vulnerable
- Outer edge cells highlighted during placement

### Accuracy Factors
- **Distance** - Further = less accurate
- **Pre-registered area** - Focused zone = more accurate
- **Time on target** - Aiming circle shrinks as they dial in

### Firing Stances (select during planning)

| Mode | Behavior | Accuracy | Fire Rate |
|------|----------|----------|-----------|
| Focus Fire | Watch designated area only | High | Fast |
| General Support | Auto-fire on any enemy in range | Medium | Medium |
| Direct Support | Fire near hero/allies | Medium | Medium |
| On-Call Only | Wait for manual fire missions | Highest | Slow |

### Auto-Target Priority (for General/Direct Support)
- Closest
- Weakest (lowest HP)
- Highest threat (most aggro)
- Heaviest (prioritize armor)

### Manual Call for Fire
- Player taps map location during battle
- Aiming circle appears, shrinks over time
- Can fire immediately (less accurate) or wait (more accurate)
- Audio cues: "Shot out... Splash in 3... 2... 1..."

### Special Round Types
- **HE (High Explosive)** - Standard damage, splash radius
- **Smoke** - Block vision, cover retreat/advance
- **Illumination** - Reveal enemies in night battles
- **Suppression** - Pin enemies, slow advance, less damage

### Other Considerations
- Splash damage affects area
- Limited ammo per battle
- Danger Close - can fire near friendlies with friendly fire risk
- Final Protective Fire - emergency all-out barrage, long cooldown

---

## 5. Night Battle System

### Concept
Night maps with limited visibility. Enemies are hidden unless illuminated or detected.

### Visibility Mechanics
- Each tile has visibility % (0-100%)
- Black overlay with varying alpha based on %
- Darkness regenerates over time

### Visibility Levels
```
100% - Full daylight visibility
 80% - Enemy slightly visible
 50% - Hard to see, silhouette only
 20% - Nearly invisible
  0% - Completely hidden
```

### Camo Ratings (per unit type)

| Unit | Camo Rating | Notes |
|------|-------------|-------|
| Infantry | 90% | Nearly invisible at night |
| Scout/Sniper | 95% | Ghost |
| Jeep | 60% | Engine noise |
| Sherman | 30% | Big, loud |
| Tiger | 20% | Massive signature |
| Artillery | 40% | Stationary but large |

### Detection Formula
```
Enemy visibility = tile_visibility × (1 - enemy_camo)
```

### Detection Rules
- High camo + dark tile = invisible
- Same tile = always revealed (stumble into each other)
- Firing reveals position briefly (muzzle flash)
- Moving reduces camo effectiveness

### Illumination Rounds
- Fired by artillery
- Radius of effect (X tiles)
- Resets visibility to 100% in area
- Fades over 10-15 seconds back to darkness
- Limited ammo - strategic resource

### Tactical Implications
- Infantry dominates night battles
- Tanks need illumination support
- Hold fire to stay hidden vs engage and reveal yourself
- Artillery becomes recon asset, not just damage
- Scout units valuable for spotting

---

## 6. Unit Behavior During Movement

### Pathfinding to Position
- Units find cover within certain radius while moving
- Engage enemies encountered en route
- Resume movement when area clear

### At Destination
- Find cover/optimal firing position within small radius
- Engage based on stance (defensive/aggressive)
- Hold until new orders

---

## Implementation Priority

### Phase 1: Core Waypoint System
1. Replace grid placement with destination markers
2. Primary position only (simplest version)
3. Units pathfind from spawn to position
4. Basic front line commands (Advance/Hold/Retreat)

### Phase 2: Support Units
1. Support unit toggle during planning
2. Support units follow hero
3. Basic support commands (Follow/Hold/Attack)

### Phase 3: Advanced Waypoints
1. Advance and fallback positions
2. Visual markers and lines
3. Autonomous behavior when not set

### Phase 4: Artillery Overhaul
1. Range visualization during placement
2. Firing stances
3. Manual call for fire
4. Aiming circle mechanic

### Phase 5: Night Battles
1. Night map type
2. Visibility system with alpha overlay
3. Camo ratings per unit
4. Illumination rounds
5. Detection rules

### Phase 6: Polish
1. Smoke rounds
2. Suppression mechanics
3. Danger close warnings
4. Audio cues for artillery

---

## UI Changes Needed

### Planning Screen
- Remove grid-based unit placement
- Add destination marker placement
- Show range circles for artillery
- Toggle support unit assignment
- Set advance/fallback positions
- Select artillery stance and priority

### Battle Screen
- Front line command buttons (top)
- Support unit commands (near shoot joystick)
- Call for fire button / tap-to-target
- Night vision overlay system
- Illumination effect visuals

---

## Data Structure Changes

### Unit Placement Data
```javascript
{
  unitId: 'sherman',
  primaryPos: { row: 8, col: 5 },
  advancePos: { row: 5, col: 5 },    // optional
  fallbackPos: { row: 10, col: 5 },  // optional
  isSupport: false,
  stance: 'defensive'
}
```

### Artillery Data
```javascript
{
  unitId: 'artillery',
  position: { row: 11, col: 6 },
  focusArea: [{ row: 3, col: 4 }, ...],  // optional
  firingMode: 'general_support',
  targetPriority: 'closest',
  ammo: { he: 10, smoke: 3, illum: 5 }
}
```

### Night Battle Data
```javascript
{
  isNight: true,
  tileVisibility: [[100, 80, 50, ...], ...],  // 2D array
  visibilityDecayRate: 5,  // % per second
  illumDuration: 15  // seconds
}
```
