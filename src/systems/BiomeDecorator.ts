import Phaser from 'phaser';
import {
  biomeAt,
  nearSafeFringe,
  SAFE_ZONE,
  WORLD_COLS,
  WORLD_ROWS,
  type OverworldBiome,
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
  const scale = targetH / img.height;
  img.setScale(scale);
  img.setOrigin(0.5, 0.85);
  img.setDepth(8 + y * 0.01);
}

/**
 * Paints floor tiles + trees + autumn leaf scatter for the overworld.
 * Deterministic seed so layout is stable across reloads.
 */
export function decorateOverworld(
  scene: Phaser.Scene,
  options?: { safe?: SafeZone; seed?: number },
): void {
  const safe = options?.safe ?? SAFE_ZONE;
  const rng = mulberry32(options?.seed ?? 0x51a7e);

  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      const biome = biomeAt(gx, gy, safe);
      const cx = gx * GRID_SIZE + GRID_SIZE / 2;
      const cy = gy * GRID_SIZE + GRID_SIZE / 2;
      paintFloorTile(scene, biome, gx, gy, cx, cy);
    }
  }

  // Safe-zone outline
  const g = scene.add.graphics().setDepth(2);
  g.lineStyle(2, 0x86efac, 0.55);
  g.strokeRect(
    safe.x0 * GRID_SIZE,
    safe.y0 * GRID_SIZE,
    (safe.x1 - safe.x0 + 1) * GRID_SIZE,
    (safe.y1 - safe.y0 + 1) * GRID_SIZE,
  );

  placeVillageTrees(scene, safe, rng);
  placeBiomeTrees(scene, safe, rng);
  placeAutumnLeaves(scene, safe, rng);
}

function paintFloorTile(
  scene: Phaser.Scene,
  biome: OverworldBiome,
  gx: number,
  gy: number,
  cx: number,
  cy: number,
): void {
  const alt = (gx + gy) % 2 === 0;
  let key = alt ? 'floor-grass' : 'floor-grass-b';
  if (biome === 'snow') {
    key = alt ? 'floor-snow' : 'floor-snow-b';
  }

  if (!scene.textures.exists(key)) {
    // Fallback solid colors if assets not ready
    const fallback =
      biome === 'snow' ? 'tile-wild-b' : biome === 'safe' ? 'tile-grass' : 'tile-wild-a';
    scene.add.image(cx, cy, fallback).setDepth(0).setDisplaySize(GRID_SIZE, GRID_SIZE);
    return;
  }

  scene.add.image(cx, cy, key).setDepth(0).setDisplaySize(GRID_SIZE + 1, GRID_SIZE + 1);
}

function placeVillageTrees(
  scene: Phaser.Scene,
  safe: SafeZone,
  rng: () => number,
): void {
  // Healthy ring around village, skip gate north-center cells
  const gateGx = Math.floor((safe.x0 + safe.x1) / 2);
  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      if (!nearSafeFringe(gx, gy, safe, 2)) {
        continue;
      }
      // Keep cave approach clear
      if (Math.abs(gx - gateGx) <= 2 && gy <= safe.y0 + 1) {
        continue;
      }
      if (rng() > 0.42) {
        continue;
      }
      const family: TreeFamily = rng() < 0.5 ? 'dark' : 'light';
      const size = pickTreeSize(rng);
      const jitter = (rng() - 0.5) * 10;
      const { x, y } = {
        x: gx * GRID_SIZE + GRID_SIZE / 2 + jitter,
        y: gy * GRID_SIZE + GRID_SIZE / 2 + jitter * 0.4,
      };
      placeTree(scene, family, size, x, y);
    }
  }
}

function placeBiomeTrees(
  scene: Phaser.Scene,
  safe: SafeZone,
  rng: () => number,
): void {
  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      const biome = biomeAt(gx, gy, safe);
      if (biome === 'safe' || biome === 'snow') {
        continue; // snow: no jungle/autumn trees; village handled separately
      }
      // Don't double-plant fringe heavily
      if (nearSafeFringe(gx, gy, safe, 1) && rng() < 0.55) {
        continue;
      }
      const chance = biome === 'jungle' ? 0.22 : 0.2;
      if (rng() > chance) {
        continue;
      }
      const family: TreeFamily = biome === 'jungle' ? 'jungle' : 'autumn';
      const size = pickTreeSize(rng);
      const jitter = (rng() - 0.5) * 12;
      placeTree(
        scene,
        family,
        size,
        gx * GRID_SIZE + GRID_SIZE / 2 + jitter,
        gy * GRID_SIZE + GRID_SIZE / 2 + jitter * 0.35,
      );
    }
  }
}

function placeAutumnLeaves(
  scene: Phaser.Scene,
  safe: SafeZone,
  rng: () => number,
): void {
  const keys = ['decor-leaves-xs', 'decor-leaves-sm', 'decor-leaves'] as const;
  for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
    for (let gx = 0; gx < WORLD_COLS; gx += 1) {
      if (biomeAt(gx, gy, safe) !== 'autumn') {
        continue;
      }
      if (rng() > 0.18) {
        continue;
      }
      const key = keys[Math.floor(rng() * keys.length)];
      if (!scene.textures.exists(key)) {
        continue;
      }
      const img = scene.add.image(
        gx * GRID_SIZE + GRID_SIZE / 2 + (rng() - 0.5) * 16,
        gy * GRID_SIZE + GRID_SIZE / 2 + (rng() - 0.5) * 16,
        key,
      );
      const scale = key === 'decor-leaves' ? 0.12 : key === 'decor-leaves-sm' ? 0.35 : 0.55;
      img.setScale(scale);
      img.setAlpha(0.85);
      img.setDepth(1);
      img.setRotation(rng() * Math.PI * 2);
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
  const maxTrees = 14; // sparse

  for (let ty = 2; ty < rows - 2; ty += 1) {
    for (let tx = 2; tx < cols - 2; tx += 1) {
      if (placed >= maxTrees) {
        return;
      }
      if (!walkable[ty][tx]) {
        continue;
      }
      // Prefer slightly open spots (neighbors walkable)
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
      // Bias toward small/medium in corridors
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
