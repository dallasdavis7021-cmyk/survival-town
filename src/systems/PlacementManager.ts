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
  decoration: { wood: 1, ore: 1 },
};

export const BUILD_LABELS: Record<StructureKind, string> = {
  house: 'House',
  bench: 'Bench',
  wall: 'Wall',
  light: 'Light',
  decoration: 'Decor',
};

export const BUILD_ORDER: StructureKind[] = ['house', 'bench', 'wall', 'light', 'decoration'];

type BuildSubMode = 'place' | 'remove';

interface OccupiedCell {
  structure: PlacedStructure;
  sprite: Phaser.GameObjects.Image;
}

interface PaletteSlot {
  kind: StructureKind;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  costText: Phaser.GameObjects.Text;
}

/**
 * Town building UX — activated when PlayerTools building mode is selected.
 * RMB places; left-click or R removes (with material refund).
 */
export class PlacementManager {
  private scene: Phaser.Scene;
  private structuresLayer: Phaser.GameObjects.Group;
  private ghost: Phaser.GameObjects.Image;
  private ghostCell: Phaser.GameObjects.Image;
  private statusText: Phaser.GameObjects.Text;
  private paletteRoot: Phaser.GameObjects.Container;
  private paletteTitle!: Phaser.GameObjects.Text;
  private paletteSlots: PaletteSlot[] = [];
  private removeKey!: Phaser.Input.Keyboard.Key;
  private digitKeys: Phaser.Input.Keyboard.Key[] = [];
  private active = false;
  private subMode: BuildSubMode = 'place';
  private selected: StructureKind = 'house';
  private occupied = new Map<string, OccupiedCell>();
  private feedbackUntil = 0;
  private feedbackMessage = '';
  private onChanged?: () => void;
  private canBuildAt?: (gridX: number, gridY: number) => boolean;
  private cursorGrid = { x: 0, y: 0 };
  private boundPointerDown: (pointer: Phaser.Input.Pointer) => void;

  constructor(
    scene: Phaser.Scene,
    structuresLayer: Phaser.GameObjects.Group,
    options?: {
      onChanged?: () => void;
      canBuildAt?: (gridX: number, gridY: number) => boolean;
    },
  ) {
    this.scene = scene;
    this.structuresLayer = structuresLayer;
    this.onChanged = options?.onChanged;
    this.canBuildAt = options?.canBuildAt;

    this.ghostCell = scene.add
      .image(0, 0, 'grid-cell')
      .setAlpha(0.7)
      .setDepth(19)
      .setVisible(false);

    this.ghost = scene.add.image(0, 0, 'house').setAlpha(0.55).setDepth(20).setVisible(false);

    this.statusText = scene.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#fef9c3',
        backgroundColor: '#14532dcc',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(21)
      .setVisible(false);

    this.paletteRoot = scene.add.container(0, 0).setScrollFactor(0).setDepth(110).setVisible(false);
    this.buildPalette();

    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard plugin required for PlacementManager');
    }

