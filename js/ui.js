// ═══════════════════════════════════════════════════════════════
// UI - HTML rendering functions
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UnitType, UNITS, UNIT_COSTS, H2H_BUDGET, VEHICLE_UNITS, TYPE_CHART, UNIT_PROJECTILES, PROJECTILES, UNIT_DESCRIPTIONS, CAMPAIGN_ERAS, CAMPAIGN_MOS } from './constants.js';
import { Game } from './state.js';
import { save } from './storage.js';

// Mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

// ═══════════════════════════════════════════════════════════════
// ANIMATION PREVIEW SYSTEM
// ═══════════════════════════════════════════════════════════════

let uiAnimFrame = 0;
let uiAnimInterval = null;

// Get animated SVG for UI previews (with custom colors applied)
function getAnimatedSvg(unit, wrapClass = '') {
  const customColors = Game.player.unitColors[unit.id];
  if (unit.svgFrames && unit.svgFrames.length > 0) {
    let frame = unit.svgFrames[0];
    if (customColors && Object.keys(customColors).length > 0) {
      frame = applyColorsToSvgInternal(frame, unit, customColors);
    }
    return `<div class="anim-svg ${wrapClass}" data-unit-id="${unit.id}">${frame}</div>`;
  }
  let svg = unit.svg;
  if (customColors && Object.keys(customColors).length > 0) {
    svg = applyColorsToSvgInternal(svg, unit, customColors);
  }
  return svg;
}

// Internal helper for color application (used before exports are defined)
function applyColorsToSvgInternal(svgString, unit, colors) {
  if (!unit.parts || !unit.defaultColors) return svgString;
  let result = svgString;
  for (const part of unit.parts) {
    const defaultColor = unit.defaultColors[part];
    const customColor = colors[part] || defaultColor;
    if (defaultColor && customColor && defaultColor !== customColor) {
      const regex = new RegExp(`fill="${defaultColor}"`, 'gi');
      result = result.replace(regex, `fill="${customColor}"`);
      const strokeRegex = new RegExp(`stroke="${defaultColor}"`, 'gi');
      result = result.replace(strokeRegex, `stroke="${customColor}"`);
    }
  }
  return result;
}

// Start/update animation cycle for UI
function startUIAnimation() {
  if (uiAnimInterval) return;
  uiAnimInterval = setInterval(() => {
    uiAnimFrame = (uiAnimFrame + 1) % 3;
    document.querySelectorAll('.anim-svg').forEach(el => {
      const unitId = el.dataset.unitId;
      const unit = UNITS.find(u => u.id === unitId);
      if (unit && unit.svgFrames) {
        let frame = unit.svgFrames[uiAnimFrame % unit.svgFrames.length];
        // Apply custom colors
        const customColors = Game.player.unitColors[unitId];
        if (customColors && Object.keys(customColors).length > 0) {
          frame = applyColorsToSvgInternal(frame, unit, customColors);
        }
        el.innerHTML = frame;
      }
    });
  }, 150);
}

