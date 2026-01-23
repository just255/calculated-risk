const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Password for editor access (same as main app)
const ACCESS_PASSWORD = 'simmons1986';

// JSON body parsing for API
app.use(express.json({ limit: '10mb' }));

// Serve static files from current directory
app.use(express.static(__dirname));

// ===== SPRITE EDITOR API =====

const VARIANTS_DIR = path.join(__dirname, 'data', 'variants');
const VARIANTS_INDEX = path.join(VARIANTS_DIR, 'index.json');

// Ensure data directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Load variants index
function loadIndex() {
  ensureDir(VARIANTS_DIR);
  if (!fs.existsSync(VARIANTS_INDEX)) {
    fs.writeFileSync(VARIANTS_INDEX, JSON.stringify({ variants: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(VARIANTS_INDEX, 'utf8'));
}

// Save variants index
function saveIndex(index) {
  fs.writeFileSync(VARIANTS_INDEX, JSON.stringify(index, null, 2));
}

// POST /api/editor/auth - Verify password
app.post('/api/editor/auth', (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// ===== DEBUG API =====
const DEBUG_DIR = path.join(__dirname, 'data', 'debug');

// POST /api/debug/lasso - Save lasso debug data
app.post('/api/debug/lasso', (req, res) => {
  try {
    ensureDir(DEBUG_DIR);
    const debugFile = path.join(DEBUG_DIR, 'lasso-debug.json');
    fs.writeFileSync(debugFile, JSON.stringify(req.body, null, 2));
    console.log('Saved lasso debug data to', debugFile);
    res.json({ success: true, path: debugFile });
  } catch (err) {
    console.error('Failed to save debug data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/debug/log - Append log entry to rolling log file
app.post('/api/debug/log', (req, res) => {
  try {
    ensureDir(DEBUG_DIR);
    const logFile = path.join(DEBUG_DIR, 'sprite-editor.log');
    const entry = req.body;

    // Format: [timestamp] [CATEGORY] [level] message | data
    const line = `[${entry.timestamp}] [${entry.category?.toUpperCase() || 'GENERAL'}] [${entry.level || 'info'}] ${entry.message}${entry.data ? ' | ' + JSON.stringify(entry.data) : ''}\n`;

    fs.appendFileSync(logFile, line);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/debug/log - Read recent log entries
app.get('/api/debug/log', (req, res) => {
  try {
    const logFile = path.join(DEBUG_DIR, 'sprite-editor.log');
    if (!fs.existsSync(logFile)) {
      return res.json({ lines: [] });
    }
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    // Return last 100 lines by default
    const limit = parseInt(req.query.limit) || 100;
    res.json({ lines: lines.slice(-limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/debug/log - Clear log file
app.delete('/api/debug/log', (req, res) => {
  try {
    const logFile = path.join(DEBUG_DIR, 'sprite-editor.log');
    if (fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, '');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Shared object definitions
const gameObjects = {
  units: [
    { id: 'infantry', name: 'Infantry', parts: ['helmet', 'body', 'weapon', 'boots'] },
    { id: 'medic', name: 'Medic', parts: ['helmet', 'body', 'equipment', 'boots'] },
    { id: 'specops', name: 'Spec Ops', parts: ['helmet', 'body', 'weapon', 'boots'] },
    { id: 'stinger', name: 'Stinger', parts: ['helmet', 'body', 'launcher', 'boots'] },
    { id: 'jeep', name: 'Jeep', parts: ['chassis', 'wheels', 'turret'] },
    { id: 'humvee', name: 'Humvee', parts: ['chassis', 'wheels', 'turret', 'armor'] },
    { id: 'sherman', name: 'Sherman', parts: ['hull', 'turret', 'tracks', 'details'] },
    { id: 'tiger', name: 'Tiger', parts: ['hull', 'turret', 'tracks', 'details'] },
    { id: 'abrams', name: 'M1 Abrams', parts: ['hull', 'turret', 'tracks', 'details'] },
    { id: 'howitzer', name: 'Howitzer', parts: ['base', 'barrel', 'wheels'] },
    { id: 'drone', name: 'Drone', parts: ['body', 'rotors', 'camera'] },
    { id: 'helicopter', name: 'Helicopter', parts: ['fuselage', 'rotor', 'tail', 'weapons'] }
  ],
  terrain: [
    { id: 'open', name: 'Open Ground' },
    { id: 'grass', name: 'Grass' },
    { id: 'brush', name: 'Brush' },
    { id: 'forest', name: 'Forest' },
    { id: 'high', name: 'High Ground' },
    { id: 'water', name: 'Water' },
    { id: 'trench', name: 'Trench' },
    { id: 'pillbox', name: 'Pillbox' }
  ]
};

// GET /api/objects - List game objects (units, terrain)
app.get('/api/objects', (req, res) => {
  res.json(gameObjects);
});

// GET /api/terrain - List all terrain types
app.get('/api/terrain', (req, res) => {
  res.json(gameObjects.terrain);
});

// GET /api/terrain/sprites - List available terrain sprite files
app.get('/api/terrain/sprites', (req, res) => {
  const treesDir = path.join(__dirname, 'sprites', 'terrain', 'trees');
  const brushDir = path.join(__dirname, 'sprites', 'terrain', 'brush');
  const groundDir = path.join(__dirname, 'sprites', 'terrain', 'ground');

  const result = {
    trees: {},
    brush: {},
    ground: []
  };

  // Scan ground textures
  if (fs.existsSync(groundDir)) {
    fs.readdirSync(groundDir)
      .filter(f => f.endsWith('.png'))
      .forEach(f => {
        const name = f.replace('.png', '').replace('terrain-', '');
        result.ground.push(name);
      });
  }

  // Scan tree sprites from resized/{type}/ folders
  const treeResizedDir = path.join(treesDir, 'resized');
  if (fs.existsSync(treeResizedDir)) {
    const treeTypes = ['oak', 'pine', 'birch', 'willow'];
    treeTypes.forEach(type => {
      const typeDir = path.join(treeResizedDir, type);
      if (fs.existsSync(typeDir)) {
        fs.readdirSync(typeDir)
          .filter(f => f.endsWith('.png'))
          .forEach(f => {
            // Format: oak-young-1.png -> key: oak-young-1
            const key = f.replace('.png', '');
            result.trees[key] = `/sprites/terrain/trees/resized/${type}/${f}`;
          });
      }
    });
  }

  // Scan brush sprites from resized/ folder
  const brushResizedDir = path.join(brushDir, 'resized');
  console.log('[API] Brush resized dir:', brushResizedDir, 'exists:', fs.existsSync(brushResizedDir));
  if (fs.existsSync(brushResizedDir)) {
    const files = fs.readdirSync(brushResizedDir).filter(f => f.endsWith('.png'));
    console.log('[API] Brush files found:', files);
    files.forEach(f => {
        // Format: bush-small-1.png -> key: bush-small-1
        const key = f.replace('.png', '');
        result.brush[key] = `/sprites/terrain/brush/resized/${f}`;
      });
  }

  res.json(result);
});

// GET /api/objects/:type/:id/variants - List variants for an object
app.get('/api/objects/:type/:id/variants', (req, res) => {
  const { type, id } = req.params;
  const index = loadIndex();
  const variants = index.variants.filter(
    v => v.objectType === type && v.objectId === id && !v.archived
  );
  res.json({ variants });
});

// GET /api/variants - List all variants
app.get('/api/variants', (req, res) => {
  const index = loadIndex();
  const variants = index.variants.filter(v => !v.archived);
  res.json({ variants });
});

// GET /api/units - List all available units from sprites folder
app.get('/api/units', (req, res) => {
  const unitsDir = path.join(__dirname, 'sprites', 'units');
  ensureDir(unitsDir);

  try {
    const units = fs.readdirSync(unitsDir)
      .filter(name => {
        const unitPath = path.join(unitsDir, name);
        return fs.statSync(unitPath).isDirectory();
      })
      .map(id => {
        // Check for variants
        const index = loadIndex();
        const variants = index.variants
          .filter(v => v.objectType === 'units' && v.objectId === id && !v.archived)
          .map(v => v.id.replace(`${id}-`, ''));

        return {
          id,
          hasVariants: variants.length > 0,
          variants
        };
      });

    res.json({ units });
  } catch (err) {
    console.error('Failed to list units:', err);
    res.json({ units: [] });
  }
});

// GET /api/variants/:id - Get variant data (latest version)
app.get('/api/variants/:id', (req, res) => {
  const { id } = req.params;
  const index = loadIndex();
  const variantMeta = index.variants.find(v => v.id === id);

  if (!variantMeta) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  // Extract slug from full ID (e.g., "abrams-default" -> "default")
  const slug = variantMeta.id.split('-').slice(1).join('-');
  const variantDir = path.join(VARIANTS_DIR, variantMeta.objectType, variantMeta.objectId, slug);
  const manifestPath = path.join(variantDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Variant manifest not found' });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const versionPath = path.join(variantDir, `v${manifest.currentVersion}.json`);

  if (!fs.existsSync(versionPath)) {
    return res.status(404).json({ error: 'Variant version not found' });
  }

  const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  res.json({ manifest, data: versionData });
});

// POST /api/variants - Create new variant
app.post('/api/variants', (req, res) => {
  const { objectType, objectId, name, author, canvasWidth, canvasHeight, parts } = req.body;

  if (!objectType || !objectId || !name || !author) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Generate ID from name
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const fullId = `${objectId}-${id}`;

  // Check if exists
  const index = loadIndex();
  if (index.variants.find(v => v.id === fullId)) {
    return res.status(400).json({ error: 'Variant with this name already exists' });
  }

  // Create directory
  const variantDir = path.join(VARIANTS_DIR, objectType, objectId, id);
  ensureDir(variantDir);

  // Create manifest
  const manifest = {
    id,
    objectType,
    objectId,
    name,
    author,
    createdAt: new Date().toISOString(),
    currentVersion: 1,
    versions: [
      { version: 1, author, timestamp: new Date().toISOString(), note: 'Initial version' }
    ],
    canvasWidth: canvasWidth || 64,
    canvasHeight: canvasHeight || 64
  };

  fs.writeFileSync(path.join(variantDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Create v1.json
  const versionData = {
    version: 1,
    author,
    timestamp: new Date().toISOString(),
    note: 'Initial version',
    canvasWidth: canvasWidth || 64,
    canvasHeight: canvasHeight || 64,
    parts: parts || {}
  };

  fs.writeFileSync(path.join(variantDir, 'v1.json'), JSON.stringify(versionData, null, 2));

  // Update index
  index.variants.push({
    id: fullId,
    objectType,
    objectId,
    name,
    author
  });
  saveIndex(index);

  res.json({ success: true, id: fullId, manifest });
});

// PUT /api/variants/:id - Save new version
app.put('/api/variants/:id', (req, res) => {
  const { id } = req.params;
  const { author, note, canvasWidth, canvasHeight, parts } = req.body;

  const index = loadIndex();
  const variantMeta = index.variants.find(v => v.id === id);

  if (!variantMeta) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  const variantDir = path.join(VARIANTS_DIR, variantMeta.objectType, variantMeta.objectId, id.split('-').slice(1).join('-'));
  const manifestPath = path.join(variantDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Variant manifest not found' });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const newVersion = manifest.currentVersion + 1;

  // Update manifest
  manifest.currentVersion = newVersion;
  manifest.versions.push({
    version: newVersion,
    author: author || 'Unknown',
    timestamp: new Date().toISOString(),
    note: note || 'Update'
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Create new version file
  const versionData = {
    version: newVersion,
    author: author || 'Unknown',
    timestamp: new Date().toISOString(),
    note: note || 'Update',
    canvasWidth: canvasWidth || manifest.canvasWidth,
    canvasHeight: canvasHeight || manifest.canvasHeight,
    parts: parts || {}
  };

  fs.writeFileSync(path.join(variantDir, `v${newVersion}.json`), JSON.stringify(versionData, null, 2));

  res.json({ success: true, version: newVersion });
});

// GET /api/variants/:id/versions - Get version history
app.get('/api/variants/:id/versions', (req, res) => {
  const { id } = req.params;
  const index = loadIndex();
  const variantMeta = index.variants.find(v => v.id === id);

  if (!variantMeta) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  const variantDir = path.join(VARIANTS_DIR, variantMeta.objectType, variantMeta.objectId, id.split('-').slice(1).join('-'));
  const manifestPath = path.join(variantDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Variant manifest not found' });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  res.json({ versions: manifest.versions, currentVersion: manifest.currentVersion });
});

// GET /api/variants/:id/versions/:v - Get specific version
app.get('/api/variants/:id/versions/:v', (req, res) => {
  const { id, v } = req.params;
  const index = loadIndex();
  const variantMeta = index.variants.find(v2 => v2.id === id);

  if (!variantMeta) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  const variantDir = path.join(VARIANTS_DIR, variantMeta.objectType, variantMeta.objectId, id.split('-').slice(1).join('-'));
  const versionPath = path.join(variantDir, `v${v}.json`);

  if (!fs.existsSync(versionPath)) {
    return res.status(404).json({ error: 'Version not found' });
  }

  const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  res.json(versionData);
});

// DELETE /api/variants/:id - Archive variant (soft delete)
app.delete('/api/variants/:id', (req, res) => {
  const { id } = req.params;
  const index = loadIndex();
  const variantMeta = index.variants.find(v => v.id === id);

  if (!variantMeta) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  // Soft delete - just mark as archived
  variantMeta.archived = true;
  saveIndex(index);

  res.json({ success: true, message: 'Variant archived' });
});

// ===== PARTS API (Part Editor) =====

const PARTS_DIR = path.join(__dirname, 'data', 'parts');
const PARTS_INDEX = path.join(PARTS_DIR, 'index.json');
const SPRITES_DIR = path.join(__dirname, 'sprites');
const MANIFEST_PATH = path.join(SPRITES_DIR, 'manifest.json');

// Load parts index
function loadPartsIndex() {
  ensureDir(PARTS_DIR);
  if (!fs.existsSync(PARTS_INDEX)) {
    fs.writeFileSync(PARTS_INDEX, JSON.stringify({ parts: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(PARTS_INDEX, 'utf8'));
}

// Save parts index
function savePartsIndex(index) {
  fs.writeFileSync(PARTS_INDEX, JSON.stringify(index, null, 2));
}

// Load sprite manifest
function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }
  return { version: '1.0', units: {}, terrain: {} };
}

// Save sprite manifest
function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// Scan sprites directory and rebuild manifest
function scanAndBuildManifest() {
  console.log('[manifest] Scanning sprites directory...');
  const manifest = { version: '1.0', units: {}, terrain: {} };
  const unitsDir = path.join(SPRITES_DIR, 'units');

  if (!fs.existsSync(unitsDir)) {
    console.log('[manifest] No units directory found');
    return manifest;
  }

  // Scan each unit
  const units = fs.readdirSync(unitsDir).filter(f =>
    fs.statSync(path.join(unitsDir, f)).isDirectory()
  );

  for (const unitId of units) {
    const unitDir = path.join(unitsDir, unitId);
    manifest.units[unitId] = { name: unitId, category: 'unknown', parts: {} };

    // Scan each part type (hull, turret, tracks, etc.)
    const partTypes = fs.readdirSync(unitDir).filter(f =>
      fs.statSync(path.join(unitDir, f)).isDirectory()
    );

    for (const partType of partTypes) {
      const partDir = path.join(unitDir, partType);
      manifest.units[unitId].parts[partType] = [];

      // Find all parts - prefer folder versions (with sprite.json) over direct PNGs
      const items = fs.readdirSync(partDir);
      const partsMap = new Map(); // Use map to deduplicate by ID

      // First pass: collect folder versions (they have metadata in sprite.json)
      for (const item of items) {
        const itemPath = path.join(partDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          const spritePath = path.join(itemPath, 'sprite.png');
          if (fs.existsSync(spritePath)) {
            const entry = { id: item, name: item, file: `${item}/sprite.png`, frameCount: 1 };

            // Check for sprite.json to extract snapPoints and category
            const spriteJsonPath = path.join(itemPath, 'sprite.json');
            if (fs.existsSync(spriteJsonPath)) {
              try {
                const spriteData = JSON.parse(fs.readFileSync(spriteJsonPath, 'utf8'));
                if (spriteData.snapPoints && spriteData.snapPoints.length > 0) {
                  entry.snapPoints = spriteData.snapPoints;
                }
                if (spriteData.partCategory) {
                  entry.category = spriteData.partCategory;
                }
              } catch (e) {
                console.warn(`[manifest] Failed to read ${spriteJsonPath}:`, e.message);
              }
            }

            partsMap.set(item, entry);
          }
        }
      }

      // Second pass: add direct PNGs only if no folder version exists
      for (const item of items) {
        const itemPath = path.join(partDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isFile() && item.endsWith('.png')) {
          const id = item.replace('.png', '');
          // Only add if we don't already have a folder version
          if (!partsMap.has(id)) {
            partsMap.set(id, { id, name: id, file: item, frameCount: 1 });
          }
        }
      }

      // Convert map to array, putting "default" parts first
      const parts = Array.from(partsMap.values());
      parts.sort((a, b) => {
        const aDefault = a.id.includes('default') ? 0 : 1;
        const bDefault = b.id.includes('default') ? 0 : 1;
        return aDefault - bDefault || a.id.localeCompare(b.id);
      });
      manifest.units[unitId].parts[partType] = parts;
    }
  }

  // Save the rebuilt manifest
  saveManifest(manifest);

  // Count what we found
  let totalParts = 0;
  for (const unitId of Object.keys(manifest.units)) {
    for (const partType of Object.keys(manifest.units[unitId].parts)) {
      totalParts += manifest.units[unitId].parts[partType].length;
    }
  }
  console.log(`[manifest] Found ${Object.keys(manifest.units).length} units, ${totalParts} total parts`);

  return manifest;
}

// GET /api/sprites/rescan - Rebuild manifest from filesystem
app.get('/api/sprites/rescan', (req, res) => {
  try {
    const manifest = scanAndBuildManifest();
    res.json({
      success: true,
      units: Object.keys(manifest.units).length,
      message: 'Manifest rebuilt from filesystem'
    });
  } catch (err) {
    console.error('[manifest] Rescan failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Extract PNG data from frames/layers structure
function extractImageDataFromFrames(frames) {
  if (!frames || !frames[0] || !frames[0].layers) return null;
  for (const layer of frames[0].layers) {
    if (layer.shapes) {
      const imgShape = layer.shapes.find(s => s.type === 'image' && s.imageData);
      if (imgShape) return imgShape.imageData;
    }
  }
  return null;
}

// Add or update part in manifest
// Parts with "default" in their ID are placed first (used as default in part editor)
// Includes snapPoints and category for the snap point hierarchy system
function updateManifestPart(manifest, unitId, partType, partEntry) {
  if (!manifest.units[unitId]) {
    manifest.units[unitId] = { name: unitId, category: 'unknown', parts: {} };
  }
  if (!manifest.units[unitId].parts[partType]) {
    manifest.units[unitId].parts[partType] = [];
  }

  const parts = manifest.units[unitId].parts[partType];
  const existingIdx = parts.findIndex(p => p.id === partEntry.id);

  if (existingIdx >= 0) {
    // Preserve existing snapPoints/category if new entry doesn't have them
    const existing = parts[existingIdx];
    if (!partEntry.snapPoints && existing.snapPoints) {
      partEntry.snapPoints = existing.snapPoints;
    }
    if (!partEntry.category && existing.category) {
      partEntry.category = existing.category;
    }
    parts[existingIdx] = partEntry;
  } else {
    // Add new part - put "default" parts at the beginning
    if (partEntry.id.includes('default') || partEntry.file.includes('default')) {
      parts.unshift(partEntry);
    } else {
      parts.push(partEntry);
    }
  }
}

// GET /api/parts - List all parts (optionally filter by unitId)
app.get('/api/parts', (req, res) => {
  const { unitId } = req.query;
  const index = loadPartsIndex();
  let parts = index.parts.filter(p => !p.archived);
  if (unitId) {
    parts = parts.filter(p => p.unitId === unitId);
  }
  res.json({ parts });
});

// GET /api/parts/:partId - Get part details
app.get('/api/parts/:partId', (req, res) => {
  const { partId } = req.params;
  const index = loadPartsIndex();
  const partMeta = index.parts.find(p => p.id === partId);

  if (!partMeta) {
    return res.status(404).json({ error: 'Part not found' });
  }

  const partPath = path.join(PARTS_DIR, partMeta.unitId, partMeta.partType, `${partMeta.id}.json`);

  if (!fs.existsSync(partPath)) {
    return res.status(404).json({ error: 'Part data not found' });
  }

  const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));
  res.json(partData);
});

// GET /api/parts/check - Check if a part file exists
app.get('/api/parts/check', (req, res) => {
  const { unitId, partType, name } = req.query;

  if (!unitId || !partType || !name) {
    return res.status(400).json({ error: 'Missing required query params: unitId, partType, name' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `${id}.png`;
  const filePath = path.join(SPRITES_DIR, 'units', unitId, partType, filename);

  if (fs.existsSync(filePath)) {
    res.json({
      exists: true,
      id,
      filename,
      previewUrl: `/sprites/units/${unitId}/${partType}/${filename}`
    });
  } else {
    res.json({ exists: false, id, filename });
  }
});

// POST /api/parts - Create new part (saves to sprites folder and updates manifest)
app.post('/api/parts', (req, res) => {
  const { unitId, partType, name, author, frames, imageData, overwrite } = req.body;

  if (!unitId || !partType || !name || !author) {
    return res.status(400).json({ error: 'Missing required fields: unitId, partType, name, author' });
  }

  // Prevent saving with invalid part type
  if (partType === 'null' || partType === 'undefined') {
    return res.status(400).json({ error: 'Invalid partType: must select a part category before saving' });
  }

  // Generate ID and filename from name
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `${id}.png`;

  // Determine save path
  const partDir = path.join(SPRITES_DIR, 'units', unitId, partType);
  ensureDir(partDir);
  const filePath = path.join(partDir, filename);

  // Check if file already exists (unless overwrite is true)
  if (fs.existsSync(filePath) && !overwrite) {
    return res.status(409).json({
      error: 'File exists',
      exists: true,
      id,
      filename,
      previewUrl: `/sprites/units/${unitId}/${partType}/${filename}`
    });
  }

  // Get PNG data from imageData or extract from frames
  const pngData = imageData || extractImageDataFromFrames(frames);
  if (!pngData || !pngData.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'No valid PNG image data provided' });
  }

  // Save PNG file
  const base64Data = pngData.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  // Update manifest
  const manifest = loadManifest();
  updateManifestPart(manifest, unitId, partType, { id, name, file: filename, frameCount: 1 });
  saveManifest(manifest);

  // Update parts index for editor tracking
  const index = loadPartsIndex();
  const partMeta = { id, unitId, partType, name, author, file: filename, createdAt: new Date().toISOString() };
  const existingIdx = index.parts.findIndex(p => p.id === id && p.unitId === unitId && p.partType === partType);
  if (existingIdx >= 0) {
    index.parts[existingIdx] = partMeta;
  } else {
    index.parts.push(partMeta);
  }
  savePartsIndex(index);

  res.json({ success: true, id, file: filename, path: `sprites/units/${unitId}/${partType}/${filename}` });
});

// PUT /api/parts/:partId - Update part
app.put('/api/parts/:partId', (req, res) => {
  const { partId } = req.params;
  const { name, author, width, height, frames } = req.body;

  const index = loadPartsIndex();
  const partMeta = index.parts.find(p => p.id === partId);

  if (!partMeta) {
    return res.status(404).json({ error: 'Part not found' });
  }

  const partPath = path.join(PARTS_DIR, partMeta.unitId, partMeta.partType, `${partMeta.id}.json`);

  if (!fs.existsSync(partPath)) {
    return res.status(404).json({ error: 'Part data not found' });
  }

  const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));

  // Update fields
  if (name) {
    partData.name = name;
    partMeta.name = name;
  }
  if (author) partData.author = author;
  if (width) partData.width = width;
  if (height) partData.height = height;
  if (frames) partData.frames = frames;

  partData.version = (partData.version || 0) + 1;
  partData.updatedAt = new Date().toISOString();

  fs.writeFileSync(partPath, JSON.stringify(partData, null, 2));
  savePartsIndex(index);

  res.json({ success: true, version: partData.version, part: partData });
});

// DELETE /api/parts/:partId - Archive part (soft delete)
app.delete('/api/parts/:partId', (req, res) => {
  const { partId } = req.params;
  const index = loadPartsIndex();
  const partMeta = index.parts.find(p => p.id === partId);

  if (!partMeta) {
    return res.status(404).json({ error: 'Part not found' });
  }

  // Soft delete
  partMeta.archived = true;
  savePartsIndex(index);

  res.json({ success: true, message: 'Part archived' });
});

// GET /api/parts/:partId/image - Get rendered PNG thumbnail
app.get('/api/parts/:partId/image', (req, res) => {
  const { partId } = req.params;
  const index = loadPartsIndex();
  const partMeta = index.parts.find(p => p.id === partId);

  if (!partMeta) {
    return res.status(404).json({ error: 'Part not found' });
  }

  const imagePath = path.join(PARTS_DIR, partMeta.unitId, partMeta.partType, `${partMeta.id}.png`);

  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: 'Part image not found' });
  }

  res.sendFile(imagePath);
});

// POST /api/parts/:partId/image - Upload part thumbnail PNG
app.post('/api/parts/:partId/image', (req, res) => {
  const { partId } = req.params;
  const { imageData } = req.body;

  if (!imageData || !imageData.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Invalid image data' });
  }

  const index = loadPartsIndex();
  const partMeta = index.parts.find(p => p.id === partId);

  if (!partMeta) {
    return res.status(404).json({ error: 'Part not found' });
  }

  // Decode base64
  const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // Ensure directory exists
  const partDir = path.join(PARTS_DIR, partMeta.unitId, partMeta.partType);
  ensureDir(partDir);

  // Save PNG file
  const pngPath = path.join(partDir, `${partMeta.id}.png`);
  fs.writeFileSync(pngPath, buffer);

  res.json({ success: true, path: `/data/parts/${partMeta.unitId}/${partMeta.partType}/${partMeta.id}.png` });
});

// ===== SPRITE PART VARIANTS API =====

// Load manifest for a unit (uses SPRITES_DIR from above)
function loadSpriteManifest(unitId) {
  const manifestPath = path.join(SPRITES_DIR, 'units', unitId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { unitId, parts: {} };
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// Save manifest for a unit
function saveSpriteManifest(unitId, manifest) {
  const unitDir = path.join(SPRITES_DIR, 'units', unitId);
  ensureDir(unitDir);
  fs.writeFileSync(path.join(unitDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// GET /api/sprites/:unitId - Get unit manifest (all parts and variants)
app.get('/api/sprites/:unitId', (req, res) => {
  const { unitId } = req.params;
  const manifest = loadSpriteManifest(unitId);
  res.json(manifest);
});

// POST /api/sprites/:unitId/:partId/:variant - Save part variant PNG
app.post('/api/sprites/:unitId/:partId/:variant', (req, res) => {
  const { unitId, partId, variant } = req.params;
  const { imageData } = req.body;

  if (!imageData || !imageData.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Invalid image data' });
  }

  // Decode base64
  const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // Ensure directory exists
  const partDir = path.join(SPRITES_DIR, 'units', unitId, partId);
  ensureDir(partDir);

  // Save PNG file
  const pngPath = path.join(partDir, `${variant}.png`);
  fs.writeFileSync(pngPath, buffer);

  // Update manifest
  const manifest = loadSpriteManifest(unitId);
  if (!manifest.parts[partId]) {
    manifest.parts[partId] = [];
  }
  if (!manifest.parts[partId].includes(variant)) {
    manifest.parts[partId].push(variant);
  }
  saveSpriteManifest(unitId, manifest);

  res.json({ success: true, path: `/sprites/units/${unitId}/${partId}/${variant}.png` });
});

// DELETE /api/sprites/:unitId/:partId/:variant - Remove part variant
app.delete('/api/sprites/:unitId/:partId/:variant', (req, res) => {
  const { unitId, partId, variant } = req.params;

  const pngPath = path.join(SPRITES_DIR, 'units', unitId, partId, `${variant}.png`);
  if (fs.existsSync(pngPath)) {
    fs.unlinkSync(pngPath);
  }

  // Update manifest
  const manifest = loadSpriteManifest(unitId);
  if (manifest.parts[partId]) {
    manifest.parts[partId] = manifest.parts[partId].filter(v => v !== variant);
    if (manifest.parts[partId].length === 0) {
      delete manifest.parts[partId];
    }
  }
  saveSpriteManifest(unitId, manifest);

  res.json({ success: true });
});

// GET /api/sprites - List all units with sprites
app.get('/api/sprites', (req, res) => {
  const unitsDir = path.join(SPRITES_DIR, 'units');
  ensureDir(unitsDir);
  const units = fs.readdirSync(unitsDir).filter(f => {
    const stat = fs.statSync(path.join(unitsDir, f));
    return stat.isDirectory();
  });

  const manifests = units.map(unitId => loadSpriteManifest(unitId));
  res.json({ units: manifests });
});

// ===== WORKING PROJECT API (New Save System) =====

// Helper: Get working directory path
function getWorkingDir(unitId, partType, variant) {
  return path.join(SPRITES_DIR, 'units', unitId, partType, variant, 'working');
}

// Helper: Recursively find all working projects
function findAllWorkingProjects() {
  const projects = [];
  const unitsDir = path.join(SPRITES_DIR, 'units');

  if (!fs.existsSync(unitsDir)) return projects;

  const units = fs.readdirSync(unitsDir).filter(f =>
    fs.statSync(path.join(unitsDir, f)).isDirectory()
  );

  for (const unitId of units) {
    const unitDir = path.join(unitsDir, unitId);
    const partTypes = fs.readdirSync(unitDir).filter(f =>
      fs.statSync(path.join(unitDir, f)).isDirectory()
    );

    for (const partType of partTypes) {
      const partDir = path.join(unitDir, partType);
      const variants = fs.readdirSync(partDir).filter(f =>
        fs.statSync(path.join(partDir, f)).isDirectory()
      );

      for (const variant of variants) {
        const workingDir = path.join(partDir, variant, 'working');
        const projectPath = path.join(workingDir, 'project.json');

        if (fs.existsSync(projectPath)) {
          try {
            const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            projects.push({
              unitId,
              partType,
              variant,
              metadata: project.metadata,
              modifiedAt: project.metadata?.modifiedAt || null
            });
          } catch (e) {
            console.warn(`Failed to read project ${projectPath}:`, e.message);
          }
        }
      }
    }
  }

  return projects;
}

// GET /api/sprites/working - List all working projects
app.get('/api/sprites/working', (req, res) => {
  try {
    const projects = findAllWorkingProjects();
    res.json({ projects });
  } catch (err) {
    console.error('Failed to list working projects:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sprites/:unitId/:partType/:variant/working - Load working project
app.get('/api/sprites/:unitId/:partType/:variant/working', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const workingDir = getWorkingDir(unitId, partType, variant);
  const projectPath = path.join(workingDir, 'project.json');

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'No working project found' });
  }

  try {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read project: ' + err.message });
  }
});

// PUT /api/sprites/:unitId/:partType/:variant/working - Save working project
app.put('/api/sprites/:unitId/:partType/:variant/working', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const projectData = req.body;

  if (!projectData) {
    return res.status(400).json({ error: 'No project data provided' });
  }

  const workingDir = getWorkingDir(unitId, partType, variant);
  ensureDir(workingDir);

  // Add/update metadata
  projectData.metadata = {
    ...projectData.metadata,
    unitId,
    partType,
    variantName: variant,
    modifiedAt: new Date().toISOString()
  };

  const projectPath = path.join(workingDir, 'project.json');

  try {
    fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
    res.json({
      success: true,
      path: `sprites/units/${unitId}/${partType}/${variant}/working/project.json`,
      modifiedAt: projectData.metadata.modifiedAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save project: ' + err.message });
  }
});

// PUT /api/sprites/:unitId/:partType/:variant/autosave - Save autosave
app.put('/api/sprites/:unitId/:partType/:variant/autosave', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const autosaveData = req.body;

  if (!autosaveData) {
    return res.status(400).json({ error: 'No autosave data provided' });
  }

  const workingDir = getWorkingDir(unitId, partType, variant);
  ensureDir(workingDir);

  autosaveData.autosavedAt = new Date().toISOString();

  const autosavePath = path.join(workingDir, 'autosave.json');

  try {
    fs.writeFileSync(autosavePath, JSON.stringify(autosaveData, null, 2));
    res.json({
      success: true,
      autosavedAt: autosaveData.autosavedAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save autosave: ' + err.message });
  }
});

// GET /api/sprites/:unitId/:partType/:variant/autosave - Get autosave if exists
app.get('/api/sprites/:unitId/:partType/:variant/autosave', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const workingDir = getWorkingDir(unitId, partType, variant);
  const autosavePath = path.join(workingDir, 'autosave.json');

  if (!fs.existsSync(autosavePath)) {
    return res.json({ exists: false });
  }

  try {
    const autosave = JSON.parse(fs.readFileSync(autosavePath, 'utf8'));
    res.json({ exists: true, data: autosave, autosavedAt: autosave.autosavedAt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read autosave: ' + err.message });
  }
});

// DELETE /api/sprites/:unitId/:partType/:variant/autosave - Clear autosave
app.delete('/api/sprites/:unitId/:partType/:variant/autosave', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const workingDir = getWorkingDir(unitId, partType, variant);
  const autosavePath = path.join(workingDir, 'autosave.json');

  if (fs.existsSync(autosavePath)) {
    fs.unlinkSync(autosavePath);
  }

  res.json({ success: true });
});

// POST /api/sprites/:unitId/:partType/:variant/publish - Publish to production
app.post('/api/sprites/:unitId/:partType/:variant/publish', (req, res) => {
  const { unitId, partType, variant } = req.params;
  const { imageData, animations, metadata } = req.body;

  if (!imageData) {
    return res.status(400).json({ error: 'No image data provided' });
  }

  const variantDir = path.join(SPRITES_DIR, 'units', unitId, partType, variant);
  ensureDir(variantDir);

  try {
    // Save main sprite PNG
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(variantDir, 'sprite.png'), Buffer.from(base64Data, 'base64'));

    // Save animation frames if provided
    if (animations && Object.keys(animations).length > 0) {
      const animDir = path.join(variantDir, 'animations');
      ensureDir(animDir);

      for (const [animName, animData] of Object.entries(animations)) {
        if (animData.frames) {
          for (let i = 0; i < animData.frames.length; i++) {
            const frameData = animData.frames[i];
            if (frameData && frameData.imageData) {
              const frameBase64 = frameData.imageData.replace(/^data:image\/png;base64,/, '');
              const filename = animData.frames.length === 1
                ? `${animName}.png`
                : `${animName}-${i + 1}.png`;
              fs.writeFileSync(path.join(animDir, filename), Buffer.from(frameBase64, 'base64'));
            }
          }
        }
      }
    }

    // Create production metadata
    const spriteJson = {
      id: `${unitId}-${partType}-${variant}`,
      dimensions: metadata?.dimensions || { width: 64, height: 64 },
      animations: {},
      // Include snap points and part category for hierarchy system
      snapPoints: metadata?.snapPoints || [],
      partCategory: metadata?.partCategory || null,
      publishedAt: new Date().toISOString()
    };

    // Add animation metadata
    if (animations) {
      for (const [animName, animData] of Object.entries(animations)) {
        if (animData.frames && animData.frames.length > 0) {
          if (animData.frames.length === 1) {
            spriteJson.animations[animName] = { file: `animations/${animName}.png` };
          } else {
            spriteJson.animations[animName] = {
              files: animData.frames.map((_, i) => `animations/${animName}-${i + 1}.png`)
            };
          }
        }
      }
    }

    fs.writeFileSync(path.join(variantDir, 'sprite.json'), JSON.stringify(spriteJson, null, 2));

    // Update global manifest with snapPoints and category for hierarchy system
    const manifest = loadManifest();
    updateManifestPart(manifest, unitId, partType, {
      id: variant,
      name: metadata?.name || variant,
      file: `${variant}/sprite.png`,
      frameCount: 1,
      // Include snap points and category for variant builder snapping
      snapPoints: metadata?.snapPoints || [],
      category: metadata?.partCategory || null
    });
    saveManifest(manifest);

    res.json({
      success: true,
      path: `sprites/units/${unitId}/${partType}/${variant}/sprite.png`,
      publishedAt: spriteJson.publishedAt
    });
  } catch (err) {
    console.error('Publish failed:', err);
    res.status(500).json({ error: 'Failed to publish: ' + err.message });
  }
});

// GET /api/terrain/tiles - List all PNG files in terrain folder
app.get('/api/terrain/tiles', (req, res) => {
  const terrainDir = path.join(__dirname, 'sprites', 'terrain');
  ensureDir(terrainDir);

  try {
    const files = fs.readdirSync(terrainDir)
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        name: f.replace('.png', ''),
        file: f,
        path: `/sprites/terrain/${f}`
      }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the game
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== MULTIPLAYER INFRASTRUCTURE (Ready for v2) =====

// Store active games and players
const games = new Map();
const players = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Player joins matchmaking
  socket.on('find-match', (playerData) => {
    players.set(socket.id, {
      id: socket.id,
      name: playerData.name || 'Commander',
      status: 'searching'
    });
    
    // Find another player searching
    const waitingPlayer = [...players.values()].find(
      p => p.status === 'searching' && p.id !== socket.id
    );
    
    if (waitingPlayer) {
      // Create a game
      const gameId = `game_${Date.now()}`;
      const game = {
        id: gameId,
        players: [waitingPlayer.id, socket.id],
        state: 'starting',
        scores: { [waitingPlayer.id]: 0, [socket.id]: 0 }
      };
      
      games.set(gameId, game);
      players.get(waitingPlayer.id).status = 'playing';
      players.get(socket.id).status = 'playing';
      
      // Notify both players
      io.to(waitingPlayer.id).emit('match-found', { gameId, opponent: players.get(socket.id).name, side: 'left' });
      io.to(socket.id).emit('match-found', { gameId, opponent: players.get(waitingPlayer.id).name, side: 'right' });
      
      console.log(`Game ${gameId} started: ${waitingPlayer.id} vs ${socket.id}`);
    } else {
      socket.emit('waiting-for-opponent');
    }
  });
  
  // Player sends their game state update
  socket.on('game-update', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      // Broadcast to opponent
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-update', data);
      }
    }
  });
  
  // Player deploys a unit (sends pressure to opponent)
  socket.on('deploy-unit', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        // Send enemy to opponent's side
        io.to(opponentId).emit('incoming-enemy', data);
      }
    }
  });
  
  // Player answers correctly - can trigger effects
  socket.on('correct-answer', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      game.scores[socket.id] = (game.scores[socket.id] || 0) + data.points;
      
      // Broadcast updated scores
      game.players.forEach(playerId => {
        io.to(playerId).emit('score-update', game.scores);
      });
    }
  });
  
  // Game over
  socket.on('game-over', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-defeated', { winner: socket.id });
      }
      
      // Cleanup
      game.players.forEach(playerId => {
        if (players.has(playerId)) {
          players.get(playerId).status = 'idle';
        }
      });
      games.delete(game.id);
    }
  });
  
  // Cancel matchmaking
  socket.on('cancel-search', () => {
    if (players.has(socket.id)) {
      players.get(socket.id).status = 'idle';
    }
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Notify opponent if in a game
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-disconnected');
      }
      games.delete(game.id);
    }
    
    players.delete(socket.id);
  });
});

// ===== START SERVER =====

// Auto-scan sprites directory on startup
scanAndBuildManifest();

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║           CALCULATED RISK - SERVER ONLINE             ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Local:    http://localhost:${PORT}                      ║`);

  // Get local network IP
  const interfaces = os.networkInterfaces();
  let localIP = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP) break;
  }

  if (localIP) {
    const paddedIP = `http://${localIP}:${PORT}`.padEnd(27);
    console.log(`║  Network:  ${paddedIP}║`);
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log('║  Share the Network URL with your son\'s phone!         ║');
  }

  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
});
