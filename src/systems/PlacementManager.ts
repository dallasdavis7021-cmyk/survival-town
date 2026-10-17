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
  decoration: { wood: 1, scrap: 1 },
};

export const BUILD_LABELS: Record<StructureKind, string> = {
  house: 'House',
  bench: 'Bench',
  wall: 'Wall',
  light: 'Light',
  decoration: 'Decor',
};

export const BUILD_ORDER: StructureKind[] = ['house', 'bench', 'wall', 'light', 'decoration'];

type BuildMode = 'off' | 'place' | 'remove';

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
 * Town-only building UX: 32×32 snap, material costs, ghost preview,
 * clickable structure palette, place + remove-with-refund.
 * No hostile / combat logic lives here.
 */
export class PlacementManager {
  private scene: Phaser.Scene;
  private structuresLayer: Phaser.GameObjects.Group;
  private ghost: Phaser.GameObjects.Image;
  private ghostCell: Phaser.GameObjects.Image;
  private statusText: Phaser.GameObjects.Text;
  private hudText: Phaser.GameObjects.Text;
  private paletteRoot: Phaser.GameObjects.Container;
  private paletteSlots: PaletteSlot[] = [];
  private placeKey!: Phaser.Input.Keyboard.Key;
  private cycleKey!: Phaser.Input.Keyboard.Key;
  private removeKey!: Phaser.Input.Keyboard.Key;
  private digitKeys: Phaser.Input.Keyboard.Key[] = [];
  private mode: BuildMode = 'off';
  private selected: StructureKind = 'house';
  private occupied = new Map<string, OccupiedCell>();
  private feedbackUntil = 0;
  private feedbackMessage = '';
  private onChanged?: () => void;
  private cursorGrid = { x: 0, y: 0 };

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

