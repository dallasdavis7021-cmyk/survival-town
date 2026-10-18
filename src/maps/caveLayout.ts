/**
 * Cave walkway tilemap — deterministic carved grid (not random per run).
 *
 * Authorship: a fixed carve script builds rooms + corridors into a 2D tile
 * grid, then markers (spawn/exit/hostiles/ore) are placed on walkable cells.
 * Runtime only *reads* the baked grid; nothing regenerates between sessions.
 *
 * Legend (internal cells):
 *   wall | floor | spawn | exit | hostile1–3 | ore | oreRich | oreRare
 *
 * North = deeper tiers; south = town entrance/exit.
 */
export const CAVE_TILE = 32;
export const CAVE_COLS = 52;
export const CAVE_ROWS = 56;

export type CaveCell =
  | 'wall'
  | 'floor'
  | 'spawn'
  | 'exit'
  | 'hostile1'
  | 'hostile2'
  | 'hostile3'
  | 'ore'
  | 'oreRich'
  | 'oreRare';

export interface CavePoint {
  tx: number;
  ty: number;
  x: number;
  y: number;
}

/** Carved chamber (not corridors) — gem spawn candidates. */
export interface CaveRoom {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: CavePoint[];
}

export interface ParsedCaveMap {
  cols: number;
  rows: number;
  width: number;
  height: number;
  cells: CaveCell[][];
  walkable: boolean[][];
  rooms: CaveRoom[];
  spawn: CavePoint;
  exit: CavePoint;
  hostiles: { point: CavePoint; tier: 1 | 2 | 3 }[];
  ores: { point: CavePoint; kind: 'ore-node' | 'ore-rich' | 'ore-rare'; tier: 1 | 2 | 3 }[];
}

export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function point(tx: number, ty: number): CavePoint {
  return {
    tx,
    ty,
    x: tx * CAVE_TILE + CAVE_TILE / 2,
    y: ty * CAVE_TILE + CAVE_TILE / 2,
  };
}

function fillWalls(cols: number, rows: number): CaveCell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'wall' as CaveCell));
}

function carveRect(grid: CaveCell[][], x0: number, y0: number, x1: number, y1: number): void {
  const loX = Math.max(1, Math.min(x0, x1));
  const hiX = Math.min(CAVE_COLS - 2, Math.max(x0, x1));
  const loY = Math.max(1, Math.min(y0, y1));
  const hiY = Math.min(CAVE_ROWS - 2, Math.max(y0, y1));
  for (let y = loY; y <= hiY; y += 1) {
    for (let x = loX; x <= hiX; x += 1) {
      grid[y][x] = 'floor';
    }
  }
}

function carveH(grid: CaveCell[][], y: number, x0: number, x1: number, width = 1): void {
  const half = Math.floor((width - 1) / 2);
  for (let dy = -half; dy <= width - 1 - half; dy += 1) {
    carveRect(grid, x0, y + dy, x1, y + dy);
  }
}

function carveV(grid: CaveCell[][], x: number, y0: number, y1: number, width = 1): void {
  const half = Math.floor((width - 1) / 2);
  for (let dx = -half; dx <= width - 1 - half; dx += 1) {
    carveRect(grid, x + dx, y0, x + dx, y1);
  }
}

/** Room rectangles only (corridors carved separately). */
const ROOM_RECTS: { id: string; x0: number; y0: number; x1: number; y1: number }[] = [
  { id: 'nw-abyss', x0: 4, y0: 2, x1: 18, y1: 8 },
  { id: 'ne-abyss', x0: 32, y0: 3, x1: 47, y1: 9 },
  { id: 'n-alcove', x0: 4, y0: 14, x1: 14, y1: 18 },
  { id: 'ne-alcove', x0: 34, y0: 12, x1: 46, y1: 17 },
  { id: 'w-depths', x0: 3, y0: 23, x1: 16, y1: 29 },
  { id: 'e-depths', x0: 34, y0: 24, x1: 48, y1: 30 },
  { id: 'sw-depths', x0: 3, y0: 34, x1: 12, y1: 38 },
  { id: 'se-depths', x0: 36, y0: 33, x1: 47, y1: 38 },
  { id: 'w-shallow', x0: 4, y0: 40, x1: 15, y1: 45 },
  { id: 'e-shallow', x0: 34, y0: 40, x1: 46, y1: 46 },
  { id: 'sw-foyer', x0: 4, y0: 49, x1: 14, y1: 52 },
];

