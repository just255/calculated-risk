// ═══════════════════════════════════════════════════════════════
// INSIGNIA PIXEL ENGINE — Pixel drawing tools for 96x96 insignia canvas
// Adapted from sprite-editor drawing algorithms.
// Pure drawing logic: operates on ImageData buffers directly.
// ═══════════════════════════════════════════════════════════════

const W = 96;   // Canvas width
const H = 96;   // Canvas height
const MAX_HISTORY = 30;

// ─── Color Utilities ────────────────────────────────────────

/** Parse hex color string to {r, g, b} or null */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16)
  } : null;
}

/** Check if two pixel colors match within tolerance */
function colorMatches(r1, g1, b1, a1, r2, g2, b2, a2, tol) {
  if (a1 < 10 && a2 < 10) return true;
  if (a1 < 10 || a2 < 10) return false;
  return (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) <= tol * 3;
}

// ─── Pixel Manipulation ────────────────────────────────────

/** Set a single pixel in ImageData (bounds-checked) */
function setPixel(imgData, x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  imgData.data[i]     = r;
  imgData.data[i + 1] = g;
  imgData.data[i + 2] = b;
  imgData.data[i + 3] = a;
}

/** Get pixel RGBA from ImageData */
function getPixel(imgData, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return [0, 0, 0, 0];
  const i = (y * W + x) * 4;
  return [imgData.data[i], imgData.data[i + 1], imgData.data[i + 2], imgData.data[i + 3]];
}

/** Plot a brush stamp (square block of size×size pixels) */
function plotBrush(imgData, cx, cy, size, r, g, b, a) {
  const offset = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      setPixel(imgData, cx - offset + dx, cy - offset + dy, r, g, b, a);
    }
  }
}

/** Erase a brush stamp (set alpha to 0) */
function eraseBrush(imgData, cx, cy, size) {
  const offset = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      setPixel(imgData, cx - offset + dx, cy - offset + dy, 0, 0, 0, 0);
    }
  }
}

// ─── Shape Algorithms (Bresenham / Midpoint) ────────────────

/**
 * Bresenham line from (x0,y0) to (x1,y1).
 * Calls plotFn(x, y) for each point along the line.
 */
function bresenhamLine(x0, y0, x1, y1, plotFn) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    plotFn(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/**
 * Midpoint circle algorithm.
 * Calls plotFn(x, y) for each point on the circle.
 */
function midpointCircle(cx, cy, radius, plotFn) {
  let x = 0, y = Math.round(radius);
  let d = 1 - Math.round(radius);
  while (x <= y) {
    plotFn(cx + x, cy + y); plotFn(cx - x, cy + y);
    plotFn(cx + x, cy - y); plotFn(cx - x, cy - y);
    plotFn(cx + y, cy + x); plotFn(cx - y, cy + x);
    plotFn(cx + y, cy - x); plotFn(cx - y, cy - x);
    x++;
    if (d < 0) { d += 2 * x + 1; }
    else { y--; d += 2 * (x - y) + 1; }
  }
}

/**
 * Midpoint ellipse algorithm (two regions).
 * Calls plotFn(x, y) for each point on the ellipse.
 */
function midpointEllipse(cx, cy, rx, ry, plotFn) {
  rx = Math.round(rx); ry = Math.round(ry);
  if (rx === 0 || ry === 0) return;
  let x = 0, y = ry;
  let rx2 = rx * rx, ry2 = ry * ry;
  let p1 = ry2 - rx2 * ry + 0.25 * rx2;
  // Region 1
  while (ry2 * x < rx2 * y) {
    plotFn(cx + x, cy + y); plotFn(cx - x, cy + y);
    plotFn(cx + x, cy - y); plotFn(cx - x, cy - y);
    x++;
    if (p1 < 0) { p1 += 2 * ry2 * x + ry2; }
    else { y--; p1 += 2 * ry2 * x - 2 * rx2 * y + ry2; }
  }
  // Region 2
  let p2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
  while (y >= 0) {
    plotFn(cx + x, cy + y); plotFn(cx - x, cy + y);
    plotFn(cx + x, cy - y); plotFn(cx - x, cy - y);
    y--;
    if (p2 > 0) { p2 -= 2 * rx2 * y + rx2; }
    else { x++; p2 += 2 * ry2 * x - 2 * rx2 * y + rx2; }
  }
}

// ─── Drawing Tools ──────────────────────────────────────────

/**
 * Draw a line on the ImageData buffer.
 * @param {ImageData} imgData
 * @param {number} x0, y0, x1, y1 — endpoints
 * @param {number} size — brush diameter
 * @param {{r,g,b}} rgb — color
 */
export function drawLine(imgData, x0, y0, x1, y1, size, rgb) {
  bresenhamLine(x0, y0, x1, y1, (x, y) => {
    plotBrush(imgData, x, y, size, rgb.r, rgb.g, rgb.b, 255);
  });
}

/**
 * Erase along a line on the ImageData buffer.
 */
export function eraseLine(imgData, x0, y0, x1, y1, size) {
  bresenhamLine(x0, y0, x1, y1, (x, y) => {
    eraseBrush(imgData, x, y, size);
  });
}

/**
 * Draw a rectangle outline.
 */
export function drawRect(imgData, x, y, w, h, size, rgb) {
  const x2 = x + w, y2 = y + h;
  drawLine(imgData, x, y, x2, y, size, rgb);
  drawLine(imgData, x2, y, x2, y2, size, rgb);
  drawLine(imgData, x2, y2, x, y2, size, rgb);
  drawLine(imgData, x, y2, x, y, size, rgb);
}

/**
 * Draw a filled rectangle.
 */
export function fillRect(imgData, x, y, w, h, rgb) {
  const x1 = Math.min(x, x + w), y1 = Math.min(y, y + h);
  const x2 = Math.max(x, x + w), y2 = Math.max(y, y + h);
  for (let py = y1; py <= y2; py++) {
    for (let px = x1; px <= x2; px++) {
      setPixel(imgData, px, py, rgb.r, rgb.g, rgb.b, 255);
    }
  }
}

/**
 * Draw a circle outline.
 */
export function drawCircle(imgData, cx, cy, radius, size, rgb) {
  midpointCircle(cx, cy, radius, (x, y) => {
    plotBrush(imgData, x, y, size, rgb.r, rgb.g, rgb.b, 255);
  });
}

/**
 * Draw a filled circle.
 */
export function fillCircle(imgData, cx, cy, radius, rgb) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        setPixel(imgData, cx + dx, cy + dy, rgb.r, rgb.g, rgb.b, 255);
      }
    }
  }
}

