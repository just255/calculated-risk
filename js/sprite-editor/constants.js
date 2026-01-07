// sprite-editor/constants.js - Configuration and constants
// Single responsibility: Define part types, unit categories, and config

export const AUTH_STORAGE_KEY = 'sprite-editor-auth';
export const CORRECT_PASSWORD = 'simmons1986';

// Part types by unit category
export const PART_TYPES = {
  soldier: ['helmet', 'head', 'body', 'arms', 'legs', 'weapon', 'backpack', 'accessory'],
  light_vehicle: ['chassis', 'wheels', 'hood', 'windshield', 'seats', 'mounted_gun', 'accessories'],
  tank: ['hull', 'turret', 'tracks', 'cannon', 'hatches', 'armor_plates', 'accessories'],
  terrain: ['base', 'detail', 'overlay']
};

// Map unit IDs to their category for part types
export const UNIT_CATEGORY = {
  infantry: 'soldier',
  medic: 'soldier',
  specops: 'soldier',
  jeep: 'light_vehicle',
  sherman: 'tank',
  tiger: 'tank',
  abrams: 'tank'
};

// Map unit IDs to dimension category (for scale guide)
// Separate from UNIT_CATEGORY since tanks have size classes
export const UNIT_DIMENSION_CATEGORY = {
  infantry: 'soldier',
  medic: 'soldier',
  specops: 'soldier',
  jeep: 'light_vehicle',
  sherman: 'medium_tank',
  tiger: 'heavy_tank',
  abrams: 'heavy_tank'
};

// Objects organized by category for selection UI
export const OBJECT_CATEGORIES = {
  soldiers: {
    label: 'Soldiers',
    icon: '🎖️',
    items: [
      { id: 'infantry', name: 'Infantry' },
      { id: 'medic', name: 'Medic' },
      { id: 'specops', name: 'Spec Ops' }
    ]
  },
  vehicles: {
    label: 'Vehicles',
    icon: '🚗',
    items: [
      { id: 'jeep', name: 'Willys Jeep' }
    ]
  },
  tanks: {
    label: 'Tanks',
    icon: '🛡️',
    items: [
      { id: 'sherman', name: 'M4 Sherman' },
      { id: 'tiger', name: 'Tiger I' },
      { id: 'abrams', name: 'M1 Abrams' }
    ]
  },
  terrain: {
    label: 'Terrain',
    icon: '🌲',
    items: [
      { id: 'open', name: 'Open Ground' },
      { id: 'grass', name: 'Grass' },
      { id: 'forest', name: 'Forest' },
      { id: 'water', name: 'Water' },
      { id: 'mountain', name: 'Mountain' }
    ]
  }
};

// Canvas defaults
export const CANVAS_DEFAULTS = {
  width: 256,
  height: 256,
  gridSize: 32,
  checkerSize: 16
};

// Hull/body dimensions for scaling reference
// These define the target bounding box for the hull/body (not including turret/cannon)
// Width = side-to-side, Height = front-to-back (units face up)
export const UNIT_DIMENSIONS = {
  soldier: {
    width: 32,
    height: 40,
    label: 'Soldier',
    color: '#22c55e'  // Green
  },
  light_vehicle: {
    width: 64,
    height: 96,
    label: 'Light Vehicle',
    color: '#3b82f6'  // Blue
  },
  medium_tank: {
    width: 80,
    height: 112,
    label: 'Medium Tank Hull',
    color: '#f59e0b'  // Amber
  },
  heavy_tank: {
    width: 96,
    height: 128,
    label: 'Heavy Tank Hull',
    color: '#ef4444'  // Red
  },
  super_heavy: {
    width: 112,
    height: 144,
    label: 'Super Heavy Hull',
    color: '#dc2626'  // Dark Red
  },
  terrain: {
    width: 192,
    height: 192,
    label: 'Terrain',
    color: '#a855f7'  // Purple
  }
};

// Get dimensions for a unit type
export function getUnitDimensions(unitId) {
  const category = UNIT_DIMENSION_CATEGORY[unitId];
  return UNIT_DIMENSIONS[category] || UNIT_DIMENSIONS.soldier;
}

// ===== Snap Point System =====

