// sprite-editor/main.js - Entry point and event coordination
// Single responsibility: Initialize app, wire up events, coordinate modules

import { state, resetObjectSelection, resetEditorState, markDirty, markClean, setProjectPath, getAutosaveKey } from './state.js';
import { checkAuth, authenticate } from './auth.js';
import { OBJECT_CATEGORIES, SHAPE_LIMITS, CURSOR_PREVIEW_TOOLS, SNAP_POINT_TYPES, PART_CATEGORIES, getSnapPointTypesList, getPartCategoriesList, getPartCategoriesGrouped, canAttachTo } from './constants.js';
import { initLayers, addLayer, selectLayer, toggleLayerVisibility, moveLayerUp, moveLayerDown, duplicateLayer, deleteLayer } from './layers.js';
import { loadImage, cacheImage, getCachedImage } from './images.js';
import { loadManifest, reloadManifest, getPartsOfType, getAllPartsForObject, getPartById } from './parts.js';
import { selectFrame, addFrame, prevFrame, nextFrame, togglePlayback, setFrameChangeCallback, updatePlaybackSpeed } from './frames.js';
import { initVariantBuilder, addPartToVariant, selectPartInVariant, movePartForward, movePartBackward, removeSelectedPart, getSelectedPart, togglePartVisibility, hitTestPart, startPartDrag, continuePartDrag, endPartDrag, isDraggingPart, selectAllParts, getSelectedPartIndices, isPartSelected, setAllSelectedScale, clearMultiSelection, startMarquee, continueMarquee, endMarquee, cancelMarquee, isMarqueeSelecting, getMarqueeBounds, setPartAnimation, getPartAnimation } from './variants.js';
import { initCanvas, render, zoomIn, zoomOut, resetZoom, updateZoom, toggleGrid, toggleRef, toggleOnion, toggleContextParts, setRefImage, clearRefImage as clearRef, getCanvasPosition, getGizmoHandleAt, generateFrameThumbnail, generateSpritesheet, renderCleanFrame } from './canvas.js';
import * as selection from './selection.js';
import * as clipboard from './clipboard.js';
import * as cloneStamp from './clone-stamp.js';
import { saveHistory, undo, redo } from './history.js';
import { startDraw, continueDraw, endDraw, isCurrentlyDrawing, isInClickPlaceMode, cancelClickPlaceMode, undoLastLassoPoint, dragShape, endDragShape, resizeShape, endResizeShape, isResizing, getSelectedShape, clearShapeSelection, deleteSelectedShape, updateSelectedShape, clearEdgeFillRefPoints, getEdgeFillRefPoints } from './tools.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as debug from './debug.js';
import * as animation from './animation.js';
import * as snapPoints from './snap-points.js';
import * as snapOverlay from './snap-overlay.js';
import * as gizmoOverlay from './gizmo-overlay.js';
import * as selectionOverlay from './selection-overlay.js';

// Helper to render all HTML overlays (call after selection/transform changes)
function renderOverlays() {
  if (state.selectedMode === 'variant-builder') {
    gizmoOverlay.renderGizmoOverlay();
    selectionOverlay.renderSelectionOverlay();
    snapOverlay.renderSnapPointOverlay();
  }
}

// Helper to update overlay positions (call during pan/zoom)
function updateOverlayPositions() {
  if (state.selectedMode === 'variant-builder') {
    gizmoOverlay.updateGizmoPositions();
    selectionOverlay.updateSelectionPositions();
    snapOverlay.updateSnapPointPositions();
  }
}

// Panning state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOffsetX = 0;
let panOffsetY = 0;

// Animation trigger tab state (which trigger is being edited)
let currentAnimationTrigger = 'idle';

function startPan(e) {
  isPanning = true;
  panStartX = e.clientX - panOffsetX;
  panStartY = e.clientY - panOffsetY;
  document.body.style.cursor = 'grabbing';
}

function continuePan(e) {
  if (!isPanning) return;
  panOffsetX = e.clientX - panStartX;
  panOffsetY = e.clientY - panStartY;
  updateCanvasTransform();
}

function endPan() {
  isPanning = false;
  document.body.style.cursor = '';
}