// Stop animation cycle
function stopUIAnimation() {
  if (uiAnimInterval) {
    clearInterval(uiAnimInterval);
    uiAnimInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SUB-STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export function setSubState(sub, data = {}) {
  Game.subState = sub;
  if (sub === SubState.LANE_SELECT) {
    Game.battle.selectedLane = data.lane;
  } else {
    Game.battle.selectedLane = null;
  }
  render();
}

// ═══════════════════════════════════════════════════════════════
// MAIN RENDER
// ═══════════════════════════════════════════════════════════════

export function render() {
  const app = document.getElementById('app');

  // Stop any existing UI animation first
  stopUIAnimation();

  switch (Game.state) {
    case State.MENU: app.innerHTML = menuHTML(); break;
    case State.HQ: app.innerHTML = headquartersHTML(); startUIAnimation(); break;
    case State.SETTINGS: app.innerHTML = settingsHTML(); break;
    case State.STATS: app.innerHTML = statsHTML(); break;
    case State.MATCHMAKING: app.innerHTML = matchmakingHTML(); break;
    case State.COUNTDOWN: app.innerHTML = countdownHTML(); break;
    case State.BATTLE: app.innerHTML = battleHTML(); break;
    case State.WAVE_COMPLETE: app.innerHTML = battleHTML() + waveCompleteHTML(); break;
    case State.PAUSED: app.innerHTML = battleHTML() + pauseHTML(); break;
    case State.VICTORY: app.innerHTML = battleHTML() + gameOverHTML(true); break;
    case State.DEFEAT: app.innerHTML = battleHTML() + gameOverHTML(false); break;
    case State.H2H_DESIGN: app.innerHTML = h2hDesignHTML(); startUIAnimation(); break;
    case State.H2H_BATTLE: app.innerHTML = h2hBattleHTML(); break;
    case State.H2H_RESULT: app.innerHTML = h2hResultHTML(); break;
    case State.H2H_MATCH_END: app.innerHTML = h2hMatchEndHTML(); break;
    case State.SPRITE_EDITOR: app.innerHTML = spriteEditorHTML(); initSpriteEditor(); break;
    // Campaign states
    case State.CAMPAIGN_ERA_SELECT: app.innerHTML = campaignEraSelectHTML(); break;
    case State.CAMPAIGN_MOS_SELECT: app.innerHTML = campaignMOSSelectHTML(); break;
    case State.CAMPAIGN_PLANNING: app.innerHTML = campaignPlanningHTML(); initPlanningGrid(); break;
    case State.CAMPAIGN_BATTLE: app.innerHTML = campaignBattleHTML(); break;
    case State.CAMPAIGN_RESULT: app.innerHTML = campaignResultHTML(); break;
  }
}

// ═══════════════════════════════════════════════════════════════
// SCREEN TEMPLATES
// ═══════════════════════════════════════════════════════════════

function menuHTML() {
  return `
    <div class="screen menu-screen">
      <h1 class="game-title"><span>CALCULATED</span>RISK</h1>
      <p class="game-subtitle">TACTICAL DEFENSE</p>
      <button class="menu-btn" data-action="campaign">Campaign</button>
      <button class="menu-btn" data-action="endless">Endless</button>
      <button class="menu-btn" data-action="versus">Head 2 Head</button>
      <button class="menu-btn" data-action="hq">Headquarters</button>
      <button class="menu-btn secondary" data-action="settings">Settings</button>
      <button class="menu-btn secondary" data-action="stats">Statistics</button>
      <button class="menu-btn secondary" data-action="sprite-editor">Sprite Editor</button>
      <div style="margin-top:30px;font-size:0.85rem;color:var(--text-secondary)">
        <span style="color:var(--accent-yellow)">⬡ ${Game.resources.scrap}</span> ·
        <span style="color:var(--accent-blue)">◈ ${Game.resources.parts}</span>
      </div>
    </div>
  `;
}

function settingsHTML() {
  const s = Game.settings;
  return `
    <div class="screen settings-screen">
      <div class="settings-header">
        <button class="back-btn" data-action="menu">←</button>
        <h2 class="settings-title">Settings</h2>
      </div>
      <div class="setting-group">
        <div class="setting-label">Difficulty</div>
        <div class="setting-options">
          <button class="setting-btn ${s.difficulty==='easy'?'active':''}" data-set="difficulty" data-val="easy">Easy</button>
          <button class="setting-btn ${s.difficulty==='normal'?'active':''}" data-set="difficulty" data-val="normal">Normal</button>
          <button class="setting-btn ${s.difficulty==='hard'?'active':''}" data-set="difficulty" data-val="hard">Hard</button>
        </div>
      </div>
      <div class="setting-group">
        <div class="checkbox-row">
          <label>Sound</label>
          <div class="toggle ${s.sound?'active':''}" data-toggle="sound"></div>
        </div>
      </div>
    </div>
  `;
}

function statsHTML() {
  const s = Game.stats;
  return `
    <div class="screen stats-screen">
      <div class="settings-header">
        <button class="back-btn" data-action="menu">←</button>
        <h2 class="settings-title">Statistics</h2>
      </div>
      <div class="stats-section">
        <h3>Battle Record</h3>
        <div class="stat-row"><span>Games Played</span><span class="stat-value">${s.gamesPlayed}</span></div>
        <div class="stat-row"><span>High Score</span><span class="stat-value">${s.highScore.toLocaleString()}</span></div>
        <div class="stat-row"><span>Highest Wave</span><span class="stat-value">${s.highestWave}</span></div>
        <div class="stat-row"><span>Total Kills</span><span class="stat-value">${s.totalKills.toLocaleString()}</span></div>
      </div>
      <div class="stats-section">
        <h3>Resources</h3>
        <div class="stat-row"><span>Total Scrap Earned</span><span class="stat-value">${s.totalScrap.toLocaleString()}</span></div>
        <div class="stat-row"><span>Current Scrap</span><span class="stat-value">${Game.resources.scrap.toLocaleString()}</span></div>
        <div class="stat-row"><span>Current Parts</span><span class="stat-value">${Game.resources.parts}</span></div>
      </div>
    </div>
  `;
}

function matchmakingHTML() {
  return `
    <div class="screen menu-screen">
      <h2 style="font-family:'Black Ops One',cursive;color:var(--accent-blue);margin-bottom:20px">HEAD 2 HEAD</h2>
      <div style="margin-bottom:30px">
        <div class="loading-dots" style="font-size:1.2rem;color:var(--text-secondary)">
          Searching for opponent<span class="dots">...</span>
        </div>
      </div>
      <button class="menu-btn secondary" data-action="menu">Cancel</button>
    </div>
  `;
}

function countdownHTML() {
  return `
    <div class="screen menu-screen countdown-overlay">
      <div class="wave-info">WAVE ${Game.battle.wave}</div>
      <h2 id="countdown-num">${Game.battle.countdown}</h2>
      <p style="margin-top:20px;color:var(--text-secondary)">Prepare defenses!</p>
    </div>
  `;
}

function battleHTML() {
  const b = Game.battle;
  const panel = Game.subState === SubState.LANE_SELECT;

  return `
    <div class="screen game-screen">
      <div class="game-hud">
        <div class="hud-section">
          <div class="health-bar">
            <div class="health-fill" style="width:${(b.health/b.maxHealth)*100}%"></div>
            <span class="health-text">${b.health}</span>
          </div>
          <span class="hud-scrap" style="color:var(--accent-yellow);font-family:'Share Tech Mono',monospace;font-size:0.85rem">⬡ ${Game.resources.scrap}</span>
        </div>
        <span class="score-display">${b.score.toLocaleString()}</span>
        <span class="wave-display">Wave ${b.wave}</span>
        <button class="hud-btn" data-action="pause">❚❚</button>
      </div>
      <div class="battlefield">
        ${[0,1,2].map(i => `<div class="lane" data-lane="${i}"><span class="lane-number">${i+1}</span></div>`).join('')}
        <div class="base-area"><span class="base-label">◆ BASE ◆</span></div>
      </div>
      <div class="lane-selector">
        ${b.lanes.map((ln,i) => {
          const u = UNITS[ln.unit];
          const ready = ln.cooldown <= 0;
          const pct = ready ? 100 : (1 - ln.cooldown / u.deployCooldown) * 100;
          return `
            <div class="lane-slot ${b.selectedLane===i?'selected':''}" data-slot="${i}">
              ${ready ? '<div class="deploy-ready"></div>' : ''}
              <div class="unit-icon" style="color:${u.color}">${u.svg}</div>
              <div class="unit-name">${u.name}</div>
              <div class="cooldown-bar"><div class="cooldown-fill" style="width:${pct}%"></div></div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="unit-panel ${panel?'open':''}">
        ${panel ? unitPanelHTML() : ''}
      </div>
    </div>
  `;
}

function unitPanelHTML() {
  const b = Game.battle;
  const li = b.selectedLane;
  const lane = b.lanes[li];
  const u = UNITS[lane.unit];
  const ready = lane.cooldown <= 0;

  return `
    <div class="panel-header">
      <span class="panel-title">Lane ${li+1}</span>
      <button class="panel-close" data-action="close">Close</button>
    </div>
    <button class="menu-btn" style="margin:0 0 15px;padding:12px" data-action="deploy" ${ready?'':'disabled'}>
      ⚡ Deploy ${u.name}
    </button>
    <div class="setting-label">Switch Unit</div>
    <div class="unit-grid">
      ${UNITS.map((unit,i) => `
        <div class="unit-option ${lane.unit===i?'selected':''}" data-switch="${i}">
          <div class="icon" style="color:${unit.color}">${unit.svg}</div>
          <div class="name">${unit.name}</div>
          <div class="stats">DMG ${unit.damage}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function waveCompleteHTML() {
  const b = Game.battle;
  return `
    <div class="overlay wave-complete-overlay">
      <h2>WAVE ${b.wave} COMPLETE</h2>
      <div class="stats-box">
        <div class="stat-line">Enemies Destroyed: <span>${b.killed}</span></div>
        <div class="stat-line">Score: <span>${b.score.toLocaleString()}</span></div>
        <div class="stat-line">Scrap: <span>${Game.resources.scrap}</span></div>
      </div>
      <button class="menu-btn" data-action="next">Next Wave</button>
    </div>
  `;
}

function pauseHTML() {
  return `
    <div class="overlay pause-overlay">
      <h2>PAUSED</h2>
      <button class="menu-btn" data-action="resume">Resume</button>
      <button class="menu-btn secondary" data-action="quit">Quit</button>
    </div>
  `;
}

function gameOverHTML(win) {
  const b = Game.battle;
  return `
    <div class="overlay game-over-overlay ${win?'victory':''}">
      <h2>${win ? 'VICTORY!' : 'DEFEATED'}</h2>
      <div class="stats-box">
        <div class="stat-line">Final Score: <span>${b.score.toLocaleString()}</span></div>
        <div class="stat-line">Waves: <span>${win ? b.wave : b.wave - 1}</span></div>
        <div class="stat-line">Kills: <span>${Game.stats.totalKills}</span></div>
        <div class="stat-line">Scrap: <span>${Game.resources.scrap}</span></div>
      </div>
      <button class="menu-btn" data-action="play">Play Again</button>
      <button class="menu-btn secondary" data-action="menu">Menu</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// HEADQUARTERS SCREEN
// ═══════════════════════════════════════════════════════════════

function headquartersHTML() {
  const tab = Game.hqTab;
  return `
    <div class="screen hq-screen">
      <div class="hq-header">
        <button class="back-btn" data-action="menu">←</button>
        <h2 class="hq-title">HEADQUARTERS</h2>
        <div class="hq-resources">
          <span style="color:var(--accent-yellow)">⬡ ${Game.resources.scrap}</span>
          <span style="color:var(--accent-blue)">◈ ${Game.resources.parts}</span>
        </div>
      </div>
      <div class="hq-tabs">
        <button class="hq-tab ${tab===HQTab.LINEUP?'active':''}" data-hq-tab="${HQTab.LINEUP}">LINEUP</button>
        <button class="hq-tab ${tab===HQTab.UNITS?'active':''}" data-hq-tab="${HQTab.UNITS}">UNITS</button>
        <button class="hq-tab ${tab===HQTab.UPGRADES?'active':''}" data-hq-tab="${HQTab.UPGRADES}">UPGRADES</button>
      </div>
      <div class="hq-content">
        ${tab === HQTab.LINEUP ? lineupTabHTML() : ''}
        ${tab === HQTab.UNITS ? unitsTabHTML() : ''}
        ${tab === HQTab.UPGRADES ? upgradesTabHTML() : ''}
      </div>
    </div>
  `;
}

function getTypeBadges(types) {
  const typeColors = {
    infantry: '#4ade80',
    armor: '#60a5fa',
    recon: '#a3e635',
    anti_armor: '#fbbf24',
    artillery: '#fb923c',
    support: '#f87171',
    air: '#7c3aed',
    anti_air: '#22d3ee'
  };
  return types.map(t =>
    `<span class="type-badge" style="background:${typeColors[t]}">${t.replace('_', '-').toUpperCase()}</span>`
  ).join('');
}

function isUnitUnlocked(unit) {
  return unit.unlockCost === null ||
         Game.player.unlockedUnits.includes(unit.id) ||
         Game.settings.mode === 'versus';
}

function isVehicle(unit) {
  return VEHICLE_UNITS.includes(unit.id);
}

function lineupTabHTML() {
  const lineup = Game.player.lineup;
  const selectedSlot = Game.hqSelectedSlot;

  // Get unlocked units for the picker
  const unlockedUnits = UNITS.filter(u => isUnitUnlocked(u));

  return `
    <div class="lineup-container">
      <h3 class="tab-subtitle">Battle Formation</h3>
      <div class="lineup-slots">
        ${lineup.map((unitIdx, i) => {
          const unit = UNITS[unitIdx];
          const isSelected = selectedSlot === i;
          return `
            <div class="lineup-slot ${isSelected ? 'selected' : ''}" data-lineup-slot="${i}">
              <div class="slot-label">Lane ${i + 1}</div>
              <div class="slot-unit ${isVehicle(unit) ? 'vehicle' : ''}" style="color:${unit.color}">
                ${unit.svg}
              </div>
              <div class="slot-name">${unit.name}</div>
              <div class="slot-types">${getTypeBadges(unit.types)}</div>
            </div>
          `;
        }).join('')}
      </div>

      ${selectedSlot !== null ? `
        <div class="unit-picker">
          <h4>Select Unit for Lane ${selectedSlot + 1}</h4>
          <div class="picker-grid">
            ${unlockedUnits.map((unit, i) => {
              const unitIdx = UNITS.indexOf(unit);
              const isCurrentUnit = lineup[selectedSlot] === unitIdx;
              return `
                <div class="picker-unit ${isCurrentUnit ? 'current' : ''}" data-lineup-unit="${unitIdx}">
                  <div class="picker-icon ${isVehicle(unit) ? 'vehicle' : ''}" style="color:${unit.color}">${unit.svg}</div>
                  <div class="picker-name">${unit.name}</div>
                  <div class="picker-types">${getTypeBadges(unit.types)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : `
        <p class="lineup-hint">Tap a lane to change unit</p>
      `}
    </div>
  `;
}

function getTypeEffectiveness(unitTypes) {
  const strong = new Set();
  const weak = new Set();
  for (const type of unitTypes) {
    const chart = TYPE_CHART[type];
    if (chart) {
      chart.strong.forEach(t => strong.add(t));
      chart.weak.forEach(t => weak.add(t));
    }
  }
  return { strong: [...strong], weak: [...weak] };
}

function formatTypeName(type) {
  return type.replace('_', '-').toUpperCase();
}

function unitDetailsHTML(unitIdx) {
  const unit = UNITS[unitIdx];
  const unlocked = isUnitUnlocked(unit);
  const effectiveness = getTypeEffectiveness(unit.types);
  const projType = UNIT_PROJECTILES[unit.id];
  const projDef = PROJECTILES[projType];
  const description = UNIT_DESCRIPTIONS[unit.id] || '';

  // Calculate DPS
  const dps = (unit.damage / (unit.fireRate / 1000)).toFixed(1);

  // Get upgrade info
  const upgrades = Game.player.upgrades[unit.id] || { damage: 0, fireRate: 0 };
  const dmgLevel = upgrades.damage;
  const rateLevel = upgrades.fireRate;
  const currentDmg = unit.upgrades.damage.levels[dmgLevel];
  const currentRate = unit.upgrades.fireRate.levels[rateLevel];
  const currentDps = (currentDmg / (currentRate / 1000)).toFixed(1);

  const canAfford = unit.unlockCost &&
    Game.resources.scrap >= unit.unlockCost.scrap &&
    Game.resources.parts >= unit.unlockCost.parts;

  return `
    <div class="unit-details">
      <button class="details-close" data-close-details>&times;</button>
      <div class="details-header">
        <div class="details-icon ${VEHICLE_UNITS.includes(unit.id) ? 'vehicle' : ''}" style="color:${unit.color}">
          ${getAnimatedSvg(unit, 'details-anim')}
        </div>
        <div class="details-title">
          <h2>${unit.name}</h2>
          <div class="details-types">${getTypeBadges(unit.types)}</div>
        </div>
      </div>

      <p class="details-desc">${description}</p>

      <div class="details-section">
        <h4>Combat Stats</h4>
        <div class="details-stats">
          <div class="stat-row">
            <span class="stat-label">Damage</span>
            <span class="stat-value">${unlocked ? currentDmg : unit.damage}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Fire Rate</span>
            <span class="stat-value">${((unlocked ? currentRate : unit.fireRate) / 1000).toFixed(2)}s</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">DPS</span>
            <span class="stat-value">${unlocked ? currentDps : dps}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Deploy CD</span>
            <span class="stat-value">${(unit.deployCooldown / 1000).toFixed(1)}s</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">H2H Cost</span>
            <span class="stat-value">${UNIT_COSTS[unit.id]} pts</span>
          </div>
        </div>
      </div>

      <div class="details-section">
        <h4>Firing Range</h4>
        <div class="firing-range" data-range-unit="${UNITS.indexOf(unit)}">
          <div class="range-field">
            <div class="range-unit" style="color:${unit.color}">
              ${getAnimatedSvg(unit, 'range-unit')}
            </div>
            <div class="range-targets">
              <div class="range-target" data-target="0">
                <svg viewBox="0 0 50 50" fill="none" stroke="#f87171" stroke-width="2">
                  <rect x="8" y="15" width="34" height="22" rx="2"/>
                  <rect x="15" y="8" width="18" height="10" rx="1"/>
                  <rect x="8" y="37" width="34" height="8" rx="1"/>
                </svg>
              </div>
              <div class="range-target" data-target="1">
                <svg viewBox="0 0 50 50" fill="none" stroke="#facc15" stroke-width="2">
                  <rect x="8" y="15" width="34" height="22" rx="2"/>
                  <rect x="15" y="8" width="18" height="10" rx="1"/>
                  <rect x="8" y="37" width="34" height="8" rx="1"/>
                </svg>
              </div>
              <div class="range-target" data-target="2">
                <svg viewBox="0 0 50 50" fill="none" stroke="#a78bfa" stroke-width="2">
                  <rect x="8" y="15" width="34" height="22" rx="2"/>
                  <rect x="15" y="8" width="18" height="10" rx="1"/>
                  <rect x="8" y="37" width="34" height="8" rx="1"/>
                </svg>
              </div>
            </div>
            <div class="range-projectiles"></div>
          </div>
          <div class="range-info">
            <span class="range-hint">Tap targets to fire!</span>
            <span class="range-stats">${projType.toUpperCase()} | ${(unit.fireRate / 1000).toFixed(2)}s</span>
          </div>
        </div>
      </div>

      <div class="details-section">
        <h4>Type Effectiveness</h4>
        <div class="effectiveness-row">
          <span class="eff-label strong">Strong vs:</span>
          <span class="eff-types">${effectiveness.strong.length > 0 ? effectiveness.strong.map(t => `<span class="eff-badge strong">${formatTypeName(t)}</span>`).join('') : '<span class="eff-none">None</span>'}</span>
        </div>
        <div class="effectiveness-row">
          <span class="eff-label weak">Weak vs:</span>
          <span class="eff-types">${effectiveness.weak.length > 0 ? effectiveness.weak.map(t => `<span class="eff-badge weak">${formatTypeName(t)}</span>`).join('') : '<span class="eff-none">None</span>'}</span>
        </div>
      </div>

      ${!unlocked ? `
        <div class="details-unlock">
          <div class="unlock-cost-lg">
            <span style="color:var(--accent-yellow)">⬡ ${unit.unlockCost.scrap}</span>
            <span style="color:var(--accent-blue)">◈ ${unit.unlockCost.parts}</span>
          </div>
          <button class="unlock-btn-lg ${canAfford ? '' : 'disabled'}" data-unlock="${unit.id}">
            ${canAfford ? 'UNLOCK UNIT' : 'INSUFFICIENT RESOURCES'}
          </button>
        </div>
      ` : `
        <div class="details-status unlocked">UNLOCKED</div>
      `}
    </div>
  `;
}

function unitsTabHTML() {
  const selectedIdx = Game.hqSelectedUnit;

  return `
    <div class="units-container">
      <h3 class="tab-subtitle">Unit Roster</h3>
      <p class="tab-hint">Tap a unit for details</p>
      <div class="units-grid">
        ${UNITS.map((unit, idx) => {
          const unlocked = isUnitUnlocked(unit);

          return `
            <div class="unit-card ${unlocked ? '' : 'locked'}" data-unit-idx="${idx}">
              <div class="unit-card-icon" style="color:${unit.color}">${getAnimatedSvg(unit)}</div>
              <div class="unit-card-name">${unit.name}</div>
              <div class="unit-card-types">${getTypeBadges(unit.types)}</div>
              ${!unlocked ? '<div class="unit-card-locked-badge">LOCKED</div>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ${selectedIdx !== null ? `
      <div class="unit-details-overlay">
        <div class="unit-details-modal">
          ${unitDetailsHTML(selectedIdx)}
        </div>
      </div>
    ` : ''}
  `;
}

function upgradesTabHTML() {
  const unlockedUnits = UNITS.filter(u => isUnitUnlocked(u));

  return `
    <div class="upgrades-container">
      <h3 class="tab-subtitle">Unit Upgrades</h3>
      ${unlockedUnits.length === 0 ? `
        <p class="no-units">No units unlocked yet. Unlock units in the UNITS tab first.</p>
      ` : `
        <div class="upgrades-list">
          ${unlockedUnits.map(unit => {
            const upgrades = Game.player.upgrades[unit.id] || { damage: 0, fireRate: 0 };
            const dmgLevel = upgrades.damage;
            const rateLevel = upgrades.fireRate;
            const dmgData = unit.upgrades.damage;
            const rateData = unit.upgrades.fireRate;

            const dmgCurrent = dmgData.levels[dmgLevel];
            const dmgNext = dmgLevel < dmgData.levels.length - 1 ? dmgData.levels[dmgLevel + 1] : null;
            const dmgCost = dmgLevel < dmgData.costs.length - 1 ? dmgData.costs[dmgLevel + 1] : null;
            const canAffordDmg = dmgCost && Game.resources.scrap >= dmgCost;

            const rateCurrent = rateData.levels[rateLevel];
            const rateNext = rateLevel < rateData.levels.length - 1 ? rateData.levels[rateLevel + 1] : null;
            const rateCost = rateLevel < rateData.costs.length - 1 ? rateData.costs[rateLevel + 1] : null;
            const canAffordRate = rateCost && Game.resources.scrap >= rateCost;

            return `
              <div class="upgrade-card">
                <div class="upgrade-header">
                  <div class="upgrade-icon" style="color:${unit.color}">${getAnimatedSvg(unit)}</div>
                  <div class="upgrade-info">
                    <div class="upgrade-name">${unit.name}</div>
                    <div class="upgrade-types">${getTypeBadges(unit.types)}</div>
                  </div>
                </div>
                <div class="upgrade-stats">
                  <div class="upgrade-stat">
                    <span class="stat-label">Damage</span>
                    <span class="stat-value">${dmgCurrent}</span>
                    ${dmgNext !== null ? `
                      <button class="upgrade-btn ${canAffordDmg ? '' : 'disabled'}" data-upgrade="${unit.id}:damage">
                        → ${dmgNext} (⬡${dmgCost})
                      </button>
                    ` : `<span class="maxed">MAX</span>`}
                  </div>
                  <div class="upgrade-stat">
                    <span class="stat-label">Fire Rate</span>
                    <span class="stat-value">${rateCurrent}ms</span>
                    ${rateNext !== null ? `
                      <button class="upgrade-btn ${canAffordRate ? '' : 'disabled'}" data-upgrade="${unit.id}:fireRate">
                        → ${rateNext}ms (⬡${rateCost})
                      </button>
                    ` : `<span class="maxed">MAX</span>`}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// H2H SCREENS
// ═══════════════════════════════════════════════════════════════

function getWaveCostUI(wave) {
  return wave.lanes.reduce((sum, unitIdx) => {
    if (unitIdx === null) return sum;
    return sum + UNIT_COSTS[UNITS[unitIdx].id];
  }, 0);
}

function h2hDesignHTML() {
  const h2h = Game.h2h;
  const remaining = h2h.budget - h2h.spent;
  const unlockedUnits = UNITS.filter(u => isUnitUnlocked(u));

  // Selected wave and lane for the unit picker
  const selWave = h2h.selectedWave;
  const selLane = Game.h2hWaveLane;

  // Check if any wave has at least one unit
  const hasUnits = h2h.playerAttack.some(w => w.lanes.some(l => l !== null));

  return `
    <div class="screen h2h-design-screen">
      <div class="h2h-header">
        <button class="back-btn" data-action="menu">←</button>
        <div class="h2h-round-info">
          <span class="round-label">ROUND ${h2h.round}/${h2h.bestOf}</span>
          <span class="score-label">${h2h.score.player} - ${h2h.score.ai}</span>
        </div>
        <div class="budget-display">
          <span class="budget-remaining ${remaining < 50 ? 'low' : ''}">${remaining}</span>
          <span class="budget-total">/ ${h2h.budget} pts</span>
        </div>
      </div>

      <div class="h2h-content">
        <section class="attack-section">
          <div class="section-header">
            <h3 class="section-title">ATTACK WAVES</h3>
            <button class="add-wave-btn-small" data-action="add-wave">+ ADD</button>
          </div>

          <div class="wave-list">
            ${h2h.playerAttack.map((wave, waveIdx) => {
              const waveCost = getWaveCostUI(wave);
              return `
                <div class="wave-row">
                  <div class="wave-row-header">
                    <span class="wave-num">Wave ${waveIdx + 1}</span>
                    <span class="wave-cost">${waveCost} pts</span>
                    <button class="wave-remove" data-wave-remove="${waveIdx}">×</button>
                  </div>
                  <div class="wave-slots">
                    ${wave.lanes.map((unitIdx, laneIdx) => {
                      const unit = unitIdx !== null ? UNITS[unitIdx] : null;
                      const isSelected = selWave === waveIdx && selLane === laneIdx;
                      return `
                        <div class="wave-slot ${unit ? 'filled' : ''} ${isSelected ? 'selected' : ''}"
                             data-wave-slot="${waveIdx}-${laneIdx}">
                          <div class="slot-label">L${laneIdx + 1}</div>
                          ${unit ? `
                            <div class="slot-unit ${isVehicle(unit) ? 'vehicle' : ''}" style="color:${unit.color}">${getAnimatedSvg(unit)}</div>
                            <div class="slot-name">${unit.name}</div>
                          ` : `
                            <div class="slot-empty">+</div>
                          `}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          ${selWave !== null && selLane !== undefined ? `
            <div class="lane-picker">
              <div class="lane-picker-header">
                Wave ${selWave + 1}, Lane ${selLane + 1}
              </div>
              <div class="lane-picker-units">
                <button class="pick-unit-btn" data-set-lane="${selWave}-${selLane}-none">
                  <span class="pick-clear">×</span>
                  <span>None</span>
                </button>
                ${unlockedUnits.map(u => {
                  const uIdx = UNITS.indexOf(u);
                  const cost = UNIT_COSTS[u.id];
                  const currentUnit = h2h.playerAttack[selWave]?.lanes[selLane];
                  const currentCost = currentUnit !== null ? UNIT_COSTS[UNITS[currentUnit].id] : 0;
                  const netCost = cost - currentCost;
                  const canAfford = netCost <= remaining;
                  const isSelected = currentUnit === uIdx;
                  return `
                    <button class="pick-unit-btn ${isSelected ? 'current' : ''} ${canAfford || isSelected ? '' : 'disabled'}"
                            data-set-lane="${selWave}-${selLane}-${uIdx}"
                            ${canAfford || isSelected ? '' : 'disabled'}>
                      <div class="pick-unit-icon ${isVehicle(u) ? 'vehicle' : ''}" style="color:${u.color}">${getAnimatedSvg(u)}</div>
                      <span>${u.name}</span>
                      <span class="pick-unit-cost">${cost}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}
        </section>

        <section class="defense-section">
          <h3 class="section-title">DEFENSE LINEUP</h3>
          <div class="defense-lanes">
            ${h2h.playerDefense.map((unitIdx, i) => {
              const unit = UNITS[unitIdx];
              const isSelected = Game.h2hDefenseSlot === i;
              return `
                <div class="defense-slot ${isSelected ? 'selected' : ''}" data-h2h-defense-slot="${i}">
                  <div class="defense-label">Lane ${i + 1}</div>
                  <div class="defense-unit ${isVehicle(unit) ? 'vehicle' : ''}" style="color:${unit.color}">${getAnimatedSvg(unit)}</div>
                  <div class="defense-name">${unit.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          ${Game.h2hDefenseSlot !== undefined ? `
            <div class="lane-picker">
              <div class="lane-picker-header">Defense Lane ${Game.h2hDefenseSlot + 1}</div>
              <div class="lane-picker-units">
                ${unlockedUnits.map(unit => {
                  const unitIdx = UNITS.indexOf(unit);
                  const isSelected = h2h.playerDefense[Game.h2hDefenseSlot] === unitIdx;
                  return `
                    <button class="pick-unit-btn ${isSelected ? 'current' : ''}" data-h2h-defense-unit="${unitIdx}">
                      <div class="pick-unit-icon ${isVehicle(unit) ? 'vehicle' : ''}" style="color:${unit.color}">${getAnimatedSvg(unit)}</div>
                      <span>${unit.name}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}
        </section>
      </div>

      <div class="h2h-footer">
        <button class="menu-btn h2h-start ${!hasUnits ? 'disabled' : ''}"
                data-action="h2h-start"
                ${!hasUnits ? 'disabled' : ''}>
          START BATTLE
        </button>
      </div>
    </div>
  `;
}

function h2hBattleHTML() {
  const h2h = Game.h2h;

  return `
    <div class="screen h2h-battle-screen">
      <div class="h2h-battle-hud">
        <div class="h2h-score-display">
          <span class="player-score">YOU: ${h2h.score.player}</span>
          <span class="round-indicator">Round ${h2h.round}</span>
          <span class="ai-score">AI: ${h2h.score.ai}</span>
        </div>
      </div>

      <div class="h2h-dual-field">
        <div class="ai-base">
          <div class="base-label">AI BASE</div>
          <div class="hp-bar ai-hp-bar">
            <div class="hp-fill ai-hp-fill" style="width:${h2h.aiHP}%"></div>
            <span class="hp-text ai-hp-text">${Math.ceil(h2h.aiHP)}</span>
          </div>
          <div class="defense-row">
            ${h2h.aiDefense.map((unitIdx, i) => {
              const unit = UNITS[unitIdx];
              return `
                <div class="defender-slot">
                  <div class="defender-icon">${getEntitySvg(unit, 'enemy')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="h2h-battlefield">
          <div class="lane h2h-lane" data-lane="0"></div>
          <div class="lane h2h-lane" data-lane="1"></div>
          <div class="lane h2h-lane" data-lane="2"></div>
        </div>

        <div class="player-base">
          <div class="defense-row">
            ${h2h.playerDefense.map((unitIdx, i) => {
              const unit = UNITS[unitIdx];
              return `
                <div class="defender-slot">
                  <div class="defender-icon">${getEntitySvg(unit, 'player')}</div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="hp-bar player-hp-bar">
            <div class="hp-fill player-hp-fill" style="width:${h2h.playerHP}%"></div>
            <span class="hp-text player-hp-text">${Math.ceil(h2h.playerHP)}</span>
          </div>
          <div class="base-label">YOUR BASE</div>
        </div>
      </div>
    </div>
  `;
}

function h2hResultHTML() {
  const h2h = Game.h2h;
  const playerWon = h2h.playerHP > h2h.aiHP;

  return `
    <div class="screen h2h-result-screen">
      <div class="result-content">
        <h2 class="round-complete">ROUND ${h2h.round} COMPLETE</h2>

        <div class="hp-comparison">
          <div class="hp-side player ${playerWon ? 'winner' : ''}">
            <div class="hp-label">YOU</div>
            <div class="hp-value">${Math.ceil(h2h.playerHP)} HP</div>
          </div>
          <div class="vs-divider">vs</div>
          <div class="hp-side ai ${!playerWon ? 'winner' : ''}">
            <div class="hp-label">AI</div>
            <div class="hp-value">${Math.ceil(h2h.aiHP)} HP</div>
          </div>
        </div>

        <div class="round-winner ${playerWon ? 'player-win' : 'ai-win'}">
          ${playerWon ? 'YOU WIN!' : 'AI WINS!'}
        </div>

        <div class="match-score">
          <span class="score-label">Match Score</span>
          <span class="score-value">${h2h.score.player} - ${h2h.score.ai}</span>
        </div>

        <button class="menu-btn" data-action="h2h-next">NEXT ROUND</button>
      </div>
    </div>
  `;
}

function h2hMatchEndHTML() {
  const h2h = Game.h2h;
  const playerWon = h2h.score.player > h2h.score.ai;

  return `
    <div class="screen h2h-match-end-screen ${playerWon ? 'victory' : 'defeat'}">
      <div class="match-end-content">
        <h2 class="match-result">${playerWon ? 'VICTORY!' : 'DEFEAT'}</h2>

        <div class="final-score">
          <span class="score-label">Final Score</span>
          <span class="score-value">${h2h.score.player} - ${h2h.score.ai}</span>
        </div>

        <div class="match-summary">
          ${playerWon
            ? `You defeated the AI in a best of ${h2h.bestOf}!`
            : `The AI won the match. Try again with a new strategy!`}
        </div>

        <button class="menu-btn" data-action="h2h-rematch">REMATCH</button>
        <button class="menu-btn secondary" data-action="menu">MENU</button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// SPRITE EDITOR
// ═══════════════════════════════════════════════════════════════

function spriteEditorHTML() {
  return `
    <div class="screen sprite-editor-screen" data-tool="select">
      <div class="se-header">
        <button class="back-btn" data-action="menu">←</button>
        <h2>Sprite Editor</h2>
        <div class="se-tools">
          <button class="se-tool active" data-tool="select" title="Select (V)">↖</button>
          <button class="se-tool" data-tool="line" title="Line (L)">╱</button>
          <button class="se-tool" data-tool="rect" title="Rectangle (R)">▢</button>
          <button class="se-tool" data-tool="circle" title="Circle (C)">○</button>
          <button class="se-tool" data-tool="ellipse" title="Ellipse (E)">⬭</button>
          <button class="se-tool" data-tool="path" title="Path (P)">✎</button>
          <button class="se-tool" data-tool="fill" title="Fill (F)">◉</button>
          <button class="se-tool" data-tool="brush" title="Brush (B)">●</button>
        </div>
        <div class="se-actions">
          <button class="se-btn" id="seUndo" title="Undo">↶</button>
          <button class="se-btn" id="seRedo" title="Redo">↷</button>
          <button class="se-btn" id="seDelete" title="Delete">🗑</button>
        </div>
      </div>

      <div class="se-main">
        <div class="se-canvas-area" id="seCanvasArea">
          <div class="se-canvas-wrapper" id="seCanvasWrapper">
            <canvas id="seRefCanvas"></canvas>
            <canvas id="seDrawCanvas"></canvas>
            <canvas id="sePreviewCanvas"></canvas>
          </div>
        </div>

        <div class="se-panel">
          <div class="se-section">
            <div class="se-section-title">Reference</div>
            <input type="file" id="seRefInput" accept="image/*" style="display:none">
            <button class="se-btn-full" id="seLoadRef">Load Image</button>
            <div class="se-row">
              <label>Opacity</label>
              <input type="range" id="seRefOpacity" min="0" max="100" value="40">
            </div>
            <button class="se-btn-small" id="seClearRef">Clear</button>
            <button class="se-btn-small" id="seToggleRef">Toggle</button>
          </div>

          <div class="se-section">
            <div class="se-section-title">Canvas</div>
            <div class="se-row">
              <label>Size</label>
              <input type="number" id="seWidth" value="128" min="16" max="512">
              <span>×</span>
              <input type="number" id="seHeight" value="128" min="16" max="512">
            </div>
            <button class="se-btn-full" id="seResize">Apply Size</button>
            <div class="se-row">
              <label>Zoom</label>
              <span id="seZoomLevel">100%</span>
              <button class="se-btn-small" id="seZoomIn">+</button>
              <button class="se-btn-small" id="seZoomOut">−</button>
              <button class="se-btn-small" id="seZoomFit">Fit</button>
            </div>
          </div>

          <div class="se-section">
            <div class="se-section-title">Stroke</div>
            <div class="se-row">
              <label>Color</label>
              <input type="color" id="seStrokeColor" value="#ffffff">
              <label>Width</label>
              <input type="number" id="seStrokeWidth" value="2" min="1" max="20">
            </div>
          </div>

          <div class="se-section">
            <div class="se-section-title">Fill</div>
            <div class="se-row">
              <input type="checkbox" id="seFillEnabled">
              <label>Enable</label>
              <input type="color" id="seFillColor" value="#4ade80">
            </div>
          </div>

          <div class="se-section">
            <div class="se-section-title">Animation State</div>
            <div class="se-row">
              <select id="seStateSelect"></select>
              <button class="se-btn-small" id="seAddState">+</button>
              <button class="se-btn-small" id="seDelState">−</button>
            </div>
            <div class="se-row">
              <input type="text" id="seStateName" placeholder="State name" style="flex:1">
              <button class="se-btn-small" id="seRenameState">Rename</button>
            </div>
          </div>

          <div class="se-section">
            <div class="se-section-title">Frames</div>
            <div class="se-frames" id="seFrames"></div>
            <button class="se-btn-full" id="seAddFrame">+ Add Frame</button>
            <div class="se-row" style="margin-top:8px">
              <button class="se-btn-small" id="sePlayAnim">▶ Play</button>
              <label>Speed</label>
              <input type="range" id="seAnimSpeed" min="50" max="500" value="200">
            </div>
            <div class="se-preview-box">
              <canvas id="seAnimPreview"></canvas>
            </div>
          </div>

          <div class="se-section">
            <div class="se-section-title">Spritesheet Export</div>
            <select id="seUnitSelect">
              ${UNITS.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
            </select>
            <button class="se-btn-full se-primary" id="seExport">Export Spritesheet</button>
            <button class="se-btn-full" id="seClear">Clear Canvas</button>
          </div>
        </div>
      </div>

      <!-- Unit Customizer -->
      <div class="unit-customizer" id="unitCustomizer">
        <div class="uc-header">
          <h3>Unit Color Customizer</h3>
          <button class="uc-toggle" id="ucToggle">▼</button>
        </div>
        <div class="uc-content" id="ucContent">
          <div class="uc-unit-select">
            <label>Select Unit</label>
            <select id="ucUnitSelect">
              ${UNITS.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
            </select>
          </div>
          <div class="uc-preview" id="ucPreview"></div>
          <div class="uc-parts" id="ucParts"></div>
          <div class="uc-actions">
            <button class="se-btn-full" id="ucReset">Reset to Default</button>
            <button class="se-btn-full se-primary" id="ucSave">Save Colors</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Sprite Editor State & Logic
let seState = null;

function initSpriteEditor() {
  const canvasArea = document.getElementById('seCanvasArea');
  const wrapper = document.getElementById('seCanvasWrapper');
  const refCanvas = document.getElementById('seRefCanvas');
  const drawCanvas = document.getElementById('seDrawCanvas');
  const previewCanvas = document.getElementById('sePreviewCanvas');

  const animPreview = document.getElementById('seAnimPreview');

  seState = {
    tool: 'select',
    strokeColor: '#ffffff',
    strokeWidth: 2,
    fillEnabled: false,
    fillColor: '#4ade80',
    width: 128,
    height: 128,
    zoom: 1,
    refOpacity: 0.4,
    refVisible: true,
    // Animation states - each state has a name and frames
    states: [
      { name: 'idle', frames: [{ shapes: [] }] },
      { name: 'moving', frames: [{ shapes: [] }] },
      { name: 'firing', frames: [{ shapes: [] }] }
    ],
    currentState: 0,
    currentFrame: 0,
    selectedShape: null,
    isDrawing: false,
    startX: 0,
    startY: 0,
    history: [],
    historyIndex: -1,
    pathPoints: [],
    brushPoints: null,
    animPlaying: false,
    animFrame: 0,
    animSpeed: 200,
    animInterval: null,
    spaceHeld: false,
    refCanvas, drawCanvas, previewCanvas, wrapper, canvasArea, animPreview
  };

  // Setup animation preview canvas
  animPreview.width = seState.width;
  animPreview.height = seState.height;

  // Update state selector
  updateSEStateSelect();

  // Fit to screen initially
  fitCanvasToScreen();

  // Setup canvases
  resizeSECanvases();
  renderSE();
  updateSEFrames();
  saveHistory();

  // Event listeners
  setupSEListeners();

  // Initialize unit customizer
  initUnitCustomizer();
}

function fitCanvasToScreen() {
  const area = seState.canvasArea;
  const padding = 40;
  const availW = area.clientWidth - padding * 2;
  const availH = area.clientHeight - padding * 2;
  const scaleW = availW / seState.width;
  const scaleH = availH / seState.height;
  seState.zoom = Math.min(scaleW, scaleH, 4);
  updateZoomDisplay();
  applySEZoom();
}

function resizeSECanvases() {
  const { width, height, refCanvas, drawCanvas, previewCanvas, animPreview } = seState;
  [refCanvas, drawCanvas, previewCanvas, animPreview].forEach(c => {
    c.width = width;
    c.height = height;
  });
  applySEZoom();
}

function applySEZoom() {
  const { wrapper, width, height, zoom, refCanvas, drawCanvas, previewCanvas } = seState;
  // Set wrapper to scaled size for proper scrolling
  wrapper.style.width = (width * zoom) + 'px';
  wrapper.style.height = (height * zoom) + 'px';

  // Scale canvases using CSS (not canvas internal size)
  [refCanvas, drawCanvas, previewCanvas].forEach(c => {
    c.style.width = (width * zoom) + 'px';
    c.style.height = (height * zoom) + 'px';
  });
}

function updateZoomDisplay() {
  document.getElementById('seZoomLevel').textContent = Math.round(seState.zoom * 100) + '%';
}

function setupSEListeners() {
  const { drawCanvas, canvasArea } = seState;

  // Tools
  document.querySelectorAll('.se-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.se-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      seState.tool = btn.dataset.tool;
      seState.pathPoints = [];
      document.querySelector('.sprite-editor-screen').dataset.tool = seState.tool;
    });
  });

  // Canvas events
  drawCanvas.addEventListener('mousedown', onSEMouseDown);
  drawCanvas.addEventListener('mousemove', onSEMouseMove);
  drawCanvas.addEventListener('mouseup', onSEMouseUp);
  drawCanvas.addEventListener('click', onSEClick);

  // Zoom with mouse wheel
  canvasArea.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    seState.zoom = Math.max(0.25, Math.min(8, seState.zoom * delta));
    updateZoomDisplay();
    applySEZoom();
  }, { passive: false });

  // Pan with middle mouse or space+drag
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let scrollStartX = 0, scrollStartY = 0;

  canvasArea.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && seState.spaceHeld)) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = canvasArea.scrollLeft;
      scrollStartY = canvasArea.scrollTop;
      canvasArea.classList.add('panning');
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPanning) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      canvasArea.scrollLeft = scrollStartX - dx;
      canvasArea.scrollTop = scrollStartY - dy;
    }
  });

  window.addEventListener('mouseup', e => {
    if (isPanning) {
      isPanning = false;
      canvasArea.classList.remove('panning');
    }
  });

  // Space key for pan mode
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && Game.state === State.SPRITE_EDITOR && !seState.spaceHeld) {
      seState.spaceHeld = true;
      canvasArea.style.cursor = 'grab';
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && seState.spaceHeld) {
      seState.spaceHeld = false;
      canvasArea.style.cursor = '';
    }
  });

  // Settings
  document.getElementById('seStrokeColor').addEventListener('input', e => seState.strokeColor = e.target.value);
  document.getElementById('seStrokeWidth').addEventListener('input', e => seState.strokeWidth = parseInt(e.target.value));
  document.getElementById('seFillEnabled').addEventListener('change', e => seState.fillEnabled = e.target.checked);
  document.getElementById('seFillColor').addEventListener('input', e => seState.fillColor = e.target.value);

  document.getElementById('seRefOpacity').addEventListener('input', e => {
    seState.refOpacity = e.target.value / 100;
    seState.refCanvas.style.opacity = seState.refOpacity;
  });

  // Canvas size
  document.getElementById('seResize').addEventListener('click', () => {
    seState.width = parseInt(document.getElementById('seWidth').value);
    seState.height = parseInt(document.getElementById('seHeight').value);
    resizeSECanvases();
    fitCanvasToScreen();
    renderSE();
    updateSEFrames();
  });

  // Zoom buttons
  document.getElementById('seZoomIn').addEventListener('click', () => {
    seState.zoom = Math.min(8, seState.zoom * 1.25);
    updateZoomDisplay();
    applySEZoom();
  });
  document.getElementById('seZoomOut').addEventListener('click', () => {
    seState.zoom = Math.max(0.25, seState.zoom / 1.25);
    updateZoomDisplay();
    applySEZoom();
  });
  document.getElementById('seZoomFit').addEventListener('click', fitCanvasToScreen);

  // Reference image
  document.getElementById('seLoadRef').addEventListener('click', () => {
    document.getElementById('seRefInput').click();
  });
  document.getElementById('seRefInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      const img = new Image();
      img.onload = () => {
        const ctx = seState.refCanvas.getContext('2d');
        ctx.clearRect(0, 0, seState.width, seState.height);
        ctx.drawImage(img, 0, 0, seState.width, seState.height);
      };
      img.src = URL.createObjectURL(file);
    }
  });
  document.getElementById('seClearRef').addEventListener('click', () => {
    seState.refCanvas.getContext('2d').clearRect(0, 0, seState.width, seState.height);
  });
  document.getElementById('seToggleRef').addEventListener('click', () => {
    seState.refVisible = !seState.refVisible;
    seState.refCanvas.style.display = seState.refVisible ? 'block' : 'none';
  });

  // Undo/Redo/Delete
  document.getElementById('seUndo').addEventListener('click', undoSE);
  document.getElementById('seRedo').addEventListener('click', redoSE);
  document.getElementById('seDelete').addEventListener('click', () => {
    if (seState.selectedShape !== null) {
      getCurrentFrame().shapes.splice(seState.selectedShape, 1);
      seState.selectedShape = null;
      saveHistory();
      renderSE();
      updateSEFrames();
    }
  });

  // Clear
  document.getElementById('seClear').addEventListener('click', () => {
    getCurrentFrame().shapes = [];
    saveHistory();
    renderSE();
    updateSEFrames();
  });

  // Frames
  document.getElementById('seAddFrame').addEventListener('click', () => {
    // Copy current frame to new frame
    const currentShapes = getCurrentFrame().shapes;
    const copiedShapes = JSON.parse(JSON.stringify(currentShapes));
    getCurrentFrames().push({ shapes: copiedShapes });
    seState.currentFrame = getCurrentFrames().length - 1;
    renderSE();
    updateSEFrames();
  });

  // Animation preview
  document.getElementById('sePlayAnim').addEventListener('click', toggleSEAnimation);
  document.getElementById('seAnimSpeed').addEventListener('input', e => {
    seState.animSpeed = parseInt(e.target.value);
  });

  // State management
  document.getElementById('seStateSelect').addEventListener('change', e => {
    seState.currentState = parseInt(e.target.value);
    seState.currentFrame = 0;
    seState.selectedShape = null;
    renderSE();
    updateSEFrames();
  });

  document.getElementById('seAddState').addEventListener('click', () => {
    seState.states.push({ name: `state${seState.states.length + 1}`, frames: [{ shapes: [] }] });
    seState.currentState = seState.states.length - 1;
    seState.currentFrame = 0;
    updateSEStateSelect();
    renderSE();
    updateSEFrames();
    saveHistory();
  });

  document.getElementById('seDelState').addEventListener('click', () => {
    if (seState.states.length > 1) {
      seState.states.splice(seState.currentState, 1);
      if (seState.currentState >= seState.states.length) seState.currentState = seState.states.length - 1;
      seState.currentFrame = 0;
      updateSEStateSelect();
      renderSE();
      updateSEFrames();
      saveHistory();
    }
  });

  document.getElementById('seRenameState').addEventListener('click', () => {
    const name = document.getElementById('seStateName').value.trim();
    if (name) {
      seState.states[seState.currentState].name = name;
      updateSEStateSelect();
      saveHistory();
    }
  });

  // Export
  document.getElementById('seExport').addEventListener('click', exportSESpritesheet);

  // Keyboard
  document.addEventListener('keydown', onSEKeydown);
}

function onSEKeydown(e) {
  if (Game.state !== State.SPRITE_EDITOR) return;

  if (e.ctrlKey && e.key === 'z') { undoSE(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'y') { redoSE(); e.preventDefault(); }
  if (e.key === 'Delete' && seState.selectedShape !== null) {
    getCurrentFrame().shapes.splice(seState.selectedShape, 1);
    seState.selectedShape = null;
    saveHistory();
    renderSE();
    updateSEFrames();
  }
  if (e.key === 'Escape') {
    seState.pathPoints = [];
    seState.selectedShape = null;
    renderSE();
  }

  // Tool shortcuts
  const toolKeys = { v: 'select', l: 'line', r: 'rect', c: 'circle', e: 'ellipse', p: 'path', f: 'fill', b: 'brush' };
  if (toolKeys[e.key.toLowerCase()] && !e.ctrlKey && !e.altKey) {
    const tool = toolKeys[e.key.toLowerCase()];
    seState.tool = tool;
    seState.pathPoints = [];
    document.querySelectorAll('.se-tool').forEach(b => b.classList.remove('active'));
    document.querySelector(`.se-tool[data-tool="${tool}"]`)?.classList.add('active');
    document.querySelector('.sprite-editor-screen').dataset.tool = tool;
  }
}

function getSEMousePos(e) {
  const rect = seState.drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (seState.width / rect.width),
    y: (e.clientY - rect.top) * (seState.height / rect.height)
  };
}

function onSEMouseDown(e) {
  const pos = getSEMousePos(e);
  seState.startX = pos.x;
  seState.startY = pos.y;

  if (seState.tool === 'select') {
    const shapes = getCurrentFrame().shapes;
    seState.selectedShape = null;
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], pos.x, pos.y)) {
        seState.selectedShape = i;
        break;
      }
    }
    renderSE();
    return;
  }

  if (seState.tool === 'fill') {
    floodFill(Math.floor(pos.x), Math.floor(pos.y), seState.fillColor);
    return;
  }

  if (seState.tool === 'brush') {
    seState.isDrawing = true;
    seState.brushPoints = [{ x: pos.x, y: pos.y }];
    return;
  }

  if (seState.tool === 'path') return;
  seState.isDrawing = true;
}

function onSEMouseMove(e) {
  const pos = getSEMousePos(e);

  // Move selected shape
  if (seState.tool === 'select' && seState.selectedShape !== null && e.buttons === 1) {
    const shape = getCurrentFrame().shapes[seState.selectedShape];
    const dx = pos.x - seState.startX;
    const dy = pos.y - seState.startY;
    moveSEShape(shape, dx, dy);
    seState.startX = pos.x;
    seState.startY = pos.y;
    renderSE();
    return;
  }

  if (!seState.isDrawing) return;

  // Brush tool - accumulate points and draw live
  if (seState.tool === 'brush' && seState.brushPoints) {
    seState.brushPoints.push({ x: pos.x, y: pos.y });
    const ctx = seState.previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, seState.width, seState.height);
    drawBrushStroke(ctx, seState.brushPoints, seState.strokeColor, seState.strokeWidth);
    return;
  }

  const ctx = seState.previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, seState.width, seState.height);
  const shape = createSEShape(seState.tool, seState.startX, seState.startY, pos.x, pos.y);
  if (shape) drawSEShape(ctx, shape);
}

function onSEMouseUp(e) {
  if (!seState.isDrawing) return;
  seState.isDrawing = false;

  const pos = getSEMousePos(e);
  seState.previewCanvas.getContext('2d').clearRect(0, 0, seState.width, seState.height);

  // Save brush stroke
  if (seState.tool === 'brush' && seState.brushPoints && seState.brushPoints.length > 1) {
    const shape = {
      type: 'brush',
      points: [...seState.brushPoints],
      stroke: seState.strokeColor,
      strokeWidth: seState.strokeWidth
    };
    getCurrentFrame().shapes.push(shape);
    seState.brushPoints = null;
    saveHistory();
    renderSE();
    updateSEFrames();
    return;
  }

  const shape = createSEShape(seState.tool, seState.startX, seState.startY, pos.x, pos.y);
  if (shape && (Math.abs(pos.x - seState.startX) > 2 || Math.abs(pos.y - seState.startY) > 2)) {
    getCurrentFrame().shapes.push(shape);
    saveHistory();
    renderSE();
    updateSEFrames();
  }
}

function onSEClick(e) {
  if (seState.tool !== 'path') return;

  const pos = getSEMousePos(e);
  seState.pathPoints.push({ x: pos.x, y: pos.y });

  // Double-click to finish
  if (seState.pathPoints.length >= 2) {
    const last = seState.pathPoints[seState.pathPoints.length - 1];
    const prev = seState.pathPoints[seState.pathPoints.length - 2];
    if (Math.abs(last.x - prev.x) < 5 && Math.abs(last.y - prev.y) < 5) {
      seState.pathPoints.pop();
      if (seState.pathPoints.length >= 2) {
        const shape = {
          type: 'path',
          points: [...seState.pathPoints],
          stroke: seState.strokeColor,
          strokeWidth: seState.strokeWidth,
          fill: seState.fillEnabled ? seState.fillColor : null
        };
        getCurrentFrame().shapes.push(shape);
        saveHistory();
        updateSEFrames();
      }
      seState.pathPoints = [];
      renderSE();
      return;
    }
  }

  // Draw path preview
  const ctx = seState.previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, seState.width, seState.height);
  if (seState.pathPoints.length > 0) {
    ctx.beginPath();
    ctx.moveTo(seState.pathPoints[0].x, seState.pathPoints[0].y);
    seState.pathPoints.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = seState.strokeColor;
    ctx.lineWidth = seState.strokeWidth;
    ctx.stroke();
    seState.pathPoints.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80';
      ctx.fill();
    });
  }
}

function createSEShape(type, x1, y1, x2, y2) {
  const base = { stroke: seState.strokeColor, strokeWidth: seState.strokeWidth, fill: seState.fillEnabled ? seState.fillColor : null };
  switch (type) {
    case 'line': return { type: 'line', x1, y1, x2, y2, ...base };
    case 'rect': return { type: 'rect', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), ...base };
    case 'circle': return { type: 'circle', cx: x1, cy: y1, r: Math.sqrt((x2-x1)**2 + (y2-y1)**2), ...base };
    case 'ellipse': return { type: 'ellipse', cx: (x1+x2)/2, cy: (y1+y2)/2, rx: Math.abs(x2-x1)/2, ry: Math.abs(y2-y1)/2, ...base };
    default: return null;
  }
}

function drawBrushStroke(ctx, points, color, width) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawSEShape(ctx, shape) {
  if (shape.type === 'fillData') {
    // Draw saved image data
    const img = new Image();
    img.src = shape.imageData;
    if (img.complete) {
      ctx.drawImage(img, 0, 0);
    } else {
      img.onload = () => ctx.drawImage(img, 0, 0);
    }
    return;
  }

  if (shape.type === 'brush') {
    drawBrushStroke(ctx, shape.points, shape.stroke, shape.strokeWidth);
    return;
  }

  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth = shape.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (shape.fill) ctx.fillStyle = shape.fill;

  ctx.beginPath();
  switch (shape.type) {
    case 'line': ctx.moveTo(shape.x1, shape.y1); ctx.lineTo(shape.x2, shape.y2); break;
    case 'rect': ctx.rect(shape.x, shape.y, shape.w, shape.h); break;
    case 'circle': ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2); break;
    case 'ellipse': ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2); break;
    case 'path':
      if (shape.points.length > 0) {
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        shape.points.forEach(p => ctx.lineTo(p.x, p.y));
      }
      break;
  }
  if (shape.fill) ctx.fill();
  ctx.stroke();
}

