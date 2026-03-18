// ═══════════════════════════════════════════════════════════════
// STATE - Game state object and battle factory
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, H2H_BUDGET, CAMPAIGN_HERO_UNITS, UNITS, ENEMIES, UNIT_COMBAT_STATS, ZoneOwner, ScenarioType, Biome, BIOME_TERRAIN, Team, INFANTRY_ARCHETYPES, ROLE_TO_UNIT_ID, CREW_SCHEMAS } from './constants.js';
import { WorldBuilder } from './world-builder/index.js';
import { generateBattleTerrain, randomizeBattleConfig } from './world-builder/battle-terrain.js';
import { hashString } from './world-builder/rng.js';
import { createSergeant, DEFAULT_SERGEANT } from './sergeant.js';
import { initBattleAI, applyBrainDefaults } from './ai-pipeline.js';
import { findValidSpawnPos } from './terrain-utils.js';
import { getPool, getAvailableVehicles, getRankName, getSoldier, getCrewForVehicle, assignToVehicle } from './roster.js';
import { loadLastLoadout } from './storage.js';

export const Game = {
  state: State.MENU,
  subState: SubState.PLAYING,
  hqTab: HQTab.LINEUP,
  hqSelectedSlot: null,
  hqSelectedUnit: null,  // Selected unit index for details panel
  insigniaEditor: null,  // InsigniaEditor singleton ref (set by insignia-events.js)
  h2hDefenseSlot: undefined,
  h2hWaveLane: undefined,

  settings: {
    sound: true,
    difficulty: 'normal',
    mode: 'waves',
    autoRecord: true,
    insigniaSetId: null,      // Active insignia set ID for battles
    // Control settings
    controls: {
      joystickDragThreshold: 8,      // Pixels to drag before joystick activates
      joystickActivationRadius: 80,  // Pixels from anchor to activate joystick
      gestureHoldTime: 1000,         // Ms to hold for artillery
      gestureTapInterval: 300        // Ms between multi-taps
    }
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
    unlockedUnits: ['infantry', 'abrams'],  // Infantry + Abrams for testing
    upgrades: {},                 // { unitId: { damage: 0, fireRate: 0 } }
    lineup: [0, 0, 0],            // Unit indices for the 3 lanes
    unitColors: {},               // { unitId: { partName: '#color', ... } } - custom colors per unit
    spriteSelections: {}          // { unitId: { partName: 'spriteName', ... } | null } - custom sprites per unit, null = use default SVG
  },

  // Persistent soldier roster (crew system)
  roster: [],

  // Reset each battle
  battle: null,

  // H2H match state
  h2h: null,

  // Campaign state
  campaign: null,

  // Endless mode state
  endless: null
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

  // Auto-spawn units in base zone (rows 20-23, which is playerStartRow to gridHeight-1)
  const spawnZoneStartRow = GRID_HEIGHT - PLAYER_ROWS;  // Row 20
  const unitPlacements = [];
  let spawnRow = GRID_HEIGHT - 1;  // Start at bottom row (23)
  let spawnCol = 0;
  const maxCols = GRID_WIDTH;

  availableUnits.forEach(unitType => {
    for (let i = 0; i < unitType.count; i++) {
      unitPlacements.push({
        unitId: unitType.id,
        primaryPos: { row: spawnRow, col: spawnCol },
        advancePos: null,
        fallbackPos: null,
        isSupport: false,
        inSpawnZone: true  // Flag to track if unit hasn't been moved yet
      });

      spawnCol++;
      if (spawnCol >= maxCols) {
        spawnCol = 0;
        spawnRow--;
        if (spawnRow < spawnZoneStartRow) spawnRow = spawnZoneStartRow; // Keep in spawn zone
      }
    }
  });

  return {
    // Grid config
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    playerStartRow: GRID_HEIGHT - PLAYER_ROWS,  // Row 20
    enemyEndRow: ENEMY_ROWS,                     // Row 4
    cellSize: 33,  // Pixels per cell for rendering (32px + 1px gap)

    // The grid - now only for terrain/structures, not unit positions
    grid,

    // Terrain grid
    terrain,

    // Spawn point (center bottom of player zone)
    spawnPoint: {
      row: GRID_HEIGHT - 1,
      col: Math.floor(GRID_WIDTH / 2)
    },

    // Hero placement (grid coordinates)
    hero: {
      row: GRID_HEIGHT - 2,  // Second from bottom
      col: Math.floor(GRID_WIDTH / 2),  // Center
      unitId: heroStats.id,
      stats: heroStats
    },

    // Unit placements - destination-based system (auto-populated with units in spawn zone)
    // Each placement: { unitId, primaryPos, advancePos?, fallbackPos?, isSupport, inSpawnZone }
    unitPlacements,

    // Available units info (for reference, not for roster selection)
    availableUnits,

    // Currently selected placement object (direct reference, not index)
    selectedPlacement: null,

    // Context menu state for long-press/right-click
    contextMenu: null,  // { row, col, screenX, screenY } when open

    // Enemy army (AI generates, or preset)
    enemyArmy: [],

    // Doctrine/tactic selection
    doctrine: 'frontal',  // 'frontal' | 'flanking' | 'defensive' | 'blitz'

    // Front line commands state
    frontLineState: 'hold',  // 'advance' | 'hold' | 'retreat'

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

  // Get spawn point from battlePlan
  const spawnPoint = battlePlan?.spawnPoint || { row: gridHeight - 1, col: Math.floor(gridWidth / 2) };
  const spawnX = (spawnPoint.col + 0.5) * CELL_SIZE;
  const spawnY = (spawnPoint.row + 0.5) * CELL_SIZE;

  // Extract player units from battlePlan unitPlacements (new destination system)
  const playerUnits = [];
  if (battlePlan?.unitPlacements) {
    battlePlan.unitPlacements.forEach((placement, index) => {
      // Convert positions from grid coords to world coords
      const primaryPos = placement.primaryPos ? {
        x: (placement.primaryPos.col + 0.5) * CELL_SIZE,
        y: (placement.primaryPos.row + 0.5) * CELL_SIZE
      } : null;

      const advancePos = placement.advancePos ? {
        x: (placement.advancePos.col + 0.5) * CELL_SIZE,
        y: (placement.advancePos.row + 0.5) * CELL_SIZE
      } : null;

      const fallbackPos = placement.fallbackPos ? {
        x: (placement.fallbackPos.col + 0.5) * CELL_SIZE,
        y: (placement.fallbackPos.row + 0.5) * CELL_SIZE
      } : null;

      // Get unit stats
      const unitDef = UNITS.find(u => u.id === placement.unitId);
      const hp = unitDef?.hp || 100;

      // Note: Smart positioning is handled by assignSmartPositions() in game.js
      // Units without explicit positions will have them assigned after battle creation

      playerUnits.push(createUnit(placement.unitId, {
        id: `unit_${index}`,
        x: spawnX + (index % 3 - 1) * 40,
        y: spawnY + Math.floor(index / 3) * 40,
        hp: hp,
        maxHp: hp,
        primaryPos: primaryPos,
        advancePos: advancePos,
        fallbackPos: fallbackPos,
        currentDestination: primaryPos,
        advanceTarget: null,
        repositionTarget: null,
        isSupport: placement.isSupport || false,
        stance: placement.isSupport ? 'support' : 'autonomous',
        aiState: 'idle',
        reachedDestination: false,
      }));
    });
  }

  // Also support legacy grid-based placement for backwards compatibility
  if (playerUnits.length === 0 && battlePlan?.grid) {
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const cell = battlePlan.grid[row]?.[col];
        if (cell && cell.owner === 'player') {
          const waypoints = (cell.waypoints || []).map(wp => ({
            x: (wp.col + 0.5) * CELL_SIZE,
            y: (wp.row + 0.5) * CELL_SIZE
          }));

          playerUnits.push(createUnit(cell.unitId, {
            id: `unit_${row}_${col}`,
            x: (col + 0.5) * CELL_SIZE,
            y: (row + 0.5) * CELL_SIZE,
            hp: 100,
            maxHp: 100,
            waypoints: waypoints,
            currentWaypoint: 0,
            aiBehavior: cell.aiBehavior || null,
            aiState: 'idle',
            advanceTarget: null,
            repositionTarget: null
          }));
        }
      }
    }
  }

  // Generate PCG terrain if images are preloaded
  let terrainCanvases = null;
  let terrainMap = null;
  let pcgSpawnZones = null;
  let terrainLabel = null;
  let terrainConfig = null;
  const battleSeed = battlePlan?.seed || Math.floor(Math.random() * 999999);
  if (Game.terrainImages) {
    try {
      const varied = randomizeBattleConfig(battleSeed);
      terrainConfig = { biome: varied.biome, season: varied.season, templateName: varied.templateName, pcgParams: { ...varied.pcgParams } };
      const pcg = generateBattleTerrain({
        mapWidth, mapHeight, cellSize: CELL_SIZE,
        biome: varied.biome, season: varied.season,
        seed: battleSeed,
        images: Game.terrainImages,
        pcgParams: varied.pcgParams
      });
      terrainCanvases = { terrainCanvas: pcg.terrainCanvas, canopyCanvas: pcg.canopyCanvas, bridgeDeckCanvas: pcg.bridgeDeckCanvas };
      terrainMap = pcg.terrainMap;
      pcgSpawnZones = pcg.spawnZones;
      terrainLabel = `${varied.templateName} (${varied.season}) #${battleSeed}`;
    } catch (err) {
      console.warn('[state] PCG terrain generation failed, using fallback:', err);
    }
  }

  const battle = {
    // Cell/grid config
    cellSize: CELL_SIZE,
    gridWidth,
    gridHeight,

    // Map size in pixels
    mapWidth,
    mapHeight,

    // Terrain from battlePlan (fallback)
    terrain: battlePlan?.terrain || [],

    // PCG terrain (pre-rendered canvases)
    terrainCanvases,
    terrainMap,
    pcgSpawnZones,
    terrainLabel,
    terrainSeed: battleSeed,
    terrainConfig,

    // Camera position
    camera: { x: 0, y: 0 },

    // Hero
    hero: createUnit(heroStats.id, {
      id: `hero_${Date.now()}`,
      x: heroX,
      y: heroY,
      hp: heroStats.hp,
      maxHp: heroStats.hp,
      speed: heroStats.speed,
      damage: heroStats.damage,
      fireRate: heroStats.fireRate,
      mos: mos,
      animId: `hero-${heroStats.id}-${Date.now()}`,
      isMoving: false,
      lastX: heroX,
      lastY: heroY,
      targetHullAngle: -Math.PI / 2,
      _currentSpeed: heroStats.speed,
      viewRange: UNIT_COMBAT_STATS[heroStats.id]?.viewRange || 950,
      viewCone: 360,
      _awareness: 0.6
    }),

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
    kills: 0,

    // Front line command state (legacy - will be replaced by squad system)
    frontLineState: 'hold',  // 'advance' | 'hold' | 'retreat'

    // Pending command (for move orders etc)
    pendingCommand: null,

    // === SQUAD SYSTEM ===
    squad: {
      // Squad-wide stance (determines proactive behavior for all units)
      stance: 'autonomous',  // 'autonomous' | 'aggressive' | 'defensive' | 'support'

      // Squad-wide order (applies to all units unless they have individual orders)
      currentOrder: 'hold',  // 'hold' | 'advance' | 'fallback' | 'suppress' | 'flank' | 'digIn'

      // Formation
      formation: 'line',  // 'line' | 'wedge' | 'column' | 'spread' | 'auto'

      // Custom formations (saved by player)
      customFormations: [],  // Array of { name, positions: [{offsetX, offsetY}, ...] }

      // Selection state
      selectedUnitId: null,  // ID of selected unit (null = whole squad or none)
      selectionMode: 'none', // 'none' | 'squad' | 'unit'

      // Multi-select mode
      multiSelectMode: false,  // true when multi-select toggle is on
      selectedUnits: [],       // Array of unit IDs when in multi-select mode

      // Concentrate fire target
      concentrateTarget: null  // Enemy ID that all units should focus
    },

    // Spotted enemies (enemies that have been seen by hero or any unit)
    spottedEnemies: [],  // Array of { enemyId, lastSeenX, lastSeenY, lastSeenTime, isVisible }

    // Command mode for radio UI
    commandMode: null,  // null | 'selectTarget' | 'selectLocation'
    commandAction: null, // The action waiting for target selection

    // Radio popup UI state
    radioOpen: false  // Whether the radio command popup is open
  };

  // Initialize unified AI pipeline
  const blueSpawnZone = { x: battle.mapWidth / 2, y: battle.mapHeight - 100, radius: 100 };
  const redSpawnZone = { x: battle.mapWidth / 2, y: 100, radius: 100 };
  initBattleAI(battle, { allyPreset: 'campaignAlly', enemyPreset: 'campaignEnemy', blueSpawnZone, redSpawnZone, insigniaSetId: Game.settings.insigniaSetId });

  return battle;
}