function updateCanvasTransform() {
  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${state.zoom})`;
    // Update all HTML overlay positions after transform
    if (state.selectedMode === 'variant-builder') {
      requestAnimationFrame(() => {
        snapOverlay.updateSnapPointPositions();
        gizmoOverlay.updateGizmoPositions();
        selectionOverlay.updateSelectionPositions();
      });
    } else if (state.selectedMode === 'part-editor') {
      requestAnimationFrame(() => snapOverlay.updateSnapPointPositions());
    }
  }
}

// Export pan offset for snap overlay calculations
export function getPanOffset() {
  return { x: panOffsetX, y: panOffsetY };
}

function resetPan() {
  // Center the canvas in the container
  const canvas = document.getElementById('canvas');
  const container = canvas?.parentElement;
  if (canvas && container) {
    const containerRect = container.getBoundingClientRect();
    // Only center if container has dimensions (is visible)
    if (containerRect.width > 0 && containerRect.height > 0) {
      const canvasWidth = canvas.width * state.zoom;
      const canvasHeight = canvas.height * state.zoom;
      panOffsetX = (containerRect.width - canvasWidth) / 2;
      panOffsetY = (containerRect.height - canvasHeight) / 2;
    }
  }
  updateCanvasTransform();
}

// ===== Reference Image System (Variant Builder) =====

// Populate the reference source dropdown with available units
function populateReferenceSourceDropdown(select) {
  // Clear existing options except first
  while (select.options.length > 1) select.remove(1);

  // Add options from OBJECT_CATEGORIES (excluding terrain)
  for (const [catKey, cat] of Object.entries(OBJECT_CATEGORIES)) {
    if (catKey === 'terrain') continue;

    const group = document.createElement('optgroup');
    group.label = cat.label;

    for (const item of cat.items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      group.appendChild(opt);
    }

    select.appendChild(group);
  }
}

// Load a reference image from a unit's default variant
async function loadReferenceImage(unitId) {
  if (!unitId) {
    state.referenceImage = null;
    render();
    return;
  }

  try {
    // Try to load the unit's default variant sprite
    const url = `/sprites/units/${unitId}/default/sprite.png`;
    const img = await loadImage(url);

    state.referenceImage = {
      src: url,
      img: img,
      x: 0,
      y: 0,
      scale: 100,
      opacity: 50
    };

    // Update UI inputs
    const scaleInput = document.getElementById('referenceScale');
    const xInput = document.getElementById('referenceX');
    const yInput = document.getElementById('referenceY');
    const opacitySlider = document.getElementById('referenceOpacity');
    const opacityValue = document.getElementById('referenceOpacityValue');

    if (scaleInput) scaleInput.value = 100;
    if (xInput) xInput.value = 0;
    if (yInput) yInput.value = 0;
    if (opacitySlider) opacitySlider.value = 50;
    if (opacityValue) opacityValue.textContent = '50%';

    // Auto-enable visibility
    state.showReferenceImage = true;
    const showCheckbox = document.getElementById('showReferenceImage');
    if (showCheckbox) showCheckbox.checked = true;

    render();
  } catch (err) {
    console.warn(`Could not load reference image for ${unitId}:`, err);
    state.referenceImage = null;
    render();
  }
}

// ===== Snap Point System (Part Editor) =====

// Populate the category dropdown with grouped options
function populatePartCategoryDropdown() {
  const select = document.getElementById('partCategorySelect');
  if (!select) return;

  // Clear existing options except first (the "None" option)
  while (select.options.length > 1) select.remove(1);

  // Add categories grouped by type
  for (const group of getPartCategoriesGrouped()) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;

    for (const cat of group.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.label;
      optgroup.appendChild(opt);
    }

    select.appendChild(optgroup);
  }

  // Set current value
  select.value = state.partCategory || '';
}

// Populate the snap point type dropdown
function populateSnapPointTypeDropdown() {
  const select = document.getElementById('snapPointType');
  if (!select) return;

  select.innerHTML = '';
  for (const type of getSnapPointTypesList()) {
    const opt = document.createElement('option');
    opt.value = type.id;
    opt.textContent = type.label;
    select.appendChild(opt);
  }
}

// Start snap point placement mode
function startSnapPointPlacement() {
  state.snapPointTool = true;
  ui.setStatus('Click on canvas to place snap point');
  document.getElementById('addSnapPointBtn')?.classList.add('active');
}

// Cancel snap point placement
function cancelSnapPointPlacement() {
  state.snapPointTool = false;
  document.getElementById('addSnapPointBtn')?.classList.remove('active');
}

// Add a snap point at canvas position
function addSnapPoint(x, y) {
  const id = `snap_${Date.now()}`;
  const snapPoint = {
    id,
    name: `point_${state.snapPoints.length + 1}`,
    // Round to 0.5 increments for pixel-center positioning
    x: Math.round((x - state.canvasWidth / 2) * 2) / 2,
    y: Math.round((y - state.canvasHeight / 2) * 2) / 2,
    type: 'cannon_mount',  // Default type
    rotation: 0
  };

  state.snapPoints.push(snapPoint);
  state.selectedSnapPointId = id;
  cancelSnapPointPlacement();
  saveHistory();
  markDirty();
  renderSnapPointsList();
  updateSnapPointProps();
  render();
  snapOverlay.renderSnapPointOverlay();
}

// Select a snap point
function selectSnapPoint(id) {
  state.selectedSnapPointId = id;
  renderSnapPointsList();
  updateSnapPointProps();
  render();
  snapOverlay.renderSnapPointOverlay();
}

// Delete selected snap point
function deleteSelectedSnapPoint() {
  if (!state.selectedSnapPointId) return;

  const idx = state.snapPoints.findIndex(p => p.id === state.selectedSnapPointId);
  if (idx >= 0) {
    saveHistory();
    state.snapPoints.splice(idx, 1);
    state.selectedSnapPointId = null;
    markDirty();
    renderSnapPointsList();
    updateSnapPointProps();
    render();
    snapOverlay.renderSnapPointOverlay();
  }
}

// Render the snap points list
function renderSnapPointsList() {
  const container = document.getElementById('snapPointsList');
  if (!container) return;

  if (state.snapPoints.length === 0) {
    container.innerHTML = `
      <div class="empty-list-message" style="color: var(--text-muted); font-size: 0.8rem; padding: 8px;">
        No snap points defined. Click + Add to place one.
      </div>`;
    return;
  }

  container.innerHTML = state.snapPoints.map(p => {
    const typeInfo = SNAP_POINT_TYPES[p.type] || { label: p.type, color: '#888' };
    const isSelected = p.id === state.selectedSnapPointId;
    return `
      <div class="layer-item ${isSelected ? 'selected' : ''}"
           onclick="spriteEditor.selectSnapPoint('${p.id}')"
           style="display: flex; align-items: center; gap: 6px;">
        <span style="width: 10px; height: 10px; border-radius: 50%; background: ${typeInfo.color};"></span>
        <span style="flex: 1;">${p.name}</span>
        <span style="font-size: 0.7rem; color: var(--text-muted);">${typeInfo.label}</span>
      </div>`;
  }).join('');

  // Update delete button state
  const deleteBtn = document.getElementById('deleteSnapPointBtn');
  if (deleteBtn) deleteBtn.disabled = !state.selectedSnapPointId;

  // Update rotation pivot dropdown with snap points
  updateRotationPivotDropdown();
}

// Update snap point properties panel
function updateSnapPointProps() {
  const propsDiv = document.getElementById('snapPointProps');
  const deleteBtn = document.getElementById('deleteSnapPointBtn');
  if (!propsDiv) return;

  const point = state.snapPoints.find(p => p.id === state.selectedSnapPointId);

  if (!point) {
    propsDiv.classList.add('hidden');
    if (deleteBtn) deleteBtn.disabled = true;
    return;
  }

  propsDiv.classList.remove('hidden');
  if (deleteBtn) deleteBtn.disabled = false;

  document.getElementById('snapPointName').value = point.name;
  document.getElementById('snapPointType').value = point.type;
  document.getElementById('snapPointX').value = point.x;
  document.getElementById('snapPointY').value = point.y;
}

// Update snap point from UI
function updateSelectedSnapPoint(field, value) {
  const point = state.snapPoints.find(p => p.id === state.selectedSnapPointId);
  if (!point) return;

  saveHistory();
  point[field] = value;
  markDirty();

  if (field === 'name' || field === 'type') {
    renderSnapPointsList();
  }
  render();
  snapOverlay.renderSnapPointOverlay();
}

// ===== Measure Tool =====

// Handle click for measure tool
function handleMeasureClick(x, y) {
  // Round to nearest pixel
  const point = { x: Math.round(x), y: Math.round(y) };

  if (state.measurePoints.length >= 2) {
    // Start a new measurement
    state.measurePoints = [point];
  } else {
    state.measurePoints.push(point);
  }

  updateMeasureUI();
  render();
}

// Update measure tool UI panel
function updateMeasureUI() {
  const p1Elem = document.getElementById('measurePoint1');
  const p2Elem = document.getElementById('measurePoint2');
  const distElem = document.getElementById('measureDistance');
  const midElem = document.getElementById('measureMidpoint');

  if (!p1Elem) return;

  const p1 = state.measurePoints[0];
  const p2 = state.measurePoints[1];

  // Point 1
  if (p1) {
    p1Elem.textContent = `Point 1: (${p1.x}, ${p1.y})`;
    p1Elem.style.color = 'var(--text-primary)';
  } else {
    p1Elem.textContent = 'Point 1: -';
    p1Elem.style.color = 'var(--text-muted)';
  }

  // Point 2
  if (p2) {
    p2Elem.textContent = `Point 2: (${p2.x}, ${p2.y})`;
    p2Elem.style.color = 'var(--text-primary)';
  } else {
    p2Elem.textContent = 'Point 2: -';
    p2Elem.style.color = 'var(--text-muted)';
  }

  // Distance and midpoint (only if we have 2 points)
  if (p1 && p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    distElem.textContent = `Distance: ${dist.toFixed(1)} px`;
    distElem.style.color = 'var(--accent-green)';

    midElem.textContent = `Midpoint: (${midX.toFixed(1)}, ${midY.toFixed(1)})`;
    midElem.style.color = '#60a5fa';  // Blue
  } else {
    distElem.textContent = 'Distance: -';
    distElem.style.color = 'var(--text-muted)';
    midElem.textContent = 'Midpoint: -';
    midElem.style.color = 'var(--text-muted)';
  }
}

// Add current measurement as a persistent guide
function addMeasureGuide() {
  if (state.measurePoints.length < 2) {
    ui.setStatus('Need 2 points to add a guide');
    return;
  }

  const p1 = state.measurePoints[0];
  const p2 = state.measurePoints[1];

  state.measureGuides.push({
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y }
  });

  // Clear current measurement
  state.measurePoints = [];
  updateMeasureUI();
  render();
  ui.setStatus('Guide added');
}

// Clear current measurement
function clearMeasure() {
  state.measurePoints = [];
  updateMeasureUI();
  render();
}

// Clear all guides
function clearAllGuides() {
  state.measureGuides = [];
  render();
  ui.setStatus('All guides cleared');
}

// ===== Rotation Preview (Part Editor) =====
let rotationAnimationId = null;
let lastRotationTime = 0;

// Toggle rotation preview on/off
function toggleRotationPreview() {
  state.rotationPreview.enabled = !state.rotationPreview.enabled;
  updateRotationPreviewButton();

  if (state.rotationPreview.enabled) {
    lastRotationTime = performance.now();
    rotationAnimationId = requestAnimationFrame(animateRotation);
    ui.setStatus('Rotation preview started');
  } else {
    if (rotationAnimationId) {
      cancelAnimationFrame(rotationAnimationId);
      rotationAnimationId = null;
    }
    ui.setStatus('Rotation preview stopped');
  }
}

// Animation loop for rotation preview
function animateRotation(currentTime) {
  if (!state.rotationPreview.enabled) return;

  const deltaTime = (currentTime - lastRotationTime) / 1000; // seconds
  lastRotationTime = currentTime;

  // Update angle based on speed
  state.rotationPreview.angle += state.rotationPreview.speed * deltaTime;
  state.rotationPreview.angle = state.rotationPreview.angle % 360;

  // Update UI
  const angleSlider = document.getElementById('rotationAngle');
  const angleNum = document.getElementById('rotationAngleNum');
  if (angleSlider) angleSlider.value = Math.round(state.rotationPreview.angle);
  if (angleNum) angleNum.value = Math.round(state.rotationPreview.angle);

  render();

  rotationAnimationId = requestAnimationFrame(animateRotation);
}

// Update play/pause button text
function updateRotationPreviewButton() {
  const btn = document.getElementById('rotationPreviewBtn');
  if (btn) {
    btn.textContent = state.rotationPreview.enabled ? '⏸ Pause' : '▶ Play';
    btn.style.background = state.rotationPreview.enabled ? 'var(--accent-orange)' : '';
  }
}

// Reset rotation preview to 0
function resetRotationPreview() {
  state.rotationPreview.angle = 0;
  state.rotationPreview.enabled = false;

  if (rotationAnimationId) {
    cancelAnimationFrame(rotationAnimationId);
    rotationAnimationId = null;
  }

  updateRotationPreviewButton();

  const angleSlider = document.getElementById('rotationAngle');
  const angleNum = document.getElementById('rotationAngleNum');
  if (angleSlider) angleSlider.value = 0;
  if (angleNum) angleNum.value = 0;

  render();
  ui.setStatus('Rotation preview reset');
}

// Update rotation pivot dropdown with snap points
function updateRotationPivotDropdown() {
  const select = document.getElementById('rotationPivot');
  if (!select) return;

  // Remember current selection
  const currentValue = select.value;

  // Clear and rebuild options
  select.innerHTML = '<option value="center">Center</option>';

  // Add snap points as pivot options
  for (const point of state.snapPoints) {
    const opt = document.createElement('option');
    opt.value = point.id;
    opt.textContent = `${point.name} (${point.x}, ${point.y})`;
    select.appendChild(opt);
  }

  // Restore selection if still valid
  if (currentValue && [...select.options].some(o => o.value === currentValue)) {
    select.value = currentValue;
  }
}

// Set rotation pivot
function setRotationPivot(pivotId) {
  state.rotationPreview.pivotType = pivotId;

  if (pivotId === 'center') {
    state.rotationPreview.pivotX = 0;
    state.rotationPreview.pivotY = 0;
  } else {
    // Find snap point
    const point = state.snapPoints.find(p => p.id === pivotId);
    if (point) {
      state.rotationPreview.pivotX = point.x;
      state.rotationPreview.pivotY = point.y;
    }
  }

  render();
}

// ===== Autosave System (Client-side only) =====
let localAutosaveTimer = null;
const LOCAL_AUTOSAVE_INTERVAL = 30000;  // 30 seconds

// Start autosave timer
function startAutosave() {
  stopAutosave();

  // Local autosave every 30 seconds
  localAutosaveTimer = setInterval(() => {
    if (state.isDirty && state.projectPath) {
      autosaveToLocalStorage();
    }
  }, LOCAL_AUTOSAVE_INTERVAL);

  debug.log('Autosave started');
}

// Stop autosave timer
function stopAutosave() {
  if (localAutosaveTimer) {
    clearInterval(localAutosaveTimer);
    localAutosaveTimer = null;
  }
}

// Get current project data for saving
function getProjectData() {
  return {
    version: '1.0',
    metadata: {
      unitId: state.selectedObjectId,
      partType: state.selectedPartType,
      variantName: state.projectPath?.variant || 'default',
      author: state.artistName || 'Artist'
    },
    canvas: {
      width: state.canvasWidth,
      height: state.canvasHeight
    },
    frames: state.frames.map((frame, idx) => ({
      id: frame.id || `frame-${idx + 1}`,
      name: frame.name || `Frame ${idx + 1}`,
      layers: idx === state.currentFrame ? state.layers : frame.layers
    })),
    // Snap point system
    snapPoints: state.snapPoints || [],
    partCategory: state.partCategory || null,
    animations: {} // TODO: Add animation data when implemented
  };
}

// Autosave to localStorage
function autosaveToLocalStorage() {
  const key = getAutosaveKey();
  if (!key) return;

  try {
    const data = getProjectData();
    data.autosavedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(data));
    state.lastAutosavedAt = data.autosavedAt;
    updateSaveStatusUI();
    debug.log('Autosaved to localStorage');
  } catch (err) {
    debug.error('localStorage autosave failed:', err.message);
  }
}

// Update save status indicator in UI
function updateSaveStatusUI() {
  const indicator = document.getElementById('saveStatus');
  if (!indicator) return;

  if (state.saveStatus === 'saving') {
    indicator.textContent = 'Saving...';
    indicator.className = 'save-status saving';
  } else if (!state.isDirty && state.lastSavedAt) {
    const ago = getTimeAgo(state.lastSavedAt);
    indicator.textContent = `Saved ${ago}`;
    indicator.className = 'save-status saved';
  } else if (state.isDirty) {
    if (state.lastAutosavedAt) {
      const ago = getTimeAgo(state.lastAutosavedAt);
      indicator.textContent = `Autosaved ${ago}`;
      indicator.className = 'save-status autosaved';
    } else {
      indicator.textContent = 'Unsaved changes';
      indicator.className = 'save-status unsaved';
    }
  } else {
    indicator.textContent = '';
    indicator.className = 'save-status';
  }
}

// Get human-readable time ago string
function getTimeAgo(isoString) {
  const now = new Date();
  const then = new Date(isoString);
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Check for autosave recovery on startup
function checkAutosaveRecovery() {
  if (!state.projectPath) return;

  const localKey = getAutosaveKey();
  if (!localKey) return;

  // Check localStorage for autosave
  let autosaveData = null;
  try {
    const stored = localStorage.getItem(localKey);
    if (stored) autosaveData = JSON.parse(stored);
  } catch (e) { /* ignore */ }

  // Check if autosave is newer than last save
  if (autosaveData && state.lastSavedAt) {
    if (new Date(autosaveData.autosavedAt) <= new Date(state.lastSavedAt)) {
      autosaveData = null; // Autosave is older, no recovery needed
    }
  }

  if (autosaveData) {
    showRecoveryPrompt(autosaveData);
  }
}

// Show recovery prompt modal
function showRecoveryPrompt(autosaveData) {
  const overlay = document.getElementById('recoveryOverlay');
  if (!overlay) {
    debug.warn('Recovery overlay not found in DOM');
    return;
  }

  const timeEl = document.getElementById('recoveryTime');
  if (timeEl && autosaveData.autosavedAt) {
    timeEl.textContent = new Date(autosaveData.autosavedAt).toLocaleString();
  }

  // Store for later use
  window._pendingRecovery = autosaveData;

  overlay.classList.remove('hidden');
}

// Handle recovery choice
function recoverAutosave() {
  const data = window._pendingRecovery;
  if (data) {
    loadProjectData(data);
    markDirty(); // Mark as dirty since this is recovered unsaved work
    ui.setStatus('Recovered from autosave');
  }
  document.getElementById('recoveryOverlay')?.classList.add('hidden');
  window._pendingRecovery = null;
}

function discardAutosave() {
  // Clear autosave from localStorage
  const key = getAutosaveKey();
  if (key) localStorage.removeItem(key);

  document.getElementById('recoveryOverlay')?.classList.add('hidden');
  window._pendingRecovery = null;
  ui.setStatus('Autosave discarded');
}

// Load project data into editor state
function loadProjectData(data) {
  if (data.canvas) {
    state.canvasWidth = data.canvas.width || state.canvasWidth;
    state.canvasHeight = data.canvas.height || state.canvasHeight;

    // Resize the canvas element to match
    const canvas = document.getElementById('canvas');
    if (canvas) {
      canvas.width = state.canvasWidth;
      canvas.height = state.canvasHeight;
    }
  }
  if (data.frames && data.frames.length > 0) {
    state.frames = data.frames;
    state.currentFrame = 0;
    state.layers = data.frames[0].layers || [];

    // Set selectedLayerId to first layer (required for editing)
    if (state.layers.length > 0) {
      state.selectedLayerId = state.layers[0].id;
    }
  }
  if (data.metadata) {
    state.artistName = data.metadata.author || state.artistName;
  }

  // Load snap points and part category
  if (data.snapPoints) {
    state.snapPoints = data.snapPoints;
    state.selectedSnapPointId = null;
  }
  if (data.partCategory !== undefined) {
    state.partCategory = data.partCategory;
  }

  // Update UI panels
  renderLayers();
  renderFrames();
  renderSnapPointsList();
  updateSnapPointProps();

  // Update part category dropdown
  const categorySelect = document.getElementById('partCategorySelect');
  if (categorySelect) {
    categorySelect.value = state.partCategory || '';
  }

  // Update canvas size inputs
  const widthInput = document.getElementById('canvasWidthInput');
  const heightInput = document.getElementById('canvasHeightInput');
  if (widthInput) widthInput.value = state.canvasWidth;
  if (heightInput) heightInput.value = state.canvasHeight;

  render();
}

// Initialize the application
export function init() {
  ui.initUI();
  debug.init();
  loadUIScale();
  setupHoldButtons();

  // Set up frame change callback for animation playback
  setFrameChangeCallback(() => {
    renderLayers();
    renderFrames();
    render();
  });

  // Check if already authenticated
  if (checkAuth()) {
    ui.showAuthOverlay(false);
    initEditor();
  }

  // Setup event listeners
  setupEventListeners();
}

// Load UI scale from localStorage
function loadUIScale() {
  const savedScale = localStorage.getItem('spriteEditor_uiScale');
  const scale = savedScale ? parseInt(savedScale) : 100;
  setUIScale(scale, false);
}

// Set UI scale
function setUIScale(percent, save = true) {
  const scale = percent / 100;
  document.documentElement.style.setProperty('--ui-scale', scale);
  if (save) {
    localStorage.setItem('spriteEditor_uiScale', percent);
  }
  ui.updateScaleMenu(percent);
  ui.setStatus(`UI Scale: ${percent}%`);
}

// Setup all event listeners
function setupEventListeners() {
  // Auth
  document.getElementById('authPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuthenticate();
  });

  // Tool changed event (from tools.js when eyedropper adds to target colors)
  document.addEventListener('toolChanged', (e) => {
    const tool = e.detail.tool;
    state.tool = tool;
    ui.setActiveTool(tool);
    updateToolOptionsPanel();
    renderTargetColorsList();
  });

  // Target colors changed event (from tools.js when color is picked for lasso)
  document.addEventListener('targetColorsChanged', () => {
    renderTargetColorsList();
    rerunLassoSelection();
  });

  // Canvas
  const canvas = document.getElementById('canvas');
  initCanvas(canvas);

  // Initialize snap point HTML overlay
  snapOverlay.initSnapOverlay({
    // Variant Builder: part attached via overlay click
    onAttach: (partIndex, parentIndex, snapId) => {
      ui.setStatus(`Attached to ${snapId}`);
      renderPartsInVariant();
      updatePartProperties();
      saveHistory();
      render();
      snapOverlay.renderSnapPointOverlay();
    },
    // Variant Builder: snap point clicked - show attachment panel
    onSnapPointClick: (info) => {
      showSnapAttachPanel(info);
    },
    // Part Editor: snap point selected
    onSelect: (snapId) => {
      state.selectedSnapPointId = snapId;
      renderSnapPointsList();
      updateSnapPointProps();
    },
    // Part Editor: snap point moved by dragging
    onMove: (snapId, newX, newY) => {
      const point = state.snapPoints.find(p => p.id === snapId);
      if (point) {
        point.x = newX;
        point.y = newY;
        markDirty();
        saveHistory();
        updateSnapPointProps();
      }
    }
  });

  // Initialize gizmo HTML overlay
  const canvasWrapper = document.getElementById('canvasWrapper');
  gizmoOverlay.initGizmoOverlay(canvasWrapper, (handleType, partIndex, e) => {
    // Select the part if clicking on a non-primary gizmo
    if (partIndex !== state.selectedPartInVariant) {
      selectPartInVariant(partIndex, e.shiftKey);
      renderPartsInVariant();
      updatePartProperties();
    }

    // Start drag with axis constraint
    const pos = getCanvasPosition(e);
    startPartDrag(pos.x, pos.y, handleType);
    render();
    gizmoOverlay.renderGizmoOverlay();
    selectionOverlay.renderSelectionOverlay();

    // Add document-level handlers for drag (since mouse may leave gizmo/canvas)
    const onMouseMove = (moveEvent) => {
      const movePos = getCanvasPosition(moveEvent);
      continuePartDrag(movePos.x, movePos.y);

      // Check for detachment if part is attached
      if (state.selectedPartInVariant !== null) {
        const part = state.partsInVariant[state.selectedPartInVariant];
        if (part && snapPoints.isPartAttached(state.selectedPartInVariant)) {
          const snapWorldPos = snapPoints.getSnapPointWorldPosition(part.parentIndex, part.attachedTo);
          if (snapWorldPos) {
            const dist = Math.hypot(part.x - snapWorldPos.x, part.y - snapWorldPos.y);
            if (dist > 30) {
              snapPoints.detachPart(state.selectedPartInVariant);
              ui.setStatus('Detached from parent');
            }
          }
        }
        snapPoints.updateCandidateSnapPoint(state.selectedPartInVariant, movePos.x, movePos.y);
      }
      render();
      updateOverlayPositions();
    };

    const onMouseUp = (upEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Check for snap point attachment
      const candidate = snapPoints.getCandidateSnapPoint();
      if (candidate && candidate.compatible && state.selectedPartInVariant !== null) {
        snapPoints.attachPartToSnapPoint(
          state.selectedPartInVariant,
          candidate.parentIndex,
          candidate.snapPointId
        );
        ui.setStatus(`Attached to ${candidate.snapPointId}`);
      }
      snapPoints.clearCandidateSnapPoint();
      endPartDrag();
      updatePartProperties();
      renderPartsInVariant();
      render();
      renderOverlays();
      saveHistory();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Initialize selection HTML overlay
  selectionOverlay.initSelectionOverlay(canvasWrapper);

  // Drawing events - all tool handling delegated to tools.js
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click only
      // Variant builder: click to select/drag parts
      if (state.selectedMode === 'variant-builder') {
        const pos = getCanvasPosition(e);
        const isShift = e.shiftKey;

        // Gizmo clicks are now handled by HTML overlay (gizmo-overlay.js)
        // Snap point clicks are now handled by HTML overlay (snap-overlay.js)

        // Check if clicking on a part
        const partIdx = hitTestPart(pos.x, pos.y, getCachedImage);

        if (partIdx >= 0) {
          selectPartInVariant(partIdx, isShift);  // Shift for additive selection
          startPartDrag(pos.x, pos.y);  // Free drag (moves all selected)
          renderPartsInVariant();
          updatePartProperties();
        } else {
          // Clicked empty space - start marquee selection
          startMarquee(pos.x, pos.y);
        }
        render();
        renderOverlays();
        return;
      }

      // Part editor mode
      // Check for snap point placement first
      if (state.snapPointTool) {
        const pos = getCanvasPosition(e);
        addSnapPoint(pos.x, pos.y);
        return;
      }

      // Measure tool
      if (state.tool === 'measure') {
        const pos = getCanvasPosition(e);
        handleMeasureClick(pos.x, pos.y);
        return;
      }

      startDraw(e);
      // Update shape panel if using select tool
      if (state.tool === 'select') {
        updateShapePropertiesPanel();
      }
    } else if (e.button === 1) { // Middle click - start panning
      e.preventDefault();
      startPan(e);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const pos = getCanvasPosition(e);
    ui.setMousePosition(pos.x, pos.y);

    // Continue panning if middle mouse is down
    if (isPanning) {
      continuePan(e);
      return;
    }

    // Snap point hover is now handled by HTML overlay (snap-overlay.js)
    // CSS :hover states provide the visual feedback

    // Variant builder: drag parts or marquee selection
    if (state.selectedMode === 'variant-builder') {
      if (isDraggingPart()) {
        continuePartDrag(pos.x, pos.y);

        // Check for detachment if part is attached
        if (state.selectedPartInVariant !== null) {
          const part = state.partsInVariant[state.selectedPartInVariant];
          if (part && snapPoints.isPartAttached(state.selectedPartInVariant)) {
            // Check if dragged far from attachment point
            const snapWorldPos = snapPoints.getSnapPointWorldPosition(part.parentIndex, part.attachedTo);
            if (snapWorldPos) {
              const dist = Math.hypot(part.x - snapWorldPos.x, part.y - snapWorldPos.y);
              if (dist > 30) {  // Detach threshold
                snapPoints.detachPart(state.selectedPartInVariant);
                ui.setStatus('Detached from parent');
              }
            }
          }

          // Update snap point detection for visual feedback
          snapPoints.updateCandidateSnapPoint(state.selectedPartInVariant, pos.x, pos.y);
        }
        render();
        // Update overlay positions during drag
        updateOverlayPositions();
        return;
      }

      if (isMarqueeSelecting()) {
        continueMarquee(pos.x, pos.y);
        render();
        selectionOverlay.renderSelectionOverlay();  // Update marquee box
        return;
      }
    }

    // Continue drawing if mouse is down
    if (isCurrentlyDrawing()) {
      continueDraw(e);
    }

    // Handle polyline preview (line tool click-to-place)
    if (isInClickPlaceMode()) {
      continueDraw(e);
      return; // Polyline handles its own rendering
    }

    // Handle shape resizing (select tool)
    if (isResizing()) {
      resizeShape(e);
      return;
    }

    // Handle shape dragging (select tool)
    if (state.isDraggingShape) {
      dragShape(e);
    }

    // Update cursor position for stroke preview
    updateCursorPreview(pos.x, pos.y);
  });

  canvas.addEventListener('mouseleave', () => {
    clearCursorPreview();
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      // Variant builder: end part dragging or marquee selection
      if (isDraggingPart()) {
        // Check for snap point attachment
        const candidate = snapPoints.getCandidateSnapPoint();
        if (candidate && candidate.compatible && state.selectedPartInVariant !== null) {
          // Attach to snap point
          snapPoints.attachPartToSnapPoint(
            state.selectedPartInVariant,
            candidate.parentIndex,
            candidate.snapPointId
          );
          ui.setStatus(`Attached to ${candidate.snapPointId}`);
        }
        snapPoints.clearCandidateSnapPoint();
        endPartDrag();
        updatePartProperties();
        renderPartsInVariant();  // Update hierarchy display
        render();
        renderOverlays();
        saveHistory();  // Save for undo/redo
        return;
      }

      // Variant builder: end marquee selection
      if (isMarqueeSelecting()) {
        const isShift = e.shiftKey;
        endMarquee(isShift, getCachedImage);
        renderPartsInVariant();
        updatePartProperties();
        render();
        renderOverlays();
        return;
      }

      if (isResizing()) {
        endResizeShape();
        updateShapePropertiesPanel();
      } else if (state.isDraggingShape) {
        endDragShape();
        updateShapePropertiesPanel();
      } else {
        endDraw(e);
        saveHistory();
      }
    } else if (e.button === 1) {
      endPan();
    }
  });

  canvas.addEventListener('mouseleave', (e) => {
    if (isCurrentlyDrawing()) {
      endDraw(e);
      saveHistory();
    }
    if (isResizing()) {
      endResizeShape();
    }
    if (state.isDraggingShape) {
      endDragShape();
    }
    if (isDraggingPart()) {
      snapPoints.clearCandidateSnapPoint();
      endPartDrag();
    }
    if (isMarqueeSelecting()) {
      cancelMarquee();
      render();
    }
    if (isPanning) {
      endPan();
    }
    // Clear cursor preview when leaving canvas
    clearCursorPreview();
  });

  // Mouse wheel zoom (on canvas container to avoid browser zoom)
  const canvasContainer = canvas.parentElement;
  canvasContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Get mouse position relative to container
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.deltaY < 0) {
      handleZoomIn(mouseX, mouseY);
    } else {
      handleZoomOut(mouseX, mouseY);
    }
  }, { passive: false });

  // Prevent middle-click scroll/paste behavior
  canvas.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Right-click to cancel/deselect
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handleRightClick();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Property change listeners
  setupPropertyListeners();

  // Animation state buttons (bottom bar for preview)
  document.querySelectorAll('.animation-state-btn').forEach(btn => {
    btn.onclick = () => {
      const newState = btn.dataset.state;
      document.querySelectorAll('.animation-state-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update both state locations for consistency
      state.animationState = newState;
      animation.setAnimationState(newState);
      // Also sync trigger tabs to match
      document.querySelectorAll('.trigger-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.trigger === newState);
      });
      currentAnimationTrigger = newState;
      // Update UI to show animation for this trigger
      const part = getSelectedPart();
      if (part) updateAnimationUI(part);
    };
  });

  // Toolbar buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.onclick = () => {
      const clickedTool = btn.dataset.tool;

      // Clicking same tool cancels current operation
      if (state.tool === clickedTool) {
        cancelCurrentOperation();
        return;
      }

      // Cancel polyline when switching away from line tool
      if (isInClickPlaceMode()) {
        cancelClickPlaceMode();
        render();
      }

      state.tool = clickedTool;
      ui.setActiveTool(clickedTool);
      updateToolOptionsPanel();
    };
  });
}

// Show/hide tool-specific options panels
function updateToolOptionsPanel() {
  const wandSection = document.getElementById('wandOptionsSection');
  const lassoSection = document.getElementById('lassoOptionsSection');
  const targetColorsSection = document.getElementById('targetColorsSection');
  const selectionBrushSection = document.getElementById('selectionBrushOptionsSection');
  const cloneStampSection = document.getElementById('cloneStampOptionsSection');
  const blendSection = document.getElementById('blendOptionsSection');
  const pixelateSection = document.getElementById('pixelateOptionsSection');
  const measureSection = document.getElementById('measureOptionsSection');

  if (wandSection) {
    wandSection.classList.toggle('hidden', state.tool !== 'wand');
  }
  if (lassoSection) {
    lassoSection.classList.toggle('hidden', state.tool !== 'lasso');
  }
  if (targetColorsSection) {
    targetColorsSection.classList.toggle('hidden', state.tool !== 'lasso');
  }
  if (selectionBrushSection) {
    selectionBrushSection.classList.toggle('hidden', state.tool !== 'selection-brush');
  }
  if (cloneStampSection) {
    cloneStampSection.classList.toggle('hidden', state.tool !== 'clone-stamp');
  }
  if (blendSection) {
    blendSection.classList.toggle('hidden', state.tool !== 'blend');
  }
  if (pixelateSection) {
    pixelateSection.classList.toggle('hidden', state.tool !== 'pixelate');
  }
  if (measureSection) {
    measureSection.classList.toggle('hidden', state.tool !== 'measure');
  }

  // Update target colors UI when lasso tool is active
  if (state.tool === 'lasso') {
    renderTargetColorsList();
  }

  // Also update shape panel when tool changes
  updateShapePropertiesPanel();
}

// Update shape properties panel based on selected shape
function updateShapePropertiesPanel() {
  const shapeSection = document.getElementById('shapeOptionsSection');
  const defaultsSection = document.getElementById('drawingDefaultsSection');
  if (!shapeSection) return;

  const shape = getSelectedShape();
  const hasSelection = shape && state.tool === 'select';

  // Toggle between drawing defaults and shape properties
  if (hasSelection) {
    shapeSection.classList.remove('hidden');
    if (defaultsSection) defaultsSection.classList.add('hidden');
  } else {
    shapeSection.classList.add('hidden');
    if (defaultsSection) defaultsSection.classList.remove('hidden');
    return;
  }

  const isImage = shape.type === 'image';
  const isDrawnShape = ['rect', 'circle', 'ellipse', 'line', 'path'].includes(shape.type);
  const hasFillSupport = ['rect', 'circle', 'ellipse'].includes(shape.type);
  const hasXY = shape.x !== undefined;

  // Show/hide sections based on shape type
  const scaleRows = document.getElementById('shapeScaleRows');
  const positionRows = document.getElementById('shapePositionRows');
  const imageButtons = document.getElementById('shapeImageButtons');
  const strokeRow = document.getElementById('shapeStrokeRow');
  const fillSection = document.getElementById('shapeFillSection');
  const crispRow = document.getElementById('shapeCrispRow');

  if (scaleRows) scaleRows.style.display = isImage ? '' : 'none';
  if (imageButtons) imageButtons.style.display = isImage ? '' : 'none';
  if (positionRows) positionRows.style.display = hasXY ? '' : 'none';
  if (strokeRow) strokeRow.style.display = isDrawnShape ? '' : 'none';
  if (fillSection) fillSection.style.display = hasFillSupport ? '' : 'none';
  if (crispRow) crispRow.style.display = isDrawnShape ? '' : 'none';

  // Update opacity - skip if user is typing
  const shapeOpacity = document.getElementById('shapeOpacity');
  const shapeOpacityNum = document.getElementById('shapeOpacityNum');
  if (shapeOpacity && !shapeOpacity.matches(':focus')) shapeOpacity.value = shape.opacity ?? 100;
  if (shapeOpacityNum && !shapeOpacityNum.matches(':focus')) shapeOpacityNum.value = shape.opacity ?? 100;

  // Update stroke color and width - skip if user is typing
  const strokeColor = document.getElementById('shapeStrokeColor');
  if (strokeColor && shape.strokeColor) strokeColor.value = shape.strokeColor;
  const strokeWidth = document.getElementById('shapeStrokeWidth');
  if (strokeWidth && !strokeWidth.matches(':focus')) strokeWidth.value = shape.strokeWidth || 1;

  // Update fill controls
  const hasFill = document.getElementById('shapeHasFill');
  const fillType = document.getElementById('shapeFillType');
  const fillColor = document.getElementById('shapeFillColor');
  const fillColor2 = document.getElementById('shapeFillColor2');
  const fillAngle = document.getElementById('shapeFillAngle');
  const fillAngleNum = document.getElementById('shapeFillAngleNum');
  const fillColor2Row = document.getElementById('shapeFillColor2Row');
  const fillAngleRow = document.getElementById('shapeFillAngleRow');
  const fillTypeRow = document.getElementById('shapeFillTypeRow');

  const hasFillEnabled = !!shape.fillColor;
  if (hasFill) hasFill.checked = hasFillEnabled;
  if (fillType) fillType.value = shape.fillType || 'solid';
  if (fillColor && shape.fillColor) fillColor.value = shape.fillColor;
  if (fillColor2) fillColor2.value = shape.fillColor2 || '#333333';
  if (fillAngle && !fillAngle.matches(':focus')) fillAngle.value = shape.fillAngle || 0;
  if (fillAngleNum && !fillAngleNum.matches(':focus')) fillAngleNum.value = shape.fillAngle || 0;

  // Show/hide gradient controls based on fill type and enabled state
  const isGradient = (shape.fillType === 'linear' || shape.fillType === 'radial');
  if (fillTypeRow) fillTypeRow.style.display = hasFillEnabled ? '' : 'none';
  if (fillColor2Row) fillColor2Row.style.display = hasFillEnabled && isGradient ? '' : 'none';
  if (fillAngleRow) fillAngleRow.style.display = hasFillEnabled && isGradient ? '' : 'none';

  // Update crisp edges
  const crispEdges = document.getElementById('shapeCrispEdges');
  if (crispEdges) crispEdges.checked = shape.pixelPerfect ?? false;

  // Update position fields (for shapes with x/y) - skip if user is typing
  if (hasXY) {
    const shapeX = document.getElementById('shapeX');
    const shapeY = document.getElementById('shapeY');
    if (shapeX && !shapeX.matches(':focus')) shapeX.value = Math.round(shape.x);
    if (shapeY && !shapeY.matches(':focus')) shapeY.value = Math.round(shape.y);
  }

  // Update scale for images - skip if user is typing
  if (isImage) {
    const origW = shape.originalWidth || shape.width;
    const origH = shape.originalHeight || shape.height;
    const scaleX = Math.round((shape.width / origW) * 100);
    const scaleY = Math.round((shape.height / origH) * 100);

    const shapeScaleX = document.getElementById('shapeScaleX');
    const shapeScaleXNum = document.getElementById('shapeScaleXNum');
    if (shapeScaleX && !shapeScaleX.matches(':focus')) shapeScaleX.value = scaleX;
    if (shapeScaleXNum && !shapeScaleXNum.matches(':focus')) shapeScaleXNum.value = scaleX;

    const shapeScaleY = document.getElementById('shapeScaleY');
    const shapeScaleYNum = document.getElementById('shapeScaleYNum');
    if (shapeScaleY && !shapeScaleY.matches(':focus')) shapeScaleY.value = scaleY;
    if (shapeScaleYNum && !shapeScaleYNum.matches(':focus')) shapeScaleYNum.value = scaleY;
  }
}

// Setup property input listeners
function setupPropertyListeners() {
  // Layer opacity
  syncSliderInput('layerOpacity', 'layerOpacityNum', 0, 100, (v) => {
    const layer = state.layers.find(l => l.id === state.selectedLayerId);
    if (layer) { layer.opacity = v; render(); }
  });

  // Layer blend mode
  const layerBlend = document.getElementById('layerBlend');
  if (layerBlend) {
    let updatingBlend = false;
    layerBlend.addEventListener('change', (e) => {
      if (updatingBlend) return; // Prevent feedback loop
      const layer = state.layers.find(l => l.id === state.selectedLayerId);
      if (layer) {
        layer.blend = e.target.value;
        console.log('Blend mode set to:', layer.blend, 'on layer:', layer.name);
        render();
        ui.setStatus(`Blend: ${layer.blend}`);
      }
    });
    // Store reference for updateLayerProperties to use
    window._blendDropdownGuard = (fn) => { updatingBlend = true; fn(); updatingBlend = false; };
  }

  // Gradient angle
  syncSliderInput('gradientAngle', 'gradientAngleNum', 0, 360, (v) => {
    state.gradientAngle = v; render();
  });

  // Part rotation - applies to all selected parts
  syncSliderInput('partRotation', 'partRotationNum', 0, 360, (v) => {
    const indices = getSelectedPartIndices();
    for (const idx of indices) {
      const part = state.partsInVariant[idx];
      if (part) part.rotation = v;
    }
    render();
  });
  document.getElementById('partRotation')?.addEventListener('change', () => saveHistory());

  // Part scale (percent to decimal) - applies to all selected parts
  syncSliderInput('partScale', 'partScaleNum', 1, 300, (v) => {
    setAllSelectedScale(v / 100);
    render();
  });
  document.getElementById('partScale')?.addEventListener('change', () => saveHistory());

  // Part opacity - applies to all selected parts
  syncSliderInput('partOpacity', 'partOpacityNum', 0, 100, (v) => {
    const indices = getSelectedPartIndices();
    for (const idx of indices) {
      const part = state.partsInVariant[idx];
      if (part) part.opacity = v;
    }
    render();
  });
  document.getElementById('partOpacity')?.addEventListener('change', () => saveHistory());

  // Scale reference overlay (variant builder)
  const showScaleOverlay = document.getElementById('showScaleOverlay');
  if (showScaleOverlay) {
    showScaleOverlay.addEventListener('change', (e) => {
      state.showScaleOverlay = e.target.checked;
      render();
    });
  }

  const scaleOverlayType = document.getElementById('scaleOverlayType');
  if (scaleOverlayType) {
    scaleOverlayType.addEventListener('change', (e) => {
      state.scaleOverlayType = e.target.value || null;
      render();
    });
  }

  // Animation config (variant builder)
  const animationType = document.getElementById('animationType');
  if (animationType) {
    animationType.addEventListener('change', (e) => {
      const type = e.target.value;
      updateAnimationParamsUI(type);
      applyAnimationToSelectedPart();
      updateTriggerTabIndicators();
    });
  }

  // Animation trigger tabs
  document.querySelectorAll('.trigger-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const trigger = tab.dataset.trigger;
      selectAnimationTrigger(trigger);
    });
  });

  // Animation state preview buttons
  document.querySelectorAll('.animation-state-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const newState = btn.dataset.state;
      document.querySelectorAll('.animation-state-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      animation.setAnimationState(newState);
    });
  });

  // Reference image controls (variant builder)
  const showReferenceImage = document.getElementById('showReferenceImage');
  if (showReferenceImage) {
    showReferenceImage.addEventListener('change', (e) => {
      state.showReferenceImage = e.target.checked;
      render();
    });
  }

  const referenceSource = document.getElementById('referenceSource');
  if (referenceSource) {
    // Populate dropdown with available units
    populateReferenceSourceDropdown(referenceSource);
    referenceSource.addEventListener('change', (e) => {
      loadReferenceImage(e.target.value);
    });
  }

  // Reference opacity slider
  const refOpacitySlider = document.getElementById('referenceOpacity');
  const refOpacityValue = document.getElementById('referenceOpacityValue');
  if (refOpacitySlider) {
    refOpacitySlider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value);
      if (refOpacityValue) refOpacityValue.textContent = v + '%';
      if (state.referenceImage) {
        state.referenceImage.opacity = v;
        render();
      }
    });
  }

  // Reference scale
  syncInputOnBlur('referenceScale', 10, 200, (v) => {
    if (state.referenceImage) {
      state.referenceImage.scale = v;
      render();
    }
  });
  inputCallbacks.set('referenceScale', { min: 10, max: 200, onChange: (v) => {
    if (state.referenceImage) {
      state.referenceImage.scale = v;
      render();
    }
  }});

  // Reference offset X/Y
  syncInputOnBlur('referenceX', null, null, (v) => {
    if (state.referenceImage) {
      state.referenceImage.x = v;
      render();
    }
  });
  inputCallbacks.set('referenceX', { min: -500, max: 500, onChange: (v) => {
    if (state.referenceImage) {
      state.referenceImage.x = v;
      render();
    }
  }});

  syncInputOnBlur('referenceY', null, null, (v) => {
    if (state.referenceImage) {
      state.referenceImage.y = v;
      render();
    }
  });
  inputCallbacks.set('referenceY', { min: -500, max: 500, onChange: (v) => {
    if (state.referenceImage) {
      state.referenceImage.y = v;
      render();
    }
  }});

  // Snap point controls (Part Editor)
  populatePartCategoryDropdown();
  populateSnapPointTypeDropdown();

  const partCategorySelect = document.getElementById('partCategorySelect');
  if (partCategorySelect) {
    partCategorySelect.addEventListener('change', (e) => {
      saveHistory();
      state.partCategory = e.target.value || null;
      markDirty();
    });
  }

  const showSnapPoints = document.getElementById('showSnapPoints');
  if (showSnapPoints) {
    showSnapPoints.addEventListener('change', (e) => {
      state.showSnapPoints = e.target.checked;
      render();
      snapOverlay.renderSnapPointOverlay();
    });
  }

  const snapPointName = document.getElementById('snapPointName');
  if (snapPointName) {
    snapPointName.addEventListener('input', (e) => {
      updateSelectedSnapPoint('name', e.target.value);
    });
  }

  const snapPointType = document.getElementById('snapPointType');
  if (snapPointType) {
    snapPointType.addEventListener('change', (e) => {
      updateSelectedSnapPoint('type', e.target.value);
    });
  }

  // Snap point X/Y with +/- button support
  syncInputOnBlur('snapPointX', -500, 500, (v) => updateSelectedSnapPoint('x', v));
  inputCallbacks.set('snapPointX', { min: -500, max: 500, onChange: (v) => updateSelectedSnapPoint('x', v) });

  syncInputOnBlur('snapPointY', -500, 500, (v) => updateSelectedSnapPoint('y', v));
  inputCallbacks.set('snapPointY', { min: -500, max: 500, onChange: (v) => updateSelectedSnapPoint('y', v) });

  // Rotation preview controls
  const rotationSpeedCallback = (v) => {
    state.rotationPreview.speed = v;
  };
  syncSliderInput('rotationSpeed', 'rotationSpeedNum', 10, 180, rotationSpeedCallback);
  inputCallbacks.set('rotationSpeedNum', { min: 10, max: 180, onChange: rotationSpeedCallback });

  const rotationAngleCallback = (v) => {
    state.rotationPreview.angle = v;
    render();
  };
  syncSliderInput('rotationAngle', 'rotationAngleNum', 0, 360, rotationAngleCallback);
  inputCallbacks.set('rotationAngleNum', { min: 0, max: 360, onChange: rotationAngleCallback });

  const rotationPivot = document.getElementById('rotationPivot');
  if (rotationPivot) {
    rotationPivot.addEventListener('change', (e) => {
      setRotationPivot(e.target.value);
    });
  }

  // Canvas size controls
  syncInputOnBlur('canvasWidthInput', SHAPE_LIMITS.canvas.min, SHAPE_LIMITS.canvas.max, (v) => handleSetCanvasSize(v, state.canvasHeight));
  syncInputOnBlur('canvasHeightInput', SHAPE_LIMITS.canvas.min, SHAPE_LIMITS.canvas.max, (v) => handleSetCanvasSize(state.canvasWidth, v));

  // Magic wand tolerance - using shared helper
  syncSliderInput('wandTolerance', 'wandToleranceNum', 0, 255, selection.setTolerance);

  // Lasso tolerance - using shared helper with realtime re-selection
  const lassoToleranceCallback = (v) => {
    state.lassoTolerance = v;
    rerunLassoSelection();
  };
  syncSliderInput('lassoTolerance', 'lassoToleranceNum', 0, 100, lassoToleranceCallback);
  // Also register for +/- button adjustments
  inputCallbacks.set('lassoToleranceNum', { min: 0, max: 100, onChange: lassoToleranceCallback });

  // Lasso expand colors toggle with realtime re-selection
  const lassoExpandColors = document.getElementById('lassoExpandColors');
  if (lassoExpandColors) {
    lassoExpandColors.addEventListener('change', (e) => {
      state.lassoExpandColors = e.target.checked;
      rerunLassoSelection();
    });
  }

  // Clone stamp brush size - using shared helper
  syncSliderInput('cloneBrushSize', 'cloneBrushSizeNum', 1, 64, cloneStamp.setBrushSize);
  inputCallbacks.set('cloneBrushSizeNum', { min: 1, max: 64, onChange: cloneStamp.setBrushSize });

  // Clone stamp aligned mode
  const cloneAligned = document.getElementById('cloneAligned');
  if (cloneAligned) {
    cloneAligned.addEventListener('change', (e) => {
      cloneStamp.setAligned(e.target.checked);
    });
  }

  // Clone stamp flip options
  const cloneFlipH = document.getElementById('cloneFlipH');
  if (cloneFlipH) {
    cloneFlipH.addEventListener('change', (e) => {
      cloneStamp.setFlipH(e.target.checked);
    });
  }

  const cloneFlipV = document.getElementById('cloneFlipV');
  if (cloneFlipV) {
    cloneFlipV.addEventListener('change', (e) => {
      cloneStamp.setFlipV(e.target.checked);
    });
  }

  // Blend brush hardness
  syncSliderInput('blendHardness', 'blendHardnessNum', 10, 100, (val) => { state.blendHardness = val; });
  inputCallbacks.set('blendHardnessNum', { min: 10, max: 100, onChange: (val) => { state.blendHardness = val; } });

  // Pixelate cell size
  syncSliderInput('pixelateSize', 'pixelateSizeNum', 2, 16, (val) => { state.pixelateSize = val; });
  inputCallbacks.set('pixelateSizeNum', { min: 2, max: 16, onChange: (val) => { state.pixelateSize = val; } });

  // Timeline FPS
  const timelineFps = document.getElementById('timelineFps');
  if (timelineFps) {
    const updateFps = (e) => {
      state.fps = Math.max(1, Math.min(60, parseInt(e.target.value) || 12));
      updatePlaybackSpeed();
    };
    timelineFps.addEventListener('input', updateFps);
    timelineFps.addEventListener('change', updateFps);
  }
  inputCallbacks.set('timelineFps', { min: 1, max: 60, onChange: (val) => { state.fps = val; updatePlaybackSpeed(); } });

  // Stroke properties
  const strokeColor = document.getElementById('strokeColor');
  if (strokeColor) {
    strokeColor.addEventListener('input', (e) => {
      state.strokeColor = e.target.value;
    });
  }

  const strokeWidth = document.getElementById('strokeWidth');
  if (strokeWidth) {
    // Update on both input (dragging) and change (typing)
    const updateStrokeWidth = (e) => {
      state.strokeWidth = Math.max(1, parseInt(e.target.value) || 1);
      render(); // Update cursor preview
    };
    strokeWidth.addEventListener('input', updateStrokeWidth);
    strokeWidth.addEventListener('change', updateStrokeWidth);
  }

  // Pixel-perfect toggle
  const pixelPerfect = document.getElementById('pixelPerfect');
  if (pixelPerfect) {
    pixelPerfect.addEventListener('change', (e) => {
      state.pixelPerfect = e.target.checked;
    });
  }

  // Fill properties
  const fillEnabled = document.getElementById('fillEnabled');
  if (fillEnabled) {
    fillEnabled.addEventListener('change', (e) => {
      state.fillEnabled = e.target.checked;
    });
  }

  const fillColor1 = document.getElementById('fillColor1');
  if (fillColor1) {
    fillColor1.addEventListener('input', (e) => {
      state.fillColor1 = e.target.value;
    });
  }

  const fillColor2 = document.getElementById('fillColor2');
  if (fillColor2) {
    fillColor2.addEventListener('input', (e) => {
      state.fillColor2 = e.target.value;
    });
  }

  const fillType = document.getElementById('fillType');
  if (fillType) {
    fillType.addEventListener('change', (e) => {
      state.fillType = e.target.value;
      // Show/hide gradient options
      const color2Row = document.getElementById('fillColor2Row');
      const angleRow = document.getElementById('gradientAngleRow');
      if (color2Row) color2Row.style.display = e.target.value === 'solid' ? 'none' : 'flex';
      if (angleRow) angleRow.style.display = e.target.value === 'solid' ? 'none' : 'flex';
    });
  }

  // Shape transform controls
  syncSliderInput('shapeOpacity', 'shapeOpacityNum', 0, 100, (v) => {
    const shape = getSelectedShape();
    if (shape) { shape.opacity = v; render(); }
  });
  syncSliderInput('shapeScaleX', 'shapeScaleXNum', SHAPE_LIMITS.scale.min, SHAPE_LIMITS.scale.max, setShapeScaleX);
  syncSliderInput('shapeScaleY', 'shapeScaleYNum', SHAPE_LIMITS.scale.min, SHAPE_LIMITS.scale.max, setShapeScaleY);
  // Shape position - use blur to allow typing multi-digit numbers
  syncInputOnBlur('shapeX', null, null, (v) => {
    const shape = getSelectedShape();
    if (shape) { saveHistory(); shape.x = v; render(); }
  });
  syncInputOnBlur('shapeY', null, null, (v) => {
    const shape = getSelectedShape();
    if (shape) { saveHistory(); shape.y = v; render(); }
  });

  // Part position (variant builder)
  syncInputOnBlur('partX', null, null, (v) => {
    const indices = getSelectedPartIndices();
    if (indices.size === 0) return;
    saveHistory();
    // Move all selected parts by the delta from primary
    const primary = getSelectedPart();
    if (!primary) return;
    const delta = v - primary.x;
    for (const idx of indices) {
      const part = state.partsInVariant[idx];
      if (part) part.x += delta;
    }
    markDirty();
    updatePartProperties();
    render();
  });
  syncInputOnBlur('partY', null, null, (v) => {
    const indices = getSelectedPartIndices();
    if (indices.size === 0) return;
    saveHistory();
    const primary = getSelectedPart();
    if (!primary) return;
    const delta = v - primary.y;
    for (const idx of indices) {
      const part = state.partsInVariant[idx];
      if (part) part.y += delta;
    }
    markDirty();
    updatePartProperties();
    render();
  });

  // Part pivot (variant builder) - absolute canvas coordinates
  // Custom handler: empty = null (use part position as pivot), number = absolute pivot
  setupPivotInput('partPivotX', 'pivotX');
  setupPivotInput('partPivotY', 'pivotY');

  // Shape stroke color
  const shapeStrokeColor = document.getElementById('shapeStrokeColor');
  if (shapeStrokeColor) {
    shapeStrokeColor.addEventListener('input', (e) => {
      const shape = getSelectedShape();
      if (shape) { saveHistory(); shape.strokeColor = e.target.value; render(); }
    });
  }

  // Shape stroke width
  const shapeStrokeWidth = document.getElementById('shapeStrokeWidth');
  if (shapeStrokeWidth) {
    shapeStrokeWidth.addEventListener('input', (e) => {
      const shape = getSelectedShape();
      if (shape) {
        saveHistory();
        shape.strokeWidth = Math.max(1, Math.min(50, parseInt(e.target.value) || 1));
        render();
      }
    });
  }

  // Shape fill toggle
  const shapeHasFill = document.getElementById('shapeHasFill');
  if (shapeHasFill) {
    shapeHasFill.addEventListener('change', (e) => {
      const shape = getSelectedShape();
      if (shape) {
        saveHistory();
        if (e.target.checked) {
          const fillColorInput = document.getElementById('shapeFillColor');
          shape.fillColor = fillColorInput?.value || '#000000';
          shape.fillType = shape.fillType || 'solid';
        } else {
          shape.fillColor = null;
        }
        // Show/hide fill controls based on enabled state
        const fillTypeRow = document.getElementById('shapeFillTypeRow');
        const fillColor2Row = document.getElementById('shapeFillColor2Row');
        const fillAngleRow = document.getElementById('shapeFillAngleRow');
        const isGradient = (shape.fillType === 'linear' || shape.fillType === 'radial');
        if (fillTypeRow) fillTypeRow.style.display = e.target.checked ? '' : 'none';
        if (fillColor2Row) fillColor2Row.style.display = e.target.checked && isGradient ? '' : 'none';
        if (fillAngleRow) fillAngleRow.style.display = e.target.checked && isGradient ? '' : 'none';
        render();
      }
    });
  }

  // Shape fill color
  const shapeFillColor = document.getElementById('shapeFillColor');
  if (shapeFillColor) {
    shapeFillColor.addEventListener('input', (e) => {
      const shape = getSelectedShape();
      if (shape && shape.fillColor) {
        saveHistory();
        shape.fillColor = e.target.value;
        render();
      }
    });
  }

  // Shape fill type
  const shapeFillType = document.getElementById('shapeFillType');
  if (shapeFillType) {
    shapeFillType.addEventListener('change', (e) => {
      const shape = getSelectedShape();
      if (shape) {
        saveHistory();
        shape.fillType = e.target.value;
        // Show/hide gradient controls
        const isGradient = (e.target.value === 'linear' || e.target.value === 'radial');
        const fillColor2Row = document.getElementById('shapeFillColor2Row');
        const fillAngleRow = document.getElementById('shapeFillAngleRow');
        if (fillColor2Row) fillColor2Row.style.display = isGradient ? '' : 'none';
        if (fillAngleRow) fillAngleRow.style.display = isGradient ? '' : 'none';
        render();
      }
    });
  }

  // Shape fill color 2 (for gradients)
  const shapeFillColor2 = document.getElementById('shapeFillColor2');
  if (shapeFillColor2) {
    shapeFillColor2.addEventListener('input', (e) => {
      const shape = getSelectedShape();
      if (shape) {
        saveHistory();
        shape.fillColor2 = e.target.value;
        render();
      }
    });
  }

  // Shape fill angle (for gradients)
  syncSliderInput('shapeFillAngle', 'shapeFillAngleNum', 0, 360, (v) => {
    const shape = getSelectedShape();
    if (shape) {
      shape.fillAngle = v;
      render();
    }
  });

  // Shape crisp edges toggle
  const shapeCrispEdges = document.getElementById('shapeCrispEdges');
  if (shapeCrispEdges) {
    shapeCrispEdges.addEventListener('change', (e) => {
      const shape = getSelectedShape();
      if (shape) {
        saveHistory();
        shape.pixelPerfect = e.target.checked;
        render();
      }
    });
  }
}

// Reusable: sync a slider and number input pair
// Also registers callback for +/- button support
function syncSliderInput(sliderId, numId, min, max, onChange) {
  const slider = document.getElementById(sliderId);
  const num = document.getElementById(numId);

  if (slider) {
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (num) num.value = val;
      onChange(val);
    });
  }
  if (num) {
    // Live update while typing (don't clamp yet)
    num.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (!isNaN(val)) {
        if (slider) slider.value = Math.max(min, Math.min(max, val));
        onChange(val);
      }
    });
    // Clamp value when done typing
    num.addEventListener('blur', (e) => {
      const val = Math.max(min, Math.min(max, parseInt(e.target.value) || min));
      e.target.value = val;
      if (slider) slider.value = val;
      onChange(val);
    });
    // Register for +/- button support
    inputCallbacks.set(numId, { min, max, sliderId, onChange });
  }
}

// Reusable: sync a single input (no slider)
function syncInput(inputId, min, max, onChange) {
  const input = document.getElementById(inputId);
  if (input) {
    // Live update while typing
    input.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (!isNaN(val)) onChange(val);
    });
    // Clamp on blur if needed
    if (min !== null || max !== null) {
      input.addEventListener('blur', (e) => {
        let val = parseInt(e.target.value) || 0;
        if (min !== null) val = Math.max(min, val);
        if (max !== null) val = Math.min(max, val);
        e.target.value = val;
        onChange(val);
      });
    }
  }
}

// Sync input on blur only - allows typing multi-digit numbers without interruption
// Stores callback for use by adjustInput button handler
const inputCallbacks = new Map();

function syncInputOnBlur(inputId, min, max, onChange) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Store callback for adjustInput to use
  inputCallbacks.set(inputId, { min, max, onChange });

  const applyValue = () => {
    let val = parseInt(input.value) || 0;
    if (min !== null) val = Math.max(min, val);
    if (max !== null) val = Math.min(max, val);
    input.value = val;
    onChange(val);
  };

  // Only apply on blur (when user clicks away)
  input.addEventListener('blur', applyValue);

  // Apply on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyValue();
      e.target.blur();
    }
  });
}

// Setup pivot input - empty = null (auto), number = absolute pivot point
function setupPivotInput(inputId, propName) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const applyValue = () => {
    const part = getSelectedPart();
    if (!part) return;

    const trimmed = input.value.trim();
    // Empty or "auto" means use part position (null)
    if (trimmed === '' || trimmed.toLowerCase() === 'auto') {
      saveHistory();
      part[propName] = null;
      input.value = '';
      input.placeholder = 'auto';
      markDirty();
      render();
    } else {
      const val = parseInt(trimmed);
      if (!isNaN(val)) {
        saveHistory();
        part[propName] = val;
        input.value = val;
        markDirty();
        render();
      }
    }
  };

  // Register callback for +/- buttons (used by adjustInput)
  inputCallbacks.set(inputId, {
    min: null,
    max: null,
    onChange: (val) => {
      const part = getSelectedPart();
      if (part) {
        saveHistory();
        part[propName] = val;
        markDirty();
        render();
      }
    }
  });

  input.addEventListener('blur', applyValue);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyValue();
      e.target.blur();
    }
  });
}

// Shape adjustment functions (like ref image adjustments)
function adjustShapeOpacity(delta) {
  const shape = getSelectedShape();
  if (!shape) return;
  const newVal = Math.max(0, Math.min(100, (shape.opacity ?? 100) + delta));
  saveHistory();
  shape.opacity = newVal;
  render();
  updateShapePropertiesPanel();
}

function isScaleLocked() {
  const lock = document.getElementById('shapeScaleLock');
  return lock?.checked ?? true;
}

function setShapeScaleX(percent) {
  const shape = getSelectedShape();
  if (!shape) return;
  const origW = shape.originalWidth || shape.width;
  const origH = shape.originalHeight || shape.height;

  // Calculate current center
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;

  // Calculate new dimensions
  const newWidth = Math.round(origW * percent / 100);
  let newHeight = shape.height;
  if (isScaleLocked()) {
    newHeight = Math.round(origH * percent / 100);
  }

  // Apply new dimensions
  shape.width = newWidth;
  shape.height = newHeight;

  // Adjust position to keep center point fixed
  shape.x = Math.round(centerX - newWidth / 2);
  shape.y = Math.round(centerY - newHeight / 2);

  // Sync all inputs
  syncScaleInputs('X', percent);
  if (isScaleLocked()) syncScaleInputs('Y', percent);
  syncPositionInputs(shape);

  render();
}

function setShapeScaleY(percent) {
  const shape = getSelectedShape();
  if (!shape) return;
  const origW = shape.originalWidth || shape.width;
  const origH = shape.originalHeight || shape.height;

  // Calculate current center
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;

  // Calculate new dimensions
  let newWidth = shape.width;
  const newHeight = Math.round(origH * percent / 100);
  if (isScaleLocked()) {
    newWidth = Math.round(origW * percent / 100);
  }

  // Apply new dimensions
  shape.width = newWidth;
  shape.height = newHeight;

  // Adjust position to keep center point fixed
  shape.x = Math.round(centerX - newWidth / 2);
  shape.y = Math.round(centerY - newHeight / 2);

  // Sync all inputs
  syncScaleInputs('Y', percent);
  if (isScaleLocked()) syncScaleInputs('X', percent);
  syncPositionInputs(shape);

  render();
}

// Sync scale slider/input pair
function syncScaleInputs(axis, percent) {
  const slider = document.getElementById(`shapeScale${axis}`);
  const num = document.getElementById(`shapeScale${axis}Num`);
  if (slider) slider.value = Math.max(SHAPE_LIMITS.scale.min, Math.min(SHAPE_LIMITS.scale.max, percent));
  if (num) num.value = Math.max(SHAPE_LIMITS.scale.min, Math.min(SHAPE_LIMITS.scale.max, percent));
}

// Sync position inputs
function syncPositionInputs(shape) {
  const xInput = document.getElementById('shapeX');
  const yInput = document.getElementById('shapeY');
  if (xInput) xInput.value = Math.round(shape.x);
  if (yInput) yInput.value = Math.round(shape.y);
}

function adjustShapeScaleX(delta) {
  const shape = getSelectedShape();
  if (!shape) return;
  const origW = shape.originalWidth || shape.width;
  const currentPercent = Math.round((shape.width / origW) * 100);
  setShapeScaleX(Math.max(SHAPE_LIMITS.scale.min, Math.min(SHAPE_LIMITS.scale.max, currentPercent + delta)));
}

function adjustShapeScaleY(delta) {
  const shape = getSelectedShape();
  if (!shape) return;
  const origH = shape.originalHeight || shape.height;
  const currentPercent = Math.round((shape.height / origH) * 100);
  setShapeScaleY(Math.max(SHAPE_LIMITS.scale.min, Math.min(SHAPE_LIMITS.scale.max, currentPercent + delta)));
}

// Reusable shape property adjustment (used by data-shape buttons)
function adjustShapeProperty(prop, delta) {
  const shape = getSelectedShape();
  if (!shape) return;

  switch (prop) {
    case 'x':
    case 'y':
      shape[prop] = (shape[prop] || 0) + delta;
      const input = document.getElementById(`shape${prop.toUpperCase()}`);
      if (input) input.value = Math.round(shape[prop]);
      render();
      break;

    case 'opacity':
      const newOpacity = Math.max(0, Math.min(100, (shape.opacity ?? 100) + delta));
      shape.opacity = newOpacity;
      const opacitySlider = document.getElementById('shapeOpacity');
      const opacityNum = document.getElementById('shapeOpacityNum');
      if (opacitySlider) opacitySlider.value = newOpacity;
      if (opacityNum) opacityNum.value = newOpacity;
      render();
      break;

    case 'strokeWidth':
      const newWidth = Math.max(1, Math.min(50, (shape.strokeWidth || 1) + delta));
      shape.strokeWidth = newWidth;
      const widthInput = document.getElementById('shapeStrokeWidth');
      if (widthInput) widthInput.value = newWidth;
      render();
      break;

    case 'scaleX':
      adjustShapeScaleX(delta);
      break;

    case 'scaleY':
      adjustShapeScaleY(delta);
      break;
  }
}

function adjustShapeX(delta) {
  adjustShapeProperty('x', delta);
}

function adjustShapeY(delta) {
  adjustShapeProperty('y', delta);
}

function resetShapeTransform() {
  const shape = getSelectedShape();
  if (!shape) return;
  saveHistory();
  shape.width = shape.originalWidth || shape.width;
  shape.height = shape.originalHeight || shape.height;
  shape.opacity = 100;
  // Also center after reset
  shape.x = Math.round((state.canvasWidth - shape.width) / 2);
  shape.y = Math.round((state.canvasHeight - shape.height) / 2);
  render();
  updateShapePropertiesPanel();
  ui.setStatus('Shape reset');
}

function centerShape() {
  const shape = getSelectedShape();
  if (!shape) return;
  saveHistory();
  // Center shape on canvas
  shape.x = Math.round((state.canvasWidth - shape.width) / 2);
  shape.y = Math.round((state.canvasHeight - shape.height) / 2);
  render();
  updateShapePropertiesPanel();
  ui.setStatus('Shape centered');
}

function fitShapeToCanvas() {
  const shape = getSelectedShape();
  if (!shape || !shape.originalWidth || !shape.originalHeight) return;
  saveHistory();

  // Calculate scale to fit canvas while maintaining aspect ratio
  const scaleX = state.canvasWidth / shape.originalWidth;
  const scaleY = state.canvasHeight / shape.originalHeight;
  const scale = Math.min(scaleX, scaleY);

  // Apply new dimensions
  shape.width = Math.round(shape.originalWidth * scale);
  shape.height = Math.round(shape.originalHeight * scale);

  // Center on canvas
  shape.x = Math.round((state.canvasWidth - shape.width) / 2);
  shape.y = Math.round((state.canvasHeight - shape.height) / 2);

  render();
  updateShapePropertiesPanel();
  ui.setStatus('Fit to canvas');
}

// Canvas size handlers
function handleSetCanvasSize(width, height) {
  width = Math.max(SHAPE_LIMITS.canvas.min, Math.min(SHAPE_LIMITS.canvas.max, width));
  height = Math.max(SHAPE_LIMITS.canvas.min, Math.min(SHAPE_LIMITS.canvas.max, height));

  state.canvasWidth = width;
  state.canvasHeight = height;

  // Update the actual canvas element
  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }

  // Update the input fields - skip if user is typing
  const widthInput = document.getElementById('canvasWidthInput');
  const heightInput = document.getElementById('canvasHeightInput');
  if (widthInput && !widthInput.matches(':focus')) widthInput.value = width;
  if (heightInput && !heightInput.matches(':focus')) heightInput.value = height;

  render();
  ui.setStatus(`Canvas size: ${width}×${height}`);
}

function handleAdjustCanvasSize(dimension, delta) {
  const { min, max } = SHAPE_LIMITS.canvas;
  if (dimension === 'width') {
    const newWidth = Math.max(min, Math.min(max, state.canvasWidth + delta));
    handleSetCanvasSize(newWidth, state.canvasHeight);
  } else if (dimension === 'height') {
    const newHeight = Math.max(min, Math.min(max, state.canvasHeight + delta));
    handleSetCanvasSize(state.canvasWidth, newHeight);
  }
}

// Handle keyboard shortcuts
function handleKeydown(e) {
  // F12 - Toggle debug console (available anywhere)
  if (e.key === 'F12') {
    e.preventDefault();
    handleToggleDebug();
    return;
  }

  // Ignore shortcuts when typing in inputs
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
    return;
  }

  if (!state.authenticated || !state.selectedMode) return;

  // Ctrl shortcuts
  if (e.ctrlKey) {
    switch (e.key) {
      case 'z': e.preventDefault(); handleUndo(); break;
      case 'y': e.preventDefault(); handleRedo(); break;
      case 's': e.preventDefault(); handleSave(); break;
      case 'o': e.preventDefault(); handleOpenProject(); break;
      case 'c':
        e.preventDefault();
        if (state.selectedMode === 'part-editor' && clipboard.copySelection()) {
          ui.setStatus('Copied to clipboard');
        }
        break;
      case 'x':
        e.preventDefault();
        if (state.selectedMode === 'part-editor') {
          clipboard.cutSelection().then(success => {
            if (success) {
              ui.setStatus('Cut to clipboard');
            }
          });
        }
        break;
      case 'v':
        e.preventDefault();
        if (state.selectedMode === 'part-editor' && clipboard.pasteSelection()) {
          ui.setStatus('Pasted from clipboard');
          renderLayers();
        }
        break;
      case 'a':
      case 'A':
        e.preventDefault();
        // Select all parts in variant builder
        if (state.selectedMode === 'variant-builder') {
          const count = selectAllParts();
          renderPartsInVariant();
          updatePartProperties();
          render();
          ui.setStatus(`Selected ${count} parts`);
        }
        // Select all opaque pixels in part editor
        if (state.selectedMode === 'part-editor') {
          if (e.shiftKey) {
            // Ctrl+Shift+A: Select from all layers
            if (clipboard.selectAllOpaqueAllLayers()) {
              ui.setStatus('Selected all opaque pixels (all layers)');
            } else {
              ui.setStatus('No opaque pixels found');
            }
          } else {
            // Ctrl+A: Select from current layer only
            if (clipboard.selectAllOpaque()) {
              ui.setStatus('Selected all opaque pixels on layer');
            } else {
              ui.setStatus('No opaque pixels found');
            }
          }
        }
        break;
    }
    return;
  }

  // Tool shortcuts (Part Editor only)
  if (state.selectedMode === 'part-editor') {
    // Shift+L for lasso
    if (e.shiftKey && e.key.toLowerCase() === 'l') {
      state.tool = 'lasso';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Shift+B for selection brush
    if (e.shiftKey && e.key.toLowerCase() === 'b') {
      state.tool = 'selection-brush';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Shift+T for clone stamp
    if (e.shiftKey && e.key.toLowerCase() === 't') {
      state.tool = 'clone-stamp';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Shift+D for blend brush
    if (e.shiftKey && e.key.toLowerCase() === 'd') {
      state.tool = 'blend';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Shift+X for pixelate brush
    if (e.shiftKey && e.key.toLowerCase() === 'x') {
      state.tool = 'pixelate';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Shift+M for marquee selection
    if (e.shiftKey && e.key.toLowerCase() === 'm') {
      state.tool = 'marquee';
      ui.setActiveTool(state.tool);
      updateToolOptionsPanel();
      return;
    }

    // Rotation/flip shortcuts (work on selection or selected shape)
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      const angle = e.key === '[' ? -90 : 90;
      if (selection.hasSelection()) {
        clipboard.rotateSelection(angle).then(success => {
          if (success) {
            markDirty();
            ui.setStatus(`Rotated selection ${angle}°`);
          }
        });
      }
      return;
    }

    // Flip shortcuts: Shift+H horizontal, Shift+J vertical (Shift+V is taken)
    if (e.shiftKey && (e.key.toLowerCase() === 'h' || e.key.toLowerCase() === 'j')) {
      e.preventDefault();
      const isHorizontal = e.key.toLowerCase() === 'h';
      if (selection.hasSelection()) {
        const flipFn = isHorizontal ? clipboard.flipSelectionHorizontal : clipboard.flipSelectionVertical;
        flipFn().then(success => {
          if (success) {
            markDirty();
            ui.setStatus(`Flipped selection ${isHorizontal ? 'horizontally' : 'vertically'}`);
          }
        });
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': state.tool = 'select'; break;
      case 'w': state.tool = 'wand'; break;
      case 'p': state.tool = 'pencil'; break;
      case 'e': state.tool = 'eraser'; break;
      case 'b': state.tool = 'bucket'; break;
      case 'g': state.tool = 'edge-fill'; break;
      case 't': state.tool = 'stamp'; break;
      case 's': state.tool = 'spray'; break;
      case 'l': state.tool = 'line'; break;
      case 'r': state.tool = 'rect'; break;
      case 'c': state.tool = 'circle'; break;
      case 'i': state.tool = 'eyedropper'; break;
      case 'm': state.tool = 'measure'; break;
      case ',': handlePrevFrame(); break;
      case '.': handleNextFrame(); break;
      case 'escape':
        cancelCurrentOperation();
        break;
      case 'delete':
      case 'backspace':
        e.preventDefault();
        console.log('[main] Delete pressed. hasSelection:', selection.hasSelection(), 'selectedShapeIndex:', state.selectedShapeIndex);
        // First check if there's a selection - delete selected pixels
        if (selection.hasSelection()) {
          console.log('[main] Deleting selected pixels...');
          clipboard.deleteSelectedPixels().then(success => {
            console.log('[main] deleteSelectedPixels result:', success);
            if (success) {
              selection.clearSelection();
              render();
              ui.setStatus('Deleted selected pixels');
            }
          });
        } else if (state.selectedShapeIndex !== null) {
          // Otherwise delete the selected shape
          console.log('[main] No selection, deleting shape at index:', state.selectedShapeIndex);
          deleteSelectedShape();
          updateShapePropertiesPanel();
        }
        break;
    }
    ui.setActiveTool(state.tool);
    updateToolOptionsPanel();
  }

  // Arrow key movement - shared between modes
  const delta = clipboard.getArrowKeyDelta(e);

  // Arrow key movement (Variant Builder)
  if (state.selectedMode === 'variant-builder') {
    const selectedIndices = getSelectedPartIndices();
    if (selectedIndices.size === 0) return;

    // Handle delete separately
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelectedPart();
      renderPartsInVariant();
      updatePartProperties();
      render();
      return;
    }

    if (delta) {
      e.preventDefault();
      saveHistory();
      for (const idx of selectedIndices) {
        const part = state.partsInVariant[idx];
        if (part) {
          part.x += delta.dx;
          part.y += delta.dy;
        }
      }
      markDirty();
      updatePartProperties();
      render();
    }
  }

  // Arrow key movement (Part Editor - move selection or selected shape)
  if (state.selectedMode === 'part-editor' && delta) {
    e.preventDefault();

    // Priority 1: Move pixel selection if active
    if (selection.hasSelection()) {
      clipboard.moveSelection(delta.dx, delta.dy).then(moved => {
        if (moved) {
          markDirty();
          ui.setStatus(`Moved selection by (${delta.dx}, ${delta.dy})`);
        }
      });
      return;
    }

    // Priority 2: Move selected shape if any
    if (state.selectedShapeIndex !== null) {
      const layer = state.layers.find(l => l.id === state.selectedLayerId);
      if (layer && layer.shapes[state.selectedShapeIndex]) {
        saveHistory();
        const shape = layer.shapes[state.selectedShapeIndex];
        // Move shape based on its type
        if (shape.x !== undefined) shape.x += delta.dx;
        if (shape.y !== undefined) shape.y += delta.dy;
        if (shape.x1 !== undefined) { shape.x1 += delta.dx; shape.x2 += delta.dx; }
        if (shape.y1 !== undefined) { shape.y1 += delta.dy; shape.y2 += delta.dy; }
        // Move pixels array if present
        if (shape.pixels) {
          shape.pixels = shape.pixels.map(p => ({ ...p, x: p.x + delta.dx, y: p.y + delta.dy }));
        }
        if (shape.dots) {
          shape.dots = shape.dots.map(d => ({ ...d, x: d.x + delta.dx, y: d.y + delta.dy }));
        }
        if (shape.points) {
          shape.points = shape.points.map(p => ({ ...p, x: p.x + delta.dx, y: p.y + delta.dy }));
        }
        markDirty();
        updateShapePropertiesPanel();
        render();
      }
      return;
    }
  }
}

// Initialize editor after auth
async function initEditor() {
  // Load sprite manifest
  await loadManifest();

  ui.renderObjectSelector();
  ui.setStatus('Select an object to begin');
}

// Auth handler
function handleAuthenticate() {
  const password = ui.getPasswordInput();
  if (authenticate(password)) {
    ui.showAuthOverlay(false);
    initEditor();
  } else {
    ui.showAuthError();
  }
}

// Object selection
function selectObject(type, id, name) {
  state.selectedObjectType = type;
  state.selectedObjectId = id;
  ui.showModeSelectOverlay(name);
}

// Mode selection
function selectMode(mode) {
  state.selectedMode = mode;
  state.selectedPartType = null;
  state.editingPartId = null;
  ui.selectModeCard(mode);

  if (mode === 'part-editor') {
    ui.renderPartTypeGrid(state.selectedObjectId, state.selectedObjectType, handlePartTypeSelected);
    ui.showPartTypeSelection();
    ui.setConfirmEnabled(false);
  } else {
    ui.hidePartTypeSelection();
    ui.hidePartSelectSection();
    ui.setConfirmEnabled(true);
  }
}

// Part type selected - show existing parts
function handlePartTypeSelected(type, btn) {
  state.selectedPartType = type;
  state.editingPartId = null;

  // Load existing parts of this type for this object
  const existingParts = getPartsOfType(state.selectedObjectId, type, state.selectedObjectType);

  // Format the type name nicely
  const typeName = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Show part selection grid
  ui.showPartSelectSection(typeName);
  ui.renderPartSelectGrid(
    existingParts,
    typeName,
    handleSelectExistingPart,
    handleCreateNewPart
  );

  ui.setConfirmEnabled(false); // Must select a part or "Create New"
}

// User selected an existing part to edit
function handleSelectExistingPart(partId) {
  state.editingPartId = partId;
  ui.setConfirmEnabled(true);
}

// User chose to create a new part
function handleCreateNewPart() {
  state.editingPartId = null;
  ui.setConfirmEnabled(true);
}

// Confirm mode selection and enter editor
function confirmModeSelection() {
  ui.hideModeSelectOverlay();
  enterEditor();
}

// Cancel mode selection
function cancelModeSelection() {
  ui.hideModeSelectOverlay();
  ui.hidePartSelectSection();
  state.selectedObjectType = null;
  state.selectedObjectId = null;
  state.selectedMode = null;
  state.selectedPartType = null;
  state.editingPartId = null;
}

// Enter the editor
async function enterEditor() {
  // Get object name for breadcrumb
  let objectName = state.selectedObjectId;
  for (const category of Object.values(OBJECT_CATEGORIES)) {
    const found = category.items.find(i => i.id === state.selectedObjectId);
    if (found) {
      objectName = found.name;
      break;
    }
  }

  // Get editing part info if editing existing
  let editingPartName = null;
  state.editingPartImage = null;

  if (state.editingPartId) {
    const part = getPartById(state.selectedObjectId, state.selectedPartType, state.editingPartId, state.selectedObjectType);
    if (part) {
      editingPartName = part.name;
      // Load the part image
      if (part.thumbnail) {
        state.editingPartImage = part.thumbnail;
        try {
          await loadImage(part.thumbnail);
          console.log('[sprite-editor] Loaded part image:', part.thumbnail);
        } catch (e) {
          console.warn('[sprite-editor] Could not load part image:', part.thumbnail);
        }
      }
    }
  }

  ui.enterEditorView(state.selectedMode);
  ui.updateBreadcrumb(objectName, state.selectedPartType, state.selectedMode, editingPartName);

  if (state.selectedMode === 'part-editor') {
    initPartEditorMode();
  } else {
    initVariantBuilderMode();
  }

  // Center canvas in viewport (after layout settles)
  requestAnimationFrame(() => {
    resetPan();
    render();
  });
  ui.setStatus(`Editing ${objectName}`);
}

// Initialize Part Editor mode
async function initPartEditorMode() {
  initLayers();

  // Clear variant builder overlays (gizmo and selection - not used in part editor)
  gizmoOverlay.clearGizmoOverlay();
  selectionOverlay.clearSelectionOverlay();

  // Clear snap points from previous part (important when switching between parts)
  state.snapPoints = [];
  state.selectedSnapPointId = null;
  state.snapPointTool = false;
  state.partCategory = null;

  // If editing an existing part, load its data
  if (state.editingPartId && state.editingPartImage) {
    await loadPartImageIntoLayer(state.editingPartImage);
    // Set project path for existing part
    setProjectPath(state.selectedObjectId, state.selectedPartType, state.editingPartId);

    // Try to load working project data (includes snap points, layers, etc.)
    let projectLoaded = false;

    // 1. Try server first
    try {
      const projectData = await api.loadWorkingProject(
        state.selectedObjectId,
        state.selectedPartType,
        state.editingPartId
      );
      if (projectData) {
        console.log('[sprite-editor] Loaded working project from server with snap points:', projectData.snapPoints?.length || 0);
        loadProjectData(projectData);
        projectLoaded = true;
      }
    } catch (e) {
      console.log('[sprite-editor] No server working project found');
    }

    // 2. Try localStorage as fallback
    if (!projectLoaded) {
      const storageKey = `spriteEditor_project_${state.selectedObjectId}_${state.selectedPartType}_${state.editingPartId}`;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const projectData = JSON.parse(stored);
          console.log('[sprite-editor] Loaded working project from localStorage with snap points:', projectData.snapPoints?.length || 0);
          loadProjectData(projectData);
          projectLoaded = true;
        }
      } catch (e) {
        console.log('[sprite-editor] No localStorage project found');
      }
    }

    // 3. Try published sprite.json as last fallback (for snap points only)
    if (!projectLoaded) {
      try {
        const spriteJsonUrl = `/sprites/units/${state.selectedObjectId}/${state.selectedPartType}/${state.editingPartId}/sprite.json`;
        const response = await fetch(spriteJsonUrl);
        if (response.ok) {
          const spriteData = await response.json();
          if (spriteData.snapPoints && spriteData.snapPoints.length > 0) {
            console.log('[sprite-editor] Loaded snap points from published sprite.json:', spriteData.snapPoints.length);
            state.snapPoints = spriteData.snapPoints;
            state.partCategory = spriteData.partCategory || null;
            renderSnapPointsList();
            updateSnapPointProps();
          }
        }
      } catch (e) {
        console.log('[sprite-editor] No published sprite.json found, starting fresh');
      }
    }
  }

  renderLayers();
  renderFrames();
  renderSnapPointsList();
  updateSnapPointProps();
  populatePartCategoryDropdown();

  // Load all default parts as context reference (ghost images)
  await loadContextParts();

  // Check for autosave recovery and start autosave
  if (state.projectPath) {
    checkAutosaveRecovery();
    startAutosave();
  }

  // Render snap points via HTML overlay
  snapOverlay.renderSnapPointOverlay();
}

// Load a part image into the current layer
async function loadPartImageIntoLayer(imageUrl) {
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return;

  try {
    const img = await loadImage(imageUrl);

    // Cache the image
    cacheImage(imageUrl, img);

    // Create image shape centered on canvas
    const x = (state.canvasWidth - img.width) / 2;
    const y = (state.canvasHeight - img.height) / 2;

    const imageShape = {
      type: 'image',
      imageData: imageUrl,
      x: x,
      y: y,
      width: img.width,
      height: img.height,
      originalWidth: img.width,
      originalHeight: img.height,
      opacity: 100
    };

    layer.shapes.push(imageShape);
    ui.setStatus(`Loaded part: ${img.width}x${img.height}`);
  } catch (e) {
    console.warn('[sprite-editor] Could not load part image into layer:', imageUrl, e);
  }
}

// Load other default parts as semi-transparent context reference
async function loadContextParts() {
  await loadManifest();

  // Load all parts ONCE and cache them
  const allParts = getAllPartsForObject(state.selectedObjectId, state.selectedObjectType);
  state.allContextPartsCache = allParts;

  // Preload ALL images upfront (one time)
  for (const part of allParts) {
    if (part.thumbnail) {
      try {
        await loadImage(part.thumbnail);
      } catch (e) {
        console.warn('[sprite-editor] Could not preload context part:', part.thumbnail);
      }
    }
  }

  // Build list of part types with counts
  const partTypeCounts = {};
  for (const part of allParts) {
    partTypeCounts[part.partType] = (partTypeCounts[part.partType] || 0) + 1;
  }

  // Build dropdown options: "All" + each part type
  state.contextVariants = [
    { id: 'all', name: 'All Parts', filter: null },
    ...Object.entries(partTypeCounts).map(([type, count]) => ({
      id: type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} (${count})`,
      filter: type
    }))
  ];
  state.selectedContextVariant = 'all';

  // Populate the dropdown
  ui.populateContextVariantSelect(state.contextVariants, state.selectedContextVariant);

  // Apply initial filter (uses cached data, no API calls)
  applyContextFilter(state.selectedContextVariant);
}

