import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { ensureBiomeAssetsLoaded } from '../systems/BiomeAssets';
import { decorateOverworld } from '../systems/BiomeDecorator';
import { LootDrops } from '../systems/LootDrops';
import { ensureMineralTexturesLoaded } from '../systems/Minerals';
import { GRID_SIZE, PlacementManager } from '../systems/PlacementManager';
import {
  cycleTool,
  getActiveTool,
  TOOL_LABELS,
  toolHelpLine,
  type ToolId,
} from '../systems/PlayerTools';
import { ensurePortalAssetsLoaded, placePortal } from '../systems/PortalAssets';
import { WildernessMetalSpawner } from '../systems/WildernessMetalSpawner';
import { ensureShapeTextures } from '../utils/textures';
import { isSafeGrid, SAFE_ZONE, WORLD_COLS, WORLD_ROWS } from '../world/Biomes';

const MAP_W = WORLD_COLS * GRID_SIZE;
const MAP_H = WORLD_ROWS * GRID_SIZE;
const SAFE = SAFE_ZONE;
const MINE_RANGE = 52;

export class TownScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private toolKey!: Phaser.Input.Keyboard.Key;
  private pickupKey!: Phaser.Input.Keyboard.Key;
  private placement!: PlacementManager;
  private loot!: LootDrops;
  private metals!: WildernessMetalSpawner;
  private hud!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private zoneLabel!: Phaser.GameObjects.Text;
  private tool: ToolId = getActiveTool();
  private transitioning = false;
  private facing = new Phaser.Math.Vector2(0, -1);
  private biomesReady = false;

  constructor() {
    super('TownScene');
  }

  create(): void {
    ensureShapeTextures(this);
    gameState.setLastScene('TownScene');
    gameState.heal(gameState.player.maxHp);
    this.transitioning = false;
    this.tool = getActiveTool();

    this.cameras.main.setBackgroundColor('#1a2e1a');
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);

    // Temporary solid floors until biome assets finish loading
    this.drawFallbackGround();

    const structures = this.add.group();
    this.placement = new PlacementManager(this, structures, {
      canBuildAt: (gx, gy) => isSafeGrid(gx, gy, SAFE),
    });
    this.loot = new LootDrops(this);

    const safeCx = ((SAFE.x0 + SAFE.x1) / 2) * GRID_SIZE;
    const safeCy = ((SAFE.y0 + SAFE.y1) / 2) * GRID_SIZE;
    this.loot.drop(safeCx - 48, safeCy + 80, 'wood', 2);
    this.loot.drop(safeCx + 56, safeCy + 64, 'stone', 1);

    const wildernessCells = this.collectWildernessCells();
    this.metals = new WildernessMetalSpawner(this, wildernessCells, GRID_SIZE);

    this.hud = this.add
      .text(12, 10, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        color: '#ecfccb',
        backgroundColor: '#052e16aa',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.help = this.add
      .text(12, this.scale.height - 52, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#d9f99d',
        backgroundColor: '#052e16cc',
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(101);

    this.zoneLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#fef9c3',
        backgroundColor: '#14532d99',
        padding: { x: 6, y: 2 },
      })
      .setScrollFactor(0)
      .setDepth(102)
      .setOrigin(1, 0);

    this.player = this.physics.add.sprite(safeCx, safeCy + 40, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    const gateX = safeCx;
    const gateY = SAFE.y0 * GRID_SIZE + GRID_SIZE * 0.6;
    // Placeholder until portal art loads; swapped in ensurePortalAssetsLoaded
    placePortal(this, gateX, gateY, 'entrance', () => this.enterCave(), this.player);

    this.add
      .text(safeCx, SAFE.y0 * GRID_SIZE + GRID_SIZE * 3.2, 'TOWN SAFE ZONE', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#bbf7d0',
        backgroundColor: '#14532d66',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(3);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard required');
    }

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as typeof this.wasd;
    this.toolKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.pickupKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown() || this.transitioning) {
        return;
      }
      this.onRightClick(pointer);
    });

    void Promise.all([
      ensureBiomeAssetsLoaded(this),
      ensureMineralTexturesLoaded(this),
      ensurePortalAssetsLoaded(this),
    ]).then(() => {
      if (!this.sys.isActive()) {
        return;
      }
      if (!this.biomesReady) {
        decorateOverworld(this, { safe: SAFE, seed: 0x51a7e });
        this.biomesReady = true;
      }
      this.metals.populate();
      // Refresh portal texture if it loaded after placeholder
      const portalKey = 'portal-cave-entrance';
      if (this.textures.exists(portalKey)) {
        this.children.list.forEach((obj) => {
          if (obj instanceof Phaser.GameObjects.Image && obj.texture.key === 'town-gate') {
            obj.setTexture(portalKey);
            const tex = obj.texture.getSourceImage() as HTMLImageElement;
            obj.setScale(72 / Math.max(1, tex.height));
            obj.setOrigin(0.5, 0.85);
          }
        });
      }
    });

    this.applyTool();
    this.refreshHud();
  }

  update(): void {
    if (this.transitioning) {
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.toolKey)) {
      this.tool = cycleTool();
      this.applyTool();
    }

    if (Phaser.Input.Keyboard.JustDown(this.pickupKey)) {
      this.loot.collectNear(this.player.x, this.player.y);
      this.refreshHud();
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.placement.update(worldPoint.x, worldPoint.y);

    this.metals.update(this.player, this.cameras.main);
    this.movePlayer();
    this.refreshHud();
  }

  private isInSafeZone(worldX: number, worldY: number): boolean {
    const gx = Math.floor(worldX / GRID_SIZE);
    const gy = Math.floor(worldY / GRID_SIZE);
    return isSafeGrid(gx, gy, SAFE);
  }

  private collectWildernessCells(): { gx: number; gy: number; x: number; y: number }[] {
    const cells: { gx: number; gy: number; x: number; y: number }[] = [];
    for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
      for (let gx = 0; gx < WORLD_COLS; gx += 1) {
        if (isSafeGrid(gx, gy, SAFE)) {
          continue;
        }
        cells.push({
          gx,
          gy,
          x: gx * GRID_SIZE + GRID_SIZE / 2,
          y: gy * GRID_SIZE + GRID_SIZE / 2,
        });
      }
    }
    return cells;
  }

  private applyTool(): void {
    this.placement.setActive(this.tool === 'building');
    this.refreshHud();
  }

  private onRightClick(pointer: Phaser.Input.Pointer): void {
    if (this.tool === 'building') {
      this.placement.contextAction();
      this.refreshHud();
      return;
    }

    if (this.tool === 'weapon') {
      if (this.isInSafeZone(this.player.x, this.player.y)) {
        this.floatHint('No hostiles in town safe zone');
      } else {
        this.floatHint('No hostiles here yet — wilderness metals only');
      }
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.metals.tryMineNear(world.x, world.y, this.player.x, this.player.y, MINE_RANGE)) {
      this.refreshHud();
      return;
    }

    if (this.isInSafeZone(this.player.x, this.player.y)) {
      this.floatHint('No metals in town — walk into the wilderness');
    } else {
      this.floatHint('No metal node in range');
    }
  }

  private movePlayer(): void {
    const speed = gameState.player.speed;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left?.isDown || this.wasd.A.isDown) {
      vx -= 1;
    }
    if (this.cursors.right?.isDown || this.wasd.D.isDown) {
      vx += 1;
    }
    if (this.cursors.up?.isDown || this.wasd.W.isDown) {
      vy -= 1;
    }
    if (this.cursors.down?.isDown || this.wasd.S.isDown) {
      vy += 1;
    }

    if (vx !== 0 && vy !== 0) {
      const inv = Math.SQRT1_2;
      vx *= inv;
      vy *= inv;
    }

    if (vx !== 0 || vy !== 0) {
      this.facing.set(vx, vy).normalize();
    }

    this.player.setVelocity(vx * speed, vy * speed);
  }

  private refreshHud(): void {
    const inv = gameState.inventory;
    const inSafe = this.isInSafeZone(this.player.x, this.player.y);
    const buildExtra =
      this.tool === 'building'
        ? ` · ${this.placement.selectedLabel} (${this.placement.selectedCost}) · LMB/R remove`
        : '';

    this.hud.setText(
      [
        inSafe
          ? 'TOWN SAFE ZONE — no hostiles · no wilderness metals'
          : 'WILDERNESS — gold / iron / silver (RMB mine)',
        `HP ${gameState.player.hp}/${gameState.player.maxHp}`,
        `Inv: wood ${inv.wood} stone ${inv.stone} ore ${inv.ore}  gems ${inv.diamond}d/${inv.emerald}e/${inv.sapphire}s  metals ${inv.gold}g/${inv.iron}i/${inv.silver}s`,
        `Active: ${TOOL_LABELS[this.tool]}${buildExtra}`,
      ].join('\n'),
    );

    this.help.setText(`${toolHelpLine(this.tool)}  ·  WASD move  ·  north gate → cave`);
    this.help.setPosition(12, this.scale.height - (this.tool === 'building' ? 140 : 52));

    this.zoneLabel
      .setText(inSafe ? 'SAFE' : 'WILD')
      .setPosition(this.scale.width - 12, 12)
      .setStyle({
        color: inSafe ? '#bbf7d0' : '#fde68a',
        backgroundColor: inSafe ? '#14532d99' : '#42200699',
      });
  }

  private floatHint(msg: string): void {
    const t = this.add
      .text(this.player.x, this.player.y - 28, msg, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#fef9c3',
        backgroundColor: '#14532dcc',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: t.y - 16,
      duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  private enterCave(): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    gameState.saveNow();
    this.scene.start('CaveScene');
  }

  private drawFallbackGround(): void {
    for (let gy = 0; gy < WORLD_ROWS; gy += 1) {
      for (let gx = 0; gx < WORLD_COLS; gx += 1) {
        const cx = gx * GRID_SIZE + GRID_SIZE / 2;
        const cy = gy * GRID_SIZE + GRID_SIZE / 2;
        this.add.image(cx, cy, 'tile-grass').setDepth(0).setAlpha(0.9);
      }
    }
  }
}
