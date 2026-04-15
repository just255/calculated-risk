# Gear & Equipment System — Design Reference

## Core Concept

Every soldier has equipment slots. Gear lives in a shared armory. Assigning gear to a soldier removes it from the pool. Gear modifies combat stats. Training determines how effectively the soldier uses the gear. Gear can be lost permanently if a soldier dies or becomes POW in a lost battle.

## Stat Model

```
Final stat = Soldier physicals + (Gear bonus × Training effectiveness)
```

- **Physicals** — the human (fixed per soldier, grows slowly over time)
- **Gear bonus** — what the equipment adds at 100% effectiveness
- **Training** — multiplier (0-1) on gear bonus. 90% trained = 90% of gear bonus applied

A soldier with no gear has only their physicals. A soldier with great gear but 10% training barely benefits from it.

## Equipment Slots

| Slot | Description | Examples |
|------|------------|---------|
| **Primary** | Main weapon | M4A1, AK-47, M249, M24 Sniper |
| **Sidearm** | Backup weapon | M9, M1911, Glock 17 |
| **Optic** | Sighting system (restricted by weapon) | Iron Sights, Red Dot, ACOG 4x, Sniper Scope 8x |
| **Attachment** | Weapon mod (restricted by weapon) | Suppressor, Foregrip, Bipod, Extended Mag |
| **Armor** | Body protection | None, Light Vest, Plate Carrier, Heavy Armor |
| **Utility** | Role-specific or shared gear | Medkit, Repair Kit, Ammo Pack, Grenades, Mines |

## MOS Weapon Access

| MOS | Primary Categories | Unique Utility |
|-----|-------------------|---------------|
| Rifleman | Assault rifles, Battle rifles, Carbines | Grenades, Ammo Pack |
| Medic | SMGs, Carbines, Pistols | Medkit, Trauma Kit |
| Engineer | SMGs, Shotguns, Carbines | Repair Kit, AT Mines, C4 |
| Heavy Gunner | LMGs, Launchers | Bipod (free), Extra Ammo Belt |
| Marksman | Sniper rifles, DMRs, Battle rifles | Ghillie wrap (reduces detection) |

Sidearms and armor are shared across all MOS.

## Weapon Data Model

Each weapon is a unique instance in the armory:

```js
{
  id: 'wpn_a3f2c',               // unique instance ID
  templateId: 'M4A1',            // weapon template
  condition: 0.95,                // 0-1, affects reliability
  
  // From template:
  name: 'M4A1',
  category: 'assault_rifle',     // determines MOS access
  stats: {
    damage: 18,                   // per-hit damage
    fireRate: 600,                // ms between shots (RPM = 60000/fireRate)
    range: 350,                   // effective range in game units
    accuracy: 0.82,               // base accuracy
    magSize: 30,                  // magazine capacity
    reloadTime: 2200,             // ms to reload
    recoil: 0.15,                 // per-shot recoil
    weight: 3.4                   // affects movement speed
  },
  compatibleOptics: ['iron', 'red_dot', 'acog', 'holo'],
  compatibleAttachments: ['suppressor', 'foregrip', 'laser', 'ext_mag'],
  
  // Behavioral properties
  burstMode: 'auto',             // 'auto' | 'burst' | 'semi'
  soundSignature: 1.3,           // detection range multiplier
  muzzleFlash: 1.0               // visual signature
}
```

## Optic Data Model

```js
{
  templateId: 'acog_4x',
  name: 'ACOG 4x',
  slot: 'optic',
  statMods: {
    range: 80,                    // bonus at 100% training
    accuracy: 0.05,               // bonus
    aimTime: 200                  // penalty: ms added to aim time
  },
  compatibleWith: ['assault_rifle', 'battle_rifle', 'dmr']
}
```

## Attachment Data Model

```js
{
  templateId: 'suppressor',
  name: 'Suppressor',
  slot: 'attachment',
  statMods: {
    damage: -2,                   // slight damage reduction
    range: -20                    // slight range reduction
  },
  behaviorMods: {
    soundSignature: 0.4,          // reduces detection range to 40%
    muzzleFlash: 0.1              // nearly invisible flash
  },
  compatibleWith: ['assault_rifle', 'smg', 'carbine', 'sniper_rifle', 'pistol']
}
```

## Armor Data Model

```js
{
  templateId: 'plate_carrier',
  name: 'Plate Carrier',
  slot: 'armor',
  statMods: {
    hp: 40,                       // bonus HP
    speed: -8,                    // movement penalty
    stamina: -0.1                 // endurance penalty (tires faster)
  }
}
```

