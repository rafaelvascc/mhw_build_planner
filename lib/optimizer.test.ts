import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compatible, equip, decorate, summarize } from './planner.ts';
import type { Build, Catalog, Decoration, Equipment, Skill } from './planner.ts';
import { optimizeBuild, applyOptimizedBuild, slotCandidates, OptimizerError, optimizerLimitations, type OptimizerResult } from './optimizer.ts';

const data:Catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const find=(name:string)=>{const e=data.equipments.find(e=>e.name===name);assert.ok(e,name);return e;};
const skillId=(name:string)=>{const s=data.skills.find(s=>s.name===name);assert.ok(s,name);return s.id;};
const run=(build:Build,catalog:Catalog,skillIds:number[])=>optimizeBuild({build,catalog,skillIds},{yieldControl:async()=>{}});

/** Small deterministic catalog for priority, capping and compatibility rules. */
function syntheticCatalog():Catalog {
  const ranks=(max:number)=>Array.from({length:max},(_,i)=>({level:i+1,name:null,description:`Lv ${i+1}`,pieces:null}));
  const skills:Skill[]=[
    {id:1,name:'Alpha',kind:'armor',description:null,ranks:ranks(3)},
    {id:2,name:'Beta',kind:'armor',description:null,ranks:ranks(3)},
    {id:3,name:'Gamma',kind:'armor',description:null,ranks:ranks(1)},
    {id:4,name:'Omega',kind:'weapon',description:null,ranks:ranks(2)},
  ];
  const decorations:Decoration[]=[
    {id:1,name:'Alpha Jewel [1]',kind:'armor',level:1,rarity:3,skills:[{id:1,level:1}]},
    {id:2,name:'Beta Jewel [2]',kind:'armor',level:2,rarity:4,skills:[{id:2,level:1}]},
    {id:3,name:'Omega Jewel [1]',kind:'weapon',level:1,rarity:3,skills:[{id:4,level:1}]},
    {id:4,name:'Alpha Blade Jewel [3]',kind:'weapon',level:3,rarity:5,skills:[{id:1,level:1},{id:4,level:1}]},
  ];
  const piece=(id:string,slot:Equipment['slot'],name:string,skills:Equipment['skills'],slots:Equipment['slots'],defense:number,extra:Partial<Equipment>={}):Equipment=>({id,name,slot,kind:slot,rarity:5,description:'',slots,skills,bonuses:[],defense:{base:defense,max:defense+20},resistances:{},...extra});
  const equipments:Equipment[]=[
    piece('w-1','weapon','Test Sword',[],[{kind:'weapon',level:3},{kind:'weapon',level:1}],0,{kind:'great-sword',damage:{raw:100,display:480},affinity:0}),
    piece('w-2','weapon','Test Bow',[],[{kind:'weapon',level:1}],0,{kind:'bow',damage:{raw:90,display:180},affinity:0}),
    piece('h-a','head','Alpha Helm',[{id:1,level:2}],[],10),
    piece('h-b','head','Beta Helm',[{id:2,level:2}],[],10),
    piece('h-s','head','Slotted Helm',[],[{kind:'armor',level:1},{kind:'armor',level:1}],20),
    piece('h-g3','head','Gamma Helm III',[{id:3,level:3}],[],10),
    piece('h-g1','head','Gamma Helm I',[{id:3,level:1}],[],20),
    piece('c-a','chest','Alpha Mail',[{id:1,level:1}],[{kind:'armor',level:2}],10),
    piece('c-b','chest','Beta Mail',[{id:2,level:1}],[{kind:'armor',level:2}],10),
    piece('c-n','chest','Plain Mail',[],[],30),
    piece('a-n','arms','Plain Braces',[],[{kind:'armor',level:1}],5),
    piece('wa-n','waist','Plain Coil',[],[],5),
    piece('ch-a','charm','Alpha Charm',[{id:1,level:1}],[],0,{kind:'charm',defense:undefined}),
    piece('ch-b','charm','Beta Charm',[{id:2,level:2}],[],0,{kind:'charm',defense:undefined}),
    piece('ch-r','charm','Mystery Charm',[],[],0,{kind:'charm',defense:undefined,random:true}),
  ];
  return {version:'test',equipments,decorations,skills};
}
const level=(result:OptimizerResult,name:string)=>result.skills.find(s=>s.skill.name===name)!.level;

