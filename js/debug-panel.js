// ═══════════════════════════════════════════════════════════════
// DEBUG PANEL — Live in-game debug bar for endless/fire range
// Toggle with backtick (`)
// ═══════════════════════════════════════════════════════════════

import { saveDebugReplay } from './replay-recorder.js';

let _panel = null;
let _visible = false;
let _inspectedUnit = null;
let _updateInterval = null;

const STYLES = `
.debug-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(10, 12, 18, 0.92);
  border-top: 1px solid #4ade80;
  font-family: 'Oxanium', monospace;
  font-size: 12px;
  color: #e2e8f0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  max-height: 40vh;
  overflow-y: auto;
}
.debug-panel.hidden { display: none; }
.debug-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-wrap: wrap;
}
.debug-row:last-child { border-bottom: none; }
.debug-label {
  color: #94a3b8;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 50px;
}
.debug-value {
  color: #4ade80;
  font-weight: 600;
}
.debug-value.red { color: #f87171; }
.debug-value.yellow { color: #fbbf24; }
.debug-value.blue { color: #60a5fa; }
.debug-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  color: #e2e8f0;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: 'Oxanium', monospace;
  font-size: 11px;
  transition: background 0.15s;
}
.debug-btn:hover { background: rgba(255,255,255,0.18); }
.debug-btn.active { background: rgba(74, 222, 128, 0.2); border-color: #4ade80; color: #4ade80; }
.debug-btn.danger { border-color: #f87171; }
.debug-btn.danger:hover { background: rgba(248, 113, 113, 0.2); color: #f87171; }
.debug-sep {
  width: 1px;
  height: 18px;
  background: rgba(255,255,255,0.12);
  margin: 0 4px;
}
.debug-inspector {
  padding: 4px 10px;
  background: rgba(0,0,0,0.3);
  font-size: 11px;
  line-height: 1.5;
}
.debug-inspector .unit-name { color: #60a5fa; font-weight: 600; }
.debug-inspector .stat { color: #94a3b8; }
.debug-inspector .val { color: #e2e8f0; }
.debug-timescale {
  display: flex;
  align-items: center;
  gap: 4px;
}
.debug-timescale input[type=range] {
  width: 80px;
  height: 14px;
  accent-color: #4ade80;
}
`;

/**
 * Toggle debug panel visibility. Creates it on first use.
 * @param {function} getBattle - Returns current battle state object
 */
export function toggleDebugPanel(getBattle) {
  if (!_panel) _createPanel(getBattle);
  _visible = !_visible;
  _panel.classList.toggle('hidden', !_visible);
  if (_visible) {
    _startUpdates(getBattle);
  } else {
    _stopUpdates();
  }
  return _visible;
}

export function isDebugPanelVisible() {
  return _visible;
}

export function destroyDebugPanel() {
  _stopUpdates();
  if (_panel) {
    _panel.remove();
    _panel = null;
  }
  _visible = false;
  _inspectedUnit = null;
}

/**
 * Call from click handler — if debug panel is open, inspect clicked unit.
 */
export function debugInspectAt(b, worldX, worldY) {
  if (!_visible || !b) return false;
  const allUnits = [...(b.units || []), ...(b.enemies || [])];
  if (b.hero) allUnits.push(b.hero);
  let closest = null, closestDist = 40;
  for (const u of allUnits) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - worldX, u.y - worldY);
    if (d < closestDist) { closest = u; closestDist = d; }
  }
  _inspectedUnit = closest;
  return !!closest;
}

// ── Internal ────────────────────────────────────────────────

