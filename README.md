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
| `CaveScene` | Maze walkways, hostiles, mining, melee, fog |
| `caveLayout` | Deterministic carved tilemap (rooms/corridors) |
| `CaveGemSpawner` | Diamond/emerald/sapphire in cave rooms |
| `WildernessMetalSpawner` | Gold/iron/silver outside town safe zone |
| `BiomeDecorator` | Overworld biomes (grass/snow/trees/leaves) + sparse cave trees |
| `PlayerTools` | Shared Mining → Weapon → Building tool cycle |
| `LootDrops` | Ground pickups collected with E |
| `PlacementManager` | 32×32 ghost preview, palette, place/remove + refund |
| `CombatSystem` | Aggro, melee wind-up/hit/recovery, knockback |

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

## Controls cheat-sheet

| Input | Action |
| --- | --- |
| **WASD** / arrows | Move (8-dir) |
| **Q** | Cycle tool: Mining → Weapon → Building → … |
| **E** | Pick up nearby ground loot |
| **RMB** | Tool action — Weapon: attack · Mining: mine under cursor/facing · Building: place |
| **LMB** / **R** | Building tool — remove structure (refund materials) |
| **1–5** | Building tool — select House / Bench / Wall / Light / Decor |

Town is an absolute safe zone (no hostiles). Building placements only apply in town; cave RMB with Building tool reminds you to return. Loot from combat/mining drops on the ground — use **E** to collect into inventory (persisted via `GameState`).

### Scene tips

- **Town:** north **CAVE ENTRANCE** gate enters the cave
- **Overworld:** town **safe zone** (build / cave gate) surrounded by **wilderness** (gold/iron/silver nodes)
- **Cave:** darker-red rock maze; gems (diamond/emerald/sapphire) spawn in **rooms** only; three depth tiers; **RETURN TO TOWN** at the south foyer

## v0 notes

Programmatic colored shape textures only — no sprite sheets yet. NPC economy and polished UI remain out of scope.
