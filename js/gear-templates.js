// ═══════════════════════════════════════════════════════════════
// GEAR TEMPLATES — Weapon, optic, attachment, armor, utility definitions
// These are blueprints. Actual items in the armory are instances of these.
// ═══════════════════════════════════════════════════════════════

// ── Quality tiers ────────────────────────────────────────────

export const QUALITY_TIERS = {
  standard_issue: { label: 'Standard Issue', mult: 0.8, wearRate: 1.5, color: '#94a3b8' },
  common:         { label: 'Common',         mult: 1.0, wearRate: 1.0, color: '#e2e8f0' },
  improved:       { label: 'Improved',       mult: 1.1, wearRate: 0.85, color: '#4ade80' },
  rare:           { label: 'Rare',           mult: 1.2, wearRate: 0.7, color: '#60a5fa' }
};

// ── Weapon categories ────────────────────────────────────────

export const WEAPON_CATEGORIES = {
  assault_rifle: 'Assault Rifle',
  battle_rifle: 'Battle Rifle',
  carbine: 'Carbine',
  smg: 'SMG',
  lmg: 'LMG',
  sniper_rifle: 'Sniper Rifle',
  dmr: 'DMR',
  shotgun: 'Shotgun',
  pistol: 'Pistol',
  launcher: 'Launcher'
};

// ── MOS weapon access ────────────────────────────────────────

export const MOS_WEAPON_ACCESS = {
  rifleman:     ['assault_rifle', 'battle_rifle', 'carbine'],
  medic:        ['smg', 'carbine', 'pistol'],
  engineer:     ['smg', 'shotgun', 'carbine'],
  heavy_gunner: ['lmg', 'launcher'],
  marksman:     ['sniper_rifle', 'dmr', 'battle_rifle']
};

// ── Weapon templates ─────────────────────────────────────────
// stats.damage = per-hit damage (fixed by caliber)
// stats.fireRate = ms between shots (lower = faster)
// stats.range = effective range in game units
// stats.accuracy = base accuracy (0-1)
// stats.magSize = rounds per magazine
// stats.reloadTime = ms to reload
// stats.recoil = per-shot recoil (0-1, higher = worse)
// stats.weight = kg, affects movement speed

