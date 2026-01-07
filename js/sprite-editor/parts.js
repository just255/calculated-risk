// sprite-editor/parts.js - Parts data loading from manifest
// Single responsibility: Load and query parts data from the sprite manifest

let spriteManifest = null;

/**
 * Load the sprite manifest from server
 * @param {boolean} forceReload - If true, ignore cached manifest and reload from server
 * @returns {Promise<Object|null>}
 */
export async function loadManifest(forceReload = false) {
  if (spriteManifest && !forceReload) return spriteManifest;

  try {
    // Add cache buster to force fresh fetch
    const cacheBuster = forceReload ? `?t=${Date.now()}` : '';
    const response = await fetch(`/sprites/manifest.json${cacheBuster}`);
    if (response.ok) {
      spriteManifest = await response.json();
      console.log('[parts] Loaded sprite manifest');
    }
  } catch (e) {
    console.warn('[parts] Could not load manifest:', e);
  }
  return spriteManifest;
}

/**
 * Force reload the manifest from server (useful after publishing)
 * @returns {Promise<Object|null>}
 */
export async function reloadManifest() {
  return loadManifest(true);
}

/**
 * Get the cached manifest (null if not loaded)
 * @returns {Object|null}
 */
export function getManifest() {
  return spriteManifest;
}

/**
 * Get existing parts of a specific type for an object
 * @param {string} objectId - e.g., 'abrams', 'infantry'
 * @param {string} partType - e.g., 'hull', 'helmet'
 * @param {string} objectType - 'unit' or 'terrain'
 * @returns {Array} Array of part objects with id, name, frameCount, thumbnail
 */
export function getPartsOfType(objectId, partType, objectType = 'unit') {
  if (!spriteManifest) return [];

  const folder = objectType === 'terrain' ? 'terrain' : 'units';
  let partsData = null;

  if (objectType === 'terrain') {
    partsData = spriteManifest.terrain?.[objectId]?.parts?.[partType];
  } else {
    partsData = spriteManifest.units?.[objectId]?.parts?.[partType];
  }

  if (!partsData) return [];

  // Add cache-busting timestamp to force fresh image loads
  const cacheBuster = `?t=${Date.now()}`;
  return partsData.map(part => ({
    id: part.id,
    name: part.name,
    frameCount: part.frameCount || 1,
    thumbnail: `/sprites/${folder}/${objectId}/${partType}/${part.file}${cacheBuster}`,
    // Include snap points and category for variant builder
    snapPoints: part.snapPoints || [],
    category: part.category || null
  }));
}

/**
 * Get all parts for an object (all types combined)
 * @param {string} objectId - e.g., 'abrams', 'infantry'
 * @param {string} objectType - 'unit' or 'terrain'
 * @returns {Array} Array of part objects with id, name, partType, frameCount, thumbnail
 */
export function getAllPartsForObject(objectId, objectType = 'unit') {
  if (!spriteManifest) return [];

  const folder = objectType === 'terrain' ? 'terrain' : 'units';
  let partsData = null;

  if (objectType === 'terrain') {
    partsData = spriteManifest.terrain?.[objectId]?.parts;
  } else {
    partsData = spriteManifest.units?.[objectId]?.parts;
  }

  if (!partsData) return [];

  // Add cache-busting timestamp to force fresh image loads
  const cacheBuster = `?t=${Date.now()}`;
  const allParts = [];
  for (const [partType, parts] of Object.entries(partsData)) {
    for (const part of parts) {
      allParts.push({
        id: part.id,
        partType: partType,
        name: part.name,
        frameCount: part.frameCount || 1,
        thumbnail: `/sprites/${folder}/${objectId}/${partType}/${part.file}${cacheBuster}`,
        // Include snap points and category for variant builder
        // Category defaults to partType (cannon, turret, hull, etc.) for snap point matching
        snapPoints: part.snapPoints || [],
        category: part.category || partType
      });
    }
  }

  return allParts;
}

/**
 * Find a specific part by ID
 * @param {string} objectId
 * @param {string} partType
 * @param {string} partId
 * @param {string} objectType
 * @returns {Object|null}
 */
export function getPartById(objectId, partType, partId, objectType = 'unit') {
  const parts = getPartsOfType(objectId, partType, objectType);
  return parts.find(p => p.id === partId) || null;
}