function hitTestShape(shape, x, y) {
  const m = 5;
  switch (shape.type) {
    case 'line': return distToSeg(x, y, shape.x1, shape.y1, shape.x2, shape.y2) < m + shape.strokeWidth;
    case 'rect': return x >= shape.x - m && x <= shape.x + shape.w + m && y >= shape.y - m && y <= shape.y + shape.h + m;
    case 'circle': const d = Math.sqrt((x - shape.cx)**2 + (y - shape.cy)**2); return Math.abs(d - shape.r) < m + shape.strokeWidth || (shape.fill && d < shape.r);
    case 'ellipse': const ex = (x - shape.cx) / shape.rx, ey = (y - shape.cy) / shape.ry, ed = Math.sqrt(ex*ex + ey*ey); return Math.abs(ed - 1) < 0.3 || (shape.fill && ed < 1);
    case 'path': for (let i = 1; i < shape.points.length; i++) { if (distToSeg(x, y, shape.points[i-1].x, shape.points[i-1].y, shape.points[i].x, shape.points[i].y) < m + shape.strokeWidth) return true; } return false;
    case 'brush': for (let i = 1; i < shape.points.length; i++) { if (distToSeg(x, y, shape.points[i-1].x, shape.points[i-1].y, shape.points[i].x, shape.points[i].y) < m + shape.strokeWidth) return true; } return false;
    case 'fillData': return false; // Fill areas can't be selected
    default: return false;
  }
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / (dx*dx + dy*dy || 1)));
  return Math.sqrt((px - (x1 + t*dx))**2 + (py - (y1 + t*dy))**2);
}

