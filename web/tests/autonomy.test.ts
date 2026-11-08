import { describe, expect, it } from 'vitest';
import { autonomyLineFor, laneOfManifestCommand, pinChoicesFor } from '@/AIP/connectors/autonomyModel';
import type { AutonomyGrant, CommandTrackRecord } from '@/types/database';

// Graduated autonomy (B7, _shared/autonomy.ts + the grant's place in
// _shared/approvalPolicy.ts): lanes derive from the manifest's
// reversibility, never from the model; a grant may lift only the one
// ask full delegation would have lifted, never a floor — deny stays
// denied, critical stays asking, the ask-every-time mode stays
// asking — under every combination of the policy matrix; the record
// is computed from settled records only (decided action rows and
// finished runs' outcomes); an incident revokes a standing grant on
// the path that records it, and the evaluator sweeps the rest.
const auto = await import(new URL('../../supabase/functions/_shared/autonomy.ts', import.meta.url).pathname);
const pol = await import(new URL('../../supabase/functions/_shared/approvalPolicy.ts', import.meta.url).pathname);
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);

const NOW = new Date('2026-12-07T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const manifestOf = (commands: unknown[]) => cm.parseManifest({ commands }).manifest;
const cmdOf = (over: Record<string, unknown>) =>
  manifestOf([{ name: 'do_thing', action: 'things.do', effect: 'write', mcp: 'do_thing', ...over }]).commands[0];

describe('laneOfCommand — lanes from the manifest, never the model', () => {
  it('derives the lane from reversibility, declared first', () => {
    expect(auto.laneOfCommand(cmdOf({ reversibility: 'contained' }))).toBe(1);
    expect(auto.laneOfCommand(cmdOf({ reversibility: 'wide' }))).toBe(2);
    expect(auto.laneOfCommand(cmdOf({ reversibility: 'none' }))).toBe(3);
    expect(auto.laneOfCommand(cmdOf({}))).toBe(2); // an undeclared write is lane 2
  });

  it('an undeclared critical command is lane 3; a read has no lane', () => {
    expect(auto.laneOfCommand(cmdOf({ name: 'delete_thing', action: 'things.delete' }))).toBe(3);
    expect(auto.laneOfCommand(cmdOf({ name: 'send_thing', action: 'things.send' }))).toBe(3);
    expect(auto.laneOfCommand(cmdOf({ effect: 'read' }))).toBeNull();
  });

  it('the policy numbers live in the one named place', () => {
    expect(auto.AUTONOMY_POLICY.lane1Clean).toBe(5);
    expect(auto.AUTONOMY_POLICY.lane2Clean).toBe(15);
    expect(auto.AUTONOMY_POLICY.lane2VerifyGreen).toBe(5);
    expect(auto.AUTONOMY_POLICY.demotionFactor).toBe(2);
    expect(auto.baseCleanForLane(1)).toBe(5);
    expect(auto.baseCleanForLane(2)).toBe(15);
  });
});

describe('commandNameForTool — a tool name maps back to its command, or to nothing', () => {
  const integration = { id: '12345678-1234-1234-1234-123456789abc', name: 'GitHub' };
  const manifest = manifestOf([
    { name: 'create_issue', action: 'issues.create', effect: 'write', mcp: 'create_issue' },
    { name: 'get_issue', action: 'issues.get', effect: 'read', mcp: 'get_issue' },
  ]);

  it('strips the integration prefix and names the declared command', () => {
    expect(auto.commandNameForTool(integration, 'github_1234__create_issue', manifest)).toBe('create_issue');
  });

  it('sees through a collision suffix', () => {
    expect(auto.commandNameForTool(integration, 'github_1234__create_issue_2', manifest)).toBe('create_issue');
  });

  it('an undeclared remainder maps to nothing — never a guess', () => {
    expect(auto.commandNameForTool(integration, 'github_1234__delete_everything', manifest)).toBeNull();
    expect(auto.commandNameForTool(integration, 'some_other_tool', manifest)).toBeNull();
    expect(auto.commandNameForTool(integration, 'batch', manifest)).toBeNull();
  });
});

// ── The gate: the grant composed over the floors ─────────────────────

const facts = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  isWrite: true, isRead: false,
  manifest: { permission: 'ask', rule: null, critical: null },
  delegation: 'approve_each',
  autonomyGrant: { lane: 1, clean: 5 },
  ...over,
});

