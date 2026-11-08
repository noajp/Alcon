import { describe, expect, it } from 'vitest';

// The Copilot session's shared pieces: the kept conversation's shapes
// (copilotSession.ts, pure) and the decision path Athena's chat driver
// shares with the Element paths (run-agent/decision.ts, exercised
// against a fake service-role client).
const session = await import(new URL('../../supabase/functions/_shared/copilotSession.ts', import.meta.url).pathname);
const decision = await import(new URL('../../supabase/functions/run-agent/decision.ts', import.meta.url).pathname);
const anchorMod = await import(new URL('../../supabase/functions/_shared/copilotAnchor.ts', import.meta.url).pathname);
const turnMod = await import(new URL('../../supabase/functions/_shared/copilotTurn.ts', import.meta.url).pathname);

describe("copilot turn assembly (Athena's chat driver)", () => {
  it('builds the prompt with the context hint and no toolset outside a Space', async () => {
    const turn = await turnMod.buildCopilotTurn({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userDb: {} as any, admin: null,
      context: { viewLabel: 'ボード', today: '2026-11-08' },
      supabaseUrl: null, actor: { agent: 'Alcon Copilot', userId: 'u1' },
    });
    expect(turn.toolset).toBeNull();
    expect(turn.system[0].text).toContain('Alcon');
    expect(turn.system[1].text).toContain('現在のビュー: ボード');
    expect(turn.system[1].text).toContain('ユーザーの業務日付: 2026-11-08');
    expect(turn.toolParams.length).toBeGreaterThan(0);
    // Without an integration toolset nothing needs approval and every
    // tool is the board's own kind.
    expect(turn.needsApproval({ id: 'x', name: 'anything', input: {} })).toBe(false);
    expect(turn.kindOf('anything')).toBe('board');
  });

  it('names the Copilot as its steps and notifications sign', () => {
    expect(anchorMod.COPILOT_AGENT_NAME).toBe('Alcon Copilot');
  });

  it('carries the approval mode it was built under, defaulting to auto', async () => {
    const plain = await turnMod.buildCopilotTurn({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userDb: {} as any, admin: null,
      context: { viewLabel: 'ボード', today: '2026-11-08' },
      supabaseUrl: null, actor: { agent: 'Alcon Copilot', userId: 'u1' },
    });
    expect(plain.approvalMode).toBe('auto');
    // Without an integration toolset there is no verdict to give: the
    // catalog's own tools are the entry policy's alone.
    expect(plain.verdictOf({ id: 'x', name: 'anything', input: {} })).toBeNull();

    const freed = await turnMod.buildCopilotTurn({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userDb: {} as any, admin: null,
      context: { viewLabel: 'ボード', today: '2026-11-08' },
      supabaseUrl: null, actor: { agent: 'Alcon Copilot', userId: 'u1' },
      approvalMode: 'free',
    });
    expect(freed.approvalMode).toBe('free');
    expect(freed.needsApproval({ id: 'x', name: 'anything', input: {} })).toBe(false);
  });
});

type Block = Record<string, unknown>;
const call = (id: string, name = 'ext__send') => ({ id, name, input: { to: 'a@example.com' } });

describe('copilot approval expiry', () => {
  it('lapses exactly seven days after it was asked', () => {
    const from = new Date('2026-11-08T00:00:00.000Z');
    expect(session.COPILOT_APPROVAL_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(session.copilotApprovalExpiresAt(from)).toBe('2026-11-15T00:00:00.000Z');
  });

  it('answers an expired batch with an error result per call, saying why', () => {
    const results = session.expiredApprovalResults([call('c1'), call('c2')]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1', is_error: true });
    expect(results[0].content).toContain('7日');
    expect(results[1].tool_use_id).toBe('c2');
  });
});

describe('kept conversation updates', () => {
  const messages = () => ([
    { role: 'user', content: '送って' },
    {
      role: 'assistant', content: '', done: true,
      approvals: [
        { calls: [call('c1')], inputHash: 'h1', status: 'pending', runId: 'r1', actionId: 'a1' },
        { calls: [call('c2')], inputHash: 'h2', status: 'pending', runId: 'r1', actionId: 'a2' },
      ],
    },
  ]);

  it('writes the decision onto its own card only', () => {
    const before = messages();
    const after = session.withApprovalDecision(before, 'a2', {
      status: 'executed', results: [{ name: 'ext__send', ok: true, content: 'done' }],
    });
    expect(after[0]).toBe(before[0]);
    const cards = (after[1] as { approvals: { actionId: string; status: string }[] }).approvals;
    expect(cards[0].status).toBe('pending');
    expect(cards[1].status).toBe('executed');
    expect((after[1] as { approvals: { results?: unknown }[] }).approvals[1].results).toEqual([{ name: 'ext__send', ok: true, content: 'done' }]);
  });

  it('leaves messages without the card untouched', () => {
    const before = messages();
    const after = session.withApprovalDecision(before, 'missing', { status: 'denied' });
    expect(after[1]).toBe(before[1]);
  });

  it('shapes a resumed turn like a panel assistant message', () => {
    const plain = session.resumedAssistantMessage({ text: '終わりました' });
    expect(plain).toEqual({ role: 'assistant', content: '終わりました', done: true });
    const withCard = session.resumedAssistantMessage({
      text: '途中経過',
      toolEvents: [{ name: 'listElements', result: { ok: true, rows: 3 } }],
      approval: { calls: [call('c9')], inputHash: 'h9', status: 'pending', runId: 'r1', actionId: 'a9' },
    });
    expect(withCard.toolEvents).toHaveLength(1);
    expect(withCard.approvals?.[0].actionId).toBe('a9');
  });
});

// A chainable fake for the two tables applyDecision touches. Updates are
// recorded; the action lookup answers the one pending row.
function fakeAdmin(action: Record<string, unknown> | null) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const chain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      update: (patch: Record<string, unknown>) => { updates.push({ table, patch }); return c; },
      maybeSingle: async () => ({ data: action }),
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    };
    return c;
  };
  return { admin: { from: (table: string) => chain(table) }, updates };
}

