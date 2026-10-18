import Phaser from 'phaser';

export type TreeFamily = 'dark' | 'light' | 'jungle' | 'autumn' | 'cave';
export type TreeSize = 'l' | 'm' | 's';

export const TREE_FAMILIES: TreeFamily[] = ['dark', 'light', 'jungle', 'autumn', 'cave'];
export const TREE_SIZES: TreeSize[] = ['l', 'm', 's'];

export function treeTextureKey(family: TreeFamily, size: TreeSize): string {
  return `tree-${family}-${size}`;
}

export function preloadBiomeAssets(scene: Phaser.Scene): void {
  for (const fam of TREE_FAMILIES) {
    for (const size of TREE_SIZES) {
      const key = treeTextureKey(fam, size);
      if (!scene.textures.exists(key)) {
        scene.load.image(key, `/assets/trees/${fam}-${size}.png`);
      }
    }
  }

  const floors: [string, string][] = [
    ['floor-grass', '/assets/floors/grass.png'],
    ['floor-grass-b', '/assets/floors/grass-b.png'],
    ['floor-snow', '/assets/floors/snow.png'],
    ['floor-snow-b', '/assets/floors/snow-b.png'],
    ['floor-cave-tex', '/assets/floors/cave.png'],
    ['floor-cave-tex-b', '/assets/floors/cave-b.png'],
  ];
  for (const [key, path] of floors) {
    if (!scene.textures.exists(key)) {
      scene.load.image(key, path);
    }
  }

  const decor: [string, string][] = [
    ['decor-leaves', '/assets/decor/autumn-leaves.png'],
    ['decor-leaves-sm', '/assets/decor/autumn-leaves-sm.png'],
    ['decor-leaves-xs', '/assets/decor/autumn-leaves-xs.png'],
  ];
  for (const [key, path] of decor) {
    if (!scene.textures.exists(key)) {
      scene.load.image(key, path);
    }
  }
}

export function ensureBiomeAssetsLoaded(scene: Phaser.Scene): Promise<void> {
  const needed = [
    ...TREE_FAMILIES.flatMap((f) => TREE_SIZES.map((s) => treeTextureKey(f, s))),
    'floor-grass',
    'floor-grass-b',
    'floor-snow',
    'floor-snow-b',
    'floor-cave-tex',
    'floor-cave-tex-b',
    'decor-leaves',
    'decor-leaves-sm',
    'decor-leaves-xs',
  ];
  const missing = needed.filter((k) => !scene.textures.exists(k));
  if (missing.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    preloadBiomeAssets(scene);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}

export function pickTreeSize(rng: () => number = Math.random): TreeSize {
  const r = rng();
  if (r < 0.25) return 'l';
  if (r < 0.6) return 'm';
  return 's';
}

/** Display heights for top-down (source art is large). */
export const TREE_DISPLAY_HEIGHT: Record<TreeSize, number> = {
  l: 64,
  m: 52,
  s: 38,
};