describe('grantLiftable / verdictWithAutonomy — the one ask a grant may lift', () => {
  it('lifts the command’s own ask in Auto, and only there', () => {
    expect(pol.grantLiftable(facts())).toBe(true);
    expect(pol.verdictWithAutonomy(facts(), 'auto')).toEqual({ base: 'ask', final: 'allow', lift: 'track-record' });
    expect(pol.verdictWithAutonomy(facts(), 'ask')).toEqual({ base: 'ask', final: 'ask', lift: null });
  });

  it('in Free the grant changes only the record’s attribution', () => {
    expect(pol.verdictWithAutonomy(facts(), 'free')).toEqual({ base: 'ask', final: 'allow', lift: 'track-record' });
    expect(pol.verdictWithAutonomy(facts({ autonomyGrant: null }), 'free')).toEqual({ base: 'ask', final: 'allow', lift: null });
  });

  it('never lifts what delegation already lifts — that ask is the delegation’s', () => {
    const delegated = facts({ delegation: 'full_delegation' });
    expect(pol.approvalVerdict(delegated)).toBe('allow');
    expect(pol.grantLiftable(delegated)).toBe(false);
    expect(pol.verdictWithAutonomy(delegated, 'auto')).toEqual({ base: 'allow', final: 'allow', lift: null });
  });

  it('never lifts a rule-bound ask, an allowed command, or a read', () => {
    expect(pol.grantLiftable(facts({ manifest: { permission: 'ask', rule: 0, critical: null } }))).toBe(false);
    expect(pol.grantLiftable(facts({ manifest: { permission: 'allow', rule: null, critical: null } }))).toBe(false);
    expect(pol.grantLiftable(facts({ isRead: true, isWrite: false }))).toBe(false);
    expect(pol.grantLiftable(facts({ catalogDecision: 'approve' }))).toBe(false);
  });

  it('a granted critical command still asks in every mode — the floor is its own derivation', () => {
    const critical = facts({ manifest: { permission: 'ask', rule: null, critical: 'delete' } });
    expect(pol.grantLiftable(critical)).toBe(false);
    for (const mode of ['auto', 'free'] as const) {
      expect(pol.verdictWithAutonomy(critical, mode).lift).toBeNull();
    }
    expect(pol.verdictWithAutonomy(critical, 'auto').final).toBe('ask');
  });

  it('property: over the whole policy matrix, a grant moves a verdict only where the design allows', () => {
    const permissions = ['allow', 'ask', 'deny'] as const;
    const modes = ['ask', 'auto', 'free'] as const;
    for (const permission of permissions) {
      for (const rule of [null, 0]) {
        for (const critical of [null, 'send'] as const) {
          for (const delegation of ['approve_each', 'full_delegation'] as const) {
            for (const mode of modes) {
              for (const grant of [null, { lane: 1 as const, clean: 9 }]) {
                const f = {
                  isWrite: true, isRead: false,
                  manifest: { permission, rule, critical },
                  delegation, autonomyGrant: grant,
                };
                const plain = pol.applyMode(pol.approvalVerdict(f), f, mode);
                const composed = pol.verdictWithAutonomy(f, mode);
                // The base never moves; the floors never move.
                expect(composed.base).toBe(pol.approvalVerdict(f));
                if (composed.final !== plain) {
                  // The only permitted movement: Auto lifting a
                  // grant-liftable ask, attributed to the record.
                  expect(mode).toBe('auto');
                  expect(plain).toBe('ask');
                  expect(composed.final).toBe('allow');
                  expect(composed.lift).toBe('track-record');
                  expect(pol.grantLiftable(f)).toBe(true);
                }
                if (composed.lift === 'track-record') {
                  expect(pol.grantLiftable(f)).toBe(true);
                  expect(mode).not.toBe('ask');
                }
                // Deny and critical are unreachable by promotion.
                if (permission === 'deny') expect(composed.final).toBe('deny');
                if (critical) expect(composed.lift).toBeNull();
                if (mode === 'ask') expect(composed.lift).toBeNull();
              }
            }
          }
        }
      }
    }
  });
});

// ── The record: events from settled records only ─────────────────────

const INTEG_ID = '12345678-1234-1234-1234-123456789abc';
const MANIFEST_JSON = {
  commands: [
    { name: 'create_issue', action: 'issues.create', effect: 'write', mcp: 'create_issue', reversibility: 'contained' },
    { name: 'update_file', action: 'repos.update_file', effect: 'write', mcp: 'update_file', verify: { command: 'get_file', expect: { content: 'content' } } },
    { name: 'get_file', action: 'repos.get_file', effect: 'read', mcp: 'get_file' },
  ],
};
const INTEG = { id: INTEG_ID, name: 'GitHub', manifest: manifestOf(MANIFEST_JSON.commands) };
const TOOL = 'github_1234__create_issue';
const FILE_TOOL = 'github_1234__update_file';

