# Calculated Risk — Game Design Document

## Vision

A military-themed math training game built around three interconnected systems: **exploration** (roguelike zone traversal), **combat** (real-time tactical battles), and **manufacturing** (math-driven base building and crafting).

The player explores a continuous, coherent world — driving through PCG-generated zones, choosing which direction to push, scouting for intel, and hauling salvage and blueprints back to base. At base, math IS the work: solving problems to manufacture ammo, repair vehicles, research tech, and forge equipment. Better gear lets you survive deeper exploration, which yields rarer blueprints, which require harder math to build.

The world feels real — rivers flow downhill to oceans, forests thin as you climb into mountains, paths connect settlements. You're not playing random arenas; you're exploring a place.

---

## Core Loop

```
        BASE (math is the work)
        ┌─ Manufacture ammo/gear (solve to build)
        ├─ Repair vehicle (solve to restore)
        ├─ Research new tech (mastery unlocks)
        └─ Forge equipment (mini-game → quality)
              │
              ▼
        DEPLOY → Enter World
              │
              ▼
  ┌→ Clear Zone → Scout Edges → Choose Direction ─┐
  │                                                │
  └────────────────────────────────────────────────┘
              │
              ▼ (extract or die)
        RETURN TO BASE
        └─ Deposit salvage, blueprints, intel
```

**Field phase (no math — pure action):**
1. **Deploy** from base with manufactured gear
2. **Fight** — clear enemies in the current zone
3. **Scout** — spend resources to learn what's in adjacent zones, or gamble blind
4. **Choose a direction** — push N/S/E/W into the next zone
5. **Discover** — terrain generates coherently from the previous zone
6. **Collect** — salvage from kills, blueprints from strongholds, field pickups
7. **Extract or push deeper** — cash out safely or risk it all

**Base phase (math is the gameplay):**
1. **Deposit** salvage and blueprints from the field
2. **Manufacture** — solve math to produce ammo, supplies, gear
3. **Repair** — solve math to restore vehicle HP and fix damage
4. **Research** — sustained mastery of fact families unlocks new tech
5. **Forge** — timed math mini-game determines crafted item quality
6. **Upgrade base** — build new facilities to unlock new crafting categories

---

## World Generation

### Macro World Seed

A single seed generates the entire world's large-scale geography. Players never see a "world map" — they discover it by exploring.

**Heightmap layer:**
- Perlin/simplex noise at large scale determines elevation
- Drives biome placement: lowlands (wetland, grassland), midlands (forest), highlands (rocky, conifer), peaks (barren)
- Rivers flow from high to low elevation naturally

**Biome map:**
- Derived from heightmap + moisture (second noise layer)
- Low elevation + high moisture → wetland
- Mid elevation + moderate moisture → temperate forest
- High elevation + low moisture → rocky highland
- Coastal edges → beaches, cliffs

**River network:**
- Rivers originate at high elevation, flow downhill
- Merge at confluences, widen as they flow
- Terminate at ocean/lake
- Cross multiple zones seamlessly

**Road/path network:**
- Generated at macro level connecting points of interest
- Worn dirt paths between settlements/outposts
- Following a road often leads somewhere useful

### Zone System

The world is divided into a grid of **zones**. Each zone is one battlefield — a single screen the player fights through.

**Zone size tiers (player-selected difficulty):**

| Tier | Zone Grid | Pixels | Name | Description |
|------|-----------|--------|------|-------------|
| 1 | 24x24 | 1536x1536 | Patrol | Standard engagement |
| 2 | 32x32 | 2048x2048 | Sortie | Room to maneuver |
| 3 | 40x40 | 2560x2560 | Operation | Multi-front combat |
| 4 | 48x48 | 3072x3072 | Campaign | Full-scale battle |

Zone size is chosen once at run start and stays constant for the entire run. Bigger zones = harder enemies, better loot, separate leaderboard.

### Edge Coherence

When a zone is generated, its four edges are recorded as **edge descriptors**:

```javascript
{
  north: {
    groundType: 'grass-1',           // Base ground at the edge
    rivers: [{ position: 340, width: 60, flowDirection: 'north' }],
    forests: [{ start: 0, end: 400, density: 0.8 }],
    paths: [{ position: 600, width: 30 }],
    elevation: 0.45                  // From macro heightmap
  },
  // ... east, south, west
}
```

When the adjacent zone generates, the opposing edge descriptor becomes an **input constraint**:
- A river exiting zone A's east edge at Y=340 enters zone B's west edge at Y=340
- Forest coverage continues at the same density
- Paths connect across boundaries
- Ground type blends smoothly (no hard cuts)

