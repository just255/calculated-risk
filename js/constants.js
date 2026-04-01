// ═══════════════════════════════════════════════════════════════
// CONSTANTS - State enums, unit definitions, enemy definitions
// ═══════════════════════════════════════════════════════════════

export const State = {
  MENU: 'menu',
  HQ: 'hq',
  SETTINGS: 'settings',
  STATS: 'stats',
  MATCHMAKING: 'matchmaking',
  COUNTDOWN: 'countdown',
  BATTLE: 'battle',
  WAVE_COMPLETE: 'wave_complete',
  PAUSED: 'paused',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  // H2H States
  H2H_DESIGN: 'h2h_design',
  H2H_BATTLE: 'h2h_battle',
  H2H_RESULT: 'h2h_result',
  H2H_MATCH_END: 'h2h_match_end',
  // Sprite Editor
  SPRITE_EDITOR: 'sprite_editor',
  // Campaign States
  CAMPAIGN_ERA_SELECT: 'campaign_era_select',
  CAMPAIGN_MOS_SELECT: 'campaign_mos_select',
  CAMPAIGN_TRAINING: 'campaign_training',
  CAMPAIGN_MAP: 'campaign_map',
  CAMPAIGN_PLANNING: 'campaign_planning',
  CAMPAIGN_BATTLE: 'campaign_battle',
  CAMPAIGN_RESULT: 'campaign_result',
  CAMPAIGN_ERA_END: 'campaign_era_end',
  // Vehicle Selection (for test battles)
  VEHICLE_SELECT: 'vehicle_select',
  // Endless Mode States
  ENDLESS_LOADOUT: 'endless_loadout',     // Pre-run: select gear, buy insurance
  ENDLESS_BATTLE: 'endless_battle',       // Combat (hero control)
  ENDLESS_BETWEEN: 'endless_between',     // Between waves: exit/continue/repair
  ENDLESS_RESULT: 'endless_result',        // Run complete: death or extraction
  // Fire Range (AI test bed)
  FIRE_RANGE: 'fire_range',               // Config screen: pick units, behaviors
  FIRE_RANGE_BATTLE: 'fire_range_battle',  // Active AI battle (observer mode)
  // Replay Theater
  REPLAY_THEATER: 'replay_theater',
  REPLAY_PLAYBACK: 'replay_playback'
};

// Team identifiers — used on unit.team, waypoint keys, commander keys, logs
export const Team = {
  BLUE: 'blue',
  RED: 'red'
};

// Projectile owner — used on p.owner for hit routing in game.js
export const Owner = {
  PLAYER: 'player',
  ALLY: 'ally',
  ENEMY: 'enemy'
};

export const HQTab = {
  LINEUP: 'lineup',
  UNITS: 'units',
  UPGRADES: 'upgrades',
  INSIGNIA: 'insignia'
};

export const RANK_NAMES = ['PVT', 'PV2', 'PFC', 'SPC', 'CPL', 'SGT'];
export const RANK_LABELS = ['Private', 'Private 2nd Class', 'Private First Class', 'Specialist', 'Corporal', 'Sergeant'];

export const INSIGNIA_SHAPE_TYPES = [
  { type: 'chevron', label: 'Chevron', icon: 'V' },
  { type: 'arc', label: 'Arc', icon: '⌒' },
  { type: 'diamond', label: 'Diamond', icon: '◇' },
  { type: 'line', label: 'Line', icon: '—' },
  { type: 'circle', label: 'Circle', icon: '○' },
  { type: 'path', label: 'Path', icon: '✏' }
];

// ═══════════════════════════════════════════════════════════════
// SQUAD SYSTEM
// ═══════════════════════════════════════════════════════════════

// Squad-level tactical orders
export const SquadOrder = {
  HOLD: 'hold',           // Stop and defend current position
  ADVANCE: 'advance',     // Move forward aggressively
  FALLBACK: 'fallback',   // Retreat to rally/fallback position
  SUPPRESS: 'suppress',   // Focus fire on area, reduce enemy accuracy
  FLANK: 'flank',         // Move around for side attack bonus
  DIG_IN: 'digIn',        // Fortify position, +defense, immobile
  SEARCH: 'search'        // Hunt enemies in area (search & destroy)
};

// Target priority options for units
export const TargetPriority = {
  NEAREST: 'nearest',     // Attack closest enemy
  WEAKEST: 'weakest',     // Attack lowest HP enemy
  STRONGEST: 'strongest', // Attack highest threat enemy
  ARMOR: 'armor',         // Prioritize armored targets
  INFANTRY: 'infantry',   // Prioritize infantry targets
  ARTILLERY: 'artillery', // Prioritize artillery/support
  ASSIGNED: 'assigned'    // Attack squad's concentrate target only
};

// Squad formation types
export const Formation = {
  AUTO: 'auto',           // Automatically arrange by unit type
  LINE: 'line',           // Horizontal line — holding, covering fire
  WEDGE: 'wedge',         // V-shape with leader at front — general advance
  COLUMN: 'column',       // Single file — retreating, following
  SPREAD: 'spread',       // Maximum spacing (anti-artillery) — same as dispersed
  STAGGERED: 'staggered', // Two offset columns — road movement, approach march
  ECHELON_L: 'echelon_l', // Diagonal line left — flanking left
  ECHELON_R: 'echelon_r'  // Diagonal line right — flanking right
};

// Order effects on unit behavior
export const ORDER_EFFECTS = {
  hold: {
    speedMod: 0,
    defenseMod: 1.0,
    canMove: false
  },
  advance: {
    speedMod: 1.2,
    defenseMod: 0.8,
    canMove: true,
    aggressive: true
  },
  fallback: {
    speedMod: 1.0,
    defenseMod: 0.9,
    canMove: true,
    retreating: true
  },
  suppress: {
    speedMod: 0,
    defenseMod: 1.0,
    canMove: false,
    areaFire: true,
    accuracyDebuff: 0.3  // Debuff applied to enemies in area
  },
  flank: {
    speedMod: 1.1,
    defenseMod: 0.7,
    canMove: true,
    damageMod: 1.5  // Bonus when attacking from side/rear
  },
  digIn: {
    speedMod: 0,
    defenseMod: 1.5,
    canMove: false,
    setupTime: 2000  // ms to set up
  },
  search: {
    speedMod: 0.8,
    defenseMod: 0.9,
    canMove: true,
    hunting: true
  }
};

// ═══════════════════════════════════════════════════════════════
// ZONE SYSTEM - Scrolling zone-capture mechanics
// ═══════════════════════════════════════════════════════════════

// Zone ownership states
export const ZoneOwner = {
  PLAYER: 'player',       // Controlled by player
  ENEMY: 'enemy',         // Controlled by enemy
  CONTESTED: 'contested', // Being fought over
  NEUTRAL: 'neutral'      // No current owner
};

// Scenario types for zone battles
export const ScenarioType = {
  ADVANCING: 'advancing', // Player pushes north through zones
  FRONTLINE: 'frontline'  // Tug-of-war, zones can be lost
};

// Biome types for terrain generation
export const Biome = {
  BEACH: 'beach',         // Sand, water, sparse cover
  FIELDS: 'fields',       // Open grass, hedgerows
  FOREST: 'forest',       // Dense trees, limited sightlines
  URBAN: 'urban',         // Buildings, streets, rubble
  FORTRESS: 'fortress'    // Fortifications, trenches, pillboxes
};

// Biome terrain distribution (probability weights)
export const BIOME_TERRAIN = {
  beach: {
    open: 0.3,
    grass: 0.2,
    water: 0.25,
    brush: 0.15,
    pillbox: 0.05,
    trench: 0.05
  },
  fields: {
    open: 0.15,
    grass: 0.4,
    brush: 0.2,
    forest: 0.1,
    high: 0.1,
    trench: 0.05
  },
  forest: {
    open: 0.05,
    grass: 0.15,
    brush: 0.25,
    forest: 0.45,
    high: 0.1
  },
  urban: {
    open: 0.2,
    pillbox: 0.25,
    trench: 0.15,
    high: 0.2,
    brush: 0.2
  },
  fortress: {
    open: 0.1,
    trench: 0.35,
    pillbox: 0.3,
    high: 0.15,
    brush: 0.1
  }
};

// ═══════════════════════════════════════════════════════════════
// UNIT STANCE SYSTEM - Drives proactive AI behavior
// ═══════════════════════════════════════════════════════════════

export const UnitStance = {
  AUTONOMOUS: 'autonomous',  // Default - AI decides based on situation
  AGGRESSIVE: 'aggressive',  // Push forward, deal more damage, take more damage
  DEFENSIVE: 'defensive',    // Hold ground, take less damage, deal less damage
  SUPPORT: 'support'         // Follow hero, provide backup
};

// Stance interaction modifiers (Rock-Paper-Scissors)
// Format: STANCE_MODIFIERS[attackerStance][targetStance] = { damageMod, defenseMod }
export const STANCE_MODIFIERS = {
  aggressive: {
    aggressive: { damageMod: 1.2, defenseMod: 0.8 },  // High risk/reward
    defensive:  { damageMod: 0.9, defenseMod: 1.0 },  // Defensive is prepared
    autonomous: { damageMod: 1.1, defenseMod: 1.0 },  // Slight edge
    support:    { damageMod: 1.0, defenseMod: 1.0 }
  },
  defensive: {
    aggressive: { damageMod: 1.2, defenseMod: 1.0 },  // Punish rushers
    defensive:  { damageMod: 0.8, defenseMod: 1.2 },  // Stalemate
    autonomous: { damageMod: 1.0, defenseMod: 1.1 },  // Slight edge
    support:    { damageMod: 1.0, defenseMod: 1.0 }
  },
  autonomous: {
    aggressive: { damageMod: 1.0, defenseMod: 1.0 },  // Balanced
    defensive:  { damageMod: 1.0, defenseMod: 1.0 },
    autonomous: { damageMod: 1.0, defenseMod: 1.0 },
    support:    { damageMod: 1.0, defenseMod: 1.0 }
  },
  support: {
    aggressive: { damageMod: 1.0, defenseMod: 1.0 },
    defensive:  { damageMod: 1.0, defenseMod: 1.0 },
    autonomous: { damageMod: 1.0, defenseMod: 1.0 },
    support:    { damageMod: 1.0, defenseMod: 1.0 }
  }
};

// Get stance modifier for damage calculation
export function getStanceModifier(attackerStance, targetStance) {
  const attacker = attackerStance || 'autonomous';
  const target = targetStance || 'autonomous';
  return STANCE_MODIFIERS[attacker]?.[target] || { damageMod: 1.0, defenseMod: 1.0 };
}

// Map enemy AI type to an equivalent stance for modifier calculations
export function getEnemyStance(aiType) {
  switch (aiType) {
    case 'RUSHER':
    case 'HUNTER':
      return 'aggressive';
    case 'CAUTIOUS':
    case 'RETREATER':
      return 'defensive';
    default:
      return 'autonomous';
  }
}

// Stance behavior parameters
export const STANCE_PARAMS = {
  autonomous: {
    advanceSpeed: 1.0,
    retreatThreshold: 0.30,  // Retreat at 30% HP
    threatPushThreshold: 0.3, // Push forward if threat < 30%
    threatHoldThreshold: 0.7  // Hold if threat 30-70%, retreat if > 70%
  },
  aggressive: {
    advanceSpeed: 1.3,       // 30% faster advance
    retreatThreshold: 0.15,  // Only retreat at 15% HP
    threatPushThreshold: 0.8, // Almost always push
    threatHoldThreshold: 0.95
  },
  defensive: {
    advanceSpeed: 0.8,       // 20% slower, more cautious
    retreatThreshold: 0.40,  // Retreat at 40% HP
    threatPushThreshold: 0.1, // Rarely push
    threatHoldThreshold: 0.5  // Hold more often
  },
  support: {
    advanceSpeed: 1.0,
    retreatThreshold: 0.30,
    followDistance: 80,       // Stay close to hero
    threatPushThreshold: 0,   // Never push independently
    threatHoldThreshold: 1.0  // Always follow hero
  }
};

// ═══════════════════════════════════════════════════════════════
// FORMATION OFFSETS - Preset formation positions
// ═══════════════════════════════════════════════════════════════

// Formation offsets from center point (for N units)
// Each array element is [offsetX, offsetY] relative to formation center
export const FORMATION_OFFSETS = {
  line: [
    // Assault line — leader at center, units spread horizontally
    [0, 0],              // 0: Leader (center)
    [-60, 0], [60, 0],
    [-120, 0], [120, 0],
    [-180, 0], [180, 0],
    [-240, 0], [240, 0]
  ],
  wedge: [
    // V-shape — leader center, point man at front tip
    // Per FM 3-21.8: platoon leader stays center for C2, point element leads
    [0, 0],                    // 0: Leader (center — reference point)
    [0, -50],                  // 1: Point man (50px ahead of leader)
    [-35, -25], [35, -25],     // 2-3: Forward wings
    [-70, 15], [70, 15],       // 4-5: Flanks beside leader
    [-105, 55], [105, 55],     // 6-7: Rear wings
    [0, 75]                    // 8: Tail guard
  ],
  column: [
    // Single file — leader in 3rd position for C2
    // Per doctrine: point man leads, slack man 2nd, leader 3rd
    [0, 0],              // 0: Leader (3rd position)
    [0, -100],           // 1: Point man
    [0, -50],            // 2: Slack man
    [0, 50],             // 3: Behind leader
    [0, 100],            // 4:
    [0, 150],            // 5:
    [0, 200],            // 6:
    [0, 250]             // 7: Tail-end charlie
  ],
  spread: [
    // Maximum spacing (anti-artillery / dispersed) — leader at center
    [0, 0],
    [-100, -50], [100, -50],
    [-100, 50], [100, 50],
    [-200, 0], [200, 0],
    [0, -100], [0, 100]
  ],
  staggered: [
    // Two offset columns — leader in 3rd position
    [0, 0],              // 0: Leader (3rd position)
    [0, -100],           // 1: Point man
    [30, -50],           // 2: Slack (offset right)
    [-30, 50],           // 3: Behind leader
    [30, 100],           // 4:
    [-30, 150],          // 5:
    [30, 200],           // 6:
    [-30, 250]           // 7: Tail
  ],
  echelon_l: [
    // Diagonal stepping left — leader 2nd position
    [0, 0],              // 0: Leader (2nd position)
    [40, -45],           // 1: Point (ahead, right)
    [-40, 45],           // 2: Step left-back
    [-80, 90],           // 3:
    [-120, 135],         // 4:
    [-160, 180],         // 5:
    [-200, 225],         // 6:
    [-240, 270]          // 7:
  ],
  echelon_r: [
    // Diagonal stepping right — leader 2nd position
    [0, 0],              // 0: Leader (2nd position)
    [-40, -45],          // 1: Point (ahead, left)
    [40, 45],            // 2: Step right-back
    [80, 90],            // 3:
    [120, 135],          // 4:
    [160, 180],          // 5:
    [200, 225],          // 6:
    [240, 270]           // 7:
  ]
};

// Get formation positions for N units centered at (cx, cy)
export function getFormationPositions(formation, cx, cy, unitCount, facing = -Math.PI/2) {
  const offsets = FORMATION_OFFSETS[formation] || FORMATION_OFFSETS.line;
  const positions = [];

  // Rotate offsets based on facing direction
  const cos = Math.cos(facing + Math.PI/2); // +90° to make "up" the default
  const sin = Math.sin(facing + Math.PI/2);

  for (let i = 0; i < Math.min(unitCount, offsets.length); i++) {
    const [ox, oy] = offsets[i];
    // Rotate offset
    const rx = ox * cos - oy * sin;
    const ry = ox * sin + oy * cos;
    positions.push({ x: cx + rx, y: cy + ry });
  }

  return positions;
}

// ═══════════════════════════════════════════════════════════════
// UNIT TYPE SYSTEM
// ═══════════════════════════════════════════════════════════════

export const UnitType = {
  INFANTRY: 'infantry',
  ARMOR: 'armor',
  RECON: 'recon',
  ANTI_ARMOR: 'anti_armor',
  ARTILLERY: 'artillery',
  SUPPORT: 'support',
  AIR: 'air',
  ANTI_AIR: 'anti_air'
};

// Type effectiveness: strong = 1.5x damage, weak = 0.67x damage
export const TYPE_CHART = {
  infantry:   { strong: ['recon'], weak: ['armor', 'artillery', 'air'] },
  armor:      { strong: ['infantry', 'recon'], weak: ['anti_armor', 'air'] },
  recon:      { strong: ['artillery', 'support'], weak: ['infantry', 'armor', 'air'] },
  anti_armor: { strong: ['armor'], weak: ['infantry', 'artillery', 'air'] },
  artillery:  { strong: ['infantry', 'anti_armor'], weak: ['recon', 'air'] },
  support:    { strong: [], weak: ['recon', 'air'] },
  air:        { strong: ['infantry', 'armor', 'recon', 'anti_armor', 'artillery', 'support'], weak: ['anti_air'] },
  anti_air:   { strong: ['air'], weak: ['armor', 'artillery'] }
};

