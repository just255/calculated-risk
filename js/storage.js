// ═══════════════════════════════════════════════════════════════
// STORAGE - LocalStorage persistence
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { loadRoster, saveRoster, seedStarterRoster, loadVehicles, saveVehicles, seedStarterVehicles } from './roster.js';

const SAVE_KEY = 'cr_save';
const FR_LAST_KEY = 'cr_fr_last_config';
const FR_SAVES_KEY = 'cr_fr_saves';

export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      resources: Game.resources,
      stats: Game.stats,
      settings: Game.settings,
      player: Game.player
    }));
    saveRoster();
    saveVehicles();
  } catch (e) {
    console.warn('Failed to save:', e);
  }
}

export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data) {
      Object.assign(Game.resources, data.resources || {});
      Object.assign(Game.stats, data.stats || {});
      // Shallow merge top-level settings
      Object.assign(Game.settings, data.settings || {});
      // Deep merge controls settings
      if (data.settings?.controls) {
        Game.settings.controls = Game.settings.controls || {};
        Object.assign(Game.settings.controls, data.settings.controls);
      }
      if (data.player) {
        Object.assign(Game.player, data.player);
        // Ensure unitColors exists for older saves
        if (!Game.player.unitColors) {
          Game.player.unitColors = {};
        }
        // Ensure spriteSelections exists for older saves
        if (!Game.player.spriteSelections) {
          Game.player.spriteSelections = {};
        }
        // Ensure abrams is unlocked for PNG sprite testing
        if (!Game.player.unlockedUnits.includes('abrams')) {
          Game.player.unlockedUnits.push('abrams');
        }
      }
    }
    // Load persistent roster + vehicles (separate storage keys)
    loadRoster();
    loadVehicles();
    // Seed starters if first time
    seedStarterRoster();
    seedStarterVehicles();

    // Cleanup: unassign vehicle crew pointing to stale/missing vehicle IDs
    const vehicleIds = new Set((Game.vehicles || []).map(v => v.id));
    let cleanedCount = 0;
    for (const s of (Game.roster || [])) {
      if (s.pool === 'vehicle' && s.assignedVehicleId && !vehicleIds.has(s.assignedVehicleId)) {
        s.assignedVehicleId = null;
        s.assignedSlot = null;
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) console.log(`[roster] Cleaned ${cleanedCount} stale crew assignments`);

  } catch (e) {
    console.warn('Failed to load:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// FIRE RANGE CONFIG PERSISTENCE
// ═══════════════════════════════════════════════════════════════

function stripExpanded(config) {
  const c = JSON.parse(JSON.stringify(config));
  // Handle new squad structure
  for (const squad of [...(c.blueSquads || []), ...(c.redSquads || [])]) {
    for (const slot of (squad.units || [])) {
      delete slot._expanded;
    }
  }
  // Handle legacy flat team arrays (backwards compat)
  for (const slot of [...(c.blueTeam || []), ...(c.redTeam || [])]) {
    delete slot._expanded;
  }
  return c;
}

// Migrate old configs: enemyType → unitId, flat teams → squads
export function migrateFRConfig(config) {
  if (!config) return config;
  // Migrate old red team enemyType → unitId
  if (config.redTeam) {
    for (const slot of config.redTeam) {
      if (slot.enemyType && !slot.unitId) {
        slot.unitId = slot.enemyType;
        delete slot.enemyType;
      }
    }
  }
  // Migrate flat team arrays to squad structure
  if (config.blueTeam && !config.blueSquads) {
    config.blueSquads = [{ name: 'Alpha', sergeant: config.blueSergeant || {}, formation: 'line', units: config.blueTeam }];
    delete config.blueTeam;
    delete config.blueSergeant;
  }
  if (config.redTeam && !config.redSquads) {
    config.redSquads = [{ name: 'Alpha', sergeant: config.redSergeant || {}, formation: 'line', units: config.redTeam }];
    delete config.redTeam;
    delete config.redSergeant;
  }
  // Ensure commander config exists
  if (!config.blueCommander) config.blueCommander = { personality: {} };
  if (!config.redCommander) config.redCommander = { personality: {} };
  return config;
}

export function saveFRConfig(config) {
  try {
    localStorage.setItem(FR_LAST_KEY, JSON.stringify(stripExpanded(config)));
  } catch (e) {
    console.warn('Failed to save FR config:', e);
  }
}

export function loadFRConfig() {
  try {
    const raw = localStorage.getItem(FR_LAST_KEY);
    return raw ? migrateFRConfig(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('Failed to load FR config:', e);
    return null;
  }
}

export function saveFRNamedConfig(name, config) {
  try {
    const saves = JSON.parse(localStorage.getItem(FR_SAVES_KEY) || '{}');
    saves[name] = { config: stripExpanded(config), savedAt: Date.now() };
    localStorage.setItem(FR_SAVES_KEY, JSON.stringify(saves));
  } catch (e) {
    console.warn('Failed to save named FR config:', e);
  }
}

export function loadFRNamedConfigs() {
  try {
    return JSON.parse(localStorage.getItem(FR_SAVES_KEY) || '{}');
  } catch (e) {
    console.warn('Failed to load named FR configs:', e);
    return {};
  }
}

export function deleteFRNamedConfig(name) {
  try {
    const saves = JSON.parse(localStorage.getItem(FR_SAVES_KEY) || '{}');
    delete saves[name];
    localStorage.setItem(FR_SAVES_KEY, JSON.stringify(saves));
  } catch (e) {
    console.warn('Failed to delete named FR config:', e);
  }
}
