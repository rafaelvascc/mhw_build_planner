import { compatible, equip, decorate, summarize, weaponTypes, type Build, type BuildSlot, type Catalog, type Decoration, type DecoSlot, type Equipment, type Skill, type SkillRef } from './planner.ts';

/**
 * Automatic build optimizer.
 *
 * Objective (deterministic, lexicographic — see `compareScore`):
 *   1..b  achieved level of each selected set/group bonus, capped at the level the
 *         user asked for, in selection (priority) order — bonuses outrank skills
 *   b+1..b+k  capped level of each selected skill, in selection order
 *   then  total capped level of all selected skills
 *   then  tie-breakers: weapon attack, free decoration capacity left for the user
 *         (sum of empty slot levels), defense (base or catalog maximum, following
 *         the planner toggle), levels of non-selected skills carried by equipment
 *
 * Strategy — a slot-by-slot dynamic programme with deferred decoration filling:
 *   1. Every optimizer slot (weapons, charm, five armor pieces) gets a candidate
 *      list. Weapons stay fixed unless a selected bonus is carried by a weapon of
 *      the equipped type, in which case those weapons are suggested as well.
 *      Candidates are Pareto-pruned on (bonus pieces, selected-skill vector,
 *      decoration slots, tie-breakers), which shrinks the catalog to the few
 *      dozen useful pieces per slot.
 *   2. States carry bonus piece counts (capped at the pieces the target level
 *      needs), the capped skill vector and a pool of empty decoration slots
 *      (counts per kind and level). Equivalent states merge, dominated states are
 *      dropped, and only if a stage still exceeds `beamWidth` is it truncated by a
 *      greedy decoration-fill estimate (beam fallback, reported as `approximate`).
 *   3. The best finalists get an exact decoration fill (small DP over the slot
 *      pool, decorations restricted to the selected skills) and the winner is
 *      materialised with `equip`/`decorate` so it obeys the planner data model.
 *   The search yields to the event loop periodically so the UI stays responsive.
 */

export const optimizerSlots = ['weapon','secondaryWeapon','charm','head','chest','arms','waist','legs'] as const satisfies readonly BuildSlot[];
export type OptimizerSlot = typeof optimizerSlots[number];
export const armorSlots = ['head','chest','arms','waist','legs'] as const satisfies readonly OptimizerSlot[];
export const weaponSlots = ['weapon','secondaryWeapon'] as const satisfies readonly OptimizerSlot[];
export const bonusKinds = ['set','group'] as const;

export interface BonusTarget { id:number; level:number; /** The equipped weapon contributes one piece toward this bonus (for example, a Gogmazios weapon's random set bonus). */ weaponHasSkill?:boolean }
export interface OptimizerInput { build:Build; catalog:Catalog; skillIds:number[]; bonuses?:BonusTarget[]; defenseMode?:'base'|'max'; /** Equipment ids the player does not own; never chosen (equipped weapons are always kept). */ excludeIds?:Iterable<string> }
export interface OptimizerProgress { stage:'prepare'|'search'|'fill'|'finish'; slot?:OptimizerSlot; done:number; total:number; evaluated:number; states:number; merged:number }
export interface OptimizerOptions { beamWidth?:number; finalists?:number; fillBeamWidth?:number; signal?:AbortSignal; onProgress?:(progress:OptimizerProgress)=>void; yieldControl?:()=>Promise<void>; yieldEveryMs?:number }
export interface OptimizedSkill { skill:Skill; priority:number; level:number; max:number; capped:boolean }
export interface OptimizedBonus { skill:Skill; priority:number; target:number; level:number; max:number; pieces:number; piecesNeeded:number; weaponHasSkill:boolean; reached:boolean }
export interface OptimizerPiece { slot:OptimizerSlot; equipment:Equipment; decorations:(Decoration|null)[]; fixed:boolean; suggested:boolean }
export interface OptimizerResult { build:Build; bonuses:OptimizedBonus[]; skills:OptimizedSkill[]; allCapped:boolean; pieces:OptimizerPiece[]; evaluated:number; candidates:Partial<Record<OptimizerSlot,number>>; approximate:boolean; notes:string[]; message?:string }

