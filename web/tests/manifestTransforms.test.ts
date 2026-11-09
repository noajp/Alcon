import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  draftStructureOfWeb, draftStructureHashWeb, draftPermissionHashWeb, type DraftContentLike,
} from '@/AIP/connectors/draftModel';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const cd = await import(new URL('../../supabase/functions/_shared/connectorDraft.ts', import.meta.url).pathname);
const mt = await import(new URL('../../supabase/functions/_shared/manifestTransforms.ts', import.meta.url).pathname);
const itools = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);

// Named response transforms (Sim prototype P1T; design §3.4): a manifest
// command may name a pure function from a closed code-side registry
// that shapes the service's raw answer — gmail_message reads a Gmail
// message resource as its headers and plain-text body. The grammar is
// fail-closed (an unknown name costs the command its place), a G4 draft
// may never name one, the reference rides the structure hash and never
// the permission hash (server and web twin alike), and the executor
// shapes a live answer exactly once — after the transport, before the
// verify read-back; an error answer and a replayed answer are never
// shaped.

// ── Gmail fixtures, in the API's own shapes ─────────────────────────────

const b64url = (s: string) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64word = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`;
const qword = (s: string) => `=?UTF-8?Q?${[...Buffer.from(s, 'utf-8')].map((b) => (b === 0x20 ? '_' : b >= 0x21 && b <= 0x7e && b !== 0x3d && b !== 0x3f && b !== 0x5f ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')}?=`;

const header = (name: string, value: string) => ({ name, value });

const SIMPLE_MESSAGE = {
  id: '18f1a2b3c4d5e6f7',
  threadId: '18f1a2b3c4d5e6f7',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: '来月の請求書を…',
  payload: {
    partId: '',
    mimeType: 'text/plain',
    filename: '',
    headers: [
      header('From', '田中 花子 <hanako@example.co.jp>'),
      header('To', 'me@example.co.jp'),
      header('Subject', b64word('請求書の件名')),
      header('Date', 'Mon, 3 Nov 2026 10:15:00 +0900'),
      header('Message-ID', '<abc123@example.co.jp>'),
      header('References', '<prev1@example.co.jp> <prev2@example.co.jp>'),
    ],
    body: { size: 42, data: b64url('来月の請求書を添付します。\nご確認ください。🎉') },
  },
  sizeEstimate: 1234,
};

const shaped = (text: string) => JSON.parse(mt.gmailMessage(text));

describe('gmail_message: the shaping', () => {
  it('reads a single-part message: headers decoded, body out of base64url', () => {
    const out = shaped(JSON.stringify(SIMPLE_MESSAGE));
    expect(out).toEqual({
      id: '18f1a2b3c4d5e6f7',
      threadId: '18f1a2b3c4d5e6f7',
      labelIds: ['INBOX', 'UNREAD'],
      from: '田中 花子 <hanako@example.co.jp>',
      to: 'me@example.co.jp',
      subject: '請求書の件名',
      date: 'Mon, 3 Nov 2026 10:15:00 +0900',
      body: '来月の請求書を添付します。\nご確認ください。🎉',
      hasAttachments: false,
      attachmentCount: 0,
      messageIdHeader: '<abc123@example.co.jp>',
      references: '<prev1@example.co.jp> <prev2@example.co.jp>',
    });
  });

  it('steps over an HTTP answer\u2019s status line, and decodes a Q-encoded header', () => {
    const msg = JSON.parse(JSON.stringify(SIMPLE_MESSAGE));
    msg.payload.headers[0] = header('From', `${qword('鈴木 一郎')} <ichiro@example.co.jp>`);
    const out = shaped(`HTTP 200\n${JSON.stringify(msg)}`);
    expect(out.from).toBe('鈴木 一郎 <ichiro@example.co.jp>');
    expect(out.subject).toBe('請求書の件名');
  });

  it('walks into nested multiparts for the plain part, and counts the attachment', () => {
    const msg = {
      id: 'm2', threadId: 't2', labelIds: ['INBOX'],
      payload: {
        partId: '', mimeType: 'multipart/mixed', filename: '', headers: [header('Subject', '資料送付')],
        body: { size: 0 },
        parts: [
          {
            partId: '0', mimeType: 'multipart/alternative', filename: '', headers: [], body: { size: 0 },
            parts: [
              {
                partId: '0.0', mimeType: 'multipart/related', filename: '', headers: [], body: { size: 0 },
                parts: [
                  { partId: '0.0.0', mimeType: 'text/plain', filename: '', headers: [], body: { size: 12, data: b64url('本文はこちらです') } },
                  { partId: '0.0.1', mimeType: 'text/html', filename: '', headers: [], body: { size: 30, data: b64url('<p>本文はこちらです</p>') } },
                ],
              },
            ],
          },
          { partId: '1', mimeType: 'application/pdf', filename: '請求書.pdf', headers: [], body: { size: 90210, attachmentId: 'ANGjdJ8xyz' } },
        ],
      },
    };
    const out = shaped(JSON.stringify(msg));
    expect(out.body).toBe('本文はこちらです');
    expect(out.hasAttachments).toBe(true);
    expect(out.attachmentCount).toBe(1);
  });

  it('an attachment is a file\u2019s part, never the body — and only an id with a name counts', () => {
    const msg = {
      id: 'm3', threadId: 't3', labelIds: [],
      payload: {
        partId: '', mimeType: 'multipart/mixed', filename: '', headers: [],
        body: { size: 0 },
        parts: [
          // A named text part with inline data but no attachment id:
          // not counted (the API's mark is the pair), never the body.
          { partId: '0', mimeType: 'text/plain', filename: 'notes.txt', headers: [], body: { size: 14, data: b64url('ATTACHMENT TEXT') } },
          // An id without a name: not counted either.
          { partId: '1', mimeType: 'image/png', filename: '', headers: [], body: { size: 500, attachmentId: 'ANGjdJ7abc' } },
          { partId: '2', mimeType: 'text/plain', filename: '', headers: [], body: { size: 8, data: b64url('REAL BODY') } },
        ],
      },
    };
    const out = shaped(JSON.stringify(msg));
    expect(out.body).toBe('REAL BODY');
    expect(out.attachmentCount).toBe(0);
    expect(out.hasAttachments).toBe(false);
  });

  it('reads an HTML-only message as text: tags and scripts go, entities are read', () => {
    const html = '<html><head><style>.a { color: red; }</style></head><body>'
      + '<p>請求の件名について</p><p>金額は &amp; 参照<br>次行です</p>'
      + '<script>alert(1)</script></body></html>';
    const msg = {
      id: 'm4', threadId: 't4', labelIds: [],
      payload: {
        partId: '', mimeType: 'text/html', filename: '',
        headers: [header('Subject', 'HTML のみ')],
        body: { size: html.length, data: b64url(html) },
      },
    };
    const out = shaped(JSON.stringify(msg));
    expect(out.body).toBe('請求の件名について\n金額は & 参照\n次行です');
    expect(out.body).not.toContain('alert');
    expect(out.body).not.toContain('color');
  });

  it('a metadata answer (headers, no body data) shapes with an empty body', () => {
    const msg = {
      id: 'm5', threadId: 't5', labelIds: ['SENT'],
      payload: {
        partId: '', mimeType: 'text/plain', filename: '',
        headers: [header('Subject', '見出しのみ'), header('From', 'a@example.co.jp')],
        body: { size: 42 },
      },
    };
    const out = shaped(JSON.stringify(msg));
    expect(out.subject).toBe('見出しのみ');
    expect(out.body).toBe('');
  });

  it('caps an oversized body in the transport\u2019s truncation style', () => {
    const msg = {
      id: 'm6', threadId: 't6', labelIds: [],
      payload: {
        partId: '', mimeType: 'text/plain', filename: '', headers: [],
        body: { size: 25000, data: b64url('あ'.repeat(25_000)) },
      },
    };
    const out = shaped(JSON.stringify(msg));
    expect(out.body.length).toBe(mt.GMAIL_MESSAGE_BODY_MAX + '\n…(15000 chars truncated)'.length);
    expect(out.body.endsWith('…(15000 chars truncated)')).toBe(true);
    expect(out.body.slice(0, 100)).toBe('あ'.repeat(100));
  });

  it('passes through what is not a message resource, byte for byte', () => {
    const list = JSON.stringify({ messages: [{ id: '1', threadId: 't' }], resultSizeEstimate: 1 });
    expect(mt.gmailMessage(list)).toBe(list);
    const error = JSON.stringify({ error: { code: 404, message: 'not found' } });
    expect(mt.gmailMessage(`HTTP 404\n${error}`)).toBe(`HTTP 404\n${error}`);
    expect(mt.gmailMessage('not json at all')).toBe('not json at all');
    const truncated = JSON.stringify(SIMPLE_MESSAGE).slice(0, 120);
    expect(mt.gmailMessage(truncated)).toBe(truncated);
  });

  it('applyResponseTransform: an unknown name is the second lock — text unchanged', () => {
    expect(mt.applyResponseTransform('no_such_transform', 'abc')).toBe('abc');
    expect(mt.isResponseTransform('gmail_message')).toBe(true);
    expect(mt.isResponseTransform('gmail_mesage')).toBe(false);
  });
});

// ── The grammar ─────────────────────────────────────────────────────────

const READ_WITH_TRANSFORM = {
  name: 'gmail_read', action: 'gmail.read', effect: 'read',
  description: 'Read one message', input: { id: { type: 'string' } }, required: ['id'],
  http: { method: 'GET', path: '/messages/{id}' }, transform: 'gmail_message',
};

const manifestWith = (commands: unknown[]) => ({ version: 1, defaults: { read: 'allow', write: 'ask' }, commands });
const commandOf = (raw: unknown, name: string) => cm.parseManifest(raw).manifest.commands.find((c: { name: string }) => c.name === name);

describe('parseTransform via parseManifest (P1T)', () => {
  it('keeps a command naming a registered transform, on http and mcp alike', () => {
    const { manifest, errors } = cm.parseManifest(manifestWith([
      READ_WITH_TRANSFORM,
      { name: 'drive_read', action: 'drive.read', effect: 'read', mcp: 'read_file', transform: 'gmail_message' },
    ]));
    expect(errors).toEqual([]);
    expect(manifest.commands.map((c: { transform: string | null }) => c.transform)).toEqual(['gmail_message', 'gmail_message']);
  });

  it('an unknown name — or not a name at all — costs the command its place', () => {
    for (const bad of ['gmail_mesage', 'Gmail_Message', 42, { name: 'gmail_message' }, '']) {
      const { manifest, errors } = cm.parseManifest(manifestWith([{ ...READ_WITH_TRANSFORM, transform: bad }]));
      expect(manifest.commands).toEqual([]);
      expect(errors.join(' ')).toContain('transform');
    }
  });

  it('absent is null, and a v1 manifest parses exactly as before', () => {
    const plain = { name: 'list_items', action: 'items.list', effect: 'read', http: { method: 'GET', path: '/items' } };
    expect(commandOf(manifestWith([plain]), 'list_items').transform).toBeNull();
  });

  it('manifestFromTools keeps a person\u2019s stored reference across a connection test', () => {
    const existing = manifestWith([
      { name: 'gmail_read', action: 'gmail.read', effect: 'read', mcp: 'read_message', transform: 'gmail_message' },
      { name: 'plain_read', action: 'x.read', effect: 'read', mcp: 'plain_tool' },
    ]);
    const rebuilt = cm.manifestFromTools([
      { name: 'read_message', description: 'Read', readOnly: true },
      { name: 'plain_tool', description: 'Plain', readOnly: true },
    ], existing);
    const byName = Object.fromEntries((rebuilt.commands as { name: string; transform?: string }[]).map((c) => [c.name, c.transform]));
    expect(byName.gmail_read).toBe('gmail_message');
    expect(byName.plain_read).toBeUndefined();
  });

  it('the three name lists agree: the grammar\u2019s, the registry\u2019s, the web twin\u2019s', () => {
    expect([...cm.RESPONSE_TRANSFORM_NAMES].sort()).toEqual([...mt.RESPONSE_TRANSFORM_NAMES].sort());
    // The twin accepts exactly the registry's names in its projection,
    // and drops a command naming anything else, as the server does.
    for (const name of mt.RESPONSE_TRANSFORM_NAMES) {
      const content = { name: 'Gmail', endpoint: 'https://gmail.googleapis.com', auth_type: 'oauth', auth_header: null, guide: null, manifest: manifestWith([{ ...READ_WITH_TRANSFORM, transform: name }]) };
      expect((cd.draftStructureOf(content).commands as { transform: string }[])[0].transform).toBe(name);
      expect(draftStructureOfWeb(content as DraftContentLike)).toEqual(cd.draftStructureOf(content));
    }
    const bogus = { name: 'Gmail', endpoint: 'https://gmail.googleapis.com', auth_type: 'oauth', auth_header: null, guide: null, manifest: manifestWith([{ ...READ_WITH_TRANSFORM, transform: 'nope' }]) };
    expect(cd.draftStructureOf(bogus).commands).toEqual([]);
    expect(draftStructureOfWeb(bogus as DraftContentLike)).toEqual(cd.draftStructureOf(bogus));
  });
});

describe('the hashes and the drafting ban (P1T)', () => {
  const content = (manifest: unknown) => ({
    name: 'Gmail', endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me',
    auth_type: 'oauth', auth_header: null, guide: null, manifest,
  });
  const base = manifestWith([READ_WITH_TRANSFORM]);
  const bare = manifestWith([{ ...READ_WITH_TRANSFORM, transform: undefined }]);

  it('the reference is structure, never permission — on both sides of the twin', async () => {
    expect(await cd.draftStructureHash(content(base))).not.toBe(await cd.draftStructureHash(content(bare)));
    expect(await cd.draftPermissionHash(content(base))).toBe(await cd.draftPermissionHash(content(bare)));
    expect(await draftStructureHashWeb(content(base) as DraftContentLike)).toBe(await cd.draftStructureHash(content(base)));
    expect(await draftPermissionHashWeb(content(base) as DraftContentLike)).toBe(await cd.draftPermissionHash(content(base)));
  });

  it('a drafted candidate may not name a transform, though the manifest parses', () => {
    const candidate = {
      name: 'Gmail', endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me',
      authType: 'bearer', authHeader: null, manifest: base, guide: null, testInputs: {}, sources: [],
    };
    const { errors, manifest } = cd.validateDraftCandidate(candidate);
    expect(manifest.commands.map((c: { name: string }) => c.name)).toEqual(['gmail_read']);
    expect(errors.join(' ')).toContain('transform');
    expect(errors.join(' ')).toContain('gmail_read');
  });
});

// ── The executor seam ───────────────────────────────────────────────────

const GMAIL_MANIFEST = manifestWith([
  READ_WITH_TRANSFORM,
  {
    name: 'send_note', action: 'notes.send', effect: 'write',
    input: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'],
    http: { method: 'POST', path: '/notes', body: ['title'] },
    verify: { command: 'gmail_read', expect: { subject: '請求書の件名' } },
  },
]);

const toolOf = (manifest: unknown, over: Record<string, unknown> = {}) => {
  const { manifest: parsed } = cm.parseManifest(manifest);
  return {
    integration: {
      id: 'int-1', name: 'Gmail', kind: 'http',
      endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me',
      auth_type: 'oauth', auth_header: null, delegation: 'approve_each', description: null,
    },
    remote: null,
    command: parsed.commands[0],
    manifest: parsed,
    bind: async () => ({ secret: 'tok', session: null }),
    ...over,
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('executeIntegrationTool: shaping at the seam (P1T)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a live answer is shaped once: the model-facing text is the flat record', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(SIMPLE_MESSAGE));
    const r = await itools.executeIntegrationTool(toolOf(GMAIL_MANIFEST), { id: 'c1', name: 'gmail__gmail_read', input: { id: '18f1a2b3c4d5e6f7' } });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out.subject).toBe('請求書の件名');
    expect(out.body).toBe('来月の請求書を添付します。\nご確認ください。🎉');
  });

  it('an error answer is feedback, not data: it is never shaped', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ error: { code: 500, message: 'boom' } }, 500));
    const r = await itools.executeIntegrationTool(toolOf(GMAIL_MANIFEST), { id: 'c2', name: 'gmail__gmail_read', input: { id: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('HTTP 500');
    expect(r.text).toContain('boom');
  });

  it('a replayed call answers from the record, unshaped — the fixture already holds the shaped string', async () => {
    let binds = 0;
    const tool = toolOf(GMAIL_MANIFEST, {
      bind: async () => { binds++; throw new Error('no vault in tests'); },
      replay: { dispatch: async () => ({ text: 'RECORDED ANSWER', isError: false, replayed: true }) },
    });
    const r = await itools.executeIntegrationTool(tool, { id: 'c3', name: 'gmail__gmail_read', input: { id: '18f1a2b3c4d5e6f7' } });
    expect(r).toEqual({ text: 'RECORDED ANSWER', isError: false, replayed: true });
    expect(binds).toBe(0);
  });

  it('a verify read-back works from the shaped text: a header-only field can be expected', async () => {
    const bodies = [{ ok: true }, SIMPLE_MESSAGE];
    vi.stubGlobal('fetch', async () => jsonResponse(bodies.shift()));
    const { manifest: parsed } = cm.parseManifest(GMAIL_MANIFEST);
    const tool = toolOf(GMAIL_MANIFEST, { command: parsed.commands.find((c: { name: string }) => c.name === 'send_note') });
    const r = await itools.executeIntegrationTool(tool, { id: 'c4', name: 'gmail__send_note', input: { id: '18f1a2b3c4d5e6f7', title: 'x' } });
    // The expectation names `subject` — a field the raw message
    // resource carries only inside its payload headers. It can match
    // only because the read-back was shaped before it was diffed.
    expect(r.verify).toEqual({ ok: true });
    expect(r.isError).toBe(false);
  });
});
