import Phaser from 'phaser';
import {
  buildWallRects,
  CAVE_TILE,
  parseCaveLayout,
  tierAtWorldY,
  type ParsedCaveMap,
} from '../maps/caveLayout';
import { gameState, type InventoryItemId } from '../state/GameState';
import { ensureBiomeAssetsLoaded } from '../systems/BiomeAssets';
import { decorateCaveTrees } from '../systems/BiomeDecorator';
import { CaveGemSpawner } from '../systems/CaveGemSpawner';
import { CombatSystem, type HostileSprite } from '../systems/CombatSystem';
import { LootDrops } from '../systems/LootDrops';
import { ensureMineralTexturesLoaded } from '../systems/Minerals';
import {
  cycleTool,
  getActiveTool,
  TOOL_LABELS,
  toolHelpLine,
  type ToolId,
} from '../systems/PlayerTools';
import { ensurePortalAssetsLoaded, placePortal } from '../systems/PortalAssets';
import { ensureShapeTextures } from '../utils/textures';

const MINE_RANGE = 56;

type CaveTier = 1 | 2 | 3;

interface OreNodeData {
  hp: number;
  maxHp: number;
  tier: CaveTier;
  kind: 'ore-node' | 'ore-rich' | 'ore-rare';
}

export class CaveScene extends Phaser.Scene {
  private map!: ParsedCaveMap;
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private toolKey!: Phaser.Input.Keyboard.Key;
  private pickupKey!: Phaser.Input.Keyboard.Key;
  private combat!: CombatSystem;
  private loot!: LootDrops;
  private gems!: CaveGemSpawner;
  private hostiles!: Phaser.Physics.Arcade.Group;
  private oreNodes!: Phaser.Physics.Arcade.StaticGroup;
  private hud!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private fogRt!: Phaser.GameObjects.RenderTexture;
  private lightMaskKey = 'light-mask-mid';
  private lightRadius = 140;
  private currentTier: CaveTier = 1;
  private tool: ToolId = getActiveTool();
  private transitioning = false;
  private runLoot: Partial<Record<InventoryItemId, number>> = {};
  private facing = new Phaser.Math.Vector2(0, -1);

  constructor() {
    super('CaveScene');
  }