// Calculate type effectiveness multiplier
export function getTypeMultiplier(attackerTypes, defenderTypes) {
  let multiplier = 1.0;
  for (const atkType of attackerTypes) {
    const chart = TYPE_CHART[atkType];
    if (!chart) continue;
    for (const defType of defenderTypes) {
      if (chart.strong.includes(defType)) multiplier *= 1.5;
      if (chart.weak.includes(defType)) multiplier *= 0.67;
    }
  }
  return multiplier;
}

// ═══════════════════════════════════════════════════════════════
// H2H UNIT COSTS (for wave budget system)
// ═══════════════════════════════════════════════════════════════

export const UNIT_COSTS = {
  infantry: 10,
  medic: 15,
  specops: 25,
  stinger: 30,
  jeep: 20,
  humvee: 35,
  sherman: 40,
  tiger: 60,
  abrams: 80,
  howitzer: 50,
  drone: 25,
  apache: 70
};

export const H2H_BUDGET = 500;

// Vehicle/tank units that need rotation to face enemy (drawn horizontally)
export const VEHICLE_UNITS = ['jeep', 'humvee', 'sherman', 'tiger', 'abrams', 'howitzer', 'apache'];

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN - ERAS AND MOS DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const CAMPAIGN_ERAS = [
  { id: 1, name: 'Revolutionary War', period: '1775-1783', tech: 'muskets' },
  { id: 2, name: 'Civil War I', period: '1861-1865', tech: 'rifles' },
  { id: 3, name: 'World War I', period: '1917-1918', tech: 'trenches' },
  { id: 4, name: 'World War II', period: '1942-1945', tech: 'tanks' },
  { id: 5, name: 'Vietnam', period: '1965-1975', tech: 'helicopters' },
  { id: 6, name: 'Civil War II', period: '2030+', tech: 'modern' }
];

export const CAMPAIGN_MOS = {
  infantry: { name: 'Infantry', playstyle: 'Versatile, adaptable' },
  cavalry: { name: 'Cavalry/Armor', playstyle: 'Heavy damage, mobile' },
  naval: { name: 'Naval', playstyle: 'Special naval missions' },
  aviation: { name: 'Aviation', playstyle: 'Air superiority', minEra: 3 },
  artillery: { name: 'Artillery', playstyle: 'Long range, area damage' }
};

// Hero units by era and MOS
export const CAMPAIGN_HERO_UNITS = {
  1: { // Revolutionary War
    infantry: { id: 'continental', name: 'Continental Soldier', hp: 80, speed: 120, damage: 15, fireRate: 2000 },
    cavalry: { id: 'dragoon', name: 'Dragoon', hp: 100, speed: 180, damage: 20, fireRate: 1500 },
    naval: { id: 'frigate_captain', name: 'Frigate Captain', hp: 120, speed: 100, damage: 25, fireRate: 2500 },
    artillery: { id: 'cannon_crew', name: 'Cannon Crew', hp: 60, speed: 80, damage: 40, fireRate: 3000 }
  },
  3: { // WWI (first era with all 5 MOS)
    infantry: { id: 'doughboy', name: 'Doughboy', hp: 100, speed: 130, damage: 20, fireRate: 800 },
    cavalry: { id: 'mark_iv', name: 'Mark IV Tank', hp: 200, speed: 80, damage: 35, fireRate: 1500 },
    naval: { id: 'destroyer_captain', name: 'Destroyer Captain', hp: 150, speed: 120, damage: 30, fireRate: 1200 },
    aviation: { id: 'sopwith', name: 'Sopwith Camel', hp: 80, speed: 200, damage: 25, fireRate: 500 },
    artillery: { id: 'howitzer_crew', name: 'Howitzer Crew', hp: 70, speed: 60, damage: 50, fireRate: 2500 }
  },
  4: { // WWII
    infantry: { id: 'gi', name: 'GI', hp: 100, speed: 140, damage: 22, fireRate: 600 },
    cavalry: { id: 'sherman', name: 'M4 Sherman', hp: 250, speed: 100, damage: 40, fireRate: 1200 },
    naval: { id: 'pt_boat', name: 'PT Boat Captain', hp: 150, speed: 160, damage: 35, fireRate: 800 },
    aviation: { id: 'p51', name: 'P-51 Mustang', hp: 100, speed: 250, damage: 30, fireRate: 400 },
    artillery: { id: 'm7_priest', name: 'M7 Priest', hp: 150, speed: 90, damage: 55, fireRate: 2000 }
  },
  6: { // Civil War II (Modern)
    infantry: { id: 'future_soldier', name: 'Future Soldier', hp: 120, speed: 160, damage: 28, fireRate: 400 },
    cavalry: { id: 'abrams', name: 'M1A3 Abrams', hp: 350, speed: 120, damage: 50, fireRate: 1000 },
    naval: { id: 'destroyer', name: 'Destroyer Captain', hp: 200, speed: 140, damage: 45, fireRate: 700 },
    aviation: { id: 'apache', name: 'AH-64 Apache', hp: 150, speed: 220, damage: 40, fireRate: 350 },
    artillery: { id: 'mlrs', name: 'M270 MLRS', hp: 120, speed: 80, damage: 70, fireRate: 1800 }
  }
};

// ═══════════════════════════════════════════════════════════════
// PROJECTILE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const PROJECTILES = {
  bullet: {
    speed: 600,       // pixels per second
    width: 3,
    height: 8,
    color: '#ffcc00',
    trail: false,
    muzzleFlash: { size: 8, duration: 50 }
  },
  rifle: {
    speed: 700,
    width: 2,
    height: 12,
    color: '#ff6600',
    trail: true,
    trailColor: 'rgba(255, 102, 0, 0.4)',
    muzzleFlash: { size: 10, duration: 60 }
  },
  missile: {
    speed: 400,
    width: 4,
    height: 14,
    color: '#ff3333',
    trail: true,
    trailColor: 'rgba(255, 150, 50, 0.6)',
    muzzleFlash: { size: 12, duration: 80 }
  },
  shell: {
    speed: 500,
    width: 6,
    height: 12,
    color: '#888888',
    trail: true,
    trailColor: 'rgba(100, 100, 100, 0.5)',
    muzzleFlash: { size: 16, duration: 100 }
  },
  artillery: {
    speed: 350,
    width: 8,
    height: 16,
    color: '#555555',
    trail: true,
    trailColor: 'rgba(80, 80, 80, 0.6)',
    muzzleFlash: { size: 24, duration: 120 }
  },
  laser: {
    speed: 900,
    width: 2,
    height: 20,
    color: '#00ffff',
    trail: true,
    trailColor: 'rgba(0, 255, 255, 0.3)',
    muzzleFlash: { size: 6, duration: 40 }
  },
  cannon: {
    speed: 550,
    width: 5,
    height: 10,
    color: '#ffaa00',
    trail: true,
    trailColor: 'rgba(255, 170, 0, 0.5)',
    muzzleFlash: { size: 14, duration: 90 }
  }
};

// Map unit types to their projectile type
export const UNIT_PROJECTILES = {
  infantry: 'bullet',
  medic: 'bullet',
  specops: 'rifle',
  stinger: 'missile',
  jeep: 'bullet',
  humvee: 'rifle',
  sherman: 'shell',
  tiger: 'shell',
  abrams: 'cannon',
  howitzer: 'artillery',
  drone: 'laser',
  apache: 'missile'
};

// Unit combat stats: range (pixels), speed (pixels/second), isAir
// viewRange (pixels): how far the crew can see (independent of fire range)
// viewCone (degrees): forward vision cone angle (peripheral/rear zones computed from this)
// Game version — single source of truth. Build number tracks iteration.
export const GAME_VERSION = { major: 0, minor: 8, build: 169 };
export const GAME_VERSION_STRING = `${GAME_VERSION.major}.${GAME_VERSION.minor}.${GAME_VERSION.build}`;

// Default max spread angle (degrees) — per-unit override via maxSpreadDeg in UNIT_COMBAT_STATS
export const DEFAULT_MAX_SPREAD_DEG = 7.5;

export const UNIT_COMBAT_STATS = {
  // hullRate/turretRate in deg/s (max), fireTolerance in deg, turretArc in deg
  // turretPivot: {x,y} offset from center in sprite-local coords
  // turretAccel: deg/s² — how fast turret accelerates/decelerates (trapezoidal profile)
  //   High = snappy (infantry aiming). Low = heavy turret inertia (tiger).
  // zeroIn: seconds to reach full stability from 0. Discipline modulates ±20%.
  // accel/decel: exponential lerp rates for hull movement (higher = snappier).
  //   Infantry: instant sprint response. Jeep: high p/w, launches fast. Tiger: sluggish.
  // baseAccuracy: weapon system's inherent precision ceiling (0-1). Upgrades/crew can push higher.
  // moveSignature: how visible when moving (1.0 = baseline, higher = more obvious). Multiplied with terrain concealment.
  // fireSignature: how visible when firing (muzzle flash, smoke). Replaces generic 1.5 hardcode.
  // proneSignature: visibility when prone/stationary in cover (infantry only). Lower = harder to spot.
  // hp/damage/fireRate: single source of truth for combat stats. All systems (deploy, fire range, roster) read from here.
  // hitRadius: projectile collision radius in pixels. Infantry ~10px, vehicles ~18px, tanks ~25px.
  infantry:  { hp: 180, damage: 6,  fireRate: 600,  range: 400, speed: 50,  accel: 2.5, decel: 4.0,  isAir: false, hitRadius: 10, viewRange: 550, viewCone: 140, hullRate: 1080, turretRate: 720,  turretAccel: 3600, fireTolerance: 15, turretArc: 360, zeroIn: 2.5, baseAccuracy: 0.82, blastRadius: 0,  moveSignature: 1.1, fireSignature: 1.3, proneSignature: 0.4, topDownSprite: '/sprites/units/infantry/soldier.png', turretPivot: { x: 0, y: 0 },  hullParts: ['boots', 'legs'],            turretParts: ['body', 'helmet', 'weapon'] },
  medic:     { hp: 160, damage: 5,  fireRate: 750,  range: 300, speed: 45,  accel: 2.5, decel: 4.0,  isAir: false, hitRadius: 10, viewRange: 450, viewCone: 150, hullRate: 1080, turretRate: 720,  turretAccel: 3600, fireTolerance: 15, turretArc: 360, zeroIn: 2.8, baseAccuracy: 0.75, blastRadius: 0,  moveSignature: 1.1, fireSignature: 1.3, proneSignature: 0.4, turretPivot: { x: 0, y: 0 },  hullParts: ['boots', 'legs'],            turretParts: ['body', 'helmet', 'weapon'] },
  specops:   { hp: 150, damage: 12, fireRate: 700,  range: 500, speed: 55,  accel: 3.0, decel: 4.5,  isAir: false, hitRadius: 10, viewRange: 800, viewCone: 130, hullRate: 1080, turretRate: 720,  turretAccel: 3600, fireTolerance: 15, turretArc: 360, zeroIn: 2.0, baseAccuracy: 0.90, blastRadius: 0,  moveSignature: 1.0, fireSignature: 1.2, proneSignature: 0.3, turretPivot: { x: 0, y: 0 },  hullParts: ['boots', 'legs'],            turretParts: ['body', 'helmet', 'weapon'] },
  stinger:   { hp: 170, damage: 25, fireRate: 2000, range: 550, speed: 45,  accel: 2.5, decel: 4.0,  isAir: false, hitRadius: 10, viewRange: 600, viewCone: 140, hullRate: 1080, turretRate: 720,  turretAccel: 3600, fireTolerance: 15, turretArc: 360, zeroIn: 3.0, baseAccuracy: 0.80, blastRadius: 0,  moveSignature: 1.1, fireSignature: 1.5, proneSignature: 0.4, turretPivot: { x: 0, y: 0 },  hullParts: ['boots', 'legs'],            turretParts: ['body', 'helmet', 'weapon'] },
  jeep:      { hp: 240, damage: 8,  fireRate: 400,  range: 450, speed: 120, accel: 5.0, decel: 3.5,  isAir: false, hitRadius: 18, viewRange: 700, viewCone: 120, hullRate: 180,  turretRate: 360,  turretAccel: 1200, fireTolerance: 10, turretArc: 360, zeroIn: 3.5, baseAccuracy: 0.72, blastRadius: 0,  moveSignature: 1.4, fireSignature: 1.4, proneSignature: 0.8, turretPivot: { x: 0, y: 2 },  hullParts: ['wheels', 'body', 'hood', 'seats', 'spare', 'detail'], turretParts: ['weapon'] },
  humvee:    { hp: 300, damage: 10, fireRate: 350,  range: 500, speed: 100, accel: 4.0, decel: 3.5,  isAir: false, hitRadius: 18, viewRange: 700, viewCone: 130, hullRate: 180,  turretRate: 360,  turretAccel: 1200, fireTolerance: 10, turretArc: 360, zeroIn: 3.2, baseAccuracy: 0.78, blastRadius: 8,  moveSignature: 1.4, fireSignature: 1.5, proneSignature: 0.8, turretPivot: { x: 0, y: -2 }, hullParts: ['wheels', 'body', 'hood', 'roof', 'detail'],           turretParts: ['turret', 'gun'] },
  sherman:   { hp: 450, damage: 30, fireRate: 1500, range: 550, speed: 60,  accel: 2.0, decel: 3.5,  isAir: false, hitRadius: 22, viewRange: 750, viewCone: 100, hullRate: 90,   turretRate: 270,  turretAccel: 540,  fireTolerance: 5,  turretArc: 360, zeroIn: 3.0, baseAccuracy: 0.85, blastRadius: 25, moveSignature: 1.6, fireSignature: 1.8, proneSignature: 0.9, turretPivot: { x: 0, y: 2 },  hullParts: ['tracks', 'hull'],           turretParts: ['turret', 'gun', 'hatches'] },
  tiger:     { hp: 600, damage: 45, fireRate: 2000, range: 600, speed: 50,  accel: 1.5, decel: 3.0,  isAir: false, hitRadius: 25, viewRange: 800, viewCone: 100, hullRate: 60,   turretRate: 180,  turretAccel: 360,  fireTolerance: 5,  turretArc: 360, zeroIn: 2.5, baseAccuracy: 0.88, blastRadius: 30, moveSignature: 1.7, fireSignature: 1.9, proneSignature: 0.9, turretPivot: { x: 0, y: 2 },  hullParts: ['tracks', 'hull'],           turretParts: ['turret', 'gun', 'hatches'] },
  abrams:    { hp: 750, damage: 60, fireRate: 1800, range: 700, speed: 55,  accel: 3.0, decel: 4.0,  isAir: false, hitRadius: 25, viewRange: 850, viewCone: 110, hullRate: 108,  turretRate: 270,  turretAccel: 720,  fireTolerance: 5,  turretArc: 360, zeroIn: 2.0, baseAccuracy: 0.92, blastRadius: 35, moveSignature: 1.8, fireSignature: 2.0, proneSignature: 0.9, turretPivot: { x: 0, y: 1 },  hullParts: ['tracks', 'hull'],           turretParts: ['turret', 'gun', 'hatches'] },
  howitzer:  { hp: 240, damage: 80, fireRate: 3000, range: 900, speed: 30,  accel: 1.2, decel: 2.5,  isAir: false, hitRadius: 22, viewRange: 400, viewCone: 140, hullRate: 45,   turretRate: 120,  turretAccel: 240,  fireTolerance: 3,  turretArc: 360, zeroIn: 4.0, baseAccuracy: 0.70, blastRadius: 50, moveSignature: 1.5, fireSignature: 2.2, proneSignature: 0.9, turretPivot: { x: 0, y: 3 },  hullParts: ['tracks', 'hull'],           turretParts: ['turret', 'gun'] },
  drone:     { hp: 200, damage: 15, fireRate: 800,  range: 500, speed: 120, accel: 6.0, decel: 6.0,  isAir: true,  hitRadius: 12, viewRange: 900, viewCone: 160, hullRate: 360,  turretRate: 360,  turretAccel: 1800, fireTolerance: 10, turretArc: 360, zeroIn: 1.5, baseAccuracy: 0.80, moveSignature: 1.2, fireSignature: 1.3, proneSignature: 1.0, turretPivot: { x: 0, y: 0 },  hullParts: [],                           turretParts: [] },
  apache:    { hp: 360, damage: 35, fireRate: 1000, range: 700, speed: 130, accel: 4.0, decel: 5.0,  isAir: true,  hitRadius: 18, viewRange: 900, viewCone: 160, hullRate: 270,  turretRate: 360,  turretAccel: 1440, fireTolerance: 10, turretArc: 360, zeroIn: 1.8, baseAccuracy: 0.85, moveSignature: 1.5, fireSignature: 1.6, proneSignature: 1.0, turretPivot: { x: 0, y: 0 },  hullParts: [],                           turretParts: [] }
};

