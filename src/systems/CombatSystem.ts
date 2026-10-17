import Phaser from 'phaser';
import { gameState } from '../state/GameState';

export interface HostileConfig {
  hp: number;
  damage: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  knockback: number;
  /** Visual / loot tier hint: 1 shallow, 2 mid, 3 deep. */
  tier: 1 | 2 | 3;
  tint?: number;
  scale?: number;
}

const DEFAULT_HOSTILE: HostileConfig = {
  hp: 30,
  damage: 8,
  speed: 90,
  aggroRange: 170,
  attackRange: 34,
  attackCooldownMs: 780,
  knockback: 320,
  tier: 1,
};

export type HostileSprite = Phaser.Physics.Arcade.Sprite & {
  hostileHp: number;
  hostileMaxHp: number;
  lastAttackAt: number;
  stunUntil: number;
  aggroed: boolean;
  config: HostileConfig;
};

type AttackPhase = 'idle' | 'windup' | 'active' | 'recovery';

const WINDUP_MS = 140;
const ACTIVE_MS = 110;
const RECOVERY_MS = 240;
const PLAYER_KNOCKBACK = 340;
const HOSTILE_HIT_STUN_MS = 280;
const PLAYER_HIT_STUN_MS = 160;

/**
 * Decoupled melee combat — intended for cave/wilderness scenes only.
 * Directional swings use wind-up → active hit window → recovery.
 */