let aseq = 0;
const actionRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `a${++aseq}`, run_id: 'run1', tool: TOOL, integration_id: INTEG_ID, status: 'executed', decision_source: null,
  decided_at: daysAgo(1), created_at: daysAgo(1), result: null,
  input: { calls: [{ id: 'c1', name: TOOL, input: {} }] },
  ...over,
});
const outcomeRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `o-${String(over.run_id ?? 'run1')}`, run_id: 'run1', activity_space_id: 's1',
  verdict_result: 'pass', human_signal: 'none', signal_source: null, signal_at: null,
  finished_at: daysAgo(1),
  ...over,
});
const eventsOf = (actions: unknown[], outcomes: unknown[]) =>
  auto.commandEventsOf({ actions, outcomes, integrations: [INTEG] });
const recordFor = (actions: unknown[], outcomes: unknown[], tool = TOOL) => {
  const events = eventsOf(actions, outcomes).filter((e: { integrationId: string }) => e.integrationId === INTEG_ID);
  return auto.recordsOf(events).find((r: { action: string }) => r.action === (tool === TOOL ? 'create_issue' : 'update_file'));
};

describe('commandEventsOf — only settled records speak', () => {
  it('a policy approval that landed is a completion, checked by its run’s verdict', () => {
    const events = eventsOf([actionRow({ decision_source: 'policy' })], [outcomeRow()]);
    const completions = events.filter((e: { kind: string }) => e.kind === 'completion');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ action: 'create_issue', checkedPass: true });
  });

  it('a track-record approval counts the same — the source differs, the evidence does not', () => {
    const events = eventsOf([actionRow({ decision_source: 'track-record' })], [outcomeRow()]);
    expect(events.filter((e: { kind: string }) => e.kind === 'completion')).toHaveLength(1);
  });

  it('a run with no outcome record speaks nothing — nothing is settled yet', () => {
    expect(eventsOf([actionRow({ decision_source: 'policy' })], [])).toEqual([]);
    expect(eventsOf([actionRow({ status: 'rejected', decided_at: daysAgo(1) })], [])).toEqual([]);
  });

  it('a person’s rejection is an incident on the command, at the decision time', () => {
    const events = eventsOf(
      [actionRow({ status: 'rejected', decided_at: daysAgo(3) })],
      [outcomeRow()],
    );
    expect(events).toEqual([expect.objectContaining({ kind: 'incident', incidentKind: 'rejection', action: 'create_issue', at: daysAgo(3) })]);
  });

  it('a batch’s per-call verify mismatch is an incident beside its completion', () => {
    const events = eventsOf(
      [actionRow({ result: { failed: 0, total: 1, perCall: [{ id: 'c1', ok: true, verify: { ok: false, diff: [{ field: 'content' }] } }] } })],
      [outcomeRow()],
    );
    expect(events.some((e: { kind: string }) => e.kind === 'completion')).toBe(true);
    expect(events.some((e: { kind: string; incidentKind?: string }) => e.kind === 'incident' && e.incidentKind === 'verify_mismatch')).toBe(true);
  });

  it('a legacy batch with any failure credits nobody — per-call truth unknown', () => {
    const twoCalls = { calls: [{ id: 'c1', name: TOOL, input: {} }, { id: 'c2', name: TOOL, input: {} }] };
    const events = eventsOf(
      [actionRow({ input: twoCalls, result: { failed: 1, total: 2 } })],
      [outcomeRow()],
    );
    expect(events.filter((e: { kind: string }) => e.kind === 'completion')).toEqual([]);
    // A batch in which every call landed credits each call — the
    // aggregate is per-call truth exactly there.
    const whole = eventsOf([actionRow({ input: twoCalls, result: { failed: 0, total: 2 } })], [outcomeRow()]);
    expect(whole.filter((e: { kind: string }) => e.kind === 'completion')).toHaveLength(2);
  });

  it('run-level signals attach to the commands the run used — except approval rejections, which the rows carry', () => {
    const failed = eventsOf([actionRow({ decision_source: 'policy' })], [outcomeRow({ verdict_result: 'fail' })]);
    expect(failed.some((e: { incidentKind?: string }) => e.incidentKind === 'verdict_fail')).toBe(true);
    const reopened = eventsOf(
      [actionRow({ decision_source: 'policy' })],
      [outcomeRow({ human_signal: 'rework', signal_source: 'reopen', signal_at: daysAgo(0) })],
    );
    expect(reopened.some((e: { incidentKind?: string }) => e.incidentKind === 'reopen')).toBe(true);
    const rolledBack = eventsOf(
      [actionRow({ decision_source: 'policy' })],
      [outcomeRow({ human_signal: 'rejected', signal_source: 'rollback', signal_at: daysAgo(0) })],
    );
    expect(rolledBack.some((e: { incidentKind?: string }) => e.incidentKind === 'rollback')).toBe(true);
    const approvalRejection = eventsOf(
      [actionRow({ decision_source: 'policy' })],
      [outcomeRow({ human_signal: 'rejected', signal_source: 'approval', signal_at: daysAgo(0) })],
    );
    expect(approvalRejection.filter((e: { kind: string }) => e.kind === 'incident')).toEqual([]);
  });
});

