import { describe, expect, it } from 'vitest';
import { copilotTitleOf, type CopilotMessage } from '@/AIP/ai/useClaywareCopilot';

// The Copilot panel's display contract, pinned before the engine
// unification moves the turns onto run-agent (Athena): the title a kept
// conversation is filed under, and the ai_sessions.messages shapes the
// panel renders — the server appends in exactly these shapes, so what is
// pinned here is what both sides must keep meaning.
const session = await import(new URL('../../supabase/functions/_shared/copilotSession.ts', import.meta.url).pathname);

describe('copilotTitleOf (how a kept conversation is filed)', () => {
  const user = (content: string, attachments?: CopilotMessage['attachments']): CopilotMessage => ({ role: 'user', content, attachments });
  const assistant = (content: string): CopilotMessage => ({ role: 'assistant', content, done: true });

  it('takes the start of the first question', () => {
    expect(copilotTitleOf([user('来月の売上を教えて'), assistant('…')])).toBe('来月の売上を教えて');
    expect(copilotTitleOf([assistant('先に挨拶'), user('質問はこれ')])).toBe('質問はこれ');
  });

  it('folds whitespace and caps at 80 characters', () => {
    expect(copilotTitleOf([user('  行が\n分かれた\t質問  ')])).toBe('行が 分かれた 質問');
    expect(copilotTitleOf([user('あ'.repeat(120))])).toBe('あ'.repeat(80));
  });

  it('a file-only question takes the file name', () => {
    expect(copilotTitleOf([user('', [{ name: '請求書.pdf', mediaType: 'application/pdf' }])])).toBe('請求書.pdf');
  });

  it('no question yet means no title', () => {
    expect(copilotTitleOf([])).toBe('');
    expect(copilotTitleOf([assistant('…')])).toBe('');
  });
});

describe('the kept conversation’s stored shape', () => {
  // One full exchange as ai_sessions.messages holds it: a question with a
  // file (name only — contents are never kept), an answer with its tool
  // steps, and an approval card waiting on its run and action.
  const kept = () => ([
    { role: 'user', content: 'この請求書を送って', attachments: [{ name: '請求書.pdf', mediaType: 'application/pdf' }] },
    {
      role: 'assistant', content: '送る準備ができました。', done: true,
      toolEvents: [{ name: 'readFile', input: { name: '請求書.pdf' }, result: { ok: true, rows: 1 } }],
      approvals: [{
        calls: [{ id: 'c1', name: 'ext__send', input: { to: 'a@example.com' }, display: { integration: 'Mail', operation: 'send', destination: 'a@example.com', detail: null, effect: 'write', critical: null, rememberable: false } }],
        inputHash: 'h1', status: 'pending', runId: 'r1', actionId: 'a1',
      }],
    },
  ]);

  it('survives storage as jsonb unchanged', () => {
    const messages = kept();
    expect(JSON.parse(JSON.stringify(messages))).toEqual(messages);
  });

  it('a decision lands on its card, and the resumed turn appends as an answer', () => {
    const decided = session.withApprovalDecision(kept(), 'a1', {
      status: 'executed', results: [{ name: 'ext__send', ok: true, content: 'sent' }],
    });
    const card = (decided[1] as { approvals: { status: string; results?: unknown }[] }).approvals[0];
    expect(card.status).toBe('executed');
    expect(card.results).toEqual([{ name: 'ext__send', ok: true, content: 'sent' }]);

    const continued = [...decided, session.resumedAssistantMessage({ text: '送りました', toolEvents: [{ name: 'listElements', result: { ok: true, rows: 2 } }] })];
    expect(continued).toHaveLength(3);
    expect(continued[2]).toEqual({
      role: 'assistant', content: '送りました', done: true,
      toolEvents: [{ name: 'listElements', result: { ok: true, rows: 2 } }],
    });
  });
});
