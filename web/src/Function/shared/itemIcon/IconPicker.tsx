'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { DynamicIcon, iconNames, type IconName } from '@/ui/icons/dynamic';
import { Search } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ALCON_GLYPHS, ItemIcon } from './ItemIcon';
import {
  ITEM_COLORS, glyphIcon, isPaletteColor, itemColor, lucideIcon, matchesSearch,
  parseItemIcon, readRecentEmoji, rememberEmoji,
} from './itemIconValue';

export interface ItemLook { icon: string | null; color: string | null }

type Tab = 'icons' | 'emoji';

interface EmojiRow { unicode: string; label: string; tags?: string[]; group?: number; order?: number }

/** The emoji groups the picker shows, in Unicode's order (skin tones and
 *  other components are left out). */
const EMOJI_GROUPS: [group: number, label: string][] = [
  [0, 'Smileys & Emotion'], [1, 'People & Body'], [3, 'Animals & Nature'], [4, 'Food & Drink'],
  [5, 'Travel & Places'], [6, 'Activities'], [7, 'Objects'], [8, 'Symbols'], [9, 'Flags'],
];

let emojiCache: Promise<EmojiRow[]> | null = null;
function loadEmoji(): Promise<EmojiRow[]> {
  emojiCache ??= import('emojibase-data/ja/compact.json')
    .then((m) => (m.default as EmojiRow[])
      .filter((e) => e.group !== undefined && e.group !== 2)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    .catch((e) => { emojiCache = null; throw e; });
  return emojiCache;
}

const PAGE = 160;

/** The custom-colour swatch before a colour is chosen: every swatch colour in a ring. */
const RAINBOW = `conic-gradient(${[...ITEM_COLORS.slice(2), ITEM_COLORS[2]].map((c) => c.hex).join(', ')})`;

/**
 * Picks an icon and a colour for a Strategy, Object or Element: Alcon's own
 * drawings and the standard set (tinted by the colour above them), or an
 * emoji. Nothing is saved here — `onChange` gets the new look.
 */
export function IconPicker({ value, onChange, children, defaultIcon, align = 'start' }: {
  value: ItemLook;
  onChange: (next: ItemLook) => void;
  children: ReactNode;
  /** The concept's own icon, shown on the "default" choice. */
  defaultIcon: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (parseItemIcon(value.icon)?.kind === 'emoji' ? 'emoji' : 'icons'));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const pick = (next: Partial<ItemLook>) => onChange({ ...value, ...next });

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(''); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[372px] p-0" onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}>
        <div className="flex items-center gap-4 border-b border-border px-3 pt-2" role="tablist">
          {(['icons', 'emoji'] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setQuery(''); }}
              className={`-mb-px border-b-2 px-0.5 pb-2 text-[13px] transition-colors ${tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {key === 'icons' ? t('Icons') : t('Emojis')}
            </button>
          ))}
          <button type="button" onClick={() => { onChange({ icon: null, color: null }); setOpen(false); }}
            className="ml-auto pb-2 text-[12px] text-muted-foreground hover:text-foreground">
            {t('Reset')}
          </button>
        </div>

        {tab === 'icons' && <ColorRow value={value.color} onPick={(color) => pick({ color })} defaultIcon={defaultIcon} />}

        <label className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={14} className="text-muted-foreground" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'icons' ? t('Search icons…') : t('Search emoji…')}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
        </label>

        <div className="h-[300px] overflow-y-auto px-2 pb-2">
          {tab === 'icons'
            ? <IconGrid query={query} value={value} onPick={(icon) => { pick({ icon }); setOpen(false); }} />
            : <EmojiGrid query={query} onPick={(icon) => { rememberEmoji(icon); pick({ icon }); setOpen(false); }} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorRow({ value, onPick, defaultIcon }: { value: string | null; onPick: (color: string | null) => void; defaultIcon: ReactNode }) {
  const { t } = useI18n();
  const custom = value && !isPaletteColor(value) ? itemColor(value) : null;
  const swatch = 'flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:scale-110';
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <button type="button" aria-label={t('Default colour')} title={t('Default colour')} onClick={() => onPick(null)}
        className={`${swatch} bg-muted text-muted-foreground ${value ? '' : 'ring-2 ring-foreground/60'}`}>
        <span className="flex scale-75">{defaultIcon}</span>
      </button>
      {ITEM_COLORS.map((c) => (
        <button key={c.key} type="button" aria-label={t(c.label)} title={t(c.label)} onClick={() => onPick(c.key)}
          className={`${swatch} ${value === c.key ? 'ring-2 ring-foreground/60' : ''}`} style={{ background: c.hex }} />
      ))}
      <label title={t('Custom colour')} aria-label={t('Custom colour')}
        className={`${swatch} relative ml-auto cursor-pointer overflow-hidden border border-border ${custom ? 'ring-2 ring-foreground/60' : ''}`}
        style={{ background: custom ?? RAINBOW }}>
        <input type="color" value={custom ?? itemColor(ITEM_COLORS[0].key) ?? undefined} onChange={(e) => onPick(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

function IconGrid({ query, value, onPick }: { query: string; value: ItemLook; onPick: (icon: string) => void }) {
  const { t } = useI18n();
  const tone = itemColor(value.color);
  const alcon = useMemo(() => ALCON_GLYPHS.filter(([name]) => matchesSearch(query, name)), [query]);
  const standard = useMemo(() => iconNames.filter((name) => matchesSearch(query, name)), [query]);
  // How many of the standard set are shown, counted per search.
  const [paging, setPaging] = useState({ query, shown: PAGE });
  const shown = paging.query === query ? paging.shown : PAGE;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setPaging((p) => ({ query, shown: (p.query === query ? p.shown : PAGE) + PAGE }));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [standard.length, query]);

  const cell = (key: string, icon: string, title: string, glyph: ReactNode) => (
    <button key={key} type="button" title={title} aria-label={title} onClick={() => onPick(icon)}
      className={`flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground ${value.icon === icon ? 'bg-accent' : ''}`}
      style={tone ? { color: tone } : undefined}>
      {glyph}
    </button>
  );

  return (
    <>
      {alcon.length > 0 && <Section title="Alcon">
        {alcon.map(([name, Glyph]) => cell(`g-${name}`, glyphIcon(name), name, <Glyph size={16} />))}
      </Section>}
      {standard.length > 0 && <Section title={t('Standard')}>
        {standard.slice(0, shown).map((name) => cell(`l-${name}`, lucideIcon(name), name,
          <DynamicIcon name={name as IconName} size={16} strokeWidth={2} fallback={() => <span className="size-4" />} />))}
      </Section>}
      {shown < standard.length && <div ref={sentinel} className="h-6" />}
      {alcon.length === 0 && standard.length === 0 && <Empty>{t('No icons match.')}</Empty>}
    </>
  );
}

function EmojiGrid({ query, onPick }: { query: string; onPick: (emoji: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<EmojiRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [recent] = useState(readRecentEmoji);
  useEffect(() => { loadEmoji().then(setRows, () => setFailed(true)); }, []);

  const matches = useMemo(() => (rows ?? []).filter((e) => matchesSearch(query, e.label, ...(e.tags ?? []))), [rows, query]);
  if (failed) return <Empty>{t('Could not load emoji.')}</Empty>;
  if (!rows) return <Empty>{t('Loading…')}</Empty>;

  const cell = (emoji: string, label: string, key: string) => (
    <button key={key} type="button" title={label} aria-label={label} onClick={() => onPick(emoji)}
      className="flex size-8 items-center justify-center rounded-md text-[20px] leading-none hover:bg-accent">
      {emoji}
    </button>
  );

  if (query.trim()) {
    return matches.length ? <Section title={t('Results')}>{matches.map((e) => cell(e.unicode, e.label, e.unicode))}</Section> : <Empty>{t('No emoji match.')}</Empty>;
  }
  return (
    <>
      {recent.length > 0 && <Section title={t('Frequently used')}>{recent.map((e) => cell(e, e, `r-${e}`))}</Section>}
      {EMOJI_GROUPS.map(([group, label]) => (
        <Section key={group} title={t(label)}>
          {rows.filter((e) => e.group === group).map((e) => cell(e.unicode, e.label, e.unicode))}
        </Section>
      ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-2.5">
      <h3 className="px-1 pb-1.5 text-[12px] font-medium text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-10 gap-0.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The icon at the head of a concept page, which opens the picker when the
 * viewer may edit it. Saving is the caller's (`onChange`).
 */
export function ItemIconButton({ value, onChange, defaultIcon, size = 18, canEdit = true, label }: {
  value: ItemLook;
  onChange: (next: ItemLook) => void;
  defaultIcon: ReactNode;
  size?: number;
  canEdit?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const icon = <ItemIcon icon={value.icon} color={value.color} fallback={defaultIcon} size={size} />;
  if (!canEdit) return icon;
  return (
    <IconPicker value={value} onChange={onChange} defaultIcon={defaultIcon}>
      <button type="button" aria-label={label ?? t('Change icon')} title={label ?? t('Change icon')}
        className="-m-1 rounded-md p-1 outline-none transition-colors hover:bg-accent focus-visible:bg-accent">
        {icon}
      </button>
    </IconPicker>
  );
}

/**
 * A concept's look as shown, kept ahead of the save: the pick shows at once,
 * and goes back to the stored look if saving fails.
 */
export function useItemLook(stored: ItemLook, save: (next: ItemLook) => Promise<unknown>) {
  // The pick waits on top of the stored look it was made over; once the
  // stored look changes (saved, or changed elsewhere) the stored one shows.
  const base = `${stored.icon ?? ''}|${stored.color ?? ''}`;
  const [pending, setPending] = useState<{ base: string; look: ItemLook } | null>(null);
  const look = pending && pending.base === base ? pending.look : stored;
  const change = (next: ItemLook) => {
    setPending({ base, look: next });
    save(next).catch((e) => { console.error('Failed to save icon', e); setPending(null); });
  };
  return [look, change] as const;
}
