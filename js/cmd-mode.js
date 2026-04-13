// ═══════════════════════════════════════════════════════════════
// CMD-MODE - RTS Commander play mode
// Player replaces the AI commander: select squads, issue orders,
// set waypoints, deploy waves. Hero is AI-controlled.
// ═══════════════════════════════════════════════════════════════

import { Team } from './constants.js';
import { Objective, assignObjective } from './commander.js';
import { setTeamWaypoint } from './sergeant.js';

// ─── Constants ───────────────────────────────────────────────

const CMD_BUTTONS = [
  { id: 'attack',     label: 'ATTACK',    obj: Objective.ATTACK,     key: '1', color: '#f87171' },
  { id: 'advance',    label: 'ADVANCE',   obj: Objective.ADVANCE_TO, key: '2', color: '#fbbf24' },
  { id: 'hold',       label: 'HOLD',      obj: null,                 key: '3', color: '#60a5fa' },
  { id: 'fallback',   label: 'FALL BACK', obj: Objective.FALL_BACK,  key: '4', color: '#4ade80' },
  { id: 'focusfire',  label: 'FOCUS',     obj: null,                 key: '5', color: '#fb923c' }
];

const SQUAD_COLORS = [
  '#4ade80', '#60a5fa', '#fbbf24', '#f87171',
  '#a78bfa', '#fb923c', '#34d399', '#f472b6'
];

// ─── State ───────────────────────────────────────────────────

/**
 * Initialize CMD mode state on the battle object.
 * Called once when battle starts in CMD mode.
 */
export function initCMDMode(b) {
  b._cmd = {
    selectedSquadId: null,     // Currently selected squad ID
    selectedUnitRef: null,     // Clicked individual unit (for focus fire target)
    pendingCommand: null,      // Command waiting for click-to-place (e.g. 'advance')
    commandBarRects: [],       // Hit rects for command buttons
    squadBarRects: [],         // Hit rects for squad status chips
    btnRects: {},              // Named button rects
    lastClickWorld: null       // Last world-space click for waypoint
  };

  // Set blue commander to player-driven
  const cmdr = b._teamCommanders?.[Team.BLUE];
  if (cmdr) {
    cmdr.driver = 'player';
  }
}

// ─── Camera ──────────────────────────────────────────────────

/**
 * CMD camera: free pan with WASD, zoomed-out default.
 * Starts centered on map with overview zoom.
 */
export function updateCMDCamera(b, screenW, screenH) {
  // Default to overview zoom on first frame
  if (!b._cmd._cameraInit) {
    b._cmd._cameraInit = true;
    const overviewZoom = Math.min(
      screenW / b.mapWidth,
      screenH / b.mapHeight
    ) * 0.85;
    b.camera.userZoom = Math.max(0.15, Math.min(3, overviewZoom));
    b.camera.x = (b.mapWidth - screenW / (b.camera.userZoom * (Math.min(screenW, screenH) / 900))) / 2;
    b.camera.y = (b.mapHeight - screenH / (b.camera.userZoom * (Math.min(screenW, screenH) / 900))) / 2;
    b.camera._manualPan = true;
  }

  const TACTICAL_RADIUS = 450;
  const baseZoom = Math.min(screenW, screenH) / (TACTICAL_RADIUS * 2);
  const userZoom = b.camera.userZoom || 1;
  const zoom = baseZoom * userZoom;

  // WASD free pan (always active in CMD)
  const panSpeed = 500 / zoom;
  const dtSec = 1 / 60;
  let panX = 0, panY = 0;
  if (b.keys?.w) panY -= panSpeed * dtSec;
  if (b.keys?.s) panY += panSpeed * dtSec;
  if (b.keys?.a) panX -= panSpeed * dtSec;
  if (b.keys?.d) panX += panSpeed * dtSec;

  if (panX !== 0 || panY !== 0) {
    b.camera.x += panX;
    b.camera.y += panY;
  }

  b.camera.zoom = zoom;
  return zoom;
}

// ─── Hero as AI unit ─────────────────────────────────────────

/**
 * In CMD mode, the hero should run AI brain updates.
 * Called from ai-pipeline.js when playMode === 'cmd'.
 */
