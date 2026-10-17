import Phaser from 'phaser';

/** Create simple colored shape textures for v0 (no sprite sheets). */
export function ensureShapeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  const rect = (key: string, w: number, h: number, fill: number, stroke?: number) => {
    if (scene.textures.exists(key)) {
      return;
    }
    g.clear();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(0, 0, w, h, Math.min(4, Math.floor(Math.min(w, h) / 4)));
    if (stroke !== undefined) {
      g.lineStyle(2, stroke, 1);
      g.strokeRoundedRect(1, 1, w - 2, h - 2, Math.min(4, Math.floor(Math.min(w, h) / 4)));
    }
    g.generateTexture(key, w, h);
  };

  const circle = (key: string, diameter: number, fill: number, stroke?: number) => {
    if (scene.textures.exists(key)) {
      return;
    }
    g.clear();
    const r = diameter / 2;
    g.fillStyle(fill, 1);
    g.fillCircle(r, r, r);
    if (stroke !== undefined) {
      g.lineStyle(2, stroke, 1);
      g.strokeCircle(r, r, r - 1);
    }
    g.generateTexture(key, diameter, diameter);
  };

  rect('player', 22, 22, 0x4ade80, 0x166534);
  rect('hostile', 22, 22, 0xf87171, 0x7f1d1d);
  rect('hostile-mid', 24, 24, 0xfb7185, 0x9f1239);
  rect('hostile-elite', 26, 26, 0xe879f9, 0x701a75);
  rect('ore-node', 28, 28, 0x94a3b8, 0x334155);
  rect('ore-rich', 28, 28, 0x38bdf8, 0x0c4a6e);
  rect('ore-rare', 28, 28, 0xc084fc, 0x581c87);
  rect('house', 30, 30, 0xd97706, 0x78350f);
  rect('bench', 30, 30, 0xa16207, 0x713f12);
  rect('wall', 30, 30, 0x64748b, 0x1e293b);
  rect('light', 30, 30, 0xfbbf24, 0xb45309);
  rect('decoration', 30, 30, 0xc084fc, 0x6b21a8);
  // Ghost cell outline frame (drawn under preview)
  if (!scene.textures.exists('grid-cell')) {
    g.clear();
    g.lineStyle(2, 0xffffff, 1);
    g.strokeRect(1, 1, 30, 30);
    g.generateTexture('grid-cell', 32, 32);
  }
  rect('cave-exit', 40, 20, 0x22c55e, 0x14532d);
  rect('town-gate', 40, 20, 0x38bdf8, 0x0c4a6e);
  circle('hit-spark', 10, 0xfef08a);
  // Directional melee telegraph wedge
  if (!scene.textures.exists('melee-arc')) {
    g.clear();
    g.fillStyle(0xfef08a, 1);
    g.slice(16, 16, 16, Phaser.Math.DegToRad(-50), Phaser.Math.DegToRad(50), false);
    g.fillPath();
    g.generateTexture('melee-arc', 32, 32);
  }
  rect('tile-grass', 32, 32, 0x3f6212);
  rect('tile-path', 32, 32, 0x854d0e);
  rect('tile-cave', 32, 32, 0x1e293b);
  rect('tile-cave-alt', 32, 32, 0x0f172a);
  rect('tile-cave-mid', 32, 32, 0x172554);
  rect('tile-cave-deep', 32, 32, 0x1a0a2e);
  rect('tile-cave-path', 32, 32, 0x365314);

  g.destroy();
}