describe('recordOf — streaks over the events, newest first', () => {
  const completions = (n: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => actionRow({ id: `p${i}`, run_id: `run${i}`, decision_source: 'policy' }));
  const outcomesFor = (n: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => outcomeRow({ run_id: `run${i}`, finished_at: daysAgo(n - i) }));

  it('counts a clean streak of settled completions', () => {
    const record = recordFor(completions(5), outcomesFor(5));
    expect(record).toMatchObject({ cleanStreak: 5, cleanCompletions: 5, checkedInStreak: 5, incidents: 0 });
  });

  it('an incident stops the streak where it stands', () => {
    const actions = [
      ...completions(3),
      actionRow({ id: 'bad', run_id: 'runX', status: 'rejected', decided_at: daysAgo(0) }),
    ];
    const outcomes = [...outcomesFor(3), outcomeRow({ run_id: 'runX', finished_at: daysAgo(0) })];
    const record = recordFor(actions, outcomes);
    expect(record.cleanStreak).toBe(0);
    expect(record.incidents).toBe(1);
    expect(record.lastDemotion).toMatchObject({ kind: 'rejection' });
  });

  it('a failed execution is not clean either — as the newest event it zeroes the streak', () => {
    const actions = [
      actionRow({ id: 'f', run_id: 'runF', decision_source: 'policy', status: 'failed' }),
      ...completions(2),
    ];
    const outcomes = [outcomeRow({ run_id: 'runF', finished_at: daysAgo(0) }), ...outcomesFor(2)];
    const record = recordFor(actions, outcomes);
    expect(record.cleanStreak).toBe(0);
    expect(record.cleanCompletions).toBe(2);
  });
});

describe('promotionOf — the thresholds, at their boundaries', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    cleanStreak: 0, checkedInStreak: 0, verifyGreenStreak: 0, incidents: 0, ...over,
  });

  it('lane 1 earns at exactly 5 clean, with at least half checked', () => {
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 5, checkedInStreak: 3 }), grant: null }).eligible).toBe(true);
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 4, checkedInStreak: 4 }), grant: null }).eligible).toBe(false);
    // Volume without verification earns nothing: 5 clean, only 2 checked.
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 5, checkedInStreak: 2 }), grant: null }).eligible).toBe(false);
  });

  it('lane 2 earns at exactly 15 clean plus 5 green verify read-backs on a declared verify', () => {
    const base = record({ cleanStreak: 15, checkedInStreak: 8, verifyGreenStreak: 5 });
    expect(auto.promotionOf({ lane: 2, hasVerify: true, record: base, grant: null }).eligible).toBe(true);
    expect(auto.promotionOf({ lane: 2, hasVerify: false, record: base, grant: null }).eligible).toBe(false);
    expect(auto.promotionOf({ lane: 2, hasVerify: true, record: record({ ...base, verifyGreenStreak: 4 }), grant: null }).eligible).toBe(false);
    expect(auto.promotionOf({ lane: 2, hasVerify: true, record: record({ ...base, cleanStreak: 14, checkedInStreak: 14 }), grant: null }).eligible).toBe(false);
  });

  it('any incident in the window blocks promotion; lane 3 never promotes', () => {
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 9, checkedInStreak: 9, incidents: 1 }), grant: null }).eligible).toBe(false);
    expect(auto.promotionOf({ lane: 3, hasVerify: true, record: record({ cleanStreak: 99, checkedInStreak: 99, verifyGreenStreak: 99 }), grant: null }).eligible).toBe(false);
    expect(auto.promotionOf({ lane: null, hasVerify: false, record: record({ cleanStreak: 99, checkedInStreak: 99 }), grant: null }).eligible).toBe(false);
  });

  it('after an incident the requirement doubles, off the grant row that carries it', () => {
    const demoted = { requiredClean: 10 };
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 9, checkedInStreak: 9 }), grant: demoted }))
      .toEqual({ eligible: false, requiredClean: 10 });
    expect(auto.promotionOf({ lane: 1, hasVerify: false, record: record({ cleanStreak: 10, checkedInStreak: 5 }), grant: demoted }).eligible).toBe(true);
  });

  it('the basis a grant stands on carries the counts that earned it', () => {
    expect(auto.basisOf(record({ cleanStreak: 7, checkedInStreak: 4, verifyGreenStreak: 2, incidents: 0 }), 5))
      .toEqual({ cleanStreak: 7, checkedInStreak: 4, verifyGreenStreak: 2, incidents: 0, requiredClean: 5, windowDays: 28 });
  });
});

