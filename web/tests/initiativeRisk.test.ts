import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALL_MINUTES,
  RISK_THRESHOLD_DEFAULTS,
  RISK_THRESHOLD_MAX,
  computeInitiativeRisk,
  dateKey,
  dateKeyPlus,
  formatQuiet,
  isDueSoon,
  isStalled,
  lastSignalAt,
  parseRiskThresholds,
  type RiskElement,
  type RiskObject,
} from '@/Function/strategy/initiativeRiskModel';

// A fixed clock. Every threshold in this module is relative, so the tests are
// written as offsets from here rather than as wall-clock dates.
const NOW = Date.parse('2026-08-31T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function el(over: Partial<RiskElement> & { id: string }): RiskElement {
  return {
    display_id: null,
    title: over.id,
    status: 'todo',
    due_date: null,
    updated_at: null,
    objectIds: ['o1'],
    assignees: [],
    lastProgressAt: null,
    ...over,
  };
}

const OBJ: RiskObject[] = [{ id: 'o1', name: 'Object One' }];

describe('lastSignalAt — the progress comment is the heartbeat', () => {
  it('prefers the progress comment over updated_at', () => {
    const e = el({ id: 'a', lastProgressAt: NOW - 5 * MIN, updated_at: new Date(NOW).toISOString() });
    expect(lastSignalAt(e)).toBe(NOW - 5 * MIN);
  });

  it('falls back to updated_at only when the Element was never reported on', () => {
    const e = el({ id: 'a', updated_at: new Date(NOW - 3 * MIN).toISOString() });
    expect(lastSignalAt(e)).toBe(NOW - 3 * MIN);
  });

  it('has no signal at all when neither exists', () => {
    expect(lastSignalAt(el({ id: 'a' }))).toBeNull();
  });
});

describe('isStalled — same predicate as ops/stall-check.mjs', () => {
  it('fires on in_progress that has not reported past the threshold', () => {
    const e = el({ id: 'a', status: 'in_progress', lastProgressAt: NOW - 40 * MIN });
    expect(isStalled(e, NOW)).toBe(true);
  });

  it('stays quiet while the progress comment is fresh', () => {
    const e = el({ id: 'a', status: 'in_progress', lastProgressAt: NOW - 3 * MIN });
    expect(isStalled(e, NOW)).toBe(false);
  });

  // The whole reason the definition is not `updated_at`: an edit moves that
  // timestamp without anybody working, so a stopped agent would look healthy.
  it('ignores a fresh updated_at when the progress comment is old', () => {
    const e = el({
      id: 'a',
      status: 'in_progress',
      lastProgressAt: NOW - 90 * MIN,
      updated_at: new Date(NOW - MIN).toISOString(),
    });
    expect(isStalled(e, NOW)).toBe(true);
  });

  it('only ever applies to in_progress', () => {
    for (const status of ['todo', 'backlog', 'review', 'done', 'blocked', 'cancelled']) {
      expect(isStalled(el({ id: 'a', status, lastProgressAt: NOW - 10 * HOUR }), NOW)).toBe(false);
    }
  });

  it('does not call an unmeasurable Element stalled', () => {
    expect(isStalled(el({ id: 'a', status: 'in_progress' }), NOW)).toBe(false);
  });

  it('honours a custom threshold', () => {
    const e = el({ id: 'a', status: 'in_progress', lastProgressAt: NOW - 10 * MIN });
    expect(isStalled(e, NOW, 5)).toBe(true);
    expect(isStalled(e, NOW, DEFAULT_STALL_MINUTES)).toBe(false);
  });
});

describe('dateKey — due dates are calendar dates', () => {
  it('reads the local calendar day, not the UTC instant', () => {
    const d = new Date(NOW);
    const expected = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
    expect(dateKey(NOW)).toBe(expected);
  });
});

