// ═══════════════════════════════════════════════════════════════
// DEPLOY-CREW - Crew tree-view overlay for deployment panel
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { CREW_SCHEMAS, RANK_TABLE, UNITS, FORMATION_OFFSETS, UNIT_COMBAT_STATS } from './constants.js';
import {
  getRoster, getAvailable, getCrewForVehicle,
  assignToVehicle, unassignFromVehicle,
  getRankName, getSoldier, getCrewSchema
} from './roster.js';
import {
  registerScrollRegion, beginScrollClip, endScrollClip, filterRectsToClip
} from './panel-scroll.js';

// ─── Mode check ──────────────────────────────────────────────

export function isCrewMode() {
  return (Game.roster?.length || 0) > 0;
}

// ─── Constants ───────────────────────────────────────────────

const SLOT_LABELS = { tc: 'TC', gunner: 'GNR', driver: 'DRV' };
const INFANTRY_LABELS = {
  rifleman: 'RIFLE', medic: 'MEDIC', engineer: 'ENGR', heavy_gunner: 'HVY'
};
const SLOT_COLORS = {
  tc: '#d4b060',       // gold — commander
  gunner: '#60a0d4',   // blue — weapons
  driver: '#80c070'    // green — mobility
};

const INDENT_PX = 12;  // pixels per nesting level

/**
 * Measure total content height of a tree without drawing.
 * Respects collapsed state.
 */
function _measureTree(nodes, collapsed, depth = 0) {
  let total = 0;
  for (const node of nodes) {
    if (node.children) {
      const h = node.h || 18;
      total += h + 1;
      const isCollapsed = collapsed.get(node.key) ?? false;
      if (!isCollapsed) {
        total += _measureTree(node.children, collapsed, depth + 1) + 2;
      }
    } else {
      total += node.h || 16;
    }
  }
  return total;
}

/**
 * Draw a scrollable tree panel using the shared panel-scroll system.
 */
function drawScrollableTree(ctx, x, y, w, clipH, nodes, shared, b, panelKey) {
  const contentH = _measureTree(nodes, shared.collapsed);
  const scroll = registerScrollRegion(b, panelKey, x, y, w, clipH, contentH);

  // Snapshot rect array lengths before drawing
  const rectsBefore = new Map();
  const allArrays = [shared.sectionRects];
  (function gather(list) {
    for (const n of list) {
      if (n.rects && !rectsBefore.has(n.rects)) rectsBefore.set(n.rects, n.rects.length);
      if (n.children) gather(n.children);
    }
  })(nodes);
  for (const arr of allArrays) {
    if (!rectsBefore.has(arr)) rectsBefore.set(arr, arr.length);
  }

  // Clip + draw
  beginScrollClip(ctx, x, y, w, clipH);
  const scrolledShared = { ...shared, bodyBottom: y - scroll + contentH + 20 };
  drawTree(ctx, x, y - scroll, w, nodes, scrolledShared);
  endScrollClip(ctx, b, panelKey, x, y, w, clipH);

  // Remove hit rects outside visible area
  for (const [arr, startIdx] of rectsBefore) {
    filterRectsToClip(arr, startIdx, y, clipH);
  }

  return y + clipH;
}

// ─── Low-level canvas helpers ────────────────────────────────

/** Draw tree connector lines (vertical + horizontal stub). */
function _connector(ctx, x, y, h, indent) {
  const connX = x + indent - 8;
  ctx.fillStyle = 'rgba(100, 130, 70, 0.2)';
  ctx.fillRect(connX, y - 1, 1, h);
  ctx.fillRect(connX, y + h / 2 - 1, 7, 1);
}

/** Draw a thin horizontal bar (morale, expertise, etc.). */
function _miniBar(ctx, x, y, w, h, value, bgColor, fillColor) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, value)), h);
}

// ─── Recursive tree renderer ─────────────────────────────────

/**
 * Draw a tree of nodes with automatic depth-based indentation.
 *
 * Node shapes:
 *
 *   Branch (has children, collapsible):
 *   {
 *     label, key, children,
 *     count, h, bg, labelFont, labelColor,
 *     selected, right, rightColor,
 *     rects, data,           // push { ...hitRect, ...data } into rects[]
 *     afterDraw(ctx, x, y, w, h)
 *   }
 *
 *   Leaf (no children):
 *   {
 *     h,
 *     badge, badgeColor,
 *     text, textColor, textFont, textOffset,
 *     right, rightColor,
 *     selected,
 *     rects, data,
 *     afterDraw(ctx, x, y, w, h)
 *   }
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x       - Column left edge
 * @param {number} y       - Current y position
 * @param {number} w       - Column width
 * @param {Array}  nodes   - Array of node objects
 * @param {object} shared  - { collapsed: Map, sectionRects: [], bodyBottom: number }
 * @param {number} [depth] - Current nesting depth (auto-managed)
 * @returns {number} y after last drawn node
 */
