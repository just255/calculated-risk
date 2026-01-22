// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Presets System
// Built-in and custom preset management
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'terrain-editor-presets';

/**
 * Built-in presets
 */
export const BUILT_IN_PRESETS = {
  temperate: {
    name: 'Temperate Forest',
    treeTypes: ['oak', 'birch', 'oak-dead'],
    treeRatios: { oak: 0.5, birch: 0.35, 'oak-dead': 0.15 },
    selectedAges: ['young', 'transitional', 'old'],
    ageRatios: { young: 0.3, transitional: 0.4, old: 0.3 },
    treeScale: 0.35,
    treeDensity: 5
  },
  boreal: {
    name: 'Boreal/Conifer',
    treeTypes: ['pine', 'birch', 'pine-dead'],
    treeRatios: { pine: 0.6, birch: 0.3, 'pine-dead': 0.1 },
    selectedAges: ['young', 'transitional', 'old'],
    ageRatios: { young: 0.25, transitional: 0.35, old: 0.4 },
    treeScale: 0.35,
    treeDensity: 6
  },
  wetland: {
    name: 'Wetland',
    treeTypes: ['willow', 'birch', 'willow-dead'],
    treeRatios: { willow: 0.55, birch: 0.35, 'willow-dead': 0.1 },
    selectedAges: ['transitional', 'old'],
    ageRatios: { transitional: 0.4, old: 0.6 },
    treeScale: 0.4,
    treeDensity: 4
  },
  mixed: {
    name: 'Mixed Forest',
    treeTypes: ['oak', 'pine', 'birch', 'oak-dead'],
    treeRatios: { oak: 0.3, pine: 0.3, birch: 0.3, 'oak-dead': 0.1 },
    selectedAges: ['young', 'transitional', 'old'],
    ageRatios: { young: 0.33, transitional: 0.34, old: 0.33 },
    treeScale: 0.35,
    treeDensity: 5
  },
  'dead-forest': {
    name: 'Dead Forest',
    treeTypes: ['oak-dead', 'pine-dead', 'birch-dead'],
    treeRatios: { 'oak-dead': 0.4, 'pine-dead': 0.35, 'birch-dead': 0.25 },
    selectedAges: ['transitional', 'old'],
    ageRatios: { transitional: 0.3, old: 0.7 },
    treeScale: 0.35,
    treeDensity: 4
  },
  'sparse-old': {
    name: 'Sparse Old Growth',
    treeTypes: ['oak', 'willow'],
    treeRatios: { oak: 0.6, willow: 0.4 },
    selectedAges: ['old'],
    ageRatios: { old: 1.0 },
    treeScale: 0.5,
    treeDensity: 2
  }
};

/**
 * Load custom presets from localStorage
 * @returns {Object} Map of preset id -> preset data
 */
export function loadCustomPresets() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.warn('[Presets] Failed to load custom presets:', e);
    return {};
  }
}

/**
 * Save custom presets to localStorage
 * @param {Object} presets - Map of preset id -> preset data
 */
export function saveCustomPresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('[Presets] Failed to save custom presets:', e);
  }
}

/**
 * Get a preset by ID (checks built-in first, then custom)
 * @param {string} id - Preset ID
 * @returns {Object|null} Preset data or null if not found
 */
export function getPreset(id) {
  if (BUILT_IN_PRESETS[id]) {
    return { ...BUILT_IN_PRESETS[id] };
  }
  const custom = loadCustomPresets();
  if (custom[id]) {
    return { ...custom[id] };
  }
  return null;
}

/**
 * Check if a preset ID is built-in
 * @param {string} id - Preset ID
 * @returns {boolean}
 */
export function isBuiltInPreset(id) {
  return !!BUILT_IN_PRESETS[id];
}

/**
 * Save a new custom preset
 * @param {string} name - Display name for the preset
 * @param {Object} settings - Preset settings
 * @returns {string} Generated preset ID
 */
export function savePreset(name, settings) {
  const id = `custom_${Date.now()}`;
  const presets = loadCustomPresets();
  presets[id] = {
    name,
    ...settings
  };
  saveCustomPresets(presets);
  return id;
}

/**
 * Delete a custom preset
 * @param {string} id - Preset ID to delete
 * @returns {boolean} True if deleted, false if not found or is built-in
 */
export function deletePreset(id) {
  if (isBuiltInPreset(id)) {
    return false;
  }
  const presets = loadCustomPresets();
  if (presets[id]) {
    delete presets[id];
    saveCustomPresets(presets);
    return true;
  }
  return false;
}

/**
 * Get all presets (built-in + custom)
 * @returns {Object} Map of all preset id -> preset data
 */
export function getAllPresets() {
  return {
    ...BUILT_IN_PRESETS,
    ...loadCustomPresets()
  };
}

/**
 * Extract current settings from state for saving as preset
 * @param {Object} toolOptions - Current tool options from state
 * @returns {Object} Settings object suitable for saving
 */
export function extractPresetSettings(toolOptions) {
  return {
    treeTypes: [...(toolOptions.treeTypes || ['oak'])],
    treeRatios: { ...(toolOptions.treeRatios || { oak: 1.0 }) },
    selectedAges: [...(toolOptions.selectedAges || ['young', 'transitional', 'old'])],
    ageRatios: { ...(toolOptions.ageRatios || { young: 0.33, transitional: 0.34, old: 0.33 }) },
    treeScale: toolOptions.treeScale || 0.35,
    treeDensity: toolOptions.treeDensity || 5
  };
}
