// ===============================================================
// FIRE RANGE TEST PRESETS - Predefined battle scenarios for
// systematic testing of AI systems (tier damage, movement,
// suppression, targeting, vision, morale, combined arms)
// ===============================================================

const DBG_OFF = { blueInvincible: false, redInvincible: false, noCooldowns: false, showRanges: false };

// Default slot values — override only what matters per scenario
function slot(overrides) {
  return {
    unitId: 'infantry', count: 1, command: 'advance',
    aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5,
    veterancy: 0, morale: 0.8, awareness: 0.5, leadership: 0, isLeader: false,
    tgtDistance: 0.7, tgtWeakness: 0.3, tgtThreat: 0.0, tgtValue: 0.0,
    ...overrides
  };
}

// ---------------------------------------------------------------
// PRESET DEFINITIONS
// ---------------------------------------------------------------

export const FR_PRESETS = {

  // ═══════════════ TIER DAMAGE ═══════════════

  'infantry-swarm-vs-tanks': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 6, aggression: 0.7, courage: 0.7, discipline: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'sherman', count: 2, command: 'hold', patience: 0.7, courage: 0.6, discipline: 0.7 })
    ],
    mapSize: 'small', debug: DBG_OFF
  },

  'tank-duel': {
    blueTeam: [
      slot({ unitId: 'sherman', count: 3, discipline: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'sherman', count: 3, discipline: 0.6 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'david-vs-goliath': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 8, aggression: 0.8, courage: 0.7, discipline: 0.3 })
    ],
    redTeam: [
      slot({ unitId: 'tiger', count: 1, command: 'hold', courage: 0.9, patience: 0.8, discipline: 0.8 })
    ],
    mapSize: 'small', debug: DBG_OFF
  },

  'light-vs-heavy': {
    blueTeam: [
      slot({ unitId: 'jeep', count: 4, aggression: 0.6, courage: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'tiger', count: 2, command: 'hold', patience: 0.7, courage: 0.7, discipline: 0.7 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'mixed-tier-clash': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 2, discipline: 0.5 }),
      slot({ unitId: 'jeep', count: 2, aggression: 0.6 }),
      slot({ unitId: 'sherman', count: 1, discipline: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 2, discipline: 0.5 }),
      slot({ unitId: 'jeep', count: 2, aggression: 0.6 }),
      slot({ unitId: 'sherman', count: 1, discipline: 0.6 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  // ═══════════════ BEHAVIOR ═══════════════

  'aggression-test': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, aggression: 0.2, patience: 0.8, courage: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, aggression: 0.9, patience: 0.2, courage: 0.5 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'discipline-test': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.9, courage: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.1, courage: 0.6 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'patience-test': {
    blueTeam: [
      slot({ unitId: 'sherman', count: 3, command: 'hold', patience: 0.9, aggression: 0.2 })
    ],
    redTeam: [
      slot({ unitId: 'sherman', count: 3, patience: 0.1, aggression: 0.8 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'initiative-test': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, initiative: 0.9, discipline: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, initiative: 0.1, discipline: 0.5 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'bounding-overwatch': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.9, patience: 0.7, courage: 0.5, aggression: 0.3 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.5, patience: 0.3, aggression: 0.6, courage: 0.5 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  // ═══════════════ VISION ═══════════════

  'range-advantage': {
    blueTeam: [
      slot({ unitId: 'specops', count: 3, command: 'hold', awareness: 0.9, patience: 0.8, courage: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, aggression: 0.7, awareness: 0.3, courage: 0.6 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  'awareness-mismatch': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, awareness: 0.9, patience: 0.6, courage: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, awareness: 0.1, patience: 0.4, courage: 0.5 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  // ═══════════════ MORALE ═══════════════

  'suppression-test': {
    blueTeam: [
      slot({ unitId: 'tiger', count: 1, courage: 0.9, patience: 0.5, discipline: 0.8 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 6, courage: 0.4, morale: 0.6, discipline: 0.4 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'courage-test': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 4, courage: 0.2, morale: 0.5, discipline: 0.4 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, courage: 0.9, morale: 0.9, discipline: 0.7 })
    ],
    mapSize: 'small', debug: DBG_OFF
  },

  'morale-cascade': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 6, courage: 0.4, morale: 0.6, discipline: 0.3 })
    ],
    redTeam: [
      slot({ unitId: 'sherman', count: 2, courage: 0.8, discipline: 0.7, aggression: 0.6 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  // ═══════════════ COMBINED ARMS ═══════════════

  'mixed-arms-mirror': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 2, discipline: 0.5 }),
      slot({ unitId: 'jeep', count: 1, aggression: 0.5 }),
      slot({ unitId: 'sherman', count: 1, command: 'hold', discipline: 0.6, patience: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 2, discipline: 0.5 }),
      slot({ unitId: 'jeep', count: 1, aggression: 0.5 }),
      slot({ unitId: 'sherman', count: 1, command: 'hold', discipline: 0.6, patience: 0.6 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'asymmetric-combined': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.5, courage: 0.6 }),
      slot({ unitId: 'tiger', count: 1, command: 'hold', patience: 0.7, courage: 0.8 })
    ],
    redTeam: [
      slot({ unitId: 'sherman', count: 4, aggression: 0.6, discipline: 0.5 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'fire-support': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.5, courage: 0.5 }),
      slot({ unitId: 'howitzer', count: 1, command: 'hold', patience: 0.9, awareness: 0.7 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 5, aggression: 0.6, courage: 0.5 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  // ═══════════════ TARGETING ═══════════════

  'focus-weakest': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, tgtWeakness: 1.0, tgtDistance: 0.0, tgtThreat: 0.0, tgtValue: 0.0 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, tgtDistance: 1.0, tgtWeakness: 0.0, tgtThreat: 0.0, tgtValue: 0.0 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  'threat-priority': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 2, tgtThreat: 1.0, tgtDistance: 0.0, tgtWeakness: 0.0, tgtValue: 0.0 }),
      slot({ unitId: 'sherman', count: 1, tgtThreat: 1.0, tgtDistance: 0.0, tgtWeakness: 0.0, tgtValue: 0.0 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 2, tgtDistance: 1.0, tgtThreat: 0.0, tgtWeakness: 0.0, tgtValue: 0.0 }),
      slot({ unitId: 'sherman', count: 1, tgtDistance: 1.0, tgtThreat: 0.0, tgtWeakness: 0.0, tgtValue: 0.0 })
    ],
    mapSize: 'medium', debug: DBG_OFF
  },

  // ═══════════════ SERGEANT AI ═══════════════

  'sgt-aggressive-vs-cautious': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.6 }),
      slot({ unitId: 'sherman', count: 1, discipline: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.6 }),
      slot({ unitId: 'sherman', count: 1, discipline: 0.6 })
    ],
    blueSergeant: { aggression: 0.9, patience: 0.1, courage: 0.8, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
    redSergeant:  { aggression: 0.1, patience: 0.9, courage: 0.5, discipline: 0.8, initiative: 0.3, awareness: 0.5 },
    mapSize: 'large', debug: DBG_OFF
  },

  'sgt-flanker-vs-line': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.7 }),
      slot({ unitId: 'jeep', count: 2, discipline: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, discipline: 0.7 }),
      slot({ unitId: 'sherman', count: 1, discipline: 0.7 })
    ],
    blueSergeant: { aggression: 0.6, patience: 0.4, courage: 0.6, discipline: 0.5, initiative: 0.9, awareness: 0.7 },
    redSergeant:  { aggression: 0.3, patience: 0.7, courage: 0.6, discipline: 0.9, initiative: 0.1, awareness: 0.3 },
    mapSize: 'large', debug: DBG_OFF
  },

  'sgt-brave-vs-coward': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 4, courage: 0.7, morale: 0.8 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 4, courage: 0.7, morale: 0.8 })
    ],
    blueSergeant: { aggression: 0.5, patience: 0.5, courage: 0.9, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
    redSergeant:  { aggression: 0.5, patience: 0.5, courage: 0.1, discipline: 0.5, initiative: 0.5, awareness: 0.5 },
    mapSize: 'medium', debug: DBG_OFF
  },

  'sgt-adaptive-vs-rigid': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.5 }),
      slot({ unitId: 'sherman', count: 2, discipline: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 3, discipline: 0.5 }),
      slot({ unitId: 'sherman', count: 2, discipline: 0.5 })
    ],
    blueSergeant: { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.9 },
    redSergeant:  { aggression: 0.5, patience: 0.5, courage: 0.5, discipline: 0.5, initiative: 0.5, awareness: 0.1 },
    mapSize: 'medium', debug: DBG_OFF
  },

  // ═══════════════ PERFORMANCE STRESS TESTS ═══════════════

  'perf-20v20-infantry': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 20, discipline: 0.5, courage: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 20, discipline: 0.5, courage: 0.5 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  'perf-30v30-mixed': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 15, discipline: 0.5 }),
      slot({ unitId: 'sherman', count: 5, discipline: 0.6 }),
      slot({ unitId: 'jeep', count: 5, aggression: 0.6 }),
      slot({ unitId: 'humvee', count: 5, discipline: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 15, discipline: 0.5 }),
      slot({ unitId: 'sherman', count: 5, discipline: 0.6 }),
      slot({ unitId: 'jeep', count: 5, aggression: 0.6 }),
      slot({ unitId: 'humvee', count: 5, discipline: 0.5 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  'perf-50v50-infantry': {
    blueTeam: [
      slot({ unitId: 'infantry', count: 50, discipline: 0.5, courage: 0.5 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 50, discipline: 0.5, courage: 0.5 })
    ],
    mapSize: 'large', debug: DBG_OFF
  },

  'perf-10v50-defense': {
    blueTeam: [
      slot({ unitId: 'sherman', count: 3, command: 'hold', discipline: 0.7, patience: 0.7 }),
      slot({ unitId: 'infantry', count: 7, command: 'hold', discipline: 0.6 })
    ],
    redTeam: [
      slot({ unitId: 'infantry', count: 50, aggression: 0.7, courage: 0.6, discipline: 0.4 })
    ],
    mapSize: 'large', debug: DBG_OFF
  }
};

// ---------------------------------------------------------------
// ORDERED LIST FOR UI (grouped by category)
// ---------------------------------------------------------------

export const FR_PRESET_LIST = [
  { category: 'Tier Damage', presets: [
    { id: 'infantry-swarm-vs-tanks', name: 'Infantry Swarm vs Tanks', desc: '6 infantry vs 2 shermans — can mass overcome armor?' },
    { id: 'tank-duel',               name: 'Tank Duel',               desc: '3v3 shermans — same-tier baseline' },
    { id: 'david-vs-goliath',        name: 'David vs Goliath',        desc: '8 infantry vs 1 tiger — mass vs heavy armor' },
    { id: 'light-vs-heavy',          name: 'Light vs Heavy',          desc: '4 jeeps vs 2 tigers — speed vs power' },
    { id: 'mixed-tier-clash',        name: 'Mixed Tier Clash',        desc: 'Mirror match with inf + jeep + sherman' }
  ]},
  { category: 'Behavior', presets: [
    { id: 'aggression-test',    name: 'Aggression Test',    desc: 'Low aggression (backoff) vs high aggression (push)' },
    { id: 'discipline-test',    name: 'Discipline Test',    desc: 'High discipline (formation) vs low (scattered)' },
    { id: 'patience-test',      name: 'Patience Test',      desc: 'Patient hold vs impatient rush — shermans' },
    { id: 'initiative-test',    name: 'Initiative Test',    desc: 'High initiative (re-eval) vs low (routine)' },
    { id: 'bounding-overwatch', name: 'Bounding Overwatch', desc: 'Cautious tactical vs casual advance' }
  ]},
  { category: 'Vision', presets: [
    { id: 'range-advantage',     name: 'Range Advantage',     desc: 'Specops (long range, high awareness) vs infantry' },
    { id: 'awareness-mismatch',  name: 'Awareness Mismatch',  desc: 'High awareness vs low — spotting and cover use' }
  ]},
  { category: 'Morale', presets: [
    { id: 'suppression-test', name: 'Suppression Test', desc: '1 tiger vs 6 infantry — heavy suppressive fire' },
    { id: 'courage-test',     name: 'Courage Test',     desc: 'Low courage vs high — who breaks first?' },
    { id: 'morale-cascade',   name: 'Morale Cascade',   desc: '6 weak-morale infantry vs 2 shermans — cascade panic' }
  ]},
  { category: 'Combined Arms', presets: [
    { id: 'mixed-arms-mirror',    name: 'Mixed Arms Mirror',    desc: 'Balanced inf+jeep+sherman per side' },
    { id: 'asymmetric-combined',  name: 'Asymmetric Combined',  desc: 'Infantry screen + tiger vs 4 shermans' },
    { id: 'fire-support',         name: 'Fire Support',         desc: '3 infantry + howitzer vs 5 infantry' }
  ]},
  { category: 'Targeting', presets: [
    { id: 'focus-weakest',   name: 'Focus Weakest',   desc: 'Target low-HP vs target nearest' },
    { id: 'threat-priority',  name: 'Threat Priority',  desc: 'Target highest threat vs target nearest' }
  ]},
  { category: 'Sergeant AI', presets: [
    { id: 'sgt-aggressive-vs-cautious', name: 'Aggressive vs Cautious', desc: 'Reckless push sergeant vs patient hold sergeant' },
    { id: 'sgt-flanker-vs-line',        name: 'Flanker vs Line',        desc: 'High initiative flanker vs rigid line defense' },
    { id: 'sgt-brave-vs-coward',        name: 'Brave vs Coward',        desc: 'Courageous sergeant vs one who retreats early' },
    { id: 'sgt-adaptive-vs-rigid',      name: 'Adaptive vs Rigid',      desc: 'Fast re-eval (1s) vs slow (3s) — awareness test' }
  ]},
  { category: 'Performance', presets: [
    { id: 'perf-20v20-infantry',  name: '20v20 Infantry',  desc: '40 total units — baseline stress test' },
    { id: 'perf-30v30-mixed',     name: '30v30 Mixed',     desc: '60 total units — mixed armor, vehicles, infantry' },
    { id: 'perf-50v50-infantry',  name: '50v50 Infantry',  desc: '100 total units — maximum stress test' },
    { id: 'perf-10v50-defense',   name: '10v50 Defense',   desc: '10 defenders vs 50 attackers — asymmetric wave' }
  ]}
];