function drawTree(ctx, x, y, w, nodes, shared, depth = 0) {
  const indent = depth * INDENT_PX;

  for (const node of nodes) {
    if (y + 14 > shared.bodyBottom) break;

    if (node.children) {
      // ── Branch: collapsible header ──
      const h = node.h || 18;
      const isCollapsed = shared.collapsed.get(node.key) ?? false;
      const lx = x + indent;
      const lw = w - indent;

      // Tree connector for nested headers
      if (indent > 0) _connector(ctx, x, y, h, indent);

      // Background
      const bg = node.selected
        ? 'rgba(160, 200, 110, 0.12)'
        : (node.bg || 'rgba(40, 55, 30, 0.5)');
      ctx.fillStyle = bg;
      ctx.fillRect(lx - 2, y - 1, lw + 4, h);

      // Collapse indicator
      ctx.fillStyle = '#708060';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(isCollapsed ? '▸' : '▾', lx + 1, y + Math.floor(h / 6));

      // Label
      ctx.fillStyle = node.selected ? '#d0e0b0' : (node.labelColor || '#a0b090');
      ctx.font = node.labelFont || 'bold 10px Oxanium, monospace';
      const suffix = node.count != null ? ` (${node.count})` : '';
      ctx.fillText(`${node.label}${suffix}`, lx + 10, y + Math.floor(h / 8));

      // Right text
      if (node.right) {
        ctx.fillStyle = node.rightColor || '#708060';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(node.right, lx + lw - 2, y + Math.floor(h / 6));
      }

      // Hit rect — full row goes to section rects for collapse
      const rect = { x: lx - 2, y: y - 1, w: lw + 4, h, key: node.key };
      shared.sectionRects.push(rect);
      // Also push to node's own rects array for selection (checked first)
      if (node.rects) node.rects.push({ ...rect, ...(node.data || {}) });

      if (node.afterDraw) node.afterDraw(ctx, x, y, w, h);

      y = rect.y + rect.h + 1;

      // Recurse into children if expanded
      if (!isCollapsed) {
        y = drawTree(ctx, x, y, w, node.children, shared, depth + 1);
        y += 2;
      }

    } else {
      // ── Leaf: indented row with tree connector ──
      const h = node.h || 16;
      const leafIndent = indent > 0 ? indent : INDENT_PX;
      const rx = x + leafIndent - 2;
      const rw = w - leafIndent + 2;

      if (node.selected) {
        ctx.fillStyle = 'rgba(160, 200, 110, 0.12)';
        ctx.fillRect(rx, y - 1, rw, h);
      }
      _connector(ctx, x, y, h, leafIndent);

      // Badge
      if (node.badge) {
        ctx.fillStyle = node.badgeColor || '#90a080';
        ctx.font = node.badgeFont || 'bold 9px Oxanium, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(node.badge, x + leafIndent, y + 3);
      }

      // Text
      if (node.text) {
        ctx.fillStyle = node.selected ? '#d0e0b0' : (node.textColor || '#8a9478');
        ctx.font = node.textFont || '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(node.text, x + leafIndent + (node.textOffset || 32), y + 3);
      }

      // Right text
      if (node.right) {
        ctx.fillStyle = node.rightColor || '#708060';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(node.right, x + w - 4, y + 3);
      }

      const rect = { x: rx, y: y - 1, w: rw, h };
      if (node.rects) node.rects.push({ ...rect, ...(node.data || {}) });

      if (node.afterDraw) node.afterDraw(ctx, x, y, w, h);

      y += h;
    }
  }

  return y;
}

// ─── Tree builders ───────────────────────────────────────────

/** Build crew slot leaf nodes for a vehicle. */
function _crewSlotNodes(b, zone, u, sel, multi) {
  const vehicleId = u.id || u._crewVehicleId;
  const schema = getCrewSchema(u.unitId);
  if (!schema || schema[0] === 'self') return [];

  const crew = vehicleId ? getCrewForVehicle(vehicleId) : {};
  return schema.map(slot => {
    const soldier = crew[slot];
    const slotLabel = SLOT_LABELS[slot] || slot.toUpperCase();
    const slotColor = SLOT_COLORS[slot] || '#90a080';
    const isSlotSel = (sel?.type === 'crew-slot' &&
                      sel.vehicleId === vehicleId && sel.slot === slot) ||
                      (multi && multi.some(m => m.type === 'crew-slot' && m.vehicleId === vehicleId && m.slot === slot));

    let text, textColor;
    if (soldier) {
      const rankAbbr = RANK_TABLE[soldier.rankIndex]?.abbr || '';
      text = `${rankAbbr} ${soldier.name.last}`;
      textColor = isSlotSel ? '#c0d0b0' : '#8a9478';
    } else {
      text = '— empty —';
      textColor = isSlotSel ? '#807060' : '#505840';
    }

    return {
      h: 16,
      badge: slotLabel,
      badgeColor: slotColor,
      text, textColor,
      selected: isSlotSel,
      rects: zone._lineupRects,
      data: { type: 'crew-slot', vehicleId, slot, unitRef: u, soldier },
      afterDraw: soldier ? (ctx, x, y, w) => {
        const expertise = soldier.vehicleExpertise?.[u.unitId] ?? 0;
        if (expertise > 0) {
          _miniBar(ctx, x + w - 34, y + 4, 30, 5,
            expertise, 'rgba(60, 80, 45, 0.4)', 'rgba(140, 176, 96, 0.7)');
        }
      } : null
    };
  });
}

