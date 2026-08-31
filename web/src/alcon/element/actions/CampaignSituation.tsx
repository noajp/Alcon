'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AlconObjectWithChildren, Phase } from '@/hooks/useSupabase';
import { PhaseBurnup } from '@/alcon/shared/PhaseBurnup';

// =============================================================
// CampaignSituation — what a Campaign is doing, derived rather than written.
//
// The Strategy layer exists to say what we are trying to achieve and whether
// we are winning. Until now a Campaign could only say what it *contains*:
// nested Campaigns, an Object list, and a done-ratio bar per Object. A ratio
// answers "how much is finished", never "will it land" — so the answer to the
// second question kept being typed into the comment stream as prose.
//
// That is the wrong shape twice over. A comment is an utterance: it is true
// forever as a record of having been said, and it accumulates by design. A
// situation is a measurement of one moment, and a new measurement *replaces*
// the old one. Pasting measurements into an utterance stream means the newest
// and the oldest look identical, the reader has to hunt for the current one,
// and the log grows without bound because nothing ever supersedes anything.
//
// So the situation is computed here, from rows that are already on the board,
// and nobody has to remember to write it.
// =============================================================

/** Business days in [from, to], inclusive of both ends. */
function businessDaysBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  let days = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= last) {
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

type Tally = { phase: Phase; scope: number; started: number; completed: number };

/**
 * The Phases this Campaign's own Elements sit in.
 *
 * Not "the Phases of this Campaign's Domain" — a Campaign deliberately spans
 * Domains, and Phases are Domain-scoped, so there is no single Phase to ask
 * for. The Elements themselves are the only honest answer to which time boxes
 * this effort is actually being run inside.
 */
function usePhasesOfElements(phaseIds: string[]): Phase[] {
  const [phases, setPhases] = useState<Phase[]>([]);
  const key = phaseIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) {
      setPhases([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('phases')
        .select('*')
        .in('id', ids)
        .order('start_date', { ascending: true, nullsFirst: false });
      if (!cancelled) setPhases((data || []) as Phase[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return phases;
}

/**
 * Where this pace lands, and whether that is short.
 *
 * The rate is completed-per-business-day since the Phase opened. There are no
 * historical snapshots in this schema — the burn-up chart says so about its own
 * lines — so this is a mean, not a trend, and it is described as one. A mean
 * is still enough to answer the question the board has never answered: not
 * "how many are done" but "does this land by the date we set".
 */
function forecast(t: Tally): { text: string; short: number } | null {
  if (!t.phase.start_date || !t.phase.end_date || t.scope === 0) return null;
  const start = parseYMD(t.phase.start_date);
  const end = parseYMD(t.phase.end_date);
  const now = new Date();

  if (now < start) return null;
  const elapsed = businessDaysBetween(start, now > end ? end : now);
  const remaining = now >= end ? 0 : businessDaysBetween(now, end) - 1;

  if (t.completed >= t.scope) return { text: 'スコープを完了', short: 0 };
  if (remaining <= 0) {
    return { text: `期限を過ぎて残り ${t.scope - t.completed} 件`, short: t.scope - t.completed };
  }
  // Only a Phase that has not had a working day yet is genuinely unmeasurable.
  // Nothing completed after days of elapsed time is not missing data — it is a
  // rate of zero, and reporting it as "no pace yet" would hide the worst case
  // behind the same words used for the harmless one.
  if (elapsed <= 0) {
    return { text: `残り ${remaining} 営業日 / 未完了 ${t.scope - t.completed} 件。まだ営業日が経っていない`, short: 0 };
  }

  const perDay = t.completed / elapsed;
  const landing = Math.floor(t.completed + perDay * remaining);
  const short = t.scope - landing;
  return short > 0
    ? { text: `開始からの平均ペースなら期限までに ${landing} 件。スコープに ${short} 件届かない`, short }
    : { text: `開始からの平均ペースなら期限前にスコープを完了`, short: 0 };
}

export function CampaignSituation({
  objectIds,
  allObjects,
}: {
  /** The Campaign's Object scope (`strategy_objects`). */
  objectIds: string[];
  allObjects: AlconObjectWithChildren[];
}) {
  // Every Element this Campaign owns, through its Objects.
  const elements = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const id of objectIds) {
      for (const el of allObjects.find((o) => o.id === id)?.elements ?? []) {
        if (seen.has(el.id)) continue; // multi-homed Elements must not count twice
        seen.add(el.id);
        out.push(el);
      }
    }
    return out;
  }, [objectIds, allObjects]);

  const phaseIds = useMemo(
    () => Array.from(new Set(elements.map((e) => e.phase_id).filter((v): v is string => !!v))).sort(),
    [elements],
  );
  const phases = usePhasesOfElements(phaseIds);

  const tallies = useMemo<Tally[]>(
    () =>
      phases
        .filter((p) => p.start_date && p.end_date)
        .map((p) => {
          const els = elements.filter((e) => e.phase_id === p.id);
          return {
            phase: p,
            scope: els.length,
            started: els.filter((e) => e.status === 'in_progress' || e.status === 'review').length,
            completed: els.filter((e) => e.status === 'done').length,
          };
        }),
    [phases, elements],
  );

  // Elements outside every time box. Not a fault — backlog lives here — but the
  // burn-up above deliberately does not count them, and a scope number that
  // silently omits rows is how a plan looks healthier than it is.
  const unphased = elements.filter((e) => !e.phase_id && e.status !== 'done' && e.status !== 'cancelled').length;

  if (!elements.length) return null;

  return (
    <section>
      <div className="h-px bg-border mb-3" />
      <h2 className="text-[13px] font-medium text-foreground/90 mb-2">Situation</h2>

      {tallies.length === 0 && (
        <div className="text-[12px] text-muted-foreground/50 py-1">
          Phase に入った Element がありません — 期間を持つ Phase に入れると着地見込みが出ます。
        </div>
      )}

      {tallies.map((t) => {
        const f = forecast(t);
        return (
          <div key={t.phase.id} className="mb-2">
            <div className="flex items-baseline gap-2 px-1">
              <span className="text-[13px] font-medium text-foreground">{t.phase.name}</span>
              {f && (
                <span
                  className={`text-[12px] ${f.short > 0 ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}`}
                >
                  {f.text}
                </span>
              )}
            </div>
            <PhaseBurnup phase={t.phase} scope={t.scope} started={t.started} completed={t.completed} />
          </div>
        );
      })}

      {unphased > 0 && (
        <div className="text-[12px] text-muted-foreground px-1 pb-2">
          Phase の外に未完了 {unphased} 件。上の burn-up には入っていません。
        </div>
      )}

      {/* Seam for el_STR-002. The cross-section — what is overdue, what is
          stalled, who is overloaded — belongs in this section too:
          <CampaignRisk objectIds={objectIds} allObjects={allObjects} />
          goes exactly here, below the burn-up.
          Order is deliberate. Time axis first: "are we late" is the question a
          Campaign is opened to answer, and it is the one that decides whether
          the cross-section is worth reading at all. The cross-section then says
          where to push, which is only actionable once you know you need to.
          Same props as this component — the Objects are the Campaign's scope
          and their Elements are the rows. Nothing here needs the Campaign row
          itself, so neither should that.
          Kept as two components because they answer different questions from
          different data: this one reads phases, that one reads due dates,
          progress comments (the stall definition lives in ops/stall-check.mjs
          and must not be re-derived here) and assignees. */}
    </section>
  );
}
