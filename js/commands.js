// ═══════════════════════════════════════════════════════════════
// COMMANDS - Execute actions triggered by gestures
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';
import { render } from './ui.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Get battle state
// ═══════════════════════════════════════════════════════════════

function getBattle() {
  return Game.campaign?.heroBattle;
}

function showFeedback(text) {
  const b = getBattle();
  if (b) {
    b.commandFeedback = { text, time: Date.now() };
  }
}

// ═══════════════════════════════════════════════════════════════
// UNIT COMMANDS (Individual unit actions)
// ═══════════════════════════════════════════════════════════════

export function executeUnitCommand(unitId, command, params = {}) {
  const b = getBattle();
  if (!b) return;

  const unit = b.units.find(u => u.id === unitId);
  if (!unit || unit.hp <= 0) return;

  switch (command) {
    case 'select':
      // Toggle selection in multi-select mode
      if (b.squad.multiSelectMode) {
        const idx = b.squad.selectedUnits.indexOf(unitId);
        if (idx >= 0) {
          b.squad.selectedUnits.splice(idx, 1);
        } else {
          b.squad.selectedUnits.push(unitId);
        }
      } else {
        // Single select mode
        b.squad.selectedUnitId = unitId;
        b.squad.selectionMode = 'unit';
      }
      break;

    case 'digIn':
      unit.currentOrder = 'digIn';
      unit.hasIndividualOrder = true;
      showFeedback('⛏️ Unit: DIG IN!');
      break;

    case 'advance':
      unit.currentOrder = 'advance';
      unit.hasIndividualOrder = true;
      showFeedback('⚔️ Unit: ADVANCE!');
      break;

    case 'fallback':
      unit.currentOrder = 'fallback';
      unit.hasIndividualOrder = true;
      showFeedback('🏃 Unit: FALL BACK!');
      break;

    case 'supportHero':
      // Toggle support hero mode
      if (unit.supportTarget === 'hero') {
        unit.supportTarget = null;
        unit.currentOrder = 'hold';
        showFeedback('🤝 Unit: Support cancelled');
      } else {
        unit.supportTarget = 'hero';
        unit.currentOrder = 'support';
        showFeedback('🤝 Unit: Supporting hero!');
      }
      break;

    case 'searchAndDestroy':
      unit.currentOrder = 'searchAndDestroy';
      unit.hasIndividualOrder = true;
      unit.aiTargeting = 'aggressive';
      showFeedback('💀 Unit: Search & destroy!');
      break;

    case 'openRadio':
      b.squad.selectedUnitId = unitId;
      b.squad.selectionMode = 'unit';
      b.radioOpen = true;
      showFeedback('📻 Radio open');
      break;

    case 'moveTo':
      if (params.x !== undefined && params.y !== undefined) {
        unit.moveTarget = { x: params.x, y: params.y };
        unit.currentOrder = 'move';
        showFeedback('📍 Unit: Moving out!');
      }
      break;

    case 'supportAlly':
      if (params.allyId) {
        unit.supportTarget = params.allyId;
        unit.currentOrder = 'support';
        showFeedback('🤝 Unit: Supporting ally!');
      }
      break;
  }

  render();
}

// ═══════════════════════════════════════════════════════════════
// SQUAD COMMANDS (All units or selected units)
// ═══════════════════════════════════════════════════════════════