// Overdue is a post-mortem: it only moves once the date is already missed.
// Measured on the Op Kestrel Relief board (16 Elements, all dated), 0 were
// overdue while 4 were due inside three days with nobody started — the reading
// that actually decides where the next person goes.
describe('isDueSoon — the same measurement taken early enough to act on', () => {
  const today = dateKey(NOW);
  const horizon = dateKeyPlus(NOW, 3);

  it('fires on unstarted work inside the horizon', () => {
    expect(isDueSoon(el({ id: 'a', status: 'todo', due_date: horizon }), today, horizon)).toBe(true);
    expect(isDueSoon(el({ id: 'b', status: 'backlog', due_date: today }), today, horizon)).toBe(true);
  });

  it('ignores work already moving toward the date', () => {
    for (const status of ['in_progress', 'review']) {
      expect(isDueSoon(el({ id: 'a', status, due_date: today }), today, horizon)).toBe(false);
    }
  });

  it('ignores work outside the horizon and work already past it', () => {
    expect(isDueSoon(el({ id: 'a', status: 'todo', due_date: dateKeyPlus(NOW, 4) }), today, horizon)).toBe(false);
    expect(isDueSoon(el({ id: 'b', status: 'todo', due_date: dateKeyPlus(NOW, -1) }), today, horizon)).toBe(false);
  });

  it('ignores closed and undated work', () => {
    expect(isDueSoon(el({ id: 'a', status: 'done', due_date: today }), today, horizon)).toBe(false);
    expect(isDueSoon(el({ id: 'b', status: 'todo' }), today, horizon)).toBe(false);
  });
});

describe('dateKeyPlus', () => {
  it('walks whole calendar days, including across a month boundary', () => {
    const aug31 = Date.parse('2026-08-31T12:00:00');
    expect(dateKeyPlus(aug31, 0)).toBe('2026-08-31');
    expect(dateKeyPlus(aug31, 3)).toBe('2026-09-03');
    expect(dateKeyPlus(aug31, -1)).toBe('2026-08-30');
  });
});

describe('computeInitiativeRisk — signals', () => {
  it('counts open work and ignores done / cancelled', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'todo' }),
        el({ id: 'b', status: 'done' }),
        el({ id: 'c', status: 'cancelled' }),
        el({ id: 'd', status: 'in_progress', lastProgressAt: NOW }),
      ],
      NOW,
    );
    expect(r.openTotal).toBe(2);
  });

  it('ignores Elements homed outside the Initiative scope', () => {
    const r = computeInitiativeRisk(OBJ, [el({ id: 'a' }), el({ id: 'b', objectIds: ['other'] })], NOW);
    expect(r.openTotal).toBe(1);
  });

  it('counts a multi-homed Element once when one home is in scope', () => {
    const r = computeInitiativeRisk(OBJ, [el({ id: 'a', objectIds: ['other', 'o1'] })], NOW);
    expect(r.openTotal).toBe(1);
  });

  it('counts overdue only for open Elements strictly before today', () => {
    const today = dateKey(NOW);
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', due_date: '2026-01-01' }),
        el({ id: 'b', due_date: today }),
        el({ id: 'c', due_date: '2099-01-01' }),
        el({ id: 'd', due_date: '2026-01-01', status: 'done' }),
      ],
      NOW,
    );
    expect(r.overdue).toBe(1);
    expect(r.scheduled).toBe(3);
  });

  // The measured shape of the real board: 0 of 57 open Elements carry a due
  // date. `overdue: 0` there is not "on time", it is "not measured", and the
  // report has to keep those apart or the pane lies.
  it('separates an unmeasured schedule from a clean one', () => {
    const none = computeInitiativeRisk(OBJ, [el({ id: 'a' }), el({ id: 'b' })], NOW);
    expect(none.overdue).toBe(0);
    expect(none.scheduled).toBe(0);

    const measured = computeInitiativeRisk(OBJ, [el({ id: 'a', due_date: '2099-01-01' })], NOW);
    expect(measured.overdue).toBe(0);
    expect(measured.scheduled).toBe(1);
  });

  it('counts due-soon work that nobody has started', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'todo', due_date: dateKeyPlus(NOW, 1) }),
        el({ id: 'b', status: 'backlog', due_date: dateKeyPlus(NOW, 3) }),
        el({ id: 'c', status: 'in_progress', due_date: dateKeyPlus(NOW, 1), lastProgressAt: NOW }),
        el({ id: 'd', status: 'todo', due_date: dateKeyPlus(NOW, 8) }),
      ],
      NOW,
    );
    expect(r.dueSoon).toBe(2);
    expect(r.overdue).toBe(0);
  });

  it('counts blocked and unstaffed open Elements', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'blocked' }),
        el({ id: 'b', assignees: [{ id: 'w1', name: 'Ada' }] }),
        el({ id: 'c' }),
        el({ id: 'd', status: 'done' }),
      ],
      NOW,
    );
    expect(r.blocked).toBe(1);
    expect(r.unstaffed).toBe(2);
  });
});

