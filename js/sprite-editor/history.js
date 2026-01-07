// sprite-editor/history.js - Undo/Redo history management
// Single responsibility: Track and restore editor state history

import { state, markDirty } from './state.js';
import { getSelectionState, setSelectionState } from './selection.js';
import { getSelectedPartIndices, restorePartSelection } from './variants.js';

const MAX_HISTORY = 50;

// Save current state to history (call BEFORE making changes)
export function saveHistory() {
  // Get current part selection state
  const partSelectionIndices = [...getSelectedPartIndices()];
  const primaryPartIndex = state.selectedPartInVariant;

  // If this is the first save, just save the initial state
  if (state.history.length === 0) {
    state.history.push({
      layers: JSON.parse(JSON.stringify(state.layers)),
      frames: JSON.parse(JSON.stringify(state.frames)),
      partsInVariant: JSON.parse(JSON.stringify(state.partsInVariant)),
      partSelectionIndices,
      primaryPartIndex,
      selection: getSelectionState(),
      // Snap point system
      snapPoints: JSON.parse(JSON.stringify(state.snapPoints || [])),
      partCategory: state.partCategory
    });
    state.historyIndex = 0;
    return;
  }

  // Mark as dirty since a change is being made
  markDirty();

  // Remove future history if we're not at the end
  state.history = state.history.slice(0, state.historyIndex + 1);

  // Save current state
  state.history.push({
    layers: JSON.parse(JSON.stringify(state.layers)),
    frames: JSON.parse(JSON.stringify(state.frames)),
    partsInVariant: JSON.parse(JSON.stringify(state.partsInVariant)),
    partSelectionIndices,
    primaryPartIndex,
    selection: getSelectionState(),
    // Snap point system
    snapPoints: JSON.parse(JSON.stringify(state.snapPoints || [])),
    partCategory: state.partCategory
  });

  state.historyIndex = state.history.length - 1;

  // Limit history size
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
    state.historyIndex--;
  }
}

// Undo last action
export function undo() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    restoreHistory();
    return true;
  }
  return false;
}

// Redo last undone action
export function redo() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    restoreHistory();
    return true;
  }
  return false;
}

// Restore state from history
function restoreHistory() {
  const snapshot = state.history[state.historyIndex];
  state.layers = JSON.parse(JSON.stringify(snapshot.layers));
  state.frames = JSON.parse(JSON.stringify(snapshot.frames));
  state.partsInVariant = JSON.parse(JSON.stringify(snapshot.partsInVariant));
  setSelectionState(snapshot.selection);

  // Restore snap point system
  if (snapshot.snapPoints !== undefined) {
    state.snapPoints = JSON.parse(JSON.stringify(snapshot.snapPoints));
    state.selectedSnapPointId = null; // Clear selection on undo
  }
  if (snapshot.partCategory !== undefined) {
    state.partCategory = snapshot.partCategory;
  }

  // Restore variant builder part selection
  if (snapshot.partSelectionIndices !== undefined) {
    restorePartSelection(snapshot.partSelectionIndices, snapshot.primaryPartIndex);
  }
}

// Check if can undo
export function canUndo() {
  return state.historyIndex > 0;
}

// Check if can redo
export function canRedo() {
  return state.historyIndex < state.history.length - 1;
}

// Clear history
export function clearHistory() {
  state.history = [];
  state.historyIndex = -1;
}
