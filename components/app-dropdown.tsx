'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
  inline?: boolean;
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

export function AppDropdown(props: AppDropdownProps) {
  const {
    label,
    options,
    placeholder = 'Select an option',
    searchable = false,
    searchPlaceholder = 'Search…',
    emptyText = 'No matching options',
    disabled = false,
    inline = false,
    className = '',
    triggerClassName = '',
  } = props;
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || inline || !triggerRef.current) return;
    const bounds = triggerRef.current.getBoundingClientRect();
    setOpenUp(window.innerHeight - bounds.bottom < 330 && bounds.top > window.innerHeight - bounds.bottom);
  }, [inline, open]);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

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
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? (direction === 1 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
  };

  return <div ref={rootRef} className={`filter-label app-dropdown ${open ? 'open' : ''} ${openUp ? 'open-up' : ''} ${inline ? 'inline' : ''} ${className}`}>
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
    {open && <div className="app-dropdown-menu">
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
    </div>}
  </div>;
}
