// ═══════════════════════════════════════════════════════════════
// AI PIPELINE — Central orchestration for all AI systems
//
// Provides a unified per-frame AI pipeline that replaces
// inline AI code in all battle modes (campaign, endless, fire range).
//
// Architecture: Commanders → Squads → Sergeants → Formations → Brains → Intel
// ═══════════════════════════════════════════════════════════════

import { Team, UNIT_COMBAT_STATS } from './constants.js';
import { updateStability } from './fire-decision.js';
import { Objective, Play, COMMANDER_PRESETS, COMMANDER_TRAIT_PRESETS, createCommander, updateCommander, assignObjective, scaleCommanderByWave, planDeployment, getEdgeSpawnZones, initDefenseZones } from './commander.js';
import { createSergeant, updateSergeant } from './sergeant.js';
import {
  updateUnitAI,
  updateEnemyAI,
  updateFormation,
  shareTeamIntel,
  Command
} from './ai.js';
import { updateModifierEffects } from './elite-modifiers.js';
import { buildSpottedList } from './vision.js';
import { logEvent } from './battle-log.js';

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC UNIT HASH — Personality-driven desync seed
// ═══════════════════════════════════════════════════════════════

/** Simple deterministic hash from unit id string → 0-1 float */
function hashUnitId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// PERSONALITY PRESETS — Named archetypes for unit personality
// Each defines 6 traits + spread (per-unit variance range).
// Used in fire range config, endless spawning, and campaign.
// ═══════════════════════════════════════════════════════════════

export const PERSONALITY_PRESETS = {
  random:     { label: 'Random',     spread: 0.5,
    traits: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.5 } },
  aggressive: { label: 'Aggressive', spread: 0.15,
    traits: { aggression: 0.85, patience: 0.2, courage: 0.7, discipline: 0.3, initiative: 0.7, awareness: 0.4 } },
  cautious:   { label: 'Cautious',   spread: 0.15,
    traits: { aggression: 0.2, patience: 0.8, courage: 0.4, discipline: 0.7, initiative: 0.3, awareness: 0.7 } },
  disciplined:{ label: 'Disciplined',spread: 0.1,
    traits: { aggression: 0.4, patience: 0.7, courage: 0.6, discipline: 0.9, initiative: 0.4, awareness: 0.6 } },
  reckless:   { label: 'Reckless',   spread: 0.15,
    traits: { aggression: 0.9, patience: 0.1, courage: 0.8, discipline: 0.1, initiative: 0.8, awareness: 0.3 } },
  veteran:    { label: 'Veteran',    spread: 0.1,
    traits: { aggression: 0.5, patience: 0.7, courage: 0.7, discipline: 0.8, initiative: 0.6, awareness: 0.8 } },
  green:      { label: 'Green',      spread: 0.2,
    traits: { aggression: 0.3, patience: 0.3, courage: 0.3, discipline: 0.3, initiative: 0.2, awareness: 0.3 } },
  sniper:     { label: 'Sniper',     spread: 0.1,
    traits: { aggression: 0.2, patience: 0.95, courage: 0.5, discipline: 0.9, initiative: 0.3, awareness: 0.9 } },
  berserker:  { label: 'Berserker',  spread: 0.1,
    traits: { aggression: 1.0, patience: 0.0, courage: 0.9, discipline: 0.0, initiative: 0.6, awareness: 0.2 } },
};

/**
 * Generate personality traits from a preset with per-unit variance.
 * @param {string} presetName - Key into PERSONALITY_PRESETS (or 'custom' to skip)
 * @param {object} [overrides] - Optional trait overrides (for 'custom' mode)
 * @returns {object} Personality object with 6 traits
 */
