// ═══════════════════════════════════════════════════════════════
// GAME - Battle logic, game loop, update, draw
// ═══════════════════════════════════════════════════════════════

import { State, SubState, HQTab, UNITS, ENEMIES, getTypeMultiplier, UNIT_COSTS, H2H_BUDGET, PROJECTILES, UNIT_PROJECTILES, UNIT_COMBAT_STATS, getTerrainSVG } from './constants.js';
import { Game, newBattle, newH2H, newCampaign, newCampaignBattle } from './state.js';
import { sound } from './audio.js';
import { save } from './storage.js';
import { render, setSubState, getCustomizedSvg, getCustomizedSvgFrames, getEntitySvg, getEntitySvgFrames, drawCommandUI } from './ui.js';
import {
  isBlocked,
  findTargetsInRange,
  getClosestTarget,
  createProjectile,
  updateProjectiles
} from './combat.js';
import {
  isTerrainBlocked,
  getTerrainSpeedMod,
  updateUnitAI,
  updateEnemyAI,
  issueCommand,
  AIState,
  AIBehavior,
  EnemyAIType,
  setUnitBehavior,
  setEnemyAIType,
  TacticalCommand,
  addWaypoint,
  clearWaypoints,
  setWaypointsFromGrid,
  recordDamage,
  ENTITY_RADIUS
} from './ai.js';

// Get effective unit stats with upgrades applied
function getUnitStats(unitIdx) {
  const unit = UNITS[unitIdx];
  const upgrades = Game.player.upgrades[unit.id] || { damage: 0, fireRate: 0 };

  const dmgLevel = upgrades.damage;
  const rateLevel = upgrades.fireRate;

  return {
    damage: unit.upgrades.damage.levels[dmgLevel],
    fireRate: unit.upgrades.fireRate.levels[rateLevel],
    deployCooldown: unit.deployCooldown,
    types: unit.types
  };
}

let loopId = null;
let lastT = 0;
let animFrame = 0; // Animation frame counter for track/wheel animation

// Get animated SVG frame for units with svgFrames, otherwise return static svg
// Applies faction-specific colors (player uses custom colors, enemy/ai uses enemy faction colors)
function getUnitSvg(unitDef, faction = 'player') {
  // Get faction-appropriate SVG frames if available
  const frames = getEntitySvgFrames(unitDef, faction);
  if (frames && frames.length > 0) {
    return frames[animFrame % frames.length];
  }
  // Fall back to faction-appropriate static svg
  return getEntitySvg(unitDef, faction);
}

// ═══════════════════════════════════════════════════════════════
// STATE TRANSITIONS
// ═══════════════════════════════════════════════════════════════

