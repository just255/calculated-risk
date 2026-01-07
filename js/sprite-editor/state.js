// sprite-editor/state.js - State management
// Single responsibility: Maintain and expose editor state

import { CANVAS_DEFAULTS } from './constants.js';

// Create initial state
export function createInitialState() {
  return {
    authenticated: false,
    artistName: '',

    // Object selection
    selectedObjectType: null,   // 'unit' or 'terrain'
    selectedObjectId: null,     // 'infantry', 'tank', 'grass', etc.
    selectedMode: null,         // 'part-editor' or 'variant-builder'
    selectedPartType: null,     // For part editor: 'helmet', 'body', etc.
    editingPartId: null,        // null = creating new, string = editing existing part
    editingPartImage: null,      // URL of the part being edited (for reference)

    // Data from server
    parts: [],      // Available parts for selected object
    variants: [],   // Available variants for selected object

    // Part Editor state
    layers: [],           // Drawing layers
    selectedLayerId: null,
    frames: [{ layers: [] }],
    currentFrame: 0,

    // Variant Builder state
    partsInVariant: [],   // Parts added to current variant
    selectedPartInVariant: null,

    // Snap Point System (Part Editor)
    snapPoints: [],              // Snap points for current part being edited
    selectedSnapPointId: null,   // Currently selected snap point
    snapPointTool: false,        // Is snap point placement tool active
    showSnapPoints: true,        // Show snap points on canvas
    partCategory: null,          // Category of part being edited (turret, cannon, etc.)
    hoveredSnapPoint: null,      // Snap point under cursor (for hover highlight)

    // Canvas
    canvasWidth: CANVAS_DEFAULTS.width,
    canvasHeight: CANVAS_DEFAULTS.height,
    zoom: 1,
    panX: 0,
    panY: 0,
    showGrid: true,
    showRef: false,
    showOnion: false,
    showContextParts: false,  // Show other default parts as ghost reference (default off)
    refImage: null,          // User-imported reference image (HTMLImageElement)
    refImageUrl: null,       // URL of reference image
    refOpacity: 40,          // Reference image opacity (0-100)
    refScale: 100,           // Reference image scale (percentage)
    refX: 0,                 // Reference image X offset
    refY: 0,                 // Reference image Y offset
    contextParts: [],        // Other default parts for context (ghost reference)
    contextVariants: [],     // Available variants for context selection
    selectedContextVariant: 'default', // Currently selected context variant

    // Tools (Part Editor)
    tool: 'select',
    strokeColor: '#4ade80',
    strokeWidth: 2,
    pixelPerfect: true,      // When true, disables anti-aliasing for crisp pixels
    fillEnabled: false,
    fillType: 'solid',
    fillColor1: '#22c55e',
    fillColor2: '#166534',
    gradientAngle: 0,

    // Target color palette for lasso selection
    targetColors: [],   // Array of { color: '#hex', tolerance: 32 }
    lassoTolerance: 10, // Default tolerance for color matching (0-100)
    lassoExpandColors: false, // Expand selection to all matching colors on canvas
    lastLassoPoints: null, // Store last lasso path for realtime re-selection

    // Blend brush settings
    blendHardness: 80,  // How aggressively to blend (0-100, 100 = full average)

    // Pixelate tool settings
    pixelateSize: 4,    // Grid cell size for pixelation (2-16)

    // Measure tool
    measurePoints: [],     // Array of { x, y } - current measurement points (max 2)
    measureGuides: [],     // Array of { p1: {x,y}, p2: {x,y} } - persistent guide lines

    // Rotation preview (Part Editor)
    rotationPreview: {
      enabled: false,      // Is rotation preview active
      angle: 0,            // Current rotation angle in degrees
      speed: 45,           // Degrees per second
      pivotType: 'center', // 'center' or snap point ID
      pivotX: 0,           // Pivot point X (relative to canvas center)
      pivotY: 0            // Pivot point Y (relative to canvas center)
    },

    // Variant builder overlay
    showScaleOverlay: false,  // Show unit dimension overlay
    scaleOverlayType: null,   // Which unit type to show (null = auto from selected object)

    // Reference image overlay (variant builder)
    referenceImage: null,       // { src, img, x, y, scale, opacity, visible }
    showReferenceImage: false,  // Toggle visibility

    // Selection visualization
    showSelectionFill: true,    // Show semi-transparent fill over selection
    showMarchingAnts: false,    // Show animated marching ants outline
    selectionMaskOpacity: 0.5,  // Opacity of mask over non-selected areas (0-1)

    // Drawing state
    isDrawing: false,
    drawStart: null,
    tempShape: null,

    // Cursor position (for stroke preview)
    cursorX: -1,
    cursorY: -1,

    // Shape selection (for transforms)
    selectedShapeIndex: null,  // Index of selected shape in current layer
    isDraggingShape: false,
    isResizingShape: false,    // Currently resizing a shape via handles
    resizeHandle: null,        // Which handle is being dragged (nw, n, ne, w, e, sw, s, se)
    dragStartX: 0,
    dragStartY: 0,
    dragOrigX: 0,
    dragOrigY: 0,
    dragOrigWidth: 0,
    dragOrigHeight: 0,

    // History
    history: [],
    historyIndex: -1,

    // Animation
    isPlaying: false,
    fps: 12,
    animationState: 'idle',

    // Save system
    projectPath: null,      // Current project path (unitId/partType/variant)
    isDirty: false,         // Has unsaved changes
    lastSavedAt: null,      // ISO timestamp of last manual save
    lastAutosavedAt: null,  // ISO timestamp of last autosave
    saveStatus: 'idle'      // 'idle', 'saving', 'saved', 'error'
  };
}