// ─── Col 2: Crew tree-view lineup ───────────────────────────

export function drawCrewLineup(ctx, b, zone, units, hero, x2, colW_2, my, bodyBottom, rowH) {
  // Single unified rect array for ALL lineup rows
  if (!zone._lineupRects) zone._lineupRects = [];
  zone._lineupRects.length = 0;
  if (!zone._removeUnitRects) zone._removeUnitRects = [];
  zone._removeUnitRects.length = 0;
  if (!b._crewCollapsed) b._crewCollapsed = new Map();

  // Split units into vehicles and infantry
  const allVehicles = [];
  const allInfantry = [];

  if (hero) {
    const s = getCrewSchema(hero.unitId);
    (s && s[0] !== 'self' ? allVehicles : allInfantry).push(hero);
  }
  for (const u of (units || [])) {
    const s = getCrewSchema(u.unitId);
    (s && s[0] !== 'self' ? allVehicles : allInfantry).push(u);
  }

  // Lineup tree uses its own throwaway sectionRects — no collapse behavior
  const _discardedSectionRects = [];
  const shared = {
    collapsed: b._crewCollapsed,
    sectionRects: _discardedSectionRects,
    bodyBottom
  };

  const sel = b._lineupSelection; // { type, unitRef?, group?, slot?, vehicleId?, soldier? }
  const multi = b._lineupMultiSelect || [];
  const isMultiSel = (u, type) => multi.some(m => m.type === type && m.unitRef === u);
  const tree = [];

  if (allVehicles.length > 0) {
    tree.push({
      label: 'VEHICLES', key: 'lineup-vehicles', count: allVehicles.length,
      selected: sel?.type === 'group' && sel.group === 'vehicles',
      rects: zone._lineupRects,
      data: { type: 'group', group: 'vehicles', unitRefs: allVehicles },
      children: allVehicles.map(u => {
        const isHero = u === hero;
        const unitName = UNITS.find(ud => ud.id === u.unitId)?.name || u.unitId.toUpperCase();
        const vehicleId = u.id || u._crewVehicleId;
        return {
          label: `${isHero ? '★ ' : ''}${unitName}`,
          key: `vehicle-${vehicleId}`,
          h: 16, bg: 'rgba(50, 65, 40, 0.3)',
          labelFont: 'bold 9px Oxanium, monospace',
          selected: (sel?.type === 'vehicle' && sel.unitRef === u) ||
                    (sel?.type === 'group' && sel.group === 'vehicles' && sel.unitRefs?.includes(u)) ||
                    isMultiSel(u, 'vehicle'),
          right: isHero ? 'YOU' : null, rightColor: '#90a080',
          rects: zone._lineupRects,
          data: { type: 'vehicle', unitId: u.unitId, unitRef: u, vehicleId },
          children: _crewSlotNodes(b, zone, u, sel, multi),
          afterDraw: !isHero ? (ctx, x, y, w, h) => {
            const rmS = 12, rmX = x + w - rmS - 2, rmY = y + (h - rmS) / 2;
            ctx.fillStyle = 'rgba(120, 60, 50, 0.2)';
            ctx.fillRect(rmX, rmY, rmS, rmS);
            ctx.fillStyle = '#806050';
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('✕', rmX + rmS / 2, rmY + rmS / 2);
            zone._removeUnitRects.push({ x: rmX, y: rmY, w: rmS, h: rmS, unitRef: u });
          } : null
        };
      })
    });
  }

  if (allInfantry.length > 0) {
    tree.push({
      label: 'SOLDIERS', key: 'lineup-infantry', count: allInfantry.length,
      selected: sel?.type === 'group' && sel.group === 'soldiers',
      rects: zone._lineupRects,
      data: { type: 'group', group: 'soldiers', unitRefs: allInfantry },
      children: allInfantry.map(u => {
        const isHero = u === hero;
        const unitName = UNITS.find(ud => ud.id === u.unitId)?.name || u.unitId.toUpperCase();
        return {
          h: 16,
          badge: unitName.slice(0, 4).toUpperCase(),
          text: `${isHero ? '★ ' : ''}${typeof u.unitName === 'string' ? u.unitName : (u.unitName?.display || u.id)}`,
          textOffset: 36,
          selected: (sel?.type === 'infantry' && sel.unitRef === u) ||
                    (sel?.type === 'group' && sel.group === 'soldiers' && sel.unitRefs?.includes(u)) ||
                    isMultiSel(u, 'infantry'),
          rects: zone._lineupRects,
          data: { type: 'infantry', unitId: u.unitId, unitRef: u },
          afterDraw: !isHero ? (ctx, x, y, w, h) => {
            const rmS = 12, rmX = x + w - rmS - 2, rmY = y + (h - rmS) / 2;
            ctx.fillStyle = 'rgba(120, 60, 50, 0.2)';
            ctx.fillRect(rmX, rmY, rmS, rmS);
            ctx.fillStyle = '#806050';
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('✕', rmX + rmS / 2, rmY + rmS / 2);
            zone._removeUnitRects.push({ x: rmX, y: rmY, w: rmS, h: rmS, unitRef: u });
          } : null
        };
      })
    });
  }

  const clipH = bodyBottom - my;
  return drawScrollableTree(ctx, x2, my, colW_2, clipH, tree, shared, b, 'lineup');
}