**Blending zone:** The first/last ~3 cells of each zone are a "blend zone" where terrain transitions smoothly to match the neighbor's edge.

---

## Zone Types

Each zone has a type that determines what the player encounters.

### Combat Zones (most common)
- Standard enemies scaled to difficulty tier and depth into the run
- Terrain provides natural cover and tactical variety
- Must clear all enemies to unlock edges
- Drop standard loot (scrap, parts)

### Supply Cache
- No enemies (or very few guards)
- Scattered loot containers across the zone
- Timer-based? Grab what you can before reinforcements arrive?
- Contains consumables, ammo, repair kits

### Forward Base (Repair Station)
- No enemies — safe zone
- Repair vehicle (heal HP)
- Rearm / restock consumables
- Possibly recruit a squad member or buy upgrades
- Rare — maybe 1 in every 8-10 zones

### Stronghold (Mini-Boss)
- Single powerful enemy or hardened position
- Rare, high-quality loot behind it
- Could be a fortified building, bunker, or heavy vehicle
- Defeating the boss unlocks a special reward

### Mystery Zone
- Unknown until you enter
- Could be anything: ambush, hidden cache, friendly encounter, trap
- High variance — the ultimate gamble
- Sometimes the best loot in the game

### Extraction Point
- Appears deeper into the run (after N zones explored)
- Player can choose to extract safely with accumulated loot
- Or keep pushing for more — but death means losing everything
- The ultimate "calculated risk" moment

---

## Scouting / Intel System

Before choosing a direction, the player can gather information about adjacent zones.

### Free Intel
- **Visual:** You can see terrain at the zone edges — forest thinning, river flowing, mountain rising
- **Biome hint:** The edge visually suggests what biome is next

### Radio Intel (costs currency)
- Reveals: zone type (combat/cache/base/stronghold/mystery), difficulty rating
- Shows an icon on the edge: skull, chest, wrench, crown, question mark
- Cost scales with run depth (info gets more expensive deeper in)

### Drone Recon (costs more / takes time)
- Reveals: specific enemy composition, loot table, terrain layout
- Maybe shows a minimap preview of the zone
- Could require waiting one "turn" for the drone to return

### No Intel
- Jump in blind — question mark
- Cheapest option, maximum risk
- Sometimes rewarded with bonus loot for "bravery"

---

## Progression

### Per-Run
- Accumulate scrap/parts from kills and caches
- Vehicle takes damage — manage HP as a resource
- Deeper runs = better loot but more risk
- Death = lose unsaved loot (or partial loss?)

### Per-Tier Leaderboards
- Each difficulty tier has its own leaderboard
- Tracked: zones cleared, enemies killed, score, loot collected
- Prevents small-tier grinding from dominating
- Seeded runs for fair competition (same world seed = same leaderboard)

### Loot Tables by Tier
- **Patrol:** Common drops, basic upgrades
- **Sortie:** Uncommon drops, vehicle modifications
- **Operation:** Rare drops, unique equipment
- **Campaign:** Legendary drops, exclusive unlocks

### Loot Tables by Zone Type
- Combat zones: standard drops from enemies
- Supply caches: consumables, repair kits, ammo
- Strongholds: guaranteed rare+ quality
- Mystery zones: wild variance — could be trash, could be legendary

### Meta Progression
- Unlocking new vehicles through exploration milestones
- Permanent upgrades purchased between runs
- Achievement-based unlocks ("Clear 5 Strongholds" → unlock heavy tank variant)
- Map knowledge: "You've been here before" — previously explored world areas might show on a fog-of-war world map

---

## Base of Operations

The base is where math becomes gameplay. The player returns from the field with salvage and blueprints, and uses math to turn raw materials into usable gear. The base grows visually over time as new buildings are constructed.

### Economy

Three resource types flow between field and base:

**Salvage** (common, spent on use):
- Dropped by enemies, found in caches, scattered across zones
- Raw material consumed during every manufacturing action
- Always needed, always running low — drives the player back into the field

**Blueprints** (rare, permanent):
- Found in strongholds, mystery zones, hidden caches
- Each blueprint unlocks the ability to manufacture a specific item forever
- The persistent chase item — the reason to explore deeper
- Examples: "Tungsten AP Shell" blueprint, "Reactive Armor Mk2" blueprint, "Long-Range Radio" blueprint

