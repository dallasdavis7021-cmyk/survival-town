/** Packed from art-refs/player-spritesheet.jpg → public/assets/player/player-atlas.png */
export const PLAYER_ATLAS = {
  frameWidth: 56,
  frameHeight: 48,
  anims: {
    'idle-down': [0],
    'walk-down': [0, 1, 2, 3, 4],
    'idle-up': [10],
    'walk-up': [9, 10, 11, 12, 13],
    'idle-left': [14],
    'walk-left': [14, 15, 16, 17],
    'idle-right': [19],
    'walk-right': [19, 20, 21, 22, 23],
    attack: [6, 7, 5, 8],
    hurt: [25],
    'mine-wood': [18],
    'mine-rock': [24],
  },
} as const;
