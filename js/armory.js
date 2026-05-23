// ═══════════════════════════════════════════════════════════════
// ARMORY — Shared gear inventory, loadout assignment, validation
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import {
  getGearTemplate, getWeaponTemplate, WEAPON_TEMPLATES, OPTIC_TEMPLATES,
  ATTACHMENT_TEMPLATES, ARMOR_TEMPLATES, UTILITY_TEMPLATES,
  QUALITY_TIERS, MOS_WEAPON_ACCESS, STANDARD_ISSUE
} from './gear-templates.js';

const ARMORY_KEY = 'cr_armory';
const DEFAULT_CAPACITY = 50;

let _idCounter = 0;

// ── Initialization ───────────────────────────────────────────

function _ensureArmory() {
  if (!Game.armory) {
    Game.armory = { items: [], capacity: DEFAULT_CAPACITY, kits: {} };
  }
  if (!Game.armory.kits) Game.armory.kits = {};
  return Game.armory;
}

/**
 * Reset the armory to a clean empty state. Called from setup-deploy on first-mission
 * (re)start so items from prior failed/abandoned attempts don't accumulate as orphans
 * (assignedTo points at soldier IDs no longer in roster). See Task #130 and ADR-0004.
 */
export function resetArmory() {
  Game.armory = { items: [], capacity: DEFAULT_CAPACITY, kits: {} };
}

function _slotKey(key) {
  const slot = Game._activeSlot;
  return slot != null ? `cr_s${slot}_${key}` : key;
}

function _generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

// ── CRUD ─────────────────────────────────────────────────────

/**
 * Create a new gear item from a template.
 * @param {string} templateId - Key in any template catalog
 * @param {string} quality - 'standard_issue' | 'common' | 'improved' | 'rare'
 * @param {object} [opts] - { condition, assignedTo }
 * @returns {object} The created item, already added to armory
 */
export function createItem(templateId, quality = 'common', opts = {}) {
  const armory = _ensureArmory();
  const template = getGearTemplate(templateId);
  if (!template) { console.warn(`[armory] Unknown template: ${templateId}`); return null; }

  const slot = template.slot || _inferSlot(templateId);
  const item = {
    id: _generateId(slot === 'primary' || slot === 'sidearm' ? 'wpn' : slot.substring(0, 3)),
    templateId,
    slot,
    quality: quality || 'common',
    condition: opts.condition ?? 1.0,
    assignedTo: opts.assignedTo || null,
    equipped: opts.equipped === true,
    volume: template.volume || 1
  };

  armory.items.push(item);
  return item;
}

function _inferSlot(templateId) {
  if (WEAPON_TEMPLATES[templateId]) {
    const cat = WEAPON_TEMPLATES[templateId].category;
    return cat === 'pistol' ? 'sidearm' : 'primary';
  }
  if (OPTIC_TEMPLATES[templateId]) return 'optic';
  if (ATTACHMENT_TEMPLATES[templateId]) return 'attachment';
  if (ARMOR_TEMPLATES[templateId]) return 'armor';
  if (UTILITY_TEMPLATES[templateId]) return 'utility';
  return 'unknown';
}

/**
 * Assign an item to a soldier's loadout slot.
 * @returns {boolean} success
 */
export function assignItem(itemId, soldierId, opts = {}) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item) return false;
  if (item.assignedTo && item.assignedTo !== soldierId) return false;
  item.assignedTo = soldierId;
  // Default to equipped=true unless caller specifies otherwise (e.g., kit storage).
  if (opts.equipped !== false) {
    // Unequip any other item the soldier has in this slot
    for (const other of armory.items) {
      if (other.assignedTo === soldierId && other.slot === item.slot && other.id !== item.id) {
        other.equipped = false;
      }
    }
    item.equipped = true;
  } else {
    item.equipped = false;
  }
  return true;
}

/**
 * Unassign an item back to the armory pool.
 * @returns {boolean} success
 */
export function unassignItem(itemId) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item) return false;
  item.assignedTo = null;
  return true;
}

/**
 * Get the item currently equipped (worn) by a soldier in a slot.
 * An assigned item with equipped=true. Items in stored kits return null here.
 */
export function getEquipped(soldierId, slot) {
  const armory = _ensureArmory();
  return armory.items.find(i => i.assignedTo === soldierId && i.slot === slot && i.equipped !== false) || null;
}

/**
 * Get ALL items owned by a soldier (assigned to them), regardless of equipped state.
 * Useful for kit management — soldiers can own multiple items per slot.
 */