// Snap point types - what kind of mount/attachment point this is
export const SNAP_POINT_TYPES = {
  turret_mount: {
    id: 'turret_mount',
    label: 'Turret Mount',
    color: '#f59e0b',  // Amber
    accepts: ['turret']
  },
  cannon_mount: {
    id: 'cannon_mount',
    label: 'Cannon Mount',
    color: '#ef4444',  // Red
    accepts: ['cannon']
  },
  mg_mount: {
    id: 'mg_mount',
    label: 'MG Mount',
    color: '#ec4899',  // Pink
    accepts: ['mg', 'minigun']
  },
  track_mount: {
    id: 'track_mount',
    label: 'Track Mount',
    color: '#6b7280',  // Gray
    accepts: ['track']
  },
  light_mount: {
    id: 'light_mount',
    label: 'Light Mount',
    color: '#fbbf24',  // Yellow
    accepts: ['headlight', 'taillight', 'spotlight']
  },
  armor_mount: {
    id: 'armor_mount',
    label: 'Armor Mount',
    color: '#78716c',  // Stone
    accepts: ['armor_plate', 'skirt']
  },
  accessory: {
    id: 'accessory',
    label: 'Accessory',
    color: '#8b5cf6',  // Purple
    accepts: ['antenna', 'toolbox', 'stowage', 'flag', 'decal']
  },
  wheel_mount: {
    id: 'wheel_mount',
    label: 'Wheel Mount',
    color: '#475569',  // Slate
    accepts: ['wheel', 'tire']
  },
  weapon_mount: {
    id: 'weapon_mount',
    label: 'Weapon Mount',
    color: '#dc2626',  // Red
    accepts: ['weapon', 'rifle', 'pistol']
  },
  equipment_mount: {
    id: 'equipment_mount',
    label: 'Equipment Mount',
    color: '#059669',  // Emerald
    accepts: ['backpack', 'vest', 'medkit', 'ammo_pouch']
  },
  head_mount: {
    id: 'head_mount',
    label: 'Head Mount',
    color: '#f472b6',  // Pink
    accepts: ['head']
  },
  helmet_mount: {
    id: 'helmet_mount',
    label: 'Helmet Mount',
    color: '#a78bfa',  // Violet
    accepts: ['helmet', 'goggles', 'mask']
  }
};

// Part categories organized by group
// Each category defines what type of part this is and where it can attach

// Category groups for UI organization
export const PART_CATEGORY_GROUPS = {
  vehicle_base: {
    label: 'Vehicle - Base',
    categories: ['hull', 'chassis']
  },
  vehicle_weapons: {
    label: 'Vehicle - Weapons',
    categories: ['turret', 'cannon', 'mg', 'minigun']
  },
  vehicle_mobility: {
    label: 'Vehicle - Mobility',
    categories: ['track', 'wheel', 'tire']
  },
  vehicle_accessories: {
    label: 'Vehicle - Accessories',
    categories: ['headlight', 'taillight', 'spotlight', 'armor_plate', 'skirt', 'antenna', 'toolbox', 'stowage', 'flag', 'decal']
  },
  soldier_base: {
    label: 'Soldier - Base',
    categories: ['torso', 'legs']
  },
  soldier_head: {
    label: 'Soldier - Head',
    categories: ['head', 'helmet', 'goggles', 'mask']
  },
  soldier_gear: {
    label: 'Soldier - Gear',
    categories: ['weapon', 'sidearm', 'backpack', 'vest', 'medkit', 'ammo_pouch']
  }
};

// Part categories - what type of part this is (determines where it can attach)
export const PART_CATEGORIES = {
  // Vehicle - Base (root parts, don't attach to anything)
  hull: { id: 'hull', label: 'Hull (Tank)', group: 'vehicle_base', canAttachTo: [] },
  chassis: { id: 'chassis', label: 'Chassis (Vehicle)', group: 'vehicle_base', canAttachTo: [] },

  // Vehicle - Weapons
  turret: { id: 'turret', label: 'Turret', group: 'vehicle_weapons', canAttachTo: ['turret_mount'] },
  cannon: { id: 'cannon', label: 'Main Cannon', group: 'vehicle_weapons', canAttachTo: ['cannon_mount'] },
  mg: { id: 'mg', label: 'Machine Gun', group: 'vehicle_weapons', canAttachTo: ['mg_mount'] },
  minigun: { id: 'minigun', label: 'Minigun', group: 'vehicle_weapons', canAttachTo: ['mg_mount'] },

  // Vehicle - Mobility
  track: { id: 'track', label: 'Track', group: 'vehicle_mobility', canAttachTo: ['track_mount'] },
  wheel: { id: 'wheel', label: 'Wheel', group: 'vehicle_mobility', canAttachTo: ['wheel_mount'] },
  tire: { id: 'tire', label: 'Tire', group: 'vehicle_mobility', canAttachTo: ['wheel_mount'] },

  // Vehicle - Lights
  headlight: { id: 'headlight', label: 'Headlight', group: 'vehicle_accessories', canAttachTo: ['light_mount'] },
  taillight: { id: 'taillight', label: 'Taillight', group: 'vehicle_accessories', canAttachTo: ['light_mount'] },
  spotlight: { id: 'spotlight', label: 'Spotlight', group: 'vehicle_accessories', canAttachTo: ['light_mount'] },

  // Vehicle - Armor
  armor_plate: { id: 'armor_plate', label: 'Armor Plate', group: 'vehicle_accessories', canAttachTo: ['armor_mount'] },
  skirt: { id: 'skirt', label: 'Side Skirt', group: 'vehicle_accessories', canAttachTo: ['armor_mount'] },

  // Vehicle - Accessories
  antenna: { id: 'antenna', label: 'Antenna', group: 'vehicle_accessories', canAttachTo: ['accessory'] },
  toolbox: { id: 'toolbox', label: 'Toolbox', group: 'vehicle_accessories', canAttachTo: ['accessory'] },
  stowage: { id: 'stowage', label: 'Stowage', group: 'vehicle_accessories', canAttachTo: ['accessory'] },
  flag: { id: 'flag', label: 'Flag', group: 'vehicle_accessories', canAttachTo: ['accessory'] },
  decal: { id: 'decal', label: 'Decal', group: 'vehicle_accessories', canAttachTo: ['accessory'] },

  // Soldier - Base (root parts)
  torso: { id: 'torso', label: 'Torso', group: 'soldier_base', canAttachTo: [] },
  legs: { id: 'legs', label: 'Legs', group: 'soldier_base', canAttachTo: [] },

  // Soldier - Head
  head: { id: 'head', label: 'Head', group: 'soldier_head', canAttachTo: ['head_mount'] },
  helmet: { id: 'helmet', label: 'Helmet', group: 'soldier_head', canAttachTo: ['helmet_mount'] },
  goggles: { id: 'goggles', label: 'Goggles', group: 'soldier_head', canAttachTo: ['accessory'] },
  mask: { id: 'mask', label: 'Face Mask', group: 'soldier_head', canAttachTo: ['accessory'] },

  // Soldier - Gear
  weapon: { id: 'weapon', label: 'Primary Weapon', group: 'soldier_gear', canAttachTo: ['weapon_mount'] },
  sidearm: { id: 'sidearm', label: 'Sidearm', group: 'soldier_gear', canAttachTo: ['weapon_mount'] },
  backpack: { id: 'backpack', label: 'Backpack', group: 'soldier_gear', canAttachTo: ['equipment_mount'] },
  vest: { id: 'vest', label: 'Tactical Vest', group: 'soldier_gear', canAttachTo: ['equipment_mount'] },
  medkit: { id: 'medkit', label: 'Medkit', group: 'soldier_gear', canAttachTo: ['equipment_mount'] },
  ammo_pouch: { id: 'ammo_pouch', label: 'Ammo Pouch', group: 'soldier_gear', canAttachTo: ['equipment_mount'] }
};

