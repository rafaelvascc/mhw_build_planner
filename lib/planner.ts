export const slots = ['weapon','secondaryWeapon','head','chest','arms','waist','legs','charm'] as const;
export type EquipmentSlot = Exclude<typeof slots[number], 'secondaryWeapon'>;
export type BuildSlot = typeof slots[number];
export type SlotKind = 'weapon'|'armor';
export interface SkillRef { id:number; level:number }
export interface Skill { id:number; name:string; kind:string; description:string|null; ranks:{level:number;name:string|null;description:string;pieces:number|null}[] }
export interface DecoSlot { level:number; kind:SlotKind }
export interface Decoration { id:number; name:string; kind:SlotKind; level:number; rarity:number; skills:SkillRef[]; icon?:{color:string;colorId:number} }
export const elements = ['fire','water','thunder','ice','dragon'] as const;
export interface Equipment { id:string; name:string; slot:EquipmentSlot; kind:string; rarity:number; description:string; slots:DecoSlot[]; skills:SkillRef[]; bonuses:number[]; defense?:{base:number;max:number}; resistances?:Record<string,number>; damage?:{raw:number;display:number}; affinity?:number; defenseBonus?:number; specials?:{kind:string;element?:string;status?:string;damage:{raw:number;display:number}}[]; sharpness?:Record<string,number>; series?:string; random?:boolean; customizable?:boolean }
export interface Catalog { version:string; equipments:Equipment[]; decorations:Decoration[]; skills:Skill[] }
export interface Equipped { equipment:Equipment; decorations:(Decoration|null)[] }
export type Build = Partial<Record<BuildSlot,Equipped>>;
export const labels:Record<BuildSlot,string> = {weapon:'Primary weapon',secondaryWeapon:'Secondary weapon',head:'Helmet',chest:'Chest armor',arms:'Gloves',waist:'Waist',legs:'Pants',charm:'Charm'};
export const weaponTypes:Record<string,string> = {'great-sword':'Great Sword','long-sword':'Long Sword','sword-shield':'Sword & Shield','dual-blades':'Dual Blades',hammer:'Hammer','hunting-horn':'Hunting Horn',lance:'Lance',gunlance:'Gunlance','switch-axe':'Switch Axe','charge-blade':'Charge Blade','insect-glaive':'Insect Glaive','light-bowgun':'Light Bowgun','heavy-bowgun':'Heavy Bowgun',bow:'Bow'};
export const compatible = (d:Decoration,s:DecoSlot)=>d.kind===s.kind&&d.level<=s.level;
export function equip(build:Build,equipment:Equipment,targetSlot:BuildSlot=equipment.slot):Build {
  const old=build[targetSlot];
  return {...build,[targetSlot]:{equipment,decorations:equipment.slots.map((s,i)=>old?.decorations[i]&&compatible(old.decorations[i]!,s)?old.decorations[i]:null)}};
}
export function decorate(build:Build,slot:BuildSlot,index:number,decoration:Decoration|null):Build {
  const entry=build[slot],target=entry?.equipment.slots[index];
  if(!entry||!target||(decoration&&!compatible(decoration,target)))return build;
  return {...build,[slot]:{...entry,decorations:entry.decorations.map((d,i)=>i===index?decoration:d)}};
}
export interface Filters {name:string;skill:string;skills:string[];minRarity:string;maxRarity:string;minCount:string;maxCount:string;minLevel:string;maxLevel:string;type:string;elements:string[];rarity?:string;count?:string;level?:string}
export const emptyFilters:Filters={name:'',skill:'',skills:[],minRarity:'any',maxRarity:'any',minCount:'any',maxCount:'any',minLevel:'any',maxLevel:'any',type:'any',elements:[]};
const normalized=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
export interface SkillMatch { skill:Skill; byName:boolean; snippet?:string }
/** Skills whose name contains the query first (alphabetical), then skills whose description, rank names or rank descriptions contain it. Accent- and case-insensitive. */
export function searchSkills(skills:Skill[],query:string):SkillMatch[] {
  const q=normalized(query.trim());
  const sorted=[...skills].sort((a,b)=>a.name.localeCompare(b.name));
  if(!q) return sorted.map(skill=>({skill,byName:true}));
  const byName:SkillMatch[]=[],byText:SkillMatch[]=[];
  for(const skill of sorted){
    if(normalized(skill.name).includes(q)){ byName.push({skill,byName:true}); continue; }
    const snippet=[skill.description??'',...skill.ranks.flatMap(r=>[r.name??'',r.description])].find(text=>normalized(text).includes(q));
    if(snippet!=null) byText.push({skill,byName:false,snippet});
  }
  return [...byName,...byText];
}
export function filterEquipment(items:Equipment[],f:Filters,skills:Skill[]) {
  const names=new Map(skills.map(s=>[s.id,normalized(s.name)]));
  const minRarity=f.minRarity==='any'?(f.rarity&&f.rarity!=='any'?+f.rarity:1):+f.minRarity;
  const maxRarity=f.maxRarity==='any'?99:+f.maxRarity;
  const minCount=f.minCount==='any'?(f.count&&f.count!=='any'?+f.count:0):+f.minCount;
  const maxCount=f.maxCount==='any'?(f.count&&f.count!=='any'?+f.count:99):+f.maxCount;
  const minLevel=f.minLevel==='any'?(f.level&&f.level!=='any'?+f.level:0):+f.minLevel;
  const skillQueries=f.skills?.length?f.skills.map(normalized):(f.skill?f.skill.split('||').map(normalized).filter(Boolean):[]);
  const maxLevel=f.maxLevel==='any'?99:+f.maxLevel;
  return items.filter(e=>normalized(e.name).includes(normalized(f.name))&&(!skillQueries.length||skillQueries.some(query=>[...e.skills.map(s=>s.id),...e.bonuses].some(id=>names.get(id)?.includes(query))))&&e.rarity>=minRarity&&e.rarity<=maxRarity&&(f.type==='any'||e.kind===f.type)&&e.slots.length>=minCount&&e.slots.length<=maxCount&&(minLevel===0||e.slots.some(s=>s.level>=minLevel&&s.level<=maxLevel))&&(!f.elements?.length||e.specials?.some(s=>f.elements.includes(s.element??s.status??''))));
}
export function summarize(build:Build,skills:Skill[],defenseMode:'base'|'max'='base') {
  const totals=new Map<number,number>(),pieces=new Map<number,number>();
  const add=(r:SkillRef)=>totals.set(r.id,(totals.get(r.id)??0)+r.level);
  let baseDefense=0,totalSlots=0,usedSlots=0;
  const resistances:Record<string,number>=Object.fromEntries(elements.map(e=>[e,0]));
  for(const entry of Object.values(build)) {
    if(!entry)continue;
    const e=entry.equipment;e.skills.forEach(add);
    new Set(e.bonuses).forEach(id=>pieces.set(id,(pieces.get(id)??0)+1));
    baseDefense+=(e.defense?.[defenseMode]??0)+(e.defenseBonus??0);
    elements.forEach(el=>resistances[el]+=e.resistances?.[el]??0);totalSlots+=e.slots.length;
    entry.decorations.forEach((d,i)=>{if(d&&e.slots[i]&&compatible(d,e.slots[i])){d.skills.forEach(add);usedSlots++;}});
  }
  const activeSkills=skills.filter(s=>totals.has(s.id)).map(skill=>{const total=totals.get(skill.id)!;const max=Math.max(...skill.ranks.map(r=>r.level));const level=Math.min(total,max);return {skill,total,max,level,rank:skill.ranks.find(r=>r.level===level)};}).sort((a,b)=>b.level-a.level||a.skill.name.localeCompare(b.skill.name));
  const bonuses=skills.filter(s=>pieces.has(s.id)).map(skill=>{const count=pieces.get(skill.id)!;const ranks=skill.ranks.filter(r=>r.pieces!=null).sort((a,b)=>a.level-b.level);return {skill,count,ranks,active:ranks.filter(r=>count>=r.pieces!).at(-1)};});
  const level=(name:string)=>activeSkills.find(s=>s.skill.name===name)?.level??0;
  const bonus=(name:string,values:number[])=>{const rank=level(name);return rank>0?values[Math.min(rank,values.length)-1]??0:0;};
  const w=build.weapon?.equipment,a=level('Attack Boost'),d=level('Defense Boost');
  const attack=w?(w.damage?.raw??0)*[1,1,1,1,1.02,1.04][a]+[0,3,5,7,8,9][a]:0;
  const conditionalAttackFlat=bonus('Agitator',[4,8,12,16,20])+bonus('Foray',[6,8,10,12,15])+bonus('Peak Performance',[3,6,10,15,20])+bonus('Adrenaline Rush',[10,15,20,25,30])+bonus('Resentment',[5,10,15,20,25])+bonus('Counterstrike',[10,15,25])+bonus('Punishing Draw',[3,5,7])+bonus("Doshaguma's Might",[10,25])+bonus("Ebony Odogaron's Power",[8,18]);
  const conditionalAttackPercent=(bonus('Offensive Guard',[5,10,15])+bonus('Ambush',[5,10,15])+bonus('Heroics',[0,5,5,10,30]))/100;
  const maxAttack=(attack+conditionalAttackFlat)*(1+conditionalAttackPercent);
  let defense=baseDefense*[1,1,1,1.05,1.05,1.08,1.08,1.1][d]+[0,5,10,10,20,20,35,35][d];
  const maxDefense=defense+bonus('Heroics',[0,50,50,100,100]);
  elements.forEach(el=>{const l=level(`${el[0].toUpperCase()}${el.slice(1)} Resistance`);resistances[el]+=[0,6,12,20][l]+[0,0,0,0,3,3,5,5][d];if(l===3)defense+=10;});
  const baseAffinity=w?Math.min(100,(w.affinity??0)+level('Critical Eye')*4):0;
  const conditionalAffinity=bonus('Agitator',[3,5,7,10,15])+bonus('Weakness Exploit',[8,15,25,35,50])+bonus('Maximum Might',[10,20,30])+bonus('Latent Power',[10,20,30,40,50])+bonus('Foray',[0,5,10,15,20])+bonus('Slicked Blade',[7,14,21])+bonus('Critical Draw',[50,75,100])+bonus('Antivirus',[3,6,10]);
  const baseStats={attack:Math.round(attack*10)/10,displayAttack:w?.damage?.raw?Math.round(attack*w.damage.display/w.damage.raw):0,affinity:baseAffinity,defense:Math.floor(defense)};
  const maxStats={attack:Math.round(maxAttack*10)/10,displayAttack:w?.damage?.raw?Math.round(maxAttack*w.damage.display/w.damage.raw):0,affinity:w?Math.min(100,baseAffinity+conditionalAffinity):0,defense:Math.floor(maxDefense)};
  return {attack:baseStats.attack,displayAttack:baseStats.displayAttack,affinity:baseStats.affinity,defense:baseStats.defense,baseStats,maxStats,baseDefense,resistances,activeSkills,bonuses,totalSlots,usedSlots,equippedCount:Object.keys(build).length};
}
