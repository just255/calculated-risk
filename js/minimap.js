// ═══════════════════════════════════════════════════════════════
// MINIMAP — Tactical overview rendered to a canvas element
// Terrain is cached to an offscreen canvas once at battle start.
// Each frame only redraws unit dots, fog, and viewport on top.
// ═══════════════════════════════════════════════════════════════

let _terrainCache = null;  // { canvas, mapWidth, mapHeight, w, scaleX, scaleY }

/**
 * Draw the minimap for a battle state.
 * Renders cached terrain + live units/enemies/hero/viewport.
 */
export function drawMinimap(b, selector = '.minimap-canvas') {
  const canvas = document.querySelector(selector);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Fixed scale: map width fits canvas width
  const scaleX = w / b.mapWidth;
  const scaleY = scaleX;

  // Cache terrain on first call or if map changed
  if (!_terrainCache || _terrainCache.mapWidth !== b.mapWidth || _terrainCache.mapHeight !== b.mapHeight || _terrainCache.w !== w) {
    _buildTerrainCache(b, w, scaleX, scaleY);
  }

  const mapCanvasH = b.mapHeight * scaleY;

  // Focus on hero
  const focusY = b.hero?.y ?? b.mapHeight / 2;
  const scrollY = Math.max(0, Math.min(focusY * scaleY - h / 2, mapCanvasH - h));

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Draw cached terrain with scroll
  if (_terrainCache?.canvas) {
    ctx.drawImage(_terrainCache.canvas, 0, scrollY, w, h, 0, 0, w, h);
  }

  // Everything else draws with scroll offset
  ctx.save();
  ctx.translate(0, -scrollY);

  // Fog overlay for unrevealed zones
  if (b._fogZones) {
    for (const zone of b._fogZones) {
      if (!zone.revealed) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, zone.y * scaleY, w, zone.height * scaleY);
      }
    }
  }

  drawBlueUnits(ctx, b, scaleX, scaleY);
  drawEnemies(ctx, b, scaleX, scaleY);

  if (b.hero && !b.hero.dead) {
    drawHero(ctx, b, scaleX, scaleY);
  }

  if (b.camera?.zoom) {
    drawViewport(ctx, b, w, h, scaleX, scaleY);
  }

  ctx.restore();
}

/**
 * Clear the terrain cache (call on battle end / new battle).
 */
export function clearMinimapCache() {
  _terrainCache = null;
}

// ── Internal ────────────────────────────────────────────────

function _buildTerrainCache(b, w, scaleX, scaleY) {
  const mapCanvasH = Math.ceil(b.mapHeight * scaleY);
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = mapCanvasH;
  const ctx = offscreen.getContext('2d');

  if (b.terrainCanvases?.terrainCanvas) {
    ctx.drawImage(b.terrainCanvases.terrainCanvas, 0, 0, w, mapCanvasH);
  } else if (b.terrain) {
    const TERRAIN_COLORS = {
      open: '#4a4035', grass: '#3a5a2a', brush: '#2a4a1a',
      forest: '#1e3a18', high: '#5a4a3a', water: '#1a4a65',
      trench: '#3a2a1a', pillbox: '#5a5a5a'
    };
    const cellW = (b.cellSize || 64) * scaleX;
    const cellH = (b.cellSize || 64) * scaleY;
    for (let row = 0; row < (b.gridHeight || 0); row++) {
      for (let col = 0; col < (b.gridWidth || 0); col++) {
        const type = b.terrain[row]?.[col] || 'open';
        ctx.fillStyle = TERRAIN_COLORS[type] || TERRAIN_COLORS.open;
        ctx.fillRect(col * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  _terrainCache = { canvas: offscreen, mapWidth: b.mapWidth, mapHeight: b.mapHeight, w };
}

function drawBlueUnits(ctx, b, scaleX, scaleY) {
  if (!b.units) return;
  for (const unit of b.units) {
    if (unit.dead) continue;
    const x = unit.x * scaleX;
    const y = unit.y * scaleY;
    const isSelected = b.squad?.selectedUnitId === unit.id;

    if (isSelected) {
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isSelected ? '#7ab87a' : '#5a8a5a';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemies(ctx, b, scaleX, scaleY) {
  if (!b.enemies) return;
  const fogSet = b._visibleEnemies;
  ctx.fillStyle = '#ff4444';
  for (const e of b.enemies) {
    if (e.dead) continue;
    if (fogSet && !fogSet.has(e.id)) continue;
    const x = e.x * scaleX;
    const y = e.y * scaleY;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHero(ctx, b, scaleX, scaleY) {
  const x = b.hero.x * scaleX;
  const y = b.hero.y * scaleY;

  ctx.fillStyle = '#4a9eff';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  const viewRange = b.hero.viewRange || 850;
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, viewRange * scaleX, 0, Math.PI * 2);
  ctx.stroke();
}

function drawViewport(ctx, b, w, h, scaleX, scaleY) {
  const cam = b.camera;
  const zoom = cam.zoom || 1;
  const el = document.querySelector('.battle-canvas-container, .campaign-battlefield');
  if (!el) return;
  const viewW = el.clientWidth / zoom;
  const viewH = el.clientHeight / zoom;
  const vx = cam.x * scaleX;
  const vy = cam.y * scaleY;
  const vw = viewW * scaleX;
  const vh = viewH * scaleY;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(vx, vy, vw, vh);
}
