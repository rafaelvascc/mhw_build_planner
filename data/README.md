# Equipment snapshot

Source: https://wilds.mhdb.io/en, a community project. See the endpoint names in scripts/import-equipment.mjs and the adjacent manifest for import version and checksum. The API date is not a game patch guarantee.

Raw responses are kept here for reproducibility. public/data/catalog.json is the normalized catalog shipped to the browser. Skill/group references are validated during import. Full charm ranks are flattened into selectable items; randomized templates have user-configurable skills and typed decoration slots.

Run `node scripts/import-equipment.mjs` to rebuild the normalized snapshot. Add `--refresh` to download new source responses. Review changes and run the planner tests before shipping an updated snapshot. The current published snapshot remains unchanged if normalization fails before the final write.

Upstream extraction repository: https://github.com/LartTyler/mhdb-wilds-data (GPL-3.0). API source: https://github.com/LartTyler/mhdb-wilds. No third-party artwork is bundled. This project is not affiliated with Capcom.

Passive calculations implemented: Attack Boost (flat and percent true raw), Critical Eye, Defense Boost, and the five elemental resistance skills. Values are recorded in the corresponding skill rank descriptions in skills.json. Other skill effects are shown by rank but are not folded into numerical stats. Conditional activation, Artian reinforcements, status/element skill modifiers, and transcended slot upgrades remain outside this version's calculation model.
