import Phaser from 'phaser';
import { gameState, type InventoryItemId } from '../state/GameState';

const PICKUP_RADIUS = 48;

export type LootSprite = Phaser.Physics.Arcade.Image & {
  lootId: InventoryItemId;
  lootAmount: number;
};

const LOOT_TINT: Record<InventoryItemId, number> = {
  wood: 0xb45309,
  stone: 0x94a3b8,
  ore: 0x38bdf8,
  scrap: 0xfbbf24,
  crystal: 0xc084fc,
};

/**
 * Ground loot pickups. E (via collectNear) adds items to GameState inventory.
 */
export class LootDrops {
  private scene: Phaser.Scene;
  private group: Phaser.Physics.Arcade.Group;
  private onCollected?: (id: InventoryItemId, amount: number) => void;

  constructor(
    scene: Phaser.Scene,
    options?: { onCollected?: (id: InventoryItemId, amount: number) => void },
  ) {
    this.scene = scene;
    this.onCollected = options?.onCollected;
    this.group = scene.physics.add.group({ allowGravity: false });
  }

  get physicsGroup(): Phaser.Physics.Arcade.Group {
    return this.group;
  }

  drop(x: number, y: number, id: InventoryItemId, amount = 1): void {
    if (amount <= 0) {
      return;
    }

    const jitterX = (Math.random() - 0.5) * 18;
    const jitterY = (Math.random() - 0.5) * 18;
    const sprite = this.group.create(x + jitterX, y + jitterY, 'loot-orb') as LootSprite;
    sprite.lootId = id;
    sprite.lootAmount = amount;
    sprite.setTint(LOOT_TINT[id] ?? 0xffffff);
    sprite.setDepth(15);
    sprite.setScale(0.85);
    sprite.setData('loot', true);

    this.scene.tweens.add({
      targets: sprite,
      y: sprite.y - 6,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  dropMany(x: number, y: number, drops: { id: InventoryItemId; n: number }[]): void {
    for (const d of drops) {
      // One orb per stack keeps ground readable
      this.drop(x, y, d.id, d.n);
    }
  }

  /** Pick up all loot near the player. Returns count of stacks collected. */
  collectNear(playerX: number, playerY: number): number {
    let collected = 0;
    const children = [...this.group.getChildren()] as LootSprite[];

    for (const sprite of children) {
      if (!sprite.active) {
        continue;
      }
      const dist = Phaser.Math.Distance.Between(playerX, playerY, sprite.x, sprite.y);
      if (dist > PICKUP_RADIUS) {
        continue;
      }

      gameState.addItem(sprite.lootId, sprite.lootAmount);
      this.onCollected?.(sprite.lootId, sprite.lootAmount);
      collected += 1;

      const label = this.scene.add
        .text(sprite.x, sprite.y - 8, `+${sprite.lootAmount} ${sprite.lootId}`, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '11px',
          color: '#fef9c3',
        })
        .setOrigin(0.5)
        .setDepth(45);
      this.scene.tweens.add({
        targets: label,
        y: label.y - 20,
        alpha: 0,
        duration: 500,
        onComplete: () => label.destroy(),
      });

      sprite.destroy();
    }

    if (collected > 0) {
      gameState.saveNow();
    }

    return collected;
  }
}
