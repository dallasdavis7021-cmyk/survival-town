import Phaser from 'phaser';
import { CAVE_TILE, type CaveRoom } from '../maps/caveLayout';
import { CREATURE_ATLAS } from './creatureAtlasMeta';
import type { FacingDir } from './PlayerSprite';

export const CREATURE_TEXTURE = 'cave-creature-sheet';
const DISPLAY_HEIGHT = 36;

/**
 * Room size for spawn counts (bounding-box tile area).
 * Small: area < SMALL_ROOM_AREA → 1 creature
 * Big:   area ≥ SMALL_ROOM_AREA → 2 creatures
 */
export const SMALL_ROOM_AREA = 70;

export function roomBoundingArea(room: CaveRoom): number {
  return (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1);
}

export function creatureCountForRoom(room: CaveRoom): 1 | 2 {
  return roomBoundingArea(room) < SMALL_ROOM_AREA ? 1 : 2;
}

/** Pick distinct walkable tiles inside a room for creature spawns. */
export function pickRoomSpawnPoints(
  room: CaveRoom,
  count: number,
): { x: number; y: number; tx: number; ty: number }[] {
  const tiles = [...room.tiles];
  if (tiles.length === 0) {
    return [];
  }
  // Prefer interior tiles (not on room edge) when available
  const interior = tiles.filter(
    (t) => t.tx > room.x0 && t.tx < room.x1 && t.ty > room.y0 && t.ty < room.y1,
  );
  const pool = [...(interior.length >= count ? interior : tiles)];
  const picks: { x: number; y: number; tx: number; ty: number }[] = [];
  const used = new Set<string>();

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (const t of pool) {
    if (picks.length >= count) {
      break;
    }
    const key = `${t.tx},${t.ty}`;
    if (used.has(key)) {
      continue;
    }
    // Keep spawns a bit apart in big rooms
    const tooClose = picks.some(
      (p) => Math.abs(p.tx - t.tx) + Math.abs(p.ty - t.ty) < 3,
    );
    if (tooClose && pool.length > count + 2) {
      continue;
    }
    used.add(key);
    picks.push({ x: t.x, y: t.y, tx: t.tx, ty: t.ty });
  }

  // Fallback if spacing was too strict
  while (picks.length < count && picks.length < tiles.length) {
    const t = tiles[picks.length % tiles.length];
    const key = `${t.tx},${t.ty}`;
    if (!used.has(key)) {
      used.add(key);
      picks.push({ x: t.x, y: t.y, tx: t.tx, ty: t.ty });
    } else {
      break;
    }
  }

  return picks;
}

export function preloadCaveCreature(scene: Phaser.Scene): void {
  if (!scene.textures.exists(CREATURE_TEXTURE)) {
    scene.load.spritesheet(CREATURE_TEXTURE, '/assets/creature/creature-atlas.png', {
      frameWidth: CREATURE_ATLAS.frameWidth,
      frameHeight: CREATURE_ATLAS.frameHeight,
    });
  }
}

export function ensureCaveCreatureLoaded(scene: Phaser.Scene): Promise<void> {
  if (scene.textures.exists(CREATURE_TEXTURE)) {
    registerCreatureAnims(scene);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    preloadCaveCreature(scene);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      registerCreatureAnims(scene);
      resolve();
    });
    scene.load.start();
  });
}

export function registerCreatureAnims(scene: Phaser.Scene): void {
  if (!scene.textures.exists(CREATURE_TEXTURE) || scene.anims.exists('creature-walk-down')) {
    return;
  }
  const mk = (key: string, frames: readonly number[], frameRate: number, repeat: number) => {
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(CREATURE_TEXTURE, { frames: [...frames] }),
      frameRate,
      repeat,
    });
  };
  const a = CREATURE_ATLAS.anims;
  mk('creature-idle-down', a['idle-down'], 1, -1);
  mk('creature-walk-down', a['walk-down'], 7, -1);
  mk('creature-idle-up', a['idle-up'], 1, -1);
  mk('creature-walk-up', a['walk-up'], 7, -1);
  mk('creature-idle-right', a['idle-right'], 1, -1);
  mk('creature-walk-right', a['walk-right'], 7, -1);
  // Left uses flipX on right frames
  mk('creature-idle-left', a['idle-right'], 1, -1);
  mk('creature-walk-left', a['walk-right'], 7, -1);
  mk('creature-attack', a.attack, 9, 0);
  mk('creature-downed', a.downed, 1, 0);
}

