// ═══════════════════════════════════════════════════════════════
// BATTLE LOG — Centralized event logging with categories + filters
//
// All battle events flow through logEvent(). Each event is tagged
// with source, category, and severity so consumers (kill feed,
// chatter, debug panel, replay analysis) can filter independently.
//
// Usage:
//   import { logEvent, EventCategory, EventSeverity } from './battle-log.js';
//   logEvent(b, { source: 'commander', category: 'tactical', severity: 'alert',
//     team: 'red', action: 'play', detail: 'Squad 1: assault' });
//
// Querying:
//   import { filterEvents, getRecentEvents } from './battle-log.js';
//   const kills = filterEvents(b, { category: 'combat', action: 'kill' });
//   const cmdAlerts = filterEvents(b, { source: 'commander', severity: 'alert' });
//   const recent = getRecentEvents(b, { category: 'tactical' }, 10);
// ═══════════════════════════════════════════════════════════════


// ── Enums ────────────────────────────────────────────────────

export const EventSource = {
  COMMANDER:  'commander',
  SERGEANT:   'sergeant',
  UNIT:       'unit',
  SYSTEM:     'system'
};

export const EventCategory = {
  COMBAT:     'combat',      // fire, hit, kill
  TACTICAL:   'tactical',    // plays, objectives, phases, reassignments
  LOGISTICS:  'logistics',   // reserves, reinforcements, escalation, deployment
  INTEL:      'intel',       // spotted, contact, threat assessment, sitrep
  MOVEMENT:   'movement',    // formation, cover, flanking, survival, stuck, navigation
  SYSTEM:     'system'       // wave start, debug, timescale
};

export const EventSeverity = {
  INFO:       'info',        // Routine (fire, movement, formation telemetry)
  ALERT:      'alert',       // Noteworthy (kills, phase changes, reinforcements)
  CRITICAL:   'critical'     // Urgent (panic deploy, escalation, all-out assault)
};


// ── Classification table ─────────────────────────────────────
// Maps legacy event { type, action } → { source, category, severity }
// Used by logEvent() when called with raw legacy shapes, and by
// classifyLegacyEvent() for retroactive tagging.

const CLASSIFICATION = {
  // Commander events
  'commander.objective':    { source: 'commander', category: 'tactical',   severity: 'info'     },
  'commander.play':         { source: 'commander', category: 'tactical',   severity: 'alert'    },
  'commander.reassign':     { source: 'commander', category: 'tactical',   severity: 'alert'    },
  'commander.complete':     { source: 'commander', category: 'tactical',   severity: 'info'     },
  'commander.deploy':       { source: 'commander', category: 'logistics',  severity: 'alert'    },
  'commander.reserve':      { source: 'commander', category: 'logistics',  severity: 'alert'    },
  'commander.panic_deploy': { source: 'commander', category: 'logistics',  severity: 'critical' },
  'commander.escalate':     { source: 'commander', category: 'logistics',  severity: 'critical' },

  // Sergeant events
  'sergeant.*':             { source: 'sergeant',  category: 'tactical',   severity: 'info'     },
  'speech.*':               { source: 'sergeant',  category: 'tactical',   severity: 'info'     },

  // Combat events
  'fire.*':                 { source: 'unit',      category: 'combat',     severity: 'info'     },
  'hit.*':                  { source: 'unit',      category: 'combat',     severity: 'info'     },
  'kill.*':                 { source: 'unit',      category: 'combat',     severity: 'alert'    },

  // Decision events
  'decision.*':             { source: 'unit',      category: 'tactical',   severity: 'info'     },

  // Movement events
  'turning.*':              { source: 'unit',      category: 'movement',   severity: 'info'     },
  'formation.*':            { source: 'unit',      category: 'movement',   severity: 'info'     },
  'cover.*':                { source: 'unit',      category: 'movement',   severity: 'info'     },
  'movement.*':             { source: 'unit',      category: 'movement',   severity: 'info'     },
  'move_blocked.*':         { source: 'unit',      category: 'movement',   severity: 'info'     },
  'nav_fail.*':             { source: 'unit',      category: 'movement',   severity: 'alert'    },
  'STUCK.*':                { source: 'unit',      category: 'movement',   severity: 'alert'    },

  // Survival / flank
  'survival.*':             { source: 'unit',      category: 'combat',     severity: 'info'     },
  'flank.*':                { source: 'unit',      category: 'combat',     severity: 'alert'    },
  'morale_event.*':         { source: 'unit',      category: 'combat',     severity: 'info'     },

  // System events
  'wave.*':                 { source: 'system',    category: 'system',     severity: 'alert'    }
};