test('selection order defines skill priority',async()=>{
  const catalog=syntheticCatalog();
  catalog.decorations=catalog.decorations.filter(d=>d.name!=='Beta Jewel [2]');
  find_(catalog,'Plain Braces').slots=[];find_(catalog,'Beta Mail').slots=[];
  const alphaFirst=await run({},catalog,[1,2]);
  const betaFirst=await run({},catalog,[2,1]);
  assert.deepEqual(alphaFirst.skills.map(s=>[s.priority,s.skill.name,s.level]),[[1,'Alpha',3],[2,'Beta',2]]);
  assert.deepEqual(betaFirst.skills.map(s=>[s.priority,s.skill.name,s.level]),[[1,'Beta',3],[2,'Alpha',2]]);
  assert.ok(level(alphaFirst,'Alpha')>level(betaFirst,'Alpha'));
  assert.ok(level(betaFirst,'Beta')>level(alphaFirst,'Beta'));
});

test('skill levels are capped at the catalog maximum and excess is not rewarded',async()=>{
  const catalog=syntheticCatalog();
  const result=await run({},catalog,[3]);
  const gamma=result.skills[0];
  assert.equal(gamma.max,1);assert.equal(gamma.level,1);assert.equal(gamma.capped,true);
  assert.equal(result.build.head?.equipment.name,'Gamma Helm I','higher defense wins once the cap is reached');
  assert.equal(summarize(result.build,catalog.skills).activeSkills.find(s=>s.skill.id===3)?.level,1);
});

test('decorations respect slot kind and level compatibility',async()=>{
  const catalog=syntheticCatalog();
  const build=equip({},find_(catalog,'Test Sword'));
  const result=await run(build,catalog,[4,2,1]);
  for(const entry of Object.values(result.build)){
    entry!.decorations.forEach((d,i)=>{if(d)assert.ok(compatible(d,entry!.equipment.slots[i]),`${d.name} in ${entry!.equipment.name}`);});
  }
  assert.equal(result.build.weapon?.decorations.filter(Boolean).length,2,'both weapon slots hold weapon decorations');
  assert.ok(result.build.weapon?.decorations.every(d=>d?.kind==='weapon'));
  const armorDecorations=(['head','chest','arms','waist','legs'] as const).flatMap(slot=>result.build[slot]?.decorations??[]).filter((d):d is Decoration=>!!d);
  assert.ok(armorDecorations.every(d=>d.kind==='armor'));
  assert.ok(!result.build.arms?.decorations.some(d=>d?.name==='Beta Jewel [2]'),'a level 2 jewel never enters the level 1 arm slot');
  assert.equal(level(result,'Omega'),2);
});

test('the configured custom charm is a candidate with its skills and slots preserved',async()=>{
  const base=data.equipments.find(e=>e.slot==='charm'&&e.random)!;
  const weakness=skillId('Weakness Exploit');
  const custom:Equipment={...base,skills:[{id:weakness,level:5}],slots:[{kind:'armor',level:3},{kind:'weapon',level:2}]};
  const result=await run(equip({},custom),data,[weakness,skillId('Agitator')]);
  const charm=result.build.charm?.equipment;
  assert.equal(charm?.id,base.id);assert.equal(charm?.random,true);
  assert.deepEqual(charm?.skills,custom.skills);assert.deepEqual(charm?.slots,custom.slots);
  assert.equal(result.build.charm?.decorations.length,2);
  const candidates=slotCandidates(equip({},custom),data,'charm');
  assert.equal(candidates.filter(e=>e.random).length,1);
  assert.equal(candidates[0].skills[0].level,5);
});

test('random charm templates are excluded unless configured in the build',async()=>{
  const charms=slotCandidates({},data,'charm');
  assert.ok(charms.length>0);
  assert.ok(charms.every(e=>!e.random&&e.slot==='charm'));
  assert.equal(charms.length,data.equipments.filter(e=>e.slot==='charm'&&!e.random).length);
  const result=await run({},data,[skillId('Constitution')]);
  assert.equal(result.build.charm?.equipment.random,false);
  const synthetic=await run({},syntheticCatalog(),[1]);
  assert.notEqual(synthetic.build.charm?.equipment.name,'Mystery Charm');
});

test('primary and secondary weapons stay fixed and weapon decorations stay compatible',async()=>{
  const primary=find('Hope Bow IV');
  const secondary=data.equipments.find(e=>e.slot==='weapon'&&e.id!==primary.id&&e.slots.some(s=>s.level===3))!;
  const build=equip(equip({},primary),secondary,'secondaryWeapon');
  const result=await run(build,data,[skillId('Attack Boost'),skillId('Critical Eye')]);
  assert.equal(result.build.weapon?.equipment.id,primary.id);
  assert.equal(result.build.secondaryWeapon?.equipment.id,secondary.id);
  assert.equal(result.pieces.filter(p=>p.fixed).length,2);
  for(const slot of ['weapon','secondaryWeapon'] as const){
    const entry=result.build[slot]!;
    entry.decorations.forEach((d,i)=>{if(d)assert.ok(compatible(d,entry.equipment.slots[i]));});
  }
  assert.ok(result.build.secondaryWeapon?.decorations.some(Boolean),'secondary weapon slots are used');
  assert.ok((['head','chest','arms','waist','legs'] as const).every(slot=>result.build[slot]));
});

