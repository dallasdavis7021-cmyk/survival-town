import Phaser from 'phaser';
import { PLAYER_ATLAS } from './playerAtlasMeta';

export type FacingDir = 'down' | 'up' | 'left' | 'right';

const TEXTURE_KEY = 'player-sheet';
const DISPLAY_HEIGHT = 40;

export function preloadPlayerSprite(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEXTURE_KEY)) {
    scene.load.spritesheet(TEXTURE_KEY, '/assets/player/player-atlas.png', {
      frameWidth: PLAYER_ATLAS.frameWidth,
      frameHeight: PLAYER_ATLAS.frameHeight,
    });
  }
}

export function ensurePlayerSpriteLoaded(scene: Phaser.Scene): Promise<void> {
  if (scene.textures.exists(TEXTURE_KEY)) {
    registerPlayerAnims(scene);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    preloadPlayerSprite(scene);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      registerPlayerAnims(scene);
      resolve();
    });
    scene.load.start();
  });
}

export function registerPlayerAnims(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEXTURE_KEY) || scene.anims.exists('player-walk-down')) {
    return;
  }
  const mk = (key: string, frames: readonly number[], frameRate: number, repeat: number) => {
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(TEXTURE_KEY, { frames: [...frames] }),
      frameRate,
      repeat,
    });
  };
  const a = PLAYER_ATLAS.anims;
  mk('player-idle-down', a['idle-down'], 1, -1);
  mk('player-walk-down', a['walk-down'], 8, -1);
  mk('player-idle-up', a['idle-up'], 1, -1);
  mk('player-walk-up', a['walk-up'], 8, -1);
  mk('player-idle-left', a['idle-left'], 1, -1);
  mk('player-walk-left', a['walk-left'], 8, -1);
  mk('player-idle-right', a['idle-right'], 1, -1);
  mk('player-walk-right', a['walk-right'], 8, -1);
  mk('player-attack', a.attack, 10, 0);
  mk('player-hurt', a.hurt, 1, 0);
}

/**
 * Animated player with a tight collision body
 * (not full art width — backpack / pickaxe overhang ignored).
 */
export function createPlayerSprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
): Phaser.Physics.Arcade.Sprite {
  registerPlayerAnims(scene);
  const key = scene.textures.exists(TEXTURE_KEY) ? TEXTURE_KEY : 'player';
  const sprite = scene.physics.add.sprite(x, y, key, 0);
  sprite.setDepth(10);
  sprite.setCollideWorldBounds(true);
  sprite.setOrigin(0.5, 0.85);

  if (key === TEXTURE_KEY) {
    const scale = DISPLAY_HEIGHT / PLAYER_ATLAS.frameHeight;
    sprite.setScale(scale);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(14, 14);
    body.setOffset((PLAYER_ATLAS.frameWidth - 14) / 2, PLAYER_ATLAS.frameHeight - 18);
  } else {
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(18, 18);
    body.setOffset(2, 2);
  }

  if (scene.anims.exists('player-idle-down')) {
    sprite.play('player-idle-down');
  }
  return sprite;
}

export function facingFromVector(vx: number, vy: number): FacingDir {
  if (Math.abs(vx) > Math.abs(vy)) {
    return vx < 0 ? 'left' : 'right';
  }
  return vy < 0 ? 'up' : 'down';
}

export function facingFromFacingVec(facing: Phaser.Math.Vector2): FacingDir {
  return facingFromVector(facing.x, facing.y);
}

/** Drive walk/idle from velocity; no-op while attack/hurt anim plays. */
export function updatePlayerAnim(
  sprite: Phaser.Physics.Arcade.Sprite,
  facing: FacingDir,
  moving: boolean,
): void {
  const current = sprite.anims.currentAnim?.key ?? '';
  if (
    (current === 'player-attack' || current === 'player-hurt') &&
    sprite.anims.isPlaying
  ) {
    return;
  }

  // Clear attack flip when returning to loco
  if (current === 'player-attack' || current === 'player-hurt') {
    sprite.setFlipX(false);
  }

  const want = moving ? `player-walk-${facing}` : `player-idle-${facing}`;
  if (!sceneAnimsReady(sprite) || !sprite.anims.animationManager.exists(want)) {
    return;
  }
  if (current !== want) {
    sprite.play(want, true);
  }
}

function sceneAnimsReady(sprite: Phaser.GameObjects.Sprite): boolean {
  return !!sprite.anims?.animationManager;
}

/** Play pickaxe swing for weapon / mining. Flips for left facing. */
export function playPlayerAttack(
  sprite: Phaser.Physics.Arcade.Sprite,
  facing: FacingDir,
  onComplete?: () => void,
): void {
  if (!sprite.anims.animationManager.exists('player-attack')) {
    onComplete?.();
    return;
  }
  sprite.setFlipX(facing === 'left');
  sprite.play('player-attack', true);
  sprite.once(
    Phaser.Animations.Events.ANIMATION_COMPLETE,
    (anim: Phaser.Animations.Animation) => {
      if (anim.key !== 'player-attack') {
        return;
      }
      sprite.setFlipX(false);
      onComplete?.();
    },
  );
}

export function playPlayerHurt(sprite: Phaser.Physics.Arcade.Sprite): void {
  if (!sprite.anims.animationManager.exists('player-hurt')) {
    return;
  }
  sprite.setFlipX(false);
  sprite.play('player-hurt', true);
}
