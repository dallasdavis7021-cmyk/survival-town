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
  version: 1;
  player: PlayerStats;
  inventory: Record<InventoryItemId, number>;
  structures: PlacedStructure[];
  lastScene: 'TownScene' | 'CaveScene';
  pendingCaveGems: PendingCaveGem[];
}

const STORAGE_KEY = 'survival-town-save-v1';

const DEFAULT_STATE: PersistedState = {
  version: 1,
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
};

function cloneDefault(): PersistedState {
  return structuredClone(DEFAULT_STATE);
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

      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== 1) {
        return null;
      }

      return {
        ...cloneDefault(),
        ...parsed,
        player: { ...cloneDefault().player, ...parsed.player },
        inventory: { ...cloneDefault().inventory, ...parsed.inventory },
        structures: Array.isArray(parsed.structures) ? parsed.structures : [],
        pendingCaveGems: Array.isArray(parsed.pendingCaveGems) ? parsed.pendingCaveGems : [],
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