// ═══════════════════════════════════════════════════════════════
// ZONE BATTLE SYSTEM - Scrolling zone-capture battles
// ═══════════════════════════════════════════════════════════════

// Zone name generator based on position
function getZoneName(index, total) {
  const names = [
    ['Beachhead', 'Landing Zone', 'Shore Defense'],
    ['Fields', 'No Man\'s Land', 'Open Ground', 'Crossroads'],
    ['Village', 'Outskirts', 'Town Center'],
    ['Forest', 'Woods', 'Thicket'],
    ['Stronghold', 'Fortress', 'Enemy HQ', 'Final Stand']
  ];

  // First zone = beach-type names, last zone = stronghold names
  if (index === 0) return names[0][Math.floor(Math.random() * names[0].length)];
  if (index === total - 1) return names[4][Math.floor(Math.random() * names[4].length)];

  // Middle zones pick from fields/village/forest
  const midNames = [...names[1], ...names[2], ...names[3]];
  return midNames[Math.floor(Math.random() * midNames.length)];
}

// Get biome for zone based on position
function getZoneBiome(index, total) {
  // Progression: beach → fields → forest/urban → fortress
  if (index === 0) return Biome.BEACH;
  if (index === total - 1) return Biome.FORTRESS;

  // Middle zones alternate
  const midBiomes = [Biome.FIELDS, Biome.FOREST, Biome.URBAN];
  return midBiomes[(index - 1) % midBiomes.length];
}

// Create a zone object
export function createZone(id, config = {}) {
  const rowsPerZone = config.rowsPerZone || 24;

  return {
    id,
    name: config.name || `Zone ${id}`,
    owner: config.owner || ZoneOwner.NEUTRAL,
    startRow: config.startRow ?? (id * rowsPerZone),
    endRow: config.endRow ?? ((id + 1) * rowsPerZone - 1),
    biome: config.biome || Biome.FIELDS,
    terrain: config.terrain || null,  // null = generate, or 2D array for pre-designed
    spawnPoints: config.spawnPoints || [],
    enemiesRemaining: config.enemiesRemaining ?? 10,
    enemiesActive: 0,
    captureProgress: 0,  // 0-100 for contested zones
    timer: config.timer ?? 120000,  // ms, time limit for zone
    timerStarted: false,
    rewards: config.rewards || { scrap: 100 }
  };
}

// Create an advancing scenario (player pushes from south to north)
// Zone 0 = BOTTOM (player start), Zone N-1 = TOP (enemy stronghold)
export function createAdvancingScenario(name, zoneCount = 3, config = {}) {
  const zones = [];
  const rowsPerZone = config.rowsPerZone || 24;
  const mapWidth = config.mapWidth || 16;  // Narrower map (was 24)
  const totalRows = zoneCount * rowsPerZone;

  for (let i = 0; i < zoneCount; i++) {
    // REVERSED: Zone 0 at bottom (high rows), Zone N-1 at top (low rows)
    const zoneIndex = zoneCount - 1 - i;  // Reverse for row calculation
    const zone = createZone(i, {
      name: getZoneName(i, zoneCount),
      owner: i === 0 ? ZoneOwner.PLAYER : ZoneOwner.ENEMY,
      startRow: zoneIndex * rowsPerZone,  // Zone 0 gets highest rows
      endRow: (zoneIndex + 1) * rowsPerZone - 1,
      biome: getZoneBiome(i, zoneCount),
      rowsPerZone,
      enemiesRemaining: 10 + i * 5,  // More enemies in later zones
      timer: 120000,  // 2 minutes per zone
      rewards: { scrap: 100 + i * 50 }
    });
    zones.push(zone);
  }

  return {
    type: ScenarioType.ADVANCING,
    name: name || 'Operation Advance',
    description: config.description || 'Push through enemy territory to capture the stronghold',
    zones,
    mapWidth,
    totalRows,
    playerStartZone: 0,
    enemyStartZone: zoneCount - 1,
    allowZoneLoss: false,  // Advancing scenarios don't allow zone loss
    globalTimer: config.globalTimer || null,
    victoryCondition: 'capture_all',
    defeatCondition: 'hero_death'
  };
}

