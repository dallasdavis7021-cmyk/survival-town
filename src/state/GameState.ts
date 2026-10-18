import { CAVE_COLS, CAVE_ROWS } from '../maps/caveLayout';

export type InventoryItemId =
  | 'wood'
  | 'stone'
  | 'ore'
  | 'scrap'
  | 'crystal'
  | 'diamond'
  | 'emerald'
  | 'sapphire'
  | 'gold'
  | 'iron'
  | 'silver';

export type StructureKind = 'house' | 'bench' | 'wall' | 'light' | 'decoration';

export type CaveGemId = 'diamond' | 'emerald' | 'sapphire';

/** Queued cave-gem respawn (picked on next cave enter at a different room). */
export interface PendingCaveGem {
  id: CaveGemId;
  excludeTx: number;
  excludeTy: number;
}

export interface PlacedStructure {
  id: string;
  kind: StructureKind;
  gridX: number;
  gridY: number;
}

export interface PlayerStats {
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
}

export interface PersistedState {
  version: 2;
  player: PlayerStats;
  inventory: Record<InventoryItemId, number>;
  structures: PlacedStructure[];
  lastScene: 'TownScene' | 'CaveScene';
  pendingCaveGems: PendingCaveGem[];
  /** Cave fog-of-war: row strings of '0'/'1', length CAVE_ROWS × CAVE_COLS. */
  caveExplored: string[];
}

const STORAGE_KEY = 'survival-town-save-v1';

const DEFAULT_STATE: PersistedState = {
  version: 2,
  player: {
    hp: 100,
    maxHp: 100,
    attack: 12,
    speed: 160,
  },
  inventory: {
    wood: 16,
    stone: 10,
    ore: 2,
    scrap: 2,
    crystal: 0,
    diamond: 0,
    emerald: 0,
    sapphire: 0,
    gold: 0,
    iron: 0,
    silver: 0,
  },
  structures: [],
  lastScene: 'TownScene',
  pendingCaveGems: [],
  caveExplored: emptyCaveExplored(),
};

export function emptyCaveExplored(): string[] {
  return Array.from({ length: CAVE_ROWS }, () => '0'.repeat(CAVE_COLS));
}

function cloneDefault(): PersistedState {
  return structuredClone(DEFAULT_STATE);
}

function normalizeCaveExplored(raw: unknown): string[] {
  const blank = emptyCaveExplored();
  if (!Array.isArray(raw) || raw.length === 0) {
    return blank;
  }
  const rows: string[] = [];
  for (let y = 0; y < CAVE_ROWS; y += 1) {
    const src = typeof raw[y] === 'string' ? (raw[y] as string) : '';
    let row = '';
    for (let x = 0; x < CAVE_COLS; x += 1) {
      row += src[x] === '1' ? '1' : '0';
    }
    rows.push(row);
  }
  return rows;
}

export class GameState {
  private data: PersistedState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.data = this.load() ?? cloneDefault();
  }

  get snapshot(): Readonly<PersistedState> {
    return this.data;
  }

  get player(): PlayerStats {
    return this.data.player;
  }

  get inventory(): Record<InventoryItemId, number> {
    return this.data.inventory;
  }

  get structures(): PlacedStructure[] {
    return this.data.structures;
  }

  get lastScene(): PersistedState['lastScene'] {
    return this.data.lastScene;
  }

  get pendingCaveGems(): PendingCaveGem[] {
    return this.data.pendingCaveGems;
  }

  get caveExplored(): string[] {
    return this.data.caveExplored;
  }

  isCaveTileExplored(tx: number, ty: number): boolean {
    if (ty < 0 || ty >= CAVE_ROWS || tx < 0 || tx >= CAVE_COLS) {
      return false;
    }
    return this.data.caveExplored[ty]?.[tx] === '1';
  }

  /** Reveal cave tiles in a Chebyshev radius; returns true if anything new. */
  revealCaveAround(tx: number, ty: number, radius = 3): boolean {
    let changed = false;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = tx + dx;
        const y = ty + dy;
        if (y < 0 || y >= CAVE_ROWS || x < 0 || x >= CAVE_COLS) {
          continue;
        }
        const row = this.data.caveExplored[y];
        if (row[x] === '1') {
          continue;
        }
        this.data.caveExplored[y] = row.slice(0, x) + '1' + row.slice(x + 1);
        changed = true;
      }
    }
    if (changed) {
      this.queueSave();
    }
    return changed;
  }

  setLastScene(scene: PersistedState['lastScene']): void {
    this.data.lastScene = scene;
    this.queueSave();
  }

  addItem(id: InventoryItemId, amount = 1): void {
    this.data.inventory[id] = (this.data.inventory[id] ?? 0) + amount;
    this.queueSave();
  }

  canAfford(costs: Partial<Record<InventoryItemId, number>>): boolean {
    return (Object.entries(costs) as [InventoryItemId, number][]).every(
      ([id, cost]) => (this.data.inventory[id] ?? 0) >= cost,
    );
  }

  spendItems(costs: Partial<Record<InventoryItemId, number>>): boolean {
    if (!this.canAfford(costs)) {
      return false;
    }

    for (const [id, cost] of Object.entries(costs) as [InventoryItemId, number][]) {
      this.data.inventory[id] -= cost;
    }

    this.queueSave();
    return true;
  }

  refundItems(costs: Partial<Record<InventoryItemId, number>>): void {
    for (const [id, amount] of Object.entries(costs) as [InventoryItemId, number][]) {
      this.data.inventory[id] = (this.data.inventory[id] ?? 0) + amount;
    }
    this.queueSave();
  }

  heal(amount: number): void {
    this.data.player.hp = Math.min(this.data.player.maxHp, this.data.player.hp + amount);
    this.queueSave();
  }

  damage(amount: number): void {
    this.data.player.hp = Math.max(0, this.data.player.hp - amount);
    this.queueSave();
  }

  setStructures(structures: PlacedStructure[]): void {
    this.data.structures = structures;
    this.queueSave();
  }

  addStructure(structure: PlacedStructure): void {
    this.data.structures.push(structure);
    this.queueSave();
  }

  removeStructure(id: string): PlacedStructure | null {
    const index = this.data.structures.findIndex((s) => s.id === id);
    if (index < 0) {
      return null;
    }
    const [removed] = this.data.structures.splice(index, 1);
    this.queueSave();
    return removed ?? null;
  }

  queueCaveGemRespawn(gem: PendingCaveGem): void {
    this.data.pendingCaveGems.push(gem);
    this.queueSave();
  }

  takePendingCaveGems(): PendingCaveGem[] {
    const gems = [...this.data.pendingCaveGems];
    this.data.pendingCaveGems = [];
    this.queueSave();
    return gems;
  }

  reset(): void {
    this.data = cloneDefault();
    this.saveNow();
  }

  private load(): PersistedState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const ver = Number(parsed.version);
      if (ver !== 1 && ver !== 2) {
        return null;
      }
      const typed = parsed as unknown as Partial<PersistedState>;

      return {
        ...cloneDefault(),
        ...typed,
        version: 2,
        player: { ...cloneDefault().player, ...typed.player },
        inventory: { ...cloneDefault().inventory, ...typed.inventory },
        structures: Array.isArray(typed.structures) ? typed.structures : [],
        pendingCaveGems: Array.isArray(typed.pendingCaveGems) ? typed.pendingCaveGems : [],
        caveExplored: normalizeCaveExplored(typed.caveExplored),
      };
    } catch {
      return null;
    }
  }

  private queueSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }
}

/** Shared singleton used across scenes and systems. */
export const gameState = new GameState();