export function getOwnedItems(soldierId, slot = null) {
  const armory = _ensureArmory();
  return armory.items.filter(i => i.assignedTo === soldierId && (!slot || i.slot === slot));
}

/**
 * Get all items currently equipped by a soldier (worn now).
 */
export function getLoadout(soldierId) {
  const armory = _ensureArmory();
  const items = armory.items.filter(i => i.assignedTo === soldierId && i.equipped !== false);
  const loadout = {};
  for (const item of items) loadout[item.slot] = item;
  return loadout;
}

/**
 * Equip a specific owned item. Marks it equipped=true and unmarks any others in the same slot.
 * Item must already be assigned to the soldier.
 */
export function equipItem(soldierId, itemId) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item || item.assignedTo !== soldierId) return false;
  // Unequip others in the same slot owned by this soldier
  for (const other of armory.items) {
    if (other.assignedTo === soldierId && other.slot === item.slot && other.id !== item.id) {
      other.equipped = false;
    }
  }
  item.equipped = true;
  return true;
}

/**
 * Unequip the soldier's slot — marks all items in that slot for this soldier as not worn.
 * They remain owned. To remove ownership, call unassignItem instead.
 */
export function unequipSlot(soldierId, slot) {
  const armory = _ensureArmory();
  for (const i of armory.items) {
    if (i.assignedTo === soldierId && i.slot === slot) i.equipped = false;
  }
}

/**
 * Migrate older items that don't have an `equipped` field. Existing assigned items
 * default to equipped=true (they were "worn" under the pre-kit model).
 * Idempotent — safe to call multiple times.
 */
export function migrateItemsForKits() {
  const armory = _ensureArmory();
  for (const i of armory.items) {
    if (i.equipped === undefined) i.equipped = !!i.assignedTo;
  }
}


// ─── Kit save/load ────────────────────────────────────────────

/** Snapshot the soldier's currently equipped items into a kit for the given MOS. */
export function saveKit(soldier, mos) {
  if (!soldier || !mos) return;
  const armory = _ensureArmory();
  const kit = {};
  for (const i of armory.items) {
    if (i.assignedTo === soldier.id && i.equipped !== false) {
      kit[i.slot] = i.id;
    }
  }
  if (!armory.kits[soldier.id]) armory.kits[soldier.id] = {};
  armory.kits[soldier.id][mos] = kit;
}

/**
 * Apply the saved kit for a given MOS — equip items that are in the kit, unequip everything else
 * owned by the soldier. If no kit exists, clear all equipped (items stay owned).
 */
export function loadKit(soldier, mos) {
  if (!soldier) return;
  const armory = _ensureArmory();
  const kit = armory.kits[soldier.id]?.[mos] || null;
  // Step 1: unequip everything the soldier owns
  for (const i of armory.items) {
    if (i.assignedTo === soldier.id) i.equipped = false;
  }
  if (!kit) return;
  // Step 2: equip items listed in the kit (verify they're still owned by soldier)
  for (const [slot, itemId] of Object.entries(kit)) {
    const item = armory.items.find(x => x.id === itemId);
    if (item && item.assignedTo === soldier.id && item.slot === slot) {
      item.equipped = true;
    }
  }
}

/** Returns the saved kit for the soldier's given MOS, or null. */
export function getKit(soldier, mos) {
  if (!soldier) return null;
  const armory = _ensureArmory();
  return armory.kits[soldier.id]?.[mos] || null;
}

/** Does the soldier have a saved kit for the given MOS? */
export function hasKit(soldier, mos) {
  return !!getKit(soldier, mos);
}

/**
 * Compare the soldier's currently equipped items to the saved kit for an MOS.
 * Returns true if they differ (or if no kit exists and the soldier has equipped items).
 */
export function kitIsDirty(soldier, mos) {
  if (!soldier) return false;
  const armory = _ensureArmory();
  const equipped = {};
  let hasAny = false;
  for (const i of armory.items) {
    if (i.assignedTo === soldier.id && i.equipped !== false) {
      equipped[i.slot] = i.id;
      hasAny = true;
    }
  }
  const kit = getKit(soldier, mos);
  if (!kit) return hasAny; // No saved kit, anything equipped = dirty
  // Compare slot maps
  const slots = new Set([...Object.keys(equipped), ...Object.keys(kit)]);
  for (const s of slots) {
    if (equipped[s] !== kit[s]) return true;
  }
  return false;
}

/**
 * Lookup which of a soldier's saved kits contains an item. Returns the MOS key, or null.
 */
