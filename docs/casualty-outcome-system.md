# Casualty & Recovery System — Design Reference

## Core Principle

Nobody dies instantly. Every casualty has a chain of events — downed, revived or not, battle won or lost — that determines the final outcome. Stats, personality, support roles, and player decisions all influence who comes home.

---

## Part 1: Infantry Casualties

### Downed State

When an infantry unit hits 0 HP, they enter `downed` state:
- Unit falls prone, stops moving/firing
- **Bleed-out timer**: 30 seconds (visible progress bar above unit)
- Downed units remain on the field — they are not removed
- Downed units can still be hit (already at 0 HP, no further effect)

### Medic Revive (Mid-Battle)

Medics detect downed friendlies and prioritize them.

- Medic must move within ~30px of the downed soldier
- **Revive channel**: 3-4 seconds (interruptible by heavy suppression)
- On success: soldier revives at **20-30% HP**
- Revived soldiers have reduced accuracy and speed for the rest of the battle
- Medic callout on revive: *"You're good, stay with me"* / *"Get up, we're not done"*

If the medic doesn't reach them before the bleed-out timer expires, the soldier is `out` for the rest of the battle. Their fate is determined post-battle.

### Post-Battle Outcomes (Infantry)

**If the soldier was revived mid-battle:**
- No casualty roll. They made it. Active status, HP carries over from end of battle.

**If the soldier bled out but the battle was WON:**
- Medevac. Casualty roll determines injury severity.

**If the soldier bled out and the battle was LOST:**
- POW status. Casualty roll with worse odds determines injuries.

### Casualty Roll

Roll a **survival score** (0-100):

```
survivalScore = base
  + endurance × 0.25        // toughness — heaviest weight
  + strength × 0.15         // physical resilience
  + courage × 0.10          // willpower to hold on
  + veterancy × 0.10        // experience (battlesServed, caps at +10)
  - overkill_pct × 0.20     // how far past 0 HP the killing blow went (cap -20)
  - not_stabilized × 10     // bleed-out expired without medic
```

#### Base by context:

| Context | Base |
|---|---|
| Intro mission | 60 |
| Normal battle, won | 35 |
| Normal battle, lost | 20 |
| Vehicle crew (destroyed vehicle) | 15 |

#### Outcome thresholds:

| Score | Outcome | Recovery |
|---|---|---|
| 85+ | **Unscathed** | Active immediately, HP at 15-25% |
| 65-84 | **Light Wound** | Active next battle, HP at 50% |
| 40-64 | **Wounded** | 1-2 battles recovery |
| 20-39 | **Critical** | 3-4 battles recovery, HP starts at 5% |
| 0-19 | **KIA** | Permanent loss |

---

## Part 2: Vehicle Subsystem Damage

Vehicles don't just have HP — they have subsystems that can break independently.

### Subsystems

| Subsystem | Effect When Damaged | Engineer Repairable? |
|---|---|---|
| **Tracks** | Vehicle can't move. Can still fire. | Yes |
| **Turret** | Can't rotate or fire. Can still move. | Yes |
| **Engine** | Speed halved, smoking. | Yes |
| **Ammo Rack** | Catastrophic kill. Instant destruction. | No |

### Subsystem Damage Roll

On each hit that deals significant damage, roll for subsystem damage:

```
subsystemRoll = random(0-100)
  - (damage / vehicle_maxHP) × 50     // harder hits more likely to damage subsystems
  - armor_penetration_bonus            // AP rounds more dangerous to internals
```

Thresholds (TBD, need tuning):
- **Tracks**: roll < 15
- **Turret**: roll < 12
- **Engine**: roll < 10
- **Ammo Rack**: roll < 3 (rare but devastating)

Multiple subsystems can be damaged on the same vehicle. A tank with busted tracks AND a jammed turret is a sitting duck.

### Vehicle States

| State | Description |
|---|---|
| **Operational** | All subsystems functional, HP > 0 |
| **Damaged** | One or more subsystems out, HP > 0 |
| **Disabled** | Multiple subsystems out or HP very low — combat ineffective |
| **Destroyed** | HP hits 0 or ammo rack detonation |

### Engineer Mid-Battle Repair

Engineers detect damaged friendly vehicles and move to repair.

- Engineer must move within ~30px of the vehicle
- **Repair channel**: 4-5 seconds per subsystem (longer than medic revive)
- On success: subsystem restored. Vehicle HP stays where it is.
- Engineer is vulnerable during repair — same tension as medic revive
- Priority: tracks > turret > engine (mobility first)

Engineer does NOT restore vehicle HP. They fix what's broken so it can fight. HP recovery happens in the repair bay post-battle.

### Destroyed Vehicles — Crew Fate

When a vehicle is destroyed:
- Crew enters `downed` state (same as infantry)
- **Crew injuries are worse** — medic CANNOT revive vehicle crew mid-battle
- Crew must wait for post-battle resolution
- Win → medevac, casualty roll with vehicle crew base (15 — lower than infantry)
- Lose → POW

Ammo rack detonation:
- Crew automatically `downed` with severe injuries
- Casualty roll base: **5** (very low survival odds)
- This is the worst-case scenario for any unit in the game

---

## Part 3: Battle Outcomes

