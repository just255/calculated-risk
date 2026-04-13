# Command Hierarchy — Design Document

## Overview

Three-tier command chain: Commander (CMD) → Sergeant (SGT) → Unit.
Each tier has distinct responsibilities, stats, and progression.

## Tiers

### Commander (CMD) — Strategic, Off-Field
- Pool: `officer`
- Role: `commander`
- Rank track: OFFICER_RANKS (2LT → 1LT → CPT → MAJ)
- Never deploys to the field. Operates from HQ/command post.
- One CMD assigned per battle (Operations tab, CMD slot above squads).
- If no CMD assigned: no strategic bonuses, player handles everything manually.

**What CMD controls:**
- Max squads deployable (rank-gated: 1/2/3/3)
- Max deploy power cap (rank-gated)
- Deployment suggestions (ghost layout on deploy panel, awareness + terrain-driven)
- Objectives issued to SGTs during battle (ATTACK, DEFEND, ADVANCE_TO, FALL_BACK, SUPPORT)
- Intel gathering (progressive enemy composition reveal, awareness-driven)
- Morale recovery between waves (discipline-driven)

**CMD personality weights:**
| Trait | Effect |
|---|---|
| Aggression | Offensive vs defensive objective bias |
| Discipline | Reserve commit timing, morale recovery between waves |
| Awareness | Intel quality/speed, deployment suggestion quality |
| Initiative | Response speed — how fast objectives adapt to changing battlefield |
| Patience | Willingness to hold and let enemies come |
| Courage | Willingness to issue risky orders (flanking, advancing under fire) |

**CMD MMR progression — scored on:**
| Metric | Weight | Description |
|---|---|---|
| Waves completed | High | Force survival |
| Extraction rate | High | Getting everyone out |
| Soldiers kept alive | Medium | Casualties under command |
| Morale at extraction | Medium | Force cohesion |
| Objectives completed | Medium | Did squads achieve orders? |
| Overkill penalty | Low (negative) | Deploying 10x power vs wave 1 doesn't count |

**Override penalty:**
CMD MMR credit is reduced when the player overrides CMD decisions.
Only applies when player acts ABOVE their assigned role scope.

| Override Level | CMD MMR Credit |
|---|---|
| No overrides | 100% |
| Minor (1-2 changes) | 75% |
| Moderate (3-5 changes) | 40% |
| Heavy (6+ changes) | 10% |
| Full manual (CMD mode) | 0% |

Override diff is computed from:
- Deployment: how far player moved squads from CMD's suggested positions
- Battle: how many CMD objectives the player changed

### Sergeant (SGT) — Tactical, On-Field
- Pool: `infantry` (or `vehicle` if TC)
- Must be E-5+ (NCO-eligible)
- One per squad, auto-assigned to highest leadership score
- Player can override SGT assignment in Operations tab
- On SGT death: auto-reassign to next highest leadership in squad, cascading until last unit

**What SGT controls:**
- Tactical phases (SEARCH, CONTACT, ENGAGE, PRESS, PURSUE, DISENGAGE, REGROUP, AMBUSH, FLANK, HOLD)
- Unit commands (Follow, Advance, Hold, Fall Back, Cover Me, Focus Fire, Flank Left/Right)
- Translates CMD objectives into tactical execution

**SGT derived stats:**
```
leadership = discipline × 0.4 + initiative × 0.3 + awareness × 0.2 + courage × 0.1
commandAuthority = leadership × (0.5 + rankBonus)
moraleBuffer = courage × 0.5 + discipline × 0.3
rallySpeed = courage × 0.4 + discipline × 0.4
squadDetection = awareness × 0.6
formationCohesion = discipline × 0.5
```

**SGT feeds into effectiveMorale:**
```
effectiveMorale = morale + discipline × 0.3 + sgtLeadership × 0.2 + veterancy × 0.1
```

### Unit — Execution, On-Field
- All enlisted soldiers and vehicle crew
- Follows SGT commands filtered through personality
- effectiveMorale determines behavior bands (rout/survival/obey)

## Player Override Scope

| Player Role | Controls | Cannot Override |
|---|---|---|
| Unit in squad | Own movement, firing, position | Other units, SGT, CMD |
| TC in vehicle | Vehicle + crew actions | Other vehicles, SGT, CMD |
| SGT of squad | Squad tactics, unit commands | Other squads, CMD |
| CMD mode | All objectives, all squads | Nothing (0% CMD MMR) |

## Officer Rank Track

| Index | Grade | Abbr | Title | Max Squads | Deploy Power Cap |
|---|---|---|---|---|---|
| 0 | O-1 | 2LT | Second Lieutenant | 1 | Base |
| 1 | O-2 | 1LT | First Lieutenant | 2 | Base × 1.5 |
| 2 | O-3 | CPT | Captain | 3 | Base × 2.0 |
| 3 | O-4 | MAJ | Major | 3 | Base × 2.5 |

## Green to Gold (Enlisted → Officer Promotion)

Any soldier E-5+ can be promoted to officer. They leave the field permanently.

| Enlisted Rank | Scrap Cost | Commendations Required |
|---|---|---|
| SGT (E-5) | 800 | 4 |
| SSG (E-6) | 600 | 3 |
| SFC (E-7) | 400 | 2 |
| MSG (E-8) | 250 | 1 |
| SGM (E-9) | 150 | 0 |

- Personality carries over
- MMR continues (does not reset) — full career tracked for memorial
- Starts at O-1 regardless of enlisted rank
- Officer MMR scored on CMD-specific metrics, not combat

## Intel Gathering (CMD Awareness)

Once deployed, CMD gathers intel progressively:

```
Time to first intel = 30s - (awareness × 20s)
```

Reveal order (each step unlocks at intervals):
1. Enemy force size (small/medium/large)
2. Unit type breakdown (infantry/vehicle/heavy counts)
3. Approximate positions (markers)
4. Movement direction + intent

## Deployment Suggestions

CMD generates a suggested deployment layout (ghost positions on deploy panel):
- Squad zone assignments (ALPHA/BRAVO/CHARLIE)
- Formation recommendations
- Composition adjustments

Player sees these as pre-filled/ghost positions. Moving units away from suggestions = override diff.

## Starting Progression

| Milestone | Unlock |
|---|---|
| Start | 1 infantry (player character), solo play |
| Wave 3 | CMD slot unlocks, first officer assigned/recruitable |
| Wave 5 | SGT auto-assignment, roster expands to 25 |
| First vehicle | Vehicle crew, motor pool |

## Player Decision Profile

Track cumulative player decisions across all runs:
- Aggression tendency (attack vs defend choices)
- Risk tolerance (push deep vs extract early)
- Override frequency (trust AI vs micromanage)
- Casualty tolerance (expendable vs protective)

Uses TBD — potential for CMD personality matching, difficulty tuning, narrative flavor.

## Retirement → Memorial Wall

Soldiers can be manually retired (not just KIA):
- Removes from active roster
- Calculates legacy score from full career
- If qualifying, eligible for memorial wall
- Triggers lineage (sons become available)
- Different from DISMISS (which deletes permanently)
