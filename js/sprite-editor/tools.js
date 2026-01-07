// sprite-editor/tools.js - Drawing tools
// Single responsibility: Handle drawing tool interactions

import { state } from './state.js';
import { render, getCanvasPosition, getContext, drawShapeToContext, getCurrentLayerImageData } from './canvas.js';
import * as selection from './selection.js';
import * as stamp from './stamp.js';
import * as cloneStamp from './clone-stamp.js';
import { saveHistory } from './history.js';
import { OVERLAY_STYLES } from './constants.js';

let isDrawing = false;
let startPos = null;
let currentShape = null;
let pathPoints = [];
let lastBrushPos = null; // For selection brush continuous painting
let brushStartPos = null; // Track stroke start for minimum movement threshold
let cloneStampShape = null; // For clone stamp continuous painting
let lastClonePos = null; // Track last clone position for continuous stroke

// Edge fill reference points (Alt+Click to add)
let edgeFillRefPoints = [];

// Blend brush state
let lastBlendPos = null;
let blendShape = null;

// Pixelate brush state
let lastPixelatePos = null;
let pixelateShape = null;

// Marquee selection state
let marqueeStart = null;
let marqueeEnd = null;
let isMarqueeSelecting = false;

// Click-to-place mode state (works for all shape tools)
let clickPlaceMode = false;
let clickPlaceStart = null;
let clickPlaceTool = null;  // Which tool is in click-place mode
let isDragging = false;  // Track if user is dragging vs clicking
let clickPlaceStartShapeIndex = null;  // Index of the starting dot shape (for removal on cancel)

// Polygon lasso state (click-to-place polygon selection)
let lassoPoints = [];  // Array of {x, y} points for polygon lasso

// Get the current layer
function getCurrentLayer() {
  return state.layers.find(l => l.id === state.selectedLayerId);
}

// Handle positions: corners and edges
const HANDLE_SIZE = 8;
const HANDLES = {
  nw: 'nw', n: 'n', ne: 'ne',
  w: 'w',          e: 'e',
  sw: 'sw', s: 's', se: 'se'
};

// Hit test resize handles for a shape (returns handle name or null)
function hitTestHandle(shape, x, y) {
  if (shape.type !== 'image') return null;

  const hs = HANDLE_SIZE / 2 + 2; // Half size + tolerance
  const sx = shape.x, sy = shape.y;
  const sw = shape.width, sh = shape.height;

  // Corner handles
  if (Math.abs(x - sx) <= hs && Math.abs(y - sy) <= hs) return HANDLES.nw;
  if (Math.abs(x - (sx + sw)) <= hs && Math.abs(y - sy) <= hs) return HANDLES.ne;
  if (Math.abs(x - sx) <= hs && Math.abs(y - (sy + sh)) <= hs) return HANDLES.sw;
  if (Math.abs(x - (sx + sw)) <= hs && Math.abs(y - (sy + sh)) <= hs) return HANDLES.se;

  // Edge handles (middle of each edge)
  if (Math.abs(x - (sx + sw/2)) <= hs && Math.abs(y - sy) <= hs) return HANDLES.n;
  if (Math.abs(x - (sx + sw/2)) <= hs && Math.abs(y - (sy + sh)) <= hs) return HANDLES.s;
  if (Math.abs(x - sx) <= hs && Math.abs(y - (sy + sh/2)) <= hs) return HANDLES.w;
  if (Math.abs(x - (sx + sw)) <= hs && Math.abs(y - (sy + sh/2)) <= hs) return HANDLES.e;

  return null;
}

// Distance from point to line segment
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

  // Project point onto line, clamped to segment
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

// Hit test a shape at given coordinates
function hitTestShape(shape, x, y) {
  const tolerance = Math.max(5, (shape.strokeWidth || 1) / 2 + 3);

  switch (shape.type) {
    case 'image':
      return x >= shape.x && x <= shape.x + shape.width &&
             y >= shape.y && y <= shape.y + shape.height;
    case 'rect':
      // If filled, hit anywhere inside
      if (shape.fillColor) {
        return x >= shape.x && x <= shape.x + shape.width &&
               y >= shape.y && y <= shape.y + shape.height;
      }
      // If not filled, only hit the stroke (edges)
      const inOuter = x >= shape.x - tolerance && x <= shape.x + shape.width + tolerance &&
                      y >= shape.y - tolerance && y <= shape.y + shape.height + tolerance;
      const inInner = x > shape.x + tolerance && x < shape.x + shape.width - tolerance &&
                      y > shape.y + tolerance && y < shape.y + shape.height - tolerance;
      return inOuter && !inInner;
    case 'circle':
      const dist = Math.sqrt((x - shape.x) ** 2 + (y - shape.y) ** 2);
      if (shape.fillColor) {
        return dist <= shape.radius;
      }
      // Only hit the stroke ring
      return Math.abs(dist - shape.radius) <= tolerance;
    case 'ellipse':
      const ex = (x - shape.x) / shape.radiusX;
      const ey = (y - shape.y) / shape.radiusY;
      const ellipseDist = Math.sqrt(ex * ex + ey * ey);
      if (shape.fillColor) {
        return ellipseDist <= 1;
      }
      // Only hit the stroke
      return Math.abs(ellipseDist - 1) <= tolerance / Math.min(shape.radiusX, shape.radiusY);
    case 'line':
      return distanceToLineSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= tolerance;
    case 'path':
      if (!shape.points || shape.points.length === 0) return false;
      // Single point (dot)
      if (shape.points.length === 1) {
        const p = shape.points[0];
        return Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2) <= tolerance;
      }
      // Check distance to each segment
      for (let i = 0; i < shape.points.length - 1; i++) {
        const p1 = shape.points[i];
        const p2 = shape.points[i + 1];
        if (distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tolerance) {
          return true;
        }
      }
      return false;
    default:
      return false;
  }
}

// Get current stroke settings
function getStrokeSettings() {
  return {
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    fillColor: state.fillEnabled ? state.fillColor1 : null
  };
}

// Create a single point shape (reusable for polyline start, dots, etc.)
function createPointShape(x, y) {
  return {
    type: 'path',
    points: [{ x, y }],
    pixelPerfect: state.pixelPerfect,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth
  };
}

// Create rect from two corner points (handles any direction)
function createRectFromPoints(p1, p2, settings) {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  return {
    type: 'rect',
    x, y, width, height,
    pixelPerfect: state.pixelPerfect,
    ...settings
  };
}