describe('computeInitiativeRisk — findings', () => {
  const TWO: RiskObject[] = [
    { id: 'o1', name: 'Object One' },
    { id: 'o2', name: 'Object Two' },
  ];

  it('reports an Object with a silent in-flight Element as stalled', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [el({ id: 'a', status: 'in_progress', lastProgressAt: NOW - 3 * HOUR })],
      NOW,
    );
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0].reason).toBe('stalled');
    expect(r.objects[0].stalled).toBe(1);
    expect(r.objects[0].inFlight).toBe(1);
  });

  // Idle is a different illness from stalled and needs a different remedy:
  // nobody ever started, so the answer is to staff it, not to go debug it.
  it('reports open-but-unstarted quiet work as idle, not stalled', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'todo', lastProgressAt: NOW - 30 * HOUR }),
        el({ id: 'b', status: 'backlog', lastProgressAt: NOW - 40 * HOUR }),
      ],
      NOW,
    );
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0].reason).toBe('idle');
    expect(r.objects[0].open).toBe(2);
    expect(r.objects[0].inFlight).toBe(0);
    expect(r.objects[0].quietForMs).toBe(30 * HOUR);
  });

  it('does not call an Object idle while something is in flight', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'todo', lastProgressAt: NOW - 30 * HOUR }),
        el({ id: 'b', status: 'in_progress', lastProgressAt: NOW - MIN }),
      ],
      NOW,
    );
    expect(r.objects).toEqual([]);
  });

  it('does not call a recently-touched Object idle', () => {
    const r = computeInitiativeRisk(OBJ, [el({ id: 'a', lastProgressAt: NOW - 2 * HOUR })], NOW);
    expect(r.objects).toEqual([]);
  });

  it('skips Objects with no Elements at all rather than calling them idle', () => {
    const r = computeInitiativeRisk(TWO, [el({ id: 'a', lastProgressAt: NOW - MIN })], NOW);
    expect(r.objects).toEqual([]);
  });

  it('reports an Object with near, unstarted work as due_soon', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'todo', due_date: dateKeyPlus(NOW, 1), lastProgressAt: NOW - MIN }),
        el({ id: 'b', status: 'backlog', due_date: dateKeyPlus(NOW, 3), lastProgressAt: NOW - MIN }),
        el({ id: 'c', status: 'todo', due_date: dateKeyPlus(NOW, 9), lastProgressAt: NOW - MIN }),
      ],
      NOW,
    );
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0].reason).toBe('due_soon');
    expect(r.objects[0].dueSoon).toBe(2);
    expect(r.objects[0].dueSoonBy).toBe(dateKeyPlus(NOW, 1));
  });

  it('ranks overdue, stalled, blocked, due_soon, idle in that order', () => {
    const five: RiskObject[] = [
      { id: 'idle', name: 'Idle' },
      { id: 'soon', name: 'Soon' },
      { id: 'blocked', name: 'Blocked' },
      { id: 'stalled', name: 'Stalled' },
      { id: 'overdue', name: 'Overdue' },
    ];
    const r = computeInitiativeRisk(
      five,
      [
        el({ id: 'a', objectIds: ['idle'], status: 'todo', lastProgressAt: NOW - 30 * HOUR }),
        el({ id: 'b', objectIds: ['soon'], status: 'todo', due_date: dateKeyPlus(NOW, 1), lastProgressAt: NOW - MIN }),
        el({ id: 'c', objectIds: ['blocked'], status: 'blocked', lastProgressAt: NOW - MIN }),
        el({ id: 'd', objectIds: ['stalled'], status: 'in_progress', lastProgressAt: NOW - 2 * HOUR }),
        el({ id: 'e', objectIds: ['overdue'], status: 'todo', due_date: dateKeyPlus(NOW, -2), lastProgressAt: NOW - MIN }),
      ],
      NOW,
    );
    expect(r.objects.map((o) => o.object.name)).toEqual([
      'Overdue',
      'Stalled',
      'Blocked',
      'Soon',
      'Idle',
    ]);
  });

  it('sorts due_soon Objects by the date they are racing, not by silence', () => {
    const TWO_OBJ: RiskObject[] = [
      { id: 'o1', name: 'Later' },
      { id: 'o2', name: 'Sooner' },
    ];
    const r = computeInitiativeRisk(
      TWO_OBJ,
      [
        el({ id: 'a', objectIds: ['o1'], status: 'todo', due_date: dateKeyPlus(NOW, 3), lastProgressAt: NOW - 20 * HOUR }),
        el({ id: 'b', objectIds: ['o2'], status: 'todo', due_date: dateKeyPlus(NOW, 1), lastProgressAt: NOW - MIN }),
      ],
      NOW,
    );
    expect(r.objects.map((o) => o.object.name)).toEqual(['Sooner', 'Later']);
  });

  // A neighbouring Element being edited refreshes the Object's clock while the
  // stopped one stays stopped. The stalled row must report the outage, not the
  // Object's newest breath.
  it('reports the stalled Element\'s own silence, not the Object\'s', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', status: 'in_progress', lastProgressAt: NOW - 95 * MIN }),
        el({ id: 'b', status: 'todo', lastProgressAt: NOW - 2 * MIN }),
      ],
      NOW,
    );
    expect(r.objects[0].reason).toBe('stalled');
    expect(r.objects[0].quietForMs).toBe(2 * MIN);
    expect(r.objects[0].stalledQuietMs).toBe(95 * MIN);
  });

  it('puts the longest silence first within one reason', () => {
    const r = computeInitiativeRisk(
      TWO,
      [
        el({ id: 'a', objectIds: ['o1'], status: 'todo', lastProgressAt: NOW - 26 * HOUR }),
        el({ id: 'b', objectIds: ['o2'], status: 'todo', lastProgressAt: NOW - 200 * HOUR }),
      ],
      NOW,
    );
    expect(r.objects.map((o) => o.object.name)).toEqual(['Object Two', 'Object One']);
  });
});

