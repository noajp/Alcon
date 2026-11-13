'use client';

import { SidebarReveal } from '@/Function/shared/SidebarReveal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CirclePlay, Plus, RotateCcw, Search, X } from '@/ui/icons';
import { isCommitEnter, useEscapeLayer } from '@/Function/shared/keyboard';
import { NavPhaseIcon } from '@/Frame/sidebar/NavIcons';
import { EmptyState } from '@/Function/shared/EmptyState';
import { PageIcon, PageSection, PAGE_FRAME, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ObjectIcon } from '@/Frame/icons';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { PhaseBurnup } from '@/Function/shared/PhaseBurnup';
import { DateField as SharedDateField } from '@/Function/shared/date';
import { MenuShell } from '@/Function/shared/menu';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  createPhase,
  deletePhase,
  fetchPhaseCandidates,
  reopenPhase,
  updateElement,
  updateObject,
  updatePhase,
  useCarryOverReasons,
  usePhaseReschedules,
  usePhases,
  type Phase,
  type PhaseReschedule,
  useDomains,
} from '@/hooks/useSupabase';
import { formatElementDate, formatDateOnly, parseDateOnly } from '@/Function/shared/dateUtils';
import type { PhaseStatus } from '@/types/database';
import { PhaseCloseDialog } from './PhaseCloseDialog';
import { seedPhaseDates, lastPhaseEndOf, todayKey } from '@/Function/shared/phaseDefaults';
import {
  PHASE_STANDING_LABEL,
  PHASE_STATUS_LABEL,
  nextOpenPhase,
  phaseRollup,
  phaseStanding,
  todayYMD,
  type PhaseStanding,
} from '@/Function/strategy/phaseClose';

// =============================================================
// PhaseView — the Strategy layer's "Phase" app: Linear-Cycle-style
// time-boxed periods, scoped to the active Domain. A Phase is a named date
// range ("要件定義", Jul 14 – Jul 27); Objects and Elements are assigned to
// at most one Phase via their phase_id column. Unlike Linear's auto-rolling
// cycles, Phases are created by hand — Clayware phases are milestones of a plan
// (requirements → design → build), not a fixed sprint cadence.
// =============================================================

type PhaseMembers = Awaited<ReturnType<typeof fetchPhaseCandidates>>;

// "Jul\n16" — the two-line boundary label on the timeline rail.
function railLabel(s: string, locale: string): string {
  const d = parseDateOnly(s)!;
  return `${d.toLocaleDateString(locale, { month: 'short' })}\n${d.getDate()}`;
}

// The tone of each standing's label. Out of time is the only one that argues
// — it is the state nobody chose, and the only one that asks for action.
const STANDING_TONE: Record<PhaseStanding, string> = {
  planned: 'text-muted-foreground',
  active: 'text-muted-foreground',
  out_of_time: 'text-[var(--status-warning)]',
  complete: 'text-muted-foreground',
};

const STANDING_DOT: Record<PhaseStanding, string> = {
  planned: 'bg-muted-foreground/50',
  active: 'bg-[var(--accent-default)]',
  out_of_time: 'bg-[var(--status-warning)]',
  complete: 'bg-[var(--status-success)]',
};

// Live tallies for a Phase. The ring reads Elements only — `phaseRollup` says
// what done over total means, and Objects carry no status to contribute to it.
// Started is the burn-up's middle band.
function phaseMetrics(p: Phase, members: PhaseMembers) {
  const rollup = phaseRollup(members.elements, p.id);
  const started = members.elements.filter(
    (e) => e.phase_id === p.id && (e.status === 'in_progress' || e.status === 'review'),
  ).length;
  return { ...rollup, started };
}

