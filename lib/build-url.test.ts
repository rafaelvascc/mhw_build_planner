import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compatible, decorate, equip, type Build, type Catalog } from './planner.ts';
import { decodeBuild, encodeBuild } from './build-url.ts';

const catalog: Catalog = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const findEquipment = (name: string) => catalog.equipments.find(equipment => equipment.name === name)!;

test('build URL round-trips equipment and decorations for both weapons', () => {
  const primary = findEquipment('Hope Bow IV');
  const secondary = catalog.equipments.find(equipment => equipment.slot === 'weapon' && equipment.id !== primary.id && equipment.slots.length > 0)!;
  const primaryDecoration = catalog.decorations.find(decoration => primary.slots.some(slot => compatible(decoration, slot)))!;
  const secondaryDecoration = catalog.decorations.find(decoration => secondary.slots.some(slot => compatible(decoration, slot)))!;
  let build: Build = equip({}, primary);
  build = equip(build, secondary, 'secondaryWeapon');
  build = decorate(build, 'weapon', 0, primaryDecoration);
  build = decorate(build, 'secondaryWeapon', 0, secondaryDecoration);

  const encoded = encodeBuild(build, catalog);
  assert.ok(encoded);
  const restored = decodeBuild(encoded, catalog);
  assert.equal(restored.warning, undefined);
  assert.equal(restored.build.weapon?.equipment.id, primary.id);
  assert.equal(restored.build.secondaryWeapon?.equipment.id, secondary.id);
  assert.equal(restored.build.weapon?.decorations[0]?.id, primaryDecoration.id);
  assert.equal(restored.build.secondaryWeapon?.decorations[0]?.id, secondaryDecoration.id);
});

test('custom random charm skills and slots survive URL round-trip', () => {
  const base = catalog.equipments.find(equipment => equipment.slot === 'charm' && equipment.random)!;
  const skill = catalog.skills.find(candidate => candidate.kind === 'armor' && candidate.ranks.length > 0)!;
  const custom = { ...base, skills: [{ id: skill.id, level: 1 }], slots: [{ kind: 'armor' as const, level: 2 }] };
  const build = equip({}, custom);
  const encoded = encodeBuild(build, catalog);
  assert.ok(encoded);
  const restored = decodeBuild(encoded, catalog).build.charm?.equipment;
  assert.deepEqual(restored?.skills, custom.skills);
  assert.deepEqual(restored?.slots, custom.slots);
});

test('empty and malformed links are handled safely', () => {
  assert.equal(encodeBuild({}, catalog), null);
  const result = decodeBuild('not-a-valid-payload', catalog);
  assert.deepEqual(result.build, {});
  assert.ok(result.warning);
});