function moveSEShape(shape, dx, dy) {
  switch (shape.type) {
    case 'line': shape.x1 += dx; shape.y1 += dy; shape.x2 += dx; shape.y2 += dy; break;
    case 'rect': shape.x += dx; shape.y += dy; break;
    case 'circle': case 'ellipse': shape.cx += dx; shape.cy += dy; break;
    case 'path': shape.points.forEach(p => { p.x += dx; p.y += dy; }); break;
  }
}

function renderSE() {
  const ctx = seState.drawCanvas.getContext('2d');
  ctx.clearRect(0, 0, seState.width, seState.height);

  const shapes = getCurrentFrame().shapes;
  shapes.forEach((shape, i) => {
    drawSEShape(ctx, shape);
    if (i === seState.selectedShape) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const b = getSEShapeBounds(shape);
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.setLineDash([]);
    }
  });
}

function getSEShapeBounds(shape) {
  switch (shape.type) {
    case 'line': return { x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2), w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1) };
    case 'rect': return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'circle': return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
    case 'ellipse': return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
    case 'path': const pxs = shape.points.map(p => p.x), pys = shape.points.map(p => p.y); return { x: Math.min(...pxs), y: Math.min(...pys), w: Math.max(...pxs) - Math.min(...pxs), h: Math.max(...pys) - Math.min(...pys) };
    case 'brush': const bxs = shape.points.map(p => p.x), bys = shape.points.map(p => p.y); return { x: Math.min(...bxs), y: Math.min(...bys), w: Math.max(...bxs) - Math.min(...bxs), h: Math.max(...bys) - Math.min(...bys) };
    default: return { x: 0, y: 0, w: 0, h: 0 };
  }
}