describe('computeInitiativeRisk — load', () => {
  it('ranks Workers by open Element count and computes their share', () => {
    const ada = { id: 'w1', name: 'Ada' };
    const grace = { id: 'w2', name: 'Grace' };
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', assignees: [ada] }),
        el({ id: 'b', assignees: [ada] }),
        el({ id: 'c', assignees: [ada] }),
        el({ id: 'd', assignees: [grace] }),
      ],
      NOW,
    );
    expect(r.load.map((l) => [l.name, l.open])).toEqual([
      ['Ada', 3],
      ['Grace', 1],
    ]);
    expect(r.load[0].share).toBeCloseTo(0.75);
  });

  it('does not count closed Elements as load', () => {
    const ada = { id: 'w1', name: 'Ada' };
    const r = computeInitiativeRisk(
      OBJ,
      [el({ id: 'a', assignees: [ada] }), el({ id: 'b', status: 'done', assignees: [ada] })],
      NOW,
    );
    expect(r.load[0].open).toBe(1);
  });

  // The measured reading on the real board: one Worker holds 42 of 57 open
  // Elements. That is the decision the pane exists to surface.
  it('flags a Initiative that runs through one Worker', () => {
    const ada = { id: 'w1', name: 'Ada' };
    const grace = { id: 'w2', name: 'Grace' };
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', assignees: [ada] }),
        el({ id: 'b', assignees: [ada] }),
        el({ id: 'c', assignees: [ada] }),
        el({ id: 'd', assignees: [grace] }),
      ],
      NOW,
    );
    expect(r.concentration?.name).toBe('Ada');
  });

  it('leaves an evenly-staffed Initiative unflagged', () => {
    const r = computeInitiativeRisk(
      OBJ,
      [
        el({ id: 'a', assignees: [{ id: 'w1', name: 'Ada' }] }),
        el({ id: 'b', assignees: [{ id: 'w2', name: 'Grace' }] }),
      ],
      NOW,
    );
    expect(r.concentration).toBeNull();
  });

  it('gives an empty Initiative a report rather than throwing', () => {
    const r = computeInitiativeRisk([], [], NOW);
    expect(r).toMatchObject({ openTotal: 0, load: [], objects: [], concentration: null });
  });
});

