/** Packed from art-refs/enemy-cave-creature.jpg → public/assets/creature/creature-atlas.png */
export const CREATURE_ATLAS = {
  frameWidth: 64,
  frameHeight: 48,
  anims: {
    'idle-down': [0],
    'walk-down': [0, 1, 2, 13],
    'idle-up': [3],
    'walk-up': [3, 4, 8, 9],
    'idle-right': [10],
    'walk-right': [10, 11, 12],
    attack: [5, 6, 7],
    downed: [14],
  },
} as const;