// ─── Col 3: Crew-filtered available roster ──────────────────

export function drawCrewAvailable(ctx, b, zone, x3, colW_3, ry, bodyBottom, resRowH) {
  if (!zone._crewRosterRects) zone._crewRosterRects = [];
  zone._crewRosterRects.length = 0;
  if (!zone._crewAddRects) zone._crewAddRects = [];
  zone._crewAddRects.length = 0;
  if (!zone._motorPoolRects) zone._motorPoolRects = [];
  zone._motorPoolRects.length = 0;
  if (!zone._poolTabRects) zone._poolTabRects = [];
  zone._poolTabRects.length = 0;
  if (!zone._sectionHitRects) zone._sectionHitRects = [];
  zone._sectionHitRects.length = 0;
  if (!b._crewCollapsed) b._crewCollapsed = new Map();
  if (!b._poolTab) b._poolTab = 'barracks';

  // ── Tab bar ──
  const tabH = 16;
  const tabW = Math.floor(colW_3 / 2);
  const tabs = [
    { id: 'barracks', label: 'BARRACKS' },
    { id: 'motorpool', label: 'MOTOR POOL' }
  ];

  for (let i = 0; i < tabs.length; i++) {
    const tx = x3 + i * tabW;
    const isActive = b._poolTab === tabs[i].id;

    ctx.fillStyle = isActive ? 'rgba(80, 110, 55, 0.5)' : 'rgba(40, 55, 30, 0.3)';
    ctx.fillRect(tx, ry, tabW - 1, tabH);

    if (isActive) {
      ctx.fillStyle = 'rgba(140, 180, 90, 0.6)';
      ctx.fillRect(tx, ry + tabH - 2, tabW - 1, 2);
    }

    ctx.fillStyle = isActive ? '#c0d0a0' : '#708060';
    ctx.font = 'bold 8px Oxanium, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tabs[i].label, tx + tabW / 2, ry + tabH / 2);

    zone._poolTabRects.push({ x: tx, y: ry, w: tabW - 1, h: tabH, tab: tabs[i].id });
  }
  ry += tabH + 4;

  // ── Barracks tab: crew soldiers ──
  if (b._poolTab === 'barracks') {
    return _drawBarracksTab(ctx, b, zone, x3, colW_3, ry, bodyBottom, resRowH);
  }

  // ── Motor Pool tab: reserve vehicles/infantry ──
  return _drawMotorPoolTab(ctx, b, zone, x3, colW_3, ry, bodyBottom, resRowH);
}

function _drawBarracksTab(ctx, b, zone, x3, colW_3, ry, bodyBottom, resRowH) {
  // Barracks shows infantry pool soldiers (rifleman, medic, engineer, heavy_gunner)
  const roster = getRoster();
  const soldiers = roster.filter(s =>
    s.pool === 'infantry' && s.status === 'active'
  );
  const headerText = `INFANTRY (${soldiers.length})`;

  // Sub-header
  ctx.fillStyle = '#708060';
  ctx.font = '9px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(headerText, x3, ry);
  ry += 14;

  if (soldiers.length === 0) {
    ctx.fillStyle = '#506040';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('No infantry soldiers', x3 + 4, ry);
    return ry + 14;
  }

  // Group by role
  const groups = {};
  for (const s of soldiers) {
    if (!groups[s.role]) groups[s.role] = [];
    groups[s.role].push(s);
  }

  const shared = {
    collapsed: b._crewCollapsed,
    sectionRects: zone._sectionHitRects,
    bodyBottom
  };

  const tree = [];
  for (const role of ['rifleman', 'medic', 'engineer', 'heavy_gunner']) {
    const group = groups[role];
    if (!group || group.length === 0) continue;

    tree.push({
      label: INFANTRY_LABELS[role] || role.toUpperCase(),
      key: `pool-${role}`,
      count: group.length,
      children: group.map(s => {
        const isSel = b._selectedCrewSoldier?.id === s.id;
        const rankAbbr = RANK_TABLE[s.rankIndex]?.abbr || 'PVT';
        const morale = s.morale ?? 0.5;
        return {
          h: resRowH,
          badge: rankAbbr,
          badgeColor: isSel ? '#c0d0a0' : '#708060',
          text: s.name.last,
          textOffset: 30,
          selected: isSel,
          rects: zone._crewRosterRects,
          data: { soldier: s },
          afterDraw: (ctx, x, y, w, h) => {
            _miniBar(ctx, x + w - 24, y + 3, 20, 4,
              morale, 'rgba(60, 80, 45, 0.3)',
              morale > 0.5 ? 'rgba(100, 180, 80, 0.6)' : 'rgba(200, 140, 60, 0.6)');
          }
        };
      })
    });
  }

  const clipH = bodyBottom - ry;
  return drawScrollableTree(ctx, x3, ry, colW_3, clipH, tree, shared, b, 'pool');
}

