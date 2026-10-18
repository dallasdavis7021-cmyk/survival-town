import Phaser from 'phaser';
import { CAVE_COLS, CAVE_ROWS, CAVE_TILE, type ParsedCaveMap } from '../maps/caveLayout';
import { gameState, type InventoryItemId } from '../state/GameState';
import { GRID_SIZE } from '../systems/PlacementManager';
import { CAVE_ENTRANCE_GRID, SAFE_ZONE, WORLD_COLS, WORLD_ROWS } from '../world/Biomes';

export type UiPanel = 'map' | 'inventory' | 'settings' | null;
export type UiArea = 'town' | 'cave';

export interface GameUiContext {
  area: UiArea;
  getPlayerWorld: () => { x: number; y: number };
  /** Cave only — required when area === 'cave'. */
  caveMap?: ParsedCaveMap;
}

const INV_ORDER: InventoryItemId[] = [
  'wood',
  'stone',
  'ore',
  'scrap',
  'crystal',
  'diamond',
  'emerald',
  'sapphire',
  'gold',
  'iron',
  'silver',
];

const CONTROLS_LINES = [
  'WASD / arrows — move',
  'Q — cycle tool (Mining → Weapon → Building)',
  'E — pick up nearby loot',
  'RMB — use active tool (mine / attack / place)',
  'LMB or R — remove structure (build mode)',
  'O — map',
  'P — inventory',
  'Tab — settings',
  'Esc — close panel',
];

/**
 * Shared O / P / Tab overlays. Soft-pauses gameplay while a panel is open.
 * Tab is captured so the browser doesn't cycle focus out of the canvas.
 */
export class GameUi {
  private scene: Phaser.Scene;
  private ctx: GameUiContext;
  private root!: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private panelBg!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private mapGfx!: Phaser.GameObjects.Graphics;
  private playerBlip!: Phaser.GameObjects.Arc;
  private hint!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private settingsButtons: Phaser.GameObjects.Text[] = [];
  private active: UiPanel = null;
  constructor(scene: Phaser.Scene, ctx: GameUiContext) {
    this.scene = scene;
    this.ctx = ctx;
    this.build();
    this.bindKeys();
  }

  get isOpen(): boolean {
    return this.active !== null;
  }

  /** Call from scene update — map / inventory live refresh while open. */
  update(): void {
    if (this.active === 'map') {
      this.drawMap();
    }
    if (this.active === 'inventory') {
      this.refreshInventoryBody();
    }
  }

  /** Reveal cave FoW around the player (call from CaveScene each frame). */
  revealCaveFog(): void {
    if (this.ctx.area !== 'cave' || !this.ctx.caveMap) {
      return;
    }
    const { x, y } = this.ctx.getPlayerWorld();
    const tx = Math.floor(x / CAVE_TILE);
    const ty = Math.floor(y / CAVE_TILE);
    gameState.revealCaveAround(tx, ty, 4);
  }

  destroy(): void {
    this.root.destroy(true);
    this.hint.destroy();
    this.toast.destroy();
  }

  private build(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    this.hint = this.scene.add
      .text(w - 12, h - 14, 'O map · P inv · Tab settings', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#a3e635',
        backgroundColor: '#052e1688',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(120);

    this.toast = this.scene.add
      .text(w / 2, 48, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        color: '#ecfccb',
        backgroundColor: '#14532dcc',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(130)
      .setAlpha(0);

    this.root = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(125).setVisible(false);

    this.dim = this.scene.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.55)
      .setInteractive();
    this.dim.on('pointerdown', () => {
      /* swallow clicks while modal open */
    });

    const { pw, ph } = this.panelSize();
    this.panelBg = this.scene.add
      .rectangle(w / 2, h / 2, pw, ph, 0x0f1f14, 0.96)
      .setStrokeStyle(2, 0x4ade80, 0.7);

    this.title = this.scene.add
      .text(w / 2, h / 2 - ph / 2 + 22, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '16px',
        color: '#ecfccb',
      })
      .setOrigin(0.5, 0.5);

    this.body = this.scene.add
      .text(w / 2 - pw / 2 + 20, h / 2 - ph / 2 + 48, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        color: '#d9f99d',
        lineSpacing: 4,
        wordWrap: { width: pw - 40 },
      })
      .setOrigin(0, 0);

