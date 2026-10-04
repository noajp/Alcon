'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { MenuShell } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date';
import { EmptyState } from '@/Function/shared/EmptyState';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { fromDateOnlyString } from '@/Function/shared/dateUtils';
import { useStrategies, useDomains, useObjects } from '@/hooks/useSupabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useInitiativeHealth } from '@/ActivitySpace/strategy/initiative/useInitiativeHealth';
import { usePortfolios } from '@/ActivitySpace/strategy/portfolio/data';
import { buildPortfolioTree, groupByPortfolio, initiativesInSpace, rollupPortfolio } from '@/ActivitySpace/strategy/portfolio/portfolioGroups';
import { NavPortfolioIcon, NavStrategyIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import type { StrategyWithObjects, Vision, VisionUpdate } from '@/types/database';
import { createVision, resolveVision, setStrategyVision, updateVision, useSpaceRoleQuery, useVisions } from './data';

// Strategy > Vision — what the Space aims for. A Space holds any number of
// Visions, the way it holds Domains: each one has a name, the aim in one
// statement, by when, why, and how the Space will know it got there; under
// it sit its Portfolios and the Initiatives placed directly under it. A
// Vision is edited by whoever wrote it or by a Space owner; every member
// reads it. Each field saves on blur.
export function VisionView({ visionId, createRequested, onCreateHandled, onSelectVision, onOpenPortfolio, onSelectStrategy }: {
  visionId: string | null;
  createRequested: boolean;
  onCreateHandled: () => void;
  onSelectVision: (id: string) => void;
  onOpenPortfolio: (id: string) => void;
  onSelectStrategy: (id: string) => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const userId = useCurrentUserId();
  const { data: visions, loading } = useVisions(spaceId);
  const vision = resolveVision(visions, visionId);

  // The viewer's seat in the Space: an owner may edit any Vision.
  const role = useSpaceRoleQuery(spaceId);
  const canEdit = !!vision && (vision.created_by === userId || role.data === 'owner');

  const [localNew, setLocalNew] = useState(false);
  const newOpen = localNew || createRequested;
  const closeNew = () => { setLocalNew(false); if (createRequested) onCreateHandled(); };

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavVisionIcon size={12} />
        <span className="truncate text-[12px] font-semibold text-foreground">{vision?.name ?? t('Vision')}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" type="button"
          onClick={() => setLocalNew(true)} title={t('New Vision')} aria-label={t('New Vision')}>
          <Plus size={14} />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading || role.isPending ? null : !vision ? (
          <EmptyState icon={NavVisionIcon} title={t('Add a Vision')}
            description={t('A Vision says what this Space aims for. Portfolios and Initiatives hang under it, the way Objects and Elements hang under a Domain.')}
            hint={t('A Space can hold several Visions.')}
            cta={t('Create Vision')} onCta={() => setLocalNew(true)} />
        ) : (
          <div className="mx-auto w-full max-w-2xl px-8 py-10">
            <VisionFields key={vision.id} vision={vision} canEdit={canEdit} />
            <PortfoliosTowardVision spaceId={vision.activity_space_id} visionId={vision.id} onOpenPortfolio={onOpenPortfolio} />
            <DirectInitiatives visionId={vision.id} onSelectStrategy={onSelectStrategy} />
          </div>
        )}
      </div>

      {newOpen && spaceId && (
        <QuickCreatePopup
          open
          icon={<NavVisionIcon size={12} />}
          contextLabel={t('New Vision')}
          ariaLabel={t('New Vision')}
          namePlaceholder={t('Vision name…')}
          descriptionPlaceholder={t('The aim, in one statement…')}
          onClose={closeNew}
          onSubmit={async ({ name, description }) => {
            const created = await createVision({ activity_space_id: spaceId, name, statement: description || null, order_index: visions.length });
            closeNew();
            onSelectVision(created.id);
          }}
        />
      )}
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// vision_conditions is jsonb with no shape constraint: read it as a list of
// strings whatever was written, and keep one empty list so an absent value
// is the same array on every render.
const NO_CONDITIONS: string[] = [];
function normalizeConditions(value: unknown): string[] {
  if (!Array.isArray(value)) return NO_CONDITIONS;
  const list = value.filter((x): x is string => typeof x === 'string');
  return list.length === 0 ? NO_CONDITIONS : list;
}

function VisionFields({ vision, canEdit }: { vision: Vision; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: VisionUpdate) => {
    setState('saving');
    try {
      await updateVision(vision.id, patch);
      setState('saved');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : t("Couldn't save"));
    }
  };
  const horizon = vision.horizon ?? null;
  const conditions = useMemo(() => normalizeConditions(vision.conditions), [vision.conditions]);

  return (
    <div>
      <TextBlock canEdit={canEdit} initial={vision.name} label={t('Vision name')} required singleLine
        placeholder={t('Vision name…')} emptyText={vision.name}
        className="text-[22px] font-semibold leading-8 tracking-tight" onCommit={(v) => void save({ name: v })} />
      <TextBlock canEdit={canEdit} initial={vision.statement ?? ''} label={t('Vision')}
        placeholder={t('Write the Vision — the future this Space works toward, in one statement.')}
        emptyText={t('No statement yet.')}
        className="mt-2 text-[16px] leading-7" onCommit={(v) => save({ statement: v || null })} />

      <div className="mt-8 grid gap-6 sm:grid-cols-[140px_1fr]">
        <FieldLabel>{t('By when')}</FieldLabel>
        <div>
          {canEdit ? (
            <DateField value={horizon} onChange={(v) => void save({ horizon: v })} placeholder={t('Set a horizon')} aria-label={t('By when')} />
          ) : (
            <span className="text-[13px] text-foreground">{horizon ? fromDateOnlyString(horizon)?.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : <span className="text-muted-foreground">{t('No horizon yet')}</span>}</span>
          )}
        </div>

        <FieldLabel>{t('Why')}</FieldLabel>
        <TextBlock canEdit={canEdit} initial={vision.narrative ?? ''} label={t('Why')}
          placeholder={t('Why this, and what changes when it is true.')}
          emptyText={t('Not written yet.')}
          className="text-[13px] leading-6" onCommit={(v) => save({ narrative: v || null })} />

        <FieldLabel>{t('We will know because')}</FieldLabel>
        <ConditionsList canEdit={canEdit} initial={conditions} onCommit={(list) => save({ conditions: list })} />
      </div>

      <div className="mt-3 h-4 text-[11px] text-muted-foreground" role="status">
        {state === 'saving' ? t('Saving…') : state === 'saved' ? t('Saved') : state === 'error' ? `${t("Couldn't save")}: ${error}` : ''}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{children}</div>;
}

// A text field that grows with its text and saves on blur; read-only it is
// the text itself. Adopts a refetched value unless it holds an unsaved edit.
function TextBlock({ canEdit, initial, label, placeholder, emptyText, className, required = false, singleLine = false, onCommit }: {
  canEdit: boolean; initial: string; label: string; placeholder: string; emptyText: string; className: string;
  /** An emptied field snaps back to the saved text instead of saving ''. */
  required?: boolean;
  /** Enter commits (blurs) instead of adding a line. */
  singleLine?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (text === seenInitial) setText(initial);
  }
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  if (!canEdit) {
    return initial
      ? <p className={`whitespace-pre-wrap text-foreground ${className}`}>{initial}</p>
      : <p className={`text-muted-foreground ${className}`}>{emptyText}</p>;
  }
  return (
    <textarea ref={ref} value={text} rows={1} aria-label={label} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = singleLine ? text.replace(/\s*\n\s*/g, ' ').trim() : text.trim();
        if (required && !next) { setText(seenInitial); return; }
        if (next !== seenInitial.trim()) onCommit(next);
      }}
      onKeyDown={(e) => { if (singleLine && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } }}
      className={`-mx-2 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:bg-muted/30 ${className}`} />
  );
}