// The acceptance case, taken from a live Initiative rather than invented: five
// Task Forces, sixteen dated Elements, six Workers. Read as a fixed instant so
// it does not rot next week — the whole reason `now` is an argument.
describe('computeInitiativeRisk — Op Kestrel Relief, as measured', () => {
  const T = Date.parse('2026-08-31T21:18:00+09:00');
  const OBJECTS: RiskObject[] = [
    { id: 'rcn', name: 'RECON' },
    { id: 'air', name: 'TF-AIR' },
    { id: 'med', name: 'TF-MED' },
    { id: 'log', name: 'TF-LOG' },
    { id: 'civ', name: 'TF-CIV' },
  ];
  const mori = { id: 'w-mori', name: 'Lt. Mori' };
  const hale = { id: 'w-hale', name: 'Capt. Hale' };
  const okafor = { id: 'w-okafor', name: 'Maj. Okafor' };
  const reyes = { id: 'w-reyes', name: 'Capt. Reyes' };
  const lindqvist = { id: 'w-lind', name: 'Dr. Lindqvist' };
  const vega = { id: 'w-vega', name: 'Col. Vega' };
  const fresh = T - 2 * MIN;

  const BOARD: RiskElement[] = [
    el({ id: 'RCN-001', objectIds: ['rcn'], status: 'done', due_date: '2026-08-31', lastProgressAt: fresh, assignees: [mori] }),
    el({ id: 'RCN-002', objectIds: ['rcn'], status: 'in_progress', due_date: '2026-09-01', lastProgressAt: fresh, assignees: [mori] }),
    el({ id: 'RCN-003', objectIds: ['rcn'], status: 'backlog', due_date: '2026-09-07', lastProgressAt: fresh, assignees: [mori] }),
    el({ id: 'AIR-001', objectIds: ['air'], status: 'todo', due_date: '2026-09-01', lastProgressAt: fresh, assignees: [hale] }),
    el({ id: 'AIR-002', objectIds: ['air'], status: 'todo', due_date: '2026-09-02', lastProgressAt: fresh, assignees: [hale] }),
    el({ id: 'AIR-003', objectIds: ['air', 'med'], status: 'backlog', due_date: '2026-09-03', lastProgressAt: fresh, assignees: [hale, okafor] }),
    el({ id: 'MED-001', objectIds: ['med'], status: 'in_progress', due_date: '2026-09-02', lastProgressAt: fresh, assignees: [okafor] }),
    el({ id: 'MED-002', objectIds: ['med'], status: 'backlog', due_date: '2026-09-06', lastProgressAt: fresh, assignees: [okafor] }),
    el({ id: 'MED-003', objectIds: ['med'], status: 'backlog', due_date: '2026-09-04', lastProgressAt: fresh, assignees: [okafor, hale] }),
    el({ id: 'LOG-001', objectIds: ['log'], status: 'in_progress', due_date: '2026-09-01', lastProgressAt: fresh, assignees: [reyes] }),
    el({ id: 'LOG-002', objectIds: ['log'], status: 'backlog', due_date: '2026-09-05', lastProgressAt: fresh, assignees: [reyes, lindqvist] }),
    el({ id: 'LOG-003', objectIds: ['log'], status: 'backlog', due_date: '2026-09-07', lastProgressAt: fresh, assignees: [reyes] }),
    el({ id: 'CIV-001', objectIds: ['civ'], status: 'in_progress', due_date: '2026-09-02', lastProgressAt: fresh, assignees: [lindqvist] }),
    el({ id: 'CIV-002', objectIds: ['civ'], status: 'backlog', due_date: '2026-09-07', lastProgressAt: fresh, assignees: [lindqvist] }),
    el({ id: 'CIV-003', objectIds: ['civ'], status: 'backlog', due_date: '2026-09-07', lastProgressAt: fresh, assignees: [lindqvist] }),
    el({ id: 'CIV-004', objectIds: ['civ'], status: 'backlog', due_date: '2026-09-11', lastProgressAt: fresh, assignees: [lindqvist, vega] }),
  ];

  const r = computeInitiativeRisk(OBJECTS, BOARD, T);

  it('finds nothing overdue and nothing stalled — the schedule is measured and clean', () => {
    expect(r.openTotal).toBe(15);
    expect(r.scheduled).toBe(15);
    expect(r.overdue).toBe(0);
    expect(r.stalled).toBe(0);
    expect(r.blocked).toBe(0);
    expect(r.unstaffed).toBe(0);
  });

  // Overdue alone would report this Initiative as entirely healthy. It is not:
  // three Elements are due within three days and nobody has started any of them.
  it('names TF-AIR as where the next person goes', () => {
    expect(r.dueSoon).toBe(3);
    expect(r.objects[0].object.name).toBe('TF-AIR');
    expect(r.objects[0].reason).toBe('due_soon');
    expect(r.objects[0].dueSoon).toBe(3);
    expect(r.objects[0].dueSoonBy).toBe('2026-09-01');
  });

  // AIR-003 is homed in both Task Forces, so it appears on both rows — but the
  // Initiative-level count is of Elements, not of rows, and must not double it.
  it('shows the multi-homed Element on both Objects without counting it twice', () => {
    expect(r.objects.map((o) => o.object.name)).toEqual(['TF-AIR', 'TF-MED']);
    expect(r.objects[1].dueSoon).toBe(1);
    expect(r.objects[0].dueSoon + r.objects[1].dueSoon).toBe(4);
    expect(r.dueSoon).toBe(3);
  });

  it('does not flag concentration on a Initiative staffed across six Workers', () => {
    expect(r.load[0]).toMatchObject({ name: 'Dr. Lindqvist', open: 5 });
    expect(r.concentration).toBeNull();
  });
});