  create(): void {
    ensureShapeTextures(this);
    this.ensureLightMasks();
    this.map = parseCaveLayout();
    gameState.setLastScene('CaveScene');
    this.transitioning = false;
    this.runLoot = {};
    this.tool = getActiveTool();

    // Darker red void mass as camera clear color
    this.cameras.main.setBackgroundColor('#2a0808');
    this.physics.world.setBounds(0, 0, this.map.width, this.map.height);
    this.cameras.main.setBounds(0, 0, this.map.width, this.map.height);

    this.drawWalkwayMap();
    this.walls = this.buildWallCollision();

    this.player = this.physics.add.sprite(this.map.spawn.x, this.map.spawn.y, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    playerBody.setSize(18, 18);
    playerBody.setOffset(2, 2);

    this.physics.add.collider(this.player, this.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.hostiles = this.physics.add.group();
    this.oreNodes = this.physics.add.staticGroup();
    this.loot = new LootDrops(this, {
      onCollected: (id, amount) => {
        this.runLoot[id] = (this.runLoot[id] ?? 0) + amount;
      },
    });
    this.gems = new CaveGemSpawner(this, this.map);

    this.combat = new CombatSystem(this, this.player, this.hostiles, {
      onHostileKilled: (hostile, x, y) => this.onHostileKilled(hostile, x, y),
      onPlayerHurt: () => this.refreshHud(),
    });

    this.physics.add.collider(this.hostiles, this.walls);
    this.spawnFromMap();

    void Promise.all([
      ensureMineralTexturesLoaded(this),
      ensureBiomeAssetsLoaded(this),
      ensurePortalAssetsLoaded(this),
    ]).then(() => {
      if (!this.sys.isActive()) {
        return;
      }
      this.applyCaveFloorTextures();
      this.gems.populate();
      decorateCaveTrees(this, this.map.walkable, CAVE_TILE);
      const exitKey = 'portal-cave-exit';
      if (this.textures.exists(exitKey)) {
        this.children.list.forEach((obj) => {
          if (obj instanceof Phaser.GameObjects.Image && obj.texture.key === 'cave-exit') {
            obj.setTexture(exitKey);
            const tex = obj.texture.getSourceImage() as HTMLImageElement;
            obj.setScale(72 / Math.max(1, tex.height));
            obj.setOrigin(0.5, 0.85);
          }
        });
      }
    });

    // Red-tinted cave exit portal (walk-in zone, no full-sprite blocker)
    placePortal(
      this,
      this.map.exit.x,
      this.map.exit.y,
      'exit',
      () => this.returnToTown(),
      this.player,
    );

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
        backgroundColor: '#1a0505cc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.help = this.add
      .text(12, this.scale.height - 52, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#fecaca',
        backgroundColor: '#1a0505cc',
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(101);

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

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.fogRt.setSize(gameSize.width, gameSize.height);
    });

    this.currentTier = tierAtWorldY(this.player.y, this.map.height);
    this.applyTierLight();
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

    if (Phaser.Input.Keyboard.JustDown(this.toolKey)) {
      this.tool = cycleTool();
    }

    if (Phaser.Input.Keyboard.JustDown(this.pickupKey)) {
      this.loot.collectNear(this.player.x, this.player.y);
    }

    this.updateTierFromPosition();
    this.movePlayer();
    this.combat.update(time, delta);
    this.drawFog();
    this.refreshHud();
  }

  private drawWalkwayMap(): void {
    const { cols, rows, walkable } = this.map;
    const deepCutoff = Math.floor(rows * 0.34);

    for (let ty = 0; ty < rows; ty += 1) {
      for (let tx = 0; tx < cols; tx += 1) {
        const cx = tx * CAVE_TILE + CAVE_TILE / 2;
        const cy = ty * CAVE_TILE + CAVE_TILE / 2;
        if (!walkable[ty][tx]) {
          const rock = ty < deepCutoff ? 'cave-rock-deep' : 'cave-rock';
          this.add.image(cx, cy, rock).setDepth(0);
          continue;
        }

        // Placeholder until floor-cave-tex loads (restamped in applyCaveFloorTextures)
        const floor = ((tx + ty) & 1) === 0 ? 'cave-floor' : 'cave-floor-dim';
        this.add
          .image(cx, cy, floor)
          .setDepth(1)
          .setDisplaySize(CAVE_TILE + 1, CAVE_TILE + 1)
          .setData('caveFloor', true);

        // Crisp light outlines where floor meets rock
        const up = ty === 0 || !walkable[ty - 1][tx];
        const down = ty === rows - 1 || !walkable[ty + 1][tx];
        const left = tx === 0 || !walkable[ty][tx - 1];
        const right = tx === cols - 1 || !walkable[ty][tx + 1];

        if (up) {
          this.add.image(cx, ty * CAVE_TILE + 1, 'cave-edge-h').setDepth(2);
        }
        if (down) {
          this.add.image(cx, (ty + 1) * CAVE_TILE - 1, 'cave-edge-h').setDepth(2);
        }
        if (left) {
          this.add.image(tx * CAVE_TILE + 1, cy, 'cave-edge-v').setDepth(2);
        }
        if (right) {
          this.add.image((tx + 1) * CAVE_TILE - 1, cy, 'cave-edge-v').setDepth(2);
        }
      }
    }

    // Tier banners on spine
    this.addTierBanner(this.map.width / 2, this.map.height * 0.12, 'TIER 3 — ABYSS', '#fca5a5');
    this.addTierBanner(this.map.width / 2, this.map.height * 0.45, 'TIER 2 — DEPTHS', '#fde68a');
    this.addTierBanner(this.map.width / 2, this.map.height * 0.78, 'TIER 1 — SHALLOW', '#86efac');
  }

  /** Stamp art-directed cave floor texture onto all walkable tiles. */
  private applyCaveFloorTextures(): void {
    if (!this.textures.exists('floor-cave-tex')) {
      return;
    }
    const { cols, rows, walkable } = this.map;
    for (let ty = 0; ty < rows; ty += 1) {
      for (let tx = 0; tx < cols; tx += 1) {
        if (!walkable[ty][tx]) {
          continue;
        }
        const cx = tx * CAVE_TILE + CAVE_TILE / 2;
        const cy = ty * CAVE_TILE + CAVE_TILE / 2;
        const key =
          ((tx + ty) & 1) === 0
            ? 'floor-cave-tex'
            : this.textures.exists('floor-cave-tex-b')
              ? 'floor-cave-tex-b'
              : 'floor-cave-tex';
        this.add
          .image(cx, cy, key)
          .setDepth(1)
          .setDisplaySize(CAVE_TILE + 1, CAVE_TILE + 1);
      }
    }
  }

  private buildWallCollision(): Phaser.Physics.Arcade.StaticGroup {
    const group = this.physics.add.staticGroup();
    const rects = buildWallRects(this.map.walkable, CAVE_TILE);

    for (const r of rects) {
      // Invisible static bodies (merged wall runs) — player & hostiles collide
      const wall = group.create(r.x + r.w / 2, r.y + r.h / 2, 'cave-rock') as Phaser.Physics.Arcade.Sprite;
      wall.setDisplaySize(r.w, r.h);
      wall.setVisible(false);
      wall.refreshBody();
    }

    return group;
  }

  private spawnFromMap(): void {
    for (const h of this.map.hostiles) {
      const cfg =
        h.tier === 3
          ? {
              tier: 3 as const,
              hp: 65,
              damage: 15,
              speed: 115,
              aggroRange: 200,
              attackRange: 36,
              knockback: 400,
              attackCooldownMs: 650,
            }
          : h.tier === 2
            ? {
                tier: 2 as const,
                hp: 42,
                damage: 11,
                speed: 100,
                aggroRange: 180,
                knockback: 360,
              }
            : {
                tier: 1 as const,
                hp: 28,
                damage: 7,
                speed: 85,
                aggroRange: 150,
              };

      const hostile = this.combat.spawnHostile(h.point.x, h.point.y, cfg);
      const body = hostile.body as Phaser.Physics.Arcade.Body;
      body.setSize(16, 16);
      body.setOffset(3, 3);
    }

    for (const o of this.map.ores) {
      this.spawnOre(o.point.x, o.point.y, o.tier, o.kind);
    }
  }

  private addTierBanner(x: number, y: number, label: string, color: string): void {
    this.add
      .text(x, y, label, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color,
        backgroundColor: '#1a0505aa',
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
    node.setDepth(5);
    node.refreshBody();
  }

  private onRightClick(pointer: Phaser.Input.Pointer): void {
    if (this.tool === 'weapon') {
      this.combat.tryStartAttack(this.time.now);
      return;
    }

    if (this.tool === 'mining') {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.tryMineAt(world.x, world.y);
      return;
    }

    this.floatText(this.player.x, this.player.y - 24, 'Build in town only', '#fde68a');
  }

  private updateTierFromPosition(): void {
    const next = tierAtWorldY(this.player.y, this.map.height);
    if (next === this.currentTier) {
      return;
    }
    this.currentTier = next;
    this.applyTierLight();
  }

  private applyTierLight(): void {
    if (this.currentTier === 1) {
      this.lightRadius = 168;
      this.lightMaskKey = 'light-mask-wide';
    } else if (this.currentTier === 2) {
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

  private onHostileKilled(hostile: HostileSprite, x: number, y: number): void {
    const tier = hostile.config.tier;
    const drops: { id: InventoryItemId; n: number }[] = [{ id: 'scrap', n: tier }];
    if (Math.random() < 0.4 + tier * 0.1) {
      drops.push({ id: 'ore', n: tier === 3 ? 2 : 1 });
    }
    if (tier >= 3 && Math.random() < 0.45) {
      drops.push({ id: 'crystal', n: 1 });
    }

    this.loot.dropMany(x, y, drops);
    this.floatText(x, y - 12, 'loot dropped — E pick up', tier >= 3 ? '#e9d5ff' : '#fef08a');
    this.refreshHud();
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

    if (vx !== 0 || vy !== 0) {
      this.facing.set(vx, vy).normalize();
    }

    this.player.setVelocity(vx * speed, vy * speed);
  }

  private tryMineAt(cursorX: number, cursorY: number): void {
    if (this.combat.isAttackLocked) {
      return;
    }

    if (this.gems.tryMineNear(cursorX, cursorY, this.player.x, this.player.y, MINE_RANGE)) {
      this.refreshHud();
      return;
    }

    const nodes = this.oreNodes.getChildren() as Phaser.Physics.Arcade.Sprite[];
    const inPlayerRange = nodes.filter(
      (n) =>
        n.active &&
        Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y) <= MINE_RANGE,
    );

    if (inPlayerRange.length === 0) {
      this.floatText(this.player.x, this.player.y - 20, 'Nothing to mine in range', '#94a3b8');
      return;
    }

    let target =
      inPlayerRange.find(
        (n) => Phaser.Math.Distance.Between(cursorX, cursorY, n.x, n.y) < 28,
      ) ?? null;

    if (!target) {
      const face = this.combat.facingVector.lengthSq() > 0 ? this.combat.facingVector : this.facing;
      let bestScore = -Infinity;
      for (const n of inPlayerRange) {
        const dx = n.x - this.player.x;
        const dy = n.y - this.player.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dot = (dx / dist) * face.x + (dy / dist) * face.y;
        const score = dot * 2 - dist / MINE_RANGE;
        if (score > bestScore) {
          bestScore = score;
          target = n;
        }
      }
    }

    if (!target) {
      return;
    }

    this.strikeOre(target);
  }

  private strikeOre(node: Phaser.Physics.Arcade.Sprite): void {
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

    if (Math.random() < 0.35) {
      this.loot.drop(node.x, node.y, 'stone', 1);
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

    this.loot.dropMany(node.x, node.y, drops);
    this.floatText(
      node.x,
      node.y - 16,
      'ore broke — E pick up',
      data.kind === 'ore-rare' ? '#e9d5ff' : '#93c5fd',
    );
    node.destroy();
    this.refreshHud();
  }

  private drawFog(): void {
    const cam = this.cameras.main;
    const localX = this.player.x - cam.scrollX;
    const localY = this.player.y - cam.scrollY;

    if (this.fogRt.width !== cam.width || this.fogRt.height !== cam.height) {
      this.fogRt.setSize(cam.width, cam.height);
    }

    // Near-black fog so darker-red rock still reads in lit radius
    const baseAlpha = this.currentTier === 1 ? 0.82 : this.currentTier === 2 ? 0.92 : 0.97;
    this.fogRt.clear();
    this.fogRt.fill(0x050202, baseAlpha);
    this.fogRt.erase(this.lightMaskKey, localX - this.lightRadius, localY - this.lightRadius);
    if (this.currentTier >= 2) {
      this.fogRt.fill(0x000000, this.currentTier === 3 ? 0.14 : 0.07);
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
        `HP ${gameState.player.hp}/${gameState.player.maxHp}  ·  Active: ${TOOL_LABELS[this.tool]}${this.tool === 'weapon' ? ` (${swing})` : ''}`,
        `Inv: ore ${inv.ore} scrap ${inv.scrap}  gems ${inv.diamond}d/${inv.emerald}e/${inv.sapphire}s  metals ${inv.gold}g/${inv.iron}i/${inv.silver}s`,
        `Picked up this run: ${runBits || '—'}  ·  gems in rooms  ·  path → RETURN TO TOWN`,
      ].join('\n'),
    );

    this.help.setText(`${toolHelpLine(this.tool)}  ·  WASD move (paths only)`);
    this.help.setPosition(12, this.scale.height - 52);
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
    this.gems.onLeaveCave();
    gameState.saveNow();
    this.scene.start('TownScene');
  }

  private onPlayerDown(): void {
    this.transitioning = true;
    this.gems.onLeaveCave();
    gameState.heal(Math.floor(gameState.player.maxHp * 0.5));
    gameState.saveNow();
    this.floatText(this.player.x, this.player.y, 'Knocked out — returning…', '#fca5a5');
    this.time.delayedCall(700, () => this.scene.start('TownScene'));
  }
}
