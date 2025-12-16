// ═══════════════════════════════════════════════════════════════
// STATE - Game state object and battle factory
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, H2H_BUDGET, CAMPAIGN_HERO_UNITS, UNITS } from './constants.js';

export const Game = {
  state: State.MENU,
  subState: SubState.PLAYING,
  hqTab: HQTab.LINEUP,
  hqSelectedSlot: null,
  hqSelectedUnit: null,  // Selected unit index for details panel
  h2hDefenseSlot: undefined,
  h2hWaveLane: undefined,

  settings: {
    sound: true,
    difficulty: 'normal',
    mode: 'waves'
  },

  // Persistent across sessions
  resources: { scrap: 0, parts: 0 },
  stats: {
    gamesPlayed: 0,
    highScore: 0,
    highestWave: 0,
    totalKills: 0,
    totalScrap: 0
  },

  // Player progression (persistent)
  player: {
    unlockedUnits: ['infantry'],  // Only infantry starts unlocked
    upgrades: {},                 // { unitId: { damage: 0, fireRate: 0 } }
    lineup: [0, 0, 0],            // Unit indices for the 3 lanes
    unitColors: {}                // { unitId: { partName: '#color', ... } } - custom colors per unit
  },

  // Reset each battle
  battle: null,

  // H2H match state
  h2h: null,

  // Campaign state
  campaign: null
};

// Campaign state factory
export function newCampaign() {
  return {
    era: 1,
    mos: 'infantry',

    // Family legacy (6 generations)
    family: [
      { era: 1, name: 'Nathaniel', mos: null, survived: null },
      { era: 2, name: 'William', mos: null, survived: null },
      { era: 3, name: 'Harold', mos: null, survived: null },
      { era: 4, name: 'John', mos: null, survived: null },
      { era: 5, name: 'Robert', mos: null, survived: null },
      { era: 6, name: 'You', mos: null, survived: null }
    ],
    familyMOS: [],

    // Resources
    scrap: 0,

    // Territory
    nodes: [],
    currentNode: null,

    // Battle planning (set before battle)
    battlePlan: null,

    // Current battle
    heroBattle: null
  };
}

// Terrain types (natural features only - structures like trenches/pillboxes added later)
// Background and feature are separate layers:
//   - Background: base ground texture (open, grass)
//   - Feature: what's ON the ground (brush, forest, high ground, water)
const TerrainType = {
  OPEN: 'open',           // Bare ground
  GRASS: 'grass',         // Grass coverage
  BRUSH: 'brush',         // Bushes/scrub (+10% def, -10% speed)
  FOREST: 'forest',       // Dense trees (+20% def, invisibility)
  HIGH_GROUND: 'high',    // Rocky ridge (impassable)
  WATER: 'water',         // Rivers/ponds (-50% speed)
  TRENCH: 'trench',       // Dug-in position (+50% def for infantry)
  PILLBOX: 'pillbox',     // Concrete bunker (+75% def, fixed arc)
};

// Time of day affects visibility, colors, and combat
const TimeOfDay = {
  DAWN: 'dawn',           // 0500-0700: Low visibility, warm colors, +10% ambush bonus
  DAY: 'day',             // 0700-1800: Normal conditions
  DUSK: 'dusk',           // 1800-2000: Low visibility, warm colors, +10% ambush bonus
  NIGHT: 'night',         // 2000-0500: Very low visibility, +25% ambush, -20% accuracy
};

// Weather affects movement, visibility, and morale
const Weather = {
  CLEAR: 'clear',         // Normal conditions
  OVERCAST: 'overcast',   // Slightly reduced visibility
  FOG: 'fog',             // -40% visibility, +20% ambush bonus
  RAIN: 'rain',           // -20% visibility, -15% movement, -10% accuracy
  STORM: 'storm',         // -50% visibility, -30% movement, no air support
};

