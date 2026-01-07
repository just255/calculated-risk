// sprite-editor/layers.js - Layer management for Part Editor
// Single responsibility: Create, modify, and manage drawing layers

import { state } from './state.js';

// Create a new layer
export function createLayer(name = null) {
  const id = `layer-${Date.now()}`;
  return {
    id,
    name: name || `Layer ${state.layers.length + 1}`,
    visible: true,
    opacity: 100,
    blend: 'normal',
    shapes: []
  };
}

// Initialize with default layer
export function initLayers() {
  const layer = createLayer('Layer 1');
  state.layers = [layer];
  state.selectedLayerId = layer.id;
  state.frames = [{ layers: JSON.parse(JSON.stringify(state.layers)) }];
  state.currentFrame = 0;
}

// Add a new layer
export function addLayer() {
  const layer = createLayer();
  state.layers.push(layer);
  state.selectedLayerId = layer.id;
  return layer;
}

// Select a layer
export function selectLayer(layerId) {
  state.selectedLayerId = layerId;
}

// Get selected layer
export function getSelectedLayer() {
  return state.layers.find(l => l.id === state.selectedLayerId);
}

// Toggle layer visibility
export function toggleLayerVisibility(layerId) {
  const layer = state.layers.find(l => l.id === layerId);
  if (layer) {
    layer.visible = !layer.visible;
  }
  return layer;
}

// Update layer properties
export function updateLayerProperty(layerId, property, value) {
  const layer = state.layers.find(l => l.id === layerId);
  if (layer && property in layer) {
    layer[property] = value;
  }
  return layer;
}

// Move layer up (toward front)
export function moveLayerUp() {
  const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
  if (idx < state.layers.length - 1) {
    [state.layers[idx], state.layers[idx + 1]] = [state.layers[idx + 1], state.layers[idx]];
    return true;
  }
  return false;
}

// Move layer down (toward back)
export function moveLayerDown() {
  const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
  if (idx > 0) {
    [state.layers[idx], state.layers[idx - 1]] = [state.layers[idx - 1], state.layers[idx]];
    return true;
  }
  return false;
}

// Duplicate layer
export function duplicateLayer() {
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (layer) {
    const newLayer = JSON.parse(JSON.stringify(layer));
    newLayer.id = `layer-${Date.now()}`;
    newLayer.name = `${layer.name} copy`;
    const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
    state.layers.splice(idx + 1, 0, newLayer);
    return newLayer;
  }
  return null;
}

// Delete layer
export function deleteLayer() {
  if (state.layers.length <= 1) {
    return false; // Cannot delete the last layer
  }
  const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
  state.layers.splice(idx, 1);
  state.selectedLayerId = state.layers[Math.min(idx, state.layers.length - 1)].id;
  return true;
}

// Add shape to current layer
export function addShapeToLayer(shape) {
  const layer = getSelectedLayer();
  if (layer) {
    layer.shapes.push(shape);
  }
}