### Battle Won

| Soldier State | Outcome |
|---|---|
| Alive | Active, HP carries over |
| Revived by medic | Active, HP carries over (reduced) |
| Downed, bled out | Medevac → casualty roll (base 35) |
| Vehicle crew, vehicle destroyed | Medevac → casualty roll (base 15) |

### Battle Lost

| Soldier State | Outcome |
|---|---|
| Alive | Retreats, active but shaken (morale penalty) |
| Revived by medic | Retreats, active (reduced HP) |
| Downed, bled out | POW → casualty roll (base 20) |
| Vehicle crew, vehicle destroyed | POW → casualty roll (base 15) |

### Hero Goes Down

The hero is a soldier. Same rules apply.
- Hero downed → medic can revive, bleed-out timer, same as anyone
- **Battle does NOT end when hero goes down** — the squad fights on
- If hero is not revived: win → medevac, lose → POW
- Player selects a new hero from the roster
- Old hero can be rescued through future battles/missions (POW recovery)

---

## Part 4: POW System

### Capture

Soldiers who are downed when a battle is lost become POW.

- Status: `pow`
- Cannot be deployed
- Shown in a POW section of the barracks (or infirmary)

### Degradation

Each battle (run) that passes while a soldier is POW, they degrade:

```
degradeRoll = random(0-100)
  + endurance × 0.30        // can they endure captivity
  + courage × 0.20          // mental fortitude
  + veterancy × 0.15        // survival experience
```

| Roll | Result |
|---|---|
| 60+ | Stable — no change |
| 30-59 | Declining — hpPercent drops, woundedBattlesLeft increases |
| 10-29 | Critical — severe HP drop, may not survive much longer |
| 0-9 | Died in captivity — KIA |

High-stat veterans might hold on for 20+ runs. Green recruits with low courage could die in 1-2.

### Recovery

POWs are recovered by:
- **Winning battles** — each win has a chance to recover a POW (liberation)
- **Spending resources** — pay scrap/parts for a rescue operation (guaranteed)
- **Rescue missions** — special mission to recover specific POW (future feature)

Recovered POWs:
- Return with low HP, wounded status
- Long recovery time (4-6 battles)
- Possible stat penalties from captivity (temporary)
- Possible personality shifts (courage may drop, or increase — they survived)
- **Bonds strengthen** with anyone who was in the battle where they were captured

---

## Part 5: Vehicle Recovery

### Post-Battle (Won)

| Vehicle State | Outcome |
|---|---|
| Operational | Active, HP carries over |
| Damaged (subsystems) | Repair bay: 1-2 battles, subsystems restored |
| Destroyed | Repair bay: 3-5 battles, costs scrap. All subsystems restored. |

### Post-Battle (Lost)

| Vehicle State | Outcome |
|---|---|
| Operational | Retreats with the squad |
| Damaged | Retreats, subsystem damage persists until repaired |
| Destroyed | Captured — spend resources to recover, or permanent loss |

---

## Part 6: Support Role Value

### Medic
- Revives downed infantry mid-battle (3-4s channel)
- Proximity bonus (+15) to casualty roll for squad members
- Cannot help vehicle crew from destroyed vehicles
- High priority target — losing the medic means no more revives

### Engineer
- Repairs damaged vehicle subsystems mid-battle (4-5s channel)
- Does NOT restore vehicle HP — subsystems only
- Cannot fix ammo rack detonation
- High priority asset for mechanized squads

### Tactical Implications
- Every squad wants a medic and an engineer
- Mixed squads (infantry + vehicles) need both
- Losing your medic early changes the entire battle dynamic
- Engineers keep damaged vehicles in the fight — a tracked tank with a repaired turret is still dangerous

---

## Part 7: Recovery & Healing

### Infirmary (Barracks Tab)

Wounded soldiers show in the infirmary with:
- HP bar and current status
- Recovery timer (battles remaining)
- **Rush Heal**: spend 50 scrap for instant recovery

### Repair Bay

Damaged/destroyed vehicles show with:
- HP bar and subsystem status
- Repair timer (battles remaining)
- **Rush Repair**: spend scrap for instant repair (cost scales with damage)

### Passive Recovery

Between battles (on win):
- All wounded soldiers heal +20% HP
- Wounded → active when HP > 50% AND woundedBattlesLeft = 0
- Vehicles repair +15% HP per battle

### Emergency Draft

If the entire roster is lost (all KIA/POW):
- HQ sends a batch of green recruits
- Bottom-tier stats, no training, no bonds
- The player rebuilds from nothing
- Any surviving POWs continue degrading — rescue them or lose them

---

## Implementation Priority

1. **Downed state + bleed-out timer** — foundation for everything else
2. **Medic revive AI** — the most impactful mid-battle mechanic
3. **Casualty roll in _processPostBattle** — replace the current binary dead/alive
4. **POW status + degradation** — loss consequences
5. **Vehicle subsystem damage** — per-hit rolls
6. **Engineer repair AI** — mirror of medic for vehicles
7. **Infirmary + repair bay UI** — already partially built
8. **Hero goes down ≠ game over** — battle continues
9. **Emergency draft** — safety net for total wipe
10. **Rescue missions** — future content
