import type { CSSProperties } from 'react';
import { labels, weaponTypes, type Decoration, type EquipmentSlot, type BuildSlot, type SlotKind } from '@/lib/planner';
import rarityPalette from '@/lib/icon-palette.json';

export function rarityStyle(rarity:number):CSSProperties {
  return {color:rarityPalette[String(rarity) as keyof typeof rarityPalette]??'currentColor'};
}

export function EquipmentIcon({slot,kind,rarity,size=36}:{slot:EquipmentSlot|BuildSlot;kind?:string;rarity?:number;size?:number}) {
  const type=slot==='weapon'||slot==='secondaryWeapon'?(kind&&kind in weaponTypes?kind:'great-sword'):slot;
  const label=slot==='weapon'?weaponTypes[type]:labels[slot];
  return <img className={`game-icon ${rarity==null?'game-icon-neutral':''}`} src={`/icons/equipment/${type}-${rarity??1}.svg`} width={size} height={size} alt="" aria-hidden="true" title={`${label}${rarity!=null?` · Rarity ${rarity}`:''}`} draggable={false}/>;
}

export function DecorationIcon({decoration,size=36}:{decoration:Pick<Decoration,'level'|'icon'>;size?:number}) {
  return <img className="game-icon jewel-icon" src={`/icons/decorations/${decoration.level}-${decoration.icon?.color??'white'}.png`} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}

export function DecorationSlotIcon({level,kind,size=26}:{level:number;kind:SlotKind;size?:number}) {
  return <span className={`game-slot-icon ${kind}`} role="img" aria-label={`${kind} slot, level ${level}`} title={`${kind==='weapon'?'Weapon':'Armor'} slot · Level ${level}`} style={{width:size,height:size}}>
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M10 4h20l7 7v9L25 34H15L3 20v-9Z" stroke="currentColor" strokeWidth="2"/>{Array.from({length:level},(_,i)=><path key={i} d={`M${20+(i-(level-1)/2)*9} 35l-3 4h6Z`} fill="currentColor"/>)}</svg><b>{level}</b>
  </span>;
}
