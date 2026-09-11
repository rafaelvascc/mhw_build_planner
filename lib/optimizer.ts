import { compatible, equip, decorate, summarize, type Build, type BuildSlot, type Catalog, type Decoration, type DecoSlot, type Equipment, type Skill, type SkillRef } from './planner.ts';

/**
 * Automatic build optimizer.
 *
 * Objective (deterministic, lexicographic — see `compareScore`):
 *   1..k  capped level of each selected skill, in selection (priority) order
 *   k+1   total capped level of all selected skills
 *   k+2   free decoration capacity left for the user (sum of empty slot levels)
 *   k+3   defense (base or catalog maximum, following the planner toggle)
 *   k+4   levels of non-selected skills carried by the equipment
 *
 * Strategy — a slot-by-slot dynamic programme with deferred decoration filling:
 *   1. Every optimizer slot (fixed weapons, charm, five armor pieces) gets a
 *      candidate list. Candidates are Pareto-pruned on (selected-skill vector,
 *      decoration slots, tie-breakers), which shrinks the catalog to the few
 *      dozen useful pieces per slot.
 *   2. States carry the capped skill vector plus a pool of empty decoration slots
 *      (counts per kind and level). Equivalent states merge, dominated states are
 *      dropped, and only if a stage still exceeds `beamWidth` is it truncated by a
 *      greedy decoration-fill estimate (beam fallback, reported as `approximate`).
 *   3. The best finalists get an exact decoration fill (small DP over the slot
 *      pool, decorations restricted to the selected skills) and the winner is
 *      materialised with `equip`/`decorate` so it obeys the planner data model.
 *   The search yields to the event loop periodically so the UI stays responsive.
 *
 * Set and group bonuses are not part of the score yet; see `optimizerLimitations`.
 * `vectorOf`/`compareScore` are the extension points for adding them.
 */

export const optimizerSlots = ['weapon','secondaryWeapon','charm','head','chest','arms','waist','legs'] as const satisfies readonly BuildSlot[];
export type OptimizerSlot = typeof optimizerSlots[number];
export const armorSlots = ['head','chest','arms','waist','legs'] as const satisfies readonly OptimizerSlot[];
export const fixedSlots = ['weapon','secondaryWeapon'] as const satisfies readonly OptimizerSlot[];
export const optimizerLimitations = ['Set and group bonuses are not part of the optimization score yet; pieces are chosen for their listed skills and decoration slots only.'] as const;

export interface OptimizerInput { build:Build; catalog:Catalog; skillIds:number[]; defenseMode?:'base'|'max' }
export interface OptimizerProgress { stage:'prepare'|'search'|'fill'|'finish'; slot?:OptimizerSlot; done:number; total:number; evaluated:number; states:number; merged:number }
export interface OptimizerOptions { beamWidth?:number; finalists?:number; fillBeamWidth?:number; signal?:AbortSignal; onProgress?:(progress:OptimizerProgress)=>void; yieldControl?:()=>Promise<void>; yieldEveryMs?:number }
export interface OptimizedSkill { skill:Skill; priority:number; level:number; max:number; capped:boolean }
export interface OptimizerPiece { slot:OptimizerSlot; equipment:Equipment; decorations:(Decoration|null)[]; fixed:boolean }
export interface OptimizerResult { build:Build; skills:OptimizedSkill[]; allCapped:boolean; pieces:OptimizerPiece[]; evaluated:number; candidates:Partial<Record<OptimizerSlot,number>>; approximate:boolean; unsupported:readonly string[]; message?:string }

export type OptimizerErrorCode = 'no-skills'|'unknown-skill'|'aborted';
export class OptimizerError extends Error {
  code:OptimizerErrorCode;
  constructor(code:OptimizerErrorCode,message:string) { super(message); this.name='OptimizerError'; this.code=code; }
}