export function personalityFromPreset(presetName, overrides) {
  if (presetName === 'custom' && overrides) {
    return { ...overrides };
  }
  const preset = PERSONALITY_PRESETS[presetName] || PERSONALITY_PRESETS.random;
  const spread = presetName === 'random' ? preset.spread : preset.spread;
  const result = {};
  for (const [k, v] of Object.entries(preset.traits)) {
    const raw = v + (Math.random() - 0.5) * 2 * spread;
    result[k] = Math.max(0, Math.min(1, raw));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// BRAIN PRESETS — Config-driven defaults per mode
// ═══════════════════════════════════════════════════════════════

export const BRAIN_PRESETS = {
  campaignAlly: {
    command: 'hold',
    personality: { aggression: 0.4, patience: 0.6, courage: 0.5, discipline: 0.7, initiative: 0.4 },
    targeting: { distance: 0.6, weakness: 0.3, threat: 0.1, value: 0.0 },
    awareness: 0.5, leadership: 0, morale: 0.8, veterancy: 0
  },
  campaignEnemy: {
    command: 'advance',
    personality: { aggression: 0.6, patience: 0.3, courage: 0.4, discipline: 0.3, initiative: 0.3 },
    targeting: { distance: 0.8, weakness: 0.1, threat: 0.1, value: 0.0 },
    awareness: 0.3, leadership: 0, morale: 0.6, veterancy: 0
  },
  endlessAlly: {
    command: 'advance',
    personality: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5 },
    targeting: { distance: 0.7, weakness: 0.3, threat: 0.0, value: 0.0 },
    awareness: 0.5, leadership: 0, morale: 0.8, veterancy: 0
  },
  endlessEnemy: {
    command: 'advance',
    personality: { aggression: 0.5, patience: 0.4, courage: 0.4, discipline: 0.3, initiative: 0.3 },
    targeting: { distance: 0.8, weakness: 0.2, threat: 0.0, value: 0.0 },
    awareness: 0.3, leadership: 0, morale: 0.6, veterancy: 0
  }
};

// ═══════════════════════════════════════════════════════════════
// BRAIN DEFAULTS — Stamp brain fields onto units
// ═══════════════════════════════════════════════════════════════

/**
 * Stamps brain fields onto a unit that doesn't have them.
 * Non-destructive — won't overwrite existing fields.
 * @param {object} unit - The unit to stamp
 * @param {object|string} presetOrName - A preset object or key into BRAIN_PRESETS
 */
export function applyBrainDefaults(unit, presetOrName) {
  const preset = typeof presetOrName === 'string'
    ? BRAIN_PRESETS[presetOrName] || BRAIN_PRESETS.campaignEnemy
    : presetOrName;

  // Command
  if (unit.command === undefined) unit.command = preset.command || Command.ADVANCE;

  // Personality — use personalityPreset if set, otherwise copy from brain preset with spread
  if (!unit.personality) {
    if (unit.personalityPreset) {
      unit.personality = personalityFromPreset(unit.personalityPreset);
    } else {
      // Brain preset personality + per-unit spread so units aren't identical
      const base = preset.personality;
      unit.personality = {};
      const spread = 0.15;
      for (const k of Object.keys(base)) {
        const raw = base[k] + (Math.random() - 0.5) * 2 * spread;
        unit.personality[k] = Math.max(0, Math.min(1, raw));
      }
    }
  } else {
    const p = preset.personality;
    for (const k of Object.keys(p)) {
      if (unit.personality[k] === undefined) unit.personality[k] = p[k];
    }
  }

  // Targeting weights
  if (!unit.targeting) {
    unit.targeting = { ...preset.targeting };
  } else {
    const t = preset.targeting;
    for (const k of Object.keys(t)) {
      if (unit.targeting[k] === undefined) unit.targeting[k] = t[k];
    }
  }

  // Scalar brain fields (with spread so units aren't clones)
  if (unit.awareness === undefined) {
    const baseAwr = preset.awareness ?? 0.5;
    unit.awareness = Math.max(0, Math.min(1, baseAwr + (Math.random() - 0.5) * 0.3));
  }
  if (unit.leadership === undefined) unit.leadership = preset.leadership ?? 0;
  if (unit.morale === undefined) unit.morale = preset.morale ?? 0.8;
  if (unit.veterancy === undefined) unit.veterancy = preset.veterancy ?? 0;
  if (unit.viewRange === undefined) {
    const combatStats = UNIT_COMBAT_STATS[unit.unitId];
    unit.viewRange = preset.viewRange ?? combatStats?.viewRange ?? 400;
  }
  if (unit.viewCone === undefined) {
    const combatStats = UNIT_COMBAT_STATS[unit.unitId];
    unit.viewCone = preset.viewCone ?? combatStats?.viewCone ?? 140;
  }

  // Squad assignment
  if (unit._squadId === undefined) unit._squadId = 0;

  // Suppression init
  if (unit._suppression === undefined) unit._suppression = 0;

  // Personality-driven timer stagger — desynchronize units within a squad
  // Uses deterministic hash so behavior is reproducible, not random
  const hash = hashUnitId(unit.id);
  const initiative = unit.personality?.initiative ?? 0.5;

  // Fire timing: initiative drives readiness at battle start
  if (unit.lastShot === undefined) {
    const maxDelay = unit.fireRate || 2000;
    unit.lastShot = -(hash * maxDelay * (0.5 + initiative * 0.5));
  }

  // Eval timer stagger: each unit's "rhythm" based on personality hash
  const evalSpread = 800;
  if (unit._lastSurvivalCheck === undefined) unit._lastSurvivalCheck = -(hash * evalSpread);
  if (unit._lastTargetLockCheck === undefined) unit._lastTargetLockCheck = -(hash * evalSpread * 0.7);
  if (unit._lastFlankCheck === undefined) unit._lastFlankCheck = -(hash * evalSpread * 1.3);
  if (unit._lastCoverCheck === undefined) unit._lastCoverCheck = -(hash * evalSpread * 0.9);
}

// ═══════════════════════════════════════════════════════════════
// WAVE SCALING — Progressive difficulty
// ═══════════════════════════════════════════════════════════════

/**
 * Returns a new preset with stats scaled by wave number.
 * Awareness, courage, discipline, veterancy ramp up.
 */
export function scaleBrainByWave(preset, wave) {
  const w = Math.max(1, wave);
  const scale = Math.min((w - 1) * 0.04, 0.5); // 4% per wave, cap at +0.5
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    ...preset,
    personality: {
      ...preset.personality,
      courage:    clamp((preset.personality.courage    || 0.5) + scale * 0.6, 0, 1),
      discipline: clamp((preset.personality.discipline || 0.5) + scale * 0.5, 0, 1),
      initiative: clamp((preset.personality.initiative || 0.3) + scale * 0.3, 0, 1)
    },
    awareness: clamp((preset.awareness || 0.3) + scale * 0.8, 0, 1),
    veterancy: clamp((preset.veterancy || 0)   + scale * 1.0, 0, 1)
  };
}

