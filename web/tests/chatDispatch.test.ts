import { describe, expect, it } from 'vitest';

// Athena's dispatch table (run-agent/dispatch.ts), the seeding of a chat
// transcript from the kept conversation (copilotSession.ts), the context
// fold (copilotTurn.ts) and the attachment blocks (_shared/attachments.ts)
// — the pure pieces of the chat driver, pinned before the driver itself
// is trusted with the panel's turns.
const dispatch = await import(new URL('../../supabase/functions/run-agent/dispatch.ts', import.meta.url).pathname);
const session = await import(new URL('../../supabase/functions/_shared/copilotSession.ts', import.meta.url).pathname);
const turnMod = await import(new URL('../../supabase/functions/_shared/copilotTurn.ts', import.meta.url).pathname);
const attachments = await import(new URL('../../supabase/functions/_shared/attachments.ts', import.meta.url).pathname);

const subject = (over: Record<string, unknown> = {}) => ({
  element_id: null, strategy_id: null, ai_session_id: null, mode: 'execute', ...over,
});

describe('driverForRun (one driver per subject)', () => {
  it('an Element’s run is work', () => {
    expect(dispatch.driverForRun(subject({ element_id: 'e1' }))).toBe('execute');
    // A subject beside the Element never outranks it.
    expect(dispatch.driverForRun(subject({ element_id: 'e1', ai_session_id: 's1', mode: 'copilot' }))).toBe('execute');
  });

  it('a Strategy’s run is its conversation', () => {
    expect(dispatch.driverForRun(subject({ strategy_id: 'st1', mode: 'converse' }))).toBe('converse');
    expect(dispatch.driverForRun(subject({ strategy_id: 'st1', ai_session_id: 's1', mode: 'copilot' }))).toBe('converse');
  });

  it('a session’s run is the chat — by its session, or by its mode once the session is gone', () => {
    expect(dispatch.driverForRun(subject({ ai_session_id: 's1', mode: 'copilot' }))).toBe('chat');
    expect(dispatch.driverForRun(subject({ mode: 'copilot' }))).toBe('chat');
  });

  it('a draft’s run is the drafting driver (G4)', () => {
    expect(dispatch.driverForRun(subject({ integration_draft_id: 'd1', mode: 'draft' }))).toBe('draft');
    // The Element still outranks every other subject.
    expect(dispatch.driverForRun(subject({ element_id: 'e1', integration_draft_id: 'd1', mode: 'draft' }))).toBe('execute');
  });
});

describe('entryForBody and the claim table', () => {
  it('reads a request’s shape in serve’s order', () => {
    expect(dispatch.entryForBody({ message: 'hi', decision: { approve: true } })).toBe('message');
    expect(dispatch.entryForBody({ message: '' })).toBe('message');
    expect(dispatch.entryForBody({ decision: { approve: true }, continue: true })).toBe('decision');
    expect(dispatch.entryForBody({ continue: true, resume: true })).toBe('continue');
    expect(dispatch.entryForBody({ resume: true })).toBe('resume');
    expect(dispatch.entryForBody({})).toBe('start');
  });

  it('claims each entry from the statuses it has always claimed from', () => {
    expect(dispatch.claimFor('message')).toEqual({ from: ['queued', 'awaiting_input', 'paused'] });
    expect(dispatch.claimFor('decision')).toEqual({ from: ['awaiting_approval'] });
    expect(dispatch.claimFor('continue')).toEqual({ from: ['running'], token: true });
    expect(dispatch.claimFor('resume')).toEqual({ from: ['paused'] });
    expect(dispatch.claimFor('start')).toEqual({ from: ['queued'] });
  });

  it('words may be posted to either conversation, never to a work run', () => {
    expect(dispatch.messageAllowed('converse')).toBe(true);
    expect(dispatch.messageAllowed('chat')).toBe(true);
    expect(dispatch.messageAllowed('execute')).toBe(false);
    // A draft takes the person's answer to its question, and "fix this".
    expect(dispatch.messageAllowed('draft')).toBe(true);
  });
});