// ── The evaluator and the synchronous revocation, over a store ───────

type Row = Record<string, unknown>;
interface Store {
  run_outcomes: Row[]; agent_actions: Row[]; integrations: Row[];
  autonomy_grants: Row[]; autonomy_changes: Row[]; command_track_records: Row[];
}

type Filter = { col: string; op: 'eq' | 'in' | 'gte' | 'lt'; val?: unknown };
const matches = (row: Row, f: Filter): boolean => {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return v === f.val;
    case 'in': return (f.val as unknown[]).includes(v as never);
    case 'gte': return typeof v === 'string' && typeof f.val === 'string' && v >= f.val;
    case 'lt': return typeof v === 'string' && typeof f.val === 'string' && v < f.val;
  }
};

function fakeAdmin(store: Store) {
  let gen = 0;
  const from = (table: keyof Store) => {
    const rows = store[table];
    let op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let conflictKeys: string[] = [];
    const filters: Filter[] = [];
    const orders: { col: string; ascending: boolean }[] = [];
    let limitN: number | null = null;
    const applyFilters = (list: Row[]) => list.filter((r) => filters.every((f) => matches(r, f)));
    const run = (): { data: unknown; error: unknown } => {
      if (op === 'select') {
        let out = applyFilters([...rows]);
        for (const o of orders) out.sort((a, b) => String(a[o.col] ?? '').localeCompare(String(b[o.col] ?? '')) * (o.ascending ? 1 : -1));
        if (limitN !== null) out = out.slice(0, limitN);
        return { data: out, error: null };
      }
      if (op === 'upsert') {
        for (const row of payload as Row[]) {
          const at = rows.findIndex((r) => conflictKeys.every((k) => r[k] === row[k]));
          if (at >= 0) rows[at] = { ...rows[at], ...row };
          else rows.push({ id: `gen${++gen}`, ...row });
        }
        return { data: null, error: null };
      }
      if (op === 'insert') {
        rows.push({ id: `gen${++gen}`, created_at: daysAgo(0), updated_at: daysAgo(0), ...payload as Row });
        return { data: null, error: null };
      }
      if (op === 'update') {
        const hit = applyFilters(rows);
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit[0] ?? null, error: null };
      }
      const kept = rows.filter((r) => !filters.every((f) => matches(r, f)));
      rows.length = 0; rows.push(...kept);
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      in: (col: string, val: unknown) => { filters.push({ col, op: 'in', val }); return q; },
      gte: (col: string, val: unknown) => { filters.push({ col, op: 'gte', val }); return q; },
      lt: (col: string, val: unknown) => { filters.push({ col, op: 'lt', val }); return q; },
      eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return q; },
      order: (col: string, o: { ascending: boolean }) => { orders.push({ col, ascending: o.ascending }); return q; },
      limit: (n: number) => { limitN = n; return q; },
      upsert: (r: Row[], opts: { onConflict: string }) => { op = 'upsert'; payload = r; conflictKeys = opts.onConflict.split(','); return q; },
      insert: (r: Row) => { op = 'insert'; payload = r; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: () => { const d = run().data; return Promise.resolve({ data: Array.isArray(d) ? (d[0] ?? null) : d, error: null }); },
      single: () => { const d = run().data; return Promise.resolve({ data: Array.isArray(d) ? d[0] : d, error: null }); },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from };
}