// Exit click-place mode (for shapes that complete on second click)
function exitClickPlaceMode(removeStartDot = false) {
  // Remove the starting dot if canceling
  if (removeStartDot && clickPlaceStartShapeIndex !== null) {
    const layer = getCurrentLayer();
    if (layer && layer.shapes.length > clickPlaceStartShapeIndex) {
      layer.shapes.splice(clickPlaceStartShapeIndex, 1);
    }
  }
  clickPlaceMode = false;
  clickPlaceStart = null;
  clickPlaceTool = null;
  clickPlaceStartShapeIndex = null;
  currentShape = null;
  lassoPoints = [];  // Clear lasso state
}

// Update lasso preview shape from current points
function updateLassoPreview() {
  currentShape = {
    type: 'path',
    points: [...lassoPoints],
    strokeColor: '#00ff88',
    strokeWidth: 1,
    isLasso: true,
    isPreview: true
  };
}

// Finalize polygon lasso selection
function finalizeLassoSelection(e) {
  if (lassoPoints.length < 3) {
    exitClickPlaceMode();
    render();
    return;
  }

  // Store lasso points for realtime re-selection when settings change
  state.lastLassoPoints = lassoPoints.map(p => ({ x: p.x, y: p.y }));

  // Get target colors from state
  const targetColors = state.targetColors || [];

  // Check modifiers
  const addToSel = e && e.shiftKey;
  const subtractFromSel = e && e.altKey;

  // Pass raw lasso points - selection.js handles pixel boundary testing
  selection.lassoSelect(lassoPoints, {
    addToSelection: addToSel,
    subtractFromSelection: subtractFromSel,
    targetColors: targetColors,
    tolerance: state.lassoTolerance || 10,
    expandColors: state.lassoExpandColors !== false
  });
  // Clear shape selection when making pixel selection
  clearShapeSelection();
  saveHistory();

  // Clean up
  exitClickPlaceMode();
  render();
}

// Enter click-place mode for a tool
function enterClickPlaceMode(tool, x, y) {
  clickPlaceMode = true;
  clickPlaceTool = tool;
  clickPlaceStart = { x, y };
}

// Detect if user is dragging (moved more than threshold)
function detectDrag(pos) {
  if (!isDragging && startPos) {
    const dx = Math.abs(pos.x - startPos.x);
    const dy = Math.abs(pos.y - startPos.y);
    if (dx > 3 || dy > 3) {
      isDragging = true;
    }
  }
}

// Blend pixels at a position - averages colors in radius
// hardness: 0-100, where 100 = full replacement with average, 0 = no change
function blendPixelsAt(cx, cy, radius, hardness = 50) {
  const imageData = getCurrentLayerImageData();
  if (!imageData) return null;

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = imageData.data;

  // Collect all opaque pixels in radius
  const pixelsInRadius = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue; // Circular

      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;

      const idx = (py * width + px) * 4;
      if (pixels[idx + 3] < 128) continue; // Skip transparent

      pixelsInRadius.push({
        x: px, y: py,
        r: pixels[idx],
        g: pixels[idx + 1],
        b: pixels[idx + 2],
        a: pixels[idx + 3]
      });
    }
  }

  if (pixelsInRadius.length < 2) return null; // Need at least 2 pixels to blend

  // Compute average color
  let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
  for (const p of pixelsInRadius) {
    avgR += p.r;
    avgG += p.g;
    avgB += p.b;
    avgA += p.a;
  }
  const count = pixelsInRadius.length;
  avgR = Math.round(avgR / count);
  avgG = Math.round(avgG / count);
  avgB = Math.round(avgB / count);
  avgA = Math.round(avgA / count);

  // Apply blended color - hardness controls how much we move towards average
  const blendFactor = hardness / 100;
  const result = [];
  for (const p of pixelsInRadius) {
    result.push({
      x: p.x,
      y: p.y,
      r: Math.round(p.r * (1 - blendFactor) + avgR * blendFactor),
      g: Math.round(p.g * (1 - blendFactor) + avgG * blendFactor),
      b: Math.round(p.b * (1 - blendFactor) + avgB * blendFactor),
      a: p.a // Keep original alpha
    });
  }

  return result;
}

// Pixelate pixels at a position - divides area into grid cells and averages each cell
// Creates a chunky/mosaic effect instead of smooth blending
function pixelateAtPoint(cx, cy, radius, cellSize = 4) {
  const imageData = getCurrentLayerImageData();
  if (!imageData) return null;

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = imageData.data;

  // Snap center to grid
  const gridCx = Math.floor(cx / cellSize) * cellSize;
  const gridCy = Math.floor(cy / cellSize) * cellSize;

  // Calculate grid-aligned bounds
  const minX = Math.floor((cx - radius) / cellSize) * cellSize;
  const maxX = Math.ceil((cx + radius) / cellSize) * cellSize;
  const minY = Math.floor((cy - radius) / cellSize) * cellSize;
  const maxY = Math.ceil((cy + radius) / cellSize) * cellSize;

  const result = [];

  // Process each grid cell
  for (let cellY = minY; cellY < maxY; cellY += cellSize) {
    for (let cellX = minX; cellX < maxX; cellX += cellSize) {
      // Check if cell center is within brush radius
      const cellCenterX = cellX + cellSize / 2;
      const cellCenterY = cellY + cellSize / 2;
      const distFromBrush = Math.sqrt((cellCenterX - cx) ** 2 + (cellCenterY - cy) ** 2);
      if (distFromBrush > radius) continue;

      // Collect colors in this cell
      let totalR = 0, totalG = 0, totalB = 0, totalA = 0;
      let opaqueCount = 0;
      const cellPixels = [];

      for (let py = cellY; py < cellY + cellSize && py < height; py++) {
        for (let px = cellX; px < cellX + cellSize && px < width; px++) {
          if (px < 0 || py < 0) continue;

          const idx = (py * width + px) * 4;
          const alpha = pixels[idx + 3];

          cellPixels.push({ x: px, y: py, hasContent: alpha > 0 });

          if (alpha > 0) {
            totalR += pixels[idx];
            totalG += pixels[idx + 1];
            totalB += pixels[idx + 2];
            totalA += alpha;
            opaqueCount++;
          }
        }
      }

      // Only pixelate cells that have some content
      if (opaqueCount > 0) {
        const avgR = Math.round(totalR / opaqueCount);
        const avgG = Math.round(totalG / opaqueCount);
        const avgB = Math.round(totalB / opaqueCount);
        const avgA = Math.round(totalA / opaqueCount);

        // Apply average color to all pixels in the cell that had content
        for (const p of cellPixels) {
          if (p.hasContent) {
            result.push({
              x: p.x,
              y: p.y,
              r: avgR,
              g: avgG,
              b: avgB,
              a: avgA
            });
          }
        }
      }
    }
  }

  return result.length > 0 ? result : null;
}