export class CombatSystem {
  private scene: Phaser.Scene;
  private player: Phaser.Physics.Arcade.Sprite;
  private hostiles: Phaser.Physics.Arcade.Group;
  private phase: AttackPhase = 'idle';
  private phaseEndsAt = 0;
  private swingDir = new Phaser.Math.Vector2(0, 1);
  private facing = new Phaser.Math.Vector2(0, 1);
  private hitThisSwing = new Set<HostileSprite>();
  private playerStunUntil = 0;
  private swingTelegraph?: Phaser.GameObjects.Image;
  private onHostileKilled?: (hostile: HostileSprite, x: number, y: number) => void;
  private onPlayerHurt?: () => void;
  private readonly attackReach = 46;
  private readonly attackHalfWidth = 38;

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
  }

  get facingVector(): Phaser.Math.Vector2 {
    return this.facing.clone();
  }

  /** Start a directional melee swing (call from RMB in Weapon tool mode). */
  tryStartAttack(time = this.scene.time.now): boolean {
    if (this.phase !== 'idle' || time < this.playerStunUntil) {
      return false;
    }
    this.beginSwing(time);
    return true;
  }

  get attackPhase(): AttackPhase {
    return this.phase;
  }

  get isPlayerStunned(): boolean {
    return this.scene.time.now < this.playerStunUntil;
  }

  /** True while wind-up/active/recovery — callers can reduce move speed. */
  get isAttackLocked(): boolean {
    return this.phase !== 'idle';
  }

  spawnHostile(x: number, y: number, config: Partial<HostileConfig> = {}): HostileSprite {
    const merged: HostileConfig = { ...DEFAULT_HOSTILE, ...config };
    const texture = merged.tier >= 3 ? 'hostile-elite' : merged.tier === 2 ? 'hostile-mid' : 'hostile';
    const sprite = this.hostiles.create(x, y, texture) as HostileSprite;
    sprite.setCollideWorldBounds(true);
    sprite.setBounce(0.02);
    sprite.setScale(merged.scale ?? (merged.tier === 3 ? 1.2 : merged.tier === 2 ? 1.05 : 1));
    if (merged.tint !== undefined) {
      sprite.setTint(merged.tint);
    }
    sprite.hostileHp = merged.hp;
    sprite.hostileMaxHp = merged.hp;
    sprite.lastAttackAt = 0;
    sprite.stunUntil = 0;
    sprite.aggroed = false;
    sprite.config = merged;
    sprite.setData('isHostile', true);
    sprite.setData('tier', merged.tier);
    return sprite;
  }

  update(time: number, delta: number): void {
    this.updateFacing();
    this.updateAttackPhase(time);

    if (this.phase === 'active') {
      this.resolveActiveHits();
    }

    this.hostiles.children.each((child) => {
      const hostile = child as HostileSprite;
      if (!hostile.active) {
        return true;
      }
      this.updateHostileAI(hostile, time, delta);
      return true;
    });
  }

  private updateFacing(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body | undefined;
    const vx = body?.velocity.x ?? 0;
    const vy = body?.velocity.y ?? 0;
    if (Math.abs(vx) > 8 || Math.abs(vy) > 8) {
      this.facing.set(vx, vy).normalize();
    }
  }

  private beginSwing(time: number): void {
    this.phase = 'windup';
    this.phaseEndsAt = time + WINDUP_MS;
    this.swingDir.copy(this.facing);
    this.hitThisSwing.clear();

    const reachX = this.player.x + this.swingDir.x * 22;
    const reachY = this.player.y + this.swingDir.y * 22;
    this.swingTelegraph?.destroy();
    this.swingTelegraph = this.scene.add
      .image(reachX, reachY, 'melee-arc')
      .setDepth(28)
      .setAlpha(0.55)
      .setRotation(Math.atan2(this.swingDir.y, this.swingDir.x));

    this.player.setTint(0xa7f3d0);
  }

  private updateAttackPhase(time: number): void {
    if (this.phase === 'idle') {
      return;
    }

    if (time < this.phaseEndsAt) {
      if (this.phase === 'windup' && this.swingTelegraph) {
        const t = 1 - (this.phaseEndsAt - time) / WINDUP_MS;
        this.swingTelegraph.setAlpha(0.35 + t * 0.45);
        this.swingTelegraph.setPosition(
          this.player.x + this.swingDir.x * (16 + t * 10),
          this.player.y + this.swingDir.y * (16 + t * 10),
        );
      }
      return;
    }

    if (this.phase === 'windup') {
      this.phase = 'active';
      this.phaseEndsAt = time + ACTIVE_MS;
      this.player.setTintFill(0xffffff);
      this.spawnSwingSpark();
      return;
    }

    if (this.phase === 'active') {
      this.phase = 'recovery';
      this.phaseEndsAt = time + RECOVERY_MS;
      this.player.clearTint();
      this.swingTelegraph?.destroy();
      this.swingTelegraph = undefined;
      return;
    }

    // recovery → idle
    this.phase = 'idle';
    this.player.clearTint();
  }

  private spawnSwingSpark(): void {
    const reachX = this.player.x + this.swingDir.x * 26;
    const reachY = this.player.y + this.swingDir.y * 26;
    const spark = this.scene.add.image(reachX, reachY, 'hit-spark').setDepth(30).setScale(1.2);
    this.scene.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 2.2,
      duration: 140,
      onComplete: () => spark.destroy(),
    });
  }

  private resolveActiveHits(): void {
    const originX = this.player.x + this.swingDir.x * 12;
    const originY = this.player.y + this.swingDir.y * 12;

    this.hostiles.children.each((child) => {
      const hostile = child as HostileSprite;
      if (!hostile.active || this.hitThisSwing.has(hostile)) {
        return true;
      }

      const toEnemyX = hostile.x - originX;
      const toEnemyY = hostile.y - originY;
      const dist = Math.hypot(toEnemyX, toEnemyY);
      if (dist > this.attackReach || dist < 1) {
        return true;
      }

      const nx = toEnemyX / dist;
      const ny = toEnemyY / dist;
      const dot = nx * this.swingDir.x + ny * this.swingDir.y;
      // ~90° forward cone
      if (dot < 0.15) {
        return true;
      }

      const lateral = Math.abs(nx * -this.swingDir.y + ny * this.swingDir.x) * dist;
      if (lateral > this.attackHalfWidth) {
        return true;
      }

      this.hitThisSwing.add(hostile);
      this.hurtHostile(hostile, gameState.player.attack, this.swingDir.x, this.swingDir.y);
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
    hostile.stunUntil = this.scene.time.now + HOSTILE_HIT_STUN_MS;
    hostile.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (hostile.active) {
        hostile.clearTint();
        if (hostile.aggroed) {
          hostile.setTint(0xfca5a5);
        }
      }
    });

    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    const force = 380 + hostile.config.tier * 40;
    body?.setVelocity(knockX * force, knockY * force);

    const flash = this.scene.add.image(hostile.x, hostile.y, 'hit-spark').setDepth(31).setScale(0.8);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      y: hostile.y - 16,
      duration: 180,
      onComplete: () => flash.destroy(),
    });

    if (hostile.hostileHp <= 0) {
      const { x, y } = hostile;
      this.onHostileKilled?.(hostile, x, y);
      hostile.destroy();
    }
  }

  private updateHostileAI(hostile: HostileSprite, time: number, _delta: number): void {
    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }

    if (time < hostile.stunUntil) {
      // Keep knockback; don't steer during stun.
      return;
    }

    const dist = Phaser.Math.Distance.Between(
      hostile.x,
      hostile.y,
      this.player.x,
      this.player.y,
    );

    const inAggro = dist <= hostile.config.aggroRange;
    if (inAggro && !hostile.aggroed) {
      hostile.aggroed = true;
      hostile.setTint(0xfca5a5);
      // Brief aggro pop so chase reads clearly
      this.scene.tweens.add({
        targets: hostile,
        scale: hostile.scale * 1.15,
        duration: 90,
        yoyo: true,
      });
    } else if (!inAggro && hostile.aggroed && dist > hostile.config.aggroRange * 1.25) {
      hostile.aggroed = false;
      hostile.clearTint();
      if (hostile.config.tint !== undefined) {
        hostile.setTint(hostile.config.tint);
      }
    }

    if (!hostile.aggroed) {
      body.setVelocity(0, 0);
      return;
    }

    this.scene.physics.moveToObject(hostile, this.player, hostile.config.speed);

    if (
      dist <= hostile.config.attackRange &&
      time - hostile.lastAttackAt >= hostile.config.attackCooldownMs &&
      time >= this.playerStunUntil
    ) {
      hostile.lastAttackAt = time;
      gameState.damage(hostile.config.damage);
      this.onPlayerHurt?.();

      const angle = Phaser.Math.Angle.Between(hostile.x, hostile.y, this.player.x, this.player.y);
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body | undefined;
      const kb = hostile.config.knockback || PLAYER_KNOCKBACK;
      playerBody?.setVelocity(Math.cos(angle) * kb, Math.sin(angle) * kb);
      this.playerStunUntil = time + PLAYER_HIT_STUN_MS;
      this.player.setTintFill(0xff8888);
      this.scene.time.delayedCall(100, () => {
        if (this.player.active && this.phase === 'idle') {
          this.player.clearTint();
        }
      });
    }
  }
}
