import { describe, expect, it, vi, afterEach } from 'vitest';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const gm = await import(new URL('../../supabase/functions/_shared/gmailManifest.ts', import.meta.url).pathname);
const mt = await import(new URL('../../supabase/functions/_shared/manifestTransforms.ts', import.meta.url).pathname);
const vr = await import(new URL('../../supabase/functions/_shared/verifyReads.ts', import.meta.url).pathname);
const itools = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);

// gmail_send v2 and gmail_modify_labels (Sim prototype P2; design §4):
// the send's body is a computed document — an RFC 822 message the
// named gmail_mime builder assembles from the call's inputs — and its
// declaration carries what Sim has no equivalent for: a present block
// translated from gmail_send_v2's assistant.reviewFields, a verify
// that reads the created message back expecting its thread, and
// reversibility "none". The label write is the polling flow's
// processed-mark: reversible ("contained"), verified by the same
// read-back, and — by the operation-segment reading of its path —
// not a critical send merely because its resource is a message.

const { manifest } = cm.parseManifest(gm.GMAIL_MANIFEST);
const send = manifest.commands.find((c: { name: string }) => c.name === 'gmail_send');
const modify = manifest.commands.find((c: { name: string }) => c.name === 'gmail_modify_labels');

/** The RFC 822 message inside a built body, as text. */
const messageOf = (built: Record<string, unknown>): string =>
  Buffer.from(String(built.raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

/** The header block of a built message, and its decoded body. */
const partsOf = (built: Record<string, unknown>) => {
  const message = messageOf(built);
  const [head, ...rest] = message.split('\r\n\r\n');
  const b64 = rest.join('\r\n\r\n').replace(/\r\n/g, '');
  return { message, head, body: Buffer.from(b64, 'base64').toString('utf-8') };
};

describe('gmail_mime: the builder', () => {
  it('builds a plain send: headers, a base64 body, no threadId key', () => {
    const built = mt.gmailMimeBody({ to: 'boss@example.co.jp', subject: 'Weekly report', body: 'All quiet.\nSee attached.' });
    expect(Object.keys(built)).toEqual(['raw']);
    expect(String(built.raw)).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    const { message, head, body } = partsOf(built);
    expect(head).toBe([
      'To: boss@example.co.jp',
      'Subject: Weekly report',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n'));
    expect(body).toBe('All quiet.\nSee attached.');
    // CRLF discipline: no bare line break anywhere in the message.
    expect(message.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('encodes a Japanese subject and display name, the address staying plain', () => {
    const built = mt.gmailMimeBody({
      to: '田中 花子 <hanako@example.co.jp>',
      subject: '来月の請求書について、ご確認をお願いいたします',
      body: '請求書を添付します。\nご確認ください。',
    });
    const { head, body } = partsOf(built);
    const toLine = head.split('\r\n').find((l: string) => l.startsWith('To:'))!;
    expect(toLine).toContain('<hanako@example.co.jp>');
    expect(mt.decodeHeaderValue(toLine.slice(4))).toBe('田中 花子 <hanako@example.co.jp>');
    const subjectLine = head.split('\r\n').find((l: string) => l.startsWith('Subject:'))!;
    // A long subject becomes several encoded words, each within the
    // RFC's 75-char limit, and together they read back as the subject.
    const words = subjectLine.slice(9).split(' ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(mt.decodeHeaderValue(subjectLine.slice(9))).toBe('来月の請求書について、ご確認をお願いいたします');
    expect(body).toBe('請求書を添付します。\nご確認ください。');
  });

  it('threads a reply from the header inputs, threadId riding beside raw', () => {
    const built = mt.gmailMimeBody({
      to: 'hanako@example.co.jp', subject: 'Re: 請求書の件', body: '承知しました。',
      threadId: 't-123', replyToMessageId: 'm-456',
      messageIdHeader: '<abc123@example.co.jp>',
      references: '<prev1@example.co.jp> <prev2@example.co.jp>',
    });
    expect(built.threadId).toBe('t-123');
    const { head } = partsOf(built);
    expect(head).toContain('In-Reply-To: <abc123@example.co.jp>');
    expect(head).toContain('References: <prev1@example.co.jp> <prev2@example.co.jp> <abc123@example.co.jp>');
  });

  it('a reply id alone threads nothing: headers come from header inputs only', () => {
    const { head } = partsOf(mt.gmailMimeBody({ to: 'a@example.co.jp', body: 'x', replyToMessageId: 'm-456' }));
    expect(head).not.toContain('In-Reply-To');
    expect(head).not.toContain('References');
  });

  it('cc and bcc ride when given and are absent when not; html is a content type', () => {
    const full = partsOf(mt.gmailMimeBody({
      to: 'a@example.co.jp', cc: 'c1@example.co.jp, c2@example.co.jp', bcc: 'b@example.co.jp',
      body: '<p>Hi</p>', contentType: 'html',
    }));
    expect(full.head).toContain('Cc: c1@example.co.jp, c2@example.co.jp');
    expect(full.head).toContain('Bcc: b@example.co.jp');
    expect(full.head).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(full.body).toBe('<p>Hi</p>');
    const bare = partsOf(mt.gmailMimeBody({ to: 'a@example.co.jp', body: 'x' }));
    expect(bare.head).not.toContain('Cc:');
    expect(bare.head).not.toContain('Bcc:');
    expect(bare.head).not.toContain('Subject:');
  });

  it('a line break in a header value cannot become a second header', () => {
    const { head } = partsOf(mt.gmailMimeBody({
      to: 'a@example.co.jp', subject: 'Hello\nBcc: evil@example.co.jp', body: 'x',
    }));
    const lines = head.split('\r\n');
    expect(lines.some((l: string) => l.startsWith('Bcc:'))).toBe(false);
    expect(lines.filter((l: string) => l.startsWith('Subject:'))).toHaveLength(1);
  });

  it('the registry answers by name, and an unknown name builds nothing', () => {
    expect(mt.isBodyBuilder('gmail_mime')).toBe(true);
    expect(mt.isBodyBuilder('nope')).toBe(false);
    expect(mt.applyBodyBuilder('gmail_mime', { to: 'a@example.co.jp', body: 'x' })).toHaveProperty('raw');
    expect(mt.applyBodyBuilder('nope', {})).toBeNull();
  });
});

describe('the send declaration', () => {
  it('is a write that asks, on POST /messages/send, its body built by gmail_mime', () => {
    expect(send.effect).toBe('write');
    expect(send.permission).toBe('ask');
    expect(send.http).toEqual({ method: 'POST', path: '/messages/send', query: [], body: [], bodyFrom: 'gmail_mime' });
    expect(send.required).toEqual(['to', 'body']);
    expect(Object.keys(send.input)).toEqual([
      'to', 'cc', 'bcc', 'subject', 'body', 'contentType', 'threadId', 'replyToMessageId', 'messageIdHeader', 'references',
    ]);
  });

  it('carries the present translation of Sim’s reviewFields (design §4.3)', () => {
    expect(send.present).toEqual({
      title: 'Send email',
      fields: [
        { arg: 'to', label: 'To' },
        { arg: 'cc', label: 'Cc' },
        { arg: 'bcc', label: 'Bcc' },
        { arg: 'threadId', label: 'Thread' },
        { arg: 'replyToMessageId', label: 'Reply to' },
        { arg: 'subject', label: 'Subject' },
      ],
      preview: 'body',
    });
  });

  it('is a critical send, irreversible by declaration, with no undo and no quota', () => {
    expect(cm.criticalClassOf(send)).toBe('send');
    expect(send.reversibility).toBe('none');
    expect(cm.reversibilityOf(send)).toBe('none');
    expect(send.undo).toBeNull();
    expect(send.quota).toBeNull();
  });

  it('verifies by reading the created message back, expecting the thread, after a second', () => {
    expect(send.verify).toEqual({ command: 'gmail_read', expect: { threadId: 'threadId' }, delayMs: 1000 });
  });

  it('requestFor alone leaves the body empty — the builder runs at the executor seam', () => {
    expect(cm.requestFor(send, { to: 'a@example.co.jp', body: 'x' }))
      .toEqual({ method: 'POST', path: '/messages/send', query: {}, body: {} });
    expect(cm.requestFor(send, { body: 'x' })).toEqual({ error: 'to が必要です' });
  });
});

describe('the label declaration', () => {
  it('is a contained write on POST /messages/{id}/modify, the label lists as its body', () => {
    expect(modify.effect).toBe('write');
    expect(modify.permission).toBe('ask');
    expect(modify.http).toEqual({
      method: 'POST', path: '/messages/{id}/modify', query: [], body: ['addLabelIds', 'removeLabelIds'], bodyFrom: null,
    });
    expect(modify.required).toEqual(['id']);
    expect(modify.reversibility).toBe('contained');
    expect(cm.reversibilityOf(modify)).toBe('contained');
    expect(modify.verify).toEqual({ command: 'gmail_read', expect: { threadId: 'threadId' }, delayMs: 0 });
  });

  it('is not a critical send: its resource is a message, its operation is a label change', () => {
    expect(cm.criticalClassOf(modify)).toBeNull();
    // The operation segment still speaks when it is the verb:
    const sendShaped = { ...modify, name: 'notify_labels', action: 'labels.notify', http: { ...modify.http, path: '/messages/send' } };
    expect(cm.criticalClassOf(sendShaped)).toBe('send');
  });

  it('builds its request: the id fills its segment, only the given lists ride', () => {
    expect(cm.requestFor(modify, { id: 'm1', addLabelIds: ['Label_7'] }))
      .toEqual({ method: 'POST', path: '/messages/m1/modify', query: {}, body: { addLabelIds: ['Label_7'] } });
    expect(cm.requestFor(modify, { id: 'm1', addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] }))
      .toEqual({ method: 'POST', path: '/messages/m1/modify', query: {}, body: { addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] } });
  });
});

describe('the verify, constructed (B2 machinery over the real manifest)', () => {
  const sleep = async () => {};
  const readBack = (record: Record<string, unknown>) => async () => ({ text: JSON.stringify(record), isError: false });

  it('a fresh send: the created id addresses the read, its own thread is the expectation', async () => {
    let readInput: Record<string, unknown> | null = null;
    const check = await vr.runVerifyRead({
      manifest, declaration: send.verify,
      writeInput: { to: 'boss@example.co.jp', body: '本文です。' },
      // The send's answer as the transport framed it — the created
      // id and thread are read out of it (stateOfResult steps over
      // the status line), or the read could not be addressed at all.
      writeResultText: 'HTTP 200\n{"id":"m-new","threadId":"t-new","labelIds":["SENT"]}',
      deps: {
        callRead: async (_cmd: unknown, input: Record<string, unknown>) => {
          readInput = input;
          return { text: JSON.stringify({ id: 'm-new', threadId: 't-new', labelIds: ['SENT'] }), isError: false };
        },
        sleep,
      },
    });
    expect(readInput).toEqual({ id: 'm-new' });
    expect(check).toEqual({ ok: true });
  });

  it('a reply: the named thread is the expectation, and a different one is a mismatch', async () => {
    const base = {
      manifest, declaration: send.verify,
      writeInput: { to: 'a@example.co.jp', body: 'x', threadId: 't-named' },
      writeResultText: 'HTTP 200\n{"id":"m-re","threadId":"t-named","labelIds":["SENT"]}',
    };
    await expect(vr.runVerifyRead({
      ...base, deps: { callRead: readBack({ id: 'm-re', threadId: 't-named' }), sleep },
    })).resolves.toEqual({ ok: true });
    const bad = await vr.runVerifyRead({
      ...base, deps: { callRead: readBack({ id: 'm-re', threadId: 't-other' }), sleep },
    });
    expect(bad.ok).toBe(false);
    expect(bad.diff).toEqual([{ field: 'threadId', expected: 't-named', actual: 't-other' }]);
  });

  it('a label change: the modified message reads back in its own thread', async () => {
    const check = await vr.runVerifyRead({
      manifest, declaration: modify.verify,
      writeInput: { id: 'm1', addLabelIds: ['Label_7'] },
      writeResultText: 'HTTP 200\n{"id":"m1","threadId":"t1","labelIds":["INBOX","Label_7"]}',
      deps: { callRead: readBack({ id: 'm1', threadId: 't1', labelIds: ['INBOX', 'Label_7'] }), sleep },
    });
    expect(check).toEqual({ ok: true });
  });
});

describe('the send, end to end through the executor', () => {
  afterEach(() => vi.unstubAllGlobals());

  const CREATED = {
    id: 'm-new', threadId: 't-new', labelIds: ['SENT'],
    payload: {
      mimeType: 'text/plain', filename: '',
      headers: [
        { name: 'To', value: 'boss@example.co.jp' },
        { name: 'Subject', value: '確認のお願い' },
        { name: 'Message-ID', value: '<m-new@example.co.jp>' },
      ],
      body: { size: 5, data: 'aGVsbG8' },
    },
  };

  it('posts the built body, then reads the created message back and verifies', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ?? '' });
      const body = calls.length === 1 ? CREATED : CREATED;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const tool = {
      integration: {
        id: 'int-1', name: 'Gmail', kind: 'http',
        endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me',
        auth_type: 'oauth', auth_header: null, delegation: 'approve_each', description: null,
      },
      remote: null, command: send, manifest,
      bind: async () => ({ secret: 'tok', session: null }),
    };
    const r = await itools.executeIntegrationTool(tool, {
      id: 's1', name: 'gmail__gmail_send',
      input: { to: 'boss@example.co.jp', subject: '確認のお願い', body: 'hello' },
    });
    expect(r.isError).toBe(false);
    expect(r.verify).toEqual({ ok: true });
    // Two calls: the send, then the verify's read of the created id.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'GET https://gmail.googleapis.com/gmail/v1/users/me/messages/m-new',
    ]);
    const sent = JSON.parse(calls[0].body) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['raw']);
    const { head, body } = partsOf(sent);
    expect(head).toContain('To: boss@example.co.jp');
    expect(body).toBe('hello');
  });
});