// ═══════════════════════════════════════════════════════════════
// SQUAD — Data model + helpers
// ═══════════════════════════════════════════════════════════════

let _nextSquadId = 0;

/**
 * Creates a squad struct. Auto-assigns sergeant from highest-leadership member.
 * @param {string} team - Team.BLUE or Team.RED
 * @param {object[]} members - Unit objects (already in b.units or b.enemies)
 * @param {object} opts - { spawnZone, enemyZone, personality, formation, command }
 * @returns {object} Squad struct
 */
export function createSquad(team, members, opts = {}) {
  const id = _nextSquadId++;
  const aliveMembers = members.filter(u => !u.dead);

  // Assign _squadId to all members
  for (const u of members) {
    u._squadId = id;
  }

  // Find highest-leadership member for sergeant
  let sgtUnit = null;
  let highestLeadership = -1;
  for (const u of aliveMembers) {
    const lead = u.leadership || 0;
    if (lead > highestLeadership) {
      highestLeadership = lead;
      sgtUnit = u;
    }
  }
  // If no one has leadership, pick first alive member
  if (!sgtUnit && aliveMembers.length > 0) {
    sgtUnit = aliveMembers[0];
  }

  const spawnZone = opts.spawnZone || { x: sgtUnit?.x || 0, y: sgtUnit?.y || 0, radius: 100 };
  const enemyZone = opts.enemyZone || { x: spawnZone.x, y: 0, radius: 100 };
  const sgtPersonality = opts.personality || sgtUnit?.personality || {};

  const sergeant = createSergeant(team, sgtPersonality, spawnZone, enemyZone, id);

  const squad = {
    id,
    team,
    active: aliveMembers.length > 0,
    sergeantUnitId: sgtUnit?.id || null,
    sergeant,
    formation: opts.formation || 'line',
    command: opts.command || 'advance',
    members: members.map(u => u.id)
  };

  // Stamp ranks on all members
  stampSquadRanks(squad, members);

  return squad;
}

/**
 * Assign military ranks to all members of a squad based on role and leadership.
 * Ranks: 0=PVT, 1=PV2, 2=PFC, 3=SPC, 4=CPL, 5=SGT
 * @param {object} squad - Squad struct
 * @param {object[]} unitPool - Array of unit objects to search
 */
