// Cursor apply layer — reads Game.settings.cursors and writes a CSS variable
// (--cursor-menu) on :root so body/menu surfaces pick up the selected pointer.
// Battle reticle is applied per-frame inside renderHeroCrosshair (hero-hud.js);
// see resolveBattleReticle() below for the shared resolution helper.

import { Game } from './state.js';
import {
  BUILT_IN_CURSORS,
  getCursor,
  resolveColors,
  buildCursorSvg,
  defaultColors,
  DEFAULT_MENU_CURSOR_ID,
  DEFAULT_BATTLE_RETICLE_ID
} from './cursor-library.js';

// Default selection shape — used if settings are missing or corrupt.
function _defaultSelection() {
  return {
    menu:   { id: DEFAULT_MENU_CURSOR_ID, colors: undefined },
    battle: { id: DEFAULT_BATTLE_RETICLE_ID, colors: undefined },
    custom: []
  };
}

// Returns the current cursor settings, guaranteed to be a valid object.
// Self-heals if a selected id no longer resolves (e.g. a custom was deleted).
export function getCursorSettings() {
  if (!Game.settings.cursors) Game.settings.cursors = _defaultSelection();
  const c = Game.settings.cursors;
  if (!c.menu || typeof c.menu !== 'object') c.menu = { id: DEFAULT_MENU_CURSOR_ID };
  if (!c.battle || typeof c.battle !== 'object') c.battle = { id: DEFAULT_BATTLE_RETICLE_ID };
  if (!Array.isArray(c.custom)) c.custom = [];
  // Validate selected ids exist; fall back to defaults.
  if (!getCursor(c.menu.id, c.custom) || getCursor(c.menu.id, c.custom).type !== 'menu') {
    c.menu.id = DEFAULT_MENU_CURSOR_ID;
    c.menu.colors = undefined;
  }
  if (!getCursor(c.battle.id, c.custom) || getCursor(c.battle.id, c.custom).type !== 'battle') {
    c.battle.id = DEFAULT_BATTLE_RETICLE_ID;
    c.battle.colors = undefined;
  }
  return c;
}

// Resolve the chosen menu cursor → CSS declaration value (the whole right-hand
// side of `cursor: …`, including hotspot + fallback). Caller assigns to
// --cursor-menu (or directly to a `cursor:` property if CSS var support is
// suspect — see plan risk #2).
export function resolveMenuCursorCss() {
  const c = getCursorSettings();
  const entry = getCursor(c.menu.id, c.custom);
  if (!entry) return 'auto';
  const colors = resolveColors(entry, c.menu.colors);
  const dataUri = buildCursorSvg(entry, colors);
  if (!dataUri) return 'auto';
  const [hx, hy] = entry.hotspot || [0, 0];
  return `url("${dataUri}") ${hx} ${hy}, auto`;
}

// Resolve the chosen battle reticle → entry + colors for the canvas render path.
// Called from renderHeroCrosshair every frame.
export function resolveBattleReticle() {
  const c = getCursorSettings();
  const entry = getCursor(c.battle.id, c.custom);
  if (!entry || entry.type !== 'battle') {
    // Last-ditch fallback to the original (always present).
    const fallback = BUILT_IN_CURSORS.find(e => e.id === DEFAULT_BATTLE_RETICLE_ID);
    return { entry: fallback, colors: defaultColors(fallback) };
  }
  const colors = resolveColors(entry, c.battle.colors);
  return { entry, colors };
}

// Apply the menu cursor to :root. Idempotent — call after settings change.
export function applyMenuCursor() {
  document.documentElement.style.setProperty('--cursor-menu', resolveMenuCursorCss());
}