// Create a frontline scenario (tug-of-war, zones can be lost)
// Zone 0 = BOTTOM (player home), Zone N-1 = TOP (enemy home)
export function createFrontlineScenario(name, zoneCount = 5, config = {}) {
  const zones = [];
  const rowsPerZone = config.rowsPerZone || 24;
  const mapWidth = config.mapWidth || 16;  // Narrower map (was 24)
  const totalRows = zoneCount * rowsPerZone;
  const midZone = Math.floor(zoneCount / 2);

  for (let i = 0; i < zoneCount; i++) {
    // Determine initial ownership (zone 0 = player, zone N-1 = enemy)
    let owner;
    if (i < midZone) owner = ZoneOwner.PLAYER;
    else if (i > midZone) owner = ZoneOwner.ENEMY;
    else owner = ZoneOwner.CONTESTED;

    // REVERSED: Zone 0 at bottom (high rows), Zone N-1 at top (low rows)
    const zoneIndex = zoneCount - 1 - i;
    const zone = createZone(i, {
      name: getZoneName(i, zoneCount),
      owner,
      startRow: zoneIndex * rowsPerZone,
      endRow: (zoneIndex + 1) * rowsPerZone - 1,
      biome: getZoneBiome(i, zoneCount),
      rowsPerZone,
      enemiesRemaining: 8 + Math.abs(i - midZone) * 3,
      timer: 90000,  // 90 seconds per zone
      rewards: { scrap: 75 + Math.abs(i - midZone) * 25 }
    });

    // Start timer for middle contested zone
    if (i === midZone) zone.timerStarted = true;

    zones.push(zone);
  }

  return {
    type: ScenarioType.FRONTLINE,
    name: name || 'Operation Frontline',
    description: config.description || 'Hold the line and push back the enemy forces',
    zones,
    mapWidth,
    totalRows,
    playerStartZone: 0,  // Player starts at zone 0 (bottom)
    enemyStartZone: zoneCount - 1,  // Enemy at zone N-1 (top)
    allowZoneLoss: true,  // Frontline allows zone loss
    globalTimer: config.globalTimer || 600000,  // 10 minute total battle
    victoryCondition: 'capture_all',
    defeatCondition: 'lose_home_zone'
  };
}

// Generate spawn points for a zone
// Enemies spawn at the BACK of the zone (near north edge for enemy zones)
// Returns RELATIVE row positions (0 = zone.startRow, 1 = zone.startRow + 1, etc.)
export function generateZoneSpawnPoints(zone, mapWidth, count = 5) {
  const points = [];

  // Spawn from TOP/BACK of zone (low relative rows = north edge of zone)
  // Row 1-3 relative = near the north edge of the zone
  for (let i = 0; i < count; i++) {
    points.push({
      col: 2 + Math.floor(Math.random() * (mapWidth - 4)),  // Avoid edges
      row: 1 + Math.floor(Math.random() * 3),  // Relative rows 1-3 (back of zone)
      type: 'standard'
    });
  }

  return points;
}

// Generate terrain for a single zone based on biome with CLUSTERING
export function generateZoneTerrain(zone, mapWidth, previousEdge = null) {
  const rows = zone.endRow - zone.startRow + 1;
  const terrain = [];
  const biomeWeights = BIOME_TERRAIN[zone.biome] || BIOME_TERRAIN.fields;

  // Initialize with base terrain (open or grass)
  const baseType = Math.random() < 0.6 ? 'open' : 'grass';
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < mapWidth; c++) {
      row.push(baseType);
    }
    terrain.push(row);
  }

  // Blend with previous zone edge for first 2 rows
  if (previousEdge) {
    for (let r = 0; r < Math.min(2, rows); r++) {
      const blendRow = previousEdge[previousEdge.length - 2 + r];
      if (blendRow) {
        for (let c = 0; c < mapWidth; c++) {
          if (Math.random() < 0.7) terrain[r][c] = blendRow[c] || baseType;
        }
      }
    }
  }

  // Helper to place clustered features
  function placeCluster(type, centerR, centerC, size, chance = 0.7) {
    for (let dr = -size; dr <= size; dr++) {
      for (let dc = -size; dc <= size; dc++) {
        const r = centerR + dr;
        const c = centerC + dc;
        if (r >= 0 && r < rows && c >= 0 && c < mapWidth) {
          // Falloff from center
          const dist = Math.sqrt(dr * dr + dc * dc);
          const falloff = 1 - (dist / (size + 1));
          if (Math.random() < chance * falloff) {
            terrain[r][c] = type;
          }
        }
      }
    }
  }

  // Place water features (rivers/ponds) - fewer, larger
  if (biomeWeights.water > 0.1) {
    const waterCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < waterCount; i++) {
      const r = 3 + Math.floor(Math.random() * (rows - 6));
      const c = 2 + Math.floor(Math.random() * (mapWidth - 4));
      // River-like: horizontal or vertical stretch
      if (Math.random() < 0.5) {
        // Horizontal river
        const length = 4 + Math.floor(Math.random() * 6);
        for (let dc = 0; dc < length && c + dc < mapWidth - 1; dc++) {
          terrain[r][c + dc] = 'water';
          if (r > 0 && Math.random() < 0.3) terrain[r - 1][c + dc] = 'water';
        }
      } else {
        // Pond cluster
        placeCluster('water', r, c, 2, 0.6);
      }
    }
  }

  // Place brush/vegetation clusters
  if (biomeWeights.brush > 0.05) {
    const brushCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < brushCount; i++) {
      const r = 2 + Math.floor(Math.random() * (rows - 4));
      const c = 2 + Math.floor(Math.random() * (mapWidth - 4));
      placeCluster('brush', r, c, 2 + Math.floor(Math.random() * 2), 0.65);
    }
  }

  // Place forest clusters (larger, with brush edges)
  if (biomeWeights.forest > 0) {
    const forestCount = Math.floor(biomeWeights.forest * 5);
    for (let i = 0; i < forestCount; i++) {
      const r = 3 + Math.floor(Math.random() * (rows - 6));
      const c = 3 + Math.floor(Math.random() * (mapWidth - 6));
      const size = 2 + Math.floor(Math.random() * 2);
      // Forest core
      placeCluster('forest', r, c, size, 0.75);
      // Brush edge around forest
      placeCluster('brush', r, c, size + 1, 0.3);
    }
  }

  // Place structures (trenches, pillboxes) - sparse
  if (biomeWeights.trench > 0) {
    const trenchCount = Math.ceil(biomeWeights.trench * 3);
    for (let i = 0; i < trenchCount; i++) {
      const r = 4 + Math.floor(Math.random() * (rows - 8));
      const c = 2 + Math.floor(Math.random() * (mapWidth - 6));
      const length = 3 + Math.floor(Math.random() * 4);
      for (let dc = 0; dc < length && c + dc < mapWidth - 1; dc++) {
        if (terrain[r][c + dc] !== 'water') {
          terrain[r][c + dc] = 'trench';
        }
      }
    }
  }

  if (biomeWeights.pillbox > 0) {
    const pillboxCount = Math.ceil(biomeWeights.pillbox * 3);
    for (let i = 0; i < pillboxCount; i++) {
      const r = 3 + Math.floor(Math.random() * (rows - 6));
      const c = 2 + Math.floor(Math.random() * (mapWidth - 4));
      if (terrain[r][c] !== 'water') {
        terrain[r][c] = 'pillbox';
      }
    }
  }

  // Place high ground (ridges)
  if (biomeWeights.high > 0) {
    const ridgeCount = Math.ceil(biomeWeights.high * 2);
    for (let i = 0; i < ridgeCount; i++) {
      const r = 5 + Math.floor(Math.random() * (rows - 10));
      const c = 2 + Math.floor(Math.random() * (mapWidth - 8));
      const length = 4 + Math.floor(Math.random() * 5);
      for (let dc = 0; dc < length && c + dc < mapWidth - 2; dc++) {
        terrain[r][c + dc] = 'high';
        // Slight vertical extension
        if (Math.random() < 0.3 && r > 0) terrain[r - 1][c + dc] = 'high';
      }
    }
  }

  return terrain;
}

