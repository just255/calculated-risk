// sprite-editor/ui.js - UI rendering functions
// Single responsibility: Update DOM elements based on state

import { state } from './state.js';
import { OBJECT_CATEGORIES, getPartTypesForObject, formatPartTypeName } from './constants.js';

// DOM element cache
const elements = {};

// Initialize element cache
export function initUI() {
  elements.authOverlay = document.getElementById('authOverlay');
  elements.authPassword = document.getElementById('authPassword');
  elements.authError = document.getElementById('authError');
  elements.modeSelectOverlay = document.getElementById('modeSelectOverlay');
  elements.selectedObjectName = document.getElementById('selectedObjectName');
  elements.modeCardPart = document.getElementById('modeCardPart');
  elements.modeCardVariant = document.getElementById('modeCardVariant');
  elements.partTypeSection = document.getElementById('partTypeSection');
  elements.partTypeGrid = document.getElementById('partTypeGrid');
  elements.partSelectSection = document.getElementById('partSelectSection');
  elements.partSelectGrid = document.getElementById('partSelectGrid');
  elements.partSelectTitle = document.getElementById('partSelectTitle');
  elements.modeConfirmBtn = document.getElementById('modeConfirmBtn');
  elements.app = document.getElementById('app');
  elements.welcomeScreen = document.getElementById('welcomeScreen');
  elements.editorView = document.getElementById('editorView');
  elements.objectSelector = document.getElementById('objectSelector');
  elements.headerBreadcrumb = document.getElementById('headerBreadcrumb');
  elements.modeIndicator = document.getElementById('modeIndicator');
  elements.saveBtn = document.getElementById('saveBtn');
  elements.layerList = document.getElementById('layerList');
  elements.partsInUse = document.getElementById('partsInUse');
  elements.partLibrary = document.getElementById('partLibrary');
  elements.frameList = document.getElementById('frameList');
  elements.timelinePanel = document.getElementById('timelinePanel');
  elements.animationPreviewBar = document.getElementById('animationPreviewBar');
  elements.statusText = document.getElementById('statusText');
  elements.statusLayer = document.getElementById('statusLayer');
  elements.statusFrame = document.getElementById('statusFrame');
  elements.statusParts = document.getElementById('statusParts');
  elements.statusPos = document.getElementById('statusPos');
  elements.statusZoom = document.getElementById('statusZoom');
  elements.zoomDisplay = document.getElementById('zoomDisplay');
  elements.menuBar = document.getElementById('menuBar');
  elements.gridBtn = document.getElementById('gridBtn');
  elements.refBtn = document.getElementById('refBtn');
  elements.onionBtn = document.getElementById('onionBtn');
  elements.contextBtn = document.getElementById('contextBtn');
  elements.contextPartsList = document.getElementById('contextPartsList');
  elements.toggleAllContextBtn = document.getElementById('toggleAllContextBtn');
  elements.toggleAllLayersBtn = document.getElementById('toggleAllLayersBtn');
  elements.toggleAllPartsBtn = document.getElementById('toggleAllPartsBtn');
  elements.contextVariantSelect = document.getElementById('contextVariantSelect');
  elements.refImageSection = document.getElementById('refImageSection');
  elements.refOpacity = document.getElementById('refOpacity');
  elements.refOpacityNum = document.getElementById('refOpacityNum');
  elements.refScale = document.getElementById('refScale');
  elements.refScaleNum = document.getElementById('refScaleNum');
  elements.refX = document.getElementById('refX');
  elements.refY = document.getElementById('refY');
}

// Show/hide auth overlay
export function showAuthOverlay(show) {
  elements.authOverlay.classList.toggle('hidden', !show);
}

export function showAuthError() {
  elements.authError.style.display = 'block';
}

