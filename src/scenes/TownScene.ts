import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { GRID_SIZE, PlacementManager } from '../systems/PlacementManager';
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
  private buildKey!: Phaser.Input.Keyboard.Key;
  private placement!: PlacementManager;
  private hud!: Phaser.GameObjects.Text;
  private transitioning = false;

  constructor() {
    super('TownScene');
  }

  create(): void {
    ensureShapeTextures(this);
    gameState.setLastScene('TownScene');
    gameState.heal(gameState.player.maxHp);
    this.transitioning = false;

    this.cameras.main.setBackgroundColor('#1a2e1a');
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);

    this.drawGround();

    const structures = this.add.group();
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

    this.placement = new PlacementManager(this, structures, this.hud, () => {
      this.placement.refreshHud();
    });

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
    this.buildKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);

    this.placement.refreshHud();
  }

  update(): void {
    if (this.transitioning) {
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.buildKey)) {
      this.placement.toggleMode();
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.placement.update(worldPoint.x, worldPoint.y);

    if (this.placement.isBuildMode) {
      this.player.setVelocity(0, 0);
      return;
    }

    this.movePlayer();
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

    this.player.setVelocity(vx * speed, vy * speed);
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

    // Soft town glow atmosphere
    const glow = this.add.graphics().setDepth(1);
    glow.fillStyle(0x86efac, 0.08);
    glow.fillCircle(MAP_W / 2, MAP_H / 2, 220);
  }
}
