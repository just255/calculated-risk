// ═══════════════════════════════════════════════════════════════
// LOADOUTS — Preset squad configurations for quick deployment
// ═══════════════════════════════════════════════════════════════

import { UNITS, UNIT_COMBAT_STATS, FORMATION_OFFSETS } from './constants.js';
import { isCrewMode } from './deploy-crew.js';
import { getAvailable, assignToVehicle, getCrewForVehicle, getCrewSchema, unassignAllCrew } from './roster.js';
import { registerScrollRegion, beginScrollClip, endScrollClip, filterRectsToClip } from './panel-scroll.js';

// ─── Preset Definitions ────────────────────────────────────────

export const SQUAD_PRESETS = [
  {
    id: 'blitz_brigade',
    name: 'Blitz Brigade',
    tagline: 'Balanced brawlers',
    formation: 'wedge',
    units: ['sherman', 'sherman', 'sherman', 'humvee', 'infantry', 'infantry', 'infantry', 'infantry']
  },
  {
    id: 'steel_stampede',
    name: 'Steel Stampede',
    tagline: 'Heavy armor push',
    formation: 'line',
    units: ['sherman', 'sherman', 'tiger', 'tiger', 'humvee', 'infantry', 'infantry', 'infantry']
  },
  {
    id: 'rat_pack',
    name: 'Rat Pack',
    tagline: 'Fast and reckless',
    formation: 'spread',
    units: ['jeep', 'jeep', 'jeep', 'humvee', 'humvee', 'specops', 'specops', 'specops']
  },
  {
    id: 'boot_camp',
    name: 'Boot Camp',
    tagline: 'Boots on the ground',
    formation: 'staggered',
    units: ['medic', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry']
  },
  {
    id: 'lone_wolf',
    name: 'Lone Wolf',
    tagline: 'Just you. Good luck.',
    formation: 'line',
    units: []
  }
];

// ─── Preset Stats ──────────────────────────────────────────────

/** Compute summary stats for a preset (including hero unit). */
export function getPresetStats(preset, heroUnitId) {
  const allIds = [heroUnitId, ...preset.units];
  let totalDps = 0;
  let heaviest = 0;   // 0=foot, 1=light, 2=medium, 3=heavy
  let totalSpeed = 0;
  let count = 0;

  for (const uid of allIds) {
    const def = UNITS.find(u => u.id === uid);
    const combat = UNIT_COMBAT_STATS[uid];
    if (def) {
      const dps = def.damage / (def.fireRate / 1000);
      totalDps += dps;
    }
    if (combat) {
      totalSpeed += combat.speed || 0;
      count++;
    }
    // Weight classification
    const w = _unitWeight(uid);
    if (w > heaviest) heaviest = w;
  }

  const avgSpeed = count > 0 ? totalSpeed / count : 0;
  return {
    dps: Math.round(totalDps),
    armor: heaviest >= 3 ? 'Heavy' : heaviest >= 2 ? 'Medium' : heaviest >= 1 ? 'Light' : 'None',
    speed: avgSpeed >= 60 ? 'Fast' : avgSpeed >= 35 ? 'Medium' : 'Slow',
    count: allIds.length
  };
}

function _unitWeight(uid) {
  if (['abrams', 'tiger', 'howitzer'].includes(uid)) return 3;
  if (['sherman'].includes(uid)) return 2;
  if (['jeep', 'humvee'].includes(uid)) return 1;
  return 0;
}

// ─── Unit icons for preset cards ───────────────────────────────

const UNIT_ICON_COLORS = {
  infantry: '#6b9e6b', medic: '#b07070', specops: '#8878a8',
  stinger: '#a89860', jeep: '#6888a0', humvee: '#5a90a0',
  sherman: '#a89868', tiger: '#a08858', abrams: '#909090',
  howitzer: '#a88060', drone: '#788880', apache: '#609880'
};

const UNIT_ICON_SHAPES = {
  infantry: 'nato-infantry',   medic: 'nato-infantry',
  specops: 'nato-infantry',    stinger: 'nato-infantry',
  jeep: 'nato-light',          humvee: 'nato-light',
  sherman: 'nato-medium',      tiger: 'nato-heavy',
  abrams: 'nato-heavy',
  howitzer: 'nato-spg',        drone: 'nato-recon',
  apache: 'nato-light'
};

/** Draw a NATO-style unit icon at (x,y) with size s. */
export function drawUnitIcon(ctx, x, y, s, unitId) {
  const color = UNIT_ICON_COLORS[unitId] || '#708060';
  const shape = UNIT_ICON_SHAPES[unitId] || 'nato-infantry';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.12);

  const cx = x + s / 2;
  const cy = y + s / 2;
  const hw = s / 2;      // half width
  const hh = s * 0.35;   // half height (rectangle portion)

  if (shape === 'nato-infantry') {
    // Rectangle with X inside
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    ctx.beginPath();
    ctx.moveTo(x + 1, cy - hh);
    ctx.lineTo(x + s - 1, cy + hh);
    ctx.moveTo(x + s - 1, cy - hh);
    ctx.lineTo(x + 1, cy + hh);
    ctx.stroke();

  } else if (shape === 'nato-light') {
    // Rectangle with 1 dot (light vehicle)
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.12, 0, Math.PI * 2);
    ctx.fill();

  } else if (shape === 'nato-medium') {
    // Rectangle with 2 dots (medium tank)
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    const dotR = s * 0.1;
    const dotGap = s * 0.18;
    ctx.beginPath();
    ctx.arc(cx - dotGap, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + dotGap, cy, dotR, 0, Math.PI * 2);
    ctx.fill();

  } else if (shape === 'nato-heavy') {
    // Rectangle with 3 dots (heavy tank)
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    const dotR = s * 0.1;
    const dotGap = s * 0.25;
    ctx.beginPath();
    ctx.arc(cx - dotGap, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + dotGap, cy, dotR, 0, Math.PI * 2);
    ctx.fill();

  } else if (shape === 'nato-spg') {
    // Square with cross inside (artillery)
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx, cy + hh);
    ctx.moveTo(x + 1, cy);
    ctx.lineTo(x + s - 1, cy);
    ctx.stroke();

  } else if (shape === 'nato-recon') {
    // Rectangle with diagonal slash (recon)
    ctx.strokeRect(x + 1, cy - hh, s - 2, hh * 2);
    ctx.beginPath();
    ctx.moveTo(x + 1, cy + hh);
    ctx.lineTo(x + s - 1, cy - hh);
    ctx.stroke();
  }
}