// Color palettes for different times of day
export const TimePalettes = {
  dawn: {
    sky: '#ff9966',
    ambient: 'rgba(255, 150, 100, 0.15)',
    shadow: 'rgba(80, 40, 60, 0.3)',
    grass: ['#4a6b3a', '#5a7b4a', '#3a5b2a'],
    trees: ['#2a4a2a', '#1a3a1a', '#3a5a3a'],
    earth: ['#6b5a45', '#7a6850', '#5a4a38'],
    water: ['#3a6a8a', '#4a7a9a', '#2a5a7a'],
  },
  day: {
    sky: '#87ceeb',
    ambient: 'rgba(255, 255, 255, 0)',
    shadow: 'rgba(0, 0, 0, 0.2)',
    grass: ['#4a7a3a', '#5a8a4a', '#3a6a2a'],
    trees: ['#234d23', '#1a3a1a', '#2d5a2d'],
    earth: ['#7a6850', '#8b7860', '#6a5840'],
    water: ['#1a4a65', '#2a6a8a', '#1e5575'],
  },
  dusk: {
    sky: '#ff6b6b',
    ambient: 'rgba(255, 100, 80, 0.2)',
    shadow: 'rgba(60, 30, 50, 0.4)',
    grass: ['#5a6a3a', '#6a7a4a', '#4a5a2a'],
    trees: ['#2a3a2a', '#1a2a1a', '#3a4a3a'],
    earth: ['#6a5545', '#7a6555', '#5a4538'],
    water: ['#2a4a5a', '#3a5a6a', '#1a3a4a'],
  },
  night: {
    sky: '#1a1a2e',
    ambient: 'rgba(30, 40, 80, 0.4)',
    shadow: 'rgba(0, 0, 20, 0.5)',
    grass: ['#2a3a2a', '#3a4a3a', '#1a2a1a'],
    trees: ['#1a2a1a', '#0a1a0a', '#2a3a2a'],
    earth: ['#3a3530', '#4a4540', '#2a2520'],
    water: ['#0a2a3a', '#1a3a4a', '#0a1a2a'],
  },
};

// Weather effect modifiers
export const WeatherEffects = {
  clear: { filter: 'none', opacity: 1 },
  overcast: { filter: 'saturate(0.7) brightness(0.9)', opacity: 1 },
  fog: { filter: 'saturate(0.5) brightness(1.1) contrast(0.8)', opacity: 0.7 },
  rain: { filter: 'saturate(0.6) brightness(0.8)', opacity: 1 },
  storm: { filter: 'saturate(0.4) brightness(0.6) contrast(1.1)', opacity: 1 },
};

