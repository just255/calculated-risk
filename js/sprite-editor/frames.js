// sprite-editor/frames.js - Animation frame management
// Single responsibility: Manage animation frames for Part Editor

import { state } from './state.js';

// Save current frame's layers
export function saveCurrentFrame() {
  state.frames[state.currentFrame].layers = JSON.parse(JSON.stringify(state.layers));
}

// Load a frame's layers
export function loadFrame(frameIndex) {
  if (frameIndex >= 0 && frameIndex < state.frames.length) {
    state.layers = JSON.parse(JSON.stringify(state.frames[frameIndex].layers));
    state.selectedLayerId = state.layers[0]?.id || null;
  }
}

// Select a frame (saves current, loads new)
export function selectFrame(frameIndex) {
  saveCurrentFrame();
  state.currentFrame = frameIndex;
  loadFrame(frameIndex);
}

// Add a new frame (copy of current)
export function addFrame() {
  saveCurrentFrame();
  const newFrame = {
    layers: JSON.parse(JSON.stringify(state.layers))
  };
  state.frames.push(newFrame);
  state.currentFrame = state.frames.length - 1;
  return state.currentFrame;
}

// Delete current frame
export function deleteFrame() {
  if (state.frames.length <= 1) {
    return false; // Cannot delete the last frame
  }
  state.frames.splice(state.currentFrame, 1);
  state.currentFrame = Math.min(state.currentFrame, state.frames.length - 1);
  loadFrame(state.currentFrame);
  return true;
}

// Duplicate current frame
export function duplicateFrame() {
  saveCurrentFrame();
  const newFrame = {
    layers: JSON.parse(JSON.stringify(state.frames[state.currentFrame].layers))
  };
  state.frames.splice(state.currentFrame + 1, 0, newFrame);
  state.currentFrame++;
  return state.currentFrame;
}

// Go to previous frame
export function prevFrame() {
  if (state.currentFrame > 0) {
    selectFrame(state.currentFrame - 1);
    return true;
  }
  return false;
}

// Go to next frame
export function nextFrame() {
  if (state.currentFrame < state.frames.length - 1) {
    selectFrame(state.currentFrame + 1);
    return true;
  }
  return false;
}

// Get frame count
export function getFrameCount() {
  return state.frames.length;
}

// Get current frame index
export function getCurrentFrameIndex() {
  return state.currentFrame;
}

// Animation playback state
let playbackTimer = null;
let onFrameChange = null;

// Set callback for frame changes (used to trigger re-render)
export function setFrameChangeCallback(callback) {
  onFrameChange = callback;
}

// Start playback
export function startPlayback() {
  if (playbackTimer) return; // Already playing

  state.isPlaying = true;
  const interval = 1000 / state.fps;

  playbackTimer = setInterval(() => {
    // Advance to next frame
    if (state.currentFrame < state.frames.length - 1) {
      selectFrame(state.currentFrame + 1);
    } else {
      // Loop back to start (or stop if no loop)
      selectFrame(0);
    }

    // Trigger callback to update UI
    if (onFrameChange) {
      onFrameChange();
    }
  }, interval);
}

// Stop playback
export function stopPlayback() {
  if (playbackTimer) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  state.isPlaying = false;
}

// Toggle playback
export function togglePlayback() {
  if (state.isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
  return state.isPlaying;
}

// Update playback speed (call when FPS changes)
export function updatePlaybackSpeed() {
  if (state.isPlaying) {
    stopPlayback();
    startPlayback();
  }
}