// ─── Formation dot preview ─────────────────────────────────────

/** Draw a mini formation dot pattern centered at (cx, cy). */
export function drawFormationPreview(ctx, cx, cy, size, formationId, unitCount) {
  const offsets = FORMATION_OFFSETS[formationId];
  if (!offsets || unitCount === 0) return;

  const count = Math.min(unitCount, offsets.length);
  // Scale offsets to fit in the preview area
  let maxDist = 0;
  for (let i = 0; i < count; i++) {
    const d = Math.hypot(offsets[i][0], offsets[i][1]);
    if (d > maxDist) maxDist = d;
  }
  const scale = maxDist > 0 ? (size / 2 - 4) / maxDist : 1;

  for (let i = 0; i < count; i++) {
    const dx = offsets[i][0] * scale;
    const dy = offsets[i][1] * scale;
    const r = i === 0 ? 3 : 2;
    ctx.fillStyle = i === 0 ? '#d0e0b0' : 'rgba(140, 180, 90, 0.7)';
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Apply Preset ──────────────────────────────────────────────

/**
 * Apply a preset loadout to the battle.
 * Moves all current units to reserves, then builds the preset squad.
 * Auto-assigns crew if in crew mode.
 */
export function applyPreset(b, presetId) {
  const preset = SQUAD_PRESETS.find(p => p.id === presetId);
  if (!preset) return false;

  // Unassign all crew from current lineup + hero before moving to reserves
  if (isCrewMode()) {
    unassignAllCrew([b.hero, ...(b.units || [])]);
  }

  // Move all current lineup units to reserves
  if (!b.reservePool) b.reservePool = [];
  while (b.units && b.units.length > 0) {
    b.reservePool.push(b.units.pop());
  }
  if (!b.units) b.units = [];

  // Set formation
  if (preset.formation && FORMATION_OFFSETS[preset.formation]) {
    b._deployFormation = preset.formation;
  }

  // For each unit in the preset, pull from reserves or create new
  for (const unitId of preset.units) {
    const unit = _pullOrCreate(b, unitId);
    if (unit) b.units.push(unit);
  }

  // Auto-assign crew
  if (isCrewMode()) {
    _autoAssignAllCrew(b);
  }

  b._selectedPreset = presetId;
  b._selectedUnit = null;
  b._lineupSelection = null;
  b._cardFlipped = false;
  return true;
}

/** Pull a matching unit from reserves. Returns null if not available. */
function _pullOrCreate(b, unitId) {
  const reserves = b.reservePool || [];
  const idx = reserves.findIndex(r => r.unitId === unitId);
  if (idx >= 0) {
    return reserves.splice(idx, 1)[0];
  }
  // No anonymous fallback — roster is the source of truth.
  // If the unit type isn't in the pool, skip it.
  return null;
}

/** Auto-assign best available crew to all vehicles in lineup + hero. */
function _autoAssignAllCrew(b) {
  const allUnits = [b.hero, ...(b.units || [])].filter(Boolean);

  for (const u of allUnits) {
    const schema = getCrewSchema(u.unitId);
    if (!schema || schema[0] === 'self') continue;

    const vehicleId = u.id || u._crewVehicleId;
    if (!vehicleId) continue;

    const currentCrew = getCrewForVehicle(vehicleId);

    for (const slot of schema) {
      if (currentCrew[slot]) continue; // Already filled

      // Find best available soldier for this role
      const available = getAvailable('vehicle', slot);
      if (available.length === 0) continue;

      // Sort by expertise on this vehicle type, then rank
      available.sort((a, b) => {
        const expA = a.vehicleExpertise?.[u.unitId] ?? 0;
        const expB = b.vehicleExpertise?.[u.unitId] ?? 0;
        if (expB !== expA) return expB - expA;
        return (b.rankIndex || 0) - (a.rankIndex || 0);
      });

      assignToVehicle(available[0].id, vehicleId, slot);
    }
  }
}

// ─── Drawing ───────────────────────────────────────────────────

// ─── Legend data ────────────────────────────────────────────────

const LEGEND_UNITS = [
  'infantry', 'medic', 'specops', 'stinger',
  'jeep', 'humvee', 'sherman', 'tiger',
  'abrams', 'howitzer'
];

const LEGEND_LABELS = {
  infantry: 'INFA', medic: 'MED', specops: 'SPEC', stinger: 'STNG',
  jeep: 'JEEP', humvee: 'HMVE', sherman: 'SHRM', tiger: 'TIGR',
  abrams: 'ABRM', howitzer: 'HWTZ'
};

// ─── Content measurement ───────────────────────────────────────

const ICON_SIZE = 12;
const CARD_H = 56;
const CARD_GAP = 4;
const LEGEND_ROW_H = ICON_SIZE + 4;
const LEGEND_HEADER_H = 18;
const LEGEND_COLS = 4;

function _measurePresetContent(heroUnitId) {
  // 5 preset cards only — legend is sticky outside scroll
  let h = 0;
  h += SQUAD_PRESETS.length * (CARD_H + CARD_GAP);
  return h;
}

function _legendHeight() {
  const rows = Math.ceil(LEGEND_UNITS.length / LEGEND_COLS);
  return LEGEND_HEADER_H + rows * LEGEND_ROW_H + 4;
}

/**
 * Draw the preset selector panel in col 1 (scrollable).
 */
export function drawPresetPanel(ctx, b, zone, x, w, top, bottom, heroUnitId) {
  if (!zone._presetRects) zone._presetRects = [];
  zone._presetRects.length = 0;

  // Header (outside scroll area)
  ctx.fillStyle = '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('LOADOUTS', x, top);
  ctx.fillStyle = 'rgba(100, 130, 70, 0.3)';
  ctx.fillRect(x, top + 14, w, 1);
  const scrollTop = top + 20;

  // Reserve space for sticky legend at bottom
  const legH = _legendHeight();
  const clipH = bottom - scrollTop - legH;
  const contentH = _measurePresetContent(heroUnitId);
  const scroll = registerScrollRegion(b, 'presets', x, scrollTop, w, clipH, contentH);
  const rectsStart = zone._presetRects.length;

  beginScrollClip(ctx, x, scrollTop, w, clipH);

  let y = scrollTop - scroll;

  // ── Preset cards ──
  for (const preset of SQUAD_PRESETS) {
    const isActive = b._selectedPreset === preset.id;
    const totalUnits = 1 + preset.units.length;

    // Card background
    ctx.fillStyle = isActive
      ? 'rgba(140, 180, 90, 0.15)'
      : 'rgba(40, 55, 30, 0.4)';
    ctx.fillRect(x, y, w, CARD_H);

    if (isActive) {
      ctx.strokeStyle = 'rgba(140, 180, 90, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, CARD_H);
    }

    // Name
    ctx.fillStyle = isActive ? '#d0e0b0' : '#a0b090';
    ctx.font = 'bold 11px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(preset.name, x + 4, y + 3);

    // Tagline
    ctx.fillStyle = isActive ? '#90a080' : '#607050';
    ctx.font = '8px monospace';
    ctx.fillText(preset.tagline, x + 4, y + 16);

    // Unit icon strip
    const iconSize = ICON_SIZE;
    const iconY = y + 30;
    let iconX = x + 4;

    drawUnitIcon(ctx, iconX, iconY, iconSize, heroUnitId);
    iconX += iconSize + 1;

    // Separator
    ctx.fillStyle = 'rgba(100, 130, 70, 0.4)';
    ctx.fillRect(iconX, iconY + 1, 1, iconSize - 2);
    iconX += 3;

    for (const uid of preset.units) {
      if (iconX + iconSize > x + w - 30) break;
      drawUnitIcon(ctx, iconX, iconY, iconSize, uid);
      iconX += iconSize + 1;
    }

    // Formation preview (bottom-right)
    if (preset.formation && preset.units.length > 0) {
      const fmtSize = 22;
      const fmtCx = x + w - fmtSize / 2 - 4;
      const fmtCy = y + CARD_H - fmtSize / 2 - 4;
      drawFormationPreview(ctx, fmtCx, fmtCy, fmtSize, preset.formation, totalUnits);
    }

    // Stats summary (top-right)
    const stats = getPresetStats(preset, heroUnitId);
    ctx.fillStyle = '#708060';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${stats.count} units`, x + w - 4, y + 3);
    ctx.fillText(`${stats.armor}`, x + w - 4, y + 13);

    ctx.fillStyle = '#90a880';
    ctx.fillText(`${stats.dps} DPS`, x + w - 4, y + 23);

    // Hit rect
    zone._presetRects.push({
      x, y, w, h: CARD_H,
      presetId: preset.id
    });

    y += CARD_H + CARD_GAP;
  }

  endScrollClip(ctx, b, 'presets', x, scrollTop, w, clipH);

  // Filter out hit rects that scrolled outside the visible area
  filterRectsToClip(zone._presetRects, rectsStart, scrollTop, clipH);

  // ── Sticky legend at bottom ──
  let ly = bottom - legH;

  ctx.fillStyle = '#708060';
  ctx.font = 'bold 9px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('LEGEND', x + 4, ly + 2);
  ctx.fillStyle = 'rgba(100, 130, 70, 0.2)';
  ctx.fillRect(x, ly + 14, w, 1);
  ly += LEGEND_HEADER_H;

  const colW = Math.floor(w / LEGEND_COLS);
  for (let i = 0; i < LEGEND_UNITS.length; i++) {
    const col = i % LEGEND_COLS;
    const row = Math.floor(i / LEGEND_COLS);
    const lx = x + col * colW + 2;
    const ly2 = ly + row * LEGEND_ROW_H;

    drawUnitIcon(ctx, lx, ly2, ICON_SIZE, LEGEND_UNITS[i]);

    ctx.fillStyle = '#8a9478';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(LEGEND_LABELS[LEGEND_UNITS[i]] || LEGEND_UNITS[i].toUpperCase(), lx + ICON_SIZE + 4, ly2 + (ICON_SIZE - 8) / 2);
  }

  return bottom;
}
