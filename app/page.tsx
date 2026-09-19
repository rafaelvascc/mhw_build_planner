'use client';

import { useEffect, useMemo, useRef, useState, type SVGProps } from 'react';
import { Swords, Plus, Shield, Gem, ChevronRight, ChevronDown, X, Search, SlidersHorizontal, Flame, Droplets, Zap, Snowflake, Orbit, Skull, Bomb, Sparkles, CircleHelp, Check, RotateCcw, Copy, ArrowUp, ArrowDown, LoaderCircle, Ban } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { SkillDescriptions, SkillName } from '@/components/skill-name';
import { EquipmentIcon, DecorationIcon, DecorationSlotIcon, rarityStyle } from '@/components/equipment-icon';
import { slots, labels, weaponTypes, elements, emptyFilters, filterEquipment, searchSkills, compatible, equip, decorate, summarize, type Skill, type EquipmentSlot, type BuildSlot, type Build, type Catalog, type Equipment, type Filters, type SkillRef, type DecoSlot } from '@/lib/planner';
import { decodeBuild, encodeBuild } from '@/lib/build-url';
import { useSessionState } from '@/hooks/use-session-state';
import { optimizeBuild, applyOptimizedBuild, bonusRanks, bonusKinds, OptimizerError, type OptimizerResult, type OptimizerProgress } from '@/lib/optimizer';


function DragonHeadIcon({size=24, strokeWidth=1.8, ...props}: SVGProps<SVGSVGElement> & {size?:number|string}) {
  return <svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-hidden'] ?? true}>
    <path d="m6.6 8.1-2.4-3.7 4 1.2L10.4 3l1.6 2.1L13.6 3l2.2 2.6 4-1.2-2.4 3.7c.6 1 .9 2.2.9 3.4 0 3.5-2.7 6.3-6.1 6.3s-6.1-2.8-6.1-6.3c0-1.2.3-2.4.9-3.4Z" />
    <path d="M8.7 12.1h.01M15.3 12.1h.01M9.2 15.2c1.7 1.1 3.9 1.1 5.6 0M12 15.9v2M7.4 14.5l-1.8 1.7M16.6 14.5l1.8 1.7" />
  </svg>;
}
const elementIcons = { fire:Flame, water:Droplets, thunder:Zap, ice:Snowflake, dragon:DragonHeadIcon };
const attributeIcons = { fire:Flame, ice:Snowflake, water:Droplets, thunder:Zap, dragon:DragonHeadIcon, poison:Skull, blastblight:Bomb, paralysis:Sparkles } as const;
const weaponAttributes = [
  ['fire','Fire','element-fire'], ['ice','Ice','element-ice'], ['water','Water','element-water'], ['thunder','Thunder','element-thunder'], ['dragon','Dragon','element-dragon'],
  ['poison','Poison','status-poison'], ['blastblight','Blast','status-blast'], ['paralysis','Paralysis','status-paralysis'],
] as const;
type WeaponAttribute = keyof typeof attributeIcons;
const attributeMeta = new Map(weaponAttributes.map(([key,label,className])=>[key,{label,className,Icon:attributeIcons[key]}] as const));
const weaponAttributeKeys = (equipment:Equipment):WeaponAttribute[] => [...new Set((equipment.specials??[]).map(s=>s.element??s.status).filter((value): value is WeaponAttribute=>Boolean(value && value in attributeIcons)))];
const sharpnessColors:Record<string,string> = {red:'#c65353',orange:'#d8954f',yellow:'#d1c56c',green:'#75a47f',blue:'#6a92be',white:'#e5e5e5',purple:'#ac85c7'};
function WeaponRowStats({weapon}:{weapon:Equipment}) {
  const sharpness=Object.entries(weapon.sharpness??{}).filter(([,value])=>value>0);
  return <div className="weapon-row-stats" aria-label={`${weapon.name} combat stats`}>
    <span className="weapon-stat"><b>Damage</b>{weapon.damage?.display??0}<small>{weapon.damage?.raw??0} raw</small></span>
    {weapon.specials?.map((special,index)=>{const key=special.element??special.status??'';const meta=attributeMeta.get(key as WeaponAttribute);return <span className={`weapon-stat weapon-special ${special.element?`element-${special.element}`:`status-${special.status}`}`} key={`${key}-${index}`}><b>{meta?.label??key}</b>{special.damage.display}</span>;})}
    <span className="weapon-stat"><b>Affinity</b>{weapon.affinity??0}%</span>
    {sharpness.length>0&&<span className="weapon-stat weapon-sharpness"><b>Sharpness</b><span className="sharpness-mini" aria-label="Sharpness levels">{sharpness.map(([color,value])=><i key={color} title={`${color} ${value}`} style={{background:sharpnessColors[color]??'#777',flex:value}}/>)}</span><small>{sharpness.map(([color,value])=>`${color} ${value}`).join(' · ')}</small></span>}
  </div>;
}
type Picker = { slot:BuildSlot; index?:number } | null;
type OptimizerBonusSelection = { name:string; level:number; weaponHasSkill:boolean };
const sessionKeys = { skills:'hunter-forge.optimizer.skills', bonuses:'hunter-forge.optimizer.bonuses', ignored:'hunter-forge.optimizer.ignored' } as const;
const parseStrings = (value:unknown) => Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):null;
const parseBonuses = (value:unknown):OptimizerBonusSelection[]|null => Array.isArray(value)?value.flatMap(item=>item&&typeof item==='object'&&typeof (item as {name?:unknown}).name==='string'&&Number.isInteger((item as {level?:unknown}).level)?[{name:(item as {name:string}).name,level:(item as {level:number}).level,weaponHasSkill:(item as {weaponHasSkill?:unknown}).weaponHasSkill===true}]:[]):null;
const isWeaponBuildSlot = (slot:BuildSlot) => slot==='weapon'||slot==='secondaryWeapon';

function Choice({ label, value, onChange, options }: {label:string; value:string; onChange:(v:string)=>void; options:[string,string][]}) {
  return <label className="filter-label"><span>{label}</span><select aria-label={label} className="filter-select" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>;
}