    this.removeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.digitKeys = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
    ];

    this.boundPointerDown = (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer);
    scene.input.on('pointerdown', this.boundPointerDown);

    for (const structure of gameState.structures) {
      this.spawnStructure(structure, false);
    }
  }

  get isBuildMode(): boolean {
    return this.active;
  }

  get selectedLabel(): string {
    return BUILD_LABELS[this.selected];
  }

  get selectedCost(): string {
    return formatCost(BUILD_COSTS[this.selected]);
  }

  get isRemoveSubMode(): boolean {
    return this.subMode === 'remove';
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.subMode = 'place';
    }
    this.ghost.setVisible(active && this.subMode === 'place');
    this.ghostCell.setVisible(active);
    this.statusText.setVisible(active);
    this.paletteRoot.setVisible(active);
    this.clearFeedback();
    this.refreshPalette();
  }

  update(pointerWorldX: number, pointerWorldY: number): void {
    if (!this.active) {
      this.ghost.setVisible(false);
      this.ghostCell.setVisible(false);
      this.statusText.setVisible(false);
      return;
    }

    this.handleHotkeys();

    const gridX = Math.floor(pointerWorldX / GRID_SIZE);
    const gridY = Math.floor(pointerWorldY / GRID_SIZE);
    this.cursorGrid = { x: gridX, y: gridY };

    const worldX = gridX * GRID_SIZE + GRID_SIZE / 2;
    const worldY = gridY * GRID_SIZE + GRID_SIZE / 2;

    this.ghostCell.setPosition(worldX, worldY).setVisible(true);
    this.ghost.setPosition(worldX, worldY).setVisible(this.subMode === 'place');
    this.statusText.setPosition(worldX, worldY - 22).setVisible(true);

    if (this.subMode === 'place') {
      this.updatePlaceGhost(gridX, gridY);
    } else {
      this.updateRemoveGhost(gridX, gridY);
    }

    this.refreshPalette();
  }

  /** RMB place (or remove if in remove sub-mode). */
  contextAction(): void {
    if (!this.active) {
      return;
    }
    this.actAt(this.cursorGrid.x, this.cursorGrid.y);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.active) {
      return;
    }
    if (pointer.y >= this.scene.scale.height - 88) {
      return;
    }

    // RMB place is handled by the scene via contextAction() to avoid double-fires.
    if (pointer.rightButtonDown()) {
      return;
    }

    if (pointer.leftButtonDown()) {
      // Left-click removes under cursor when building tool is active
      this.tryRemove(this.cursorGrid.x, this.cursorGrid.y);
    }
  }

  private handleHotkeys(): void {
    if (Phaser.Input.Keyboard.JustDown(this.removeKey)) {
      this.subMode = this.subMode === 'remove' ? 'place' : 'remove';
      this.clearFeedback();
    }

    for (let i = 0; i < this.digitKeys.length; i += 1) {
      if (Phaser.Input.Keyboard.JustDown(this.digitKeys[i])) {
        this.selectKind(BUILD_ORDER[i]);
        this.subMode = 'place';
      }
    }
  }

  private updatePlaceGhost(gridX: number, gridY: number): void {
    this.ghost.setTexture(this.selected).setVisible(true);
    const key = cellKey(gridX, gridY);
    const occupied = this.occupied.has(key);
    const inSafe = !this.canBuildAt || this.canBuildAt(gridX, gridY);
    const afford = gameState.canAfford(BUILD_COSTS[this.selected]);
    const canPlace = !occupied && afford && inSafe;

    if (!inSafe) {
      this.ghost.setTint(0xef4444).setAlpha(0.35);
      this.ghostCell.setTint(0xef4444);
      this.statusText.setText('Wilderness — building only in town safe zone');
      this.statusText.setStyle({ color: '#fecaca', backgroundColor: '#7f1d1dcc' });
    } else if (canPlace) {
      this.ghost.setTint(0xffffff).setAlpha(0.6);
      this.ghostCell.setTint(0x4ade80);
      this.statusText.setText(`${BUILD_LABELS[this.selected]} — RMB place · LMB/R remove`);
      this.statusText.setStyle({ color: '#ecfccb', backgroundColor: '#14532dcc' });
    } else if (occupied) {
      this.ghost.setTint(0xf97316).setAlpha(0.35);
      this.ghostCell.setTint(0xf97316);
      this.statusText.setText('Occupied — LMB or R to remove');
      this.statusText.setStyle({ color: '#ffedd5', backgroundColor: '#9a3412cc' });
    } else {
      this.ghost.setTint(0xef4444).setAlpha(0.45);
      this.ghostCell.setTint(0xef4444);
      this.statusText.setText(`Need ${formatCost(BUILD_COSTS[this.selected])}`);
      this.statusText.setStyle({ color: '#fecaca', backgroundColor: '#7f1d1dcc' });
    }

    if (this.scene.time.now < this.feedbackUntil) {
      this.statusText.setText(this.feedbackMessage);
    }
  }

  private updateRemoveGhost(gridX: number, gridY: number): void {
    this.ghost.setVisible(false);
    const cell = this.occupied.get(cellKey(gridX, gridY));
    if (cell) {
      this.ghostCell.setTint(0xf87171);
      const refund = formatCost(BUILD_COSTS[cell.structure.kind]);
      this.statusText.setText(
        `Remove ${BUILD_LABELS[cell.structure.kind]} — refund ${refund || 'nothing'} (RMB/LMB)`,
      );
      this.statusText.setStyle({ color: '#fee2e2', backgroundColor: '#7f1d1dcc' });
    } else {
      this.ghostCell.setTint(0x94a3b8);
      this.statusText.setText('Remove sub-mode — aim at a structure (R back to place)');
      this.statusText.setStyle({ color: '#e2e8f0', backgroundColor: '#334155cc' });
    }

    if (this.scene.time.now < this.feedbackUntil) {
      this.statusText.setText(this.feedbackMessage);
    }
  }

  private actAt(gridX: number, gridY: number): void {
    if (this.subMode === 'place') {
      this.tryPlace(gridX, gridY);
    } else {
      this.tryRemove(gridX, gridY);
    }
  }

  private selectKind(kind: StructureKind): void {
    this.selected = kind;
    this.subMode = 'place';
    this.clearFeedback();
    this.refreshPalette();
  }

  private tryPlace(gridX: number, gridY: number): void {
    if (this.canBuildAt && !this.canBuildAt(gridX, gridY)) {
      this.flashFeedback('Build only inside the town safe zone', '#fecaca');
      return;
    }

    const key = cellKey(gridX, gridY);
    if (this.occupied.has(key)) {
      this.flashFeedback('Tile occupied — LMB to remove', '#fecaca');
      return;
    }

    const costs = BUILD_COSTS[this.selected];
    if (!gameState.canAfford(costs)) {
      this.flashFeedback(`Not enough materials (${formatCost(costs)})`, '#fecaca');
      return;
    }

    if (!gameState.spendItems(costs)) {
      this.flashFeedback('Could not spend materials', '#fecaca');
      return;
    }

    const structure: PlacedStructure = {
      id: `${this.selected}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: this.selected,
      gridX,
      gridY,
    };

    this.spawnStructure(structure, true);
    this.flashFeedback(`Placed ${BUILD_LABELS[this.selected]} (−${formatCost(costs)})`, '#bbf7d0');
    this.refreshPalette();
    this.onChanged?.();
  }

  private tryRemove(gridX: number, gridY: number): void {
    const key = cellKey(gridX, gridY);
    const cell = this.occupied.get(key);
    if (!cell) {
      this.flashFeedback('Nothing to remove here', '#e2e8f0');
      return;
    }

    const removed = gameState.removeStructure(cell.structure.id);
    if (!removed) {
      this.flashFeedback('Remove failed', '#fecaca');
      return;
    }

    const refund = BUILD_COSTS[removed.kind];
    gameState.refundItems(refund);
    cell.sprite.destroy();
    this.occupied.delete(key);

    this.flashFeedback(
      `Removed ${BUILD_LABELS[removed.kind]} (+${formatCost(refund) || '0'})`,
      '#bbf7d0',
    );
    this.refreshPalette();
    this.onChanged?.();
  }

  private spawnStructure(structure: PlacedStructure, persist: boolean): void {
    const key = cellKey(structure.gridX, structure.gridY);

    const sprite = this.scene.add
      .image(
        structure.gridX * GRID_SIZE + GRID_SIZE / 2,
        structure.gridY * GRID_SIZE + GRID_SIZE / 2,
        structure.kind,
      )
      .setDepth(5);

    this.structuresLayer.add(sprite);
    this.occupied.set(key, { structure, sprite });

    if (persist) {
      gameState.addStructure(structure);
    }
  }

  private buildPalette(): void {
    const camH = this.scene.scale.height;
    const camW = this.scene.scale.width;
    const barH = 78;
    const slotW = 92;
    const gap = 8;
    const totalW = BUILD_ORDER.length * slotW + (BUILD_ORDER.length - 1) * gap;
    const startX = (camW - totalW) / 2;
    const y = camH - barH - 8;

    const bar = this.scene.add
      .rectangle(camW / 2, y + barH / 2, totalW + 24, barH, 0x052e16, 0.92)
      .setStrokeStyle(1, 0x4ade80, 0.45);
    this.paletteRoot.add(bar);

    this.paletteTitle = this.scene.add
      .text(camW / 2, y + 8, 'PALETTE — 1-5 select · RMB place · LMB/R remove · Q change tool', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#bbf7d0',
      })
      .setOrigin(0.5, 0);
    this.paletteRoot.add(this.paletteTitle);

    BUILD_ORDER.forEach((kind, i) => {
      const x = startX + i * (slotW + gap) + slotW / 2;
      const slotY = y + 44;

      const bg = this.scene.add
        .rectangle(0, 0, slotW, 48, 0x14532d, 0.95)
        .setStrokeStyle(2, 0x86efac, 0.5)
        .setInteractive({ useHandCursor: true });

      const icon = this.scene.add.image(-28, 0, kind).setScale(0.85);
      const label = this.scene.add
        .text(4, -10, `${i + 1} ${BUILD_LABELS[kind]}`, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '11px',
          color: '#ecfccb',
        })
        .setOrigin(0, 0.5);
      const costText = this.scene.add
        .text(4, 8, formatCost(BUILD_COSTS[kind]), {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '10px',
          color: '#a3e635',
        })
        .setOrigin(0, 0.5);

      const container = this.scene.add.container(x, slotY, [bg, icon, label, costText]);
      this.paletteRoot.add(container);

      bg.on('pointerdown', () => {
        this.selectKind(kind);
      });

      this.paletteSlots.push({ kind, container, bg, icon, label, costText });
    });
  }

  private refreshPalette(): void {
    for (const slot of this.paletteSlots) {
      const selected = this.subMode === 'place' && slot.kind === this.selected;
      const afford = gameState.canAfford(BUILD_COSTS[slot.kind]);
      slot.bg.setFillStyle(selected ? 0x166534 : 0x14532d, 0.95);
      slot.bg.setStrokeStyle(2, selected ? 0xfde68a : afford ? 0x86efac : 0xf87171, selected ? 0.95 : 0.5);
      slot.icon.setAlpha(afford || selected ? 1 : 0.4);
      slot.costText.setColor(afford ? '#a3e635' : '#f87171');
      slot.costText.setText(formatCost(BUILD_COSTS[slot.kind]));
    }
  }

  private flashFeedback(message: string, _color: string): void {
    this.feedbackMessage = message;
    this.feedbackUntil = this.scene.time.now + 900;
  }

  private clearFeedback(): void {
    this.feedbackUntil = 0;
    this.feedbackMessage = '';
  }
}

function cellKey(gridX: number, gridY: number): string {
  return `${gridX},${gridY}`;
}

function formatCost(costs: Partial<Record<InventoryItemId, number>>): string {
  return (Object.entries(costs) as [InventoryItemId, number][])
    .map(([id, n]) => `${n} ${id}`)
    .join(', ');
}