describe('formatQuiet', () => {
  it('reads minutes, then hours, then days', () => {
    expect(formatQuiet(5 * MIN)).toBe('5m');
    expect(formatQuiet(90 * MIN)).toBe('1h');
    expect(formatQuiet(27 * HOUR)).toBe('27h');
    expect(formatQuiet(72 * HOUR)).toBe('3d');
  });

  it('never rounds a fresh silence down to zero', () => {
    expect(formatQuiet(20_000)).toBe('1m');
  });
});

describe('parseRiskThresholds — domains.risk_thresholds is jsonb, so trust nothing', () => {
  it('maps the snake_case storage keys to the model options', () => {
    expect(parseRiskThresholds({ due_soon_days: 7, stall_minutes: 90, idle_hours: 48 })).toEqual({
      dueSoonDays: 7,
      stallMinutes: 90,
      idleHours: 48,
    });
  });

  it('drops anything that is not a positive finite number, and tolerates junk', () => {
    expect(parseRiskThresholds({ due_soon_days: '7', stall_minutes: -5, idle_hours: NaN })).toEqual({});
    expect(parseRiskThresholds({ due_soon_days: 0 })).toEqual({});
    expect(parseRiskThresholds(null)).toEqual({});
    expect(parseRiskThresholds('nope')).toEqual({});
    expect(parseRiskThresholds({})).toEqual({});
  });

  it('exposes the same defaults the model falls back to, under the storage keys', () => {
    expect(RISK_THRESHOLD_DEFAULTS.stall_minutes).toBe(DEFAULT_STALL_MINUTES);
  });
});