// Render object selector with categories
export function renderObjectSelector() {
  const container = elements.objectSelector;
  container.innerHTML = '';

  Object.entries(OBJECT_CATEGORIES).forEach(([categoryKey, category]) => {
    // Category header
    const header = document.createElement('div');
    header.style.cssText = 'width: 100%; text-align: center; margin-top: 15px; margin-bottom: 8px; color: var(--text-secondary); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px;';
    header.innerHTML = `<span style="margin-right: 6px;">${category.icon}</span>${category.label}`;
    container.appendChild(header);

    // Items in category
    const itemsRow = document.createElement('div');
    itemsRow.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; width: 100%;';

    category.items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'object-btn';
      const objectType = categoryKey === 'terrain' ? 'terrain' : 'unit';
      btn.innerHTML = `${item.name}`;
      btn.onclick = () => window.spriteEditor.selectObject(objectType, item.id, item.name);
      itemsRow.appendChild(btn);
    });

    container.appendChild(itemsRow);
  });
}

// Show mode selection overlay
export function showModeSelectOverlay(objectName) {
  elements.selectedObjectName.textContent = objectName;
  elements.modeSelectOverlay.classList.remove('hidden');
  resetModeSelection();
}

export function hideModeSelectOverlay() {
  elements.modeSelectOverlay.classList.add('hidden');
}

// Reset mode selection UI
export function resetModeSelection() {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  elements.partTypeSection.classList.add('hidden');
  elements.modeConfirmBtn.disabled = true;
}

// Update mode card selection
export function selectModeCard(mode) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  const card = mode === 'part-editor' ? elements.modeCardPart : elements.modeCardVariant;
  card.classList.add('selected');
}

// Show part type selection
export function showPartTypeSelection() {
  elements.partTypeSection.classList.remove('hidden');
  elements.partSelectSection.classList.add('hidden');
}

export function hidePartTypeSelection() {
  elements.partTypeSection.classList.add('hidden');
}

// Show part selection (existing parts + create new)
export function showPartSelectSection(partTypeName) {
  elements.partSelectTitle.textContent = `Select a ${partTypeName} to edit or create new`;
  elements.partSelectSection.classList.remove('hidden');
}

export function hidePartSelectSection() {
  elements.partSelectSection.classList.add('hidden');
}

// Render existing parts grid for selection
export function renderPartSelectGrid(existingParts, partTypeName, onSelectPart, onCreateNew) {
  const grid = elements.partSelectGrid;
  grid.innerHTML = '';

  // "Create New" card first
  const newCard = document.createElement('div');
  newCard.className = 'part-select-card create-new';
  newCard.innerHTML = `
    <div class="part-select-icon">+</div>
    <div class="part-select-name">Create New</div>
    <div class="part-select-desc">Start from scratch</div>
  `;
  newCard.onclick = () => {
    document.querySelectorAll('.part-select-card').forEach(c => c.classList.remove('selected'));
    newCard.classList.add('selected');
    onCreateNew();
  };
  grid.appendChild(newCard);

  // Existing parts
  existingParts.forEach(part => {
    const card = document.createElement('div');
    card.className = 'part-select-card';
    card.innerHTML = `
      <div class="part-select-preview">${part.thumbnail ? `<img src="${part.thumbnail}" alt="${part.name}">` : '📄'}</div>
      <div class="part-select-name">${part.name}</div>
      <div class="part-select-desc">${part.frameCount || 1} frame${(part.frameCount || 1) > 1 ? 's' : ''}</div>
    `;
    card.onclick = () => {
      document.querySelectorAll('.part-select-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      onSelectPart(part.id);
    };
    grid.appendChild(card);
  });
}

// Render part type grid
export function renderPartTypeGrid(objectId, objectType, onSelect) {
  const grid = elements.partTypeGrid;
  grid.innerHTML = '';

  const types = getPartTypesForObject(objectId, objectType);

  types.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'part-type-btn';
    btn.textContent = formatPartTypeName(type);
    btn.onclick = () => {
      document.querySelectorAll('.part-type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      onSelect(type, btn);
    };
    grid.appendChild(btn);
  });
}

// Enable/disable confirm button
export function setConfirmEnabled(enabled) {
  elements.modeConfirmBtn.disabled = !enabled;
}

