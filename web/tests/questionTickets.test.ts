import { describe, expect, it } from 'vitest';

const qt = await import(new URL('../../supabase/functions/_shared/questionTickets.ts', import.meta.url).pathname);
const loop = await import(new URL('../../supabase/functions/_shared/agentLoop.ts', import.meta.url).pathname);
const dispatch = await import(new URL('../../supabase/functions/run-agent/dispatch.ts', import.meta.url).pathname);
import { questionTicketView } from '@/Function/shared/questionTicketModel';

// Async question tickets (back-half B12): the ticket's shape is
// judged by code before anything is filed (a question, what the
// agent tried first, well-formed options); a person's answer is
// judged against the ticket it answers and delivered verbatim;
// the loop rests a run on its filed questions — one rest for a
// turn's questions, never mixed with an approval wait — and the
// answer resumes the paused turn as the question calls' results,
// in the single user message that follows the turn.

describe('validateAskInput (what code judges before a ticket is filed)', () => {
  it('accepts a question with what was tried, options and context', () => {
    const v = qt.validateAskInput({
      question: '  予算の上限は税込ですか？ ',
      tried: '過去の Element と表を確認したが、記載がなかった',
      options: [{ label: '税込', recommended: true }, { label: '税別' }],
      context: { decision: '見積もりの総額が決まります', links: [{ label: '見積もり案', url: 'https://example.com/q' }] },
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.question).toBe('予算の上限は税込ですか？');
    expect(v.value.options).toEqual([{ label: '税込', recommended: true }, { label: '税別' }]);
    expect(v.value.context.decision).toBe('見積もりの総額が決まります');
    expect(v.value.context.links).toEqual([{ label: '見積もり案', url: 'https://example.com/q' }]);
  });

  it('refuses a question with nothing tried first — the weak gate, checked by code', () => {
    expect(qt.validateAskInput({ question: 'どれですか？' }).ok).toBe(false);
    expect(qt.validateAskInput({ question: 'どれですか？', tried: '   ' }).ok).toBe(false);
  });

  it('refuses a missing question', () => {
    expect(qt.validateAskInput({ tried: '調べた' }).ok).toBe(false);
    expect(qt.validateAskInput({ question: ' ', tried: '調べた' }).ok).toBe(false);
  });

  it('judges the options: 2–5, distinct, at most one recommendation', () => {
    const base = { question: 'q', tried: 't' };
    expect(qt.validateAskInput({ ...base, options: [{ label: 'a' }] }).ok).toBe(false);
    expect(qt.validateAskInput({ ...base, options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `o${n}` })) }).ok).toBe(false);
    expect(qt.validateAskInput({ ...base, options: [{ label: 'A' }, { label: 'a' }] }).ok).toBe(false);
    expect(qt.validateAskInput({ ...base, options: [{ label: 'a', recommended: true }, { label: 'b', recommended: true }] }).ok).toBe(false);
    // No options at all is a free-form question, and stands.
    expect(qt.validateAskInput({ ...base }).ok).toBe(true);
  });
});