function _drawMotorPoolTab(ctx, b, zone, x3, colW_3, ry, bodyBottom, resRowH) {
  const lineSel = b._lineupSelection;
  const selectedSlot = (lineSel?.type === 'crew-slot') ? lineSel : null;

  // ── Vehicle crew section (TC/GNR/DRV from roster) ──
  let crewSoldiers, crewHeader;
  if (selectedSlot) {
    crewSoldiers = getAvailable('vehicle', selectedSlot.slot);
    const slotLabel = SLOT_LABELS[selectedSlot.slot] || selectedSlot.slot.toUpperCase();
    crewHeader = `${slotLabel} POOL (${crewSoldiers.length})`;
  } else {
    const roster = getRoster();
    crewSoldiers = roster.filter(s =>
      s.pool === 'vehicle' && s.status === 'active' && s.assignedVehicleId == null
    );
    crewHeader = `CREW POOL (${crewSoldiers.length})`;
  }

  // Group crew by role
  const crewGroups = {};
  for (const s of crewSoldiers) {
    if (!crewGroups[s.role]) crewGroups[s.role] = [];
    crewGroups[s.role].push(s);
  }

  const crewTree = [];
  for (const role of ['tc', 'gunner', 'driver']) {
    const group = crewGroups[role];
    if (!group || group.length === 0) continue;
    crewTree.push({
      label: SLOT_LABELS[role] || role.toUpperCase(),
      key: `pool-${role}`,
      count: group.length,
      children: group.map(s => {
        const isSel = b._selectedCrewSoldier?.id === s.id;
        const rankAbbr = RANK_TABLE[s.rankIndex]?.abbr || 'PVT';
        const morale = s.morale ?? 0.5;
        return {
          h: resRowH,
          badge: rankAbbr,
          badgeColor: isSel ? '#c0d0a0' : '#708060',
          text: s.name.last,
          textOffset: 30,
          selected: isSel,
          rects: zone._crewRosterRects,
          data: { soldier: s },
          afterDraw: (ctx, x, y, w, h) => {
            const canAssign = selectedSlot && s.role === selectedSlot.slot && !selectedSlot.soldier;
            if (canAssign) {
              const addS = 12, addX = x + w - addS - 2, addY = y + (h - addS) / 2;
              ctx.fillStyle = isSel ? 'rgba(80, 160, 60, 0.3)' : 'rgba(60, 120, 50, 0.2)';
              ctx.fillRect(addX, addY, addS, addS);
              ctx.fillStyle = isSel ? '#80c060' : '#608050';
              ctx.font = 'bold 10px monospace';
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText('+', addX + addS / 2, addY + addS / 2);
              zone._crewAddRects.push({ x: addX, y: addY, w: addS, h: addS, soldier: s });
            } else {
              _miniBar(ctx, x + w - 24, y + 3, 20, 4,
                morale, 'rgba(60, 80, 45, 0.3)',
                morale > 0.5 ? 'rgba(100, 180, 80, 0.6)' : 'rgba(200, 140, 60, 0.6)');
            }
          }
        };
      })
    });
  }

  // ── Reserve vehicles section ──
  const allReserves = b.reservePool || [];
  const reserves = allReserves.filter(r => {
    const s = getCrewSchema(r.unitId);
    return s && s[0] !== 'self';
  });
  const capacity = FORMATION_OFFSETS[b._deployFormation || 'line']?.length || 7;
  const filled = 1 + (b.units?.length || 0);
  const vehicleRowH = 28;

  // Build vehicle tree entries
  const vehicleTree = [];
  if (reserves.length > 0) {
    vehicleTree.push({
      label: 'VEHICLES',
      key: 'pool-vehicles',
      count: reserves.length,
      children: reserves.map(r => {
        const isSel = b._selectedUnit?.id === r.id;
        const unitDef = UNITS.find(u => u.id === r.unitId);
        const combat = UNIT_COMBAT_STATS[r.unitId];
        const vehicleName = unitDef?.name || r.unitId.toUpperCase();
        return {
          h: vehicleRowH,
          badge: vehicleName,
          badgeColor: isSel ? '#d0e0b0' : '#a0b090',
          badgeFont: 'bold 9px Oxanium, monospace',
          selected: isSel,
          rects: zone._motorPoolRects,
          data: { unitRef: r, unitId: r.unitId },
          afterDraw: (ctx, x, y, w, h) => {
            // Stats line below name
            const hp = combat?.hp || unitDef?.damage || '?';
            const spd = combat?.speed || '?';
            const rng = combat?.range || '?';
            ctx.fillStyle = '#607050';
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`HP ${hp}  SPD ${spd}  RNG ${rng}`, x + 12, y + 14);

            // + add button
            if (filled < capacity) {
              const addS = 14, addX = x + w - addS - 2, addY2 = y + (h - addS) / 2 - 1;
              ctx.fillStyle = isSel ? 'rgba(80, 160, 60, 0.3)' : 'rgba(60, 120, 50, 0.2)';
              ctx.fillRect(addX, addY2, addS, addS);
              ctx.fillStyle = isSel ? '#80c060' : '#608050';
              ctx.font = 'bold 11px monospace';
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText('+', addX + addS / 2, addY2 + addS / 2);
              zone._addUnitRects.push({ x: addX, y: addY2, w: addS, h: addS, unitRef: r });
            }
          }
        };
      })
    });
  }

  // Combine crew + vehicles into one scrollable tree
  const tree = [...crewTree, ...vehicleTree];

  // Header
  ctx.fillStyle = '#708060';
  ctx.font = '9px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(crewHeader, x3, ry);
  ry += 14;

  if (tree.length === 0) {
    ctx.fillStyle = '#506040';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('No crew or vehicles', x3 + 4, ry);
    return ry + 14;
  }

  const shared = {
    collapsed: b._crewCollapsed,
    sectionRects: zone._sectionHitRects,
    bodyBottom
  };

  const clipH = bodyBottom - ry;
  return drawScrollableTree(ctx, x3, ry, colW_3, clipH, tree, shared, b, 'motorpool');

  return ry + clipH;
}