## Utility Data Model

```js
{
  templateId: 'medkit',
  name: 'Field Medkit',
  slot: 'utility',
  mosRestriction: ['medic'],      // only medics can equip
  ability: 'revive',              // unlocks mid-battle revive
  charges: 3,                     // uses per battle
  statMods: {}                    // no passive stat changes
}
```

## Stat Computation (Revised)

```js
function getEffectiveCombatStats(soldier) {
  // 1. Start with soldier physicals as base
  const p = soldier.physicals;
  let stats = {
    hp: scalePhysical(p.strength, 120, 220),       // strength → HP pool
    speed: scalePhysical(p.endurance, 35, 65),      // endurance → movement
    viewRange: scalePhysical(p.vision, 400, 700),   // vision → spotting
    reactionTime: scalePhysical(p.reflexes, 80, 40) // reflexes → faster reactions (lower = better)
  };
  
  // 2. Apply weapon stats (if equipped)
  const weapon = getEquippedItem(soldier, 'primary');
  if (weapon) {
    const t = soldier.training?.[soldier.role] ?? 0;
    stats.damage = weapon.stats.damage;
    stats.fireRate = weapon.stats.fireRate;
    stats.range = weapon.stats.range;
    stats.accuracy = weapon.stats.accuracy;
    stats.magSize = weapon.stats.magSize;
    stats.reloadTime = weapon.stats.reloadTime;
    
    // 3. Apply optic/attachment mods (scaled by training)
    const optic = getEquippedItem(soldier, 'optic');
    const attachment = getEquippedItem(soldier, 'attachment');
    for (const item of [optic, attachment].filter(Boolean)) {
      for (const [stat, bonus] of Object.entries(item.statMods || {})) {
        if (stats[stat] !== undefined) {
          stats[stat] += bonus * t;  // Training scales gear effectiveness
        }
      }
    }
  } else {
    // No weapon: fists/sidearm fallback
    stats.damage = 3;
    stats.fireRate = 1500;
    stats.range = 50;
    stats.accuracy = 0.5;
  }
  
  // 4. Apply armor
  const armor = getEquippedItem(soldier, 'armor');
  if (armor) {
    for (const [stat, bonus] of Object.entries(armor.statMods || {})) {
      if (stats[stat] !== undefined) stats[stat] += bonus;
    }
  }
  
  // 5. Apply weapon condition degradation
  if (weapon && weapon.condition < 1.0) {
    stats.accuracy *= (0.7 + weapon.condition * 0.3);  // 70-100% accuracy based on condition
    // Jam chance increases as condition drops (handled in fire-decision.js)
  }
  
  // 6. Apply wound debuffs
  if (soldier.hpPercent < 1.0) {
    stats.hp = Math.round(stats.hp * soldier.hpPercent);
  }
  
  return stats;
}
```

## Armory Data Model

```js
Game.armory = {
  weapons: [],      // weapon instances
  optics: [],       // optic instances  
  attachments: [],  // attachment instances
  armor: [],        // armor instances
  utilities: []     // utility instances
};
```

Each item in the armory has:
- `id` — unique instance ID
- `templateId` — references the template for stats/name
- `condition` — 0-1 durability
- `assignedTo` — soldier ID or null (in pool)

## Soldier Loadout

```js
soldier.loadout = {
  primary: 'wpn_a3f2c',      // armory item ID or null
  sidearm: 'wpn_b7d1e',
  optic: 'opt_c4f8a',
  attachment: 'att_d2e9b',
  armor: 'arm_e1f3c',
  utility: 'utl_f5a2d'
};
```

## Standard Issue (Default Gear)

When a soldier is recruited, they receive standard issue gear for their MOS. These are created as new armory items:

| MOS | Primary | Optic | Armor | Utility |
|-----|---------|-------|-------|---------|
| Rifleman | M4A1 | Iron Sights | Light Vest | Frag Grenade ×2 |
| Medic | MP5 | Iron Sights | Light Vest | Medkit ×3 |
| Engineer | M870 Shotgun | Iron Sights | Light Vest | Repair Kit ×2 |
| Heavy Gunner | M249 SAW | Iron Sights | Plate Carrier | Ammo Belt |
| Marksman | M24 SWS | Scope 4x | Light Vest | Ghillie Wrap |

Standard issue gear has no special quality — it's the baseline.

## Acquisition

### Loot (post-battle)
- Enemies drop weapons/gear on death (chance-based)
- Quality and rarity scale with wave difficulty
- Dropped gear starts at 60-80% condition