// Add spray dots around a center point with better randomization
function addSprayDots(shape, cx, cy) {
  const count = shape.density;
  const radius = shape.radius;

  for (let i = 0; i < count; i++) {
    // Random angle
    const angle = Math.random() * Math.PI * 2;

    // Gaussian-like distribution (more dots near center)
    // Use Box-Muller transform approximation
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2);
    const normalizedDist = Math.abs(gaussian) / 3; // Normalize to ~0-1 range
    const dist = Math.min(radius, normalizedDist * radius);

    // Add slight position jitter for more organic look
    const jitterX = (Math.random() - 0.5) * 0.5;
    const jitterY = (Math.random() - 0.5) * 0.5;

    const x = Math.round(cx + Math.cos(angle) * dist + jitterX);
    const y = Math.round(cy + Math.sin(angle) * dist + jitterY);
    shape.dots.push({ x, y });
  }
}

// Create preview shape for click-place mode (reusable for all tools)
function createClickPlacePreview(pos) {
  const start = clickPlaceStart;
  const settings = getStrokeSettings();

  switch (clickPlaceTool) {
    case 'line':
      return {
        type: 'line',
        x1: start.x, y1: start.y,
        x2: pos.x, y2: pos.y,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
    case 'rect':
      return createRectFromPoints(start, pos, settings);
    case 'circle':
      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      return {
        type: 'circle',
        x: start.x, y: start.y,
        radius: Math.sqrt(dx * dx + dy * dy),
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
    case 'ellipse':
      return {
        type: 'ellipse',
        x: start.x, y: start.y,
        radiusX: Math.abs(pos.x - start.x),
        radiusY: Math.abs(pos.y - start.y),
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
    default:
      return null;
  }
}

// Start drawing
export function startDraw(e) {
  if (state.selectedMode !== 'part-editor') return;

  const layer = getCurrentLayer();
  if (!layer || !layer.visible) return;

  isDrawing = true;
  startPos = getCanvasPosition(e);

  const settings = getStrokeSettings();

  switch (state.tool) {
    case 'pencil':
      pathPoints = [{ x: startPos.x, y: startPos.y }];
      currentShape = {
        type: 'path',
        points: pathPoints,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
      break;

    case 'line':
      // If in click-place mode for line, clicking adds a new segment
      if (clickPlaceMode && clickPlaceTool === 'line' && clickPlaceStart) {
        currentShape = {
          type: 'line',
          x1: clickPlaceStart.x,
          y1: clickPlaceStart.y,
          x2: startPos.x,
          y2: startPos.y,
          pixelPerfect: state.pixelPerfect,
          ...settings
        };
        const layer = getCurrentLayer();
        if (layer) {
          saveHistory();
          layer.shapes.push(currentShape);
        }
        // Update start for next segment
        clickPlaceStart = { x: startPos.x, y: startPos.y };
        currentShape = null;
        isDrawing = false;
        render();
        return;
      }
      // Start drag mode - will switch to click-place if no drag detected
      isDragging = false;
      currentShape = {
        type: 'line',
        x1: startPos.x,
        y1: startPos.y,
        x2: startPos.x,
        y2: startPos.y,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
      break;

    case 'rect':
      // If in click-place mode for rect, second click completes it
      if (clickPlaceMode && clickPlaceTool === 'rect' && clickPlaceStart) {
        currentShape = createRectFromPoints(clickPlaceStart, startPos, settings);
        const layer = getCurrentLayer();
        if (layer) {
          saveHistory();
          layer.shapes.push(currentShape);
        }
        exitClickPlaceMode();
        render();
        return;
      }
      isDragging = false;
      currentShape = {
        type: 'rect',
        x: startPos.x,
        y: startPos.y,
        width: 0,
        height: 0,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
      break;

    case 'circle':
      // If in click-place mode for circle, second click sets radius
      if (clickPlaceMode && clickPlaceTool === 'circle' && clickPlaceStart) {
        const dx = startPos.x - clickPlaceStart.x;
        const dy = startPos.y - clickPlaceStart.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        currentShape = {
          type: 'circle',
          x: clickPlaceStart.x,
          y: clickPlaceStart.y,
          radius: radius,
          pixelPerfect: state.pixelPerfect,
          ...settings
        };
        const layer = getCurrentLayer();
        if (layer) {
          saveHistory();
          layer.shapes.push(currentShape);
        }
        exitClickPlaceMode();
        render();
        return;
      }
      isDragging = false;
      currentShape = {
        type: 'circle',
        x: startPos.x,
        y: startPos.y,
        radius: 0,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
      break;

    case 'ellipse':
      // If in click-place mode for ellipse, second click sets radii
      if (clickPlaceMode && clickPlaceTool === 'ellipse' && clickPlaceStart) {
        currentShape = {
          type: 'ellipse',
          x: clickPlaceStart.x,
          y: clickPlaceStart.y,
          radiusX: Math.abs(startPos.x - clickPlaceStart.x),
          radiusY: Math.abs(startPos.y - clickPlaceStart.y),
          pixelPerfect: state.pixelPerfect,
          ...settings
        };
        const layer = getCurrentLayer();
        if (layer) {
          saveHistory();
          layer.shapes.push(currentShape);
        }
        exitClickPlaceMode();
        render();
        return;
      }
      isDragging = false;
      currentShape = {
        type: 'ellipse',
        x: startPos.x,
        y: startPos.y,
        radiusX: 0,
        radiusY: 0,
        pixelPerfect: state.pixelPerfect,
        ...settings
      };
      break;

    case 'select':
      const shapes = layer.shapes;

      // First check if clicking on a resize handle of currently selected image
      if (state.selectedShapeIndex !== null) {
        const selectedShape = shapes[state.selectedShapeIndex];
        if (selectedShape && selectedShape.type === 'image') {
          const handle = hitTestHandle(selectedShape, startPos.x, startPos.y);
          if (handle) {
            // Start resize mode
            state.isResizingShape = true;
            state.resizeHandle = handle;
            state.dragStartX = startPos.x;
            state.dragStartY = startPos.y;
            state.dragOrigX = selectedShape.x;
            state.dragOrigY = selectedShape.y;
            state.dragOrigWidth = selectedShape.width;
            state.dragOrigHeight = selectedShape.height;
            isDrawing = false;
            render();
            return;
          }
        }
      }

      // Check if clicking on a shape (search in reverse for top-most)
      let foundIndex = -1;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTestShape(shapes[i], startPos.x, startPos.y)) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex >= 0) {
        state.selectedShapeIndex = foundIndex;
        state.isDraggingShape = true;
        state.dragStartX = startPos.x;
        state.dragStartY = startPos.y;
        // Store original position based on shape type
        const shape = shapes[foundIndex];
        if (shape.type === 'line') {
          state.dragOrigX = shape.x1;
          state.dragOrigY = shape.y1;
          state.dragOrigX2 = shape.x2;
          state.dragOrigY2 = shape.y2;
        } else if (shape.type === 'path' && shape.points) {
          state.dragOrigPoints = shape.points.map(p => ({ x: p.x, y: p.y }));
        } else {
          state.dragOrigX = shape.x;
          state.dragOrigY = shape.y;
        }
      } else {
        state.selectedShapeIndex = null;
      }
      isDrawing = false;
      render();
      return;

    case 'eyedropper':
      pickColor(startPos);
      break;

    case 'bucket':
      // Flood fill with current color
      const bucketLayer = getCurrentLayer();
      if (bucketLayer) {
        saveHistory(); // Save BEFORE the change
        const fillColor = state.fillEnabled ? state.fillColor1 : state.strokeColor;
        const filledPixels = selection.floodFill(startPos.x, startPos.y, fillColor);
        if (filledPixels.length > 0) {
          bucketLayer.shapes.push({
            type: 'fill',
            pixels: filledPixels,
            color: fillColor
          });
        }
      }
      isDrawing = false;
      render();
      return; // Don't continue with normal drawing flow

    case 'edge-fill':
      // Edge fill - fill transparent holes
      // Alt+Click = add reference point, Click = fill using reference points (or auto if none)
      const edgeFillLayer = getCurrentLayer();
      if (!edgeFillLayer) {
        isDrawing = false;
        return;
      }

      if (e.altKey) {
        // Add reference point (sample area)
        edgeFillRefPoints.push({ x: Math.round(startPos.x), y: Math.round(startPos.y) });
        console.log(`[EdgeFill] Added reference point ${edgeFillRefPoints.length} at (${startPos.x}, ${startPos.y})`);
        isDrawing = false;
        render();
        return;
      }

      // Fill using reference points if set, otherwise use auto algorithm
      let filledPixels;
      if (edgeFillRefPoints.length > 0) {
        filledPixels = selection.edgeFillFromReferences(startPos.x, startPos.y, edgeFillRefPoints);
        // Clear reference points after use
        edgeFillRefPoints = [];
      } else {
        // Fallback to auto algorithm
        filledPixels = selection.edgeFillAdvanced(startPos.x, startPos.y, 16);
      }

      if (filledPixels && filledPixels.length > 0) {
        saveHistory();
        edgeFillLayer.shapes.push({
          type: 'edge-fill',
          pixels: filledPixels
        });
      }
      isDrawing = false;
      render();
      return;

    case 'stamp':
      // Legacy stamp tool - paste selection at click location
      const stampLayer = getCurrentLayer();
      if (!stampLayer || !selection.hasSelection()) {
        isDrawing = false;
        return;
      }

      const stampPixels = stamp.createStamp(startPos.x, startPos.y, {
        flipH: e.shiftKey && !e.ctrlKey,
        flipV: e.altKey,
        random: e.ctrlKey && e.shiftKey
      });

      if (stampPixels && stampPixels.length > 0) {
        saveHistory();
        stampLayer.shapes.push({ type: 'stamp', pixels: stampPixels });
      }

      isDrawing = false;
      render();
      return;

    case 'clone-stamp':
      // Clone Stamp tool (Photoshop-style)
      // Alt+Click = set source, Click/Drag = paint
      const cloneLayer = getCurrentLayer();
      if (!cloneLayer) {
        isDrawing = false;
        return;
      }

      if (e.altKey) {
        // Set source point
        cloneStamp.setSource(startPos.x, startPos.y);
        isDrawing = false;
        render();
        return;
      }

      if (!cloneStamp.hasSource()) {
        console.log('[CloneStamp] Alt+Click to set source first');
        isDrawing = false;
        return;
      }

      // Start painting - save history once at start of stroke
      saveHistory();
      cloneStamp.startPaint(startPos.x, startPos.y);

      // Create shape to accumulate pixels during drag
      cloneStampShape = { type: 'stamp', pixels: [] };
      cloneLayer.shapes.push(cloneStampShape);

      // Paint initial position
      const imageData = getCurrentLayerImageData();
      const clonePixels = cloneStamp.paint(startPos.x, startPos.y, imageData);
      if (clonePixels && clonePixels.length > 0) {
        cloneStampShape.pixels.push(...clonePixels);
      }
      lastClonePos = { x: startPos.x, y: startPos.y };

      // Keep drawing true for drag behavior
      render();
      return;

    case 'wand':
      // Magic wand selection
      const addToSelection = e.shiftKey || false;
      selection.magicWandSelect(startPos.x, startPos.y, addToSelection);
      // Clear shape selection when making pixel selection
      clearShapeSelection();
      saveHistory(); // Save selection to history
      isDrawing = false;
      render();
      return; // Don't continue with normal drawing flow

    case 'marquee': {
      // Rectangle marquee selection - start drag
      marqueeStart = { x: startPos.x, y: startPos.y };
      marqueeEnd = { x: startPos.x, y: startPos.y };
      isMarqueeSelecting = true;
      isDrawing = true;
      render();
      return;
    }

    case 'selection-brush': {
      // Selection brush - paint selection directly
      const brushEraseMode = e.altKey || false;
      const brushAddMode = e.shiftKey || false;
      const brushSize = Math.max(1, state.strokeWidth);
      // Start new stroke (clears unless adding/erasing)
      selection.startBrushStroke(brushAddMode, brushEraseMode);
      state.cursorX = startPos.x;
      state.cursorY = startPos.y;
      selection.brushSelect(startPos.x, startPos.y, brushSize, brushEraseMode);
      lastBrushPos = { x: startPos.x, y: startPos.y };
      brushStartPos = { x: startPos.x, y: startPos.y }; // Track start for min movement
      isDrawing = true;
      render();
      return;
    }

    case 'lasso': {
      // Polygon lasso - click to place points, close to complete
      if (clickPlaceMode && clickPlaceTool === 'lasso' && lassoPoints.length > 0) {
        // Check if clicking exactly on start point to close polygon
        // Compare with clickPlaceStart (original click), not lassoPoints[0] (which has +0.5 offset)
        const onStartPoint = startPos.x === clickPlaceStart.x && startPos.y === clickPlaceStart.y;

        if (onStartPoint && lassoPoints.length >= 3) {
          // Close the polygon and run selection
          finalizeLassoSelection(e);
          return;
        }

        // Add point at pixel center (+0.5) for proper boundary inclusion
        lassoPoints.push({ x: startPos.x + 0.5, y: startPos.y + 0.5 });
        updateLassoPreview();
        render();
        return;
      }

      // Start new polygon lasso - use pixel center (+0.5) for proper boundary inclusion
      lassoPoints = [{ x: startPos.x + 0.5, y: startPos.y + 0.5 }];
      clickPlaceMode = true;
      clickPlaceTool = 'lasso';
      clickPlaceStart = { x: startPos.x, y: startPos.y };
      updateLassoPreview();
      render();
      return;
    }

    case 'eraser':
      pathPoints = [{ x: startPos.x, y: startPos.y }];
      currentShape = {
        type: 'path',
        points: pathPoints,
        strokeColor: 'rgba(0,0,0,0)',
        strokeWidth: state.strokeWidth * 2,
        pixelPerfect: state.pixelPerfect,
        isEraser: true
      };
      break;

    case 'spray':
      // Spray tool - scatter dots in a radius
      // Radius = stroke width, density scales with area (more dots for coverage)
      const sprayRadius = Math.max(1, state.strokeWidth);
      const sprayDensity = Math.max(3, Math.ceil(sprayRadius * 1.5)); // Minimum 3 dots, scales up
      currentShape = {
        type: 'spray',
        dots: [],
        color: state.strokeColor,
        radius: sprayRadius,
        density: sprayDensity
      };
      // Add initial spray
      addSprayDots(currentShape, startPos.x, startPos.y);
      break;

    case 'blend':
      // Blend brush - averages colors in brush area without smudging
      const blendLayer = getCurrentLayer();
      if (!blendLayer) {
        isDrawing = false;
        return;
      }

      // Save history once at start of stroke
      saveHistory();

      // Create shape to accumulate blended pixels
      blendShape = { type: 'blend', pixels: [] };
      blendLayer.shapes.push(blendShape);

      // Blend initial position
      const blendRadius = Math.max(1, Math.floor(state.strokeWidth / 2));
      const blendedPixels = blendPixelsAt(startPos.x, startPos.y, blendRadius, state.blendHardness);
      if (blendedPixels && blendedPixels.length > 0) {
        blendShape.pixels.push(...blendedPixels);
      }
      lastBlendPos = { x: startPos.x, y: startPos.y };
      render();
      return;

    case 'pixelate':
      // Pixelate brush - creates chunky/mosaic effect by averaging grid cells
      const pixelateLayer = getCurrentLayer();
      if (!pixelateLayer) {
        isDrawing = false;
        return;
      }

      // Save history once at start of stroke
      saveHistory();

      // Create shape to accumulate pixelated pixels
      pixelateShape = { type: 'pixelate', pixels: [] };
      pixelateLayer.shapes.push(pixelateShape);

      // Pixelate initial position
      const pixelateRadius = Math.max(1, Math.floor(state.strokeWidth / 2));
      const pixelatedPixels = pixelateAtPoint(startPos.x, startPos.y, pixelateRadius, state.pixelateSize);
      if (pixelatedPixels && pixelatedPixels.length > 0) {
        pixelateShape.pixels.push(...pixelatedPixels);
      }
      lastPixelatePos = { x: startPos.x, y: startPos.y };
      render();
      return;
  }

  render();
}

// Continue drawing (mouse move while button down)
export function continueDraw(e) {
  const pos = getCanvasPosition(e);

  // Handle lasso polygon preview (show path + line to cursor)
  if (clickPlaceMode && clickPlaceTool === 'lasso' && lassoPoints.length > 0) {
    // Create preview with existing points + line to cursor
    currentShape = {
      type: 'path',
      points: [...lassoPoints, { x: pos.x, y: pos.y }],
      strokeColor: '#00ff88',
      strokeWidth: 1,
      isLasso: true,
      isPreview: true
    };
    renderWithPreview();
    return;
  }

  // Handle click-place preview (mouse not down, but in click-place mode)
  if (clickPlaceMode && clickPlaceStart && !isDrawing) {
    currentShape = createClickPlacePreview(pos);
    renderWithPreview();
    return;
  }

  // Marquee selection - update rectangle as user drags
  if (state.tool === 'marquee' && isMarqueeSelecting && marqueeStart) {
    marqueeEnd = { x: pos.x, y: pos.y };
    renderWithPreview();
    return;
  }

  // Selection brush doesn't use currentShape, handle separately
  if (state.tool === 'selection-brush' && lastBrushPos) {
    // Skip if position hasn't changed
    if (pos.x === lastBrushPos.x && pos.y === lastBrushPos.y) {
      return;
    }
    // Require minimum movement from stroke start before painting lines
    // This prevents accidental micro-movements during clicks
    if (brushStartPos) {
      const dx = Math.abs(pos.x - brushStartPos.x);
      const dy = Math.abs(pos.y - brushStartPos.y);
      if (dx < 2 && dy < 2) {
        return; // Not enough movement yet
      }
      // Once we start moving, clear the threshold check
      brushStartPos = null;
    }
    const eraseMode = e.altKey || false;
    const brushSize = Math.max(1, state.strokeWidth);
    selection.brushSelectLine(lastBrushPos.x, lastBrushPos.y, pos.x, pos.y, brushSize, eraseMode);
    lastBrushPos = { x: pos.x, y: pos.y };
    render();
    return;
  }

  // Clone stamp continuous painting
  if (state.tool === 'clone-stamp' && isDrawing && cloneStampShape && lastClonePos) {
    // Skip if position hasn't changed
    if (pos.x === lastClonePos.x && pos.y === lastClonePos.y) {
      return;
    }

    // Interpolate between last position and current for smooth strokes
    const dx = pos.x - lastClonePos.x;
    const dy = pos.y - lastClonePos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const brushSize = cloneStamp.getBrushSize();
    const step = Math.max(1, Math.floor(brushSize / 4)); // Step size based on brush

    const imageData = getCurrentLayerImageData();
    const steps = Math.ceil(dist / step);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(lastClonePos.x + dx * t);
      const py = Math.round(lastClonePos.y + dy * t);

      const clonePixels = cloneStamp.paint(px, py, imageData);
      if (clonePixels && clonePixels.length > 0) {
        cloneStampShape.pixels.push(...clonePixels);
      }
    }

    lastClonePos = { x: pos.x, y: pos.y };
    render();
    return;
  }

  // Blend brush continuous painting
  if (state.tool === 'blend' && isDrawing && blendShape && lastBlendPos) {
    if (pos.x === lastBlendPos.x && pos.y === lastBlendPos.y) {
      return;
    }

    const blendRadius = Math.max(1, Math.floor(state.strokeWidth / 2));

    // Interpolate between last position and current for smooth strokes
    const dx = pos.x - lastBlendPos.x;
    const dy = pos.y - lastBlendPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, Math.floor(blendRadius / 2));
    const steps = Math.ceil(dist / step);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(lastBlendPos.x + dx * t);
      const py = Math.round(lastBlendPos.y + dy * t);

      const blendedPixels = blendPixelsAt(px, py, blendRadius, state.blendHardness);
      if (blendedPixels && blendedPixels.length > 0) {
        blendShape.pixels.push(...blendedPixels);
      }
    }

    lastBlendPos = { x: pos.x, y: pos.y };
    render();
    return;
  }

  // Pixelate brush continuous painting
  if (state.tool === 'pixelate' && isDrawing && pixelateShape && lastPixelatePos) {
    if (pos.x === lastPixelatePos.x && pos.y === lastPixelatePos.y) {
      return;
    }

    const pixelateRadius = Math.max(1, Math.floor(state.strokeWidth / 2));

    // Interpolate between last position and current for continuous strokes
    const dx = pos.x - lastPixelatePos.x;
    const dy = pos.y - lastPixelatePos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, Math.floor(pixelateRadius / 2));
    const steps = Math.ceil(dist / step);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(lastPixelatePos.x + dx * t);
      const py = Math.round(lastPixelatePos.y + dy * t);

      const pixelatedPixels = pixelateAtPoint(px, py, pixelateRadius, state.pixelateSize);
      if (pixelatedPixels && pixelatedPixels.length > 0) {
        pixelateShape.pixels.push(...pixelatedPixels);
      }
    }

    lastPixelatePos = { x: pos.x, y: pos.y };
    render();
    return;
  }

  if (!isDrawing || !currentShape) return;

  switch (state.tool) {
    case 'pencil':
    case 'eraser':
      pathPoints.push({ x: pos.x, y: pos.y });
      currentShape.points = pathPoints;
      break;

    // Note: lasso now uses click-place mode, handled earlier in continueDraw

    case 'spray':
      addSprayDots(currentShape, pos.x, pos.y);
      break;

    case 'line':
      currentShape.x2 = pos.x;
      currentShape.y2 = pos.y;
      detectDrag(pos);
      break;

    case 'rect':
      currentShape.width = pos.x - startPos.x;
      currentShape.height = pos.y - startPos.y;
      // Handle negative dimensions (drawing from right to left or bottom to top)
      if (currentShape.width < 0) {
        currentShape.x = pos.x;
        currentShape.width = Math.abs(currentShape.width);
      }
      if (currentShape.height < 0) {
        currentShape.y = pos.y;
        currentShape.height = Math.abs(currentShape.height);
      }
      detectDrag(pos);
      break;

    case 'circle':
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      currentShape.radius = Math.sqrt(dx * dx + dy * dy);
      detectDrag(pos);
      break;

    case 'ellipse':
      currentShape.radiusX = Math.abs(pos.x - startPos.x);
      currentShape.radiusY = Math.abs(pos.y - startPos.y);
      detectDrag(pos);
      break;
  }

  // Render preview
  renderWithPreview();
}

