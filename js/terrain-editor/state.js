// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - State Management
// Centralized state with event emission
// ═══════════════════════════════════════════════════════════════

import { EventEmitter, Events } from './events.js';
import { createTerrainMap, generateTreesForStroke, removeTreesForStroke, removeTreesInRadius } from '../world-builder/index.js';

/**
 * Default editor configuration
 */
const DEFAULT_CONFIG = {
  gridWidth: 24,
  gridHeight: 24,
  cellSize: 64,
  baseLayer: 'grass-1'
};

/**
 * Default tool options
 */
const DEFAULT_TOOL_OPTIONS = {
  brushRadius: 60,
  falloff: 'smooth',
  clearingMode: false,          // When true, brush removes trees instead of adding
  featureType: 'forest',
  treeType: 'oak',              // Legacy single type (fallback)
  treeTypes: ['oak'],           // Multi-select tree types (includes dead variants like 'oak-dead')
  treeRatios: { oak: 1.0 },     // Ratios for each selected type
  treeDensity: 5,
  treeScale: 0.35,              // Global scale multiplier for trees (0.03-0.6)
  selectedAges: ['young', 'transitional', 'old'],  // Which ages to include
  ageRatios: { young: 0.333, transitional: 0.333, old: 0.334 },  // Ratios for each selected age
  // Ground texture options
  autoGroundTexture: true,      // Auto-paint ground texture with features
  groundTextureType: 'grass-1', // Manual ground texture type when painting groundTexture (matches default base layer)
  fadeWidth: 12,                // Width of soft alpha fade at edges in pixels (0 = hard edge)
  floorExtend: 0,               // How much forest floor extends beyond tree brush (-24 to +24)
  floorFade: 16,                // Forest floor edge fade width

  // Water options
  waterTextureType: 'water',    // Water texture to paint
  waterFadeWidth: 12,           // Water edge fade width
  shoreTextureType: 'mud',      // Shore texture around water (or 'none')
  shoreWidth: 24,               // Width of shore ring around water
  treesInWater: false           // Allow trees to spawn in water areas
};

/**
 * Default view settings
 */
const DEFAULT_VIEW_SETTINGS = {
  showGrid: true,
  gridOpacity: 0.1,
  showBoundary: true
};

/**
 * Editor state management
 */
export class EditorState extends EventEmitter {
  constructor(config = {}) {
    super();

    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Terrain data
    this._terrainMap = createTerrainMap(
      cfg.gridWidth,
      cfg.gridHeight,
      cfg.cellSize,
      cfg.baseLayer
    );

    // Tool state
    this._activeTool = 'paint';
    this._toolOptions = { ...DEFAULT_TOOL_OPTIONS };

    // Selection state
    this._selection = [];

    // Viewport state
    this._viewport = {
      x: 0,
      y: 0,
      zoom: 1,
      minZoom: 0.25,
      maxZoom: 4
    };

    // Map metadata
    this._metadata = {
      name: 'Untitled Map',
      author: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    // View settings
    this._viewSettings = { ...DEFAULT_VIEW_SETTINGS };

    // Dirty flag (unsaved changes)
    this._dirty = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // TERRAIN MAP
  // ═══════════════════════════════════════════════════════════════

  get terrainMap() {
    return this._terrainMap;
  }

  get strokes() {
    return this._terrainMap.strokes;
  }

  get baseLayer() {
    return this._terrainMap.baseLayer;
  }

  set baseLayer(value) {
    this._terrainMap.baseLayer = value;
    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.BASE_LAYER_CHANGED, { baseLayer: value });
    this.emit(Events.RENDER_REQUESTED);
  }

  get gridWidth() {
    return this._terrainMap.gridWidth;
  }

  get gridHeight() {
    return this._terrainMap.gridHeight;
  }

  get cellSize() {
    return this._terrainMap.cellSize;
  }

  get canvasWidth() {
    return this._terrainMap.gridWidth * this._terrainMap.cellSize;
  }

  get canvasHeight() {
    return this._terrainMap.gridHeight * this._terrainMap.cellSize;
  }

  // ═══════════════════════════════════════════════════════════════
  // STROKES
  // ═══════════════════════════════════════════════════════════════

  addStroke(stroke, skipRender = false) {
    this._terrainMap.strokes.push(stroke);

    // Generate trees for forest strokes
    if (stroke.treeType) {
      generateTreesForStroke(this._terrainMap, stroke);
    }

    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKE_ADDED, { stroke });

    // Allow batching - skip render during drag painting
    if (!skipRender) {
      this.emit(Events.RENDER_REQUESTED);
    }
    return stroke;
  }