export type OptimizerErrorCode = 'no-skills'|'unknown-skill'|'unknown-bonus'|'aborted';
export class OptimizerError extends Error {
  code:OptimizerErrorCode;
  constructor(code:OptimizerErrorCode,message:string) { super(message); this.name='OptimizerError'; this.code=code; }
}

const kinds = ['armor','weapon'] as const;
const maxSlotLevel = 3;
/** Empty-slot pool: counts indexed by kind order then level (armor 1..3, weapon 1..3). */
type Pool = number[];
/** `rank` = bonus levels reached (priority first), `vec` = capped selected-skill levels, `tie` = tie-breakers. */
interface Scored { rank:number[]; vec:number[]; tie:number[] }
interface Candidate extends Scored { equipment:Equipment; bonus:number[]; pool:Pool }
interface Pick { slot:OptimizerSlot; candidate:Candidate }
interface State extends Scored { bonus:number[]; pool:Pool; prev:State|null; pick:Pick|null; estimate?:Scored }
interface BonusSpec { skill:Skill; target:number; needed:number; weaponHasSkill:boolean; ranks:{level:number;pieces:number}[] }
interface Context { catalog:Catalog; index:Map<number,number>; maxes:number[]; bonusIndex:Map<number,number>; bonusSpecs:BonusSpec[]; defenseMode:'base'|'max'; decoOptions:Map<string,ScoredDecoration[]>; bestFor:Map<string,ScoredDecoration|null> }
interface ScoredDecoration extends Scored { decoration:Decoration }
interface Fill { vec:number[]; free:number; chosen:(ScoredDecoration|null)[]; slots:DecoSlot[]; approximate:boolean }

export const skillMax = (skill:Skill) => skill.ranks.length?Math.max(...skill.ranks.map(r=>r.level)):0;
/** Piece-count ranks of a set/group bonus, lowest first. */
export const bonusRanks = (skill:Skill) => skill.ranks.filter(r=>r.pieces!=null).map(r=>({level:r.level,pieces:r.pieces!,name:r.name})).sort((a,b)=>a.level-b.level);
/** Highest bonus level whose piece requirement `count` satisfies, capped at `cap`. */
const bonusLevel = (ranks:{level:number;pieces:number}[],count:number,cap:number) => ranks.reduce((best,r)=>count>=r.pieces&&r.level<=cap?Math.max(best,r.level):best,0);
const zeros = (n:number) => new Array<number>(n).fill(0);
const sum = (v:number[]) => v.reduce((n,x)=>n+x,0);
const compareTie = (a:number[],b:number[]) => { for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) return a[i]-b[i]; } return 0; };
const capAdd = (a:number[],b:number[],maxes:number[]) => a.map((x,i)=>Math.min(maxes[i],x+b[i]));
const addAll = (a:number[],b:number[]) => a.map((x,i)=>x+b[i]);
const poolIndex = (slot:DecoSlot) => kinds.indexOf(slot.kind)*maxSlotLevel+Math.min(maxSlotLevel,Math.max(1,slot.level))-1;
const poolOf = (slots:DecoSlot[]):Pool => { const pool=zeros(kinds.length*maxSlotLevel); for(const slot of slots) if(slot.level>0) pool[poolIndex(slot)]++; return pool; };
const poolValue = (pool:Pool) => pool.reduce((n,count,i)=>n+count*(i%maxSlotLevel+1),0);
/** True when every slot counted in `b` fits into a distinct slot of `a` (same kind, level at least as high). */
function poolDominates(a:Pool,b:Pool) {
  for(let kind=0;kind<kinds.length;kind++){
    let ca=0,cb=0;
    for(let level=maxSlotLevel-1;level>=0;level--){ ca+=a[kind*maxSlotLevel+level]; cb+=b[kind*maxSlotLevel+level]; if(ca<cb) return false; }
  }
  return true;
}