    this.placeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.cycleKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.removeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.digitKeys = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
    ];

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.mode === 'off' || !pointer.leftButtonDown()) {
        return;
      }
      // Ignore clicks on the palette strip (handled by slot handlers).
      if (pointer.y >= this.scene.scale.height - 88) {
        return;
      }
      this.actAt(this.cursorGrid.x, this.cursorGrid.y);
    });

    for (const structure of gameState.structures) {
      this.spawnStructure(structure, false);
    }

    this.refreshHud();
    this.refreshPalette();
  }

  get isBuildMode(): boolean {
    return this.mode !== 'off';
  }

  toggleMode(): void {
    if (this.mode === 'off') {
      this.setMode('place');
    } else {
      this.setMode('off');
    }
  }

  private setMode(next: BuildMode): void {
    this.mode = next;
    const active = next !== 'off';
    this.ghost.setVisible(active);
    this.ghostCell.setVisible(active);
    this.statusText.setVisible(active);
    this.paletteRoot.setVisible(active);
    this.clearFeedback();
    this.refreshHud();
    this.refreshPalette();
  }

  update(pointerWorldX: number, pointerWorldY: number): void {
    this.handleHotkeys();

    if (this.mode === 'off') {
      this.ghost.setVisible(false);
      this.ghostCell.setVisible(false);
      this.statusText.setVisible(false);
      return;
    }

    const gridX = Math.floor(pointerWorldX / GRID_SIZE);
    const gridY = Math.floor(pointerWorldY / GRID_SIZE);
    this.cursorGrid = { x: gridX, y: gridY };

    const worldX = gridX * GRID_SIZE + GRID_SIZE / 2;
    const worldY = gridY * GRID_SIZE + GRID_SIZE / 2;

    this.ghostCell.setPosition(worldX, worldY).setVisible(true);
    this.ghost.setPosition(worldX, worldY).setVisible(this.mode === 'place');
    this.statusText.setPosition(worldX, worldY - 22).setVisible(true);

    if (this.mode === 'place') {
      this.updatePlaceGhost(gridX, gridY);
    } else {
      this.updateRemoveGhost(gridX, gridY);
    }

    if (Phaser.Input.Keyboard.JustDown(this.placeKey)) {
      this.actAt(gridX, gridY);
    }

    this.refreshHud();
    this.refreshPalette();
  }

  private handleHotkeys(): void {
    if (Phaser.Input.Keyboard.JustDown(this.cycleKey)) {
      if (this.mode === 'off') {
        this.setMode('place');
      } else if (this.mode === 'place') {
        this.cycleSelected(1);
      }
    }

    if (this.mode !== 'off' && Phaser.Input.Keyboard.JustDown(this.removeKey)) {
      this.setMode(this.mode === 'remove' ? 'place' : 'remove');
    }

    for (let i = 0; i < this.digitKeys.length; i += 1) {
      if (Phaser.Input.Keyboard.JustDown(this.digitKeys[i])) {
        if (this.mode === 'off') {
          this.setMode('place');
        } else if (this.mode === 'remove') {
          this.setMode('place');
        }
        this.selectKind(BUILD_ORDER[i]);
      }
    }
  }

  private updatePlaceGhost(gridX: number, gridY: number): void {
    this.ghost.setTexture(this.selected).setVisible(true);
    const key = cellKey(gridX, gridY);
    const occupied = this.occupied.has(key);
    const afford = gameState.canAfford(BUILD_COSTS[this.selected]);
    const canPlace = !occupied && afford;

    if (canPlace) {
      this.ghost.setTint(0xffffff).setAlpha(0.6);
      this.ghostCell.setTint(0x4ade80);
      this.statusText.setText(`${BUILD_LABELS[this.selected]} — click / E to place`);
      this.statusText.setStyle({ color: '#ecfccb', backgroundColor: '#14532dcc' });
    } else if (occupied) {
      this.ghost.setTint(0xf97316).setAlpha(0.35);
      this.ghostCell.setTint(0xf97316);
      this.statusText.setText('Occupied — press R to remove');
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
        `Remove ${BUILD_LABELS[cell.structure.kind]} — refund ${refund || 'nothing'}`,
      );
      this.statusText.setStyle({ color: '#fee2e2', backgroundColor: '#7f1d1dcc' });
    } else {
      this.ghostCell.setTint(0x94a3b8);
      this.statusText.setText('Remove mode — click a structure (R exits)');
      this.statusText.setStyle({ color: '#e2e8f0', backgroundColor: '#334155cc' });
    }

    if (this.scene.time.now < this.feedbackUntil) {
      this.statusText.setText(this.feedbackMessage);
    }
  }

  private actAt(gridX: number, gridY: number): void {
    if (this.mode === 'place') {
      this.tryPlace(gridX, gridY);
    } else if (this.mode === 'remove') {
      this.tryRemove(gridX, gridY);
    }
  }

  private cycleSelected(dir: number): void {
    const index = BUILD_ORDER.indexOf(this.selected);
    const next = (index + dir + BUILD_ORDER.length) % BUILD_ORDER.length;
    this.selectKind(BUILD_ORDER[next]);
  }

  private selectKind(kind: StructureKind): void {
    this.selected = kind;
    if (this.mode === 'remove') {
      this.setMode('place');
    }
    this.clearFeedback();
    this.refreshHud();
    this.refreshPalette();
  }

  private tryPlace(gridX: number, gridY: number): void {
    const key = cellKey(gridX, gridY);
    if (this.occupied.has(key)) {
      this.flashFeedback('Tile occupied', '#fecaca');
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
    this.refreshHud();
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
    this.refreshHud();
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

    const title = this.scene.add
      .text(camW / 2, y + 8, 'STRUCTURE PALETTE — 1-5 select · Q cycle · R remove · B exit', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#bbf7d0',
      })
      .setOrigin(0.5, 0);
    this.paletteRoot.add(title);

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
        this.setMode('place');
      });

      this.paletteSlots.push({ kind, container, bg, icon, label, costText });
    });
  }

  private refreshPalette(): void {
    for (const slot of this.paletteSlots) {
      const selected = this.mode === 'place' && slot.kind === this.selected;
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

  refreshHud(): void {
    const inv = gameState.inventory;
    const cost = BUILD_COSTS[this.selected];
    const modeLine =
      this.mode === 'off'
        ? 'B / Q — enter build mode · Walk north gate → cave'
        : this.mode === 'place'
          ? `PLACE: ${BUILD_LABELS[this.selected]} (${formatCost(cost)}) · click/E place · R remove · B exit`
          : 'REMOVE: click/E structure to refund materials · R back to place · B exit';

    this.hudText.setText(
      [
        'TOWN — absolute safe zone (no hostiles)',
        `HP ${gameState.player.hp}/${gameState.player.maxHp}`,
        `Inv: wood ${inv.wood}  stone ${inv.stone}  ore ${inv.ore}  scrap ${inv.scrap}  crystal ${inv.crystal ?? 0}`,
        modeLine,
      ].join('\n'),
    );
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