// Apply context filter using cached data (instant, no API calls)
function applyContextFilter(filterId) {
  const allParts = state.allContextPartsCache || [];

  // Find the selected filter option
  const selectedOption = state.contextVariants.find(v => v.id === filterId);

  let partsToShow;
  if (filterId === 'all' || !selectedOption?.filter) {
    // "All Parts" - show everything
    partsToShow = allParts;
  } else {
    // Filter by part type
    partsToShow = allParts.filter(part => part.partType === selectedOption.filter);
  }

  // Add visibility flag and editing indicator
  // Hidden by default - user can toggle on as needed for reference
  state.contextParts = partsToShow.map(part => ({
    ...part,
    visible: false,
    isEditingPart: part.id === state.editingPartId
  }));

  // Ensure context button reflects actual visibility state (all hidden by default)
  const anyVisible = state.contextParts.some(p => p.visible);
  state.showContextParts = anyVisible;
  ui.setContextActive(anyVisible);

  renderContextParts();
  render();
}

// Handle context filter selection change (instant, uses cache)
function handleSelectContextVariant(filterId) {
  state.selectedContextVariant = filterId;
  applyContextFilter(filterId);
  ui.setStatus(`Filter: ${state.contextVariants.find(v => v.id === filterId)?.name || filterId}`);
}

