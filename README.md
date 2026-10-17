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

- `WASD` / arrows — move
- `SPACE` — melee attack
- `E` — mine nearby ore nodes
- Walk into the south **RETURN TO TOWN** exit to go back (inventory and HP persist)

Town is an absolute safe zone: hostiles never spawn or pursue there.

## v0 notes

Programmatic colored shape textures only — no sprite sheets yet. Fog of war is a simple radial light mask in the cave. Deep cave tiers, NPC economy, and polished UI are out of scope for this scaffold.