function SkillSearch({ value, onChange, skills, label='Skill', strict=false }: {value:string;onChange:(v:string)=>void;skills:Skill[];label?:string;strict?:boolean}) {
  const [query,setQuery]=useState(value);
  useEffect(()=>setQuery(value),[value]);
  const names=useMemo(()=>skills.map(s=>s.name).sort(),[skills]);
  const filteredItems=useMemo(()=>searchSkills(skills,query).map(m=>m.skill.name),[skills,query]);
  return <label className="filter-label"><span>{label}</span><Combobox items={names} filteredItems={filteredItems} value={value || null} onValueChange={v=>{setQuery(v??'');onChange(v??'');}} inputValue={query} onInputValueChange={v=>{setQuery(v);if(!strict)onChange(v);}}><ComboboxInput aria-label={label} placeholder="Any skill" showClear/><ComboboxContent><ComboboxEmpty>No matching skills</ComboboxEmpty><ComboboxList>{(name:string)=><ComboboxItem key={name} value={name}><SkillName name={name} passive/></ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></label>;
}

function SkillMultiSelect({ value, onChange, skills, label='Skills', noun='skill', plural=`${noun}s` }: {value:string[];onChange:(v:string[])=>void;skills:Skill[];label?:string;noun?:string;plural?:string}) {
  const [query,setQuery]=useState('');
  const matches=useMemo(()=>searchSkills(skills,query),[skills,query]);
  const toggle=(name:string)=>onChange(value.includes(name)?value.filter(item=>item!==name):[...value,name]);
  return <label className="filter-label"><span>{label}</span><details className="skill-dropdown">
    <summary className="skill-dropdown-trigger"><span>{value.length?`${value.length} ${value.length===1?noun:plural} selected`:`Any ${noun}`}</span><ChevronDown size={16}/></summary>
    <div className="skill-dropdown-menu" onClick={event=>event.stopPropagation()}>
      <div className="skill-dropdown-search"><Search size={15}/><input aria-label={`Search ${plural}`} placeholder={`Search ${plural}…`} value={query} onChange={event=>setQuery(event.target.value)}/></div>
      <div className="skill-dropdown-options">{matches.map(({skill,byName,snippet})=><button type="button" key={skill.id} className={`skill-dropdown-option ${value.includes(skill.name)?'selected':''}`} onClick={()=>toggle(skill.name)}><span className="skill-option-check">{value.includes(skill.name)&&<Check size={13}/>}</span><span className="skill-option-text"><SkillName id={skill.id} passive/>{!byName&&snippet&&<small className="skill-option-snippet" title={snippet}>{snippet}</small>}</span></button>)}{!matches.length&&<span className="skill-dropdown-empty">No matching {plural}</span>}</div>
      {value.length>0&&<button type="button" className="skill-dropdown-clear" onClick={()=>onChange([])}>Clear selected {plural}</button>}
    </div>
  </details></label>;
}

export default function Home() {
  const [catalog,setCatalog] = useState<Catalog|null>(null);
  const [error,setError] = useState('');
  const [reload,setReload] = useState(0);
  const [build,setBuild] = useState<Build>({});
  const [picker,setPicker] = useState<Picker>(null);
  const [filters,setFilters] = useState<Filters>({...emptyFilters});
  const [decoSearch,setDecoSearch] = useState('');
  const [visible,setVisible] = useState(60);
  const [defenseMode,setDefenseMode] = useState<'base'|'max'>('base');
  const [customOpen,setCustomOpen] = useState(false);
  const [customSkills,setCustomSkills] = useState<SkillRef[]>([]);
  const [customSlots,setCustomSlots] = useState<DecoSlot[]>([]);
  const [announcement,setAnnouncement] = useState('');
  const [urlReady,setUrlReady] = useState(false);
  const [optimizerOpen,setOptimizerOpen] = useState(false);
  const [optimizerSkills,setOptimizerSkills] = useSessionState<string[]>(sessionKeys.skills,[],parseStrings);
  const [optimizerBonuses,setOptimizerBonuses] = useSessionState<OptimizerBonusSelection[]>(sessionKeys.bonuses,[],parseBonuses);
  const [ignoredIds,setIgnoredIds] = useSessionState<string[]>(sessionKeys.ignored,[],parseStrings);
  const [optimizing,setOptimizing] = useState(false);
  const [optimizerProgress,setOptimizerProgress] = useState<OptimizerProgress|null>(null);
  const [optimizerResult,setOptimizerResult] = useState<OptimizerResult|null>(null);
  const [optimizerError,setOptimizerError] = useState('');
  const optimizerAbort = useRef<AbortController|null>(null);

  useEffect(()=>{
    const controller = new AbortController();
    setError('');
    fetch('/data/catalog.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Could not load the equipment catalog.');return r.json();}).then(value=>{const data=value as Catalog;if(!Array.isArray(data.equipments)||!data.equipments.length||!Array.isArray(data.skills)||!data.skills.length||!Array.isArray(data.decorations))throw Error('The equipment catalog is invalid.');setCatalog(data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  },[reload]);

  useEffect(()=>{
    if(!catalog||urlReady)return;
    const encoded=new URL(window.location.href).searchParams.get('b');
    if(encoded){const result=decodeBuild(encoded,catalog);setBuild(result.build);if(result.warning)setAnnouncement(result.warning);}
    setUrlReady(true);
  },[catalog,urlReady]);

  useEffect(()=>{
    if(!catalog||!urlReady)return;
    const current=new URL(window.location.href),encoded=encodeBuild(build,catalog);
    if(encoded)current.searchParams.set('b',encoded);else current.searchParams.delete('b');
    const next=`${current.pathname}${current.search}${current.hash}`;
    const previous=`${window.location.pathname}${window.location.search}${window.location.hash}`;
    if(next!==previous)window.history.replaceState(null,'',next);
  },[build,catalog,urlReady]);

  const allSkills = useMemo(()=>catalog?.skills??[],[catalog]);
  const ordinarySkills = useMemo(()=>catalog?.skills.filter(s=>['armor','weapon'].includes(s.kind))??[],[catalog]);
  const skillById = useMemo(()=>new Map(catalog?.skills.map(s=>[s.id,s])),[catalog]);
  const summary = useMemo(()=>summarize(build,catalog?.skills??[],defenseMode),[build,catalog,defenseMode]);
  const results = useMemo(()=>!catalog||!picker?[]:filterEquipment(catalog.equipments.filter(e=>e.slot===(picker.slot==='secondaryWeapon'?'weapon':picker.slot)),filters,catalog.skills).sort((a,b)=>{
    if((picker.slot==='weapon'||picker.slot==='secondaryWeapon')&&a.kind!==b.kind)return Object.keys(weaponTypes).indexOf(a.kind)-Object.keys(weaponTypes).indexOf(b.kind);
    return b.rarity-a.rarity||a.name.localeCompare(b.name);
  }),[catalog,picker,filters]);
  const targetSlot = picker?.index!=null?build[picker.slot]?.equipment.slots[picker.index]:null;
  const decoResults = useMemo(()=>!targetSlot?[]:catalog?.decorations.filter(d=>compatible(d,targetSlot)&&`${d.name} ${d.skills.map(s=>skillById.get(s.id)?.name).join(' ')}`.toLowerCase().includes(decoSearch.toLowerCase())).sort((a,b)=>b.level-a.level||a.name.localeCompare(b.name))??[],[catalog,targetSlot,decoSearch,skillById]);
  const skillText = (skills:SkillRef[]) => skills.map((s,i)=><span key={s.id}>{i>0&&' · '}<SkillName id={s.id} level={s.level}/></span>);
  const weaponSpecials = build.weapon?.equipment.specials??[];
  const bonusSkills = useMemo(()=>catalog?.skills.filter(s=>(bonusKinds as readonly string[]).includes(s.kind)&&bonusRanks(s).length)??[],[catalog]);
  const bonusByName = useMemo(()=>new Map(bonusSkills.map(s=>[s.name,s])),[bonusSkills]);
  const equipmentById = useMemo(()=>new Map(catalog?.equipments.map(e=>[e.id,e])),[catalog]);
  const optimizedSummary = useMemo(()=>optimizerResult?summarize(optimizerResult.build,catalog?.skills??[],defenseMode):null,[optimizerResult,catalog,defenseMode]);

  function openPicker(slot:BuildSlot,index?:number) {
    setFilters({...emptyFilters});setDecoSearch('');setVisible(60);setPicker({slot,index});
  }
  function updateFilter(key:keyof Filters,value:string) {setFilters(f=>({...f,[key]:value}));setVisible(60);}
  function selectEquipment(e:Equipment) {setBuild(b=>equip(b,e,picker?.slot));setAnnouncement(`${e.name} equipped.`);setPicker(null);}
  function removeEquipment(slot:BuildSlot) {setBuild(b=>{const next={...b};delete next[slot];return next;});setAnnouncement(`${labels[slot]} removed.`);}
  function editCharm() {
    const charm=build.charm?.equipment;
    setCustomSkills(charm?.skills??[]);setCustomSlots(charm?.slots??[]);setCustomOpen(true);
  }
  function saveCharm() {
    const charm=build.charm?.equipment;if(!charm)return;
    const valid=customSkills.filter(s=>skillById.has(s.id)&&s.level>0);
    const updated={...charm,skills:valid,slots:customSlots.filter(s=>s.level>0)};
    setBuild(b=>equip(b,updated));setCustomOpen(false);setAnnouncement('Custom charm updated.');
  }
  function stopOptimizer() {
    optimizerAbort.current?.abort();optimizerAbort.current=null;setOptimizing(false);setOptimizerProgress(null);
  }
  function openOptimizer() {setOptimizerResult(null);setOptimizerError('');setOptimizerOpen(true);}
  function closeOptimizer() {stopOptimizer();setOptimizerResult(null);setOptimizerOpen(false);}
  function moveItem<T>(list:T[],index:number,offset:number) {
    const target=index+offset;if(target<0||target>=list.length)return list;const next=[...list];[next[index],next[target]]=[next[target],next[index]];return next;
  }
  function moveOptimizerSkill(index:number,offset:number) {setOptimizerSkills(list=>moveItem(list,index,offset));}
  function moveOptimizerBonus(index:number,offset:number) {setOptimizerBonuses(list=>moveItem(list,index,offset));}
  function selectBonusNames(names:string[]) {
    setOptimizerBonuses(list=>names.map(name=>list.find(b=>b.name===name)??{name,level:bonusRanks(bonusByName.get(name)!).at(-1)?.level??1,weaponHasSkill:false}));
  }
  function setBonusLevel(name:string,level:number) {setOptimizerBonuses(list=>list.map(b=>b.name===name?{...b,level}:b));}
  function setBonusWeaponSkill(name:string,weaponHasSkill:boolean) {setOptimizerBonuses(list=>list.map(b=>b.name===name?{...b,weaponHasSkill}:b));}
  /** Marks a suggested piece as not owned and re-runs the search without it. The list is kept for the browser tab session. */
  function ignoreEquipment(id:string) {
    const next=ignoredIds.includes(id)?ignoredIds:[...ignoredIds,id];
    setIgnoredIds(next);setAnnouncement(`${equipmentById.get(id)?.name??'Item'} ignored. Searching again.`);
    void runOptimizer(next);
  }
  async function runOptimizer(excludeIds:string[]=ignoredIds) {
    if(!catalog)return;
    const skillIds=optimizerSkills.map(name=>catalog.skills.find(s=>s.name===name)?.id).filter((id):id is number=>id!=null);
    const bonuses=optimizerBonuses.flatMap(b=>{const skill=bonusByName.get(b.name);return skill?[{id:skill.id,level:b.level,weaponHasSkill:b.weaponHasSkill}]:[];});
    stopOptimizer();
    const controller=new AbortController();optimizerAbort.current=controller;
    setOptimizing(true);setOptimizerResult(null);setOptimizerError('');setOptimizerProgress(null);
    try {
      const result=await optimizeBuild({build,catalog,skillIds,bonuses,defenseMode,excludeIds},{signal:controller.signal,onProgress:setOptimizerProgress});
      if(controller.signal.aborted)return;
      setOptimizerResult(result);setAnnouncement(result.allCapped?'Optimization finished. Every selected bonus and skill reached its target.':`Optimization finished. ${result.message}`);
    } catch(e) {
      if(e instanceof OptimizerError&&e.code==='aborted')return;
      setOptimizerError(e instanceof Error?e.message:'The optimizer could not complete.');
    } finally {
      if(optimizerAbort.current===controller){optimizerAbort.current=null;setOptimizing(false);setOptimizerProgress(null);}
    }
  }
  function applyOptimizer() {
    if(!optimizerResult)return;
    const result=optimizerResult;
    setBuild(b=>applyOptimizedBuild(b,result));setOptimizerResult(null);setOptimizerOpen(false);setAnnouncement(result.pieces.some(p=>p.suggested)?'Optimized build applied, including a suggested weapon.':'Optimized build applied. Both weapons were kept.');
  }
  useEffect(()=>()=>{optimizerAbort.current?.abort();},[]);
  async function copyBuildLink() {
    try { await navigator.clipboard.writeText(window.location.href);setAnnouncement('Build link copied.'); }
    catch { setAnnouncement('Copy failed. Copy the URL from your browser address bar.'); }
  }

  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool||!catalog)return;
    const lifecycle=new AbortController();
    try { Promise.resolve(context.registerTool({name:'search_hunter_equipment',description:'Search equipment in the current Monster Hunter Wilds catalog by name and slot.',inputSchema:{type:'object',properties:{name:{type:'string'},slot:{type:'string',enum:[...slots]}},required:['name','slot'],additionalProperties:false},annotations:{readOnlyHint:true},execute:(input:unknown)=>{if(!input||typeof input!=='object')throw Error('Expected search input');const v=input as {name:unknown;slot:unknown};if(typeof v.name!=='string'||!slots.includes(v.slot as BuildSlot))throw Error('Invalid name or slot');const sourceSlot=v.slot==='secondaryWeapon'?'weapon':v.slot;return filterEquipment(catalog.equipments.filter(e=>e.slot===sourceSlot),{...emptyFilters,name:v.name},catalog.skills).slice(0,30).map(e=>({id:e.id,name:e.name,rarity:e.rarity,slots:e.slots}));}},{signal:lifecycle.signal})).catch(()=>{}); }catch{}
    return ()=>lifecycle.abort();
  },[catalog]);

  return <SkillDescriptions skills={catalog?.skills??[]}><div className="app-shell">
    <header className="topbar"><div className="brand"><Swords/><span>HUNTER<span className="brand-light">FORGE</span></span><span className="edition">WILDS</span></div><span className="header-note">Monster Hunter Wilds · Build planner</span></header>
    <main>
      <div className="page-title"><div><p className="eyebrow">THE HUNTER’S WORKBENCH</p><h1>Build your next hunt.</h1><p className="muted">Choose your equipment. Find your edge.</p></div><div className="page-actions"><button className="copy-build-button optimize-button" type="button" onClick={openOptimizer} disabled={!catalog}><Sparkles size={14}/> Optimize</button><button className="copy-build-button" type="button" onClick={copyBuildLink} disabled={!catalog}><Copy size={14}/> Copy build link</button><span className={`outline-badge ${summary.equippedCount===8?'complete':''}`}>{summary.equippedCount===8&&<Check size={14}/>} {summary.equippedCount} / 8 equipped</span></div></div>
      {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>Try again</button></div>}
      <div className="sr-only" role="status">{announcement}</div>
      <div className="workbench">
        <section className="equipment-panel" aria-label="Equipment loadout">
          <div className="section-heading"><h2><Swords size={20}/> Equipment</h2><span className="muted">One piece. Every possibility.</span></div>
          {slots.map((slot,i)=>{
            const entry=build[slot],e=entry?.equipment;
            return <div className={`equipment-row ${e?'is-equipped':''}`} key={slot}>
              <span className="slot-index">0{i+1}</span><div className={`equipment-icon ${isWeaponBuildSlot(slot)?'weapon-icon':''}`}><EquipmentIcon slot={slot} kind={e?.kind} rarity={e?.rarity}/></div>
              <div className="equipment-copy"><div className="slot-label">{labels[slot]} {e&&<span className="rarity" style={rarityStyle(e.rarity)}>RARITY {e.rarity}</span>}</div>
                <button className={e?'equipment-name':'empty-equipment'} onClick={()=>openPicker(slot)} disabled={!catalog}>{e?e.name:<><Plus size={16}/> Choose {labels[slot].toLowerCase()}</>}{e?.slot==='weapon'&&<span className="weapon-attributes">{weaponAttributeKeys(e).map(key=>{const meta=attributeMeta.get(key);if(!meta)return null;const AttributeIcon=meta.Icon;return <span key={key} className={`weapon-attribute ${meta.className}`} title={meta.label} aria-label={meta.label}><AttributeIcon size={16} strokeWidth={2.5} aria-hidden="true"/></span>;})}</span>}{e&&<ChevronRight size={15}/>}</button>
                {e&&<><p className="equipment-subline">{isWeaponBuildSlot(slot)?`${weaponTypes[e.kind]}`:e.defense?`${e.defense[defenseMode]} defense`:e.random?'Custom charm · enter your roll':'Forged charm'}{e.skills.length>0&&<> · {skillText(e.skills)}</>}</p>{isWeaponBuildSlot(slot)&&<WeaponRowStats weapon={e}/>}
                  {e.customizable&&<p className="inline-note">Artian base values · reinforcement bonuses not included</p>}
                  {e.random&&<button className="text-button" onClick={editCharm}><SlidersHorizontal size={13}/> Edit charm skills & slots</button>}
                  <div className="decoration-slots">{e.slots.length?e.slots.map((s,j)=>{const d=entry!.decorations[j];return <button key={j} className={`deco-button ${d?'filled':''} ${s.kind}`} aria-label={`${labels[slot]} decoration slot ${j+1}, level ${s.level}${d?`, ${d.name}`:', empty'}`} onClick={()=>openPicker(slot,j)}><span className="gem-level">{d?<DecorationIcon decoration={d} size={28}/>:<DecorationSlotIcon level={s.level} kind={s.kind}/>}</span><span>{d?d.name:'Add decoration'}{d&&<small className="deco-rarity" style={rarityStyle(d.rarity)}>R{d.rarity} · Slot {s.level}</small>}</span>{d?<Check size={12}/>:<Plus size={12}/>}</button>;}):<span className="no-slots">No decoration slots</span>}</div>
                </>}
              </div>
              {e?<button className="icon-button remove-equipment" aria-label={`Remove ${labels[slot].toLowerCase()}`} onClick={()=>removeEquipment(slot)}><X size={16}/></button>:<button className="icon-button" aria-label={`Select ${labels[slot].toLowerCase()}`} disabled={!catalog} onClick={()=>openPicker(slot)}><ChevronRight size={17}/></button>}
            </div>;
          })}
          <div className="panel-footnote"><span><DecorationSlotIcon level={1} kind="weapon" size={20}/> Weapon slots</span><span><DecorationSlotIcon level={1} kind="armor" size={20}/> Armor slots</span></div>
        </section>
        <aside className="summary-panel" aria-label="Build summary">
          <div className="section-heading"><h2>Build overview</h2><span className="eyebrow">LIVE</span></div>
          <div className="stat-grid" aria-live="polite">
            <div className="stat"><span><EquipmentIcon slot="weapon" kind={build.weapon?.equipment.kind} rarity={build.weapon?.equipment.rarity} size={20}/> Attack</span><div className="stat-pair"><div><small>Base</small><strong>{summary.baseStats.displayAttack}</strong></div><div className="stat-max"><small>Max</small><strong>{summary.maxStats.displayAttack}</strong></div></div><small>{summary.baseStats.attack} / {summary.maxStats.attack} true raw</small>{weaponSpecials.length>0&&<div className="attack-elements" aria-label="Weapon elemental and status values">{weaponSpecials.map((special,index)=>{const key=special.element??special.status??'';const meta=attributeMeta.get(key as WeaponAttribute);const SpecialIcon=meta?.Icon;return <span key={`${key}-${index}`} className={meta?.className??''}>{SpecialIcon&&<SpecialIcon size={13} strokeWidth={2.5}/>} {meta?.label??key} {special.damage.display}</span>;})}</div>}</div>
            <div className="stat"><span><Orbit size={13}/> Affinity</span><div className="stat-pair"><div><small>Base</small><strong>{summary.baseStats.affinity}<em>%</em></strong></div><div className="stat-max"><small>Max</small><strong>{summary.maxStats.affinity}<em>%</em></strong></div></div><small>Max: Agitator, weak point, wound and other conditions</small></div>
            <div className="stat"><span><Shield size={13}/> Defense</span><div className="stat-pair"><div><small>Base</small><strong>{summary.baseStats.defense}</strong></div><div className="stat-max"><small>Max</small><strong>{summary.maxStats.defense}</strong></div></div><small>{defenseMode==='base'?'Base armor':'Catalog maximum armor'} · Max includes active defense skills</small></div>
            <div className="stat"><span><DecorationIcon decoration={{level:1}} size={20}/> Decorations</span><strong>{summary.usedSlots}<em> / {summary.totalSlots}</em></strong><small>Slots filled</small></div>
          </div>
          <div className="defense-choice"><Choice label="Armor defense" value={defenseMode} onChange={v=>setDefenseMode(v as 'base'|'max')} options={[[ 'base','Base'],['max','Catalog maximum']]}/></div>
          <div className="resistance-row">{elements.map(el=>{const Icon=elementIcons[el];return <div key={el} title={`${el} resistance`}><Icon size={17} className={`element-${el}`}/><strong className={summary.resistances[el]<0?'negative':''}>{summary.resistances[el]}</strong><span>{el}</span></div>;})}</div>
          {build.weapon?.equipment.specials?.length? <div className="weapon-details"><span className="muted">Base element / status</span>{build.weapon.equipment.specials.map((s,i)=><span key={i}>{s.element??s.status} <b>{s.damage.display}</b></span>)}</div>:null}
          {build.weapon?.equipment.sharpness&&<div className="weapon-details"><span className="muted">Base sharpness</span><div className="sharpness-bar" aria-label="Base weapon sharpness">{Object.entries(build.weapon.equipment.sharpness).map(([color,value])=>value>0&&<span key={color} title={`${color}: ${value}`} style={{background:color==='red'?'#c65353':color==='orange'?'#d8954f':color==='yellow'?'#d1c56c':color==='green'?'#75a47f':color==='blue'?'#6a92be':color==='white'?'#e5e5e5':'#ac85c7',flex:value}}/>)}</div></div>}
          <details className="calculation-note"><summary><CircleHelp size={14}/> How stats are calculated</summary><p>Includes equipment, Attack Boost, Critical Eye, Defense Boost, and elemental resistance skills. Conditional effects, food, items, set-bonus stat changes, and other skill modifiers are not included. Element/status and sharpness show the weapon’s base values. Catalog maximum defense does not add transcended decoration slots.</p></details>
          <div className="summary-section"><div className="subheading"><h2>Active skills</h2><span className="count-badge">{summary.activeSkills.length}</span></div>
            {!summary.activeSkills.length?<div className="empty-state"><Gem size={32}/><p>Your build starts here</p><span>Equip a weapon or armor piece to see its skills and stats.</span></div>:<div className="skill-list">{summary.activeSkills.map(s=><details className="skill-detail" key={s.skill.id}><summary><span><SkillName id={s.skill.id} level={s.level} showLevel={false}/>{s.total>s.max&&<small className="overcap"> +{s.total-s.max} excess</small>}</span><span className="skill-meter">{Array.from({length:s.max},(_,i)=><i key={i} className={i<s.level?'on':''}/>)}<b>{s.level}</b></span></summary><p>{s.rank?.description??s.skill.description}</p></details>)}</div>}
          </div>
          <div className="summary-section"><div className="subheading"><h2>Set & group bonuses</h2><span className="count-badge">{summary.bonuses.filter(b=>b.active).length}</span></div>{!summary.bonuses.length?<p className="bonus-empty">Combine armor pieces to unlock bonuses.</p>:summary.bonuses.map(b=><div className={`bonus ${b.active?'active':''}`} key={b.skill.id}><div><SkillName id={b.skill.id} level={b.active?.level} showLevel={false}/><b>{b.count} pcs</b></div>{b.ranks.map(r=><p key={r.level} className={b.count>=r.pieces!?'unlocked':''}>{b.count>=r.pieces!?<Check size={13}/>:<span className="bonus-dot"/>}<span>{r.pieces} pcs · {r.name}</span></p>)}{b.active&&<small>{b.active.description}</small>}</div>)}</div>
        </aside>
      </div>
      <footer><span>{catalog?`${catalog.equipments.length.toLocaleString()} equipment entries · ${catalog.decorations.length} decorations · Data: ${catalog.version.slice(0,10)}`:'Loading equipment catalog…'}</span><a href="/icons/credits.html" target="_blank" rel="noreferrer">Icon sources & colors ↗</a><a href="https://wilds.mhdb.io" target="_blank" rel="noreferrer">Data by MHDB ↗</a></footer>
    </main>
    <Dialog open={!!picker} onOpenChange={open=>{if(!open)setPicker(null);}}><DialogContent className="equipment-dialog">
      <div className="picker-heading"><p className="eyebrow">EQUIPMENT CATALOG</p><DialogTitle className="picker-title">{targetSlot?'Choose a decoration':`Choose ${picker?labels[picker.slot].toLowerCase():'equipment'}`}</DialogTitle><DialogDescription>{targetSlot?`Only ${targetSlot.kind} decorations that fit a level ${targetSlot.level} slot are shown.`:'Find the right piece for your build.'}</DialogDescription></div>
      {targetSlot?<><div className="search-field"><Search size={18}/><Input aria-label="Search decorations" placeholder="Search decorations by name or skill…" value={decoSearch} onChange={e=>setDecoSearch(e.target.value)}/></div><button className="clear-decoration" onClick={()=>{if(picker?.index!=null)setBuild(b=>decorate(b,picker.slot,picker.index!,null));setPicker(null);}}><X size={15}/> Leave this slot empty</button><div className="results-header"><span>{decoResults.length} compatible decorations</span><span>LEVEL {targetSlot.level} · {targetSlot.kind.toUpperCase()}</span></div><div className="results-list">{decoResults.map(d=><div className="catalog-item" key={d.id}><button className="catalog-select" aria-label={`Equip ${d.name}`} onClick={()=>{if(picker?.index!=null)setBuild(b=>decorate(b,picker.slot,picker.index!,d));setAnnouncement(`${d.name} added.`);setPicker(null);}}/><div className={`equipment-icon ${d.kind==='weapon'?'weapon-icon':''}`}><DecorationIcon decoration={d}/></div><div className="result-copy"><div className="result-title"><strong>{d.name}</strong><span className="rarity" style={rarityStyle(d.rarity)}>R{d.rarity}</span></div><p>{skillText(d.skills)}</p><small className="decoration-kind">{d.kind==='weapon'?'Weapon':'Armor'} decoration · Level {d.level}</small></div><DecorationSlotIcon level={d.level} kind={d.kind}/><ChevronRight size={16}/></div>)}{!decoResults.length&&<div className="empty-state"><Search/><p>No decorations match</p><button className="text-button" onClick={()=>setDecoSearch('')}>Clear search</button></div>}</div></>:
      <><div className="picker-filters"><div className="filter-searches"><label className="filter-label"><span>Equipment name</span><div className="search-field"><Search size={17}/><Input aria-label="Equipment name" placeholder="Search by name…" value={filters.name} onChange={e=>updateFilter('name',e.target.value)}/></div></label><SkillMultiSelect value={filters.skills??[]} onChange={v=>{setFilters(f=>({...f,skills:v,skill:''}));setVisible(60);}} skills={allSkills}/></div><div className="filter-options">{isWeaponBuildSlot(picker?.slot??'head')&&<Choice label="Weapon type" value={filters.type} onChange={v=>updateFilter('type',v)} options={[[ 'any','All weapon types'],...Object.entries(weaponTypes)]}/>}<Choice label="Min rarity" value={filters.minRarity} onChange={v=>updateFilter('minRarity',v)} options={[[ 'any','No minimum'],...[1,2,3,4,5,6,7,8].map(n=>[String(n),`Rarity ${n}+`] as [string,string])]}/><Choice label="Max rarity" value={filters.maxRarity} onChange={v=>updateFilter('maxRarity',v)} options={[[ 'any','No maximum'],...[1,2,3,4,5,6,7,8].map(n=>[String(n),`Rarity ${n}`] as [string,string])]}/><Choice label="Min decoration slots" value={filters.minCount} onChange={v=>updateFilter('minCount',v)} options={[[ 'any','No minimum'],...[0,1,2,3].map(n=>[String(n),`${n} slot${n===1?'':'s'}+`] as [string,string])]}/><Choice label="Max decoration slots" value={filters.maxCount} onChange={v=>updateFilter('maxCount',v)} options={[[ 'any','No maximum'],...[0,1,2,3].map(n=>[String(n),`${n} slot${n===1?'':'s'}`] as [string,string])]}/><Choice label="Minimum slot level" value={filters.minLevel} onChange={v=>updateFilter('minLevel',v)} options={[[ 'any','Any level'],['1','At least one Lv. 1+'],['2','At least one Lv. 2+'],['3','At least one Lv. 3']]}/></div>{isWeaponBuildSlot(picker?.slot??'head')&&<div className="attribute-filter"><span className="filter-label-title">Weapon element / status</span><div className="attribute-chips">{weaponAttributes.map(([key,label,className])=>{const checked=filters.elements.includes(key);return <button type="button" key={key} className={`attribute-chip ${className} ${checked?'checked':''}`} aria-pressed={checked} onClick={()=>setFilters(f=>({...f,elements:checked?f.elements.filter(v=>v!==key):[...f.elements,key]}))}><span className="attribute-check">{checked&&<Check size={12}/>}</span>{label}</button>;})}</div></div>}</div>
      <div className="results-header"><span>{results.length.toLocaleString()} matching pieces</span><button className="text-button" onClick={()=>{setFilters({...emptyFilters});setVisible(60);}}><RotateCcw size={12}/> Reset filters</button></div><div className="results-list">{results.slice(0,visible).map((e,i)=>{return <div key={e.id}>{isWeaponBuildSlot(picker?.slot??'head')&&(i===0||results[i-1].kind!==e.kind)&&<h3 className="weapon-group"><EquipmentIcon slot="weapon" kind={e.kind} size={26}/>{weaponTypes[e.kind]}</h3>}<div className={`catalog-item ${build[e.slot]?.equipment.id===e.id?'selected':''}`}><button className="catalog-select" aria-label={`Equip ${e.name}`} onClick={()=>selectEquipment(e)}/><div className={`equipment-icon ${e.slot==='weapon'?'weapon-icon':''}`}><EquipmentIcon slot={e.slot} kind={e.kind} rarity={e.rarity}/></div><div className="result-copy"><div className="result-title"><strong>{e.name}</strong>{e.slot==='weapon'&&<span className="weapon-attributes catalog-attributes">{weaponAttributeKeys(e).map(key=>{const meta=attributeMeta.get(key);if(!meta)return null;const AttributeIcon=meta.Icon;return <span key={key} className={`weapon-attribute ${meta.className}`} title={meta.label} aria-label={meta.label}><AttributeIcon size={15} strokeWidth={2.5} aria-hidden="true"/></span>;})}</span>}<span className="rarity" style={rarityStyle(e.rarity)}>R{e.rarity}</span></div>{e.slot==='weapon'&&<WeaponRowStats weapon={e}/>}<p>{e.random?'Randomized charm · configure your roll':e.skills.length?skillText(e.skills):'No innate skills'}</p>{e.bonuses.length>0&&<p className="result-bonus">{e.bonuses.map((id,i)=><span key={id}>{i>0&&' · '}<SkillName id={id}/></span>)}</p>}</div><div className="result-slots">{e.slots.length?e.slots.map((s,j)=><DecorationSlotIcon key={j} level={s.level} kind={s.kind}/>):<span className="muted">—</span>}</div>{build[picker?.slot??e.slot]?.equipment.id===e.id?<Check size={16}/>:<ChevronRight size={16}/>}</div></div>;})}{!results.length&&<div className="empty-state"><Search/><p>No equipment matches</p><span>Try a different name or loosen your filters.</span><button className="text-button" onClick={()=>setFilters({...emptyFilters})}>Clear all filters</button></div>}{results.length>visible&&<button className="load-more" onClick={()=>setVisible(n=>n+60)}>Show more · {results.length-visible} remaining</button>}</div></>}
    </DialogContent></Dialog>

    <Dialog open={customOpen} onOpenChange={setCustomOpen}><DialogContent className="custom-dialog"><DialogTitle>Configure your charm</DialogTitle><DialogDescription>Enter the skills and slots on your charm. Custom rolls are not checked for in-game obtainability.</DialogDescription><div className="custom-skills">{[0,1,2].map(i=>{const ref=customSkills[i];const skill=skillById.get(ref?.id??-1);return <div key={i} className="custom-row"><SkillSearch strict label={`Charm skill ${i+1}`} skills={ordinarySkills.filter(s=>!customSkills.some((r,j)=>j!==i&&r.id===s.id))} value={skill?.name??''} onChange={name=>{const found=ordinarySkills.find(s=>s.name===name);setCustomSkills(rows=>{const next=[...rows];next[i]={id:found?.id??-1,level:found?1:0};return next;});}}/><Choice label={`Skill ${i+1} level`} value={String(ref?.level||1)} options={(skill?.ranks??[{level:1}]).map(r=>[String(r.level),`Lv. ${r.level}`])} onChange={v=>setCustomSkills(rows=>rows.map((r,j)=>i===j?{...r,level:+v}:r))}/></div>;})}</div><h3>Decoration slots</h3>{[0,1,2].map(i=><div className="custom-row" key={i}><Choice label={`Charm slot ${i+1}`} value={String(customSlots[i]?.level??0)} onChange={v=>setCustomSlots(rows=>{const next=[...rows];next[i]={kind:next[i]?.kind??'armor',level:+v};return next;})} options={[[ '0','No slot'],['1','Level 1'],['2','Level 2'],['3','Level 3']]}/><Choice label={`Slot ${i+1} type`} value={customSlots[i]?.kind??'armor'} options={[[ 'armor','Armor'],['weapon','Weapon']]} onChange={v=>setCustomSlots(rows=>{const next=[...rows];next[i]={level:next[i]?.level??0,kind:v as 'armor'|'weapon'};return next;})}/></div>)}<button className="primary-button" onClick={saveCharm}>Apply charm</button></DialogContent></Dialog>
    <Dialog open={optimizerOpen} onOpenChange={open=>{if(!open)closeOptimizer();}}><DialogContent className="custom-dialog optimizer-dialog"><DialogTitle>Optimize your build</DialogTitle><DialogDescription>Pick set or group bonuses and skills. Selection order is priority: bonuses are settled first, then the first skill is maximized before the second, and so on. Armor, charm and decorations are searched; an equipped weapon is only swapped for a same-type weapon that carries a selected bonus.</DialogDescription>
      {!optimizerResult?<>
        <div className="optimizer-context" aria-label="Fixed equipment">
          <span><b>Primary weapon</b> {build.weapon?.equipment.name??'None equipped'}</span>
          <span><b>Secondary weapon</b> {build.secondaryWeapon?.equipment.name??'None equipped'}</span>
          <span><b>Charm candidates</b> {build.charm?.equipment.random?`All forged charms plus your custom ${build.charm.equipment.name}`:'All forged charms'}</span>
        </div>
        <div className="optimizer-section"><h3>Set &amp; group bonuses <span>Highest priority · pick the level you want</span></h3>
          <div className="optimizer-picker"><SkillMultiSelect value={optimizerBonuses.map(b=>b.name)} onChange={selectBonusNames} skills={bonusSkills} label="Set & group bonuses" noun="bonus" plural="bonuses"/></div>
          {optimizerBonuses.length>0&&<ol className="optimizer-priority" aria-label="Bonus priority">{optimizerBonuses.map((bonus,i)=>{const skill=bonusByName.get(bonus.name);return <li key={bonus.name}><span className="priority-index">{i+1}</span><SkillName name={bonus.name} passive/><select className="filter-select bonus-level" aria-label={`${bonus.name} target level`} value={bonus.level} disabled={optimizing} onChange={e=>setBonusLevel(bonus.name,+e.target.value)}>{(skill?bonusRanks(skill):[]).map(r=><option key={r.level} value={r.level}>Lv. {r.level} · {r.pieces} pieces{r.name?` · ${r.name}`:''}</option>)}</select><label className="optimizer-weapon-skill"><input type="checkbox" checked={bonus.weaponHasSkill} disabled={optimizing} onChange={e=>setBonusWeaponSkill(bonus.name,e.target.checked)}/><span>My weapon has this skill</span></label><span className="priority-actions"><button type="button" aria-label={`Move ${bonus.name} up`} disabled={i===0||optimizing} onClick={()=>moveOptimizerBonus(i,-1)}><ArrowUp size={14}/></button><button type="button" aria-label={`Move ${bonus.name} down`} disabled={i===optimizerBonuses.length-1||optimizing} onClick={()=>moveOptimizerBonus(i,1)}><ArrowDown size={14}/></button><button type="button" aria-label={`Remove ${bonus.name}`} disabled={optimizing} onClick={()=>setOptimizerBonuses(list=>list.filter(item=>item.name!==bonus.name))}><X size={14}/></button></span></li>;})}</ol>}
        </div>
        <div className="optimizer-section"><h3>Skills <span>Maximized after the bonuses, in this order</span></h3>
          <div className="optimizer-picker"><SkillMultiSelect value={optimizerSkills} onChange={setOptimizerSkills} skills={ordinarySkills}/></div>
          {optimizerSkills.length>0&&<ol className="optimizer-priority" aria-label="Skill priority">{optimizerSkills.map((name,i)=><li key={name}><span className="priority-index">{optimizerBonuses.length+i+1}</span><SkillName name={name} passive/><span className="priority-actions"><button type="button" aria-label={`Move ${name} up`} disabled={i===0||optimizing} onClick={()=>moveOptimizerSkill(i,-1)}><ArrowUp size={14}/></button><button type="button" aria-label={`Move ${name} down`} disabled={i===optimizerSkills.length-1||optimizing} onClick={()=>moveOptimizerSkill(i,1)}><ArrowDown size={14}/></button><button type="button" aria-label={`Remove ${name}`} disabled={optimizing} onClick={()=>setOptimizerSkills(list=>list.filter(item=>item!==name))}><X size={14}/></button></span></li>)}</ol>}
        </div>
        {!optimizerSkills.length&&!optimizerBonuses.length&&<p className="muted optimizer-hint">Select at least one bonus or skill. Earlier selections have higher priority.</p>}
        {ignoredIds.length>0&&<div className="optimizer-section optimizer-ignored"><h3>Ignored equipment <span>Not owned · remembered for this browser tab</span></h3><ul className="ignored-list">{ignoredIds.map(id=><li key={id}><Ban size={13}/><span>{equipmentById.get(id)?.name??id}</span><button type="button" className="text-button" disabled={optimizing} onClick={()=>setIgnoredIds(list=>list.filter(item=>item!==id))}>Restore</button></li>)}</ul><button type="button" className="text-button" disabled={optimizing} onClick={()=>setIgnoredIds([])}>Restore all</button></div>}
        {optimizerError&&<p className="optimizer-error" role="alert">{optimizerError}</p>}
        {optimizing&&<div className="optimizer-progress" role="status"><LoaderCircle size={15} className="spin"/><span>{optimizerProgress?.slot?`Searching ${labels[optimizerProgress.slot].toLowerCase()}…`:optimizerProgress?.stage==='fill'?'Placing decorations…':'Preparing candidates…'} {(optimizerProgress?.evaluated??0).toLocaleString()} combinations</span><span className="progress-bar"><i style={{width:`${Math.round(100*(optimizerProgress?.done??0)/(optimizerProgress?.total??1))}%`}}/></span></div>}
        <div className="optimizer-actions"><button className="primary-button" type="button" disabled={(!optimizerSkills.length&&!optimizerBonuses.length)||optimizing||!catalog} onClick={()=>runOptimizer()}>{optimizing?'Optimizing…':'Run optimizer'}</button>{optimizing?<button className="secondary-button" type="button" onClick={stopOptimizer}>Stop</button>:<button className="secondary-button" type="button" onClick={closeOptimizer}>Cancel</button>}</div>
      </>:<>
        {optimizing&&<div className="optimizer-progress" role="status"><LoaderCircle size={15} className="spin"/><span>Searching again without the ignored equipment… {(optimizerProgress?.evaluated??0).toLocaleString()} combinations</span><span className="progress-bar"><i style={{width:`${Math.round(100*(optimizerProgress?.done??0)/(optimizerProgress?.total??1))}%`}}/></span></div>}
        {optimizerResult.message?<p className="optimizer-warning" role="status">{optimizerResult.message}</p>:<p className="optimizer-success" role="status"><Check size={14}/> Every selected bonus and skill reached its target.</p>}
        {optimizerResult.approximate&&<p className="inline-note">The search was bounded to stay fast. This is the best build found, not a proven optimum.</p>}
        {optimizerResult.bonuses.length>0&&<table className="optimizer-skills"><thead><tr><th>#</th><th>Set / group bonus</th><th>Level</th><th>Target</th><th>Pieces</th><th>Reached</th></tr></thead><tbody>{optimizerResult.bonuses.map(b=><tr key={b.skill.id} className={b.reached?'capped':'partial'}><td>{b.priority}</td><td><SkillName id={b.skill.id} passive/></td><td>{b.level}</td><td>{b.target} <small className="muted">/ {b.max}</small></td><td>{b.pieces} <small className="muted">/ {b.piecesNeeded}{b.weaponHasSkill?' · 1 from weapon':''}</small></td><td><span className="capped-cell">{b.reached?<><Check size={14}/> Yes</>:'No'}</span></td></tr>)}</tbody></table>}
        {optimizerResult.skills.length>0&&<table className="optimizer-skills"><thead><tr><th>#</th><th>Skill</th><th>Level</th><th>Max</th><th>Capped</th></tr></thead><tbody>{optimizerResult.skills.map(s=><tr key={s.skill.id} className={s.capped?'capped':'partial'}><td>{optimizerResult.bonuses.length+s.priority}</td><td><SkillName id={s.skill.id} passive/></td><td>{s.level}</td><td>{s.max}</td><td><span className="capped-cell">{s.capped?<><Check size={14}/> Yes</>:'No'}</span></td></tr>)}</tbody></table>}
        <h3>Optimized equipment</h3>
        <ul className="optimizer-pieces">{optimizerResult.pieces.map(p=><li key={p.slot}><div className={`equipment-icon ${p.fixed?'weapon-icon':''}`}><EquipmentIcon slot={p.slot} kind={p.equipment.kind} rarity={p.equipment.rarity} size={28}/></div><div><div className="slot-label">{labels[p.slot]}{p.fixed?<span className="rarity">KEPT</span>:p.suggested?<span className="rarity suggested">SUGGESTED WEAPON</span>:<span className="rarity" style={rarityStyle(p.equipment.rarity)}>RARITY {p.equipment.rarity}</span>}</div><strong>{p.equipment.name}</strong><p>{p.equipment.skills.length?skillText(p.equipment.skills):'No innate skills'}{p.equipment.bonuses.length>0&&<> · {p.equipment.bonuses.map((id,i)=><span key={id} className="result-bonus">{i>0&&' · '}<SkillName id={id} passive/></span>)}</>}</p>{p.equipment.slots.length>0&&<div className="optimizer-decos">{p.equipment.slots.map((slot,j)=>{const d=p.decorations[j];return <span key={j} className={`deco-chip ${d?'filled':''} ${slot.kind}`}>{d?<DecorationIcon decoration={d} size={20}/>:<DecorationSlotIcon level={slot.level} kind={slot.kind} size={20}/>}{d?d.name:`Empty Lv. ${slot.level}`}</span>;})}</div>}</div>{!p.fixed&&<button type="button" className="ignore-button" aria-label={`I don't have ${p.equipment.name}; search again without it`} title="Search again without this item" disabled={optimizing} onClick={()=>ignoreEquipment(p.equipment.id)}><Ban size={13}/> I don&apos;t have this</button>}</li>)}</ul>
        {ignoredIds.length>0&&<p className="optimizer-meta">Ignored as not owned: {ignoredIds.map(id=>equipmentById.get(id)?.name??id).join(', ')}. <button type="button" className="text-button" disabled={optimizing} onClick={()=>{setIgnoredIds([]);void runOptimizer([]);}}>Restore all and search again</button></p>}
        {optimizedSummary&&<p className="optimizer-meta">Defense {optimizedSummary.defense} · Decorations {optimizedSummary.usedSlots} / {optimizedSummary.totalSlots} · {optimizerResult.evaluated.toLocaleString()} combinations evaluated · Candidates: {Object.entries(optimizerResult.candidates).map(([slot,count])=>`${labels[slot as BuildSlot]} ${count}`).join(', ')}</p>}
        {optimizerResult.notes.map(note=><p className="inline-note" key={note}>{note}</p>)}
        <div className="optimizer-actions"><button className="primary-button" type="button" onClick={applyOptimizer}>Apply optimized build</button><button className="secondary-button" type="button" onClick={closeOptimizer}>Cancel</button></div>
      </>}
    </DialogContent></Dialog>
  </div></SkillDescriptions>;
}

