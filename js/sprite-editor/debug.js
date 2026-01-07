// sprite-editor/debug.js - Debug console module
// Single responsibility: Capture and display debug logs

const MAX_LOGS = 500;
const logs = [];
let isVisible = false;
let containerEl = null;
let contentEl = null;

// Log levels with colors
const LOG_LEVELS = {
  log: { label: 'LOG', color: '#888' },
  info: { label: 'INFO', color: '#3b82f6' },
  warn: { label: 'WARN', color: '#f59e0b' },
  error: { label: 'ERROR', color: '#ef4444' },
  debug: { label: 'DEBUG', color: '#8b5cf6' }
};

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

// Format a value for display
function formatValue(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val, null, 2);
    } catch (e) {
      return String(val);
    }
  }
  return String(val);
}

// Add a log entry
function addLog(level, args) {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });

  const message = Array.from(args).map(formatValue).join(' ');

  const entry = {
    timestamp,
    level,
    message
  };

  logs.push(entry);

  // Trim old logs
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  // Update UI if visible
  if (isVisible && contentEl) {
    appendLogToUI(entry);
  }
}

// Append a single log entry to the UI
function appendLogToUI(entry) {
  const levelInfo = LOG_LEVELS[entry.level] || LOG_LEVELS.log;

  const line = document.createElement('div');
  line.className = `debug-line debug-${entry.level}`;
  line.innerHTML = `<span class="debug-time">${entry.timestamp}</span>` +
    `<span class="debug-level" style="color:${levelInfo.color}">[${levelInfo.label}]</span>` +
    `<span class="debug-msg">${escapeHtml(entry.message)}</span>`;

  contentEl.appendChild(line);

  // Auto-scroll to bottom
  contentEl.scrollTop = contentEl.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Render all logs to UI
function renderLogs() {
  if (!contentEl) return;

  contentEl.innerHTML = '';
  logs.forEach(entry => appendLogToUI(entry));
}

// Initialize the debug console
export function init() {
  // Intercept console methods
  Object.keys(LOG_LEVELS).forEach(level => {
    console[level] = (...args) => {
      // Call original
      originalConsole[level](...args);
      // Capture to our log
      addLog(level, args);
    };
  });

  // Get DOM elements
  containerEl = document.getElementById('debugConsole');
  contentEl = document.getElementById('debugContent');

  // Log initialization
  console.info('Debug console initialized');
}

// Toggle visibility
export function toggle() {
  isVisible = !isVisible;

  if (containerEl) {
    containerEl.classList.toggle('hidden', !isVisible);
  }

  if (isVisible) {
    renderLogs();
  }

  return isVisible;
}

// Show the console
export function show() {
  isVisible = true;
  if (containerEl) {
    containerEl.classList.remove('hidden');
  }
  renderLogs();
}

// Hide the console
export function hide() {
  isVisible = false;
  if (containerEl) {
    containerEl.classList.add('hidden');
  }
}

// Clear all logs
export function clear() {
  logs.length = 0;
  if (contentEl) {
    contentEl.innerHTML = '';
  }
  console.info('Debug console cleared');
}

// Copy logs to clipboard
export function copyLogs() {
  const text = logs.map(e => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`).join('\n');

  navigator.clipboard.writeText(text).then(() => {
    console.info(`Copied ${logs.length} log entries to clipboard`);
  }).catch(err => {
    console.error('Failed to copy logs:', err);
  });
}

// Get current visibility state
export function isOpen() {
  return isVisible;
}

// Manually log a message (bypasses console interception)
export function log(level, ...args) {
  addLog(level, args);
  originalConsole[level]?.(...args);
}
