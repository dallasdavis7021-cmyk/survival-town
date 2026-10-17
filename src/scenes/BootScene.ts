import Phaser from 'phaser';
import { gameState } from '../state/GameState';

/** Routes to the last persisted scene (town by default). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const next = gameState.lastScene === 'CaveScene' ? 'CaveScene' : 'TownScene';
    this.scene.start(next);
  }
}