export function shouldHeroRunAI(b) {
  return b.playMode === 'cmd' && b.hero && !b.hero.dead;
}

// ─── Click handling ──────────────────────────────────────────

/**
 * Convert screen coords to world coords using current camera.
 */
function screenToWorld(b, sx, sy) {
  const z = b.camera.zoom || 1;
  return {
    x: sx / z + b.camera.x,
    y: sy / z + b.camera.y
  };
}

/**
 * Find the squad closest to a world position (by its alive members).
 */
function findSquadAtWorld(b, wx, wy, maxDist = 80) {
  if (!b._squads) return null;
  let best = null, bestDist = maxDist;

  for (const squad of b._squads) {
    if (!squad.active || squad.team !== Team.BLUE) continue;
    const pool = b.units || [];
    for (const u of pool) {
      if (u.dead || u._squadId !== squad.id) continue;
      const dx = u.x - wx, dy = u.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = squad;
      }
    }
  }

  // Also check hero
  if (b.hero && !b.hero.dead) {
    const dx = b.hero.x - wx, dy = b.hero.y - wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      const heroSquad = b._squads.find(sq => sq.id === b.hero._squadId && sq.active);
      if (heroSquad) {
        best = heroSquad;
      }
    }
  }

  return best;
}

/**
 * Find individual unit near world position (for target designation).
 */
function findUnitAtWorld(b, wx, wy, team, maxDist = 50) {
  const pool = team === 'blue' ? (b.units || []) : (b.enemies || []);
  let best = null, bestDist = maxDist;

  for (const u of pool) {
    if (u.dead) continue;
    const dx = u.x - wx, dy = u.y - wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = u;
    }
  }

  // Check hero for blue
  if (team === 'blue' && b.hero && !b.hero.dead) {
    const dx = b.hero.x - wx, dy = b.hero.y - wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) best = b.hero;
  }

  return best;
}

/**
 * Handle a click during CMD mode active battle.
 * Returns true if consumed.
 */
export function handleCMDClick(b, screenX, screenY, ctrlKey) {
  const cmd = b._cmd;
  if (!cmd) return false;

  const _hit = (r) => r && screenX >= r.x && screenX <= r.x + r.w &&
                       screenY >= r.y && screenY <= r.y + r.h;

  // 1. Command bar button clicks
  for (const rect of cmd.commandBarRects) {
    if (_hit(rect)) {
      if (rect.cmdId === 'advance') {
        // Advance needs a click target — set pending
        cmd.pendingCommand = 'advance';
      } else if (rect.cmdId === 'attack') {
        _issueCommand(b, 'attack');
      } else if (rect.cmdId === 'hold') {
        _issueHoldCommand(b);
      } else if (rect.cmdId === 'fallback') {
        _issueCommand(b, 'fall_back');
      } else if (rect.cmdId === 'focusfire') {
        // Focus fire needs an enemy target — set pending
        cmd.pendingCommand = 'focusfire';
      }
      return true;
    }
  }

  // 2. Squad bar clicks — select squad
  for (const rect of cmd.squadBarRects) {
    if (_hit(rect)) {
      cmd.selectedSquadId = rect.squadId;
      cmd.pendingCommand = null;
      return true;
    }
  }

  // 3. World clicks
  const world = screenToWorld(b, screenX, screenY);

  // 3a. Pending advance command — set waypoint at click position
  if (cmd.pendingCommand === 'advance' && cmd.selectedSquadId != null) {
    _issueAdvanceTo(b, world.x, world.y);
    cmd.pendingCommand = null;
    return true;
  }

  // 3b. Pending focus fire — find enemy at click position
  if (cmd.pendingCommand === 'focusfire') {
    const target = findUnitAtWorld(b, world.x, world.y, 'red', 80);
    if (target) {
      _issueFocusFire(b, target);
    }
    cmd.pendingCommand = null;
    return true;
  }

  // 3c. Right-click shortcut: advance to position (if squad selected)
  // (handled via contextmenu event, not here)

  // 3d. Select squad by clicking on its units
  const squad = findSquadAtWorld(b, world.x, world.y);
  if (squad) {
    cmd.selectedSquadId = squad.id;
    cmd.pendingCommand = null;
    return true;
  }

  // 3e. Deselect
  cmd.selectedSquadId = null;
  cmd.pendingCommand = null;
  return false;
}

