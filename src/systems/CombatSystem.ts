import Phaser from 'phaser';
import { gameState } from '../state/GameState';

export interface HostileConfig {
  hp: number;
  damage: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
}

const DEFAULT_HOSTILE: HostileConfig = {
  hp: 30,
  damage: 8,
  speed: 90,
  aggroRange: 180,
  attackRange: 36,
  attackCooldownMs: 700,
};

export type HostileSprite = Phaser.Physics.Arcade.Sprite & {
  hostileHp: number;
  hostileMaxHp: number;
  lastAttackAt: number;
  config: HostileConfig;
};

export class CombatSystem {
  private scene: Phaser.Scene;
  private player: Phaser.Physics.Arcade.Sprite;
  private hostiles: Phaser.Physics.Arcade.Group;
  private attackKey: Phaser.Input.Keyboard.Key;
  private lastPlayerAttackAt = 0;
  private readonly playerAttackCooldownMs = 350;
  private readonly playerAttackRange = 42;
  private onHostileKilled?: (hostile: HostileSprite, x: number, y: number) => void;
  private onPlayerHurt?: () => void;

  constructor(
    scene: Phaser.Scene,
    player: Phaser.Physics.Arcade.Sprite,
    hostiles: Phaser.Physics.Arcade.Group,
    options?: {
      onHostileKilled?: (hostile: HostileSprite, x: number, y: number) => void;
      onPlayerHurt?: () => void;
    },
  ) {
    this.scene = scene;
    this.player = player;
    this.hostiles = hostiles;
    this.onHostileKilled = options?.onHostileKilled;
    this.onPlayerHurt = options?.onPlayerHurt;

    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard plugin required for CombatSystem');
    }

    this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  spawnHostile(
    x: number,
    y: number,
    config: Partial<HostileConfig> = {},
  ): HostileSprite {
    const merged = { ...DEFAULT_HOSTILE, ...config };
    const sprite = this.hostiles.create(x, y, 'hostile') as HostileSprite;
    sprite.setCollideWorldBounds(true);
    sprite.setBounce(0.05);
    sprite.hostileHp = merged.hp;
    sprite.hostileMaxHp = merged.hp;
    sprite.lastAttackAt = 0;
    sprite.config = merged;
    sprite.setData('isHostile', true);
    return sprite;
  }

  update(time: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.attackKey)) {
      this.playerMelee(time);
    }

    this.hostiles.children.each((child) => {
      const hostile = child as HostileSprite;
      if (!hostile.active) {
        return true;
      }

      this.updateHostileAI(hostile, time);
      return true;
    });
  }

  private playerMelee(time: number): void {
    if (time - this.lastPlayerAttackAt < this.playerAttackCooldownMs) {
      return;
    }

    this.lastPlayerAttackAt = time;

    const facingX = this.player.body?.velocity.x ?? 0;
    const facingY = this.player.body?.velocity.y ?? 0;
    let dirX = Math.sign(facingX);
    let dirY = Math.sign(facingY);
    if (dirX === 0 && dirY === 0) {
      dirY = 1;
    }

    const reachX = this.player.x + dirX * 18;
    const reachY = this.player.y + dirY * 18;
    const spark = this.scene.add.image(reachX, reachY, 'hit-spark').setDepth(30);
    this.scene.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 1.8,
      duration: 160,
      onComplete: () => spark.destroy(),
    });

    this.hostiles.children.each((child) => {
      const hostile = child as HostileSprite;
      if (!hostile.active) {
        return true;
      }

      const dist = Phaser.Math.Distance.Between(reachX, reachY, hostile.x, hostile.y);
      if (dist <= this.playerAttackRange) {
        this.hurtHostile(hostile, gameState.player.attack, dirX, dirY);
      }
      return true;
    });
  }

  private hurtHostile(
    hostile: HostileSprite,
    damage: number,
    knockX: number,
    knockY: number,
  ): void {
    hostile.hostileHp -= damage;
    hostile.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => {
      if (hostile.active) {
        hostile.clearTint();
      }
    });

    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setVelocity(knockX * 220, knockY * 220);

    if (hostile.hostileHp <= 0) {
      const { x, y } = hostile;
      this.onHostileKilled?.(hostile, x, y);
      hostile.destroy();
    }
  }

  private updateHostileAI(hostile: HostileSprite, time: number): void {
    const dist = Phaser.Math.Distance.Between(
      hostile.x,
      hostile.y,
      this.player.x,
      this.player.y,
    );
    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }

    if (dist > hostile.config.aggroRange) {
      body.setVelocity(0, 0);
      return;
    }

    this.scene.physics.moveToObject(hostile, this.player, hostile.config.speed);

    if (dist <= hostile.config.attackRange && time - hostile.lastAttackAt >= hostile.config.attackCooldownMs) {
      hostile.lastAttackAt = time;
      gameState.damage(hostile.config.damage);
      this.onPlayerHurt?.();

      const angle = Phaser.Math.Angle.Between(hostile.x, hostile.y, this.player.x, this.player.y);
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body | undefined;
      playerBody?.setVelocity(Math.cos(angle) * 260, Math.sin(angle) * 260);
      this.player.setTintFill(0xff8888);
      this.scene.time.delayedCall(80, () => {
        if (this.player.active) {
          this.player.clearTint();
        }
      });
    }
  }
}
