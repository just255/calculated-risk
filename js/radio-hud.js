// ═══════════════════════════════════════════════════════════════
// RADIO HUD — Military field radio with message display
// Positioned bottom-right during battle. Shows command objectives
// and squad/commander communications.
// ═══════════════════════════════════════════════════════════════

import { logEvent } from './battle-log.js';

let _radioEl = null;
let _expanded = false;
let _messages = [];
let _objective = '';
const MAX_MESSAGES = 50;

// ── SVG Radio Body ──────────────────────────────────────────

const RADIO_SVG = `
<svg viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg" class="radio-svg">
  <defs>
    <linearGradient id="radio-body-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#353d2a"/>
      <stop offset="50%" stop-color="#272e1e"/>
      <stop offset="100%" stop-color="#1a2014"/>
    </linearGradient>
    <linearGradient id="screen-bezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0e1408"/>
      <stop offset="100%" stop-color="#060a04"/>
    </linearGradient>
    <filter id="led-glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Body -->
  <rect x="2" y="2" width="276" height="216" rx="8" fill="url(#radio-body-grad)" stroke="#1a2014" stroke-width="2"/>

  <!-- Antenna -->
  <rect x="16" y="8" width="8" height="80" rx="2" fill="#3a4030" stroke="#2e3524" stroke-width="1"/>
  <rect x="18" y="4" width="4" height="12" rx="1" fill="#4a5040"/>
  <circle cx="20" cy="4" r="3" fill="#5a6050"/>

  <!-- Screen bezel -->
  <rect x="38" y="8" width="230" height="160" rx="4" fill="url(#screen-bezel)" stroke="#0a0e06" stroke-width="2"/>

  <!-- Knobs -->
  <circle cx="18" cy="110" r="10" fill="#3a4030" stroke="#2e3524" stroke-width="1.5"/>
  <line x1="18" y1="102" x2="18" y2="106" stroke="#5a6550" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="18" cy="140" r="8" fill="#343a2c" stroke="#282e20" stroke-width="1.5"/>
  <line x1="18" y1="133" x2="18" y2="136" stroke="#505a48" stroke-width="1.5" stroke-linecap="round"/>

  <!-- LEDs -->
  <circle cx="50" cy="180" r="4" class="radio-led-tx" filter="url(#led-glow)"/>
  <text x="50" y="195" text-anchor="middle" fill="#4a5540" font-size="8" font-family="Oxanium">TX</text>
  <circle cx="80" cy="180" r="4" class="radio-led-rx" filter="url(#led-glow)"/>
  <text x="80" y="195" text-anchor="middle" fill="#4a5540" font-size="8" font-family="Oxanium">RX</text>
  <circle cx="110" cy="180" r="4" class="radio-led-pwr" filter="url(#led-glow)"/>
  <text x="110" y="195" text-anchor="middle" fill="#4a5540" font-size="8" font-family="Oxanium">PWR</text>

  <!-- Speaker grill -->
  ${Array.from({length: 6}, (_, i) =>
    `<line x1="140" y1="${176 + i * 6}" x2="260" y2="${176 + i * 6}" stroke="#1a2014" stroke-width="1.5" stroke-linecap="round"/>`
  ).join('')}
</svg>
`;

// ── Create / Destroy ────────────────────────────────────────

export function createRadioHUD() {
  if (_radioEl) return;

  _radioEl = document.createElement('div');
  _radioEl.className = 'radio-hud';
  _radioEl.innerHTML = `
    <div class="radio-body">
      ${RADIO_SVG}
      <div class="radio-screen">
        <div class="radio-objective">
          <span class="radio-obj-label">OBJ:</span>
          <span class="radio-obj-text">Awaiting orders...</span>
        </div>
        <div class="radio-separator"></div>
        <div class="radio-comms" data-action="radio-expand">
          <div class="radio-comms-scroll"></div>
        </div>
      </div>
      <div class="radio-scanlines"></div>
    </div>
  `;

  document.body.appendChild(_radioEl);

  // Expand/collapse on click
  _radioEl.querySelector('.radio-comms').addEventListener('click', () => {
    _expanded = !_expanded;
    _radioEl.classList.toggle('expanded', _expanded);
  });

  _messages = [];
  _objective = 'Awaiting orders...';
}

export function destroyRadioHUD() {
  if (_radioEl) {
    _radioEl.remove();
    _radioEl = null;
  }
  _messages = [];
  _expanded = false;
}

// ── Message API ─────────────────────────────────────────────

/**
 * Send a radio message.
 * @param {object} msg - { sender, rank, name, text, priority, time }
 *   sender: 'cmd' | 'sgt' | 'unit' | 'intel'
 *   priority: 'normal' | 'urgent' | 'critical'
 */
export function radioMessage(msg) {
  if (!_radioEl) return;

  const entry = {
    sender: msg.sender || 'cmd',
    rank: msg.rank || '',
    name: msg.name || 'HQ',
    text: msg.text || '',
    priority: msg.priority || 'normal',
    time: msg.time || Date.now()
  };

  _messages.push(entry);
  if (_messages.length > MAX_MESSAGES) _messages.shift();

  _renderComms();
  _flashTX(entry.priority);
}

/**
 * Set the current objective text.
 */
export function setRadioObjective(text) {
  _objective = text;
  if (!_radioEl) return;
  const objText = _radioEl.querySelector('.radio-obj-text');
  if (objText) objText.textContent = text;
}

/**
 * Get all radio messages (for replay/debug).
 */
export function getRadioMessages() {
  return [..._messages];
}

/**
 * Enlarge/restore the radio for cinematic focus.
 * @param {boolean} focused - true to enlarge, false to restore
 */
export function setRadioFocus(focused) {
  if (!_radioEl) return;
  _radioEl.classList.toggle('focused', focused);
}

// ── Rendering ───────────────────────────────────────────────

function _renderComms() {
  if (!_radioEl) return;
  const scroll = _radioEl.querySelector('.radio-comms-scroll');
  if (!scroll) return;

  // Show last N messages based on expanded state
  const visible = _expanded ? _messages : _messages.slice(-2);

  scroll.innerHTML = visible.map(m => {
    const priorityClass = m.priority === 'urgent' ? 'msg-urgent'
      : m.priority === 'critical' ? 'msg-critical' : '';
    const label = _formatSender(m);
    const timeStr = _formatTime(m.time);
    return `
      <div class="radio-msg ${priorityClass}">
        <div class="radio-msg-header">
          <span class="radio-msg-sender">${label}</span>
          <span class="radio-msg-time">${timeStr}</span>
        </div>
        <div class="radio-msg-text">${m.text}</div>
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
  scroll.scrollTop = scroll.scrollHeight;
}

function _formatSender(msg) {
  const tag = msg.sender === 'cmd' ? 'CMD'
    : msg.sender === 'sgt' ? 'SGT'
    : msg.sender === 'intel' ? 'INTEL'
    : 'UNIT';
  const name = msg.rank ? `${msg.rank} ${msg.name}` : msg.name;
  return `[${tag}] ${name}`;
}

function _formatTime(timestamp) {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function _flashTX(priority) {
  if (!_radioEl) return;
  const tx = _radioEl.querySelector('.radio-led-tx');
  if (!tx) return;

  tx.classList.add('flashing');
  if (priority === 'critical') tx.classList.add('flash-critical');
  else if (priority === 'urgent') tx.classList.add('flash-urgent');

  setTimeout(() => {
    tx.classList.remove('flashing', 'flash-critical', 'flash-urgent');
  }, 600);
}