// ─── Col 4: Crew card overlay ───────────────────────────────

export function drawCrewCard(ctx, b, x4, colW_4, cy, bodyBottom) {
  const slot = b._selectedCrewSlot;
  if (!slot?.soldier) return cy;

  const s = slot.soldier;
  const rankInfo = RANK_TABLE[s.rankIndex] || RANK_TABLE[0];

  // Soldier name + rank
  ctx.fillStyle = '#d0e0b0';
  ctx.font = 'bold 12px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${rankInfo.abbr} ${s.name.first} ${s.name.last}`, x4, cy);
  cy += 16;

  // Role label
  ctx.fillStyle = SLOT_COLORS[slot.slot] || '#90a080';
  ctx.font = 'bold 10px Oxanium, monospace';
  ctx.fillText(SLOT_LABELS[slot.slot] || slot.slot.toUpperCase(), x4, cy);
  cy += 16;

  // Stats
  const stats = [
    ['XP', `${s.experience}`],
    ['BATTLES', `${s.battlesServed}`],
    ['KILLS', `${s.kills}`],
    ['MORALE', `${(s.morale * 100).toFixed(0)}%`],
    ['SURV', `${(s.survivability * 100).toFixed(0)}%`]
  ];

  for (const [label, val] of stats) {
    if (cy + 14 > bodyBottom) break;
    ctx.fillStyle = '#708060';
    ctx.font = '9px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x4, cy);
    ctx.fillStyle = '#b0c0a0';
    ctx.textAlign = 'right';
    ctx.fillText(val, x4 + colW_4 / 2, cy);
    cy += 13;
  }
  cy += 6;

  // Personality traits
  const traits = ['aggression', 'patience', 'courage', 'discipline', 'initiative', 'awareness'];
  const labels = ['AGGR', 'PAT ', 'COUR', 'DISC', 'INIT', 'AWAR'];
  const barW = colW_4 - 60;

  ctx.fillStyle = '#90a880';
  ctx.font = 'bold 9px Oxanium, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('PERSONALITY', x4, cy);
  cy += 14;

  for (let i = 0; i < traits.length; i++) {
    if (cy + 14 > bodyBottom) break;
    const val = s.personality[traits[i]] ?? 0.5;

    ctx.fillStyle = '#708060';
    ctx.font = '9px Oxanium, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(labels[i], x4, cy);

    _miniBar(ctx, x4 + 36, cy, barW, 10, val,
      'rgba(60, 80, 45, 0.4)', 'rgba(140, 176, 96, 0.7)');

    ctx.fillStyle = '#90a080';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(2), x4 + colW_4, cy);
    cy += 14;
  }

  // Vehicle expertise
  if (slot.unitRef) {
    const unitId = slot.unitRef.unitId;
    const expertise = s.vehicleExpertise?.[unitId] ?? 0;
    if (cy + 20 < bodyBottom) {
      cy += 6;
      ctx.fillStyle = '#90a880';
      ctx.font = 'bold 9px Oxanium, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${unitId.toUpperCase()} EXPERTISE`, x4, cy);
      cy += 14;
      _miniBar(ctx, x4, cy, colW_4, 8, expertise,
        'rgba(60, 80, 45, 0.4)', 'rgba(100, 160, 200, 0.7)');
      cy += 14;
    }
  }

  return cy;
}

// ─── Click handlers ─────────────────────────────────────────

/**
 * Unified lineup click handler. Every row type handled here.
 * Supports Ctrl+click multi-select (same category only).
 * Returns true if a hit was found.
 */