// Tools that support click-to-place mode
const CLICK_PLACE_TOOLS = ['line', 'rect', 'circle', 'ellipse'];

// End drawing
export function endDraw(e) {
  // Handle marquee selection ending
  if (state.tool === 'marquee' && isMarqueeSelecting && marqueeStart && marqueeEnd) {
    const addToSel = e && e.shiftKey;
    selection.rectangleSelect(
      marqueeStart.x, marqueeStart.y,
      marqueeEnd.x, marqueeEnd.y,
      addToSel
    );
    // Clear shape selection when making pixel selection
    clearShapeSelection();
    saveHistory();
    marqueeStart = null;
    marqueeEnd = null;
    isMarqueeSelecting = false;
    isDrawing = false;
    render();
    return;
  }

  // Handle selection brush ending
  if (state.tool === 'selection-brush' && lastBrushPos) {
    lastBrushPos = null;
    brushStartPos = null;
    isDrawing = false;
    // Clear shape selection when making pixel selection
    clearShapeSelection();
    saveHistory(); // Save selection to history
    // Update cursor position from event so preview stays visible
    if (e) {
      const pos = getCanvasPosition(e);
      state.cursorX = pos.x;
      state.cursorY = pos.y;
    }
    render();
    return;
  }

  // Handle clone stamp ending
  if (state.tool === 'clone-stamp' && cloneStampShape) {
    // Clean up empty shapes
    if (cloneStampShape.pixels.length === 0) {
      const layer = getCurrentLayer();
      if (layer) {
        const idx = layer.shapes.indexOf(cloneStampShape);
        if (idx !== -1) layer.shapes.splice(idx, 1);
      }
    }
    cloneStampShape = null;
    lastClonePos = null;
    isDrawing = false;
    render();
    return;
  }

  // Handle blend brush ending
  if (state.tool === 'blend' && blendShape) {
    // Clean up empty shapes
    if (blendShape.pixels.length === 0) {
      const layer = getCurrentLayer();
      if (layer) {
        const idx = layer.shapes.indexOf(blendShape);
        if (idx !== -1) layer.shapes.splice(idx, 1);
      }
    }
    blendShape = null;
    lastBlendPos = null;
    isDrawing = false;
    render();
    return;
  }

  // Handle pixelate brush ending
  if (state.tool === 'pixelate' && pixelateShape) {
    // Clean up empty shapes
    if (pixelateShape.pixels.length === 0) {
      const layer = getCurrentLayer();
      if (layer) {
        const idx = layer.shapes.indexOf(pixelateShape);
        if (idx !== -1) layer.shapes.splice(idx, 1);
      }
    }
    pixelateShape = null;
    lastPixelatePos = null;
    isDrawing = false;
    render();
    return;
  }

  if (!isDrawing) return;

  isDrawing = false;

  // Handle click-to-place for shape tools
  if (CLICK_PLACE_TOOLS.includes(state.tool) && currentShape) {
    if (isDragging) {
      // User dragged - complete shape normally
      const layer = getCurrentLayer();
      if (layer && shouldAddShape(currentShape)) {
        saveHistory();
        layer.shapes.push(currentShape);
      }
      exitClickPlaceMode();
    } else {
      // User just clicked - enter click-place mode
      enterClickPlaceMode(state.tool, startPos.x, startPos.y);
      // Draw a dot at first point for line tool
      if (state.tool === 'line') {
        const layer = getCurrentLayer();
        if (layer) {
          saveHistory();
          clickPlaceStartShapeIndex = layer.shapes.length;  // Track index before push
          layer.shapes.push(createPointShape(startPos.x, startPos.y));
        }
      }
    }
    currentShape = null;
    pathPoints = [];
    startPos = null;
    isDragging = false;
    renderWithPreview();
    return;
  }

  // Lasso uses click-place mode - don't finalize on mouseup
  if (state.tool === 'lasso' && clickPlaceMode && clickPlaceTool === 'lasso') {
    return;
  }

  if (currentShape) {
    const layer = getCurrentLayer();
    if (layer) {
      // Only add shape if it has some size
      if (shouldAddShape(currentShape)) {
        saveHistory(); // Save BEFORE adding the shape
        layer.shapes.push(currentShape);
      }
    }
  }

  currentShape = null;
  pathPoints = [];
  startPos = null;

  render();
}

