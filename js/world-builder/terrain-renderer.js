// ═══════════════════════════════════════════════════════════════
// TERRAIN RENDERER - Canvas-based terrain rendering
// Pre-renders terrain to a canvas texture for fast drawing
// ═══════════════════════════════════════════════════════════════

/**
 * Color palettes for each terrain type
 */
const TERRAIN_COLORS = {
  open: {
    base: '#5a5045',
    detail: ['#4a4035', '#6a6055', '#4a4035'],
    detailOpacity: [0.5, 0.4, 0.3]
  },
  grass: {
    base: '#4a6a3a',
    detail: ['#5a7a4a', '#5a8a4a', '#4a7040', '#3a6030'],
    detailOpacity: [0.6, 0.5, 0.6, 0.5]
  },
  brush: {
    base: '#2a4a1a',
    gradient: { inner: '#5a8a48', mid: '#4a7a38', outer: '#2a5a1a' },
    highlights: ['#5a9a52', '#6aaa62']
  },
  forest: {
    base: '#1e3a18',
    gradient: { inner: '#4a7a42', mid: '#3a6a32', outer: '#1e4a18' },
    highlights: ['#4a8a42', '#5a9a52']
  },
  high: {
    base: '#5a4a3a',
    gradient: { bottom: '#3a2a1a', mid: '#5a4a3a', top: '#7a6a58' },
    highlights: ['#6a5a48', '#7a6a58']
  },
  water: {
    base: '#1a4a65',
    gradient: { start: '#2a5a75', mid: '#1a4a65', end: '#2a5a75' },
    ripples: '#3a6a85'
  },
  trench: {
    base: '#6a5a45',
    ditch: '#2a1a0a',
    floor: '#4a3a25',
    wall: { top: '#5a4a35', bottom: '#3a2a1a' }
  },
  pillbox: {
    base: '#8a7a65',
    concrete: { light: '#8a8a8a', mid: '#6a6a6a', dark: '#3a3a3a' },
    slit: '#1a1a1a'
  }
};

/**
 * Draw a single terrain cell to a canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} type - Terrain type
 * @param {number} x - X position in pixels
 * @param {number} y - Y position in pixels
 * @param {number} size - Cell size in pixels
 * @param {Object} rng - Optional seeded RNG for consistent detail placement
 */
export function drawTerrainCell(ctx, type, x, y, size, rng = null) {
  const colors = TERRAIN_COLORS[type] || TERRAIN_COLORS.open;

  // Helper for random-ish values based on position
  const posRand = (i) => {
    if (rng) return rng.random();
    // Deterministic based on position
    return ((x * 31 + y * 17 + i * 13) % 100) / 100;
  };

  switch (type) {
    case 'open':
      drawOpen(ctx, x, y, size, colors, posRand);
      break;
    case 'grass':
      drawGrass(ctx, x, y, size, colors, posRand);
      break;
    case 'brush':
      drawBrush(ctx, x, y, size, colors, posRand);
      break;
    case 'forest':
      drawForest(ctx, x, y, size, colors, posRand);
      break;
    case 'high':
      drawHighGround(ctx, x, y, size, colors, posRand);
      break;
    case 'water':
      drawWater(ctx, x, y, size, colors, posRand);
      break;
    case 'trench':
      drawTrench(ctx, x, y, size, colors, posRand);
      break;
    case 'pillbox':
      drawPillbox(ctx, x, y, size, colors, posRand);
      break;
    default:
      drawOpen(ctx, x, y, size, TERRAIN_COLORS.open, posRand);
  }
}