const kinds = ['armor','weapon'] as const;
const maxSlotLevel = 3;
/** Empty-slot pool: counts indexed by kind order then level (armor 1..3, weapon 1..3). */
type Pool = number[];
interface Scored { vec:number[]; tie:number[] }
interface Candidate extends Scored { equipment:Equipment; pool:Pool }
interface Pick { slot:OptimizerSlot; candidate:Candidate }
interface State extends Scored { pool:Pool; prev:State|null; pick:Pick|null; estimate?:Scored }
interface Context { catalog:Catalog; index:Map<number,number>; maxes:number[]; defenseMode:'base'|'max'; decoOptions:Map<string,ScoredDecoration[]>; bestFor:Map<string,ScoredDecoration|null> }
interface ScoredDecoration extends Scored { decoration:Decoration }
interface Fill { vec:number[]; free:number; chosen:(ScoredDecoration|null)[]; slots:DecoSlot[]; approximate:boolean }

export const skillMax = (skill:Skill) => skill.ranks.length?Math.max(...skill.ranks.map(r=>r.level)):0;
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

/** Negative when `a` scores higher than `b`: priority skills in order, total, then tie-breakers. */
export function compareScore(a:Scored,b:Scored) {
  for(let i=0;i<a.vec.length;i++){ if(a.vec[i]!==b.vec[i]) return b.vec[i]-a.vec[i]; }
  const total=sum(b.vec)-sum(a.vec); if(total) return total;
  return compareTie(b.tie,a.tie);
}
function dominates(a:Scored,b:Scored) {
  for(let i=0;i<a.vec.length;i++){ if(a.vec[i]<b.vec[i]) return false; }
  return compareTie(a.tie,b.tie)>=0;
}

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
    .map(decoration=>({decoration,vec:vectorOf(decoration.skills,ctx.index,ctx.maxes),tie:[0]}))
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
    states=[...merged.values()].sort((a,b)=>compareScore({vec:a.vec,tie:[a.free]},{vec:b.vec,tie:[b.free]}));
    if(states.length>beamWidth){ states=states.slice(0,beamWidth); approximate=true; }
  }
  const best=states[0]; const chosen:(ScoredDecoration|null)[]=[];
  for(let s:FillState|null=best;s&&s.prev;s=s.prev) chosen.unshift(s.chosen);
  return {vec:best.vec,free:best.free,chosen,slots,approximate};
}

const defenseOf = (e:Equipment,mode:'base'|'max') => (e.defense?.[mode]??0)+(e.defenseBonus??0);
const otherLevels = (e:Equipment,index:Map<number,number>) => e.skills.reduce((n,s)=>index.has(s.id)?n:n+s.level,0);
const candidateOf = (ctx:Context,equipment:Equipment):Candidate => ({equipment,pool:poolOf(equipment.slots),vec:vectorOf(equipment.skills,ctx.index,ctx.maxes),tie:[defenseOf(equipment,ctx.defenseMode),otherLevels(equipment,ctx.index)]});
const candidateDominates = (a:Candidate,b:Candidate) => dominates(a,b)&&poolDominates(a.pool,b.pool);
const compareCandidates = (a:Candidate,b:Candidate) => compareScore(a,b)||poolValue(b.pool)-poolValue(a.pool)||sum(b.pool)-sum(a.pool)||a.equipment.id.localeCompare(b.equipment.id);

/** Equipment considered for a slot: the fixed weapons, forged charms plus the configured custom charm, or catalog armor. */
export function slotCandidates(build:Build,catalog:Catalog,slot:OptimizerSlot):Equipment[] {
  if(slot==='weapon'||slot==='secondaryWeapon'){ const e=build[slot]?.equipment; return e?[e]:[]; }
  if(slot==='charm'){
    const forged=catalog.equipments.filter(e=>e.slot==='charm'&&!e.random);
    const current=build.charm?.equipment;
    return current?.random?[current,...forged]:forged;
  }
  return catalog.equipments.filter(e=>e.slot===slot);
}

