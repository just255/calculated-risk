# Hero Persistence Plan — "Forge Your Soldier"

## Concept

The hero is a persistent soldier from the roster. You start as a raw recruit (E-1, low stats). Your personality traits grow based on **how you actually play** — not arbitrary numbers. The same `progression.js` trait growth system that AI soldiers use applies to the hero, but fed by **player input metrics** instead of AI behavior metrics.

## Data Flow

```
Game.heroSoldierId  ──→  roster lookup  ──→  soldier personality/stats
                                                    │
                                              battle creation
                                                    │
                                              hero unit gets:
                                              - baseAccuracy + soldier bonus
                                              - personality (affects squad morale, intel sharing)
                                              - rank (affects squad command radius)
                                                    │
                                              during battle:
                                              - track player metrics (new)
                                                    │
                                              post-battle:
                                              - feed metrics to computeTraitDeltas()
                                              - applyTraitGrowth() to soldier
                                              - XP + rank promotion
                                              - save roster
```

## What Already Exists (no changes needed)

| System | Status |
|--------|--------|
| `createSoldier()` / `generateRecruit()` | Ready — creates E-1 with low stats |
| `createBattleMetrics()` | Ready — tracks kills, accuracy, suppression, cover, etc. |
| `computeTraitDeltas()` | Ready — maps metrics to personality growth |
| `applyTraitGrowth()` | Ready — diminishing returns, clamp 0-1 |
| `applyPromotion()` / `RANK_TABLE` | Ready — E-1 through E-9 |
| `saveRoster()` / `loadRoster()` | Ready — localStorage persistence |
| `baseAccuracy` in UNIT_COMBAT_STATS | Ready — just added |
| `_accuracyBonus` slot in `shouldFire()` | Ready — just added |

## What Needs To Be Built

### 1. `Game.heroSoldierId` — persistent hero reference
- New field on `Game` (in `state.js`), saved/loaded with `storage.js`
- If null → first-run flow creates a recruit and assigns them
- Points to a soldier in `Game.roster` with a special `isHero: true` flag

### 2. Hero metrics collector — track player behavior during battle
- New object `b._heroMetrics` (instance of `createBattleMetrics()`) created at battle start
- **Shots fired**: increment in `game.js` where hero creates projectile (~line 2395)
- **Shots hit**: increment in `projectile-resolver.js` when `p.sourceId` starts with `'hero'` and hits enemy
- **Damage dealt**: sum damage in same hit path
- **Movement time**: accumulate `dtSec` when `hero.isMoving === true` in the hero update loop
- **Distance traveled**: sum `hero.velocity * dtSec` each frame
- **Time in cover**: accumulate when hero position has cover terrain
- **Survival time**: `(now - battleStart) / 1000`
- **Engagement distance**: average distance to target at fire time (new metric)

### 3. Wire hero creation to roster soldier
- In `state.js` `newBattle()`: look up `Game.heroSoldierId` → get soldier → apply personality to hero unit
- Soldier personality feeds into hero's `_awareness`, `_accuracyBonus`, and display stats
- Soldier rank affects viewRange bonus and squad morale aura

### 4. Post-battle hero progression
- In game.js victory/defeat handling: call `processHeroProgression(b)`
- Feeds `b._heroMetrics` into existing `computeTraitDeltas()` → `applyTraitGrowth()`
- XP award based on kills, waves survived, accuracy
- Rank promotion check via existing `applyPromotion()`
- Save roster

### 5. Play-style derived bonuses (the "mold" part)
- **High accuracy player** (hitRatio > 0.6 over time) → patience + discipline grow → higher stability threshold gate → fires less but hits more
- **Aggressive player** (high shots/sec, close engagements) → aggression grows → personality feeds into squad AI
- **Tactical player** (lots of cover time, repositioning) → awareness + initiative grow → better intel sharing, wider view cone
- These emerge naturally from `computeTraitDeltas()` — no special hero logic needed, the existing growth matrix already maps these behaviors to traits

### 6. Hero soldier UI (lightweight)
- HQ screen: show hero soldier card (name, rank, personality bars, battles served)
- Post-battle: show trait changes ("Patience +0.01, Courage +0.005")
- Deploy screen: hero slot shows the soldier's stats

## Files Changed

| File | Change |
|------|--------|
| `state.js` | Add `Game.heroSoldierId`, wire soldier→hero in `newBattle()` |
| `storage.js` | Save/load `heroSoldierId` |
| `game.js` | Create `b._heroMetrics`, increment shotsFired on hero fire, call `processHeroProgression()` at battle end |
| `projectile-resolver.js` | Increment `b._heroMetrics.shotsHit` + `damageDealt` on hero projectile hit |
| `progression.js` | Add `processHeroProgression(b)` function (thin wrapper around existing growth pipeline) |
| `roster.js` | Add `getHeroSoldier()` helper, `isHero` flag |
| `ui.js` | Hero soldier card in HQ + post-battle trait deltas display |
| `main.js` | First-run hero creation flow, hero card click handlers |

## What This Does NOT Do (future)
- Hero unit type selection (always infantry for now — vehicle hero is a later feature)
- Hero loadout/equipment system (ties into factory mode)
- Hero permadeath (too punishing early — add later with "legacy" system)
- Multiplayer hero persistence

## Implementation Order
1. Data model (`heroSoldierId`, `isHero` flag, persistence)
2. Hero metrics collection (shots, hits, movement, cover)
3. Wire soldier→hero at battle creation
4. Post-battle progression
5. UI (hero card, trait growth display)

Each step is independently testable.