  /**
   * Request a render (used after batch operations)
   */
  requestRender() {
    this.emit(Events.RENDER_REQUESTED);
  }

  removeStroke(strokeId) {
    const index = this._terrainMap.strokes.findIndex(s => s.id === strokeId);
    if (index !== -1) {
      const stroke = this._terrainMap.strokes.splice(index, 1)[0];

      // Remove associated trees
      removeTreesForStroke(this._terrainMap, strokeId);

      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.STROKE_REMOVED, { stroke });
      this.emit(Events.RENDER_REQUESTED);
      return stroke;
    }
    return null;
  }

  removeStrokesAt(x, y, radius) {
    const removed = [];
    const radiusSq = radius * radius;

    this._terrainMap.strokes = this._terrainMap.strokes.filter(stroke => {
      const dx = stroke.x - x;
      const dy = stroke.y - y;
      const distSq = dx * dx + dy * dy;
      const combinedRadius = stroke.radius + radius;

      if (distSq < combinedRadius * combinedRadius) {
        removed.push(stroke);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      // Remove associated trees for all removed strokes
      removed.forEach(stroke => removeTreesForStroke(this._terrainMap, stroke.id));

      this._terrainMap.dirty = true;
      this._markDirty();
      removed.forEach(stroke => this.emit(Events.STROKE_REMOVED, { stroke }));
      this.emit(Events.RENDER_REQUESTED);
    }

    return removed;
  }

  clearStrokes() {
    this._terrainMap.strokes = [];
    this._terrainMap.trees = []; // Clear all trees too
    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKES_CLEARED);
    this.emit(Events.RENDER_REQUESTED);
  }

  clearTreesAt(x, y, radius, falloff = 'hard') {
    const removed = removeTreesInRadius(this._terrainMap, x, y, radius, falloff);
    if (removed > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed;
  }

  // ═══════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════

  get activeTool() {
    return this._activeTool;
  }

  set activeTool(toolName) {
    const previous = this._activeTool;
    this._activeTool = toolName;
    this.emit(Events.TOOL_CHANGED, { tool: toolName, previous });
  }

  get toolOptions() {
    return this._toolOptions;
  }

  setToolOption(key, value) {
    const previous = this._toolOptions[key];
    this._toolOptions[key] = value;
    this.emit(Events.TOOL_OPTIONS_CHANGED, { key, value, previous });
  }

  setToolOptions(options) {
    Object.entries(options).forEach(([key, value]) => {
      this._toolOptions[key] = value;
    });
    this.emit(Events.TOOL_OPTIONS_CHANGED, { options });
  }

  // ═══════════════════════════════════════════════════════════════
  // SELECTION
  // ═══════════════════════════════════════════════════════════════

  get selection() {
    return this._selection;
  }

  select(strokes) {
    this._selection = Array.isArray(strokes) ? strokes : [strokes];
    this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
    this.emit(Events.RENDER_REQUESTED);
  }

  addToSelection(stroke) {
    if (!this._selection.includes(stroke)) {
      this._selection.push(stroke);
      this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  removeFromSelection(stroke) {
    const index = this._selection.indexOf(stroke);
    if (index !== -1) {
      this._selection.splice(index, 1);
      this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  clearSelection() {
    if (this._selection.length > 0) {
      this._selection = [];
      this.emit(Events.SELECTION_CLEARED);
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  getStrokesAt(x, y) {
    return this._terrainMap.strokes.filter(stroke => {
      const dx = stroke.x - x;
      const dy = stroke.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= stroke.radius;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEWPORT
  // ═══════════════════════════════════════════════════════════════

  get viewport() {
    return this._viewport;
  }

  pan(dx, dy) {
    this._viewport.x += dx;
    this._viewport.y += dy;
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  setViewport(x, y, zoom) {
    this._viewport.x = x;
    this._viewport.y = y;
    if (zoom !== undefined) {
      this._viewport.zoom = Math.max(
        this._viewport.minZoom,
        Math.min(this._viewport.maxZoom, zoom)
      );
    }
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  zoom(delta, centerX, centerY) {
    const oldZoom = this._viewport.zoom;
    const newZoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, oldZoom * (1 + delta))
    );

    if (newZoom !== oldZoom) {
      // Zoom toward point
      const scale = newZoom / oldZoom;
      this._viewport.x = centerX - (centerX - this._viewport.x) * scale;
      this._viewport.y = centerY - (centerY - this._viewport.y) * scale;
      this._viewport.zoom = newZoom;

      this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  resetViewport() {
    this._viewport.x = 0;
    this._viewport.y = 0;
    this._viewport.zoom = 1;
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  // ═══════════════════════════════════════════════════════════════
  // METADATA & DIRTY STATE
  // ═══════════════════════════════════════════════════════════════

  get metadata() {
    return this._metadata;
  }

  setMetadata(data) {
    Object.assign(this._metadata, data);
    this._metadata.modified = new Date().toISOString();
  }

  get isDirty() {
    return this._dirty;
  }

  _markDirty() {
    this._dirty = true;
    this._metadata.modified = new Date().toISOString();
  }

  markClean() {
    this._dirty = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEW SETTINGS
  // ═══════════════════════════════════════════════════════════════

  get viewSettings() {
    return this._viewSettings;
  }

  setViewSetting(key, value) {
    this._viewSettings[key] = value;
    this.emit(Events.RENDER_REQUESTED);
  }

  // ═══════════════════════════════════════════════════════════════
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════

  toJSON() {
    return {
      version: 2,  // Bumped for tree registry support
      metadata: { ...this._metadata },
      baseLayer: this._terrainMap.baseLayer,
      gridWidth: this._terrainMap.gridWidth,
      gridHeight: this._terrainMap.gridHeight,
      cellSize: this._terrainMap.cellSize,
      strokes: this._terrainMap.strokes.map(s => ({ ...s })),
      trees: this._terrainMap.trees.map(t => ({ ...t }))  // Save tree registry
    };
  }

  loadFromJSON(data) {
    if (!data || (data.version !== 1 && data.version !== 2)) {
      throw new Error('Invalid map data format');
    }

    // Reset terrain map
    this._terrainMap = createTerrainMap(
      data.gridWidth || DEFAULT_CONFIG.gridWidth,
      data.gridHeight || DEFAULT_CONFIG.gridHeight,
      data.cellSize || DEFAULT_CONFIG.cellSize,
      data.baseLayer || DEFAULT_CONFIG.baseLayer
    );

    // Load strokes
    this._terrainMap.strokes = data.strokes || [];

    // Load or regenerate trees
    if (data.version === 2 && data.trees) {
      // Version 2: Load pre-calculated trees
      this._terrainMap.trees = data.trees;
    } else {
      // Version 1: Regenerate trees from strokes
      this._terrainMap.trees = [];
      for (const stroke of this._terrainMap.strokes) {
        if (stroke.treeType) {
          generateTreesForStroke(this._terrainMap, stroke);
        }
      }
    }

    this._terrainMap.dirty = true;

    // Load metadata
    this._metadata = { ...data.metadata };

    // Clear selection and mark clean
    this._selection = [];
    this._dirty = false;

    this.emit(Events.MAP_LOADED, { data });
    this.emit(Events.RENDER_REQUESTED);
  }

  newMap(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    this._terrainMap = createTerrainMap(
      cfg.gridWidth,
      cfg.gridHeight,
      cfg.cellSize,
      cfg.baseLayer
    );

    this._metadata = {
      name: 'Untitled Map',
      author: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    this._selection = [];
    this._dirty = false;

    this.emit(Events.MAP_CLEARED);
    this.emit(Events.RENDER_REQUESTED);
  }
}

/**
 * Create a new editor state instance
 */
export function createEditorState(config) {
  return new EditorState(config);
}
