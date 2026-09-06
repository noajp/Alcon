'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AlconObjectWithChildren, Phase } from '@/hooks/useSupabase';
import { PhaseBurnup } from '@/alcon/shared/PhaseBurnup';
import { phaseElapsedRemaining } from '@/alcon/shared/phaseWindow';

// =============================================================
// InitiativeSituation — what a Initiative is doing, derived rather than written.
//
// The Strategy layer exists to say what we are trying to achieve and whether
// we are winning. Until now a Initiative could only say what it *contains*:
// nested Initiatives, an Object list, and a done-ratio bar per Object. A ratio
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
//
// Body only: the heading and the box around it are the widget frame's
// (`alcon/widget`), so this renders the reading and nothing else.
// =============================================================

type Tally = { phase: Phase; scope: number; started: number; completed: number };

/**
 * Elapsed business days below which a completion rate is not reported.
 *
 * Three is the smallest sample that can show a direction rather than a single
 * day repeated — with one or two days the projection is dominated by whichever
 * day happened to land in it, and the multiplier onto the remaining window is
 * large enough to turn that accident into a headline.
 */
const MIN_SAMPLE_DAYS = 3;

/**
 * The Phases this Initiative's own Elements sit in.
 *
 * Not "the Phases of this Initiative's Domain" — a Initiative deliberately spans
 * Domains, and Phases are Domain-scoped, so there is no single Phase to ask
 * for. The Elements themselves are the only honest answer to which time boxes
 * this effort is actually being run inside.
 */
function usePhasesOfElements(phaseIds: string[]): Phase[] {
  const [phases, setPhases] = useState<Phase[]>([]);
  const key = phaseIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    // No ids means nothing to fetch, and setting empty state here would be a
    // synchronous write inside the effect that runs on every key change —
    // a cascading render to express something the render can just read off
    // `key` itself (see the guard below).
    if (!ids.length) return;
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

  // Guarding on `key` rather than trusting `phases` to have been cleared: the
  // effect above deliberately leaves stale rows in place instead of writing
  // through them, so the empty case has to be answered here.
  return key ? phases : EMPTY_PHASES;
}

const EMPTY_PHASES: Phase[] = [];

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
  if (t.scope === 0) return null;
  const window = phaseElapsedRemaining(t.phase, new Date());
  // Null means the Phase has not opened yet, or is missing a date — either
  // way there is nothing to forecast, and the burn-up chart already declines
  // to draw in the same cases (see phaseWindowMs).
  if (!window) return null;
  const { elapsed, remaining } = window;

  if (t.completed >= t.scope) return { text: 'スコープを完了', short: 0 };
  if (remaining <= 0) {
    return { text: `期限を過ぎて残り ${t.scope - t.completed} 件`, short: t.scope - t.completed };
  }
  // A pace needs enough elapsed time to be a pace rather than a single day
  // multiplied. Measured on this board: Sprint 2 opened on a Sunday, so by
  // Monday it had one elapsed business day and eleven completed Elements —
  // 11/day projected over nine remaining days lands on 110 against a scope of
  // 24, and the section would have announced "finishes early" with total
  // confidence off one data point.
  //
  // Refusing to project is the same discipline as refusing to call a rate of
  // zero "unmeasurable", pointed the other way: a number that sounds
  // authoritative and is not, is worse than no number, because someone acts on
  // it. The counts are still shown — they are observed, not extrapolated.
  if (elapsed < MIN_SAMPLE_DAYS) {
    return {
      text: `完了 ${t.completed} / ${t.scope} 件、残り ${remaining} 営業日。経過 ${elapsed} 営業日ではペースを測れない`,
      short: 0,
    };
  }

  const perDay = t.completed / elapsed;
  const landing = Math.floor(t.completed + perDay * remaining);
  const short = t.scope - landing;
  return short > 0
    ? { text: `開始からの平均ペースなら期限までに ${landing} 件。スコープに ${short} 件届かない`, short }
    : { text: `開始からの平均ペースなら期限前にスコープを完了`, short: 0 };
}

export function InitiativeSituation({
  objectIds,
  allObjects,
}: {
  /** The Initiative's Object scope (`strategy_objects`). */
  objectIds: string[];
  allObjects: AlconObjectWithChildren[];
}) {
  // Every Element this Initiative owns, through its Objects.
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
    <>
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
          <InitiativeRisk objectIds={objectIds} allObjects={allObjects} />
          goes exactly here, below the burn-up.
          Order is deliberate. Time axis first: "are we late" is the question a
          Initiative is opened to answer, and it is the one that decides whether
          the cross-section is worth reading at all. The cross-section then says
          where to push, which is only actionable once you know you need to.
          Same props as this component — the Objects are the Initiative's scope
          and their Elements are the rows. Nothing here needs the Initiative row
          itself, so neither should that.
          Kept as two components because they answer different questions from
          different data: this one reads phases, that one reads due dates,
          progress comments (the stall definition lives in ops/stall-check.mjs
          and must not be re-derived here) and assignees. */}
    </>
  );
}
