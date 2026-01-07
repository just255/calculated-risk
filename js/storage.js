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
      // Shallow merge top-level settings
      Object.assign(Game.settings, data.settings || {});
      // Deep merge controls settings
      if (data.settings?.controls) {
        Game.settings.controls = Game.settings.controls || {};
        Object.assign(Game.settings.controls, data.settings.controls);
      }
      if (data.player) {
        Object.assign(Game.player, data.player);
        // Ensure unitColors exists for older saves
        if (!Game.player.unitColors) {
          Game.player.unitColors = {};
        }
        // Ensure spriteSelections exists for older saves
        if (!Game.player.spriteSelections) {
          Game.player.spriteSelections = {};
        }
        // Ensure abrams is unlocked for PNG sprite testing
        if (!Game.player.unlockedUnits.includes('abrams')) {
          Game.player.unlockedUnits.push('abrams');
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load:', e);
  }
}