// Generate natural terrain features (NML only - deployment zones stay clear)
function generateTerrain(width, height, nmlStart, nmlEnd) {
  const terrain = [];
  for (let row = 0; row < height; row++) {
    terrain.push(new Array(width).fill(TerrainType.OPEN));
  }

  // === BASE LAYER: Grass in NML only ===
  for (let row = nmlStart; row < nmlEnd; row++) {
    for (let col = 0; col < width; col++) {
      if (Math.random() < 0.5) {
        terrain[row][col] = TerrainType.GRASS;
      }
    }
  }

  // === FEATURE 1: Ridge/high ground (horizontal band in NML) ===
  const ridgeRow = nmlStart + Math.floor((nmlEnd - nmlStart) / 2);
  const ridgeLength = 6 + Math.floor(Math.random() * 8);
  const ridgeStart = Math.floor(Math.random() * (width - ridgeLength));
  for (let col = ridgeStart; col < ridgeStart + ridgeLength; col++) {
    terrain[ridgeRow][col] = TerrainType.HIGH_GROUND;
    // Extend slightly up/down for natural look
    if (ridgeRow > nmlStart && Math.random() < 0.5) {
      terrain[ridgeRow - 1][col] = TerrainType.HIGH_GROUND;
    }
    if (ridgeRow < nmlEnd - 1 && Math.random() < 0.3) {
      terrain[ridgeRow + 1][col] = TerrainType.HIGH_GROUND;
    }
  }

  // === FEATURE 2: Brush/scrub patches (NML only) ===
  const brushCount = 3 + Math.floor(Math.random() * 3);
  for (let b = 0; b < brushCount; b++) {
    const centerRow = nmlStart + 1 + Math.floor(Math.random() * (nmlEnd - nmlStart - 2));
    const centerCol = Math.floor(Math.random() * (width - 4)) + 2;
    // Small brush clusters (2x2 to 3x3)
    const size = 1 + Math.floor(Math.random() * 2);
    for (let dr = -1; dr <= size; dr++) {
      for (let dc = -1; dc <= size; dc++) {
        const r = centerRow + dr;
        const c = centerCol + dc;
        if (r >= nmlStart && r < nmlEnd && c >= 0 && c < width) {
          const current = terrain[r][c];
          if ((current === TerrainType.OPEN || current === TerrainType.GRASS) && Math.random() < 0.6) {
            terrain[r][c] = TerrainType.BRUSH;
          }
        }
      }
    }
  }

  // === FEATURE 3: Forest patches (NML only, with brush edges) ===
  const forestCount = 2 + Math.floor(Math.random() * 2);
  for (let f = 0; f < forestCount; f++) {
    const centerRow = nmlStart + 2 + Math.floor(Math.random() * (nmlEnd - nmlStart - 4));
    const centerCol = Math.floor(Math.random() * (width - 8)) + 4;
    // Create forest cluster (3x3 to 5x5) with brush edges
    const size = 2 + Math.floor(Math.random() * 3);
    for (let dr = -2; dr <= size + 1; dr++) {
      for (let dc = -2; dc <= size + 1; dc++) {
        const r = centerRow + dr;
        const c = centerCol + dc;
        if (r >= nmlStart && r < nmlEnd && c >= 0 && c < width) {
          const isEdge = dr === -2 || dr === size + 1 || dc === -2 || dc === size + 1;
          const current = terrain[r][c];
          if (current !== TerrainType.HIGH_GROUND && current !== TerrainType.WATER) {
            if (isEdge && Math.random() < 0.5) {
              terrain[r][c] = TerrainType.BRUSH;
            } else if (!isEdge && Math.random() < 0.75) {
              terrain[r][c] = TerrainType.FOREST;
            }
          }
        }
      }
    }
  }

  // === FEATURE 4: Water feature (river, NML only) ===
  if (Math.random() < 0.5) {
    const streamRow = nmlStart + 3 + Math.floor(Math.random() * (nmlEnd - nmlStart - 6));
    const streamStart = Math.floor(Math.random() * 4);
    const streamEnd = width - Math.floor(Math.random() * 4);
    // Leave a gap for crossing
    const gapStart = Math.floor(width / 3) + Math.floor(Math.random() * (width / 3));
    const gapEnd = gapStart + 2 + Math.floor(Math.random() * 3);

    for (let col = streamStart; col < streamEnd; col++) {
      if (col >= gapStart && col < gapEnd) continue;
      const current = terrain[streamRow][col];
      if (current !== TerrainType.HIGH_GROUND) {
        terrain[streamRow][col] = TerrainType.WATER;
      }
    }
  }

  // === FEATURE 5: Fortifications (trenches + pillbox) ===
  // Place a trench line in player's forward area (bottom of NML)
  const trenchRow = nmlEnd - 2;
  const trenchStart = 4 + Math.floor(Math.random() * 4);
  const trenchLength = 6 + Math.floor(Math.random() * 6);
  for (let col = trenchStart; col < trenchStart + trenchLength && col < width - 2; col++) {
    const current = terrain[trenchRow][col];
    if (current !== TerrainType.HIGH_GROUND && current !== TerrainType.WATER) {
      terrain[trenchRow][col] = TerrainType.TRENCH;
    }
  }

  // Place a pillbox near the trench (defensive anchor)
  const pillboxCol = trenchStart + Math.floor(trenchLength / 2);
  const pillboxRow = trenchRow + 1;
  if (pillboxRow < nmlEnd && pillboxCol < width) {
    terrain[pillboxRow][pillboxCol] = TerrainType.PILLBOX;
  }

  // Enemy fortification (optional - 50% chance)
  if (Math.random() < 0.5) {
    const enemyTrenchRow = nmlStart + 1;
    const enemyTrenchStart = 8 + Math.floor(Math.random() * 6);
    const enemyTrenchLength = 4 + Math.floor(Math.random() * 4);
    for (let col = enemyTrenchStart; col < enemyTrenchStart + enemyTrenchLength && col < width - 2; col++) {
      const current = terrain[enemyTrenchRow][col];
      if (current !== TerrainType.HIGH_GROUND && current !== TerrainType.WATER) {
        terrain[enemyTrenchRow][col] = TerrainType.TRENCH;
      }
    }
    // Enemy pillbox
    const enemyPillboxCol = enemyTrenchStart - 1;
    if (enemyPillboxCol >= 0) {
      terrain[enemyTrenchRow][enemyPillboxCol] = TerrainType.PILLBOX;
    }
  }

  return terrain;
}