// Render context parts list
function renderContextParts() {
  ui.renderContextParts(state.contextParts, handleToggleContextPartVisibility);
  updateToggleAllContextBtn();
}

// Toggle individual context part visibility
function handleToggleContextPartVisibility(index) {
  if (index >= 0 && index < state.contextParts.length) {
    state.contextParts[index].visible = !state.contextParts[index].visible;
    // Sync master toggle - if any part is visible, context is on
    const anyVisible = state.contextParts.some(p => p.visible);
    state.showContextParts = anyVisible;
    ui.setContextActive(anyVisible);
    renderContextParts();
    render();
  }
}

// Toggle all context parts visibility
function handleToggleAllContext() {
  const allVisible = state.contextParts.every(p => p.visible);
  const newState = !allVisible;
  state.contextParts.forEach(p => p.visible = newState);
  // Sync the master toggle and Context button
  state.showContextParts = newState;
  ui.setContextActive(newState);
  renderContextParts();
  render();
}

// Toggle all layers visibility
function handleToggleAllLayers() {
  const allVisible = state.layers.every(l => l.visible);
  const newState = !allVisible;
  state.layers.forEach(l => l.visible = newState);
  renderLayers();
  render();
}

// Toggle all parts in variant visibility
function handleToggleAllParts() {
  const allVisible = state.partsInVariant.every(p => p.visible !== false);
  const newState = !allVisible;
  state.partsInVariant.forEach(p => p.visible = newState);
  renderPartsInVariant();
  render();
}