// Enter editor view
export function enterEditorView(mode) {
  // Set mode class on app
  elements.app.classList.remove('mode-part-editor', 'mode-variant-builder');
  elements.app.classList.add(`mode-${mode}`);

  // Hide welcome, show editor and menu bar
  elements.welcomeScreen.classList.add('hidden');
  elements.menuBar.classList.remove('hidden');
  elements.editorView.style.display = 'flex';
  elements.editorView.classList.remove('hidden');

  // Show appropriate bottom panel
  if (mode === 'part-editor') {
    elements.timelinePanel.classList.remove('hidden');
    elements.animationPreviewBar.classList.add('hidden');
  } else {
    elements.timelinePanel.classList.add('hidden');
    elements.animationPreviewBar.classList.remove('hidden');
  }

  // Update mode indicator
  elements.modeIndicator.classList.remove('hidden', 'part-editor', 'variant-builder');
  elements.modeIndicator.classList.add(mode);
  elements.modeIndicator.textContent = mode === 'part-editor' ? 'Part Editor' : 'Variant Builder';

  // Show save button
  elements.saveBtn.classList.remove('hidden');
}

// Exit to welcome screen
export function exitToWelcomeScreen() {
  elements.editorView.style.display = 'none';
  elements.menuBar.classList.add('hidden');
  elements.welcomeScreen.classList.remove('hidden');
  elements.modeIndicator.classList.add('hidden');
  elements.saveBtn.classList.add('hidden');
  elements.headerBreadcrumb.innerHTML = '';
}

// Update header breadcrumb
export function updateBreadcrumb(objectName, partType, mode, editingPartName = null) {
  if (mode === 'part-editor') {
    const partTypeName = formatPartTypeName(partType);
    if (editingPartName) {
      elements.headerBreadcrumb.innerHTML = `<span>${objectName}</span> › ${partTypeName} › <span style="color: var(--accent-green);">${editingPartName}</span>`;
    } else {
      elements.headerBreadcrumb.innerHTML = `<span>${objectName}</span> › ${partTypeName} › <span style="color: var(--accent-orange);">New</span>`;
    }
  } else {
    elements.headerBreadcrumb.innerHTML = `<span>${objectName}</span> › New Variant`;
  }
}

// Generic list item renderer for layers, parts, context parts
function renderListItems(container, items, options = {}) {
  const {
    selectedId = null,
    selectedIds = null,  // Set of all selected IDs for multi-select
    onSelect = null,
    onToggleVisibility = null,
    getId = (item) => item.id,
    getName = (item) => item.name,
    getVisible = (item) => item.visible !== false,
    getOrder = null,
    getExtra = null,
    extraClass = null
  } = options;

  container.innerHTML = '';

  items.forEach((item, index) => {
    const itemEl = document.createElement('div');
    const id = getId(item, index);
    // Check if selected (primary or in multi-selection set)
    const isPrimary = selectedId !== null && id === selectedId;
    const isInSelection = selectedIds ? selectedIds.has(id) : isPrimary;
    const isVisible = getVisible(item);

    let className = 'layer-item';
    if (isPrimary) className += ' selected';
    else if (isInSelection) className += ' multi-selected';
    if (extraClass) {
      const extra = extraClass(item);
      if (extra) className += ' ' + extra;
    }
    itemEl.className = className;

    const name = getName(item);
    const order = getOrder ? getOrder(item, index) : null;
    const extra = getExtra ? getExtra(item) : '';

    // Use inline styles to guarantee visibility icon works
    const visStyle = isVisible
      ? 'color: #4ade80;'
      : 'opacity: 0.5; filter: grayscale(1);';

    itemEl.innerHTML = `
      <span class="layer-visibility" style="${visStyle}" data-index="${index}">👁</span>
      <span class="layer-name">${name}${extra}</span>
      ${order !== null ? `<span class="layer-order" title="Stack position (higher = on top)">${order}</span>` : ''}
    `;

    // Click on visibility icon toggles visibility
    if (onToggleVisibility) {
      const visSpan = itemEl.querySelector('.layer-visibility');
      visSpan.onclick = (e) => {
        e.stopPropagation();
        onToggleVisibility(id, index);
      };
    }

    // Click elsewhere selects (pass event for shift/ctrl multi-select)
    if (onSelect) {
      itemEl.onclick = (e) => onSelect(id, index, e);
    }

    container.appendChild(itemEl);
  });
}

