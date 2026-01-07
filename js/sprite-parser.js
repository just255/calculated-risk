// Sprite Parser - Convert between editor shapes and SVG
// Handles import from constants.js sprites and export to SVG format

/**
 * Convert editor shapes to SVG string
 * @param {Array} shapes - Array of shape objects from editor
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {string} SVG string
 */
export function shapesToSvg(shapes, width, height) {
  const elements = shapes.map(shape => shapeToSvgElement(shape)).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${elements}
</svg>`;
}

/**
 * Convert a single shape to SVG element string
 * @param {Object} shape - Shape object
 * @returns {string} SVG element string
 */
function shapeToSvgElement(shape) {
  const partAttr = shape.part ? ` data-part="${shape.part}"` : '';
  const fillAttr = shape.fill ? ` fill="${shape.fill}"` : ' fill="none"';
  const strokeAttr = shape.stroke ? ` stroke="${shape.stroke}"` : '';
  const strokeWidthAttr = shape.strokeWidth ? ` stroke-width="${shape.strokeWidth}"` : '';
  const baseAttrs = `${fillAttr}${strokeAttr}${strokeWidthAttr}${partAttr}`;

  switch (shape.type) {
    case 'line':
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}"${baseAttrs} stroke-linecap="round"/>`;

    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"${baseAttrs}/>`;

    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"${baseAttrs}/>`;

    case 'ellipse':
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"${baseAttrs}/>`;

    case 'path':
      const d = shape.points.map((p, i) =>
        i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`
      ).join(' ');
      return `<path d="${d}"${baseAttrs} stroke-linecap="round" stroke-linejoin="round"/>`;

    default:
      return '';
  }
}

/**
 * Parse SVG string to editor shapes
 * @param {string} svgString - SVG string to parse
 * @returns {Object} { shapes: Array, width: number, height: number }
 */
export function svgToShapes(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    return { shapes: [], width: 64, height: 64 };
  }

  // Get dimensions from viewBox or width/height
  let width = 64, height = 64;
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const [, , w, h] = viewBox.split(/\s+/).map(Number);
    width = w || 64;
    height = h || 64;
  } else {
    width = parseFloat(svg.getAttribute('width')) || 64;
    height = parseFloat(svg.getAttribute('height')) || 64;
  }

  const shapes = [];

  // Parse all shape elements
  svg.querySelectorAll('line, rect, circle, ellipse, path, polygon, polyline').forEach(el => {
    const shape = svgElementToShape(el);
    if (shape) {
      shapes.push(shape);
    }
  });

  return { shapes, width, height };
}

/**
 * Convert SVG element to editor shape
 * @param {Element} el - SVG element
 * @returns {Object|null} Shape object or null
 */
function svgElementToShape(el) {
  const tag = el.tagName.toLowerCase();
  const part = el.getAttribute('data-part') || undefined;

  // Get common style attributes
  const stroke = el.getAttribute('stroke') || '#ffffff';
  const strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 2;
  const fill = el.getAttribute('fill');
  const fillValue = (fill && fill !== 'none') ? fill : null;

  const base = {
    stroke,
    strokeWidth,
    fill: fillValue,
    part
  };

  switch (tag) {
    case 'line':
      return {
        type: 'line',
        x1: parseFloat(el.getAttribute('x1')) || 0,
        y1: parseFloat(el.getAttribute('y1')) || 0,
        x2: parseFloat(el.getAttribute('x2')) || 0,
        y2: parseFloat(el.getAttribute('y2')) || 0,
        ...base
      };

    case 'rect':
      return {
        type: 'rect',
        x: parseFloat(el.getAttribute('x')) || 0,
        y: parseFloat(el.getAttribute('y')) || 0,
        w: parseFloat(el.getAttribute('width')) || 0,
        h: parseFloat(el.getAttribute('height')) || 0,
        ...base
      };

    case 'circle':
      return {
        type: 'circle',
        cx: parseFloat(el.getAttribute('cx')) || 0,
        cy: parseFloat(el.getAttribute('cy')) || 0,
        r: parseFloat(el.getAttribute('r')) || 0,
        ...base
      };

    case 'ellipse':
      return {
        type: 'ellipse',
        cx: parseFloat(el.getAttribute('cx')) || 0,
        cy: parseFloat(el.getAttribute('cy')) || 0,
        rx: parseFloat(el.getAttribute('rx')) || 0,
        ry: parseFloat(el.getAttribute('ry')) || 0,
        ...base
      };

    case 'path':
      const d = el.getAttribute('d') || '';
      const points = parsePathD(d);
      if (points.length > 0) {
        return {
          type: 'path',
          points,
          ...base
        };
      }
      return null;

    case 'polygon':
    case 'polyline':
      const pointsAttr = el.getAttribute('points') || '';
      const polyPoints = parsePolyPoints(pointsAttr);
      if (polyPoints.length > 0) {
        return {
          type: 'path',
          points: polyPoints,
          ...base
        };
      }
      return null;

    default:
      return null;
  }
}

/**
 * Parse SVG path d attribute to array of points
 * Only handles simple M/L/H/V commands for now
 * @param {string} d - Path d attribute
 * @returns {Array} Array of {x, y} points
 */
function parsePathD(d) {
  const points = [];
  let currentX = 0, currentY = 0;

  // Simple regex-based parser for basic path commands
  const commands = d.match(/[MLHVZmlhvz][^MLHVZmlhvz]*/gi) || [];

  for (const cmd of commands) {
    const type = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    switch (type) {
      case 'M': // Move to absolute
        currentX = coords[0] || 0;
        currentY = coords[1] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'm': // Move to relative
        currentX += coords[0] || 0;
        currentY += coords[1] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'L': // Line to absolute
        currentX = coords[0] || 0;
        currentY = coords[1] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'l': // Line to relative
        currentX += coords[0] || 0;
        currentY += coords[1] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'H': // Horizontal line absolute
        currentX = coords[0] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'h': // Horizontal line relative
        currentX += coords[0] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'V': // Vertical line absolute
        currentY = coords[0] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'v': // Vertical line relative
        currentY += coords[0] || 0;
        points.push({ x: currentX, y: currentY });
        break;
      case 'Z':
      case 'z':
        // Close path - optionally add first point again
        if (points.length > 0) {
          points.push({ x: points[0].x, y: points[0].y });
        }
        break;
    }
  }

  return points;
}

/**
 * Parse polygon/polyline points attribute
 * @param {string} pointsAttr - Points attribute value
 * @returns {Array} Array of {x, y} points
 */
function parsePolyPoints(pointsAttr) {
  const numbers = pointsAttr.trim().split(/[\s,]+/).map(Number);
  const points = [];

  for (let i = 0; i < numbers.length - 1; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }

  return points;
}

/**
 * Convert frames array to multiple SVG strings (for animation)
 * @param {Array} frames - Array of frame objects, each with shapes array
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Array} Array of SVG strings
 */
export function framesToSvgArray(frames, width, height) {
  return frames.map(frame => shapesToSvg(frame.shapes, width, height));
}

/**
 * Extract parts from shapes and group them
 * @param {Array} shapes - Array of shape objects
 * @returns {Object} Object with part names as keys and shape arrays as values
 */
export function groupShapesByPart(shapes) {
  const groups = {};

  shapes.forEach(shape => {
    const partName = shape.part || 'default';
    if (!groups[partName]) {
      groups[partName] = [];
    }
    groups[partName].push(shape);
  });

  return groups;
}

/**
 * Create a variant data structure from editor state
 * @param {Array} frames - Array of frame objects
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Object} Parts object for variant storage
 */
export function createVariantParts(frames, width, height) {
  // For simple sprites, just create a "main" part with all frames
  // For more complex sprites, could group by data-part attribute

  return {
    main: {
      pivot: { x: width / 2, y: height / 2 },
      offset: { x: 0, y: 0 },
      zIndex: 0,
      animation: frames.length > 1 ? { type: 'frames', fps: 12 } : { type: 'none' },
      frames: frames
    }
  };
}

/**
 * Render shapes to a canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} shapes - Array of shape objects
 */
export function renderShapesToCanvas(ctx, shapes) {
  shapes.forEach(shape => {
    ctx.strokeStyle = shape.stroke || '#ffffff';
    ctx.lineWidth = shape.strokeWidth || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.fill) {
      ctx.fillStyle = shape.fill;
    }

    ctx.beginPath();

    switch (shape.type) {
      case 'line':
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        break;
      case 'rect':
        ctx.rect(shape.x, shape.y, shape.w, shape.h);
        break;
      case 'circle':
        ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        break;
      case 'ellipse':
        ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
        break;
      case 'path':
        if (shape.points && shape.points.length > 0) {
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.forEach(p => ctx.lineTo(p.x, p.y));
        }
        break;
    }

    if (shape.fill) ctx.fill();
    ctx.stroke();
  });
}
