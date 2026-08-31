'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, CirclePlay, Plus, Search, X } from 'lucide-react';
import { NavPhaseIcon } from '@/shell/sidebar/NavIcons';
import { ObjectIcon } from '@/shell/icons';
import { ElementIcon } from '@/alcon/shared/conceptIcons';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { PhaseBurnup } from '@/alcon/shared/PhaseBurnup';
import { DateField as SharedDateField } from '@/alcon/shared/date';
import {
  createPhase,
  deletePhase,
  fetchPhaseCandidates,
  updateElement,
  updateObject,
  updatePhase,
  usePhases,
  type Phase,
} from '@/hooks/useSupabase';

// =============================================================
// PhaseView — the Strategy layer's "Phase" app: Linear-Cycle-style
// time-boxed periods, scoped to the active Domain. A Phase is a named date
// range ("要件定義", Jul 14 – Jul 27); Objects and Elements are assigned to
// at most one Phase via their phase_id column. Unlike Linear's auto-rolling
// cycles, Phases are created by hand — Alcon phases are milestones of a plan
// (requirements → design → build), not a fixed sprint cadence.
// =============================================================

type PhaseMembers = Awaited<ReturnType<typeof fetchPhaseCandidates>>;

// 'YYYY-MM-DD' → "Jul 14" (local, no timezone drift on bare dates).
function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// 'YYYY-MM-DD' → local Date at midnight (no timezone drift on bare dates).
function parseYMD(s: string): Date {
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "Jul\n16" — the two-line boundary label on the timeline rail.
function railLabel(s: string): string {
  const d = parseYMD(s);
  return `${d.toLocaleDateString(undefined, { month: 'short' })}\n${d.getDate()}`;
}

// Current / Upcoming / Completed, judged on local calendar dates.
function phaseTiming(p: Phase): 'current' | 'upcoming' | 'past' | null {
  if (!p.start_date && !p.end_date) return null;
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (p.start_date && ymd < p.start_date) return 'upcoming';
  if (p.end_date && ymd > p.end_date) return 'past';
  return 'current';
}

const TIMING_LABEL: Record<'current' | 'upcoming' | 'past', string> = {
  current: 'Current',
  upcoming: 'Upcoming',
  past: 'Completed',
};

// Live tallies for a Phase. Scope counts every assigned item (Objects +
// Elements); Started / Completed only Elements — Objects carry no status of
// their own.
function phaseMetrics(p: Phase, members: PhaseMembers) {
  const objects = members.objects.filter((o) => o.phase_id === p.id).length;
  const els = members.elements.filter((e) => e.phase_id === p.id);
  const scope = objects + els.length;
  const started = els.filter((e) => e.status === 'in_progress' || e.status === 'review').length;
  const completed = els.filter((e) => e.status === 'done').length;
  return { scope, started, completed };
}

// Remaining weekdays from today through the end date (inclusive).
function weekdaysLeft(end: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endD = parseYMD(end);
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
          stroke="var(--status-success)" strokeWidth={2}
          strokeDasharray={`${c * v} ${c}`} strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function PhaseView({
  activeDomainId,
  onOpenObject,
}: {
  activeDomainId: string | null;
  /** Jump to an Object's detail (the Execution "projects" view). */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { data: phases, loading, refetch } = usePhases(activeDomainId);
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
        members={members}
        onBack={() => setOpenPhaseId(null)}
        onSaved={() => { refetch(); void reloadMembers(); }}
        onOpenObject={onOpenObject}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavPhaseIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Phase</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title="Add Phase"
          aria-label="Add Phase"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? null : !activeDomainId ? (
          <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground px-6">
            Select a Domain to plan its Phases.
          </div>
        ) : phases.length === 0 ? (
          <EmptyPrompt onCreate={() => setNewOpen(true)} />
        ) : (
          <PhaseTimeline phases={phases} members={members} onOpen={setOpenPhaseId} />
        )}
      </div>

      {newOpen && activeDomainId && (
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

function EmptyPrompt({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
      <span className="text-muted-foreground/50"><NavPhaseIcon size={28} /></span>
      <p className="text-[13px] text-muted-foreground max-w-md">
        Create a Phase to time-box a stage of work — 要件定義, design, build. Assign Objects and Elements to it and track what each period covers.
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
        >
          <Plus size={12} />
          New Phase
        </button>
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
  // Newest first (upcoming → current → completed); undated phases sink.
  const sorted = useMemo(
    () => [...phases].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')),
    [phases],
  );

  return (
    // pt/pb keep the boundary labels (translated half out of their row)
    // from clipping against the scroll container's edges.
    <div className="h-full overflow-auto pt-4 pb-8">
      {sorted.map((p, i) => {
        const timing = phaseTiming(p);
        const m = phaseMetrics(p, members);
        const donePct = m.scope > 0 ? Math.round((m.completed / m.scope) * 100) : 0;
        const isCurrent = timing === 'current';
        return (
          <div key={p.id} className="relative border-b border-border/40">
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
                  {railLabel(p.end_date)}
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
                  {railLabel(p.start_date)}
                </span>
              </>
            )}

            <div className="pl-24 pr-8">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="w-full flex items-center gap-3 py-5 text-left rounded-md transition-colors hover:bg-muted/10"
              >
                <CirclePlay size={16} className={isCurrent ? 'text-foreground shrink-0' : 'text-muted-foreground shrink-0'} />
                <span className="text-[13px] font-semibold text-foreground flex-1 truncate">{p.name}</span>
                {timing && (
                  <span className="px-2 py-0.5 rounded bg-muted/60 text-[11px] text-muted-foreground shrink-0">
                    {TIMING_LABEL[timing]}
                  </span>
                )}
                {timing === 'past' ? (
                  <span className="flex items-center gap-3 text-[12px] shrink-0">
                    <span className="flex items-center gap-1.5">
                      <ProgressRing value={m.scope > 0 ? m.completed / m.scope : 0} />
                      <span className="text-foreground font-medium tabular-nums">{donePct}%</span>
                      <span className="text-muted-foreground">success</span>
                    </span>
                    <span className="text-foreground font-medium tabular-nums">{m.completed}</span>
                    <span className="text-muted-foreground -ml-2">completed</span>
                    <span className="text-foreground font-medium tabular-nums">{m.scope}</span>
                    <span className="text-muted-foreground -ml-2">scope</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-3 text-[12px] shrink-0">
                    <span className="flex items-center gap-1.5">
                      <ProgressRing value={m.scope > 0 ? m.completed / m.scope : 0} />
                      <span className="text-foreground font-medium tabular-nums">{donePct}%</span>
                      <span className="text-muted-foreground">done</span>
                    </span>
                    {isCurrent && p.end_date ? (
                      <>
                        <span className="text-foreground font-medium tabular-nums">{weekdaysLeft(p.end_date)}</span>
                        <span className="text-muted-foreground -ml-2">weekdays left</span>
                      </>
                    ) : (
                      <>
                        <span className="text-foreground font-medium tabular-nums">{m.scope}</span>
                        <span className="text-muted-foreground -ml-2">scope</span>
                      </>
                    )}
                  </span>
                )}
              </button>

              {isCurrent && p.start_date && p.end_date && (
                <PhaseBurnup phase={p} scope={m.scope} started={m.started} completed={m.completed} />
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
  members,
  onBack,
  onSaved,
  onOpenObject,
}: {
  phase: Phase;
  members: PhaseMembers;
  onBack: () => void;
  onSaved: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const [name, setName] = useState(phase.name);
  const [pickerFor, setPickerFor] = useState<'objects' | 'elements' | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setName(phase.name);
    setPickerFor(null);
    setQuery('');
  }, [phase.id, phase.name]);

  const myObjects = useMemo(() => members.objects.filter((o) => o.phase_id === phase.id), [members.objects, phase.id]);
  const myElements = useMemo(() => members.elements.filter((e) => e.phase_id === phase.id), [members.elements, phase.id]);
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

  const closePicker = () => { setPickerFor(null); setQuery(''); };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          Phase
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate max-w-[240px]">
          {phase.name}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handleDelete()}
          title="Delete Phase"
          aria-label="Delete Phase"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-red-500 hover:bg-muted rounded-md transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8 space-y-5">
          <div>
            <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
              <NavPhaseIcon size={18} />
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              placeholder="Phase name"
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none outline-none leading-tight tracking-normal"
            />
          </div>

          {/* Period — the time box itself. */}
          <div className="flex items-end gap-3 max-w-md">
            <DateField
              label="Start"
              value={phase.start_date ?? ''}
              onChange={(v) => void saveDates({ start_date: v || null })}
            />
            <DateField
              label="End"
              value={phase.end_date ?? ''}
              onChange={(v) => void saveDates({ end_date: v || null })}
            />
          </div>

          {/* ── Objects ── */}
          <section>
            <div className="h-px bg-border mb-3" />
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-foreground/90">Objects</h2>
              <button
                type="button"
                aria-label="Add Objects"
                onClick={() => { setPickerFor(pickerFor === 'objects' ? null : 'objects'); setQuery(''); }}
                className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Plus size={13} />
              </button>
            </div>

            {myObjects.length === 0 && pickerFor !== 'objects' && (
              <div className="text-[12px] text-muted-foreground/50 py-1">No Objects in this Phase yet.</div>
            )}
            {myObjects.map((o) => (
              <div
                key={o.id}
                onClick={() => onOpenObject?.(o.id, phase.domain_id)}
                className={`flex items-center gap-2 px-1 py-1.5 min-h-[2.375rem] rounded-md group/row hover:bg-muted/20 transition-colors ${onOpenObject ? 'cursor-pointer' : ''}`}
              >
                <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
                <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">{o.name}</span>
                {o.due_date && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{fmtDate(o.due_date)}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void setObjectPhase(o.id, null); }}
                  aria-label={`Remove ${o.name} from this Phase`}
                  className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {pickerFor === 'objects' && (
              <MemberPicker
                placeholder="Search Objects…"
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <ObjectIcon size={11} />
                    <span className="flex-1 truncate text-foreground">{o.name}</span>
                    {o.phase_id && <span className="text-[10px] text-muted-foreground shrink-0">in another Phase</span>}
                  </button>
                ))}
              </MemberPicker>
            )}
          </section>

          {/* ── Elements ── */}
          <section>
            <div className="h-px bg-border mb-3" />
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-foreground/90">Elements</h2>
              <button
                type="button"
                aria-label="Add Elements"
                onClick={() => { setPickerFor(pickerFor === 'elements' ? null : 'elements'); setQuery(''); }}
                className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Plus size={13} />
              </button>
            </div>

            {myElements.length === 0 && pickerFor !== 'elements' && (
              <div className="text-[12px] text-muted-foreground/50 py-1">No Elements in this Phase yet.</div>
            )}
            {myElements.map((el) => (
              <div
                key={el.id}
                className="flex items-center gap-2 px-1 py-1.5 min-h-[2.375rem] rounded-md group/row hover:bg-muted/20 transition-colors"
              >
                <ElementProgressMark status={el.status} size={14} />
                <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">{el.title}</span>
                {el.object_id && objectNameById.get(el.object_id) && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[160px] shrink-0">
                    {objectNameById.get(el.object_id)}
                  </span>
                )}
                {el.due_date && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{fmtDate(el.due_date)}</span>
                )}
                <button
                  type="button"
                  onClick={() => void setElementPhase(el.id, null)}
                  aria-label={`Remove ${el.title} from this Phase`}
                  className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {pickerFor === 'elements' && (
              <MemberPicker
                placeholder="Search Elements…"
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent text-left"
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
          </section>
        </div>
      </div>
    </div>
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
  return (
    <>
      <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-2">
        <Search size={12} className="text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] outline-none"
          autoFocus
        />
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X size={12} />
        </button>
      </div>
      <div className="rounded-lg border border-border/60 bg-card max-h-72 overflow-auto">
        {empty && (
          <div className="px-3 py-3 text-[12px] text-muted-foreground italic">No matches</div>
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
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

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
          <span className="text-[13px] font-semibold text-foreground">New Phase</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Phase name (e.g. 要件定義)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
              if (e.key === 'Escape') onClose();
            }}
            className="w-full text-xl font-semibold text-foreground bg-transparent border-none outline-none leading-tight"
          />
          <div className="flex items-end gap-3">
            <DateField label="Start" value={startDate} onChange={setStartDate} />
            <DateField label="End" value={endDate} onChange={setEndDate} />
          </div>
        </div>

        <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-border/60">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