// Helper to get current state's frames
function getCurrentFrames() {
  return seState.states[seState.currentState].frames;
}

function getCurrentFrame() {
  return getCurrentFrames()[seState.currentFrame];
}

function updateSEStateSelect() {
  const select = document.getElementById('seStateSelect');
  if (!select) return;
  select.innerHTML = seState.states.map((s, i) =>
    `<option value="${i}" ${i === seState.currentState ? 'selected' : ''}>${s.name}</option>`
  ).join('');
}

function updateSEFrames() {
  const frames = getCurrentFrames();
  const container = document.getElementById('seFrames');
  container.innerHTML = frames.map((frame, i) => `
    <div class="se-frame ${i === seState.currentFrame ? 'active' : ''}" data-frame="${i}">
      <canvas width="${seState.width}" height="${seState.height}"></canvas>
      <span>${i + 1}</span>
      ${frames.length > 1 ? `<button class="se-frame-del" data-del="${i}">×</button>` : ''}
    </div>
  `).join('');

  // Draw thumbnails
  frames.forEach((frame, i) => {
    const canvas = container.querySelectorAll('canvas')[i];
    if (canvas) {
      const ctx = canvas.getContext('2d');
      frame.shapes.forEach(s => drawSEShape(ctx, s));
    }
  });

  // Frame click handlers
  container.querySelectorAll('.se-frame').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('se-frame-del')) return;
      seState.currentFrame = parseInt(el.dataset.frame);
      seState.selectedShape = null;
      renderSE();
      updateSEFrames();
    });
  });

  container.querySelectorAll('.se-frame-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.del);
      const frames = getCurrentFrames();
      if (frames.length > 1) {
        frames.splice(idx, 1);
        if (seState.currentFrame >= frames.length) seState.currentFrame = frames.length - 1;
        renderSE();
        updateSEFrames();
      }
    });
  });
}

function saveHistory() {
  seState.history = seState.history.slice(0, seState.historyIndex + 1);
  seState.history.push(JSON.stringify(seState.states));
  seState.historyIndex++;
  if (seState.history.length > 50) { seState.history.shift(); seState.historyIndex--; }
}

function undoSE() {
  if (seState.historyIndex > 0) {
    seState.historyIndex--;
    seState.states = JSON.parse(seState.history[seState.historyIndex]);
    renderSE();
    updateSEFrames();
    updateSEStateSelect();
  }
}

function redoSE() {
  if (seState.historyIndex < seState.history.length - 1) {
    seState.historyIndex++;
    seState.states = JSON.parse(seState.history[seState.historyIndex]);
    renderSE();
    updateSEFrames();
    updateSEStateSelect();
  }
}