// Generate terrain for entire scenario (all zones stitched together)
export function generateZonedTerrain(scenario) {
  const terrain = [];
  let previousEdge = null;

  for (const zone of scenario.zones) {
    if (zone.terrain) {
      // Pre-designed map section
      terrain.push(...zone.terrain);
      previousEdge = zone.terrain.slice(-2);
    } else {
      // Generate based on biome, blend with previous zone
      const section = generateZoneTerrain(zone, scenario.mapWidth, previousEdge);
      terrain.push(...section);
      previousEdge = section.slice(-2);

      // Store generated terrain back to zone
      zone.terrain = section;
    }

    // Generate spawn points if not defined
    if (!zone.spawnPoints || zone.spawnPoints.length === 0) {
      zone.spawnPoints = generateZoneSpawnPoints(zone, scenario.mapWidth, zone.enemiesRemaining);
    }
  }

  return terrain;
}

// Create starting squad of allied units for zone battles
function createStartingSquad(heroX, heroY, cellSize) {
  const units = [];

  // Starting squad composition: 4 infantry spread around the hero
  const squadPositions = [
    { dx: -cellSize * 1.5, dy: 0 },      // Left
    { dx: cellSize * 1.5, dy: 0 },       // Right
    { dx: -cellSize * 0.75, dy: cellSize },    // Back-left
    { dx: cellSize * 0.75, dy: cellSize },     // Back-right
  ];

  squadPositions.forEach((pos, i) => {
    units.push(createUnit('infantry', {
      id: `ally_${i}`,
      x: heroX + pos.dx,
      y: heroY + pos.dy,
      hp: 50,
      maxHp: 50,
      damage: 8,
      fireRate: 1200,
      supportTarget: null,
      protectTarget: null,
      moveTarget: null
    }));
  });

  return units;
}

