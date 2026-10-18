import Phaser from 'phaser';
import {
  CAVE_ENTRANCE_GRID,
  isSafeGrid,
  nearSafeFringe,
  SAFE_ZONE,
  WORLD_COLS,
  WORLD_ROWS,
  type SafeZone,
} from '../world/Biomes';
import {
  pickTreeSize,
  TREE_DISPLAY_HEIGHT,
  treeTextureKey,
  type TreeFamily,
  type TreeSize,
} from './BiomeAssets';
import { GRID_SIZE } from './PlacementManager';

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function placeTree(
  scene: Phaser.Scene,
  family: TreeFamily,
  size: TreeSize,
  x: number,
  y: number,
): void {
  const key = treeTextureKey(family, size);
  if (!scene.textures.exists(key)) {
    return;
  }
  const img = scene.add.image(x, y, key);
  const targetH = TREE_DISPLAY_HEIGHT[size];
  // Fit by height; never crop — full canopy + trunk must show
  const scale = targetH / Math.max(1, img.height);
  img.setScale(scale);
  img.setOrigin(0.5, 1); // plant at feet
  img.setDepth(8 + y * 0.01);
}

/**
 * Single grass overworld: light/dark trees (sparse) + a few autumn accents.
 * Safe zone vs wilderness is gameplay-only (metals); no themed biome regions.
 */
export function decorateOverworld(
  scene: Phaser.Scene,
  options?: { safe?: SafeZone; seed?: number },
): void {
  const safe = options?.safe ?? SAFE_ZONE;
  const rng = mulberry32(options?.seed ?? 0x51a7e);

  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      const cx = gx * GRID_SIZE + GRID_SIZE / 2;
      const cy = gy * GRID_SIZE + GRID_SIZE / 2;
      paintGrassTile(scene, gx, gy, cx, cy);
    }
  }

  const g = scene.add.graphics().setDepth(2);
  g.lineStyle(2, 0x86efac, 0.55);
  g.strokeRect(
    safe.x0 * GRID_SIZE,
    safe.y0 * GRID_SIZE,
    (safe.x1 - safe.x0 + 1) * GRID_SIZE,
    (safe.y1 - safe.y0 + 1) * GRID_SIZE,
  );

  placeSparseTrees(scene, safe, rng);
}

function paintGrassTile(
  scene: Phaser.Scene,
  gx: number,
  gy: number,
  cx: number,
  cy: number,
): void {
  const alt = (gx + gy) % 2 === 0;
  const key = alt ? 'floor-grass' : 'floor-grass-b';

  if (!scene.textures.exists(key)) {
    scene.add.image(cx, cy, 'tile-grass').setDepth(0).setDisplaySize(GRID_SIZE, GRID_SIZE);
    return;
  }

  scene.add.image(cx, cy, key).setDepth(0).setDisplaySize(GRID_SIZE + 1, GRID_SIZE + 1);
}

/**
 * Low density: light + dark mainly, a few autumn sprinkled in.
 * Village fringe slightly denser than open wilderness; town center clear.
 */
function placeSparseTrees(scene: Phaser.Scene, safe: SafeZone, rng: () => number): void {
  const gateGx = CAVE_ENTRANCE_GRID.gx;
  const gateGy = CAVE_ENTRANCE_GRID.gy;
  let placed = 0;
  // Scale with world area (~4× vs old 48×36) — sparse but not empty void
  const maxTrees = Math.floor((WORLD_COLS * WORLD_ROWS) / 40); // ~172 on 96×72

  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      if (placed >= maxTrees) {
        return;
      }

      // Keep deep town interior open for builds / decor
      if (isSafeGrid(gx, gy, safe) && !nearSafeFringe(gx, gy, safe, 1)) {
        continue;
      }

      // Clear around wilderness cave mouth + a short approach lane toward town
      if (Math.abs(gx - gateGx) <= 2 && Math.abs(gy - gateGy) <= 2) {
        continue;
      }
      if (Math.abs(gx - gateGx) <= 1 && gy > gateGy && gy < safe.y0) {
        continue;
      }

      const onFringe = nearSafeFringe(gx, gy, safe, 1);
      // ~5% fringe, ~1.6% wilderness — light cover across the larger map
      const chance = onFringe ? 0.05 : 0.016;
      if (rng() > chance) {
        continue;
      }

      // Mostly light/dark; ~12% autumn accents
      let family: TreeFamily;
      const roll = rng();
      if (roll < 0.12) {
        family = 'autumn';
      } else if (roll < 0.56) {
        family = 'dark';
      } else {
        family = 'light';
      }

      const size = pickTreeSize(rng);
      const jitter = (rng() - 0.5) * 10;
      placeTree(
        scene,
        family,
        size,
        gx * GRID_SIZE + GRID_SIZE / 2 + jitter,
        gy * GRID_SIZE + GRID_SIZE / 2 + jitter * 0.35,
      );
      placed += 1;
    }
  }
}

/** Sparse cave trees on walkable tiles — do not overdo. */
export function decorateCaveTrees(
  scene: Phaser.Scene,
  walkable: boolean[][],
  tileSize: number,
  seed = 0xca11e7,
): void {
  const rng = mulberry32(seed);
  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;
  let placed = 0;
  const maxTrees = 14;

  for (let ty = 2; ty < rows - 2; ty += 1) {
    for (let tx = 2; tx < cols - 2; tx += 1) {
      if (placed >= maxTrees) {
        return;
      }
      if (!walkable[ty][tx]) {
        continue;
      }
      let open = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (walkable[ty + dy]?.[tx + dx]) {
          open += 1;
        }
      }
      if (open < 2) {
        continue;
      }
      if (rng() > 0.012) {
        continue;
      }
      const size = pickTreeSize(rng);
      const useSize: TreeSize = open <= 2 ? (rng() < 0.7 ? 's' : 'm') : size;
      placeTree(
        scene,
        'cave',
        useSize,
        tx * tileSize + tileSize / 2,
        ty * tileSize + tileSize / 2,
      );
      placed += 1;
    }
  }
}
