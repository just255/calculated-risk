# Physical Attributes + Cross-Training — Design Reference

## Physical Attributes (0-100 scale, rolled at creation)

| Attribute | What it is | TC Effect | Gunner Effect | Driver Effect | Infantry Effect |
|---|---|---|---|---|---|
| Vision | How far/well they see | View range | — | — | View range |
| Strength | Physical toughness | — | Recoil management | — | Max HP, recoil management |
| Reflexes | Reaction speed | — | Reload speed, stability recovery | Turn rate | Reload speed, stability recovery |
| Endurance | Stamina | Suppression resistance | — | Terrain handling | Suppression resistance, speed |

## Cross-Training (MOS + Training Map)

Every soldier has:
- `mos` — primary MOS, set at recruitment, permanent
- `training` — map of role → proficiency (0-1)

### Starting Training by MOS:
| MOS | Primary (0.5) | Cross-trained |
|---|---|---|
| Rifleman | rifleman | medic 0.1, engineer 0.1, heavy_gunner 0.15 |
| Medic | medic | rifleman 0.2 |
| Engineer | engineer | rifleman 0.15, heavy_gunner 0.1 |
| Heavy Gunner | heavy_gunner | rifleman 0.2, engineer 0.1 |
| TC | tc | gunner 0.15, driver 0.1 |
| Gunner | gunner | tc 0.1 |
| Driver | driver | tc 0.1, gunner 0.05 |

### Growth:
- +0.02 per battle in active role
- MOS role grows at 1.5x rate (+0.03)
- Cap at 1.0

## Role Effectiveness Formula

```
effectiveness(stat) = (physicalStat / 100) × (0.5 + training[role] × 0.5)
```

Physical stats are the ceiling, training determines how much you reach.

### Example:
Soldier with 80 strength, training { gunner: 0.8, tc: 0.2 }:
- As gunner: 0.8 × (0.5 + 0.8 × 0.5) = 0.8 × 0.9 = **0.72 effectiveness**
- As TC: 0.8 × (0.5 + 0.2 × 0.5) = 0.8 × 0.6 = **0.48 effectiveness**

## Gameplay Impact Band

All modifiers apply as: `baseStat × (0.7 + modifier × 0.3)`

- Modifier 0.0 → 70% of base stat (untrained, weak physical)
- Modifier 0.5 → 85% of base stat (average)
- Modifier 1.0 → 100% of base stat (mastery, peak physical)

Crew can never make a vehicle worse than 70% of its base capability.