// Zone battle factory - creates a battle from a scenario
export function newZoneBattle(era, mos, scenario) {
  const CELL_SIZE = 64;

  // Generate terrain for all zones
  const terrain = generateZonedTerrain(scenario);

  // Find the starting zone for player (zone 0 = bottom, high row numbers)
  const startZone = scenario.zones[scenario.playerStartZone];

  // Hero position: near bottom of start zone (high row = bottom of screen)
  // startZone.endRow is the highest row number in the zone
  const heroX = (scenario.mapWidth / 2) * CELL_SIZE;
  const heroY = (startZone.endRow - 2) * CELL_SIZE;  // 2 rows up from bottom of zone

  // Get hero stats
  const eraUnits = CAMPAIGN_HERO_UNITS[era] || CAMPAIGN_HERO_UNITS[1];
  const heroStats = eraUnits[mos] || eraUnits.infantry;

  // Find first non-player zone as active zone (the one player needs to capture next)
  // Zones are sorted by id (0, 1, 2...) where 0 is player home at bottom
  const activeZoneIndex = scenario.zones.findIndex(z => z.owner !== ZoneOwner.PLAYER);

  // Calculate map height
  const mapHeight = scenario.totalRows * CELL_SIZE;

  return {
    // Scenario reference
    scenario,
    zones: scenario.zones.map(z => ({ ...z })),  // Deep copy zones
    activeZoneIndex: activeZoneIndex >= 0 ? activeZoneIndex : 0,

    // Front line tracking (Y position where enemy zones start - lower Y = further north)
    frontLineY: activeZoneIndex >= 0
      ? scenario.zones[activeZoneIndex].endRow * CELL_SIZE  // Bottom edge of contested zone
      : mapHeight / 2,

    // Zone transition animation state
    zoneTransition: null,

    // Cell/grid config
    cellSize: CELL_SIZE,
    gridWidth: scenario.mapWidth,
    gridHeight: scenario.totalRows,

    // Map size in pixels
    mapWidth: scenario.mapWidth * CELL_SIZE,
    mapHeight,

    // Terrain
    terrain,

    // Camera position - start looking at hero (near bottom of map)
    camera: { x: 0, y: heroY - 300 },

    // Hero
    hero: {
      x: heroX,
      y: heroY,
      angle: -Math.PI / 2,  // Face UP (north)
      hp: heroStats.hp,
      maxHp: heroStats.hp,
      speed: heroStats.speed,
      damage: heroStats.damage,
      fireRate: heroStats.fireRate,
      lastShot: 0,
      unitId: heroStats.id,
      mos,
      isHero: true,
      animId: `hero-${heroStats.id}-${Date.now()}`,  // Unique animation ID
      isMoving: false,
      lastX: heroX,
      lastY: heroY,
      hullAngle: -Math.PI / 2,  // Hull facing direction (separate from aim angle)
      targetHullAngle: -Math.PI / 2,  // Target hull angle for smooth turning
      _currentSpeed: heroStats.speed,  // Start at full speed (no stall on spawn)
      viewRange: UNIT_COMBAT_STATS[heroStats.id]?.viewRange || 950
    },

    // Player units - spawn a starting squad near the hero
    units: createStartingSquad(heroX, heroY, CELL_SIZE),

    // Input state
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, down: false },

    // Enemies
    enemies: [],

    // Projectiles & Effects
    projectiles: [],
    effects: [],

    // Result
    result: null,
    kills: 0,

    // Squad system
    squad: {
      stance: 'autonomous',
      currentOrder: 'hold',
      formation: 'line',
      customFormations: [],
      selectedUnitId: null,
      selectionMode: 'none',
      multiSelectMode: false,
      selectedUnits: [],
      concentrateTarget: null
    },

    // Spotted enemies
    spottedEnemies: [],

    // Command mode
    commandMode: null,
    commandAction: null,
    radioOpen: false
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

// Endless mode run state factory
export function newEndlessRun() {
  return {
    // Run tracking
    wave: 0,
    score: 0,
    kills: 0,
    runStartTime: Date.now(),
    seed: null,  // null = unseeded, string = seeded run

    // UI state
    selectedCategory: 'all',  // Current vehicle category tab
    vehicleLayout: 'list',    // 'list' or 'grid' - vehicle selector layout

    // Loadout (gear brought at risk)
    loadout: {
      vehicle: null,      // Vehicle ID
      variant: null,      // Variant name (e.g. 'desert', 'winter')
      parts: [],          // Attached parts
      insuredItems: []    // Items protected by insurance
    },

    // Insurance
    insuranceCost: 0,     // Total insurance cost paid

    // Loot collected this run
    loot: {
      scrap: 0,
      parts: [],          // Part drops collected
      items: []           // Special items collected
    },

    // Wear tracking (per component)
    wear: {
      barrel: 0,          // Shots fired
      armor: 0,           // Damage absorbed
      tracks: 0,          // Distance traveled
      engine: 0           // Run time (seconds)
    },

    // Run result
    result: null,         // 'exit' | 'death'
    exitWave: null,       // Wave at which player exited/died

    // Battle state (during combat)
    battle: null          // Active battle instance
  };
}

// ── Unit name generator ──────────────────────────────────────
const SURNAMES = [
  'Adams', 'Baker', 'Clark', 'Davis', 'Evans', 'Foster', 'Grant', 'Hayes',
  'Irving', 'Jones', 'Kelly', 'Lopez', 'Mason', 'Nash', 'Ortiz', 'Palmer',
  'Quinn', 'Reed', 'Stone', 'Torres', 'Upton', 'Vega', 'Walsh', 'Young',
  'Abbott', 'Brooks', 'Cole', 'Drake', 'Ellis', 'Flynn', 'Gray', 'Hart',
  'Jacobs', 'Kane', 'Lane', 'Mills', 'Noble', 'Owens', 'Price', 'Reese',
  'Shaw', 'Tate', 'Vale', 'Webb', 'York', 'Cruz', 'Dunn', 'Ford',
  'Gibbs', 'Holt', 'Ives', 'Judd', 'Knox', 'Lake', 'Moss', 'Nolan',
  'Park', 'Rowe', 'Sims', 'Troy', 'Wade', 'Zane', 'Burns', 'Cross'
];
const RANKS = ['PVT', 'PV2', 'PFC', 'SPC', 'CPL', 'SGT'];

let _nameIdx = 0;
export function generateUnitName(leadership = 0) {
  const rank = RANKS[Math.min(RANKS.length - 1, Math.floor(leadership * (RANKS.length - 1)))];
  const surname = SURNAMES[_nameIdx % SURNAMES.length];
  _nameIdx++;
  return { rank, surname, display: `${rank} ${surname}` };
}
export function resetNameGenerator() { _nameIdx = 0; }

// ── Unit factory ─────────────────────────────────────────────
// Single source of truth for creating unit objects. All fields that the
// AI brain, rendering, or replay systems expect MUST be set here.
// Callers override via the `overrides` parameter.

export function createUnit(unitId, overrides = {}) {
  const stats = UNIT_COMBAT_STATS[unitId] || {};
  const unitDef = UNITS.find(u => u.id === unitId);
  const isInfantryType = unitId === 'infantry' || unitId === 'medic' || unitId === 'specops' || unitId === 'stinger';

  const unit = {
    // Identity
    id: overrides.id || `unit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    unitId,

    // Position & orientation
    x: 0,
    y: 0,
    angle: -Math.PI / 2,       // Face north by default
    hullAngle: -Math.PI / 2,

    // Combat stats — prefer UNIT_COMBAT_STATS, fall back to unit def, then defaults
    hp: unitDef?.hp || (isInfantryType ? 60 : 150),
    maxHp: unitDef?.hp || (isInfantryType ? 60 : 150),
    damage: unitDef?.damage || (isInfantryType ? 10 : 30),
    fireRate: stats.fireRate || (isInfantryType ? 1000 : 1500),
    speed: stats.speed || (isInfantryType ? 80 : 70),
    range: stats.range || (isInfantryType ? 350 : 450),
    lastShot: 0,

    // State
    dead: false,
    stability: 0,

    // AI fields (stamped properly by applyBrainDefaults, but must exist)
    aiState: null,
    aiBehavior: null,
    currentOrder: 'hold',
    hasIndividualOrder: false,
    stance: 'autonomous',
    targetPriority: 'nearest',
    isSelected: false,
    _squadId: 0,
  };

  // Apply caller overrides (position, id, hp scaling, etc.)
  Object.assign(unit, overrides);

  // Ensure maxHp matches hp if only hp was overridden
  if (overrides.hp && !overrides.maxHp) unit.maxHp = unit.hp;

  return unit;
}

// Build deployment pool from persistent roster + vehicle inventory
function buildDeploymentPool() {
  const pool = [];

  // Infantry from roster — each soldier becomes a deployable unit
  const infantrySoldiers = getPool('infantry');
  for (let i = 0; i < infantrySoldiers.length; i++) {
    const soldier = infantrySoldiers[i];
    const archetype = INFANTRY_ARCHETYPES[soldier.role] || INFANTRY_ARCHETYPES.rifleman;
    const renderUnitId = ROLE_TO_UNIT_ID[soldier.role] || 'infantry';
    const maxHp = archetype.hp;

    pool.push(createUnit(renderUnitId, {
      id: `roster_inf_${i}`,
      hp: Math.round(maxHp * soldier.hpPercent),
      maxHp,
      damage: archetype.damage,
      fireRate: archetype.fireRate,
      speed: archetype.speed,
      range: archetype.range,
      // Roster link
      _soldierId: soldier.id,
      _role: soldier.role,
      _special: archetype.special || null,
      // Display
      unitName: getRankName(soldier),
      displayName: `${getRankName(soldier)} (${(INFANTRY_ARCHETYPES[soldier.role] ? soldier.role : 'rifleman')})`,
      // Insignia from roster soldier (falls back to global setting)
      _insigniaSetId: soldier.insigniaSetId || Game.settings?.insigniaSetId || null,
      // Personality from roster soldier (will be stamped by applyBrainDefaults, but seed it)
      personality: { ...soldier.personality }
    }));
  }

  // Vehicles from persistent inventory
  const vehicles = getAvailableVehicles();
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const unitDef = UNITS.find(u => u.id === vehicle.unitId);
    const stats = UNIT_COMBAT_STATS[vehicle.unitId] || {};
    const baseHp = unitDef?.hp || 300;
    const maxHp = baseHp;

    pool.push(createUnit(vehicle.unitId, {
      id: `roster_veh_${i}`,
      hp: Math.round(maxHp * vehicle.hpPercent),
      maxHp,
      // Vehicle link
      _vehicleId: vehicle.id,
      _crewSoldierIds: {},
      // Insignia from vehicle inventory (falls back to global setting)
      _insigniaSetId: vehicle.insigniaSetId || Game.settings?.insigniaSetId || null,
      // Display
      unitName: vehicle.name || (unitDef?.name || vehicle.unitId),
      displayName: unitDef?.name || vehicle.unitId
    }));
  }

  return pool;
}

/**
 * Restore the last-used loadout from localStorage.
 * Moves matching units from reservePool → units[] and re-assigns crew.
 */
function _restoreLastLoadout(b) {
  const saved = loadLastLoadout();
  if (!saved || !saved.lineup || saved.lineup.length === 0) return;

  if (saved.formation) b._deployFormation = saved.formation;
  if (saved.presetId) b._selectedPreset = saved.presetId;

  const reserves = b.reservePool || [];

  for (const entry of saved.lineup) {
    // Find a matching unit in the reserve pool
    let idx = -1;

    if (entry._soldierId) {
      // Infantry: match by soldier ID
      idx = reserves.findIndex(r => r._soldierId === entry._soldierId);
    } else if (entry._vehicleId) {
      // Vehicle: match by persistent vehicle ID
      idx = reserves.findIndex(r => r._vehicleId === entry._vehicleId);
    } else {
      // Fallback: match by unitId
      idx = reserves.findIndex(r => r.unitId === entry.unitId);
    }

    if (idx >= 0) {
      const unit = reserves.splice(idx, 1)[0];
      b.units.push(unit);
    }
  }

  // Re-assign crew to vehicles (crew assignments persist in roster via assignedVehicleId)
  // The crew panel will show them correctly on next render
}

// Create AI-controlled ally squad for endless mode testing
function createEndlessSquad(heroX, heroY, mapWidth, mapHeight, cellSize, terrainMap, stageDepth) {
  const units = [];

  // Squad composition: mixed unit types spread across the bottom half
  const squad = [
    { unitId: 'infantry', behavior: 'AGGRESSIVE', order: 'search' },
    { unitId: 'infantry', behavior: 'AGGRESSIVE', order: 'search' },
    { unitId: 'infantry', behavior: 'DEFENSIVE', order: 'hold' },
    { unitId: 'infantry', behavior: 'FLANKER',   order: 'flank' },
    { unitId: 'sherman',  behavior: 'DEFENSIVE', order: 'hold' },
    { unitId: 'sherman',  behavior: 'AGGRESSIVE', order: 'advance' },
  ];

  // Spawn at staging position (off-map, behind bottom edge)
  const spawnCenterX = heroX;
  const spawnCenterY = mapHeight + (stageDepth || 0) / 2;
  const spawnZone = { x: spawnCenterX, y: spawnCenterY, radius: squad.length * 40 };

  squad.forEach((def, i) => {
    // Spread in a line around hero
    const offsetX = (i - squad.length / 2) * 60;
    const offsetY = (Math.random() - 0.5) * 80;
    // Don't validate terrain for off-map positions
    const pos = stageDepth ? { x: spawnZone.x + offsetX, y: spawnZone.y + offsetY } : findValidSpawnPos(spawnZone, offsetX, offsetY, terrainMap);

    const name = generateUnitName(def.unitId === 'sherman' ? 0.6 : 0.1 + Math.random() * 0.3);
    units.push(createUnit(def.unitId, {
      id: `ally_${i}`,
      unitName: name,
      x: pos.x,
      y: pos.y,
      currentOrder: def.order,
      _behaviorKey: def.behavior,
    }));
  });

  return units;
}

// Endless battle factory - creates a battle instance for endless mode
export function newEndlessBattle(loadout, wave = 1) {
  const CELL_SIZE = 64;

  // Get seed and generate terrain config
  const seed = Game.endless?.seed || null;
  const battleSeed = seed ? (typeof seed === 'string' ? hashString(seed) : seed) + wave : Math.floor(Math.random() * 999999);
  const varied = Game.terrainImages ? randomizeBattleConfig(battleSeed) : null;

  // Map size tiers — smaller start, ~50% growth per tier
  // Waves 1-3: small (1 squad max), 4-7: medium (2), 8-12: large (3), 13+: xl (3)
  const SIZE_TIERS = [
    { maxWave: 3,  grid: 24, label: 'Patrol',      enemyMult: 1.0, maxSquads: 1 },
    { maxWave: 7,  grid: 32, label: 'Sortie',      enemyMult: 1.3, maxSquads: 2 },
    { maxWave: 12, grid: 42, label: 'Operation',   enemyMult: 1.6, maxSquads: 3 },
    { maxWave: Infinity, grid: 52, label: 'Campaign', enemyMult: 2.0, maxSquads: 3 }
  ];
  const sizeTier = SIZE_TIERS.find(t => wave <= t.maxWave) || SIZE_TIERS[SIZE_TIERS.length - 1];
  const gridWidth = sizeTier.grid;
  const gridHeight = sizeTier.grid;
  const mapWidth = gridWidth * CELL_SIZE;
  const mapHeight = gridHeight * CELL_SIZE;

  // Generate fallback terrain
  const terrain = generateEndlessTerrain(gridWidth, gridHeight, wave, seed);

  // Staging depth for off-map spawn (wave 1 only)
  const stageDepth = Math.round(mapHeight * 0.1); // Always have staging area for blue march-in

  // Hero position: wave 1 starts off-map (behind bottom edge), later waves on-map
  const heroX = mapWidth / 2;
  const heroY = wave === 1 ? mapHeight + stageDepth / 2 : mapHeight - CELL_SIZE * 3;

  // Get vehicle stats from loadout
  const vehicleId = loadout?.vehicle || 'abrams';
  const vehicleDef = UNITS.find(u => u.id === vehicleId);

  // Default hero stats (heavy tank feel — slow, powerful)
  const heroStats = {
    id: vehicleId,
    hp: vehicleDef?.hp || 200,
    speed: 70,         // Slow tank: positioning matters
    damage: vehicleDef?.damage || 40,
    fireRate: 3000     // Deliberate shots: every hit counts
  };

  // Generate PCG terrain if images are preloaded
  let terrainCanvases = null;
  let terrainMap = null;
  let pcgSpawnZones = null;
  let terrainLabel = null;
  let terrainConfig = null;
  if (Game.terrainImages && varied) {
    try {
      terrainConfig = { biome: varied.biome, season: varied.season, templateName: varied.templateName, pcgParams: { ...varied.pcgParams } };
      const pcg = generateBattleTerrain({
        mapWidth, mapHeight, cellSize: CELL_SIZE,
        biome: varied.biome, season: varied.season,
        seed: battleSeed,
        images: Game.terrainImages,
        pcgParams: varied.pcgParams
      });
      terrainCanvases = { terrainCanvas: pcg.terrainCanvas, canopyCanvas: pcg.canopyCanvas, bridgeDeckCanvas: pcg.bridgeDeckCanvas };
      terrainMap = pcg.terrainMap;
      pcgSpawnZones = pcg.spawnZones;
      terrainLabel = `${sizeTier.label}: ${varied.templateName} (${varied.season}) #${battleSeed}`;
    } catch (err) {
      console.warn('[state] PCG terrain generation failed, using fallback:', err);
    }
  }

  const battle = {
    // Mode identifier
    mode: 'endless',

    // Cell/grid config
    cellSize: CELL_SIZE,
    gridWidth,
    gridHeight,

    // Difficulty scaling from map size tier
    sizeTier: sizeTier.label,
    _sizeTier: sizeTier,
    enemyMult: sizeTier.enemyMult,

    // Map size in pixels
    mapWidth,
    mapHeight,

    // Terrain (fallback)
    terrain,

    // PCG terrain (pre-rendered canvases)
    terrainCanvases,
    terrainMap,
    pcgSpawnZones,
    terrainLabel,
    terrainSeed: battleSeed,
    terrainConfig,

    // Camera - start centered on hero
    camera: { x: 0, y: heroY - 300, lookX: 0, lookY: 0 },

    // Hero (player's tank) — stable ID so crew assignments persist across battles
    hero: {
      id: 'hero',
      x: heroX,
      y: heroY,
      angle: -Math.PI / 2,  // Face UP (north)
      hp: heroStats.hp,
      maxHp: heroStats.hp,
      speed: heroStats.speed,
      damage: heroStats.damage,
      fireRate: heroStats.fireRate,
      lastShot: 0,
      unitId: vehicleId,
      unitName: { rank: 'LT', surname: 'Commander', display: 'LT Commander' },
      variantId: loadout?.variant || 'default',
      isHero: true,
      animId: `hero-${vehicleId}-${Date.now()}`,
      isMoving: false,
      lastX: heroX,
      lastY: heroY,
      hullAngle: -Math.PI / 2,
      targetHullAngle: -Math.PI / 2,
      _currentSpeed: heroStats.speed,
      viewRange: UNIT_COMBAT_STATS[vehicleId]?.viewRange || 950,
      viewCone: 360,
      _awareness: 0.6
    },

    // Player-built squad — starts empty, populated from deploy panel (roster)
    units: [],

    // Deployment pool — built from persistent roster + vehicle inventory
    reservePool: null,  // Populated after battle object creation

    // Input state
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, down: false },
    joystickInput: null,  // { moveX, moveY, aimX, aimY }
    aimAngle: null,       // Direct aim angle from joystick

    // Enemies
    enemies: [],
    enemiesRemaining: 0,
    enemiesSpawned: 0,

    // Projectiles & Effects
    projectiles: [],
    effects: [],

    // Wave tracking
    wave,
    waveStartTime: Date.now(),
    waveComplete: false,

    // Result
    result: null,  // null | 'victory' | 'defeat'
    kills: 0,

    // Command UI feedback
    commandFeedback: null,

    // Deployment phase (wave 1 only — later waves spawn mid-combat)
    phase: wave === 1 ? 'deploying' : 'active',
    deployReady: { blue: wave !== 1, red: wave !== 1 },
    countdownStart: null,
    playMode: 'unit',              // 'unit' | 'sgt' | 'cmd' (only 'unit' implemented)
    stageDepth,
    deployZones: null  // Set below
  };

  // Build deployment zones: 3 zones per edge (ALPHA / BRAVO / CHARLIE)
  const zoneNames = ['ALPHA', 'BRAVO', 'CHARLIE'];
  const zoneW = mapWidth / 3;
  battle.deployZones = {
    blue: zoneNames.map((name, i) => ({
      name,
      x: i * zoneW,
      y: mapHeight - CELL_SIZE * 2,
      width: zoneW,
      height: CELL_SIZE * 2,
      units: [],
      selected: false
    })),
    red: zoneNames.map((name, i) => ({
      name,
      x: i * zoneW,
      y: 0,
      width: zoneW,
      height: CELL_SIZE * 2,
      units: [],
      selected: false
    }))
  };

  // Initialize unified AI pipeline
  const blueZone = { x: battle.mapWidth / 2, y: battle.mapHeight - battle.cellSize * 3, radius: 100 };
  const redZone = { x: battle.mapWidth / 2, y: battle.cellSize * 3, radius: 100 };
  // Init AI pipeline — skip blue squads (units not deployed yet, deploy panel fills them)
  // Blue squad + sergeant created when player hits DEPLOY via _reinitBlueSquad()
  initBattleAI(battle, {
    allyPreset: 'endlessAlly', enemyPreset: 'endlessEnemy',
    blueSpawnZone: blueZone, redSpawnZone: redZone,
    insigniaSetId: Game.settings.insigniaSetId,
    maxSquads: sizeTier.maxSquads,
    redCommanderOrigin: Game.settings?.redCommanderOrigin,
    skipBlueSquads: true
  });

  // Build deployment pool from persistent roster + vehicle inventory
  battle.reservePool = buildDeploymentPool();

  // Auto-restore last-used loadout if available
  _restoreLastLoadout(battle);

  return battle;
}

