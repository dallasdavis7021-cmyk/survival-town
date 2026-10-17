import Phaser from 'phaser';
import type { CavePoint, CaveRoom, ParsedCaveMap } from '../maps/caveLayout';
import { gameState, type CaveGemId } from '../state/GameState';
import {
  CAVE_GEM_RESPAWN_ON_LEAVE_CHANCE,
  CAVE_GEM_SPAWN_CHANCE,
  CAVE_GEMS,
  MINERAL_TEXTURE,
  styleMineralSprite,
} from './Minerals';

export type GemSprite = Phaser.Physics.Arcade.Image & {
  mineralId: CaveGemId;
  tileTx: number;
  tileTy: number;
};

/**
 * Cave gems (diamond / emerald / sapphire): rooms only, low rate.
 * Mined → inventory; on cave leave, low chance to queue respawn at a different room.
 */
export class CaveGemSpawner {
  private scene: Phaser.Scene;
  private map: ParsedCaveMap;
  private group: Phaser.Physics.Arcade.StaticGroup;
  private occupied = new Set<string>();
  private minedThisVisit: { id: CaveGemId; tx: number; ty: number }[] = [];

  constructor(scene: Phaser.Scene, map: ParsedCaveMap) {
    this.scene = scene;
    this.map = map;
    this.group = scene.physics.add.staticGroup();
  }

  get nodes(): Phaser.Physics.Arcade.StaticGroup {
    return this.group;
  }

  /** Ambient low-rate spawn + any pending respawns from a prior leave. */
  populate(): void {
    this.minedThisVisit = [];
    this.occupied.clear();

    const pending = gameState.takePendingCaveGems();
    for (const gem of pending) {
      const tile = this.pickRoomTile(gem.excludeTx, gem.excludeTy);
      if (tile) {
        this.spawnAt(gem.id, tile);
      }
    }

    for (const id of CAVE_GEMS) {
      if (Math.random() > CAVE_GEM_SPAWN_CHANCE) {
        continue;
      }
      const tile = this.pickRoomTile();
      if (tile) {
        this.spawnAt(id, tile);
      }
    }
  }

  tryMineNear(worldX: number, worldY: number, playerX: number, playerY: number, range: number): boolean {
    const sprites = this.group.getChildren() as GemSprite[];
    const inRange = sprites.filter(
      (s) => s.active && Phaser.Math.Distance.Between(playerX, playerY, s.x, s.y) <= range,
    );
    if (inRange.length === 0) {
      return false;
    }

    inRange.sort(
      (a, b) =>
        Phaser.Math.Distance.Between(worldX, worldY, a.x, a.y) -
        Phaser.Math.Distance.Between(worldX, worldY, b.x, b.y),
    );
    const node = inRange[0];

    gameState.addItem(node.mineralId, 1);
    this.minedThisVisit.push({ id: node.mineralId, tx: node.tileTx, ty: node.tileTy });
    this.occupied.delete(`${node.tileTx},${node.tileTy}`);
    this.float(node.x, node.y, `+1 ${node.mineralId}`, '#e0f2fe');
    node.destroy();
    gameState.saveNow();
    return true;
  }

  /** Call when leaving the cave — may queue respawns at different rooms. */
  onLeaveCave(): void {
    for (const mined of this.minedThisVisit) {
      if (Math.random() > CAVE_GEM_RESPAWN_ON_LEAVE_CHANCE) {
        continue;
      }
      gameState.queueCaveGemRespawn({
        id: mined.id,
        excludeTx: mined.tx,
        excludeTy: mined.ty,
      });
    }
    this.minedThisVisit = [];
    gameState.saveNow();
  }

  private spawnAt(id: CaveGemId, tile: CavePoint): void {
    const key = `${tile.tx},${tile.ty}`;
    if (this.occupied.has(key)) {
      return;
    }
    this.occupied.add(key);

    const sprite = this.group.create(tile.x, tile.y, MINERAL_TEXTURE[id]) as GemSprite;
    sprite.mineralId = id;
    sprite.tileTx = tile.tx;
    sprite.tileTy = tile.ty;
    styleMineralSprite(sprite);
    sprite.refreshBody();
  }

  private pickRoomTile(excludeTx = -999, excludeTy = -999): CavePoint | null {
    const candidates: CavePoint[] = [];
    for (const room of this.map.rooms) {
      for (const tile of room.tiles) {
        if (tile.tx === excludeTx && tile.ty === excludeTy) {
          continue;
        }
        // Prefer interior (not on room edge) when possible
        if (
          tile.tx <= room.x0 ||
          tile.ty <= room.y0 ||
          tile.tx >= room.x1 ||
          tile.ty >= room.y1
        ) {
          continue;
        }
        const key = `${tile.tx},${tile.ty}`;
        if (this.occupied.has(key)) {
          continue;
        }
        // Avoid overlapping baked ore / spawn markers if cell isn't plain floor-ish
        candidates.push(tile);
      }
    }

    // Fallback: any room tile
    if (candidates.length === 0) {
      for (const room of this.map.rooms) {
        for (const tile of room.tiles) {
          if (tile.tx === excludeTx && tile.ty === excludeTy) continue;
          if (this.occupied.has(`${tile.tx},${tile.ty}`)) continue;
          candidates.push(tile);
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Prefer a different room than exclude when possible
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled[0] ?? null;
  }

  private float(x: number, y: number, label: string, color: string): void {
    const t = this.scene.add
      .text(x, y - 12, label, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color,
      })
      .setOrigin(0.5)
      .setDepth(40);
    this.scene.tweens.add({
      targets: t,
      y: y - 36,
      alpha: 0,
      duration: 700,
      onComplete: () => t.destroy(),
    });
  }
}

export function roomCountLabel(rooms: CaveRoom[]): string {
  return `${rooms.length} rooms`;
}