**Field Pickups** (one-time, no math):
- Repair kits, temporary boosts, emergency ammo found during exploration
- Used immediately in the field — keeps the action flowing without pausing for math
- Cannot be manufactured — only found

### Base Buildings

The base starts as a tent and a workbench. As the player invests resources, new buildings unlock new crafting categories. Each building is a menu screen (visual base building is a future goal).

**Motor Pool** (starting building):
- Vehicle repair — solve addition/subtraction to restore HP
- Faster/more accurate = better repair quality
- "Hull integrity: 45 + ? = 120" → solve to repair
- Failing doesn't break anything — you just repair less

**Armory** (unlocked early):
- Manufacture ammo and consumables from salvage + blueprints
- Multiplication drives quantity: "Each shell needs 8 steel. Building 6 shells. Total?"
- More correct answers in the time limit = more ammo produced
- Different ammo types require different blueprints (AP, HE, incendiary)

**Research Lab** (unlocked mid-game):
- Unlock new tech tiers through sustained fact family mastery
- Division and fractions: "Split 144 resources across 12 labs"
- Not one-off problems — requires consistent mastery over time (e.g., 90% accuracy on 7× table unlocks Tier 2 optics)
- Tech tiers unlock better blueprints in the armory and forge

**Forge** (unlocked mid-game):
- Craft equipment and vehicle upgrades from blueprints
- Timed math mini-game determines quality tier:

| Performance | Result |
|-------------|--------|
| 5/5 correct, fast | Legendary quality |
| 5/5 or 4/5, normal speed | Rare quality |
| 3/5 or slow | Common quality |
| < 3/5 | Failed — salvage wasted, try again |

- Higher quality = better stats on the crafted item
- The same blueprint can be forged repeatedly for better quality — incentivizes practice

**Comms Tower** (unlocked later):
- Buy scouting intel before deploying
- Intercept radio chatter that hints at blueprint locations, strongholds, hidden zones
- "Command reports a prototype engine sighting two zones north of sector 7"
- Decode intercepted messages (math puzzle) for precise coordinates

**Garage** (unlocked later):
- Upgrade and customize vehicles
- Install forged equipment (engine, armor, optics, weapons)
- Each vehicle has equipment slots — choose loadout before deploying
- Visual preview of your vehicle with upgrades applied

### Math as Manufacturing — Design Principles

1. **Math has a PURPOSE the kid can see.** You're not solving 6×7 because school says so. You're solving it because that's how tungsten shells get made, and you need those shells to survive the stronghold up north.

2. **Failure isn't punishment.** Wrong answers produce less or lower quality — you don't lose what you have. The kid always makes progress, just more/less efficiently.

3. **Difficulty scales with reward.** Manufacturing basic ammo is easy math. Forging legendary equipment is hard math. The kid self-selects difficulty by choosing what to build.

4. **No math in the field.** Combat is pure action. The base is where you do the work. Clean separation — the field is the reward for the work, not the other way around.

5. **Speed AND accuracy matter.** Timed manufacturing creates urgency. Getting 5/5 correct but slowly produces Rare. Getting 5/5 fast produces Legendary. This mirrors real factory efficiency.

### Blueprint Examples

| Blueprint | Found In | Building | Math Type | Produces |
|-----------|----------|----------|-----------|----------|
| Standard AP Shell | Starting | Armory | Multiplication | Basic armor-piercing ammo |
| Tungsten AP Shell | Stronghold | Armory | Multiplication (harder) | +15% damage vs heavies |
| Reactive Armor Mk1 | Supply Cache | Forge | Mixed operations | Absorbs first hit per zone |
| Long-Range Optics | Mystery Zone | Forge | Division | +20% view range |
| Field Radio Upgrade | Forward Base | Forge | Fractions | Cheaper scouting intel |
| Diesel Engine Mk2 | Deep Stronghold | Forge | Mixed (hard, timed) | +15% speed |
| Prototype Railgun | Legendary (rare) | Forge | Expert math | Massive single-target damage |
| Med Station Kit | Supply Cache | Armory | Addition | Deployable heal zone in field |
| Bridge Layer Kit | Mystery Zone | Forge | Geometry | Cross rivers without bridges |

### Base Progression Curve

```
Week 1:  Tent + Workbench → basic repairs, basic ammo
         Learning addition/subtraction, simple multiplication

Week 2:  Motor Pool + Armory → full repair, ammo variety
         Multiplication tables, building quantity

Week 3:  Research Lab → tech tiers, better blueprints available
         Division, sustained mastery tracking

Week 4:  Forge → equipment crafting, quality tiers
         Mixed operations, timed challenges

Week 5+: Comms Tower + Garage → intel, vehicle customization
         Fractions, harder operations, all systems engaged
```

