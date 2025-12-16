// ═══════════════════════════════════════════════════════════════
// STORAGE - LocalStorage persistence
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';

const SAVE_KEY = 'cr_save';

export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      resources: Game.resources,
      stats: Game.stats,
      settings: Game.settings,
      player: Game.player
    }));
  } catch (e) {
    console.warn('Failed to save:', e);
  }
}

export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data) {
      Object.assign(Game.resources, data.resources || {});
      Object.assign(Game.stats, data.stats || {});
      Object.assign(Game.settings, data.settings || {});
      if (data.player) {
        Object.assign(Game.player, data.player);
        // Ensure unitColors exists for older saves
        if (!Game.player.unitColors) {
          Game.player.unitColors = {};
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load:', e);
  }
}
