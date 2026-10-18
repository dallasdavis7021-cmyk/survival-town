import Phaser from 'phaser';
import type { InventoryItemId } from '../state/GameState';

/** Cave gems — rooms only. */
export type CaveGemId = 'diamond' | 'emerald' | 'sapphire';

/** Wilderness metals — outside town safe zone. */
export type WildernessMetalId = 'gold' | 'iron' | 'silver';

export type MineralId = CaveGemId | WildernessMetalId;

export const CAVE_GEMS: CaveGemId[] = ['diamond', 'emerald', 'sapphire'];
export const WILDERNESS_METALS: WildernessMetalId[] = ['gold', 'iron', 'silver'];

export const MINERAL_TEXTURE: Record<MineralId, string> = {
  diamond: 'mineral-diamond',
  emerald: 'mineral-emerald',
  sapphire: 'mineral-sapphire',
  gold: 'mineral-gold',
  iron: 'mineral-iron',
  silver: 'mineral-silver',
};

export const MINERAL_ASSET_PATH: Record<MineralId, string> = {
  diamond: '/minerals/diamond.png',
  emerald: '/minerals/emerald.png',
  sapphire: '/minerals/sapphire.png',
  gold: '/minerals/gold.jpg',
  iron: '/minerals/iron.png',
  silver: '/minerals/silver.png',
};

/** Display scale for top-down nodes (source art is large). */
export const MINERAL_DISPLAY_SIZE = 28;

export const CAVE_GEM_SPAWN_CHANCE = 0.28; // per gem type on cave enter (low)
export const CAVE_GEM_RESPAWN_ON_LEAVE_CHANCE = 0.32;
export const WILDERNESS_TARGET_COUNT = 10; // higher frequency than cave gems
export const WILDERNESS_OFFSCREEN_MARGIN = 80;

export function isCaveGem(id: string): id is CaveGemId {
  return (CAVE_GEMS as string[]).includes(id);
}

export function isWildernessMetal(id: string): id is WildernessMetalId {
  return (WILDERNESS_METALS as string[]).includes(id);
}

export function mineralToInventory(id: MineralId): InventoryItemId {
  return id;
}

/** Preload mineral sprites (call from scene preload or create before use). */
export function preloadMinerals(scene: Phaser.Scene): void {
  for (const id of [...CAVE_GEMS, ...WILDERNESS_METALS]) {
    const key = MINERAL_TEXTURE[id];
    if (!scene.textures.exists(key)) {
      scene.load.image(key, MINERAL_ASSET_PATH[id]);
    }
  }
}

export function ensureMineralTexturesLoaded(scene: Phaser.Scene): Promise<void> {
  const missing = [...CAVE_GEMS, ...WILDERNESS_METALS].filter(
    (id) => !scene.textures.exists(MINERAL_TEXTURE[id]),
  );
  if (missing.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    for (const id of missing) {
      scene.load.image(MINERAL_TEXTURE[id], MINERAL_ASSET_PATH[id]);
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}

export function styleMineralSprite(sprite: Phaser.GameObjects.Image): void {
  sprite.setDisplaySize(MINERAL_DISPLAY_SIZE, MINERAL_DISPLAY_SIZE);
  sprite.setDepth(6);
}
