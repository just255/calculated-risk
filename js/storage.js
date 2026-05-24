// ═══════════════════════════════════════════════════════════════
// STORAGE - LocalStorage persistence
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { loadRoster, saveRoster, seedStarterRoster, loadVehicles, saveVehicles, seedStarterVehicles, loadMemorial } from './roster.js';
import { loadArmory, saveArmory } from './armory.js';

// ── Save slot system ─────────────────────────────────────────

const MAX_SLOTS = 10;             // Dev: 10, Live: 3
const SLOT_META_KEY = 'cr_slots'; // Stores slot metadata (summaries)
const ACTIVE_SLOT_KEY = 'cr_active_slot';

/** Get the prefixed storage key for the active slot. Uses Game._activeSlot. */
export function slotKey(key) {
  const slot = Game._activeSlot;
  if (slot == null) return key; // Fallback for pre-slot code
  return `cr_s${slot}_${key}`;
}

/** Get/set the active slot index (0-based). Stored on Game for cross-module access. */
export function getActiveSlot() { return Game._activeSlot ?? null; }
export function setActiveSlot(idx) {
  Game._activeSlot = idx;
  localStorage.setItem(ACTIVE_SLOT_KEY, String(idx));
}

/** Get metadata for all slots. Returns array of { idx, name, summary } or null for empty. */
export function getSlotMetas() {
  try {
    return JSON.parse(localStorage.getItem(SLOT_META_KEY)) || [];
  } catch { return []; }
}

/** Save metadata for a single slot. */
export function saveSlotMeta(idx, meta) {
  const metas = getSlotMetas();
  // Pad array to idx
  while (metas.length <= idx) metas.push(null);
  metas[idx] = meta;
  localStorage.setItem(SLOT_META_KEY, JSON.stringify(metas));
}

/** Update the active slot's metadata from current Game state. */
export function updateActiveSlotMeta() {
  if (Game._activeSlot == null) return;
  const roster = Game.roster || [];
  const alive = roster.filter(s => s.status !== 'kia').length;
  saveSlotMeta(Game._activeSlot, {
    name: `Slot ${Game._activeSlot + 1}`,
    rosterSize: alive,
    highestWave: Game.stats?.highestWave || 0,
    scrap: Game.resources?.scrap || 0,
    lastPlayed: Date.now()
  });
}

/** Delete a save slot — removes all its localStorage keys. */
export function deleteSlot(idx) {
  const prefix = `cr_s${idx}_`;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) localStorage.removeItem(key);
  // Clear metadata
  const metas = getSlotMetas();
  if (metas[idx]) { metas[idx] = null; localStorage.setItem(SLOT_META_KEY, JSON.stringify(metas)); }
}

/** Check if a slot has save data. */
export function slotExists(idx) {
  return localStorage.getItem(`cr_s${idx}_cr_save`) !== null ||
         localStorage.getItem(`cr_s${idx}_cr_roster`) !== null;
}

/** Migrate legacy (non-slotted) save to slot 0 if it exists and no slots exist yet. */
export function migrateLegacySave() {
  const metas = getSlotMetas();
  if (metas.some(m => m !== null)) return; // Already have slots
  if (!localStorage.getItem('cr_save') && !localStorage.getItem('cr_roster')) return; // No legacy data

  // Copy all cr_ keys to slot 0
  const legacyKeys = ['cr_save', 'cr_roster', 'cr_vehicles', 'cr_memorial', 'cr_recent_fallen', 'cr_last_loadout', 'cr_fr_last_config', 'cr_fr_saves'];
  for (const key of legacyKeys) {
    const val = localStorage.getItem(key);
    if (val) localStorage.setItem(`cr_s0_${key}`, val);
  }
  saveSlotMeta(0, { name: 'Slot 1 (migrated)', rosterSize: 0, highestWave: 0, scrap: 0, lastPlayed: Date.now() });
}

/** Get the max number of slots. */
export function getMaxSlots() { return MAX_SLOTS; }

// ── Storage keys (now routed through slotKey) ────────────────

const SAVE_KEY = 'cr_save';
const FR_LAST_KEY = 'cr_fr_last_config';
const FR_SAVES_KEY = 'cr_fr_saves';
const LOADOUT_KEY = 'cr_last_loadout';

// ── Loadout persistence ──────────────────────────────────────

/**
 * Save the current deployment lineup so it auto-loads next battle.
 * Stores unit types + soldier/vehicle IDs (not positions or battle state).
 */