function keyEncoder(maxes:number[],slotCount:number) {
  const radices=[...maxes.map(m=>m+1),...zeros(kinds.length*maxSlotLevel).map(()=>slotCount+1)];
  const capacity=radices.reduce((n,r)=>n*r,1);
  if(capacity<=Number.MAX_SAFE_INTEGER) return (vec:number[],pool:Pool)=>{ let key=0; for(let i=0;i<vec.length;i++) key=key*radices[i]+vec[i]; for(let i=0;i<pool.length;i++) key=key*radices[vec.length+i]+pool[i]; return key; };
  return (vec:number[],pool:Pool)=>`${vec.join(',')}|${pool.join(',')}`;
}

const defaultYield = () => new Promise<void>(resolve=>setTimeout(resolve,0));
const now = () => (typeof performance!=='undefined'?performance.now():Date.now());

/** Materialises a search state plus its decoration fill into a planner `Build`. */
function materialize(state:State,fill:Fill):{build:Build;pieces:OptimizerPiece[]} {
  const picks:Pick[]=[]; for(let s:State|null=state;s;s=s.prev) if(s.pick) picks.unshift(s.pick);
  const queues=new Map<string,(Decoration|null)[]>();
  fill.slots.forEach((slot,i)=>{ const key=slotKey(slot); const queue=queues.get(key)??[]; queue.push(fill.chosen[i]?.decoration??null); queues.set(key,queue); });
  let build:Build={};
  for(const {slot,candidate} of picks){
    build=equip(build,candidate.equipment,slot);
    candidate.equipment.slots.forEach((target,i)=>{ const decoration=queues.get(slotKey(target))?.shift(); if(decoration) build=decorate(build,slot,i,decoration); });
  }
  const pieces=picks.map(({slot,candidate})=>({slot,equipment:candidate.equipment,decorations:build[slot]?.decorations??[],fixed:(fixedSlots as readonly string[]).includes(slot)}));
  return {build,pieces};
}