// Check if shape should be added (has valid dimensions)
function shouldAddShape(shape) {
  switch (shape.type) {
    case 'path':
      // Allow single-point paths (dots) - just need at least 1 point
      return shape.points && shape.points.length >= 1;
    case 'line':
      return shape.x1 !== shape.x2 || shape.y1 !== shape.y2;
    case 'rect':
      return shape.width > 0 && shape.height > 0;
    case 'circle':
      return shape.radius > 0;
    case 'ellipse':
      return shape.radiusX > 0 || shape.radiusY > 0;
    default:
      return true;
  }
}

// Render canvas with current drawing preview
function renderWithPreview() {
  render();

  const ctx = getContext();

  // Draw marquee selection preview
  if (isMarqueeSelecting && marqueeStart && marqueeEnd) {
    drawMarqueePreview(ctx);
  }

  // Draw click-place start point indicator
  if (clickPlaceMode && clickPlaceStart) {
    drawClickPlaceMarker(ctx, clickPlaceStart.x, clickPlaceStart.y);
  }

  if (currentShape) {
    drawPreviewShape(ctx, currentShape);
  }
}

// Draw marquee selection preview rectangle
function drawMarqueePreview(ctx) {
  const x = Math.min(marqueeStart.x, marqueeEnd.x);
  const y = Math.min(marqueeStart.y, marqueeEnd.y);
  const w = Math.abs(marqueeEnd.x - marqueeStart.x);
  const h = Math.abs(marqueeEnd.y - marqueeStart.y);

  ctx.save();

  // Dashed rectangle outline
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);

  // Semi-transparent fill
  ctx.fillStyle = 'rgba(0, 170, 255, 0.1)';
  ctx.fillRect(x, y, w, h);

  // Size indicator
  if (w > 20 && h > 20) {
    ctx.setLineDash([]);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#00aaff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${w}×${h}`, x + 4, y + 4);
  }

  ctx.restore();
}

