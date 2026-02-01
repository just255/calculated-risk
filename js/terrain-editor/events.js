// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Event System
// Event types and simple event emitter
// ═══════════════════════════════════════════════════════════════

/**
 * Event type constants
 */
export const Events = {
  // State changes
  STATE_CHANGED: 'state:changed',

  // Tool events
  TOOL_CHANGED: 'tool:changed',
  TOOL_OPTIONS_CHANGED: 'tool:options:changed',

  // Stroke events
  STROKE_ADDED: 'stroke:added',
  STROKE_REMOVED: 'stroke:removed',
  STROKE_MODIFIED: 'stroke:modified',
  STROKES_CLEARED: 'strokes:cleared',
  PAINTING_FINISHED: 'painting:finished',  // Fires when scatter painting ends (for preview refresh)

  // Selection events
  SELECTION_CHANGED: 'selection:changed',
  SELECTION_CLEARED: 'selection:cleared',

  // Canvas events
  VIEWPORT_CHANGED: 'viewport:changed',
  RENDER_REQUESTED: 'render:requested',

  // History events
  HISTORY_PUSHED: 'history:pushed',
  HISTORY_UNDO: 'history:undo',
  HISTORY_REDO: 'history:redo',

  // Map events
  MAP_LOADED: 'map:loaded',
  MAP_SAVED: 'map:saved',
  MAP_CLEARED: 'map:cleared',

  // Layer events
  LAYER_CHANGED: 'layer:changed',
  BASE_LAYER_CHANGED: 'base:layer:changed'
};

/**
 * Simple event emitter
 */
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler to remove
   */
  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }

  /**
   * Subscribe to an event once
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   */
  once(event, callback) {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      callback(data);
    });
    return unsubscribe;
  }

  /**
   * Remove all listeners for an event (or all events)
   * @param {string} [event] - Event name, or omit to clear all
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}
