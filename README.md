# Survival Town

Top-down browser action RPG / town builder. Explore caves for loot and ore, return to an absolute safe town zone, and expand the settlement on a 32×32 grid.

## Stack

- Vite + TypeScript
- Phaser 3 (arcade physics, 8-directional movement)
- Local `GameState` with `localStorage` auto-save

## Modules

| Module | Role |
| --- | --- |
| `GameState` | Player stats, inventory, placed structures, auto-save |
| `TownScene` | Safe haven — building only, no hostile spawns |
| `CaveScene` | Hostiles, mining, melee, radial fog/light |
| `PlacementManager` | 32×32 ghost preview, palette, place/remove + material refund |
| `CombatSystem` | Aggro, melee, knockback |

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

### Build

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Controls

**Town**

- `WASD` / arrows — move
- `B` or `Q` — enter / exit build mode
- `1`–`5` or click the palette — select House / Bench / Wall / Light / Decor
- `Q` (in place mode) — cycle structure
- `E` or left-click — place (blocked if tile occupied or materials insufficient)
- `R` — toggle remove mode; `E` / click refunds materials and clears the tile
- Ghost preview snaps to the 32×32 grid (green = ok, red = can't afford, orange = occupied)
- Walk into the north **CAVE ENTRANCE** to enter the cave

**Cave**

- `WASD` / arrows — move (slowed during melee wind-up / recovery)
- `SPACE` — directional melee (wind-up → hit window → recovery; faces last move dir)
- `E` — mine nearby ore (chip stone while hitting; richer nodes deeper)
- Three depth tiers northward: Shallow → Depths → Abyss (harder foes, better ore / crystal, tighter light)
- Follow the marked south path to **RETURN TO TOWN** — inventory & stats auto-save via `GameState`

Town is an absolute safe zone: hostiles never spawn or pursue there.

## v0 notes

Programmatic colored shape textures only — no sprite sheets yet. NPC economy and polished UI remain out of scope.