// Generate terrain for endless battles using WorldBuilder
function generateEndlessTerrain(width, height, wave, seed = null) {
  // Combine seed with wave for unique terrain per wave while keeping determinism
  const waveSeed = seed ? `${seed}-wave-${wave}` : null;

  return WorldBuilder.generate({
    mode: 'endless',
    width,
    height,
    wave,
    seed: waveSeed
  });
}

// ═══════════════════════════════════════════════════════════════
// FIRE RANGE — AI test bed with configurable teams
// ═══════════════════════════════════════════════════════════════

const DEFAULT_FIRE_RANGE_CONFIG = {
  blueSquads: [
    {
      name: 'Alpha',
      sergeant: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
      formation: 'line',
      units: [
        { unitId: 'infantry', count: 4, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 },
        { unitId: 'sherman',  count: 2, command: 'hold',    aggression: 0.3, patience: 0.7, courage: 0.6, discipline: 0.7, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.5, tgtWeakness: 0.3, tgtThreat: 0.5, tgtValue: 0.0 }
      ]
    }
  ],
  redSquads: [
    {
      name: 'Alpha',
      sergeant: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
      formation: 'line',
      units: [
        { unitId: 'infantry', count: 4, command: 'advance', aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0 },
        { unitId: 'sherman',  count: 2, command: 'hold',    aggression: 0.3, patience: 0.7, courage: 0.6, discipline: 0.7, initiative: 0.5, veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false, tgtDistance: 0.5, tgtWeakness: 0.3, tgtThreat: 0.5, tgtValue: 0.0 }
      ]
    }
  ],
  blueCommander: { personality: {} },
  redCommander: { personality: {} },
  mapSize: 'medium',
  debug: {
    blueInvincible: false,
    redInvincible: false,
    noCooldowns: false,
    showRanges: false
  }
};

