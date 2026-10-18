import { GRID_SIZE } from '../systems/PlacementManager';

export type OverworldBiome = 'safe' | 'jungle' | 'autumn' | 'snow';

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

/**
 * Overworld biome layout:
 * - safe: town rectangle (grass + village trees on fringe)
 * - snow: entire northern wilderness strip
 * - jungle: western wilderness (+ SW)
 * - autumn: eastern wilderness (+ SE)
 */
export function biomeAt(gx: number, gy: number, safe: SafeZone = SAFE_ZONE): OverworldBiome {
  if (isSafeGrid(gx, gy, safe)) {
    return 'safe';
  }
  if (gy < safe.y0) {
    return 'snow';
  }
  if (gx < safe.x0) {
    return 'jungle';
  }
  if (gx > safe.x1) {
    return 'autumn';
  }
  // southern wilderness
  return gx < WORLD_COLS / 2 ? 'jungle' : 'autumn';
}

export function biomeLabel(b: OverworldBiome): string {
  switch (b) {
    case 'safe':
      return 'Town';
    case 'jungle':
      return 'Jungle';
    case 'autumn':
      return 'Autumn';
    case 'snow':
      return 'Snow';
  }
}

export function worldPixel(gx: number, gy: number): { x: number; y: number } {
  return {
    x: gx * GRID_SIZE + GRID_SIZE / 2,
    y: gy * GRID_SIZE + GRID_SIZE / 2,
  };
}

/** Near safe-zone border (inside or just outside) for village tree ring. */
export function nearSafeFringe(gx: number, gy: number, safe: SafeZone = SAFE_ZONE, band = 2): boolean {
  const inOuter =
    gx >= safe.x0 - band &&
    gx <= safe.x1 + band &&
    gy >= safe.y0 - band &&
    gy <= safe.y1 + band;
  if (!inOuter) {
    return false;
  }
  // Exclude deep interior (leave room for buildings / decor)
  const deep =
    gx >= safe.x0 + 3 &&
    gx <= safe.x1 - 3 &&
    gy >= safe.y0 + 3 &&
    gy <= safe.y1 - 3;
  return !deep;
}