// Check if a part category can attach to a snap point type
export function canAttachTo(partCategory, snapPointType) {
  const category = PART_CATEGORIES[partCategory];
  if (!category) return false;
  return category.canAttachTo.includes(snapPointType);
}

// Get snap point type info
export function getSnapPointType(typeId) {
  return SNAP_POINT_TYPES[typeId] || null;
}

// Get all snap point types as array for UI dropdowns
export function getSnapPointTypesList() {
  return Object.values(SNAP_POINT_TYPES);
}

// Get all part categories as array for UI dropdowns
export function getPartCategoriesList() {
  return Object.values(PART_CATEGORIES);
}

// Get part categories grouped for UI dropdowns with optgroups
export function getPartCategoriesGrouped() {
  const result = [];
  for (const [groupId, groupDef] of Object.entries(PART_CATEGORY_GROUPS)) {
    const categories = groupDef.categories
      .map(catId => PART_CATEGORIES[catId])
      .filter(Boolean);
    if (categories.length > 0) {
      result.push({
        groupId,
        label: groupDef.label,
        categories
      });
    }
  }
  return result;
}

// Shape/image property limits
export const SHAPE_LIMITS = {
  scale: { min: 1, max: 500 },    // 1% to 500%
  opacity: { min: 0, max: 100 },  // 0% to 100%
  canvas: { min: 1, max: 1024 }   // 1px to 1024px
};

// Tools that show cursor preview (crosshair, brush size, etc.)
export const CURSOR_PREVIEW_TOOLS = ['pencil', 'eraser', 'line', 'rect', 'circle', 'ellipse', 'selection-brush', 'lasso', 'clone-stamp', 'edge-fill', 'spray', 'blend', 'pixelate'];

// Overlay styles (labels, markers, etc.)
export const OVERLAY_STYLES = {
  label: {
    font: '10px "Courier New", monospace',
    textColor: '#4ade80',
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowBlur: 0,
    shadowOffsetX: 1,
    shadowOffsetY: 1
  },
  marker: {
    opacity: 0.5,
    size: 8
  }
};

// Format part type name for display (mounted_gun -> Mounted Gun)
export function formatPartTypeName(type) {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Calculate brush bounds for a given center position and size.
 * Used by both brush preview and actual brush painting for consistency.
 *
 * For brush size N centered at (x, y):
 * - Left edge: x - floor((N-1)/2)
 * - Size: exactly N pixels
 *
 * @param {number} x - Center X coordinate
 * @param {number} y - Center Y coordinate
 * @param {number} size - Brush size in pixels
 * @returns {{x: number, y: number, width: number, height: number}} Brush bounds
 */
export function getBrushBounds(x, y, size) {
  const offset = Math.floor((size - 1) / 2);
  return {
    x: Math.floor(x) - offset,
    y: Math.floor(y) - offset,
    width: size,
    height: size
  };
}

// Get part types for a given object
export function getPartTypesForObject(objectId, objectType) {
  if (objectType === 'terrain') {
    return PART_TYPES.terrain;
  }
  const category = UNIT_CATEGORY[objectId] || 'soldier';
  return PART_TYPES[category] || PART_TYPES.soldier;
}