/** Sums the levels of the selected skills carried by `refs`, capped per skill. */
export function vectorOf(refs:SkillRef[],index:Map<number,number>,maxes:number[]) {
  const vec=zeros(maxes.length);
  for(const ref of refs){ const i=index.get(ref.id); if(i!=null) vec[i]=Math.min(maxes[i],vec[i]+ref.level); }
  return vec;
}
/** Counts each selected bonus once per piece, like `summarize`, capped at the pieces its target level needs. */
function bonusCountsOf(ctx:Context,equipment:Equipment) {
  const counts=zeros(ctx.bonusSpecs.length);
  for(const id of new Set(equipment.bonuses)){ const i=ctx.bonusIndex.get(id); if(i!=null) counts[i]=Math.min(ctx.bonusSpecs[i].needed,counts[i]+1); }
  return counts;
}
const rankOf = (ctx:Context,bonus:number[]) => bonus.map((count,i)=>bonusLevel(ctx.bonusSpecs[i].ranks,count,ctx.bonusSpecs[i].target));

/** Negative when `a` scores higher than `b`: bonus levels, priority skills in order, skill total, then tie-breakers. */
export function compareScore(a:Scored,b:Scored) {
  for(let i=0;i<a.rank.length;i++){ if(a.rank[i]!==b.rank[i]) return b.rank[i]-a.rank[i]; }
  for(let i=0;i<a.vec.length;i++){ if(a.vec[i]!==b.vec[i]) return b.vec[i]-a.vec[i]; }
  const total=sum(b.vec)-sum(a.vec); if(total) return total;
  return compareTie(b.tie,a.tie);
}
function dominates(a:Scored,b:Scored) {
  for(let i=0;i<a.rank.length;i++){ if(a.rank[i]<b.rank[i]) return false; }
  for(let i=0;i<a.vec.length;i++){ if(a.vec[i]<b.vec[i]) return false; }
  return compareTie(a.tie,b.tie)>=0;
}
const countsDominate = (a:number[],b:number[]) => a.every((x,i)=>x>=b[i]);

/** Keeps entries that no earlier kept entry dominates. Callers sort by score first so dominant entries tend to come first. */
function paretoPrune<T extends Scored>(sorted:T[],isDominated:(a:T,b:T)=>boolean=dominates,checkLimit=1500) {
  const kept:T[]=[];
  for(const item of sorted){
    let dominated=false;
    for(let i=0;i<kept.length&&i<checkLimit;i++){ if(isDominated(kept[i],item)){ dominated=true; break; } }
    if(!dominated) kept.push(item);
  }
  return kept;
}

const slotKey = (slot:DecoSlot) => `${slot.kind}:${slot.level}`;
/** Non-dominated decorations that carry a selected skill and fit the slot. */
function decorationOptions(ctx:Context,slot:DecoSlot):ScoredDecoration[] {
  const key=slotKey(slot); const cached=ctx.decoOptions.get(key); if(cached) return cached;
  const scored:ScoredDecoration[]=ctx.catalog.decorations.filter(d=>compatible(d,slot)&&d.skills.some(s=>ctx.index.has(s.id)))
    .map(decoration=>({decoration,rank:[],vec:vectorOf(decoration.skills,ctx.index,ctx.maxes),tie:[0]}))
    .sort((a,b)=>compareScore(a,b)||a.decoration.level-b.decoration.level||a.decoration.id-b.decoration.id);
  const options=paretoPrune(scored,dominates,Infinity);
  ctx.decoOptions.set(key,options); return options;
}
/** Best decoration for one selected skill in a slot of the given kind and level, or null when none fits. */
function bestDecorationFor(ctx:Context,kind:typeof kinds[number],level:number,skillIndex:number) {
  const key=`${kind}:${level}:${skillIndex}`; const cached=ctx.bestFor.get(key); if(cached!==undefined) return cached;
  const best=decorationOptions(ctx,{kind,level}).filter(d=>d.vec[skillIndex]>0).sort((a,b)=>b.vec[skillIndex]-a.vec[skillIndex]||sum(b.vec)-sum(a.vec)||a.decoration.id-b.decoration.id)[0]??null;
  ctx.bestFor.set(key,best); return best;
}