    this.mapGfx = this.scene.add.graphics();
    this.playerBlip = this.scene.add.circle(0, 0, 4, 0x4ade80).setVisible(false);

    this.root.add([this.dim, this.panelBg, this.title, this.body, this.mapGfx, this.playerBlip]);
  }

  private bindKeys(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) {
      throw new Error('Keyboard required for GameUi');
    }
    // Keep Tab/Esc from leaving the game canvas / bubbling oddly
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.TAB,
      Phaser.Input.Keyboard.KeyCodes.ESC,
      Phaser.Input.Keyboard.KeyCodes.O,
      Phaser.Input.Keyboard.KeyCodes.P,
    ]);

    // Event-based toggles (more reliable than JustDown for O/P/Tab)
    kb.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      const k = event.key;
      if (k === 'o' || k === 'O') {
        event.preventDefault();
        this.toggle('map');
        return;
      }
      if (k === 'p' || k === 'P') {
        event.preventDefault();
        this.toggle('inventory');
        return;
      }
      if (k === 'Tab') {
        event.preventDefault();
        this.toggle('settings');
        return;
      }
      if (k === 'Escape') {
        event.preventDefault();
        if (this.active) {
          this.close();
        }
      }
    });
  }

  private toggle(panel: Exclude<UiPanel, null>): void {
    if (this.active === panel) {
      this.close();
      return;
    }
    this.open(panel);
  }

  private open(panel: Exclude<UiPanel, null>): void {
    this.clearSettingsButtons();
    this.active = panel;
    this.root.setVisible(true);
    this.mapGfx.clear().setVisible(false);
    this.playerBlip.setVisible(false);
    this.body.setVisible(true);
    this.layoutPanel(panel);

    if (panel === 'map') {
      this.title.setText(this.ctx.area === 'cave' ? 'MAP — Cave (fog of war)' : 'MAP — Overworld');
      this.body.setText('').setVisible(false);
      this.mapGfx.setVisible(true);
      this.playerBlip.setVisible(true);
      this.drawMap();
    } else if (panel === 'inventory') {
      this.title.setText('INVENTORY');
      this.refreshInventoryBody();
    } else {
      this.title.setText('SETTINGS');
      this.showSettingsMenu();
    }
  }

  /** Near-fullscreen map for overworld; larger cave map; compact for inventory/settings. */
  private panelSize(forMap = false): { pw: number; ph: number } {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const mapOpen = forMap || this.active === 'map';
    if (mapOpen && this.ctx.area === 'town') {
      return { pw: Math.min(w - 16, w * 0.96), ph: Math.min(h - 16, h * 0.94) };
    }
    if (mapOpen && this.ctx.area === 'cave') {
      return { pw: Math.min(w - 24, 720), ph: Math.min(h - 24, 560) };
    }
    return { pw: Math.min(560, w - 48), ph: Math.min(420, h - 48) };
  }

  private layoutPanel(panel: UiPanel): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const { pw, ph } = this.panelSize(panel === 'map');
    this.panelBg.setPosition(w / 2, h / 2).setSize(pw, ph);
    this.title.setPosition(w / 2, h / 2 - ph / 2 + 22);
    this.body.setPosition(w / 2 - pw / 2 + 20, h / 2 - ph / 2 + 48);
    this.body.setStyle({ wordWrap: { width: pw - 40 } });
  }

  private close(): void {
    this.active = null;
    this.clearSettingsButtons();
    this.root.setVisible(false);
    this.mapGfx.clear();
    this.playerBlip.setVisible(false);
  }

  private refreshInventoryBody(): void {
    const inv = gameState.inventory;
    const lines = INV_ORDER.map((id) => `${id.padEnd(10)} ${inv[id] ?? 0}`);
    this.body.setText(lines.join('\n'));
  }

  private showSettingsMenu(): void {
    this.body.setText('Choose an option:').setVisible(true);
    this.clearSettingsButtons();

    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const { ph } = this.panelSize(false);
    const baseY = h / 2 - ph / 2 + 90;

    const mk = (label: string, y: number, onClick: () => void) => {
      const t = this.scene.add
        .text(w / 2, y, label, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '14px',
          color: '#052e16',
          backgroundColor: '#86efac',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(126)
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setStyle({ backgroundColor: '#bbf7d0' }));
      t.on('pointerout', () => t.setStyle({ backgroundColor: '#86efac' }));
      t.on('pointerdown', onClick);
      this.root.add(t);
      this.settingsButtons.push(t);
    };

    mk('[ Save gameplay ]', baseY, () => {
      gameState.saveNow();
      this.showToast('Game saved to this browser');
    });
    mk('[ Controls ]', baseY + 48, () => {
      this.clearSettingsButtons();
      this.body.setText(CONTROLS_LINES.join('\n')).setVisible(true);
      const back = this.scene.add
        .text(w / 2, h / 2 + ph / 2 - 36, '[ Back ]', {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#052e16',
          backgroundColor: '#86efac',
          padding: { x: 12, y: 6 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(126)
        .setInteractive({ useHandCursor: true });
      back.on('pointerdown', () => {
        this.clearSettingsButtons();
        this.showSettingsMenu();
      });
      this.root.add(back);
      this.settingsButtons.push(back);
    });
  }

  private clearSettingsButtons(): void {
    for (const b of this.settingsButtons) {
      b.destroy();
    }
    this.settingsButtons = [];
  }

  private showToast(msg: string): void {
    this.toast.setText(msg);
    this.scene.tweens.killTweensOf(this.toast);
    this.toast.setAlpha(1);
    this.scene.tweens.add({
      targets: this.toast,
      alpha: 0,
      delay: 1200,
      duration: 500,
    });
  }

  private drawMap(): void {
    this.mapGfx.clear();
    if (this.ctx.area === 'cave') {
      this.drawCaveMap();
    } else {
      this.drawOverworldMap();
    }
  }

  private mapFrame(): { ox: number; oy: number; cell: number; cols: number; rows: number } {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const { pw, ph } = this.panelSize(true);
    const cols = this.ctx.area === 'cave' ? CAVE_COLS : WORLD_COLS;
    const rows = this.ctx.area === 'cave' ? CAVE_ROWS : WORLD_ROWS;
    const padX = 20;
    const padTop = 48;
    const padBot = 20;
    const availW = pw - padX * 2;
    const availH = ph - padTop - padBot;
    // Prefer filling the panel — world grid scales up for readable village map
    const cell = Math.min(availW / cols, availH / rows);
    const mapW = cell * cols;
    const mapH = cell * rows;
    const ox = w / 2 - mapW / 2;
    const oy = h / 2 - ph / 2 + padTop + (availH - mapH) / 2;
    return { ox, oy, cell, cols, rows };
  }

  private drawOverworldMap(): void {
    const { ox, oy, cell } = this.mapFrame();
    const safe = SAFE_ZONE;

    for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
      for (let gx = 0; gx < WORLD_COLS; gx += 1) {
        const inSafe =
          gx >= safe.x0 && gx <= safe.x1 && gy >= safe.y0 && gy <= safe.y1;
        const color = inSafe ? 0x4d7c0f : 0x3f6212;
        this.mapGfx.fillStyle(color, 1);
        this.mapGfx.fillRect(ox + gx * cell, oy + gy * cell, cell + 0.5, cell + 0.5);
      }
    }

    // Safe outline
    this.mapGfx.lineStyle(Math.max(1, cell * 0.4), 0x86efac, 0.9);
    this.mapGfx.strokeRect(
      ox + safe.x0 * cell,
      oy + safe.y0 * cell,
      (safe.x1 - safe.x0 + 1) * cell,
      (safe.y1 - safe.y0 + 1) * cell,
    );

    // Cave portal (wilderness — not on safe border)
    const portalGx = CAVE_ENTRANCE_GRID.gx;
    const portalGy = CAVE_ENTRANCE_GRID.gy;
    this.mapGfx.fillStyle(0x1e293b, 1);
    this.mapGfx.fillRect(
      ox + portalGx * cell - cell * 0.4,
      oy + portalGy * cell - cell * 0.2,
      cell * 1.8,
      cell * 1.2,
    );
    this.mapGfx.fillStyle(0x38bdf8, 1);
    this.mapGfx.fillCircle(
      ox + portalGx * cell + cell * 0.5,
      oy + portalGy * cell + cell * 0.4,
      cell * 0.45,
    );

    // Structures
    for (const s of gameState.structures) {
      this.mapGfx.fillStyle(0xd97706, 1);
      this.mapGfx.fillRect(
        ox + s.gridX * cell + cell * 0.15,
        oy + s.gridY * cell + cell * 0.15,
        cell * 0.7,
        cell * 0.7,
      );
    }

    const { x, y } = this.ctx.getPlayerWorld();
    const pgx = x / GRID_SIZE;
    const pgy = y / GRID_SIZE;
    this.playerBlip
      .setPosition(ox + pgx * cell, oy + pgy * cell)
      .setRadius(Math.max(3, cell * 0.55))
      .setFillStyle(0xfef08a)
      .setVisible(true);
  }

  private drawCaveMap(): void {
    const map = this.ctx.caveMap;
    if (!map) {
      return;
    }
    const { ox, oy, cell } = this.mapFrame();

    for (let ty = 0; ty < CAVE_ROWS; ty += 1) {
      for (let tx = 0; tx < CAVE_COLS; tx += 1) {
        const walk = map.walkable[ty]?.[tx];
        const explored = gameState.isCaveTileExplored(tx, ty);
        let color: number;
        if (!walk) {
          // Non-walkable rock — always somewhat visible once near, else deep void
          color = explored ? 0x3a0c0c : 0x120404;
        } else if (!explored) {
          // Unexplored playable = dark grey fog
          color = 0x2a2a2a;
        } else {
          color = 0x1a1a1a; // explored floor
        }
        this.mapGfx.fillStyle(color, 1);
        this.mapGfx.fillRect(ox + tx * cell, oy + ty * cell, cell + 0.5, cell + 0.5);
      }
    }

    // Exit / spawn markers if explored
    if (gameState.isCaveTileExplored(map.exit.tx, map.exit.ty)) {
      this.mapGfx.fillStyle(0xf87171, 1);
      this.mapGfx.fillCircle(
        ox + map.exit.tx * cell + cell / 2,
        oy + map.exit.ty * cell + cell / 2,
        Math.max(2, cell * 0.45),
      );
    }
    if (gameState.isCaveTileExplored(map.spawn.tx, map.spawn.ty)) {
      this.mapGfx.fillStyle(0x38bdf8, 1);
      this.mapGfx.fillCircle(
        ox + map.spawn.tx * cell + cell / 2,
        oy + map.spawn.ty * cell + cell / 2,
        Math.max(2, cell * 0.4),
      );
    }

    const { x, y } = this.ctx.getPlayerWorld();
    const ptx = x / CAVE_TILE;
    const pty = y / CAVE_TILE;
    this.playerBlip
      .setPosition(ox + ptx * cell, oy + pty * cell)
      .setRadius(Math.max(3, cell * 0.6))
      .setFillStyle(0xfef08a)
      .setVisible(true);
  }
}