export function saveLastLoadout(b) {
  try {
    const lineup = (b.units || []).map(u => ({
      unitId: u.unitId,
      _soldierId: u._soldierId || null,
      _vehicleId: u._vehicleId || null,
      _role: u._role || null
    }));
    const data = {
      presetId: b._selectedPreset || null,
      formation: b._deployFormation || 'line',
      lineup
    };
    localStorage.setItem(slotKey(LOADOUT_KEY), JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save loadout:', e);
  }
}

/**
 * Load the last-used deployment lineup.
 * Returns { presetId, formation, lineup[] } or null.
 */
export function loadLastLoadout() {
  try {
    const raw = localStorage.getItem(slotKey(LOADOUT_KEY));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Failed to load loadout:', e);
    return null;
  }
}

export function save() {
  try {
    localStorage.setItem(slotKey(SAVE_KEY), JSON.stringify({
      resources: Game.resources,
      stats: Game.stats,
      settings: Game.settings,
      player: Game.player
    }));
    saveRoster();
    saveVehicles();
    updateActiveSlotMeta();
  } catch (e) {
    console.warn('Failed to save:', e);
  }
}

export function load() {
  try {
    // Reset state before loading to prevent cross-slot bleed
    Game.resources = { scrap: 0, parts: 0 };
    Game.stats = { highestWave: 0, battles: 0, kills: 0 };
    Game.roster = [];
    Game.vehicles = [];
    Game.memorial = [];
    Game.recentFallen = [];
    Game.hqRecruitPool = null;
    Game.armory = { items: [], capacity: 50 };

    const data = JSON.parse(localStorage.getItem(slotKey(SAVE_KEY)));
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
      // Deep merge cursor settings (default-init if missing on older saves)
      Game.settings.cursors = Game.settings.cursors || {
        menu:   { id: 'd3-amber', colors: undefined },
        battle: { id: 'original', colors: undefined },
        custom: []
      };
      if (data.settings?.cursors) {
        Object.assign(Game.settings.cursors, data.settings.cursors);
        Game.settings.cursors.custom = Array.isArray(data.settings.cursors.custom)
          ? data.settings.cursors.custom : [];
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
    // Load persistent roster + vehicles + armory (separate storage keys)
    // Armory loads first so roster migration can check for orphaned item references.
    loadArmory();
    loadRoster();
    loadVehicles();
    loadMemorial();
    // One-time migration to armory-as-single-source-of-truth: move soldier.kits
    // into armory.kits[soldierId] and strip the deprecated soldier.loadout / soldier.kits
    // fields. Gated by armory._sotMigratedV1. See ADR-0004.
    _migrateToArmorySOT();
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
    localStorage.setItem(slotKey(FR_LAST_KEY), JSON.stringify(stripExpanded(config)));
  } catch (e) {
    console.warn('Failed to save FR config:', e);
  }
}

export function loadFRConfig() {
  try {
    const raw = localStorage.getItem(slotKey(FR_LAST_KEY));
    return raw ? migrateFRConfig(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('Failed to load FR config:', e);
    return null;
  }
}

export function saveFRNamedConfig(name, config) {
  try {
    const saves = JSON.parse(localStorage.getItem(slotKey(FR_SAVES_KEY)) || '{}');
    saves[name] = { config: stripExpanded(config), savedAt: Date.now() };
    localStorage.setItem(slotKey(FR_SAVES_KEY), JSON.stringify(saves));
  } catch (e) {
    console.warn('Failed to save named FR config:', e);
  }
}

export function loadFRNamedConfigs() {
  try {
    return JSON.parse(localStorage.getItem(slotKey(FR_SAVES_KEY)) || '{}');
  } catch (e) {
    console.warn('Failed to load named FR configs:', e);
    return {};
  }
}

export function deleteFRNamedConfig(name) {
  try {
    const saves = JSON.parse(localStorage.getItem(slotKey(FR_SAVES_KEY)) || '{}');
    delete saves[name];
    localStorage.setItem(slotKey(FR_SAVES_KEY), JSON.stringify(saves));
  } catch (e) {
    console.warn('Failed to delete named FR config:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// ARMORY AS SINGLE SOURCE OF TRUTH MIGRATION (one-shot per slot)
// ═══════════════════════════════════════════════════════════════

/**
 * Move `soldier.kits` into `armory.kits[soldierId]` and strip both
 * `soldier.loadout` and `soldier.kits` from every soldier. Defensively
 * reconciles any item whose assignedTo/equipped doesn't match the old
 * soldier.loadout reference — this is the last chance to compare the
 * dual sources before the cache is gone. See ADR-0004.
 *
 * Gated by `armory._sotMigratedV1` so it runs exactly once per save slot.
 */
function _migrateToArmorySOT() {
  if (!Game.armory) return;
  if (Game.armory._sotMigratedV1) return;
  if (!Game.armory.kits) Game.armory.kits = {};
  let rosterTouched = false;

  for (const s of (Game.roster || [])) {
    // Move kits intact.
    if (s.kits && Object.keys(s.kits).length > 0) {
      Game.armory.kits[s.id] = s.kits;
    }
    if ('kits' in s) { delete s.kits; rosterTouched = true; }

    // Reconcile loadout → items (defensive — last chance to compare).
    if (s.loadout) {
      for (const [, itemId] of Object.entries(s.loadout)) {
        if (!itemId) continue;
        const item = Game.armory.items.find(i => i.id === itemId);
        if (!item) continue;
        if (item.assignedTo !== s.id) item.assignedTo = s.id;
        if (item.equipped === false) item.equipped = true;
      }
    }
    if ('loadout' in s) { delete s.loadout; rosterTouched = true; }
  }

  Game.armory._sotMigratedV1 = true;
  saveArmory();
  if (rosterTouched) saveRoster();
}