// Draw marker at click-place start point (1px crosshair, always crisp)
function drawClickPlaceMarker(ctx, x, y) {
  ctx.save();

  const color = state.strokeColor;
  const px = Math.round(x);
  const py = Math.round(y);

  // 1px crosshair using fillRect (always pixel-perfect)
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  // Horizontal line with gap
  for (let i = -8; i <= 8; i++) {
    if (Math.abs(i) > 2) ctx.fillRect(px + i, py, 1, 1);
  }
  // Vertical line with gap
  for (let i = -8; i <= 8; i++) {
    if (Math.abs(i) > 2) ctx.fillRect(px, py + i, 1, 1);
  }
  // Center pixel
  ctx.globalAlpha = 1;
  ctx.fillRect(px, py, 1, 1);

  ctx.restore();
}

// Draw shape preview - reuses drawShapeToContext with transparency
function drawPreviewShape(ctx, shape) {
  ctx.save();
  ctx.globalAlpha = 0.7; // Preview at 70% opacity
  drawShapeToContext(ctx, shape);
  ctx.restore();

  // Draw measurement info
  drawShapeMeasurement(ctx, shape);
}

// Get measurement info for a shape (reusable for status bar, tooltips, etc.)
function getShapeMeasurement(shape) {
  switch (shape.type) {
    case 'line':
      const dx = shape.x2 - shape.x1;
      const dy = shape.y2 - shape.y1;
      const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
      const length = Math.sqrt(dx * dx + dy * dy);
      return {
        text: `${angle.toFixed(1)}° ${length.toFixed(0)}px`,
        x: shape.x2 + 5,
        y: shape.y2 - 5
      };
    case 'circle':
      return {
        text: `r: ${shape.radius.toFixed(0)}px`,
        x: shape.x + shape.radius + 5,
        y: shape.y
      };
    case 'ellipse':
      return {
        text: `${shape.radiusX.toFixed(0)} × ${shape.radiusY.toFixed(0)}`,
        x: shape.x + shape.radiusX + 5,
        y: shape.y
      };
    case 'rect':
      return {
        text: `${Math.abs(shape.width).toFixed(0)} × ${Math.abs(shape.height).toFixed(0)}`,
        x: shape.x + shape.width + 5,
        y: shape.y + shape.height
      };
    default:
      return null;
  }
}