/**
 * Handle right-click for quick advance-to waypoint.
 */
export function handleCMDRightClick(b, screenX, screenY) {
  const cmd = b._cmd;
  if (!cmd || cmd.selectedSquadId == null) return false;

  const world = screenToWorld(b, screenX, screenY);
  _issueAdvanceTo(b, world.x, world.y);
  return true;
}

/**
 * Handle keyboard shortcuts in CMD mode.
 */
export function handleCMDKey(b, key) {
  const cmd = b._cmd;
  if (!cmd) return false;

  // Number keys for commands
  for (const btn of CMD_BUTTONS) {
    if (key === btn.key) {
      if (btn.id === 'advance') {
        cmd.pendingCommand = 'advance';
      } else if (btn.id === 'attack') {
        _issueCommand(b, 'attack');
      } else if (btn.id === 'hold') {
        _issueHoldCommand(b);
      } else if (btn.id === 'fallback') {
        _issueCommand(b, 'fall_back');
      } else if (btn.id === 'focusfire') {
        cmd.pendingCommand = 'focusfire';
      }
      return true;
    }
  }

  // Tab — cycle through squads
  if (key === 'Tab') {
    _cycleSquad(b);
    return true;
  }

  // Escape — cancel pending command / deselect
  if (key === 'Escape') {
    if (cmd.pendingCommand) {
      cmd.pendingCommand = null;
    } else {
      cmd.selectedSquadId = null;
    }
    return true;
  }

  // F — center camera on selected squad
  if (key === 'f' || key === 'F') {
    _centerOnSelectedSquad(b);
    return true;
  }

  return false;
}

// ─── Command execution ──────────────────────────────────────

function _getSelectedSgt(b) {
  const cmd = b._cmd;
  if (cmd.selectedSquadId == null) return null;
  const squad = b._squads?.find(sq => sq.id === cmd.selectedSquadId && sq.active);
  return squad?.sergeant || null;
}

function _issueCommand(b, objectiveType) {
  const sgt = _getSelectedSgt(b);
  if (!sgt) return;
  const cmdr = b._teamCommanders?.[Team.BLUE];

  assignObjective(cmdr, sgt, { type: objectiveType }, Date.now(), b);
}

function _issueAdvanceTo(b, wx, wy) {
  const sgt = _getSelectedSgt(b);
  if (!sgt) return;
  const cmdr = b._teamCommanders?.[Team.BLUE];

  assignObjective(cmdr, sgt, {
    type: Objective.ADVANCE_TO,
    position: { x: wx, y: wy }
  }, Date.now(), b);

  // Also set the squad waypoint
  setTeamWaypoint(b, sgt, { x: wx, y: wy });
}

function _issueHoldCommand(b) {
  const sgt = _getSelectedSgt(b);
  if (!sgt) return;
  const cmdr = b._teamCommanders?.[Team.BLUE];

  // Hold = defend at current position
  const squad = b._squads?.find(sq => sq.id === b._cmd.selectedSquadId);
  if (!squad) return;

  const pool = b.units || [];
  const members = pool.filter(u => !u.dead && u._squadId === squad.id);
  if (members.length === 0) return;

  // Average position of squad
  const cx = members.reduce((s, u) => s + u.x, 0) / members.length;
  const cy = members.reduce((s, u) => s + u.y, 0) / members.length;

  assignObjective(cmdr, sgt, {
    type: Objective.DEFEND,
    position: { x: cx, y: cy }
  }, Date.now(), b);
}

function _issueFocusFire(b, target) {
  const sgt = _getSelectedSgt(b);
  if (!sgt) return;

  // Set focus fire command on all squad members
  const squad = b._squads?.find(sq => sq.id === b._cmd.selectedSquadId);
  if (!squad) return;

  const pool = b.units || [];
  const members = pool.filter(u => !u.dead && u._squadId === squad.id);
  for (const u of members) {
    u._command = 'focus_fire';
    u._focusTarget = target;
  }

  // Also set for hero if in this squad
  if (b.hero && !b.hero.dead && b.hero._squadId === squad.id) {
    b.hero._command = 'focus_fire';
    b.hero._focusTarget = target;
  }
}

