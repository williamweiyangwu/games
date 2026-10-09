# Arcade

A single website that collects five browser games in one place.

## Games

| Game | Folder | Status |
| --- | --- | --- |
| KARDS — WWII card game | [`kards/`](kards/) | Ready |
| Europe 1939 — map game | [`map-game/`](map-game/) | Ready |
| Blockcraft — voxel sandbox | [`minecraft/`](minecraft/) | Ready |
| Tank War — 2D arena | [`tank/`](tank/) | Ready |
| Sun Circuit — 3D race car | [`race-car/`](race-car/) | Developing |

## Run locally

Each game is a self-contained `index.html`. Open any `index.html` in a browser,
or serve the root folder with any static server:

```
python -m http.server 8000
```

## Deploy

Pushed to GitHub Pages at https://williamweiyangwu.github.io/games/