/** Fast lower bound of the fill value: smallest fitting slot first, priority skills first. Used for beam ranking. */
function greedyEstimate(ctx:Context,vec:number[],pool:Pool):{vec:number[];free:number} {
  const counts=[...pool],current=[...vec],maxes=ctx.maxes;
  for(let i=0;i<maxes.length;i++){
    while(current[i]<maxes[i]){
      let placed=false;
      for(let level=1;level<=maxSlotLevel&&!placed;level++) for(let kind=0;kind<kinds.length;kind++){
        const p=kind*maxSlotLevel+level-1; if(!counts[p]) continue;
        const best=bestDecorationFor(ctx,kinds[kind],level,i); if(!best) continue;
        counts[p]--; for(let j=0;j<maxes.length;j++) current[j]=Math.min(maxes[j],current[j]+best.vec[j]); placed=true; break;
      }
      if(!placed) break;
    }
  }
  return {vec:current,free:poolValue(counts)};
}

/** Exact decoration fill for a slot pool: DP over slots keyed by capped skill vector, keeping the most free capacity. */
function exactFill(ctx:Context,vec:number[],pool:Pool,beamWidth:number):Fill {
  const slots:DecoSlot[]=[];
  for(let kind=0;kind<kinds.length;kind++) for(let level=maxSlotLevel;level>=1;level--) for(let n=0;n<pool[kind*maxSlotLevel+level-1];n++) slots.push({kind:kinds[kind],level});
  interface FillState { vec:number[]; free:number; prev:FillState|null; chosen:ScoredDecoration|null }
  let states:FillState[]=[{vec,free:0,prev:null,chosen:null}];
  let approximate=false;
  for(const slot of slots){
    const options=decorationOptions(ctx,slot);
    const merged=new Map<string,FillState>();
    for(const state of states){
      const keep=(next:FillState)=>{ const key=next.vec.join(','); const existing=merged.get(key); if(!existing||next.free>existing.free) merged.set(key,next); };
      keep({vec:state.vec,free:state.free+slot.level,prev:state,chosen:null});
      for(const option of options){
        if(!option.vec.some((x,i)=>x>0&&state.vec[i]<ctx.maxes[i])) continue;
        keep({vec:capAdd(state.vec,option.vec,ctx.maxes),free:state.free,prev:state,chosen:option});
      }
    }
    states=[...merged.values()].sort((a,b)=>compareScore({rank:[],vec:a.vec,tie:[a.free]},{rank:[],vec:b.vec,tie:[b.free]}));
    if(states.length>beamWidth){ states=states.slice(0,beamWidth); approximate=true; }
  }
  const best=states[0]; const chosen:(ScoredDecoration|null)[]=[];
  for(let s:FillState|null=best;s&&s.prev;s=s.prev) chosen.unshift(s.chosen);
  return {vec:best.vec,free:best.free,chosen,slots,approximate};
}

const defenseOf = (e:Equipment,mode:'base'|'max') => (e.defense?.[mode]??0)+(e.defenseBonus??0);
const attackOf = (e:Equipment) => e.damage?.raw??0;
const otherLevels = (e:Equipment,index:Map<number,number>) => e.skills.reduce((n,s)=>index.has(s.id)?n:n+s.level,0);
/** Tie-breakers carried by a piece: attack, defense, non-selected skill levels (free capacity is added at fill time). */
const tieOf = (ctx:Context,e:Equipment) => [attackOf(e),defenseOf(e,ctx.defenseMode),otherLevels(e,ctx.index)];
function candidateOf(ctx:Context,equipment:Equipment):Candidate {
  const bonus=bonusCountsOf(ctx,equipment);
  return {equipment,bonus,rank:rankOf(ctx,bonus),pool:poolOf(equipment.slots),vec:vectorOf(equipment.skills,ctx.index,ctx.maxes),tie:tieOf(ctx,equipment)};
}
const candidateDominates = (a:Candidate,b:Candidate) => countsDominate(a.bonus,b.bonus)&&dominates(a,b)&&poolDominates(a.pool,b.pool);
const compareCandidates = (a:Candidate,b:Candidate) => compareScore(a,b)||sum(b.bonus)-sum(a.bonus)||poolValue(b.pool)-poolValue(a.pool)||sum(b.pool)-sum(a.pool)||a.equipment.id.localeCompare(b.equipment.id);