function exportSESpritesheet() {
  const frames = getCurrentFrames();
  const totalW = seState.width * frames.length;
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = seState.height;
  const ctx = canvas.getContext('2d');

  frames.forEach((frame, i) => {
    ctx.save();
    ctx.translate(i * seState.width, 0);
    frame.shapes.forEach(s => drawSEShape(ctx, s));
    ctx.restore();
  });

  const unitId = document.getElementById('seUnitSelect').value;
  const stateName = seState.states[seState.currentState].name;
  const link = document.createElement('a');
  link.download = `${unitId}-${stateName}-spritesheet.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function toggleSEAnimation() {
  const btn = document.getElementById('sePlayAnim');

  if (seState.animPlaying) {
    // Stop animation
    clearInterval(seState.animInterval);
    seState.animInterval = null;
    seState.animPlaying = false;
    btn.textContent = '▶ Play';
  } else {
    // Start animation
    seState.animPlaying = true;
    seState.animFrame = 0;
    btn.textContent = '⏹ Stop';

    renderAnimFrame();
    seState.animInterval = setInterval(() => {
      seState.animFrame = (seState.animFrame + 1) % getCurrentFrames().length;
      renderAnimFrame();
    }, seState.animSpeed);
  }
}

function renderAnimFrame() {
  const ctx = seState.animPreview.getContext('2d');
  ctx.clearRect(0, 0, seState.width, seState.height);
  const frames = getCurrentFrames();
  const frame = frames[seState.animFrame];
  if (frame) {
    frame.shapes.forEach(s => drawSEShape(ctx, s));
  }
}

function floodFill(startX, startY, fillColor) {
  const canvas = seState.drawCanvas;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, seState.width, seState.height);
  const data = imageData.data;

  // Convert hex color to RGBA
  const hex = fillColor.replace('#', '');
  const fillR = parseInt(hex.substr(0, 2), 16);
  const fillG = parseInt(hex.substr(2, 2), 16);
  const fillB = parseInt(hex.substr(4, 2), 16);
  const fillA = 255;

  // Get starting color
  const startIdx = (startY * seState.width + startX) * 4;
  const startR = data[startIdx];
  const startG = data[startIdx + 1];
  const startB = data[startIdx + 2];
  const startA = data[startIdx + 3];

  // Don't fill if same color
  if (startR === fillR && startG === fillG && startB === fillB && startA === fillA) return;

  // Tolerance for color matching
  const tolerance = 32;
  function colorMatch(idx) {
    return Math.abs(data[idx] - startR) <= tolerance &&
           Math.abs(data[idx + 1] - startG) <= tolerance &&
           Math.abs(data[idx + 2] - startB) <= tolerance &&
           Math.abs(data[idx + 3] - startA) <= tolerance;
  }

  // Flood fill using scanline algorithm
  const stack = [[startX, startY]];
  const visited = new Set();

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const key = `${x},${y}`;

    if (x < 0 || x >= seState.width || y < 0 || y >= seState.height) continue;
    if (visited.has(key)) continue;

    const idx = (y * seState.width + x) * 4;
    if (!colorMatch(idx)) continue;

    visited.add(key);

    // Fill pixel
    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = fillA;

    // Add neighbors
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  ctx.putImageData(imageData, 0, 0);

  // Save as a fill shape for history
  getCurrentFrame().shapes.push({
    type: 'fillData',
    imageData: canvas.toDataURL()
  });
  saveHistory();
  updateSEFrames();
}

// ═══════════════════════════════════════════════════════════════
// UNIT CUSTOMIZER
// ═══════════════════════════════════════════════════════════════

let ucState = {
  selectedUnit: null,
  tempColors: {},
  collapsed: false
};

function initUnitCustomizer() {
  const customizer = document.getElementById('unitCustomizer');
  const toggle = document.getElementById('ucToggle');
  const unitSelect = document.getElementById('ucUnitSelect');
  const resetBtn = document.getElementById('ucReset');
  const saveBtn = document.getElementById('ucSave');

  if (!customizer) return;

  // Start collapsed
  customizer.classList.add('collapsed');
  ucState.collapsed = true;

  // Toggle expand/collapse
  const header = customizer.querySelector('.uc-header');
  header.addEventListener('click', () => {
    ucState.collapsed = !ucState.collapsed;
    customizer.classList.toggle('collapsed', ucState.collapsed);
  });

  // Unit selection
  unitSelect.addEventListener('change', () => {
    ucState.selectedUnit = unitSelect.value;
    loadUnitColors(ucState.selectedUnit);
    renderUCPreview();
    renderUCParts();
  });

  // Reset button
  resetBtn.addEventListener('click', () => {
    if (!ucState.selectedUnit) return;
    const unit = UNITS.find(u => u.id === ucState.selectedUnit);
    if (unit && unit.defaultColors) {
      ucState.tempColors = { ...unit.defaultColors };
      renderUCPreview();
      renderUCParts();
    }
  });

  // Save button
  saveBtn.addEventListener('click', () => {
    if (!ucState.selectedUnit) return;
    // Save to Game.player.unitColors
    Game.player.unitColors[ucState.selectedUnit] = { ...ucState.tempColors };
    save();
    // Visual feedback
    saveBtn.textContent = 'Saved!';
    saveBtn.style.background = 'var(--accent-green)';
    setTimeout(() => {
      saveBtn.textContent = 'Save Colors';
      saveBtn.style.background = '';
    }, 1000);
  });

  // Initialize with first unit
  ucState.selectedUnit = UNITS[0].id;
  loadUnitColors(ucState.selectedUnit);
  renderUCPreview();
  renderUCParts();
}

function loadUnitColors(unitId) {
  const unit = UNITS.find(u => u.id === unitId);
  if (!unit) return;

  // Start with default colors
  ucState.tempColors = { ...unit.defaultColors };

  // Override with saved custom colors
  if (Game.player.unitColors[unitId]) {
    Object.assign(ucState.tempColors, Game.player.unitColors[unitId]);
  }
}

function renderUCPreview() {
  const preview = document.getElementById('ucPreview');
  if (!preview || !ucState.selectedUnit) return;

  const unit = UNITS.find(u => u.id === ucState.selectedUnit);
  if (!unit) return;

  // Get the SVG and apply custom colors
  let svg = unit.svg;
  svg = applyColorsToSvg(svg, unit, ucState.tempColors);

  preview.innerHTML = `<div class="uc-preview-svg">${svg}</div>`;
}

function renderUCParts() {
  const partsContainer = document.getElementById('ucParts');
  if (!partsContainer || !ucState.selectedUnit) return;

  const unit = UNITS.find(u => u.id === ucState.selectedUnit);
  if (!unit || !unit.parts) {
    partsContainer.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;">No customizable parts</div>';
    return;
  }

  partsContainer.innerHTML = unit.parts.map(part => {
    const color = ucState.tempColors[part] || unit.defaultColors[part] || '#888888';
    return `
      <div class="uc-part-row" data-part="${part}">
        <span class="uc-part-name">${part}</span>
        <input type="color" class="uc-color-input" data-part="${part}" value="${color}">
      </div>
    `;
  }).join('');

  // Add event listeners for color inputs
  partsContainer.querySelectorAll('.uc-color-input').forEach(input => {
    input.addEventListener('input', e => {
      const part = e.target.dataset.part;
      ucState.tempColors[part] = e.target.value;
      renderUCPreview();
    });
  });
}

// Apply custom colors to an SVG string (uses internal helper)
function applyColorsToSvg(svgString, unit, colors) {
  return applyColorsToSvgInternal(svgString, unit, colors);
}

// Export function for use in game rendering
export function getCustomizedSvg(unit) {
  const customColors = Game.player.unitColors[unit.id];
  if (!customColors || Object.keys(customColors).length === 0) {
    return unit.svg;
  }
  return applyColorsToSvg(unit.svg, unit, customColors);
}

// Export function for animated frames
export function getCustomizedSvgFrames(unit) {
  const customColors = Game.player.unitColors[unit.id];
  if (!customColors || Object.keys(customColors).length === 0 || !unit.svgFrames) {
    return unit.svgFrames;
  }
  return unit.svgFrames.map(frame => applyColorsToSvg(frame, unit, customColors));
}

// ═══════════════════════════════════════════════════════════════
// FACTION-BASED ENTITY RENDERING
// ═══════════════════════════════════════════════════════════════

// Generate enemy faction colors (red-tinted versions of default colors)
function getEnemyFactionColors(unit) {
  if (!unit.defaultColors) return {};

  const enemyColors = {};
  for (const [part, color] of Object.entries(unit.defaultColors)) {
    // Convert to HSL and shift toward red/orange
    enemyColors[part] = shiftColorToEnemy(color);
  }
  return enemyColors;
}

// Shift a hex color toward enemy faction (red/orange tint)
function shiftColorToEnemy(hexColor) {
  // Parse hex color
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Convert to HSL
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;

  let h, s;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    switch (max) {
      case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
      case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
      case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
    }
  }

  // Shift hue toward red/orange (0-30 degrees = 0-0.083)
  // Keep some variation based on original hue
  const enemyHue = (h * 0.2) * 0.083; // Compress to red-orange range
  const enemySat = Math.min(1, s * 1.2); // Slightly boost saturation

  // Convert back to RGB
  const hslToRgb = (h, s, l) => {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };

  const [nr, ng, nb] = hslToRgb(enemyHue, enemySat, l);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// Get SVG for any entity with faction-specific coloring
// faction: 'player' | 'enemy' | 'ai' (ai uses same as enemy)
export function getEntitySvg(unit, faction = 'player') {
  if (faction === 'player') {
    return getCustomizedSvg(unit);
  }

  // Enemy/AI faction - apply enemy colors
  const enemyColors = getEnemyFactionColors(unit);
  if (Object.keys(enemyColors).length === 0) {
    return unit.svg;
  }
  return applyColorsToSvg(unit.svg, unit, enemyColors);
}

// Get animated SVG frames for any entity with faction-specific coloring
export function getEntitySvgFrames(unit, faction = 'player') {
  if (faction === 'player') {
    return getCustomizedSvgFrames(unit);
  }

  // Enemy/AI faction - apply enemy colors
  if (!unit.svgFrames) return null;

  const enemyColors = getEnemyFactionColors(unit);
  if (Object.keys(enemyColors).length === 0) {
    return unit.svgFrames;
  }
  return unit.svgFrames.map(frame => applyColorsToSvg(frame, unit, enemyColors));
}

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN MODE UI
// ═══════════════════════════════════════════════════════════════

function campaignEraSelectHTML() {
  const erasHTML = CAMPAIGN_ERAS.map(era => `
    <button class="era-btn" data-action="select-era" data-era="${era.id}">
      <div class="era-name">${era.name}</div>
      <div class="era-period">${era.period}</div>
    </button>
  `).join('');

  return `
    <div class="screen campaign-screen">
      <h2>SELECT ERA</h2>
      <p class="subtitle">Choose your generation's war</p>
      <div class="era-list">
        ${erasHTML}
      </div>
      <button class="menu-btn secondary" data-action="menu">Back</button>
    </div>
  `;
}

function campaignMOSSelectHTML() {
  const c = Game.campaign;
  const era = CAMPAIGN_ERAS.find(e => e.id === c.era);

  const mosHTML = Object.entries(CAMPAIGN_MOS).map(([id, mos]) => {
    // Check if MOS is available in this era
    if (mos.minEra && c.era < mos.minEra) {
      return `
        <button class="mos-btn disabled" disabled>
          <div class="mos-name">${mos.name}</div>
          <div class="mos-locked">Unlocks Era ${mos.minEra}</div>
        </button>
      `;
    }
    return `
      <button class="mos-btn" data-action="select-mos" data-mos="${id}">
        <div class="mos-name">${mos.name}</div>
        <div class="mos-style">${mos.playstyle}</div>
      </button>
    `;
  }).join('');

  return `
    <div class="screen campaign-screen">
      <h2>${era?.name || 'Unknown Era'}</h2>
      <p class="subtitle">Select your Military Occupation</p>
      <div class="mos-list">
        ${mosHTML}
      </div>
      <button class="menu-btn secondary" data-action="campaign">Back</button>
    </div>
  `;
}

// Auto-fit grid zoom to viewport
function initPlanningGrid() {
  const plan = Game.campaign?.battlePlan;
  if (!plan || !plan.autoFitZoom) return;

  // Wait for DOM to be ready
  requestAnimationFrame(() => {
    const viewport = document.getElementById('grid-viewport');
    const grid = document.getElementById('planning-grid');
    if (!viewport || !grid) return;

    const viewportRect = viewport.getBoundingClientRect();
    const gridWidth = plan.gridWidth * plan.cellSize;
    const gridHeight = plan.gridHeight * plan.cellSize;

    // Calculate zoom to fit grid in viewport with padding
    const padding = 20;
    const zoomX = (viewportRect.width - padding * 2) / gridWidth;
    const zoomY = (viewportRect.height - padding * 2) / gridHeight;
    const fitZoom = Math.min(zoomX, zoomY, 1.0); // Don't zoom in past 100%

    plan.zoom = Math.max(0.3, fitZoom);
    plan.autoFitZoom = false; // Only auto-fit once

    // Apply zoom
    grid.style.transform = `scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px)`;

    // Update zoom display
    const zoomDisplay = document.querySelector('.grid-zoom-level');
    if (zoomDisplay) {
      zoomDisplay.textContent = `${Math.round(plan.zoom * 100)}%`;
    }
  });
}

function campaignPlanningHTML() {
  const c = Game.campaign;
  const plan = c?.battlePlan;

  if (!plan) return '<div class="screen">Loading battle plan...</div>';

  const { gridWidth, gridHeight, grid, terrain, hero, availableUnits, selectedUnit, playerStartRow, enemyEndRow } = plan;

  // Build grid HTML
  let gridHTML = '';
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cell = grid[row][col];
      const terrainType = terrain[row][col];
      const isPlayerZone = row >= playerStartRow;
      const isEnemyZone = row < enemyEndRow;
      const isNoMansLand = !isPlayerZone && !isEnemyZone;
      const isHeroCell = hero.row === row && hero.col === col;

      let cellClass = 'plan-cell';
      if (isPlayerZone) cellClass += ' player-zone';
      if (isEnemyZone) cellClass += ' enemy-zone';
      if (isNoMansLand) cellClass += ' no-mans-land';
      if (isHeroCell) cellClass += ' hero-cell';

      // Add terrain class
      if (terrainType !== 'open') {
        cellClass += ` terrain-${terrainType}`;
      }

      let cellContent = '';

      // Terrain SVG graphics - TOP DOWN VIEW (like vehicles)
      // All NML cells get terrain graphics (including 'open' as base dirt)
      if (isNoMansLand && !isHeroCell) {
        const terrainSVGs = {
          // Open: Base dirt/ground
          open: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-open-svg">
            <rect width="32" height="32" fill="#5a5045"/>
            <circle cx="6" cy="8" r="1.5" fill="#4a4035" opacity="0.5"/>
            <circle cx="20" cy="6" r="1" fill="#6a6055" opacity="0.4"/>
            <circle cx="28" cy="14" r="1.5" fill="#4a4035" opacity="0.5"/>
            <circle cx="10" cy="22" r="1" fill="#6a6055" opacity="0.4"/>
            <circle cx="24" cy="26" r="1.5" fill="#4a4035" opacity="0.5"/>
            <circle cx="16" cy="16" r="1" fill="#4a4035" opacity="0.3"/>
          </svg>`,

          // Grass: Subtle grass texture
          grass: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-grass-svg">
            <rect width="32" height="32" fill="#4a6a3a"/>
            <ellipse cx="6" cy="8" rx="3" ry="2" fill="#5a7a4a" opacity="0.6"/>
            <ellipse cx="26" cy="10" rx="3" ry="2" fill="#5a8a4a" opacity="0.5"/>
            <ellipse cx="8" cy="20" rx="2.5" ry="2" fill="#4a7040" opacity="0.6"/>
            <ellipse cx="28" cy="24" rx="2.5" ry="2" fill="#5a8050" opacity="0.5"/>
            <ellipse cx="16" cy="26" rx="3" ry="2" fill="#5a7a4a" opacity="0.6"/>
            <ellipse cx="20" cy="14" rx="2" ry="1.5" fill="#3a6030" opacity="0.5"/>
          </svg>`,

          // Brush: Top-down bush/shrub - randomized positions
          brush: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-brush-svg">
            <defs>
              <radialGradient id="bush" cx="50%" cy="50%" fx="45%" fy="40%" r="50%">
                <stop offset="0%" stop-color="#5a8a48"/>
                <stop offset="40%" stop-color="#4a7a38"/>
                <stop offset="70%" stop-color="#3a6a2a"/>
                <stop offset="100%" stop-color="#2a5a1a"/>
              </radialGradient>
            </defs>
            <!-- Dark green background -->
            <rect width="32" height="32" fill="#2a4a1a"/>
            <!-- Base layer - randomized large ellipses -->
            <ellipse cx="3" cy="5" rx="11" ry="10" fill="url(#bush)"/>
            <ellipse cx="28" cy="6" rx="12" ry="11" fill="url(#bush)"/>
            <ellipse cx="32" cy="24" rx="11" ry="13" fill="url(#bush)"/>
            <ellipse cx="6" cy="30" rx="13" ry="11" fill="url(#bush)"/>
            <ellipse cx="-3" cy="16" rx="10" ry="12" fill="url(#bush)"/>
            <!-- Middle layer - offset -->
            <ellipse cx="16" cy="3" rx="9" ry="8" fill="url(#bush)"/>
            <ellipse cx="30" cy="15" rx="10" ry="9" fill="url(#bush)"/>
            <ellipse cx="18" cy="30" rx="11" ry="9" fill="url(#bush)"/>
            <ellipse cx="2" cy="22" rx="9" ry="10" fill="url(#bush)"/>
            <!-- Top layer - scattered -->
            <ellipse cx="12" cy="10" rx="8" ry="7" fill="url(#bush)"/>
            <ellipse cx="22" cy="11" rx="7" ry="8" fill="url(#bush)"/>
            <ellipse cx="24" cy="22" rx="9" ry="8" fill="url(#bush)"/>
            <ellipse cx="10" cy="20" rx="8" ry="7" fill="url(#bush)"/>
            <ellipse cx="16" cy="16" rx="7" ry="6" fill="url(#bush)"/>
            <!-- Highlight bumps - random -->
            <ellipse cx="9" cy="8" rx="4" ry="3" fill="#5a9a52" opacity="0.6"/>
            <ellipse cx="24" cy="9" rx="3" ry="4" fill="#6aaa62" opacity="0.5"/>
            <ellipse cx="22" cy="24" rx="4" ry="3" fill="#5a9a52" opacity="0.5"/>
            <ellipse cx="8" cy="22" rx="3" ry="3" fill="#6aaa62" opacity="0.4"/>
          </svg>`,

          // Forest: Top-down tree canopy - randomized positions
          forest: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-forest-svg">
            <defs>
              <radialGradient id="canopy" cx="50%" cy="50%" fx="45%" fy="40%" r="50%">
                <stop offset="0%" stop-color="#4a7a42"/>
                <stop offset="40%" stop-color="#3a6a32"/>
                <stop offset="70%" stop-color="#2a5a25"/>
                <stop offset="100%" stop-color="#1e4a18"/>
              </radialGradient>
            </defs>
            <!-- Dark green background -->
            <rect width="32" height="32" fill="#1e3a18"/>
            <!-- Base layer - large ellipses, randomized -->
            <ellipse cx="5" cy="7" rx="12" ry="11" fill="url(#canopy)"/>
            <ellipse cx="26" cy="4" rx="14" ry="12" fill="url(#canopy)"/>
            <ellipse cx="30" cy="22" rx="13" ry="14" fill="url(#canopy)"/>
            <ellipse cx="8" cy="28" rx="15" ry="12" fill="url(#canopy)"/>
            <ellipse cx="-2" cy="18" rx="11" ry="13" fill="url(#canopy)"/>
            <!-- Middle layer - offset from base -->
            <ellipse cx="14" cy="5" rx="10" ry="9" fill="url(#canopy)"/>
            <ellipse cx="28" cy="14" rx="11" ry="10" fill="url(#canopy)"/>
            <ellipse cx="20" cy="28" rx="12" ry="10" fill="url(#canopy)"/>
            <ellipse cx="3" cy="24" rx="10" ry="11" fill="url(#canopy)"/>
            <!-- Top layer - scattered -->
            <ellipse cx="10" cy="12" rx="9" ry="8" fill="url(#canopy)"/>
            <ellipse cx="24" cy="9" rx="8" ry="9" fill="url(#canopy)"/>
            <ellipse cx="22" cy="21" rx="10" ry="9" fill="url(#canopy)"/>
            <ellipse cx="9" cy="19" rx="9" ry="8" fill="url(#canopy)"/>
            <ellipse cx="17" cy="15" rx="8" ry="7" fill="url(#canopy)"/>
            <!-- Highlight bumps - random positions -->
            <ellipse cx="7" cy="10" rx="5" ry="4" fill="#4a8a42" opacity="0.6"/>
            <ellipse cx="23" cy="7" rx="4" ry="5" fill="#5a9a52" opacity="0.5"/>
            <ellipse cx="25" cy="23" rx="5" ry="4" fill="#4a8a42" opacity="0.5"/>
            <ellipse cx="11" cy="24" rx="4" ry="4" fill="#5a9a52" opacity="0.4"/>
            <ellipse cx="18" cy="13" rx="4" ry="3" fill="#5a9a52" opacity="0.5"/>
          </svg>`,

          // High ground: Rocky ridge (tiles placed east/west on map)
          high: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-high-svg">
            <defs>
              <linearGradient id="rock" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stop-color="#3a2a1a"/>
                <stop offset="50%" stop-color="#5a4a3a"/>
                <stop offset="100%" stop-color="#7a6a58"/>
              </linearGradient>
            </defs>
            <!-- Ground background -->
            <rect width="32" height="32" fill="#5a4a3a"/>
            <!-- Base layer - large rock ellipses filling cell -->
            <ellipse cx="5" cy="7" rx="12" ry="11" fill="url(#rock)"/>
            <ellipse cx="26" cy="4" rx="14" ry="12" fill="url(#rock)"/>
            <ellipse cx="30" cy="22" rx="13" ry="14" fill="url(#rock)"/>
            <ellipse cx="8" cy="28" rx="15" ry="12" fill="url(#rock)"/>
            <ellipse cx="-2" cy="18" rx="11" ry="13" fill="url(#rock)"/>
            <!-- Middle layer -->
            <ellipse cx="14" cy="5" rx="10" ry="9" fill="url(#rock)"/>
            <ellipse cx="20" cy="26" rx="11" ry="10" fill="url(#rock)"/>
            <ellipse cx="2" cy="12" rx="9" ry="8" fill="url(#rock)"/>
            <ellipse cx="28" cy="14" rx="10" ry="9" fill="url(#rock)"/>
            <!-- Top layer -->
            <ellipse cx="16" cy="16" rx="12" ry="10" fill="url(#rock)"/>
            <ellipse cx="6" cy="22" rx="9" ry="8" fill="url(#rock)"/>
            <ellipse cx="24" cy="8" rx="8" ry="7" fill="url(#rock)"/>
            <!-- Highlight bumps -->
            <ellipse cx="7" cy="10" rx="5" ry="4" fill="#6a5a48" opacity="0.5"/>
            <ellipse cx="22" cy="6" rx="4" ry="3" fill="#7a6a58" opacity="0.5"/>
            <ellipse cx="25" cy="20" rx="5" ry="4" fill="#6a5a48" opacity="0.5"/>
            <ellipse cx="11" cy="24" rx="4" ry="4" fill="#7a6a58" opacity="0.4"/>
            <ellipse cx="18" cy="13" rx="4" ry="3" fill="#6a5a48" opacity="0.5"/>
          </svg>`,

          // Water: Solid water with subtle shading (movement penalty only)
          water: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-water-svg">
            <defs>
              <linearGradient id="water" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#2a5a75"/>
                <stop offset="50%" stop-color="#1a4a65"/>
                <stop offset="100%" stop-color="#2a5a75"/>
              </linearGradient>
            </defs>
            <rect width="32" height="32" fill="url(#water)"/>
            <!-- Subtle surface shimmer -->
            <ellipse cx="10" cy="10" rx="4" ry="2" fill="#3a6a85" opacity="0.3"/>
            <ellipse cx="24" cy="22" rx="5" ry="2" fill="#3a6a85" opacity="0.25"/>
          </svg>`,

          // Trench: Full-width dug-in position with end caps
          trench: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-trench-svg">
            <defs>
              <linearGradient id="trenchWall" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#5a4a35"/>
                <stop offset="100%" stop-color="#3a2a1a"/>
              </linearGradient>
            </defs>
            <!-- Ground -->
            <rect width="32" height="32" fill="#6a5a45"/>
            <!-- Trench dug area (full width) -->
            <rect x="0" y="10" width="32" height="12" fill="#2a1a0a"/>
            <!-- Wooden planks (floor) -->
            <rect x="0" y="14" width="32" height="4" fill="#4a3a25"/>
            <line x1="4" y1="14" x2="4" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
            <line x1="10" y1="14" x2="10" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
            <line x1="16" y1="14" x2="16" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
            <line x1="22" y1="14" x2="22" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
            <line x1="28" y1="14" x2="28" y2="18" stroke="#3a2a15" stroke-width="0.5"/>
            <!-- North wall (sandbags - continuous) -->
            <ellipse cx="3" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="10" cy="9" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="17" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="24" cy="9" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="31" cy="10" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <!-- South wall (sandbags - continuous) -->
            <ellipse cx="1" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="8" cy="23" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="15" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="22" cy="23" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <ellipse cx="29" cy="22" rx="4" ry="2.5" fill="url(#trenchWall)"/>
            <!-- End caps (left) -->
            <rect x="0" y="10" width="3" height="12" fill="#5a4a35"/>
            <ellipse cx="2" cy="12" rx="2" ry="1.5" fill="url(#trenchWall)"/>
            <ellipse cx="2" cy="16" rx="2" ry="1.5" fill="url(#trenchWall)"/>
            <ellipse cx="2" cy="20" rx="2" ry="1.5" fill="url(#trenchWall)"/>
            <!-- End caps (right) -->
            <rect x="29" y="10" width="3" height="12" fill="#5a4a35"/>
            <ellipse cx="30" cy="12" rx="2" ry="1.5" fill="url(#trenchWall)"/>
            <ellipse cx="30" cy="16" rx="2" ry="1.5" fill="url(#trenchWall)"/>
            <ellipse cx="30" cy="20" rx="2" ry="1.5" fill="url(#trenchWall)"/>
          </svg>`,

          // Pillbox facing north (player side) - bay window points up
          pillbox: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-pillbox-svg">
            <defs>
              <linearGradient id="concreteTop" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stop-color="#6a6a6a"/>
                <stop offset="100%" stop-color="#8a8a8a"/>
              </linearGradient>
              <linearGradient id="concreteSide" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stop-color="#5a5a5a"/>
                <stop offset="100%" stop-color="#3a3a3a"/>
              </linearGradient>
            </defs>
            <!-- Ground matches open terrain -->
            <rect width="32" height="32" fill="#8a7a65"/>
            <!-- Sandbags around rear/sides -->
            <ellipse cx="10" cy="28" rx="3" ry="2" fill="#5a4a35"/>
            <ellipse cx="22" cy="28" rx="3" ry="2" fill="#5a4a35"/>
            <ellipse cx="6" cy="22" rx="2" ry="3" fill="#5a4a35"/>
            <ellipse cx="26" cy="22" rx="2" ry="3" fill="#5a4a35"/>
            <!-- Shadow under structure -->
            <polygon points="8,26 24,26 24,12 20,8 16,4 12,8 8,12" fill="#2a2a2a" opacity="0.3" transform="translate(1,1)"/>
            <!-- Main body (back section) -->
            <polygon points="8,26 24,26 24,12 8,12" fill="url(#concreteSide)"/>
            <!-- Bay window (front angled section pointing north) -->
            <polygon points="8,12 12,8 16,4 20,8 24,12" fill="url(#concreteSide)"/>
            <!-- Top beveled edge -->
            <polygon points="8,24 24,24 24,12 20,8 16,4 12,8 8,12" fill="url(#concreteTop)" opacity="0.5"/>
            <!-- Roof flat top -->
            <polygon points="10,22 22,22 22,14 19,10 16,7 13,10 10,14" fill="#7a7a7a"/>
            <!-- Firing slits (facing north) -->
            <rect x="14" y="4" width="4" height="3" fill="#1a1a1a"/>
            <rect x="9" y="8" width="3" height="2" fill="#1a1a1a" transform="rotate(-30 10.5 9)"/>
            <rect x="20" y="8" width="3" height="2" fill="#1a1a1a" transform="rotate(30 21.5 9)"/>
          </svg>`,

          // Pillbox facing south (enemy side) - bay window points down
          pillboxSouth: `<svg viewBox="0 0 32 32" class="terrain-svg terrain-pillbox-svg">
            <defs>
              <linearGradient id="concreteTopS" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#6a6a6a"/>
                <stop offset="100%" stop-color="#8a8a8a"/>
              </linearGradient>
              <linearGradient id="concreteSideS" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#3a3a3a"/>
                <stop offset="100%" stop-color="#5a5a5a"/>
              </linearGradient>
            </defs>
            <!-- Ground matches open terrain -->
            <rect width="32" height="32" fill="#8a7a65"/>
            <!-- Sandbags around rear/sides -->
            <ellipse cx="10" cy="4" rx="3" ry="2" fill="#5a4a35"/>
            <ellipse cx="22" cy="4" rx="3" ry="2" fill="#5a4a35"/>
            <ellipse cx="6" cy="10" rx="2" ry="3" fill="#5a4a35"/>
            <ellipse cx="26" cy="10" rx="2" ry="3" fill="#5a4a35"/>
            <!-- Shadow under structure -->
            <polygon points="8,6 24,6 24,20 20,24 16,28 12,24 8,20" fill="#2a2a2a" opacity="0.3" transform="translate(1,1)"/>
            <!-- Main body (back section) -->
            <polygon points="8,6 24,6 24,20 8,20" fill="url(#concreteSideS)"/>
            <!-- Bay window (front angled section pointing south) -->
            <polygon points="8,20 12,24 16,28 20,24 24,20" fill="url(#concreteSideS)"/>
            <!-- Top beveled edge -->
            <polygon points="8,8 24,8 24,20 20,24 16,28 12,24 8,20" fill="url(#concreteTopS)" opacity="0.5"/>
            <!-- Roof flat top -->
            <polygon points="10,10 22,10 22,18 19,22 16,25 13,22 10,18" fill="#7a7a7a"/>
            <!-- Firing slits (facing south) -->
            <rect x="14" y="25" width="4" height="3" fill="#1a1a1a"/>
            <rect x="9" y="22" width="3" height="2" fill="#1a1a1a" transform="rotate(30 10.5 23)"/>
            <rect x="20" y="22" width="3" height="2" fill="#1a1a1a" transform="rotate(-30 21.5 23)"/>
          </svg>`
        };
        // Pick pillbox direction based on map half
        let svgKey = terrainType;
        if (terrainType === 'pillbox') {
          const midRow = Math.floor(gridHeight / 2);
          svgKey = row < midRow ? 'pillboxSouth' : 'pillbox';
        }
        cellContent = terrainSVGs[svgKey] || '';
      }

      // Check if this cell is the selected placed unit
      const isSelectedPlacedUnit = plan.selectedPlacedUnit?.row === row && plan.selectedPlacedUnit?.col === col;
      if (isSelectedPlacedUnit) {
        cellClass += ' selected-placed-unit';
        // Add path-mode-origin class when in path set mode to highlight starting position
        if (plan.pathSetMode) {
          cellClass += ' path-mode-origin';
        }
      }

      // Check if this cell is in the planned path
      const pathIdx = plan.plannedPath?.findIndex(p => p.row === row && p.col === col) ?? -1;
      const isInPath = pathIdx >= 0;
      if (isInPath) {
        cellClass += ' in-path';
      }

      // Check if this is the final target cell (last in path being set)
      const isPathTarget = plan.plannedPath?.length > 0 &&
        plan.plannedPath[plan.plannedPath.length - 1].row === row &&
        plan.plannedPath[plan.plannedPath.length - 1].col === col;
      if (isPathTarget) {
        cellClass += ' path-target';
      }

      // Check if this cell is part of the SELECTED unit's saved waypoints
      let selectedUnitWaypointIdx = -1;
      if (plan.selectedPlacedUnit && !plan.pathSetMode) {
        const { row: selRow, col: selCol } = plan.selectedPlacedUnit;
        const selectedCell = grid[selRow]?.[selCol];
        if (selectedCell?.waypoints) {
          selectedUnitWaypointIdx = selectedCell.waypoints.findIndex(wp => wp.row === row && wp.col === col);
          if (selectedUnitWaypointIdx >= 0) {
            cellClass += ' selected-unit-waypoint';
          }
          // Mark final waypoint as target
          if (selectedCell.waypoints.length > 0 &&
              selectedCell.waypoints[selectedCell.waypoints.length - 1].row === row &&
              selectedCell.waypoints[selectedCell.waypoints.length - 1].col === col) {
            cellClass += ' selected-unit-waypoint-target';
          }
        }
      }

      if (isHeroCell) {
        cellContent = '<div class="plan-hero">★</div>';
      } else if (cell) {
        const unit = UNITS.find(u => u.id === cell.unitId);
        if (unit) {
          const isWaypointSelected = plan.waypointUnit === cell;
          const hasWaypoints = cell.waypoints && cell.waypoints.length > 0;
          const waypointClass = isWaypointSelected ? ' waypoint-selected' : (hasWaypoints ? ' has-waypoints' : '');
          const selectedClass = isSelectedPlacedUnit ? ' unit-selected' : '';
          const pathModeClass = isSelectedPlacedUnit && plan.pathSetMode ? ' path-mode' : '';
          cellContent = `<div class="plan-unit ${cell.owner}${waypointClass}${selectedClass}${pathModeClass}" title="${unit.name}${hasWaypoints ? ' (has ' + cell.waypoints.length + ' waypoints)' : ''}">${getAnimatedSvg(unit, 'plan-unit-svg')}</div>`;
        }
      }

      // Show path number if in path (path-set mode)
      if (isInPath && !cell) {
        cellContent += `<div class="path-marker">${pathIdx + 1}</div>`;
      }

      // Show selected unit's waypoint numbers (when unit is selected, not in path-set mode)
      if (selectedUnitWaypointIdx >= 0 && !plan.pathSetMode) {
        cellContent += `<div class="waypoint-marker selected-waypoint">${selectedUnitWaypointIdx + 1}</div>`;
      }

      // Check if this cell is a waypoint target for OTHER units (not the selected one)
      // Only show when no unit is selected or when it's a different unit's waypoint
      let waypointNumber = null;
      if (!isInPath && selectedUnitWaypointIdx < 0) {
        for (let r = 0; r < gridHeight; r++) {
          for (let c = 0; c < gridWidth; c++) {
            // Skip if this is the selected unit
            if (plan.selectedPlacedUnit && r === plan.selectedPlacedUnit.row && c === plan.selectedPlacedUnit.col) {
              continue;
            }
            const srcCell = plan.grid[r]?.[c];
            if (srcCell && srcCell.waypoints) {
              const wpIdx = srcCell.waypoints.findIndex(wp => wp.row === row && wp.col === col);
              if (wpIdx >= 0) {
                waypointNumber = wpIdx + 1;
                cellContent += `<div class="waypoint-marker">${waypointNumber}</div>`;
                break;
              }
            }
          }
          if (waypointNumber) break;
        }
      }

      const terrainData = terrainType !== 'open' ? ` data-terrain="${terrainType}"` : '';
      gridHTML += `<div class="${cellClass}" data-row="${row}" data-col="${col}"${terrainData} data-action="plan-cell">${cellContent}</div>`;
    }
  }

  // Build unit roster HTML
  const rosterHTML = availableUnits.map(unit => {
    const isSelected = selectedUnit === unit.id;
    return `
      <div class="roster-unit ${isSelected ? 'selected' : ''}" data-action="select-plan-unit" data-unit="${unit.id}">
        <div class="roster-unit-icon">${getAnimatedSvg(unit, 'roster-svg')}</div>
        <div class="roster-unit-name">${unit.name}</div>
        <div class="roster-unit-count">x${unit.count}</div>
      </div>
    `;
  }).join('');

  // Doctrine selector
  const doctrines = [
    { id: 'frontal', name: 'Frontal Assault', desc: 'Direct push forward' },
    { id: 'flanking', name: 'Flanking', desc: 'Wings advance faster' },
    { id: 'defensive', name: 'Defensive', desc: 'Hold and counter' },
    { id: 'blitz', name: 'Blitzkrieg', desc: 'Fast units rush ahead' }
  ];

  const doctrineHTML = doctrines.map(d => `
    <button class="doctrine-btn ${plan.doctrine === d.id ? 'selected' : ''}"
            data-action="select-doctrine" data-doctrine="${d.id}">
      <div class="doctrine-name">${d.name}</div>
      <div class="doctrine-desc">${d.desc}</div>
    </button>
  `).join('');

  // Calculate intel status
  const totalEnemyCells = 5 * gridWidth; // Top 5 rows
  const revealedCells = plan.enemyArmy.filter(e => e.revealed).length;
  const intelPercent = plan.enemyArmy.length > 0 ? Math.round((revealedCells / plan.enemyArmy.length) * 100) : 0;

  return `
    <div class="screen planning-screen">
      <div class="intel-bar">
        <div class="intel-status">
          <span class="intel-label">ENEMY INTEL</span>
          <div class="intel-progress">
            <div class="intel-fill" style="width: ${intelPercent}%"></div>
          </div>
          <span class="intel-percent">${intelPercent}%</span>
        </div>
        <button class="intel-scout-btn" data-action="scout-enemy">
          <span class="scout-icon">🔭</span>
          <span>SCOUT</span>
        </button>
        <div class="intel-hint">Solve problems to reveal enemy positions</div>
      </div>

      <div class="planning-main">
        <div class="planning-grid-wrapper">
          <div class="planning-grid-viewport" id="grid-viewport">
            <div class="planning-grid time-${plan.timeOfDay} weather-${plan.weather}"
                 id="planning-grid"
                 style="grid-template-columns: repeat(${gridWidth}, 1fr); transform: scale(${plan.zoom}) translate(${plan.panX}px, ${plan.panY}px);">
              ${gridHTML}
            </div>
            <div class="grid-controls">
              <button class="grid-ctrl-btn" data-action="grid-zoom-in" title="Zoom In">+</button>
              <span class="grid-zoom-level">${Math.round(plan.zoom * 100)}%</span>
              <button class="grid-ctrl-btn" data-action="grid-zoom-out" title="Zoom Out">−</button>
              <button class="grid-ctrl-btn" data-action="grid-center" title="Center View">⌖</button>
              <button class="grid-ctrl-btn" data-action="grid-reset" title="Reset View">↺</button>
            </div>
          </div>
        </div>

        <div class="planning-panel">
          ${/* === PLACED UNIT DETAIL PANEL === */
          plan.selectedPlacedUnit ? (() => {
            const { row, col } = plan.selectedPlacedUnit;
            const cell = grid[row]?.[col];
            if (!cell) return '';
            const unitDef = UNITS.find(u => u.id === cell.unitId);
            if (!unitDef) return '';
            const stance = cell.stance || 'defensive';
            const hasPath = cell.waypoints && cell.waypoints.length > 0;

            return `
              <div class="placed-unit-panel ${plan.pathSetMode ? 'path-mode' : ''}">
                <div class="placed-unit-header">
                  <div class="placed-unit-icon">${getAnimatedSvg(unitDef, 'placed-svg')}</div>
                  <div class="placed-unit-info">
                    <div class="placed-unit-name">${unitDef.name}</div>
                    <div class="placed-unit-pos">Position: ${row}, ${col}</div>
                  </div>
                  <button class="placed-unit-close" data-action="close-placed-unit">×</button>
                </div>

                ${plan.pathSetMode ? `
                  <div class="path-set-controls">
                    <div class="path-set-hint">Click cells to define path (${plan.plannedPath.length} points)</div>
                    <div class="path-set-btns">
                      <button class="path-btn cancel" data-action="cancel-set-path">Cancel</button>
                      <button class="path-btn confirm" data-action="confirm-set-path">Confirm Path</button>
                    </div>
                  </div>
                ` : `
                  <div class="placed-unit-actions">
                    <button class="placed-action-btn path-btn" data-action="start-set-path">
                      <span class="btn-icon">📍</span>
                      <span>Set Path</span>
                      ${hasPath ? `<span class="path-count">(${cell.waypoints.length})</span>` : ''}
                    </button>
                    ${hasPath ? `
                      <button class="placed-action-btn clear-btn" data-action="clear-path">
                        <span class="btn-icon">🗑</span>
                        <span>Clear Path</span>
                      </button>
                    ` : ''}
                    <button class="placed-action-btn remove-btn" data-action="remove-placed-unit">
                      <span class="btn-icon">✕</span>
                      <span>Remove</span>
                    </button>
                  </div>

                  <div class="stance-selector">
                    <div class="stance-label">Stance:</div>
                    <div class="stance-options">
                      <button class="stance-btn ${stance === 'aggressive' ? 'active' : ''}" data-action="set-stance" data-stance="aggressive" title="Push forward, engage enemies">
                        ⚔️ Aggressive
                      </button>
                      <button class="stance-btn ${stance === 'defensive' ? 'active' : ''}" data-action="set-stance" data-stance="defensive" title="Hold position, return fire">
                        🛡️ Defensive
                      </button>
                      <button class="stance-btn ${stance === 'support' ? 'active' : ''}" data-action="set-stance" data-stance="support" title="Stay back, support allies">
                        ➕ Support
                      </button>
                    </div>
                  </div>
                `}
              </div>
            `;
          })() : ''}
          ${/* === NEW UNIT SELECTION PANEL (from roster) === */
          selectedUnit && selectedUnit !== 'hero' && !plan.selectedPlacedUnit ? (() => {
            const unit = availableUnits.find(u => u.id === selectedUnit);
            const unitDef = unit ? UNITS.find(u => u.id === unit.id) : null;
            if (!unitDef) return '';
            return `
              <div class="unit-detail-panel">
                <div class="unit-detail-header">
                  <div class="unit-detail-icon">${getAnimatedSvg(unitDef, 'detail-svg')}</div>
                  <div class="unit-detail-info">
                    <div class="unit-detail-name">${unitDef.name}</div>
                    <div class="unit-detail-stats">
                      <span class="stat">DMG: ${unitDef.damage}</span>
                      <span class="stat">RATE: ${(unitDef.fireRate / 1000).toFixed(1)}s</span>
                      <span class="stat">CD: ${(unitDef.deployCooldown / 1000).toFixed(0)}s</span>
                    </div>
                  </div>
                  <button class="unit-detail-close" data-action="close-unit-detail">▼</button>
                </div>
              </div>
            `;
          })() : ''}
          ${selectedUnit === 'hero' && !plan.selectedPlacedUnit ? `
            <div class="unit-detail-panel">
              <div class="unit-detail-header">
                <div class="unit-detail-icon hero-detail-icon">★</div>
                <div class="unit-detail-info">
                  <div class="unit-detail-name">Hero</div>
                  <div class="unit-detail-stats">
                    <span class="stat">Your commander on the battlefield</span>
                  </div>
                </div>
                <button class="unit-detail-close" data-action="close-unit-detail">▼</button>
              </div>
            </div>
          ` : ''}

          <div class="panel-divider-top"></div>

          <div class="panel-section units-section">
            <h3>Units</h3>
            <div class="roster-grid">
              ${rosterHTML}
              <button class="roster-unit ${selectedUnit === 'hero' ? 'selected' : ''}"
                      data-action="select-plan-unit" data-unit="hero">
                <div class="roster-unit-icon hero-icon">★</div>
                <div class="roster-unit-name">Hero</div>
              </button>
            </div>
          </div>

          <div class="panel-section tactic-section">
            <h3>Tactic</h3>
            <div class="doctrine-grid">
              ${doctrineHTML}
            </div>
          </div>

          <div class="panel-section help-section">
            <div class="help-text">
              ${plan.pathSetMode
                ? '<strong>Path Mode:</strong> Click cells to add to path. Click existing path cell to trim. Click Confirm when done.'
                : '<strong>Tip:</strong> Click a placed unit to select it and set its path and stance. Units follow their paths when battle starts.'}
            </div>
          </div>

          <div class="panel-actions">
            <button class="menu-btn secondary" data-action="plan-clear">Clear</button>
            <button class="menu-btn" data-action="plan-deploy">DEPLOY →</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function campaignBattleHTML() {
  const c = Game.campaign;
  const b = c?.heroBattle;

  if (!b) return '<div class="screen">Loading battle...</div>';

  return `
    <div class="screen campaign-battle-screen">
      <div class="campaign-top-bar">
        <div class="campaign-minimap">
          <canvas class="minimap-canvas" width="120" height="120"></canvas>
          <div class="minimap-legend">
            <span class="legend-hero">●</span> You
            <span class="legend-unit">●</span> Allies
            <span class="legend-enemy">●</span> Enemy
          </div>
        </div>
        <div class="campaign-hud">
          <div class="campaign-hp-bar">
            <div class="campaign-hp-fill" style="width: ${(b.hero.hp / b.hero.maxHP) * 100}%"></div>
            <span class="campaign-hp-text">${Math.ceil(b.hero.hp)} / ${b.hero.maxHP}</span>
          </div>
          <div class="campaign-stats">
            <span class="campaign-timer">${Math.ceil(b.timer)}s</span>
            <span class="campaign-kills">Kills: ${b.kills}</span>
            <span class="campaign-wave">Wave: ${b.wave}</span>
          </div>
        </div>
      </div>
      <div class="campaign-battlefield">
        <!-- Entities rendered by game loop -->
      </div>
      ${isMobile ? `
      <div class="mobile-controls">
        <div class="mobile-joystick-zone">
          <div class="joystick-hint">MOVE</div>
        </div>
        <div class="mobile-shoot-zone">
          <div class="shoot-hint">TAP TO SHOOT</div>
        </div>
        <div class="mobile-commands">
          <button class="mobile-cmd-btn" data-cmd="follow">👥 1</button>
          <button class="mobile-cmd-btn" data-cmd="hold">🛡️ 2</button>
          <button class="mobile-cmd-btn" data-cmd="attack">⚔️ 3</button>
          <button class="mobile-cmd-btn" data-cmd="retreat">↩️ 5</button>
        </div>
      </div>
      ` : `
      <div class="campaign-controls-hint">
        <div class="controls-row">
          <span class="control-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
          <span class="control-sep">·</span>
          <span class="control-group"><kbd>Mouse</kbd> Aim</span>
          <span class="control-sep">·</span>
          <span class="control-group"><kbd>Click</kbd> Shoot</span>
        </div>
        <div class="controls-row commands-row">
          <span class="control-group"><kbd>1</kbd> Follow</span>
          <span class="control-group"><kbd>2</kbd> Hold</span>
          <span class="control-group"><kbd>3</kbd> Attack</span>
          <span class="control-group"><kbd>4</kbd> Move</span>
          <span class="control-group"><kbd>5</kbd> Retreat</span>
          <span class="control-sep">·</span>
          <span class="control-group"><kbd>Q</kbd> Aggressive</span>
          <span class="control-group"><kbd>E</kbd> Defensive</span>
        </div>
      </div>
      `}
    </div>
  `;
}