export function goto(newState, data = {}) {
  console.log(`[State] ${Game.state} → ${newState}`);
  const prev = Game.state;
  Game.state = newState;
  Game.subState = SubState.PLAYING;

  switch (newState) {
    case State.COUNTDOWN:
      Game.battle = newBattle();
      render();
      runCountdown();
      break;

    case State.BATTLE:
      if (prev === State.COUNTDOWN || prev === State.WAVE_COMPLETE) {
        spawnWave();
      }
      render();
      startLoop();
      break;

    case State.WAVE_COMPLETE:
      stopLoop();
      render();
      break;

    case State.PAUSED:
      stopLoop();
      render();
      break;

    case State.VICTORY:
    case State.DEFEAT:
      stopLoop();
      finishBattle();
      render();
      break;

    case State.HQ:
      Game.hqTab = Game.hqTab || HQTab.LINEUP;
      render();
      break;

    case State.H2H_DESIGN:
      if (!Game.h2h) {
        Game.h2h = newH2H();
        // Auto-add first wave so user can start designing immediately
        Game.h2h.playerAttack.push({ delay: 0, lanes: [null, null, null] });
        // Focus first lane of first wave
        Game.h2h.selectedWave = 0;
        Game.h2hWaveLane = 0;
      }
      render();
      break;

    case State.H2H_BATTLE:
      // Generate AI pattern when battle starts
      generateAIPattern();
      Game.h2h.phase = 'battle';
      render();
      startH2HLoop();
      break;

    case State.H2H_RESULT:
      stopLoop();
      Game.h2h.phase = 'result';
      render();
      break;

    case State.H2H_MATCH_END:
      stopLoop();
      Game.h2h.phase = 'result';
      render();
      break;

    // Campaign States
    case State.CAMPAIGN_ERA_SELECT:
      if (!Game.campaign) {
        Game.campaign = newCampaign();
      }
      render();
      break;

    case State.CAMPAIGN_MOS_SELECT:
      render();
      break;

    case State.CAMPAIGN_BATTLE:
      // Start campaign battle with current era, MOS, and battlePlan
      if (!Game.campaign.heroBattle) {
        Game.campaign.heroBattle = newCampaignBattle(
          Game.campaign.era,
          Game.campaign.mos,
          Game.campaign.battlePlan
        );
      }
      render();
      startCampaignLoop();
      break;

    case State.CAMPAIGN_RESULT:
      stopLoop();
      render();
      break;

    default:
      render();
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERRUPT POINTS - Where math can be injected later
// ═══════════════════════════════════════════════════════════════

function onDeploy(lane, callback) {
  // INTERRUPT: Math challenge before deploy
  callback(); // For now, just execute
}

function onSwitch(lane, unit, callback) {
  // INTERRUPT: Math challenge before switching
  callback();
}

export function onForge(item, callback) {
  // INTERRUPT: Mini-game determines quality
  callback({ quality: 'common' });
}

export function onRepair(unit, callback) {
  // INTERRUPT: Math determines repair quality
  callback({ restored: 100 });
}

export function onResearch(tech, callback) {
  // INTERRUPT: Math challenge to complete research
  callback();
}

// ═══════════════════════════════════════════════════════════════
// BATTLE LOGIC
// ═══════════════════════════════════════════════════════════════

function spawnWave() {
  const b = Game.battle;
  const wave = b.wave;
  const count = 3 + Math.floor(wave * 1.5);

  for (let i = 0; i < count; i++) {
    let type = 0;
    const r = Math.random();
    if (wave >= 5 && r > 0.9) type = 3;
    else if (wave >= 3 && r > 0.7) type = 2;
    else if (wave >= 2 && r > 0.5) type = 1;

    const def = ENEMIES[type];
    const scale = 1 + (wave - 1) * 0.12;

    b.enemies.push({
      type,
      lane: Math.floor(Math.random() * 3),
      y: -60 - i * 100,
      hp: Math.floor(def.health * scale),
      maxHp: Math.floor(def.health * scale)
    });
  }

  b.waveSize = count;
  b.killed = 0;
}

export function deploy(laneIdx) {
  const b = Game.battle;
  const lane = b.lanes[laneIdx];

  if (lane.cooldown > 0) return;

  onDeploy(laneIdx, () => {
    const def = UNITS[lane.unit];
    const bf = document.querySelector('.battlefield');
    const h = bf ? bf.offsetHeight : 400;

    lane.deployed.push({
      type: lane.unit,
      y: h - 80,
      lastShot: 0
    });

    lane.cooldown = def.deployCooldown;
    sound('deploy');
    setSubState(SubState.PLAYING);
  });
}

export function switchUnit(laneIdx, unitIdx) {
  onSwitch(laneIdx, unitIdx, () => {
    Game.battle.lanes[laneIdx].unit = unitIdx;
    render();
  });
}

function finishBattle() {
  Game.stats.gamesPlayed++;
  if (Game.battle.score > Game.stats.highScore) {
    Game.stats.highScore = Game.battle.score;
  }
  if (Game.battle.wave > Game.stats.highestWave) {
    Game.stats.highestWave = Game.battle.wave;
  }
  save();
}

// ═══════════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════════

function startLoop() {
  if (loopId) return;
  lastT = performance.now();
  loopId = requestAnimationFrame(loop);
}

export function stopLoop() {
  if (loopId) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
}

function loop(t) {
  if (Game.state !== State.BATTLE) {
    loopId = null;
    return;
  }

  const dt = t - lastT;
  lastT = t;

  // Update animation frame every ~150ms (3 frames total, cycles through)
  animFrame = Math.floor(t / 150) % 3;

  update(dt);
  draw();

  loopId = requestAnimationFrame(loop);
}

function update(dt) {
  const b = Game.battle;
  const bf = document.querySelector('.battlefield');
  const bfH = bf ? bf.offsetHeight : 400;
  const bfW = bf ? bf.offsetWidth : 300;
  const laneW = bfW / 3;
  const dtSec = dt / 1000;
  const now = Date.now();

  // Cooldowns
  b.lanes.forEach(lane => {
    if (lane.cooldown > 0) lane.cooldown = Math.max(0, lane.cooldown - dt);
  });

  // Prepare enemy data with isAir property for blocking checks
  const enemiesWithAir = b.enemies.map(e => ({
    ...e,
    isAir: ENEMIES[e.type].isAir
  }));

  // Move player units (advance toward enemies - direction: -1 = up)
  b.lanes.forEach((lane, li) => {
    // Prepare deployed units with required properties
    const deployedWithProps = lane.deployed.map(u => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      return { ...u, lane: li, isAir: combatStats?.isAir || false };
    });

    lane.deployed.forEach((u, ui) => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      if (!combatStats) return;

      const unitWithProps = { ...u, lane: li, isAir: combatStats.isAir };

      // Use shared blocking function
      u.blocked = isBlocked(unitWithProps, enemiesWithAir, -1);

      if (!u.blocked) {
        u.y = Math.max(50, u.y - combatStats.speed * dtSec);
      }
    });
  });

  // Prepare player units for enemy blocking checks
  const allPlayerUnits = b.lanes.flatMap((lane, li) =>
    lane.deployed.map(u => {
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      return { ...u, lane: li, isAir: combatStats?.isAir || false };
    })
  );

  // Move enemies (advance toward player base - direction: 1 = down)
  b.enemies.forEach(e => {
    if (e.dead) return;

    const eDef = ENEMIES[e.type];
    const enemyWithProps = { ...e, isAir: eDef.isAir };

    // Use shared blocking function
    e.blocked = isBlocked(enemyWithProps, allPlayerUnits, 1);

    if (!e.blocked) {
      e.y += eDef.speed * dt / 16;
    }

    // Reached base
    if (e.y > bfH - 50) {
      b.health -= eDef.damage;
      e.dead = true;
      sound('hit');

      if (b.health <= 0) {
        b.health = 0;
        goto(State.DEFEAT);
      }
    }
  });

  // Combat - player units fire at enemies in range
  b.lanes.forEach((lane, li) => {
    lane.deployed.forEach(u => {
      const stats = getUnitStats(u.type);
      const unitDef = UNITS[u.type];
      const combatStats = UNIT_COMBAT_STATS[unitDef.id];
      if (!combatStats) return;

      const unitWithProps = { ...u, lane: li };

      // Use shared targeting function
      const targets = findTargetsInRange(unitWithProps, enemiesWithAir, combatStats.range, -1);

      if (targets.length && now - u.lastShot > stats.fireRate) {
        const target = getClosestTarget(targets, -1);
        u.lastShot = now;

        // Create projectile using shared function
        const proj = createProjectile({
          unitId: unitDef.id,
          x: li * laneW + laneW / 2,
          y: u.y - 20,
          lane: li,
          damage: stats.damage,
          attackerTypes: stats.types,
          direction: -1,
          owner: 'player'
        });
        b.projectiles.push(proj);

        // Muzzle flash effect
        const projDef = PROJECTILES[proj.type];
        if (projDef) {
          b.effects.push({
            type: 'muzzle',
            x: li * laneW + laneW / 2,
            y: u.y - 25,
            size: projDef.muzzleFlash.size,
            color: projDef.color,
            t: now
          });
        }
        sound('shoot');
      }
    });
  });

  // Combat - enemies fire at player units in range
  b.enemies.forEach(e => {
    if (e.dead) return;

    const eDef = ENEMIES[e.type];
    if (!e.lastShot) e.lastShot = 0;

    // Find player units in this enemy's lane that are in range
    const enemyWithProps = { ...e, y: e.y };
    const targetsInLane = allPlayerUnits.filter(u => u.lane === e.lane);
    const targets = findTargetsInRange(enemyWithProps, targetsInLane, eDef.range, 1);

    // Fire rate based on enemy type (faster enemies shoot less frequently)
    const fireRate = 1500 - (eDef.speed * 100); // Slower enemies shoot faster

    if (targets.length && now - e.lastShot > fireRate) {
      e.lastShot = now;

      // Get the unit that this enemy type is based on for projectile type
      const linkedUnit = UNITS.find(u => u.id === eDef.unitId);
      const projUnitId = linkedUnit ? linkedUnit.id : 'infantry';

      const proj = createProjectile({
        unitId: projUnitId,
        x: e.lane * laneW + laneW / 2,
        y: e.y + 20,
        lane: e.lane,
        damage: eDef.damage,
        attackerTypes: eDef.types,
        direction: 1,
        owner: 'enemy'
      });
      b.projectiles.push(proj);
      sound('shoot');
    }
  });

  // Prepare player units as targets for enemy projectiles
  // Add lane property directly to units and initialize HP
  b.lanes.forEach((lane, li) => {
    lane.deployed.forEach(u => {
      u.lane = li;  // Add lane reference directly
      // Initialize HP if not set
      if (!u.hp) {
        const unitDef = UNITS[u.type];
        u.hp = unitDef.upgrades.damage.levels[0] * 5;
        u.maxHp = u.hp;
      }
    });
  });

  // Flatten for targeting (these are references, not copies)
  const playerUnitsAsTargets = b.lanes.flatMap(lane => lane.deployed);

  // Update player projectiles (hitting enemies) - using shared module
  const playerProjs = b.projectiles.filter(p => p.owner === 'player');
  const playerProjResult = updateProjectiles(
    playerProjs,
    b.enemies,
    dtSec,
    bfH,
    (target) => ENEMIES[target.type].types
  );

  // Update enemy projectiles (hitting player units) - using shared module
  const enemyProjs = b.projectiles.filter(p => p.owner === 'enemy');
  const enemyProjResult = updateProjectiles(
    enemyProjs,
    playerUnitsAsTargets,
    dtSec,
    bfH,
    (target) => UNITS[target.type].types
  );

  // No sync needed - updateProjectiles modified the original units directly

  // Combine projectile results
  b.projectiles = [...playerProjResult.projectiles, ...enemyProjResult.projectiles];
  b.effects.push(...playerProjResult.effects, ...enemyProjResult.effects);

  // Clean up dead player units
  b.lanes.forEach(lane => {
    lane.deployed = lane.deployed.filter(u => !u.dead);
  });

  // Handle kills and loot (game-specific logic)
  b.enemies.forEach(e => {
    if (e.dead && !e.looted) {
      e.looted = true;
      b.killed++;
      const eDef = ENEMIES[e.type];

      Game.resources.scrap += eDef.scrap;
      b.score += eDef.scrap * 10;
      Game.stats.totalKills++;
      Game.stats.totalScrap += eDef.scrap;

      const ex = e.lane * laneW + laneW / 2 - 15;
      b.effects.push({ type: 'loot', x: ex + 20, y: e.y - 10, text: `+${eDef.scrap}`, cls: 'scrap', t: now });

      if (Math.random() < eDef.partsChance) {
        Game.resources.parts++;
        b.effects.push({ type: 'loot', x: ex + 40, y: e.y - 10, text: '+1', cls: 'parts', t: now });
      }
    }
  });

  // Cleanup
  b.enemies = b.enemies.filter(e => !e.dead);

  // Clean up effects
  b.effects = b.effects.filter(e => {
    const age = now - e.t;
    if (e.type === 'muzzle') return age < 80;
    if (e.type === 'impact') return age < 200;
    return age < 1000;
  });

  // Wave complete?
  if (b.enemies.length === 0 && b.killed >= b.waveSize) {
    if (Game.settings.mode === 'waves' && b.wave >= 10) {
      goto(State.VICTORY);
    } else {
      goto(State.WAVE_COMPLETE);
    }
  }
}