/** Weapons of the same type as the one equipped in `slot` that carry a selected bonus. Empty slots never receive a weapon. */
export function bonusWeapons(build:Build,catalog:Catalog,slot:'weapon'|'secondaryWeapon',bonusIds:Iterable<number>) {
  const ids=new Set(bonusIds); const current=build[slot]?.equipment;
  if(!ids.size||!current) return [];
  return catalog.equipments.filter(e=>e.slot==='weapon'&&e.id!==current.id&&e.kind===current.kind&&e.bonuses.some(id=>ids.has(id)));
}

/** Equipment considered for a slot: the equipped weapon plus bonus-carrying weapons of its type, the configured custom charm (fixed) or forged charms, and catalog armor. Excluded ids are dropped everywhere except fixed weapons and a fixed custom charm. */
export function slotCandidates(build:Build,catalog:Catalog,slot:OptimizerSlot,bonusIds:Iterable<number>=[],excludeIds:Iterable<string>=[]):Equipment[] {
  const excluded=new Set(excludeIds);
  if(slot==='weapon'||slot==='secondaryWeapon'){
    const current=build[slot]?.equipment;
    const suggestions=bonusWeapons(build,catalog,slot,bonusIds).filter(e=>!excluded.has(e.id));
    return current?[current,...suggestions]:suggestions;
  }
  if(slot==='charm'){
    const current=build.charm?.equipment;
    if(current?.random) return [current];
    return catalog.equipments.filter(e=>e.slot==='charm'&&!e.random&&!excluded.has(e.id));
  }
  return catalog.equipments.filter(e=>e.slot===slot&&!excluded.has(e.id));
}

function keyEncoder(bonusNeeds:number[],maxes:number[],slotCount:number) {
  const radices=[...bonusNeeds.map(n=>n+1),...maxes.map(m=>m+1),...zeros(kinds.length*maxSlotLevel).map(()=>slotCount+1)];
  const capacity=radices.reduce((n,r)=>n*r,1);
  if(capacity<=Number.MAX_SAFE_INTEGER) return (bonus:number[],vec:number[],pool:Pool)=>{ let key=0,i=0; for(const x of bonus) key=key*radices[i++]+x; for(const x of vec) key=key*radices[i++]+x; for(const x of pool) key=key*radices[i++]+x; return key; };
  return (bonus:number[],vec:number[],pool:Pool)=>`${bonus.join(',')}|${vec.join(',')}|${pool.join(',')}`;
}

const defaultYield = () => new Promise<void>(resolve=>setTimeout(resolve,0));
const now = () => (typeof performance!=='undefined'?performance.now():Date.now());