export async function optimizeBuild(input:OptimizerInput,options:OptimizerOptions={}):Promise<OptimizerResult> {
  const {build,catalog}=input; const defenseMode=input.defenseMode??'base';
  const skillIds=[...new Set(input.skillIds)];
  if(!skillIds.length) throw new OptimizerError('no-skills','Select at least one skill to optimize.');
  const skills=skillIds.map(id=>{ const skill=catalog.skills.find(s=>s.id===id); if(!skill) throw new OptimizerError('unknown-skill',`Skill ${id} is not in the catalog.`); return skill; });
  const maxes=skills.map(skillMax);
  const ctx:Context={catalog,index:new Map(skillIds.map((id,i)=>[id,i])),maxes,defenseMode,decoOptions:new Map(),bestFor:new Map()};
  const beamWidth=Math.max(1,options.beamWidth??8000),finalists=Math.max(1,options.finalists??24),fillBeamWidth=Math.max(1,options.fillBeamWidth??6000);
  const yieldEveryMs=options.yieldEveryMs??12,yieldControl=options.yieldControl??defaultYield;
  const checkAbort=()=>{ if(options.signal?.aborted) throw new OptimizerError('aborted','Optimization cancelled.'); };
  let evaluated=0,approximate=false,lastYield=now();
  const candidates:Partial<Record<OptimizerSlot,number>>={};
  const report=(stage:OptimizerProgress['stage'],done:number,states:number,merged:number,slot?:OptimizerSlot)=>options.onProgress?.({stage,slot,done,total:optimizerSlots.length+1,evaluated,states,merged});
  const maybeYield=async()=>{ checkAbort(); if(now()-lastYield>=yieldEveryMs){ await yieldControl(); lastYield=now(); checkAbort(); } };
  const estimateOf=(vec:number[],pool:Pool,tie:number[]):Scored=>{ const g=greedyEstimate(ctx,vec,pool); return {vec:g.vec,tie:[g.free,...tie]}; };

  report('prepare',0,1,1);
  const slotLists=optimizerSlots.map(slot=>{
    const raw=slotCandidates(build,catalog,slot);
    const scored=raw.map(e=>candidateOf(ctx,e)).sort(compareCandidates);
    return {slot,considered:raw.length,options:raw.length>1?paretoPrune(scored,candidateDominates,Infinity):scored};
  });
  const totalSlots=slotLists.reduce((n,l)=>n+Math.max(0,...l.options.map(o=>o.equipment.slots.length)),0);
  const encode=keyEncoder(maxes,totalSlots);
  const compareRaw=(a:State,b:State)=>compareScore(a,b)||poolValue(b.pool)-poolValue(a.pool)||sum(b.pool)-sum(a.pool);
  const compareEstimates=(a:State,b:State)=>compareScore(a.estimate!,b.estimate!)||compareRaw(a,b);
  const stateDominates=(a:State,b:State)=>dominates(a,b)&&poolDominates(a.pool,b.pool);
  const estimateAll=async(list:State[])=>{ let n=0; for(const state of list){ state.estimate??=estimateOf(state.vec,state.pool,state.tie); if((++n&2047)===0) await maybeYield(); } };

  let states:State[]=[{vec:zeros(maxes.length),tie:[0,0],pool:zeros(kinds.length*maxSlotLevel),prev:null,pick:null}];
  for(const [slotIndex,{slot,considered,options:slotOpts}] of slotLists.entries()){
    await maybeYield();
    if(!slotOpts.length) continue;
    candidates[slot]=considered;
    const merged=new Map<number|string,State>();
    for(const state of states){
      for(const candidate of slotOpts){
        evaluated++;
        const vec=capAdd(state.vec,candidate.vec,maxes),pool=addAll(state.pool,candidate.pool),tie=addAll(state.tie,candidate.tie),key=encode(vec,pool);
        const existing=merged.get(key);
        if(!existing||compareTie(tie,existing.tie)>0) merged.set(key,{vec,tie,pool,prev:state,pick:{slot,candidate}});
      }
      if((evaluated&2047)===0) await maybeYield();
    }
    let next=[...merged.values()];
    await estimateAll(next); next.sort(compareEstimates);
    if(next.length>beamWidth){ next=next.slice(0,beamWidth); approximate=true; }
    states=paretoPrune(next,stateDominates);
    report('search',slotIndex+1,states.length,merged.size,slot);
  }
  checkAbort();
  report('fill',optimizerSlots.length,states.length,states.length);
  let best:{state:State;fill:Fill;score:Scored}|null=null;
  for(const state of states.slice(0,finalists)){
    const fill=exactFill(ctx,state.vec,state.pool,fillBeamWidth);
    if(fill.approximate) approximate=true;
    const score:Scored={vec:fill.vec,tie:[fill.free,...state.tie]};
    if(!best||compareScore(score,best.score)<0) best={state,fill,score};
    await maybeYield();
  }
  const {build:optimized,pieces}=best?materialize(best.state,best.fill):{build:{},pieces:[]};
  const summary=summarize(optimized,catalog.skills,defenseMode);
  const result=skills.map((skill,priority)=>{ const max=maxes[priority]; const level=Math.min(max,summary.activeSkills.find(s=>s.skill.id===skill.id)?.total??0); return {skill,priority:priority+1,level,max,capped:level>=max}; });
  const missing=result.filter(s=>!s.capped);
  const message=missing.length?`${missing.map(s=>`${s.skill.name} ${s.level}/${s.max}`).join(', ')} could not be fully maximized with the fixed weapons and available equipment.`:undefined;
  report('finish',optimizerSlots.length+1,states.length,states.length);
  return {build:optimized,skills:result,allCapped:!missing.length,pieces,evaluated,candidates,approximate,unsupported:optimizerLimitations,message};
}

/** Replaces armor, charm and decorations with the optimized result while keeping both equipped weapons. */
export function applyOptimizedBuild(current:Build,result:OptimizerResult):Build {
  const next:Build={};
  for(const slot of fixedSlots){
    const entry=current[slot]; if(!entry) continue;
    const optimized=result.build[slot];
    next[slot]=optimized&&optimized.equipment.id===entry.equipment.id?optimized:entry;
  }
  for(const slot of ['charm',...armorSlots] as const){ const entry=result.build[slot]; if(entry) next[slot]=entry; }
  return next;
}
