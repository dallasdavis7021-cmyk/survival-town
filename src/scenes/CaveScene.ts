import Phaser from 'phaser';
import { gameState, type InventoryItemId } from '../state/GameState';
import { CombatSystem, type HostileSprite } from '../systems/CombatSystem';
import { GRID_SIZE } from '../systems/PlacementManager';
import { ensureShapeTextures } from '../utils/textures';

/** North = deep, south = exit / shallow. */
const MAP_W = 42 * GRID_SIZE;
const MAP_H = 48 * GRID_SIZE;

type CaveTier = 1 | 2 | 3;

interface OreNodeData {
  hp: number;
  maxHp: number;
  tier: CaveTier;
  kind: 'ore-node' | 'ore-rich' | 'ore-rare';
}

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
  private lightMaskKey = 'light-mask-mid';
  private lightRadius = 140;
  private currentTier: CaveTier = 1;
  private transitioning = false;
  private runLoot: Partial<Record<InventoryItemId, number>> = {};

  constructor() {
    super('CaveScene');
  }

  create(): void {
    ensureShapeTextures(this);
    this.ensureLightMasks();
    gameState.setLastScene('CaveScene');
    this.transitioning = false;
    this.runLoot = {};

    this.cameras.main.setBackgroundColor('#020617');
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);

    this.drawCaveFloor();
    this.drawExitPath();

    // Spawn near southern exit (shallow tier)
    this.player = this.physics.add.sprite(MAP_W / 2, MAP_H - 72, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.hostiles = this.physics.add.group();
    this.oreNodes = this.physics.add.staticGroup();

    this.combat = new CombatSystem(this, this.player, this.hostiles, {
      onHostileKilled: (hostile, x, y) => this.onHostileKilled(hostile, x, y),
      onPlayerHurt: () => this.refreshHud(),
    });

    this.spawnTierContent();

    const exit = this.add.image(MAP_W / 2, MAP_H - 24, 'cave-exit').setDepth(6);
    this.physics.add.existing(exit, true);
    this.physics.add.overlap(this.player, exit, () => this.returnToTown());

    this.add
      .text(MAP_W / 2, MAP_H - 52, 'RETURN TO TOWN — loot is saved', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#bbf7d0',
        backgroundColor: '#14532d99',
        padding: { x: 6, y: 3 },
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

  update(time: number, delta: number): void {
    if (this.transitioning) {
      return;
    }

    if (gameState.player.hp <= 0) {
      this.onPlayerDown();
      return;
    }

    this.updateTierFromPosition();
    this.movePlayer();
    this.combat.update(time, delta);
    this.tryMine();
    this.drawFog();
    this.refreshHud();
  }

  private tierAtY(y: number): CaveTier {
    const t = y / MAP_H;
    if (t < 0.34) {
      return 3; // deep north
    }
    if (t < 0.62) {
      return 2; // mid
    }
    return 1; // shallow south near exit
  }

  private updateTierFromPosition(): void {
    const next = this.tierAtY(this.player.y);
    if (next === this.currentTier) {
      return;
    }
    this.currentTier = next;
    if (next === 1) {
      this.lightRadius = 168;
      this.lightMaskKey = 'light-mask-wide';
    } else if (next === 2) {
      this.lightRadius = 128;
      this.lightMaskKey = 'light-mask-mid';
    } else {
      this.lightRadius = 92;
      this.lightMaskKey = 'light-mask-tight';
    }
  }

  private ensureLightMasks(): void {
    const make = (key: string, radius: number) => {
      if (this.textures.exists(key)) {
        return;
      }
      const size = radius * 2;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 10; i >= 1; i -= 1) {
        const t = i / 10;
        g.fillStyle(0xffffff, t * t);
        g.fillCircle(size / 2, size / 2, radius * (0.35 + t * 0.65));
      }
      g.generateTexture(key, size, size);
      g.destroy();
    };

    make('light-mask-wide', 168);
    make('light-mask-mid', 128);
    make('light-mask-tight', 92);
  }

  private spawnTierContent(): void {
    // Shallow (tier 1) — near exit, weaker foes, basic ore
    const shallowHostiles = [
      { x: 10 * GRID_SIZE, y: 38 * GRID_SIZE },
      { x: 30 * GRID_SIZE, y: 40 * GRID_SIZE },
      { x: 20 * GRID_SIZE, y: 34 * GRID_SIZE },
    ];
    for (const p of shallowHostiles) {
      this.combat.spawnHostile(p.x, p.y, {
        tier: 1,
        hp: 28,
        damage: 7,
        speed: 85,
        aggroRange: 150,
      });
    }
    this.spawnOre(8 * GRID_SIZE, 36 * GRID_SIZE, 1, 'ore-node');
    this.spawnOre(28 * GRID_SIZE, 37 * GRID_SIZE, 1, 'ore-node');
    this.spawnOre(16 * GRID_SIZE, 42 * GRID_SIZE, 1, 'ore-node');

    // Mid (tier 2)
    const midHostiles = [
      { x: 8 * GRID_SIZE, y: 24 * GRID_SIZE },
      { x: 32 * GRID_SIZE, y: 26 * GRID_SIZE },
      { x: 18 * GRID_SIZE, y: 22 * GRID_SIZE },
      { x: 26 * GRID_SIZE, y: 30 * GRID_SIZE },
    ];
    for (const p of midHostiles) {
      this.combat.spawnHostile(p.x, p.y, {
        tier: 2,
        hp: 42,
        damage: 11,
        speed: 100,
        aggroRange: 190,
        knockback: 360,
      });
    }
    this.spawnOre(12 * GRID_SIZE, 28 * GRID_SIZE, 2, 'ore-rich');
    this.spawnOre(30 * GRID_SIZE, 23 * GRID_SIZE, 2, 'ore-rich');
    this.spawnOre(20 * GRID_SIZE, 26 * GRID_SIZE, 2, 'ore-node');
    this.spawnOre(6 * GRID_SIZE, 20 * GRID_SIZE, 2, 'ore-rich');

    // Deep (tier 3) — elites + rare ore, darkest
    const deepHostiles = [
      { x: 10 * GRID_SIZE, y: 8 * GRID_SIZE },
      { x: 30 * GRID_SIZE, y: 10 * GRID_SIZE },
      { x: 20 * GRID_SIZE, y: 6 * GRID_SIZE },
      { x: 14 * GRID_SIZE, y: 14 * GRID_SIZE },
      { x: 28 * GRID_SIZE, y: 16 * GRID_SIZE },
    ];
    for (const p of deepHostiles) {
      this.combat.spawnHostile(p.x, p.y, {
        tier: 3,
        hp: 65,
        damage: 15,
        speed: 115,
        aggroRange: 220,
        attackRange: 38,
        knockback: 400,
        attackCooldownMs: 650,
      });
    }
    this.spawnOre(8 * GRID_SIZE, 10 * GRID_SIZE, 3, 'ore-rare');
    this.spawnOre(32 * GRID_SIZE, 8 * GRID_SIZE, 3, 'ore-rare');
    this.spawnOre(22 * GRID_SIZE, 12 * GRID_SIZE, 3, 'ore-rich');
    this.spawnOre(16 * GRID_SIZE, 4 * GRID_SIZE, 3, 'ore-rare');

    // Tier banners (world space)
    this.addTierBanner(MAP_W / 2, MAP_H * 0.78, 'TIER 1 — SHALLOW', '#86efac');
    this.addTierBanner(MAP_W / 2, MAP_H * 0.48, 'TIER 2 — DEPTHS', '#fde68a');
    this.addTierBanner(MAP_W / 2, MAP_H * 0.16, 'TIER 3 — ABYSS', '#fca5a5');
  }

  private addTierBanner(x: number, y: number, label: string, color: string): void {
    this.add
      .text(x, y, label, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color,
        backgroundColor: '#020617aa',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(4);
  }

  private spawnOre(
    x: number,
    y: number,
    tier: CaveTier,
    kind: OreNodeData['kind'],
  ): void {
    const hp = kind === 'ore-rare' ? 5 : kind === 'ore-rich' ? 4 : 3;
    const node = this.oreNodes.create(x, y, kind) as Phaser.Physics.Arcade.Sprite;
    const data: OreNodeData = { hp, maxHp: hp, tier, kind };
    node.setData('ore', data);
    node.refreshBody();
  }

  private onHostileKilled(hostile: HostileSprite, x: number, y: number): void {
    const tier = hostile.config.tier;
    const drops: { id: InventoryItemId; n: number }[] = [{ id: 'scrap', n: tier }];
    if (Math.random() < 0.4 + tier * 0.1) {
      drops.push({ id: 'ore', n: tier === 3 ? 2 : 1 });
    }
    if (tier >= 3 && Math.random() < 0.45) {
      drops.push({ id: 'crystal', n: 1 });
    }

    for (const d of drops) {
      this.grantLoot(d.id, d.n);
    }
    const label = drops.map((d) => `+${d.n} ${d.id}`).join(' ');
    this.floatText(x, y - 12, label, tier >= 3 ? '#e9d5ff' : '#fef08a');
    this.refreshHud();
  }

  private grantLoot(id: InventoryItemId, amount: number): void {
    gameState.addItem(id, amount);
    this.runLoot[id] = (this.runLoot[id] ?? 0) + amount;
  }

  private movePlayer(): void {
    if (this.combat.isPlayerStunned) {
      return;
    }

    let speed = gameState.player.speed;
    if (this.combat.isAttackLocked) {
      speed *= 0.45;
    }

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
    if (!Phaser.Input.Keyboard.JustDown(this.mineKey) || this.combat.isAttackLocked) {
      return;
    }

    const nodes = this.oreNodes.getChildren() as Phaser.Physics.Arcade.Sprite[];
    const node = nodes.find(
      (n) => n.active && Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y) < 42,
    );

    if (!node) {
      return;
    }

    const data = node.getData('ore') as OreNodeData;
    data.hp -= 1;
    node.setData('ore', data);
    node.setTintFill(0xffffff);
    this.time.delayedCall(55, () => {
      if (node.active) {
        node.clearTint();
      }
    });

    this.floatText(node.x, node.y - 10, `${data.maxHp - data.hp}/${data.maxHp}`, '#cbd5e1');

    // Chip drop while mining
    if (Math.random() < 0.35) {
      this.grantLoot('stone', 1);
      this.floatText(node.x + 10, node.y - 18, '+stone', '#94a3b8');
    }

    if (data.hp > 0) {
      this.refreshHud();
      return;
    }

    this.breakOre(node, data);
  }

  private breakOre(node: Phaser.Physics.Arcade.Sprite, data: OreNodeData): void {
    const drops: { id: InventoryItemId; n: number }[] = [];

    if (data.kind === 'ore-node') {
      drops.push({ id: 'stone', n: 1 + Math.floor(Math.random() * 2) });
      drops.push({ id: 'ore', n: 1 });
    } else if (data.kind === 'ore-rich') {
      drops.push({ id: 'ore', n: 2 + Math.floor(Math.random() * 2) });
      drops.push({ id: 'stone', n: 1 });
      if (Math.random() < 0.25) {
        drops.push({ id: 'scrap', n: 1 });
      }
    } else {
      drops.push({ id: 'ore', n: 2 + Math.floor(Math.random() * 2) });
      drops.push({ id: 'crystal', n: 1 });
      if (Math.random() < 0.5) {
        drops.push({ id: 'scrap', n: 2 });
      }
    }

    for (const d of drops) {
      this.grantLoot(d.id, d.n);
    }

    const label = drops.map((d) => `+${d.n} ${d.id}`).join(' ');
    this.floatText(node.x, node.y - 16, label, data.kind === 'ore-rare' ? '#e9d5ff' : '#93c5fd');
    node.destroy();
    gameState.saveNow();
    this.refreshHud();
  }

  private drawFog(): void {
    const cam = this.cameras.main;
    const localX = this.player.x - cam.scrollX;
    const localY = this.player.y - cam.scrollY;

    if (this.fogRt.width !== cam.width || this.fogRt.height !== cam.height) {
      this.fogRt.setSize(cam.width, cam.height);
    }

    // Deeper = darker base overlay
    const baseAlpha = this.currentTier === 1 ? 0.78 : this.currentTier === 2 ? 0.9 : 0.97;
    this.fogRt.clear();
    this.fogRt.fill(0x020617, baseAlpha);
    // Soft edge: erase primary then a smaller brighter core feel via second erase
    this.fogRt.erase(this.lightMaskKey, localX - this.lightRadius, localY - this.lightRadius);
    if (this.currentTier >= 2) {
      // Extra darkness ring — fill corners again slightly by not double-erasing
      this.fogRt.fill(0x000000, this.currentTier === 3 ? 0.12 : 0.06);
      this.fogRt.erase(this.lightMaskKey, localX - this.lightRadius, localY - this.lightRadius);
    }
  }

  private refreshHud(): void {
    const inv = gameState.inventory;
    const tierName = this.currentTier === 1 ? 'Shallow' : this.currentTier === 2 ? 'Depths' : 'Abyss';
    const phase = this.combat.attackPhase;
    const swing =
      phase === 'idle' ? 'ready' : phase === 'windup' ? 'wind-up…' : phase === 'active' ? 'HIT' : 'recover';
    const runBits = (Object.entries(this.runLoot) as [InventoryItemId, number][])
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${id}+${n}`)
      .join(' ');

    this.hud.setText(
      [
        `CAVE TIER ${this.currentTier} — ${tierName}  ·  light ${this.lightRadius}px`,
        `HP ${gameState.player.hp}/${gameState.player.maxHp}  ·  melee ${swing}`,
        `Inv: wood ${inv.wood} stone ${inv.stone} ore ${inv.ore} scrap ${inv.scrap} crystal ${inv.crystal}`,
        `This run: ${runBits || '—'}  ·  SPACE swing · E mine · south exit → town`,
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
    this.floatText(this.player.x, this.player.y, 'Knocked out — returning with loot…', '#fca5a5');
    this.time.delayedCall(700, () => this.scene.start('TownScene'));
  }

  private drawCaveFloor(): void {
    for (let y = 0; y < MAP_H; y += GRID_SIZE) {
      for (let x = 0; x < MAP_W; x += GRID_SIZE) {
        const tier = this.tierAtY(y + GRID_SIZE / 2);
        const alt = (x / GRID_SIZE + y / GRID_SIZE) % 2 === 0;
        let key = alt ? 'tile-cave' : 'tile-cave-alt';
        if (tier === 2) {
          key = alt ? 'tile-cave-mid' : 'tile-cave';
        } else if (tier === 3) {
          key = alt ? 'tile-cave-deep' : 'tile-cave-alt';
        }
        this.add.image(x + GRID_SIZE / 2, y + GRID_SIZE / 2, key).setDepth(0);
      }
    }
  }

  private drawExitPath(): void {
    // Clear north–south corridor toward town exit so the return route stays readable
    const cx = MAP_W / 2;
    for (let y = MAP_H - GRID_SIZE; y > MAP_H * 0.55; y -= GRID_SIZE) {
      this.add.image(cx, y + GRID_SIZE / 2, 'tile-cave-path').setDepth(1).setAlpha(0.9);
      this.add.image(cx - GRID_SIZE, y + GRID_SIZE / 2, 'tile-cave-path').setDepth(1).setAlpha(0.55);
      this.add.image(cx + GRID_SIZE, y + GRID_SIZE / 2, 'tile-cave-path').setDepth(1).setAlpha(0.55);
    }

    for (let y = MAP_H - 120; y > MAP_H * 0.6; y -= 96) {
      this.add
        .text(cx + 36, y, '↓ TOWN', {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '10px',
          color: '#86efac',
        })
        .setDepth(4);
    }
  }
}