// Render layer list
export function renderLayerList(layers, selectedLayerId, onSelect, onToggleVisibility) {
  const container = elements.layerList;
  if (!container) return;

  // Render in reverse order (top layer first)
  const reversedLayers = [...layers].reverse();

  renderListItems(container, reversedLayers, {
    selectedId: selectedLayerId,
    onSelect: (id) => onSelect(id),
    onToggleVisibility: (id) => onToggleVisibility(id),
    getId: (layer) => layer.id,
    getName: (layer) => layer.name,
    getVisible: (layer) => layer.visible,
    getOrder: (layer, idx) => layers.length - idx
  });

  // Update status
  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  elements.statusLayer.textContent = selectedLayer?.name || '-';
}

// Render frame list with optional thumbnails
export function renderFrameList(frames, currentFrame, onSelect, onAdd, generateThumbnail = null) {
  const container = elements.frameList;
  container.innerHTML = '';

  frames.forEach((frame, idx) => {
    const thumb = document.createElement('div');
    thumb.className = `frame-thumb${idx === currentFrame ? ' selected' : ''}`;

    // Generate thumbnail if generator provided
    if (generateThumbnail) {
      const thumbUrl = generateThumbnail(frame, 40);
      if (thumbUrl) {
        thumb.style.backgroundImage = `url(${thumbUrl})`;
        thumb.style.backgroundSize = 'contain';
        thumb.style.backgroundPosition = 'center';
        thumb.style.backgroundRepeat = 'no-repeat';
      }
    }

    // Frame number overlay
    const label = document.createElement('span');
    label.className = 'frame-number';
    label.textContent = idx + 1;
    thumb.appendChild(label);

    thumb.onclick = () => onSelect(idx);
    container.appendChild(thumb);
  });

  // Add frame button
  const addBtn = document.createElement('div');
  addBtn.className = 'frame-thumb add-frame';
  addBtn.textContent = '+';
  addBtn.onclick = onAdd;
  container.appendChild(addBtn);

  elements.statusFrame.textContent = `${currentFrame + 1}/${frames.length}`;
}

// Render parts in variant with hierarchy
export function renderPartsInUse(partsInVariant, selectedIndex, onSelect, onToggleVisibility, selectedIndices = null) {
  const container = elements.partsInUse;
  if (!container) return;

  container.innerHTML = '';

  // Build hierarchy tree
  const tree = buildPartTree(partsInVariant);

  // Render tree recursively
  renderPartTreeItems(container, tree, partsInVariant, {
    selectedIndex,
    selectedIndices,
    onSelect,
    onToggleVisibility,
    depth: 0
  });

  elements.statusParts.textContent = partsInVariant.length;
}

// Build a tree structure from flat parts list
function buildPartTree(partsInVariant) {
  // Find root parts (no parent)
  const roots = [];
  const childrenMap = new Map();  // parentIndex -> [childIndices]

  partsInVariant.forEach((part, index) => {
    if (part.parentIndex === null || part.parentIndex === undefined) {
      roots.push(index);
    } else {
      if (!childrenMap.has(part.parentIndex)) {
        childrenMap.set(part.parentIndex, []);
      }
      childrenMap.get(part.parentIndex).push(index);
    }
  });

  // Sort roots by zIndex (highest first)
  roots.sort((a, b) => (partsInVariant[b].zIndex || 0) - (partsInVariant[a].zIndex || 0));

  // Build tree nodes recursively
  function buildNode(index) {
    const children = childrenMap.get(index) || [];
    // Sort children by zIndex
    children.sort((a, b) => (partsInVariant[b].zIndex || 0) - (partsInVariant[a].zIndex || 0));
    return {
      index,
      children: children.map(buildNode)
    };
  }

  return roots.map(buildNode);
}