export function handleLineupClick(b, zone, screenX, screenY, ctrlKey) {
  if (!zone._lineupRects) return false;
  const _hit = (r) => r && screenX >= r.x && screenX <= r.x + r.w &&
                       screenY >= r.y && screenY <= r.y + r.h;

  for (const lr of zone._lineupRects) {
    if (!_hit(lr)) continue;

    // Category: 'vehicle', 'infantry', or 'crew-slot'
    const clickCat = lr.type === 'group' ? lr.group : lr.type;

    // ── Ctrl+click: multi-select (same category only) ──
    if (ctrlKey && lr.type !== 'group') {
      if (!b._lineupMultiSelect) b._lineupMultiSelect = [];
      const multi = b._lineupMultiSelect;

      // Seed multi with current single selection if empty and compatible
      if (multi.length === 0 && b._lineupSelection &&
          b._lineupSelection.type === lr.type && b._lineupSelection.type !== 'group' &&
          (lr.type !== 'crew-slot' || b._lineupSelection.slot === lr.slot)) {
        // Don't seed if it's the same item we're about to click
        const isSameItem = lr.type === 'crew-slot'
          ? (b._lineupSelection.vehicleId === lr.vehicleId && b._lineupSelection.slot === lr.slot)
          : (b._lineupSelection.unitRef === lr.unitRef);
        if (!isSameItem) {
          multi.push({ ...b._lineupSelection });
        }
      }

      // "Same category" means same type AND same slot for crew-slots
      // (all drivers together, all gunners together — mixing resets)
      const sameCategory = multi.length === 0 ||
        (multi[0].type === lr.type &&
         (lr.type !== 'crew-slot' || multi[0].slot === lr.slot));

      if (!sameCategory) {
        // Different category — clear and start fresh with this item
        b._lineupMultiSelect = [{ ...lr }];
        b._lineupSelection = { ...lr };
      } else {
        // Same category — toggle this item in/out
        const idx = lr.type === 'crew-slot'
          ? multi.findIndex(m => m.vehicleId === lr.vehicleId && m.slot === lr.slot)
          : multi.findIndex(m => m.unitRef === lr.unitRef);
        if (idx >= 0) {
          multi.splice(idx, 1);
        } else {
          multi.push({ ...lr });
        }

        if (multi.length === 0) {
          b._lineupSelection = null;
          b._lineupMultiSelect = null;
        } else if (multi.length === 1) {
          b._lineupSelection = { ...multi[0] };
        } else {
          // Multi-select: create a group-like selection
          const group = lr.type === 'vehicle' ? 'vehicles'
            : lr.type === 'crew-slot' ? lr.slot
            : 'soldiers';
          b._lineupSelection = {
            type: 'group',
            group,
            unitRefs: multi.map(m => m.unitRef),
            soldiers: lr.type === 'crew-slot' ? multi.map(m => m.soldier).filter(Boolean) : null
          };
        }
      }

      // Auto-switch tab: vehicles + crew-slots → motor pool, infantry → barracks
      if (lr.type === 'vehicle' || lr.type === 'crew-slot') b._poolTab = 'motorpool';
      else b._poolTab = 'barracks';
      return true;
    }

    // ── Normal click: single select ──
    b._lineupMultiSelect = null;

    const prev = b._lineupSelection;
    const sameClick = prev && prev.type === lr.type &&
      ((lr.type === 'group' && prev.group === lr.group) ||
       (lr.type === 'vehicle' && prev.unitRef === lr.unitRef) ||
       (lr.type === 'infantry' && prev.unitRef === lr.unitRef) ||
       (lr.type === 'crew-slot' && prev.vehicleId === lr.vehicleId && prev.slot === lr.slot));

    if (sameClick) {
      b._lineupSelection = null;
    } else {
      b._lineupSelection = { ...lr };

      if (lr.type === 'group') {
        b._poolTab = (lr.group === 'vehicles' || lr.group === 'tc' || lr.group === 'gunner' || lr.group === 'driver') ? 'motorpool' : 'barracks';
      } else if (lr.type === 'vehicle' || lr.type === 'crew-slot') {
        b._poolTab = 'motorpool';
      } else if (lr.type === 'infantry') {
        b._poolTab = 'barracks';
      }
    }
    return true;
  }
  return false;
}

/** Collapse toggle for Barracks tree headers (TC/GNR/DRV). */
export function handleSectionHeaderClick(b, zone, screenX, screenY) {
  if (!zone._sectionHitRects || !b._crewCollapsed) return false;
  for (const hr of zone._sectionHitRects) {
    if (screenX >= hr.x && screenX <= hr.x + hr.w &&
        screenY >= hr.y && screenY <= hr.y + hr.h) {
      b._crewCollapsed.set(hr.key, !b._crewCollapsed.get(hr.key));
      return true;
    }
  }
  return false;
}

