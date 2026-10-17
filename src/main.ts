import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TownScene } from './scenes/TownScene';
import { CaveScene } from './scenes/CaveScene';
import { gameState } from './state/GameState';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b1210',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, TownScene, CaveScene],
};

window.addEventListener('beforeunload', () => {
  gameState.saveNow();
});

const game = new Phaser.Game(config);
game.events.once(Phaser.Core.Events.READY, () => {
  game.canvas?.addEventListener('contextmenu', (e) => e.preventDefault());
});