// Render tree items recursively
function renderPartTreeItems(container, nodes, partsInVariant, options) {
  const { selectedIndex, selectedIndices, onSelect, onToggleVisibility, depth } = options;

  nodes.forEach((node, nodeIdx) => {
    const index = node.index;
    const part = partsInVariant[index];
    const isLast = nodeIdx === nodes.length - 1;

    const itemEl = document.createElement('div');
    const isPrimary = selectedIndex !== null && index === selectedIndex;
    const isInSelection = selectedIndices ? selectedIndices.has(index) : isPrimary;
    const isVisible = part.visible !== false;
    const isAttached = part.parentIndex !== null && part.parentIndex !== undefined;

    let className = 'layer-item';
    if (isPrimary) className += ' selected';
    else if (isInSelection) className += ' multi-selected';
    itemEl.className = className;

    // Build indent prefix
    let indent = '';
    if (depth > 0) {
      // Add tree-style prefix
      indent = '│ '.repeat(depth - 1) + (isLast ? '└─' : '├─') + ' ';
    }

    // Visibility style
    const visStyle = isVisible
      ? 'color: #4ade80;'
      : 'opacity: 0.5; filter: grayscale(1);';

    // Attachment info
    let attachInfo = '';
    if (isAttached && part.attachedTo) {
      attachInfo = ` <span style="color: var(--text-muted); font-size: 0.75rem;">→ ${part.attachedTo}</span>`;
    }

    // Category badge
    let categoryBadge = '';
    if (part.category) {
      categoryBadge = ` <span style="background: var(--bg-tertiary); color: var(--text-muted); padding: 0 4px; border-radius: 3px; font-size: 0.7rem;">${part.category}</span>`;
    }

    itemEl.innerHTML = `
      <span class="layer-visibility" style="${visStyle}" data-index="${index}">👁</span>
      <span class="layer-name" style="font-family: monospace;"><span style="color: var(--text-muted);">${indent}</span>${part.name}${categoryBadge}${attachInfo}</span>
      <span class="layer-order" title="Stack position (higher = on top)">${(part.zIndex || 0) + 1}</span>
    `;

    // Click on visibility icon toggles visibility
    if (onToggleVisibility) {
      const visSpan = itemEl.querySelector('.layer-visibility');
      visSpan.onclick = (e) => {
        e.stopPropagation();
        onToggleVisibility(index);
      };
    }

    // Click on item selects it
    if (onSelect) {
      itemEl.onclick = (e) => {
        onSelect(index, e.shiftKey || false);
      };
    }

    container.appendChild(itemEl);

    // Render children recursively
    if (node.children.length > 0) {
      renderPartTreeItems(container, node.children, partsInVariant, {
        ...options,
        depth: depth + 1
      });
    }
  });
}

// Render part library for variant builder
export function renderPartLibrary(parts, onAddPart) {
  const container = elements.partLibrary;
  container.innerHTML = '';

  // Group parts by type
  const grouped = {};
  parts.forEach(part => {
    if (!grouped[part.partType]) grouped[part.partType] = [];
    grouped[part.partType].push(part);
  });

  Object.entries(grouped).forEach(([type, typeParts]) => {
    const group = document.createElement('div');
    group.className = 'tree-group expanded';
    group.innerHTML = `
      <div class="tree-group-header">
        <span class="tree-group-toggle"></span>
        <span class="tree-group-name">${formatPartTypeName(type)}</span>
        <span class="tree-group-count">(${typeParts.length})</span>
      </div>
      <div class="tree-items">
        ${typeParts.map(p => `
          <div class="tree-item" data-part-id="${p.id}">${p.name}</div>
        `).join('')}
      </div>
    `;

    // Add click handlers
    group.querySelector('.tree-group-header').onclick = () => group.classList.toggle('expanded');
    group.querySelectorAll('.tree-item').forEach(item => {
      item.onclick = () => onAddPart(item.dataset.partId);
    });

    container.appendChild(group);
  });

  if (parts.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 10px; font-size: 0.9rem;">No parts available. Create some in Part Editor first.</div>';
  }
}

