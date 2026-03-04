// ═══════════════════════════════════════════════════════════════
// INSIGNIA PRESETS — Built-in rank insignia set library
// Loadable preset templates, fully editable after loading.
// ═══════════════════════════════════════════════════════════════

const C = {
  gold: '#ffd700',
  white: '#ffffff',
  black: '#1a1a1a',
  silver: '#c0c0c0',
  green: '#556b2f',
};

let _idCounter = 0;
function _sid() { return 's_p' + (_idCounter++); }

function mk(type, overrides) {
  return {
    x: 0, y: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0,
    flipX: false, flipY: false,
    strokeColor: C.gold,
    strokeWidth: 1.5,
    fillColor: C.gold,
    fillEnabled: false,
    fillOpacity: 0.5,
    visible: true,
    type,
    id: _sid(),
    ...({
      chevron: { halfW: 6, height: 7, bow: 0.35 },
      arc:     { halfW: 5, arcHeight: 4 },
      diamond: { width: 10, height: 14 },
      line:    { length: 12 },
      circle:  { radius: 4 },
      path:    { points: [], closed: true },
    }[type] || {}),
    ...overrides
  };
}

// ─── US Army (Simplified) ───────────────────────────────────

function usArmy() {
  _idCounter = 0;
  return {
    id: 'preset_us_army',
    name: 'US Army',
    presetId: 'us_army',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ranks: [
      // 0: PVT — empty (no insignia)
      { shapes: [] },

      // 1: PV2 — single chevron
      { shapes: [
        mk('chevron', { halfW: 6, height: 7, bow: 0.35, verticalEnds: true }),
      ]},

      // 2: PFC — chevron + arc rocker
      { shapes: [
        mk('chevron', { halfW: 6, height: 7, bow: 0.35, verticalEnds: true }),
        mk('arc', { halfW: 5.5, arcHeight: 4, y: -7, verticalEnds: true }),
      ]},

      // 3: SPC — eagle spread + inverted chevron
      { shapes: [
        mk('chevron', {
          halfW: 6, height: 6, bow: 0.10,
          rotation: Math.PI,
          fillEnabled: true, fillOpacity: 0.5
        }),
        mk('arc', { halfW: 6, arcHeight: 3.5, flipY: true, y: -3.5 }),
        mk('arc', { halfW: 1.5, arcHeight: 2, x: -1.5, y: 0.5 }),
        mk('arc', { halfW: 1.5, arcHeight: 2, x: 1.5, y: 0.5 }),
      ]},

      // 4: CPL — 2 chevrons
      { shapes: [
        mk('chevron', { halfW: 6, height: 7, bow: 0.35, y: 2, verticalEnds: true }),
        mk('chevron', { halfW: 5.3, height: 6.2, bow: 0.35, y: -3, verticalEnds: true }),
      ]},

      // 5: SGT — 3 chevrons
      { shapes: [
        mk('chevron', { halfW: 6, height: 7, bow: 0.35, y: 4, verticalEnds: true }),
        mk('chevron', { halfW: 5.3, height: 6.2, bow: 0.35, y: -1, verticalEnds: true }),
        mk('chevron', { halfW: 4.6, height: 5.4, bow: 0.35, y: -5.5, verticalEnds: true }),
      ]},
    ]
  };
}

// ─── USMC ───────────────────────────────────────────────────

function usmc() {
  _idCounter = 0;
  return {
    id: 'preset_usmc',
    name: 'USMC',
    presetId: 'usmc',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ranks: [
      // 0: PVT — empty
      { shapes: [] },

      // 1: PFC — single chevron (USMC PFC = 1 stripe)
      { shapes: [
        mk('chevron', { halfW: 7, height: 8, bow: 0.25, strokeWidth: 2, verticalEnds: true }),
      ]},

      // 2: LCPL — chevron + crossed rifles placeholder (diamond)
      { shapes: [
        mk('chevron', { halfW: 7, height: 8, bow: 0.25, strokeWidth: 2, verticalEnds: true }),
        mk('line', { length: 8, x: 0, y: -4, rotation: 0.4, strokeWidth: 1 }),
        mk('line', { length: 8, x: 0, y: -4, rotation: -0.4, strokeWidth: 1 }),
      ]},

      // 3: CPL — 2 chevrons
      { shapes: [
        mk('chevron', { halfW: 7, height: 8, bow: 0.25, y: 3, strokeWidth: 2, verticalEnds: true }),
        mk('chevron', { halfW: 6, height: 7, bow: 0.25, y: -3, strokeWidth: 2, verticalEnds: true }),
      ]},

      // 4: SGT — 3 chevrons
      { shapes: [
        mk('chevron', { halfW: 7, height: 8, bow: 0.25, y: 5, strokeWidth: 2, verticalEnds: true }),
        mk('chevron', { halfW: 6, height: 7, bow: 0.25, y: 0, strokeWidth: 2, verticalEnds: true }),
        mk('chevron', { halfW: 5, height: 6, bow: 0.25, y: -5, strokeWidth: 2, verticalEnds: true }),
      ]},

      // 5: SSGT — 3 chevrons + 1 rocker
      { shapes: [
        mk('chevron', { halfW: 7, height: 8, bow: 0.25, y: 5, strokeWidth: 2, verticalEnds: true }),
        mk('chevron', { halfW: 6, height: 7, bow: 0.25, y: 0, strokeWidth: 2, verticalEnds: true }),
        mk('chevron', { halfW: 5, height: 6, bow: 0.25, y: -5, strokeWidth: 2, verticalEnds: true }),
        mk('arc', { halfW: 7, arcHeight: 4, y: 11, flipY: true, strokeWidth: 2, verticalEnds: true }),
      ]},
    ]
  };
}