/**
 * Draw an ellipse outline.
 */
export function drawEllipse(imgData, cx, cy, rx, ry, size, rgb) {
  midpointEllipse(cx, cy, rx, ry, (x, y) => {
    plotBrush(imgData, x, y, size, rgb.r, rgb.g, rgb.b, 255);
  });
}

/**
 * Draw a filled ellipse.
 */
export function fillEllipse(imgData, cx, cy, rx, ry, rgb) {
  rx = Math.round(rx); ry = Math.round(ry);
  if (rx === 0 || ry === 0) return;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        setPixel(imgData, cx + dx, cy + dy, rgb.r, rgb.g, rgb.b, 255);
      }
    }
  }
}

/**
 * Flood fill from (startX, startY) with the given color.
 * 4-connected stack-based algorithm.
 * @param {ImageData} imgData
 * @param {number} startX, startY — seed point
 * @param {{r,g,b}} rgb — fill color
 * @param {number} [tolerance=0] — color matching tolerance (0-255)
 * @returns {number} — number of pixels filled
 */
export function floodFill(imgData, startX, startY, rgb, tolerance = 0) {
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= W || startY < 0 || startY >= H) return 0;

  const pixels = imgData.data;
  const ti = (startY * W + startX) * 4;
  const tR = pixels[ti], tG = pixels[ti + 1], tB = pixels[ti + 2], tA = pixels[ti + 3];

  // Don't fill if target is same as fill color
  if (tR === rgb.r && tG === rgb.g && tB === rgb.b && tA === 255) return 0;

  const visited = new Uint8Array(W * H);
  const stack = [[startX, startY]];
  let count = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const idx = y * W + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const pi = idx * 4;
    if (!colorMatches(pixels[pi], pixels[pi + 1], pixels[pi + 2], pixels[pi + 3],
                      tR, tG, tB, tA, tolerance)) continue;

    // Fill this pixel
    pixels[pi]     = rgb.r;
    pixels[pi + 1] = rgb.g;
    pixels[pi + 2] = rgb.b;
    pixels[pi + 3] = 255;
    count++;

    // 4-connected neighbors
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return count;
}

/**
 * Spray dots around (cx, cy) with Gaussian distribution.
 * Draws directly into the ImageData buffer.
 * @param {ImageData} imgData
 * @param {number} cx, cy — center position
 * @param {number} radius — spray radius
 * @param {number} density — number of dots per spray
 * @param {{r,g,b}} rgb — color
 */
