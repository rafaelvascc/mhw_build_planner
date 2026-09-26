'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export type AppDropdownOption = {
  value: string;
  label: string;
  searchText?: string;
  content?: ReactNode;
  disabled?: boolean;
};

type CommonProps = {
  label: string;
  options: AppDropdownOption[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
};

type SingleProps = CommonProps & {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultipleProps = CommonProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  selectionLabel?: (count: number) => string;
  clearLabel?: string;
};

export type AppDropdownProps = SingleProps | MultipleProps;
type MenuLayout = { host:HTMLElement; style:CSSProperties };

export function AppDropdown(props: AppDropdownProps) {
  const {
    label,
    options,
    placeholder = 'Select an option',
    searchable = false,
    searchPlaceholder = 'Search…',
    emptyText = 'No matching options',
    disabled = false,
    className = '',
    triggerClassName = '',
  } = props;
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState<MenuLayout|null>(null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = props.multiple ? props.value : [props.value];

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter(option => `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [options, query]);

  const selectedOption = !props.multiple ? options.find(option => option.value === props.value) : undefined;
  const triggerText = props.multiple
    ? props.value.length
      ? props.selectionLabel?.(props.value.length) ?? `${props.value.length} selected`
      : placeholder
    : selectedOption?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target=event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const positionMenu=()=>{
      const trigger=triggerRef.current;if(!trigger)return;
      const bounds=trigger.getBoundingClientRect(),dialogHost=trigger.closest<HTMLElement>('[data-slot="dialog-content"]');
      const host=dialogHost??document.body,hostBounds=dialogHost?.getBoundingClientRect();
      const viewportWidth=document.documentElement.clientWidth,viewportHeight=window.innerHeight,gap=6;
      const width=Math.min(Math.max(bounds.width,260),420,viewportWidth-16);
      const viewportLeft=Math.min(Math.max(bounds.left,8),viewportWidth-width-8);
      const spaceAbove=bounds.top-8,spaceBelow=viewportHeight-bounds.bottom-8;
      const opensUp=spaceBelow<330&&spaceAbove>spaceBelow;
      const available=Math.max(120,Math.min(330,(opensUp?spaceAbove:spaceBelow)-gap));
      const style:CSSProperties={position:dialogHost?'absolute':'fixed',top:'auto',bottom:'auto',left:viewportLeft-(hostBounds?.left??0),width,minWidth:width,maxWidth:width,maxHeight:available};
      if(opensUp)style.bottom=(hostBounds?.bottom??viewportHeight)-bounds.top+gap;
      else style.top=bounds.bottom-(hostBounds?.top??0)+gap;
      setMenuLayout({host,style});
    };
    positionMenu();
    window.addEventListener('resize',positionMenu);
    window.addEventListener('scroll',positionMenu,true);
    return ()=>{window.removeEventListener('resize',positionMenu);window.removeEventListener('scroll',positionMenu,true);};
  }, [open]);

  useEffect(() => {
    if (open && searchable && menuLayout?.host) searchRef.current?.focus({preventScroll:true});
  }, [open, searchable, menuLayout?.host]);

  const close = () => {
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    setQuery('');
    setOpen(true);
  };

  const choose = (option: AppDropdownOption) => {
    if (option.disabled) return;
    if (props.multiple) {
      props.onChange(props.value.includes(option.value)
        ? props.value.filter(value => value !== option.value)
        : [...props.value, option.value]);
    } else {
      props.onChange(option.value);
      close();
    }
  };

  const focusOption = (event: KeyboardEvent<HTMLElement>, direction: 1 | -1) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? (direction === 1 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
  };

  const menu=open?<div ref={menuRef} className="app-dropdown-menu" data-slot="app-dropdown-positioner" style={menuLayout?.style}>
    {searchable && <div className="app-dropdown-search"><Search size={15}/><input ref={searchRef} aria-label={`Search ${label}`} placeholder={searchPlaceholder} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowDown') focusOption(event, 1);
      else if (event.key === 'ArrowUp') focusOption(event, -1);
    }}/></div>}
    <div id={listId} className="app-dropdown-options" role="listbox" aria-label={`${label} options`} aria-multiselectable={props.multiple || undefined}>
      {filteredOptions.map(option => {
        const isSelected = selected.includes(option.value);
        return <button
          type="button"
          role="option"
          aria-selected={isSelected}
          key={option.value}
          disabled={option.disabled}
          className={`app-dropdown-option ${isSelected ? 'selected' : ''}`}
          onClick={() => choose(option)}
          onKeyDown={event => {
            if (event.key === 'Escape') close();
            else if (event.key === 'ArrowDown') focusOption(event, 1);
            else if (event.key === 'ArrowUp') focusOption(event, -1);
          }}
        >
          <span className="app-dropdown-check">{isSelected && <Check size={13}/>}</span>
          <span className="app-dropdown-option-content">{option.content ?? option.label}</span>
        </button>;
      })}
      {!filteredOptions.length && <span className="app-dropdown-empty">{emptyText}</span>}
    </div>
    {props.multiple && props.value.length > 0 && <button type="button" className="app-dropdown-clear" onClick={() => props.onChange([])}>{props.clearLabel ?? 'Clear selection'}</button>}
  </div>:null;

  return <div ref={rootRef} className={`filter-label app-dropdown ${open ? 'open' : ''} ${className}`}>
    <span>{label}</span>
    <button
      ref={triggerRef}
      type="button"
      className={`filter-select app-dropdown-trigger ${triggerClassName}`}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled}
      onClick={() => open ? close() : openMenu()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          openMenu();
          event.preventDefault();
        } else if (event.key === 'Escape') close();
      }}
    >
      <span>{triggerText}</span><ChevronDown size={16}/>
    </button>
    {menu&&(menuLayout?.host?createPortal(menu,menuLayout.host):menu)}
  </div>;
}
