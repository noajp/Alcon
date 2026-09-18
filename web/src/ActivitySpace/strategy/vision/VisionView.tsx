'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/button';
import { DateField } from '@/Function/shared/date';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { fromDateOnlyString } from '@/Function/shared/dateUtils';
import { useActivitySpaces, updateActivitySpace, useStrategies, useDomains, useObjects } from '@/hooks/useSupabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useInitiativeHealth } from '@/ActivitySpace/strategy/initiative/useInitiativeHealth';
import { usePortfolios } from '@/ActivitySpace/strategy/portfolio/data';
import { buildPortfolioTree, groupByPortfolio, initiativesInSpace, rollupPortfolio } from '@/ActivitySpace/strategy/portfolio/portfolioGroups';
import { NavPortfolioIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import type { ActivitySpace, ActivitySpaceUpdate } from '@/types/database';

// Strategy > Vision — what the Space aims for, in the Space's own words:
// one statement, by when, why, and how it will know it got there. Then the
// Portfolios that work toward it, with what each adds up to. The Space
// owner writes; every member reads. Each field saves on blur.
export function VisionView({ onOpenPortfolio }: { onOpenPortfolio: (id: string) => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const userId = useCurrentUserId();
  const { data: spaces, loading, refetch } = useActivitySpaces();
  const space = spaces.find((s) => s.id === spaceId) ?? null;

  // The viewer's seat in the Space: only an owner writes the Vision.
  const role = useQuery({
    queryKey: ['space-role', spaceId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_space_members')
        .select('role')
        .eq('activity_space_id', spaceId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as 'owner' | 'member' | undefined) ?? null;
    },
    enabled: !!spaceId && !!userId,
  });
  const isOwner = role.data === 'owner';

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavVisionIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">{t('Vision')}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading || !space || role.isPending ? null : (
          <div className="mx-auto w-full max-w-2xl px-8 py-10">
            <VisionFields key={space.id} space={space} canEdit={isOwner} onSaved={() => void refetch()} />
            <PortfoliosTowardVision spaceId={space.id} onOpenPortfolio={onOpenPortfolio} />
          </div>
        )}
      </div>
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function VisionFields({ space, canEdit, onSaved }: { space: ActivitySpace; canEdit: boolean; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: ActivitySpaceUpdate) => {
    setState('saving');
    try {
      await updateActivitySpace(space.id, patch);
      setState('saved');
      onSaved();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : t("Couldn't save"));
    }
  };
  const horizon = space.vision_horizon ?? null;
  const conditions = space.vision_conditions ?? [];

  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{t('What {space} aims for', { space: space.name })}</p>
      <TextBlock canEdit={canEdit} initial={space.vision ?? ''} label={t('Vision')}
        placeholder={t('Write the Vision — the future this Space works toward, in one statement.')}
        emptyText={t('No Vision yet. The Space owner writes it here.')}
        className="mt-3 text-[20px] leading-8" onCommit={(v) => save({ vision: v || null })} />

      <div className="mt-8 grid gap-6 sm:grid-cols-[140px_1fr]">
        <FieldLabel>{t('By when')}</FieldLabel>
        <div>
          {canEdit ? (
            <DateField value={horizon} onChange={(v) => void save({ vision_horizon: v })} placeholder={t('Set a horizon')} aria-label={t('By when')} />
          ) : (
            <span className="text-[13px] text-foreground">{horizon ? fromDateOnlyString(horizon)?.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : <span className="text-muted-foreground">{t('No horizon yet')}</span>}</span>
          )}
        </div>

        <FieldLabel>{t('Why')}</FieldLabel>
        <TextBlock canEdit={canEdit} initial={space.vision_narrative ?? ''} label={t('Why')}
          placeholder={t('Why this, and what changes when it is true.')}
          emptyText={t('Not written yet.')}
          className="text-[13px] leading-6" onCommit={(v) => save({ vision_narrative: v || null })} />

        <FieldLabel>{t('We will know because')}</FieldLabel>
        <ConditionsList canEdit={canEdit} initial={conditions} onCommit={(list) => save({ vision_conditions: list })} />
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
function TextBlock({ canEdit, initial, label, placeholder, emptyText, className, onCommit }: {
  canEdit: boolean; initial: string; label: string; placeholder: string; emptyText: string; className: string;
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
      onBlur={() => { const next = text.trim(); if (next !== seenInitial.trim()) onCommit(next); }}
      className={`-mx-2 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:bg-muted/30 ${className}`} />
  );
}

// The success conditions — one line each. A line saves on blur; an empty
// line is dropped; the list is written whole.
function ConditionsList({ canEdit, initial, onCommit }: { canEdit: boolean; initial: string[]; onCommit: (list: string[]) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<string[]>(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (JSON.stringify(items) === JSON.stringify(seen)) setItems(initial);
  }
  const commit = (next: string[]) => {
    const cleaned = next.map((s) => s.trim()).filter(Boolean);
    setItems(cleaned);
    if (JSON.stringify(cleaned) !== JSON.stringify(seen)) onCommit(cleaned);
  };
  if (!canEdit) {
    return initial.length === 0
      ? <p className="text-[13px] text-muted-foreground">{t('No conditions yet.')}</p>
      : <ul className="space-y-1 text-[13px] leading-6 text-foreground">{initial.map((c, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground/60">•</span><span>{c}</span></li>)}</ul>;
  }
  return (
    <div className="-mx-2">
      {items.map((c, i) => (
        <div key={i} className="group flex items-center gap-1">
          <span className="pl-2 text-muted-foreground/60">•</span>
          <input value={c} aria-label={t('Condition {n}', { n: String(i + 1) })}
            onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
            onBlur={() => commit(items)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[13px] leading-6 text-foreground outline-none transition-colors focus:bg-muted/30" />
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={t('Remove condition')} onClick={() => commit(items.filter((_, j) => j !== i))}><X size={12} /></Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" align="start" className="mt-1 text-muted-foreground" onClick={() => setItems((prev) => [...prev, ''])}>
        <Plus size={12} />{t('Add a condition')}
      </Button>
    </div>
  );
}

// The Portfolios that work toward the Vision, top level, with what each
// adds up to. Same numbers as the Portfolio page.
function PortfoliosTowardVision({ spaceId, onOpenPortfolio }: { spaceId: string; onOpenPortfolio: (id: string) => void }) {
  const { t } = useI18n();
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
  const { byPortfolio } = useMemo(() => groupByPortfolio(portfolios, strategies), [portfolios, strategies]);
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios]);
  if (tree.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Portfolios toward this Vision')}</h2>
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
