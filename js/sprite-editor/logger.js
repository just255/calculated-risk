// sprite-editor/logger.js - Client-side logging with localStorage persistence
// Single responsibility: Log operations and store for later retrieval

const STORAGE_KEY = 'spriteEditorLogs';
const MAX_ENTRIES = 500;

// Log levels
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

// Log categories
export const LogCategory = {
  SELECTION: 'selection',
  TOOLS: 'tools',
  CANVAS: 'canvas',
  LAYERS: 'layers',
  STATE: 'state',
  IO: 'io',
  GENERAL: 'general'
};

// In-memory log buffer
let logBuffer = [];

// Configuration
let config = {
  enabled: true,
  consoleOutput: true,
  persistToStorage: true,
  minLevel: LogLevel.DEBUG
};

// Load existing logs from localStorage
function loadLogs() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      logBuffer = JSON.parse(stored);
    }
  } catch (e) {
    logBuffer = [];
  }
}

// Save logs to localStorage
function saveLogs() {
  if (!config.persistToStorage) return;
  try {
    // Keep only last MAX_ENTRIES
    if (logBuffer.length > MAX_ENTRIES) {
      logBuffer = logBuffer.slice(-MAX_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logBuffer));
  } catch (e) {
    console.warn('[LOGGER] Failed to save to localStorage:', e.message);
  }
}

// Initialize
loadLogs();

// Configure logger
export function configure(options) {
  config = { ...config, ...options };
}

// Main log function
export function log(category, level, message, data = null) {
  if (!config.enabled) return;

  const entry = {
    ts: new Date().toISOString(),
    cat: category,
    lvl: level,
    msg: message,
    data
  };

  // Add to buffer
  logBuffer.push(entry);
  saveLogs();

  // Console output
  if (config.consoleOutput) {
    const prefix = `[${category.toUpperCase()}]`;
    switch (level) {
      case LogLevel.ERROR:
        console.error(prefix, message, data || '');
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, data || '');
        break;
      case LogLevel.INFO:
        console.info(prefix, message, data || '');
        break;
      default:
        console.log(prefix, message, data || '');
    }
  }

  return entry;
}

// Convenience methods
export function debug(category, message, data) {
  return log(category, LogLevel.DEBUG, message, data);
}

export function info(category, message, data) {
  return log(category, LogLevel.INFO, message, data);
}

export function warn(category, message, data) {
  return log(category, LogLevel.WARN, message, data);
}

export function error(category, message, data) {
  return log(category, LogLevel.ERROR, message, data);
}

// Category-specific convenience methods
export function logSelection(operation, data) {
  return log(LogCategory.SELECTION, LogLevel.DEBUG, operation, data);
}

export function logTool(operation, data) {
  return log(LogCategory.TOOLS, LogLevel.DEBUG, operation, data);
}

export function logCanvas(operation, data) {
  return log(LogCategory.CANVAS, LogLevel.DEBUG, operation, data);
}

export function logIO(operation, data) {
  return log(LogCategory.IO, LogLevel.INFO, operation, data);
}

// Get all logs
export function getLogs() {
  return [...logBuffer];
}

// Get logs filtered by category
export function getLogsByCategory(category) {
  return logBuffer.filter(e => e.cat === category);
}

// Clear all logs
export function clearLogs() {
  logBuffer = [];
  localStorage.removeItem(STORAGE_KEY);
}

// Download logs as JSON file
export function downloadLogs() {
  const json = JSON.stringify(logBuffer, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sprite-editor-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Format logs as readable text
export function formatLogs() {
  return logBuffer.map(e =>
    `[${e.ts}] [${e.cat.toUpperCase()}] [${e.lvl}] ${e.msg}${e.data ? ' | ' + JSON.stringify(e.data) : ''}`
  ).join('\n');
}

// Export for window access
if (typeof window !== 'undefined') {
  window.spriteEditorLogger = {
    log, debug, info, warn, error,
    logSelection, logTool, logCanvas, logIO,
    configure, getLogs, getLogsByCategory, clearLogs,
    downloadLogs, formatLogs,
    LogLevel, LogCategory
  };
}