This curve is approximate — driven by play frequency, not calendar. A kid playing daily progresses faster. The base visually reflects progress: more buildings, vehicles in the yard, equipment on the walls.

---

## UI / UX Flow

### Pre-Run Screen
```
┌──────────────────────────────────────┐
│         ENDLESS EXPLORATION          │
│                                      │
│  Difficulty:                         │
│  [Patrol] [Sortie] [Operation] [Campaign] │
│                                      │
│  Vehicle: [Select...]               │
│  Seed: [Random] or [Enter seed]     │
│                                      │
│  Best: Wave 14 | Score: 12,450      │
│                                      │
│         [ DEPLOY ]                   │
└──────────────────────────────────────┘
```

### In-Zone HUD
```
┌──────────────────────────────────────┐
│ HP ████████░░  Wave 3  Score: 2,400 │
│                                      │
│  Sortie: Oak Woodland (summer)      │
│                                      │
│           [battlefield]              │
│                                      │
│                 [N?]                 │
│          [W?] ← → [E?]             │
│                 [S?]                 │
│                                      │
│  [Scout: 50 scrap]    [Minimap]     │
└──────────────────────────────────────┘
```

### Edge Selection (after clearing zone)
- Direction indicators appear at each edge
- Icons show intel level: ?, biome hint, or full intel
- Player drives toward an edge to transition
- Brief transition animation as next zone loads

---

## Technical Architecture

### Chunked PCG Pipeline
```
World Seed
  └→ Macro Heightmap (simplex noise, computed once)
  └→ Macro Moisture Map (second noise layer)
  └→ Biome Map (derived from height + moisture)
  └→ River Network (flow simulation from peaks)
  └→ Road Network (connecting POIs)

Zone Request (grid x, y)
  └→ Look up biome from macro maps
  └→ Get edge constraints from neighbors (if generated)
  └→ generateBattleTerrain({ biome, edgeConstraints, ... })
  └→ Record this zone's edge descriptors
  └→ Cache result (terrain canvas, canopy canvas, scatter)
```

### Zone Cache
- Keep current zone + 4 adjacent zones in memory
- Discard zones more than 2 steps away
- Edge descriptors are lightweight — keep all of those
- Re-generate discarded zones from seed if player backtracks

### Edge Constraint Integration
The existing `generateBattlefield()` in `pcg.js` would need:
1. **Edge-aware stroke placement** — don't put forests/water that conflict with edge constraints
2. **River continuation** — if a river enters from the west, route it through the zone and out another edge (following heightmap gradient)
3. **Blend zones** — the first/last few cells match the neighbor's terrain type

### Performance Budget
- Zone generation: <500ms (current pipeline: ~40-80ms for small maps)
- Larger zones (48x48 = 3072px) may need canvas tiling if >4096px limit
- Pre-generate adjacent zones during gameplay (background, low priority)
- Terrain canvas can be generated in an OffscreenCanvas / Web Worker

---

## Implementation Phases

### Phase A: Zone Exploration Foundation
- [ ] Macro world seed (heightmap + biome map)
- [ ] Edge descriptor recording on zone generation
- [ ] Edge constraint input to PCG generator
- [ ] Zone cache (current + adjacent)
- [ ] Basic zone transition (drive to edge → load next zone)
- [ ] Direction choice UI (edge indicators)
- [ ] Playtest zone sizes: 32x32 vs 48x48

### Phase B: Base of Operations (Core)
- [ ] Base screen (menu-based, no visual base yet)
- [ ] Salvage/blueprint resource system
- [ ] Motor Pool — repair via addition/subtraction problems
- [ ] Armory — manufacture ammo via multiplication problems
- [ ] Deploy screen — choose vehicle, see loadout, enter world
- [ ] Field → base → field loop working end to end

### Phase C: Zone Types & Scouting
- [ ] Zone type assignment from macro map + RNG
- [ ] Scouting UI (edge indicators with icons)
- [ ] Radio intel purchase mechanic
- [ ] Forward base (repair station) zone type
- [ ] Supply cache zone type
- [ ] Extraction point mechanic

### Phase D: Advanced Base
- [ ] Research Lab — division/fractions, mastery tracking unlocks tech tiers
- [ ] Forge — timed mini-game, quality tiers (common → legendary)
- [ ] Comms Tower — buy intel, intercept radio chatter, decode messages
- [ ] Garage — vehicle customization, equipment slots
- [ ] Blueprint catalog UI

