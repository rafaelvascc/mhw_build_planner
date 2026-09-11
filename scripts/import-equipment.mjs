import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(`data/${name}.json`, root), 'utf8'));
const endpoints = { weapons:'weapons', armor:'armor', decorations:'decorations', charms:'charms', skills:'skills', sets:'armor/sets' };
if (process.argv.includes('--refresh')) {
  const before = await fetch('https://wilds.mhdb.io/version').then(r=>r.json());
  const responses = {};
  for (const [name,path] of Object.entries(endpoints)) {
    const response = await fetch(`https://wilds.mhdb.io/en/${path}`);
    if (!response.ok) throw Error(`${path}: ${response.status}`);
    responses[name] = await response.json();
    if (!Array.isArray(responses[name]) || !responses[name].length) throw Error(`Empty ${name}`);
  }
  const after = await fetch('https://wilds.mhdb.io/version').then(r=>r.json());
  if (before.version !== after.version) throw Error('Source changed during import; retry.');
  for (const [name,value] of Object.entries({...responses,version:before})) await writeFile(new URL(`data/${name}.json`,root),JSON.stringify(value));
}
const raw = Object.fromEntries(await Promise.all(Object.keys(endpoints).map(async n=>[n,await read(n)])));
const skills = raw.skills.map(s=>({id:s.id,name:s.name,kind:s.kind,description:s.description,ranks:s.ranks.map(r=>({level:r.level,name:r.name,description:r.description,pieces:r.setPiecesRequired}))}));
const skillMap = new Map(skills.map(s=>[s.id,s]));
const refs = entries => (entries??[]).map(r=>{if(!skillMap.has(r.skill.id))throw Error(`Missing skill ${r.skill.id}`);return {id:r.skill.id,level:r.level};});
const setMap = new Map(raw.sets.map(s=>[s.id,s]));
function equipment(e,slot,id) {
  const set = setMap.get(e.armorSet?.id);
  const bonuses = new Set((e.skills??[]).filter(r=>['set','group'].includes(skillMap.get(r.skill.id)?.kind)).map(r=>r.skill.id));
  for(const b of [set?.setBonusSkill,set?.groupBonusSkill]) if(b)bonuses.add(b.id);
  return {id,name:e.name,slot,kind:e.kind??slot,rarity:e.rarity,description:e.description,slots:(e.slots??[]).map(level=>({level,kind:slot==='weapon'?'weapon':'armor'})),skills:refs(e.skills).filter(r=>!['set','group'].includes(skillMap.get(r.id)?.kind)),bonuses:[...bonuses],defense:e.defense,resistances:e.resistances,damage:e.damage,affinity:e.affinity,defenseBonus:e.defenseBonus,specials:e.specials,sharpness:e.sharpness,series:e.series?.name,customizable:slot==='weapon'&&!e.series};
}
const equipments = [...raw.weapons.map(e=>equipment(e,'weapon',`weapon-${e.id}`)),...raw.armor.map(e=>equipment(e,e.kind,`armor-${e.id}`)),...raw.charms.flatMap(c=>c.ranks.map(e=>({...equipment(e,'charm',`charm-${e.id}`),random:c.random??c.randomized??false})))];
const decorations = raw.decorations.map(d=>({id:d.id,name:d.name,kind:d.kind,level:d.slot,rarity:d.rarity,skills:refs(d.skills),icon:d.icon}));
if(new Set(equipments.map(e=>e.id)).size!==equipments.length)throw Error('Duplicate equipment IDs');
for(const e of equipments)for(const s of e.slots)if(![1,2,3].includes(s.level))throw Error(`Invalid slot on ${e.name}`);
const version = await read('version');
const data = {version:version.version,equipments,decorations,skills};
await mkdir(new URL('public/data/',root),{recursive:true});
await writeFile(new URL('public/data/catalog.json',root),JSON.stringify(data));
await writeFile(new URL('data/manifest.json',root),JSON.stringify({source:'https://wilds.mhdb.io/en',version:version.version,importedAt:new Date().toISOString(),sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),equipmentCount:equipments.length,decorationCount:decorations.length,skillCount:skills.length},null,2));
console.log(`Validated ${equipments.length} equipment entries, ${decorations.length} decorations and ${skills.length} skills.`);