// Render context parts list (ghost reference parts in Part Editor)
export function renderContextParts(contextParts, onToggleVisibility) {
  const container = elements.contextPartsList;
  if (!container) return;

  if (contextParts.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 10px; font-size: 0.85rem;">No other parts available for reference.</div>';
    return;
  }

  renderListItems(container, contextParts, {
    onToggleVisibility: (id, index) => onToggleVisibility && onToggleVisibility(index),
    getId: (part, index) => index,
    getName: (part) => formatPartTypeName(part.partType),
    getVisible: (part) => part.visible !== false,
    getExtra: (part) => part.isEditingPart ? ' <span style="color: var(--accent-orange); font-size: 0.7rem;">(editing)</span>' : '',
    extraClass: (part) => part.isEditingPart ? 'editing' : null
  });
}

// Update a toggle all button state based on list items visibility
// Three states: all visible (green), some hidden (green dimmed), all hidden (grey)
function updateToggleAllBtnState(btn, items, getVisible = (item) => item.visible !== false) {
  if (!btn || !items) return;

  const allVisible = items.length > 0 && items.every(item => getVisible(item));
  const allHidden = items.length > 0 && items.every(item => !getVisible(item));

  if (allHidden) {
    // All hidden - grey
    btn.style.color = '';
    btn.style.opacity = '0.5';
    btn.style.filter = 'grayscale(1)';
  } else if (allVisible) {
    // All visible - green full
    btn.style.color = '#4ade80';
    btn.style.opacity = '1';
    btn.style.filter = '';
  } else {
    // Mixed - green dimmed
    btn.style.color = '#4ade80';
    btn.style.opacity = '0.6';
    btn.style.filter = '';
  }
}

// Specific update functions for each panel
export function updateToggleAllContextBtn(contextParts) {
  updateToggleAllBtnState(elements.toggleAllContextBtn, contextParts);
}

export function updateToggleAllLayersBtn(layers) {
  updateToggleAllBtnState(elements.toggleAllLayersBtn, layers);
}

export function updateToggleAllPartsBtn(parts) {
  updateToggleAllBtnState(elements.toggleAllPartsBtn, parts);
}

// Populate context variant dropdown
export function populateContextVariantSelect(variants, selectedId) {
  const select = elements.contextVariantSelect;
  if (!select) return;

  select.innerHTML = '';

  variants.forEach(variant => {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.name;
    if (variant.id === selectedId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

// Update status bar
export function setStatus(text) {
  elements.statusText.textContent = text;
}

export function setMousePosition(x, y) {
  elements.statusPos.textContent = `${x}, ${y}`;
}

export function setZoomDisplay(percent) {
  elements.zoomDisplay.textContent = `${percent}%`;
  elements.statusZoom.textContent = `${percent}%`;
}

// Toggle button active states
export function setGridActive(active) {
  elements.gridBtn.classList.toggle('active', active);
}

export function setRefActive(active) {
  elements.refBtn.classList.toggle('active', active);
}

export function setOnionActive(active) {
  elements.onionBtn.classList.toggle('active', active);
}

export function setContextActive(active) {
  if (elements.contextBtn) {
    elements.contextBtn.classList.toggle('active', active);
  }
}

// Show/hide reference image controls
export function showRefImageControls(show) {
  if (elements.refImageSection) {
    elements.refImageSection.classList.toggle('hidden', !show);
  }
}

// Update reference image control values
export function updateRefImageControls(opacity, scale, x, y) {
  if (elements.refOpacity) elements.refOpacity.value = opacity;
  if (elements.refOpacityNum) elements.refOpacityNum.value = opacity;
  if (elements.refScale) elements.refScale.value = Math.min(scale, 500); // Slider max is 500
  if (elements.refScaleNum) elements.refScaleNum.value = scale;
  if (elements.refX) elements.refX.value = x;
  if (elements.refY) elements.refY.value = y;
}

// Update tool selection
export function setActiveTool(toolName) {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });
}

// Get password input value
export function getPasswordInput() {
  return elements.authPassword.value;
}

// Update UI scale menu indicator
export function updateScaleMenu(percent) {
  const label = document.getElementById('currentScaleLabel');
  if (label) label.textContent = `${percent}%`;

  const menu = document.getElementById('scaleMenu');
  if (menu) {
    menu.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('scale-active', btn.dataset.scale === String(percent));
    });
  }
}