### Phase E: Loot & Progression
- [ ] Blueprint drop tables by zone type and depth
- [ ] Salvage economy balancing
- [ ] Per-tier leaderboards
- [ ] Meta-progression (achievement unlocks, vehicle roster)
- [ ] Difficulty adaptation (track weak facts, weight them in manufacturing)

### Phase F: World Polish
- [ ] Edge blending (smooth terrain transitions)
- [ ] River flow continuity across zones
- [ ] Road/path network across zones
- [ ] Fog-of-war world map (shows explored zones)
- [ ] Stronghold / mini-boss encounters
- [ ] Mystery zone variety
- [ ] Radio chatter narrative system ("Intel reports a prototype engine to the north...")

### Phase G: Campaign Mode
- [ ] Authored macro maps (Normandy, Ardennes, etc.)
- [ ] Region capture mechanic and frontline system
- [ ] Theatre progression and unlocks
- [ ] Historical briefings and era-appropriate vehicles

---

## Campaign Integration

The zone exploration system isn't just for endless mode — it becomes the backbone of campaign mode too. Same zone-level gameplay, different macro layer.

### Campaign as Real-World Macro Maps

Instead of a procedural macro world, campaign uses **authored macro maps** based on real (or inspired-by-real) geography:

| Theatre | Geography | Biomes Used | Key Features |
|---------|-----------|-------------|--------------|
| Normandy | Coastal → farmland → forest | temperate, wetland | Beach landings, hedgerow bocage, river crossings |
| Ardennes | Dense forest, hills, snow | conifer, dead-forest | Winter conditions, narrow valleys, siege battles |
| North Africa | Desert, oases, coast | (future: arid, desert) | Open terrain, supply lines, fortified towns |
| Pacific Islands | Jungle, beach, volcanic | (future: tropical) | Amphibious approach, dense canopy, cave strongholds |
| Eastern Front | Steppe, frozen rivers, cities | conifer, dead-forest | Vast open ground, brutal cold, urban combat |

### Region Capture Mechanic

The campaign macro map shows a real-world theatre divided into regions (groups of zones):

```
┌─────────────────────────────────────────────┐
│              NORMANDY - June 1944           │
│                                             │
│   ░░░░░░░░░░░░░░▓▓▓▓▓▓████████████████    │
│   ░░ BEACH ░░░░░▓ BOCAGE ▓███ FOREST ████  │
│   ░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓████████████████  │
│        ↑              ↑          ↑          │
│     CAPTURED      FRONTLINE   ENEMY HELD    │
│                                             │
│   ░ = Allied    ▓ = Contested   █ = Axis    │
└─────────────────────────────────────────────┘
```

- **Frontline advances** as you clear zones in contested regions
- Choose which sector to push — flanking vs head-on, just like endless edge choices
- Some regions have **strategic objectives**: capture the bridge, secure the airfield, cut the supply line
- Failing a zone doesn't end the campaign — it pushes the frontline back

### How Campaign Zones Differ from Endless

| Aspect | Endless | Campaign |
|--------|---------|----------|
| Macro map | Procedural (seed) | Authored (real geography) |
| Zone biome | From heightmap + noise | From theatre's region data |
| Direction choice | Player-driven exploration | Strategic — push the frontline |
| Failure | Permadeath (run ends) | Frontline retreats, retry |
| Progression | Per-run loot, leaderboards | Story progression, unlock theatres |
| Difficulty | Player-selected tier | Escalates with theatre progression |
| Edge constraints | Procedural continuity | Authored region transitions |

### Shared Systems

Everything below the macro layer is identical:
- Zone-level PCG terrain generation
- Edge coherence and blending
- Combat, scouting, zone types
- Loot drops and vehicle progression
- Forward bases and repair stations

The only difference is **what determines the next zone's biome and constraints** — a procedural world seed (endless) vs an authored theatre map (campaign).

### Campaign Progression

1. **Unlock theatres** by completing previous ones (or by reaching milestones)
2. **Each theatre** has 15-30 zones arranged in a region grid
3. **Strategic choices** — which region to push first affects difficulty elsewhere
4. **War resources** — campaign currencies for calling in support (artillery, air strikes, reinforcements)
5. **Historical flavor** — briefings, era-appropriate vehicles, real battle names

---

## Head-to-Head (H2H) Multiplayer

### Core Principles