// Campaign battle planning factory
export function newBattlePlan(era, mos) {
  // Grid: 24 wide x 24 tall
  // Player deploys in bottom 4 rows
  // Enemy deploys in top 4 rows
  // Middle 16 rows are no-man's land (combat area)
  const GRID_WIDTH = 24;
  const GRID_HEIGHT = 24;
  const PLAYER_ROWS = 4;  // Bottom 4 rows for player
  const ENEMY_ROWS = 4;   // Top 4 rows for enemy
  const NML_START = ENEMY_ROWS;
  const NML_END = GRID_HEIGHT - PLAYER_ROWS;

  // Create empty grid (null = empty cell)
  const grid = [];
  for (let row = 0; row < GRID_HEIGHT; row++) {
    grid.push(new Array(GRID_WIDTH).fill(null));
  }

  // Generate realistic terrain
  const terrain = generateTerrain(GRID_WIDTH, GRID_HEIGHT, NML_START, NML_END);

  // Get hero stats
  const eraUnits = CAMPAIGN_HERO_UNITS[era] || CAMPAIGN_HERO_UNITS[1];
  const heroStats = eraUnits[mos] || eraUnits.infantry;

  // Available units for placement (use player's unlocked units)
  const availableUnits = Game.player.unlockedUnits.map(id => {
    const unit = UNITS.find(u => u.id === id);
    return unit ? { ...unit, count: 5 } : null;  // Start with 5 of each
  }).filter(Boolean);

  return {
    // Grid config
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    playerStartRow: GRID_HEIGHT - PLAYER_ROWS,  // Row 14
    enemyEndRow: ENEMY_ROWS,                     // Row 6
    cellSize: 33,  // Pixels per cell for rendering (32px + 1px gap)

    // The grid - each cell is null or { unitId, owner: 'player'|'enemy' }
    grid,

    // Terrain grid
    terrain,

    // Hero placement (grid coordinates)
    hero: {
      row: GRID_HEIGHT - 2,  // Second from bottom
      col: Math.floor(GRID_WIDTH / 2),  // Center
      unitId: heroStats.id,
      stats: heroStats
    },

    // Available units to place (with counts)
    availableUnits,

    // Currently selected unit for placement
    selectedUnit: null,  // unit id or 'hero'

    // Placement mode
    mode: 'place',  // 'place' | 'remove' | 'hero'

    // Enemy army (AI generates, or preset)
    enemyArmy: [],

    // Doctrine/tactic selection
    doctrine: 'frontal',  // 'frontal' | 'flanking' | 'defensive' | 'blitz'

    // Battlefield conditions
    timeOfDay: 'day',     // 'dawn' | 'day' | 'dusk' | 'night'
    weather: 'clear',     // 'clear' | 'overcast' | 'fog' | 'rain' | 'storm'

    // View controls - zoom will be auto-calculated on first render
    zoom: 1.0,        // Will be set to fit viewport
    autoFitZoom: true, // Flag to trigger auto-fit on first render
    panX: 0,          // Horizontal offset (0 = centered)
    panY: 0,          // Vertical offset
    isPanning: false,
    lastPanX: 0,
    lastPanY: 0,

    // Unit selection and path planning
    selectedPlacedUnit: null,  // { row, col } of selected unit on grid
    pathSetMode: false,        // True when user is defining a path
    plannedPath: [],           // Array of { row, col } for current path being set
  };
}

