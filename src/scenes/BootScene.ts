import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { preloadMinerals } from '../systems/Minerals';

/** Preloads shared assets, then routes to the last persisted scene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    preloadMinerals(this);
  }

  create(): void {
    const next = gameState.lastScene === 'CaveScene' ? 'CaveScene' : 'TownScene';
    this.scene.start(next);
  }
}
