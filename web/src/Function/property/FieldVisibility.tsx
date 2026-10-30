'use client';
import { useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fieldDisplayLabel } from './fieldModel';
import type { DataColumn } from '@/Function/shared/listTable/useListColumns';
import { MenuSectionLabel } from '@/Function/shared/menu';
import { Button, ButtonAppearanceProvider } from '@/ui/button';

/** Shared by the table header and Display panel. Hiding never deletes data. */
export function FieldVisibility({ columns, isVisible, onToggle, compact = false }: {
  compact?: boolean;
  columns: DataColumn[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const labelOf = (c: DataColumn) => fieldDisplayLabel(t, c);
  const matching = columns.filter((c) => labelOf(c).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (compact) return <div className="px-2 py-2">
    <MenuSectionLabel className="px-0 pb-2">{t('Display properties')}</MenuSectionLabel>
    <div className="flex flex-wrap gap-1.5">
      {columns.map((c) => <Button key={c.id} type="button" size="sm" variant={isVisible(c.id) ? 'secondary' : 'ghost'} className={`max-w-full ${isVisible(c.id) ? 'bg-[var(--surface-strong)]' : 'text-muted-foreground'}`}
        aria-pressed={isVisible(c.id)} disabled={!c.toggleable} onClick={() => onToggle(c.id)} title={labelOf(c)}><span className="truncate">{labelOf(c)}</span></Button>)}
    </div>
  </div>;
  return <ButtonAppearanceProvider appearance="navigation"><div className="space-y-2">
    <input aria-label={t('Find fields')} placeholder={t('Find fields…')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-8 bg-transparent px-2 text-sm focus:bg-muted rounded-md" />
    {(['builtin', 'custom'] as const).map((kind) => {
      const fields = matching.filter((c) => c.kind === kind);
      if (!fields.length) return null;
      return <div key={kind}><MenuSectionLabel>{kind === 'builtin' ? t('Default fields') : t('Custom fields')}</MenuSectionLabel>
        {fields.map((c) => <Button type="button" key={c.id} variant="ghost" size="md" className="w-full justify-between" role="switch" aria-checked={isVisible(c.id)} aria-label={t('Show {name}', { name: labelOf(c) })} disabled={!c.toggleable} onClick={() => onToggle(c.id)}>
          <span className="truncate">{labelOf(c)}</span>
          <span aria-hidden className={`w-8 h-4 rounded-full p-0.5 shrink-0 ${isVisible(c.id) ? 'bg-primary' : 'bg-muted-foreground'}`}><span className={`block size-3 rounded-full bg-background transition-transform ${isVisible(c.id) ? 'translate-x-4' : ''}`} /></span>
        </Button>)}
      </div>;
    })}
    {!matching.length && <p className="px-2 py-3 text-sm text-muted-foreground">{t('No fields found')}</p>}
  </div></ButtonAppearanceProvider>;
}