function stampSquadRanks(squad, unitPool) {
  const members = unitPool.filter(u => squad.members.includes(u.id));
  const sgtId = squad.sergeantUnitId;

  // Separate sergeant from the rest
  const others = members.filter(u => u.id !== sgtId);

  // Sort others by leadership (descending) for rank distribution
  others.sort((a, b) => (b.leadership || 0) - (a.leadership || 0));

  for (const u of members) {
    if (u.id === sgtId) {
      u._rank = 5; // SGT (3 chevrons)
    } else {
      const idx = others.indexOf(u);
      if (idx === 0) {
        u._rank = 4; // CPL (2 chevrons, 2nd in command)
      } else if (idx === 1) {
        u._rank = 3; // SPC (diamond)
      } else if (idx === 2) {
        u._rank = 2; // PFC (1 chevron + rocker)
      } else if (idx === 3) {
        u._rank = 1; // PV2 (1 chevron)
      } else {
        u._rank = 0; // PVT (no insignia)
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT BATTLE AI — One-time setup after battle object created
// ═══════════════════════════════════════════════════════════════

/**
 * Initializes the full AI pipeline on a battle object.
 * Creates squads, stamps brain defaults, sets up team infrastructure.
 *
 * @param {object} b - Battle object
 * @param {object} opts - {
 *   allyPreset: string|object, enemyPreset: string|object,
 *   blueSpawnZone, redSpawnZone,
 *   skipSquads: bool  // if true, don't auto-create squads (fire range does its own)
 * }
 */
export function initBattleAI(b, opts = {}) {
  const allyPreset = opts.allyPreset || 'campaignAlly';
  const enemyPreset = opts.enemyPreset || 'campaignEnemy';
  const blueSpawnZone = opts.blueSpawnZone || { x: b.mapWidth / 2, y: b.mapHeight - 100, radius: 100 };
  const redSpawnZone = opts.redSpawnZone || { x: b.mapWidth / 2, y: 100, radius: 100 };

  // Reset squad ID counter for fresh battle
  _nextSquadId = 0;

  // Init shared structures
  if (!b._teamWaypoints) b._teamWaypoints = {};
  if (!b._squadWaypoints) b._squadWaypoints = {};
  if (!b._debugLog) b._debugLog = [];
  // Fog of war: start with empty visibility (no enemies visible until spotted)
  // null = no fog (fire range), Set = fog active (campaign/endless)
  if (!b.fireRange) b._visibleEnemies = new Set();
  if (!b._teamCommanders) {
    b._teamCommanders = {
      [Team.BLUE]: null,
      [Team.RED]: null
    };
  }

  // Stamp brain defaults on all units
  const blueUnits = (b.units || []);
  const redUnits = (b.enemies || []);
  const insigniaSetId = opts.insigniaSetId || null;
  b._insigniaSetId = insigniaSetId;

  for (const u of blueUnits) {
    applyBrainDefaults(u, allyPreset);
    if (!u.team) u.team = Team.BLUE;
    if (insigniaSetId) u._insigniaSetId = insigniaSetId;
  }
  for (const e of redUnits) {
    applyBrainDefaults(e, enemyPreset);
    if (!e.team) e.team = Team.RED;
    if (insigniaSetId) e._insigniaSetId = insigniaSetId;
  }

  // Create squads
  b._squads = [];

  if (!opts.skipSquads) {
    // Group units by _squadId
    const blueGroups = opts.skipBlueSquads ? new Map() : _groupBySquadId(blueUnits);
    const redGroups = _groupBySquadId(redUnits);

    for (const [, members] of blueGroups) {
      const squad = createSquad(Team.BLUE, members, {
        spawnZone: blueSpawnZone,
        enemyZone: redSpawnZone
      });
      b._squads.push(squad);
    }

    for (const [, members] of redGroups) {
      const squad = createSquad(Team.RED, members, {
        spawnZone: redSpawnZone,
        enemyZone: blueSpawnZone
      });
      b._squads.push(squad);
    }
  }

  // Create commanders and assign initial objectives
  // In unit/sgt modes, only the red commander exists (blue is player-driven)
  _initCommanders(b, opts);
  // Remove blue commander for non-CMD play modes (sergeant drives blue team)
  if (b.playMode && b.playMode !== 'cmd' && !b.fireRange) {
    b._teamCommanders[Team.BLUE] = null;
  }

  // Backwards compat: build _sergeants from squads
  _syncSergeants(b);
}

/**
 * Create commanders for both teams and assign initial objectives to all sergeants.
 */
function _initCommanders(b, opts) {
  const now = Date.now();

  // Blue commander
  const bluePers = opts.config?.blueCommander?.personality || COMMANDER_PRESETS.balanced;
  const blueSquadIds = b._squads.filter(s => s.team === Team.BLUE).map(s => s.id);
  b._teamCommanders[Team.BLUE] = createCommander({
    team: Team.BLUE,
    personality: bluePers,
    originUnit: opts.config?.blueCommander?.originUnit,
    maxSquads: opts.maxSquads ?? 3,
    spawnEdge: 'bottom',
    driver: opts.blueCommanderDriver || 'ai'
  });
  b._teamCommanders[Team.BLUE].squads = blueSquadIds;
  if (b.mapWidth && b.mapHeight) {
    initDefenseZones(b._teamCommanders[Team.BLUE], b.mapWidth, b.mapHeight);
  }

  // Red commander
  const redPers = opts.config?.redCommander?.personality || COMMANDER_PRESETS.balanced;
  const redSquadIds = b._squads.filter(s => s.team === Team.RED).map(s => s.id);
  b._teamCommanders[Team.RED] = createCommander({
    team: Team.RED,
    personality: redPers,
    originUnit: opts.config?.redCommander?.originUnit || opts.redCommanderOrigin,
    maxSquads: opts.maxSquads ?? 3,
    spawnEdge: 'top',
    driver: opts.redCommanderDriver || 'ai'
  });
  b._teamCommanders[Team.RED].squads = redSquadIds;
  if (b.mapWidth && b.mapHeight) {
    initDefenseZones(b._teamCommanders[Team.RED], b.mapWidth, b.mapHeight);
  }

  // Assign initial objectives — ATTACK for all squads
  for (const squad of b._squads) {
    if (!squad.sergeant) continue;
    const cmdr = b._teamCommanders[squad.team];
    if (cmdr) {
      const objective = opts.config?.[squad.team === Team.BLUE ? 'blueSquads' : 'redSquads']
        ?.[0]?.objective || Objective.ATTACK;
      assignObjective(cmdr, squad.sergeant, { type: objective }, now, b);
    }
  }
}

/**
 * Groups units by their _squadId field.
 * Units without _squadId get assigned to squad 0.
 */
function _groupBySquadId(units) {
  const groups = new Map();
  for (const u of units) {
    const sid = u._squadId ?? 0;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid).push(u);
  }
  return groups;
}

/**
 * Build b._sergeants from squad data for backwards compat.
 * Fire range code and other systems may still reference b._sergeants.
 */
function _syncSergeants(b) {
  b._sergeants = {};
  for (const sq of b._squads) {
    if (!sq.active) continue;
    // Store first sergeant per team (backwards compat: b._sergeants.blue / .red)
    if (!b._sergeants[sq.team]) {
      b._sergeants[sq.team] = sq.sergeant;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RUN BATTLE AI — Unified per-frame pipeline
// ═══════════════════════════════════════════════════════════════

/**
 * Unified per-frame AI pipeline. Replaces all inline AI code.
 *
 * Order: Modifiers → Commanders → Sergeants → Formations → Brains → Intel → Succession
 *
 * @param {object} b - Battle object
 * @param {number} now - Current timestamp (ms)
 * @param {number} dtSec - Delta time in seconds
 */
export function runBattleAI(b, now, dtSec) {
  const allUnits = b.units || [];
  const allEnemies = b.enemies || [];
  const hero = b.hero;

  b._now = now;

  // Safety: ensure _squads exists (handles stale battle objects)
  if (!b._squads) b._squads = [];
  if (!b._debugLog) b._debugLog = [];
  if (!b._teamWaypoints) b._teamWaypoints = {};

  // 1. Update modifier effects (commander aura, berserker rage, etc.)
  updateModifierEffects(allEnemies, dtSec);

  // 2. Commanders — evaluate battlefield, update objectives
  if (b._teamCommanders) {
    for (const cmdr of Object.values(b._teamCommanders)) {
      if (cmdr) updateCommander(b, cmdr, now);
    }
  }

  // Build hostiles pool that includes hero for red sergeant awareness
  const heroAsHostile = (hero && !hero.dead && !hero.observer) ? [hero] : [];
  const redEnemyPool = allUnits.concat(heroAsHostile);

  // 3. Per-squad: Sergeant → Formation
  for (const squad of b._squads) {
    if (!squad.active) continue;

    // Gather squad members — alive-only for formations, all (incl. dead) for sergeant
    const allPool = squad.team === Team.BLUE ? allUnits : allEnemies;
    const enemyPool = squad.team === Team.BLUE ? allEnemies : redEnemyPool;
    const aliveMembers = _getSquadMembers(squad, allPool);

    if (aliveMembers.length === 0) {
      squad.active = false;
      continue;
    }

    // 2a. Sergeant AI — needs ALL members (incl. dead) for casualty rate,
    //     and ALL enemies for enemy casualty rate
    if (squad.sergeant) {
      const allMembers = _getAllSquadMembers(squad, allPool);
      updateSergeant(b, squad.sergeant, allMembers, enemyPool, now);
    }

    // 2b. Formation (alive members only)
    updateFormation(b, aliveMembers, enemyPool, now);
  }

  // 3. Individual unit brains
  for (const e of allEnemies) {
    if (e.dead) continue;
    updateEnemyAI(b, e, hero, allUnits, now, dtSec);
  }

  for (const u of allUnits) {
    if (u.dead) continue;
    updateUnitAI(b, u, hero, allEnemies, now, dtSec);
  }

  // Boundary enforcement: units that were on-map can't leave.
  // Units marching in from off-map are allowed until they enter.
  // Once _wasOnMap is set, they're clamped forever.
  const margin = 20;
  const mapW = b.mapWidth || 1536;
  const mapH = b.mapHeight || 1536;
  for (const u of [...allUnits, ...allEnemies]) {
    if (u.dead) continue;
    const onMap = u.x >= 0 && u.y >= 0 && u.x <= mapW && u.y <= mapH;
    if (onMap && !u._wasOnMap) u._wasOnMap = true;
    if (u._wasOnMap) {
      if (u.x < margin) u.x = margin;
      if (u.y < margin) u.y = margin;
      if (u.x > mapW - margin) u.x = mapW - margin;
      if (u.y > mapH - margin) u.y = mapH - margin;
    }
  }

  // 3.5. Hero AI — runs through brain in CMD mode or fire range (when included as combatant)
  const heroAutoFire = b.playMode === 'cmd' || b.fireRange;
  if (hero && !hero.dead && !hero.observer && heroAutoFire) {
    // Ensure hero has brain defaults stamped (first frame only)
    if (!hero._brainInit) {
      hero._brainInit = true;
      const wave = b.wave || 1;
      const preset = scaleBrainByWave(BRAIN_PRESETS.campaignAlly, wave);
      applyBrainDefaults(hero, preset);
    }
    updateUnitAI(b, hero, null, allEnemies, now, dtSec);
  }

  // 3.5b. Hero spotting — hero doesn't run through updateBrain in unit mode, so build spotted list here
  if (hero && !hero.dead && !hero.observer) {
    if (!heroAutoFire) {
      buildSpottedList(hero, allEnemies, b, now);
    }
    // Share hero intel with all blue allies (hero acts as scout for the team)
    _shareHeroIntel(b, hero, allUnits, now);
  }

  // 3.5c. Hero stability — NOT updated here. The game loop calls
  // updateHeroStability() AFTER hero movement so _movedThisFrame is accurate.
  // See game.js heroFire/movement sections.

  // 3.6. Track whether hero is spotted by any red unit (for UI alert)
  if (hero && !hero.dead) {
    hero._isSpottedByEnemy = allEnemies.some(e =>
      !e.dead && e._spotted && e._spotted.some(s => s.enemy === hero)
    );
  }

  // 4. Intel sharing (hierarchical: intra-squad instant, cross-squad delayed)
  shareHierarchicalIntel(b, now);

  // 5. Sergeant succession check
  for (const squad of b._squads) {
    if (!squad.active) continue;
    _checkSuccession(b, squad);
  }

  // 6. Prune dead squads to keep array lean
  if (b._squads.length > 10) {
    b._squads = b._squads.filter(sq => sq.active);
  }

  // 7. Sync _sergeants for backwards compat
  _syncSergeants(b);

  // 8. Cap debug log
  if (b._debugLog && b._debugLog.length > 2000) {
    b._debugLog.splice(0, b._debugLog.length - 2000);
  }

  // 9. Build fog-of-war visibility set for renderer
  buildVisibilitySet(b);
}

/**
 * Look up alive squad members from the unit pool.
 */
function _getSquadMembers(squad, pool) {
  const memberSet = new Set(squad.members);
  return pool.filter(u => !u.dead && memberSet.has(u.id));
}

/**
 * Look up ALL squad members (alive + dead) from the unit pool.
 * Needed by sergeant (casualty rate) and formation (stress from casualties).
 */
function _getAllSquadMembers(squad, pool) {
  const memberSet = new Set(squad.members);
  return pool.filter(u => memberSet.has(u.id));
}

// ═══════════════════════════════════════════════════════════════
// SPAWN SQUAD — Mid-battle squad creation (for waves)
// ═══════════════════════════════════════════════════════════════

/**
 * Creates a new squad mid-battle from already-created units.
 * Stamps brain defaults, creates sergeant, adds to b._squads.
 *
 * @param {object} b - Battle object
 * @param {string} team - Team.BLUE or Team.RED
 * @param {object[]} units - Array of unit objects (already pushed to b.units/b.enemies)
 * @param {object} spawnZone - { x, y, radius }
 * @param {object} opts - { preset, personality, formation, command }
 */
export function spawnSquad(b, team, units, spawnZone, opts = {}) {
  // Stamp brain defaults
  const preset = opts.preset || (team === Team.BLUE ? 'endlessAlly' : 'endlessEnemy');
  const insigniaSetId = opts.insigniaSetId || b._insigniaSetId || null;
  for (const u of units) {
    applyBrainDefaults(u, preset);
    if (!u.team) u.team = team;
    if (insigniaSetId) u._insigniaSetId = insigniaSetId;
  }

  // Determine enemy zone (opposite side of map from this team)
  const enemyZone = team === Team.BLUE
    ? { x: b.mapWidth / 2, y: 100, radius: 100 }
    : { x: b.mapWidth / 2, y: b.mapHeight - 100, radius: 100 };

  const squad = createSquad(team, units, {
    spawnZone,
    enemyZone,
    personality: opts.sgtPersonality || opts.personality,
    formation: opts.formation || 'wedge',
    command: opts.command || 'advance'
  });

  b._squads.push(squad);

  // Register with commander (objective assignment handled by caller if skipObjective is set)
  if (squad.sergeant && b._teamCommanders) {
    const cmdr = b._teamCommanders[team];
    if (cmdr) {
      cmdr.squads.push(squad.id);
      if (!opts.skipObjective) {
        assignObjective(cmdr, squad.sergeant, { type: Objective.ATTACK }, performance.now(), b);
      }
    }
  }

  _syncSergeants(b);

  return squad;
}

// ═══════════════════════════════════════════════════════════════
// SERGEANT SUCCESSION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if sergeant unit died. If so, promote successor.
 */
function _checkSuccession(b, squad) {
  if (!squad.sergeantUnitId) return;

  const allPool = squad.team === Team.BLUE ? (b.units || []) : (b.enemies || []);
  const sgtUnit = allPool.find(u => u.id === squad.sergeantUnitId);

  // Sergeant still alive
  if (sgtUnit && !sgtUnit.dead) return;

  // Sergeant died — promote successor
  promoteSgtSuccessor(b, squad);
}

// Survivability tier for sergeant succession — higher = more survivable, better commander
const _SGT_CATEGORY_TIER = {
  heavy_tank: 4,
  medium_tank: 3,
  light_vehicle: 2,
  infantry: 1
};
function _unitCategoryTier(unit) {
  switch (unit.unitId || 'infantry') {
    case 'tiger': case 'abrams': case 'howitzer': return 4;
    case 'sherman': return 3;
    case 'jeep': case 'humvee': return 2;
    default: return 1;
  }
}

/**
 * Called when sergeant unit dies. Finds best surviving squad member to promote.
 * Priority: unit category (tanks > vehicles > infantry) then leadership score.
 * This ensures the most survivable unit leads, with leadership as tiebreaker.
 */
export function promoteSgtSuccessor(b, squad) {
  const allPool = squad.team === Team.BLUE ? (b.units || []) : (b.enemies || []);
  const aliveMembers = allPool.filter(u => !u.dead && squad.members.includes(u.id));

  if (aliveMembers.length === 0) {
    // Squad wiped — deactivate
    squad.active = false;
    squad.sergeantUnitId = null;
    return;
  }

  // Find best successor: category tier first, then leadership as tiebreaker
  let best = aliveMembers[0];
  let bestTier = _unitCategoryTier(best);
  let bestLead = best.leadership || 0;
  for (let i = 1; i < aliveMembers.length; i++) {
    const u = aliveMembers[i];
    const tier = _unitCategoryTier(u);
    const lead = u.leadership || 0;
    if (tier > bestTier || (tier === bestTier && lead > bestLead)) {
      best = u;
      bestTier = tier;
      bestLead = lead;
    }
  }

  // Promote
  squad.sergeantUnitId = best.id;

  // Re-stamp ranks for the squad (reset _rankStampTime so chevrons pop in fresh)
  const squadMembers = allPool.filter(u => squad.members.includes(u.id));
  for (const u of squadMembers) u._rankStampTime = null;
  stampSquadRanks(squad, allPool);

  // Mark promoted unit with a highlight effect
  best._promotionTime = performance.now();

  // Transfer sergeant state — keep phase, path, sitrep
  if (squad.sergeant) {
    squad.sergeant._lastCommand = null; // Allow re-evaluation
    squad.sergeant._lastFormation = null;
  }

  // Log succession
  logEvent(b, {
    t: Date.now(),
    who: `squad-${squad.id}`,
    team: squad.team,
    type: 'sergeant',
    action: `sgt promoted ${best.id}`,
    detail: `squad ${squad.id} | remaining: ${aliveMembers.length}`
  });
}

// ═══════════════════════════════════════════════════════════════
// HIERARCHICAL INTEL SHARING
// ═══════════════════════════════════════════════════════════════

/**
 * Hierarchical intel flow:
 * 1. Intra-squad sharing (instant) — via existing shareTeamIntel per squad
 * 2. Sergeant relay (delayed) — cross-squad via sergeants
 */
export function shareHierarchicalIntel(b, now) {
  // Group squads by team
  const teamSquads = {};
  for (const sq of b._squads) {
    if (!sq.active) continue;
    if (!teamSquads[sq.team]) teamSquads[sq.team] = [];
    teamSquads[sq.team].push(sq);
  }

  // For each team
  for (const [team, squads] of Object.entries(teamSquads)) {
    const pool = team === Team.BLUE ? (b.units || []) : (b.enemies || []);

    if (squads.length === 1) {
      // Single squad — sergeant relays to all members (no range limit)
      const members = _getSquadMembers(squads[0], pool);
      if (members.length > 0) shareTeamIntel(members, now, { squadMode: true });
      continue;
    }

    // Multiple squads: intra-squad instant (full range), cross-squad delayed
    // Step 1: Intra-squad sharing (instant, sergeant relays — no range limit)
    for (const sq of squads) {
      const members = _getSquadMembers(sq, pool);
      if (members.length > 0) shareTeamIntel(members, now, { squadMode: true });
    }

    // Step 2: Sergeant relay (cross-squad)
    _relaySergeantIntel(b, squads, pool, now);
  }
}

/**
 * Cross-squad intel relay via sergeants.
 * Each sergeant aggregates their squad's intel, relays to other
 * same-team sergeants with a delay based on discipline.
 */
function _relaySergeantIntel(b, squads, pool, now) {
  // Build per-squad spotted aggregates
  const squadIntel = [];
  for (const sq of squads) {
    const members = _getSquadMembers(sq, pool);
    // Aggregate spotted enemies from all squad members
    const spotted = new Map();
    for (const m of members) {
      if (!m._spotted) continue;
      for (const s of m._spotted) {
        if (!spotted.has(s.id) || (s.lastSeen > spotted.get(s.id).lastSeen)) {
          spotted.set(s.id, s);
        }
      }
    }
    const discipline = sq.sergeant?.personality?.discipline || 0.5;
    // Delay: 2s for low discipline, 0.5s for high
    const relayDelay = 2000 - discipline * 1500;
    squadIntel.push({ squad: sq, spotted, relayDelay, members });
  }

  // Cross-pollinate: each squad relays to others with delay + degradation
  for (let i = 0; i < squadIntel.length; i++) {
    for (let j = 0; j < squadIntel.length; j++) {
      if (i === j) continue;
      const source = squadIntel[i];
      const dest = squadIntel[j];

      for (const [enemyId, intel] of source.spotted) {
        // Apply relay delay — only share if intel is old enough
        const age = now - (intel.lastSeen || 0);
        if (age < source.relayDelay) continue;

        // Distribute to destination squad members with reduced accuracy
        for (const dm of dest.members) {
          if (!dm._spotted) dm._spotted = [];
          const existing = dm._spotted.find(s => s.id === enemyId);
          if (existing) {
            // Only update if our relay is newer
            if ((intel.lastSeen || 0) > (existing.lastSeen || 0)) {
              existing.lastSeen = intel.lastSeen;
              existing.posUncertainty = Math.max(existing.posUncertainty || 0, 60);
              existing.direct = false;
              existing.source = 'sgt_relay';
            }
          } else {
            // Add new intel with degraded accuracy
            dm._spotted.push({
              ...intel,
              posUncertainty: 60,
              direct: false,
              source: 'sgt_relay'
            });
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// HERO INTEL SHARING — Hero spots shared with all blue units
// ═══════════════════════════════════════════════════════════════

/**
 * Share hero's spotted list with all blue allies.
 * Hero acts as a forward observer — instant, high-quality intel.
 */
function _shareHeroIntel(b, hero, blueUnits, now) {
  if (!hero._spotted || hero._spotted.length === 0) return;

  for (const ally of blueUnits) {
    if (ally.dead) continue;
    if (!ally._spotted) ally._spotted = [];

    const directIds = new Set();
    for (const s of ally._spotted) {
      if (s.direct) directIds.add(s.enemy?.id);
    }

    for (const entry of hero._spotted) {
      if (!entry.enemy || entry.enemy.dead) continue;
      if (directIds.has(entry.enemy.id)) continue;

      const existing = ally._spotted.find(s => s.enemy?.id === entry.enemy.id && !s.direct);
      if (existing) {
        if (entry.timestamp > existing.timestamp) {
          existing.accuracy = entry.accuracy * 0.9;
          existing.timestamp = entry.timestamp;
          existing.posUncertainty = 15;
          existing.source = 'hero';
        }
      } else {
        ally._spotted.push({
          enemy: entry.enemy,
          dist: Math.sqrt((ally.x - entry.enemy.x) ** 2 + (ally.y - entry.enemy.y) ** 2),
          zone: entry.zone,
          accuracy: entry.accuracy * 0.9,
          concealment: entry.concealment,
          direct: false,
          source: 'hero',
          posUncertainty: 15,
          timestamp: entry.timestamp
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FOG OF WAR — Team visibility set for renderer filtering
// ═══════════════════════════════════════════════════════════════

/**
 * Build b._visibleEnemies — a Set of enemy IDs spotted by any blue unit or the hero.
 * The renderer uses this to hide/fade enemies not in the set.
 * In fire range mode, fog of war is disabled (set to null = show all).
 */
function buildVisibilitySet(b) {
  // Fire range is a sandbox — no fog of war
  if (b.fireRange) {
    b._visibleEnemies = null;
    return;
  }

  const visible = new Set();

  // Collect from all blue units' spotted lists
  for (const unit of (b.units || [])) {
    if (unit.dead) continue;
    for (const s of (unit._spotted || [])) {
      if (s.enemy && !s.enemy.dead) visible.add(s.enemy.id);
    }
  }

  // Hero spotted list (built in step 3.5 via buildSpottedList)
  if (b.hero && !b.hero.dead && !b.hero.observer) {
    for (const s of (b.hero._spotted || [])) {
      if (s.enemy && !s.enemy.dead) visible.add(s.enemy.id);
    }
  }

  b._visibleEnemies = visible;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Reset the squad ID counter (for testing or fresh sessions).
 */
export function resetSquadIds() {
  _nextSquadId = 0;
}