// Draw text label with drop shadow (reusable for any overlay text)
function drawLabel(ctx, text, x, y, style = OVERLAY_STYLES.label) {
  ctx.save();
  ctx.font = style.font;
  ctx.textBaseline = 'middle';

  // Drop shadow
  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = style.shadowBlur;
  ctx.shadowOffsetX = style.shadowOffsetX;
  ctx.shadowOffsetY = style.shadowOffsetY;

  // Text
  ctx.fillStyle = style.textColor;
  ctx.fillText(text, x, y);

  ctx.restore();
}

// Draw measurement overlay for shape preview
function drawShapeMeasurement(ctx, shape) {
  const measurement = getShapeMeasurement(shape);
  if (measurement) {
    drawLabel(ctx, measurement.text, measurement.x, measurement.y);
  }
}

// Pick color from canvas
function pickColor(pos) {
  const ctx = getContext();
  const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
  const hex = '#' + [pixel[0], pixel[1], pixel[2]]
    .map(c => c.toString(16).padStart(2, '0'))
    .join('');

  // Check if we're picking for target color (lasso tool)
  if (state._pickingForTargetColor) {
    selection.addTargetColor(hex, state.lassoTolerance || 32);
    state._pickingForTargetColor = false;

    // Return to lasso tool
    if (state._returnToLassoAfterPick) {
      state._returnToLassoAfterPick = false;
      state.tool = 'lasso';
      // Update toolbar UI and trigger re-selection
      document.dispatchEvent(new CustomEvent('toolChanged', { detail: { tool: 'lasso' } }));
      document.dispatchEvent(new CustomEvent('targetColorsChanged'));
    }
    return;
  }

  state.strokeColor = hex;
  document.getElementById('strokeColor').value = hex;
}

// Check if currently drawing
export function isCurrentlyDrawing() {
  return isDrawing;
}

// Cancel current drawing
export function cancelDraw() {
  isDrawing = false;
  currentShape = null;
  pathPoints = [];
  startPos = null;
  exitClickPlaceMode();
  render();
}