export function findKitForItem(soldier, itemId) {
  if (!soldier?.id) return null;
  const armory = _ensureArmory();
  const soldierKits = armory.kits[soldier.id];
  if (!soldierKits) return null;
  for (const [mos, kit] of Object.entries(soldierKits)) {
    if (Object.values(kit).includes(itemId)) return mos;
  }
  return null;
}

/**
 * Is this item referenced by any soldier's saved kit (across the whole armory)?
 * Useful as a destruction guard so we don't accidentally remove kit-referenced items.
 */
export function isItemInAnyKit(itemId) {
  const armory = _ensureArmory();
  for (const soldierKits of Object.values(armory.kits || {})) {
    for (const kit of Object.values(soldierKits || {})) {
      if (Object.values(kit || {}).includes(itemId)) return true;
    }
  }
  return false;
}

/**
 * Get unassigned items, optionally filtered by slot and MOS.
 */
export function getAvailableItems(slot = null, mos = null) {
  const armory = _ensureArmory();
  return armory.items.filter(i => {
    if (i.assignedTo) return false;
    if (slot && i.slot !== slot) return false;
    if (mos && i.slot === 'primary') {
      const template = getWeaponTemplate(i.templateId);
      if (template && !MOS_WEAPON_ACCESS[mos]?.includes(template.category)) return false;
    }
    if (mos && i.slot === 'utility') {
      const template = getGearTemplate(i.templateId);
      if (template?.mosRestriction && !template.mosRestriction.includes(mos)) return false;
    }
    return true;
  });
}

// ── Validation ───────────────────────────────────────────────

/**
 * Check if a soldier can equip an item.
 * @returns {{ valid: boolean, reason: string }}
 */
export function canEquip(soldier, item) {
  if (!soldier || !item) return { valid: false, reason: 'Missing soldier or item' };

  const template = getGearTemplate(item.templateId);
  if (!template) return { valid: false, reason: 'Unknown item template' };

  // Already assigned to someone else?
  if (item.assignedTo && item.assignedTo !== soldier.id) {
    return { valid: false, reason: 'Item assigned to another soldier' };
  }

  // MOS weapon restriction
  if (item.slot === 'primary') {
    const weaponTemplate = getWeaponTemplate(item.templateId);
    if (weaponTemplate) {
      const allowed = MOS_WEAPON_ACCESS[soldier.role || soldier.mos] || [];
      if (!allowed.includes(weaponTemplate.category)) {
        return { valid: false, reason: `${soldier.role || soldier.mos} cannot use ${weaponTemplate.category}` };
      }
    }
  }

  // Optic compatibility with equipped weapon
  if (item.slot === 'optic') {
    const primary = getEquipped(soldier.id, 'primary');
    if (primary) {
      const weaponTemplate = getWeaponTemplate(primary.templateId);
      if (weaponTemplate && !weaponTemplate.compatibleOptics?.includes(item.templateId)) {
        return { valid: false, reason: `${template.name} not compatible with ${weaponTemplate.name}` };
      }
    }
  }

  // Attachment compatibility with equipped weapon
  if (item.slot === 'attachment') {
    const primary = getEquipped(soldier.id, 'primary');
    if (primary) {
      const weaponTemplate = getWeaponTemplate(primary.templateId);
      if (weaponTemplate && !weaponTemplate.compatibleAttachments?.includes(item.templateId)) {
        return { valid: false, reason: `${template.name} not compatible with ${weaponTemplate.name}` };
      }
    }
  }

  // Utility MOS restriction
  if (item.slot === 'utility' && template.mosRestriction) {
    if (!template.mosRestriction.includes(soldier.role || soldier.mos)) {
      return { valid: false, reason: `${template.name} requires ${template.mosRestriction.join(' or ')}` };
    }
  }

  return { valid: true, reason: '' };
}

// ── Condition & Repair ───────────────────────────────────────

/**
 * Degrade an item's condition.
 */
export function degradeItem(itemId, amount) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item) return;
  const qualityTier = QUALITY_TIERS[item.quality] || QUALITY_TIERS.common;
  item.condition = Math.max(0, item.condition - amount * qualityTier.wearRate);
}

/**
 * Repair an item. Returns scrap cost.
 */
export function repairItem(itemId) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item) return 0;
  const repairAmount = 1.0 - item.condition;
  const baseCost = 30;
  const qualityMult = QUALITY_TIERS[item.quality]?.mult || 1.0;
  const brokenPenalty = item.condition <= 0 ? 2.0 : 1.0;
  const cost = Math.round(repairAmount * baseCost * qualityMult * brokenPenalty);
  item.condition = 1.0;
  return cost;
}

/**
 * Get repair cost without applying it.
 */