/** Deterministic maze: spine + chambers + bottlenecks. */
function carveCaveGrid(): { grid: CaveCell[][]; rooms: CaveRoom[] } {
  const g = fillWalls(CAVE_COLS, CAVE_ROWS);
  const spine = 26;

  // Main N–S spine (narrow in places, wider foyer at south)
  carveV(g, spine, 2, CAVE_ROWS - 3, 1);
  carveV(g, spine, CAVE_ROWS - 8, CAVE_ROWS - 3, 3); // foyer

  // --- Abyss chambers (north) ---
  carveRect(g, 4, 2, 18, 8);
  carveH(g, 5, 18, spine, 1);
  carveRect(g, 32, 3, 47, 9);
  carveH(g, 6, spine, 32, 1);
  carveV(g, 10, 8, 14, 1);
  carveRect(g, 4, 14, 14, 18);
  carveH(g, 16, 14, spine, 1);
  carveRect(g, 34, 12, 46, 17);
  carveH(g, 14, spine, 34, 1);
  carveV(g, spine - 1, 19, 22, 1);
  carveV(g, spine + 1, 19, 22, 1);
  carveH(g, 20, spine - 1, spine + 1, 1);

  // --- Depths (mid) ---
  carveRect(g, 3, 23, 16, 29);
  carveH(g, 26, 16, spine, 1);
  carveRect(g, 34, 24, 48, 30);
  carveH(g, 27, spine, 34, 1);
  carveV(g, 8, 29, 34, 1);
  carveRect(g, 3, 34, 12, 38);
  carveH(g, 36, 12, spine, 1);
  carveRect(g, 36, 33, 47, 38);
  carveH(g, 35, spine, 36, 1);
  carveH(g, 31, spine, spine + 8, 1);
  carveV(g, spine + 8, 31, 33, 1);
  carveH(g, 33, spine + 2, spine + 8, 1);

  // --- Shallow (south) ---
  carveRect(g, 4, 40, 15, 45);
  carveH(g, 42, 15, spine, 1);
  carveRect(g, 34, 40, 46, 46);
  carveH(g, 43, spine, 34, 1);
  carveV(g, 10, 45, 49, 1);
  carveRect(g, 4, 49, 14, 52);
  carveH(g, 50, 14, spine, 1);

  carveH(g, CAVE_ROWS - 4, 8, spine + 12, 2);
  carveRect(g, 8, CAVE_ROWS - 5, 12, CAVE_ROWS - 3);
  carveRect(g, spine + 8, CAVE_ROWS - 5, spine + 14, CAVE_ROWS - 3);

  const rooms: CaveRoom[] = ROOM_RECTS.map((r) => {
    const tiles: CavePoint[] = [];
    for (let ty = r.y0; ty <= r.y1; ty += 1) {
      for (let tx = r.x0; tx <= r.x1; tx += 1) {
        if (g[ty]?.[tx] && g[ty][tx] !== 'wall') {
          tiles.push(point(tx, ty));
        }
      }
    }
    return { ...r, tiles };
  }).filter((r) => r.tiles.length > 0);

  return { grid: g, rooms };
}

function placeMarker(grid: CaveCell[][], tx: number, ty: number, cell: CaveCell): void {
  if (ty < 1 || tx < 1 || ty >= CAVE_ROWS - 1 || tx >= CAVE_COLS - 1) {
    throw new Error(`Marker out of bounds ${tx},${ty}`);
  }
  if (grid[ty][tx] === 'wall') {
    // Nudge to nearest floor (search small radius)
    for (let r = 0; r <= 3; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const x = tx + dx;
          const y = ty + dy;
          if (y > 0 && x > 0 && y < CAVE_ROWS - 1 && x < CAVE_COLS - 1 && grid[y][x] === 'floor') {
            grid[y][x] = cell;
            return;
          }
        }
      }
    }
    throw new Error(`No floor near marker ${cell} at ${tx},${ty}`);
  }
  grid[ty][tx] = cell;
}