export function executeSquadCommand(command, params = {}) {
  const b = getBattle();
  if (!b) return;

  // Get target units (selected units in multi-select, or all units)
  const targetUnits = b.squad.multiSelectMode && b.squad.selectedUnits.length > 0
    ? b.units.filter(u => b.squad.selectedUnits.includes(u.id) && u.hp > 0)
    : b.units.filter(u => u.hp > 0);

  switch (command) {
    case 'select':
      // Exit multi-select mode and select all
      b.squad.multiSelectMode = false;
      b.squad.selectedUnits = [];
      b.squad.selectedUnitId = null;
      b.squad.selectionMode = 'squad';
      break;

    case 'digIn':
      targetUnits.forEach(unit => {
        unit.currentOrder = 'digIn';
        unit.hasIndividualOrder = true;
      });
      b.squad.currentOrder = 'digIn';
      showFeedback('⛏️ Squad: DIG IN!');
      break;

    case 'advance':
      targetUnits.forEach(unit => {
        unit.currentOrder = 'advance';
        unit.hasIndividualOrder = true;
      });
      b.squad.currentOrder = 'advance';
      showFeedback('⚔️ Squad: ADVANCE!');
      break;

    case 'fallback':
      targetUnits.forEach(unit => {
        unit.currentOrder = 'fallback';
        unit.hasIndividualOrder = true;
      });
      b.squad.currentOrder = 'fallback';
      showFeedback('🏃 Squad: FALL BACK!');
      break;

    case 'followHero':
      // Toggle follow hero mode for all
      const wasFollowing = targetUnits.every(u => u.supportTarget === 'hero');
      targetUnits.forEach(unit => {
        if (wasFollowing) {
          unit.supportTarget = null;
          unit.currentOrder = 'hold';
        } else {
          unit.supportTarget = 'hero';
          unit.currentOrder = 'support';
        }
      });
      showFeedback(wasFollowing ? '👣 Squad: Hold position' : '👣 Squad: Following hero!');
      break;

    case 'searchAndDestroy':
      targetUnits.forEach(unit => {
        unit.currentOrder = 'searchAndDestroy';
        unit.hasIndividualOrder = true;
        unit.aiTargeting = 'aggressive';
      });
      showFeedback('💀 Squad: Search & destroy!');
      break;

    case 'openRadio':
      b.squad.selectedUnitId = null;
      b.squad.selectionMode = 'squad';
      b.radioOpen = true;
      showFeedback('📻 Radio open');
      break;

    case 'moveTo':
      if (params.x !== undefined && params.y !== undefined) {
        // Spread units around target position
        const spread = 40;
        targetUnits.forEach((unit, i) => {
          const angle = (i / targetUnits.length) * Math.PI * 2;
          unit.moveTarget = {
            x: params.x + Math.cos(angle) * spread,
            y: params.y + Math.sin(angle) * spread
          };
          unit.currentOrder = 'move';
        });
        showFeedback('📍 Squad: Moving out!');
      }
      break;

    case 'protectAlly':
      if (params.allyId) {
        targetUnits.forEach(unit => {
          unit.protectTarget = params.allyId;
          unit.currentOrder = 'protect';
        });
        showFeedback('🛡️ Squad: Protecting ally!');
      }
      break;
  }

  render();
}

// ═══════════════════════════════════════════════════════════════
// ENEMY COMMANDS (Actions targeting an enemy)
// ═══════════════════════════════════════════════════════════════

export function executeEnemyCommand(enemy, command, params = {}) {
  const b = getBattle();
  if (!b || !enemy || enemy.dead) return;

  switch (command) {
    case 'heroAttack':
      // Set hero to auto-attack this target
      b.hero.autoAttackTarget = enemy.id;
      showFeedback('🎯 Targeting enemy!');
      break;

    case 'focusFire':
      // All units in range focus on this enemy
      b.squad.concentrateTarget = enemy.id;
      showFeedback('🔥 Focus fire!');
      break;

    case 'flank':
      // Units attempt to flank this enemy
      b.units.filter(u => u.hp > 0).forEach(unit => {
        unit.flankTarget = enemy.id;
        unit.currentOrder = 'flank';
      });
      showFeedback('↩️ Flanking enemy!');
      break;

    case 'artillery':
      // Call artillery on enemy's current position (fixed)
      const strikePos = { x: params.x || enemy.x, y: params.y || enemy.y };
      if (!b.artilleryStrikes) b.artilleryStrikes = [];
      b.artilleryStrikes.push({
        x: strikePos.x,
        y: strikePos.y,
        time: Date.now(),
        delay: 2000, // 2 second delay
        radius: 60,
        damage: 100,
        type: 'single'
      });
      showFeedback('💥 Artillery incoming!');
      break;
  }

  render();
}

// ═══════════════════════════════════════════════════════════════
// ALLY COMMANDS (Actions targeting a friendly unit)
// ═══════════════════════════════════════════════════════════════

