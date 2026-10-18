import Phaser from 'phaser';

export const PORTAL_TEXTURE = {
  entrance: 'portal-cave-entrance',
  exit: 'portal-cave-exit',
} as const;

const PORTAL_PATH = {
  entrance: '/assets/portals/cave-entrance-lg.png',
  exit: '/assets/portals/cave-exit-lg.png',
} as const;

/** Display height for top-down portals. */
export const PORTAL_DISPLAY_HEIGHT = 72;

export function preloadPortalAssets(scene: Phaser.Scene): void {
  for (const key of ['entrance', 'exit'] as const) {
    const tex = PORTAL_TEXTURE[key];
    if (!scene.textures.exists(tex)) {
      scene.load.image(tex, PORTAL_PATH[key]);
    }
  }
}

export function ensurePortalAssetsLoaded(scene: Phaser.Scene): Promise<void> {
  const missing = (['entrance', 'exit'] as const).filter(
    (k) => !scene.textures.exists(PORTAL_TEXTURE[k]),
  );
  if (missing.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    preloadPortalAssets(scene);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}

export function stylePortalSprite(sprite: Phaser.GameObjects.Image): void {
  const tex = sprite.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const srcH = Math.max(1, tex.height || 1);
  sprite.setScale(PORTAL_DISPLAY_HEIGHT / srcH);
  sprite.setOrigin(0.5, 0.85);
  sprite.setDepth(6);
}

/**
 * Visual portal + small walk-in overlap zone (no full-sprite blocker).
 * Returns the trigger zone used for scene transitions.
 */
export function placePortal(
  scene: Phaser.Scene,
  x: number,
  y: number,
  kind: 'entrance' | 'exit',
  onEnter: () => void,
  player: Phaser.Physics.Arcade.Sprite,
): { sprite: Phaser.GameObjects.Image; zone: Phaser.GameObjects.Zone } {
  const key = PORTAL_TEXTURE[kind];
  const textureKey = scene.textures.exists(key) ? key : kind === 'entrance' ? 'town-gate' : 'cave-exit';
  const sprite = scene.add.image(x, y, textureKey);
  stylePortalSprite(sprite);

  // Overlap mouth in front of / at the opening — small so player isn't blocked
  const zoneW = Math.max(28, sprite.displayWidth * 0.35);
  const zoneH = Math.max(22, sprite.displayHeight * 0.22);
  const zoneY = y + sprite.displayHeight * 0.08;
  const zone = scene.add.zone(x, zoneY, zoneW, zoneH);
  scene.physics.add.existing(zone, true);
  scene.physics.add.overlap(player, zone, () => onEnter());

  return { sprite, zone };
}