// Cancel click-place mode (called by ESC, right-click, tool switch)
export function cancelClickPlaceMode() {
  exitClickPlaceMode(true);  // Remove the starting dot
  render();
}

// Check if in click-place mode
export function isInClickPlaceMode() {
  return clickPlaceMode;
}

// Undo last lasso point (for right-click in polygon mode)
// Returns true if a point was removed, false if should cancel entirely
export function undoLastLassoPoint() {
  if (!clickPlaceMode || clickPlaceTool !== 'lasso' || lassoPoints.length === 0) {
    return false;
  }

  // Remove the last point
  lassoPoints.pop();

  // If no points left, exit click-place mode
  if (lassoPoints.length === 0) {
    exitClickPlaceMode(true);
    return true;
  }

  // Update the preview
  updateLassoPreview();
  render();
  return true;
}

// Get click-place start position (for drawing indicator)
export function getClickPlaceStart() {
  return clickPlaceStart;
}

// Get current click-place tool
export function getClickPlaceTool() {
  return clickPlaceTool;
}

// Drag selected shape
export function dragShape(e) {
  if (!state.isDraggingShape || state.selectedShapeIndex === null) return;

  const layer = getCurrentLayer();
  if (!layer) return;

  const shape = layer.shapes[state.selectedShapeIndex];
  if (!shape) return;

  const pos = getCanvasPosition(e);
  const dx = pos.x - state.dragStartX;
  const dy = pos.y - state.dragStartY;

  // Apply offset based on shape type
  if (shape.type === 'line') {
    shape.x1 = state.dragOrigX + dx;
    shape.y1 = state.dragOrigY + dy;
    shape.x2 = state.dragOrigX2 + dx;
    shape.y2 = state.dragOrigY2 + dy;
  } else if (shape.type === 'path' && state.dragOrigPoints) {
    for (let i = 0; i < shape.points.length; i++) {
      shape.points[i].x = state.dragOrigPoints[i].x + dx;
      shape.points[i].y = state.dragOrigPoints[i].y + dy;
    }
  } else {
    shape.x = state.dragOrigX + dx;
    shape.y = state.dragOrigY + dy;
  }

  render();
}

// Resize selected shape by dragging handle
export function resizeShape(e) {
  if (!state.isResizingShape || state.selectedShapeIndex === null) return;

  const layer = getCurrentLayer();
  if (!layer) return;

  const shape = layer.shapes[state.selectedShapeIndex];
  if (!shape || shape.type !== 'image') return;

  const pos = getCanvasPosition(e);
  const dx = pos.x - state.dragStartX;
  const dy = pos.y - state.dragStartY;
  const handle = state.resizeHandle;

  let newX = state.dragOrigX;
  let newY = state.dragOrigY;
  let newW = state.dragOrigWidth;
  let newH = state.dragOrigHeight;

  // Apply resize based on which handle is being dragged
  switch (handle) {
    case 'nw':
      newX = state.dragOrigX + dx;
      newY = state.dragOrigY + dy;
      newW = state.dragOrigWidth - dx;
      newH = state.dragOrigHeight - dy;
      break;
    case 'ne':
      newY = state.dragOrigY + dy;
      newW = state.dragOrigWidth + dx;
      newH = state.dragOrigHeight - dy;
      break;
    case 'sw':
      newX = state.dragOrigX + dx;
      newW = state.dragOrigWidth - dx;
      newH = state.dragOrigHeight + dy;
      break;
    case 'se':
      newW = state.dragOrigWidth + dx;
      newH = state.dragOrigHeight + dy;
      break;
    case 'n':
      newY = state.dragOrigY + dy;
      newH = state.dragOrigHeight - dy;
      break;
    case 's':
      newH = state.dragOrigHeight + dy;
      break;
    case 'w':
      newX = state.dragOrigX + dx;
      newW = state.dragOrigWidth - dx;
      break;
    case 'e':
      newW = state.dragOrigWidth + dx;
      break;
  }

  // Enforce minimum size
  if (newW >= 10) {
    shape.x = newX;
    shape.width = newW;
  }
  if (newH >= 10) {
    shape.y = newY;
    shape.height = newH;
  }

  render();
}

// End shape resize
export function endResizeShape() {
  if (!state.isResizingShape) return;

  const layer = getCurrentLayer();
  if (layer && state.selectedShapeIndex !== null) {
    const shape = layer.shapes[state.selectedShapeIndex];
    if (shape && (shape.width !== state.dragOrigWidth || shape.height !== state.dragOrigHeight)) {
      saveHistory();
    }
  }

  state.isResizingShape = false;
  state.resizeHandle = null;
}

// Check if currently resizing
export function isResizing() {
  return state.isResizingShape;
}

// Check if shape moved during drag
function shapeMovedDuringDrag(shape) {
  if (shape.type === 'line') {
    return shape.x1 !== state.dragOrigX || shape.y1 !== state.dragOrigY;
  } else if (shape.type === 'path' && state.dragOrigPoints && shape.points.length > 0) {
    return shape.points[0].x !== state.dragOrigPoints[0].x || shape.points[0].y !== state.dragOrigPoints[0].y;
  }
  return shape.x !== state.dragOrigX || shape.y !== state.dragOrigY;
}

// End shape drag
export function endDragShape() {
  if (!state.isDraggingShape) return;

  const layer = getCurrentLayer();
  if (layer && state.selectedShapeIndex !== null) {
    const shape = layer.shapes[state.selectedShapeIndex];
    // Only save history if position actually changed
    if (shape && shapeMovedDuringDrag(shape)) {
      saveHistory();
    }
  }

  state.isDraggingShape = false;
}

// Get the selected shape
export function getSelectedShape() {
  if (state.selectedShapeIndex === null) return null;
  const layer = getCurrentLayer();
  if (!layer) return null;
  return layer.shapes[state.selectedShapeIndex] || null;
}

// Clear shape selection
export function clearShapeSelection() {
  state.selectedShapeIndex = null;
  state.isDraggingShape = false;
}

// Delete selected shape
export function deleteSelectedShape() {
  if (state.selectedShapeIndex === null) return false;
  const layer = getCurrentLayer();
  if (!layer) return false;

  saveHistory();
  layer.shapes.splice(state.selectedShapeIndex, 1);
  state.selectedShapeIndex = null;
  render();
  return true;
}

// Update selected shape property
export function updateSelectedShape(property, value) {
  const shape = getSelectedShape();
  if (!shape) return false;

  saveHistory();
  shape[property] = value;
  render();
  return true;
}

// Edge fill reference points
export function getEdgeFillRefPoints() {
  return edgeFillRefPoints;
}

export function clearEdgeFillRefPoints() {
  edgeFillRefPoints = [];
}