function _cycleSquad(b) {
  const cmd = b._cmd;
  const blueSquads = (b._squads || []).filter(sq => sq.active && sq.team === Team.BLUE);
  if (blueSquads.length === 0) return;

  const currentIdx = blueSquads.findIndex(sq => sq.id === cmd.selectedSquadId);
  const nextIdx = (currentIdx + 1) % blueSquads.length;
  cmd.selectedSquadId = blueSquads[nextIdx].id;
  cmd.pendingCommand = null;
}

function _centerOnSelectedSquad(b) {
  const cmd = b._cmd;
  if (cmd.selectedSquadId == null) return;

  const pool = b.units || [];
  const members = pool.filter(u => !u.dead && u._squadId === cmd.selectedSquadId);

  // Include hero
  if (b.hero && !b.hero.dead && b.hero._squadId === cmd.selectedSquadId) {
    members.push(b.hero);
  }

  if (members.length === 0) return;

  const cx = members.reduce((s, u) => s + u.x, 0) / members.length;
  const cy = members.reduce((s, u) => s + u.y, 0) / members.length;

  const container = b.battleRenderer?._container;
  if (!container) return;
  const zoom = b.camera.zoom || 1;
  b.camera.x = cx - container.offsetWidth / zoom / 2;
  b.camera.y = cy - container.offsetHeight / zoom / 2;
  b.camera._manualPan = true;
}

// ─── HUD Drawing ────────────────────────────────────────────

/**
 * Draw the CMD mode HUD overlay.
 * Called from drawEndlessBattle/drawHeroBattle when playMode === 'cmd'.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} b       - Battle state
 * @param {number} screenW - Canvas width (CSS px)
 * @param {number} screenH - Canvas height (CSS px)
 */
export function drawCMDOverlay(ctx, b, screenW, screenH) {
  const cmd = b._cmd;
  if (!cmd) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cmd.commandBarRects.length = 0;
  cmd.squadBarRects.length = 0;

  _drawSquadBar(ctx, b, screenW, screenH);
  _drawCommandBar(ctx, b, screenW, screenH);
  _drawSelectedSquadHighlight(ctx, b);
  _drawPendingCommandCursor(ctx, b, screenW, screenH);
  _drawWaypointMarkers(ctx, b);

  ctx.restore();
}

// ── Squad status bar (top) ──────────────────────────────────