export function styleCaveCreature(sprite: Phaser.Physics.Arcade.Sprite, tier: 1 | 2 | 3): void {
  registerCreatureAnims(sprite.scene);
  const scale =
    (DISPLAY_HEIGHT / CREATURE_ATLAS.frameHeight) *
    (tier === 3 ? 1.15 : tier === 2 ? 1.05 : 1);
  sprite.setTexture(CREATURE_TEXTURE, 0);
  sprite.setScale(scale);
  sprite.setOrigin(0.5, 0.8);
  sprite.clearTint();
  const body = sprite.body as Phaser.Physics.Arcade.Body;
  body.setSize(18, 14);
  body.setOffset((CREATURE_ATLAS.frameWidth - 18) / 2, CREATURE_ATLAS.frameHeight - 16);
  if (sprite.anims.animationManager.exists('creature-idle-down')) {
    sprite.play('creature-idle-down');
  }
}

export function facingFromVelocity(vx: number, vy: number): FacingDir {
  if (Math.abs(vx) > Math.abs(vy)) {
    return vx < 0 ? 'left' : 'right';
  }
  return vy < 0 ? 'up' : 'down';
}

export function updateCreatureAnim(
  sprite: Phaser.Physics.Arcade.Sprite,
  facing: FacingDir,
  moving: boolean,
  mode: 'loco' | 'attack' | 'downed',
): void {
  if (mode === 'downed') {
    if (sprite.anims.currentAnim?.key !== 'creature-downed') {
      sprite.setFlipX(false);
      sprite.play('creature-downed', true);
    }
    return;
  }
  if (mode === 'attack') {
    if (sprite.anims.currentAnim?.key !== 'creature-attack') {
      sprite.setFlipX(facing === 'left');
      sprite.play('creature-attack', true);
    }
    return;
  }

  const current = sprite.anims.currentAnim?.key ?? '';
  if (current === 'creature-attack' && sprite.anims.isPlaying) {
    return;
  }

  sprite.setFlipX(facing === 'left');
  const dir = facing === 'left' ? 'left' : facing;
  const want = moving ? `creature-walk-${dir}` : `creature-idle-${dir}`;
  // left idle/walk exist; for up/down don't flip
  if (facing === 'up' || facing === 'down') {
    sprite.setFlipX(false);
  }
  if (current !== want && sprite.anims.animationManager.exists(want)) {
    sprite.play(want, true);
  }
}

/** Find the cave room containing a world point (or nearest by tile). */
export function findRoomAt(
  rooms: CaveRoom[],
  worldX: number,
  worldY: number,
): CaveRoom | null {
  const tx = Math.floor(worldX / CAVE_TILE);
  const ty = Math.floor(worldY / CAVE_TILE);
  for (const room of rooms) {
    if (tx >= room.x0 && tx <= room.x1 && ty >= room.y0 && ty <= room.y1) {
      return room;
    }
  }
  // nearest room by center distance
  let best: CaveRoom | null = null;
  let bestD = Infinity;
  for (const room of rooms) {
    const cx = ((room.x0 + room.x1) / 2) * CAVE_TILE;
    const cy = ((room.y0 + room.y1) / 2) * CAVE_TILE;
    const d = Phaser.Math.Distance.Between(worldX, worldY, cx, cy);
    if (d < bestD) {
      bestD = d;
      best = room;
    }
  }
  return best;
}

export function pickRoomPatrolTarget(room: CaveRoom): { x: number; y: number } | null {
  if (room.tiles.length === 0) {
    return null;
  }
  const t = room.tiles[Math.floor(Math.random() * room.tiles.length)];
  return { x: t.x, y: t.y };
}

/** Soft-clamp: if next position would leave walkable, zero that axis. */
export function constrainToWalkable(
  sprite: Phaser.Physics.Arcade.Sprite,
  walkable: boolean[][],
  tileSize: number,
): void {
  const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
  if (!body) {
    return;
  }
  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;
  const tryX = sprite.x + body.velocity.x * (1 / 60);
  const tryY = sprite.y + body.velocity.y * (1 / 60);

  const tileOk = (wx: number, wy: number) => {
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    if (ty < 0 || tx < 0 || ty >= rows || tx >= cols) {
      return false;
    }
    return walkable[ty][tx];
  };

  if (!tileOk(tryX, sprite.y)) {
    body.setVelocityX(0);
  }
  if (!tileOk(sprite.x, tryY)) {
    body.setVelocityY(0);
  }
  // If still stuck off-walkable, nudge toward nearest walkable in 3x3
  if (!tileOk(sprite.x, sprite.y)) {
    const tx = Math.floor(sprite.x / tileSize);
    const ty = Math.floor(sprite.y / tileSize);
    for (let r = 1; r <= 3; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (ny >= 0 && nx >= 0 && ny < rows && nx < cols && walkable[ny][nx]) {
            sprite.setPosition(nx * tileSize + tileSize / 2, ny * tileSize + tileSize / 2);
            body.setVelocity(0, 0);
            return;
          }
        }
      }
    }
  }
}
