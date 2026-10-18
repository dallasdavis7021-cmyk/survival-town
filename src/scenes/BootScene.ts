import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { preloadBiomeAssets } from '../systems/BiomeAssets';
import { preloadMinerals } from '../systems/Minerals';
import { preloadPortalAssets } from '../systems/PortalAssets';

/** Preloads shared assets, then routes to the last persisted scene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    preloadMinerals(this);
    preloadBiomeAssets(this);
    preloadPortalAssets(this);
  }

  create(): void {
    const next = gameState.lastScene === 'CaveScene' ? 'CaveScene' : 'TownScene';
    this.scene.start(next);
  }
}