// Update the toggle all button state
function updateToggleAllContextBtn() {
  ui.updateToggleAllContextBtn(state.contextParts);
}

// Initialize Variant Builder mode
function initVariantBuilderMode() {
  initVariantBuilder();
  loadAvailableParts();
  renderPartsInVariant();
  // Load existing variants for this unit
  loadVariantsForUnit();
  // Render all HTML overlays after a brief delay for layout
  requestAnimationFrame(() => {
    snapOverlay.renderSnapPointOverlay();
    gizmoOverlay.renderGizmoOverlay();
    selectionOverlay.renderSelectionOverlay();
  });
}

// Load available parts for variant builder from manifest
async function loadAvailableParts() {
  // Force reload manifest to get fresh snap point data
  await reloadManifest();

  // Get all parts for this object using the parts module
  state.parts = getAllPartsForObject(state.selectedObjectId, state.selectedObjectType);

  console.log(`[sprite-editor] Loaded ${state.parts.length} parts for ${state.selectedObjectId}`);
  // Log snap points info for debugging
  state.parts.forEach(p => {
    if (p.snapPoints?.length > 0) {
      console.log(`[sprite-editor]   ${p.name}: ${p.snapPoints.length} snap points, category=${p.category}`);
    }
  });
  ui.renderPartLibrary(state.parts, handleAddPartToVariant);
}

// Render helpers
function renderLayers() {
  ui.renderLayerList(
    state.layers,
    state.selectedLayerId,
    handleSelectLayer,
    handleToggleLayerVisibility
  );
  ui.updateToggleAllLayersBtn(state.layers);
}

function renderFrames() {
  ui.renderFrameList(
    state.frames,
    state.currentFrame,
    handleSelectFrame,
    handleAddFrame,
    generateFrameThumbnail
  );
}

function renderPartsInVariant() {
  ui.renderPartsInUse(
    state.partsInVariant,
    state.selectedPartInVariant,
    handleSelectPartInVariant,
    handleTogglePartVisibility,
    getSelectedPartIndices()  // Pass multi-selection set
  );
  ui.updateToggleAllPartsBtn(state.partsInVariant);
  // Update HTML snap point overlay
  if (state.selectedMode === 'variant-builder') {
    snapOverlay.renderSnapPointOverlay();
  }
}

function handleTogglePartVisibility(index) {
  togglePartVisibility(index);
  renderPartsInVariant();
  render();
}

// Layer handlers
function handleSelectLayer(layerId) {
  selectLayer(layerId);
  renderLayers();
  updateLayerProperties();
}

function handleToggleLayerVisibility(layerId) {
  toggleLayerVisibility(layerId);
  renderLayers();
  render();
}

function handleAddLayer() {
  addLayer();
  renderLayers();
  saveHistory();
}

function handleMoveLayerUp() {
  if (moveLayerUp()) {
    renderLayers();
    render();
    saveHistory();
  }
}

function handleMoveLayerDown() {
  if (moveLayerDown()) {
    renderLayers();
    render();
    saveHistory();
  }
}

function handleDuplicateLayer() {
  if (duplicateLayer()) {
    renderLayers();
    render();
    saveHistory();
  }
}

function handleDeleteLayer() {
  if (deleteLayer()) {
    renderLayers();
    render();
    saveHistory();
  } else {
    alert('Cannot delete the last layer');
  }
}

function updateLayerProperties() {
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (layer) {
    document.getElementById('layerName').value = layer.name;
    document.getElementById('layerOpacity').value = layer.opacity;
    const layerOpacityNum = document.getElementById('layerOpacityNum');
    if (layerOpacityNum) layerOpacityNum.value = layer.opacity;
    // Use guard to prevent change event feedback loop
    const blendDropdown = document.getElementById('layerBlend');
    if (window._blendDropdownGuard) {
      window._blendDropdownGuard(() => { blendDropdown.value = layer.blend; });
    } else {
      blendDropdown.value = layer.blend;
    }
  }
}

// Frame handlers
function handleSelectFrame(idx) {
  selectFrame(idx);
  renderLayers();
  renderFrames();
  render();
}

function handleAddFrame() {
  addFrame();
  renderFrames();
  saveHistory();
}

function handlePrevFrame() {
  if (prevFrame()) {
    renderLayers();
    renderFrames();
    render();
  }
}

function handleNextFrame() {
  if (nextFrame()) {
    renderLayers();
    renderFrames();
    render();
  }
}

function handleTogglePlayback() {
  const isPlaying = togglePlayback();
  // Update play button visual
  const playBtn = document.querySelector('.timeline-controls button:nth-child(2)');
  if (playBtn) {
    playBtn.textContent = isPlaying ? '⏸' : '▶';
  }
}

// Variant handlers
async function handleAddPartToVariant(partId) {
  const partData = state.parts.find(p => p.id === partId);
  if (partData) {
    // Preload the image
    if (partData.thumbnail) {
      try {
        await loadImage(partData.thumbnail);
      } catch (e) {
        console.warn('Could not load part image:', partData.thumbnail);
      }
    }

    addPartToVariant(partData);
    renderPartsInVariant();
    updatePartProperties();
    render();
    ui.setStatus(`Added ${partData.name}`);
  }
}

function handleSelectPartInVariant(index, additive = false) {
  selectPartInVariant(index, additive);
  renderPartsInVariant();
  updatePartProperties();
  render();  // Update canvas to show selection
}

function handleMovePartUp() {
  if (movePartForward()) {
    renderPartsInVariant();
    render();
  }
}

function handleMovePartDown() {
  if (movePartBackward()) {
    renderPartsInVariant();
    render();
  }
}

function handleRemovePart() {
  if (removeSelectedPart()) {
    renderPartsInVariant();
    updatePartProperties();
    render();
  }
}

function updatePartProperties() {
  const part = getSelectedPart();
  const selectedCount = getSelectedPartIndices().size;

  if (!part) {
    document.getElementById('noPartSelected').classList.remove('hidden');
    document.getElementById('partTransform').classList.add('hidden');
    return;
  }

  document.getElementById('noPartSelected').classList.add('hidden');
  document.getElementById('partTransform').classList.remove('hidden');

  // Show selection count in header if multi-selected
  const headerEl = document.querySelector('#partTransform .prop-section-title');
  if (headerEl) {
    headerEl.textContent = selectedCount > 1
      ? `Transform (${selectedCount} parts)`
      : 'Transform';
  }

  document.getElementById('partX').value = Math.round(part.x);
  document.getElementById('partY').value = Math.round(part.y);

  // Pivot point (absolute canvas coordinates, null = use part position)
  const pivotXInput = document.getElementById('partPivotX');
  const pivotYInput = document.getElementById('partPivotY');
  if (pivotXInput) {
    pivotXInput.value = part.pivotX !== null ? Math.round(part.pivotX) : '';
  }
  if (pivotYInput) {
    pivotYInput.value = part.pivotY !== null ? Math.round(part.pivotY) : '';
  }

  // Sync sliders and numeric inputs
  document.getElementById('partRotation').value = part.rotation;
  const partRotationNum = document.getElementById('partRotationNum');
  if (partRotationNum) partRotationNum.value = part.rotation;

  const scalePercent = Math.round(part.scale * 100);
  document.getElementById('partScale').value = scalePercent;
  const partScaleNum = document.getElementById('partScaleNum');
  if (partScaleNum) partScaleNum.value = scalePercent;

  document.getElementById('partOpacity').value = part.opacity;
  const partOpacityNum = document.getElementById('partOpacityNum');
  if (partOpacityNum) partOpacityNum.value = part.opacity;

  // Update parent selector dropdown
  updatePartParentDropdown(part);

  // Update animation UI
  updateAnimationUI(part);
}

// Update parent selector dropdown for current part
function updatePartParentDropdown(part) {
  const select = document.getElementById('partParentSelect');
  if (!select) return;

  const currentPartIndex = state.partsInVariant.indexOf(part);

  // Clear and rebuild options
  select.innerHTML = '<option value="">None (root)</option>';

  // Add all other parts as potential parents (can't be parent of self or create cycles)
  state.partsInVariant.forEach((p, idx) => {
    if (idx === currentPartIndex) return; // Can't be own parent

    // Check for cycles - can't select a descendant as parent
    let isDescendant = false;
    let checkPart = p;
    while (checkPart && checkPart.parentIndex !== null) {
      if (checkPart.parentIndex === currentPartIndex) {
        isDescendant = true;
        break;
      }
      checkPart = state.partsInVariant[checkPart.parentIndex];
    }
    if (isDescendant) return;

    const label = p.partId || p.name || `Part ${idx}`;
    const option = document.createElement('option');
    option.value = idx;
    option.textContent = label;
    select.appendChild(option);
  });

  // Set current value
  select.value = part.parentIndex !== null ? part.parentIndex : '';

  // Show hint about snap point attachment if part is attached
  const hint = document.getElementById('parentHint');
  if (hint) {
    if (part.attachedTo) {
      hint.textContent = 'Attached via snap point. Clear attachment to use manual positioning.';
      select.disabled = true;
    } else {
      hint.textContent = 'Set parent for hierarchy animations. X/Y becomes offset from parent.';
      select.disabled = false;
    }
  }
}