export function sprayDots(imgData, cx, cy, radius, density, rgb) {
  for (let i = 0; i < density; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Box-Muller Gaussian approximation
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2);
    const dist = Math.min(radius, Math.abs(gaussian) / 3 * radius);
    const x = Math.round(cx + Math.cos(angle) * dist);
    const y = Math.round(cy + Math.sin(angle) * dist);
    setPixel(imgData, x, y, rgb.r, rgb.g, rgb.b, 255);
  }
}

/**
 * Blend brush — averages colors within a circular region.
 * @param {ImageData} imgData
 * @param {number} cx, cy — center
 * @param {number} radius — blend radius
 * @param {number} [hardness=50] — 0-100, how strongly pixels move toward the average
 */
export function blendAt(imgData, cx, cy, radius, hardness = 50) {
  const pixels = imgData.data;
  const collected = [];

  // Collect opaque pixels in radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = cx + dx, py = cy + dy;
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const i = (py * W + px) * 4;
      if (pixels[i + 3] < 128) continue;
      collected.push({ x: px, y: py, r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] });
    }
  }

  if (collected.length < 2) return;

  // Average
  let avgR = 0, avgG = 0, avgB = 0;
  for (const p of collected) { avgR += p.r; avgG += p.g; avgB += p.b; }
  const n = collected.length;
  avgR = Math.round(avgR / n);
  avgG = Math.round(avgG / n);
  avgB = Math.round(avgB / n);

  // Apply blend
  const f = hardness / 100;
  for (const p of collected) {
    const i = (p.y * W + p.x) * 4;
    pixels[i]     = Math.round(p.r * (1 - f) + avgR * f);
    pixels[i + 1] = Math.round(p.g * (1 - f) + avgG * f);
    pixels[i + 2] = Math.round(p.b * (1 - f) + avgB * f);
  }
}

// ─── Undo / Redo ────────────────────────────────────────────

/**
 * Save a snapshot of the current pixel data for undo.
 * Call BEFORE making changes.
 * @param {object} editor — InsigniaEditor instance (has pixelData, pixelHistory, pixelRedoHistory, currentRank)
 */
export function pushUndo(editor) {
  const rank = editor.currentRank;
  const imgData = editor.getPixelData(rank);

  if (!editor.pixelHistory[rank]) editor.pixelHistory[rank] = [];
  if (!editor.pixelRedoHistory[rank]) editor.pixelRedoHistory[rank] = [];

  // Clone the current ImageData
  const snap = new ImageData(new Uint8ClampedArray(imgData.data), W, H);
  editor.pixelHistory[rank].push(snap);

  // Clear redo stack (new action invalidates redo)
  editor.pixelRedoHistory[rank] = [];

  // Limit history size
  if (editor.pixelHistory[rank].length > MAX_HISTORY) {
    editor.pixelHistory[rank].shift();
  }
}

/**
 * Undo: restore previous snapshot.
 * @returns {boolean} true if undo succeeded
 */
export function undo(editor) {
  const rank = editor.currentRank;
  const history = editor.pixelHistory[rank];
  if (!history || history.length === 0) return false;

  // Save current state to redo
  const imgData = editor.getPixelData(rank);
  if (!editor.pixelRedoHistory[rank]) editor.pixelRedoHistory[rank] = [];
  editor.pixelRedoHistory[rank].push(new ImageData(new Uint8ClampedArray(imgData.data), W, H));

  // Restore
  const snap = history.pop();
  imgData.data.set(snap.data);
  return true;
}

/**
 * Redo: restore next snapshot.
 * @returns {boolean} true if redo succeeded
 */
export function redo(editor) {
  const rank = editor.currentRank;
  const redoStack = editor.pixelRedoHistory[rank];
  if (!redoStack || redoStack.length === 0) return false;

  // Save current state to undo (without clearing redo)
  const imgData = editor.getPixelData(rank);
  if (!editor.pixelHistory[rank]) editor.pixelHistory[rank] = [];
  editor.pixelHistory[rank].push(new ImageData(new Uint8ClampedArray(imgData.data), W, H));

  // Restore
  const snap = redoStack.pop();
  imgData.data.set(snap.data);
  return true;
}

// ─── Tool Interaction State Machine ─────────────────────────

let _drawing = false;
let _startX = 0, _startY = 0;
let _lastX = 0, _lastY = 0;
let _previewCanvas = null;   // OffscreenCanvas for shape preview during drag
let _previewData = null;     // Snapshot taken at stroke start for shape tools