// Context menu
let activeContextMenu = null;
let contextMenuJustOpened = false;

export function showContextMenu(x, y, items) {
  // Remove existing menu
  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.onclick = (e) => {
      e.stopPropagation();
      hideContextMenu();
      item.action();
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;
  contextMenuJustOpened = true;

  // Prevent immediate close from the click/mouseup that opened it
  // Use 300ms to handle long-press releases (500ms press + release)
  setTimeout(() => {
    contextMenuJustOpened = false;
  }, 300);

  // Close on click outside (but not on the menu itself)
  const closeHandler = (e) => {
    if (contextMenuJustOpened) return;
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('mouseup', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
    // Store handler for cleanup
    if (activeContextMenu) {
      activeContextMenu._closeHandler = closeHandler;
    }
  }, 50);

  // Adjust position if off screen
  requestAnimationFrame(() => {
    if (!menu.parentElement) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }
  });
}

export function hideContextMenu() {
  if (activeContextMenu) {
    if (activeContextMenu._closeHandler) {
      document.removeEventListener('click', activeContextMenu._closeHandler);
      document.removeEventListener('mouseup', activeContextMenu._closeHandler);
      document.removeEventListener('contextmenu', activeContextMenu._closeHandler);
    }
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// ===== Modular Input Components =====

/**
 * Create a number input group with +/- buttons
 * @param {Object} config
 * @param {string} config.id - Input element ID
 * @param {string} [config.label] - Optional label text
 * @param {number} [config.min] - Minimum value
 * @param {number} [config.max] - Maximum value
 * @param {number} [config.step=1] - Step for +/- buttons
 * @param {string} [config.unit] - Unit suffix (e.g., 'px', '%')
 * @param {number} [config.width=40] - Input width in pixels
 * @returns {HTMLElement} The container element
 */
export function createNumInputGroup(config) {
  const { id, label, min, max, step = 1, unit, width = 40 } = config;

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '4px';

  // Label
  if (label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'prop-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);
  }

  // Input group
  const group = document.createElement('div');
  group.className = 'num-input-group';

  // Minus button
  const minusBtn = document.createElement('button');
  minusBtn.className = 'num-btn';
  minusBtn.textContent = '−';
  minusBtn.dataset.input = id;
  minusBtn.dataset.delta = `-${step}`;
  if (min !== undefined) minusBtn.dataset.min = min;
  if (max !== undefined) minusBtn.dataset.max = max;
  group.appendChild(minusBtn);

  // Input
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'prop-input num-input';
  input.id = id;
  input.style.width = `${width}px`;
  group.appendChild(input);

  // Plus button
  const plusBtn = document.createElement('button');
  plusBtn.className = 'num-btn';
  plusBtn.textContent = '+';
  plusBtn.dataset.input = id;
  plusBtn.dataset.delta = String(step);
  if (min !== undefined) plusBtn.dataset.min = min;
  if (max !== undefined) plusBtn.dataset.max = max;
  group.appendChild(plusBtn);

  container.appendChild(group);

  // Unit suffix
  if (unit) {
    const unitEl = document.createElement('span');
    unitEl.className = 'prop-unit';
    unitEl.textContent = unit;
    container.appendChild(unitEl);
  }

  return container;
}

/**
 * Create a row with X and Y number inputs
 * @param {Object} config
 * @param {string} config.xId - X input element ID
 * @param {string} config.yId - Y input element ID
 * @param {number} [config.min] - Minimum value
 * @param {number} [config.max] - Maximum value
 * @param {number} [config.step=1] - Step for +/- buttons
 * @returns {HTMLElement} The row element
 */
export function createXYInputRow(config) {
  const { xId, yId, min, max, step = 1 } = config;

  const row = document.createElement('div');
  row.className = 'prop-row';

  // X input
  const xGroup = createNumInputGroup({ id: xId, label: 'X', min, max, step });
  row.appendChild(xGroup);

  // Y input (with left margin)
  const yGroup = createNumInputGroup({ id: yId, label: 'Y', min, max, step });
  yGroup.style.marginLeft = '8px';
  row.appendChild(yGroup);

  return row;
}
