// ═══════════════════════════════════════════════════════════════
// BRIDGE RENDERER - Shared bridge rendering for editor + battle
// ═══════════════════════════════════════════════════════════════

/**
 * Render bridge deck textures onto a canvas context.
 * Tiles the deck texture along the bridge centerline, rotated so planks cross the width.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} bridges - Bridge data objects
 * @param {object} groundImages - Map of texture key → HTMLImageElement (must contain bridge-wood/bridge-stone)
 */
export function renderBridgeDecks(ctx, bridges, groundImages) {
  if (!bridges || bridges.length === 0) return;

  for (const bridge of bridges) {
    const { x, y, width: deckWidth, length, dirX, dirY, deckTexture } = bridge;
    const texType = deckTexture || 'bridge-wood';
    const textureImg = groundImages?.[texType];
    if (!textureImg) continue;

    const angle = Math.atan2(dirY, dirX);
    const tw = textureImg.width;
    const th = textureImg.height;
    const halfLen = length / 2;

    // Scale: fit source width (plank direction) to deckWidth
    const scale = deckWidth / tw;
    const tileLen = th * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = false;

    // Clip to bridge bounds
    ctx.beginPath();
    ctx.rect(-halfLen, -deckWidth / 2, length, deckWidth);
    ctx.clip();

    // Tile along bridge length. Each tile rotated 90° so source X
    // (planks) spans across the deck width (Y in rotated space).
    for (let pos = -halfLen; pos < halfLen; pos += tileLen) {
      ctx.save();
      ctx.translate(pos + tileLen / 2, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(textureImg, -deckWidth / 2, -tileLen / 2, deckWidth, tileLen);
      ctx.restore();
    }

    ctx.restore();
  }
}

/**
 * Render bridge truss sprites as canopy overlay (above entities).
 * Whole-tile snapping with rail-only end caps.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} bridges - Bridge data objects
 * @param {object} bridgeImages - Map of sprite key → HTMLImageElement (truss-1, truss-2, etc.)
 */
export function renderBridgeTrusses(ctx, bridges, bridgeImages) {
  if (!bridges || bridges.length === 0) return;
  if (!bridgeImages || Object.keys(bridgeImages).length === 0) return;

  for (const bridge of bridges) {
    if (!bridge.trussEnabled) continue;

    const variant = bridge.trussVariant || 2;
    const trussKey = `truss-${variant}`;
    const img = bridgeImages[trussKey];
    if (!img) continue;

    const { x, y, width, length, dirX, dirY } = bridge;
    const angle = Math.atan2(dirY, dirX);

    // Truss slightly narrower than deck
    const trussWidth = width * 0.95;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle - Math.PI / 2); // Align sprite's vertical axis with bridge direction

    // Tile height from sprite aspect ratio so cross-braces aren't stretched
    const tileHeight = trussWidth * (img.height / img.width);
    // Snap to whole tiles — no mid-pattern clipping
    const maxBody = length * 0.85;
    const totalTiles = Math.max(1, Math.floor(maxBody / tileHeight));
    const trussLength = totalTiles * tileHeight;
    const halfTruss = trussLength / 2;
    const halfDeck = length / 2;
    const halfTW = Math.round(trussWidth / 2);

    ctx.imageSmoothingEnabled = false;

    // Main truss body (cross-braced), exact whole tiles
    const startY = -halfTruss;
    for (let i = 0; i < totalTiles; i++) {
      const ty = Math.round(startY + i * tileHeight);
      const th = Math.round(tileHeight) + 1;
      ctx.drawImage(img, -halfTW, ty, Math.round(trussWidth), th);
    }

    // End caps: side rails only, from truss edge to deck edge
    const railFrac = 0.22;
    const srcW = img.width;
    const srcRailW = Math.round(srcW * railFrac);
    const railW = Math.round(trussWidth * railFrac);
    const capLen = halfDeck - halfTruss;
    const railTileH = railW * (img.height / srcRailW);

    if (capLen > 0) {
      // Top end cap
      ctx.save();
      ctx.beginPath();
      ctx.rect(-halfTW, -halfDeck, trussWidth, capLen);
      ctx.clip();
      for (let t = 0; t < Math.ceil(capLen / railTileH); t++) {
        const ty = -halfDeck + t * railTileH;
        ctx.drawImage(img, 0, 0, srcRailW, img.height,
          -halfTW, ty, railW, Math.round(railTileH));
        ctx.drawImage(img, srcW - srcRailW, 0, srcRailW, img.height,
          halfTW - railW, ty, railW, Math.round(railTileH));
      }
      ctx.restore();

      // Bottom end cap
      ctx.save();
      ctx.beginPath();
      ctx.rect(-halfTW, halfTruss, trussWidth, capLen);
      ctx.clip();
      for (let t = 0; t < Math.ceil(capLen / railTileH); t++) {
        const ty = halfTruss + t * railTileH;
        ctx.drawImage(img, 0, 0, srcRailW, img.height,
          -halfTW, ty, railW, Math.round(railTileH));
        ctx.drawImage(img, srcW - srcRailW, 0, srcRailW, img.height,
          halfTW - railW, ty, railW, Math.round(railTileH));
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