/**
 * Convert mouse/touch event to pixel coordinates on the 96x96 canvas.
 * @param {HTMLCanvasElement} canvas — the insignia canvas element
 * @param {MouseEvent|Touch} e
 * @returns {{x: number, y: number}}
 */
export function canvasToPixel(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * scaleX),
    y: Math.floor((e.clientY - rect.top) * scaleY)
  };
}

/**
 * Begin a drawing stroke.
 * @param {object} editor — InsigniaEditor
 * @param {number} x, y — pixel coords on 96x96 canvas
 */
export function strokeStart(editor, x, y) {
  _drawing = true;
  _startX = x; _startY = y;
  _lastX = x; _lastY = y;

  const imgData = editor.getPixelData(editor.currentRank);
  const rgb = hexToRgb(editor.toolColor);
  if (!rgb) return;
  const size = editor.brushSize;

  switch (editor.activeTool) {
    case 'pencil':
      pushUndo(editor);
      plotBrush(imgData, x, y, size, rgb.r, rgb.g, rgb.b, 255);
      break;

    case 'eraser':
      pushUndo(editor);
      eraseBrush(imgData, x, y, size);
      break;

    case 'spray':
      pushUndo(editor);
      sprayDots(imgData, x, y, Math.max(3, size * 2), Math.ceil(size * 2), rgb);
      break;

    case 'blend':
      pushUndo(editor);
      blendAt(imgData, x, y, Math.max(2, size), 50);
      break;

    case 'fill':
      pushUndo(editor);
      floodFill(imgData, x, y, rgb);
      break;

    case 'line':
    case 'rect':
    case 'circle':
    case 'ellipse':
      // Shape tools: save snapshot for preview restoration
      pushUndo(editor);
      _previewData = new ImageData(new Uint8ClampedArray(imgData.data), W, H);
      break;
  }
}

/**
 * Continue a drawing stroke (mouse/touch move).
 * @param {object} editor
 * @param {number} x, y — pixel coords
 */
export function strokeMove(editor, x, y) {
  if (!_drawing) return;

  const imgData = editor.getPixelData(editor.currentRank);
  const rgb = hexToRgb(editor.toolColor);
  if (!rgb) return;
  const size = editor.brushSize;

  switch (editor.activeTool) {
    case 'pencil':
      // Draw line from last position to current for smooth freehand
      drawLine(imgData, _lastX, _lastY, x, y, size, rgb);
      break;

    case 'eraser':
      eraseLine(imgData, _lastX, _lastY, x, y, size);
      break;

    case 'spray':
      sprayDots(imgData, x, y, Math.max(3, size * 2), Math.ceil(size * 2), rgb);
      break;

    case 'blend':
      blendAt(imgData, x, y, Math.max(2, size), 50);
      break;

    case 'line':
      // Restore from snapshot, then draw preview line
      imgData.data.set(_previewData.data);
      drawLine(imgData, _startX, _startY, x, y, size, rgb);
      break;

    case 'rect': {
      imgData.data.set(_previewData.data);
      const rx = Math.min(_startX, x), ry = Math.min(_startY, y);
      const rw = Math.abs(x - _startX), rh = Math.abs(y - _startY);
      drawRect(imgData, rx, ry, rw, rh, size, rgb);
      break;
    }

    case 'circle': {
      imgData.data.set(_previewData.data);
      const dx = x - _startX, dy = y - _startY;
      const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
      drawCircle(imgData, _startX, _startY, radius, size, rgb);
      break;
    }

    case 'ellipse': {
      imgData.data.set(_previewData.data);
      const rx = Math.abs(x - _startX);
      const ry = Math.abs(y - _startY);
      drawEllipse(imgData, _startX, _startY, rx, ry, size, rgb);
      break;
    }
  }

  _lastX = x;
  _lastY = y;
}

/**
 * End a drawing stroke (mouse/touch up).
 * @param {object} editor
 * @param {number} x, y — pixel coords
 */
export function strokeEnd(editor, x, y) {
  if (!_drawing) return;
  _drawing = false;

  // For shape tools, the final shape is already drawn via strokeMove.
  // For fill, it was applied on strokeStart.
  // Clean up preview state.
  _previewData = null;
}

/** Whether a stroke is currently in progress */
export function isDrawing() { return _drawing; }

// ─── Utility Exports ────────────────────────────────────────

export { hexToRgb, setPixel, getPixel, W, H };