test('applying the result replaces armor, charm and decorations while keeping both weapons',async()=>{
  const primary=find('Hope Bow IV');
  const secondary=data.equipments.find(e=>e.slot==='weapon'&&e.id!==primary.id&&e.slots.length>0)!;
  const jewel=data.decorations.find(d=>d.kind==='weapon'&&d.level<=secondary.slots[0].level)!;
  let current=equip(equip({},primary),secondary,'secondaryWeapon');
  current=decorate(current,'secondaryWeapon',0,jewel);
  current=equip(current,find('Conga Helm α'));
  current=equip(current,find('Windproof Charm I'));
  const result=await run(equip({},primary),data,[skillId('Weakness Exploit')]);
  const applied=applyOptimizedBuild(current,result);
  assert.equal(applied.weapon?.equipment.id,primary.id);
  assert.deepEqual(applied.weapon?.decorations,result.build.weapon?.decorations);
  assert.equal(applied.secondaryWeapon?.equipment.id,secondary.id,'a weapon missing from the result stays untouched');
  assert.equal(applied.secondaryWeapon?.decorations[0]?.id,jewel.id);
  assert.notEqual(applied.head?.equipment.id,'armor-1');
  assert.equal(applied.head?.equipment.id,result.build.head?.equipment.id);
  assert.equal(applied.charm?.equipment.id,result.build.charm?.equipment.id);
  assert.equal(summarize(applied,data.skills).activeSkills.find(s=>s.skill.name==='Weakness Exploit')?.level,5);
});

test('no selected skills is rejected with a clear error',async()=>{
  await assert.rejects(run({},data,[]),(error:unknown)=>error instanceof OptimizerError&&error.code==='no-skills');
  await assert.rejects(run({},data,[999999]),(error:unknown)=>error instanceof OptimizerError&&error.code==='unknown-skill');
});

test('an aborted signal stops the search with an aborted error',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(optimizeBuild({build:{},catalog:data,skillIds:[skillId('Constitution')]},{signal:controller.signal}),(error:unknown)=>error instanceof OptimizerError&&error.code==='aborted');
});

test('skills that cannot be maximized are reported without failing',async()=>{
  const catalog=syntheticCatalog();
  catalog.decorations=catalog.decorations.filter(d=>d.name!=='Alpha Jewel [1]');
  catalog.equipments=catalog.equipments.filter(e=>e.name!=='Alpha Mail'&&e.name!=='Alpha Charm');
  const result=await run({},catalog,[1,3]);
  assert.equal(result.allCapped,false);
  assert.equal(level(result,'Alpha'),2);
  assert.match(result.message??'',/Alpha 2\/3/);
  assert.equal(result.skills[1].capped,false,'Gamma only comes from helmets, which the higher-priority Alpha already uses');
  assert.match(result.message??'',/Gamma 0\/1/);
  assert.equal(result.build.head?.equipment.name,'Alpha Helm');
  assert.deepEqual(result.unsupported,optimizerLimitations);
});

test('incomplete builds and partial catalogs do not break the search',async()=>{
  const catalog=syntheticCatalog();
  const noWeapons=await run({},catalog,[1]);
  assert.equal(noWeapons.build.weapon,undefined);assert.equal(noWeapons.build.legs,undefined);
  assert.equal(level(noWeapons,'Alpha'),3);
  assert.ok(noWeapons.evaluated>0);
  assert.deepEqual(Object.keys(noWeapons.candidates).sort(),['arms','charm','chest','head','waist']);
  const withBow=await run(equip({},find_(catalog,'Test Bow')),catalog,[4]);
  assert.equal(withBow.build.weapon?.decorations[0]?.name,'Omega Jewel [1]');
});

test('results are deterministic across runs',async()=>{
  const build=equip({},find('Hope Bow IV'));
  const ids=[skillId('Weakness Exploit'),skillId('Agitator'),skillId('Constitution'),skillId('Evade Window')];
  const first=await run(build,data,ids),second=await run(build,data,ids);
  const shape=(r:OptimizerResult)=>r.pieces.map(p=>`${p.slot}:${p.equipment.id}:${p.decorations.map(d=>d?.id??0).join('/')}`);
  assert.deepEqual(shape(first),shape(second));
  assert.deepEqual(first.skills.map(s=>s.level),second.skills.map(s=>s.level));
  assert.ok(first.skills.every(s=>s.capped));
});

function find_(catalog:Catalog,name:string) { const e=catalog.equipments.find(e=>e.name===name); assert.ok(e,name); return e; }