function bakeMarkers(grid: CaveCell[][]): void {
  const spine = 26;
  // Exit west, spawn east on foyer
  placeMarker(grid, 10, CAVE_ROWS - 4, 'exit');
  placeMarker(grid, spine + 11, CAVE_ROWS - 4, 'spawn');

  // Hostiles by tier bands
  placeMarker(grid, 8, 5, 'hostile3');
  placeMarker(grid, 40, 6, 'hostile3');
  placeMarker(grid, 8, 16, 'hostile3');
  placeMarker(grid, 40, 15, 'hostile3');

  placeMarker(grid, 6, 26, 'hostile2');
  placeMarker(grid, 40, 27, 'hostile2');
  placeMarker(grid, 6, 36, 'hostile2');
  placeMarker(grid, 42, 35, 'hostile2');

  placeMarker(grid, 8, 42, 'hostile1');
  placeMarker(grid, 40, 43, 'hostile1');
  placeMarker(grid, 8, 50, 'hostile1');

  // Ore
  placeMarker(grid, 12, 4, 'oreRare');
  placeMarker(grid, 44, 5, 'oreRare');
  placeMarker(grid, 8, 15, 'oreRare');
  placeMarker(grid, 42, 14, 'oreRich');

  placeMarker(grid, 8, 25, 'oreRich');
  placeMarker(grid, 44, 26, 'oreRich');
  placeMarker(grid, 6, 35, 'oreRich');
  placeMarker(grid, 44, 36, 'ore');

  placeMarker(grid, 8, 41, 'ore');
  placeMarker(grid, 42, 42, 'ore');
  placeMarker(grid, 8, 51, 'ore');
}

/** Parse / bake the deterministic cave tilemap. */
export function parseCaveLayout(): ParsedCaveMap {
  const { grid: cells, rooms } = carveCaveGrid();
  bakeMarkers(cells);

  const walkable = cells.map((row) => row.map((c) => c !== 'wall'));
  const hostiles: ParsedCaveMap['hostiles'] = [];
  const ores: ParsedCaveMap['ores'] = [];
  let spawn: CavePoint | null = null;
  let exit: CavePoint | null = null;

  for (let ty = 0; ty < CAVE_ROWS; ty += 1) {
    for (let tx = 0; tx < CAVE_COLS; tx += 1) {
      const cell = cells[ty][tx];
      const p = point(tx, ty);
      if (cell === 'spawn') spawn = p;
      else if (cell === 'exit') exit = p;
      else if (cell === 'hostile1') hostiles.push({ point: p, tier: 1 });
      else if (cell === 'hostile2') hostiles.push({ point: p, tier: 2 });
      else if (cell === 'hostile3') hostiles.push({ point: p, tier: 3 });
      else if (cell === 'ore') ores.push({ point: p, kind: 'ore-node', tier: 1 });
      else if (cell === 'oreRich') ores.push({ point: p, kind: 'ore-rich', tier: 2 });
      else if (cell === 'oreRare') ores.push({ point: p, kind: 'ore-rare', tier: 3 });
    }
  }

  if (!spawn || !exit) {
    throw new Error('Cave bake failed: missing spawn or exit');
  }

  return {
    cols: CAVE_COLS,
    rows: CAVE_ROWS,
    width: CAVE_COLS * CAVE_TILE,
    height: CAVE_ROWS * CAVE_TILE,
    cells,
    walkable,
    rooms,
    spawn,
    exit,
    hostiles,
    ores,
  };
}

export function tierAtWorldY(y: number, mapHeight: number): 1 | 2 | 3 {
  const t = y / mapHeight;
  if (t < 0.34) return 3;
  if (t < 0.62) return 2;
  return 1;
}

export function buildWallRects(walkable: boolean[][], tile = CAVE_TILE): WallRect[] {
  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;
  const rects: WallRect[] = [];

  for (let ty = 0; ty < rows; ty += 1) {
    let tx = 0;
    while (tx < cols) {
      if (walkable[ty][tx]) {
        tx += 1;
        continue;
      }
      const start = tx;
      while (tx < cols && !walkable[ty][tx]) tx += 1;
      rects.push({
        x: start * tile,
        y: ty * tile,
        w: (tx - start) * tile,
        h: tile,
      });
    }
  }

  return rects;
}
