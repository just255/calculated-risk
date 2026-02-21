// ═══════════════════════════════════════════════════════════════
// ENTITY RENDERER - Canvas-based drawing of game entities
// Replaces DOM div creation in drawHeroBattle()
// Matches visual appearance of the existing DOM rendering
// ═══════════════════════════════════════════════════════════════

import * as sprites from './sprites.js';

// Entity sizes (matching current DOM div sizes)
const HERO_SIZE = 40;
const UNIT_SIZE = 40;
const ENEMY_SIZE = 30;
const PROJ_SIZE = 8;

// Animation timing
const PULSE_PERIOD = 1000; // ms for selection pulse
const TARGET_PULSE_PERIOD = 800; // ms for concentrate-target pulse

export class EntityRenderer {

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
    const hasAnim = unit.animId && sprites.hasAnimatedUnit(unit.animId);

    if (hasAnim) {
      // Selection glow behind sprite
      if (isSelected) {
        this._drawSelectionGlow(ctx, unit.x, unit.y, UNIT_SIZE / 2, now);
      }
      const rotation = (unit.angle * 180 / Math.PI) + 90;
      sprites.renderAnimatedUnit(ctx, unit.animId, unit.x, unit.y, rotation, 0.5, now);
    } else {
      // Fallback: colored rounded rect
      const half = UNIT_SIZE / 2;
      ctx.save();
      ctx.translate(unit.x, unit.y);
      ctx.rotate(unit.angle + Math.PI / 2);

      this._roundedRect(ctx, -half, -half, UNIT_SIZE, UNIT_SIZE, 5);
      ctx.fillStyle = isSelected ? '#7ab87a' : '#5a8a5a';
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 3;
        ctx.stroke();
        // Glow effect
        ctx.shadowColor = '#4a9eff';
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = '#3a6a3a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /**
   * Render an enemy.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} enemy - Enemy entity { x, y, hp, maxHp, dead, id }
   * @param {boolean} isConcentrateTarget - Whether this enemy is the concentrate-fire target
   * @param {number} now - performance.now() for animation timing
   */
  renderEnemy(ctx, enemy, isConcentrateTarget, now) {
    if (enemy.dead) return;

    const r = ENEMY_SIZE / 2;
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
      // Fallback: red circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);

      ctx.fillStyle = '#ff4444';
      ctx.fill();

      if (isConcentrateTarget) {
        const pulse = 0.7 + 0.3 * Math.sin(now * Math.PI * 2 / TARGET_PULSE_PERIOD);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15 * pulse;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = '#aa0000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.restore();
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
  }

  /**
   * Render a projectile.
   * @param {CanvasRenderingContext2D} ctx - Context with world transform applied
   * @param {object} proj - Projectile { x, y, owner }
   */
  renderProjectile(ctx, proj) {
    const r = PROJ_SIZE / 2;
    const isPlayer = proj.owner === 'player';

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

    // Enemies
    if (b.enemies) {
      for (const enemy of b.enemies) {
        this.renderEnemy(ctx, enemy, enemy.id === concentrateTargetId, now);
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
      for (const enemy of b.enemies) {
        if (enemy.dead) continue;
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
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

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
      if (b.enemies) for (const e of b.enemies) drawRange(e, '#ff4444');
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

    // Draw enemy debug overlays
    if (b.enemies) {
      for (const enemy of b.enemies) {
        if (enemy.dead) continue;
        this._drawUnitDebug(ctx, enemy, b, '#ff4444', false);
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