describe('the dedup identity and the short form', () => {
  it('the same words, spaced or cased differently, are the same question', () => {
    expect(qt.questionKeyOf('  予算は 税込ですか？ ')).toBe(qt.questionKeyOf('予算は 税込ですか？'));
    expect(qt.questionKeyOf('Which One?')).toBe(qt.questionKeyOf('which one?'));
    expect(qt.questionKeyOf('a  b')).toBe(qt.questionKeyOf('a b'));
  });

  it('the short form is the first line, capped', () => {
    expect(qt.questionShortForm('一行目\n二行目')).toBe('一行目');
    const long = qt.questionShortForm('あ'.repeat(300));
    expect(long.length).toBe(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('the resting summary names the first question and counts the rest — none lost', () => {
    expect(qt.restingSummaryFor([{ question: 'Aですか？' }, { question: 'Bですか？' }]))
      .toBe('Aですか？（ほか 1 件の質問）');
    expect(qt.restingSummaryFor([{ question: 'Aですか？' }])).toBe('Aですか？');
  });

  it('an expiry preserves every unanswered question verbatim', () => {
    const body = qt.expiredCommentFor([
      { question: '予算は税込ですか？', options: [{ label: '税込' }, { label: '税別' }] },
      { question: '納期は月末でよいですか？', options: [] },
    ]);
    expect(body).toContain('対応が必要です');
    expect(body).toContain('予算は税込ですか？');
    expect(body).toContain('選択肢: 税込 / 税別');
    expect(body).toContain('納期は月末でよいですか？');
    expect(qt.expiredSummaryFor([{ question: 'Aですか？' }])).toContain('Aですか？');
  });

  it('the expiry is seven days out, matching the draft lifetimes', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(qt.questionExpiresAt(now)).toBe('2026-11-16T00:00:00.000Z');
    expect(qt.QUESTION_POLICY.expiryDays).toBe(7);
  });
});

describe('validateTicketAnswer (the person’s words, judged against the ticket)', () => {
  const ticket = { options: [{ label: '税込', recommended: true }, { label: '税別' }] };

  it('an option answer stands as the stored label, verbatim', () => {
    expect(qt.validateTicketAnswer(ticket, { option: '税込' })).toEqual({ ok: true, answer: '税込' });
  });

  it('an answer the ticket never offered is refused', () => {
    expect(qt.validateTicketAnswer(ticket, { option: 'どちらでも' }).ok).toBe(false);
  });

  it('free text is the exception path — the person’s words, trimmed of transport whitespace only', () => {
    expect(qt.validateTicketAnswer(ticket, { text: '  どちらでもない。個別に聞いてください。 ' }))
      .toEqual({ ok: true, answer: 'どちらでもない。個別に聞いてください。' });
  });

  it('both shapes at once, or neither, is refused', () => {
    expect(qt.validateTicketAnswer(ticket, { option: '税込', text: '税込' }).ok).toBe(false);
    expect(qt.validateTicketAnswer(ticket, {}).ok).toBe(false);
    expect(qt.validateTicketAnswer(ticket, { text: '  ' }).ok).toBe(false);
  });
});

// ── The loop: asking rests the run; the answer resumes it ─────────────

type Block = Record<string, unknown>;
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id, name, input });
const textBlock = (t: string): Block => ({ type: 'text', text: t });