// Set parent for selected part (without snap point)
function setPartParent(value) {
  const part = getSelectedPart();
  if (!part) return;

  const newParentIndex = value === '' ? null : parseInt(value, 10);
  const oldParentIndex = part.parentIndex;

  // If no change, do nothing
  if (newParentIndex === oldParentIndex) return;

  // Get current world transform of the part (before changing parent)
  const partIndex = state.partsInVariant.indexOf(part);
  const currentWorld = snapPoints.getWorldTransform(partIndex);
  const worldX = currentWorld?.x ?? part.x;
  const worldY = currentWorld?.y ?? part.y;
  const worldScale = currentWorld?.scale ?? (part.scale || 1);

  // Update part's parent
  part.parentIndex = newParentIndex;

  // Clear any snap attachment since we're using manual positioning
  part.attachedTo = null;

  // Convert position and scale to keep part visually the same
  if (newParentIndex !== null) {
    // Setting a parent - convert absolute to relative
    const parent = state.partsInVariant[newParentIndex];
    if (parent) {
      // Get parent's world transform
      const parentWorld = snapPoints.getWorldTransform(newParentIndex);
      const parentX = parentWorld?.x ?? parent.x;
      const parentY = parentWorld?.y ?? parent.y;
      const parentRot = parentWorld?.rotation ?? (parent.rotation || 0);
      const parentScale = parentWorld?.scale ?? (parent.scale || 1);

      // Calculate offset from parent (in parent's local space)
      const dx = worldX - parentX;
      const dy = worldY - parentY;

      // If parent is rotated, we need to un-rotate the offset
      if (parentRot !== 0) {
        const rad = -parentRot * Math.PI / 180;  // Negative to un-rotate
        part.x = (dx * Math.cos(rad) - dy * Math.sin(rad)) / parentScale;
        part.y = (dx * Math.sin(rad) + dy * Math.cos(rad)) / parentScale;
      } else {
        part.x = dx / parentScale;
        part.y = dy / parentScale;
      }

      // Adjust local scale so world scale stays the same
      // worldScale = parentScale * localScale, so localScale = worldScale / parentScale
      part.scale = worldScale / parentScale;
    }
  } else {
    // Removing parent - convert relative to absolute
    // worldX/worldY and worldScale already have the absolute values
    part.x = worldX;
    part.y = worldY;
    part.scale = worldScale;
  }

  // Update UI to show new values
  document.getElementById('partX').value = Math.round(part.x);
  document.getElementById('partY').value = Math.round(part.y);
  document.getElementById('partScale').value = Math.round(part.scale * 100);

  render();
  ui.setStatus(newParentIndex !== null ? 'Parent set - position converted to offset' : 'Part is now a root part');
}

// Update animation UI to reflect selected part's animation for current trigger
function updateAnimationUI(part) {
  const typeSelect = document.getElementById('animationType');
  if (!typeSelect) return;

  // Get animation for the current trigger tab
  const anim = part.animations?.[currentAnimationTrigger] || null;

  if (anim && anim.type !== 'none') {
    typeSelect.value = anim.type;
    updateAnimationParamsUI(anim.type, anim.params);
  } else {
    typeSelect.value = 'none';
    updateAnimationParamsUI('none');
  }

  // Update trigger tab indicators to show which have animations
  updateTriggerTabIndicators();

  // Update preview button text
  const previewName = document.getElementById('previewTriggerName');
  if (previewName) {
    previewName.textContent = currentAnimationTrigger.charAt(0).toUpperCase() + currentAnimationTrigger.slice(1);
  }
}

// Select a different animation trigger tab
function selectAnimationTrigger(trigger) {
  currentAnimationTrigger = trigger;

  // Update tab UI
  document.querySelectorAll('.trigger-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.trigger === trigger);
  });

  // Update preview button text
  const previewName = document.getElementById('previewTriggerName');
  if (previewName) {
    previewName.textContent = trigger.charAt(0).toUpperCase() + trigger.slice(1);
  }

  // Reload animation UI for selected part with new trigger
  const part = getSelectedPart();
  if (part) {
    updateAnimationUI(part);
  }

  // Also set the animation preview state to match
  animation.setAnimationState(trigger);

  // Update animation state buttons to match
  document.querySelectorAll('.animation-state-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.state === trigger);
  });
}

// Update trigger tab indicators to show which have animations configured
function updateTriggerTabIndicators() {
  const part = getSelectedPart();
  if (!part) return;

  const triggers = ['idle', 'move', 'aim', 'fire', 'hit'];
  triggers.forEach(trigger => {
    const tab = document.querySelector(`.trigger-tab[data-trigger="${trigger}"]`);
    if (tab) {
      const hasAnim = part.animations?.[trigger] && part.animations[trigger].type !== 'none';
      tab.classList.toggle('has-animation', hasAnim);
    }
  });
}

// Update animation params UI based on type
function updateAnimationParamsUI(type, existingParams = {}) {
  const container = document.getElementById('animationParams');
  if (!container) return;

  if (type === 'none') {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = animation.getAnimationParamsHTML(type, existingParams);

  // Add event listeners to param inputs for live update
  container.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', () => {
      applyAnimationToSelectedPart();
    });
  });
}

// Apply animation config from UI to selected part (for current trigger)
function applyAnimationToSelectedPart() {
  const part = getSelectedPart();
  if (!part) return;

  const typeSelect = document.getElementById('animationType');
  if (!typeSelect) return;

  const type = typeSelect.value;

  // Ensure animations object exists
  if (!part.animations) {
    part.animations = { idle: null, move: null, aim: null, fire: null, hit: null };
  }

  if (type === 'none') {
    part.animations[currentAnimationTrigger] = null;
  } else {
    const params = animation.readAnimationParamsFromUI(type);
    part.animations[currentAnimationTrigger] = {
      type,
      params
    };
  }

  markDirty();
  render();
}

// Toggle animation preview playback
function handlePlayPreview() {
  const playBtn = document.querySelector('.preview-box + div button');

  if (animation.isPreviewPlaying()) {
    animation.stopAnimationPreview();
    if (playBtn) playBtn.textContent = '▶ Play';
    ui.setStatus('Animation preview stopped');
  } else {
    // Log recoil debug info once at start
    const aimAngle = animation.getPreviewAimAngle();
    const animState = animation.getAnimationState();
    animation.debugLogRecoilInfo(state.partsInVariant, animState, aimAngle);

    animation.startAnimationPreview(() => {
      render();  // Re-render on each animation frame
      // Check if animation ended (non-loop mode) and update button
      if (!animation.isPreviewPlaying()) {
        if (playBtn) playBtn.textContent = '▶ Play';
        ui.setStatus('Animation complete');
      }
    });
    if (playBtn) playBtn.textContent = '⏸ Stop';
    ui.setStatus('Animation preview playing');
  }
}

// Reset animation preview - stop and show original positions
function handleResetPreview() {
  const playBtn = document.querySelector('.preview-box + div button');
  animation.resetAnimationPreview();
  if (playBtn) playBtn.textContent = '▶ Play';
  render();  // Force render at time 0
  ui.setStatus('Animation preview reset');
}

// Preview the currently selected trigger's animation
function handlePreviewCurrentTrigger() {
  // Set the animation state to match current trigger tab
  animation.setAnimationState(currentAnimationTrigger);

  // Update animation state bar to match
  document.querySelectorAll('.animation-state-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.state === currentAnimationTrigger);
  });

  // Start preview if not already playing
  if (!animation.isPreviewPlaying()) {
    handlePlayPreview();
  }

  ui.setStatus(`Previewing ${currentAnimationTrigger} animation`);
}

// Set preview aim angle (for testing aim-based animations)
function setPreviewAimAngle(value) {
  const angle = parseInt(value, 10) || 0;
  animation.setPreviewAimAngle(angle);

  // Sync both UI controls
  const slider = document.getElementById('previewAimAngle');
  const input = document.getElementById('previewAimAngleValue');
  if (slider) slider.value = angle;
  if (input) input.value = angle;

  // Re-render to show updated aim
  render();
}

// Set loop animation mode
function setLoopAnimation(loop) {
  animation.setLoopAnimation(loop);
}

// Set loop duration
function setLoopDuration(seconds) {
  const duration = parseFloat(seconds) || 1;
  animation.setLoopDuration(duration);
}

// Set pivot to canvas center (for shared rotation point)
function setPivotToCenter() {
  const part = getSelectedPart();
  if (!part) return;

  saveHistory();
  part.pivotX = state.canvasWidth / 2;
  part.pivotY = state.canvasHeight / 2;
  markDirty();
  updatePartProperties();
  render();
  ui.setStatus('Pivot set to canvas center');
}

// Clear pivot (revert to rotating around part position)
function clearPivot() {
  const part = getSelectedPart();
  if (!part) return;

  saveHistory();
  part.pivotX = null;
  part.pivotY = null;
  markDirty();
  updatePartProperties();
  render();
  ui.setStatus('Pivot cleared');
}

// Get center of canvas container (for zoom buttons)
function getContainerCenter() {
  const container = document.getElementById('canvas')?.parentElement;
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
}

// Cancel any active operation (reusable - called by ESC, right-click, tool icon click)
function cancelCurrentOperation() {
  let needsRender = false;

  // Cancel polyline mode
  if (isInClickPlaceMode()) {
    cancelClickPlaceMode();
    needsRender = true;
  }

  // Deselect shape
  if (state.selectedShapeIndex !== null) {
    clearShapeSelection();
    updateShapePropertiesPanel();
    needsRender = true;
  }

  // Clear selection
  if (selection.hasSelection()) {
    selection.clearSelection();
    state.lastLassoPoints = null; // Clear stored lasso path
    needsRender = true;
  }

  // Clear edge fill reference points
  if (getEdgeFillRefPoints().length > 0) {
    clearEdgeFillRefPoints();
    needsRender = true;
  }

  if (needsRender) {
    render();
    ui.setStatus('Cancelled');
  }
}

// Right-click handler
function handleRightClick() {
  // In lasso polygon mode, undo the last point instead of canceling
  if (state.tool === 'lasso' && isInClickPlaceMode()) {
    if (undoLastLassoPoint()) {
      return; // Point was removed, don't cancel
    }
  }
  cancelCurrentOperation();
}

// Cursor preview helpers (uses CURSOR_PREVIEW_TOOLS from constants.js)
function updateCursorPreview(x, y) {
  // Only update for tools that use cursor preview
  if (!CURSOR_PREVIEW_TOOLS.includes(state.tool)) {
    // Clear if tool changed while cursor is on canvas
    if (state.cursorX >= 0) clearCursorPreview();
    return;
  }

  // Don't render here if actively drawing - renderWithPreview handles that
  // Exception: selection-brush should always show cursor preview
  if (isCurrentlyDrawing() && state.tool !== 'selection-brush') {
    state.cursorX = -1;
    state.cursorY = -1;
    return;
  }

  // Update position and render
  state.cursorX = x;
  state.cursorY = y;
  render();
}

function clearCursorPreview() {
  if (state.cursorX >= 0 || state.cursorY >= 0) {
    state.cursorX = -1;
    state.cursorY = -1;
    render();
  }
}

// Canvas control handlers
function handleZoomIn(mouseX, mouseY) {
  if (mouseX === undefined) {
    const center = getContainerCenter();
    mouseX = center.x;
    mouseY = center.y;
  }
  zoomAtPoint(1.25, mouseX, mouseY);
}

function handleZoomOut(mouseX, mouseY) {
  if (mouseX === undefined) {
    const center = getContainerCenter();
    mouseX = center.x;
    mouseY = center.y;
  }
  zoomAtPoint(1 / 1.25, mouseX, mouseY);
}

// Zoom centered on a specific point
function zoomAtPoint(factor, mouseX, mouseY) {
  const oldZoom = state.zoom;
  const newZoom = Math.min(60, Math.max(0.1, oldZoom * factor));

  if (newZoom === oldZoom) return;

  // If mouse position provided, zoom toward that point
  if (mouseX !== undefined && mouseY !== undefined) {
    // Calculate the canvas point under the cursor before zoom
    const canvasX = (mouseX - panOffsetX) / oldZoom;
    const canvasY = (mouseY - panOffsetY) / oldZoom;

    // Update zoom
    state.zoom = newZoom;

    // Adjust pan so the same canvas point stays under the cursor
    panOffsetX = mouseX - canvasX * newZoom;
    panOffsetY = mouseY - canvasY * newZoom;
  } else {
    state.zoom = newZoom;
  }

  updateCanvasTransform();
  ui.setZoomDisplay(Math.round(newZoom * 100));
  render(); // Redraw checkerboard at new subdivision level
}

function handleResetZoom() {
  const percent = resetZoom();
  resetPan();
  ui.setZoomDisplay(percent);
  render(); // Redraw checkerboard at new subdivision level
}

function handleToggleGrid() {
  const active = toggleGrid();
  ui.setGridActive(active);
  render();
}

function handleToggleRef() {
  // Always toggle visibility (even if no image - button just won't show anything)
  const active = toggleRef();
  ui.setRefActive(active);
  render();
}

// Long press on ref button shows context menu
let refLongPressTimer = null;

function handleRefMouseDown(e) {
  // Only handle left-click for toggle/long-press
  if (e.button !== 0) return;
  e.preventDefault();
  refLongPressTimer = setTimeout(() => {
    showRefContextMenu(e);
    refLongPressTimer = null;
  }, 500); // 500ms for long press
}

function handleRefMouseUp() {
  if (refLongPressTimer) {
    clearTimeout(refLongPressTimer);
    refLongPressTimer = null;
    // Short click - toggle visibility
    handleToggleRef();
  }
}

function handleRefContextMenu(e) {
  e.preventDefault();
  showRefContextMenu(e);
}

function showRefContextMenu(e) {
  const hasImage = !!(state.refImage || state.refImageUrl);

  const menuItems = [
    { label: 'Import Image...', action: handleImportRefImage },
  ];

  if (hasImage) {
    menuItems.push(
      { label: state.showRef ? 'Hide Reference' : 'Show Reference', action: handleToggleRef },
      { label: 'Reset Transform', action: handleResetRefTransform },
      { label: 'Remove Image', action: handleClearRefImage }
    );
  }

  ui.showContextMenu(e.clientX, e.clientY, menuItems);
}

function handleToggleOnion() {
  const active = toggleOnion();
  ui.setOnionActive(active);
  render();
}

function handleToggleContextParts() {
  const active = toggleContextParts();
  ui.setContextActive(active);
  // When turning on, make all parts visible; when turning off, hide all
  state.contextParts.forEach(p => p.visible = active);
  // Sync the toggle all button after updating parts
  ui.updateToggleAllContextBtn(state.contextParts);
  renderContextParts();
  render();
}

function handleImportRefImage() {
  // Trigger hidden file input
  document.getElementById('refImageInput').click();
}

function handleRefImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      setRefImage(img);
      state.refImageUrl = e.target.result;
      console.log('[sprite-editor] Ref image loaded and stored:', !!state.refImage, !!state.refImageUrl);
      // Reset transform to defaults
      state.refOpacity = 40;
      state.refScale = 100;
      state.refX = 0;
      state.refY = 0;
      ui.setRefActive(true);
      ui.showRefImageControls(true);
      ui.updateRefImageControls(state.refOpacity, state.refScale, state.refX, state.refY);
      render();
      ui.setStatus(`Reference image loaded: ${file.name}`);
    };
    img.onerror = () => {
      console.error('[sprite-editor] Failed to load ref image');
      ui.setStatus('Failed to load reference image');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // Reset file input so same file can be selected again
  event.target.value = '';
}

function handleClearRefImage() {
  clearRef();
  ui.setRefActive(false);
  ui.showRefImageControls(false);
  render();
  ui.setStatus('Reference image cleared');
}

// Import image to current layer
function handleImportImageToLayer() {
  if (state.selectedMode !== 'part-editor') {
    ui.setStatus('Image import only available in Part Editor mode');
    return;
  }
  document.getElementById('layerImageInput').click();
}

function handleLayerImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) {
    ui.setStatus('No layer selected');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Cache the image so it renders immediately
      cacheImage(e.target.result, img);

      // Create image shape centered on canvas
      const x = (state.canvasWidth - img.width) / 2;
      const y = (state.canvasHeight - img.height) / 2;

      const imageShape = {
        type: 'image',
        imageData: e.target.result, // Store as data URL
        x: x,
        y: y,
        width: img.width,
        height: img.height,
        originalWidth: img.width,   // Store original for scale calculations
        originalHeight: img.height,
        opacity: 100
      };

      saveHistory(); // Save BEFORE adding shape
      layer.shapes.push(imageShape);
      render();
      ui.setStatus(`Imported image: ${file.name} (${img.width}x${img.height})`);
    };
    img.onerror = () => {
      ui.setStatus('Failed to load image');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // Reset file input
  event.target.value = '';
}

function handleResetRefTransform() {
  state.refOpacity = 40;
  state.refScale = 100;
  state.refX = 0;
  state.refY = 0;
  syncRefSliders();
  ui.updateRefImageControls(state.refOpacity, state.refScale, state.refX, state.refY);
  render();
}

// Generic numeric input adjustment
// stateKey: key in state object, inputId: DOM input id, sliderId: optional slider to sync
// min/max: optional bounds
function adjustNumericValue(stateKey, inputId, delta, { min = null, max = null, sliderId = null } = {}) {
  let value = state[stateKey] + delta;
  if (min !== null) value = Math.max(min, value);
  if (max !== null) value = Math.min(max, value);
  state[stateKey] = value;

  // Update the input
  const input = document.getElementById(inputId);
  if (input) input.value = value;

  // Update optional slider
  if (sliderId) {
    const slider = document.getElementById(sliderId);
    if (slider) slider.value = Math.min(value, parseInt(slider.max) || value);
  }

  render();
}

// Hold-to-repeat for +/- buttons
let holdInterval = null;
let holdTimeout = null;

function startHold(fn) {
  fn(); // Execute immediately
  // Start repeating after initial delay
  holdTimeout = setTimeout(() => {
    holdInterval = setInterval(fn, 50); // Repeat every 50ms
  }, 300); // Initial delay before repeat starts
}

function stopHold() {
  if (holdTimeout) {
    clearTimeout(holdTimeout);
    holdTimeout = null;
  }
  if (holdInterval) {
    clearInterval(holdInterval);
    holdInterval = null;
  }
}

// Setup hold behavior on all num-btn elements
function setupHoldButtons() {
  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.num-btn');
    if (!btn) return;

    e.preventDefault();

    // Check for data attributes (generic approach)
    if (btn.dataset.input) {
      const inputId = btn.dataset.input;
      const delta = parseFloat(btn.dataset.delta) || 1;
      const min = btn.dataset.min !== undefined ? parseFloat(btn.dataset.min) : null;
      const max = btn.dataset.max !== undefined ? parseFloat(btn.dataset.max) : null;
      const sliderId = btn.dataset.slider || null;
      const stateKey = btn.dataset.state || null;

      const fn = () => adjustInput(inputId, delta, { min, max, sliderId, stateKey });
      startHold(fn);
      return;
    }

    // Shape property adjustment (data-shape="x" or "y")
    if (btn.dataset.shape) {
      const prop = btn.dataset.shape;
      const delta = parseFloat(btn.dataset.delta) || 1;
      const fn = () => adjustShapeProperty(prop, delta);
      startHold(fn);
      return;
    }

    // Canvas size adjustment (data-canvas="width" or "height")
    if (btn.dataset.canvas) {
      const dimension = btn.dataset.canvas;
      const delta = parseFloat(btn.dataset.delta) || 32;
      const fn = () => handleAdjustCanvasSize(dimension, delta);
      startHold(fn);
      return;
    }

    // Fallback: check for onclick attribute (legacy)
    const onclick = btn.getAttribute('onclick');
    if (onclick) {
      // Remove onclick to prevent double-firing, restore on mouseup
      btn.removeAttribute('onclick');
      document.addEventListener('mouseup', () => {
        btn.setAttribute('onclick', onclick);
      }, { once: true });

      const fnCall = onclick.replace('spriteEditor.', '');
      const fn = new Function(`window.spriteEditor.${fnCall}`);
      startHold(fn);
    }
  });

  document.addEventListener('mouseup', stopHold);
  document.addEventListener('mouseleave', stopHold);
  document.addEventListener('touchend', stopHold);
}

// Generic input adjustment via data attributes
function adjustInput(inputId, delta, { min = null, max = null, sliderId = null, stateKey = null } = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  let value = parseFloat(input.value) || 0;
  value += delta;

  if (min !== null) value = Math.max(min, value);
  if (max !== null) value = Math.min(max, value);

  input.value = value;

  // Update state if specified
  if (stateKey && state[stateKey] !== undefined) {
    state[stateKey] = value;
  }

  // Sync slider if specified
  if (sliderId) {
    const slider = document.getElementById(sliderId);
    if (slider) slider.value = Math.min(value, parseFloat(slider.max) || value);
  }

  // Call the registered callback directly (from syncInputOnBlur)
  const callback = inputCallbacks.get(inputId);
  if (callback) {
    callback.onChange(value);
  } else {
    render();
  }
}