function _createPanel(getBattle) {
  // Inject styles
  if (!document.getElementById('debug-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'debug-panel-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  _panel = document.createElement('div');
  _panel.className = 'debug-panel hidden';
  _panel.innerHTML = `
    <div class="debug-row" id="debug-stats"></div>
    <div class="debug-row" id="debug-commander"></div>
    <div class="debug-row" id="debug-actions"></div>
    <div class="debug-inspector hidden" id="debug-inspector"></div>
  `;
  document.body.appendChild(_panel);

  // Wire up action buttons
  const actions = _panel.querySelector('#debug-actions');
  actions.innerHTML = `
    <span class="debug-label">Actions</span>
    <button class="debug-btn danger" data-debug="kill">Kill Enemies</button>
    <button class="debug-btn danger" data-debug="skip">Skip Wave</button>
    <div class="debug-sep"></div>
    <button class="debug-btn" data-debug="vision">Vision</button>
    <button class="debug-btn" data-debug="terrain">Terrain</button>
    <button class="debug-btn" data-debug="fog">Fog Off</button>
    <div class="debug-sep"></div>
    <button class="debug-btn" data-debug="pause">Pause</button>
    <button class="debug-btn" data-debug="save-replay">Save Replay</button>
    <div class="debug-sep"></div>
    <div class="debug-timescale">
      <span class="debug-label">Speed</span>
      <input type="range" min="0.1" max="4" step="0.1" value="1" data-debug="timescale">
      <span class="debug-value" id="debug-timescale-val">1.0x</span>
    </div>
  `;

  actions.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-debug]');
    if (!btn) return;
    const action = btn.dataset.debug;
    const b = getBattle();
    if (!b) return;

    switch (action) {
      case 'kill': {
        const alive = b.enemies.filter(e => !e.dead);
        alive.forEach(e => { e.hp = 0; e.dead = true; });
        console.log(`[DEBUG] Killed ${alive.length} enemies`);
        break;
      }
      case 'skip': {
        const alive = b.enemies.filter(e => !e.dead);
        alive.forEach(e => { e.hp = 0; e.dead = true; });
        // Also clear spawn queue
        if (b.spawnQueue) b.spawnQueue.length = 0;
        console.log('[DEBUG] Skipping wave');
        break;
      }
      case 'vision':
        b.showVision = !b.showVision;
        btn.classList.toggle('active', b.showVision);
        break;
      case 'terrain':
        b.showTerrainGrid = b.showTerrainGrid ? 0 : 1;
        if (b.battleRenderer) b.battleRenderer._terrainGridCache = null;
        btn.classList.toggle('active', !!b.showTerrainGrid);
        break;
      case 'fog':
        if (b._visibleEnemies) {
          b._debugFogOff = true;
          b._visibleEnemies = null;
          btn.textContent = 'Fog On';
          btn.classList.add('active');
        } else {
          b._debugFogOff = false;
          btn.textContent = 'Fog Off';
          btn.classList.remove('active');
        }
        break;
      case 'pause':
        b._debugPaused = !b._debugPaused;
        btn.classList.toggle('active', b._debugPaused);
        btn.textContent = b._debugPaused ? 'Resume' : 'Pause';
        break;
      case 'save-replay':
        btn.disabled = true;
        btn.textContent = 'Saving...';
        saveDebugReplay(b).then(ok => {
          btn.textContent = ok ? 'Saved!' : 'Failed';
          setTimeout(() => { btn.textContent = 'Save Replay'; btn.disabled = false; }, 2000);
        });
        break;
    }
  });

  // Time scale slider
  const slider = actions.querySelector('[data-debug="timescale"]');
  const sliderVal = _panel.querySelector('#debug-timescale-val');
  slider.addEventListener('input', () => {
    const b = getBattle();
    if (b) b._debugTimeScale = parseFloat(slider.value);
    sliderVal.textContent = parseFloat(slider.value).toFixed(1) + 'x';
  });
}

function _startUpdates(getBattle) {
  _stopUpdates();
  _updateInterval = setInterval(() => _updateStats(getBattle()), 200);
}

function _stopUpdates() {
  if (_updateInterval) {
    clearInterval(_updateInterval);
    _updateInterval = null;
  }
}