/** Materialises a search state plus its decoration fill into a planner `Build`. */
function materialize(state:State,fill:Fill,current:Build):{build:Build;pieces:OptimizerPiece[]} {
  const picks:Pick[]=[]; for(let s:State|null=state;s;s=s.prev) if(s.pick) picks.unshift(s.pick);
  const queues=new Map<string,(Decoration|null)[]>();
  fill.slots.forEach((slot,i)=>{ const key=slotKey(slot); const queue=queues.get(key)??[]; queue.push(fill.chosen[i]?.decoration??null); queues.set(key,queue); });
  let build:Build={};
  for(const {slot,candidate} of picks){
    build=equip(build,candidate.equipment,slot);
    candidate.equipment.slots.forEach((target,i)=>{ const decoration=queues.get(slotKey(target))?.shift(); if(decoration) build=decorate(build,slot,i,decoration); });
  }
  const pieces=picks.map(({slot,candidate})=>{
    const isWeapon=(weaponSlots as readonly string[]).includes(slot);
    const fixed=(isWeapon&&current[slot]?.equipment.id===candidate.equipment.id)||(slot==='charm'&&current.charm?.equipment.random===true&&current.charm.equipment.id===candidate.equipment.id);
    return {slot,equipment:candidate.equipment,decorations:build[slot]?.decorations??[],fixed,suggested:isWeapon&&!fixed};
  });
  return {build,pieces};
}