// The success conditions — one line each. A line saves on blur; an empty
// line is dropped; the list is written whole. Rows carry their own id, so
// removing one never depends on where the others ended up after a blur.
interface ConditionRow { id: number; text: string }
let conditionSeq = 0;
const toRows = (list: string[]): ConditionRow[] => list.map((text) => ({ id: conditionSeq++, text }));
const textsOf = (rows: ConditionRow[]) => rows.map((r) => r.text.trim()).filter(Boolean);

function ConditionsList({ canEdit, initial, onCommit }: { canEdit: boolean; initial: string[]; onCommit: (list: string[]) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ConditionRow[]>(() => toRows(initial));
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (JSON.stringify(textsOf(rows)) === JSON.stringify(seen)) setRows(toRows(initial));
  }
  const commit = (next: ConditionRow[]) => {
    const kept = next.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text);
    setRows(kept);
    const texts = kept.map((r) => r.text);
    if (JSON.stringify(texts) !== JSON.stringify(seen)) onCommit(texts);
  };
  if (!canEdit) {
    return initial.length === 0
      ? <p className="text-[13px] text-muted-foreground">{t('No conditions yet.')}</p>
      : <ul className="space-y-1 text-[13px] leading-6 text-foreground">{initial.map((c, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground/60">•</span><span>{c}</span></li>)}</ul>;
  }
  return (
    <div className="-mx-2">
      {rows.map((row, i) => (
        <div key={row.id} className="group flex items-center gap-1">
          <span className="pl-2 text-muted-foreground/60">•</span>
          <input value={row.text} aria-label={t('Condition {n}', { n: String(i + 1) })}
            onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))}
            onBlur={() => commit(rows)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[13px] leading-6 text-foreground outline-none transition-colors focus:bg-muted/30" />
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={t('Remove condition')}
            onClick={() => commit(rows.filter((r) => r.id !== row.id))}><X size={12} /></Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" align="start" className="mt-1 text-muted-foreground" onClick={() => setRows((prev) => [...prev, ...toRows([''])])}>
        <Plus size={12} />{t('Add a condition')}
      </Button>
    </div>
  );
}

// Shared read for the two sections below: the Space's Initiatives and their
// health, the same numbers the Portfolio page shows.
function useVisionScope(spaceId: string | null) {
  const { data: portfolios } = usePortfolios(spaceId);
  const { data: allStrategies } = useStrategies();
  const { data: domains } = useDomains();
  const { data: explorer } = useObjects();
  const strategies = useMemo(() => {
    const objectDomain = new Map<string, string | null>(explorer.objects.map((o) => [o.id, o.domain_id]));
    return initiativesInSpace(allStrategies, objectDomain, new Set(domains.map((d) => d.id)));
  }, [allStrategies, explorer.objects, domains]);
  const roots = useMemo(() => strategies.filter((s) => s.parentIds.length === 0), [strategies]);
  const { byId: healthById } = useInitiativeHealth(roots);
  return { portfolios, roots, healthById };
}

// The Portfolios under the Vision, top level, with what each adds up to.
function PortfoliosTowardVision({ spaceId, visionId, onOpenPortfolio }: { spaceId: string; visionId: string; onOpenPortfolio: (id: string) => void }) {
  const { t } = useI18n();
  const { portfolios: all, roots, healthById } = useVisionScope(spaceId);
  const portfolios = useMemo(() => all.filter((p) => p.vision_id === visionId), [all, visionId]);
  const { byPortfolio } = useMemo(() => groupByPortfolio(portfolios, roots.filter((s) => s.vision_id === visionId)), [portfolios, roots, visionId]);
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios]);
  if (tree.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Portfolios')}</h2>
      {tree.map((node) => {
        const r = rollupPortfolio(node, byPortfolio, healthById);
        return (
          <div key={node.portfolio.id} className="flex min-w-0 items-center gap-1 rounded-md pr-2 hover:bg-muted/40">
            <Button variant="ghost" size="md" align="start" onClick={() => onOpenPortfolio(node.portfolio.id)} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
              <NavPortfolioIcon size={16} /><span className="truncate">{node.portfolio.name}</span>
              {node.portfolio.description && <span className="hidden min-w-0 truncate text-[12px] font-normal text-muted-foreground sm:inline">{node.portfolio.description}</span>}
            </Button>
            <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              {r.progressPct !== null && (
                <span className="flex w-24 items-center gap-1.5"><SegmentedProgress value={r.progressPct} className="flex-1" /><span className="w-7 text-right">{r.progressPct}%</span></span>
              )}
              {r.alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(r.alerts) })}</span>}
              <span className="w-6 text-right" title={t('Initiatives')}>{r.initiatives}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// Initiatives placed directly under the Vision — in no Portfolio — and the
// picker that brings one in from outside the Vision.
function DirectInitiatives({ visionId, onSelectStrategy }: { visionId: string; onSelectStrategy: (id: string) => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { roots, healthById } = useVisionScope(spaceId);
  const direct = roots.filter((s) => s.vision_id === visionId && !s.portfolio_id);
  const candidates = roots.filter((s) => s.vision_id !== visionId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const move = async (s: StrategyWithObjects, to: string | null) => {
    setOpen(false);
    setError(null);
    try { await setStrategyVision(s.id, to); }
    catch (e) { setError(e instanceof Error ? e.message : t("Couldn't save")); }
  };
  return (
    <section className="mt-10">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Initiatives')}</h2>
      {direct.map((s) => {
        const h = healthById.get(s.id);
        return (
          <div key={s.id} className="group flex min-w-0 items-center gap-1 rounded-md hover:bg-muted/40">
            <Button variant="ghost" size="md" align="start" onClick={() => onSelectStrategy(s.id)} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
              <NavStrategyIcon size={16} /><span className="truncate">{s.name}</span>
            </Button>
            {h?.progressPct != null && (
              <span className="flex w-24 shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground"><SegmentedProgress value={h.progressPct} className="flex-1" /><span className="w-7 text-right">{h.progressPct}%</span></span>
            )}
            <Button variant="ghost" size="icon-xs" onClick={() => void move(s, null)} className="mr-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label={t('Remove from Vision')} title={t('Remove from Vision')}><X size={12} /></Button>
          </div>
        );
      })}
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(''); }}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" align="start" className="mt-1 text-muted-foreground"><Plus size={12} />{t('Add Initiative')}</Button>
        </PopoverTrigger>
        <MenuShell width="wide" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder={t('Find an Initiative…')} />
            <CommandList>
              <CommandEmpty>{t('No matches.')}</CommandEmpty>
              {candidates.filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) => (
                <CommandItem key={s.id} value={`${s.name} ${s.id}`} onSelect={() => void move(s, visionId)}>
                  <NavStrategyIcon size={12} /><span className="flex-1 truncate">{s.name}</span>
                  {s.vision_id && <span className="text-[11px] text-muted-foreground">{t('In another Vision')}</span>}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </MenuShell>
      </Popover>
      {error && <div className="px-2 py-1 text-[11px] text-destructive">{error}</div>}
    </section>
  );
}