function campaignResultHTML() {
  const c = Game.campaign;
  const b = c?.heroBattle;

  if (!b) return '<div class="screen">Loading...</div>';

  const isVictory = b.result === 'victory';

  return `
    <div class="screen campaign-result-screen">
      <h2 class="${isVictory ? 'victory-title' : 'defeat-title'}">
        ${isVictory ? 'VICTORY!' : 'DEFEATED'}
      </h2>
      <div class="result-stats">
        <p>Kills: ${b.kills}</p>
        <p>Waves Survived: ${b.wave - 1}</p>
        <p>Time: ${Math.max(0, 120 - Math.ceil(b.timer))}s</p>
      </div>
      <button class="menu-btn" data-action="campaign-continue">Continue</button>
      <button class="menu-btn secondary" data-action="menu">Main Menu</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// TACTICAL COMMAND UI
// ═══════════════════════════════════════════════════════════════

// Draw command feedback messages
export function drawCommandUI(bf, b) {
  // Draw command feedback message
  if (b.commandFeedback) {
    const age = Date.now() - b.commandFeedback.time;
    if (age < 2000) {
      let feedbackEl = bf.querySelector('.command-feedback');
      if (!feedbackEl) {
        feedbackEl = document.createElement('div');
        feedbackEl.className = 'command-feedback campaign-entity';
        feedbackEl.style.cssText = `
          position: absolute;
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          color: #fff;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: bold;
          pointer-events: none;
          border: 2px solid var(--accent-green, #4caf50);
          z-index: 200;
        `;
        bf.appendChild(feedbackEl);
      }
      feedbackEl.textContent = b.commandFeedback.text;
      feedbackEl.style.opacity = 1 - (age / 2000);
    }
  }
}
