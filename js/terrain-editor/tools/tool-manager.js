// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - Tool Manager
// Manages tool registration and switching
// ═══════════════════════════════════════════════════════════════

import { Events } from '../events.js';

/**
 * Tool manager - handles tool registration and input routing
 */
export class ToolManager {
  constructor(state, renderer) {
    this._state = state;
    this._renderer = renderer;
    this._tools = new Map();
    this._activeTool = null;

    // Panning state
    this._isPanning = false;
    this._panStart = null;
    this._spaceHeld = false;

    // Bind input handlers
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);

    // Subscribe to tool changes
    this._state.on(Events.TOOL_CHANGED, ({ tool }) => {
      this._switchTool(tool);
    });
  }

  /**
   * Register a tool
   */
  register(tool) {
    this._tools.set(tool.name, tool);
    console.log(`[ToolManager] Registered tool: ${tool.name}`);
  }

  /**
   * Get a tool by name
   */
  get(name) {
    return this._tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll() {
    return Array.from(this._tools.values());
  }

  /**
   * Attach input handlers to canvas
   */
  attach(canvas) {
    this._canvas = canvas;

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onContextMenu);

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    // Activate initial tool
    this._switchTool(this._state.activeTool);
  }

  /**
   * Detach input handlers
   */
  detach() {
    if (this._canvas) {
      this._canvas.removeEventListener('mousedown', this._onMouseDown);
      this._canvas.removeEventListener('mousemove', this._onMouseMove);
      this._canvas.removeEventListener('mouseup', this._onMouseUp);
      this._canvas.removeEventListener('mouseleave', this._onMouseLeave);
      this._canvas.removeEventListener('wheel', this._onWheel);
      this._canvas.removeEventListener('contextmenu', this._onContextMenu);
    }
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }

  // ═══════════════════════════════════════════════════════════════
  // TOOL SWITCHING
  // ═══════════════════════════════════════════════════════════════

  _switchTool(toolName) {
    const newTool = this._tools.get(toolName);
    if (!newTool) {
      console.warn(`[ToolManager] Unknown tool: ${toolName}`);
      return;
    }

    // Deactivate current tool
    if (this._activeTool) {
      this._activeTool.onDeactivate?.(this._state, this._renderer);
    }

    // Activate new tool
    this._activeTool = newTool;
    this._activeTool.onActivate?.(this._state, this._renderer);

    // Update cursor
    if (this._canvas) {
      this._canvas.style.cursor = newTool.cursor || 'default';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // INPUT HANDLERS
  // ═══════════════════════════════════════════════════════════════

  _getCanvasCoords(e) {
    return this._renderer.screenToCanvas(e.clientX, e.clientY);
  }

  _onMouseDown(e) {
    // Check for panning: middle mouse (button 1) OR space + left mouse (button 0)
    const isMiddleMouse = e.button === 1;
    const isSpaceLeftMouse = this._spaceHeld && e.button === 0;

    if (isMiddleMouse || isSpaceLeftMouse) {
      this._isPanning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      this._canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (!this._activeTool) return;

    const coords = this._getCanvasCoords(e);
    const event = {
      x: coords.x,
      y: coords.y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey
    };

    this._activeTool.onMouseDown?.(event, this._state, this._renderer);
  }

  _onMouseMove(e) {
    // Handle panning
    if (this._isPanning && this._panStart) {
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;

      this._state.pan(dx, dy);
      this._panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!this._activeTool) return;

    const coords = this._getCanvasCoords(e);
    const event = {
      x: coords.x,
      y: coords.y,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey
    };

    this._activeTool.onMouseMove?.(event, this._state, this._renderer);
  }

  _onMouseUp(e) {
    // End panning
    if (this._isPanning) {
      this._isPanning = false;
      this._panStart = null;
      // Restore cursor based on space state or active tool
      if (this._spaceHeld) {
        this._canvas.style.cursor = 'grab';
      } else if (this._activeTool) {
        this._canvas.style.cursor = this._activeTool.cursor || 'default';
      }
      return;
    }

    if (!this._activeTool) return;

    const coords = this._getCanvasCoords(e);
    const event = {
      x: coords.x,
      y: coords.y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey
    };

    this._activeTool.onMouseUp?.(event, this._state, this._renderer);
  }

  _onMouseLeave(e) {
    // Reset panning state when mouse leaves canvas
    if (this._isPanning) {
      this._isPanning = false;
      this._panStart = null;
    }

    if (!this._activeTool) return;

    this._renderer.clearBrushPreview();
    this._activeTool.onMouseLeave?.(this._state, this._renderer);
  }

  _onWheel(e) {
    e.preventDefault();

    // Zoom with wheel - use screen-relative position for zoom center
    const delta = -e.deltaY * 0.001;
    const rect = this._canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    this._state.zoom(delta, screenX, screenY);
  }

  _onKeyDown(e) {
    // Space key for pan mode
    if (e.code === 'Space' && !this._spaceHeld) {
      e.preventDefault();
      this._spaceHeld = true;
      if (this._canvas && !this._isPanning) {
        this._canvas.style.cursor = 'grab';
      }
      return;
    }

    // Tool shortcuts
    const shortcuts = {
      'p': 'paint',
      'c': 'clear',
      'v': 'select',
      't': 'transform'
    };

    const tool = shortcuts[e.key.toLowerCase()];
    if (tool && this._tools.has(tool)) {
      e.preventDefault();
      this._state.activeTool = tool;
      return;
    }

    // Undo/Redo
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      this._state.emit(Events.HISTORY_UNDO);
      return;
    }
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      this._state.emit(Events.HISTORY_REDO);
      return;
    }

    // Pass to active tool
    if (this._activeTool?.onKeyDown) {
      this._activeTool.onKeyDown(e, this._state, this._renderer);
    }
  }

  _onKeyUp(e) {
    // Release space key
    if (e.code === 'Space') {
      this._spaceHeld = false;
      // If not actively panning, restore the tool cursor
      if (!this._isPanning && this._canvas && this._activeTool) {
        this._canvas.style.cursor = this._activeTool.cursor || 'default';
      }
    }
  }

  _onContextMenu(e) {
    e.preventDefault();

    if (!this._activeTool) return;

    const coords = this._getCanvasCoords(e);
    const event = {
      x: coords.x,
      y: coords.y
    };

    this._activeTool.onContextMenu?.(event, this._state, this._renderer);
  }
}

/**
 * Create tool manager
 */
export function createToolManager(state, renderer) {
  return new ToolManager(state, renderer);
}