const emptyStore = (): Store => ({
  run_outcomes: [], agent_actions: [],
  integrations: [{ id: INTEG_ID, activity_space_id: 's1', name: 'GitHub', manifest: MANIFEST_JSON }],
  autonomy_grants: [], autonomy_changes: [], command_track_records: [],
});

/** n settled policy-approved runs of one tool, all verdict-passed. */
const seedCleanRuns = (store: Store, n: number, tool: string, over: { verify?: boolean } = {}) => {
  for (let i = 0; i < n; i++) {
    const runId = `${tool}-run${i}`;
    store.run_outcomes.push(outcomeRow({ run_id: runId, finished_at: daysAgo(n - i) }));
    store.agent_actions.push(actionRow({
      id: `${tool}-a${i}`, run_id: runId, tool, decision_source: 'policy',
      input: { calls: [{ id: 'c1', name: tool, input: {} }] },
      ...(over.verify ? { result: { verify: { ok: true } } } : {}),
    }));
  }
};

describe('evaluateAutonomy — promotion and demotion over the records', () => {
  it('promotes a lane-1 command at its threshold, exactly once', async () => {
    const store = emptyStore();
    seedCleanRuns(store, 5, TOOL);
    const admin = fakeAdmin(store);
    const first = await auto.evaluateAutonomy(admin, NOW);
    expect(first).toMatchObject({ records: 1, promoted: 1, demoted: 0 });
    const grant = store.autonomy_grants.find((g) => g.action === 'create_issue');
    expect(grant).toMatchObject({ level: 'auto', lane: 1, granted_by: 'system', pinned: false });
    expect((grant?.basis as { cleanStreak: number }).cleanStreak).toBe(5);
    expect(store.autonomy_changes).toHaveLength(1);
    expect(store.autonomy_changes[0]).toMatchObject({ cause: 'promotion', to_level: 'auto', action: 'create_issue' });
    expect(store.command_track_records).toHaveLength(1);
    // A second pass over the same world writes nothing new.
    const second = await auto.evaluateAutonomy(admin, NOW);
    expect(second).toMatchObject({ promoted: 0, demoted: 0 });
    expect(store.autonomy_changes).toHaveLength(1);
    expect(store.autonomy_grants).toHaveLength(1);
  });

  it('lane 2 waits for its full threshold: 14 clean is not 15', async () => {
    const store = emptyStore();
    seedCleanRuns(store, 14, FILE_TOOL, { verify: true });
    const admin = fakeAdmin(store);
    expect((await auto.evaluateAutonomy(admin, NOW)).promoted).toBe(0);
    // The fifteenth clean, checked run lands.
    store.run_outcomes.push(outcomeRow({ run_id: 'file-run-extra', finished_at: daysAgo(0) }));
    store.agent_actions.push(actionRow({
      id: 'file-a-extra', run_id: 'file-run-extra', tool: FILE_TOOL, decision_source: 'policy',
      input: { calls: [{ id: 'c1', name: FILE_TOOL, input: {} }] },
      result: { verify: { ok: true } },
    }));
    const r = await auto.evaluateAutonomy(admin, NOW);
    expect(r.promoted).toBe(1);
    expect(store.autonomy_grants.find((g) => g.action === 'update_file')).toMatchObject({ level: 'auto', lane: 2 });
  });

  it('sweeps a record-only incident (a reopen) into a demotion with the doubled requirement', async () => {
    const store = emptyStore();
    seedCleanRuns(store, 5, TOOL);
    const admin = fakeAdmin(store);
    await auto.evaluateAutonomy(admin, NOW);
    expect(store.autonomy_grants[0].level).toBe('auto');
    // A later run of the same command is sent back by a person.
    store.run_outcomes.push(outcomeRow({
      run_id: 'run-back', finished_at: daysAgo(0),
      human_signal: 'rework', signal_source: 'reopen', signal_at: daysAgo(0),
    }));
    store.agent_actions.push(actionRow({ id: 'a-back', run_id: 'run-back', decision_source: 'policy' }));
    const r = await auto.evaluateAutonomy(admin, NOW);
    expect(r.demoted).toBe(1);
    expect(store.autonomy_grants[0]).toMatchObject({ level: 'ask', required_clean: 10, last_incident_kind: 'reopen' });
    expect(store.autonomy_changes.map((c) => c.cause)).toEqual(['promotion', 'demotion']);
  });

  it('a pinned grant never moves, in either direction', async () => {
    const store = emptyStore();
    seedCleanRuns(store, 5, TOOL);
    store.run_outcomes.push(outcomeRow({
      run_id: 'run-back', finished_at: daysAgo(0),
      human_signal: 'rework', signal_source: 'reopen', signal_at: daysAgo(0),
    }));
    store.agent_actions.push(actionRow({ id: 'a-back', run_id: 'run-back', decision_source: 'policy' }));
    store.autonomy_grants.push({
      id: 'g-pin', activity_space_id: 's1', integration_id: INTEG_ID, action: 'create_issue',
      lane: 1, level: 'auto', basis: {}, granted_by: 'owner', pinned: true, required_clean: 0,
      last_incident_at: null, last_incident_kind: null,
    });
    const r = await auto.evaluateAutonomy(fakeAdmin(store), NOW);
    expect(r).toMatchObject({ promoted: 0, demoted: 0 });
    expect(store.autonomy_grants[0]).toMatchObject({ level: 'auto', pinned: true });
    expect(store.autonomy_changes).toEqual([]);
  });

  it('a quiet world writes nothing', async () => {
    const store = emptyStore();
    const r = await auto.evaluateAutonomy(fakeAdmin(store), NOW);
    expect(r).toEqual({ records: 0, promoted: 0, demoted: 0 });
    expect(store.command_track_records).toEqual([]);
  });
});