export const WEAPON_TEMPLATES = {
  // ── Assault Rifles ──
  M4A1: {
    name: 'M4A1', category: 'assault_rifle',
    stats: { damage: 18, fireRate: 600, range: 350, accuracy: 0.82, magSize: 30, reloadTime: 2500, recoil: 0.15, weight: 3.4 },
    burstModes: ['semi', 'auto'], soundSignature: 1.3, volume: 4,
    compatibleOptics: ['iron_sights', 'red_dot', 'holo', 'acog_4x'],
    compatibleAttachments: ['suppressor', 'foregrip', 'laser', 'ext_mag']
  },
  AK47: {
    name: 'AK-47', category: 'assault_rifle',
    stats: { damage: 22, fireRate: 650, range: 320, accuracy: 0.75, magSize: 30, reloadTime: 2800, recoil: 0.20, weight: 3.9 },
    burstModes: ['semi', 'auto'], soundSignature: 1.5, volume: 4,
    compatibleOptics: ['iron_sights', 'red_dot'],
    compatibleAttachments: ['foregrip', 'ext_mag']
  },
  M16A4: {
    name: 'M16A4', category: 'assault_rifle',
    stats: { damage: 20, fireRate: 700, range: 380, accuracy: 0.85, magSize: 30, reloadTime: 2500, recoil: 0.12, weight: 3.6 },
    burstModes: ['semi', 'burst'], soundSignature: 1.3, volume: 4,
    compatibleOptics: ['iron_sights', 'red_dot', 'holo', 'acog_4x'],
    compatibleAttachments: ['suppressor', 'foregrip', 'bipod', 'laser', 'ext_mag']
  },

  // ── SMGs ──
  MP5: {
    name: 'MP5', category: 'smg',
    stats: { damage: 12, fireRate: 500, range: 200, accuracy: 0.78, magSize: 30, reloadTime: 2000, recoil: 0.10, weight: 2.5 },
    burstModes: ['semi', 'auto'], soundSignature: 1.1, volume: 3,
    compatibleOptics: ['iron_sights', 'red_dot', 'holo'],
    compatibleAttachments: ['suppressor', 'foregrip', 'laser', 'ext_mag']
  },
  P90: {
    name: 'P90', category: 'smg',
    stats: { damage: 14, fireRate: 450, range: 220, accuracy: 0.76, magSize: 50, reloadTime: 2200, recoil: 0.08, weight: 2.8 },
    burstModes: ['semi', 'auto'], soundSignature: 1.0, volume: 3,
    compatibleOptics: ['iron_sights', 'red_dot'],
    compatibleAttachments: ['suppressor', 'laser']
  },

  // ── LMGs ──
  M249: {
    name: 'M249 SAW', category: 'lmg',
    stats: { damage: 20, fireRate: 550, range: 400, accuracy: 0.70, magSize: 200, reloadTime: 5000, recoil: 0.22, weight: 7.5 },
    burstModes: ['auto'], soundSignature: 1.6, volume: 6,
    compatibleOptics: ['iron_sights', 'red_dot', 'acog_4x'],
    compatibleAttachments: ['bipod', 'foregrip']
  },
  M240B: {
    name: 'M240B', category: 'lmg',
    stats: { damage: 28, fireRate: 650, range: 450, accuracy: 0.68, magSize: 100, reloadTime: 6000, recoil: 0.25, weight: 12.0 },
    burstModes: ['auto'], soundSignature: 1.8, volume: 7,
    compatibleOptics: ['iron_sights', 'acog_4x'],
    compatibleAttachments: ['bipod']
  },

  // ── Sniper Rifles ──
  M24: {
    name: 'M24 SWS', category: 'sniper_rifle',
    stats: { damage: 65, fireRate: 2000, range: 600, accuracy: 0.90, magSize: 5, reloadTime: 3000, recoil: 0.18, weight: 5.4 },
    burstModes: ['semi'], soundSignature: 1.4, volume: 5,
    compatibleOptics: ['iron_sights', 'acog_4x', 'scope_8x'],
    compatibleAttachments: ['suppressor', 'bipod']
  },
  M82: {
    name: 'Barrett M82', category: 'sniper_rifle',
    stats: { damage: 120, fireRate: 3000, range: 800, accuracy: 0.85, magSize: 10, reloadTime: 4000, recoil: 0.30, weight: 14.0 },
    burstModes: ['semi'], soundSignature: 2.0, volume: 8,
    compatibleOptics: ['scope_8x'],
    compatibleAttachments: ['bipod']
  },

  // ── Shotguns ──
  M870: {
    name: 'M870', category: 'shotgun',
    stats: { damage: 45, fireRate: 1200, range: 100, accuracy: 0.60, magSize: 8, reloadTime: 3500, recoil: 0.28, weight: 3.6 },
    burstModes: ['semi'], soundSignature: 1.5, volume: 4,
    compatibleOptics: ['iron_sights'],
    compatibleAttachments: ['foregrip']
  },

  // ── Sidearms ──
  M9: {
    name: 'M9 Beretta', category: 'pistol',
    stats: { damage: 10, fireRate: 400, range: 100, accuracy: 0.72, magSize: 15, reloadTime: 1500, recoil: 0.08, weight: 1.0 },
    burstModes: ['semi'], soundSignature: 0.9, volume: 1,
    unlimitedAmmo: true,
    compatibleOptics: [],
    compatibleAttachments: ['suppressor', 'laser']
  },
  M1911: {
    name: 'M1911', category: 'pistol',
    stats: { damage: 14, fireRate: 500, range: 80, accuracy: 0.78, magSize: 7, reloadTime: 1800, recoil: 0.12, weight: 1.1 },
    burstModes: ['semi'], soundSignature: 1.0, volume: 1,
    unlimitedAmmo: true,
    compatibleOptics: [],
    compatibleAttachments: ['suppressor']
  }
};

// ── Optic templates ──────────────────────────────────────────