export function executeAllyCommand(ally, command, params = {}) {
  const b = getBattle();
  if (!b || !ally || ally.hp <= 0) return;

  // Get currently selected unit(s)
  const selectedUnits = b.squad.multiSelectMode && b.squad.selectedUnits.length > 0
    ? b.units.filter(u => b.squad.selectedUnits.includes(u.id) && u.hp > 0)
    : b.squad.selectedUnitId
      ? b.units.filter(u => u.id === b.squad.selectedUnitId && u.hp > 0)
      : [];

  switch (command) {
    case 'select':
      // Select this ally in the squad strip
      b.squad.selectedUnitId = ally.id;
      b.squad.selectionMode = 'unit';
      break;

    case 'support':
      // Selected unit(s) support this ally
      if (selectedUnits.length > 0) {
        selectedUnits.forEach(unit => {
          if (unit.id !== ally.id) { // Don't support self
            unit.supportTarget = ally.id;
            unit.currentOrder = 'support';
          }
        });
        showFeedback('🤝 Supporting ally!');
      } else {
        showFeedback('Select a unit first');
      }
      break;

    case 'protect':
      // All units protect this ally
      b.units.filter(u => u.hp > 0 && u.id !== ally.id).forEach(unit => {
        unit.protectTarget = ally.id;
        unit.currentOrder = 'protect';
      });
      showFeedback('🛡️ Protecting ally!');
      break;

    case 'assign':
      // Contextual: assign selected units to this ally based on their type
      if (selectedUnits.length > 0) {
        selectedUnits.forEach(unit => {
          if (unit.id === ally.id) return; // Don't assign to self

          // Check unit type for contextual behavior
          const unitType = unit.unitId || 'infantry';
          const isSupportType = unitType === 'medic' || unitType === 'engineer';
          const isHeavyType = unitType === 'sherman' || unitType === 'tiger' || unitType === 'abrams';

          if (isSupportType) {
            // Support units provide support
            unit.supportTarget = ally.id;
            unit.currentOrder = 'support';
          } else if (isHeavyType) {
            // Heavy units protect
            unit.protectTarget = ally.id;
            unit.currentOrder = 'protect';
          } else {
            // Default: escort/follow
            unit.supportTarget = ally.id;
            unit.currentOrder = 'support';
          }
        });
        showFeedback('🤝 Units assigned!');
      } else {
        // No selection - all units support this ally
        b.units.filter(u => u.hp > 0 && u.id !== ally.id).forEach(unit => {
          unit.supportTarget = ally.id;
          unit.currentOrder = 'support';
        });
        showFeedback('🤝 Squad supporting ally!');
      }
      break;
  }

  render();
}

// ═══════════════════════════════════════════════════════════════
// EMPTY TILE COMMANDS (Actions on empty battlefield locations)
// ═══════════════════════════════════════════════════════════════

export function executeEmptyTileCommand(command, params = {}) {
  const b = getBattle();
  if (!b) return;

  const { x, y } = params;
  if (x === undefined || y === undefined) return;

  // Get target units (selected or all)
  const targetUnits = b.squad.multiSelectMode && b.squad.selectedUnits.length > 0
    ? b.units.filter(u => b.squad.selectedUnits.includes(u.id) && u.hp > 0)
    : b.squad.selectedUnitId
      ? b.units.filter(u => u.id === b.squad.selectedUnitId && u.hp > 0)
      : b.units.filter(u => u.hp > 0);

  switch (command) {
    case 'move':
      // Move units to location (spread formation)
      const spread = 40;
      targetUnits.forEach((unit, i) => {
        const angle = (i / Math.max(targetUnits.length, 1)) * Math.PI * 2;
        const offset = targetUnits.length > 1 ? spread : 0;
        unit.moveTarget = {
          x: x + Math.cos(angle) * offset,
          y: y + Math.sin(angle) * offset
        };
        unit.currentOrder = 'move';
        unit.hasIndividualOrder = true;
      });
      showFeedback('📍 Moving out!');
      break;

    case 'moveAndDigIn':
      // Move to location, then dig in
      targetUnits.forEach((unit, i) => {
        const angle = (i / Math.max(targetUnits.length, 1)) * Math.PI * 2;
        const offset = targetUnits.length > 1 ? 40 : 0;
        unit.moveTarget = {
          x: x + Math.cos(angle) * offset,
          y: y + Math.sin(angle) * offset
        };
        unit.currentOrder = 'moveAndDigIn';
        unit.hasIndividualOrder = true;
      });
      showFeedback('📍⛏️ Move & dig in!');
      break;

    case 'artilleryStrike':
      // Artillery strike on location (hold on empty tile)
      if (!b.artilleryStrikes) b.artilleryStrikes = [];
      b.artilleryStrikes.push({
        x, y,
        time: Date.now(),
        delay: 2000,
        radius: 60,
        damage: 100,
        type: 'single'
      });
      showFeedback('💥 Artillery incoming!');
      break;
  }

  render();
}
