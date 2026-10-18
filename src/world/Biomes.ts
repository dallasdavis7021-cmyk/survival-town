import { GRID_SIZE } from '../systems/PlacementManager';

export interface SafeZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Overworld tile grid (playable TownScene bounds).
 * Was 48×36 (1536×1152px); expanded so village + wilderness feel large.
 * Tile size = GRID_SIZE (32px) → 3072×2304px.
 */
export const WORLD_COLS = 96;
export const WORLD_ROWS = 72;

/**
 * Offset applied when migrating v1/v2 saves (old 48×36 origin) into the padded world.
 * Old content sat in the NW; we grew wilderness on all sides.
 */
export const WORLD_PAD_FROM_V2 = { x: 24, y: 18 } as const;

/** Village buildable area — centered-ish with thick wilderness ring. */
export const SAFE_ZONE: SafeZone = {
  x0: 34, // was 10 + pad
  y0: 26, // was 8 + pad
  x1: 61, // was 37 + pad
  y1: 45, // was 27 + pad
};

/**
 * Overworld cave entrance — deep northern wilderness,
 * well clear of the safe-zone border so exploring can lead you to it.
 */
export const CAVE_ENTRANCE_GRID = {
  gx: 48,
  gy: 8,
} as const;

export function isSafeGrid(gx: number, gy: number, safe: SafeZone = SAFE_ZONE): boolean {
  return gx >= safe.x0 && gx <= safe.x1 && gy >= safe.y0 && gy <= safe.y1;
}

export function worldPixel(gx: number, gy: number): { x: number; y: number } {
  return {
    x: gx * GRID_SIZE + GRID_SIZE / 2,
    y: gy * GRID_SIZE + GRID_SIZE / 2,
  };
}

/**
 * Near safe-zone border for a light village tree ring.
 * Deep town interior stays clear for buildings / future decor.
 */
export function nearSafeFringe(
  gx: number,
  gy: number,
  safe: SafeZone = SAFE_ZONE,
  band = 1,
): boolean {
  const inOuter =
    gx >= safe.x0 - band &&
    gx <= safe.x1 + band &&
    gy >= safe.y0 - band &&
    gy <= safe.y1 + band;
  if (!inOuter) {
    return false;
  }
  const deep =
    gx >= safe.x0 + 2 &&
    gx <= safe.x1 - 2 &&
    gy >= safe.y0 + 2 &&
    gy <= safe.y1 - 2;
  return !deep;
}
