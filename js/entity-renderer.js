// ═══════════════════════════════════════════════════════════════
// ENTITY RENDERER - Canvas-based drawing of game entities
// Replaces DOM div creation in drawHeroBattle()
// Matches visual appearance of the existing DOM rendering
// ═══════════════════════════════════════════════════════════════

import * as sprites from './sprites.js';
import { Owner, UNITS, UNIT_COMBAT_STATS } from './constants.js';
import { getCachedInsignia, cacheInsigniaSet } from './insignia-renderer.js';
import { buildVisionPolygon } from './vision.js';
import { queryTerrain } from './terrain-query.js';

// ── SVG-to-canvas fallback cache ─────────────────────────────
// Renders SVG strings from UNITS definitions to Image objects for canvas drawing
const _svgImageCache = {};  // keyed by `${unitId}-${team}` or `${unitId}-${team}-hull`/`-turret`

/** Apply red team recolor to SVG string */
function _recolorRed(svgStr) {
  return svgStr
    .replace(/#2d4a2d/g, '#4a2d2d')
    .replace(/#3d5c3d/g, '#5c3d3d')
    .replace(/#4a6b4a/g, '#6b4a4a')
    .replace(/#5a7d5a/g, '#7d5a5a')
    .replace(/#1a1a1a/g, '#1a1a1a')
    .replace(/#333/g, '#433')
    .replace(/#2b3d2b/g, '#3d2b2b')
    .replace(/#3a5a3a/g, '#5a3a3a')
    .replace(/#4a7a4a/g, '#7a4a4a')
    .replace(/#2a4a3a/g, '#4a2a2a')
    .replace(/#3a6a4a/g, '#6a3a3a')
    .replace(/#5a8a5a/g, '#8a5a5a');
}

/** Convert SVG string to cached Image via Blob URL */
function _svgToImage(svgStr, cacheKey) {
  if (_svgImageCache[cacheKey]) return _svgImageCache[cacheKey];

  // Ensure xmlns is present (required for Blob → Image rendering)
  if (!svgStr.includes('xmlns=')) {
    svgStr = svgStr.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }

  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img._loaded = false;
  img.onload = () => { img._loaded = true; URL.revokeObjectURL(url); };
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;

  _svgImageCache[cacheKey] = img;
  return img;
}

function _getSvgImage(unitId, team) {
  const key = `${unitId}-${team || 'blue'}`;
  if (_svgImageCache[key]) return _svgImageCache[key];

  const unitDef = UNITS.find(u => u.id === unitId);
  if (!unitDef?.svg) return null;

  let svgStr = unitDef.svg;
  if (team === 'red') svgStr = _recolorRed(svgStr);

  return _svgToImage(svgStr, key);
}

/**
 * Split an SVG string into hull and turret layer SVGs by data-part attribute.
 * Returns { hullSvg, turretSvg } — each is a complete SVG string with same viewBox.
 */
function _splitSvgLayers(svgStr, hullParts, turretParts) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgStr, 'image/svg+xml');
  const svg = doc.documentElement;
  const viewBox = svg.getAttribute('viewBox') || '';
  const width = svg.getAttribute('width') || '50';
  const height = svg.getAttribute('height') || '50';

  const hullSet = new Set(hullParts);
  const turretSet = new Set(turretParts);

  const hullEls = [];
  const turretEls = [];

  for (const child of Array.from(svg.children)) {
    const part = child.getAttribute('data-part');
    if (part && turretSet.has(part)) {
      turretEls.push(child.outerHTML);
    } else if (part && hullSet.has(part)) {
      hullEls.push(child.outerHTML);
    } else if (part) {
      // Unknown part — put in hull by default
      hullEls.push(child.outerHTML);
    } else {
      // No data-part — put in hull (background elements)
      hullEls.push(child.outerHTML);
    }
  }

  const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`;
  return {
    hullSvg: `${svgOpen}${hullEls.join('')}</svg>`,
    turretSvg: `${svgOpen}${turretEls.join('')}</svg>`
  };
}

/**
 * Get hull and turret Image objects for a unit, splitting SVG on first access.
 * Returns { hull: Image|null, turret: Image|null, pivot: {x,y} } or null if no SVG.
 */
function _getUnitLayers(unitId, team) {
  const hullKey = `${unitId}-${team || 'blue'}-hull`;
  const turretKey = `${unitId}-${team || 'blue'}-turret`;

  // Already cached?
  if (_svgImageCache[hullKey] && _svgImageCache[turretKey]) {
    return { hull: _svgImageCache[hullKey], turret: _svgImageCache[turretKey] };
  }

  const unitDef = UNITS.find(u => u.id === unitId);
  if (!unitDef?.svg) return null;

  const combatStats = UNIT_COMBAT_STATS[unitId];
  if (!combatStats?.hullParts || !combatStats?.turretParts ||
      combatStats.hullParts.length === 0 || combatStats.turretParts.length === 0) {
    return null; // No layer config — use single-image fallback
  }

  let svgStr = unitDef.svg;
  if (team === 'red') svgStr = _recolorRed(svgStr);

  const { hullSvg, turretSvg } = _splitSvgLayers(svgStr, combatStats.hullParts, combatStats.turretParts);

  return {
    hull: _svgToImage(hullSvg, hullKey),
    turret: _svgToImage(turretSvg, turretKey)
  };
}

// Entity sizes (matching current DOM div sizes)
const HERO_SIZE = 40;
const UNIT_SIZE = 40;
const ENEMY_SIZE = 30;
const PROJ_SIZE = 8;

// Animation timing
const PULSE_PERIOD = 1000; // ms for selection pulse
const TARGET_PULSE_PERIOD = 800; // ms for concentrate-target pulse

/**
 * Get a cached Image object for a unit's SVG (for canvas drawImage).
 * Exported for use by deployment panel card rendering.
 */
export function getUnitSvgImage(unitId, team) {
  return _getSvgImage(unitId, team || 'blue');
}

export class EntityRenderer {

  // Tunable insignia parameters — live-editable via debug panel
  static insigniaParams = {
    chevW: 6,       // Half-width of chevron (full width = 12)
    chevH: 7,       // Height of each chevron (~square, slightly taller)
    gap: 4,         // Vertical spacing between chevrons
    bow: 0.35,      // Inward curve as fraction of chevW
    lineWidth: 1.5, // Stroke width
    yOffset: 0      // Vertical offset from unit center
  };

  /**
   * Render the hero (animated sprite or colored fallback).
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} hero - Hero entity { x, y, hullAngle, angle, animId }
   * @param {number} now - performance.now() for animation timing
   */
  renderHero(ctx, hero, now) {
    const hasAnim = hero.animId && sprites.hasAnimatedUnit(hero.animId);

    if (hasAnim) {
      const hullRotation = (hero.hullAngle * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, hero.animId, hero.x, hero.y, hullRotation, 0.5, now);
    } else {
      // Fallback: blue rounded rect
      const half = HERO_SIZE / 2;
      ctx.save();
      ctx.translate(hero.x, hero.y);
      ctx.rotate(hero.hullAngle + Math.PI / 2);
      this._roundedRect(ctx, -half, -half, HERO_SIZE, HERO_SIZE, 5);
      ctx.fillStyle = '#4a9eff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Render a player unit.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} unit - Unit entity { x, y, angle, unitId, id, animId, hp, maxHp }
   * @param {boolean} isSelected - Whether this unit is currently selected
   * @param {number} now - performance.now() for animation timing
   */
  renderUnit(ctx, unit, isSelected, now) {
    if (unit.dead) {
      this._renderDead(ctx, unit.x, unit.y, unit.angle, UNIT_SIZE, unit.animId, now, unit);
      return;
    }

    // Persistent gold outline for sergeants
    this._drawSergeantOutline(ctx, unit.x, unit.y, UNIT_SIZE / 2, unit);

    const hasAnim = unit.animId && sprites.hasAnimatedUnit(unit.animId);

    if (hasAnim) {
      // Selection glow behind sprite
      if (isSelected) {
        this._drawSelectionGlow(ctx, unit.x, unit.y, UNIT_SIZE / 2, now);
      }
      const hullAng = unit.hullAngle ?? unit.angle;
      const rotation = (hullAng * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, unit.animId, unit.x, unit.y, rotation, 0.5, now);
    } else {
      // Try two-layer SVG rendering (hull + turret)
      const layers = _getUnitLayers(unit.unitId, unit.team);
      const half = UNIT_SIZE / 2;

      if (layers?.hull?._loaded && layers?.turret?._loaded) {
        const hullAng = unit.hullAngle ?? unit.angle;
        const combatStats = UNIT_COMBAT_STATS[unit.unitId];
        const pivot = combatStats?.turretPivot || { x: 0, y: 0 };

        if (isSelected) {
          this._drawSelectionGlow(ctx, unit.x, unit.y, half, now);
        }

        // Draw hull at hullAngle
        ctx.save();
        ctx.translate(unit.x, unit.y);
        ctx.rotate(hullAng + Math.PI / 2);
        ctx.drawImage(layers.hull, -half, -half, UNIT_SIZE, UNIT_SIZE);
        ctx.restore();

        // Draw turret at turret angle, pivoted relative to hull
        ctx.save();
        ctx.translate(unit.x, unit.y);
        ctx.rotate(hullAng + Math.PI / 2);   // align to hull
        ctx.translate(pivot.x, pivot.y);       // offset to turret pivot in hull-local coords
        ctx.rotate(unit.angle - hullAng);      // relative turret rotation
        ctx.drawImage(layers.turret, -half - pivot.x, -half - pivot.y, UNIT_SIZE, UNIT_SIZE);
        ctx.restore();
      } else {
        // Single SVG fallback (while layers load or no layer config)
        const svgImg = _getSvgImage(unit.unitId, unit.team);

        ctx.save();
        ctx.translate(unit.x, unit.y);
        ctx.rotate((unit.hullAngle ?? unit.angle) + Math.PI / 2);

        if (svgImg?._loaded) {
          if (isSelected) {
            this._drawSelectionGlow(ctx, 0, 0, half, now);
          }
          ctx.drawImage(svgImg, -half, -half, UNIT_SIZE, UNIT_SIZE);
        } else {
          // Ultimate fallback: colored rect while SVG loads
          this._roundedRect(ctx, -half, -half, UNIT_SIZE, UNIT_SIZE, 5);
          ctx.fillStyle = isSelected ? '#7ab87a' : '#5a8a5a';
          ctx.fill();
          ctx.strokeStyle = isSelected ? '#4a9eff' : '#3a6a3a';
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    // Rank chevrons (pop-in + fade) and promotion highlight
    this._drawRankChevrons(ctx, unit.x, unit.y, unit, now);
    this._drawPromotionHighlight(ctx, unit.x, unit.y, UNIT_SIZE / 2, unit, now);
  }

  /**
   * Render an enemy.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} enemy - Enemy entity { x, y, hp, maxHp, dead, id }
   * @param {boolean} isConcentrateTarget - Whether this enemy is the concentrate-fire target
   * @param {number} now - performance.now() for animation timing
   */
  renderEnemy(ctx, enemy, isConcentrateTarget, now) {
    if (enemy.dead) {
      this._renderDead(ctx, enemy.x, enemy.y, enemy.angle, ENEMY_SIZE, enemy.animId, now, enemy);
      return;
    }

    const r = ENEMY_SIZE / 2;

    // Persistent gold outline for sergeants
    this._drawSergeantOutline(ctx, enemy.x, enemy.y, r, enemy);

    const hasAnim = enemy.animId && sprites.hasAnimatedUnit(enemy.animId);

    if (hasAnim) {
      // Concentrate-fire glow behind sprite
      if (isConcentrateTarget) {
        const pulse = 0.7 + 0.3 * Math.sin(now * Math.PI * 2 / TARGET_PULSE_PERIOD);
        ctx.save();
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15 * pulse;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      const hullAngle = enemy.hullAngle ?? enemy.angle;
      const rotation = (hullAngle * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, enemy.animId, enemy.x, enemy.y, rotation, 0.4, now);
    } else {
      // Try two-layer SVG rendering (hull + turret)
      const layers = _getUnitLayers(enemy.unitId, 'red');

      if (layers?.hull?._loaded && layers?.turret?._loaded) {
        const hullAng = enemy.hullAngle ?? enemy.angle;
        const combatStats = UNIT_COMBAT_STATS[enemy.unitId];
        const pivot = combatStats?.turretPivot || { x: 0, y: 0 };

        if (isConcentrateTarget) {
          const pulse = 0.7 + 0.3 * Math.sin(now * Math.PI * 2 / TARGET_PULSE_PERIOD);
          ctx.save();
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffff00';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#ffff00';
          ctx.shadowBlur = 15 * pulse;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.restore();
        }

        // Draw hull at hullAngle
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(hullAng + Math.PI / 2);
        ctx.drawImage(layers.hull, -r, -r, ENEMY_SIZE, ENEMY_SIZE);
        ctx.restore();

        // Draw turret at turret angle, pivoted relative to hull
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(hullAng + Math.PI / 2);
        ctx.translate(pivot.x, pivot.y);
        ctx.rotate(enemy.angle - hullAng);
        ctx.drawImage(layers.turret, -r - pivot.x, -r - pivot.y, ENEMY_SIZE, ENEMY_SIZE);
        ctx.restore();
      } else {
        // Single SVG fallback
        const svgImg = _getSvgImage(enemy.unitId, 'red');

        ctx.save();
        if (svgImg?._loaded) {
          ctx.translate(enemy.x, enemy.y);
          ctx.rotate((enemy.hullAngle ?? enemy.angle ?? 0) + Math.PI / 2);
          if (isConcentrateTarget) {
            const pulse = 0.7 + 0.3 * Math.sin(now * Math.PI * 2 / TARGET_PULSE_PERIOD);
            ctx.shadowColor = '#ffff00';
            ctx.shadowBlur = 15 * pulse;
          }
          ctx.drawImage(svgImg, -r, -r, ENEMY_SIZE, ENEMY_SIZE);
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#ff4444';
          ctx.fill();
          if (isConcentrateTarget) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 3;
            ctx.stroke();
          } else {
            ctx.strokeStyle = '#aa0000';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Elite modifier glow ring (pulsing colored ring)
    if (enemy.modifierColor) {
      const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 / 1200);
      ctx.save();
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = enemy.modifierColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + pulse * 0.4;
      ctx.shadowColor = enemy.modifierColor;
      ctx.shadowBlur = 8 + pulse * 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Health bar (only show if damaged)
    if (enemy.hp < enemy.maxHp) {
      this._drawHealthBar(ctx, enemy.x, enemy.y - r - 6, enemy.hp / enemy.maxHp, false);
    }

    // Rank chevrons (pop-in + fade) and promotion highlight
    this._drawRankChevrons(ctx, enemy.x, enemy.y, enemy, now);
    this._drawPromotionHighlight(ctx, enemy.x, enemy.y, ENEMY_SIZE / 2, enemy, now);
  }

  /**
   * Render a projectile.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} proj - Projectile { x, y, owner }
   */
  renderProjectile(ctx, proj) {
    const r = PROJ_SIZE / 2;
    const isPlayer = proj.owner === Owner.PLAYER;

    ctx.save();
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isPlayer ? '#ffcc00' : '#ff6666';
    ctx.fill();

    // Glow
    ctx.shadowColor = isPlayer ? '#ffcc00' : '#ff6666';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /**
   * Render only entities that pass a filter function.
   * Same draw order as renderAll but skips non-matching entities.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} b - Battle state
   * @param {number} now - performance.now()
   * @param {function} filterFn - (entity) => boolean, only render if true
   */
  renderFiltered(ctx, b, now, filterFn) {
    const selectedUnitId = b.squad?.selectedUnitId;
    const concentrateTargetId = b.squad?.concentrateTarget;

    if (b.units) {
      for (const unit of b.units) {
        if (!filterFn(unit)) continue;
        this.renderUnit(ctx, unit, unit.id === selectedUnitId, now);
      }
    }

    if (b.hero && !b.hero.observer && filterFn(b.hero)) {
      this.renderHero(ctx, b.hero, now);
    }

    if (b.enemies) {
      const fogSet = b._visibleEnemies;
      for (const enemy of b.enemies) {
        if (!filterFn(enemy)) continue;
        if (enemy.dead) continue;
        const fogAlpha = this._updateFogAlpha(enemy, fogSet);
        if (fogAlpha < 0.02) continue;

        const prevAlpha = ctx.globalAlpha;
        if (fogAlpha < 1.0) ctx.globalAlpha *= fogAlpha;
        this.renderEnemy(ctx, enemy, enemy.id === concentrateTargetId, now);
        if (fogAlpha < 1.0) ctx.globalAlpha = prevAlpha;
      }
    }

    if (b.projectiles) {
      for (const proj of b.projectiles) {
        if (!filterFn(proj)) continue;
        this.renderProjectile(ctx, proj);
      }
    }
  }

  /**
   * Render all entities for a battle state. Draws in correct z-order.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} b - Battle state { hero, units, enemies, projectiles, squad }
   * @param {number} now - performance.now()
   */
  renderAll(ctx, b, now) {
    const selectedUnitId = b.squad?.selectedUnitId;
    const concentrateTargetId = b.squad?.concentrateTarget;

    // Units (below hero)
    if (b.units) {
      for (const unit of b.units) {
        this.renderUnit(ctx, unit, unit.id === selectedUnitId, now);
      }
    }

    // Hero (skip observer in fire range)
    if (b.hero && !b.hero.observer) {
      this.renderHero(ctx, b.hero, now);
    }

    // Enemies (filtered by fog of war)
    if (b.enemies) {
      const fogSet = b._visibleEnemies; // null = show all (fire range or no fog)
      for (const enemy of b.enemies) {
        if (enemy.dead) continue;
        // Fog of war fade
        const fogAlpha = this._updateFogAlpha(enemy, fogSet);
        if (fogAlpha < 0.02) continue; // Fully invisible, skip render

        const prevAlpha = ctx.globalAlpha;
        if (fogAlpha < 1.0) ctx.globalAlpha *= fogAlpha;
        this.renderEnemy(ctx, enemy, enemy.id === concentrateTargetId, now);
        if (fogAlpha < 1.0) ctx.globalAlpha = prevAlpha;
      }
    }

    // Projectiles (on top)
    if (b.projectiles) {
      for (const proj of b.projectiles) {
        this.renderProjectile(ctx, proj);
      }
    }
  }

  /**
   * Hit-test a screen position against entities.
   * @param {number} worldX - World X coordinate
   * @param {number} worldY - World Y coordinate
   * @param {object} b - Battle state
   * @returns {{ type: string, id: string, entity: object }|null}
   */
  hitTest(worldX, worldY, b) {
    // Check enemies first (higher priority for targeting)
    if (b.enemies) {
      const fogSet = b._visibleEnemies;
      for (const enemy of b.enemies) {
        if (enemy.dead) continue;
        // Can't click on fogged enemies
        if (fogSet && !fogSet.has(enemy.id)) continue;
        const dx = enemy.x - worldX;
        const dy = enemy.y - worldY;
        if (dx * dx + dy * dy < (ENEMY_SIZE / 2) * (ENEMY_SIZE / 2)) {
          return { type: 'enemy', id: enemy.id, entity: enemy };
        }
      }
    }

    // Check units
    if (b.units) {
      for (const unit of b.units) {
        const half = UNIT_SIZE / 2;
        if (Math.abs(unit.x - worldX) < half && Math.abs(unit.y - worldY) < half) {
          return { type: 'unit', id: unit.id, entity: unit };
        }
      }
    }

    // Check hero
    if (b.hero) {
      const half = HERO_SIZE / 2;
      if (Math.abs(b.hero.x - worldX) < half && Math.abs(b.hero.y - worldY) < half) {
        return { type: 'hero', id: 'hero', entity: b.hero };
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SPOTTED PINGS — Above-canopy enemy markers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Render pulsing silhouette pings for spotted enemies above the canopy.
   * Shows a filled diamond marker + unit outline so enemies under trees are visible.
   * @param {CanvasRenderingContext2D} ctx - Effects layer context (above canopy)
   * @param {object} b - Battle state
   * @param {number} now - performance.now()
   */
  renderSpottedPings(ctx, b, now) {
    const fogSet = b._visibleEnemies;
    // Only show pings when fog of war is active (fogSet is a Set, not null)
    if (!fogSet || !b.enemies) return;

    const PING_DURATION = 1500; // ms — initial flash on first spot
    const LINGER_DURATION = 3000; // ms — marker fades out after losing contact
    let anyDrawn = false;

    for (const enemy of b.enemies) {
      if (enemy.dead) continue;

      const isVisible = fogSet.has(enemy.id);

      // Track spot/unspot transitions
      if (isVisible) {
        if (!enemy._pingStart) {
          enemy._pingStart = now;
          // Determine who spotted this enemy — check hero first, then allies
          enemy._spottedByHero = !!(b.hero && b.hero._spotted &&
            b.hero._spotted.some(s => s.enemy === enemy && s.direct));
        }
        enemy._lastSpotted = now;
        enemy._lastSpotX = enemy.x;
        enemy._lastSpotY = enemy.y;
      } else if (!enemy._lastSpotted) {
        continue; // Never been spotted
      } else {
        const lostAge = now - enemy._lastSpotted;
        if (lostAge > LINGER_DURATION) {
          enemy._pingStart = 0; // Reset for fresh ping on re-spot
          continue;
        }
      }

      if (!anyDrawn) { ctx.save(); anyDrawn = true; }

      const age = now - enemy._pingStart;
      // Use last known position if no longer visible
      const x = isVisible ? enemy.x : enemy._lastSpotX;
      const y = isVisible ? enemy.y : enemy._lastSpotY;
      // Fade multiplier when contact is lost
      const lingerFade = isVisible ? 1.0 : Math.max(0, 1.0 - (now - enemy._lastSpotted) / LINGER_DURATION);

      // Color by who spotted: hero = cyan, ally = red
      const heroSpot = enemy._spottedByHero;
      const colorMain = heroSpot ? '#44ddff' : '#ff4444';
      const colorBright = heroSpot ? '#88eeff' : '#ff8888';
      const colorFade = heroSpot ? '#44bbdd' : '#ff6644';

      if (age <= PING_DURATION) {
        // Phase 1: Initial spot flash — bright, expanding diamond
        const t = age / PING_DURATION;
        const fade = (1.0 - t * t) * lingerFade;
        const scale = 1.0 + t * 0.5;
        const size = 12 * scale;

        ctx.globalAlpha = fade * 0.7;
        ctx.fillStyle = colorMain;
        ctx.beginPath();
        ctx.moveTo(x, y - size * 1.3);
        ctx.lineTo(x + size * 0.8, y);
        ctx.lineTo(x, y + size * 1.3);
        ctx.lineTo(x - size * 0.8, y);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = fade * 0.9;
        ctx.fillStyle = colorBright;
        const inner = size * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y - inner * 1.3);
        ctx.lineTo(x + inner * 0.8, y);
        ctx.lineTo(x, y + inner * 1.3);
        ctx.lineTo(x - inner * 0.8, y);
        ctx.closePath();
        ctx.fill();
      } else {
        // Phase 2: Persistent tracking marker — pulsing pip above unit
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
        const markerY = y - 18;
        const baseAlpha = isVisible ? (0.35 + pulse * 0.25) : (0.25 + pulse * 0.15) * lingerFade;

        ctx.globalAlpha = baseAlpha;
        ctx.fillStyle = isVisible ? colorMain : colorFade;
        const s = 4;
        ctx.beginPath();
        ctx.moveTo(x, markerY - s);
        ctx.lineTo(x + s * 0.7, markerY);
        ctx.lineTo(x, markerY + s);
        ctx.lineTo(x - s * 0.7, markerY);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (anyDrawn) ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // HERO SPOTTED ALERT — Diamond above hero when enemy has LOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Render a warning diamond above the hero when spotted by enemy units.
   * Pulses brightly on initial detection, then stays subdued while spotted.
   */
  renderHeroSpottedAlert(ctx, b, now) {
    const hero = b.hero;
    if (!hero || hero.dead || hero.observer) return;

    const isSpotted = hero._isSpottedByEnemy;

    // Track spot/unspot transitions
    if (isSpotted) {
      if (!hero._spottedPingStart) {
        hero._spottedPingStart = now; // Fresh spot — start pulse
      }
      hero._spottedLastSeen = now;
    } else if (!hero._spottedLastSeen) {
      return; // Never been spotted
    } else {
      const lostAge = now - hero._spottedLastSeen;
      if (lostAge > 1500) {
        hero._spottedPingStart = 0; // Reset for fresh ping on re-spot
        return;
      }
    }

    const PING_DURATION = 800;
    const age = now - hero._spottedPingStart;
    const x = hero.x;
    const y = hero.y - 30; // Above the tank
    // Fade out when no longer spotted
    const lingerFade = isSpotted ? 1.0 : Math.max(0, 1.0 - (now - hero._spottedLastSeen) / 1500);

    ctx.save();

    if (age <= PING_DURATION) {
      // Phase 1: Initial alert flash — bright expanding diamond
      const t = age / PING_DURATION;
      const fade = (1.0 - t * t) * lingerFade;
      const scale = 1.0 + t * 0.6;
      const size = 14 * scale;

      ctx.globalAlpha = fade * 0.8;
      ctx.fillStyle = '#ffaa22';
      ctx.beginPath();
      ctx.moveTo(x, y - size * 1.3);
      ctx.lineTo(x + size * 0.8, y);
      ctx.lineTo(x, y + size * 1.3);
      ctx.lineTo(x - size * 0.8, y);
      ctx.closePath();
      ctx.fill();

      // Bright inner core
      ctx.globalAlpha = fade * 0.95;
      ctx.fillStyle = '#ffdd66';
      const inner = size * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y - inner * 1.3);
      ctx.lineTo(x + inner * 0.8, y);
      ctx.lineTo(x, y + inner * 1.3);
      ctx.lineTo(x - inner * 0.8, y);
      ctx.closePath();
      ctx.fill();
    } else {
      // Phase 2: Subdued persistent indicator — gentle pulse
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
      const baseAlpha = (0.2 + pulse * 0.15) * lingerFade;

      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = '#ffaa22';
      const s = 5;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.7, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s * 0.7, y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Render a live vision polygon for the hero or selected unit.
   * Shows how far the unit can see in each direction, shrinking around terrain.
   */
  _renderVisionPolygon(ctx, b) {
    if (!b.debugOverlay && !b.showVision) return;

    // Pick unit to show vision for: hero first, then selected ally
    const unit = (b.hero && !b.hero.dead && !b.hero.observer)
      ? b.hero
      : b.units?.find(u => u.isSelected && !u.dead) || null;
    if (!unit) return;

    // Throttle: rebuild polygon every 200ms (5fps), cache between frames
    const now = performance.now();
    if (!this._visionCache || this._visionCache.unitId !== (unit.id || 'hero') ||
        now - this._visionCache.t > 200 ||
        Math.abs(unit.x - this._visionCache.x) > 5 ||
        Math.abs(unit.y - this._visionCache.y) > 5) {
      this._visionCache = {
        unitId: unit.id || 'hero',
        t: now,
        x: unit.x,
        y: unit.y,
        points: buildVisionPolygon(b, unit, 90)
      };
    }

    const points = this._visionCache.points;
    if (points.length < 3) return;

    ctx.save();

    // Draw filled polygon with soft gradient
    const maxR = unit.viewRange || 400;
    const gradient = ctx.createRadialGradient(unit.x, unit.y, 0, unit.x, unit.y, maxR);
    gradient.addColorStop(0, 'rgba(74, 158, 255, 0.22)');
    gradient.addColorStop(0.6, 'rgba(74, 158, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(74, 158, 255, 0.03)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw edge line
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw max range circle (dashed)
    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, maxR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  /**
   * Update fog-of-war alpha on an enemy for smooth fade in/out.
   * Returns the current fog alpha (0 = invisible, 1 = fully visible).
   * @param {object} enemy - Enemy entity
   * @param {Set|null} fogSet - Set of visible enemy IDs, or null to show all
   * @returns {number} Current fog alpha
   */
  _updateFogAlpha(enemy, fogSet) {
    // No fog of war — fully visible
    if (!fogSet) {
      enemy._fogAlpha = 1.0;
      return 1.0;
    }

    const isVisible = fogSet.has(enemy.id);
    const target = isVisible ? 1.0 : 0.0;

    if (enemy._fogAlpha === undefined) {
      enemy._fogAlpha = isVisible ? 1.0 : 0.0;
    }

    // Fade speed: ~0.3s fade in, ~1s fade out (per-frame lerp at ~60fps)
    const fadeSpeed = isVisible ? 3.0 : 1.0;
    const dt = 0.016;
    enemy._fogAlpha += (target - enemy._fogAlpha) * Math.min(1, fadeSpeed * dt);

    // Snap to target when very close
    if (Math.abs(enemy._fogAlpha - target) < 0.01) {
      enemy._fogAlpha = target;
    }

    return enemy._fogAlpha;
  }

  _roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _drawSelectionGlow(ctx, x, y, radius, now) {
    const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 / PULSE_PERIOD);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(74, 158, 255, ${0.3 + pulse * 0.4})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Render a dead unit as a greyed-out ghost at its last position.
   * Fades from full color to grey ghost over DEATH_FADE_MS.
   */
  _renderDead(ctx, x, y, angle, size, animId, now, unit) {
    // Stamp death time on first render after death
    if (!unit._deathTime) unit._deathTime = now;

    const DEATH_FADE_MS = 1500;
    const elapsed = now - unit._deathTime;
    const t = Math.min(1, elapsed / DEATH_FADE_MS); // 0 → 1 over fade duration

    // Lerp from full opacity to ghost opacity, full color to greyscale
    const alpha = 1 - t * 0.75;           // 1.0 → 0.25
    const grey = Math.round(t * 100);     // 0% → 100% greyscale

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = `grayscale(${grey}%)`;

    const hasAnim = animId && sprites.hasAnimatedUnit(animId);
    if (hasAnim) {
      const rotation = (angle * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, animId, x, y, rotation, size / UNIT_SIZE * 0.5, now);
    } else {
      const half = size / 2;
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      this._roundedRect(ctx, -half, -half, size, size, 5);
      ctx.fillStyle = '#666';
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw military rank insignia.
   * SGT (5) pulses continuously. All others pop in briefly on promotion then fade.
   * In debug mode, all ranks always visible.
   * Ranks: 0=PVT (none), 1=PV2, 2=PFC, 3=SPC, 4=CPL, 5=SGT
   * @param {boolean} [forceShow] - If true, always render (debug mode)
   */
  _drawRankChevrons(ctx, x, y, unit, now, forceShow) {
    const rank = unit._rank;
    if (rank == null || rank <= 0) return;

    let alpha;
    if (rank === 5) {
      // Sergeant: persistent pulse
      alpha = 0.4 + 0.3 * Math.sin(now * Math.PI * 2 / 2000);
    } else if (forceShow) {
      // Debug mode: always visible at steady opacity
      alpha = 0.6;
    } else {
      // Others: pop in on promotion, then fade out
      if (!unit._rankStampTime) unit._rankStampTime = now;
      const SHOW = 2000;
      const FADE = 1000;
      const elapsed = now - unit._rankStampTime;
      if (elapsed > SHOW + FADE) return; // Hidden
      alpha = elapsed > SHOW ? (1 - (elapsed - SHOW) / FADE) * 0.7 : 0.7;
    }

    // Try custom insignia set first (cached OffscreenCanvas)
    const setId = unit._insigniaSetId;
    if (setId) {
      const cached = getCachedInsignia(setId, rank);
      if (cached) {
        ctx.save();
        ctx.globalAlpha = alpha;
        // Draw cached canvas centered on unit. Cache is 48x48 logical at 2x res.
        const size = 36;
        ctx.drawImage(cached, x - size / 2, y - size / 2, size, size);
        ctx.restore();
        return;
      }
    }

    // Fallback: hardcoded insignia rendering
    const p = EntityRenderer.insigniaParams;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + p.yOffset);

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = p.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (rank === 3) {
      // Specialist — flipped PFC with eagle
      this._drawSpecialistInsignia(ctx);
    } else {
      // Chevron-based ranks
      const chevCount = rank === 1 ? 1 : rank === 2 ? 1 : rank === 4 ? 2 : rank === 5 ? 3 : 0;
      const hasRocker = rank === 2; // PFC gets a rocker above

      const p = EntityRenderer.insigniaParams;
      const chevW = p.chevW;
      const chevH = p.chevH;
      const gap = p.gap;
      const bow = chevW * p.bow;

      // Stack chevrons bottom-up (widest at bottom)
      const totalH = (chevCount - 1) * gap;
      const baseY = totalH / 2;

      for (let i = 0; i < chevCount; i++) {
        const ci = chevCount - 1 - i;
        const cy = baseY - ci * gap;
        const scale = 1 - ci * 0.12;
        const w = chevW * scale;

        this._drawSingleChevron(ctx, 0, cy - chevH / 2, w, chevH, bow * scale);
      }

      // PFC rocker — convex-up arc above the top chevron
      if (hasRocker) {
        const topApexY = baseY - (chevCount - 1) * gap - chevH / 2;
        const rockerY = topApexY - 3;
        const rockerW = chevW * 0.85;
        ctx.beginPath();
        ctx.moveTo(-rockerW, rockerY);
        ctx.quadraticCurveTo(0, rockerY - 4, rockerW, rockerY);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Draw a single curved chevron pointing UP.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx - Center X
   * @param {number} apexY - Y of the apex (top point)
   * @param {number} halfW - Half-width at the arm tips
   * @param {number} h - Height from apex to arm tips
   * @param {number} bow - Outward curve displacement
   */
  _drawSingleChevron(ctx, cx, apexY, halfW, h, bow) {
    const tipY = apexY + h; // Arms spread down from apex

    ctx.beginPath();
    // Left arm: from left tip UP to apex (with inward bow)
    ctx.moveTo(cx - halfW, tipY);
    ctx.quadraticCurveTo(cx - halfW * 0.5 + bow, apexY + h * 0.45, cx, apexY);
    // Right arm: from apex DOWN to right tip (with inward bow)
    ctx.quadraticCurveTo(cx + halfW * 0.5 - bow, apexY + h * 0.45, cx + halfW, tipY);
    ctx.stroke();
  }

  /**
   * Draw Specialist (E-4) insignia — flipped PFC (chevron down + rocker above), filled, with eagle.
   */
  _drawSpecialistInsignia(ctx) {
    const halfW = 6;
    const chevH = 6;
    const bow = halfW * 0.10;
    const rockerGap = 3.5;

    // Shape: rocker arc on top, downward-pointing chevron on bottom
    ctx.beginPath();
    // Left tip (mid-left)
    ctx.moveTo(-halfW, 0);
    // Rocker arc across the top (concave-down)
    ctx.quadraticCurveTo(0, -rockerGap, halfW, 0);
    // Right arm curves down to apex (bottom center)
    ctx.quadraticCurveTo(halfW * 0.5 + bow, chevH * 0.55, 0, chevH / 2 + 1);
    // Left arm curves back up to left tip
    ctx.quadraticCurveTo(-halfW * 0.5 - bow, chevH * 0.55, -halfW, 0);
    ctx.closePath();

    ctx.fillStyle = '#ffd700';
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * 0.5;
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
    ctx.stroke();

    // Tiny eagle wings inside
    ctx.beginPath();
    ctx.moveTo(-3, 0.5);
    ctx.quadraticCurveTo(-1.5, -1.5, 0, 0);
    ctx.quadraticCurveTo(1.5, -1.5, 3, 0.5);
    ctx.stroke();
  }

  /**
   * Draw a gold glow ring when a unit gets promoted (sergeant succession).
   * Expands outward and fades over 1.5s.
   */
  /**
   * Draw a subtle persistent gold outline around the sergeant (rank 3).
   */
  _drawSergeantOutline(ctx, x, y, radius, unit) {
    if ((unit._rank ?? 0) < 5) return; // Only sergeants (rank 5 = SGT)

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.restore();
  }

  _drawPromotionHighlight(ctx, x, y, radius, unit, now) {
    if (!unit._promotionTime) return;

    const DURATION = 1500;
    const elapsed = now - unit._promotionTime;
    if (elapsed > DURATION) {
      unit._promotionTime = null;
      return;
    }

    const t = elapsed / DURATION;
    const alpha = 1 - t;
    const ringRadius = radius + 4 + t * 12; // Expands outward

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2.5 * (1 - t * 0.5);
    ctx.globalAlpha = alpha * 0.8;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12 * alpha;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawHealthBar(ctx, x, y, ratio, isPlayer) {
    const w = 28;
    const h = 4;
    const halfW = w / 2;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x - halfW - 1, y - 1, w + 2, h + 2);

    // Fill
    const fillColor = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.fillStyle = fillColor;
    ctx.fillRect(x - halfW, y, w * ratio, h);
  }

  // ═══════════════════════════════════════════════════════════════
  // DEBUG OVERLAYS — Visual AI telemetry for Fire Range
  // ═══════════════════════════════════════════════════════════════

  renderDebugOverlays(ctx, b, now) {
    // Vision polygon for hero or selected unit
    this._renderVisionPolygon(ctx, b);

    // Show range circles even without full debug overlay
    if (b.debug?.showRanges && !b.debugOverlay) {
      ctx.save();
      const drawRange = (unit, color) => {
        if (unit.dead) return;
        const range = unit.range || 150;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (b.units) for (const u of b.units) drawRange(u, '#4a9eff');
      if (b.enemies) {
        const fogSet = b._visibleEnemies;
        for (const e of b.enemies) {
          if (fogSet && !fogSet.has(e.id)) continue;
          drawRange(e, '#ff4444');
        }
      }
      ctx.restore();
    }
    if (!b.debugOverlay) return;

    ctx.save();
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    // Draw ally debug overlays
    if (b.units) {
      for (const unit of b.units) {
        if (unit.dead) continue;
        this._drawUnitDebug(ctx, unit, b, '#4a9eff', true);
      }
    }

    // Draw enemy debug overlays (respect fog of war)
    if (b.enemies) {
      const fogSet = b._visibleEnemies;
      for (const enemy of b.enemies) {
        if (enemy.dead) continue;
        if (fogSet && !fogSet.has(enemy.id)) continue;
        this._drawUnitDebug(ctx, enemy, b, '#ff4444', false);
      }
    }

    // Show all rank insignia in debug mode (respect fog for enemies)
    const fogSet = b._visibleEnemies;
    if (b.units) {
      for (const u of b.units) {
        if (u.dead) continue;
        this._drawRankChevrons(ctx, u.x, u.y, u, now, true);
      }
    }
    if (b.enemies) {
      for (const u of b.enemies) {
        if (u.dead) continue;
        if (fogSet && !fogSet.has(u.id)) continue;
        this._drawRankChevrons(ctx, u.x, u.y, u, now, true);
      }
    }

    ctx.restore();
  }

  _drawUnitDebug(ctx, unit, b, color, isAlly) {
    const dbg = unit._dbg;
    if (!dbg) return;

    const x = unit.x;
    const y = unit.y;
    const r = isAlly ? 20 : 15;

    // State label above unit
    const stateText = dbg.state || '?';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const textW = ctx.measureText(stateText).width + 6;
    ctx.fillRect(x - textW / 2, y - r - 18, textW, 12);
    ctx.fillStyle = color;
    ctx.fillText(stateText, x, y - r - 8);
    ctx.restore();

    // Stability bar (below unit)
    const stability = dbg.stability || 0;
    const barW = 24;
    const barH = 3;
    const barX = x - barW / 2;
    const barY = y + r + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = stability > 0.7 ? '#4ade80' : stability > 0.3 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(barX, barY, barW * stability, barH);

    // Facing arrow (short line from center in direction of angle)
    const arrowLen = r + 10;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(unit.angle) * arrowLen, y + Math.sin(unit.angle) * arrowLen);
    ctx.stroke();
    ctx.restore();

    // Target line (dashed line from unit to its target)
    if (dbg.targetId) {
      const target = this._findEntityById(b, dbg.targetId);
      if (target && !target.dead) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Range circle (dashed)
    const range = unit.range || dbg.range || 150;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.15;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(x, y, range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Fire indicator (flash when firing)
    if (dbg.fireResult?.canFire) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Render spawn zone indicators (always visible, not just debug).
   * Draws dashed circles with subtle fill for blue and red zones.
   */
  renderSpawnZones(ctx, b) {
    const zones = [
      { zone: b.blueSpawnZone, stroke: '#4a9eff', fill: 'rgba(74, 158, 255, 0.06)', label: 'BLUE BASE' },
      { zone: b.redSpawnZone, stroke: '#ff4444', fill: 'rgba(255, 68, 68, 0.06)', label: 'RED BASE' }
    ];

    ctx.save();
    for (const { zone, stroke, fill, label } of zones) {
      if (!zone) continue;

      // Zone circle
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle fill
      ctx.fillStyle = fill;
      ctx.globalAlpha = 1;
      ctx.fill();

      // Label
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = stroke;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, zone.x, zone.y - zone.radius - 8);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Render speech bubbles above sergeant units.
   * Bubbles auto-fade after BUBBLE_DURATION (2.5s).
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} b - Battle state
   * @param {number} now - Date.now()
   */
  renderSpeechBubbles(ctx, b, now) {
    const BUBBLE_DURATION = 2500;
    const allUnits = [...(b.units || []), ...(b.enemies || [])];
    const fogSet = b._visibleEnemies;
    const enemySet = b.enemies ? new Set(b.enemies.map(e => e.id)) : null;

    for (const unit of allUnits) {
      const bubble = unit._speechBubble;
      if (!bubble || unit.dead) continue;
      // Hide speech bubbles for fogged enemies
      if (fogSet && enemySet?.has(unit.id) && !fogSet.has(unit.id)) continue;

      const age = now - bubble.t;
      if (age < 0 || age > BUBBLE_DURATION) continue;

      // Fade out in the last 500ms
      const alpha = age > BUBBLE_DURATION - 500
        ? (BUBBLE_DURATION - age) / 500
        : 1;

      const x = unit.x;
      const y = unit.y;
      const r = 20;
      const text = bubble.text;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      const textW = ctx.measureText(text).width;
      const padX = 8;
      const padY = 4;
      const bw = textW + padX * 2;
      const bh = 16 + padY * 2;
      const bx = x - bw / 2;
      const by = y - r - bh - 8;

      // Team color for bubble
      const isBlue = (b.units || []).includes(unit);
      const bgColor = isBlue ? 'rgba(30, 58, 95, 0.9)' : 'rgba(95, 30, 30, 0.9)';
      const borderColor = isBlue ? '#4a9eff' : '#ff4444';
      const textColor = '#ffffff';

      // Bubble background with rounded corners
      const cr = 6;
      ctx.beginPath();
      ctx.moveTo(bx + cr, by);
      ctx.lineTo(bx + bw - cr, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + cr);
      ctx.lineTo(bx + bw, by + bh - cr);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - cr, by + bh);
      // Small triangle pointer
      ctx.lineTo(x + 6, by + bh);
      ctx.lineTo(x, by + bh + 6);
      ctx.lineTo(x - 6, by + bh);
      ctx.lineTo(bx + cr, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - cr);
      ctx.lineTo(bx, by + cr);
      ctx.quadraticCurveTo(bx, by, bx + cr, by);
      ctx.closePath();

      ctx.fillStyle = bgColor;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Text
      ctx.fillStyle = textColor;
      ctx.fillText(text, x, by + bh - padY);

      ctx.restore();
    }
  }

  _findEntityById(b, id) {
    if (b.units) {
      for (const u of b.units) if (u.id === id) return u;
    }
    if (b.enemies) {
      for (const e of b.enemies) if (e.id === id) return e;
    }
    if (b.hero && (id === 'hero' || b.hero.id === id)) return b.hero;
    return null;
  }
}