describe('computeInitiativeRisk — per-Object thresholds (Settings > Elements > SLAs)', () => {
  it('judges each Object by its own Domain thresholds', () => {
    // Both Elements last reported 40 minutes ago. A keeps the default (25m)
    // and is stalled; B's Domain allows 60m and is not.
    const objects: RiskObject[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', thresholds: { stallMinutes: 60 } },
    ];
    const elements = [
      el({ id: 'e1', status: 'in_progress', objectIds: ['a'], lastProgressAt: NOW - 40 * MIN }),
      el({ id: 'e2', status: 'in_progress', objectIds: ['b'], lastProgressAt: NOW - 40 * MIN }),
    ];
    const report = computeInitiativeRisk(objects, elements, NOW);
    expect(report.stalled).toBe(1);
    expect(report.objects.map((r) => [r.object.id, r.reason])).toEqual([['a', 'stalled']]);
  });

  it('widens the due-soon horizon for an Object whose Domain asks for it', () => {
    const in5days = dateKeyPlus(NOW, 5);
    const objects: RiskObject[] = [
      { id: 'a', name: 'A' }, // default 3 days → not soon
      { id: 'b', name: 'B', thresholds: { dueSoonDays: 7 } }, // 7 days → soon
    ];
    const elements = [
      el({ id: 'e1', status: 'todo', objectIds: ['a'], due_date: in5days }),
      el({ id: 'e2', status: 'todo', objectIds: ['b'], due_date: in5days }),
    ];
    const report = computeInitiativeRisk(objects, elements, NOW);
    expect(report.dueSoon).toBe(1);
    expect(report.objects.map((r) => [r.object.id, r.reason])).toEqual([['b', 'due_soon']]);
  });

  it('lets a Domain wait longer before calling an Object idle', () => {
    const objects: RiskObject[] = [
      { id: 'a', name: 'A' }, // default 24h
      { id: 'b', name: 'B', thresholds: { idleHours: 72 } },
    ];
    const elements = [
      el({ id: 'e1', status: 'todo', objectIds: ['a'], updated_at: new Date(NOW - 30 * HOUR).toISOString() }),
      el({ id: 'e2', status: 'todo', objectIds: ['b'], updated_at: new Date(NOW - 30 * HOUR).toISOString() }),
    ];
    const report = computeInitiativeRisk(objects, elements, NOW);
    expect(report.objects.map((r) => [r.object.id, r.reason])).toEqual([['a', 'idle']]);
  });

  it('counts a multi-homed Element once, and counts it if any home flags it', () => {
    const objects: RiskObject[] = [
      { id: 'a', name: 'A', thresholds: { stallMinutes: 60 } },
      { id: 'b', name: 'B' },
    ];
    const elements = [
      el({ id: 'e1', status: 'in_progress', objectIds: ['a', 'b'], lastProgressAt: NOW - 40 * MIN }),
    ];
    const report = computeInitiativeRisk(objects, elements, NOW);
    expect(report.stalled).toBe(1);
    expect(report.objects.map((r) => r.object.id)).toEqual(['b']);
  });

  it('Object thresholds win over Initiative-level options, which win over defaults', () => {
    const objects: RiskObject[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', thresholds: { stallMinutes: 10 } },
    ];
    const elements = [
      el({ id: 'e1', status: 'in_progress', objectIds: ['a'], lastProgressAt: NOW - 20 * MIN }),
      el({ id: 'e2', status: 'in_progress', objectIds: ['b'], lastProgressAt: NOW - 20 * MIN }),
    ];
    // Initiative says 30m: A is quiet 20m → fine; B overrides to 10m → stalled.
    const report = computeInitiativeRisk(objects, elements, NOW, { stallMinutes: 30 });
    expect(report.objects.map((r) => [r.object.id, r.reason])).toEqual([['b', 'stalled']]);
  });
});

describe('parseRiskThresholds — an extreme value must not poison a report', () => {
  it('rejects a due_soon_days large enough to push dateKeyPlus out of Date range', () => {
    // Regression: an unbounded due_soon_days let dateKeyPlus produce
    // "NaN-NaN-NaN", which then compared as *greater than* every real date
    // string — silently flagging every dated Element in the Domain as due
    // soon instead of erroring.
    expect(parseRiskThresholds({ due_soon_days: 1e8 })).toEqual({});
    expect(dateKeyPlus(NOW, RISK_THRESHOLD_MAX.due_soon_days)).not.toBe('NaN-NaN-NaN');
  });

  it('accepts exactly the max and rejects one past it, for every field', () => {
    expect(parseRiskThresholds({ due_soon_days: RISK_THRESHOLD_MAX.due_soon_days })).toEqual({
      dueSoonDays: RISK_THRESHOLD_MAX.due_soon_days,
    });
    expect(parseRiskThresholds({ due_soon_days: RISK_THRESHOLD_MAX.due_soon_days + 1 })).toEqual({});

    expect(parseRiskThresholds({ stall_minutes: RISK_THRESHOLD_MAX.stall_minutes + 1 })).toEqual({});
    expect(parseRiskThresholds({ idle_hours: RISK_THRESHOLD_MAX.idle_hours + 1 })).toEqual({});
  });
});