describe('revokeAutonomyForIncident — demotion on the incident path itself', () => {
  const grantRow = (over: Row = {}): Row => ({
    id: 'g1', activity_space_id: 's1', integration_id: INTEG_ID, action: 'create_issue',
    lane: 1, level: 'auto', basis: { cleanStreak: 6 }, granted_by: 'system', pinned: false,
    required_clean: 0, last_incident_at: null, last_incident_kind: null, ...over,
  });

  it('revokes a standing grant in the same call, doubling the road back', async () => {
    const store = emptyStore();
    store.autonomy_grants.push(grantRow());
    const outcome = await auto.revokeAutonomyForIncident(fakeAdmin(store), {
      spaceId: 's1', integrationId: INTEG_ID, action: 'create_issue', kind: 'rejection', runId: 'run9',
    });
    expect(outcome).toBe('revoked');
    expect(store.autonomy_grants[0]).toMatchObject({ level: 'ask', required_clean: 10, last_incident_kind: 'rejection' });
    expect(store.autonomy_changes).toHaveLength(1);
    expect(store.autonomy_changes[0]).toMatchObject({ cause: 'demotion', from_level: 'auto', to_level: 'ask' });
    expect((store.autonomy_changes[0].detail as { incident: string }).incident).toBe('rejection');
  });

  it('a verify mismatch revokes the same way', async () => {
    const store = emptyStore();
    store.autonomy_grants.push(grantRow({ lane: 2 }));
    const outcome = await auto.revokeAutonomyForIncident(fakeAdmin(store), {
      spaceId: 's1', integrationId: INTEG_ID, action: 'create_issue', kind: 'verify_mismatch',
    });
    expect(outcome).toBe('revoked');
    expect(store.autonomy_grants[0]).toMatchObject({ level: 'ask', required_clean: 30, last_incident_kind: 'verify_mismatch' });
  });

  it('never moves a pinned grant, and says so', async () => {
    const store = emptyStore();
    store.autonomy_grants.push(grantRow({ pinned: true, granted_by: 'owner' }));
    const outcome = await auto.revokeAutonomyForIncident(fakeAdmin(store), {
      spaceId: 's1', integrationId: INTEG_ID, action: 'create_issue', kind: 'rejection',
    });
    expect(outcome).toBe('pinned');
    expect(store.autonomy_grants[0].level).toBe('auto');
    expect(store.autonomy_changes).toEqual([]);
  });

  it('no grant, or none standing at auto, is a quiet no-op', async () => {
    const store = emptyStore();
    expect(await auto.revokeAutonomyForIncident(fakeAdmin(store), {
      spaceId: 's1', integrationId: INTEG_ID, action: 'create_issue', kind: 'rejection',
    })).toBe('no_grant');
    store.autonomy_grants.push(grantRow({ level: 'ask' }));
    expect(await auto.revokeAutonomyForIncident(fakeAdmin(store), {
      spaceId: 's1', integrationId: INTEG_ID, action: 'create_issue', kind: 'rejection',
    })).toBe('not_auto');
    expect(store.autonomy_changes).toEqual([]);
  });
});

// ── The web surface: lanes, lines, pins ──────────────────────────────

