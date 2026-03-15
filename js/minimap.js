// ═══════════════════════════════════════════════════════════════
// MINIMAP — Tactical overview rendered to a canvas element
// ═══════════════════════════════════════════════════════════════

const TERRAIN_COLORS = {
  open: '#4a4035', grass: '#3a5a2a', brush: '#2a4a1a',
  forest: '#1e3a18', high: '#5a4a3a', water: '#1a4a65',
  trench: '#3a2a1a', pillbox: '#5a5a5a'
};

/**
 * Draw the minimap for a battle state.
 * Renders terrain, units, enemies (fog-aware), hero, and camera viewport.
 * @param {object} b - Battle state
 * @param {string} [selector='.minimap-canvas'] - CSS selector for the canvas element
 */
export function drawMinimap(b, selector = '.minimap-canvas') {
  const canvas = document.querySelector(selector);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  const scaleX = w / b.mapWidth;
  const scaleY = h / b.mapHeight;

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Terrain background
  drawTerrain(ctx, b, w, h, scaleX, scaleY);

  // Units
  drawBlueUnits(ctx, b, scaleX, scaleY);
  drawEnemies(ctx, b, scaleX, scaleY);

  // Hero
  if (b.hero && !b.hero.dead) {
    drawHero(ctx, b, scaleX, scaleY);
  }

  // Camera viewport indicator
  if (b.camera?.zoom) {
    drawViewport(ctx, b, w, h, scaleX, scaleY);
  }
}

function drawTerrain(ctx, b, w, h, scaleX, scaleY) {
  if (b.terrainCanvases?.terrainCanvas) {
    ctx.drawImage(b.terrainCanvases.terrainCanvas, 0, 0, w, h);
  } else if (b.terrain) {
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

  // Hero dot
  ctx.fillStyle = '#4a9eff';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // View range circle
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
  // Approximate screen size from battle-renderer viewport
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
