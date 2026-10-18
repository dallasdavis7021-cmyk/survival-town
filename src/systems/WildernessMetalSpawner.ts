import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import {
  MINERAL_TEXTURE,
  styleMineralSprite,
  WILDERNESS_METALS,
  WILDERNESS_OFFSCREEN_MARGIN,
  WILDERNESS_TARGET_COUNT,
  type WildernessMetalId,
} from './Minerals';

export type MetalSprite = Phaser.Physics.Arcade.Image & {
  mineralId: WildernessMetalId;
  gridX: number;
  gridY: number;
};

interface PendingRespawn {
  id: WildernessMetalId;
  minedAtX: number;
  minedAtY: number;
}

/**
 * Wilderness metals (gold / iron / silver): outside town safe zone only.
 * Higher density than cave gems. After mine: no on-screen respawn;
 * once the player walks away, may appear at a different off-screen cell.
 */
export class WildernessMetalSpawner {
  private scene: Phaser.Scene;
  private group: Phaser.Physics.Arcade.StaticGroup;
  private wildernessCells: { gx: number; gy: number; x: number; y: number }[];
  private occupied = new Set<string>();
  private pending: PendingRespawn[] = [];

  constructor(
    scene: Phaser.Scene,
    wildernessCells: { gx: number; gy: number; x: number; y: number }[],
    _tileSize: number,
  ) {
    this.scene = scene;
    this.wildernessCells = wildernessCells;
    this.group = scene.physics.add.staticGroup();
  }

  get nodes(): Phaser.Physics.Arcade.StaticGroup {
    return this.group;
  }

  populate(): void {
    const target = Math.min(WILDERNESS_TARGET_COUNT, this.wildernessCells.length);
    let placed = 0;
    const shuffled = [...this.wildernessCells].sort(() => Math.random() - 0.5);

    for (const cell of shuffled) {
      if (placed >= target) {
        break;
      }
      const id = WILDERNESS_METALS[placed % WILDERNESS_METALS.length];
      if (this.spawnAt(id, cell.gx, cell.gy, cell.x, cell.y)) {
        placed += 1;
      }
    }
  }

  update(player: Phaser.GameObjects.Sprite, camera: Phaser.Cameras.Scene2D.Camera): void {
    if (this.pending.length === 0) {
      return;
    }

    const stillPending: PendingRespawn[] = [];
    for (const p of this.pending) {
      const dist = Phaser.Math.Distance.Between(player.x, player.y, p.minedAtX, p.minedAtY);
      // Player must leave the mined area before respawn is allowed
      if (dist < 220) {
        stillPending.push(p);
        continue;
      }

      const cell = this.pickOffscreenCell(camera, p.minedAtX, p.minedAtY);
      if (!cell) {
        stillPending.push(p);
        continue;
      }

      this.spawnAt(p.id, cell.gx, cell.gy, cell.x, cell.y);
    }
    this.pending = stillPending;
  }

  tryMineNear(worldX: number, worldY: number, playerX: number, playerY: number, range: number): boolean {
    const sprites = this.group.getChildren() as MetalSprite[];
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
    this.occupied.delete(`${node.gridX},${node.gridY}`);
    this.pending.push({
      id: node.mineralId,
      minedAtX: node.x,
      minedAtY: node.y,
    });
    this.float(node.x, node.y, `+1 ${node.mineralId}`, '#fde68a');
    node.destroy();
    gameState.saveNow();
    return true;
  }

  private spawnAt(
    id: WildernessMetalId,
    gx: number,
    gy: number,
    x: number,
    y: number,
  ): boolean {
    const key = `${gx},${gy}`;
    if (this.occupied.has(key)) {
      return false;
    }
    this.occupied.add(key);

    const sprite = this.group.create(x, y, MINERAL_TEXTURE[id]) as MetalSprite;
    sprite.mineralId = id;
    sprite.gridX = gx;
    sprite.gridY = gy;
    styleMineralSprite(sprite);
    sprite.refreshBody();
    return true;
  }

  private pickOffscreenCell(
    camera: Phaser.Cameras.Scene2D.Camera,
    avoidX: number,
    avoidY: number,
  ): { gx: number; gy: number; x: number; y: number } | null {
    const view = new Phaser.Geom.Rectangle(
      camera.scrollX - WILDERNESS_OFFSCREEN_MARGIN,
      camera.scrollY - WILDERNESS_OFFSCREEN_MARGIN,
      camera.width + WILDERNESS_OFFSCREEN_MARGIN * 2,
      camera.height + WILDERNESS_OFFSCREEN_MARGIN * 2,
    );

    const candidates = this.wildernessCells.filter((c) => {
      if (this.occupied.has(`${c.gx},${c.gy}`)) {
        return false;
      }
      if (Phaser.Math.Distance.Between(c.x, c.y, avoidX, avoidY) < 160) {
        return false;
      }
      return !view.contains(c.x, c.y);
    });

    if (candidates.length === 0) {
      return null;
    }

    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
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