describe('laneOfManifestCommand — the settings mirror of the lane derivation', () => {
  it('agrees with the engine on the same commands', () => {
    const cases: Record<string, unknown>[] = [
      { reversibility: 'contained' },
      { reversibility: 'wide' },
      { reversibility: 'none' },
      {},
      { name: 'delete_thing', action: 'things.delete' },
      { name: 'send_thing', action: 'things.send' },
      { effect: 'read' },
    ];
    for (const over of cases) {
      const web = laneOfManifestCommand({ name: 'do_thing', action: 'things.do', effect: 'write', ...over });
      const engine = auto.laneOfCommand(cmdOf(over));
      expect(web).toBe(engine);
    }
  });
});

describe('autonomyLineFor — the one line a person judges by', () => {
  const grant = (over: Partial<AutonomyGrant> = {}): AutonomyGrant => ({
    id: 'g1', activity_space_id: 's1', integration_id: INTEG_ID, action: 'create_issue',
    lane: 1, level: 'ask', basis: {}, granted_by: 'system', pinned: false, required_clean: 0,
    last_incident_at: null, last_incident_kind: null, created_at: daysAgo(2), updated_at: daysAgo(1),
    ...over,
  });
  const record = (over: Partial<CommandTrackRecord> = {}): CommandTrackRecord => ({
    id: 'r1', activity_space_id: 's1', integration_id: INTEG_ID, action: 'create_issue',
    window_start: daysAgo(28), window_days: 28, clean_completions: 0, checked_passes: 0,
    clean_streak: 0, checked_in_streak: 0, verify_checked: 0, verify_ok: 0, verify_green_streak: 0,
    incidents: 0, last_incident_at: null, updated_at: daysAgo(0),
    ...over,
  });

  it('an earned auto names its count', () => {
    expect(autonomyLineFor(grant({ level: 'auto', basis: { cleanStreak: 15 } }), null))
      .toEqual({ kind: 'earned', clean: 15 });
  });

  it('a stopped grant names what stopped it', () => {
    expect(autonomyLineFor(grant({ last_incident_kind: 'rejection' }), null))
      .toEqual({ kind: 'stopped', cause: 'rejection' });
    expect(autonomyLineFor(grant({ last_incident_kind: 'verify_mismatch' }), record({ clean_streak: 2 })))
      .toEqual({ kind: 'stopped', cause: 'verify_mismatch' });
  });

  it('a pin speaks first — it is the owner’s word', () => {
    expect(autonomyLineFor(grant({ pinned: true, level: 'auto', granted_by: 'owner' }), null)).toEqual({ kind: 'pinned-auto' });
    expect(autonomyLineFor(grant({ pinned: true, level: 'ask', granted_by: 'owner', last_incident_kind: 'rejection' }), null))
      .toEqual({ kind: 'pinned-ask' });
  });

  it('a record in progress shows its streak; silence shows nothing', () => {
    expect(autonomyLineFor(null, record({ clean_streak: 3 }))).toEqual({ kind: 'building', clean: 3 });
    expect(autonomyLineFor(null, record())).toBeNull();
    expect(autonomyLineFor(null, null)).toBeNull();
    expect(autonomyLineFor(grant(), null)).toBeNull();
  });
});

describe('pinChoicesFor — the controls never offer what cannot stand', () => {
  const grant = (over: Partial<AutonomyGrant> = {}): AutonomyGrant => ({
    id: 'g1', activity_space_id: 's1', integration_id: INTEG_ID, action: 'create_issue',
    lane: 1, level: 'ask', basis: {}, granted_by: 'system', pinned: false, required_clean: 0,
    last_incident_at: null, last_incident_kind: null, created_at: daysAgo(2), updated_at: daysAgo(1),
    ...over,
  });

  it('offers both pins on a lane-1/2 command, only ask on lane 3 or a critical command', () => {
    expect(pinChoicesFor(null, 1)).toEqual(['ask', 'auto']);
    expect(pinChoicesFor(null, 2)).toEqual(['ask', 'auto']);
    expect(pinChoicesFor(null, 3)).toEqual(['ask']);
    expect(pinChoicesFor(null, 1, true)).toEqual(['ask']);
  });

  it('a pinned grant offers only unpin; a read offers nothing', () => {
    expect(pinChoicesFor(grant({ pinned: true, level: 'auto' }), 1)).toEqual(['unpin']);
    expect(pinChoicesFor(null, null)).toEqual([]);
  });
});