export function newFireRangeRun() {
  return {
    config: JSON.parse(JSON.stringify(DEFAULT_FIRE_RANGE_CONFIG)),
    battle: null,
    result: null,   // 'blue_wins' | 'red_wins' | null
    elapsed: 0,
    scenarioName: null  // Set when loading a preset
  };
}

// Combat stats for units in fire range.
// hp/speed/damage/fireRate are unique here; range/viewRange/viewCone come from
// UNIT_COMBAT_STATS (single source of truth in constants.js).
const _FR_BASE = {
  infantry: { hp: 180, speed: 80,  damage: 10, fireRate: 1000 },
  medic:    { hp: 135, speed: 75,  damage: 5,  fireRate: 1200 },
  specops:  { hp: 150, speed: 90,  damage: 18, fireRate: 700  },
  jeep:     { hp: 240, speed: 120, damage: 15, fireRate: 800  },
  humvee:   { hp: 300, speed: 100, damage: 20, fireRate: 900  },
  sherman:  { hp: 450, speed: 60,  damage: 30, fireRate: 1500 },
  tiger:    { hp: 600, speed: 50,  damage: 45, fireRate: 2000 },
  abrams:   { hp: 750, speed: 55,  damage: 60, fireRate: 1800 },
  howitzer: { hp: 240, speed: 30,  damage: 80, fireRate: 3000 },
  apache:   { hp: 360, speed: 130, damage: 35, fireRate: 1000 }
};
const FR_UNIT_STATS = Object.fromEntries(
  Object.entries(_FR_BASE).map(([id, base]) => [
    id,
    { ...base, ...(UNIT_COMBAT_STATS[id] || {}) }
  ])
);

const FR_MAP_SIZES = {
  small:  { grid: 20, label: 'Small' },
  medium: { grid: 28, label: 'Medium' },
  large:  { grid: 36, label: 'Large' }
};