export const OPTIC_TEMPLATES = {
  iron_sights: {
    name: 'Iron Sights', slot: 'optic',
    statMods: {}, // no bonus — baseline
    volume: 0, weight: 0,
    compatibleWith: ['assault_rifle', 'battle_rifle', 'carbine', 'smg', 'lmg', 'sniper_rifle', 'dmr', 'shotgun']
  },
  red_dot: {
    name: 'Red Dot Sight', slot: 'optic',
    statMods: { accuracy: 0.04, range: 20 },
    volume: 1, weight: 0.2,
    compatibleWith: ['assault_rifle', 'battle_rifle', 'carbine', 'smg', 'lmg', 'dmr']
  },
  holo: {
    name: 'Holographic Sight', slot: 'optic',
    statMods: { accuracy: 0.05, range: 15 },
    volume: 1, weight: 0.3,
    compatibleWith: ['assault_rifle', 'carbine', 'smg']
  },
  acog_4x: {
    name: 'ACOG 4x', slot: 'optic',
    statMods: { accuracy: 0.06, range: 80, viewRange: 50 },
    volume: 1, weight: 0.4,
    compatibleWith: ['assault_rifle', 'battle_rifle', 'lmg', 'dmr']
  },
  scope_8x: {
    name: 'Sniper Scope 8x', slot: 'optic',
    statMods: { accuracy: 0.08, range: 150, viewRange: 100 },
    volume: 1, weight: 0.6,
    compatibleWith: ['sniper_rifle', 'dmr']
  }
};

// ── Attachment templates ─────────────────────────────────────

export const ATTACHMENT_TEMPLATES = {
  suppressor: {
    name: 'Suppressor', slot: 'attachment',
    statMods: { damage: -2, range: -20 },
    behaviorMods: { soundSignature: 0.4, muzzleFlash: 0.1 },
    volume: 1, weight: 0.5,
    compatibleWith: ['assault_rifle', 'smg', 'carbine', 'sniper_rifle', 'pistol']
  },
  foregrip: {
    name: 'Foregrip', slot: 'attachment',
    statMods: { recoil: -0.04, accuracy: 0.02 },
    volume: 1, weight: 0.3,
    compatibleWith: ['assault_rifle', 'smg', 'carbine', 'lmg', 'shotgun']
  },
  bipod: {
    name: 'Bipod', slot: 'attachment',
    statMods: { recoil: -0.08, accuracy: 0.05 },
    proneOnly: true, // full bonus only when prone, 50% when stationary standing
    volume: 1, weight: 0.8,
    compatibleWith: ['assault_rifle', 'lmg', 'sniper_rifle', 'dmr']
  },
  laser: {
    name: 'Laser Sight', slot: 'attachment',
    statMods: { accuracy: 0.03 },
    volume: 1, weight: 0.1,
    compatibleWith: ['assault_rifle', 'smg', 'carbine', 'pistol']
  },
  ext_mag: {
    name: 'Extended Magazine', slot: 'attachment',
    statMods: { magSize: 10, reloadTime: 300 }, // more rounds but slightly slower reload
    volume: 1, weight: 0.3,
    compatibleWith: ['assault_rifle', 'smg', 'carbine']
  },
  hair_trigger: {
    name: 'Hair Trigger', slot: 'attachment',
    statMods: { fireRate: -50 }, // faster semi-auto ROF
    volume: 1, weight: 0.1,
    compatibleWith: ['assault_rifle', 'battle_rifle', 'dmr', 'sniper_rifle']
  }
};

// ── Armor templates ──────────────────────────────────────────

export const ARMOR_TEMPLATES = {
  none: {
    name: 'No Armor', slot: 'armor',
    statMods: {},
    weight: 0, volume: 0
  },
  light_vest: {
    name: 'Light Vest', slot: 'armor',
    statMods: { hp: 20 },
    weight: 2.0, volume: 2
  },
  plate_carrier: {
    name: 'Plate Carrier', slot: 'armor',
    statMods: { hp: 45 },
    weight: 5.5, volume: 3
  },
  heavy_armor: {
    name: 'Heavy Armor', slot: 'armor',
    statMods: { hp: 70 },
    weight: 10.0, volume: 4
  }
};

// ── Utility templates ────────────────────────────────────────