export function handleCrewAvailableClick(b, zone, screenX, screenY) {
  if (!zone._crewRosterRects) return false;
  const _hit = (r) => r && screenX >= r.x && screenX <= r.x + r.w &&
                       screenY >= r.y && screenY <= r.y + r.h;

  for (const rr of zone._crewRosterRects) {
    if (_hit(rr)) {
      // Toggle by ID (reference comparison can fail across frames)
      const current = b._selectedCrewSoldier;
      if (current && rr.soldier && current.id === rr.soldier.id) {
        b._selectedCrewSoldier = null;
      } else {
        b._selectedCrewSoldier = rr.soldier;
      }
      return true;
    }
  }
  return false;
}

export function handlePoolTabClick(b, zone, screenX, screenY) {
  if (!zone._poolTabRects) return false;
  for (const tr of zone._poolTabRects) {
    if (screenX >= tr.x && screenX <= tr.x + tr.w &&
        screenY >= tr.y && screenY <= tr.y + tr.h) {
      b._poolTab = tr.tab;
      return true;
    }
  }
  return false;
}

export function handleMotorPoolClick(b, zone, screenX, screenY) {
  if (!zone._motorPoolRects) return false;
  const _hit = (r) => r && screenX >= r.x && screenX <= r.x + r.w &&
                       screenY >= r.y && screenY <= r.y + r.h;
  for (const mr of zone._motorPoolRects) {
    if (_hit(mr)) {
      const current = b._selectedUnit;
      if (current && mr.unitRef && current.id === mr.unitRef.id) {
        b._selectedUnit = null;
      } else {
        b._selectedUnit = mr.unitRef;
      }
      return true;
    }
  }
  return false;
}

export function handleCrewAddClick(b, zone, screenX, screenY) {
  if (!zone._crewAddRects) return false;
  const lineSel = b._lineupSelection;
  if (!lineSel || lineSel.type !== 'crew-slot' || !lineSel.vehicleId || lineSel.soldier) return false;

  for (const ar of zone._crewAddRects) {
    if (screenX >= ar.x && screenX <= ar.x + ar.w &&
        screenY >= ar.y && screenY <= ar.y + ar.h) {
      const s = ar.soldier;
      if (s && s.role === lineSel.slot) {
        assignToVehicle(s.id, lineSel.vehicleId, lineSel.slot);
        b._lineupSelection.soldier = s;
        b._selectedCrewSoldier = null;
      }
      return true;
    }
  }
  return false;
}

export function handleCrewTransfer(b, direction) {
  const lineSel = b._lineupSelection;

  // ── Crew soldier swap (crew-slot selected + barracks soldier selected) ──
  if (lineSel?.type === 'crew-slot' && b._selectedCrewSoldier) {
    if (direction === 'left') {
      const soldier = b._selectedCrewSoldier;
      if (!lineSel.vehicleId || soldier.role !== lineSel.slot) return false;
      assignToVehicle(soldier.id, lineSel.vehicleId, lineSel.slot);
      b._lineupSelection.soldier = soldier;
      b._selectedCrewSoldier = null;
      return true;
    }
  }

  if (direction === 'right' && lineSel?.type === 'crew-slot' && lineSel.soldier) {
    unassignFromVehicle(lineSel.soldier.id);
    b._lineupSelection.soldier = null;
    return true;
  }

  // ── Whole unit transfer (vehicle/infantry between lineup ↔ reserves) ──
  const unitRef = lineSel?.unitRef;
  if (!unitRef || unitRef === b.hero) return false;
  if (lineSel.type !== 'vehicle' && lineSel.type !== 'infantry') return false;

  if (!b.reservePool) b.reservePool = [];
  if (!b.units) b.units = [];
  const reserves = b.reservePool;

  if (direction === 'right' && b.units.includes(unitRef)) {
    // Push from lineup to reserves
    b.units.splice(b.units.indexOf(unitRef), 1);
    reserves.push(unitRef);

    // Unassign all crew from this vehicle
    const vehicleId = unitRef.id || unitRef._crewVehicleId;
    if (vehicleId) {
      const crew = getCrewForVehicle(vehicleId);
      for (const s of Object.keys(crew)) {
        if (crew[s]) unassignFromVehicle(crew[s].id);
      }
    }
    b._lineupSelection = null;
    return true;
  }

  return false;
}

/** Auto-assign best available crew to a single vehicle. */
function _autoAssignCrewForUnit(unit, vehicleId) {
  const schema = getCrewSchema(unit.unitId);
  if (!schema || schema[0] === 'self') return;

  for (const slot of schema) {
    const existing = getCrewForVehicle(vehicleId)[slot];
    if (existing) continue;

    const candidates = getAvailable('vehicle', slot);
    if (candidates.length === 0) continue;

    // Pick best by expertise for this unit type, then by rank
    candidates.sort((a, c) => {
      const expA = a.vehicleExpertise?.[unit.unitId] ?? 0;
      const expB = c.vehicleExpertise?.[unit.unitId] ?? 0;
      if (expA !== expB) return expB - expA;
      return c.rankIndex - a.rankIndex;
    });

    assignToVehicle(candidates[0].id, vehicleId, slot);
  }
}

export function clearCrewSelection(b) {
  b._lineupSelection = null;
  b._selectedCrewSlot = null;
  b._selectedCrewSoldier = null;
}
