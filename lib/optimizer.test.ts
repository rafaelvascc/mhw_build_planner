import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compatible, equip, decorate, summarize } from './planner.ts';
import type { Build, Catalog, Decoration, Equipment, Skill } from './planner.ts';
import { optimizeBuild, applyOptimizedBuild, slotCandidates, bonusWeapons, OptimizerError, type BonusTarget, type OptimizerResult } from './optimizer.ts';

const data:Catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const find=(name:string)=>{const e=data.equipments.find(e=>e.name===name);assert.ok(e,name);return e;};
const skillId=(name:string)=>{const s=data.skills.find(s=>s.name===name);assert.ok(s,name);return s.id;};
const run=(build:Build,catalog:Catalog,skillIds:number[],bonuses:BonusTarget[]=[])=>optimizeBuild({build,catalog,skillIds,bonuses},{yieldControl:async()=>{}});

/** Small deterministic catalog for priority, capping and compatibility rules. */
function syntheticCatalog():Catalog {
  const ranks=(max:number)=>Array.from({length:max},(_,i)=>({level:i+1,name:null,description:`Lv ${i+1}`,pieces:null}));
  const skills:Skill[]=[
    {id:1,name:'Alpha',kind:'armor',description:null,ranks:ranks(3)},
    {id:2,name:'Beta',kind:'armor',description:null,ranks:ranks(3)},
    {id:3,name:'Gamma',kind:'armor',description:null,ranks:ranks(1)},
    {id:4,name:'Omega',kind:'weapon',description:null,ranks:ranks(2)},
    {id:5,name:"Sigma's Will",kind:'set',description:null,ranks:[{level:1,name:'Sigma I',description:'',pieces:2},{level:2,name:'Sigma II',description:'',pieces:4}]},
    {id:6,name:"Tau's Favor",kind:'group',description:null,ranks:[{level:1,name:'Tau',description:'',pieces:3}]},
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
    piece('h-sig','head','Sigma Helm',[],[],8,{bonuses:[5]}),
    piece('c-sig','chest','Sigma Mail',[],[],8,{bonuses:[5,6]}),
    piece('a-sig','arms','Sigma Braces',[],[],4,{bonuses:[5]}),
    piece('a-tau','arms','Tau Braces',[],[],4,{bonuses:[6]}),
    piece('wa-tau','waist','Tau Coil',[],[],4,{bonuses:[6]}),
    piece('w-sig','weapon','Sigma Sword',[],[{kind:'weapon',level:1}],0,{kind:'great-sword',damage:{raw:90,display:430},affinity:0,bonuses:[5]}),
    piece('w-sigbow','weapon','Sigma Bow',[],[],0,{kind:'bow',damage:{raw:80,display:160},affinity:0,bonuses:[5]}),
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

test('the configured custom charm is fixed with its skills and slots preserved',async()=>{
  const base=data.equipments.find(e=>e.slot==='charm'&&e.random)!;
  const weakness=skillId('Weakness Exploit');
  const custom:Equipment={...base,skills:[{id:weakness,level:5}],slots:[{kind:'armor',level:3},{kind:'weapon',level:2}]};
  const result=await run(equip({},custom),data,[weakness,skillId('Agitator')]);
  const charm=result.build.charm?.equipment;
  assert.equal(charm?.id,base.id);assert.equal(charm?.random,true);
  assert.deepEqual(charm?.skills,custom.skills);assert.deepEqual(charm?.slots,custom.slots);
  assert.equal(result.build.charm?.decorations.length,2);
  const candidates=slotCandidates(equip({},custom),data,'charm');
  assert.deepEqual(candidates.map(e=>e.id),[custom.id]);
  assert.equal(candidates[0].skills[0].level,5);
  assert.equal(result.pieces.find(piece=>piece.slot==='charm')?.fixed,true);
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

test('set bonus targets honour the chosen level and outrank skills',async()=>{
  const catalog=syntheticCatalog();
  const skillsOnly=await run({},catalog,[1]);
  assert.equal(level(skillsOnly,'Alpha'),3);
  const levelOne=await run({},catalog,[1],[{id:5,level:1}]);
  assert.deepEqual(levelOne.bonuses.map(b=>[b.skill.name,b.priority,b.target,b.level,b.pieces,b.reached]),[["Sigma's Will",1,1,1,2,true]]);
  assert.equal(levelOne.allCapped,true);
  assert.equal(level(levelOne,'Alpha'),3,'two Sigma pieces still leave room for Alpha 3');
  assert.equal(Object.values(levelOne.build).filter(e=>e?.equipment.bonuses.includes(5)).length,2);
  assert.equal(levelOne.build.weapon,undefined,'no weapon is invented for an empty slot');
  const levelTwo=await run({},catalog,[1],[{id:5,level:2}]);
  assert.equal(levelTwo.bonuses[0].level,1,'only three armor pieces exist without a weapon');
  assert.equal(levelTwo.bonuses[0].reached,false);
  assert.equal(levelTwo.bonuses[0].pieces,2,'a third piece would not raise the level, so skills win the tie');
  assert.equal(level(levelTwo,'Alpha'),3);
  assert.match(levelTwo.message??'',/Sigma's Will Lv 1\/2 \(2\/4 pieces\)/);
  assert.equal(levelTwo.allCapped,false);
  assert.match(levelTwo.notes[0],/No weapon is equipped/);
});

test('even mode favors a balanced spread without sacrificing total skill points',async()=>{
  const catalog=syntheticCatalog(),template=find_(catalog,'Alpha Helm');
  catalog.decorations=[];
  catalog.equipments=[
    {...template,id:'h-focused',name:'Focused Helm',skills:[{id:1,level:3},{id:2,level:1}]},
    {...template,id:'h-balanced',name:'Balanced Helm',skills:[{id:1,level:2},{id:2,level:2}]},
  ];
  const priority=await optimizeBuild({build:{},catalog,skillIds:[1,2],mode:'priority'},{yieldControl:async()=>{}});
  const even=await optimizeBuild({build:{},catalog,skillIds:[1,2],mode:'even'},{yieldControl:async()=>{}});
  assert.equal(priority.build.head?.equipment.name,'Focused Helm');
  assert.deepEqual(priority.skills.map(skill=>skill.level),[3,1]);
  assert.equal(even.build.head?.equipment.name,'Balanced Helm');
  assert.deepEqual(even.skills.map(skill=>skill.level),[2,2]);
});

test('a weapon-provided set bonus reduces required equipment pieces by one',async()=>{
  const catalog=syntheticCatalog();
  const result=await run({},catalog,[1],[{id:5,level:2,weaponHasSkill:true}]);
  assert.equal(result.bonuses[0].level,2);
  assert.equal(result.bonuses[0].reached,true);
  assert.equal(result.bonuses[0].pieces,4);
  assert.equal(result.bonuses[0].piecesNeeded,4);
  assert.equal(result.bonuses[0].weaponHasSkill,true);
  assert.equal(Object.values(result.build).filter(e=>e?.equipment.bonuses.includes(5)).length,3,'three equipment pieces plus the weapon contribution reach four');
});

test('bonuses are ranked in selection order before skills',async()=>{
  const catalog=syntheticCatalog();
  const sigmaFirst=await run({},catalog,[],[{id:5,level:1},{id:6,level:1}]);
  const tauFirst=await run({},catalog,[],[{id:6,level:1},{id:5,level:1}]);
  assert.deepEqual(sigmaFirst.bonuses.map(b=>[b.skill.name,b.level]),[["Sigma's Will",1],["Tau's Favor",1]]);
  assert.deepEqual(tauFirst.bonuses.map(b=>[b.skill.name,b.level]),[["Tau's Favor",1],["Sigma's Will",1]]);
  assert.deepEqual(sigmaFirst.skills,[]);
  assert.equal(sigmaFirst.build.chest?.equipment.name,'Sigma Mail','the shared piece counts once for each bonus');
});

test('weapons carrying a selected bonus are suggested only for the equipped weapon type',async()=>{
  const catalog=syntheticCatalog();
  const sword=find_(catalog,'Test Sword');
  assert.deepEqual(bonusWeapons(equip({},sword),catalog,'weapon',[5]).map(e=>e.name),['Sigma Sword']);
  assert.deepEqual(bonusWeapons({},catalog,'weapon',[5]),[],'empty weapon slots get no suggestions');
  assert.deepEqual(bonusWeapons(equip({},sword),catalog,'weapon',[]),[]);
  const needsWeapon=await run(equip({},sword),catalog,[1],[{id:5,level:2}]);
  assert.equal(needsWeapon.build.weapon?.equipment.name,'Sigma Sword');
  assert.equal(needsWeapon.build.secondaryWeapon,undefined);
  assert.equal(needsWeapon.bonuses[0].level,2);assert.equal(needsWeapon.bonuses[0].pieces,4);
  assert.equal(level(needsWeapon,'Alpha'),1,'the bonus outranks the skill even though it costs Alpha levels');
  const weaponPiece=needsWeapon.pieces.find(p=>p.slot==='weapon')!;
  assert.equal(weaponPiece.fixed,false);assert.equal(weaponPiece.suggested,true);
  assert.match(needsWeapon.notes[0],/1 Great Sword weapon carrying a selected bonus was considered/);
  const keepsWeapon=await run(equip({},sword),catalog,[],[{id:5,level:1}]);
  assert.equal(keepsWeapon.build.weapon?.equipment.name,'Test Sword','the equipped weapon wins when the bonus does not need it');
  assert.equal(keepsWeapon.pieces.find(p=>p.slot==='weapon')?.fixed,true);
  const bow=find_(catalog,'Test Bow');
  const bowBuild=await run(equip({},bow),catalog,[],[{id:5,level:2}]);
  assert.equal(bowBuild.build.weapon?.equipment.name,'Sigma Bow','a bow is never replaced by a great sword');
});

test('applying a result with a suggested weapon replaces the primary weapon',async()=>{
  const catalog=syntheticCatalog();
  catalog.equipments=catalog.equipments.filter(e=>e.name!=='Sigma Bow');
  const current=equip(equip({},find_(catalog,'Test Sword')),find_(catalog,'Test Bow'),'secondaryWeapon');
  const result=await run(current,catalog,[],[{id:5,level:2}]);
  const applied=applyOptimizedBuild(current,result);
  assert.equal(applied.weapon?.equipment.name,'Sigma Sword');
  assert.equal(applied.secondaryWeapon?.equipment.name,'Test Bow');
});

test('real catalog set bonuses reach the requested level and report missing weapon support',async()=>{
  const rey=data.skills.find(s=>s.name==="Rey Dau's Voltage")!;
  const result=await run(equip({},find('Hope Bow IV')),data,[skillId('Constitution')],[{id:rey.id,level:2}]);
  assert.equal(result.bonuses[0].level,2);assert.ok(result.bonuses[0].pieces>=4);assert.equal(result.bonuses[0].reached,true);
  assert.equal(summarize(result.build,data.skills).bonuses.find(b=>b.skill.id===rey.id)?.active?.level,2);
  assert.equal(result.build.weapon?.equipment.name,'Hope Bow IV');
  assert.match(result.notes[0],/No Bow in the catalog grants a selected bonus/);
  await assert.rejects(run({},data,[],[{id:rey.id,level:9}]),(error:unknown)=>error instanceof OptimizerError&&error.code==='unknown-bonus');
  await assert.rejects(run({},data,[],[{id:skillId('Constitution'),level:1}]),(error:unknown)=>error instanceof OptimizerError&&error.code==='unknown-bonus');
});

test('a narrow beam keeps partial sets alive until the last slot can complete them',async()=>{
  const catalog=syntheticCatalog();
  const sword=find_(catalog,'Test Sword');
  for(const beamWidth of [1,2,8]){
    const result=await optimizeBuild({build:equip({},sword),catalog,skillIds:[1,2],bonuses:[{id:5,level:2}]},{yieldControl:async()=>{},beamWidth});
    assert.equal(result.bonuses[0].level,2,`beam ${beamWidth}`);assert.equal(result.bonuses[0].pieces,4);
    assert.equal(result.build.weapon?.equipment.name,'Sigma Sword');
  }
});

test('excluded equipment is never chosen and the search continues with the next best pieces',async()=>{
  const weapon=find('Hope Bow IV');
  const ids=[skillId('Weakness Exploit'),skillId('Agitator')];
  const first=await optimizeBuild({build:equip({},weapon),catalog:data,skillIds:ids},{yieldControl:async()=>{}});
  const excluded=[first.build.head!.equipment.id,first.build.charm!.equipment.id];
  const second=await optimizeBuild({build:equip({},weapon),catalog:data,skillIds:ids,excludeIds:excluded},{yieldControl:async()=>{}});
  for(const entry of Object.values(second.build)) assert.ok(!excluded.includes(entry!.equipment.id),entry!.equipment.name);
  assert.equal(second.build.weapon?.equipment.id,weapon.id);
  assert.ok(second.build.head&&second.build.charm);
  assert.ok(slotCandidates({},data,'head',[],excluded).every(e=>!excluded.includes(e.id)));
  assert.equal(slotCandidates({},data,'head',[],excluded).length,data.equipments.filter(e=>e.slot==='head').length-1);
  const catalog=syntheticCatalog();
  const sword=find_(catalog,'Test Sword');
  const noSigmaSword=await optimizeBuild({build:equip({},sword),catalog,skillIds:[],bonuses:[{id:5,level:2}],excludeIds:['w-sig']},{yieldControl:async()=>{}});
  assert.equal(noSigmaSword.build.weapon?.equipment.name,'Test Sword','an ignored suggested weapon is no longer suggested');
  assert.equal(noSigmaSword.bonuses[0].level,1,'without the weapon the 4-piece level is out of reach');assert.ok(noSigmaSword.bonuses[0].pieces<4);
  const stillEquipped=await optimizeBuild({build:equip({},sword),catalog,skillIds:[1],excludeIds:['w-1']},{yieldControl:async()=>{}});
  assert.equal(stillEquipped.build.weapon?.equipment.name,'Test Sword','the equipped weapon is never dropped');
  const base=data.equipments.find(e=>e.slot==='charm'&&e.random)!;
  const custom:Equipment={...base,skills:[{id:skillId('Weakness Exploit'),level:5}],slots:[]};
  const fixedCustom=await optimizeBuild({build:equip({},custom),catalog:data,skillIds:[skillId('Weakness Exploit')],excludeIds:[base.id]},{yieldControl:async()=>{}});
  assert.equal(fixedCustom.build.charm?.equipment.id,base.id,'an equipped custom charm stays fixed even if its template id was previously ignored');
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
  assert.deepEqual(result.bonuses,[]);
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