// History handlers
function handleUndo() {
  if (undo()) {
    renderLayers();
    renderFrames();
    renderPartsInVariant();
    updatePartProperties();  // Update variant builder properties panel
    // Update snap point UI (Part Editor)
    renderSnapPointsList();
    updateSnapPointProps();
    const categorySelect = document.getElementById('partCategorySelect');
    if (categorySelect) categorySelect.value = state.partCategory || '';
    render();
    ui.setStatus('Undo');
  }
}

function handleRedo() {
  if (redo()) {
    renderLayers();
    renderFrames();
    renderPartsInVariant();
    updatePartProperties();  // Update variant builder properties panel
    // Update snap point UI (Part Editor)
    renderSnapPointsList();
    updateSnapPointProps();
    const categorySelect = document.getElementById('partCategorySelect');
    if (categorySelect) categorySelect.value = state.partCategory || '';
    render();
    ui.setStatus('Redo');
  }
}

// Change object (return to welcome)
function changeObject() {
  resetObjectSelection();
  ui.exitToWelcomeScreen();
  ui.setStatus('Select an object to begin');
}

// Debug console handlers
function handleToggleDebug() {
  debug.toggle();
}

function handleClearDebugLogs() {
  debug.clear();
}

function handleCopyDebugLogs() {
  debug.copyLogs();
}

// ===== Save/Export Functions =====

// Save working project (Ctrl+S)
async function handleSave() {
  if (!state.projectPath) {
    // No project path set, prompt for name
    promptSaveAs();
    return;
  }

  if (state.selectedMode === 'part-editor') {
    await saveWorkingProject();
  } else if (state.selectedMode === 'variant-builder') {
    await saveCurrentVariant();
  }
}

// Save project to localStorage and server
async function saveWorkingProject() {
  if (!state.projectPath) {
    ui.setStatus('No project path set');
    return;
  }

  const { unitId, partType, variant } = state.projectPath;
  const storageKey = `spriteEditor_project_${unitId}_${partType}_${variant}`;

  try {
    state.saveStatus = 'saving';
    updateSaveStatusUI();

    const projectData = getProjectData();
    projectData.savedAt = new Date().toISOString();

    // Save to localStorage (for fast recovery)
    localStorage.setItem(storageKey, JSON.stringify(projectData));

    // Also save to server (for persistence across devices/sessions)
    try {
      await api.saveWorkingProject(unitId, partType, variant, projectData);
      debug.log(`Project saved to server: ${unitId}/${partType}/${variant}`);
    } catch (serverErr) {
      console.warn('Server save failed, localStorage save succeeded:', serverErr);
    }

    // Also update project index
    updateProjectIndex(unitId, partType, variant);

    markClean(projectData.savedAt);
    updateSaveStatusUI();
    ui.setStatus('Saved');
    debug.log(`Project saved: ${unitId}/${partType}/${variant}`);

    // Clear any autosave since we just saved
    const localKey = getAutosaveKey();
    if (localKey) localStorage.removeItem(localKey);

  } catch (err) {
    state.saveStatus = 'error';
    updateSaveStatusUI();
    ui.setStatus(`Save failed: ${err.message}`);
    debug.error(`Save failed: ${err.message}`);
  }
}

// Update project index in localStorage
function updateProjectIndex(unitId, partType, variant) {
  const indexKey = 'spriteEditor_projectIndex';
  let index = [];
  try {
    const stored = localStorage.getItem(indexKey);
    if (stored) index = JSON.parse(stored);
  } catch (e) { /* ignore */ }

  // Add or update entry
  const existing = index.findIndex(p =>
    p.unitId === unitId && p.partType === partType && p.variant === variant
  );

  const entry = { unitId, partType, variant, modifiedAt: new Date().toISOString() };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }

  localStorage.setItem(indexKey, JSON.stringify(index));
}

// Prompt for project name (Save As)
function promptSaveAs() {
  const name = prompt('Enter variant name (e.g., "default", "desert", "winter"):');
  if (!name) return;

  const variant = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  setProjectPath(state.selectedObjectId, state.selectedPartType, variant);
  startAutosave();
  handleSave();
}

// Open working project from localStorage
function handleOpenProject() {
  const indexKey = 'spriteEditor_projectIndex';
  let projects = [];

  try {
    const stored = localStorage.getItem(indexKey);
    if (stored) projects = JSON.parse(stored);
  } catch (e) { /* ignore */ }

  if (projects.length === 0) {
    ui.setStatus('No saved projects found');
    return;
  }

  showOpenProjectDialog(projects);
}

// Show open project dialog
function showOpenProjectDialog(projects) {
  // For now, use a simple prompt - TODO: build a proper dialog
  const options = projects.map((p, i) =>
    `${i + 1}. ${p.unitId}/${p.partType}/${p.variant}`
  ).join('\n');

  const choice = prompt(`Select a project (1-${projects.length}):\n\n${options}`);
  if (!choice) return;

  const idx = parseInt(choice) - 1;
  if (idx >= 0 && idx < projects.length) {
    const project = projects[idx];
    loadWorkingProject(project.unitId, project.partType, project.variant);
  }
}

// Load a working project from localStorage
function loadWorkingProject(unitId, partType, variant) {
  const storageKey = `spriteEditor_project_${unitId}_${partType}_${variant}`;

  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      ui.setStatus('Project not found');
      return;
    }

    const data = JSON.parse(stored);

    // Set project path
    setProjectPath(unitId, partType, variant);

    // Load data into state
    loadProjectData(data);

    // Start autosave
    startAutosave();

    ui.setStatus(`Loaded: ${unitId}/${partType}/${variant}`);
    debug.log(`Loaded project: ${unitId}/${partType}/${variant}`);

  } catch (err) {
    ui.setStatus(`Load failed: ${err.message}`);
    debug.error(`Load failed: ${err.message}`);
  }
}