describe('seedMessagesFromPanel (a transcript from the kept conversation)', () => {
  it('maps the person’s turns as text and the assistant’s as a text block', () => {
    const seeded = session.seedMessagesFromPanel([
      { role: 'user', content: '売上を教えて' },
      { role: 'assistant', content: '先月は120万円でした。', done: true, toolEvents: [{ name: 'listElements', result: { ok: true, rows: 3 } }] },
      { role: 'user', content: '前年と比べて' },
    ]);
    expect(seeded).toEqual([
      { role: 'user', content: '売上を教えて' },
      { role: 'assistant', content: [{ type: 'text', text: '先月は120万円でした。' }] },
      { role: 'user', content: '前年と比べて' },
    ]);
  });

  it('drops wordless turns and opens with the person', () => {
    const seeded = session.seedMessagesFromPanel([
      { role: 'assistant', content: '先行する挨拶', done: true },
      { role: 'assistant', content: '', done: true, approvals: [{ calls: [], inputHash: 'h', status: 'denied' }] },
      { role: 'user', content: '質問' },
      { role: 'assistant', content: '  ', done: true },
    ]);
    expect(seeded).toEqual([{ role: 'user', content: '質問' }]);
  });

  it('a file-only question seeds as its file names', () => {
    const seeded = session.seedMessagesFromPanel([
      { role: 'user', content: '', attachments: [{ name: '請求書.pdf', mediaType: 'application/pdf' }, { name: '明細.txt', mediaType: 'text/plain' }] },
    ]);
    expect(seeded).toEqual([{ role: 'user', content: '添付ファイル: 請求書.pdf、明細.txt' }]);
  });

  it('an empty conversation seeds an empty transcript', () => {
    expect(session.seedMessagesFromPanel([])).toEqual([]);
  });
});

describe('foldCopilotContext (the context a chat turn runs under)', () => {
  it('the newest sent context wins whole', () => {
    expect(turnMod.foldCopilotContext({ viewLabel: '旧', spaceId: 's0' }, { viewLabel: '新', spaceId: 's1' }, 's9'))
      .toEqual({ viewLabel: '新', spaceId: 's1' });
  });

  it('a decision or continuation keeps the transcript’s context', () => {
    expect(turnMod.foldCopilotContext({ viewLabel: '保持', spaceId: 's1' }, undefined, 's9'))
      .toEqual({ viewLabel: '保持', spaceId: 's1' });
    expect(turnMod.foldCopilotContext(undefined, undefined, null)).toEqual({});
  });

  it('a context naming no Space falls back to the run’s own', () => {
    expect(turnMod.foldCopilotContext(undefined, { viewLabel: 'Profile' }, 's7'))
      .toEqual({ viewLabel: 'Profile', spaceId: 's7' });
    // A personal run has no Space to fall back to.
    expect(turnMod.foldCopilotContext(undefined, { viewLabel: 'Profile' }, null))
      .toEqual({ viewLabel: 'Profile' });
  });
});

describe('requestContent (a message’s files as document blocks)', () => {
  const pdf = { name: '請求書.pdf', mediaType: 'application/pdf', data: 'QUJD' };
  const txt = { name: 'メモ.txt', mediaType: 'text/plain', data: '中身' };

  it('plain text passes through, and only a person’s turn carries files', () => {
    expect(attachments.requestContent({ role: 'user', content: '質問' })).toBe('質問');
    expect(attachments.requestContent({ role: 'assistant', content: '答え', attachments: [pdf] })).toBe('答え');
  });

  it('builds a document block per file, then the words', () => {
    expect(attachments.requestContent({ role: 'user', content: '読んで', attachments: [pdf, txt] })).toEqual([
      { type: 'document', title: '請求書.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } },
      { type: 'document', title: 'メモ.txt', source: { type: 'text', media_type: 'text/plain', data: '中身' } },
      { type: 'text', text: '読んで' },
    ]);
    const only = attachments.requestContent({ role: 'user', content: '', attachments: [txt] }) as { type: string; text?: string }[];
    expect(only[only.length - 1]).toEqual({ type: 'text', text: '添付したファイルを読んでください。' });
  });

  it('refuses what cannot go to the model, with the reason', () => {
    expect(() => attachments.requestContent({ role: 'user', content: 'x', attachments: [pdf, pdf, pdf, pdf, pdf, pdf] }))
      .toThrow('at most 5 files per message');
    expect(() => attachments.requestContent({ role: 'user', content: 'x', attachments: [{ ...pdf, data: 'A'.repeat(14_000_001) }] }))
      .toThrow('請求書.pdf: PDF too large');
    expect(() => attachments.requestContent({ role: 'user', content: 'x', attachments: [{ ...txt, data: 'あ'.repeat(400_001) }] }))
      .toThrow('メモ.txt: text too long');
    expect(() => attachments.requestContent({ role: 'user', content: 'x', attachments: [{ name: 'a.png', mediaType: 'image/png', data: 'AA' }] }))
      .toThrow('a.png: unsupported file type');
    expect(() => attachments.requestContent({ role: 'user', content: 'x', attachments: [{ name: '空.pdf', mediaType: 'application/pdf', data: '' }] }))
      .toThrow('空.pdf: no contents');
  });
});
