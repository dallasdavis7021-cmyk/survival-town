import { GRID_SIZE } from '../systems/PlacementManager';

export interface SafeZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Matches TownScene world size. */
export const WORLD_COLS = 48;
export const WORLD_ROWS = 36;

export const SAFE_ZONE: SafeZone = {
  x0: 10,
  y0: 8,
  x1: 37,
  y1: 27,
};

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