// Remaining weekdays from today through the end date (inclusive).
function weekdaysLeft(end: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endD = parseDateOnly(end)!;
  let n = 0;
  for (const t = new Date(today); t <= endD; t.setDate(t.getDate() + 1)) {
    const dow = t.getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// Tiny capacity/progress ring (Linear's row indicator). value 0..1.
function ProgressRing({ value }: { value: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" className="shrink-0 -rotate-90">
      <circle cx={7} cy={7} r={r} fill="none" stroke="var(--border)" strokeWidth={2} />
      {v > 0 && (
        <circle
          cx={7} cy={7} r={r} fill="none"
          stroke="var(--text-secondary)" strokeWidth={2}
          strokeDasharray={`${c * v} ${c}`} strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function PhaseView({
  activeDomainId,
  onOpenObject,
  onOpenInitiative,
}: {
  activeDomainId: string | null;
  /** Jump to an Object's detail (the Execution "objects" view). */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  /** Jump to the Strategy a decision was recorded under. */
  onOpenInitiative?: (strategyId: string) => void;
}) {
  const { t } = useI18n();
  const { data: phases, loading, refetch } = usePhases(activeDomainId);
  // The create dialog seeds its dates from the Domain's defaults and the
  // last Phase, once, on open — so it waits for both to be loaded.
  const { loading: domainsLoading } = useDomains();
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // Domain-wide membership + picker candidates in one fetch, shared by the
  // list (per-Phase counts) and the detail (member rows / pickers).
  const [members, setMembers] = useState<PhaseMembers>({ objects: [], elements: [] });
  const reloadMembers = useCallback(async () => {
    if (!activeDomainId) { setMembers({ objects: [], elements: [] }); return; }
    try {
      setMembers(await fetchPhaseCandidates(activeDomainId));
    } catch (e) {
      console.error('Failed to load Phase members', e);
    }
  }, [activeDomainId]);
  useEffect(() => { void reloadMembers(); }, [reloadMembers]);

  const openPhase = useMemo(() => phases.find((p) => p.id === openPhaseId) ?? null, [phases, openPhaseId]);

  if (openPhase) {
    return (
      <PhaseDetailView
        phase={openPhase}
        phases={phases}
        members={members}
        onBack={() => setOpenPhaseId(null)}
        onSaved={() => { refetch(); void reloadMembers(); }}
        onOpenObject={onOpenObject}
        onOpenInitiative={onOpenInitiative}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex flex-shrink-0 items-center gap-1 border-b border-border/60 bg-card pl-6 pr-2">
        <SidebarReveal />
        <span className="px-1.5 py-0.5 text-[13px] font-semibold text-foreground">{t('Phase')}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title={t('Add Phase')}
          aria-label={t('Add Phase')}
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? null : !activeDomainId ? (
          <EmptyState art="phase" title="Choose a Domain" description="Select a Domain to plan its Phases." />
        ) : phases.length === 0 ? (
          <EmptyState art="phase" title="Create your first Phase"
            description="A Phase time-boxes a stage of work — requirements, design, build."
            cta="Create Phase" onCta={() => setNewOpen(true)} />
        ) : (
          <PhaseTimeline phases={phases} members={members} onOpen={setOpenPhaseId} />
        )}
      </div>

      {newOpen && activeDomainId && !loading && !domainsLoading && (
        <PhaseCreateDialog
          domainId={activeDomainId}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            refetch();
            setOpenPhaseId(id);
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Timeline list — Linear's Cycles page: a vertical date rail on the left
// (dot + "Jul 16" label at each Phase boundary, filled dot on the current
// segment), one row per Phase (newest first), and the current Phase expanded
// into a burn-up panel with a Scope / Started / Completed legend.
// =============================================================
function PhaseTimeline({
  phases,
  members,
  onOpen,
}: {
  phases: Phase[];
  members: PhaseMembers;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  // Newest first (upcoming → current → completed); undated phases sink.
  const sorted = useMemo(
    () => [...phases].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')),
    [phases],
  );
  // Sampled once per mount, as PhaseBurnup samples its clock: a render that
  // reads the date is not pure, and every row in one list should be judged
  // against the same day.
  const [today] = useState(() => todayYMD());

  return (
    // pt/pb keep the boundary labels (translated half out of their row)
    // from clipping against the scroll container's edges.
    <div className="h-full overflow-auto pt-4 pb-8">
      {sorted.map((p, i) => {
        const standing = phaseStanding(p, today);
        const m = phaseMetrics(p, members);
        const donePct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
        const isCurrent = standing === 'active';
        return (
          <div key={p.id} className="relative">
            {/* Rail — the segment of the vertical date line this row owns. */}
            <span
              aria-hidden
              className={`absolute left-[3.5rem] top-0 bottom-0 w-px ${isCurrent ? 'bg-primary/60' : 'bg-border/60'}`}
            />
            {/* Top boundary (end date) — only the first row draws it; every
                other row's top edge is the previous row's bottom boundary. */}
            {i === 0 && p.end_date && (
              <>
                <span aria-hidden className="absolute left-[3.5rem] top-0 -translate-x-1/2 -translate-y-1/2 size-2 rounded-full bg-card border border-muted-foreground/50" />
                <span className="absolute left-2 top-0 -translate-y-1/2 w-9 text-right text-[10px] leading-[1.15] text-muted-foreground whitespace-pre">
                  {railLabel(p.end_date, locale)}
                </span>
              </>
            )}
            {/* Bottom boundary (start date). Filled dot when this Phase is
                running — "today sits above this point". */}
            {p.start_date && (
              <>
                <span
                  aria-hidden
                  className={`absolute left-[3.5rem] bottom-0 -translate-x-1/2 translate-y-1/2 size-2 rounded-full ${
                    isCurrent ? 'bg-primary' : 'bg-card border border-muted-foreground/50'
                  }`}
                />
                <span className="absolute left-2 bottom-0 translate-y-1/2 w-9 text-right text-[10px] leading-[1.15] text-muted-foreground whitespace-pre">
                  {railLabel(p.start_date, locale)}
                </span>
              </>
            )}

            <div className="pl-24 pr-8">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="w-full flex items-center gap-3 px-2 py-5 text-left rounded-md transition-colors hover:bg-muted/40"
              >
                <CirclePlay size={16} className={isCurrent ? 'text-foreground shrink-0' : 'text-muted-foreground shrink-0'} />
                <span className="text-[13px] font-semibold text-foreground flex-1 truncate">{p.name}</span>
                <span className={`text-[11px] shrink-0 ${STANDING_TONE[standing]}`}>
                  {t(PHASE_STANDING_LABEL[standing])}
                </span>
                <span className="flex items-center gap-3 text-[12px] text-foreground tabular-nums shrink-0">
                  <span className="flex items-center gap-1.5">
                    <ProgressRing value={m.total > 0 ? m.done / m.total : 0} />
                    {t('{pct}% done', { pct: donePct })}
                  </span>
                  {standing === 'active' && p.end_date
                    ? <span>{t('{n} weekdays left', { n: weekdaysLeft(p.end_date) })}</span>
                    : <span>{t('{done}/{total} Elements', { done: m.done, total: m.total })}</span>}
                </span>
              </button>

              {isCurrent && p.start_date && p.end_date && (
                <PhaseBurnup phase={p} scope={m.total} started={m.started} completed={m.done} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Minimal date field for the create dialog / detail header. Native date
// input, styled to sit on the card background (no ring per app rules).
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1 min-w-0">
      <span className="block text-[11px] text-muted-foreground mb-1">{label}</span>
      <SharedDateField
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        placeholder={label}
        variant="secondary"
        block
        aria-label={label}
      />
    </label>
  );
}

// =============================================================
// Detail — name + period + assigned Objects / Elements with pickers.
// =============================================================
function PhaseDetailView({
  phase,
  phases,
  members,
  onBack,
  onSaved,
  onOpenObject,
  onOpenInitiative,
}: {
  phase: Phase;
  /** The Domain's Phases in list order — where "carry over" finds its target. */
  phases: Phase[];
  members: PhaseMembers;
  onBack: () => void;
  onSaved: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onOpenInitiative?: (strategyId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(phase.name);
  const [pickerFor, setPickerFor] = useState<'objects' | 'elements' | null>(null);
  const [query, setQuery] = useState('');
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setName(phase.name);
    setPickerFor(null);
    setQuery('');
    setClosing(false);
  }, [phase.id, phase.name]);

  const [today] = useState(() => todayYMD());
  const standing = phaseStanding(phase, today);
  const rollup = useMemo(() => phaseRollup(members.elements, phase.id), [members.elements, phase.id]);
  const nextPhase = useMemo(() => nextOpenPhase(phases, phase.id), [phases, phase.id]);

  const myObjects = useMemo(() => members.objects.filter((o) => o.phase_id === phase.id), [members.objects, phase.id]);
  const myElements = useMemo(() => members.elements.filter((e) => e.phase_id === phase.id), [members.elements, phase.id]);
  const carriedElementIds = useMemo(
    () => myElements.filter((e) => e.carried_over_count > 0).map((e) => e.id),
    [myElements],
  );
  const carryReasons = useCarryOverReasons(carriedElementIds);
  const objectNameById = useMemo(
    () => new Map(members.objects.map((o) => [o.id, o.name] as const)),
    [members.objects],
  );

  const q = query.trim().toLowerCase();
  const objectCandidates = useMemo(
    () => members.objects.filter((o) => o.phase_id !== phase.id && (q === '' || o.name.toLowerCase().includes(q))),
    [members.objects, phase.id, q],
  );
  const elementCandidates = useMemo(
    () => members.elements.filter((e) => e.phase_id !== phase.id && (q === '' || e.title.toLowerCase().includes(q))),
    [members.elements, phase.id, q],
  );

  const saveName = async () => {
    const trimmed = name.trim() || phase.name;
    if (trimmed === phase.name) return;
    try { await updatePhase(phase.id, { name: trimmed }); onSaved(); }
    catch (e) { console.error('Failed to rename Phase', e); }
  };

  const saveDates = async (updates: { start_date?: string | null; end_date?: string | null }) => {
    try { await updatePhase(phase.id, updates); onSaved(); }
    catch (e) { console.error('Failed to update Phase dates', e); }
  };

  const setObjectPhase = async (objectId: string, phaseId: string | null) => {
    try { await updateObject(objectId, { phase_id: phaseId }); onSaved(); }
    catch (e) { console.error('Failed to assign Object to Phase', e); }
  };
  const setElementPhase = async (elementId: string, phaseId: string | null) => {
    try { await updateElement(elementId, { phase_id: phaseId }); onSaved(); }
    catch (e) { console.error('Failed to assign Element to Phase', e); }
  };

  const handleDelete = async () => {
    try { await deletePhase(phase.id); onSaved(); onBack(); }
    catch (e) { console.error('Failed to delete Phase', e); }
  };

  // planned ⇄ active are just the row; complete goes through the dialog, which
  // is where the closing note and the unfinished work get decided.
  const setStatus = async (next: PhaseStatus) => {
    if (next === phase.status) return;
    if (next === 'complete') { setClosing(true); return; }
    try { await reopenPhase(phase.id, next); onSaved(); }
    catch (e) { console.error('Failed to change Phase status', e); }
  };

  const closePicker = () => { setPickerFor(null); setQuery(''); };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      {/* Drawn as the shared IslandHeader is (Function/shared/MainIsland). */}
      <div className="h-[50px] flex flex-shrink-0 items-center gap-1 border-b border-border/60 bg-card pl-6 pr-2">
        <SidebarReveal />
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          {t('Phase')}
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[13px] font-semibold text-foreground truncate max-w-[240px]">
          {phase.name}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handleDelete()}
          title={t('Delete Phase')}
          aria-label={t('Delete Phase')}
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-[var(--status-danger)] hover:bg-muted rounded-md transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className={`${PAGE_FRAME} space-y-5`}>
          <div>
            <PageIcon><NavPhaseIcon size={18} /></PageIcon>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              placeholder={t('Phase name')}
              className={`w-full bg-transparent border-none outline-none ${PAGE_TITLE}`}
              style={PAGE_TITLE_WEIGHT}
            />
          </div>

          {/* Standing — the act on the left, what it bought on the right. */}
          <div className="flex items-center gap-3 flex-wrap">
            <PhaseStatusMenu
              status={phase.status}
              standing={standing}
              onSelect={(s) => void setStatus(s)}
            />
            <span className="text-[12px] text-muted-foreground">
              {rollup.total === 0
                ? t('No Elements in this Phase')
                : t('{done} of {total} Elements done', { done: rollup.done, total: rollup.total })}
            </span>
            {standing === 'out_of_time' && phase.end_date && (
              <span className="text-[12px] text-[var(--status-warning)]">
                {t('Ran past {date} without being closed', { date: formatDateOnly(phase.end_date, locale) ?? '' })}
              </span>
            )}
            {standing === 'complete' && phase.closed_at && (
              <span className="text-[12px] text-muted-foreground">{t('Closed {date}', { date: formatDateOnly(phase.closed_at, locale) ?? '' })}</span>
            )}
          </div>

          {/* The note only stands while the Phase is closed — reopening leaves
              it as the draft for the next close rather than destroying it. */}
          {standing === 'complete' && phase.closing_note && (
            <div className="max-w-2xl">
              <span className="block text-[11px] font-medium text-muted-foreground mb-1">{t('Closing note')}</span>
              <p className="text-[13px] text-foreground whitespace-pre-wrap">{phase.closing_note}</p>
            </div>
          )}

          {/* Period — the time box itself. */}
          <div className="flex items-end gap-3 max-w-md">
            <DateField
              label={t('Start')}
              value={phase.start_date ?? ''}
              onChange={(v) => void saveDates({ start_date: v || null })}
            />
            <DateField
              label={t('End')}
              value={phase.end_date ?? ''}
              onChange={(v) => void saveDates({ end_date: v || null })}
            />
          </div>

          {/* Directly under the dates, because it is about them. */}
          <PhaseReschedules phaseId={phase.id} onOpenInitiative={onOpenInitiative} />

          {/* ── Objects ── */}
          <PageSection title={t('Objects')} action={
            <ButtonAppearanceProvider appearance="navigation">
              <Button variant="ghost" size="icon-xs" aria-label={t('Add Objects')} className="text-muted-foreground"
                onClick={() => { setPickerFor(pickerFor === 'objects' ? null : 'objects'); setQuery(''); }}>
                <Plus size={13} />
              </Button>
            </ButtonAppearanceProvider>
          }>
            {myObjects.length === 0 && pickerFor !== 'objects' && (
              <div className="px-2 text-[12px] text-muted-foreground/60 py-1">{t('No Objects in this Phase yet.')}</div>
            )}
            {myObjects.map((o) => (
              <div
                key={o.id}
                onClick={() => onOpenObject?.(o.id, phase.domain_id)}
                className={`flex items-center gap-2 px-2 py-1 min-h-8 rounded-md group/row hover:bg-muted/40 transition-colors ${onOpenObject ? 'cursor-pointer' : ''}`}
              >
                <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
                <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{o.name}</span>
                {o.due_date && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{formatDateOnly(o.due_date, locale)}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void setObjectPhase(o.id, null); }}
                  aria-label={t('Remove {name} from this Phase', { name: o.name })}
                  className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {pickerFor === 'objects' && (
              <MemberPicker
                placeholder={t('Search Objects…')}
                query={query}
                onQuery={setQuery}
                onClose={closePicker}
                empty={objectCandidates.length === 0}
              >
                {objectCandidates.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => void setObjectPhase(o.id, phase.id)}
                    className="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] hover:bg-muted/40 text-left"
                  >
                    <ObjectIcon size={11} />
                    <span className="flex-1 truncate text-foreground">{o.name}</span>
                    {o.phase_id && <span className="text-[10px] text-muted-foreground shrink-0">{t('In another Phase')}</span>}
                  </button>
                ))}
              </MemberPicker>
            )}
          </PageSection>

          {/* ── Elements ── */}
          <PageSection title={t('Elements')} action={
            <ButtonAppearanceProvider appearance="navigation">
              <Button variant="ghost" size="icon-xs" aria-label={t('Add Elements')} className="text-muted-foreground"
                onClick={() => { setPickerFor(pickerFor === 'elements' ? null : 'elements'); setQuery(''); }}>
                <Plus size={13} />
              </Button>
            </ButtonAppearanceProvider>
          }>
            {myElements.length === 0 && pickerFor !== 'elements' && (
              <div className="px-2 text-[12px] text-muted-foreground/60 py-1">{t('No Elements in this Phase yet.')}</div>
            )}
            {myElements.map((el) => (
              <div
                key={el.id}
                className="flex items-center gap-2 px-2 py-1 min-h-8 rounded-md group/row hover:bg-muted/40 transition-colors"
              >
                <ElementProgressMark status={el.status} size={14} />
                <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{el.title}</span>
                {el.carried_over_count > 0 && (() => {
                  const reason = carryReasons.get(el.id)?.reason;
                  const countLabel = el.carried_over_count === 1
                    ? t('Carried through 1 earlier Phase')
                    : t('Carried through {n} earlier Phases', { n: el.carried_over_count });
                  return (
                    <span
                      title={reason ? `${countLabel} — ${reason}` : countLabel}
                      className="flex items-center gap-1 min-w-0 shrink"
                    >
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums shrink-0">
                        <RotateCcw size={11} />
                        {el.carried_over_count}
                      </span>
                      {reason && (
                        <span className="text-[11px] text-muted-foreground/70 truncate max-w-[140px]">
                          — {reason}
                        </span>
                      )}
                    </span>
                  );
                })()}
                {el.object_id && objectNameById.get(el.object_id) && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[160px] shrink-0">
                    {objectNameById.get(el.object_id)}
                  </span>
                )}
                {el.due_date && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{formatDateOnly(el.due_date, locale)}</span>
                )}
                <button
                  type="button"
                  onClick={() => void setElementPhase(el.id, null)}
                  aria-label={t('Remove {name} from this Phase', { name: el.title })}
                  className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {pickerFor === 'elements' && (
              <MemberPicker
                placeholder={t('Search Elements…')}
                query={query}
                onQuery={setQuery}
                onClose={closePicker}
                empty={elementCandidates.length === 0}
              >
                {elementCandidates.map((el) => (
                  <button
                    type="button"
                    key={el.id}
                    onClick={() => void setElementPhase(el.id, phase.id)}
                    className="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] hover:bg-muted/40 text-left"
                  >
                    <ElementIcon size={11} />
                    <span className="flex-1 truncate text-foreground">{el.title}</span>
                    {el.object_id && objectNameById.get(el.object_id) && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px] shrink-0">
                        {objectNameById.get(el.object_id)}
                      </span>
                    )}
                  </button>
                ))}
              </MemberPicker>
            )}
          </PageSection>
        </div>
      </div>

      {closing && (
        <PhaseCloseDialog
          phase={phase}
          nextPhase={nextPhase}
          elements={members.elements}
          onDismiss={() => setClosing(false)}
          onClosed={onSaved}
        />
      )}
    </div>
  );
}

// =============================================================
// Why these dates moved.
//
// The two fields above say when the Phase runs. They cannot say why, and a box
// that has slid two quarters is exactly the one where the why is the only thing
// worth reading. The answer is recorded on the Strategy — what was chosen, what
// it gave up, who called it — and bound here, so the question can be asked from
// the side that raises it.
//
// Nothing is offered when nothing is recorded. A heading over an empty list on
// every Phase would spend a section of the page saying "no", and the decision
// is made and recorded on the Strategy side in any case.
// =============================================================
function PhaseReschedules({
  phaseId,
  onOpenInitiative,
}: {
  phaseId: string;
  onOpenInitiative?: (strategyId: string) => void;
}) {
  const { t } = useI18n();
  const { data, error } = usePhaseReschedules(phaseId);
  if (error) {
    return (
      <p className="text-[12px] text-[var(--status-danger)]">
        {t('Could not read what moved this Phase.')}
      </p>
    );
  }
  if (data.length === 0) return null;

  return (
    <PageSection title={t('Why these dates moved')}>
      <div className="flex flex-col">
        {data.map((entry) => (
          <ReschedulingDecision key={entry.bindingId} entry={entry} onOpenInitiative={onOpenInitiative} />
        ))}
      </div>
    </PageSection>
  );
}

// One recorded call. Three lines, matching the Strategy's own decision row:
// what was chosen, what it cost, and who said so — with the Strategy name as
// the way back to the rest of the record.
function ReschedulingDecision({
  entry,
  onOpenInitiative,
}: {
  entry: PhaseReschedule;
  onOpenInitiative?: (strategyId: string) => void;
}) {
  const { t } = useI18n();
  const decided = formatElementDate(entry.decidedAt);
  return (
    <div className="-mx-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)]" aria-hidden />
        <span className="text-[13px] font-[550] text-foreground truncate min-w-0 flex-1">
          {entry.title}
        </span>
        {/* The way back to the Strategy is a quiet link, not a capsule. */}
        {onOpenInitiative && (
          <button
            type="button"
            aria-label={t('Open {name}', { name: entry.strategyName })}
            onClick={() => onOpenInitiative(entry.strategyId)}
            className="shrink-0 max-w-[180px] truncate text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {entry.strategyName}
          </button>
        )}
      </div>

      {/* Kept visible when empty, as it is on the Strategy: a decision recorded
          without what it gave up is a decision half written. */}
      <p className="text-[12px] text-muted-foreground pl-3.5 mt-0.5">
        {entry.abandoned ? (
          <>
            <span className="text-[var(--text-tertiary)]">{t('Gave up')} </span>
            {entry.abandoned}
          </>
        ) : (
          <span className="text-muted-foreground/50">{t('Nothing recorded as given up')}</span>
        )}
      </p>

      {(entry.decidedByName || decided) && (
        <p className="text-[11px] text-muted-foreground/70 pl-3.5 mt-0.5">
          {[entry.decidedByName, decided ? t('decided {date}', { date: decided }) : null].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

// The status control. The trigger shows the standing — the fold of the status
// and the dates — because that is the sentence the user came to read; the menu
// offers the three statuses, which are the only thing they can actually set.
const PHASE_STATUS_ORDER: PhaseStatus[] = ['planned', 'active', 'complete'];

function PhaseStatusMenu({
  status,
  standing,
  onSelect,
}: {
  status: PhaseStatus;
  standing: PhaseStanding;
  onSelect: (status: PhaseStatus) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="xs" align="start" aria-label={t('Phase status')}>
          <span className={`size-1.5 rounded-full ${STANDING_DOT[standing]}`} aria-hidden />
          {t(PHASE_STANDING_LABEL[standing])}
          <ChevronDown size={12} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {PHASE_STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onSelect(s)} className="justify-between">
            {t(PHASE_STATUS_LABEL[s])}
            {s === status && <Check size={13} className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );
}

// Shared search-picker chrome for the Objects / Elements sections.
function MemberPicker({
  placeholder,
  query,
  onQuery,
  onClose,
  empty,
  children,
}: {
  placeholder: string;
  query: string;
  onQuery: (v: string) => void;
  onClose: () => void;
  empty: boolean;
  children: React.ReactNode;
}) {
  // Mounted only while the picker is open (the caller conditions it on
  // pickerFor), so `true` is the picker's actual open state — the same
  // pattern PhaseCreateDialog uses. On the input's own keydown, not the
  // list: a row click moves focus off the input, and this is the layer
  // that keeps catching Escape after that.
  useEscapeLayer(true, onClose);
  const { t } = useI18n();
  return (
    <>
      <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-1">
        <Search size={12} className="text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] outline-none"
          autoFocus
        />
        <button type="button" onClick={onClose} aria-label={t('Close')} className="text-muted-foreground hover:text-foreground">
          <X size={12} />
        </button>
      </div>
      <div className="max-h-72 overflow-auto">
        {empty && (
          <div className="px-3 py-3 text-[12px] text-muted-foreground">{t('No matches.')}</div>
        )}
        {children}
      </div>
    </>
  );
}

// =============================================================
// Create dialog — name + period.
// =============================================================
function PhaseCreateDialog({
  domainId,
  onClose,
  onCreated,
}: {
  domainId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  // Dates start from the Domain's Phase defaults (Settings > Strategy >
  // Phase) — seeded once on open; the fields stay editable.
  const { data: domains } = useDomains();
  const { data: phases } = usePhases(domainId);
  const [seed] = useState(() => seedPhaseDates(
    domains.find((d) => d.id === domainId)?.phase_defaults, lastPhaseEndOf(phases), todayKey()));
  const [startDate, setStartDate] = useState(seed.start);
  const [endDate, setEndDate] = useState(seed.end);
  const [saving, setSaving] = useState(false);

  // Esc closes the dialog from any of its fields, not only the name.
  useEscapeLayer(true, onClose);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const created = await createPhase({
        domain_id: domainId,
        name: name.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
      });
      onCreated(created.id);
    } catch (e) {
      console.error('create Phase failed:', e);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-10 flex items-center px-4 border-b border-border/60">
          <span className="text-[13px] font-semibold text-foreground">{t('New Phase')}</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t('Close')}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Phase name (e.g. Requirements)')}
            autoFocus
            onKeyDown={(e) => {
              if (isCommitEnter(e)) {
                e.preventDefault();
                void handleSave();
              }
            }}
            className="w-full text-xl font-semibold text-foreground bg-transparent border-none outline-none leading-tight"
          />
          <div className="flex items-end gap-3">
            <DateField label={t('Start')} value={startDate} onChange={setStartDate} />
            <DateField label={t('End')} value={endDate} onChange={setEndDate} />
          </div>
        </div>

        <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-border/60">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary"
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
          >
            {saving ? t('Saving…') : t('Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
