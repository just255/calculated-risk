// ═══════════════════════════════════════════════════════════════
// GESTURES - Touch/click gesture detection for battle mode
// ═══════════════════════════════════════════════════════════════

import { State } from './constants.js';
import { Game } from './state.js';
import { render } from './ui.js';
import {
  executeUnitCommand,
  executeSquadCommand,
  executeEnemyCommand,
  executeAllyCommand,
  executeEmptyTileCommand
} from './commands.js';
import { isJoystickActive } from './joystick.js';

// Callback to reset joysticks (set by main.js to avoid circular import)
let resetJoysticksCallback = null;
export function setResetJoysticksCallback(fn) {
  resetJoysticksCallback = fn;
}

// ═══════════════════════════════════════════════════════════════
// GESTURE PARAMETERS
// ═══════════════════════════════════════════════════════════════

// Default values
const DEFAULTS = {
  holdMs: 500,
  swipeMin: 40,
  tapInterval: 300,
  tapMaxMove: 15,
  enemyHoldMs: 1000,
  hitRadius: 50
};

// Get hold time from settings or default
function getHoldTime() {
  return Game.settings?.controls?.gestureHoldTime ?? DEFAULTS.enemyHoldMs;
}

// Get tap interval from settings or default
function getTapInterval() {
  return Game.settings?.controls?.gestureTapInterval ?? DEFAULTS.tapInterval;
}

// Static values (not configurable for now)
const HOLD_MS = DEFAULTS.holdMs;
const SWIPE_MIN = DEFAULTS.swipeMin;
const TAP_MAX_MOVE = DEFAULTS.tapMaxMove;
const HIT_RADIUS = DEFAULTS.hitRadius;

// ═══════════════════════════════════════════════════════════════
// GESTURE STATE
// ═══════════════════════════════════════════════════════════════

// Unit icon gesture state
const unitGesture = {
  touchId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  targetId: null,       // unitId or 'squad'
  holdTimer: null,
  holdFired: false,
  tapCount: 0,
  tapTimer: null,
  lastTapTime: 0
};

// Battlefield gesture state
const bfGesture = {
  touchId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  targetType: null,     // 'enemy', 'ally', 'empty'
  targetEntity: null,   // The entity object if applicable
  worldX: 0,
  worldY: 0,
  holdTimer: null,
  holdFired: false,
  tapCount: 0,
  tapTimer: null,
  lastTapTime: 0
};

// ═══════════════════════════════════════════════════════════════
// HELPER: Get battle state
// ═══════════════════════════════════════════════════════════════

function getBattle() {
  return Game.campaign?.heroBattle;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Find entity at world position
// ═══════════════════════════════════════════════════════════════

function findEntityAtPosition(b, worldX, worldY, radius) {
  // Check enemies first
  for (const enemy of b.enemies) {
    if (enemy.dead) continue;
    const dx = enemy.x - worldX;
    const dy = enemy.y - worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius) {
      return { type: 'enemy', entity: enemy, dist };
    }
  }

  // Check ally units
  for (const unit of b.units) {
    if (unit.hp <= 0) continue;
    const dx = unit.x - worldX;
    const dy = unit.y - worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius) {
      return { type: 'ally', entity: unit, dist };
    }
  }

  // Check hero
  const heroDx = b.hero.x - worldX;
  const heroDy = b.hero.y - worldY;
  const heroDist = Math.sqrt(heroDx * heroDx + heroDy * heroDy);
  if (heroDist < radius) {
    return { type: 'hero', entity: b.hero, dist: heroDist };
  }

  return { type: 'empty', entity: null, dist: 0 };
}

// ═══════════════════════════════════════════════════════════════
// UNIT ICON GESTURES
// ═══════════════════════════════════════════════════════════════

