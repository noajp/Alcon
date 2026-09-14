'use client';
import { useState } from 'react';
import type { DataColumn } from '@/ActivitySpace/execution/object/useListColumns';
import { MenuSectionLabel } from '@/Function/shared/menu';
import { Button, ButtonAppearanceProvider } from '@/ui/button';

/** Shared by the table header and Display panel. Hiding never deletes data. */
export function FieldVisibility({ columns, isVisible, onToggle }: {
  columns: DataColumn[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const matching = columns.filter((c) => c.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <ButtonAppearanceProvider appearance="navigation"><div className="space-y-2">
    <input aria-label="Find fields" placeholder="Find fields…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-8 bg-transparent px-2 text-sm focus:bg-muted rounded-md" />
    {(['builtin', 'custom'] as const).map((kind) => {
      const fields = matching.filter((c) => c.kind === kind);
      if (!fields.length) return null;
      return <div key={kind}><MenuSectionLabel>{kind === 'builtin' ? 'Default fields' : 'Custom fields'}</MenuSectionLabel>
        {fields.map((c) => <Button type="button" key={c.id} variant="ghost" size="md" className="w-full justify-between" role="switch" aria-checked={isVisible(c.id)} aria-label={`Show ${c.label}`} disabled={!c.toggleable} onClick={() => onToggle(c.id)}>
          <span className="truncate">{c.label}</span>
          <span aria-hidden className={`w-8 h-4 rounded-full p-0.5 shrink-0 ${isVisible(c.id) ? 'bg-primary' : 'bg-muted-foreground'}`}><span className={`block size-3 rounded-full bg-background transition-transform ${isVisible(c.id) ? 'translate-x-4' : ''}`} /></span>
        </Button>)}
      </div>;
    })}
    {!matching.length && <p className="px-2 py-3 text-sm text-muted-foreground">No fields found</p>}
  </div></ButtonAppearanceProvider>;
}