function _drawSquadBar(ctx, b, screenW, screenH) {
  const cmd = b._cmd;
  const blueSquads = (b._squads || []).filter(sq => sq.active && sq.team === Team.BLUE);
  if (blueSquads.length === 0) return;

  const barH = 36;
  const chipW = Math.min(160, (screenW - 20) / blueSquads.length - 6);
  const totalW = blueSquads.length * (chipW + 6) - 6;
  const startX = (screenW - totalW) / 2;
  const barY = 6;

  for (let i = 0; i < blueSquads.length; i++) {
    const squad = blueSquads[i];
    const cx = startX + i * (chipW + 6);
    const isSelected = squad.id === cmd.selectedSquadId;
    const color = SQUAD_COLORS[i % SQUAD_COLORS.length];

    // Chip background
    ctx.fillStyle = isSelected ? 'rgba(40, 55, 32, 0.9)' : 'rgba(30, 38, 25, 0.75)';
    ctx.fillRect(cx, barY, chipW, barH);

    // Selection border
    ctx.strokeStyle = isSelected ? color : 'rgba(100, 130, 70, 0.3)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(cx, barY, chipW, barH);

    // Squad color indicator
    ctx.fillStyle = color;
    ctx.fillRect(cx, barY, 3, barH);

    // Squad label
    const sgt = squad.sergeant;
    const phase = sgt?.phase || '?';
    ctx.fillStyle = isSelected ? '#e0e8d0' : '#94a3b8';
    ctx.font = 'bold 10px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`SQ ${squad.id}`, cx + 8, barY + 4);

    // Phase indicator
    ctx.fillStyle = _phaseColor(phase);
    ctx.font = '9px monospace';
    ctx.fillText(phase.toUpperCase().slice(0, 6), cx + 8, barY + 18);

    // Member count + health bar
    const pool = b.units || [];
    const members = pool.filter(u => !u.dead && u._squadId === squad.id);
    // Include hero
    if (b.hero && !b.hero.dead && b.hero._squadId === squad.id) {
      members.push(b.hero);
    }
    const total = pool.filter(u => u._squadId === squad.id).length +
                  (b.hero?._squadId === squad.id ? 1 : 0);

    ctx.fillStyle = '#708060';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${members.length}/${total}`, cx + chipW - 4, barY + 4);

    // Health bar
    const hpFrac = total > 0 ? members.length / total : 0;
    const hpBarW = chipW - 12;
    const hpBarY = barY + barH - 6;
    ctx.fillStyle = 'rgba(60, 80, 45, 0.4)';
    ctx.fillRect(cx + 6, hpBarY, hpBarW, 3);
    ctx.fillStyle = hpFrac > 0.5 ? 'rgba(74, 222, 128, 0.7)' : 'rgba(248, 113, 113, 0.7)';
    ctx.fillRect(cx + 6, hpBarY, hpBarW * hpFrac, 3);

    // Hit rect
    cmd.squadBarRects.push({ x: cx, y: barY, w: chipW, h: barH, squadId: squad.id });
  }
}

// ── Command bar (bottom) ────────────────────────────────────

function _drawCommandBar(ctx, b, screenW, screenH) {
  const cmd = b._cmd;
  const hasSelection = cmd.selectedSquadId != null;

  const btnW = 80, btnH = 32, gap = 6;
  const totalW = CMD_BUTTONS.length * (btnW + gap) - gap;
  const startX = (screenW - totalW) / 2;
  const barY = screenH - btnH - 12;

  // Background strip
  ctx.fillStyle = 'rgba(26, 31, 46, 0.85)';
  ctx.fillRect(startX - 10, barY - 6, totalW + 20, btnH + 16);
  ctx.strokeStyle = 'rgba(100, 130, 70, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(startX - 10, barY - 6, totalW + 20, btnH + 16);

  for (let i = 0; i < CMD_BUTTONS.length; i++) {
    const btn = CMD_BUTTONS[i];
    const bx = startX + i * (btnW + gap);
    const active = hasSelection;
    const isPending = cmd.pendingCommand === btn.id;

    // Button background
    if (isPending) {
      ctx.fillStyle = btn.color + '33'; // 20% opacity of button color
    } else {
      ctx.fillStyle = active ? 'rgba(47, 55, 73, 0.9)' : 'rgba(30, 35, 50, 0.6)';
    }
    ctx.fillRect(bx, barY, btnW, btnH);

    // Button border
    ctx.strokeStyle = isPending ? btn.color : (active ? 'rgba(100, 130, 70, 0.4)' : 'rgba(60, 70, 90, 0.3)');
    ctx.lineWidth = isPending ? 2 : 1;
    ctx.strokeRect(bx, barY, btnW, btnH);

    // Key hint
    ctx.fillStyle = active ? '#708060' : '#404858';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(btn.key, bx + 3, barY + 2);

    // Label
    ctx.fillStyle = isPending ? btn.color : (active ? '#e2e8f0' : '#4a5568');
    ctx.font = 'bold 10px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(btn.label, bx + btnW / 2, barY + btnH / 2 + 1);

    cmd.commandBarRects.push({ x: bx, y: barY, w: btnW, h: btnH, cmdId: btn.id });
  }
}

// ── Selected squad highlight (world space) ──────────────────

function _drawSelectedSquadHighlight(ctx, b) {
  const cmd = b._cmd;
  if (cmd.selectedSquadId == null) return;

  const zoom = b.camera.zoom || 1;
  const pool = b.units || [];
  const members = pool.filter(u => !u.dead && u._squadId === cmd.selectedSquadId);

  // Include hero
  if (b.hero && !b.hero.dead && b.hero._squadId === cmd.selectedSquadId) {
    members.push(b.hero);
  }

  if (members.length === 0) return;

  const idx = (b._squads || []).filter(sq => sq.active && sq.team === Team.BLUE)
    .findIndex(sq => sq.id === cmd.selectedSquadId);
  const color = SQUAD_COLORS[Math.max(0, idx) % SQUAD_COLORS.length];

  // Draw selection rings around each member
  for (const u of members) {
    const sx = (u.x - b.camera.x) * zoom;
    const sy = (u.y - b.camera.y) * zoom;
    const r = (u.isHero ? 18 : 14) * zoom;

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pulsing ring
    const pulse = 0.3 + 0.3 * Math.sin(Date.now() / 400);
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3 * zoom, 0, Math.PI * 2);
    ctx.strokeStyle = color.slice(0, 7) + Math.floor(pulse * 255).toString(16).padStart(2, '0');
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ── Pending command cursor feedback ─────────────────────────

function _drawPendingCommandCursor(ctx, b, screenW, screenH) {
  const cmd = b._cmd;
  if (!cmd.pendingCommand) return;

  // Show instruction text at top
  let text = '';
  if (cmd.pendingCommand === 'advance') text = 'Click map to set advance waypoint';
  if (cmd.pendingCommand === 'focusfire') text = 'Click an enemy to focus fire';

  if (text) {
    ctx.fillStyle = 'rgba(26, 31, 46, 0.8)';
    const tw = ctx.measureText(text).width + 20;
    ctx.font = 'bold 12px Oxanium, monospace';
    const textW = ctx.measureText(text).width + 20;
    ctx.fillRect((screenW - textW) / 2, 50, textW, 28);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect((screenW - textW) / 2, 50, textW, 28);
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, screenW / 2, 64);
  }

  // Crosshair at mouse position
  const mx = b.mouse?.x || 0;
  const my = b.mouse?.y || 0;
  const crossSize = 10;
  ctx.strokeStyle = cmd.pendingCommand === 'focusfire' ? '#f87171' : '#fbbf24';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mx - crossSize, my);
  ctx.lineTo(mx + crossSize, my);
  ctx.moveTo(mx, my - crossSize);
  ctx.lineTo(mx, my + crossSize);
  ctx.stroke();

  // Circle
  ctx.beginPath();
  ctx.arc(mx, my, crossSize + 4, 0, Math.PI * 2);
  ctx.stroke();
}

// ── Waypoint markers (world space) ──────────────────────────

function _drawWaypointMarkers(ctx, b) {
  const zoom = b.camera.zoom || 1;
  const blueSquads = (b._squads || []).filter(sq => sq.active && sq.team === Team.BLUE);

  for (let i = 0; i < blueSquads.length; i++) {
    const squad = blueSquads[i];
    const sgt = squad.sergeant;
    if (!sgt?.objective?.position) continue;

    const wp = sgt.objective.position;
    const sx = (wp.x - b.camera.x) * zoom;
    const sy = (wp.y - b.camera.y) * zoom;
    const color = SQUAD_COLORS[i % SQUAD_COLORS.length];

    // Diamond marker
    const size = 8;
    ctx.beginPath();
    ctx.moveTo(sx, sy - size);
    ctx.lineTo(sx + size, sy);
    ctx.lineTo(sx, sy + size);
    ctx.lineTo(sx - size, sy);
    ctx.closePath();
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`SQ${squad.id}`, sx, sy - size - 2);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function _phaseColor(phase) {
  switch (phase) {
    case 'search':    return '#94a3b8';
    case 'contact':   return '#fbbf24';
    case 'engage':    return '#f87171';
    case 'press':     return '#fb923c';
    case 'pursue':    return '#f87171';
    case 'disengage': return '#60a5fa';
    case 'regroup':   return '#4ade80';
    case 'ambush':    return '#a78bfa';
    case 'flank':     return '#fb923c';
    case 'hold':      return '#60a5fa';
    default:          return '#708060';
  }
}
