import Phaser from 'phaser';
import {
  gameState,
  type InventoryItemId,
  type PlacedStructure,
  type StructureKind,
} from '../state/GameState';

export const GRID_SIZE = 32;

export const BUILD_COSTS: Record<StructureKind, Partial<Record<InventoryItemId, number>>> = {
  house: { wood: 4, stone: 2 },
  bench: { wood: 3 },
  wall: { stone: 2 },
  light: { wood: 1, ore: 1 },
};

const BUILD_ORDER: StructureKind[] = ['house', 'bench', 'wall', 'light'];

export class PlacementManager {
  private scene: Phaser.Scene;
  private structuresLayer: Phaser.GameObjects.Group;
  private ghost: Phaser.GameObjects.Image;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private cycleKey!: Phaser.Input.Keyboard.Key;
  private mode = false;
  private selected: StructureKind = 'house';
  private occupied = new Set<string>();
  private hudText: Phaser.GameObjects.Text;
  private onChanged?: () => void;

  constructor(
    scene: Phaser.Scene,
    structuresLayer: Phaser.GameObjects.Group,
    hudText: Phaser.GameObjects.Text,
    onChanged?: () => void,
  ) {
    this.scene = scene;
    this.structuresLayer = structuresLayer;
    this.hudText = hudText;
    this.onChanged = onChanged;

    this.ghost = scene.add.image(0, 0, 'house').setAlpha(0.45).setDepth(20).setVisible(false);

    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard plugin required for PlacementManager');
    }

    this.placeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.cycleKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.mode || !pointer.leftButtonDown()) {
        return;
      }
      const gridX = Math.floor(pointer.worldX / GRID_SIZE);
      const gridY = Math.floor(pointer.worldY / GRID_SIZE);
      this.tryPlace(gridX, gridY);
    });

    for (const structure of gameState.structures) {
      this.spawnStructure(structure, false);
    }

    this.refreshHud();
  }

  get isBuildMode(): boolean {
    return this.mode;
  }

  toggleMode(): void {
    this.mode = !this.mode;
    this.ghost.setVisible(this.mode);
    this.refreshHud();
  }

  update(pointerWorldX: number, pointerWorldY: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.cycleKey)) {
      if (this.mode) {
        this.cycleSelected();
      } else {
        this.toggleMode();
      }
    }

    if (!this.mode) {
      this.ghost.setVisible(false);
      return;
    }

    this.ghost.setVisible(true);
    this.ghost.setTexture(this.selected);

    const gridX = Math.floor(pointerWorldX / GRID_SIZE);
    const gridY = Math.floor(pointerWorldY / GRID_SIZE);
    const worldX = gridX * GRID_SIZE + GRID_SIZE / 2;
    const worldY = gridY * GRID_SIZE + GRID_SIZE / 2;
    this.ghost.setPosition(worldX, worldY);

    const key = `${gridX},${gridY}`;
    const canPlace = !this.occupied.has(key) && this.canAfford(this.selected);
    this.ghost.setTint(canPlace ? 0xffffff : 0xff5555);

    if (Phaser.Input.Keyboard.JustDown(this.placeKey)) {
      this.tryPlace(gridX, gridY);
    }
  }

  private cycleSelected(): void {
    const index = BUILD_ORDER.indexOf(this.selected);
    this.selected = BUILD_ORDER[(index + 1) % BUILD_ORDER.length];
    this.refreshHud();
  }

  private canAfford(kind: StructureKind): boolean {
    const costs = BUILD_COSTS[kind];
    return Object.entries(costs).every(
      ([id, cost]) => (gameState.inventory[id as InventoryItemId] ?? 0) >= (cost ?? 0),
    );
  }

  private tryPlace(gridX: number, gridY: number): void {
    const key = `${gridX},${gridY}`;
    if (this.occupied.has(key)) {
      return;
    }

    if (!gameState.spendItems(BUILD_COSTS[this.selected])) {
      return;
    }

    const structure: PlacedStructure = {
      id: `${this.selected}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: this.selected,
      gridX,
      gridY,
    };

    this.spawnStructure(structure, true);
    this.refreshHud();
    this.onChanged?.();
  }

  private spawnStructure(structure: PlacedStructure, persist: boolean): void {
    const key = `${structure.gridX},${structure.gridY}`;
    this.occupied.add(key);

    const sprite = this.scene.add
      .image(
        structure.gridX * GRID_SIZE + GRID_SIZE / 2,
        structure.gridY * GRID_SIZE + GRID_SIZE / 2,
        structure.kind,
      )
      .setDepth(5);

    this.structuresLayer.add(sprite);

    if (persist) {
      gameState.addStructure(structure);
    }
  }

  refreshHud(): void {
    const inv = gameState.inventory;
    const cost = BUILD_COSTS[this.selected];
    const costStr = Object.entries(cost)
      .map(([id, n]) => `${n} ${id}`)
      .join(', ');

    this.hudText.setText(
      [
        `TOWN — safe zone`,
        `HP ${gameState.player.hp}/${gameState.player.maxHp}`,
        `Inv: wood ${inv.wood} | stone ${inv.stone} | ore ${inv.ore} | scrap ${inv.scrap}`,
        this.mode
          ? `Build: ${this.selected} (${costStr}) — click/E place, Q cycle, B exit`
          : `B/Q build mode · Walk north gate → cave`,
      ].join('\n'),
    );
  }
}