function handleUnitTouchStart(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

  const unitBtn = e.target.closest('[data-action="select-unit"]');
  const squadBtn = e.target.closest('[data-action="select-squad"]');

  if (!unitBtn && !squadBtn) return;

  const touch = e.touches[0];
  const b = getBattle();
  if (!b) return;

  const isSquad = !!squadBtn;
  const targetId = isSquad ? 'squad' : unitBtn.dataset.unitId;

  // For individual units, check if alive
  if (!isSquad) {
    const unit = b.units.find(u => u.id === targetId);
    if (!unit || unit.hp <= 0) return;
  }

  // Initialize gesture state
  unitGesture.touchId = touch.identifier;
  unitGesture.startX = touch.clientX;
  unitGesture.startY = touch.clientY;
  unitGesture.startTime = Date.now();
  unitGesture.targetId = targetId;
  unitGesture.holdFired = false;

  // Start hold timer for dig-in
  unitGesture.holdTimer = setTimeout(() => {
    if (unitGesture.holdFired) return;
    unitGesture.holdFired = true;

    if (isSquad) {
      executeSquadCommand('digIn');
    } else {
      executeUnitCommand(targetId, 'digIn');
    }

    if (navigator.vibrate) navigator.vibrate(50);
  }, HOLD_MS);
}

function handleUnitTouchMove(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;
  if (unitGesture.touchId === null) return;

  const touch = Array.from(e.touches).find(t => t.identifier === unitGesture.touchId);
  if (!touch) return;

  const dx = touch.clientX - unitGesture.startX;
  const dy = touch.clientY - unitGesture.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Cancel hold if moved too much
  if (dist > TAP_MAX_MOVE && unitGesture.holdTimer) {
    clearTimeout(unitGesture.holdTimer);
    unitGesture.holdTimer = null;
  }

  // Detect swipes
  const isSquad = unitGesture.targetId === 'squad';

  // Swipe LEFT - Open radio
  if (dx < -SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
    resetUnitGesture();
    if (isSquad) {
      executeSquadCommand('openRadio');
    } else {
      executeUnitCommand(unitGesture.targetId, 'openRadio');
    }
    if (navigator.vibrate) navigator.vibrate([30, 30, 30]);
    return;
  }

  // Swipe UP - Advance
  if (dy < -SWIPE_MIN && Math.abs(dx) < SWIPE_MIN) {
    resetUnitGesture();
    if (isSquad) {
      executeSquadCommand('advance');
    } else {
      executeUnitCommand(unitGesture.targetId, 'advance');
    }
    if (navigator.vibrate) navigator.vibrate([30, 50]);
    return;
  }

  // Swipe DOWN - Fallback
  if (dy > SWIPE_MIN && Math.abs(dx) < SWIPE_MIN) {
    resetUnitGesture();
    if (isSquad) {
      executeSquadCommand('fallback');
    } else {
      executeUnitCommand(unitGesture.targetId, 'fallback');
    }
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    return;
  }
}

function handleUnitTouchEnd(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

  const touch = Array.from(e.changedTouches).find(t => t.identifier === unitGesture.touchId);
  if (!touch) return;

  // Clear hold timer
  if (unitGesture.holdTimer) {
    clearTimeout(unitGesture.holdTimer);
    unitGesture.holdTimer = null;
  }

  // If hold already fired, don't process as tap
  if (unitGesture.holdFired) {
    resetUnitGesture();
    return;
  }

  const dx = touch.clientX - unitGesture.startX;
  const dy = touch.clientY - unitGesture.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Only process as tap if didn't move much
  if (dist < TAP_MAX_MOVE) {
    const now = Date.now();
    const timeSinceLastTap = now - unitGesture.lastTapTime;

    if (timeSinceLastTap < getTapInterval()) {
      unitGesture.tapCount++;
    } else {
      unitGesture.tapCount = 1;
    }
    unitGesture.lastTapTime = now;

    // Clear existing tap timer
    if (unitGesture.tapTimer) clearTimeout(unitGesture.tapTimer);

    const targetId = unitGesture.targetId;
    const isSquad = targetId === 'squad';

    // Set timer to process taps after interval
    unitGesture.tapTimer = setTimeout(() => {
      if (unitGesture.tapCount === 1) {
        // Single tap - select
        if (isSquad) {
          executeSquadCommand('select');
        } else {
          executeUnitCommand(targetId, 'select');
        }
      } else if (unitGesture.tapCount === 2) {
        // Double tap - support/follow hero
        if (isSquad) {
          executeSquadCommand('followHero');
        } else {
          executeUnitCommand(targetId, 'supportHero');
        }
        if (navigator.vibrate) navigator.vibrate([30, 50]);
      } else if (unitGesture.tapCount >= 3) {
        // Triple tap - search & destroy
        if (isSquad) {
          executeSquadCommand('searchAndDestroy');
        } else {
          executeUnitCommand(targetId, 'searchAndDestroy');
        }
        if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 50]);
      }

      unitGesture.tapCount = 0;
    }, getTapInterval());
  }

  unitGesture.touchId = null;
}

