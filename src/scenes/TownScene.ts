import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { LootDrops } from '../systems/LootDrops';
import { GRID_SIZE, PlacementManager } from '../systems/PlacementManager';
import {
  cycleTool,
  getActiveTool,
  TOOL_LABELS,
  toolHelpLine,
  type ToolId,
} from '../systems/PlayerTools';
import { ensureShapeTextures } from '../utils/textures';

const MAP_W = 32 * GRID_SIZE;
const MAP_H = 24 * GRID_SIZE;

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
  private hud!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private tool: ToolId = getActiveTool();
  private transitioning = false;
  private facing = new Phaser.Math.Vector2(0, -1);

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

    this.drawGround();

    const structures = this.add.group();
    this.placement = new PlacementManager(this, structures);
    this.loot = new LootDrops(this);

    // A couple of starter ground scraps so E pickup is demonstrable in town
    this.loot.drop(MAP_W / 2 - 48, MAP_H / 2 + 80, 'wood', 2);
    this.loot.drop(MAP_W / 2 + 56, MAP_H / 2 + 64, 'stone', 1);

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

    const spawnX = MAP_W / 2;
    const spawnY = MAP_H / 2 + 40;
    this.player = this.physics.add.sprite(spawnX, spawnY, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    const gate = this.add.image(MAP_W / 2, 28, 'town-gate').setDepth(6);
    this.physics.add.existing(gate, true);
    this.physics.add.overlap(this.player, gate, () => this.enterCave());

    this.add
      .text(MAP_W / 2, 52, 'CAVE ENTRANCE', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#bae6fd',
      })
      .setOrigin(0.5)
      .setDepth(7);

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
      this.onRightClick();
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

    this.movePlayer();
    this.refreshHud();
  }

  private applyTool(): void {
    this.placement.setActive(this.tool === 'building');
    this.refreshHud();
  }

  private onRightClick(): void {
    if (this.tool === 'building') {
      this.placement.contextAction();
      this.refreshHud();
      return;
    }

    if (this.tool === 'weapon') {
      this.floatHint('No hostiles in town (safe zone)');
      return;
    }

    // Mining in town — nothing to mine
    this.floatHint('Nothing to mine here — enter the cave');
  }

  private movePlayer(): void {
    // Allow walking while building so players can reposition; ghost still follows cursor
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
    const buildExtra =
      this.tool === 'building'
        ? ` · ${this.placement.selectedLabel} (${this.placement.selectedCost}) · LMB/R remove`
        : '';

    this.hud.setText(
      [
        'TOWN — absolute safe zone (no hostiles)',
        `HP ${gameState.player.hp}/${gameState.player.maxHp}`,
        `Inv: wood ${inv.wood}  stone ${inv.stone}  ore ${inv.ore}  scrap ${inv.scrap}  crystal ${inv.crystal ?? 0}`,
        `Active: ${TOOL_LABELS[this.tool]}${buildExtra}`,
      ].join('\n'),
    );

    this.help.setText(
      `${toolHelpLine(this.tool)}  ·  WASD move  ·  north gate → cave`,
    );
    this.help.setPosition(12, this.scale.height - (this.tool === 'building' ? 140 : 52));
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

  private drawGround(): void {
    for (let y = 0; y < MAP_H; y += GRID_SIZE) {
      for (let x = 0; x < MAP_W; x += GRID_SIZE) {
        const path =
          Math.abs(x + GRID_SIZE / 2 - MAP_W / 2) < GRID_SIZE * 1.5 ||
          Math.abs(y + GRID_SIZE / 2 - MAP_H / 2) < GRID_SIZE;
        this.add
          .image(x + GRID_SIZE / 2, y + GRID_SIZE / 2, path ? 'tile-path' : 'tile-grass')
          .setDepth(0)
          .setAlpha(path ? 0.95 : 0.85);
      }
    }

    const glow = this.add.graphics().setDepth(1);
    glow.fillStyle(0x86efac, 0.08);
    glow.fillCircle(MAP_W / 2, MAP_H / 2, 220);
  }
}
