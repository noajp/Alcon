'use client';

import { useState } from 'react';
import { Check, ChevronDown, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';

export interface PickerOption { id: string; label: string; hint?: string | null }

/** A searchable choice. `onCreate` offers the typed text as a new record. */
export function CrmPicker({ label, value, options, onChange, onCreate, placeholder, disabled, clearable = true, block = false }: {
  label: string;
  value: string | null;
  options: readonly PickerOption[];
  onChange: (id: string | null) => void;
  onCreate?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  block?: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = options.filter(option => `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(query)).slice(0, 80);
  const current = options.find(option => option.id === value);
  const exact = options.some(option => option.label.trim().toLowerCase() === query);
  return <DropdownMenu onOpenChange={() => setSearch('')}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="sm" align="start" disabled={disabled} aria-label={label}
        className={`max-w-full font-normal ${block ? 'w-full' : ''} ${current ? '' : 'text-[var(--text-tertiary)]'}`}>
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? placeholder ?? t('Choose…')}</span><ChevronDown size={12} />
      </Button>
    </DropdownMenuTrigger>
    <MenuShell as="dropdown" width="wide" align="start">
      <input autoFocus aria-label={t('Search {name}', { name: label })} placeholder={t('Search or type…')}
        className="h-8 w-full rounded-sm bg-transparent px-2 text-sm outline-none focus:bg-muted/40"
        value={search} onChange={event => setSearch(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && onCreate && query && !exact && !visible.length) { event.preventDefault(); onCreate(search.trim()); }
          if (!['Escape', 'ArrowDown', 'Enter'].includes(event.key)) event.stopPropagation();
        }} />
      <div className="max-h-72 overflow-y-auto">
        {clearable && value && <DropdownMenuItem className={MENU_ROW} onSelect={() => onChange(null)}><span className="text-muted-foreground">{t('Clear')}</span></DropdownMenuItem>}
        {visible.map(option => <DropdownMenuItem key={option.id} className={MENU_ROW} onSelect={() => onChange(option.id)}>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.hint && <span className="max-w-32 truncate text-xs text-muted-foreground">{option.hint}</span>}
          <span className="flex w-4 justify-end">{option.id === value && <Check size={12} />}</span>
        </DropdownMenuItem>)}
        {onCreate && query && !exact && <DropdownMenuItem className={MENU_ROW} onSelect={() => onCreate(search.trim())}><Plus size={12} />{t('Create “{name}”', { name: search.trim() })}</DropdownMenuItem>}
        {!visible.length && !(onCreate && query) && <p className="px-2 py-2 text-xs text-muted-foreground">{t('No matches.')}</p>}
      </div>
    </MenuShell>
  </DropdownMenu>;
}