- **No math in battle.** Math stays at base — manufacturing, repair, research. Battle is pure action and tactics.
- **North star is online matchmaking.** LAN/same-WiFi is the starting point, but the vision is global online play.
- **Squad-based combat.** Players command a hero + autonomous squad units, not lone gunman gameplay. Existing command system (target priority, move orders) directs squad behavior.
- **Blind picks.** Neither player sees what the opponent brought until they meet on the field.

### How Math Pays Off

Players build their squads at base through the manufacturing system. Each player selects their squad composition within a shared power budget — a player might go heavy (one Tiger, fewer units) or light and fast (Jeeps, more bodies). Better math at base = better gear quality on those units. The strategic advantage is earned before the fight starts.

### Mode 1: Skirmish (Quick Match)

Fast, self-contained matches on a single map.

- Matchmaking pairs two players, generates a random map seed
- Both players blind-pick their squad within the power budget
- Squads start on opposite ends of the map
- **Win condition:** Destroy all enemy units OR capture the enemy base
- Capture requires holding the base for X seconds
- Best of 3 or 5 rounds (same map, squads reset to full HP each round)
- Terrain matters — rivers, forests, chokepoints all part of the tactical game
- Between rounds: same squads, fresh state, adjust your approach based on what you learned

### Mode 2: War (Frontline Push)

A tug-of-war across 5 maps. More strategic, higher stakes.

**Structure:**
```
Map 1        Map 2        Map 3        Map 4        Map 5
[P1 Base] ← [P1 Home] ← [Midpoint] → [P2 Home] → [P2 Base]
```

- Match starts at Map 3 (the midpoint)
- Win a round → front pushes one map toward the opponent's base
- Lose a round → replay the same map (defender knows the terrain now)
- First to win on the opponent's base map wins the war
- **Round cap: 9 rounds.** If neither side reaches the end, it's a draw. Draws are valid — neither side broke through.

**Map selection:**
- Each player/team picks the 2 maps closest to their base (Maps 1-2 for P1, Maps 4-5 for P2) — home turf, chosen seeds
- Map 3 (midpoint) is random — neutral ground, unknown to both
- Opposing player never sees the other side's map picks — completely blind
- Creates a map selection meta-game: pick terrain that suits your squad composition and play style

**Why this works:**
- Natural rubber-banding: losing player replays a map they've already seen
- Pushing into enemy territory is a genuine unknown — the "calculated risk"
- Home turf advantage rewards thoughtful map selection
- Round cap prevents infinite back-and-forth

### North Star: Global Territory

The War mode scales into a persistent global territory system:

- Players join factions/sides
- Every War match contributes to a faction's frontline on a global map
- Individual battles shift territory for everyone on your side
- Global events / seasons where factions compete for control
- Your wins matter beyond personal rank — you're fighting for your side

MVP is simple 1v1 tug of war. The global layer comes later.

### Technical Foundation

**Already built (server.js):**
- Socket.io matchmaking (`find-match`, `match-found`, side assignment)
- Game state sync (`game-update`, `opponent-update`)
- Unit deployment events (`deploy-unit`, `incoming-enemy`)
- Score tracking and game-over handling
- Disconnect detection and cleanup

---

## Open Questions

1. **Death penalty:** Lose all salvage from that run? Keep blueprints (they're knowledge, not cargo)? Partial recovery from insurance (base upgrade)?
2. **Run length:** Is extraction always available, or does it appear after N zones? Can you call for extraction from the comms tower (costs resources)?
3. **Backtracking:** Can you revisit cleared zones? Are enemies gone? Do caches respawn over time?
4. **Squad:** Can you recruit AI companions at forward bases? Do they persist between runs?
5. **Ammo as resource:** Do you bring limited ammo manufactured at base? Or is ammo infinite in the field? Limited ammo adds tension and makes the armory meaningful, but could frustrate younger players.
6. **Co-op:** Two players in the same seeded world — co-op exploration? Shared base? Split up to cover more ground, or stick together for safety?
7. **Vehicle durability:** Does equipment degrade with use? (Armor cracks, engine wears, optics get dirty) Repair math to maintain peak performance.
8. **Math difficulty adaptation:** Does the game track which facts the kid struggles with and weight those more heavily in manufacturing? (Targeted practice disguised as factory work)
9. **Blueprint rarity distribution:** How rare is "legendary"? Should every 10th stronghold guarantee a new blueprint? Or pure RNG?
10. **Zone size:** 32x32 or 48x48 as the "default" feel? Need to playtest both.