function _updateStats(b) {
  if (!_panel || !b) return;

  const statsEl = _panel.querySelector('#debug-stats');
  const inspectorEl = _panel.querySelector('#debug-inspector');

  // Gather data
  const blueAlive = (b.units || []).filter(u => !u.dead).length;
  const blueTotal = (b.units || []).length;
  const redAlive = (b.enemies || []).filter(u => !u.dead).length;
  const redTotal = (b.enemies || []).length;
  const heroHp = b.hero && !b.hero.dead ? Math.ceil(b.hero.hp) : 0;
  const heroMax = b.hero?.maxHp || 0;
  const wave = b.wave || b.waveNumber || '?';
  const seed = b.seed || '?';
  const spotted = b.hero?._isSpottedByEnemy ? 'YES' : 'NO';
  const queued = b.spawnQueue?.length || 0;

  // Sergeant info
  let sgtInfo = '';
  if (b._squads) {
    for (const sq of b._squads) {
      if (!sq.active || !sq.sergeant) continue;
      const sgt = sq.sergeant;
      const team = sq.team === 'blue' ? 'blue' : 'red';
      const phase = sgt.currentPhase || '?';
      const obj = sq.objective?.type || '?';
      const pressure = sgt._objectivePressure?.toFixed(2) || '0';
      sgtInfo += `<span class="debug-value ${team}">${team[0].toUpperCase()}${sq.id}:${phase}</span>/${obj}(p${pressure}) `;
    }
  }

  statsEl.innerHTML = `
    <span class="debug-label">Wave</span><span class="debug-value">${wave}</span>
    <span class="debug-label">Seed</span><span class="debug-value">${seed}</span>
    <div class="debug-sep"></div>
    <span class="debug-label">Blue</span><span class="debug-value blue">${blueAlive}/${blueTotal}</span>
    <span class="debug-label">Red</span><span class="debug-value red">${redAlive}/${redTotal}${queued ? '+' + queued : ''}</span>
    <span class="debug-label">Hero</span><span class="debug-value">${heroHp}/${heroMax}</span>
    <span class="debug-label">Spotted</span><span class="debug-value ${spotted === 'YES' ? 'yellow' : ''}">${spotted}</span>
    <div class="debug-sep"></div>
    <span class="debug-label">Sgts</span>${sgtInfo || '<span class="debug-value">-</span>'}
  `;

  // Commander brain row
  const cmdEl = _panel.querySelector('#debug-commander');
  if (cmdEl && b._teamCommanders) {
    let cmdHtml = '';
    for (const team of ['blue', 'red']) {
      const cmdr = b._teamCommanders[team];
      if (!cmdr) continue;
      const t = cmdr.traits || {};
      const panicPct = Math.round((cmdr.panic || 0) * 100);
      const panicClass = panicPct > 60 ? 'red' : panicPct > 30 ? 'yellow' : '';
      const reserves = cmdr.reserves?.length || 0;
      const zones = (cmdr.defenseZones || []).map(z => {
        const threat = z.threatLevel?.toFixed(1) || '0';
        return `${z.id[0].toUpperCase()}:${threat}${z.breached ? '!' : ''}`;
      }).join(' ');

      // Get current plays from squads
      const plays = (b._squads || [])
        .filter(sq => sq.team === team && sq.sergeant?._currentPlay)
        .map(sq => `${sq.id}:${sq.sergeant._currentPlay}`)
        .join(' ');

      const label = team === 'blue' ? 'blue' : 'red';
      cmdHtml += `<span class="debug-label">${team[0].toUpperCase()}CMD</span>`;
      cmdHtml += `<span class="debug-value ${label}">`;
      cmdHtml += `P:<span class="${panicClass}">${panicPct}%</span>`;
      cmdHtml += ` R:${reserves}`;
      if (zones) cmdHtml += ` Z:[${zones}]`;
      if (plays) cmdHtml += ` ${plays}`;
      cmdHtml += `</span>`;
      if (team === 'blue') cmdHtml += '<div class="debug-sep"></div>';
    }
    cmdEl.innerHTML = cmdHtml || '';
    cmdEl.style.display = cmdHtml ? '' : 'none';
  }

  // Unit inspector
  if (_inspectedUnit && !_inspectedUnit.dead) {
    const u = _inspectedUnit;
    const team = (b.units || []).includes(u) ? 'blue' : (b.enemies || []).includes(u) ? 'red' : 'hero';
    const pos = `(${Math.round(u.x)}, ${Math.round(u.y)})`;
    const p = u.personality || {};
    const personality = `agg=${(p.aggression||0).toFixed(1)} pat=${(p.patience||0).toFixed(1)} cou=${(p.courage||0).toFixed(1)} dis=${(p.discipline||0).toFixed(1)} ini=${(p.initiative||0).toFixed(1)}`;
    const combat = `hp=${Math.ceil(u.hp||0)}/${u.maxHp||'?'} sup=${(u._suppression||0).toFixed(2)} mor=${(u._morale||1).toFixed(2)} stab=${(u._stability||0).toFixed(2)}`;
    const action = `st=${u._actionState||'?'} cmd=${u._activeCommand||'?'} tgt=${u._currentTarget?.id||'none'}`;
    const spotted = u._spotted?.length || 0;
    const sqId = u._squadId ?? '?';
    const insig = u._insigniaSetId || 'default';

    inspectorEl.classList.remove('hidden');
    inspectorEl.innerHTML = `
      <span class="unit-name">${u.id || 'hero'}</span> <span class="stat">(${u.unitId || '?'} / ${team} / sq${sqId})</span> <span class="stat">pos</span> <span class="val">${pos}</span> <span class="stat">insignia</span> <span class="val">${insig}</span><br>
      <span class="stat">${combat}</span><br>
      <span class="stat">${action}</span> <span class="stat">spotted=${spotted}</span><br>
      <span class="stat">personality: ${personality}</span>
    `;
  } else {
    inspectorEl.classList.add('hidden');
    _inspectedUnit = null;
  }
}
