export type InventoryItemId = 'wood' | 'stone' | 'ore' | 'scrap';

export type StructureKind = 'house' | 'bench' | 'wall' | 'light';

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
    wood: 8,
    stone: 4,
    ore: 0,
    scrap: 0,
  },
  structures: [],
  lastScene: 'TownScene',
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

  setLastScene(scene: PersistedState['lastScene']): void {
    this.data.lastScene = scene;
    this.queueSave();
  }

  addItem(id: InventoryItemId, amount = 1): void {
    this.data.inventory[id] = (this.data.inventory[id] ?? 0) + amount;
    this.queueSave();
  }

  spendItems(costs: Partial<Record<InventoryItemId, number>>): boolean {
    for (const [id, cost] of Object.entries(costs) as [InventoryItemId, number][]) {
      if ((this.data.inventory[id] ?? 0) < cost) {
        return false;
      }
    }

    for (const [id, cost] of Object.entries(costs) as [InventoryItemId, number][]) {
      this.data.inventory[id] -= cost;
    }

    this.queueSave();
    return true;
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