function harness(action: Record<string, unknown> | null, executeApproved?: (c: { id: string }) => Promise<{ content: string; is_error?: boolean }>) {
  const { admin, updates } = fakeAdmin(action);
  const steps: string[] = [];
  const saved: unknown[] = [];
  let continuations = 0;
  const deps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin: admin as any,
    runId: 'run-1',
    userId: 'user-1',
    addStep: async (_t: string, title: string) => { steps.push(title); },
    saveTranscript: async (p?: unknown) => { saved.push(p ?? null); },
    executeApproved: executeApproved ?? (async (c: { id: string }) => ({ content: `ran ${c.id}` })),
    scheduleContinuation: async () => { continuations += 1; },
    deadline: Date.now() + 60_000,
  };
  return { deps, updates, steps, saved, continuations: () => continuations };
}

const pendingTurn = (): {
  calls: ReturnType<typeof call>[];
  state: { messages: { role: string; content: unknown }[]; turns: number; nudges: number; revisions: number };
} => ({
  calls: [call('c1'), call('c2')],
  // The loop's state: the assistant's tool_use turn waiting for results.
  state: {
    messages: [
      { role: 'user', content: '送って' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'ext__send', input: {} }, { type: 'tool_use', id: 'c2', name: 'ext__send', input: {} }] },
    ],
    turns: 1, nudges: 0, revisions: 0,
  },
});

describe('applyDecision (shared by execute and the Copilot resume)', () => {
  it('approving runs the whole batch, settles the action and appends the results', async () => {
    const h = harness({ id: 'a1', status: 'pending' });
    const { calls, state } = pendingTurn();
    const out = await decision.applyDecision(state, { calls, partial: [] }, { actionId: 'a1', approve: true }, h.deps);
    expect(out.continued).toBe(false);
    expect(out.pending).toBeUndefined();
    expect(out.decided).toMatchObject({ approved: true });
    expect(out.decided?.results.map((r: { content: string }) => r.content)).toEqual(['ran c1', 'ran c2']);
    expect(h.updates.map((u) => u.patch.status)).toEqual(['approved', 'executed']);
    const last = state.messages[state.messages.length - 1] as { role: string; content: Block[] };
    expect(last.role).toBe('user');
    expect(last.content).toHaveLength(2);
  });

  it('a failed call marks the batch executed unless every call failed', async () => {
    const h = harness({ id: 'a1', status: 'pending' });
    const { calls, state } = pendingTurn();
    const out = await decision.applyDecision(state, { calls, partial: [] }, { actionId: 'a1', approve: true }, {
      ...h.deps,
      executeApproved: async (c: { id: string }) => (c.id === 'c1' ? { content: 'boom', is_error: true } : { content: 'ok' }),
    });
    expect(out.decided?.results.filter((r: { is_error?: boolean }) => r.is_error)).toHaveLength(1);
    expect(h.updates[h.updates.length - 1].patch.status).toBe('executed');
  });

  it('rejecting runs nothing and answers the turn with the refusal', async () => {
    const h = harness({ id: 'a1', status: 'pending' });
    const { calls, state } = pendingTurn();
    let ran = 0;
    const out = await decision.applyDecision(state, { calls, partial: [] }, { actionId: 'a1', approve: false, note: '宛先が違う' }, {
      ...h.deps,
      executeApproved: async () => { ran += 1; return { content: 'x' }; },
    });
    expect(ran).toBe(0);
    expect(out.decided).toMatchObject({ approved: false });
    expect(h.updates[0].patch).toMatchObject({ status: 'rejected', decision_note: '宛先が違う' });
    const results = out.decided?.results ?? [];
    expect(results[0].content).toContain('宛先が違う');
  });

  it('refuses a decision for an action that is no longer pending', async () => {
    const h = harness({ id: 'a1', status: 'executed' });
    const { calls, state } = pendingTurn();
    await expect(decision.applyDecision(state, { calls, partial: [] }, { actionId: 'a1', approve: true }, h.deps))
      .rejects.toThrow('もう処理されています');
  });

  it('a slice out of time mid-batch hands the rest to a continuation', async () => {
    const h = harness({ id: 'a1', status: 'pending' });
    const { calls, state } = pendingTurn();
    const out = await decision.applyDecision(state, { calls, partial: [], approved: true, results: [] }, undefined, { ...h.deps, deadline: Date.now() - 1 });
    expect(out.continued).toBe(true);
    expect(h.continuations()).toBe(1);
    expect(out.pending?.calls).toHaveLength(2);
  });

  it('an unanswered pending passes through untouched', async () => {
    const h = harness(null);
    const { calls, state } = pendingTurn();
    const p = { calls, partial: [] };
    const out = await decision.applyDecision(state, p, undefined, h.deps);
    expect(out).toEqual({ pending: p, continued: false });
    expect(h.updates).toHaveLength(0);
  });
});
