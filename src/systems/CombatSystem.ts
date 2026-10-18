import Phaser from 'phaser';
import type { CaveRoom } from '../maps/caveLayout';
import { gameState } from '../state/GameState';
import {
  constrainToRoom,
  facingFromVelocity,
  findRoomAt,
  isInsideRoom,
  pickRoomPatrolTarget,
  styleCaveCreature,
  updateCreatureAnim,
  CREATURE_TEXTURE,
} from './CaveCreature';
import type { FacingDir } from './PlayerSprite';

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
  homeRoom: CaveRoom | null;
  patrolTarget: { x: number; y: number } | null;
  facingDir: FacingDir;
  attackingUntil: number;
};

type AttackPhase = 'idle' | 'windup' | 'active' | 'recovery';

const WINDUP_MS = 140;
const ACTIVE_MS = 110;
const RECOVERY_MS = 240;
const PLAYER_KNOCKBACK = 340;
const HOSTILE_HIT_STUN_MS = 280;
const PLAYER_HIT_STUN_MS = 160;
const PATROL_SPEED = 42;

/**
 * Decoupled melee combat — intended for cave/wilderness scenes only.
 * Directional swings use wind-up → active hit window → recovery.
 * Hostiles use cave-creature atlas when loaded.
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
  private rooms: CaveRoom[] = [];

  constructor(
    scene: Phaser.Scene,
    player: Phaser.Physics.Arcade.Sprite,
    hostiles: Phaser.Physics.Arcade.Group,
    options?: {
      onHostileKilled?: (hostile: HostileSprite, x: number, y: number) => void;
      onPlayerHurt?: () => void;
      /** Kept for call-site compat; room tiles alone gate movement now. */
      walkable?: boolean[][];
      rooms?: CaveRoom[];
    },
  ) {
    this.scene = scene;
    this.player = player;
    this.hostiles = hostiles;
    this.onHostileKilled = options?.onHostileKilled;
    this.onPlayerHurt = options?.onPlayerHurt;
    this.rooms = options?.rooms ?? [];
  }

  setCaveNav(_walkable: boolean[][], rooms: CaveRoom[]): void {
    this.rooms = rooms;
  }

  get facingVector(): Phaser.Math.Vector2 {
    return this.facing.clone();
  }

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

  get isAttackLocked(): boolean {
    return this.phase !== 'idle';
  }

  spawnHostile(x: number, y: number, config: Partial<HostileConfig> = {}): HostileSprite {
    const merged: HostileConfig = { ...DEFAULT_HOSTILE, ...config };
    const useCreature = this.scene.textures.exists(CREATURE_TEXTURE);
    const fallback =
      merged.tier >= 3 ? 'hostile-elite' : merged.tier === 2 ? 'hostile-mid' : 'hostile';
    const sprite = this.hostiles.create(x, y, useCreature ? CREATURE_TEXTURE : fallback) as HostileSprite;
    sprite.setCollideWorldBounds(true);
    sprite.setBounce(0.02);

    if (useCreature) {
      styleCaveCreature(sprite, merged.tier);
    } else {
      sprite.setScale(merged.scale ?? (merged.tier === 3 ? 1.2 : merged.tier === 2 ? 1.05 : 1));
      if (merged.tint !== undefined) {
        sprite.setTint(merged.tint);
      }
    }

    sprite.hostileHp = merged.hp;
    sprite.hostileMaxHp = merged.hp;
    sprite.lastAttackAt = 0;
    sprite.stunUntil = 0;
    sprite.aggroed = false;
    sprite.config = merged;
    sprite.homeRoom = findRoomAt(this.rooms, x, y);
    sprite.patrolTarget = sprite.homeRoom ? pickRoomPatrolTarget(sprite.homeRoom) : null;
    sprite.facingDir = 'down';
    sprite.attackingUntil = 0;
    sprite.setData('isHostile', true);
    sprite.setData('tier', merged.tier);
    sprite.setDepth(55);
    sprite.setAlpha(1);
    sprite.setVisible(true);
    return sprite;
  }

  /** Keep hostiles on their home-room tiles only (never corridors). */
  private clampHostileToRoom(hostile: HostileSprite): void {
    if (hostile.homeRoom) {
      constrainToRoom(hostile, hostile.homeRoom);
    }
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
      .setRotation(this.swingDir.angle());
  }

  private updateAttackPhase(time: number): void {
    if (this.phase === 'idle') {
      return;
    }
    if (time < this.phaseEndsAt) {
      return;
    }

    if (this.phase === 'windup') {
      this.phase = 'active';
      this.phaseEndsAt = time + ACTIVE_MS;
      this.player.setTint(0xa7f3d0);
      this.swingTelegraph?.destroy();
      this.swingTelegraph = undefined;
      return;
    }

    if (this.phase === 'active') {
      this.phase = 'recovery';
      this.phaseEndsAt = time + RECOVERY_MS;
      this.player.clearTint();
      return;
    }

    this.phase = 'idle';
    this.player.clearTint();
  }

  private resolveActiveHits(): void {
    const originX = this.player.x + this.swingDir.x * 12;
    const originY = this.player.y + this.swingDir.y * 12;

    this.hostiles.children.each((child) => {
      const hostile = child as HostileSprite;
      if (!hostile.active || this.hitThisSwing.has(hostile) || hostile.hostileHp <= 0) {
        return true;
      }

      const dist = Phaser.Math.Distance.Between(originX, originY, hostile.x, hostile.y);
      if (dist > this.attackReach) {
        return true;
      }

      const dx = hostile.x - originX;
      const dy = hostile.y - originY;
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const forward = nx * this.swingDir.x + ny * this.swingDir.y;
      if (forward < 0.15) {
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
      // Brief downed pose before remove
      updateCreatureAnim(hostile, hostile.facingDir, false, 'downed');
      body?.setVelocity(0, 0);
      this.scene.time.delayedCall(280, () => {
        if (!hostile.active) {
          return;
        }
        this.onHostileKilled?.(hostile, x, y);
        hostile.destroy();
      });
    }
  }

  private updateHostileAI(hostile: HostileSprite, time: number, _delta: number): void {
    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }

    if (hostile.hostileHp <= 0) {
      body.setVelocity(0, 0);
      updateCreatureAnim(hostile, hostile.facingDir, false, 'downed');
      return;
    }

    if (time < hostile.stunUntil) {
      this.clampHostileToRoom(hostile);
      return;
    }

    const dist = Phaser.Math.Distance.Between(
      hostile.x,
      hostile.y,
      this.player.x,
      this.player.y,
    );

    // Only aggro / chase while the player is inside this creature's room
    const playerInHome =
      !!hostile.homeRoom && isInsideRoom(hostile.homeRoom, this.player.x, this.player.y);
    const inAggro = playerInHome && dist <= hostile.config.aggroRange;
    if (inAggro && !hostile.aggroed) {
      hostile.aggroed = true;
      this.scene.tweens.add({
        targets: hostile,
        scale: hostile.scale * 1.12,
        duration: 90,
        yoyo: true,
      });
    } else if (hostile.aggroed && (!playerInHome || dist > hostile.config.aggroRange * 1.35)) {
      hostile.aggroed = false;
      hostile.patrolTarget = hostile.homeRoom ? pickRoomPatrolTarget(hostile.homeRoom) : null;
    }

    if (time < hostile.attackingUntil) {
      body.setVelocity(0, 0);
      updateCreatureAnim(hostile, hostile.facingDir, false, 'attack');
      this.clampHostileToRoom(hostile);
      return;
    }

    if (!hostile.aggroed) {
      this.patrolHostile(hostile);
    } else {
      this.scene.physics.moveToObject(hostile, this.player, hostile.config.speed);
      this.clampHostileToRoom(hostile);

      if (
        playerInHome &&
        dist <= hostile.config.attackRange &&
        time - hostile.lastAttackAt >= hostile.config.attackCooldownMs &&
        time >= this.playerStunUntil
      ) {
        hostile.lastAttackAt = time;
        hostile.attackingUntil = time + 320;
        hostile.facingDir = facingFromVelocity(
          this.player.x - hostile.x,
          this.player.y - hostile.y,
        );
        updateCreatureAnim(hostile, hostile.facingDir, false, 'attack');

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

    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const moving = Math.abs(vx) > 6 || Math.abs(vy) > 6;
    if (moving) {
      hostile.facingDir = facingFromVelocity(vx, vy);
    }
    updateCreatureAnim(hostile, hostile.facingDir, moving, 'loco');

    this.clampHostileToRoom(hostile);
  }

  private patrolHostile(hostile: HostileSprite): void {
    const body = hostile.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }
    const room = hostile.homeRoom;
    if (!room) {
      body.setVelocity(0, 0);
      return;
    }

    if (
      !hostile.patrolTarget ||
      Phaser.Math.Distance.Between(
        hostile.x,
        hostile.y,
        hostile.patrolTarget.x,
        hostile.patrolTarget.y,
      ) < 10
    ) {
      hostile.patrolTarget = pickRoomPatrolTarget(room);
    }

    if (!hostile.patrolTarget) {
      body.setVelocity(0, 0);
      return;
    }

    const dx = hostile.patrolTarget.x - hostile.x;
    const dy = hostile.patrolTarget.y - hostile.y;
    const len = Math.hypot(dx, dy) || 1;
    body.setVelocity((dx / len) * PATROL_SPEED, (dy / len) * PATROL_SPEED);
  }
}