// Unit descriptions for details panel
export const UNIT_DESCRIPTIONS = {
  infantry: "Standard ground troops armed with assault rifles. Cheap and reliable, they form the backbone of any defense.",
  medic: "Combat medics providing suppressive fire while supporting allies. Low damage but steady presence on the field.",
  specops: "Elite soldiers with high-powered rifles. Precise and deadly, they excel against light targets.",
  stinger: "Anti-air specialists armed with guided missiles. Essential for countering aerial threats.",
  jeep: "Fast reconnaissance vehicle with mounted gun. Quick deployment makes them ideal for rapid response.",
  humvee: "Armored transport with heavy machine gun. Versatile and mobile with decent firepower.",
  sherman: "Classic medium tank. Balanced armor and firepower, effective against most ground targets.",
  tiger: "Heavy battle tank with thick armor and powerful gun. Slow but devastating against ground forces.",
  abrams: "Modern main battle tank. Superior firepower and armor make it the ultimate ground weapon.",
  howitzer: "Self-propelled artillery. Long-range bombardment deals heavy damage to clustered enemies.",
  drone: "Unmanned aerial vehicle with precision laser. Fast targeting but vulnerable to anti-air.",
  apache: "Attack helicopter with rocket pods. Dominates the battlefield from above but weak to AA."
};

export const SubState = {
  PLAYING: 'playing',
  LANE_SELECT: 'lane_select'
  // Future: MATH_CHALLENGE, FORGE, etc.
};

// ═══════════════════════════════════════════════════════════════
// UNITS - 12 units with types, unlock costs, and upgrades
// ═══════════════════════════════════════════════════════════════