export function newFireRangeBattle(config) {
  const CELL_SIZE = 64;
  const sizeInfo = FR_MAP_SIZES[config.mapSize] || FR_MAP_SIZES.medium;
  const gridWidth = sizeInfo.grid;
  const gridHeight = sizeInfo.grid;
  const mapWidth = gridWidth * CELL_SIZE;
  const mapHeight = gridHeight * CELL_SIZE;

  // Generate terrain (use config seed if provided, otherwise random)
  const battleSeed = config.terrainSeed || Math.floor(Math.random() * 999999);
  const terrain = generateEndlessTerrain(gridWidth, gridHeight, 1, null);
  const varied = Game.terrainImages ? randomizeBattleConfig(battleSeed) : null;

  let terrainCanvases = null;
  let terrainMap = null;
  let pcgSpawnZones = null;
  let terrainLabel = null;
  let terrainConfig = null;
  if (Game.terrainImages && varied) {
    try {
      terrainConfig = { biome: varied.biome, season: varied.season, templateName: varied.templateName, pcgParams: { ...varied.pcgParams } };
      const pcg = generateBattleTerrain({
        mapWidth, mapHeight, cellSize: CELL_SIZE,
        biome: varied.biome, season: varied.season,
        seed: battleSeed,
        images: Game.terrainImages,
        pcgParams: varied.pcgParams
      });
      terrainCanvases = { terrainCanvas: pcg.terrainCanvas, canopyCanvas: pcg.canopyCanvas, bridgeDeckCanvas: pcg.bridgeDeckCanvas };
      terrainMap = pcg.terrainMap;
      pcgSpawnZones = pcg.spawnZones;
      terrainLabel = `${sizeInfo.label}: ${varied.templateName} (${varied.season}) #${battleSeed}`;
    } catch (err) {
      console.warn('[fire-range] PCG terrain failed, using fallback:', err);
    }
  }

  // Determine spawn centers from PCG zones or fall back to fixed positions
  let blueSpawnZone, redSpawnZone;
  if (pcgSpawnZones && pcgSpawnZones.length >= 2) {
    // Sort by Y: lower Y = top (red), higher Y = bottom (blue)
    const sorted = [...pcgSpawnZones].sort((a, b) => a.y - b.y);
    redSpawnZone = sorted[0];
    blueSpawnZone = sorted[1];
  } else {
    blueSpawnZone = { x: mapWidth / 2, y: mapHeight - CELL_SIZE * 4, radius: 180 };
    redSpawnZone = { x: mapWidth / 2, y: CELL_SIZE * 4, radius: 180 };
  }

  // Backwards compat: wrap flat blueTeam/redTeam into single squad
  const blueSquads = config.blueSquads || [{ name: 'Alpha', sergeant: config.blueSergeant || {}, formation: 'line', units: config.blueTeam || [] }];
  const redSquads = config.redSquads || [{ name: 'Alpha', sergeant: config.redSergeant || {}, formation: 'line', units: config.redTeam || [] }];

  // Short type abbreviations for readable IDs
  const _abbr = (s) => {
    const map = { infantry:'inf', medic:'med', specops:'spc', jeep:'jep', humvee:'hmv',
      sherman:'shm', tiger:'tgr', abrams:'abr', howitzer:'how', apache:'apc',
      swarmer:'swm', scout:'sct', grunt:'grt', heavy:'hvy', elite:'elt' };
    return map[s] || s.slice(0, 3);
  };
  const _typeCounts = {};

  // Spawn blue team (allies) in blue spawn zone — iterate squads
  const blueUnits = [];
  let blueIdx = 0;
  for (let si = 0; si < blueSquads.length; si++) {
    const squadDef = blueSquads[si];
    for (const slot of squadDef.units) {
      const stats = FR_UNIT_STATS[slot.unitId];
      if (!stats) continue;
      const abbr = _abbr(slot.unitId);
      for (let i = 0; i < slot.count; i++) {
        const typeNum = (_typeCounts[abbr] = (_typeCounts[abbr] || 0) + 1) - 1;
        const offsetX = (blueIdx - 3) * 60 + (Math.random() - 0.5) * 30;
        const offsetY = (Math.random() - 0.5) * 80;
        const spawnPos = findValidSpawnPos(blueSpawnZone, offsetX, offsetY, terrainMap);
        blueUnits.push({
          id: `b.${abbr}.${typeNum}`,
          team: Team.BLUE,
          unitId: slot.unitId,
          x: spawnPos.x,
          y: spawnPos.y,
          hp: stats.hp,
          maxHp: stats.hp,
          damage: stats.damage,
          fireRate: stats.fireRate,
          speed: stats.speed,
          range: stats.range,
          viewRange: stats.viewRange || 200,
          viewCone: stats.viewCone || 140,
          lastShot: 0,
          angle: -Math.PI / 2,
          hullAngle: -Math.PI / 2,
          dead: false,
          // Brain fields from config
          command: slot.command || 'advance',
          personality: {
            aggression: slot.aggression ?? 0.5,
            patience: slot.patience ?? 0.5,
            courage: slot.courage ?? 0.5,
            discipline: slot.discipline ?? 0.5,
            initiative: slot.initiative ?? 0.5
          },
          targeting: {
            distance: slot.tgtDistance ?? 0.7,
            weakness: slot.tgtWeakness ?? 0.3,
            threat: slot.tgtThreat ?? 0.0,
            value: slot.tgtValue ?? 0.0
          },
          awareness: slot.awareness ?? 0.5,
          leadership: slot.leadership ?? 0,
          morale: slot.morale ?? 0.8,
          veterancy: slot.veterancy ?? 0,
          isHero: slot.isLeader || false,
          isLeader: slot.isLeader || false,
          isSelected: false,
          _suppression: 0,
          _squadId: si
        });
        blueIdx++;
      }
    }
  }

  // Spawn red team (enemies) in red spawn zone — iterate squads
  // Supports unitId (same stats as blue via FR_UNIT_STATS) or enemyType (legacy ENEMIES defs)
  const redEnemies = [];
  let redIdx = 0;
  const _redCounts = {};
  for (let si = 0; si < redSquads.length; si++) {
    const squadDef = redSquads[si];
    for (const slot of squadDef.units) {
      // Resolve stats: unitId path (FR_UNIT_STATS) or enemyType path (ENEMIES)
      const usePlayerStats = slot.unitId && FR_UNIT_STATS[slot.unitId];
      const stats = usePlayerStats ? FR_UNIT_STATS[slot.unitId] : null;
      const enemyDef = !usePlayerStats ? ENEMIES.find(e => e.id === slot.enemyType) : null;
      if (!stats && !enemyDef) continue;

      const typeKey = slot.unitId || slot.enemyType;
      const rAbbr = _abbr(typeKey);
      for (let i = 0; i < slot.count; i++) {
        const typeNum = (_redCounts[rAbbr] = (_redCounts[rAbbr] || 0) + 1) - 1;
        const offsetX = (redIdx - 3) * 60 + (Math.random() - 0.5) * 30;
        const offsetY = (Math.random() - 0.5) * 80;
        const spawnPos = findValidSpawnPos(redSpawnZone, offsetX, offsetY, terrainMap);
        const enemy = {
          id: `r.${rAbbr}.${typeNum}`,
          team: Team.RED,
          unitId: typeKey,
          x: spawnPos.x,
          y: spawnPos.y,
          hp: stats ? stats.hp : enemyDef.health,
          maxHp: stats ? stats.hp : enemyDef.health,
          damage: stats ? stats.damage : enemyDef.damage,
          speed: stats ? stats.speed : enemyDef.speed * 50,
          fireRate: stats ? stats.fireRate : 2000,
          range: stats ? stats.range : (enemyDef.range || 100),
          viewRange: stats ? stats.viewRange : (FR_UNIT_STATS[enemyDef?.unitId]?.viewRange || 200),
          viewCone: stats ? stats.viewCone : (FR_UNIT_STATS[enemyDef?.unitId]?.viewCone || 140),
          angle: Math.PI / 2,
          hullAngle: Math.PI / 2,
          dead: false,
          stability: 0,
          recentDamageFrom: {},
          lastAttack: 0,
          // Brain fields from config
          command: slot.command || 'advance',
          personality: {
            aggression: slot.aggression ?? 0.5,
            patience: slot.patience ?? 0.5,
            courage: slot.courage ?? 0.5,
            discipline: slot.discipline ?? 0.5,
            initiative: slot.initiative ?? 0.5
          },
          targeting: {
            distance: slot.tgtDistance ?? 0.7,
            weakness: slot.tgtWeakness ?? 0.3,
            threat: slot.tgtThreat ?? 0.0,
            value: slot.tgtValue ?? 0.0
          },
          awareness: slot.awareness ?? 0.5,
          leadership: slot.leadership ?? 0,
          morale: slot.morale ?? 0.8,
          veterancy: slot.veterancy ?? 0,
          isHero: slot.isLeader || false,
          isLeader: slot.isLeader || false,
          _suppression: 0,
          _squadId: si
        };
        redEnemies.push(enemy);
        redIdx++;
      }
    }
  }

  // Auto-assign leader by highest leadership stat if none flagged
  let blueLeader = blueUnits.find(u => u.isLeader);
  if (!blueLeader && blueUnits.length > 0) {
    blueLeader = blueUnits.reduce((best, u) => (u.leadership ?? 0) > (best.leadership ?? 0) ? u : best, blueUnits[0]);
    blueLeader.isLeader = true;
  }

  // Hero: only include as a combatant if config.includeHero is true (default: observer)
  let battleHero = null;
  if (config.includeHero && blueLeader) {
    blueLeader.isHero = true;
    battleHero = blueLeader;
  } else {
    // Observer hero — hidden far off-map, won't be targeted or rendered
    battleHero = {
      x: -9999, y: -9999,
      hp: 99999, maxHp: 99999,
      speed: 0, damage: 0, fireRate: 99999,
      angle: 0, hullAngle: 0, targetHullAngle: 0,
      lastShot: 0, isHero: true, observer: true,
      lastX: -9999, lastY: -9999,
      velocity: 0, unitId: 'abrams',
      animId: null, isMoving: false
    };
  }

  // Auto-assign enemy leader by highest leadership stat if none flagged
  let enemyLeader = redEnemies.find(e => e.isLeader);
  if (!enemyLeader && redEnemies.length > 0) {
    enemyLeader = redEnemies.reduce((best, e) => (e.leadership ?? 0) > (best.leadership ?? 0) ? e : best, redEnemies[0]);
    enemyLeader.isLeader = true;
  }

  const battle = {
    mode: 'fire_range',
    fireRange: true,

    cellSize: CELL_SIZE,
    gridWidth, gridHeight,
    mapWidth, mapHeight,

    terrain,
    terrainCanvases,
    terrainMap,
    pcgSpawnZones,
    terrainLabel,
    terrainSeed: battleSeed,
    terrainConfig,

    // Spawn zone assignments (for rendering + future capture mechanics)
    blueSpawnZone,
    redSpawnZone,

    // Camera starts near blue spawn (refined in game.js drawHeroBattle)
    camera: { x: mapWidth / 2 - 400, y: blueSpawnZone.y - 300, lookX: 0, lookY: 0 },

    // Hero (promoted blue leader or off-map observer)
    hero: battleHero,
    enemyLeader,

    // Teams
    units: blueUnits,
    enemies: redEnemies,

    // Debug options from config
    debug: config.debug ? { ...config.debug } : {},

    // Standard battle fields
    projectiles: [],
    effects: [],
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, down: false },
    joystickInput: null,
    aimAngle: null,

    // No wave system
    wave: 1,
    waveStartTime: Date.now(),
    waveComplete: false,
    enemiesRemaining: 0,
    spawnQueue: [],
    kills: 0,
    result: null,
    commandFeedback: null,

    // Commander UI state
    _commanderUI: {
      selectedSquadId: null,
      pendingOrder: null,       // Objective type awaiting map click (for positional orders)
      visible: true
    },

    // Debug telemetry
    debugOverlay: false,
    showTerrainGrid: 0,
    _debugLog: []
  };

  // Initialize unified AI pipeline (fire range units already have brain fields from config)
  initBattleAI(battle, {
    allyPreset: 'campaignAlly',
    enemyPreset: 'campaignEnemy',
    blueSpawnZone,
    redSpawnZone,
    insigniaSetId: Game.settings.insigniaSetId,
    config: {
      blueCommander: config.blueCommander,
      redCommander: config.redCommander
    }
  });

  // Restore squad-specific sergeant configs
  let blueSquadIdx = 0;
  let redSquadIdx = 0;
  for (const sq of battle._squads) {
    if (sq.team === 'blue' && blueSquads[blueSquadIdx]) {
      sq.sergeant.personality = { ...sq.sergeant.personality, ...blueSquads[blueSquadIdx].sergeant };
      sq.formation = blueSquads[blueSquadIdx].formation || 'line';
      blueSquadIdx++;
    } else if (sq.team === 'red' && redSquads[redSquadIdx]) {
      sq.sergeant.personality = { ...sq.sergeant.personality, ...redSquads[redSquadIdx].sergeant };
      sq.formation = redSquads[redSquadIdx].formation || 'line';
      redSquadIdx++;
    }
  }

  // Track team leaders (unit-level, separate from commander AI objects)
  battle._teamLeaders = {
    blue: blueLeader || null,
    red: enemyLeader || null
  };

  return battle;
}