// ─── Generic / Simple ───────────────────────────────────────

function generic() {
  _idCounter = 0;
  return {
    id: 'preset_generic',
    name: 'Simple Bars',
    presetId: 'generic',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ranks: [
      // 0: empty
      { shapes: [] },

      // 1: single bar
      { shapes: [
        mk('line', { length: 10, strokeWidth: 2 }),
      ]},

      // 2: two bars
      { shapes: [
        mk('line', { length: 10, strokeWidth: 2, y: -2 }),
        mk('line', { length: 10, strokeWidth: 2, y: 2 }),
      ]},

      // 3: diamond
      { shapes: [
        mk('diamond', { width: 8, height: 10, fillEnabled: true, fillOpacity: 0.3 }),
      ]},

      // 4: three bars
      { shapes: [
        mk('line', { length: 10, strokeWidth: 2, y: -4 }),
        mk('line', { length: 10, strokeWidth: 2, y: 0 }),
        mk('line', { length: 10, strokeWidth: 2, y: 4 }),
      ]},

      // 5: star (circle + diamond)
      { shapes: [
        mk('circle', { radius: 4, fillEnabled: true, fillOpacity: 0.3 }),
        mk('diamond', { width: 6, height: 10 }),
      ]},
    ]
  };
}

// ─── NATO-style ─────────────────────────────────────────────

function nato() {
  _idCounter = 0;
  return {
    id: 'preset_nato',
    name: 'NATO',
    presetId: 'nato',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ranks: [
      // OR-1: empty
      { shapes: [] },

      // OR-2: single chevron (thin)
      { shapes: [
        mk('chevron', { halfW: 5, height: 6, bow: 0.2, strokeWidth: 1 }),
      ]},

      // OR-3: two chevrons
      { shapes: [
        mk('chevron', { halfW: 5, height: 6, bow: 0.2, strokeWidth: 1, y: 2 }),
        mk('chevron', { halfW: 4.4, height: 5.3, bow: 0.2, strokeWidth: 1, y: -2.5 }),
      ]},

      // OR-4: three chevrons
      { shapes: [
        mk('chevron', { halfW: 5, height: 6, bow: 0.2, strokeWidth: 1, y: 4 }),
        mk('chevron', { halfW: 4.4, height: 5.3, bow: 0.2, strokeWidth: 1, y: 0 }),
        mk('chevron', { halfW: 3.8, height: 4.6, bow: 0.2, strokeWidth: 1, y: -4 }),
      ]},

      // OR-5: three chevrons + bar
      { shapes: [
        mk('chevron', { halfW: 5, height: 6, bow: 0.2, strokeWidth: 1, y: 4 }),
        mk('chevron', { halfW: 4.4, height: 5.3, bow: 0.2, strokeWidth: 1, y: 0 }),
        mk('chevron', { halfW: 3.8, height: 4.6, bow: 0.2, strokeWidth: 1, y: -4 }),
        mk('line', { length: 10, strokeWidth: 1.5, y: 8 }),
      ]},

      // OR-6: three chevrons + arc
      { shapes: [
        mk('chevron', { halfW: 5, height: 6, bow: 0.2, strokeWidth: 1, y: 4 }),
        mk('chevron', { halfW: 4.4, height: 5.3, bow: 0.2, strokeWidth: 1, y: 0 }),
        mk('chevron', { halfW: 3.8, height: 4.6, bow: 0.2, strokeWidth: 1, y: -4 }),
        mk('arc', { halfW: 5, arcHeight: 3, y: 8.5, flipY: true, strokeWidth: 1 }),
      ]},
    ]
  };
}

// ─── Export ──────────────────────────────────────────────────

/** All available presets. Each entry: { id, name, build() → set } */
export const INSIGNIA_PRESETS = [
  { id: 'us_army', name: 'US Army',     build: usArmy },
  { id: 'usmc',    name: 'USMC',        build: usmc },
  { id: 'nato',    name: 'NATO',        build: nato },
  { id: 'generic', name: 'Simple Bars', build: generic },
];

/**
 * Build a fresh copy of a preset by its ID.
 * Returns a new InsigniaSet object (fully editable), or null if not found.
 * @param {string} presetId
 * @returns {object|null}
 */
export function buildPreset(presetId) {
  const entry = INSIGNIA_PRESETS.find(p => p.id === presetId);
  if (!entry) return null;
  const set = entry.build();
  // Give each loaded copy a unique runtime ID
  set.id = 'set_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  return set;
}