function draw() {
  const b = Game.battle;
  const bf = document.querySelector('.battlefield');
  if (!bf) return;

  const laneW = bf.offsetWidth / 3;

  // Update HUD
  const hpFill = document.querySelector('.health-fill');
  const hpText = document.querySelector('.health-text');
  const scoreTxt = document.querySelector('.score-display');
  const scrapTxt = document.querySelector('.hud-scrap');

  if (hpFill) hpFill.style.width = `${(b.health / b.maxHealth) * 100}%`;
  if (hpText) hpText.textContent = b.health;
  if (scoreTxt) scoreTxt.textContent = b.score.toLocaleString();
  if (scrapTxt) scrapTxt.textContent = `⬡ ${Game.resources.scrap}`;

  // Update cooldown bars
  b.lanes.forEach((lane, i) => {
    const slot = document.querySelector(`[data-slot="${i}"]`);
    if (!slot) return;

    const def = UNITS[lane.unit];
    const ready = lane.cooldown <= 0;
    const pct = ready ? 100 : (1 - lane.cooldown / def.deployCooldown) * 100;

    const fill = slot.querySelector('.cooldown-fill');
    if (fill) fill.style.width = `${pct}%`;

    let dot = slot.querySelector('.deploy-ready');
    if (ready && !dot) {
      slot.insertAdjacentHTML('afterbegin', '<div class="deploy-ready"></div>');
    } else if (!ready && dot) {
      dot.remove();
    }
  });

  // Clear entities
  bf.querySelectorAll('.enemy, .unit, .explosion, .loot-drop, .projectile, .muzzle-flash, .impact').forEach(el => el.remove());

  // Draw enemies using their linked unit visuals with enemy faction colors
  b.enemies.forEach(e => {
    const enemyDef = ENEMIES[e.type];
    const unitDef = UNITS.find(u => u.id === enemyDef.unitId);

    const el = document.createElement('div');
    el.className = 'enemy';
    el.style.left = `${e.lane * laneW + (laneW - 50) / 2}px`;
    el.style.top = `${e.y}px`;
    el.style.transform = 'rotate(180deg)'; // Enemies face downward

    // Use modular rendering with enemy faction colors
    const svgContent = unitDef ? getUnitSvg(unitDef, 'enemy') : '';
    el.innerHTML = `
      ${svgContent}
      <div class="health-pip" style="transform: rotate(180deg);"><div class="health-pip-fill" style="width:${(e.hp/e.maxHp)*100}%"></div></div>
    `;
    bf.appendChild(el);
  });

  // Draw player units using player faction colors
  b.lanes.forEach((lane, li) => {
    lane.deployed.forEach(u => {
      const def = UNITS[u.type];
      const el = document.createElement('div');
      el.className = 'unit';
      el.style.left = `${li * laneW + (laneW - 50) / 2}px`;
      el.style.top = `${u.y}px`;

      // Show health bar if unit has taken damage
      const hpPercent = u.hp && u.maxHp ? (u.hp / u.maxHp) * 100 : 100;
      const showHealthBar = u.hp && u.hp < u.maxHp;

      el.innerHTML = `
        ${getUnitSvg(def, 'player')}
        ${showHealthBar ? `<div class="health-pip player-hp"><div class="health-pip-fill" style="width:${hpPercent}%"></div></div>` : ''}
      `;
      bf.appendChild(el);
    });
  });

  // Draw projectiles
  b.projectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) return;
    const el = document.createElement('div');
    el.className = 'projectile';
    el.style.left = `${p.x - projDef.width / 2}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${Math.max(projDef.width, 6)}px`;
    el.style.height = `${Math.max(projDef.height, 12)}px`;
    el.style.backgroundColor = projDef.color;
    el.style.borderRadius = '2px';
    el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}`;

    if (projDef.trail) {
      el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}, 0 ${projDef.height}px ${projDef.height * 2}px ${projDef.trailColor}`;
    }

    bf.appendChild(el);
  });

  // Draw effects
  const now = Date.now();
  b.effects.forEach(fx => {
    const age = now - fx.t;
    const el = document.createElement('div');

    if (fx.type === 'explosion') {
      el.className = 'explosion';
      el.style.left = `${fx.x}px`;
      el.style.top = `${fx.y}px`;
    } else if (fx.type === 'muzzle') {
      // Muzzle flash - very short duration
      if (age > 80) return;
      el.className = 'muzzle-flash';
      const scale = 1 - (age / 80);
      const size = fx.size * scale;
      el.style.left = `${fx.x - size / 2}px`;
      el.style.top = `${fx.y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.backgroundColor = fx.color;
      el.style.borderRadius = '50%';
      el.style.boxShadow = `0 0 ${size}px ${fx.color}, 0 0 ${size * 2}px ${fx.color}`;
      el.style.opacity = scale;
    } else if (fx.type === 'impact') {
      // Impact effect - scales with damage
      if (age > 200) return;
      el.className = 'impact';
      const scale = 1 - (age / 200);
      const size = fx.size * (1 + (1 - scale) * 0.5);
      el.style.left = `${fx.x - size / 2}px`;
      el.style.top = `${fx.y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.backgroundColor = fx.color;
      el.style.borderRadius = '50%';
      el.style.boxShadow = `0 0 ${size / 2}px ${fx.color}`;
      el.style.opacity = scale * 0.8;
    } else if (fx.type === 'loot') {
      el.className = `loot-drop ${fx.cls}`;
      el.style.left = `${fx.x}px`;
      el.style.top = `${fx.y}px`;
      el.textContent = fx.text;
    }

    bf.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════════
// COUNTDOWN
// ═══════════════════════════════════════════════════════════════

function runCountdown() {
  const interval = setInterval(() => {
    Game.battle.countdown--;
    const el = document.getElementById('countdown-num');
    if (el) el.textContent = Game.battle.countdown || 'GO!';

    if (Game.battle.countdown <= 0) {
      clearInterval(interval);
      setTimeout(() => goto(State.BATTLE), 400);
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// H2H - Head to Head Mode
// ═══════════════════════════════════════════════════════════════

// Get list of unlocked unit indices
function getUnlockedUnitIndices() {
  const unlocked = Game.player.unlockedUnits;
  return UNITS.map((u, i) => unlocked.includes(u.id) ? i : -1).filter(i => i >= 0);
}

// Calculate cost of a wave (sum of all non-null lanes)
function getWaveCost(wave) {
  return wave.lanes.reduce((sum, unitIdx) => {
    if (unitIdx === null) return sum;
    return sum + UNIT_COSTS[UNITS[unitIdx].id];
  }, 0);
}

// Recalculate total spent from all waves
function recalculateSpent() {
  const h2h = Game.h2h;
  h2h.spent = h2h.playerAttack.reduce((sum, wave) => sum + getWaveCost(wave), 0);
}

// Generate AI attack pattern and defense lineup
function generateAIPattern() {
  const h2h = Game.h2h;
  const difficulty = Game.settings.difficulty;
  const round = h2h.round;

  // Get available units (AI uses all units regardless of player unlock)
  const unitIndices = UNITS.map((_, i) => i);

  // Pick a unit based on difficulty
  function pickUnit() {
    if (difficulty === 'easy') {
      const cheapUnits = unitIndices.filter(idx => UNIT_COSTS[UNITS[idx].id] <= 25);
      return cheapUnits[Math.floor(Math.random() * cheapUnits.length)];
    } else if (difficulty === 'hard' && round > 1 && Math.random() > 0.5) {
      // Try to counter player's defense types
      const playerTypes = h2h.playerDefense.flatMap(idx => UNITS[idx].types);
      const counters = unitIndices.filter(idx => {
        const unitTypes = UNITS[idx].types;
        return unitTypes.some(t => playerTypes.some(pt => getTypeMultiplier([t], [pt]) > 1));
      });
      return counters.length > 0
        ? counters[Math.floor(Math.random() * counters.length)]
        : unitIndices[Math.floor(Math.random() * unitIndices.length)];
    }
    return unitIndices[Math.floor(Math.random() * unitIndices.length)];
  }

  // Build attack waves - each wave has all 3 lanes
  const attack = [];
  let budget = H2H_BUDGET;
  let delay = 0;

  const waveCount = difficulty === 'easy' ? 4 : difficulty === 'hard' ? 8 : 6;

  for (let i = 0; i < waveCount && budget > 0; i++) {
    const lanes = [null, null, null];
    let waveCost = 0;

    // Fill lanes randomly (more lanes filled on higher difficulty)
    const lanesToFill = difficulty === 'easy' ? 1 + Math.floor(Math.random() * 2) :
                        difficulty === 'hard' ? 2 + Math.floor(Math.random() * 2) :
                        1 + Math.floor(Math.random() * 3);

    const laneOrder = [0, 1, 2].sort(() => Math.random() - 0.5);

    for (let j = 0; j < lanesToFill && j < 3; j++) {
      const laneIdx = laneOrder[j];
      const unitIdx = pickUnit();
      const cost = UNIT_COSTS[UNITS[unitIdx].id];

      if (waveCost + cost <= budget) {
        lanes[laneIdx] = unitIdx;
        waveCost += cost;
      }
    }

    if (waveCost > 0) {
      attack.push({
        delay: delay * 1000,
        lanes
      });
      budget -= waveCost;
      delay += 2 + Math.random() * 2; // 2-4s between waves
    }
  }

  h2h.aiAttack = attack;

  // Generate defense lineup
  const defensePool = difficulty === 'easy'
    ? unitIndices.slice(0, 6)
    : unitIndices;

  h2h.aiDefense = [
    defensePool[Math.floor(Math.random() * defensePool.length)],
    defensePool[Math.floor(Math.random() * defensePool.length)],
    defensePool[Math.floor(Math.random() * defensePool.length)]
  ];
}

// H2H wave management functions

// Add a new empty wave
export function addH2HWave() {
  const h2h = Game.h2h;

  // Calculate delay based on existing waves
  const maxDelay = h2h.playerAttack.reduce((max, w) => Math.max(max, w.delay), 0);

  h2h.playerAttack.push({
    delay: h2h.playerAttack.length === 0 ? 0 : maxDelay + 2000, // 2 seconds after last wave
    lanes: [null, null, null]
  });

  return h2h.playerAttack.length - 1; // Return new wave index
}

// Remove a wave
export function removeH2HWave(index) {
  const h2h = Game.h2h;
  if (index < 0 || index >= h2h.playerAttack.length) return;

  h2h.playerAttack.splice(index, 1);
  recalculateSpent();
}

// Set a unit in a specific wave/lane (or null to clear)
export function setH2HWaveUnit(waveIndex, laneIndex, unitIdx) {
  const h2h = Game.h2h;
  if (waveIndex < 0 || waveIndex >= h2h.playerAttack.length) return false;
  if (laneIndex < 0 || laneIndex > 2) return false;

  const wave = h2h.playerAttack[waveIndex];
  const oldUnitIdx = wave.lanes[laneIndex];

  // Calculate cost change
  const oldCost = oldUnitIdx !== null ? UNIT_COSTS[UNITS[oldUnitIdx].id] : 0;
  const newCost = unitIdx !== null ? UNIT_COSTS[UNITS[unitIdx].id] : 0;
  const diff = newCost - oldCost;

  if (h2h.spent + diff > h2h.budget) {
    return false; // Would exceed budget
  }

  wave.lanes[laneIndex] = unitIdx;
  h2h.spent += diff;
  return true;
}

// Clear a lane in a wave
export function clearH2HWaveLane(waveIndex, laneIndex) {
  return setH2HWaveUnit(waveIndex, laneIndex, null);
}

export function setH2HDefense(laneIdx, unitIdx) {
  Game.h2h.playerDefense[laneIdx] = unitIdx;
}

// H2H Battle Loop
let h2hLoopId = null;
let h2hStartTime = 0;
let h2hPlayerSpawned = [];
let h2hAISpawned = [];

// Player's attacking units (going up toward AI base)
let playerAttackers = [];
// AI's attacking units (going down toward player base)
let aiAttackers = [];

function startH2HLoop() {
  if (h2hLoopId) return;

  h2hStartTime = Date.now();
  h2hPlayerSpawned = [];
  h2hAISpawned = [];
  playerAttackers = [];
  aiAttackers = [];
  h2hProjectiles = [];

  // Reset HP for this round
  Game.h2h.playerHP = 100;
  Game.h2h.aiHP = 100;

  // Reset defender shot timers
  Game.h2h.playerDefLastShot = [0, 0, 0];
  Game.h2h.aiDefLastShot = [0, 0, 0];

  lastT = performance.now();
  h2hLoopId = requestAnimationFrame(h2hLoop);
}

function stopH2HLoop() {
  if (h2hLoopId) {
    cancelAnimationFrame(h2hLoopId);
    h2hLoopId = null;
  }
}

function h2hLoop(t) {
  if (Game.state !== State.H2H_BATTLE) {
    h2hLoopId = null;
    return;
  }

  const dt = t - lastT;
  lastT = t;

  // Update animation frame every ~150ms
  animFrame = Math.floor(t / 150) % 3;

  updateH2H(dt);
  drawH2H();

  h2hLoopId = requestAnimationFrame(h2hLoop);
}

// H2H projectiles array
let h2hProjectiles = [];

function updateH2H(dt) {
  const h2h = Game.h2h;
  const elapsed = Date.now() - h2hStartTime;
  const bf = document.querySelector('.h2h-battlefield');
  const bfH = bf ? bf.offsetHeight : 400;
  const bfW = bf ? bf.offsetWidth : 300;
  const laneW = bfW / 3;
  const dtSec = dt / 1000;
  const now = Date.now();

  // Spawn player's attack waves (going toward AI base at top)
  h2h.playerAttack.forEach((wave, i) => {
    if (!h2hPlayerSpawned.includes(i) && elapsed >= wave.delay) {
      h2hPlayerSpawned.push(i);
      wave.lanes.forEach((unitIdx, laneIdx) => {
        if (unitIdx === null) return;
        const unit = UNITS[unitIdx];
        const combatStats = UNIT_COMBAT_STATS[unit.id];
        playerAttackers.push({
          unitIdx,
          lane: laneIdx,
          y: bfH - 60,
          hp: unit.upgrades.damage.levels[0] * 3,
          maxHp: unit.upgrades.damage.levels[0] * 3,
          lastShot: 0,
          isAir: combatStats.isAir
        });
      });
    }
  });

  // Spawn AI's attack waves (going toward player base at bottom)
  h2h.aiAttack.forEach((wave, i) => {
    if (!h2hAISpawned.includes(i) && elapsed >= wave.delay) {
      h2hAISpawned.push(i);
      wave.lanes.forEach((unitIdx, laneIdx) => {
        if (unitIdx === null) return;
        const unit = UNITS[unitIdx];
        const combatStats = UNIT_COMBAT_STATS[unit.id];
        aiAttackers.push({
          unitIdx,
          lane: laneIdx,
          y: 60,
          hp: unit.upgrades.damage.levels[0] * 3,
          maxHp: unit.upgrades.damage.levels[0] * 3,
          lastShot: 0,
          isAir: combatStats.isAir
        });
      });
    }
  });

  // Move player attackers up (toward AI base) - using shared blocking
  playerAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];

    a.blocked = isBlocked(a, aiAttackers, -1); // Moving up

    if (!a.blocked) {
      a.y -= combatStats.speed * dtSec;
    }

    // Reached AI base
    if (a.y < 50) {
      h2h.aiHP -= unit.upgrades.damage.levels[0];
      a.dead = true;
      sound('hit');
    }
  });

  // Move AI attackers down (toward player base) - using shared blocking
  aiAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];

    a.blocked = isBlocked(a, playerAttackers, 1); // Moving down

    if (!a.blocked) {
      a.y += combatStats.speed * dtSec;
    }

    // Reached player base
    if (a.y > bfH - 50) {
      h2h.playerHP -= unit.upgrades.damage.levels[0];
      a.dead = true;
      sound('hit');
    }
  });

  // Combat: Player attackers fire at AI attackers AND AI defenders
  playerAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];
    const stats = getUnitStats(a.unitIdx);

    // First check for AI attackers in range
    let targets = findTargetsInRange(a, aiAttackers, combatStats.range, -1);

    // If no AI attackers, check if close to AI defenders (at top)
    if (!targets.length) {
      // Create defender targets from AI defense lineup
      const defenderTargets = h2h.aiDefense.map((defIdx, lane) => ({
        y: 30,
        lane,
        dead: false,
        defIdx
      }));
      targets = findTargetsInRange(a, defenderTargets, combatStats.range, -1);
    }

    if (targets.length && now - a.lastShot > stats.fireRate) {
      a.lastShot = now;
      h2hProjectiles.push(createProjectile({
        unitId: unit.id,
        x: a.lane * laneW + laneW / 2,
        y: a.y - 20,
        lane: a.lane,
        damage: stats.damage,
        attackerTypes: stats.types,
        direction: -1,
        owner: 'player'
      }));
      sound('shoot');
    }
  });

  // Combat: AI attackers fire at player attackers AND player defenders
  aiAttackers.forEach(a => {
    if (a.dead) return;
    const unit = UNITS[a.unitIdx];
    const combatStats = UNIT_COMBAT_STATS[unit.id];
    const stats = getUnitStats(a.unitIdx);

    // First check for player attackers in range
    let targets = findTargetsInRange(a, playerAttackers, combatStats.range, 1);

    // If no player attackers, check if close to player defenders (at bottom)
    if (!targets.length) {
      // Create defender targets from player defense lineup
      const defenderTargets = h2h.playerDefense.map((defIdx, lane) => ({
        y: bfH - 30,
        lane,
        dead: false,
        defIdx
      }));
      targets = findTargetsInRange(a, defenderTargets, combatStats.range, 1);
    }

    if (targets.length && now - a.lastShot > stats.fireRate) {
      a.lastShot = now;
      h2hProjectiles.push(createProjectile({
        unitId: unit.id,
        x: a.lane * laneW + laneW / 2,
        y: a.y + 20,
        lane: a.lane,
        damage: stats.damage,
        attackerTypes: stats.types,
        direction: 1,
        owner: 'ai'
      }));
      sound('shoot');
    }
  });

  // Defense combat - player defenders vs AI attackers (static defenders at bottom)
  h2h.playerDefense.forEach((defIdx, lane) => {
    const defStats = getUnitStats(defIdx);
    const defUnit = UNITS[defIdx];
    const defCombat = UNIT_COMBAT_STATS[defUnit.id];
    const defender = { y: bfH - 30, lane };

    const targets = findTargetsInRange(defender, aiAttackers, defCombat.range, -1);

    if (!h2h.playerDefLastShot) h2h.playerDefLastShot = [0, 0, 0];

    if (targets.length && now - h2h.playerDefLastShot[lane] > defStats.fireRate) {
      h2h.playerDefLastShot[lane] = now;
      h2hProjectiles.push(createProjectile({
        unitId: defUnit.id,
        x: lane * laneW + laneW / 2,
        y: defender.y - 20,
        lane,
        damage: defStats.damage,
        attackerTypes: defStats.types,
        direction: -1,
        owner: 'player'
      }));
      sound('shoot');
    }
  });

  // AI defense vs player attackers (static defenders at top)
  h2h.aiDefense.forEach((defIdx, lane) => {
    const defUnit = UNITS[defIdx];
    const defCombat = UNIT_COMBAT_STATS[defUnit.id];
    const baseDmg = defUnit.upgrades.damage.levels[0];
    const defender = { y: 30, lane };

    const targets = findTargetsInRange(defender, playerAttackers, defCombat.range, 1);

    if (!h2h.aiDefLastShot) h2h.aiDefLastShot = [0, 0, 0];

    if (targets.length && now - h2h.aiDefLastShot[lane] > 1000) {
      h2h.aiDefLastShot[lane] = now;
      h2hProjectiles.push(createProjectile({
        unitId: defUnit.id,
        x: lane * laneW + laneW / 2,
        y: defender.y + 20,
        lane,
        damage: baseDmg,
        attackerTypes: defUnit.types,
        direction: 1,
        owner: 'ai'
      }));
      sound('shoot');
    }
  });

  // Update projectiles - handle both directions
  h2hProjectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) { p.hit = true; return; }

    p.y += p.direction * projDef.speed * dtSec;

    // Check for impact based on projectile owner
    const targetList = p.owner === 'player' ? aiAttackers : playerAttackers;
    const target = targetList.find(a => a.lane === p.lane && !a.dead && Math.abs(a.y - p.y) < 25);

    if (target) {
      const targetUnit = UNITS[target.unitIdx];
      const mult = getTypeMultiplier(p.attackerTypes, targetUnit.types);
      target.hp -= Math.round(p.damage * mult);
      p.hit = true;

      if (target.hp <= 0) {
        target.dead = true;
        sound('explosion');
      }
    }

    // Off screen
    if (p.y < -20 || p.y > bfH + 20) p.hit = true;
  });

  // Cleanup
  h2hProjectiles = h2hProjectiles.filter(p => !p.hit);
  playerAttackers = playerAttackers.filter(a => !a.dead);
  aiAttackers = aiAttackers.filter(a => !a.dead);

  // Clamp HP
  h2h.playerHP = Math.max(0, h2h.playerHP);
  h2h.aiHP = Math.max(0, h2h.aiHP);

  // Check win conditions
  const allSpawned = h2hPlayerSpawned.length >= h2h.playerAttack.length &&
                     h2hAISpawned.length >= h2h.aiAttack.length;
  const allDead = playerAttackers.length === 0 && aiAttackers.length === 0;

  if (h2h.playerHP <= 0 || h2h.aiHP <= 0 || (allSpawned && allDead)) {
    stopH2HLoop();
    endH2HRound();
  }
}

