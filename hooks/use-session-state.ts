'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/** React state mirrored into sessionStorage, so it survives reloads for the lifetime of the browser tab. `parse` validates stored data and returns null to fall back to the initial value. */
export function useSessionState<T>(key:string,initial:T,parse:(value:unknown)=>T|null):[T,Dispatch<SetStateAction<T>>] {
  const [value,setValue]=useState<T>(()=>{
    try {
      if(typeof window==='undefined')return initial;
      const raw=window.sessionStorage.getItem(key);
      return raw==null?initial:parse(JSON.parse(raw))??initial;
    } catch { return initial; }
  });
  useEffect(()=>{ try { window.sessionStorage.setItem(key,JSON.stringify(value)); } catch {} },[key,value]);
  return [value,setValue];
}