function resetUnitGesture() {
  if (unitGesture.holdTimer) clearTimeout(unitGesture.holdTimer);
  if (unitGesture.tapTimer) clearTimeout(unitGesture.tapTimer);
  unitGesture.touchId = null;
  unitGesture.holdTimer = null;
  unitGesture.tapCount = 0;
}

// ═══════════════════════════════════════════════════════════════
// BATTLEFIELD GESTURES (Enemy, Ally, Empty Tile)
// ═══════════════════════════════════════════════════════════════

function handleBattlefieldTouchStart(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

  const bf = e.target.closest('.campaign-battlefield');
  if (!bf) return;

  // Don't trigger on UI elements
  if (e.target.closest('.squad-strip') || e.target.closest('.radio-popup')) return;

  const touch = e.touches[0];

  const b = getBattle();
  if (!b) return;

  const rect = bf.getBoundingClientRect();
  const touchX = touch.clientX - rect.left;
  const touchY = touch.clientY - rect.top;

  // Convert to world coordinates
  const worldX = touchX + b.camera.x;
  const worldY = touchY + b.camera.y;

  // Find what's at this position
  const result = findEntityAtPosition(b, worldX, worldY, HIT_RADIUS);

  // Don't target hero with gestures
  if (result.type === 'hero') return;

  // Initialize gesture state
  bfGesture.touchId = touch.identifier;
  bfGesture.startX = touch.clientX;
  bfGesture.startY = touch.clientY;
  bfGesture.startTime = Date.now();
  bfGesture.targetType = result.type;
  bfGesture.targetEntity = result.entity;
  bfGesture.worldX = worldX;
  bfGesture.worldY = worldY;
  bfGesture.holdFired = false;

  // Start hold timer based on target type
  const holdAction = getHoldAction(result.type);
  if (holdAction) {
    bfGesture.holdTimer = setTimeout(() => {
      if (bfGesture.holdFired) return;
      bfGesture.holdFired = true;

      // Reset joysticks when hold action fires (like artillery)
      if (resetJoysticksCallback) resetJoysticksCallback();

      executeHoldAction(result.type, result.entity, worldX, worldY);
      if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 50]);
    }, result.type === 'enemy' ? getHoldTime() : HOLD_MS);
  }
}

function getHoldAction(targetType) {
  switch (targetType) {
    case 'enemy': return 'artillery';
    case 'ally': return null; // Reserved
    case 'empty': return 'artilleryStrike';
    default: return null;
  }
}

function executeHoldAction(targetType, entity, worldX, worldY) {
  switch (targetType) {
    case 'enemy':
      executeEnemyCommand(entity, 'artillery', { x: worldX, y: worldY });
      break;
    case 'empty':
      executeEmptyTileCommand('artilleryStrike', { x: worldX, y: worldY });
      break;
  }
}

function handleBattlefieldTouchMove(e) {
  if (bfGesture.touchId === null) return;

  const touch = Array.from(e.touches).find(t => t.identifier === bfGesture.touchId);
  if (!touch) return;

  const dx = touch.clientX - bfGesture.startX;
  const dy = touch.clientY - bfGesture.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Cancel hold if moved too much
  if (dist > TAP_MAX_MOVE && bfGesture.holdTimer) {
    clearTimeout(bfGesture.holdTimer);
    bfGesture.holdTimer = null;
  }
}

