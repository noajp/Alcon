'use client';

import { useMemo, useState } from 'react';
import { Plus, LayoutGrid } from '@/ui/icons';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Button } from '@/ui/button';
import { MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WIDGET_REGISTRY } from './registry';
import type { SubjectKind, WidgetDefinition, WidgetGroup, Zone } from './types';

// Sentence case, in the order a board is usually built: what the thing is,
// then how it is going, then the detail.
const GROUP_LABEL: Record<WidgetGroup, string> = {
  core: 'Core',
  progress: 'Progress',
  plan: 'Plan',
  chart: 'Charts',
  list: 'Lists',
};

const GROUP_ORDER: WidgetGroup[] = ['core', 'progress', 'plan', 'chart', 'list'];

/**
 * The one + on a surface, top right.
 *
 * One button rather than one per zone: a widget already knows where it
 * belongs (`zones[0]` is its home — a progress bar is a band, Properties is a
 * rail island), so asking the user to pick the zone first would be asking
 * them to answer a question the widget can answer itself.
 */
export function WidgetPicker({
  disabled = false,
  subjectKind,
  availableZones,
  placedTypes,
  arranging,
  onAdd,
  onArrange,
}: {
  disabled?: boolean;
  subjectKind: SubjectKind;
  /** Zones this surface actually renders — a rail widget must not be added
   *  to a surface with no rail, where it would simply never appear. */
  availableZones: Zone[];
  placedTypes: Set<string>;
  arranging: boolean;
  onAdd: (zone: Zone, type: string) => void;
  onArrange: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Availability is derived, never enumerated: a widget shows up here because
  // it accepts this subject and one of its zones exists here. Adding a
  // surface adds nothing to any widget definition.
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries: { def: WidgetDefinition; zone: Zone }[] = [];
    for (const def of Object.values(WIDGET_REGISTRY)) {
      if (!def.accepts.includes(subjectKind)) continue;
      const zone = def.zones.find((z) => availableZones.includes(z));
      if (!zone) continue;
      if (def.singleton && placedTypes.has(def.type)) continue;
      // Found by what it is called on screen, in either language.
      const names = [def.label, t(def.label), def.description ?? '', def.description ? t(def.description) : ''];
      if (q && !names.some((name) => name.toLowerCase().includes(q))) continue;
      entries.push({ def, zone });
    }
    return entries;
  }, [query, subjectKind, availableZones, placedTypes, t]);

  const grouped = useMemo(() => {
    const map = new Map<WidgetGroup, { def: WidgetDefinition; zone: Zone }[]>();
    for (const entry of available) {
      const list = map.get(entry.def.group) ?? [];
      list.push(entry);
      map.set(entry.def.group, list);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [available]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button disabled={disabled} variant="ghost" size="sm">
          <Plus size={14} />
          {t('Add widget')}
        </Button>
      </PopoverTrigger>
      <MenuShell align="end" width="wide">
        {/* Verb-phrase placeholder, no ring, no border. */}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Find a widget…')}
          className="w-full px-2 py-1 text-[13px] bg-muted/40 rounded-md border-none placeholder:text-muted-foreground/60"
        />
        <div className={MENU_SEPARATOR} />

        {grouped.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">
            {t('Nothing else fits here.')}
          </div>
        )}

        {grouped.map(([group, entries]) => (
          <div key={group}>
            <MenuSectionLabel>{t(GROUP_LABEL[group])}</MenuSectionLabel>
            {entries.map(({ def, zone }) => (
              // One line per widget: its name, then what it shows, cut to the
              // row — the whole sentence is the row's tooltip. A menu whose
              // rows wrap to three lines reads as a page, not a list.
              <button
                key={def.type}
                type="button"
                title={def.description ? t(def.description) : undefined}
                className={MENU_ROW}
                onClick={() => {
                  onAdd(zone, def.type);
                  setOpen(false);
                }}
              >
                <span className="shrink-0 text-foreground">{t(def.label)}</span>
                {def.description && (
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{t(def.description)}</span>
                )}
              </button>
            ))}
          </div>
        ))}

        {/* The keyboard route into arrange mode. A long press is the fast way
            in and the only one most people will ever use, but it cannot be
            reached from a keyboard, so the mode has to be nameable somewhere. */}
        {!arranging && (
          <>
            <div className={MENU_SEPARATOR} />
            <button
              type="button"
              className={MENU_ROW}
              onClick={() => {
                onArrange();
                setOpen(false);
              }}
            >
              <LayoutGrid size={14} className="text-muted-foreground" />
              <span className="flex-1">{t('Arrange widgets')}</span>
              <span className="text-[11px] text-muted-foreground">{t('Hold')}</span>
            </button>
          </>
        )}
      </MenuShell>
    </Popover>
  );
}