// Publish to production (sprites/units/...)
async function handlePublish() {
  // In variant-builder mode, use the variant save system instead
  if (state.selectedMode === 'variant-builder') {
    await saveCurrentVariant();
    ui.setStatus('Variant saved. Use "Export PNG" for rendered sprite.');
    return;
  }

  if (!state.projectPath) {
    ui.setStatus('Save your project first before publishing');
    return;
  }

  const { unitId, partType, variant } = state.projectPath;

  // Validate all path components
  if (!unitId || !partType || !variant) {
    ui.setStatus('Invalid project path - save project first');
    return;
  }

  // Render a clean canvas (no checkerboard, no UI, no gizmos)
  const cleanCanvas = renderCleanFrame();
  const cleanCtx = cleanCanvas.getContext('2d');
  const fullImageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
  const bounds = getNonTransparentBounds(fullImageData);

  let imageData;
  if (bounds) {
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = bounds.width;
    croppedCanvas.height = bounds.height;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(cleanCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    imageData = croppedCanvas.toDataURL('image/png');
  } else {
    imageData = cleanCanvas.toDataURL('image/png');
  }

  try {
    ui.setStatus('Publishing...');

    const result = await api.publishProject(unitId, partType, variant, {
      imageData,
      animations: {}, // TODO: Add animation frames
      metadata: {
        name: variant,
        dimensions: bounds ? { width: bounds.width, height: bounds.height } : { width: state.canvasWidth, height: state.canvasHeight },
        // Include snap points and category in published metadata
        snapPoints: state.snapPoints || [],
        partCategory: state.partCategory || null
      }
    });

    ui.setStatus(`Published to ${result.path}`);
    debug.log(`Published: ${result.path}`);

    // Reload available parts to show the new one
    await loadAvailableParts();

  } catch (err) {
    ui.setStatus(`Publish failed: ${err.message}`);
    debug.error(`Publish failed: ${err.message}`);
  }
}

// Legacy save function - now redirects to Save As Part flow
async function saveCurrentPart() {
  // This is the old "Save as Part" flow - now just calls the save modal
  await handleSaveAsPart();
}

async function savePartThumbnail() {
  if (!state.currentPartId) return;

  // Render a clean canvas (no checkerboard, no UI, no gizmos)
  const cleanCanvas = renderCleanFrame();
  const cleanCtx = cleanCanvas.getContext('2d');

  // Get image data to find non-transparent bounds
  const fullImageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
  const bounds = getNonTransparentBounds(fullImageData);

  let imageData;
  if (bounds) {
    // Crop to non-transparent content
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = bounds.width;
    croppedCanvas.height = bounds.height;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(cleanCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    imageData = croppedCanvas.toDataURL('image/png');
    debug.log(`Thumbnail cropped to ${bounds.width}x${bounds.height}`);
  } else {
    // No content, save empty or skip
    imageData = cleanCanvas.toDataURL('image/png');
  }

  try {
    await api.uploadPartImage(state.currentPartId, imageData);
    debug.log('Thumbnail saved');
  } catch (err) {
    debug.error(`Thumbnail save failed: ${err.message}`);
  }
}

// Find bounding box of non-transparent pixels
function getNonTransparentBounds(imageData) {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        hasContent = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hasContent) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

async function saveCurrentVariant() {
  if (!state.selectedObjectId) {
    ui.setStatus('No object selected');
    return;
  }

  const variantName = state.selectedVariantName || 'Untitled';
  const author = 'Artist'; // TODO: Get from user settings

  // Prepare parts data
  const parts = state.partsInVariant.map(p => ({
    partId: p.partId,
    image: p.image,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    scale: p.scale,
    opacity: p.opacity,
    zIndex: p.zIndex,
    // Multi-trigger animations (new format)
    animations: p.animations || { idle: null, move: null, aim: null, fire: null, hit: null },
    // Hierarchy
    parentIndex: p.parentIndex,
    attachedTo: p.attachedTo,
    inheritRotation: p.inheritRotation,
    inheritScale: p.inheritScale,
    // Snap points
    category: p.category,
    snapPoints: p.snapPoints
  }));

  try {
    ui.setStatus('Saving variant...');

    if (state.currentVariantId) {
      // Update existing variant
      const result = await api.updateVariant(state.currentVariantId, {
        author,
        note: 'Updated',
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        parts
      });
      ui.setStatus(`Variant saved (v${result.version})`);
      debug.log(`Variant saved: ${state.currentVariantId} v${result.version}`);
    } else {
      // Create new variant
      const result = await api.createVariant({
        objectType: 'units',
        objectId: state.selectedObjectId,
        name: variantName,
        author,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        parts
      });
      state.currentVariantId = result.id;
      ui.setStatus(`Variant created: ${result.id}`);
      debug.log(`Variant created: ${result.id}`);
    }
  } catch (err) {
    ui.setStatus(`Save failed: ${err.message}`);
    debug.error(`Save failed: ${err.message}`);
  }
}

// Load variants list for current unit and populate dropdown
async function loadVariantsForUnit() {
  const selector = document.getElementById('variantSelector');
  if (!selector || !state.selectedObjectId) return;

  // Clear existing options except the first
  selector.innerHTML = '<option value="">-- New Variant --</option>';

  try {
    const result = await api.listVariants('units', state.selectedObjectId);
    const variants = result?.variants || result || [];
    if (variants && variants.length > 0) {
      variants.forEach(v => {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = v.name || v.id;
        selector.appendChild(option);
      });
    }
  } catch (err) {
    console.log('[sprite-editor] No variants found for unit:', err.message);
  }
}

// Load selected variant into editor
async function loadSelectedVariant() {
  const selector = document.getElementById('variantSelector');
  const variantId = selector?.value;

  if (!variantId) {
    // New variant - clear current
    initVariantBuilder();
    state.currentVariantId = null;
    state.selectedVariantName = 'Untitled';
    document.getElementById('variantName').value = 'Untitled';
    renderPartsInVariant();
    render();
    ui.setStatus('New variant started');
    return;
  }

  try {
    ui.setStatus('Loading variant...');
    console.log('[sprite-editor] Loading variant:', variantId);
    const result = await api.getVariant(variantId);
    console.log('[sprite-editor] Variant response:', result);

    if (!result) {
      ui.setStatus('Failed to load variant - no response');
      return;
    }

    // Handle different response formats
    const variantData = result.data || result;
    const manifest = result.manifest || {};

    if (!variantData || typeof variantData !== 'object') {
      ui.setStatus('Failed to load variant - invalid data');
      console.error('[sprite-editor] Invalid variant data:', result);
      return;
    }

    // Clear current parts
    initVariantBuilder();

    // Load variant metadata
    state.currentVariantId = variantId;
    state.selectedVariantName = manifest.name || variantData.name || 'Untitled';
    state.canvasWidth = variantData.canvasWidth || 256;
    state.canvasHeight = variantData.canvasHeight || 256;

    // Update name input
    document.getElementById('variantName').value = state.selectedVariantName;

    // Load parts
    const parts = variantData.parts || [];
    for (const partData of parts) {
      // Create part in variant with all saved properties
      const partInVariant = {
        partId: partData.partId,
        name: partData.partId,  // Use partId as name for now
        image: partData.image,
        x: partData.x ?? 128,
        y: partData.y ?? 128,
        rotation: partData.rotation ?? 0,
        scale: partData.scale ?? 1,
        opacity: partData.opacity ?? 100,
        visible: true,
        zIndex: partData.zIndex ?? state.partsInVariant.length,
        animations: partData.animations || { idle: null, move: null, aim: null, fire: null, hit: null },
        pivotX: partData.pivotX ?? null,
        pivotY: partData.pivotY ?? null,
        category: partData.category || null,
        snapPoints: partData.snapPoints || [],
        parentIndex: partData.parentIndex ?? null,
        attachedTo: partData.attachedTo ?? null,
        inheritRotation: partData.inheritRotation ?? true,
        inheritScale: partData.inheritScale ?? false
      };

      state.partsInVariant.push(partInVariant);

      // Preload the image
      if (partData.image) {
        loadImage(partData.image);
      }
    }

    renderPartsInVariant();
    render();
    ui.setStatus(`Loaded variant: ${state.selectedVariantName}`);
  } catch (err) {
    const errMsg = err?.message || err?.error || JSON.stringify(err) || 'Unknown error';
    ui.setStatus(`Failed to load variant: ${errMsg}`);
    console.error('[sprite-editor] Load variant error:', err);
    console.error('[sprite-editor] Error stack:', err?.stack);
  }
}

// Save variant with name from input
async function handleSaveVariant() {
  const nameInput = document.getElementById('variantName');
  state.selectedVariantName = nameInput?.value || 'Untitled';
  await saveCurrentVariant();
  // Refresh the variants list
  await loadVariantsForUnit();
}

async function handleExportPng() {
  const canvas = document.getElementById('canvas');
  const link = document.createElement('a');
  link.download = `${state.selectedObjectId || 'sprite'}-${state.selectedPartType || 'export'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  ui.setStatus('PNG exported');
}

async function handleExportSpritesheet() {
  if (state.frames.length <= 1) {
    ui.setStatus('Need multiple frames for spritesheet');
    return;
  }

  const sheet = generateSpritesheet();
  if (!sheet) {
    ui.setStatus('Failed to generate spritesheet');
    return;
  }

  const link = document.createElement('a');
  link.download = `${state.selectedObjectId || 'sprite'}-${state.selectedPartType || 'export'}-spritesheet.png`;
  link.href = sheet.dataUrl;
  link.click();
  ui.setStatus(`Spritesheet exported: ${sheet.frameCount} frames (${sheet.width}x${sheet.height})`);
}

// Rescan sprites directory on server
async function handleRescanSprites() {
  try {
    ui.setStatus('Rescanning sprites...');
    const response = await fetch('/api/sprites/rescan');
    const result = await response.json();

    if (result.success) {
      ui.setStatus(`Rescan complete: ${result.units} units found`);
      // Reload the manifest
      await loadManifest();
      // Refresh the parts library if we're in editor mode
      if (state.selectedMode) {
        await loadAvailableParts();
      }
    } else {
      ui.setStatus(`Rescan failed: ${result.error}`);
    }
  } catch (err) {
    ui.setStatus(`Rescan failed: ${err.message}`);
  }
}

// Export selection as PNG
async function handleExportSelectionPng() {
  if (!selection.hasSelection()) {
    ui.setStatus('No selection to export');
    return;
  }

  const selectionData = selection.getSelectedImageData();
  if (!selectionData) {
    ui.setStatus('Could not get selection data');
    return;
  }

  const { imageData, bounds } = selectionData;

  // Create a temporary canvas with the selection
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bounds.width;
  tempCanvas.height = bounds.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  // Generate filename based on current object/part
  const objectId = state.selectedObjectId || 'sprite';
  const partType = state.selectedPartType || 'selection';
  const defaultFilename = `${objectId}-${partType}-selection.png`;

  // Try to use File System Access API for better UX (shows save dialog with directory)
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{
          description: 'PNG Image',
          accept: { 'image/png': ['.png'] }
        }]
      });
      const writable = await handle.createWritable();
      const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
      await writable.write(blob);
      await writable.close();
      ui.setStatus(`Selection saved (${bounds.width}x${bounds.height})`);
      return;
    } catch (err) {
      // User cancelled or API not supported, fall back to download
      if (err.name === 'AbortError') {
        ui.setStatus('Export cancelled');
        return;
      }
    }
  }

  // Fallback: standard download
  const link = document.createElement('a');
  link.download = defaultFilename;
  link.href = tempCanvas.toDataURL('image/png');
  link.click();
  ui.setStatus(`Selection exported (${bounds.width}x${bounds.height})`);
}

// Pending save data for confirmation modal
let pendingSaveData = null;
let pendingImageDataUrl = null;

// Save selection as a new part to server
async function handleSelectionAsPart() {
  if (!selection.hasSelection()) {
    ui.setStatus('No selection to save as part');
    return;
  }

  if (!state.selectedObjectId || !state.selectedPartType) {
    ui.setStatus('No object/part type selected');
    return;
  }

  const selectionData = selection.getSelectedImageData();
  if (!selectionData) {
    ui.setStatus('Could not get selection data');
    return;
  }

  const { imageData, bounds } = selectionData;

  // Create a temporary canvas to get data URL
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bounds.width;
  tempCanvas.height = bounds.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);
  pendingImageDataUrl = tempCanvas.toDataURL('image/png');

  // Generate suggested name: {unit}-{partType}-{variant}
  const unitId = state.selectedObjectId || 'unit';
  const partType = state.selectedPartType || 'part';
  const existingCount = state.parts ? state.parts.filter(p => p.partType === partType).length : 0;

  // Suggest variant names based on count
  const variantSuggestions = ['default', 'alt', 'desert', 'winter', 'jungle', 'urban', 'worn', 'custom'];
  const suggestedVariant = existingCount < variantSuggestions.length ? variantSuggestions[existingCount] : `v${existingCount + 1}`;
  const defaultName = `${unitId}-${partType}-${suggestedVariant}`;

  // Show themed name input modal
  showPartNameModal(defaultName);
}

// Show the part name input modal
function showPartNameModal(defaultName) {
  const overlay = document.getElementById('partNameOverlay');
  const input = document.getElementById('partNameInput');
  const checkbox = document.getElementById('setAsDefaultCheck');

  input.value = defaultName;
  checkbox.checked = defaultName.includes('default');
  overlay.classList.remove('hidden');
  input.focus();
  input.select();

  // Handle Enter key
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmPartName();
    } else if (e.key === 'Escape') {
      cancelPartName();
    }
  };
}

// Cancel part name input
function cancelPartName() {
  document.getElementById('partNameOverlay').classList.add('hidden');
  pendingImageDataUrl = null;
  ui.setStatus('Save cancelled');
}

// Confirm part name and proceed with save
async function confirmPartName() {
  const input = document.getElementById('partNameInput');
  const checkbox = document.getElementById('setAsDefaultCheck');
  let partName = input.value.trim();

  if (!partName) {
    input.style.borderColor = 'var(--error)';
    return;
  }

  // If "set as default" checked and name doesn't include "default", add it
  if (checkbox.checked && !partName.toLowerCase().includes('default')) {
    partName = partName + '-default';
  }

  document.getElementById('partNameOverlay').classList.add('hidden');

  // Store save data for potential overwrite confirmation
  pendingSaveData = {
    unitId: state.selectedObjectId,
    partType: state.selectedPartType,
    name: partName,
    author: state.artistName || 'Artist',
    imageData: pendingImageDataUrl,
    setAsDefault: checkbox.checked
  };

  await savePartWithConfirmation(false);
}

// Attempt to save part, showing confirmation if file exists
async function savePartWithConfirmation(overwrite) {
  if (!pendingSaveData) return;

  try {
    ui.setStatus('Saving as part...');
    const response = await fetch('/api/parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pendingSaveData, overwrite })
    });

    const result = await response.json();

    if (response.status === 409 && result.exists) {
      // File exists - show confirmation modal
      showSaveConfirmModal(result.previewUrl, pendingSaveData.imageData);
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || 'Save failed');
    }

    ui.setStatus(`Part saved: ${result.id}`);
    pendingSaveData = null;
    await loadAvailableParts();
  } catch (err) {
    ui.setStatus(`Save failed: ${err.message}`);
  }
}

// Enhanced comparison modal state
let compareZoomLevel = 4;

// Show the save confirmation modal with image preview
function showSaveConfirmModal(existingUrl, newDataUrl) {
  const overlay = document.getElementById('saveConfirmOverlay');
  const existingImg = document.getElementById('existingImage');
  const newImg = document.getElementById('newImage');
  const existingViewport = document.getElementById('existingViewport');
  const newViewport = document.getElementById('newViewport');

  // Add cache-busting to existing image URL
  existingImg.src = existingUrl + '?t=' + Date.now();
  newImg.src = newDataUrl;

  // Wait for both images to load before setting up zoom
  Promise.all([
    new Promise(resolve => { existingImg.onload = resolve; }),
    new Promise(resolve => { newImg.onload = resolve; })
  ]).then(() => {
    // Display dimensions
    document.getElementById('existingDimensions').textContent =
      `${existingImg.naturalWidth} × ${existingImg.naturalHeight}px`;
    document.getElementById('newDimensions').textContent =
      `${newImg.naturalWidth} × ${newImg.naturalHeight}px`;

    // Reset zoom to 4x (400%)
    compareZoomLevel = 4;
    updateCompareZoom(compareZoomLevel);

    // Setup synchronized scrolling
    setupCompareScrollSync(existingViewport, newViewport);
  });

  overlay.classList.remove('hidden');
}

// Update zoom level for comparison images (use width/height, not transform)
function updateCompareZoom(value) {
  compareZoomLevel = parseFloat(value);
  const existingImg = document.getElementById('existingImage');
  const newImg = document.getElementById('newImage');
  const label = document.getElementById('compareZoomLabel');
  const slider = document.getElementById('compareZoom');

  // Update slider if called programmatically
  if (slider) slider.value = compareZoomLevel;

  // Calculate pixel dimensions at this zoom level
  if (existingImg && existingImg.naturalWidth) {
    existingImg.style.width = `${existingImg.naturalWidth * compareZoomLevel}px`;
    existingImg.style.height = `${existingImg.naturalHeight * compareZoomLevel}px`;
  }
  if (newImg && newImg.naturalWidth) {
    newImg.style.width = `${newImg.naturalWidth * compareZoomLevel}px`;
    newImg.style.height = `${newImg.naturalHeight * compareZoomLevel}px`;
  }

  // Update label
  if (label) label.textContent = `${Math.round(compareZoomLevel * 100)}%`;
}

// Zoom controls
function zoomCompareIn() {
  compareZoomLevel = Math.min(20, compareZoomLevel + 0.5);
  updateCompareZoom(compareZoomLevel);
}

function zoomCompareOut() {
  compareZoomLevel = Math.max(0.5, compareZoomLevel - 0.5);
  updateCompareZoom(compareZoomLevel);
}

function fitCompareZoom() {
  const viewport = document.getElementById('existingViewport');
  const img = document.getElementById('existingImage');
  if (!viewport || !img || !img.naturalWidth) return;

  // Calculate zoom to fit viewport with padding
  const scaleX = (viewport.clientWidth - 20) / img.naturalWidth;
  const scaleY = (viewport.clientHeight - 20) / img.naturalHeight;
  compareZoomLevel = Math.max(0.5, Math.min(scaleX, scaleY));

  updateCompareZoom(compareZoomLevel);
}

function resetCompareZoom() {
  compareZoomLevel = 1;
  updateCompareZoom(compareZoomLevel);
}

// Synchronized scrolling between comparison viewports
function setupCompareScrollSync(viewport1, viewport2) {
  let isSyncing = false;

  const syncScroll = (source, target) => {
    if (isSyncing) return;
    isSyncing = true;

    // Calculate scroll percentage
    const maxScrollLeft = source.scrollWidth - source.clientWidth;
    const maxScrollTop = source.scrollHeight - source.clientHeight;

    if (maxScrollLeft > 0) {
      const scrollLeftPercent = source.scrollLeft / maxScrollLeft;
      target.scrollLeft = scrollLeftPercent * (target.scrollWidth - target.clientWidth);
    }
    if (maxScrollTop > 0) {
      const scrollTopPercent = source.scrollTop / maxScrollTop;
      target.scrollTop = scrollTopPercent * (target.scrollHeight - target.clientHeight);
    }

    isSyncing = false;
  };

  // Remove old listeners by cloning nodes
  const newViewport1 = viewport1.cloneNode(true);
  const newViewport2 = viewport2.cloneNode(true);
  viewport1.parentNode.replaceChild(newViewport1, viewport1);
  viewport2.parentNode.replaceChild(newViewport2, viewport2);

  newViewport1.addEventListener('scroll', () => syncScroll(newViewport1, newViewport2));
  newViewport2.addEventListener('scroll', () => syncScroll(newViewport2, newViewport1));
}

// Cancel save confirmation
function cancelSaveConfirm() {
  document.getElementById('saveConfirmOverlay').classList.add('hidden');
  pendingSaveData = null;
  ui.setStatus('Save cancelled');
}

// Confirm overwrite
async function confirmSaveOverwrite() {
  document.getElementById('saveConfirmOverlay').classList.add('hidden');
  await savePartWithConfirmation(true);
}

// Add selection as new layer
function handleSelectionToLayer() {
  if (!selection.hasSelection()) {
    ui.setStatus('No selection to create layer from');
    return;
  }

  const selectionData = selection.getSelectedImageData();
  if (!selectionData) {
    ui.setStatus('Could not get selection data');
    return;
  }

  const { imageData, bounds } = selectionData;

  // Create a temporary canvas to get data URL
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bounds.width;
  tempCanvas.height = bounds.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);
  const dataUrl = tempCanvas.toDataURL('image/png');

  const imageShape = {
    type: 'image',
    imageData: dataUrl,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    opacity: 100
  };

  saveHistory(); // Save BEFORE adding layer

  // Create a NEW layer with the selection
  const newLayer = {
    id: `layer-${Date.now()}`,
    name: `Selection ${state.layers.length + 1}`,
    visible: true,
    locked: false,
    opacity: 100,
    shapes: [imageShape]
  };

  state.layers.push(newLayer);
  state.selectedLayerId = newLayer.id;
  renderLayers();
  render();
  ui.setStatus(`Selection added as new layer: ${newLayer.name}`);
}

// ========== TARGET COLORS FOR LASSO ==========

// Re-run lasso selection with current settings (for realtime updates)
function rerunLassoSelection() {
  if (!state.lastLassoPoints || state.lastLassoPoints.length < 3) return;

  const targetColors = state.targetColors || [];

  // Pass raw lasso points - selection.js handles pixel boundary testing
  selection.lassoSelect(state.lastLassoPoints, {
    addToSelection: false,
    subtractFromSelection: false,
    targetColors: targetColors,
    tolerance: state.lassoTolerance || 10,
    expandColors: state.lassoExpandColors !== false
  });

  render();
}

// Render the target colors list UI
function renderTargetColorsList() {
  const container = document.getElementById('targetColorsList');
  if (!container) return;

  const colors = state.targetColors || [];

  if (colors.length === 0) {
    container.innerHTML = `
      <div class="no-colors-hint" style="color: var(--text-muted); font-size: 0.85rem; padding: 8px 0;">
        No target colors. Click "Add Color" or draw with lasso to auto-sample.
      </div>
    `;
    return;
  }

  container.innerHTML = colors.map((item, index) => `
    <div class="target-color-item" data-index="${index}">
      <input type="color" class="target-color-swatch" value="${item.color}"
             onchange="spriteEditor.updateTargetColor(${index}, this.value)">
      <span class="target-color-hex">${item.color}</span>
      <div class="target-color-tolerance">
        <input type="range" min="0" max="255" value="${item.tolerance}"
               onchange="spriteEditor.updateTargetTolerance(${index}, this.value)"
               oninput="this.nextElementSibling.textContent = this.value">
        <span>${item.tolerance}</span>
      </div>
      <button class="target-color-remove" onclick="spriteEditor.removeTargetColor(${index})">✕</button>
    </div>
  `).join('');
}

// Add target color (using eyedropper mode)
function handleAddTargetColor() {
  // Switch to eyedropper mode temporarily
  const prevTool = state.tool;

  // Set a flag to return to lasso after picking
  state._returnToLassoAfterPick = true;
  state._pickingForTargetColor = true;
  state.tool = 'eyedropper';
  ui.setActiveTool('eyedropper');

  ui.setStatus('Click on canvas to pick a color');
}

// Clear all target colors
function handleClearTargetColors() {
  selection.clearTargetColors();
  renderTargetColorsList();
  rerunLassoSelection();
  ui.setStatus('Target colors cleared');
}

// Update a target color
function handleUpdateTargetColor(index, color) {
  if (state.targetColors[index]) {
    state.targetColors[index].color = color;
    renderTargetColorsList();
    rerunLassoSelection();
  }
}

// Update a target color tolerance
function handleUpdateTargetTolerance(index, tolerance) {
  selection.updateTargetColorTolerance(index, parseInt(tolerance));
  rerunLassoSelection();
}

// Remove a target color
function handleRemoveTargetColor(index) {
  selection.removeTargetColor(index);
  renderTargetColorsList();
  rerunLassoSelection();
}

// ===== Snap Point Attachment Panel =====
let selectedSnapPointInfo = null;  // Current snap point for attachment panel

function showSnapAttachPanel(info) {
  selectedSnapPointInfo = info;
  const panel = document.getElementById('snapAttachPanel');
  const title = document.getElementById('snapAttachTitle');
  const infoEl = document.getElementById('snapAttachInfo');
  const list = document.getElementById('snapAttachList');
  const empty = document.getElementById('snapAttachEmpty');
  const occupied = document.getElementById('snapAttachOccupied');

  if (!panel) return;

  // Update title and info
  title.textContent = `Attach to: ${info.snapPoint.name}`;
  infoEl.textContent = `On "${info.partName}" • Type: ${info.snapPoint.type}`;

  // Find unattached compatible parts already in the variant
  const unattachedInVariant = state.partsInVariant
    .map((p, idx) => ({ ...p, variantIndex: idx }))
    .filter(p =>
      p.parentIndex === null &&  // Not attached to anything
      p.variantIndex !== info.partIndex &&  // Not the part we're attaching to
      p.category && canAttachTo(p.category, info.snapPoint.type)
    );

  // Find compatible parts from library (for adding new)
  const compatibleFromLibrary = state.parts.filter(p =>
    p.category && canAttachTo(p.category, info.snapPoint.type)
  );

  let html = '';

  // Section: Existing parts in variant
  if (unattachedInVariant.length > 0) {
    html += '<div class="snap-attach-section-title">In Variant (unattached)</div>';
    html += unattachedInVariant.map(p => `
      <div class="snap-attach-item" onclick="spriteEditor.attachExistingPart(${p.variantIndex})">
        <span class="snap-attach-name">${p.name}</span>
        <span class="snap-attach-type">${p.partType}</span>
      </div>
    `).join('');
  }

  // Section: Add from library
  if (compatibleFromLibrary.length > 0) {
    html += '<div class="snap-attach-section-title">Add from Library</div>';
    html += compatibleFromLibrary.map(p => `
      <div class="snap-attach-item snap-attach-library" onclick="spriteEditor.attachPartToSnapPoint('${p.id}')">
        <span class="snap-attach-name">${p.name}</span>
        <span class="snap-attach-type">+ new</span>
      </div>
    `).join('');
  }

  // Render list
  if (html === '') {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = html;
  }

  // Show detach button if occupied
  if (info.isOccupied) {
    occupied.classList.remove('hidden');
  } else {
    occupied.classList.add('hidden');
  }

  panel.classList.remove('hidden');
}

function closeSnapAttachPanel() {
  const panel = document.getElementById('snapAttachPanel');
  if (panel) panel.classList.add('hidden');
  selectedSnapPointInfo = null;
}

async function attachPartToSnapPoint(partId) {
  if (!selectedSnapPointInfo) return;

  const partData = state.parts.find(p => p.id === partId);
  if (!partData) return;

  // Preload image
  if (partData.thumbnail) {
    try {
      await loadImage(partData.thumbnail);
    } catch (e) {
      console.warn('Could not load part image:', partData.thumbnail);
    }
  }

  // Add part to variant
  addPartToVariant(partData);
  const newPartIndex = state.partsInVariant.length - 1;

  // Attach to the snap point
  snapPoints.attachPartToSnapPoint(
    newPartIndex,
    selectedSnapPointInfo.partIndex,
    selectedSnapPointInfo.snapId
  );

  ui.setStatus(`Attached ${partData.name} to ${selectedSnapPointInfo.snapPoint.name}`);
  renderPartsInVariant();
  updatePartProperties();
  saveHistory();
  render();
  snapOverlay.renderSnapPointOverlay();
  closeSnapAttachPanel();
}

// Attach an existing part from the variant (doesn't create a new one)
function attachExistingPart(partIndex) {
  if (!selectedSnapPointInfo) return;

  const part = state.partsInVariant[partIndex];
  if (!part) return;

  // Attach to the snap point
  snapPoints.attachPartToSnapPoint(
    partIndex,
    selectedSnapPointInfo.partIndex,
    selectedSnapPointInfo.snapId
  );

  ui.setStatus(`Attached ${part.name} to ${selectedSnapPointInfo.snapPoint.name}`);
  renderPartsInVariant();
  updatePartProperties();
  saveHistory();
  render();
  snapOverlay.renderSnapPointOverlay();
  closeSnapAttachPanel();
}

function detachFromSnapPoint() {
  if (!selectedSnapPointInfo) return;

  // Find the part attached to this snap point
  const attachedPart = state.partsInVariant.find(p =>
    p.parentIndex === selectedSnapPointInfo.partIndex &&
    p.attachedTo === selectedSnapPointInfo.snapId
  );

  if (attachedPart) {
    const attachedIndex = state.partsInVariant.indexOf(attachedPart);
    snapPoints.detachPart(attachedIndex);
    ui.setStatus('Part detached');
    renderPartsInVariant();
    updatePartProperties();
    saveHistory();
    render();
    snapOverlay.renderSnapPointOverlay();
  }

  closeSnapAttachPanel();
}

// Handle recoil direction mode change - show/hide fixed angle input
function onRecoilDirModeChange() {
  const dirMode = document.getElementById('animParamDirMode')?.value;
  const fixedRow = document.getElementById('fixedDirectionRow');
  if (fixedRow) {
    fixedRow.style.display = (dirMode === 'fixed') ? '' : 'none';
  }
}

// Handle recoil angle scale checkbox change - show/hide min/max multipliers
function onRecoilAngleScaleChange() {
  const angleScale = document.getElementById('animParamAngleScale')?.checked;
  const angleScaleParams = document.getElementById('angleScaleParams');
  if (angleScaleParams) {
    angleScaleParams.style.display = angleScale ? '' : 'none';
  }
}

// Expose public API for HTML onclick handlers
window.spriteEditor = {
  authenticate: handleAuthenticate,
  selectObject,
  selectMode,
  confirmModeSelection,
  cancelModeSelection,
  changeObject,
  // Layers
  addLayer: handleAddLayer,
  moveLayerUp: handleMoveLayerUp,
  moveLayerDown: handleMoveLayerDown,
  duplicateLayer: handleDuplicateLayer,
  deleteLayer: handleDeleteLayer,
  // Frames
  addFrame: handleAddFrame,
  prevFrame: handlePrevFrame,
  nextFrame: handleNextFrame,
  togglePlayback: handleTogglePlayback,
  // Variants
  movePartUp: handleMovePartUp,
  movePartDown: handleMovePartDown,
  removePart: handleRemovePart,
  loadSelectedVariant,
  saveVariant: handleSaveVariant,
  // Snap Point Attachment Panel
  closeSnapAttachPanel,
  attachPartToSnapPoint,
  attachExistingPart,
  detachFromSnapPoint,
  // Canvas
  zoomIn: handleZoomIn,
  zoomOut: handleZoomOut,
  resetZoom: handleResetZoom,
  resetPan,
  toggleGrid: handleToggleGrid,
  toggleRef: handleToggleRef,
  refMouseDown: handleRefMouseDown,
  refMouseUp: handleRefMouseUp,
  refContextMenu: handleRefContextMenu,
  toggleOnion: handleToggleOnion,
  toggleContextParts: handleToggleContextParts,
  toggleAllContext: handleToggleAllContext,
  toggleAllLayers: handleToggleAllLayers,
  toggleAllParts: handleToggleAllParts,
  selectContextVariant: handleSelectContextVariant,
  importRefImage: handleImportRefImage,
  handleRefImageSelect: handleRefImageSelect,
  clearRefImage: handleClearRefImage,
  importImageToLayer: handleImportImageToLayer,
  handleLayerImageSelect: handleLayerImageSelect,
  resetRefTransform: handleResetRefTransform,
  // History
  undo: handleUndo,
  redo: handleRedo,
  // Library
  refreshLibrary: loadAvailableParts,
  filterParts: () => { /* TODO */ },
  playPreview: handlePlayPreview,
  resetPreview: handleResetPreview,
  previewCurrentTrigger: handlePreviewCurrentTrigger,
  setPreviewAimAngle,
  setLoopAnimation,
  setLoopDuration,
  onRecoilDirModeChange,
  onRecoilAngleScaleChange,
  // Parent hierarchy
  setPartParent,
  // Pivot helpers
  setPivotToCenter,
  clearPivot,
  // Snap points
  startSnapPointPlacement,
  selectSnapPoint,
  deleteSelectedSnapPoint,
  getPanOffset: () => ({ x: panOffsetX, y: panOffsetY }),
  // Measure tool
  addMeasureGuide,
  clearMeasure,
  clearAllGuides,
  // Rotation preview
  toggleRotationPreview,
  resetRotationPreview,
  // File menu
  newFile: () => { resetEditorState(); renderLayers(); render(); ui.setStatus('New file'); },
  save: handleSave,
  saveAs: promptSaveAs,
  openProject: handleOpenProject,
  publish: handlePublish,
  exportPng: handleExportPng,
  exportSpritesheet: handleExportSpritesheet,
  rescanSprites: handleRescanSprites,
  // Autosave/Recovery
  recoverAutosave,
  discardAutosave,
  // Edit menu
  cut: () => { console.log('Cut - TODO'); },
  copy: () => { console.log('Copy - TODO'); },
  paste: () => { console.log('Paste - TODO'); },
  deleteSelection: () => {
    if (selection.hasSelection()) {
      selection.clearSelection();
      state.lastLassoPoints = null; // Clear stored lasso path
      render();
      ui.setStatus('Selection cleared');
    }
  },
  selectAll: () => {
    selection.selectAll();
    render();
    ui.setStatus('All selected');
  },
  clearSelection: () => {
    selection.clearSelection();
    state.lastLassoPoints = null; // Clear stored lasso path
    render();
  },
  invertSelection: () => {
    selection.invertSelection();
    render();
    ui.setStatus('Selection inverted');
  },
  setTolerance: (value) => {
    selection.setTolerance(value);
    ui.setStatus(`Tolerance: ${value}`);
  },
  getTolerance: () => selection.getTolerance(),
  // Target colors for lasso
  addTargetColor: handleAddTargetColor,
  clearTargetColors: handleClearTargetColors,
  updateTargetColor: handleUpdateTargetColor,
  updateTargetTolerance: handleUpdateTargetTolerance,
  removeTargetColor: handleRemoveTargetColor,
  // Shape transforms
  deleteSelectedShape: () => {
    if (deleteSelectedShape()) {
      updateShapePropertiesPanel();
      ui.setStatus('Shape deleted');
    }
  },
  centerShape,
  fitShapeToCanvas,
  resetShapeTransform,
  adjustShapeOpacity,
  adjustShapeScaleX,
  adjustShapeScaleY,
  adjustShapeX,
  adjustShapeY,
  exportSelectionPng: handleExportSelectionPng,
  selectionToLayer: handleSelectionToLayer,
  selectionAsPart: handleSelectionAsPart,
  cancelSaveConfirm,
  confirmSaveOverwrite,
  cancelPartName,
  confirmPartName,
  updateCompareZoom,
  zoomCompareIn,
  zoomCompareOut,
  fitCompareZoom,
  resetCompareZoom,
  // Layer menu
  mergeDown: () => { console.log('Merge Down - TODO'); },
  flattenLayers: () => { console.log('Flatten - TODO'); },
  // Debug
  toggleDebug: handleToggleDebug,
  clearDebugLogs: handleClearDebugLogs,
  copyDebugLogs: handleCopyDebugLogs,
  // Settings
  setUIScale,
  // Canvas size
  setCanvasSize: handleSetCanvasSize,
  adjustCanvasSize: handleAdjustCanvasSize,
  // Clone stamp
  clearCloneSource: () => {
    cloneStamp.clearSource();
    render();
    ui.setStatus('Clone source cleared');
  }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
