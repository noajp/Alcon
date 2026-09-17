'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/ui/command';
import { MenuShell } from '@/Function/shared/menu';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/Function/shared/conceptIcons';
import type { Domain, AlconObject } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';

export interface CalendarSelection {
  mine: boolean;
  domainIds: string[];
  objectIds: string[];
}

interface Props {
  domains: Domain[];
  objects: AlconObject[];
  selection: CalendarSelection;
  onChange: (selection: CalendarSelection) => void;
}

const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];

export function CalendarScopePicker({ domains, objects, selection, onChange }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'mine' | 'domains' | 'objects'>('domains');
  const [search, setSearch] = useState('');
  const names = selection.mine ? [t('My Elements')] : selection.objectIds.length
    ? objects.filter(object => selection.objectIds.includes(object.id)).map(object => object.name)
    : domains.filter(domain => selection.domainIds.includes(domain.id)).map(domain => domain.name);
  const Icon = selection.mine ? ElementIcon : selection.objectIds.length ? ObjectIcon : DomainIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" align="start" aria-label={t('Choose calendar scope')} title={names.join(', ')}>
          <Icon size={16} /><span className="max-w-48 truncate">{names[0] ?? t('Choose scope')}{names.length > 1 ? ` +${names.length - 1}` : ''}</span><ChevronsUpDown size={12} />
        </Button>
      </PopoverTrigger>
      <MenuShell width="wide" align="end">
        <div className="flex gap-1 p-1" aria-label={t('Calendar scope lists')}>
          {([{ id: 'mine', label: 'My Elements' }, { id: 'domains', label: 'Domains' }, { id: 'objects', label: 'Objects' }] as const).map(item => (
            <Button shape="tab" key={item.id} size="xs" variant={tab === item.id ? 'secondary' : 'ghost'} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setSearch(''); }}>{t(item.label)}</Button>
          ))}
        </div>
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('Find a calendar…')} />
          <CommandList>
            <CommandEmpty>{t('No matches.')}</CommandEmpty>
            {tab === 'mine' ? (
              <CommandItem onSelect={() => onChange({ ...selection, mine: true })}>
                <ElementIcon size={16} /><span className="flex-1">{t('My Elements')}</span>{selection.mine && <Check size={12} />}
              </CommandItem>
            ) : (tab === 'domains' ? domains : objects).map(item => {
              const checked = !selection.mine && (tab === 'domains' ? selection.domainIds : selection.objectIds).includes(item.id);
              const RowIcon = tab === 'domains' ? DomainIcon : ObjectIcon;
              return (
                <CommandItem key={item.id} value={`${item.name} ${item.id}`} keywords={[item.name]} onSelect={() => onChange(tab === 'domains'
                  ? { mine: false, domainIds: toggle(selection.domainIds, item.id), objectIds: [] }
                  : { ...selection, mine: false, objectIds: toggle(selection.objectIds, item.id) })}>
                  <RowIcon size={16} /><span className="flex-1 truncate">{item.name}</span>{checked && <Check size={12} />}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}