function endH2HRound() {
  const h2h = Game.h2h;

  // Determine round winner
  if (h2h.aiHP <= 0 && h2h.playerHP > 0) {
    h2h.score.player++;
  } else if (h2h.playerHP <= 0 && h2h.aiHP > 0) {
    h2h.score.ai++;
  } else if (h2h.playerHP > h2h.aiHP) {
    h2h.score.player++;
  } else if (h2h.aiHP > h2h.playerHP) {
    h2h.score.ai++;
  }
  // Tie: no one scores

  // Check match end
  const winScore = Math.ceil(h2h.bestOf / 2);
  if (h2h.score.player >= winScore || h2h.score.ai >= winScore) {
    goto(State.H2H_MATCH_END);
  } else {
    goto(State.H2H_RESULT);
  }
}

export function nextH2HRound() {
  const h2h = Game.h2h;
  h2h.round++;
  h2h.phase = 'design';
  h2h.playerAttack = [{ delay: 0, lanes: [null, null, null] }];
  h2h.spent = 0;
  h2h.selectedWave = 0;
  Game.h2hWaveLane = 0;
  h2h.playerHP = 100;
  h2h.aiHP = 100;
  goto(State.H2H_DESIGN);
}

export function resetH2H() {
  Game.h2h = null;
  goto(State.MENU);
}

