/** @vitest-environment jsdom */
//
// The Situation section exists to answer one question a done-ratio never
// could: does this land by the date we set. That answer is arithmetic, and
// arithmetic is exactly the kind of thing that is silently wrong — tsc and
// design-lint pass on a version that projects the wrong number, and the chart
// next to it still draws a confident line.
//
// So the cases pinned here are the ones where a plausible implementation
// quietly lies:
//
//   - counting calendar days instead of business days (over-promises by ~40%),
//   - counting Elements twice when they are multi-homed into two of the
//     Campaign's Objects (inflates both scope and completed),
//   - projecting a rate off one or two elapsed days, where the multiplier onto
//     the rest of the window turns whichever day landed in the sample into a
//     headline,
//   - reporting a Phase's scope while silently dropping the Elements that are
//     in no Phase at all, which is how a plan looks healthier than it is.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const phases: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => ({
          order: () => Promise.resolve({ data: phases, error: null }),
        }),
      }),
    }),
  },
}));

const { CampaignSituation } = await import('@/alcon/element/actions/CampaignSituation');

// Every case here is business-day arithmetic, so the weekday the suite runs on
// would otherwise change the answers. The clock is pinned to a Monday and all
// dates are written out — a test whose expected numbers drift with the calendar
// cannot tell a regression from a Tuesday.
const NOW = '2026-09-14T09:00:00'; // Monday

function phase(id: string, start: string, end: string) {
  return { id, name: `Phase ${id}`, domain_id: 'dom-1', start_date: start, end_date: end, created_at: null, updated_at: null };
}

function element(id: string, status: string, phaseId: string | null) {
  return { id, title: id, status, phase_id: phaseId } as never;
}

function object(id: string, elements: unknown[]) {
  return { id, name: id, elements } as never;
}

async function draw(objects: unknown[], objectIds: string[]) {
  render(<CampaignSituation objectIds={objectIds} allObjects={objects as never} />);
  // The phase fetch resolves on a microtask; let it land before asserting.
  await screen.findByText('Situation');
}

beforeEach(() => {
  // Date only — faking timers wholesale would stall the microtask the phase
  // fetch resolves on.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  phases.length = 0;
  cleanup();
});

describe('CampaignSituation', () => {
  it('projects the landing from business days, not calendar days', async () => {
    // Aug 31 → Sep 25, today Sep 14. 11 business days elapsed, 9 remain.
    // 10 done is 0.909/day, so it lands on 18 of a 30 scope: 12 short.
    // Counting calendar days would give 11 remaining and project 20 — a plan
    // that reads as missing by 10 instead of 12, in the flattering direction.
    phases.push(phase('p1', '2026-08-31', '2026-09-25'));
    const els = [
      ...Array.from({ length: 10 }, (_, i) => element(`done-${i}`, 'done', 'p1')),
      ...Array.from({ length: 20 }, (_, i) => element(`todo-${i}`, 'todo', 'p1')),
    ];
    await draw([object('o1', els)], ['o1']);

    expect(screen.getByText(/スコープに 12 件届かない/)).toBeTruthy();
  });

  it('counts a multi-homed Element once across the Campaign\'s Objects', async () => {
    // The same Element is reachable through two of the Campaign's Objects.
    // Counting it twice inflates scope and completed together, which keeps the
    // ratio plausible while both numbers are wrong.
    phases.push(phase('p1', '2026-09-07', '2026-09-25'));
    const shared = element('shared', 'done', 'p1');
    await draw(
      [object('o1', [shared, element('a', 'todo', 'p1')]), object('o2', [shared, element('b', 'todo', 'p1')])],
      ['o1', 'o2'],
    );

    // 3 distinct Elements, not 4.
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('refuses to project from a sample too short to be a pace', async () => {
    // Measured on the real board: a Sprint that opened on a Sunday had one
    // elapsed business day and eleven completed Elements by Monday. Projecting
    // 11/day across the rest of the window announced "finishes early" off a
    // single data point. The counts are still reported — they are observed.
    phases.push(phase('p1', '2026-09-13', '2026-09-25'));
    const els = [
      ...Array.from({ length: 11 }, (_, i) => element(`done-${i}`, 'done', 'p1')),
      ...Array.from({ length: 13 }, (_, i) => element(`todo-${i}`, 'todo', 'p1')),
    ];
    await draw([object('o1', els)], ['o1']);

    expect(screen.getByText(/経過 1 営業日ではペースを測れない/)).toBeTruthy();
    expect(screen.queryByText(/期限前にスコープを完了/)).toBeNull();
  });

  it('reports a rate of zero as a shortfall, not as missing data', async () => {
    // Half the Phase gone with nothing finished is the worst case, and it must
    // not borrow the wording of the harmless "too early to tell" case. The
    // window clears MIN_SAMPLE_DAYS so this is about the rate, not the floor.
    phases.push(phase('p1', '2026-08-31', '2026-09-25'));
    await draw(
      [object('o1', [element('a', 'todo', 'p1'), element('b', 'todo', 'p1'), element('c', 'in_progress', 'p1')])],
      ['o1'],
    );

    expect(screen.queryByText(/まだ営業日が経っていない/)).toBeNull();
    expect(screen.getByText(/スコープに 3 件届かない/)).toBeTruthy();
  });

  it('says so when unfinished work sits outside every Phase', async () => {
    // The burn-up counts only what is in the Phase. Staying silent about the
    // rest is how a scope number flatters a plan.
    phases.push(phase('p1', '2026-09-07', '2026-09-25'));
    await draw(
      [object('o1', [element('a', 'done', 'p1'), element('loose', 'todo', null), element('loose2', 'todo', null)])],
      ['o1'],
    );

    expect(screen.getByText(/Phase の外に未完了 2 件/)).toBeTruthy();
  });

  it('reports the shortfall plainly once the end date has passed', async () => {
    phases.push(phase('p1', '2026-08-17', '2026-09-11'));
    await draw(
      [object('o1', [element('a', 'done', 'p1'), element('b', 'todo', 'p1'), element('c', 'todo', 'p1')])],
      ['o1'],
    );

    expect(screen.getByText(/期限を過ぎて残り 2 件/)).toBeTruthy();
  });
});
