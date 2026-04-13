# Player Decision Profile — Design Note

## Core Idea
Track cumulative player decisions across all runs to build a playstyle fingerprint.
SGTs whose personality aligns with the player's playstyle get a synergy bonus.
Mismatched SGTs have friction — lower command authority, slower response.

## Tracked Dimensions
- **Aggression** — attack vs defend, push vs hold frequency
- **Risk tolerance** — extraction wave depth, casualty acceptance
- **Obedience** — how often player follows CMD/SGT orders vs ignores them
- **Protectiveness** — extraction rate, soldiers kept alive percentage

## Uses (confirmed)
- SGT synergy/friction — personality match with player tendencies
- Narrative — radio chatter adapts to player reputation
- Difficulty tuning — enemy AI adapts to player patterns
- Recruitment quality — reputation affects recruit pool quality
- Morale modifier — troops trust/distrust based on track record

## Uses (future exploration)
- CMD recruitment matching
- Special event triggers based on playstyle
- Enemy commander learning across runs
