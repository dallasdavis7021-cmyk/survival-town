import Phaser from 'phaser';
import { gameState, type InventoryItemId } from '../state/GameState';
import { CombatSystem } from '../systems/CombatSystem';
import { GRID_SIZE } from '../systems/PlacementManager';
import { ensureShapeTextures } from '../utils/textures';

const MAP_W = 40 * GRID_SIZE;
const MAP_H = 30 * GRID_SIZE;

export class CaveScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private mineKey!: Phaser.Input.Keyboard.Key;
  private combat!: CombatSystem;
  private hostiles!: Phaser.Physics.Arcade.Group;
  private oreNodes!: Phaser.Physics.Arcade.StaticGroup;
  private hud!: Phaser.GameObjects.Text;
  private fogRt!: Phaser.GameObjects.RenderTexture;
  private readonly lightRadius = 150;
  private transitioning = false;

  constructor() {
    super('CaveScene');
  }

  create(): void {
    ensureShapeTextures(this);
    this.ensureLightMask();
    gameState.setLastScene('CaveScene');
    this.transitioning = false;

    this.cameras.main.setBackgroundColor('#020617');
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);

    this.drawCaveFloor();

    this.player = this.physics.add.sprite(MAP_W / 2, MAP_H - 64, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.hostiles = this.physics.add.group();
    this.oreNodes = this.physics.add.staticGroup();

    this.combat = new CombatSystem(this, this.player, this.hostiles, {
      onHostileKilled: (_hostile, x, y) => {
        gameState.addItem('scrap', 1);
        if (Math.random() < 0.35) {
          gameState.addItem('ore', 1);
        }
        this.floatText(x, y - 12, '+loot', '#fef08a');
        this.refreshHud();
      },
      onPlayerHurt: () => this.refreshHud(),
    });

    this.spawnContent();

    const exit = this.add.image(MAP_W / 2, MAP_H - 24, 'cave-exit').setDepth(6);
    this.physics.add.existing(exit, true);
    this.physics.add.overlap(this.player, exit, () => this.returnToTown());

    this.add
      .text(MAP_W / 2, MAP_H - 48, 'RETURN TO TOWN', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#bbf7d0',
      })
      .setOrigin(0.5)
      .setDepth(7);

    const cam = this.cameras.main;
    this.fogRt = this.add
      .renderTexture(0, 0, cam.width, cam.height)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(50);

    this.hud = this.add
      .text(12, 10, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard required');
    }

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as typeof this.wasd;
    this.mineKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.fogRt.setSize(gameSize.width, gameSize.height);
    });

    this.refreshHud();
  }

  update(time: number): void {
    if (this.transitioning) {
      return;
    }

    if (gameState.player.hp <= 0) {
      this.onPlayerDown();
      return;
    }

    this.movePlayer();
    this.combat.update(time);
    this.tryMine();
    this.drawFog();
    this.refreshHud();
  }

  private ensureLightMask(): void {
    if (this.textures.exists('light-mask')) {
      return;
    }

    const size = this.lightRadius * 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // Soft radial: opaque center → transparent edge for erase falloff
    for (let i = 8; i >= 1; i -= 1) {
      const t = i / 8;
      g.fillStyle(0xffffff, t);
      g.fillCircle(size / 2, size / 2, this.lightRadius * t);
    }
    g.generateTexture('light-mask', size, size);
    g.destroy();
  }

  private spawnContent(): void {
    const hostileSpawns = [
      { x: 8 * GRID_SIZE, y: 8 * GRID_SIZE },
      { x: 28 * GRID_SIZE, y: 10 * GRID_SIZE },
      { x: 18 * GRID_SIZE, y: 16 * GRID_SIZE },
      { x: 12 * GRID_SIZE, y: 22 * GRID_SIZE },
      { x: 30 * GRID_SIZE, y: 20 * GRID_SIZE },
    ];

    for (const pos of hostileSpawns) {
      this.combat.spawnHostile(pos.x, pos.y);
    }

    const oreSpawns = [
      { x: 6 * GRID_SIZE, y: 12 * GRID_SIZE },
      { x: 22 * GRID_SIZE, y: 8 * GRID_SIZE },
      { x: 34 * GRID_SIZE, y: 14 * GRID_SIZE },
      { x: 16 * GRID_SIZE, y: 24 * GRID_SIZE },
      { x: 26 * GRID_SIZE, y: 26 * GRID_SIZE },
      { x: 10 * GRID_SIZE, y: 18 * GRID_SIZE },
    ];

    for (const pos of oreSpawns) {
      const node = this.oreNodes.create(pos.x, pos.y, 'ore-node') as Phaser.Physics.Arcade.Sprite;
      node.setData('hp', 3);
      node.refreshBody();
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

    this.player.setVelocity(vx * speed, vy * speed);
  }

  private tryMine(): void {
    if (!Phaser.Input.Keyboard.JustDown(this.mineKey)) {
      return;
    }

    const nodes = this.oreNodes.getChildren() as Phaser.Physics.Arcade.Sprite[];
    const node = nodes.find(
      (n) => n.active && Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y) < 40,
    );

    if (!node) {
      return;
    }

    const hp = (node.getData('hp') as number) - 1;
    node.setData('hp', hp);
    node.setTintFill(0xffffff);
    this.time.delayedCall(50, () => {
      if (node.active) {
        node.clearTint();
      }
    });

    if (hp <= 0) {
      const drops: InventoryItemId[] = ['stone', 'ore', 'ore'];
      const drop = drops[Math.floor(Math.random() * drops.length)];
      gameState.addItem(drop, 1 + Math.floor(Math.random() * 2));
      this.floatText(node.x, node.y - 14, `+${drop}`, '#93c5fd');
      node.destroy();
      this.refreshHud();
    }
  }

  private drawFog(): void {
    const cam = this.cameras.main;
    const localX = this.player.x - cam.scrollX;
    const localY = this.player.y - cam.scrollY;

    if (this.fogRt.width !== cam.width || this.fogRt.height !== cam.height) {
      this.fogRt.setSize(cam.width, cam.height);
    }

    this.fogRt.clear();
    this.fogRt.fill(0x020617, 0.92);
    this.fogRt.erase('light-mask', localX - this.lightRadius, localY - this.lightRadius);
  }

  private refreshHud(): void {
    const inv = gameState.inventory;
    this.hud.setText(
      [
        `CAVE — hostiles & mining`,
        `HP ${gameState.player.hp}/${gameState.player.maxHp}`,
        `Inv: wood ${inv.wood} | stone ${inv.stone} | ore ${inv.ore} | scrap ${inv.scrap}`,
        `WASD move · SPACE melee · E mine · south exit → town`,
      ].join('\n'),
    );
  }

  private floatText(x: number, y: number, label: string, color: string): void {
    const t = this.add
      .text(x, y, label, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color,
      })
      .setOrigin(0.5)
      .setDepth(40);

    this.tweens.add({
      targets: t,
      y: y - 28,
      alpha: 0,
      duration: 700,
      onComplete: () => t.destroy(),
    });
  }

  private returnToTown(): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    gameState.saveNow();
    this.scene.start('TownScene');
  }

  private onPlayerDown(): void {
    this.transitioning = true;
    gameState.heal(Math.floor(gameState.player.maxHp * 0.5));
    gameState.saveNow();
    this.floatText(this.player.x, this.player.y, 'Knocked out — returning…', '#fca5a5');
    this.time.delayedCall(700, () => this.scene.start('TownScene'));
  }

  private drawCaveFloor(): void {
    for (let y = 0; y < MAP_H; y += GRID_SIZE) {
      for (let x = 0; x < MAP_W; x += GRID_SIZE) {
        const alt = (x / GRID_SIZE + y / GRID_SIZE) % 2 === 0;
        this.add
          .image(x + GRID_SIZE / 2, y + GRID_SIZE / 2, alt ? 'tile-cave' : 'tile-cave-alt')
          .setDepth(0);
      }
    }
  }
}