// Campaign hero battle factory
export function newCampaignBattle(era, mos, battlePlan) {
  // Get hero stats from era/MOS definitions, with fallbacks
  const eraUnits = CAMPAIGN_HERO_UNITS[era] || CAMPAIGN_HERO_UNITS[1];
  const heroStats = eraUnits[mos] || eraUnits.infantry;

  // Cell size in pixels for converting grid to world
  const CELL_SIZE = 64;

  // Calculate map size from battlePlan grid
  const gridWidth = battlePlan?.gridWidth || 24;
  const gridHeight = battlePlan?.gridHeight || 24;
  const mapWidth = gridWidth * CELL_SIZE;
  const mapHeight = gridHeight * CELL_SIZE;

  // Get hero starting position from battlePlan
  const heroGridPos = battlePlan?.hero || { row: gridHeight - 2, col: Math.floor(gridWidth / 2) };
  const heroX = (heroGridPos.col + 0.5) * CELL_SIZE;
  const heroY = (heroGridPos.row + 0.5) * CELL_SIZE;

  // Extract player units from battlePlan grid
  const playerUnits = [];
  if (battlePlan?.grid) {
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const cell = battlePlan.grid[row]?.[col];
        if (cell && cell.owner === 'player') {
          // Convert waypoints from grid coords to world coords
          const waypoints = (cell.waypoints || []).map(wp => ({
            x: (wp.col + 0.5) * CELL_SIZE,
            y: (wp.row + 0.5) * CELL_SIZE
          }));

          playerUnits.push({
            id: `unit_${row}_${col}`,  // Unique ID for aggro tracking
            unitId: cell.unitId,
            row,
            col,
            x: (col + 0.5) * CELL_SIZE,
            y: (row + 0.5) * CELL_SIZE,
            hp: 100,  // TODO: Get from unit stats
            maxHp: 100,  // maxHp for threat calculation
            angle: -Math.PI / 2,  // Face up (toward enemy)
            lastShot: 0,
            // Waypoint support
            waypoints: waypoints,
            currentWaypoint: 0,
            // AI behavior preset (can be set during planning)
            aiBehavior: cell.aiBehavior || null,
            // Initial AI state
            aiState: waypoints.length > 0 ? 'moving' : 'defending'
          });
        }
      }
    }
  }

  return {
    // Cell/grid config
    cellSize: CELL_SIZE,
    gridWidth,
    gridHeight,

    // Map size in pixels
    mapWidth,
    mapHeight,

    // Terrain from battlePlan
    terrain: battlePlan?.terrain || [],

    // Camera position
    camera: { x: 0, y: 0 },

    // Hero
    hero: {
      x: heroX,
      y: heroY,
      angle: -Math.PI / 2,  // Face up
      hp: heroStats.hp,
      maxHp: heroStats.hp,  // maxHp for threat calculation
      speed: heroStats.speed,
      damage: heroStats.damage,
      fireRate: heroStats.fireRate,
      lastShot: 0,
      unitId: heroStats.id,
      mos: mos  // MOS for weapon category (infantry, cavalry, etc.)
    },

    // Player units from battlePlan
    units: playerUnits,

    // Input state
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, down: false },

    // Enemies (spawned during battle)
    enemies: [],

    // Projectiles
    projectiles: [],

    // Effects
    effects: [],

    // Wave system
    wave: 1,
    waveTimer: 0,
    enemiesRemaining: 0,

    // Objective
    objective: 'survive',
    timer: 120,  // seconds

    // Result
    result: null,  // 'victory' | 'defeat'
    kills: 0
  };
}

export function newBattle() {
  const lineup = Game.player.lineup;
  return {
    health: 100,
    maxHealth: 100,
    score: 0,
    wave: 1,
    countdown: 3,
    selectedLane: null,
    lanes: [
      { unit: lineup[0], cooldown: 0, deployed: [] },
      { unit: lineup[1], cooldown: 0, deployed: [] },
      { unit: lineup[2], cooldown: 0, deployed: [] }
    ],
    enemies: [],
    effects: [],
    projectiles: [],  // Active projectiles in flight
    waveSize: 0,
    killed: 0
  };
}

export function newH2H() {
  const lineup = Game.player.lineup;
  return {
    round: 1,
    score: { player: 0, ai: 0 },
    bestOf: 3,

    // Player's design - each wave deploys all 3 lanes at once
    playerAttack: [],           // Array of { delay, lanes: [unitIdx|null, unitIdx|null, unitIdx|null] }
    playerDefense: [...lineup], // Copy of current lineup

    // AI's design (generated when battle starts)
    aiAttack: [],
    aiDefense: [0, 0, 0],

    // Budget
    budget: H2H_BUDGET,
    spent: 0,

    // Battle state (during combat)
    playerHP: 100,
    aiHP: 100,
    phase: 'design',  // 'design' | 'battle' | 'result'

    // Editing state
    selectedWave: null
  };
}