export function getRepairCost(itemId) {
  const armory = _ensureArmory();
  const item = armory.items.find(i => i.id === itemId);
  if (!item) return 0;
  const repairAmount = 1.0 - item.condition;
  const baseCost = 30;
  const qualityMult = QUALITY_TIERS[item.quality]?.mult || 1.0;
  const brokenPenalty = item.condition <= 0 ? 2.0 : 1.0;
  return Math.round(repairAmount * baseCost * qualityMult * brokenPenalty);
}

/**
 * Destroy an item permanently (gear loss on KIA/POW).
 */
export function destroyItem(itemId) {
  const armory = _ensureArmory();
  const idx = armory.items.findIndex(i => i.id === itemId);
  if (idx >= 0) armory.items.splice(idx, 1);
}

// ── Standard Issue ───────────────────────────────────────────

/**
 * Create standard issue gear for a MOS and assign to a soldier.
 * @returns {object} loadout map { primary: item, sidearm: item, ... }
 */
export function createStandardIssue(mos, soldierId) {
  const config = STANDARD_ISSUE[mos] || STANDARD_ISSUE.rifleman;
  const loadout = {};

  for (const [slot, templateId] of Object.entries(config)) {
    if (!templateId) continue;
    const item = createItem(templateId, 'standard_issue', { assignedTo: soldierId, equipped: true });
    if (item) loadout[slot] = item;
  }

  return loadout;
}

// ── Volume ───────────────────────────────────────────────────

export function getArmoryVolume() {
  const armory = _ensureArmory();
  const used = armory.items.reduce((sum, i) => sum + (i.volume || 1), 0);
  return { used, capacity: armory.capacity };
}

export function hasArmorySpace(volume = 1) {
  const { used, capacity } = getArmoryVolume();
  return used + volume <= capacity;
}

// ── Loot ─────────────────────────────────────────────────────

const LOOT_TABLES = {
  swarmer: { scrap: [2, 5],  gearChance: 0,    qualityPool: [] },
  grunt:   { scrap: [5, 15], gearChance: 0.10, qualityPool: ['standard_issue'] },
  heavy:   { scrap: [15, 30], gearChance: 0.25, qualityPool: ['common'] },
  elite:   { scrap: [30, 60], gearChance: 0.50, qualityPool: ['common', 'common', 'improved', 'improved', 'rare'] }
};

/**
 * Roll loot from a battle.
 * @param {object} killsByTier - { swarmer: N, grunt: N, heavy: N, elite: N }
 * @param {number} wave
 * @returns {{ scrap: number, items: object[] }}
 */
export function rollLoot(killsByTier, wave = 1) {
  let totalScrap = 0;
  const newItems = [];

  for (const [tier, count] of Object.entries(killsByTier)) {
    const table = LOOT_TABLES[tier];
    if (!table || count <= 0) continue;

    // Scrap — sum per kill
    for (let i = 0; i < count; i++) {
      totalScrap += table.scrap[0] + Math.floor(Math.random() * (table.scrap[1] - table.scrap[0] + 1));
    }

    // Gear — one roll per kill
    if (table.gearChance > 0) {
      for (let i = 0; i < count; i++) {
        if (Math.random() < table.gearChance) {
          const quality = table.qualityPool[Math.floor(Math.random() * table.qualityPool.length)];
          const templateId = _randomLootTemplate();
          if (templateId && hasArmorySpace()) {
            const condition = 0.6 + Math.random() * 0.4;
            const item = createItem(templateId, quality, { condition });
            if (item) newItems.push(item);
          }
        }
      }
    }
  }

  return { scrap: totalScrap, items: newItems };
}

function _randomLootTemplate() {
  // Weighted pool — more common weapons drop more
  const pool = [
    'M4A1', 'M4A1', 'AK47', 'AK47', 'M16A4',
    'MP5', 'P90',
    'M249',
    'M870',
    'red_dot', 'red_dot', 'holo',
    'foregrip', 'foregrip', 'suppressor', 'laser',
    'light_vest', 'light_vest', 'plate_carrier'
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Persistence ──────────────────────────────────────────────

export function saveArmory() {
  try {
    const armory = _ensureArmory();
    localStorage.setItem(_slotKey(ARMORY_KEY), JSON.stringify(armory));
  } catch (e) {
    console.warn('[armory] Save failed:', e);
  }
}

export function loadArmory() {
  try {
    const raw = localStorage.getItem(_slotKey(ARMORY_KEY));
    if (raw) {
      const data = JSON.parse(raw);
      Game.armory = data;
    }
    migrateItemsForKits();
  } catch (e) {
    console.warn('[armory] Load failed:', e);
  }
}
