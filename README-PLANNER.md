# Hunter Forge

React 19 / TypeScript single-page Monster Hunter Wilds build planner. The project uses the Sites Vinext starter, Vite, and accessible Radix/Base UI components. Data is bundled locally; no runtime dependency on MHDB availability or browser CORS.

## Run

Requires Node 22.13+ (Node 24 is recommended for the native TypeScript tests).

```sh
npm ci
npm run dev
```

The preview runs at http://localhost:5173. Build with `npm run build`.

```sh
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test lib/planner.test.ts
node scripts/import-equipment.mjs
```

Choose each equipment slot, then its decorations. All filters combine: name, skill (including set/group membership), exact rarity, exact decoration slot count, minimum level of at least one slot, and weapon type. Weapons are grouped by type. A replacement preserves a decoration only if it is still compatible at the same slot index. Randomized charms provide a manual roll editor; custom rolls are not validated for in-game obtainability. Builds are session state and reset on reload.

Stats include equipment plus the listed supported passive skills. The in-app calculation explanation states exclusions. Set/group activation counts each piece once by bonus skill ID across armor variants. Ordinary skills cap at their maximum and show excess levels. Each skill expands to its rank description.

See data/README.md for snapshot provenance and calculation boundaries.