### Scrap Purchase (Armory shop)
- Buy from a catalog of available items
- Prices scale with quality
- New items start at 100% condition

### Crafting (Factory mode — future)
- Combine parts to build gear
- Math problems determine quality (the core game loop)
- Higher quality = better base stats or unique perks

### Salvage
- Strip gear from KIA soldiers before burial
- Damaged gear can be repaired at cost

## Gear Loss

| Situation | Gear Status |
|-----------|-------------|
| Battle won, soldier alive | Gear returns, condition -5-10% |
| Battle won, soldier wounded/revived | Gear returns, condition -15-25% |
| Battle won, soldier KIA (medevac) | Gear recovered, condition -30% |
| Battle lost, soldier retreats | Gear returns, condition -10% |
| Battle lost, soldier KIA | Gear lost permanently |
| Soldier becomes POW | Gear lost permanently |
| POW rescued | Soldier returns, NO gear |

## Condition & Maintenance

- Gear starts at 100% condition
- Each battle degrades condition by 5-15% (based on shots fired, damage taken)
- Low condition effects:
  - Weapons: accuracy drops, jam chance increases
  - Armor: HP bonus reduces proportionally
  - Optics: range bonus reduces
- Repair: spend scrap in the armory (cost scales with damage)
- Below 20% condition: "WORN" warning, significant stat penalties
- 0% condition: broken, must repair before use

## UI — Armory Tab

The Armory HQ tab becomes the gear management screen:

```
┌──────────────────────────────────────────┐
│  [INVENTORY]  [LOADOUTS]  [SHOP]         │
├──────────────┬───────────────────────────┤
│  WEAPONS (12) │  Selected: M4A1          │
│  ┌──────────┐ │  Damage: 18              │
│  │ M4A1 95% │ │  ROF: 100 rpm            │
│  │ M4A1 78% │ │  Range: 35m              │
│  │ AK47 82% │ │  Accuracy: 82%           │
│  │ M249 91% │ │  Mag: 30 rds             │
│  └──────────┘ │  Compatible: RFL, MRK    │
│  OPTICS (5)   │  Assigned to: PVT Brown  │
│  ARMOR (4)    │  ────────────────────     │
│  UTILITY (8)  │  [UNASSIGN] [REPAIR $20] │
└──────────────┴───────────────────────────┘
```

## Weapon Templates (Starter Set)

### Assault Rifles
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| M4A1 | 18 | 600 | 350 | 0.82 | 30 | 3.4 |
| AK-47 | 22 | 650 | 320 | 0.75 | 30 | 3.9 |
| M16A4 | 20 | 700 | 380 | 0.85 | 30 | 3.6 |

### SMGs
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| MP5 | 12 | 500 | 200 | 0.78 | 30 | 2.5 |
| P90 | 14 | 450 | 220 | 0.76 | 50 | 2.8 |

### LMGs
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| M249 SAW | 20 | 550 | 400 | 0.70 | 200 | 7.5 |
| M240B | 28 | 650 | 450 | 0.68 | 100 | 12.0 |

### Sniper Rifles
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| M24 SWS | 65 | 2000 | 600 | 0.90 | 5 | 5.4 |
| Barrett M82 | 120 | 3000 | 800 | 0.85 | 10 | 14.0 |

### Shotguns
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| M870 | 45 | 1200 | 100 | 0.60 | 8 | 3.6 |
| AA-12 | 30 | 800 | 80 | 0.55 | 20 | 5.2 |

### Sidearms
| Weapon | DMG | ROF(ms) | Range | Acc | Mag | Weight |
|--------|-----|---------|-------|-----|-----|--------|
| M9 | 10 | 400 | 100 | 0.72 | 15 | 1.0 |
| M1911 | 14 | 500 | 80 | 0.78 | 7 | 1.1 |

## Implementation Priority

1. **Weapon templates** in constants.js — define the starter weapon set
2. **Armory data model** on Game state — inventory arrays, persistence
3. **Soldier loadout** field — links soldier to armory items
4. **Standard issue** on recruitment — auto-create and assign default gear
5. **Revised getEffectiveCombatStats** — weapons drive damage/ROF/range, training scales attachments
6. **Dossier card update** — bars show physicals (olive) + gear (color-coded by source)
7. **Armory tab UI** — inventory browser, loadout editor, repair
8. **Loot drops** — enemies drop gear post-battle
9. **Condition/durability** — degradation per battle, repair costs
10. **Gear loss** on KIA/POW
11. **Shop** — buy gear with scrap
12. **Crafting** — future (ties into math-as-manufacturing)
