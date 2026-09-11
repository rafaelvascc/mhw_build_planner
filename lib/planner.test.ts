import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compatible, equip, decorate, summarize, filterEquipment, emptyFilters } from './planner.ts';
import type { Catalog, Equipment, Build } from './planner.ts';
const data:Catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const find=(name:string)=>{const e=data.equipments.find(e=>e.name===name);assert.ok(e,name);return e;};
test('all source skill and bonus references resolve',()=>{
  const ids=new Set(data.skills.map(s=>s.id));
  for(const e of data.equipments)for(const id of [...e.skills.map(r=>r.id),...e.bonuses])assert.ok(ids.has(id));
  for(const d of data.decorations)for(const r of d.skills)assert.ok(ids.has(r.id));
});
test('decoration compatibility enforces level and weapon/armor kind',()=>{
  for(const d of data.decorations){assert.equal(compatible(d,{kind:d.kind,level:3}),true);assert.equal(compatible(d,{kind:d.kind==='weapon'?'armor':'weapon',level:3}),false);if(d.level>1)assert.equal(compatible(d,{kind:d.kind,level:d.level-1}),false);}
});
test('changing equipment discards incompatible decorations and updates totals',()=>{
  const weapon=data.equipments.find(e=>e.slot==='weapon'&&e.slots[0]?.level===3)!;
  const jewel=data.decorations.find(d=>d.kind==='weapon'&&d.level===3)!;
  let build=equip({},weapon);build=decorate(build,'weapon',0,jewel);
  assert.equal(summarize(build,data.skills).usedSlots,1);
  const replacement=find('Hope Bow I');build=equip(build,replacement);
  assert.deepEqual(build.weapon?.decorations,[]);assert.equal(summarize(build,data.skills).usedSlots,0);
  const invalid=decorate(build,'weapon',0,jewel);assert.equal(invalid,build);
});
test('primary and secondary weapons keep independent equipment and decorations',()=>{
  const primary=find('Hope Bow I');
  const secondary=data.equipments.find(e=>e.slot==='weapon'&&e.name!=='Hope Bow I'&&e.slots.length>0)!;
  const jewel=data.decorations.find(d=>d.kind==='weapon'&&d.level<=(secondary.slots[0]?.level??0))!;
  let build=equip({},primary);build=equip(build,secondary,'secondaryWeapon');
  assert.equal(build.weapon?.equipment.id,primary.id);
  assert.equal(build.secondaryWeapon?.equipment.id,secondary.id);
  build=decorate(build,'secondaryWeapon',0,jewel);
  assert.equal(summarize(build,data.skills).usedSlots,1);
});
test('Rey Dau bonus activates at two and four pieces, never counts innate entries twice',()=>{
  const rey=data.equipments.filter(e=>e.name.startsWith('Rey Sand')&&e.name.endsWith('γ'));
  assert.equal(rey.length,5);
  let build:Build={};
  for(let i=0;i<4;i++){build=equip(build,rey[i]);const bonus=summarize(build,data.skills).bonuses.find(b=>b.skill.name==="Rey Dau's Voltage")!;assert.equal(bonus.count,i+1);assert.equal(bonus.active?.level??0,i===0?0:i<3?1:2);}
});
test('combined name, skill, rarity, count, level and type filters',()=>{
  const pieces=filterEquipment(data.equipments,{...emptyFilters,name:'esperanza',skill:'critical eye',rarity:'8',count:'3',level:'3',type:'dual-blades'},data.skills);
  assert.ok(pieces.some(e=>e.name==='Esperanza Daggers'));
  assert.ok(pieces.every(e=>e.kind==='dual-blades'&&e.rarity===8&&e.slots.length===3&&e.slots.some(s=>s.level>=3)));
  assert.equal(filterEquipment(data.equipments,{...emptyFilters,count:'0',level:'1'},data.skills).length,0);
});
test('new rarity and decoration ranges plus multi-select weapon attributes',()=>{
  const fireOrIce=filterEquipment(data.equipments,{...emptyFilters,minRarity:'8',maxRarity:'8',minCount:'2',maxCount:'3',minLevel:'2',elements:['fire','ice'],type:'any'},data.skills);
  assert.ok(fireOrIce.length>0);
  assert.ok(fireOrIce.every(e=>e.rarity===8&&e.slots.length>=2&&e.slots.length<=3&&e.slots.some(s=>s.level>=2)&&e.specials?.some(s=>['fire','ice'].includes(s.element??s.status??''))));
  const blast=filterEquipment(data.equipments,{...emptyFilters,elements:['blastblight'],type:'great-sword'},data.skills);
  assert.ok(blast.every(e=>e.kind==='great-sword'&&e.specials?.some(s=>s.status==='blastblight')));
});
test('skill filters support multiple selected skills',()=>{
  const selected=['Critical Eye','Attack Boost'];
  const ids=new Set(data.skills.filter(s=>selected.includes(s.name)).map(s=>s.id));
  const pieces=filterEquipment(data.equipments,{...emptyFilters,skills:selected},data.skills);
  assert.ok(pieces.length>0);
  assert.ok(pieces.every(e=>[...e.skills.map(s=>s.id),...e.bonuses].some(id=>ids.has(id))));
});
test('skill levels cap and passive raw/affinity bonuses apply once',()=>{
  const attack=data.skills.find(s=>s.name==='Attack Boost')!,eye=data.skills.find(s=>s.name==='Critical Eye')!;
  const weapon:Equipment={...find('Hope Bow I'),skills:[{id:attack.id,level:9},{id:eye.id,level:5}]};
  const result=summarize(equip({},weapon),data.skills);
  assert.equal(result.activeSkills.find(s=>s.skill.id===attack.id)?.level,5);
  assert.equal(result.attack,102.6);assert.equal(result.affinity,20);
});
test('base and max stat views apply conditional affinity and attack bonuses',()=>{
  const agitator=data.skills.find(s=>s.name==='Agitator')!,weakness=data.skills.find(s=>s.name==='Weakness Exploit')!;
  const weapon:Equipment={...find('Hope Bow I'),skills:[{id:agitator.id,level:5},{id:weakness.id,level:5}]};
  const result=summarize(equip({},weapon),data.skills);
  assert.equal(result.baseStats.affinity,weapon.affinity??0);
  assert.equal(result.maxStats.affinity,Math.min(100,(weapon.affinity??0)+15+50));
  assert.ok(result.maxStats.attack>result.baseStats.attack);
});
test('custom charm supports armor and weapon slots without mixing their jewels',()=>{
  const charm:Equipment={...find('Golden Age Charm'),slots:[{kind:'weapon',level:2},{kind:'armor',level:1}],skills:[]};
  let build=equip({},charm);
  const weapon=data.decorations.find(d=>d.kind==='weapon'&&d.level===2)!;
  const armor=data.decorations.find(d=>d.kind==='armor'&&d.level===1)!;
  assert.equal(decorate(build,'charm',1,weapon),build);
  build=decorate(build,'charm',0,weapon);build=decorate(build,'charm',1,armor);
  assert.equal(summarize(build,data.skills).usedSlots,2);
});
test('five pieces sum defense and resistances without multiplying set data',()=>{
  const armor=data.equipments.filter(e=>e.name.startsWith('Conga ')&&e.name.endsWith('α'));
  let build:Build={};for(const e of armor)build=equip(build,e);
  const result=summarize(build,data.skills);
  assert.equal(result.baseDefense,armor.reduce((n,e)=>n+e.defense!.base,0));
  assert.equal(result.resistances.fire,armor.reduce((n,e)=>n+e.resistances!.fire,0));
});
