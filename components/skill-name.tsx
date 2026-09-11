'use client';

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { Skill } from '@/lib/planner';

const SkillsContext=createContext<Skill[]>([]);

export function SkillDescriptions({skills,children}:{skills:Skill[];children:ReactNode}) {
  return <SkillsContext.Provider value={skills}>{children}</SkillsContext.Provider>;
}

export function SkillName({id,name,level,passive=false,showLevel=true}:{id?:number;name?:string;level?:number;passive?:boolean;showLevel?:boolean}) {
  const skills=useContext(SkillsContext);
  const skill=useMemo(()=>skills.find(s=>id!=null?s.id===id:s.name===name),[skills,id,name]);
  const [open,setOpen]=useState(false);
  const descriptionId=useId();
  if(!skill)return <span>{name??'Unknown skill'}</span>;
  return <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={200}>
    <HoverCardTrigger asChild>
      <span className="skill-name" tabIndex={passive?undefined:0} role={passive?undefined:'button'} aria-expanded={passive?undefined:open} aria-describedby={open?descriptionId:undefined}
        onClick={passive?undefined:event=>{event.preventDefault();event.stopPropagation();setOpen(true);}}
        onKeyDown={passive?undefined:event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setOpen(true);}}}>
        {skill.name}{showLevel&&level!=null&&<span className="skill-name-level"> {level}</span>}
      </span>
    </HoverCardTrigger>
    <HoverCardContent id={descriptionId} className="skill-hover-card" side="top" align="start" sideOffset={8} collisionPadding={16}
      onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onEscapeKeyDown={event=>{event.stopPropagation();setOpen(false);}}>
      <h3>{skill.name}</h3>
      {skill.description&&<p className="skill-full-description">{skill.description}</p>}
      <dl className="skill-ranks">{skill.ranks.map(rank=><div key={rank.level} className={rank.level===level?'current-rank':''}>
        <dt>Level {rank.level}{rank.pieces!=null&&` · ${rank.pieces} pieces`}{rank.level===level&&<span>Selected level</span>}</dt>
        <dd>{rank.name&&<b>{rank.name}</b>}{rank.description||'No additional description available.'}</dd>
      </div>)}</dl>
      {!skill.description&&!skill.ranks.length&&<p>No description available in the catalog.</p>}
    </HoverCardContent>
  </HoverCard>;
}