function handleBattlefieldTouchEnd(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

  const touch = Array.from(e.changedTouches).find(t => t.identifier === bfGesture.touchId);
  if (!touch) return;

  // Clear hold timer
  if (bfGesture.holdTimer) {
    clearTimeout(bfGesture.holdTimer);
    bfGesture.holdTimer = null;
  }

  // If hold already fired, don't process as tap
  if (bfGesture.holdFired) {
    resetBfGesture();
    return;
  }

  const dx = touch.clientX - bfGesture.startX;
  const dy = touch.clientY - bfGesture.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Only process as tap if didn't move much
  if (dist < TAP_MAX_MOVE) {
    const now = Date.now();
    const timeSinceLastTap = now - bfGesture.lastTapTime;

    if (timeSinceLastTap < getTapInterval()) {
      bfGesture.tapCount++;
    } else {
      bfGesture.tapCount = 1;
    }
    bfGesture.lastTapTime = now;

    // Clear existing tap timer
    if (bfGesture.tapTimer) clearTimeout(bfGesture.tapTimer);

    const targetType = bfGesture.targetType;
    const targetEntity = bfGesture.targetEntity;
    const worldX = bfGesture.worldX;
    const worldY = bfGesture.worldY;

    // Set timer to process taps after interval
    bfGesture.tapTimer = setTimeout(() => {
      processBattlefieldTaps(targetType, targetEntity, worldX, worldY, bfGesture.tapCount);
      bfGesture.tapCount = 0;
    }, getTapInterval());
  }

  bfGesture.touchId = null;
}

function processBattlefieldTaps(targetType, entity, worldX, worldY, tapCount) {
  // Skip if joystick became active (user dragged instead of tapping)
  if (isJoystickActive()) return;

  switch (targetType) {
    case 'enemy':
      if (tapCount === 1) {
        executeEnemyCommand(entity, 'heroAttack');
      } else if (tapCount === 2) {
        executeEnemyCommand(entity, 'focusFire');
        if (navigator.vibrate) navigator.vibrate([30, 50]);
      } else if (tapCount >= 3) {
        executeEnemyCommand(entity, 'flank');
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      }
      break;

    case 'ally':
      if (tapCount === 1) {
        executeAllyCommand(entity, 'select');
      } else if (tapCount >= 2) {
        // Double/triple tap = assign selected units to support/protect this ally
        executeAllyCommand(entity, 'assign');
        if (navigator.vibrate) navigator.vibrate([30, 50]);
      }
      break;

    case 'empty':
      // Single tap on empty = nothing (avoid misclicks)
      if (tapCount === 2) {
        // Double tap = move to
        executeEmptyTileCommand('move', { x: worldX, y: worldY });
        if (navigator.vibrate) navigator.vibrate([30, 50]);
      } else if (tapCount >= 3) {
        // Triple tap = move and dig in
        executeEmptyTileCommand('moveAndDigIn', { x: worldX, y: worldY });
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      }
      break;
  }
}

function resetBfGesture() {
  if (bfGesture.holdTimer) clearTimeout(bfGesture.holdTimer);
  if (bfGesture.tapTimer) clearTimeout(bfGesture.tapTimer);
  bfGesture.touchId = null;
  bfGesture.holdTimer = null;
  bfGesture.tapCount = 0;
  bfGesture.targetEntity = null;
}

// ═══════════════════════════════════════════════════════════════
// MULTI-SELECT TOGGLE
// ═══════════════════════════════════════════════════════════════

function handleMultiSelectToggle(e) {
  if (Game.state !== State.CAMPAIGN_BATTLE) return;

  const toggle = e.target.closest('[data-action="toggle-multiselect"]');
  if (!toggle) return;

  const b = getBattle();
  if (!b) return;

  b.squad.multiSelectMode = !b.squad.multiSelectMode;
  if (!b.squad.multiSelectMode) {
    b.squad.selectedUnits = [];
  }
  render();
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

export function initGestures() {
  const app = document.getElementById('app');

  // Unit icon gestures
  app.addEventListener('touchstart', handleUnitTouchStart, { passive: true });
  app.addEventListener('touchmove', handleUnitTouchMove, { passive: true });
  app.addEventListener('touchend', handleUnitTouchEnd, { passive: true });
  app.addEventListener('touchcancel', () => {
    resetUnitGesture();
    resetBfGesture();
  }, { passive: true });

  // Battlefield gestures
  document.addEventListener('touchstart', handleBattlefieldTouchStart, { passive: true });
  document.addEventListener('touchmove', handleBattlefieldTouchMove, { passive: true });
  document.addEventListener('touchend', handleBattlefieldTouchEnd, { passive: true });
  document.addEventListener('touchcancel', resetBfGesture, { passive: true });

  // Multi-select toggle
  app.addEventListener('click', handleMultiSelectToggle);

  console.log('Gesture system initialized');
}

// Export for testing
export { unitGesture, bfGesture, findEntityAtPosition };