export async function optimizeBuild(input:OptimizerInput,options:OptimizerOptions={}):Promise<OptimizerResult> {
  const {build,catalog}=input; const defenseMode=input.defenseMode??'base';
  const skillIds=[...new Set(input.skillIds)];
  const targets=(input.bonuses??[]).filter((t,i,all)=>all.findIndex(o=>o.id===t.id)===i);
  if(!skillIds.length&&!targets.length) throw new OptimizerError('no-skills','Select at least one skill or set bonus to optimize.');
  const skills=skillIds.map(id=>{ const skill=catalog.skills.find(s=>s.id===id); if(!skill) throw new OptimizerError('unknown-skill',`Skill ${id} is not in the catalog.`); return skill; });
  const bonusSpecs:BonusSpec[]=targets.map(t=>{
    const skill=catalog.skills.find(s=>s.id===t.id); const ranks=skill?bonusRanks(skill):[];
    if(!skill||!ranks.length) throw new OptimizerError('unknown-bonus',`Bonus ${t.id} is not a set or group bonus in the catalog.`);
    const rank=ranks.find(r=>r.level===t.level); if(!rank) throw new OptimizerError('unknown-bonus',`${skill.name} has no level ${t.level}.`);
    return {skill,target:t.level,needed:rank.pieces,weaponHasSkill:t.weaponHasSkill===true,ranks};
  });
  const maxes=skills.map(skillMax);
  const ctx:Context={catalog,index:new Map(skillIds.map((id,i)=>[id,i])),maxes,bonusIndex:new Map(targets.map((t,i)=>[t.id,i])),bonusSpecs,defenseMode,decoOptions:new Map(),bestFor:new Map()};
  const beamWidth=Math.max(1,options.beamWidth??8000),finalists=Math.max(1,options.finalists??24),fillBeamWidth=Math.max(1,options.fillBeamWidth??6000);
  const yieldEveryMs=options.yieldEveryMs??12,yieldControl=options.yieldControl??defaultYield;
  const checkAbort=()=>{ if(options.signal?.aborted) throw new OptimizerError('aborted','Optimization cancelled.'); };
  let evaluated=0,approximate=false,lastYield=now();
  const candidates:Partial<Record<OptimizerSlot,number>>={};
  const notes:string[]=[];
  const report=(stage:OptimizerProgress['stage'],done:number,states:number,merged:number,slot?:OptimizerSlot)=>options.onProgress?.({stage,slot,done,total:optimizerSlots.length+1,evaluated,states,merged});
  const maybeYield=async()=>{ checkAbort(); if(now()-lastYield>=yieldEveryMs){ await yieldControl(); lastYield=now(); checkAbort(); } };
  const estimateOf=(state:State):Scored=>{ const g=greedyEstimate(ctx,state.vec,state.pool); return {rank:state.rank,vec:g.vec,tie:[state.tie[0],g.free,...state.tie.slice(1)]}; };

  report('prepare',0,1,1);
  const bonusIds=targets.map(t=>t.id);
  const slotLists=optimizerSlots.map(slot=>{
    const raw=slotCandidates(build,catalog,slot,bonusIds,input.excludeIds??[]);
    const scored=raw.map(e=>candidateOf(ctx,e)).sort(compareCandidates);
    return {slot,considered:raw.length,options:raw.length>1?paretoPrune(scored,candidateDominates,Infinity):scored};
  });
  if(targets.length){
    const excluded=new Set(input.excludeIds??[]);
    const weaponCount=weaponSlots.reduce((n,slot)=>n+bonusWeapons(build,catalog,slot,bonusIds).filter(e=>!excluded.has(e.id)).length,0);
    const kindNames=[...new Set(weaponSlots.map(slot=>build[slot]?.equipment.kind).filter((k):k is string=>!!k))].map(k=>weaponTypes[k]??k);
    notes.push(!kindNames.length?'No weapon is equipped, so no weapon was suggested for the selected bonuses.':weaponCount?`${weaponCount} ${kindNames.join(' / ')} weapon${weaponCount===1?'':'s'} carrying a selected bonus ${weaponCount===1?'was':'were'} considered as a replacement.`:`No ${kindNames.join(' or ')} in the catalog grants a selected bonus, so the equipped weapons stayed fixed.`);
  }
  const totalSlots=slotLists.reduce((n,l)=>n+Math.max(0,...l.options.map(o=>o.equipment.slots.length)),0);
  const encode=keyEncoder(bonusSpecs.map(b=>b.needed),maxes,totalSlots);
  const compareRaw=(a:State,b:State)=>compareScore(a,b)||sum(b.bonus)-sum(a.bonus)||poolValue(b.pool)-poolValue(a.pool)||sum(b.pool)-sum(a.pool);
  const compareEstimates=(a:State,b:State)=>compareScore(a.estimate!,b.estimate!)||compareRaw(a,b);
  /** Bonus pieces the slots after `slotIndex` can still add, per selected bonus. */
  const supplyAfter=slotLists.map((_,slotIndex)=>bonusSpecs.map((spec,i)=>Math.min(spec.needed,slotLists.slice(slotIndex+1).reduce((n,l)=>n+Math.max(0,...l.options.map(o=>o.bonus[i])),0))));
  /** Beam order for intermediate stages: a bonus level still reachable later outranks everything, then the fewest
   *  pieces still missing for it, then the usual score. Keeps partial sets alive until the last slot can complete them. */
  const compareBeam=(slotIndex:number)=>{
    const supply=supplyAfter[slotIndex];
    const potential=(state:State)=>bonusSpecs.map((spec,i)=>bonusLevel(spec.ranks,Math.min(spec.needed,state.bonus[i]+supply[i]),spec.target));
    const deficit=(state:State,reach:number[])=>bonusSpecs.map((spec,i)=>reach[i]>state.rank[i]?spec.needed-state.bonus[i]:0);
    return (a:State,b:State)=>{
      const ra=potential(a),rb=potential(b);
      for(let i=0;i<ra.length;i++){ if(ra[i]!==rb[i]) return rb[i]-ra[i]; }
      const da=deficit(a,ra),db=deficit(b,rb);
      for(let i=0;i<da.length;i++){ if(da[i]!==db[i]) return da[i]-db[i]; }
      return compareEstimates(a,b);
    };
  };
  const stateDominates=(a:State,b:State)=>countsDominate(a.bonus,b.bonus)&&dominates(a,b)&&poolDominates(a.pool,b.pool);
  const estimateAll=async(list:State[])=>{ let n=0; for(const state of list){ state.estimate??=estimateOf(state); if((++n&2047)===0) await maybeYield(); } };

  const startingBonus=bonusSpecs.map(spec=>spec.weaponHasSkill?1:0);
  let states:State[]=[{bonus:startingBonus,rank:rankOf(ctx,startingBonus),vec:zeros(maxes.length),tie:[0,0,0],pool:zeros(kinds.length*maxSlotLevel),prev:null,pick:null}];
  for(const [slotIndex,{slot,considered,options:slotOpts}] of slotLists.entries()){
    await maybeYield();
    if(!slotOpts.length) continue;
    candidates[slot]=considered;
    const merged=new Map<number|string,State>();
    for(const state of states){
      for(const candidate of slotOpts){
        evaluated++;
        const bonus=bonusSpecs.length?state.bonus.map((x,i)=>Math.min(bonusSpecs[i].needed,x+candidate.bonus[i])):state.bonus;
        const vec=capAdd(state.vec,candidate.vec,maxes),pool=addAll(state.pool,candidate.pool),tie=addAll(state.tie,candidate.tie),key=encode(bonus,vec,pool);
        const existing=merged.get(key);
        if(!existing||compareTie(tie,existing.tie)>0) merged.set(key,{bonus,rank:bonusSpecs.length?rankOf(ctx,bonus):state.rank,vec,tie,pool,prev:state,pick:{slot,candidate}});
      }
      if((evaluated&2047)===0) await maybeYield();
    }
    let next=[...merged.values()];
    await estimateAll(next); next.sort(bonusSpecs.length?compareBeam(slotIndex):compareEstimates);
    if(next.length>beamWidth){ next=next.slice(0,beamWidth); approximate=true; }
    states=paretoPrune(next,stateDominates);
    report('search',slotIndex+1,states.length,merged.size,slot);
  }
  checkAbort();
  states.sort(compareEstimates);
  report('fill',optimizerSlots.length,states.length,states.length);
  let best:{state:State;fill:Fill;score:Scored}|null=null;
  for(const state of states.slice(0,finalists)){
    const fill=exactFill(ctx,state.vec,state.pool,fillBeamWidth);
    if(fill.approximate) approximate=true;
    const score:Scored={rank:state.rank,vec:fill.vec,tie:[state.tie[0],fill.free,...state.tie.slice(1)]};
    if(!best||compareScore(score,best.score)<0) best={state,fill,score};
    await maybeYield();
  }
  const {build:optimized,pieces}=best?materialize(best.state,best.fill,build):{build:{},pieces:[]};
  const summary=summarize(optimized,catalog.skills,defenseMode);
  const bonuses:OptimizedBonus[]=bonusSpecs.map((spec,priority)=>{
    const entry=summary.bonuses.find(b=>b.skill.id===spec.skill.id);
    const pieces=(entry?.count??0)+(spec.weaponHasSkill?1:0),level=bonusLevel(spec.ranks,pieces,Infinity);
    return {skill:spec.skill,priority:priority+1,target:spec.target,level,max:spec.ranks.at(-1)!.level,pieces,piecesNeeded:spec.needed,weaponHasSkill:spec.weaponHasSkill,reached:level>=spec.target};
  });
  const result:OptimizedSkill[]=skills.map((skill,priority)=>{ const max=maxes[priority]; const level=Math.min(max,summary.activeSkills.find(s=>s.skill.id===skill.id)?.total??0); return {skill,priority:priority+1,level,max,capped:level>=max}; });
  const missingBonuses=bonuses.filter(b=>!b.reached),missing=result.filter(s=>!s.capped);
  const parts=[...missingBonuses.map(b=>`${b.skill.name} Lv ${b.level}/${b.target} (${b.pieces}/${b.piecesNeeded} pieces)`),...missing.map(s=>`${s.skill.name} ${s.level}/${s.max}`)];
  const message=parts.length?`${parts.join(', ')} could not be fully reached with the available equipment.`:undefined;
  report('finish',optimizerSlots.length+1,states.length,states.length);
  return {build:optimized,bonuses,skills:result,allCapped:!parts.length,pieces,evaluated,candidates,approximate,notes,message};
}

/** Replaces armor, charm, decorations and any suggested weapon with the optimized result; weapons absent from the result stay as they are. */
export function applyOptimizedBuild(current:Build,result:OptimizerResult):Build {
  const next:Build={};
  for(const slot of weaponSlots){ const entry=result.build[slot]??current[slot]; if(entry) next[slot]=entry; }
  for(const slot of ['charm',...armorSlots] as const){ const entry=result.build[slot]; if(entry) next[slot]=entry; }
  return next;
}