// Global state instance
export const state = createInitialState();

// Reset state for new editing session
export function resetEditorState() {
  state.layers = [];
  state.selectedLayerId = null;
  state.frames = [{ layers: [] }];
  state.currentFrame = 0;
  state.partsInVariant = [];
  state.selectedPartInVariant = null;
  state.history = [];
  state.historyIndex = -1;
  state.zoom = 1;
  state.showGrid = true;
  state.showRef = false;
  state.showOnion = false;
  state.showContextParts = false;
  state.refImage = null;
  state.refImageUrl = null;
  state.refOpacity = 40;
  state.refScale = 100;
  state.refX = 0;
  state.refY = 0;
  state.contextParts = [];
  state.contextVariants = [];
  state.selectedContextVariant = 'default';
  state.targetColors = [];
  state.lassoTolerance = 10;
  state.lassoExpandColors = false;
  state.lastLassoPoints = null;
  // Snap point system
  state.snapPoints = [];
  state.selectedSnapPointId = null;
  state.snapPointTool = false;
  state.partCategory = null;
  // Save system
  state.projectPath = null;
  state.isDirty = false;
  state.lastSavedAt = null;
  state.lastAutosavedAt = null;
  state.saveStatus = 'idle';
}

// Mark state as dirty (has unsaved changes)
export function markDirty() {
  state.isDirty = true;
}

// Mark state as clean (just saved)
export function markClean(timestamp = new Date().toISOString()) {
  state.isDirty = false;
  state.lastSavedAt = timestamp;
  state.saveStatus = 'saved';
}

// Set project path
export function setProjectPath(unitId, partType, variant) {
  state.projectPath = { unitId, partType, variant };
}

// Get localStorage key for autosave
export function getAutosaveKey() {
  if (!state.projectPath) return null;
  const { unitId, partType, variant } = state.projectPath;
  return `spriteEditor_autosave_${unitId}_${partType}_${variant}`;
}

// Reset object selection
export function resetObjectSelection() {
  state.selectedObjectType = null;
  state.selectedObjectId = null;
  state.selectedMode = null;
  state.selectedPartType = null;
  state.editingPartId = null;
  resetEditorState();
}