export const UNITS = [
  // === INFANTRY-BASED ===
  {
    id: 'infantry', name: 'Infantry',
    types: [UnitType.INFANTRY],
    damage: 6, fireRate: 600, deployCooldown: 2000,
    color: '#4ade80',
    sprite: { src: '/sprites/units/infantry.png', frameCount: 3, frameWidth: 256, frameHeight: 256 },
    parts: ['boots', 'body', 'helmet', 'weapon'],
    defaultColors: { boots: '#2d4a2d', body: '#3d5c3d', helmet: '#4a6b4a', weapon: '#1a1a1a' },
    // Top-down: helmet, shoulders, rifle, feet (colored/shaded)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <ellipse cx="17" cy="28" rx="4" ry="5" fill="#2d4a2d"/>
      <ellipse cx="33" cy="28" rx="4" ry="5" fill="#2d4a2d"/>
      <rect x="14" y="18" width="22" height="14" rx="3" fill="#3d5c3d"/>
      <rect x="23" y="6" width="4" height="16" rx="1" fill="#1a1a1a"/>
      <rect x="22" y="4" width="6" height="4" rx="1" fill="#333"/>
      <circle cx="25" cy="22" r="8" fill="#4a6b4a"/>
      <ellipse cx="25" cy="21" rx="5" ry="4" fill="#5a7d5a"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="25" rx="4" ry="5" fill="#2d4a2d"/><ellipse cx="33" cy="31" rx="4" ry="5" fill="#2d4a2d"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#3d5c3d"/>
        <rect x="23" y="6" width="4" height="16" rx="1" fill="#1a1a1a"/><rect x="22" y="4" width="6" height="4" rx="1" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#4a6b4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#5a7d5a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="28" rx="4" ry="5" fill="#2d4a2d"/><ellipse cx="33" cy="28" rx="4" ry="5" fill="#2d4a2d"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#3d5c3d"/>
        <rect x="23" y="6" width="4" height="16" rx="1" fill="#1a1a1a"/><rect x="22" y="4" width="6" height="4" rx="1" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#4a6b4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#5a7d5a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="31" rx="4" ry="5" fill="#2d4a2d"/><ellipse cx="33" cy="25" rx="4" ry="5" fill="#2d4a2d"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#3d5c3d"/>
        <rect x="23" y="6" width="4" height="16" rx="1" fill="#1a1a1a"/><rect x="22" y="4" width="6" height="4" rx="1" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#4a6b4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#5a7d5a"/>
      </svg>`
    ],
    unlockCost: null,
    upgrades: {
      damage: { levels: [10, 12, 15], costs: [0, 50, 100] },
      fireRate: { levels: [1000, 900, 800], costs: [0, 75, 150] }
    }
  },
  {
    id: 'medic', name: 'Medic',
    types: [UnitType.INFANTRY, UnitType.SUPPORT],
    damage: 5, fireRate: 1200, deployCooldown: 2500,
    color: '#f87171',
    sprite: { src: '/sprites/units/medic.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['boots', 'body', 'helmet', 'medkit', 'cross'],
    defaultColors: { boots: '#4a3030', body: '#5c4040', helmet: '#6b4a4a', medkit: '#eee', cross: '#c44' },
    // Top-down: helmet with cross, shoulders, medkit, feet (colored)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <ellipse cx="17" cy="28" rx="4" ry="5" fill="#4a3030"/>
      <ellipse cx="33" cy="28" rx="4" ry="5" fill="#4a3030"/>
      <rect x="14" y="18" width="22" height="14" rx="3" fill="#5c4040"/>
      <rect x="36" y="20" width="8" height="8" rx="1" fill="#eee"/>
      <line x1="40" y1="22" x2="40" y2="26" stroke="#c44"/><line x1="38" y1="24" x2="42" y2="24" stroke="#c44"/>
      <circle cx="25" cy="22" r="8" fill="#6b4a4a"/>
      <ellipse cx="25" cy="21" rx="5" ry="4" fill="#7d5a5a"/>
      <line x1="25" y1="17" x2="25" y2="25" stroke="#fff" stroke-width="2"/><line x1="21" y1="21" x2="29" y2="21" stroke="#fff" stroke-width="2"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="25" rx="4" ry="5" fill="#4a3030"/><ellipse cx="33" cy="31" rx="4" ry="5" fill="#4a3030"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#5c4040"/>
        <rect x="36" y="20" width="8" height="8" rx="1" fill="#eee"/><line x1="40" y1="22" x2="40" y2="26" stroke="#c44"/><line x1="38" y1="24" x2="42" y2="24" stroke="#c44"/>
        <circle cx="25" cy="22" r="8" fill="#6b4a4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#7d5a5a"/>
        <line x1="25" y1="17" x2="25" y2="25" stroke="#fff" stroke-width="2"/><line x1="21" y1="21" x2="29" y2="21" stroke="#fff" stroke-width="2"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="28" rx="4" ry="5" fill="#4a3030"/><ellipse cx="33" cy="28" rx="4" ry="5" fill="#4a3030"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#5c4040"/>
        <rect x="36" y="20" width="8" height="8" rx="1" fill="#eee"/><line x1="40" y1="22" x2="40" y2="26" stroke="#c44"/><line x1="38" y1="24" x2="42" y2="24" stroke="#c44"/>
        <circle cx="25" cy="22" r="8" fill="#6b4a4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#7d5a5a"/>
        <line x1="25" y1="17" x2="25" y2="25" stroke="#fff" stroke-width="2"/><line x1="21" y1="21" x2="29" y2="21" stroke="#fff" stroke-width="2"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="31" rx="4" ry="5" fill="#4a3030"/><ellipse cx="33" cy="25" rx="4" ry="5" fill="#4a3030"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#5c4040"/>
        <rect x="36" y="20" width="8" height="8" rx="1" fill="#eee"/><line x1="40" y1="22" x2="40" y2="26" stroke="#c44"/><line x1="38" y1="24" x2="42" y2="24" stroke="#c44"/>
        <circle cx="25" cy="22" r="8" fill="#6b4a4a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#7d5a5a"/>
        <line x1="25" y1="17" x2="25" y2="25" stroke="#fff" stroke-width="2"/><line x1="21" y1="21" x2="29" y2="21" stroke="#fff" stroke-width="2"/>
      </svg>`
    ],
    unlockCost: { scrap: 75, parts: 5 },
    upgrades: {
      damage: { levels: [5, 7, 10], costs: [0, 40, 80] },
      fireRate: { levels: [1200, 1100, 1000], costs: [0, 60, 120] }
    }
  },
  {
    id: 'specops', name: 'Spec Ops',
    types: [UnitType.INFANTRY, UnitType.RECON],
    damage: 18, fireRate: 700, deployCooldown: 3000,
    color: '#1e293b',
    sprite: { src: '/sprites/units/specops.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['boots', 'body', 'helmet', 'weapon', 'nvg'],
    defaultColors: { boots: '#1a1a1a', body: '#2a2a2a', helmet: '#333', weapon: '#111', nvg: '#3a5a3a' },
    // Top-down: helmet with NVG, shoulders, suppressed rifle, feet (dark tactical colors)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <ellipse cx="17" cy="28" rx="4" ry="5" fill="#1a1a1a"/>
      <ellipse cx="33" cy="28" rx="4" ry="5" fill="#1a1a1a"/>
      <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a2a2a"/>
      <rect x="23" y="4" width="4" height="20" rx="1" fill="#111"/>
      <ellipse cx="25" cy="3" rx="3" ry="2" fill="#333"/>
      <circle cx="25" cy="22" r="8" fill="#333"/>
      <circle cx="21" cy="18" r="3" fill="#1a3a1a"/><circle cx="29" cy="18" r="3" fill="#1a3a1a"/>
      <circle cx="21" cy="18" r="1.5" fill="#3a5a3a"/><circle cx="29" cy="18" r="1.5" fill="#3a5a3a"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="25" rx="4" ry="5" fill="#1a1a1a"/><ellipse cx="33" cy="31" rx="4" ry="5" fill="#1a1a1a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a2a2a"/>
        <rect x="23" y="4" width="4" height="20" rx="1" fill="#111"/><ellipse cx="25" cy="3" rx="3" ry="2" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#333"/>
        <circle cx="21" cy="18" r="3" fill="#1a3a1a"/><circle cx="29" cy="18" r="3" fill="#1a3a1a"/>
        <circle cx="21" cy="18" r="1.5" fill="#3a5a3a"/><circle cx="29" cy="18" r="1.5" fill="#3a5a3a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="28" rx="4" ry="5" fill="#1a1a1a"/><ellipse cx="33" cy="28" rx="4" ry="5" fill="#1a1a1a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a2a2a"/>
        <rect x="23" y="4" width="4" height="20" rx="1" fill="#111"/><ellipse cx="25" cy="3" rx="3" ry="2" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#333"/>
        <circle cx="21" cy="18" r="3" fill="#1a3a1a"/><circle cx="29" cy="18" r="3" fill="#1a3a1a"/>
        <circle cx="21" cy="18" r="1.5" fill="#3a5a3a"/><circle cx="29" cy="18" r="1.5" fill="#3a5a3a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="31" rx="4" ry="5" fill="#1a1a1a"/><ellipse cx="33" cy="25" rx="4" ry="5" fill="#1a1a1a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a2a2a"/>
        <rect x="23" y="4" width="4" height="20" rx="1" fill="#111"/><ellipse cx="25" cy="3" rx="3" ry="2" fill="#333"/>
        <circle cx="25" cy="22" r="8" fill="#333"/>
        <circle cx="21" cy="18" r="3" fill="#1a3a1a"/><circle cx="29" cy="18" r="3" fill="#1a3a1a"/>
        <circle cx="21" cy="18" r="1.5" fill="#3a5a3a"/><circle cx="29" cy="18" r="1.5" fill="#3a5a3a"/>
      </svg>`
    ],
    unlockCost: { scrap: 100, parts: 6 },
    upgrades: {
      damage: { levels: [18, 22, 28], costs: [0, 80, 160] },
      fireRate: { levels: [700, 600, 500], costs: [0, 100, 200] }
    }
  },
  {
    id: 'stinger', name: 'Stinger Team',
    types: [UnitType.INFANTRY, UnitType.ANTI_AIR],
    damage: 12, fireRate: 1100, deployCooldown: 2800,
    color: '#22d3ee',
    sprite: { src: '/sprites/units/stinger.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['boots', 'body', 'helmet', 'launcher', 'missile'],
    defaultColors: { boots: '#1a4a4a', body: '#2a5a5a', helmet: '#3a7a7a', launcher: '#3a6a3a', missile: '#2a5a2a' },
    // Top-down: helmet, shoulders, missile launcher, feet (cyan/teal colors)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <ellipse cx="17" cy="28" rx="4" ry="5" fill="#1a4a4a"/>
      <ellipse cx="33" cy="28" rx="4" ry="5" fill="#1a4a4a"/>
      <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a5a5a"/>
      <rect x="34" y="8" width="7" height="24" rx="2" fill="#3a6a3a"/>
      <ellipse cx="37.5" cy="6" rx="4" ry="3" fill="#2a5a2a"/>
      <circle cx="37.5" cy="6" r="2" fill="#1a3a1a"/>
      <circle cx="25" cy="22" r="8" fill="#3a7a7a"/>
      <ellipse cx="25" cy="21" rx="5" ry="4" fill="#4a8a8a"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="25" rx="4" ry="5" fill="#1a4a4a"/><ellipse cx="33" cy="31" rx="4" ry="5" fill="#1a4a4a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a5a5a"/>
        <rect x="34" y="8" width="7" height="24" rx="2" fill="#3a6a3a"/><ellipse cx="37.5" cy="6" rx="4" ry="3" fill="#2a5a2a"/><circle cx="37.5" cy="6" r="2" fill="#1a3a1a"/>
        <circle cx="25" cy="22" r="8" fill="#3a7a7a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#4a8a8a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="28" rx="4" ry="5" fill="#1a4a4a"/><ellipse cx="33" cy="28" rx="4" ry="5" fill="#1a4a4a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a5a5a"/>
        <rect x="34" y="8" width="7" height="24" rx="2" fill="#3a6a3a"/><ellipse cx="37.5" cy="6" rx="4" ry="3" fill="#2a5a2a"/><circle cx="37.5" cy="6" r="2" fill="#1a3a1a"/>
        <circle cx="25" cy="22" r="8" fill="#3a7a7a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#4a8a8a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <ellipse cx="17" cy="31" rx="4" ry="5" fill="#1a4a4a"/><ellipse cx="33" cy="25" rx="4" ry="5" fill="#1a4a4a"/>
        <rect x="14" y="18" width="22" height="14" rx="3" fill="#2a5a5a"/>
        <rect x="34" y="8" width="7" height="24" rx="2" fill="#3a6a3a"/><ellipse cx="37.5" cy="6" rx="4" ry="3" fill="#2a5a2a"/><circle cx="37.5" cy="6" r="2" fill="#1a3a1a"/>
        <circle cx="25" cy="22" r="8" fill="#3a7a7a"/><ellipse cx="25" cy="21" rx="5" ry="4" fill="#4a8a8a"/>
      </svg>`
    ],
    unlockCost: { scrap: 150, parts: 8 },
    upgrades: {
      damage: { levels: [12, 16, 22], costs: [0, 100, 200] },
      fireRate: { levels: [1100, 950, 800], costs: [0, 120, 240] }
    }
  },

  // === RECON ===
  {
    id: 'jeep', name: 'Willys Jeep',
    types: [UnitType.RECON],
    damage: 8, fireRate: 400, deployCooldown: 3000,
    color: '#86efac',
    sprite: { src: '/sprites/units/jeep.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    // Part colors for customization
    parts: ['body', 'hood', 'seats', 'wheels', 'spare', 'detail'],
    defaultColors: { body: '#4a5d23', hood: '#3d4d1c', seats: '#2a1a0a', wheels: '#1a1a1a', spare: '#1a1a1a', detail: '#888' },
    // Top-down: detailed jeep with hood, seats, spare tire (colored)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="wheels" x="9" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/>
      <rect data-part="wheels" x="9" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/>
      <rect data-part="body" x="13" y="6" width="24" height="38" rx="2" fill="#4a5d23"/>
      <rect data-part="hood" x="15" y="8" width="20" height="10" rx="1" fill="#3d4d1c"/>
      <line x1="15" y1="11" x2="35" y2="11" stroke="#2a3a12"/><line x1="15" y1="14" x2="35" y2="14" stroke="#2a3a12"/>
      <rect data-part="seats" x="16" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><rect data-part="seats" x="27" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/>
      <circle data-part="spare" cx="25" cy="38" r="5" fill="#1a1a1a"/><circle cx="25" cy="38" r="2" fill="#333"/>
      <line data-part="detail" x1="11" y1="12" x2="11" y2="16" stroke="#888"/><line data-part="detail" x1="39" y1="12" x2="39" y2="16" stroke="#888"/>
      <line data-part="detail" x1="11" y1="34" x2="11" y2="38" stroke="#888"/><line data-part="detail" x1="39" y1="34" x2="39" y2="38" stroke="#888"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="9" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="9" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="13" y="6" width="24" height="38" rx="2" fill="#4a5d23"/><rect data-part="hood" x="15" y="8" width="20" height="10" rx="1" fill="#3d4d1c"/><line x1="15" y1="11" x2="35" y2="11" stroke="#2a3a12"/><line x1="15" y1="14" x2="35" y2="14" stroke="#2a3a12"/>
        <rect data-part="seats" x="16" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><rect data-part="seats" x="27" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><circle data-part="spare" cx="25" cy="38" r="5" fill="#1a1a1a"/><circle cx="25" cy="38" r="2" fill="#333"/>
        <line data-part="detail" x1="11" y1="11" x2="11" y2="13" stroke="#888"/><line data-part="detail" x1="11" y1="15" x2="11" y2="17" stroke="#888"/><line data-part="detail" x1="39" y1="11" x2="39" y2="13" stroke="#888"/><line data-part="detail" x1="39" y1="15" x2="39" y2="17" stroke="#888"/>
        <line data-part="detail" x1="11" y1="33" x2="11" y2="35" stroke="#888"/><line data-part="detail" x1="11" y1="37" x2="11" y2="39" stroke="#888"/><line data-part="detail" x1="39" y1="33" x2="39" y2="35" stroke="#888"/><line data-part="detail" x1="39" y1="37" x2="39" y2="39" stroke="#888"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="9" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="9" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="13" y="6" width="24" height="38" rx="2" fill="#4a5d23"/><rect data-part="hood" x="15" y="8" width="20" height="10" rx="1" fill="#3d4d1c"/><line x1="15" y1="11" x2="35" y2="11" stroke="#2a3a12"/><line x1="15" y1="14" x2="35" y2="14" stroke="#2a3a12"/>
        <rect data-part="seats" x="16" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><rect data-part="seats" x="27" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><circle data-part="spare" cx="25" cy="38" r="5" fill="#1a1a1a"/><circle cx="25" cy="38" r="2" fill="#333"/>
        <line data-part="detail" x1="11" y1="12" x2="11" y2="14" stroke="#888"/><line data-part="detail" x1="11" y1="16" x2="11" y2="18" stroke="#888"/><line data-part="detail" x1="39" y1="12" x2="39" y2="14" stroke="#888"/><line data-part="detail" x1="39" y1="16" x2="39" y2="18" stroke="#888"/>
        <line data-part="detail" x1="11" y1="34" x2="11" y2="36" stroke="#888"/><line data-part="detail" x1="11" y1="38" x2="11" y2="40" stroke="#888"/><line data-part="detail" x1="39" y1="34" x2="39" y2="36" stroke="#888"/><line data-part="detail" x1="39" y1="38" x2="39" y2="40" stroke="#888"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="9" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="10" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="9" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="37" y="32" width="4" height="8" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="13" y="6" width="24" height="38" rx="2" fill="#4a5d23"/><rect data-part="hood" x="15" y="8" width="20" height="10" rx="1" fill="#3d4d1c"/><line x1="15" y1="11" x2="35" y2="11" stroke="#2a3a12"/><line x1="15" y1="14" x2="35" y2="14" stroke="#2a3a12"/>
        <rect data-part="seats" x="16" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><rect data-part="seats" x="27" y="20" width="7" height="8" rx="1" fill="#2a1a0a"/><circle data-part="spare" cx="25" cy="38" r="5" fill="#1a1a1a"/><circle cx="25" cy="38" r="2" fill="#333"/>
        <line data-part="detail" x1="11" y1="13" x2="11" y2="15" stroke="#888"/><line data-part="detail" x1="11" y1="17" x2="11" y2="18" stroke="#888"/><line data-part="detail" x1="39" y1="13" x2="39" y2="15" stroke="#888"/><line data-part="detail" x1="39" y1="17" x2="39" y2="18" stroke="#888"/>
        <line data-part="detail" x1="11" y1="35" x2="11" y2="37" stroke="#888"/><line data-part="detail" x1="11" y1="39" x2="11" y2="40" stroke="#888"/><line data-part="detail" x1="39" y1="35" x2="39" y2="37" stroke="#888"/><line data-part="detail" x1="39" y1="39" x2="39" y2="40" stroke="#888"/>
      </svg>`
    ],
    unlockCost: { scrap: 50, parts: 3 },
    upgrades: {
      damage: { levels: [15, 20, 25], costs: [0, 60, 120] },
      fireRate: { levels: [800, 700, 600], costs: [0, 80, 160] }
    }
  },
  {
    id: 'humvee', name: 'Humvee',
    types: [UnitType.RECON, UnitType.ANTI_AIR],
    damage: 10, fireRate: 350, deployCooldown: 3500,
    color: '#a3e635',
    sprite: { src: '/sprites/units/humvee.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['body', 'hood', 'roof', 'turret', 'gun', 'wheels', 'detail'],
    defaultColors: { body: '#5a6b3a', hood: '#4a5a2d', roof: '#3d4a25', turret: '#2a3318', gun: '#1a1a1a', wheels: '#1a1a1a', detail: '#888' },
    // Top-down: armored humvee with roof turret (colored)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="wheels" x="6" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/>
      <rect data-part="wheels" x="6" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/>
      <rect data-part="body" x="11" y="6" width="28" height="38" rx="2" fill="#5a6b3a"/>
      <path data-part="hood" d="M14 10 L36 10 L36 18 L14 18 Z" fill="#4a5a2d"/><line x1="14" y1="13" x2="36" y2="13" stroke="#3a4a20"/><line x1="14" y1="16" x2="36" y2="16" stroke="#3a4a20"/>
      <rect data-part="roof" x="14" y="20" width="22" height="18" rx="1" fill="#3d4a25"/>
      <circle data-part="turret" cx="25" cy="29" r="6" fill="#2a3318"/><circle cx="25" cy="29" r="3" fill="#3a4328"/>
      <rect data-part="gun" x="23" y="6" width="4" height="20" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="4" width="6" height="4" fill="#222"/>
      <line data-part="detail" x1="7" y1="13" x2="10" y2="13" stroke="#888"/><line data-part="detail" x1="7" y1="17" x2="10" y2="17" stroke="#888"/>
      <line data-part="detail" x1="40" y1="13" x2="43" y2="13" stroke="#888"/><line data-part="detail" x1="40" y1="17" x2="43" y2="17" stroke="#888"/>
      <line data-part="detail" x1="7" y1="33" x2="10" y2="33" stroke="#888"/><line data-part="detail" x1="7" y1="37" x2="10" y2="37" stroke="#888"/>
      <line data-part="detail" x1="40" y1="33" x2="43" y2="33" stroke="#888"/><line data-part="detail" x1="40" y1="37" x2="43" y2="37" stroke="#888"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="6" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="6" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="11" y="6" width="28" height="38" rx="2" fill="#5a6b3a"/><path data-part="hood" d="M14 10 L36 10 L36 18 L14 18 Z" fill="#4a5a2d"/><line x1="14" y1="13" x2="36" y2="13" stroke="#3a4a20"/><line x1="14" y1="16" x2="36" y2="16" stroke="#3a4a20"/>
        <rect data-part="roof" x="14" y="20" width="22" height="18" rx="1" fill="#3d4a25"/><circle data-part="turret" cx="25" cy="29" r="6" fill="#2a3318"/><circle cx="25" cy="29" r="3" fill="#3a4328"/>
        <rect data-part="gun" x="23" y="6" width="4" height="20" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="4" width="6" height="4" fill="#222"/>
        <line data-part="detail" x1="7" y1="12" x2="10" y2="12" stroke="#888"/><line data-part="detail" x1="7" y1="16" x2="10" y2="16" stroke="#888"/><line data-part="detail" x1="7" y1="19" x2="10" y2="19" stroke="#888"/>
        <line data-part="detail" x1="40" y1="12" x2="43" y2="12" stroke="#888"/><line data-part="detail" x1="40" y1="16" x2="43" y2="16" stroke="#888"/><line data-part="detail" x1="40" y1="19" x2="43" y2="19" stroke="#888"/>
        <line data-part="detail" x1="7" y1="32" x2="10" y2="32" stroke="#888"/><line data-part="detail" x1="7" y1="36" x2="10" y2="36" stroke="#888"/><line data-part="detail" x1="7" y1="39" x2="10" y2="39" stroke="#888"/>
        <line data-part="detail" x1="40" y1="32" x2="43" y2="32" stroke="#888"/><line data-part="detail" x1="40" y1="36" x2="43" y2="36" stroke="#888"/><line data-part="detail" x1="40" y1="39" x2="43" y2="39" stroke="#888"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="6" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="6" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="11" y="6" width="28" height="38" rx="2" fill="#5a6b3a"/><path data-part="hood" d="M14 10 L36 10 L36 18 L14 18 Z" fill="#4a5a2d"/><line x1="14" y1="13" x2="36" y2="13" stroke="#3a4a20"/><line x1="14" y1="16" x2="36" y2="16" stroke="#3a4a20"/>
        <rect data-part="roof" x="14" y="20" width="22" height="18" rx="1" fill="#3d4a25"/><circle data-part="turret" cx="25" cy="29" r="6" fill="#2a3318"/><circle cx="25" cy="29" r="3" fill="#3a4328"/>
        <rect data-part="gun" x="23" y="6" width="4" height="20" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="4" width="6" height="4" fill="#222"/>
        <line data-part="detail" x1="7" y1="13" x2="10" y2="13" stroke="#888"/><line data-part="detail" x1="7" y1="17" x2="10" y2="17" stroke="#888"/>
        <line data-part="detail" x1="40" y1="13" x2="43" y2="13" stroke="#888"/><line data-part="detail" x1="40" y1="17" x2="43" y2="17" stroke="#888"/>
        <line data-part="detail" x1="7" y1="33" x2="10" y2="33" stroke="#888"/><line data-part="detail" x1="7" y1="37" x2="10" y2="37" stroke="#888"/>
        <line data-part="detail" x1="40" y1="33" x2="43" y2="33" stroke="#888"/><line data-part="detail" x1="40" y1="37" x2="43" y2="37" stroke="#888"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="wheels" x="6" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="10" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="6" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/><rect data-part="wheels" x="39" y="30" width="5" height="10" rx="1" fill="#1a1a1a"/>
        <rect data-part="body" x="11" y="6" width="28" height="38" rx="2" fill="#5a6b3a"/><path data-part="hood" d="M14 10 L36 10 L36 18 L14 18 Z" fill="#4a5a2d"/><line x1="14" y1="13" x2="36" y2="13" stroke="#3a4a20"/><line x1="14" y1="16" x2="36" y2="16" stroke="#3a4a20"/>
        <rect data-part="roof" x="14" y="20" width="22" height="18" rx="1" fill="#3d4a25"/><circle data-part="turret" cx="25" cy="29" r="6" fill="#2a3318"/><circle cx="25" cy="29" r="3" fill="#3a4328"/>
        <rect data-part="gun" x="23" y="6" width="4" height="20" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="4" width="6" height="4" fill="#222"/>
        <line data-part="detail" x1="7" y1="14" x2="10" y2="14" stroke="#888"/><line data-part="detail" x1="7" y1="18" x2="10" y2="18" stroke="#888"/>
        <line data-part="detail" x1="40" y1="14" x2="43" y2="14" stroke="#888"/><line data-part="detail" x1="40" y1="18" x2="43" y2="18" stroke="#888"/>
        <line data-part="detail" x1="7" y1="34" x2="10" y2="34" stroke="#888"/><line data-part="detail" x1="7" y1="38" x2="10" y2="38" stroke="#888"/>
        <line data-part="detail" x1="40" y1="34" x2="43" y2="34" stroke="#888"/><line data-part="detail" x1="40" y1="38" x2="43" y2="38" stroke="#888"/>
      </svg>`
    ],
    unlockCost: { scrap: 125, parts: 7 },
    upgrades: {
      damage: { levels: [20, 26, 34], costs: [0, 90, 180] },
      fireRate: { levels: [600, 500, 400], costs: [0, 110, 220] }
    }
  },

  // === ARMOR ===
  {
    id: 'sherman', name: 'M4 Sherman',
    types: [UnitType.ARMOR, UnitType.SUPPORT],
    damage: 35, fireRate: 1500, deployCooldown: 4000,
    color: '#60a5fa',
    sprite: { src: '/sprites/units/sherman.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['tracks', 'hull', 'turret', 'gun', 'hatches', 'detail'],
    defaultColors: { tracks: '#2a2a2a', hull: '#4a5a3a', turret: '#5a6b4a', gun: '#1a1a1a', hatches: '#3a4a2a', detail: '#6a7b5a' },
    // Top-down: detailed Sherman with track segments, turret, hatches (colored)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="tracks" x="6" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/>
      <rect data-part="tracks" x="35" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/>
      <line x1="6" y1="10" x2="15" y2="10" stroke="#444"/><line x1="6" y1="16" x2="15" y2="16" stroke="#444"/><line x1="6" y1="22" x2="15" y2="22" stroke="#444"/>
      <line x1="6" y1="28" x2="15" y2="28" stroke="#444"/><line x1="6" y1="34" x2="15" y2="34" stroke="#444"/><line x1="6" y1="40" x2="15" y2="40" stroke="#444"/>
      <line x1="35" y1="10" x2="44" y2="10" stroke="#444"/><line x1="35" y1="16" x2="44" y2="16" stroke="#444"/><line x1="35" y1="22" x2="44" y2="22" stroke="#444"/>
      <line x1="35" y1="28" x2="44" y2="28" stroke="#444"/><line x1="35" y1="34" x2="44" y2="34" stroke="#444"/><line x1="35" y1="40" x2="44" y2="40" stroke="#444"/>
      <rect data-part="hull" x="14" y="8" width="22" height="34" rx="2" fill="#4a5a3a"/>
      <line x1="14" y1="38" x2="36" y2="38" stroke="#3a4a2a"/>
      <path data-part="turret" d="M18 20 L32 20 L34 32 L30 38 L20 38 L16 32 Z" fill="#5a6b4a"/>
      <circle data-part="hatches" cx="25" cy="30" r="4" fill="#3a4a2a"/><circle data-part="hatches" cx="21" cy="24" r="2" fill="#3a4a2a"/><circle data-part="hatches" cx="29" cy="24" r="2" fill="#3a4a2a"/>
      <rect data-part="gun" x="23" y="2" width="4" height="16" rx="0.5" fill="#1a1a1a"/>
      <rect data-part="gun" x="22" y="0" width="6" height="3" rx="0.5" fill="#222"/>
    </svg>`,
    // Animated frames - tracks shift by 2px each frame
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="6" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="6" y1="8" x2="15" y2="8" stroke="#444"/><line x1="6" y1="14" x2="15" y2="14" stroke="#444"/><line x1="6" y1="20" x2="15" y2="20" stroke="#444"/><line x1="6" y1="26" x2="15" y2="26" stroke="#444"/><line x1="6" y1="32" x2="15" y2="32" stroke="#444"/><line x1="6" y1="38" x2="15" y2="38" stroke="#444"/><line x1="6" y1="44" x2="15" y2="44" stroke="#444"/>
        <line x1="35" y1="8" x2="44" y2="8" stroke="#444"/><line x1="35" y1="14" x2="44" y2="14" stroke="#444"/><line x1="35" y1="20" x2="44" y2="20" stroke="#444"/><line x1="35" y1="26" x2="44" y2="26" stroke="#444"/><line x1="35" y1="32" x2="44" y2="32" stroke="#444"/><line x1="35" y1="38" x2="44" y2="38" stroke="#444"/><line x1="35" y1="44" x2="44" y2="44" stroke="#444"/>
        <rect data-part="hull" x="14" y="8" width="22" height="34" rx="2" fill="#4a5a3a"/><line x1="14" y1="38" x2="36" y2="38" stroke="#3a4a2a"/><path data-part="turret" d="M18 20 L32 20 L34 32 L30 38 L20 38 L16 32 Z" fill="#5a6b4a"/><circle data-part="hatches" cx="25" cy="30" r="4" fill="#3a4a2a"/><circle data-part="hatches" cx="21" cy="24" r="2" fill="#3a4a2a"/><circle data-part="hatches" cx="29" cy="24" r="2" fill="#3a4a2a"/><rect data-part="gun" x="23" y="2" width="4" height="16" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" rx="0.5" fill="#222"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="6" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="6" y1="10" x2="15" y2="10" stroke="#444"/><line x1="6" y1="16" x2="15" y2="16" stroke="#444"/><line x1="6" y1="22" x2="15" y2="22" stroke="#444"/><line x1="6" y1="28" x2="15" y2="28" stroke="#444"/><line x1="6" y1="34" x2="15" y2="34" stroke="#444"/><line x1="6" y1="40" x2="15" y2="40" stroke="#444"/>
        <line x1="35" y1="10" x2="44" y2="10" stroke="#444"/><line x1="35" y1="16" x2="44" y2="16" stroke="#444"/><line x1="35" y1="22" x2="44" y2="22" stroke="#444"/><line x1="35" y1="28" x2="44" y2="28" stroke="#444"/><line x1="35" y1="34" x2="44" y2="34" stroke="#444"/><line x1="35" y1="40" x2="44" y2="40" stroke="#444"/>
        <rect data-part="hull" x="14" y="8" width="22" height="34" rx="2" fill="#4a5a3a"/><line x1="14" y1="38" x2="36" y2="38" stroke="#3a4a2a"/><path data-part="turret" d="M18 20 L32 20 L34 32 L30 38 L20 38 L16 32 Z" fill="#5a6b4a"/><circle data-part="hatches" cx="25" cy="30" r="4" fill="#3a4a2a"/><circle data-part="hatches" cx="21" cy="24" r="2" fill="#3a4a2a"/><circle data-part="hatches" cx="29" cy="24" r="2" fill="#3a4a2a"/><rect data-part="gun" x="23" y="2" width="4" height="16" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" rx="0.5" fill="#222"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="6" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="9" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="6" y1="12" x2="15" y2="12" stroke="#444"/><line x1="6" y1="18" x2="15" y2="18" stroke="#444"/><line x1="6" y1="24" x2="15" y2="24" stroke="#444"/><line x1="6" y1="30" x2="15" y2="30" stroke="#444"/><line x1="6" y1="36" x2="15" y2="36" stroke="#444"/><line x1="6" y1="42" x2="15" y2="42" stroke="#444"/>
        <line x1="35" y1="12" x2="44" y2="12" stroke="#444"/><line x1="35" y1="18" x2="44" y2="18" stroke="#444"/><line x1="35" y1="24" x2="44" y2="24" stroke="#444"/><line x1="35" y1="30" x2="44" y2="30" stroke="#444"/><line x1="35" y1="36" x2="44" y2="36" stroke="#444"/><line x1="35" y1="42" x2="44" y2="42" stroke="#444"/>
        <rect data-part="hull" x="14" y="8" width="22" height="34" rx="2" fill="#4a5a3a"/><line x1="14" y1="38" x2="36" y2="38" stroke="#3a4a2a"/><path data-part="turret" d="M18 20 L32 20 L34 32 L30 38 L20 38 L16 32 Z" fill="#5a6b4a"/><circle data-part="hatches" cx="25" cy="30" r="4" fill="#3a4a2a"/><circle data-part="hatches" cx="21" cy="24" r="2" fill="#3a4a2a"/><circle data-part="hatches" cx="29" cy="24" r="2" fill="#3a4a2a"/><rect data-part="gun" x="23" y="2" width="4" height="16" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" rx="0.5" fill="#222"/>
      </svg>`
    ],
    unlockCost: { scrap: 100, parts: 5 },
    upgrades: {
      damage: { levels: [35, 45, 55], costs: [0, 120, 240] },
      fireRate: { levels: [1500, 1300, 1100], costs: [0, 140, 280] }
    }
  },
  {
    id: 'tiger', name: 'Tiger I',
    types: [UnitType.ARMOR, UnitType.ANTI_ARMOR],
    damage: 50, fireRate: 2000, deployCooldown: 5000,
    color: '#fbbf24',
    sprite: { src: '/sprites/units/tiger.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['tracks', 'hull', 'turret', 'gun', 'hatches', 'detail'],
    defaultColors: { tracks: '#2a2a2a', hull: '#8b7355', turret: '#9b8365', gun: '#1a1a1a', hatches: '#6b5a45', detail: '#ab9375' },
    // Top-down: heavy Tiger tank with thick tracks, boxy turret (dunkelgelb/desert tan)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="tracks" x="4" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/>
      <rect data-part="tracks" x="35" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/>
      <line x1="4" y1="9" x2="15" y2="9" stroke="#444"/><line x1="4" y1="15" x2="15" y2="15" stroke="#444"/><line x1="4" y1="21" x2="15" y2="21" stroke="#444"/>
      <line x1="4" y1="27" x2="15" y2="27" stroke="#444"/><line x1="4" y1="33" x2="15" y2="33" stroke="#444"/><line x1="4" y1="39" x2="15" y2="39" stroke="#444"/>
      <line x1="35" y1="9" x2="46" y2="9" stroke="#444"/><line x1="35" y1="15" x2="46" y2="15" stroke="#444"/><line x1="35" y1="21" x2="46" y2="21" stroke="#444"/>
      <line x1="35" y1="27" x2="46" y2="27" stroke="#444"/><line x1="35" y1="33" x2="46" y2="33" stroke="#444"/><line x1="35" y1="39" x2="46" y2="39" stroke="#444"/>
      <rect data-part="hull" x="14" y="6" width="22" height="38" rx="1" fill="#8b7355"/>
      <rect data-part="detail" x="16" y="40" width="18" height="3" fill="#7b6345"/>
      <rect data-part="turret" x="17" y="18" width="16" height="20" rx="1" fill="#9b8365"/>
      <circle data-part="hatches" cx="25" cy="32" r="4" fill="#6b5a45"/>
      <rect data-part="hatches" x="19" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="hatches" x="26" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/>
      <rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/>
      <rect data-part="gun" x="21" y="0" width="8" height="4" rx="0.5" fill="#222"/>
      <line x1="25" y1="4" x2="25" y2="0" stroke="#111"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="4" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/>
        <line x1="4" y1="7" x2="15" y2="7" stroke="#444"/><line x1="4" y1="13" x2="15" y2="13" stroke="#444"/><line x1="4" y1="19" x2="15" y2="19" stroke="#444"/><line x1="4" y1="25" x2="15" y2="25" stroke="#444"/><line x1="4" y1="31" x2="15" y2="31" stroke="#444"/><line x1="4" y1="37" x2="15" y2="37" stroke="#444"/><line x1="4" y1="43" x2="15" y2="43" stroke="#444"/>
        <line x1="35" y1="7" x2="46" y2="7" stroke="#444"/><line x1="35" y1="13" x2="46" y2="13" stroke="#444"/><line x1="35" y1="19" x2="46" y2="19" stroke="#444"/><line x1="35" y1="25" x2="46" y2="25" stroke="#444"/><line x1="35" y1="31" x2="46" y2="31" stroke="#444"/><line x1="35" y1="37" x2="46" y2="37" stroke="#444"/><line x1="35" y1="43" x2="46" y2="43" stroke="#444"/>
        <rect data-part="hull" x="14" y="6" width="22" height="38" rx="1" fill="#8b7355"/><rect data-part="detail" x="16" y="40" width="18" height="3" fill="#7b6345"/><rect data-part="turret" x="17" y="18" width="16" height="20" rx="1" fill="#9b8365"/><circle data-part="hatches" cx="25" cy="32" r="4" fill="#6b5a45"/><rect data-part="hatches" x="19" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="hatches" x="26" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="21" y="0" width="8" height="4" rx="0.5" fill="#222"/><line x1="25" y1="4" x2="25" y2="0" stroke="#111"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="4" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/>
        <line x1="4" y1="9" x2="15" y2="9" stroke="#444"/><line x1="4" y1="15" x2="15" y2="15" stroke="#444"/><line x1="4" y1="21" x2="15" y2="21" stroke="#444"/><line x1="4" y1="27" x2="15" y2="27" stroke="#444"/><line x1="4" y1="33" x2="15" y2="33" stroke="#444"/><line x1="4" y1="39" x2="15" y2="39" stroke="#444"/>
        <line x1="35" y1="9" x2="46" y2="9" stroke="#444"/><line x1="35" y1="15" x2="46" y2="15" stroke="#444"/><line x1="35" y1="21" x2="46" y2="21" stroke="#444"/><line x1="35" y1="27" x2="46" y2="27" stroke="#444"/><line x1="35" y1="33" x2="46" y2="33" stroke="#444"/><line x1="35" y1="39" x2="46" y2="39" stroke="#444"/>
        <rect data-part="hull" x="14" y="6" width="22" height="38" rx="1" fill="#8b7355"/><rect data-part="detail" x="16" y="40" width="18" height="3" fill="#7b6345"/><rect data-part="turret" x="17" y="18" width="16" height="20" rx="1" fill="#9b8365"/><circle data-part="hatches" cx="25" cy="32" r="4" fill="#6b5a45"/><rect data-part="hatches" x="19" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="hatches" x="26" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="21" y="0" width="8" height="4" rx="0.5" fill="#222"/><line x1="25" y1="4" x2="25" y2="0" stroke="#111"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="4" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="3" width="11" height="44" rx="1" fill="#2a2a2a"/>
        <line x1="4" y1="11" x2="15" y2="11" stroke="#444"/><line x1="4" y1="17" x2="15" y2="17" stroke="#444"/><line x1="4" y1="23" x2="15" y2="23" stroke="#444"/><line x1="4" y1="29" x2="15" y2="29" stroke="#444"/><line x1="4" y1="35" x2="15" y2="35" stroke="#444"/><line x1="4" y1="41" x2="15" y2="41" stroke="#444"/>
        <line x1="35" y1="11" x2="46" y2="11" stroke="#444"/><line x1="35" y1="17" x2="46" y2="17" stroke="#444"/><line x1="35" y1="23" x2="46" y2="23" stroke="#444"/><line x1="35" y1="29" x2="46" y2="29" stroke="#444"/><line x1="35" y1="35" x2="46" y2="35" stroke="#444"/><line x1="35" y1="41" x2="46" y2="41" stroke="#444"/>
        <rect data-part="hull" x="14" y="6" width="22" height="38" rx="1" fill="#8b7355"/><rect data-part="detail" x="16" y="40" width="18" height="3" fill="#7b6345"/><rect data-part="turret" x="17" y="18" width="16" height="20" rx="1" fill="#9b8365"/><circle data-part="hatches" cx="25" cy="32" r="4" fill="#6b5a45"/><rect data-part="hatches" x="19" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="hatches" x="26" y="20" width="5" height="4" rx="0.5" fill="#6b5a45"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="21" y="0" width="8" height="4" rx="0.5" fill="#222"/><line x1="25" y1="4" x2="25" y2="0" stroke="#111"/>
      </svg>`
    ],
    unlockCost: { scrap: 200, parts: 10 },
    upgrades: {
      damage: { levels: [50, 65, 80], costs: [0, 150, 300] },
      fireRate: { levels: [2000, 1750, 1500], costs: [0, 175, 350] }
    }
  },
  {
    id: 'abrams', name: 'M1 Abrams',
    types: [UnitType.ARMOR, UnitType.ARTILLERY],
    damage: 75, fireRate: 1800, deployCooldown: 6000,
    color: '#f472b6',
    sprite: { src: '/sprites/units/abrams/full-256-trimmed.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['tracks', 'hull', 'turret', 'gun', 'hatches', 'detail'],
    defaultColors: { tracks: '#2a2a2a', hull: '#5a5a5a', turret: '#6a6a6a', gun: '#1a1a1a', hatches: '#4a4a4a', detail: '#7a7a7a' },
    // Top-down: modern Abrams with angular turret, composite armor look (modern gray)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="tracks" x="5" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/>
      <rect data-part="tracks" x="35" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/>
      <line x1="5" y1="10" x2="15" y2="10" stroke="#444"/><line x1="5" y1="16" x2="15" y2="16" stroke="#444"/><line x1="5" y1="22" x2="15" y2="22" stroke="#444"/>
      <line x1="5" y1="28" x2="15" y2="28" stroke="#444"/><line x1="5" y1="34" x2="15" y2="34" stroke="#444"/><line x1="5" y1="40" x2="15" y2="40" stroke="#444"/>
      <line x1="35" y1="10" x2="45" y2="10" stroke="#444"/><line x1="35" y1="16" x2="45" y2="16" stroke="#444"/><line x1="35" y1="22" x2="45" y2="22" stroke="#444"/>
      <line x1="35" y1="28" x2="45" y2="28" stroke="#444"/><line x1="35" y1="34" x2="45" y2="34" stroke="#444"/><line x1="35" y1="40" x2="45" y2="40" stroke="#444"/>
      <path data-part="hull" d="M14 8 L36 8 L38 12 L38 42 L36 46 L14 46 L12 42 L12 12 Z" fill="#5a5a5a"/>
      <path data-part="turret" d="M17 18 L33 18 L35 22 L33 40 L17 40 L15 22 Z" fill="#6a6a6a"/>
      <path data-part="detail" d="M20 22 L30 22 L28 36 L22 36 Z" fill="#7a7a7a"/>
      <circle data-part="hatches" cx="25" cy="30" r="3" fill="#4a4a4a"/>
      <rect data-part="hatches" x="18" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="hatches" x="28" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/>
      <rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/>
      <rect data-part="gun" x="22" y="0" width="6" height="3" fill="#222"/>
      <line data-part="detail" x1="33" y1="26" x2="36" y2="26" stroke="#8a8a8a"/><line data-part="detail" x1="33" y1="30" x2="36" y2="30" stroke="#8a8a8a"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="5" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="5" y1="8" x2="15" y2="8" stroke="#444"/><line x1="5" y1="14" x2="15" y2="14" stroke="#444"/><line x1="5" y1="20" x2="15" y2="20" stroke="#444"/><line x1="5" y1="26" x2="15" y2="26" stroke="#444"/><line x1="5" y1="32" x2="15" y2="32" stroke="#444"/><line x1="5" y1="38" x2="15" y2="38" stroke="#444"/><line x1="5" y1="44" x2="15" y2="44" stroke="#444"/>
        <line x1="35" y1="8" x2="45" y2="8" stroke="#444"/><line x1="35" y1="14" x2="45" y2="14" stroke="#444"/><line x1="35" y1="20" x2="45" y2="20" stroke="#444"/><line x1="35" y1="26" x2="45" y2="26" stroke="#444"/><line x1="35" y1="32" x2="45" y2="32" stroke="#444"/><line x1="35" y1="38" x2="45" y2="38" stroke="#444"/><line x1="35" y1="44" x2="45" y2="44" stroke="#444"/>
        <path data-part="hull" d="M14 8 L36 8 L38 12 L38 42 L36 46 L14 46 L12 42 L12 12 Z" fill="#5a5a5a"/><path data-part="turret" d="M17 18 L33 18 L35 22 L33 40 L17 40 L15 22 Z" fill="#6a6a6a"/><path data-part="detail" d="M20 22 L30 22 L28 36 L22 36 Z" fill="#7a7a7a"/><circle data-part="hatches" cx="25" cy="30" r="3" fill="#4a4a4a"/><rect data-part="hatches" x="18" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="hatches" x="28" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" fill="#222"/><line data-part="detail" x1="33" y1="26" x2="36" y2="26" stroke="#8a8a8a"/><line data-part="detail" x1="33" y1="30" x2="36" y2="30" stroke="#8a8a8a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="5" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="5" y1="10" x2="15" y2="10" stroke="#444"/><line x1="5" y1="16" x2="15" y2="16" stroke="#444"/><line x1="5" y1="22" x2="15" y2="22" stroke="#444"/><line x1="5" y1="28" x2="15" y2="28" stroke="#444"/><line x1="5" y1="34" x2="15" y2="34" stroke="#444"/><line x1="5" y1="40" x2="15" y2="40" stroke="#444"/>
        <line x1="35" y1="10" x2="45" y2="10" stroke="#444"/><line x1="35" y1="16" x2="45" y2="16" stroke="#444"/><line x1="35" y1="22" x2="45" y2="22" stroke="#444"/><line x1="35" y1="28" x2="45" y2="28" stroke="#444"/><line x1="35" y1="34" x2="45" y2="34" stroke="#444"/><line x1="35" y1="40" x2="45" y2="40" stroke="#444"/>
        <path data-part="hull" d="M14 8 L36 8 L38 12 L38 42 L36 46 L14 46 L12 42 L12 12 Z" fill="#5a5a5a"/><path data-part="turret" d="M17 18 L33 18 L35 22 L33 40 L17 40 L15 22 Z" fill="#6a6a6a"/><path data-part="detail" d="M20 22 L30 22 L28 36 L22 36 Z" fill="#7a7a7a"/><circle data-part="hatches" cx="25" cy="30" r="3" fill="#4a4a4a"/><rect data-part="hatches" x="18" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="hatches" x="28" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" fill="#222"/><line data-part="detail" x1="33" y1="26" x2="36" y2="26" stroke="#8a8a8a"/><line data-part="detail" x1="33" y1="30" x2="36" y2="30" stroke="#8a8a8a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="5" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="35" y="4" width="10" height="42" rx="1" fill="#2a2a2a"/>
        <line x1="5" y1="12" x2="15" y2="12" stroke="#444"/><line x1="5" y1="18" x2="15" y2="18" stroke="#444"/><line x1="5" y1="24" x2="15" y2="24" stroke="#444"/><line x1="5" y1="30" x2="15" y2="30" stroke="#444"/><line x1="5" y1="36" x2="15" y2="36" stroke="#444"/><line x1="5" y1="42" x2="15" y2="42" stroke="#444"/>
        <line x1="35" y1="12" x2="45" y2="12" stroke="#444"/><line x1="35" y1="18" x2="45" y2="18" stroke="#444"/><line x1="35" y1="24" x2="45" y2="24" stroke="#444"/><line x1="35" y1="30" x2="45" y2="30" stroke="#444"/><line x1="35" y1="36" x2="45" y2="36" stroke="#444"/><line x1="35" y1="42" x2="45" y2="42" stroke="#444"/>
        <path data-part="hull" d="M14 8 L36 8 L38 12 L38 42 L36 46 L14 46 L12 42 L12 12 Z" fill="#5a5a5a"/><path data-part="turret" d="M17 18 L33 18 L35 22 L33 40 L17 40 L15 22 Z" fill="#6a6a6a"/><path data-part="detail" d="M20 22 L30 22 L28 36 L22 36 Z" fill="#7a7a7a"/><circle data-part="hatches" cx="25" cy="30" r="3" fill="#4a4a4a"/><rect data-part="hatches" x="18" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="hatches" x="28" y="19" width="4" height="3" rx="0.5" fill="#4a4a4a"/><rect data-part="gun" x="23" y="2" width="4" height="18" rx="0.5" fill="#1a1a1a"/><rect data-part="gun" x="22" y="0" width="6" height="3" fill="#222"/><line data-part="detail" x1="33" y1="26" x2="36" y2="26" stroke="#8a8a8a"/><line data-part="detail" x1="33" y1="30" x2="36" y2="30" stroke="#8a8a8a"/>
      </svg>`
    ],
    unlockCost: { scrap: 300, parts: 15 },
    upgrades: {
      damage: { levels: [75, 95, 120], costs: [0, 200, 400] },
      fireRate: { levels: [1800, 1550, 1300], costs: [0, 225, 450] }
    }
  },

  // === ARTILLERY ===
  {
    id: 'howitzer', name: 'Howitzer',
    types: [UnitType.ARTILLERY],
    damage: 60, fireRate: 2500, deployCooldown: 5500,
    color: '#fb923c',
    sprite: { src: '/sprites/units/howitzer.png', frameCount: 1, frameWidth: 256, frameHeight: 256 },
    parts: ['tracks', 'hull', 'turret', 'gun', 'hatches', 'detail'],
    defaultColors: { tracks: '#2a2a2a', hull: '#5a6a4a', turret: '#6a7a5a', gun: '#1a1a1a', hatches: '#4a5a3a', detail: '#7a8a6a' },
    // Top-down: self-propelled howitzer with long barrel (olive)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <rect data-part="tracks" x="8" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/>
      <rect data-part="tracks" x="34" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/>
      <line x1="8" y1="28" x2="16" y2="28" stroke="#444"/><line x1="8" y1="34" x2="16" y2="34" stroke="#444"/><line x1="8" y1="40" x2="16" y2="40" stroke="#444"/>
      <line x1="34" y1="28" x2="42" y2="28" stroke="#444"/><line x1="34" y1="34" x2="42" y2="34" stroke="#444"/><line x1="34" y1="40" x2="42" y2="40" stroke="#444"/>
      <rect data-part="hull" x="15" y="24" width="20" height="22" rx="2" fill="#5a6a4a"/>
      <rect data-part="turret" x="18" y="18" width="14" height="14" rx="1" fill="#6a7a5a"/>
      <circle data-part="hatches" cx="25" cy="25" r="4" fill="#4a5a3a"/>
      <rect data-part="gun" x="22" y="2" width="6" height="18" rx="1" fill="#1a1a1a"/>
      <ellipse data-part="gun" cx="25" cy="2" rx="4" ry="2" fill="#222"/>
      <line x1="23" y1="6" x2="23" y2="16" stroke="#333"/><line x1="27" y1="6" x2="27" y2="16" stroke="#333"/>
      <rect data-part="hatches" x="20" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/><rect data-part="hatches" x="26" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/>
    </svg>`,
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="8" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="34" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/>
        <line x1="8" y1="26" x2="16" y2="26" stroke="#444"/><line x1="8" y1="32" x2="16" y2="32" stroke="#444"/><line x1="8" y1="38" x2="16" y2="38" stroke="#444"/><line x1="8" y1="44" x2="16" y2="44" stroke="#444"/>
        <line x1="34" y1="26" x2="42" y2="26" stroke="#444"/><line x1="34" y1="32" x2="42" y2="32" stroke="#444"/><line x1="34" y1="38" x2="42" y2="38" stroke="#444"/><line x1="34" y1="44" x2="42" y2="44" stroke="#444"/>
        <rect data-part="hull" x="15" y="24" width="20" height="22" rx="2" fill="#5a6a4a"/><rect data-part="turret" x="18" y="18" width="14" height="14" rx="1" fill="#6a7a5a"/><circle data-part="hatches" cx="25" cy="25" r="4" fill="#4a5a3a"/><rect data-part="gun" x="22" y="2" width="6" height="18" rx="1" fill="#1a1a1a"/><ellipse data-part="gun" cx="25" cy="2" rx="4" ry="2" fill="#222"/><line x1="23" y1="6" x2="23" y2="16" stroke="#333"/><line x1="27" y1="6" x2="27" y2="16" stroke="#333"/><rect data-part="hatches" x="20" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/><rect data-part="hatches" x="26" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="8" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="34" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/>
        <line x1="8" y1="28" x2="16" y2="28" stroke="#444"/><line x1="8" y1="34" x2="16" y2="34" stroke="#444"/><line x1="8" y1="40" x2="16" y2="40" stroke="#444"/>
        <line x1="34" y1="28" x2="42" y2="28" stroke="#444"/><line x1="34" y1="34" x2="42" y2="34" stroke="#444"/><line x1="34" y1="40" x2="42" y2="40" stroke="#444"/>
        <rect data-part="hull" x="15" y="24" width="20" height="22" rx="2" fill="#5a6a4a"/><rect data-part="turret" x="18" y="18" width="14" height="14" rx="1" fill="#6a7a5a"/><circle data-part="hatches" cx="25" cy="25" r="4" fill="#4a5a3a"/><rect data-part="gun" x="22" y="2" width="6" height="18" rx="1" fill="#1a1a1a"/><ellipse data-part="gun" cx="25" cy="2" rx="4" ry="2" fill="#222"/><line x1="23" y1="6" x2="23" y2="16" stroke="#333"/><line x1="27" y1="6" x2="27" y2="16" stroke="#333"/><rect data-part="hatches" x="20" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/><rect data-part="hatches" x="26" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <rect data-part="tracks" x="8" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/><rect data-part="tracks" x="34" y="22" width="8" height="24" rx="1" fill="#2a2a2a"/>
        <line x1="8" y1="30" x2="16" y2="30" stroke="#444"/><line x1="8" y1="36" x2="16" y2="36" stroke="#444"/><line x1="8" y1="42" x2="16" y2="42" stroke="#444"/>
        <line x1="34" y1="30" x2="42" y2="30" stroke="#444"/><line x1="34" y1="36" x2="42" y2="36" stroke="#444"/><line x1="34" y1="42" x2="42" y2="42" stroke="#444"/>
        <rect data-part="hull" x="15" y="24" width="20" height="22" rx="2" fill="#5a6a4a"/><rect data-part="turret" x="18" y="18" width="14" height="14" rx="1" fill="#6a7a5a"/><circle data-part="hatches" cx="25" cy="25" r="4" fill="#4a5a3a"/><rect data-part="gun" x="22" y="2" width="6" height="18" rx="1" fill="#1a1a1a"/><ellipse data-part="gun" cx="25" cy="2" rx="4" ry="2" fill="#222"/><line x1="23" y1="6" x2="23" y2="16" stroke="#333"/><line x1="27" y1="6" x2="27" y2="16" stroke="#333"/><rect data-part="hatches" x="20" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/><rect data-part="hatches" x="26" y="30" width="4" height="3" rx="0.5" fill="#4a5a3a"/>
      </svg>`
    ],
    unlockCost: { scrap: 250, parts: 12 },
    upgrades: {
      damage: { levels: [60, 80, 100], costs: [0, 175, 350] },
      fireRate: { levels: [2500, 2200, 1900], costs: [0, 200, 400] }
    }
  },

  // === AIR ===
  {
    id: 'drone', name: 'Scout Drone',
    types: [UnitType.AIR, UnitType.RECON],
    damage: 8, fireRate: 500, deployCooldown: 2000,
    color: '#94a3b8',
    sprite: { src: '/sprites/units/drone.png', frameCount: 2, frameWidth: 256, frameHeight: 256 },
    parts: ['body', 'camera', 'arms', 'rotors', 'motors', 'detail'],
    defaultColors: { body: '#4a4a4a', camera: '#2a4a6a', arms: '#3a3a3a', rotors: '#5a5a5a', motors: '#2a2a2a', detail: '#6a6a6a' },
    // Top-down: detailed quadcopter with camera pod (tech gray)
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <line data-part="arms" x1="18" y1="21" x2="8" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="21" x2="42" y2="11" stroke="#3a3a3a" stroke-width="2"/>
      <line data-part="arms" x1="18" y1="29" x2="8" y2="39" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="29" x2="42" y2="39" stroke="#3a3a3a" stroke-width="2"/>
      <circle data-part="rotors" cx="8" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="11" r="6" fill="#5a5a5a"/>
      <circle data-part="rotors" cx="8" cy="39" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="39" r="6" fill="#5a5a5a"/>
      <circle data-part="motors" cx="8" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="11" r="2" fill="#2a2a2a"/>
      <circle data-part="motors" cx="8" cy="39" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="39" r="2" fill="#2a2a2a"/>
      <rect data-part="body" x="18" y="18" width="14" height="14" rx="2" fill="#4a4a4a"/>
      <circle data-part="camera" cx="25" cy="25" r="3" fill="#2a4a6a"/>
      <line data-part="detail" x1="22" y1="18" x2="22" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="18" x2="28" y2="14" stroke="#6a6a6a"/>
      <line data-part="detail" x1="22" y1="32" x2="22" y2="36" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="32" x2="28" y2="36" stroke="#6a6a6a"/>
    </svg>`,
    // Rotor spin animation - blades rotate
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="arms" x1="18" y1="21" x2="8" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="21" x2="42" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="18" y1="29" x2="8" y2="39" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="29" x2="42" y2="39" stroke="#3a3a3a" stroke-width="2"/>
        <circle data-part="rotors" cx="8" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="8" cy="39" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="39" r="6" fill="#5a5a5a"/>
        <line x1="4" y1="11" x2="12" y2="11" stroke="#888" stroke-width="2"/><line x1="38" y1="11" x2="46" y2="11" stroke="#888" stroke-width="2"/><line x1="4" y1="39" x2="12" y2="39" stroke="#888" stroke-width="2"/><line x1="38" y1="39" x2="46" y2="39" stroke="#888" stroke-width="2"/>
        <circle data-part="motors" cx="8" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="8" cy="39" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="39" r="2" fill="#2a2a2a"/>
        <rect data-part="body" x="18" y="18" width="14" height="14" rx="2" fill="#4a4a4a"/><circle data-part="camera" cx="25" cy="25" r="3" fill="#2a4a6a"/>
        <line data-part="detail" x1="22" y1="18" x2="22" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="18" x2="28" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="22" y1="32" x2="22" y2="36" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="32" x2="28" y2="36" stroke="#6a6a6a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="arms" x1="18" y1="21" x2="8" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="21" x2="42" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="18" y1="29" x2="8" y2="39" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="29" x2="42" y2="39" stroke="#3a3a3a" stroke-width="2"/>
        <circle data-part="rotors" cx="8" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="8" cy="39" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="39" r="6" fill="#5a5a5a"/>
        <line x1="8" y1="7" x2="8" y2="15" stroke="#888" stroke-width="2"/><line x1="42" y1="7" x2="42" y2="15" stroke="#888" stroke-width="2"/><line x1="8" y1="35" x2="8" y2="43" stroke="#888" stroke-width="2"/><line x1="42" y1="35" x2="42" y2="43" stroke="#888" stroke-width="2"/>
        <circle data-part="motors" cx="8" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="8" cy="39" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="39" r="2" fill="#2a2a2a"/>
        <rect data-part="body" x="18" y="18" width="14" height="14" rx="2" fill="#4a4a4a"/><circle data-part="camera" cx="25" cy="25" r="3" fill="#2a4a6a"/>
        <line data-part="detail" x1="22" y1="18" x2="22" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="18" x2="28" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="22" y1="32" x2="22" y2="36" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="32" x2="28" y2="36" stroke="#6a6a6a"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="arms" x1="18" y1="21" x2="8" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="21" x2="42" y2="11" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="18" y1="29" x2="8" y2="39" stroke="#3a3a3a" stroke-width="2"/><line data-part="arms" x1="32" y1="29" x2="42" y2="39" stroke="#3a3a3a" stroke-width="2"/>
        <circle data-part="rotors" cx="8" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="11" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="8" cy="39" r="6" fill="#5a5a5a"/><circle data-part="rotors" cx="42" cy="39" r="6" fill="#5a5a5a"/>
        <line x1="4" y1="7" x2="12" y2="15" stroke="#888" stroke-width="2"/><line x1="38" y1="7" x2="46" y2="15" stroke="#888" stroke-width="2"/><line x1="4" y1="43" x2="12" y2="35" stroke="#888" stroke-width="2"/><line x1="38" y1="43" x2="46" y2="35" stroke="#888" stroke-width="2"/>
        <circle data-part="motors" cx="8" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="11" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="8" cy="39" r="2" fill="#2a2a2a"/><circle data-part="motors" cx="42" cy="39" r="2" fill="#2a2a2a"/>
        <rect data-part="body" x="18" y="18" width="14" height="14" rx="2" fill="#4a4a4a"/><circle data-part="camera" cx="25" cy="25" r="3" fill="#2a4a6a"/>
        <line data-part="detail" x1="22" y1="18" x2="22" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="18" x2="28" y2="14" stroke="#6a6a6a"/><line data-part="detail" x1="22" y1="32" x2="22" y2="36" stroke="#6a6a6a"/><line data-part="detail" x1="28" y1="32" x2="28" y2="36" stroke="#6a6a6a"/>
      </svg>`
    ],
    unlockCost: { scrap: 200, parts: 10 },
    upgrades: {
      damage: { levels: [8, 12, 16], costs: [0, 80, 160] },
      fireRate: { levels: [500, 400, 300], costs: [0, 100, 200] }
    }
  },
  {
    id: 'apache', name: 'Apache',
    types: [UnitType.AIR],
    damage: 45, fireRate: 900, deployCooldown: 5000,
    color: '#7c3aed',
    sprite: { src: '/sprites/units/apache.png', frameCount: 2, frameWidth: 256, frameHeight: 256 },
    parts: ['body', 'cockpit', 'wings', 'weapons', 'rotor', 'tail'],
    defaultColors: { body: '#3a4a2a', cockpit: '#2a4a5a', wings: '#4a5a3a', weapons: '#1a1a1a', rotor: '#5a5a5a', tail: '#3a4a2a' },
    // Top-down: detailed Apache with rotor, stub wings, weapons (military olive) - narrow fuselage
    svg: `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
      <line data-part="wings" x1="8" y1="24" x2="18" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="24" x2="42" y2="24" stroke="#4a5a3a" stroke-width="2"/>
      <line data-part="wings" x1="8" y1="28" x2="18" y2="28" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="28" x2="42" y2="28" stroke="#4a5a3a" stroke-width="2"/>
      <rect data-part="weapons" x="5" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><rect data-part="weapons" x="41" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/>
      <circle data-part="weapons" cx="7" cy="26" r="1.5" fill="#2a2a2a"/><circle data-part="weapons" cx="43" cy="26" r="1.5" fill="#2a2a2a"/>
      <rect data-part="tail" x="23" y="38" width="4" height="10" fill="#3a4a2a"/>
      <line data-part="tail" x1="20" y1="46" x2="30" y2="46" stroke="#4a5a3a" stroke-width="2"/>
      <rect data-part="body" x="20" y="14" width="10" height="26" rx="2" fill="#3a4a2a"/>
      <path data-part="body" d="M25 12 L20 18 L30 18 Z" fill="#4a5a3a"/>
      <rect data-part="cockpit" x="22" y="18" width="6" height="10" rx="1" fill="#2a4a5a"/>
      <circle data-part="rotor" cx="25" cy="22" r="11" fill="none" stroke="#5a5a5a" stroke-dasharray="4 2"/>
      <line data-part="rotor" x1="25" y1="11" x2="25" y2="33" stroke="#6a6a6a"/>
    </svg>`,
    // Main rotor spin animation - blades rotate
    svgFrames: [
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="wings" x1="8" y1="24" x2="18" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="24" x2="42" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="8" y1="28" x2="18" y2="28" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="28" x2="42" y2="28" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="weapons" x="5" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><rect data-part="weapons" x="41" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><circle data-part="weapons" cx="7" cy="26" r="1.5" fill="#2a2a2a"/><circle data-part="weapons" cx="43" cy="26" r="1.5" fill="#2a2a2a"/>
        <rect data-part="tail" x="23" y="38" width="4" height="10" fill="#3a4a2a"/><line data-part="tail" x1="20" y1="46" x2="30" y2="46" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="body" x="20" y="14" width="10" height="26" rx="2" fill="#3a4a2a"/><path data-part="body" d="M25 12 L20 18 L30 18 Z" fill="#4a5a3a"/><rect data-part="cockpit" x="22" y="18" width="6" height="10" rx="1" fill="#2a4a5a"/>
        <line data-part="rotor" x1="14" y1="22" x2="36" y2="22" stroke="#6a6a6a" stroke-width="2"/><line data-part="rotor" x1="25" y1="11" x2="25" y2="33" stroke="#6a6a6a" stroke-width="2"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="wings" x1="8" y1="24" x2="18" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="24" x2="42" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="8" y1="28" x2="18" y2="28" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="28" x2="42" y2="28" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="weapons" x="5" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><rect data-part="weapons" x="41" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><circle data-part="weapons" cx="7" cy="26" r="1.5" fill="#2a2a2a"/><circle data-part="weapons" cx="43" cy="26" r="1.5" fill="#2a2a2a"/>
        <rect data-part="tail" x="23" y="38" width="4" height="10" fill="#3a4a2a"/><line data-part="tail" x1="20" y1="46" x2="30" y2="46" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="body" x="20" y="14" width="10" height="26" rx="2" fill="#3a4a2a"/><path data-part="body" d="M25 12 L20 18 L30 18 Z" fill="#4a5a3a"/><rect data-part="cockpit" x="22" y="18" width="6" height="10" rx="1" fill="#2a4a5a"/>
        <line data-part="rotor" x1="17" y1="14" x2="33" y2="30" stroke="#6a6a6a" stroke-width="2"/><line data-part="rotor" x1="17" y1="30" x2="33" y2="14" stroke="#6a6a6a" stroke-width="2"/>
      </svg>`,
      `<svg viewBox="0 0 50 50" fill="none" stroke="#111" stroke-width="1">
        <line data-part="wings" x1="8" y1="24" x2="18" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="24" x2="42" y2="24" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="8" y1="28" x2="18" y2="28" stroke="#4a5a3a" stroke-width="2"/><line data-part="wings" x1="32" y1="28" x2="42" y2="28" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="weapons" x="5" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><rect data-part="weapons" x="41" y="22" width="4" height="8" rx="0.5" fill="#1a1a1a"/><circle data-part="weapons" cx="7" cy="26" r="1.5" fill="#2a2a2a"/><circle data-part="weapons" cx="43" cy="26" r="1.5" fill="#2a2a2a"/>
        <rect data-part="tail" x="23" y="38" width="4" height="10" fill="#3a4a2a"/><line data-part="tail" x1="20" y1="46" x2="30" y2="46" stroke="#4a5a3a" stroke-width="2"/>
        <rect data-part="body" x="20" y="14" width="10" height="26" rx="2" fill="#3a4a2a"/><path data-part="body" d="M25 12 L20 18 L30 18 Z" fill="#4a5a3a"/><rect data-part="cockpit" x="22" y="18" width="6" height="10" rx="1" fill="#2a4a5a"/>
        <line data-part="rotor" x1="25" y1="11" x2="25" y2="33" stroke="#6a6a6a" stroke-width="2"/><line data-part="rotor" x1="14" y1="22" x2="36" y2="22" stroke="#6a6a6a" stroke-width="2"/>
      </svg>`
    ],
    unlockCost: { scrap: 400, parts: 20 },
    upgrades: {
      damage: { levels: [45, 60, 80], costs: [0, 250, 500] },
      fireRate: { levels: [900, 750, 600], costs: [0, 275, 550] }
    }
  }
];

export const ENEMIES = [
  { id: 'swarmer', unitId: 'infantry', health: 15, speed: 2.2, damage: 5, scrap: 2, partsChance: 0, range: 150, isAir: false, types: ['infantry'] },
  { id: 'scout', unitId: 'jeep', health: 30, speed: 1.8, damage: 10, scrap: 5, partsChance: 0, range: 300, isAir: false, types: ['recon'] },
  { id: 'grunt', unitId: 'infantry', health: 60, speed: 1.3, damage: 15, scrap: 10, partsChance: 0.1, range: 350, isAir: false, types: ['infantry'] },
  { id: 'heavy', unitId: 'sherman', health: 120, speed: 0.9, damage: 25, scrap: 20, partsChance: 0.25, range: 450, isAir: false, types: ['armor'] },
  { id: 'elite', unitId: 'tiger', health: 200, speed: 1.1, damage: 40, scrap: 50, partsChance: 0.5, range: 550, isAir: false, types: ['armor', 'anti_armor'] }
];

// Terrain SVG definitions for battle rendering (must match ui.js planning SVGs)
export const TERRAIN_SVGS = {
  open: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-open-svg">
    <rect width="32" height="32" fill="#5a5045"/>
    <circle cx="6" cy="8" r="1.5" fill="#4a4035" opacity="0.5"/>
    <circle cx="20" cy="6" r="1" fill="#6a6055" opacity="0.4"/>
    <circle cx="28" cy="14" r="1.5" fill="#4a4035" opacity="0.5"/>
    <circle cx="10" cy="22" r="1" fill="#6a6055" opacity="0.4"/>
    <circle cx="24" cy="26" r="1.5" fill="#4a4035" opacity="0.5"/>
    <circle cx="16" cy="16" r="1" fill="#4a4035" opacity="0.3"/>
  </svg>`,

  grass: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-grass-svg">
    <rect width="32" height="32" fill="#4a6a3a"/>
    <ellipse cx="6" cy="8" rx="3" ry="2" fill="#5a7a4a" opacity="0.6"/>
    <ellipse cx="26" cy="10" rx="3" ry="2" fill="#5a8a4a" opacity="0.5"/>
    <ellipse cx="8" cy="20" rx="2.5" ry="2" fill="#4a7040" opacity="0.6"/>
    <ellipse cx="28" cy="24" rx="2.5" ry="2" fill="#5a8050" opacity="0.5"/>
    <ellipse cx="16" cy="26" rx="3" ry="2" fill="#5a7a4a" opacity="0.6"/>
    <ellipse cx="20" cy="14" rx="2" ry="1.5" fill="#3a6030" opacity="0.5"/>
  </svg>`,

  brush: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-brush-svg">
    <defs>
      <radialGradient id="bush" cx="50%" cy="50%" fx="45%" fy="40%" r="50%">
        <stop offset="0%" stop-color="#5a8a48"/>
        <stop offset="40%" stop-color="#4a7a38"/>
        <stop offset="70%" stop-color="#3a6a2a"/>
        <stop offset="100%" stop-color="#2a5a1a"/>
      </radialGradient>
    </defs>
    <rect width="32" height="32" fill="#2a4a1a"/>
    <ellipse cx="3" cy="5" rx="11" ry="10" fill="url(#bush)"/>
    <ellipse cx="28" cy="6" rx="12" ry="11" fill="url(#bush)"/>
    <ellipse cx="32" cy="24" rx="11" ry="13" fill="url(#bush)"/>
    <ellipse cx="6" cy="30" rx="13" ry="11" fill="url(#bush)"/>
    <ellipse cx="-3" cy="16" rx="10" ry="12" fill="url(#bush)"/>
    <ellipse cx="16" cy="3" rx="9" ry="8" fill="url(#bush)"/>
    <ellipse cx="30" cy="15" rx="10" ry="9" fill="url(#bush)"/>
    <ellipse cx="18" cy="30" rx="11" ry="9" fill="url(#bush)"/>
    <ellipse cx="2" cy="22" rx="9" ry="10" fill="url(#bush)"/>
    <ellipse cx="12" cy="10" rx="8" ry="7" fill="url(#bush)"/>
    <ellipse cx="22" cy="11" rx="7" ry="8" fill="url(#bush)"/>
    <ellipse cx="24" cy="22" rx="9" ry="8" fill="url(#bush)"/>
    <ellipse cx="10" cy="20" rx="8" ry="7" fill="url(#bush)"/>
    <ellipse cx="16" cy="16" rx="7" ry="6" fill="url(#bush)"/>
    <ellipse cx="9" cy="8" rx="4" ry="3" fill="#5a9a52" opacity="0.6"/>
    <ellipse cx="24" cy="9" rx="3" ry="4" fill="#6aaa62" opacity="0.5"/>
    <ellipse cx="22" cy="24" rx="4" ry="3" fill="#5a9a52" opacity="0.5"/>
    <ellipse cx="8" cy="22" rx="3" ry="3" fill="#6aaa62" opacity="0.4"/>
  </svg>`,

  forest: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-forest-svg">
    <defs>
      <radialGradient id="canopy" cx="50%" cy="50%" fx="45%" fy="40%" r="50%">
        <stop offset="0%" stop-color="#4a7a42"/>
        <stop offset="40%" stop-color="#3a6a32"/>
        <stop offset="70%" stop-color="#2a5a25"/>
        <stop offset="100%" stop-color="#1e4a18"/>
      </radialGradient>
    </defs>
    <rect width="32" height="32" fill="#1e3a18"/>
    <ellipse cx="5" cy="7" rx="12" ry="11" fill="url(#canopy)"/>
    <ellipse cx="26" cy="4" rx="14" ry="12" fill="url(#canopy)"/>
    <ellipse cx="30" cy="22" rx="13" ry="14" fill="url(#canopy)"/>
    <ellipse cx="8" cy="28" rx="15" ry="12" fill="url(#canopy)"/>
    <ellipse cx="-2" cy="18" rx="11" ry="13" fill="url(#canopy)"/>
    <ellipse cx="14" cy="5" rx="10" ry="9" fill="url(#canopy)"/>
    <ellipse cx="28" cy="14" rx="11" ry="10" fill="url(#canopy)"/>
    <ellipse cx="20" cy="28" rx="12" ry="10" fill="url(#canopy)"/>
    <ellipse cx="3" cy="24" rx="10" ry="11" fill="url(#canopy)"/>
    <ellipse cx="10" cy="12" rx="9" ry="8" fill="url(#canopy)"/>
    <ellipse cx="24" cy="9" rx="8" ry="9" fill="url(#canopy)"/>
    <ellipse cx="22" cy="21" rx="10" ry="9" fill="url(#canopy)"/>
    <ellipse cx="9" cy="19" rx="9" ry="8" fill="url(#canopy)"/>
    <ellipse cx="17" cy="15" rx="8" ry="7" fill="url(#canopy)"/>
    <ellipse cx="7" cy="10" rx="5" ry="4" fill="#4a8a42" opacity="0.6"/>
    <ellipse cx="23" cy="7" rx="4" ry="5" fill="#5a9a52" opacity="0.5"/>
    <ellipse cx="25" cy="23" rx="5" ry="4" fill="#4a8a42" opacity="0.5"/>
    <ellipse cx="11" cy="24" rx="4" ry="4" fill="#5a9a52" opacity="0.4"/>
    <ellipse cx="18" cy="13" rx="4" ry="3" fill="#5a9a52" opacity="0.5"/>
  </svg>`,

  high: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-high-svg">
    <defs>
      <linearGradient id="rock" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#3a2a1a"/>
        <stop offset="50%" stop-color="#5a4a3a"/>
        <stop offset="100%" stop-color="#7a6a58"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="#5a4a3a"/>
    <ellipse cx="5" cy="7" rx="12" ry="11" fill="url(#rock)"/>
    <ellipse cx="26" cy="4" rx="14" ry="12" fill="url(#rock)"/>
    <ellipse cx="30" cy="22" rx="13" ry="14" fill="url(#rock)"/>
    <ellipse cx="8" cy="28" rx="15" ry="12" fill="url(#rock)"/>
    <ellipse cx="-2" cy="18" rx="11" ry="13" fill="url(#rock)"/>
    <ellipse cx="14" cy="5" rx="10" ry="9" fill="url(#rock)"/>
    <ellipse cx="20" cy="26" rx="11" ry="10" fill="url(#rock)"/>
    <ellipse cx="2" cy="12" rx="9" ry="8" fill="url(#rock)"/>
    <ellipse cx="28" cy="14" rx="10" ry="9" fill="url(#rock)"/>
    <ellipse cx="16" cy="16" rx="12" ry="10" fill="url(#rock)"/>
    <ellipse cx="6" cy="22" rx="9" ry="8" fill="url(#rock)"/>
    <ellipse cx="24" cy="8" rx="8" ry="7" fill="url(#rock)"/>
    <ellipse cx="7" cy="10" rx="5" ry="4" fill="#6a5a48" opacity="0.5"/>
    <ellipse cx="22" cy="6" rx="4" ry="3" fill="#7a6a58" opacity="0.5"/>
    <ellipse cx="25" cy="20" rx="5" ry="4" fill="#6a5a48" opacity="0.5"/>
    <ellipse cx="11" cy="24" rx="4" ry="4" fill="#7a6a58" opacity="0.4"/>
    <ellipse cx="18" cy="13" rx="4" ry="3" fill="#6a5a48" opacity="0.5"/>
  </svg>`,

  water: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-water-svg">
    <defs>
      <linearGradient id="water" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2a5a75"/>
        <stop offset="50%" stop-color="#1a4a65"/>
        <stop offset="100%" stop-color="#2a5a75"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="url(#water)"/>
    <ellipse cx="10" cy="10" rx="4" ry="2" fill="#3a6a85" opacity="0.3"/>
    <ellipse cx="24" cy="22" rx="5" ry="2" fill="#3a6a85" opacity="0.25"/>
  </svg>`,

  trench: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-trench-svg">
    <defs>
      <linearGradient id="trenchWall" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#5a4a35"/>
        <stop offset="100%" stop-color="#3a2a1a"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="#6a5a45"/>
    <rect x="0" y="10" width="32" height="12" fill="#2a1a0a"/>
    <rect x="0" y="14" width="32" height="4" fill="#4a3a25"/>
    <line x1="4" y1="14" x2="4" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
    <line x1="10" y1="14" x2="10" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
    <line x1="16" y1="14" x2="16" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
    <line x1="22" y1="14" x2="22" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
    <line x1="28" y1="14" x2="28" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
    <ellipse cx="3" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="10" cy="9" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="17" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="24" cy="9" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="31" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="1" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="8" cy="23" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="15" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="22" cy="23" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <ellipse cx="29" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
    <rect x="0" y="10" width="3" height="12" fill="#5a4a35"/>
    <ellipse cx="2" cy="12" rx="2" ry="1.5" fill="url(#trenchWall)"/>
    <ellipse cx="2" cy="16" rx="2" ry="1.5" fill="url(#trenchWall)"/>
    <ellipse cx="2" cy="20" rx="2" ry="1.5" fill="url(#trenchWall)"/>
    <rect x="29" y="10" width="3" height="12" fill="#5a4a35"/>
    <ellipse cx="30" cy="12" rx="2" ry="1.5" fill="url(#trenchWall)"/>
    <ellipse cx="30" cy="16" rx="2" ry="1.5" fill="url(#trenchWall)"/>
    <ellipse cx="30" cy="20" rx="2" ry="1.5" fill="url(#trenchWall)"/>
  </svg>`,

  pillbox: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-pillbox-svg">
    <defs>
      <linearGradient id="concreteTop" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#6a6a6a"/>
        <stop offset="100%" stop-color="#8a8a8a"/>
      </linearGradient>
      <linearGradient id="concreteSide" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#5a5a5a"/>
        <stop offset="100%" stop-color="#3a3a3a"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="#8a7a65"/>
    <ellipse cx="10" cy="28" rx="3" ry="2" fill="#5a4a35"/>
    <ellipse cx="22" cy="28" rx="3" ry="2" fill="#5a4a35"/>
    <ellipse cx="6" cy="22" rx="2" ry="3" fill="#5a4a35"/>
    <ellipse cx="26" cy="22" rx="2" ry="3" fill="#5a4a35"/>
    <polygon points="8,26 24,26 24,12 20,8 16,4 12,8 8,12" fill="#2a2a2a" opacity="0.3" transform="translate(1,1)"/>
    <polygon points="8,26 24,26 24,12 8,12" fill="url(#concreteSide)"/>
    <polygon points="8,12 12,8 16,4 20,8 24,12" fill="url(#concreteSide)"/>
    <polygon points="8,24 24,24 24,12 20,8 16,4 12,8 8,12" fill="url(#concreteTop)" opacity="0.5"/>
    <polygon points="10,22 22,22 22,14 19,10 16,7 13,10 10,14" fill="#7a7a7a"/>
    <rect x="14" y="4" width="4" height="3" fill="#1a1a1a"/>
    <rect x="9" y="8" width="3" height="2" fill="#1a1a1a" transform="rotate(-30 10.5 9)"/>
    <rect x="20" y="8" width="3" height="2" fill="#1a1a1a" transform="rotate(30 21.5 9)"/>
  </svg>`,

  pillboxSouth: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-pillbox-svg">
    <defs>
      <linearGradient id="concreteTopS" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#6a6a6a"/>
        <stop offset="100%" stop-color="#8a8a8a"/>
      </linearGradient>
      <linearGradient id="concreteSideS" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#3a3a3a"/>
        <stop offset="100%" stop-color="#5a5a5a"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="#8a7a65"/>
    <ellipse cx="10" cy="4" rx="3" ry="2" fill="#5a4a35"/>
    <ellipse cx="22" cy="4" rx="3" ry="2" fill="#5a4a35"/>
    <ellipse cx="6" cy="10" rx="2" ry="3" fill="#5a4a35"/>
    <ellipse cx="26" cy="10" rx="2" ry="3" fill="#5a4a35"/>
    <polygon points="8,6 24,6 24,20 20,24 16,28 12,24 8,20" fill="#2a2a2a" opacity="0.3" transform="translate(1,1)"/>
    <polygon points="8,6 24,6 24,20 8,20" fill="url(#concreteSideS)"/>
    <polygon points="8,20 12,24 16,28 20,24 24,20" fill="url(#concreteSideS)"/>
    <polygon points="8,8 24,8 24,20 20,24 16,28 12,24 8,20" fill="url(#concreteTopS)" opacity="0.5"/>
    <polygon points="10,10 22,10 22,18 19,22 16,25 13,22 10,18" fill="#7a7a7a"/>
    <rect x="14" y="25" width="4" height="3" fill="#1a1a1a"/>
    <rect x="9" y="22" width="3" height="2" fill="#1a1a1a" transform="rotate(30 10.5 23)"/>
    <rect x="20" y="22" width="3" height="2" fill="#1a1a1a" transform="rotate(-30 21.5 23)"/>
  </svg>`
};

// Get terrain SVG for a specific type and position
export function getTerrainSVG(terrainType, row, gridHeight) {
  if (terrainType === 'pillbox') {
    const midRow = Math.floor(gridHeight / 2);
    return row < midRow ? TERRAIN_SVGS.pillboxSouth : TERRAIN_SVGS.pillbox;
  }
  return TERRAIN_SVGS[terrainType] || TERRAIN_SVGS.open;
}

// ═══════════════════════════════════════════════════════════════
// SHADOW SYSTEM
// ═══════════════════════════════════════════════════════════════

export const SHADOW_CONFIG = {
  enabled: true,
  // Sun angle in degrees (0 = directly overhead, 45 = afternoon)
  sunAngle: 35,
  // Sun direction in degrees (0 = from east, 90 = from south, 180 = from west)
  sunDirection: 135,
  // Shadow opacity (0-1)
  opacity: 0.25,
  // Shadow scale Y (vertical squish, 0.3 = 30% height)
  scaleY: 0.4,
  // Shadow blur in pixels
  blur: 2
};

// ═══════════════════════════════════════════════════════════════
// ENDLESS MODE VEHICLES
// ═══════════════════════════════════════════════════════════════

export const VEHICLE_CATEGORIES = [
  { id: 'all', name: 'All', icon: '★' },
  { id: 'infantry', name: 'Infantry', icon: '🪖' },
  { id: 'wwii', name: 'WWII', icon: '⭐' },
  { id: 'modern', name: 'Modern', icon: '🛡️' },
  { id: 'recon', name: 'Recon', icon: '👁️' },
  { id: 'heavy', name: 'Heavy', icon: '💪' },
  { id: 'favorites', name: 'Favs', icon: '❤️' },
];

export const ENDLESS_VEHICLES = [
  // Infantry (deploy as a soldier)
  { id: 'infantry', name: 'Rifleman', icon: '🪖', category: 'infantry',
    desc: 'Standard soldier. Start here, build your army.',
    stats: { dmg: 6, spd: 5, arm: 5 },
    variants: [],
    unlocked: true },
  { id: 'specops', name: 'Spec Ops', icon: '🎯', category: 'infantry',
    desc: 'Elite marksman. Longer range, higher accuracy.',
    stats: { dmg: 12, spd: 6, arm: 5 },
    variants: [],
    unlocked: false, unlockReq: 'Reach wave 5 as infantry' },

  // WWII Era
  { id: 'sherman', name: 'M4 Sherman', icon: '⭐', category: 'wwii',
    desc: 'WWII workhorse. Balanced all-rounder.',
    stats: { dmg: 35, spd: 5, arm: 50 },
    variants: ['olive', 'desert', 'winter'],
    unlocked: true },
  { id: 'tiger', name: 'Tiger I', icon: '🐯', category: 'wwii',
    desc: 'German heavy. Fear the 88mm.',
    stats: { dmg: 50, spd: 2, arm: 80 },
    variants: ['grey', 'desert'],
    unlocked: false, unlockReq: 'Reach wave 20' },
  { id: 'panzer4', name: 'Panzer IV', icon: '✠', category: 'wwii',
    desc: 'Versatile German medium tank.',
    stats: { dmg: 40, spd: 4, arm: 55 },
    variants: ['grey', 'desert'],
    unlocked: false, unlockReq: 'Reach wave 10' },
  { id: 't34', name: 'T-34', icon: '☭', category: 'wwii',
    desc: 'Soviet reliability. Sloped armor.',
    stats: { dmg: 38, spd: 6, arm: 60 },
    variants: ['green', 'winter'],
    unlocked: true },
  { id: 'pershing', name: 'M26 Pershing', icon: '🦅', category: 'wwii',
    desc: 'American heavy. Late war beast.',
    stats: { dmg: 55, spd: 3, arm: 75 },
    variants: ['olive', 'winter'],
    unlocked: false, unlockReq: 'Complete 5 runs' },

  // Modern Era
  { id: 'abrams', name: 'M1 Abrams', icon: '🛡️', category: 'modern',
    desc: 'Modern MBT. Heavy armor, high damage.',
    stats: { dmg: 75, spd: 4, arm: 90 },
    variants: ['default'],
    unlocked: true },
  { id: 'leopard', name: 'Leopard 2', icon: '🐆', category: 'modern',
    desc: 'German precision. Best-in-class accuracy.',
    stats: { dmg: 70, spd: 5, arm: 85 },
    variants: ['green', 'desert'],
    unlocked: false, unlockReq: 'Reach wave 15' },
  { id: 'challenger', name: 'Challenger 2', icon: '🦁', category: 'modern',
    desc: 'British fortress. Exceptional armor.',
    stats: { dmg: 65, spd: 3, arm: 95 },
    variants: ['desert', 'green'],
    unlocked: false, unlockReq: 'Exit at wave 25+' },
  { id: 't90', name: 'T-90', icon: '🔴', category: 'modern',
    desc: 'Russian modern. Explosive reactive armor.',
    stats: { dmg: 68, spd: 5, arm: 80 },
    variants: ['green', 'desert'],
    unlocked: false, unlockReq: 'Reach wave 30' },

  // Recon
  { id: 'jeep', name: 'Willys Jeep', icon: '🚙', category: 'recon',
    desc: 'Fast recon. Hit and run tactics.',
    stats: { dmg: 15, spd: 9, arm: 10 },
    variants: ['olive', 'desert'],
    unlocked: true },
  { id: 'humvee', name: 'Humvee', icon: '🚗', category: 'recon',
    desc: 'Modern utility. Versatile platform.',
    stats: { dmg: 20, spd: 8, arm: 20 },
    variants: ['desert', 'woodland'],
    unlocked: true },
  { id: 'brdm', name: 'BRDM-2', icon: '🔍', category: 'recon',
    desc: 'Soviet scout. Amphibious capability.',
    stats: { dmg: 18, spd: 7, arm: 25 },
    variants: ['green', 'desert'],
    unlocked: false, unlockReq: 'Scout 100 enemies' },
  { id: 'fennek', name: 'Fennek', icon: '🦊', category: 'recon',
    desc: 'German recon. Advanced sensors.',
    stats: { dmg: 22, spd: 8, arm: 30 },
    variants: ['green', 'desert'],
    unlocked: false, unlockReq: 'Exit 10 runs' },

  // Heavy
  { id: 'maus', name: 'Panzer VIII Maus', icon: '🐘', category: 'heavy',
    desc: 'Super-heavy. Slow but devastating.',
    stats: { dmg: 90, spd: 1, arm: 100 },
    variants: ['grey'],
    unlocked: false, unlockReq: 'Reach wave 50' },
  { id: 'tog2', name: 'TOG II', icon: '🚂', category: 'heavy',
    desc: 'British landship. Meme machine.',
    stats: { dmg: 45, spd: 1, arm: 70 },
    variants: ['green'],
    unlocked: false, unlockReq: 'Secret unlock' },
  { id: 'kv2', name: 'KV-2', icon: '🗼', category: 'heavy',
    desc: 'Soviet derp gun. 152mm of fun.',
    stats: { dmg: 85, spd: 2, arm: 65 },
    variants: ['green', 'winter'],
    unlocked: false, unlockReq: '500 total kills' },
];

// ═══════════════════════════════════════════════════════════════
// PART SYSTEM - Equipment Bay configuration
// ═══════════════════════════════════════════════════════════════

// Part category display config (icon + display name per category)
// Categories come from variant data - this just provides display metadata
export const PART_CATEGORY_CONFIG = {
  // Tanks
  hull: { name: 'Hull', icon: '▣' },
  turret: { name: 'Turret', icon: '◎' },
  cannon: { name: 'Cannon', icon: '║' },
  gun: { name: 'M. Gun', icon: '┃' },
  tracks: { name: 'Tracks', icon: '⊟' },
  // Infantry
  body: { name: 'Body', icon: '◉' },
  helmet: { name: 'Helmet', icon: '⌓' },
  weapon: { name: 'Weapon', icon: '╱' },
  boots: { name: 'Boots', icon: '⌐' },
  equipment: { name: 'Gear', icon: '▢' },
  // Vehicles
  chassis: { name: 'Chassis', icon: '▣' },
  wheels: { name: 'Wheels', icon: '◯' },
  // Aircraft
  fuselage: { name: 'Fuselage', icon: '◇' },
  rotor: { name: 'Rotor', icon: '✕' },
  tail: { name: 'Tail', icon: '◁' },
  // Generic fallback
  details: { name: 'Details', icon: '◈' },
  default: { name: 'Part', icon: '◆' }
};

// Expected part slots per unit type - defines ALL slots a unit can have
// Used as fallback when variant data isn't loaded, and to show empty slots
export const UNIT_PART_SLOTS = {
  // Tanks (MBTs)
  tank: ['hull', 'turret', 'cannon', 'gun'],
  // Light vehicles
  vehicle: ['chassis', 'wheels', 'turret', 'gun'],
  // Infantry
  infantry: ['body', 'helmet', 'weapon', 'equipment'],
  // Aircraft
  helicopter: ['fuselage', 'rotor', 'tail', 'weapon'],
  // Artillery
  artillery: ['hull', 'cannon', 'wheels'],
  // Default fallback
  default: ['hull', 'turret', 'cannon']
};

// Map unit IDs to their unit type for part slot lookup
export const UNIT_TYPE_MAP = {
  // Tanks
  abrams: 'tank',
  sherman: 'tank',
  tiger: 'tank',
  panzer4: 'tank',
  t34: 'tank',
  pershing: 'tank',
  leopard: 'tank',
  challenger: 'tank',
  t90: 'tank',
  merkava: 'tank',
  kv2: 'tank',
  // Light vehicles
  jeep: 'vehicle',
  humvee: 'vehicle',
  // Infantry
  infantry: 'infantry',
  medic: 'infantry',
  specops: 'infantry',
  stinger: 'infantry',
  // Aircraft
  helicopter: 'helicopter',
  drone: 'helicopter',
  // Artillery
  howitzer: 'artillery'
};

// System definitions - derived from unit parts via appliesTo
// '*' means universal (applies to all units)
export const SYSTEM_DEFINITIONS = {
  optics: {
    name: 'Optics',
    icon: '🔭',
    desc: 'Targeting and vision systems',
    appliesTo: ['turret', 'cannon', 'weapon', 'launcher']
  },
  ammo: {
    name: 'Ammo',
    icon: '💥',
    desc: 'Ammunition type',
    appliesTo: ['cannon', 'gun', 'weapon', 'launcher']
  },
  engine: {
    name: 'Engine',
    icon: '⚙️',
    desc: 'Power and propulsion',
    appliesTo: ['hull', 'chassis', 'fuselage', 'body']
  },
  comms: {
    name: 'Comms',
    icon: '📡',
    desc: 'Communications equipment',
    appliesTo: ['*']  // universal
  },
  fuel: {
    name: 'Fuel',
    icon: '⛽',
    desc: 'Fuel reserves',
    appliesTo: ['hull', 'chassis', 'fuselage']
  },
  armor: {
    name: 'Armor',
    icon: '🛡️',
    desc: 'Additional protection',
    appliesTo: ['hull', 'chassis', 'body', 'turret']
  },
  medkit: {
    name: 'Medkit',
    icon: '🩹',
    desc: 'Medical supplies',
    appliesTo: ['body', 'equipment']
  },
  countermeasures: {
    name: 'ECM',
    icon: '📶',
    desc: 'Electronic countermeasures',
    appliesTo: ['turret', 'fuselage', 'rotor']
  }
};

// ═══════════════════════════════════════════════════════════════
// CREW SYSTEM
// ═══════════════════════════════════════════════════════════════

// Crew slot definitions per vehicle type
export const CREW_SCHEMAS = {
  jeep:     ['tc', 'driver', 'gunner'],
  humvee:   ['tc', 'driver', 'gunner'],
  sherman:  ['tc', 'gunner', 'driver'],
  tiger:    ['tc', 'gunner', 'driver'],
  abrams:   ['tc', 'gunner', 'driver'],
  howitzer: ['tc', 'gunner'],
  infantry: ['self'],
  medic:    ['self'],
  specops:  ['self'],
  stinger:  ['self']
};

// Rank progression table — MMR-style cumulative score system (Rocket League model)
// mmr: score threshold to reach this rank. Score moves up/down each battle.
// CPL (E-4 NCO) is the sergeant unlock gate
// NOTE: All thresholds are placeholder — needs playtesting to balance
export const RANK_TABLE = [
  { grade: 'E-1', abbr: 'PVT', title: 'Private',             mmr: 0,    nco: false },
  { grade: 'E-2', abbr: 'PV2', title: 'Private 2nd Class',   mmr: 50,   nco: false },
  { grade: 'E-3', abbr: 'PFC', title: 'Private First Class', mmr: 120,  nco: false },
  { grade: 'E-4', abbr: 'SPC', title: 'Specialist',          mmr: 220,  nco: false },
  { grade: 'E-4', abbr: 'CPL', title: 'Corporal',            mmr: 350,  nco: true  },
  { grade: 'E-5', abbr: 'SGT', title: 'Sergeant',            mmr: 520,  nco: true  },
  { grade: 'E-6', abbr: 'SSG', title: 'Staff Sergeant',      mmr: 750,  nco: true  },
  { grade: 'E-7', abbr: 'SFC', title: 'Sgt First Class',     mmr: 1050, nco: true  },
  { grade: 'E-8', abbr: 'MSG', title: 'Master Sergeant',     mmr: 1400, nco: true  },
  { grade: 'E-9', abbr: 'SGM', title: 'Sergeant Major',      mmr: 1800, nco: true  }
];

// Scoring weights — how combat actions add to MMR gain per battle
// NOTE: All weights are placeholder — needs playtesting to balance
export const SCORE_WEIGHTS = {
  kill: 5,
  hit: 2,
  damageDealt: 0.1,    // per point of damage
  shotFired: 0.5,
  survived: 3,         // bonus for surviving the battle
  waveCleared: 2,      // bonus if the wave was won
  died: -5             // penalty for dying
};

// Streak multiplier — consecutive good performances amplify MMR gains
// NOTE: Thresholds are placeholder — needs playtesting
export const STREAK_CONFIG = {
  threshold: 15,       // minimum battle score to count as a "good" performance
  maxStreak: 5,        // cap on streak multiplier
  bonusPerStreak: 0.15 // +15% per consecutive good battle (5 streak = +75%)
};

// Heroic action bonuses — one-time MMR boosts for exceptional performance
// NOTE: All values are placeholder — needs playtesting
export const HEROIC_ACTIONS = {
  firstBlood:      { score: 5,  label: 'First Blood',      desc: 'First kill of the battle' },
  multiKill:       { score: 4,  label: 'Multi-Kill',        desc: '3+ kills in one battle' },
  sharpshooter:    { score: 3,  label: 'Sharpshooter',      desc: '70%+ accuracy with 5+ shots' },
  ironWill:        { score: 4,  label: 'Iron Will',         desc: 'Survived below 20% HP' },
  allyProtector:   { score: 3,  label: 'Ally Protector',    desc: 'Killed enemy targeting a wounded ally' },
  untouchable:     { score: 3,  label: 'Untouchable',       desc: 'Took 0 damage in a battle with combat' },
  lastStand:       { score: 5,  label: 'Last Stand',        desc: 'Last unit alive, won the battle' }
};

// Commendations — permanent MMR floor boosts (ratchet, never lost)
// NOTE: All values are placeholder — needs playtesting
export const COMMENDATIONS = {
  bronzeStar:     { floorBoost: 20,  label: 'Bronze Star',     desc: 'Consistent above-average performance', requirement: '3 streak of score > 25' },
  silverStar:     { floorBoost: 50,  label: 'Silver Star',     desc: 'Exceptional combat performance', requirement: '3 streak of score > 40' },
  purpleHeart:    { floorBoost: 10,  label: 'Purple Heart',    desc: 'Wounded in combat', requirement: 'Survived below 30% HP' },
  combatAction:   { floorBoost: 10,  label: 'Combat Action',   desc: 'Engaged in direct combat', requirement: '10+ shots fired in one battle' },
  veteranService: { floorBoost: 30,  label: 'Veteran Service', desc: 'Extended service record', requirement: '20+ battles served' }
};

// Infantry specializations
export const INFANTRY_MOS = {
  rifleman:     { label: 'Rifleman',     special: null },
  medic:        { label: 'Medic',        special: 'heal' },
  engineer:     { label: 'Engineer',     special: 'repair' },
  heavy_gunner: { label: 'Heavy Gunner', special: 'suppress' }
};

// Distinct combat stats per infantry archetype (role)
// All render as 'infantry' base type but fight differently
// Rifleman matches UNIT_COMBAT_STATS.infantry. Other roles override specific stats.
export const INFANTRY_ARCHETYPES = {
  rifleman:     { hp: 180, damage: 6,  fireRate: 600,  speed: 50, range: 400 },
  medic:        { hp: 160, damage: 5,  fireRate: 750,  speed: 55, range: 350, special: 'heal' },
  engineer:     { hp: 170, damage: 6,  fireRate: 700,  speed: 45, range: 380, special: 'repair' },
  heavy_gunner: { hp: 200, damage: 4,  fireRate: 250,  speed: 40, range: 450, special: 'suppress' }
};

// Maps roster roles → unit type ID for rendering/sprites
// All infantry archetypes render as 'infantry' (same sprite set)
export const ROLE_TO_UNIT_ID = {
  rifleman: 'infantry',
  medic: 'medic',
  engineer: 'infantry',
  heavy_gunner: 'infantry',
  // Vehicle roles don't need mapping — they ride in the vehicle
  tc: null,
  gunner: null,
  driver: null
};

// Default vehicle pool for new endless runs
export const STARTER_VEHICLES = [
  { unitId: 'sherman', count: 2 },
  { unitId: 'jeep', count: 1 },
  { unitId: 'humvee', count: 1 }
];

export const VEHICLE_ROLES = ['tc', 'gunner', 'driver'];