export const UTILITY_TEMPLATES = {
  frag_grenade: {
    name: 'Frag Grenade', slot: 'utility',
    mosRestriction: null, // all MOS
    ability: 'grenade', charges: 2,
    statMods: {},
    volume: 1, weight: 0.4
  },
  medkit: {
    name: 'Field Medkit', slot: 'utility',
    mosRestriction: ['medic'],
    ability: 'revive', charges: 3,
    statMods: {},
    volume: 1, weight: 0.8
  },
  trauma_kit: {
    name: 'Trauma Kit', slot: 'utility',
    mosRestriction: ['medic'],
    ability: 'revive', charges: 5,
    statMods: {},
    volume: 2, weight: 1.2
  },
  repair_kit: {
    name: 'Repair Kit', slot: 'utility',
    mosRestriction: ['engineer'],
    ability: 'repair', charges: 2,
    statMods: {},
    volume: 2, weight: 1.5
  },
  at_mine: {
    name: 'AT Mine', slot: 'utility',
    mosRestriction: ['engineer'],
    ability: 'mine', charges: 2,
    statMods: {},
    volume: 2, weight: 2.0
  },
  ammo_pack: {
    name: 'Ammo Pack', slot: 'utility',
    mosRestriction: ['rifleman', 'heavy_gunner'],
    ability: 'resupply', charges: 1,
    statMods: {},
    volume: 2, weight: 2.0
  },
  ghillie_wrap: {
    name: 'Ghillie Wrap', slot: 'utility',
    mosRestriction: ['marksman'],
    ability: 'concealment', charges: 0, // passive
    statMods: {},
    behaviorMods: { moveSignature: 0.3, proneSignature: 0.1 },
    volume: 2, weight: 1.0
  },
  c4: {
    name: 'C4 Explosive', slot: 'utility',
    mosRestriction: ['engineer'],
    ability: 'demolition', charges: 1,
    statMods: {},
    volume: 1, weight: 0.6
  }
};

// ── Special ammo types ───────────────────────────────────────

export const SPECIAL_AMMO_TYPES = {
  ap: { name: 'Armor Piercing', penetrationBonus: 0.3, damageBonus: 0, charges: 30 },
  tracer: { name: 'Tracer', penetrationBonus: 0, damageBonus: 0, markTarget: true, charges: 20 },
  incendiary: { name: 'Incendiary', penetrationBonus: 0, damageBonus: 0, dotDamage: 2, dotDuration: 3000, charges: 15 }
};

// ── Standard issue per MOS ───────────────────────────────────

export const STANDARD_ISSUE = {
  rifleman:     { primary: 'M4A1',  sidearm: 'M9', optic: 'iron_sights', attachment: null, armor: 'light_vest', utility: 'frag_grenade' },
  medic:        { primary: 'MP5',   sidearm: 'M9', optic: 'iron_sights', attachment: null, armor: 'light_vest', utility: 'medkit' },
  engineer:     { primary: 'M870',  sidearm: 'M9', optic: 'iron_sights', attachment: null, armor: 'light_vest', utility: 'repair_kit' },
  heavy_gunner: { primary: 'M249',  sidearm: 'M9', optic: 'iron_sights', attachment: null, armor: 'plate_carrier', utility: 'ammo_pack' },
  marksman:     { primary: 'M24',   sidearm: 'M9', optic: 'acog_4x',     attachment: null, armor: 'light_vest', utility: 'ghillie_wrap' }
};

// ── Prone modifiers ──────────────────────────────────────────

export const PRONE_MODIFIERS = {
  accuracyBonus: 0.15,
  hitRadiusMult: 0.5,
  misChance: 0.20,
  speed: 0,
  transitionDownTime: 500,  // ms to go prone
  transitionUpTime: 800     // ms to stand
};

// ── Range zones ──────────────────────────────────────────────
// Derived from effective range. Used in accuracy falloff.
// Close: bonus accuracy. Effective: normal. Extended: falloff. Max: near-zero accuracy.

export const RANGE_ZONE_RATIOS = {
  close: 0.15,      // 0 to 15% of effective range
  effective: 1.0,    // 15% to 100% of effective range
  extended: 1.5,     // 100% to 150% of effective range
  max: 1.8           // 150% to 180% — projectile stops here
};

// ── Helper: get template by ID ───────────────────────────────

const ALL_TEMPLATES = {
  ...WEAPON_TEMPLATES,
  ...OPTIC_TEMPLATES,
  ...ATTACHMENT_TEMPLATES,
  ...ARMOR_TEMPLATES,
  ...UTILITY_TEMPLATES
};

export function getGearTemplate(templateId) {
  return ALL_TEMPLATES[templateId] || null;
}

export function getWeaponTemplate(templateId) {
  return WEAPON_TEMPLATES[templateId] || null;
}