/**
 * Look up classification for a legacy event.
 * Tries exact match first (type.action), then wildcard (type.*).
 */
function classifyLegacyEvent(type, action) {
  const exact = `${type}.${action}`;
  if (CLASSIFICATION[exact]) return CLASSIFICATION[exact];
  const wild = `${type}.*`;
  if (CLASSIFICATION[wild]) return CLASSIFICATION[wild];
  return { source: 'unit', category: 'system', severity: 'info' };
}


// ── Core API ─────────────────────────────────────────────────

/**
 * Log a battle event. Accepts either the new tagged format or legacy format.
 *
 * New format (preferred):
 *   logEvent(b, {
 *     source: 'commander', category: 'tactical', severity: 'alert',
 *     team: 'red', who: 'cmd-red', action: 'play',
 *     detail: 'Squad 1: assault (panic: 0.45)',
 *     x, y  // optional position
 *   });
 *
 * Legacy format (auto-classified):
 *   logEvent(b, {
 *     type: 'kill', action: 'kill', who: 'unit-1', team: 'blue',
 *     target: 'enemy-3', detail: 'hp:0/100', x: 200, y: 300
 *   });
 *
 * @param {object} b - battle state (has b._debugLog)
 * @param {object} event - event data
 */
export function logEvent(b, event) {
  if (!b?._debugLog) return;

  const now = event.t ?? Date.now();

  // If the event already has source/category/severity, use them directly
  // Otherwise, classify from legacy type/action
  let source = event.source;
  let category = event.category;
  let severity = event.severity;

  if (!source || !category || !severity) {
    const cls = classifyLegacyEvent(event.type || '', event.action || '');
    source   = source   || cls.source;
    category = category || cls.category;
    severity = severity || cls.severity;
  }

  const entry = {
    t: now,
    source,
    category,
    severity,
    // Preserve all original fields
    who:    event.who,
    team:   event.team,
    type:   event.type || source,   // Keep legacy type for backwards compat
    action: event.action,
    detail: event.detail,
    target: event.target,
    x:      event.x,
    y:      event.y,
    // Extra data (optional)
    dmg:    event.dmg,
    acc:    event.acc
  };

  b._debugLog.push(entry);
}


// ── Filter API ───────────────────────────────────────────────

/**
 * Filter events from the battle log.
 *
 * @param {object} b - battle state
 * @param {object} filter - any combination of:
 *   source:   string or string[]
 *   category: string or string[]
 *   severity: string or string[]
 *   team:     string
 *   action:   string or string[]
 *   type:     string (legacy type field)
 *   since:    number (timestamp, only events after this)
 * @returns {Array} matching events
 */
export function filterEvents(b, filter = {}) {
  if (!b?._debugLog) return [];

  return b._debugLog.filter(ev => {
    if (filter.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      if (!sources.includes(ev.source)) return false;
    }
    if (filter.category) {
      const cats = Array.isArray(filter.category) ? filter.category : [filter.category];
      if (!cats.includes(ev.category)) return false;
    }
    if (filter.severity) {
      const sevs = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
      if (!sevs.includes(ev.severity)) return false;
    }
    if (filter.team && ev.team !== filter.team) return false;
    if (filter.action) {
      const actions = Array.isArray(filter.action) ? filter.action : [filter.action];
      if (!actions.includes(ev.action)) return false;
    }
    if (filter.type && ev.type !== filter.type) return false;
    if (filter.since && ev.t < filter.since) return false;
    return true;
  });
}

/**
 * Get the N most recent events matching a filter.
 *
 * @param {object} b - battle state
 * @param {object} filter - same as filterEvents
 * @param {number} count - max events to return
 * @returns {Array} matching events, most recent last
 */
export function getRecentEvents(b, filter = {}, count = 10) {
  const all = filterEvents(b, filter);
  return all.slice(-count);
}

/**
 * Count events matching a filter.
 */
export function countEvents(b, filter = {}) {
  return filterEvents(b, filter).length;
}
