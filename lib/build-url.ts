import { compatible, slots, type Build, type BuildSlot, type Catalog, type DecoSlot, type SkillRef } from './planner';

const FORMAT_VERSION = 1;
const MAX_PAYLOAD_LENGTH = 12_000;
type WireDecoration = number | null;
type WireCustom = [[number, number][], [number, 0 | 1][]];
type WireEntry = [string, WireDecoration[], WireCustom?];
type WirePayload = [number, string, (WireEntry | null)[]];

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_PAYLOAD_LENGTH) throw new Error('Invalid build link.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

function customCharmData(buildSlot: BuildSlot, entry: NonNullable<Build[BuildSlot]>): WireCustom | undefined {
  if (buildSlot !== 'charm' || !entry.equipment.random) return undefined;
  return [entry.equipment.skills.map(skill => [skill.id, skill.level]), entry.equipment.slots.map(slot => [slot.level, slot.kind === 'weapon' ? 0 : 1])];
}

export function encodeBuild(build: Build, catalog: Catalog) {
  const rows = slots.map(slot => {
    const entry = build[slot];
    if (!entry) return null;
    return [entry.equipment.id, entry.decorations.map(decoration => decoration?.id ?? null), customCharmData(slot, entry)] as WireEntry;
  });
  if (rows.every(row => row === null)) return null;
  return encodeBase64Url(JSON.stringify([FORMAT_VERSION, catalog.version, rows] satisfies WirePayload));
}

function parseCustomCharm(value: unknown, catalog: Catalog) {
  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[0]) || !Array.isArray(value[1])) return null;
  const skills: SkillRef[] = [];
  for (const item of value[0].slice(0, 3)) {
    if (!Array.isArray(item) || !isInteger(item[0]) || !isInteger(item[1])) continue;
    const skill = catalog.skills.find(candidate => candidate.id === item[0]);
    const max = skill ? Math.max(...skill.ranks.map(rank => rank.level)) : 0;
    if (skill && item[1] > 0 && item[1] <= max && !skills.some(existing => existing.id === item[0])) skills.push({ id: item[0], level: item[1] });
  }
  const charmSlots: DecoSlot[] = [];
  for (const item of value[1].slice(0, 3)) {
    if (!Array.isArray(item) || !isInteger(item[0]) || !(item[1] === 0 || item[1] === 1)) continue;
    if (item[0] >= 1 && item[0] <= 3) charmSlots.push({ level: item[0], kind: item[1] === 0 ? 'weapon' : 'armor' });
  }
  return { skills, slots: charmSlots };
}

export function decodeBuild(encoded: string, catalog: Catalog): { build: Build; warning?: string } {
  try {
    const parsed = JSON.parse(decodeBase64Url(encoded)) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== FORMAT_VERSION || typeof parsed[1] !== 'string' || !Array.isArray(parsed[2]) || parsed[2].length !== slots.length) throw new Error('Invalid build link.');
    const rows = parsed[2] as unknown[];
    const equipments = new Map(catalog.equipments.map(equipment => [equipment.id, equipment]));
    const decorations = new Map(catalog.decorations.map(decoration => [decoration.id, decoration]));
    const build: Build = {};
    let skipped = 0;
    rows.forEach((raw, index) => {
      if (raw === null) return;
      if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !Array.isArray(raw[1])) { skipped++; return; }
      const slot = slots[index];
      const baseEquipment = equipments.get(raw[0]);
      const expectedSlot = slot === 'secondaryWeapon' ? 'weapon' : slot;
      if (!baseEquipment || baseEquipment.slot !== expectedSlot) { skipped++; return; }
      const custom = slot === 'charm' && baseEquipment.random ? parseCustomCharm(raw[2], catalog) : null;
      const equipment = custom ? { ...baseEquipment, skills: custom.skills, slots: custom.slots } : baseEquipment;
      const equippedDecorations = equipment.slots.map((target, decorationIndex) => {
        const id = raw[1][decorationIndex];
        const decoration = isInteger(id) ? decorations.get(id) : undefined;
        return decoration && compatible(decoration, target) ? decoration : null;
      });
      build[slot] = { equipment, decorations: equippedDecorations };
    });
    const warning = skipped ? 'Some items in this build link could not be restored.' : parsed[1] !== catalog.version ? 'This build uses an older catalog version; verify the restored items.' : undefined;
    return { build, warning };
  } catch {
    return { build: {}, warning: 'Unable to load this build link.' };
  }
}