function scripted(turns: { content: Block[] }[]) {
  let i = 0;
  return {
    callModel: async () => {
      const t = turns[i++] ?? { content: [textBlock('done')] };
      return { content: t.content, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

const KIND: Record<string, string> = {
  read_thing: 'read', send_email: 'write', ask_question: 'question', finish: 'finish',
};
const fresh = () => ({ messages: [{ role: 'user', content: 'task' }] as never[], turns: 0, nudges: 0, revisions: 0 as number | undefined });
const limits = () => ({ maxTurnsThisCall: 10, maxTotalTurns: 50, deadline: Date.now() + 60_000 });

function loopDeps(model: ReturnType<typeof scripted>, over: Record<string, unknown> = {}) {
  const executed: string[] = [];
  const filed = new Map<string, string>();
  const deps = {
    callModel: model.callModel,
    kindOf: (n: string) => KIND[n] ?? 'board',
    needsApproval: () => false,
    execute: async (c: { id: string; name: string }) => {
      executed.push(c.name);
      if (c.name === 'ask_question') {
        const ticketId = `ticket-${c.id}`;
        filed.set(c.id, ticketId);
        return { content: '質問を登録しました。', question: { ticketId } };
      }
      if (c.name === 'finish') return { content: 'ok', finish: { outcome: 'completed', summary: 's', message: 'm' } };
      return { content: `${c.name} ok` };
    },
    onUsage: async () => {},
    budgetExceeded: () => false,
    cancelled: async () => false,
    ...over,
  };
  return { deps, executed, filed };
}

describe('the loop’s question rest (B12)', () => {
  it('a fixture run asks, rests, and resumes on the answer — present in its context', async () => {
    const { deps } = loopDeps(scripted([
      { content: [toolUse('r1', 'read_thing'), toolUse('q1', 'ask_question', { question: '税込ですか？' })] },
    ]));
    const state = fresh();
    const out = await loop.runLoop(state, deps, limits());
    expect(out.kind).toBe('question');
    if (out.kind !== 'question') return;
    expect(out.pending.calls.map((c: { id: string }) => c.id)).toEqual(['q1']);
    expect(out.tickets).toEqual([{ callId: 'q1', ticketId: 'ticket-q1' }]);
    // The turn's read result waits in the partial; the question call
    // has no result yet — its result is the answer.
    expect(out.pending.partial.map((r: { tool_use_id: string }) => r.tool_use_id)).toEqual(['r1']);
    // The answer resumes the turn: one user message answers the whole
    // paused turn, and the answer is in the run's context, verbatim.
    loop.appendDecisionResults(state, out.pending, [
      { type: 'tool_result', tool_use_id: 'q1', content: '税込です' },
    ]);
    const last = state.messages[state.messages.length - 1] as { role: string; content: { tool_use_id: string; content: string }[] };
    expect(last.role).toBe('user');
    expect(last.content).toEqual([
      { type: 'tool_result', tool_use_id: 'r1', content: 'read_thing ok' },
      { type: 'tool_result', tool_use_id: 'q1', content: '税込です' },
    ]);
  });

  it('two tickets from one run rest it once, with both listed', async () => {
    const { deps } = loopDeps(scripted([
      { content: [toolUse('q1', 'ask_question'), toolUse('q2', 'ask_question')] },
    ]));
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('question');
    if (out.kind !== 'question') return;
    expect(out.pending.calls.map((c: { id: string }) => c.id)).toEqual(['q1', 'q2']);
    expect(out.tickets).toEqual([
      { callId: 'q1', ticketId: 'ticket-q1' },
      { callId: 'q2', ticketId: 'ticket-q2' },
    ]);
  });

  it('two calls asking the same question share its one ticket', async () => {
    const { deps } = loopDeps(scripted([
      { content: [toolUse('q1', 'ask_question'), toolUse('q2', 'ask_question')] },
    ]), {
      execute: async (c: { id: string; name: string }) =>
        c.name === 'ask_question'
          ? { content: '質問を登録しました。', question: { ticketId: 'ticket-shared' } }
          : { content: `${c.name} ok` },
    });
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('question');
    if (out.kind !== 'question') return;
    expect(out.tickets).toEqual([
      { callId: 'q1', ticketId: 'ticket-shared' },
      { callId: 'q2', ticketId: 'ticket-shared' },
    ]);
  });

  it('a turn whose writes wait for approval files no question — one rest at a time', async () => {
    const { deps, executed } = loopDeps(scripted([
      { content: [toolUse('w1', 'send_email'), toolUse('q1', 'ask_question')] },
    ]), { needsApproval: () => true });
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('approval');
    if (out.kind !== 'approval') return;
    // ask_question was never executed: no ticket was filed this turn.
    expect(executed).not.toContain('ask_question');
    const deferred = out.pending.partial.find((r: { tool_use_id: string }) => r.tool_use_id === 'q1');
    expect(deferred?.is_error).toBe(true);
    expect(deferred?.content).toContain('承認の結果を受け取ってから');
  });

  it('a finish in the asking turn is premature, answered as not yet done', async () => {
    const { deps, executed } = loopDeps(scripted([
      { content: [toolUse('q1', 'ask_question'), toolUse('f1', 'finish')] },
    ]));
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('question');
    if (out.kind !== 'question') return;
    expect(executed).not.toContain('finish');
    const held = out.pending.partial.find((r: { tool_use_id: string }) => r.tool_use_id === 'f1');
    expect(held?.is_error).toBe(true);
    expect(held?.content).toContain('回答を待っているため');
  });

  it('a question that cannot be filed is an ordinary error — the run goes on', async () => {
    const { deps } = loopDeps(scripted([
      { content: [toolUse('q1', 'ask_question')] },
      { content: [toolUse('f1', 'finish')] },
    ]), {
      execute: async (c: { name: string }) =>
        c.name === 'ask_question'
          ? { content: 'tried が必要です。', is_error: true }
          : { content: 'ok', finish: { outcome: 'completed', summary: 's', message: 'm' } },
    });
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('finished');
  });
});

// ── The dispatch table: an answer is its own entry ────────────────────

describe('the answer entry (dispatch)', () => {
  it('reads a request’s shape: an answer is neither a message nor a decision', () => {
    expect(dispatch.entryForBody({ answer: { ticketId: 't1', option: 'a' } })).toBe('answer');
    expect(dispatch.entryForBody({ message: 'hi', answer: { ticketId: 't1' } })).toBe('message');
    expect(dispatch.entryForBody({ decision: { approve: true }, answer: { ticketId: 't1' } })).toBe('decision');
  });

  it('claims an answer only from awaiting_input, the question rest', () => {
    expect(dispatch.claimFor('answer')).toEqual({ from: ['awaiting_input'] });
  });

  it('only a work run takes an answer — conversations take messages', () => {
    expect(dispatch.answerAllowed('execute')).toBe(true);
    expect(dispatch.answerAllowed('converse')).toBe(false);
    expect(dispatch.answerAllowed('chat')).toBe(false);
    expect(dispatch.answerAllowed('draft')).toBe(false);
    expect(dispatch.answerAllowed('promote')).toBe(false);
    expect(dispatch.answerAllowed('heartbeat')).toBe(false);
    expect(dispatch.heartbeatEntryAllowed('answer')).toBe(false);
  });
});

// ── The web twin: the card’s reading of a ticket row ─────────────────

describe('questionTicketView (the Inbox card’s reading)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 't1', activity_space_id: 's1', run_id: 'r1', element_id: 'e1', strategy_id: null,
    question: '税込ですか？', options: [{ label: '税込' }, { label: '税別' }],
    context: { decision: '総額が決まります', links: [{ label: '見積もり案' }] },
    tried: '表を確認した', status: 'open' as const, answer: null, answered_by: null, answered_at: null,
    expires_at: '2026-11-16T00:00:00Z', created_at: '2026-11-09T00:00:00Z', ...over,
  });

  it('parses options and context defensively', () => {
    const view = questionTicketView(row({
      options: [{ label: '税込', recommended: true }, '税別', { nope: 1 }, null],
    }));
    expect(view.options).toEqual([
      { label: '税込', recommended: true }, { label: '税別', recommended: false },
    ]);
    expect(view.decision).toBe('総額が決まります');
    expect(view.links).toEqual([{ label: '見積もり案', url: null }]);
    expect(view.tried).toBe('表を確認した');
    // A malformed column reads as no options and no context, never a crash.
    const junk = questionTicketView(row({ options: 'junk', context: 42 }));
    expect(junk.options).toEqual([]);
    expect(junk.decision).toBeNull();
    expect(junk.links).toEqual([]);
  });
});

describe('a standing answer (the person’s word, kept by the engine)', () => {
  const ticket = (context: unknown) => ({ question: 'クレームの担当は誰ですか？', context });
  const now = new Date('2026-11-11T03:00:00Z');

  it('validateAskInput keeps a declared topic in the context, and refuses an empty or oversized one', () => {
    const base = { question: 'クレームの担当は誰ですか？', tried: 'listWorkers で確かめた' };
    const ok = qt.validateAskInput({ ...base, standing_topic: '  担当： クレーム ' });
    expect(ok.ok && ok.value.context.standing_topic).toBe('担当： クレーム');
    expect(qt.validateAskInput({ ...base, standing_topic: '  ' }).ok).toBe(false);
    expect(qt.validateAskInput({ ...base, standing_topic: 'あ'.repeat(81) }).ok).toBe(false);
    const none = qt.validateAskInput(base);
    expect(none.ok && 'standing_topic' in none.value.context).toBe(false);
  });

  it('becomes one fact under the declared topic, in the person’s own words', () => {
    const m = qt.standingAnswerMemory(ticket({ standing_topic: '担当：クレーム' }), ' TAKA ', true, now);
    expect(m).toMatchObject({ kind: 'fact', topic: '担当：クレーム', gist: '担当：クレーム：TAKA' });
    expect(m?.body).toContain('答え：TAKA');
    expect(m?.body).toContain('聞いた質問：クレームの担当は誰ですか？');
    expect(m?.body).toContain('2026-11-11');
  });

  it('is not kept when no topic was declared, when the person held it to this run, or when the answer is empty', () => {
    expect(qt.standingAnswerMemory(ticket({ decision: '担当を決める' }), 'TAKA', true, now)).toBeNull();
    expect(qt.standingAnswerMemory(ticket({ standing_topic: '担当：クレーム' }), 'TAKA', false, now)).toBeNull();
    expect(qt.standingAnswerMemory(ticket({ standing_topic: '担当：クレーム' }), '   ', true, now)).toBeNull();
    expect(qt.standingAnswerMemory(ticket(null), 'TAKA', true, now)).toBeNull();
  });
});