function drawOpen(ctx, x, y, size, colors, rand) {
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  // Scatter some pebbles/dirt details
  const scale = size / 32;
  for (let i = 0; i < 5; i++) {
    const dx = rand(i * 2) * size;
    const dy = rand(i * 2 + 1) * size;
    const r = (1 + rand(i + 10)) * scale;
    ctx.fillStyle = colors.detail[i % colors.detail.length];
    ctx.globalAlpha = colors.detailOpacity[i % colors.detailOpacity.length];
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGrass(ctx, x, y, size, colors, rand) {
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  // Grass patches
  const scale = size / 32;
  for (let i = 0; i < 6; i++) {
    const dx = rand(i * 3) * size;
    const dy = rand(i * 3 + 1) * size;
    const rx = (2 + rand(i) * 2) * scale;
    const ry = (1.5 + rand(i + 1)) * scale;
    ctx.fillStyle = colors.detail[i % colors.detail.length];
    ctx.globalAlpha = colors.detailOpacity[i % colors.detailOpacity.length];
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBrush(ctx, x, y, size, colors, rand) {
  // Dark base
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  // Bush clusters with gradient effect
  const scale = size / 32;
  const gradient = ctx.createRadialGradient(
    x + size / 2, y + size / 2, 0,
    x + size / 2, y + size / 2, size / 2
  );
  gradient.addColorStop(0, colors.gradient.inner);
  gradient.addColorStop(0.5, colors.gradient.mid);
  gradient.addColorStop(1, colors.gradient.outer);

  // Draw multiple overlapping bushes
  for (let i = 0; i < 8; i++) {
    const bx = x + rand(i * 2) * size;
    const by = y + rand(i * 2 + 1) * size;
    const br = (8 + rand(i) * 6) * scale;

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlights
  for (let i = 0; i < 3; i++) {
    const hx = x + (0.2 + rand(i + 20) * 0.6) * size;
    const hy = y + (0.2 + rand(i + 21) * 0.6) * size;
    const hr = (3 + rand(i + 22) * 2) * scale;
    ctx.fillStyle = colors.highlights[i % 2];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawForest(ctx, x, y, size, colors, rand) {
  // Dark base
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  // Tree canopy with gradient
  const scale = size / 32;
  const gradient = ctx.createRadialGradient(
    x + size / 2, y + size / 2, 0,
    x + size / 2, y + size / 2, size / 2
  );
  gradient.addColorStop(0, colors.gradient.inner);
  gradient.addColorStop(0.5, colors.gradient.mid);
  gradient.addColorStop(1, colors.gradient.outer);

  // Dense tree canopy
  for (let i = 0; i < 10; i++) {
    const tx = x + rand(i * 2) * size;
    const ty = y + rand(i * 2 + 1) * size;
    const tr = (10 + rand(i) * 5) * scale;

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Canopy highlights
  for (let i = 0; i < 4; i++) {
    const hx = x + (0.15 + rand(i + 30) * 0.7) * size;
    const hy = y + (0.15 + rand(i + 31) * 0.7) * size;
    const hr = (3 + rand(i + 32) * 3) * scale;
    ctx.fillStyle = colors.highlights[i % 2];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHighGround(ctx, x, y, size, colors, rand) {
  // Rocky base
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  // Rock formations with vertical gradient
  const scale = size / 32;
  const gradient = ctx.createLinearGradient(x, y + size, x, y);
  gradient.addColorStop(0, colors.gradient.bottom);
  gradient.addColorStop(0.5, colors.gradient.mid);
  gradient.addColorStop(1, colors.gradient.top);

  // Rocky bumps
  for (let i = 0; i < 8; i++) {
    const rx = x + rand(i * 2) * size;
    const ry = y + rand(i * 2 + 1) * size;
    const rr = (8 + rand(i) * 6) * scale;

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rocky highlights
  for (let i = 0; i < 4; i++) {
    const hx = x + (0.2 + rand(i + 40) * 0.6) * size;
    const hy = y + (0.2 + rand(i + 41) * 0.6) * size;
    const hr = (3 + rand(i + 42) * 2) * scale;
    ctx.fillStyle = colors.highlights[i % 2];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawWater(ctx, x, y, size, colors, rand) {
  // Water gradient
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, colors.gradient.start);
  gradient.addColorStop(0.5, colors.gradient.mid);
  gradient.addColorStop(1, colors.gradient.end);

  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);

  // Water ripples/reflections
  const scale = size / 32;
  for (let i = 0; i < 2; i++) {
    const rx = x + (0.2 + rand(i + 50) * 0.6) * size;
    const ry = y + (0.2 + rand(i + 51) * 0.6) * size;
    ctx.fillStyle = colors.ripples;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(rx, ry, 5 * scale, 2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTrench(ctx, x, y, size, colors, rand) {
  // Base dirt
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  const scale = size / 32;

  // Trench ditch (dark center)
  ctx.fillStyle = colors.ditch;
  ctx.fillRect(x, y + 10 * scale, size, 12 * scale);

  // Trench floor
  ctx.fillStyle = colors.floor;
  ctx.fillRect(x, y + 14 * scale, size, 4 * scale);

  // Floor boards
  ctx.strokeStyle = '#3a2a15';
  ctx.lineWidth = 0.5 * scale;
  for (let i = 0; i < 5; i++) {
    const lx = x + (4 + i * 6) * scale;
    ctx.beginPath();
    ctx.moveTo(lx, y + 14 * scale);
    ctx.lineTo(lx, y + 18 * scale);
    ctx.stroke();
  }

  // Dirt mounds (sandbags effect)
  const wallGradient = ctx.createLinearGradient(x, y + 22 * scale, x, y + 10 * scale);
  wallGradient.addColorStop(0, colors.wall.bottom);
  wallGradient.addColorStop(1, colors.wall.top);
  ctx.fillStyle = wallGradient;

  // Top edge mounds
  for (let i = 0; i < 5; i++) {
    const mx = x + (3 + i * 7) * scale;
    ctx.beginPath();
    ctx.ellipse(mx, y + 10 * scale, 4 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bottom edge mounds
  for (let i = 0; i < 5; i++) {
    const mx = x + (1 + i * 7) * scale;
    ctx.beginPath();
    ctx.ellipse(mx, y + 22 * scale, 4 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPillbox(ctx, x, y, size, colors, rand) {
  // Base ground
  ctx.fillStyle = colors.base;
  ctx.fillRect(x, y, size, size);

  const scale = size / 32;
  const cx = x + size / 2;
  const cy = y + size / 2;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.moveTo(cx - 8 * scale + scale, cy + 10 * scale + scale);
  ctx.lineTo(cx + 8 * scale + scale, cy + 10 * scale + scale);
  ctx.lineTo(cx + 8 * scale + scale, cy - 4 * scale + scale);
  ctx.lineTo(cx + 4 * scale + scale, cy - 8 * scale + scale);
  ctx.lineTo(cx + scale, cy - 12 * scale + scale);
  ctx.lineTo(cx - 4 * scale + scale, cy - 8 * scale + scale);
  ctx.lineTo(cx - 8 * scale + scale, cy - 4 * scale + scale);
  ctx.closePath();
  ctx.fill();

  // Concrete walls
  const wallGradient = ctx.createLinearGradient(x, cy + 10 * scale, x, cy - 4 * scale);
  wallGradient.addColorStop(0, colors.concrete.dark);
  wallGradient.addColorStop(1, colors.concrete.mid);
  ctx.fillStyle = wallGradient;

  // Front wall
  ctx.beginPath();
  ctx.moveTo(cx - 8 * scale, cy + 10 * scale);
  ctx.lineTo(cx + 8 * scale, cy + 10 * scale);
  ctx.lineTo(cx + 8 * scale, cy - 4 * scale);
  ctx.lineTo(cx - 8 * scale, cy - 4 * scale);
  ctx.closePath();
  ctx.fill();

  // Roof
  ctx.beginPath();
  ctx.moveTo(cx - 8 * scale, cy - 4 * scale);
  ctx.lineTo(cx - 4 * scale, cy - 8 * scale);
  ctx.lineTo(cx, cy - 12 * scale);
  ctx.lineTo(cx + 4 * scale, cy - 8 * scale);
  ctx.lineTo(cx + 8 * scale, cy - 4 * scale);
  ctx.closePath();
  ctx.fill();

  // Top surface highlight
  ctx.fillStyle = colors.concrete.light;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - 6 * scale, cy - 2 * scale);
  ctx.lineTo(cx + 6 * scale, cy - 2 * scale);
  ctx.lineTo(cx + 4 * scale, cy - 6 * scale);
  ctx.lineTo(cx, cy - 10 * scale);
  ctx.lineTo(cx - 4 * scale, cy - 6 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Gun slits
  ctx.fillStyle = colors.slit;
  ctx.fillRect(cx - 2 * scale, cy - 12 * scale, 4 * scale, 2 * scale);

  // Side slits (angled)
  ctx.save();
  ctx.translate(cx - 5 * scale, cy - 7 * scale);
  ctx.rotate(-0.5);
  ctx.fillRect(-1.5 * scale, -1 * scale, 3 * scale, 2 * scale);
  ctx.restore();

  ctx.save();
  ctx.translate(cx + 5 * scale, cy - 7 * scale);
  ctx.rotate(0.5);
  ctx.fillRect(-1.5 * scale, -1 * scale, 3 * scale, 2 * scale);
  ctx.restore();
}

/**
 * Pre-render entire terrain grid to an offscreen canvas
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} cellSize - Size of each cell in pixels
 * @returns {HTMLCanvasElement} - Rendered terrain canvas
 */
export function renderTerrainToCanvas(terrain, cellSize) {
  const height = terrain.length;
  const width = terrain[0]?.length || 0;

  const canvas = document.createElement('canvas');
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;

  const ctx = canvas.getContext('2d');

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const type = terrain[row][col] || 'open';
      drawTerrainCell(ctx, type, col * cellSize, row * cellSize, cellSize);
    }
  }

  return canvas;
}

/**
 * Create a terrain texture that can be used as a background
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} cellSize - Size of each cell in pixels
 * @returns {string} - Data URL for the terrain image
 */
export function createTerrainDataURL(terrain, cellSize) {
  const canvas = renderTerrainToCanvas(terrain, cellSize);
  return canvas.toDataURL('image/png');
}

// ═══════════════════════════════════════════════════════════════
// LAYERED TERRAIN RENDERING
// Base layer (ground) renders below units
// Canopy layer (forest/brush) renders above units
// ═══════════════════════════════════════════════════════════════

/**
 * Terrain type categories
 */
const GROUND_TYPES = ['open', 'grass', 'water', 'trench', 'high', 'pillbox'];
const CANOPY_TYPES = ['forest', 'brush'];

/**
 * Check if terrain type is a canopy (rendered above units)
 */
export function isCanopyTerrain(type) {
  return CANOPY_TYPES.includes(type);
}

/**
 * Get the base terrain type for a canopy cell
 * (what's underneath the canopy)
 */
export function getBaseTerrainForCanopy(type) {
  // Forest and brush are on grass
  if (type === 'forest' || type === 'brush') return 'grass';
  return 'open';
}

/**
 * Render only base/ground terrain (below units)
 * Canopy cells render their base terrain (grass) instead
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} cellSize - Size of each cell in pixels
 * @returns {HTMLCanvasElement} - Rendered base terrain canvas
 */
export function renderBaseTerrainToCanvas(terrain, cellSize) {
  const height = terrain.length;
  const width = terrain[0]?.length || 0;

  const canvas = document.createElement('canvas');
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;

  const ctx = canvas.getContext('2d');

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let type = terrain[row][col] || 'open';

      // For canopy types, draw the base terrain underneath
      if (isCanopyTerrain(type)) {
        type = getBaseTerrainForCanopy(type);
      }

      drawTerrainCell(ctx, type, col * cellSize, row * cellSize, cellSize);
    }
  }

  return canvas;
}

/**
 * Render only canopy layer (above units)
 * Uses transparent background, only draws forest/brush cells
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} cellSize - Size of each cell in pixels
 * @param {Object} canopyImages - Optional pre-loaded canopy images { forest: Image, brush: Image }
 * @returns {HTMLCanvasElement} - Rendered canopy canvas (transparent where no canopy)
 */
export function renderCanopyToCanvas(terrain, cellSize, canopyImages = null) {
  const height = terrain.length;
  const width = terrain[0]?.length || 0;

  const canvas = document.createElement('canvas');
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;

  const ctx = canvas.getContext('2d');

  // Start with fully transparent canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const type = terrain[row][col] || 'open';

      // Only draw canopy types
      if (!isCanopyTerrain(type)) continue;

      const x = col * cellSize;
      const y = row * cellSize;

      // Use pre-loaded image if available, otherwise show missing indicator
      if (canopyImages && canopyImages[type]) {
        ctx.drawImage(canopyImages[type], x, y, cellSize, cellSize);
      } else {
        // No canopy sprite loaded - show obvious missing texture
        drawMissingCanopy(ctx, type, x, y, cellSize);
      }
    }
  }

  return canvas;
}

/**
 * Draw a "missing canopy" indicator
 * Magenta checkerboard pattern to make it obvious the sprite is missing
 */
function drawMissingCanopy(ctx, type, x, y, size) {
  const checkSize = size / 4;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const isMagenta = (row + col) % 2 === 0;
      ctx.fillStyle = isMagenta ? 'rgba(255, 0, 255, 0.7)' : 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x + col * checkSize, y + row * checkSize, checkSize, checkSize);
    }
  }

  // Label
  ctx.fillStyle = '#fff';
  ctx.font = `${size / 6}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(type.toUpperCase(), x + size / 2, y + size / 2 + size / 18);
}

/**
 * Get all canopy cell positions from terrain grid
 * Useful for collision detection with units
 * @param {string[][]} terrain - 2D terrain grid
 * @returns {Array<{row: number, col: number, type: string}>}
 */
export function getCanopyCells(terrain) {
  const cells = [];
  for (let row = 0; row < terrain.length; row++) {
    for (let col = 0; col < (terrain[row]?.length || 0); col++) {
      const type = terrain[row][col];
      if (isCanopyTerrain(type)) {
        cells.push({ row, col, type });
      }
    }
  }
  return cells;
}