function drawH2H() {
  const h2h = Game.h2h;
  const bf = document.querySelector('.h2h-battlefield');
  if (!bf) return;

  const laneW = bf.offsetWidth / 3;
  const bfH = bf.offsetHeight;

  // Update health bars
  const playerHpFill = document.querySelector('.player-hp-fill');
  const aiHpFill = document.querySelector('.ai-hp-fill');
  const playerHpText = document.querySelector('.player-hp-text');
  const aiHpText = document.querySelector('.ai-hp-text');

  if (playerHpFill) playerHpFill.style.width = `${h2h.playerHP}%`;
  if (aiHpFill) aiHpFill.style.width = `${h2h.aiHP}%`;
  if (playerHpText) playerHpText.textContent = Math.ceil(h2h.playerHP);
  if (aiHpText) aiHpText.textContent = Math.ceil(h2h.aiHP);

  // Clear entities
  bf.querySelectorAll('.h2h-unit, .h2h-projectile').forEach(el => el.remove());

  // Draw player attackers (going up) - uses player faction colors
  playerAttackers.forEach(a => {
    const unit = UNITS[a.unitIdx];
    const el = document.createElement('div');
    el.className = 'h2h-unit player-attacker';
    el.style.left = `${a.lane * laneW + (laneW - 40) / 2}px`;
    el.style.top = `${a.y}px`;
    el.innerHTML = getUnitSvg(unit, 'player');
    bf.appendChild(el);
  });

  // Draw AI attackers (going down) - uses enemy faction colors
  aiAttackers.forEach(a => {
    const unit = UNITS[a.unitIdx];
    const el = document.createElement('div');
    el.className = 'h2h-unit ai-attacker';
    el.style.left = `${a.lane * laneW + (laneW - 40) / 2}px`;
    el.style.top = `${a.y}px`;
    el.innerHTML = getUnitSvg(unit, 'enemy');
    el.style.transform = 'rotate(180deg)';
    bf.appendChild(el);
  });

  // Draw projectiles
  h2hProjectiles.forEach(p => {
    const projDef = PROJECTILES[p.type];
    if (!projDef) return;

    const el = document.createElement('div');
    el.className = 'h2h-projectile';
    el.style.position = 'absolute';
    el.style.left = `${p.x - projDef.width / 2}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${Math.max(projDef.width, 6)}px`;
    el.style.height = `${Math.max(projDef.height, 12)}px`;
    el.style.backgroundColor = projDef.color;
    el.style.borderRadius = '2px';
    el.style.boxShadow = `0 0 ${projDef.width * 3}px ${projDef.color}`;
    el.style.zIndex = '15';
    bf.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN BATTLE SYSTEM - Hero 2D combat
// ═══════════════════════════════════════════════════════════════

let campaignLoopId = null;
let campaignLastT = 0;

function startCampaignLoop() {
  if (campaignLoopId) return;
  campaignLastT = performance.now();
  campaignLoopId = requestAnimationFrame(campaignLoop);
}

function stopCampaignLoop() {
  if (campaignLoopId) {
    cancelAnimationFrame(campaignLoopId);
    campaignLoopId = null;
  }
}

function campaignLoop(t) {
  if (Game.state !== State.CAMPAIGN_BATTLE) {
    campaignLoopId = null;
    return;
  }

  const dt = t - campaignLastT;
  campaignLastT = t;

  updateCampaignBattle(dt);
  drawCampaignBattle();

  campaignLoopId = requestAnimationFrame(campaignLoop);
}

function updateCampaignBattle(dt) {
  const b = Game.campaign.heroBattle;
  if (!b || b.result) return;

  const dtSec = dt / 1000;
  const now = Date.now();

  // Update timer
  b.timer -= dtSec;
  if (b.timer <= 0 && b.objective === 'survive') {
    b.result = 'victory';
    goto(State.CAMPAIGN_RESULT);
    return;
  }

  // --- HERO MOVEMENT (WASD) ---
  const hero = b.hero;
  let dx = 0, dy = 0;

  if (b.keys.w) dy -= 1;
  if (b.keys.s) dy += 1;
  if (b.keys.a) dx -= 1;
  if (b.keys.d) dx += 1;

  // Normalize diagonal movement
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707;
    dy *= 0.707;
  }

  // Get terrain speed modifier
  const speedMod = getTerrainSpeedMod(b, hero.x, hero.y);

  // Calculate new position
  const newX = hero.x + dx * hero.speed * speedMod * dtSec;
  const newY = hero.y + dy * hero.speed * speedMod * dtSec;

  // Check terrain collision only (no unit collision for now)
  const terrainBlockedX = isTerrainBlocked(b, newX, hero.y);
  if (!terrainBlockedX) {
    hero.x = newX;
  }

  const terrainBlockedY = isTerrainBlocked(b, hero.x, newY);
  if (!terrainBlockedY) {
    hero.y = newY;
  }

  // Clamp to map bounds
  hero.x = Math.max(30, Math.min(b.mapWidth - 30, hero.x));
  hero.y = Math.max(30, Math.min(b.mapHeight - 30, hero.y));

  // --- AIMING ---
  // Use aim joystick if available (mobile), otherwise mouse position
  if (b.aimAngle !== null && b.aimAngle !== undefined) {
    // Direct angle from aim joystick
    hero.angle = b.aimAngle;
  } else {
    // Angle from hero to mouse (in world coordinates)
    const worldMouseX = b.mouse.x + b.camera.x;
    const worldMouseY = b.mouse.y + b.camera.y;
    hero.angle = Math.atan2(worldMouseY - hero.y, worldMouseX - hero.x);
  }

  // --- HERO SHOOTING ---
  if (b.mouse.down && now - hero.lastShot > hero.fireRate) {
    hero.lastShot = now;

    // Create projectile moving in aim direction
    const projSpeed = 500;
    b.projectiles.push({
      x: hero.x,
      y: hero.y,
      vx: Math.cos(hero.angle) * projSpeed,
      vy: Math.sin(hero.angle) * projSpeed,
      damage: hero.damage,
      owner: 'player',
      type: 'bullet'
    });

    sound('shoot');
  }

  // --- UPDATE CAMERA WITH LOOK-AHEAD ---
  const screenW = 800;  // Will be updated from actual element
  const screenH = 600;

  // Calculate look-ahead offset based on movement and aim
  const lookAheadDist = 80; // How far ahead to look
  let lookX = 0, lookY = 0;

  // Movement-based look-ahead (primary)
  if (dx !== 0 || dy !== 0) {
    lookX = dx * lookAheadDist;
    lookY = dy * lookAheadDist;
  }
  // Aim-based look-ahead when shooting (secondary, adds to movement)
  else if (b.mouse.down) {
    lookX = Math.cos(hero.angle) * lookAheadDist * 0.5;
    lookY = Math.sin(hero.angle) * lookAheadDist * 0.5;
  }

  // Smoothly interpolate camera look-ahead
  if (!b.camera.lookX) b.camera.lookX = 0;
  if (!b.camera.lookY) b.camera.lookY = 0;
  const lookSmooth = 0.08; // Lower = smoother/slower
  b.camera.lookX += (lookX - b.camera.lookX) * lookSmooth;
  b.camera.lookY += (lookY - b.camera.lookY) * lookSmooth;

  // Center camera on hero with look-ahead offset
  const targetX = hero.x + b.camera.lookX - screenW / 2;
  const targetY = hero.y + b.camera.lookY - screenH / 2;
  b.camera.x = Math.max(0, Math.min(b.mapWidth - screenW, targetX));
  b.camera.y = Math.max(0, Math.min(b.mapHeight - screenH, targetY));

  // --- SPAWN ENEMIES ---
  // Simple wave spawning for now
  if (b.enemies.length === 0 && b.enemiesRemaining === 0) {
    spawnCampaignWave(b);
  }

  // --- UPDATE ENEMIES (using modular AI) ---
  b.enemies.forEach(e => {
    updateEnemyAI(b, e, hero, b.units, now, dtSec);

    // Check if hero is defeated
    if (hero.hp <= 0) {
      hero.hp = 0;
      b.result = 'defeat';
      goto(State.CAMPAIGN_RESULT);
    }
  });

  // --- UPDATE ALLY UNITS (using modular AI) ---
  b.units.forEach(unit => {
    updateUnitAI(b, unit, hero, b.enemies, now, dtSec);
  });

  // --- UPDATE PROJECTILES ---
  b.projectiles.forEach(p => {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;

    // Check bounds
    if (p.x < 0 || p.x > b.mapWidth || p.y < 0 || p.y > b.mapHeight) {
      p.hit = true;
      return;
    }

    // Check hit on enemies (player and ally projectiles)
    if (p.owner === 'player' || p.owner === 'ally') {
      for (const e of b.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        // Use actual entity radius for hit detection (projectile + enemy)
        const hitRadius = ENTITY_RADIUS.projectile + ENTITY_RADIUS.enemy;
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          e.hp -= p.damage;
          p.hit = true;

          // Record damage for aggro system
          if (p.owner === 'player') {
            recordDamage(e, 'hero', p.damage);
          } else if (p.owner === 'ally' && p.sourceUnitId) {
            recordDamage(e, p.sourceUnitId, p.damage);
          }

          if (e.hp <= 0) {
            e.dead = true;
            b.kills++;
            b.enemiesRemaining--;
            sound('explosion');
          }
          break;
        }
      }
    }
  });

  // Remove hit projectiles
  b.projectiles = b.projectiles.filter(p => !p.hit);

  // Remove dead enemies
  b.enemies = b.enemies.filter(e => !e.dead);
}

function spawnCampaignWave(b) {
  const count = 5 + b.wave * 2;
  b.enemiesRemaining = count;

  // AI type distribution changes with wave number
  const aiTypes = ['BASIC', 'BASIC', 'BASIC'];
  if (b.wave >= 2) aiTypes.push('RUSHER');
  if (b.wave >= 3) aiTypes.push('HUNTER', 'CAUTIOUS');
  if (b.wave >= 4) aiTypes.push('FLANKER');

  // Enemy unit types distribution (for armor class)
  // Early: infantry/jeep (soft), later: sherman/tiger (armored)
  const unitTypes = ['infantry', 'infantry', 'jeep'];
  if (b.wave >= 2) unitTypes.push('infantry', 'jeep');
  if (b.wave >= 3) unitTypes.push('sherman');
  if (b.wave >= 4) unitTypes.push('sherman', 'tiger');
  if (b.wave >= 5) unitTypes.push('tiger');

  // Enemy spawn zone is the top 4 rows (enemy territory)
  const enemyZoneHeight = 4 * b.cellSize;

  for (let i = 0; i < count; i++) {
    // Spawn from enemy zone (top of map only)
    const x = 50 + Math.random() * (b.mapWidth - 100);
    const y = 30 + Math.random() * (enemyZoneHeight - 60);

    // Randomly select AI type and unit type from available pools
    const aiTypeKey = aiTypes[Math.floor(Math.random() * aiTypes.length)];
    const unitId = unitTypes[Math.floor(Math.random() * unitTypes.length)];

    // Scale HP and damage based on unit type
    const isArmored = unitId === 'sherman' || unitId === 'tiger';
    const baseHp = isArmored ? 60 : 30;
    const baseDamage = isArmored ? 10 : 5;
    const baseSpeed = isArmored ? 50 : 70;

    const enemy = {
      id: `wave${b.wave}_${i}`,
      x,
      y,
      hp: baseHp + b.wave * 10,
      maxHp: baseHp + b.wave * 10,
      speed: baseSpeed + Math.random() * 30,
      damage: baseDamage + b.wave * 2,
      aiType: EnemyAIType[aiTypeKey],
      unitId,  // For armor class determination
      angle: Math.PI / 2  // Face downward initially
    };

    b.enemies.push(enemy);
  }

  b.wave++;
}

function drawCampaignBattle() {
  const bf = document.querySelector('.campaign-battlefield');
  if (!bf) return;

  const b = Game.campaign.heroBattle;
  if (!b) return;

  const screenW = bf.offsetWidth;
  const screenH = bf.offsetHeight;
  const cellSize = b.cellSize;

  // Update camera with actual screen size
  b.camera.x = Math.max(0, Math.min(b.mapWidth - screenW, b.hero.x - screenW / 2));
  b.camera.y = Math.max(0, Math.min(b.mapHeight - screenH, b.hero.y - screenH / 2));

  // Clear previous entities (but keep terrain if already drawn)
  bf.querySelectorAll('.campaign-entity').forEach(el => el.remove());

  // Draw terrain grid (only once, then cache)
  if (!bf.querySelector('.campaign-terrain')) {
    const terrainContainer = document.createElement('div');
    terrainContainer.className = 'campaign-terrain';
    terrainContainer.style.position = 'absolute';
    terrainContainer.style.width = `${b.mapWidth}px`;
    terrainContainer.style.height = `${b.mapHeight}px`;
    terrainContainer.style.left = '0';
    terrainContainer.style.top = '0';

    // Draw each terrain cell with SVG graphics
    for (let row = 0; row < b.gridHeight; row++) {
      for (let col = 0; col < b.gridWidth; col++) {
        const terrainType = b.terrain[row]?.[col] || 'open';
        const cell = document.createElement('div');
        cell.className = `campaign-cell terrain-${terrainType}`;
        cell.style.position = 'absolute';
        cell.style.left = `${col * cellSize}px`;
        cell.style.top = `${row * cellSize}px`;
        cell.style.width = `${cellSize}px`;
        cell.style.height = `${cellSize}px`;
        cell.style.boxSizing = 'border-box';

        // Use SVG terrain tiles
        cell.innerHTML = getTerrainSVG(terrainType, row, b.gridHeight);
        terrainContainer.appendChild(cell);
      }
    }
    bf.appendChild(terrainContainer);
  }

  // Update terrain position based on camera
  const terrainEl = bf.querySelector('.campaign-terrain');
  if (terrainEl) {
    terrainEl.style.transform = `translate(${-b.camera.x}px, ${-b.camera.y}px)`;
  }

  // Draw player units
  b.units.forEach(unit => {
    const el = document.createElement('div');
    el.className = 'campaign-entity campaign-unit';
    el.style.left = `${unit.x - b.camera.x - 20}px`;
    el.style.top = `${unit.y - b.camera.y - 20}px`;
    el.style.width = '40px';
    el.style.height = '40px';
    el.style.transform = `rotate(${unit.angle + Math.PI / 2}rad)`;
    el.style.backgroundColor = '#5a8a5a';
    el.style.borderRadius = '5px';
    el.style.border = '2px solid #3a6a3a';
    el.dataset.unitId = unit.unitId;
    bf.appendChild(el);
  });

  // Draw hero
  const hero = b.hero;
  const heroEl = document.createElement('div');
  heroEl.className = 'campaign-entity campaign-hero';
  heroEl.style.left = `${hero.x - b.camera.x - 20}px`;
  heroEl.style.top = `${hero.y - b.camera.y - 20}px`;
  heroEl.style.width = '40px';
  heroEl.style.height = '40px';
  heroEl.style.transform = `rotate(${hero.angle + Math.PI / 2}rad)`;
  heroEl.style.backgroundColor = '#4a9eff';
  heroEl.style.borderRadius = '5px';
  heroEl.style.border = '2px solid #fff';
  bf.appendChild(heroEl);

  // Draw enemies
  b.enemies.forEach(e => {
    if (e.dead) return;

    const el = document.createElement('div');
    el.className = 'campaign-entity campaign-enemy';
    el.style.left = `${e.x - b.camera.x - 15}px`;
    el.style.top = `${e.y - b.camera.y - 15}px`;
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.backgroundColor = '#ff4444';
    el.style.borderRadius = '50%';
    el.style.border = '2px solid #aa0000';
    bf.appendChild(el);
  });

  // Draw projectiles
  b.projectiles.forEach(p => {
    const el = document.createElement('div');
    el.className = 'campaign-entity campaign-projectile';
    el.style.left = `${p.x - b.camera.x - 4}px`;
    el.style.top = `${p.y - b.camera.y - 4}px`;
    el.style.width = '8px';
    el.style.height = '8px';
    el.style.backgroundColor = '#ffcc00';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 10px #ffcc00';
    bf.appendChild(el);
  });

  // Update HUD
  const hpBar = bf.querySelector('.campaign-hp-fill');
  if (hpBar) {
    hpBar.style.width = `${(hero.hp / hero.maxHP) * 100}%`;
  }

  const timerEl = bf.querySelector('.campaign-timer');
  if (timerEl) {
    timerEl.textContent = `${Math.ceil(b.timer)}s`;
  }

  const killsEl = bf.querySelector('.campaign-kills');
  if (killsEl) {
    killsEl.textContent = `Kills: ${b.kills}`;
  }

  // Draw minimap
  drawMinimap(b);

  // Draw command feedback
  drawCommandUI(bf, b);
}

// Draw minimap showing terrain, units, and enemies
function drawMinimap(b) {
  const canvas = document.querySelector('.minimap-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Scale factor: map to minimap
  const scaleX = w / b.mapWidth;
  const scaleY = h / b.mapHeight;

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Draw terrain (simplified colors)
  const terrainColors = {
    open: '#4a4035',
    grass: '#3a5a2a',
    brush: '#2a4a1a',
    forest: '#1e3a18',
    high: '#5a4a3a',
    water: '#1a4a65',
    trench: '#3a2a1a',
    pillbox: '#5a5a5a'
  };

  const cellW = (b.cellSize * scaleX);
  const cellH = (b.cellSize * scaleY);

  for (let row = 0; row < b.gridHeight; row++) {
    for (let col = 0; col < b.gridWidth; col++) {
      const terrainType = b.terrain[row]?.[col] || 'open';
      ctx.fillStyle = terrainColors[terrainType] || terrainColors.open;
      ctx.fillRect(col * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
    }
  }

  // Draw player units (green dots)
  ctx.fillStyle = '#5a8a5a';
  b.units.forEach(unit => {
    const x = unit.x * scaleX;
    const y = unit.y * scaleY;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw enemies (red dots)
  ctx.fillStyle = '#ff4444';
  b.enemies.forEach(e => {
    if (e.dead) return;
    const x = e.x * scaleX;
    const y = e.y * scaleY;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw hero (blue dot with ring)
  const heroX = b.hero.x * scaleX;
  const heroY = b.hero.y * scaleY;
  ctx.fillStyle = '#4a9eff';
  ctx.beginPath();
  ctx.arc(heroX, heroY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw view range circle around hero
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(heroX, heroY, 200 * scaleX, 0, Math.PI * 2); // ~200px view range
  ctx.stroke();
}

// Campaign input handlers (called from main.js)
export function campaignKeyDown(key) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  const k = key.toLowerCase();

  // Movement keys
  if (k === 'w' || k === 'arrowup') b.keys.w = true;
  if (k === 'a' || k === 'arrowleft') b.keys.a = true;
  if (k === 's' || k === 'arrowdown') b.keys.s = true;
  if (k === 'd' || k === 'arrowright') b.keys.d = true;

  // Tactical command keys (1-5)
  for (const [cmdKey, cmd] of Object.entries(TacticalCommand)) {
    if (key === cmd.key) {
      if (cmd.needsTarget) {
        // Enter move target mode
        b.pendingCommand = cmdKey;
        b.commandFeedback = { text: `Click to set ${cmd.label} target`, time: Date.now() };
      } else {
        // Issue command immediately to all units
        issueCommand(b.units, cmdKey.toLowerCase());
        b.commandFeedback = { text: `${cmd.icon} ${cmd.label}!`, time: Date.now() };
      }
      break;
    }
  }

  // Quick behavior changes (hold shift + number for behavior presets)
  if (key === 'q') {
    // Toggle aggressive mode
    b.units.forEach(u => setUnitBehavior(u, 'AGGRESSIVE'));
    b.commandFeedback = { text: '🔥 Aggressive Mode', time: Date.now() };
  }
  if (key === 'e') {
    // Toggle defensive mode
    b.units.forEach(u => setUnitBehavior(u, 'DEFENSIVE'));
    b.commandFeedback = { text: '🛡️ Defensive Mode', time: Date.now() };
  }
}

export function campaignKeyUp(key) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  const k = key.toLowerCase();
  if (k === 'w' || k === 'arrowup') b.keys.w = false;
  if (k === 'a' || k === 'arrowleft') b.keys.a = false;
  if (k === 's' || k === 'arrowdown') b.keys.s = false;
  if (k === 'd' || k === 'arrowright') b.keys.d = false;
}

export function campaignMouseMove(x, y) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.mouse.x = x;
  b.mouse.y = y;
}

export function campaignMouseDown() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  // Handle pending move command
  if (b.pendingCommand === 'MOVE') {
    const worldX = b.mouse.x + b.camera.x;
    const worldY = b.mouse.y + b.camera.y;

    // Issue move command to all units with target position
    issueCommand(b.units, 'move', { x: worldX, y: worldY });
    b.commandFeedback = { text: '🎯 Moving to target!', time: Date.now() };
    b.pendingCommand = null;
    return; // Don't fire weapon when issuing move command
  }

  b.mouse.down = true;
}

export function campaignMouseUp() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.mouse.down = false;
}

// Set aim angle directly (for mobile joystick)
export function campaignSetAimAngle(angle) {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.aimAngle = angle;
}

// Clear aim angle (revert to mouse-based aiming)
export function campaignClearAimAngle() {
  const b = Game.campaign?.heroBattle;
  if (!b) return;

  b.aimAngle = null;
}
