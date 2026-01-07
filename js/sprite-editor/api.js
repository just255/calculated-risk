// sprite-editor/api.js - API communication layer
// Single responsibility: Handle all server communication

const API_BASE = '/api';

// ===== Parts API =====

// List all parts (optionally filter by unitId)
export async function listParts(unitId = null) {
  const url = unitId ? `${API_BASE}/parts?unitId=${unitId}` : `${API_BASE}/parts`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch parts');
  return response.json();
}

// Get part details
export async function getPart(partId) {
  const response = await fetch(`${API_BASE}/parts/${partId}`);
  if (!response.ok) throw new Error('Failed to fetch part');
  return response.json();
}

// Create new part
export async function createPart({ unitId, partType, name, author, width, height, frames, layers }) {
  const response = await fetch(`${API_BASE}/parts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitId, partType, name, author, width, height, frames, layers })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create part');
  }
  return response.json();
}

// Update part
export async function updatePart(partId, { name, author, width, height, frames }) {
  const response = await fetch(`${API_BASE}/parts/${partId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, author, width, height, frames })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update part');
  }
  return response.json();
}

// Delete part (archive)
export async function deletePart(partId) {
  const response = await fetch(`${API_BASE}/parts/${partId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete part');
  return response.json();
}

// Get part thumbnail image URL
export function getPartImageUrl(partId) {
  return `${API_BASE}/parts/${partId}/image`;
}

// Upload part thumbnail
export async function uploadPartImage(partId, imageData) {
  const response = await fetch(`${API_BASE}/parts/${partId}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData })
  });
  if (!response.ok) throw new Error('Failed to upload image');
  return response.json();
}

// ===== Variants API =====

// List all variants (optionally filter by objectType and objectId)
export async function listVariants(objectType = null, objectId = null) {
  let url = `${API_BASE}/variants`;
  if (objectType && objectId) {
    url = `${API_BASE}/objects/${objectType}/${objectId}/variants`;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch variants');
  return response.json();
}

// Get variant details
export async function getVariant(variantId) {
  const response = await fetch(`${API_BASE}/variants/${variantId}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch variant (${response.status})`);
  }
  return response.json();
}

// Create new variant
export async function createVariant({ objectType, objectId, name, author, canvasWidth, canvasHeight, parts }) {
  const response = await fetch(`${API_BASE}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType, objectId, name, author, canvasWidth, canvasHeight, parts })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create variant');
  }
  return response.json();
}

// Update variant (save new version)
export async function updateVariant(variantId, { author, note, canvasWidth, canvasHeight, parts }) {
  const response = await fetch(`${API_BASE}/variants/${variantId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, note, canvasWidth, canvasHeight, parts })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update variant');
  }
  return response.json();
}

// Delete variant (archive)
export async function deleteVariant(variantId) {
  const response = await fetch(`${API_BASE}/variants/${variantId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete variant');
  return response.json();
}

// Get variant version history
export async function getVariantVersions(variantId) {
  const response = await fetch(`${API_BASE}/variants/${variantId}/versions`);
  if (!response.ok) throw new Error('Failed to fetch versions');
  return response.json();
}

// Get specific variant version
export async function getVariantVersion(variantId, version) {
  const response = await fetch(`${API_BASE}/variants/${variantId}/versions/${version}`);
  if (!response.ok) throw new Error('Failed to fetch version');
  return response.json();
}

// ===== Objects API =====

// Get all game objects (units, terrain)
export async function getObjects() {
  const response = await fetch(`${API_BASE}/objects`);
  if (!response.ok) throw new Error('Failed to fetch objects');
  return response.json();
}

// Get units list
export async function getUnits() {
  const response = await fetch(`${API_BASE}/units`);
  if (!response.ok) throw new Error('Failed to fetch units');
  return response.json();
}

// Get terrain list
export async function getTerrain() {
  const response = await fetch(`${API_BASE}/terrain`);
  if (!response.ok) throw new Error('Failed to fetch terrain');
  return response.json();
}

// ===== Working Project API (New Save System) =====

// List all working projects
export async function listWorkingProjects() {
  const response = await fetch(`${API_BASE}/sprites/working`);
  if (!response.ok) throw new Error('Failed to list working projects');
  return response.json();
}

// Load a working project
export async function loadWorkingProject(unitId, partType, variant) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/working`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Failed to load project');
  return response.json();
}

// Save a working project
export async function saveWorkingProject(unitId, partType, variant, projectData) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/working`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save project');
  }
  return response.json();
}

// Save autosave to server
export async function saveAutosave(unitId, partType, variant, autosaveData) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/autosave`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(autosaveData)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save autosave');
  }
  return response.json();
}

// Get autosave from server
export async function getAutosave(unitId, partType, variant) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/autosave`);
  if (!response.ok) throw new Error('Failed to get autosave');
  return response.json();
}

// Clear autosave on server
export async function clearAutosave(unitId, partType, variant) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/autosave`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to clear autosave');
  return response.json();
}

// Publish to production
export async function publishProject(unitId, partType, variant, { imageData, animations, metadata }) {
  const response = await fetch(`${API_BASE}/sprites/${unitId}/${partType}/${variant}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData, animations, metadata })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to publish');
  }
  return response.json();
}

// ===== Auth API =====

// Verify editor password
export async function authenticate(password) {
  const response = await fetch(`${API_BASE}/editor/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  return response.json();
}
