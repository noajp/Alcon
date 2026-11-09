import { describe, expect, it } from 'vitest';
import { oauthProviderOf, presetById, type IntegrationPreset } from '@/AIP/connectors/catalog';
import { completeOAuthReturn, readOAuthReturn, stripOAuthReturn } from '@/AIP/connectors/oauthReturn';

// Google Drive over OAuth (ADR 0035): the pure parts of integration-oauth,
// the token refresh in resolveCredential, and the Drive request builders.
const oauth = await import(new URL('../../supabase/functions/_shared/googleOAuth.ts', import.meta.url).pathname);
const drive = await import(new URL('../../supabase/functions/_shared/googleDrive.ts', import.meta.url).pathname);
const client = await import(new URL('../../supabase/functions/_shared/integrationClient.ts', import.meta.url).pathname);

const INTEGRATION = '5b0c1f7e-3a2d-4e8f-9a6b-1c2d3e4f5a6b';
const DRIVE_ROW = {
  id: INTEGRATION, preset: 'google-drive', kind: 'http', name: 'Google Drive', description: null,
  endpoint: 'https://www.googleapis.com/drive/v3', auth_type: 'oauth', auth_header: null, delegation: 'approve_each',
};
const SECRET = {
  v: 1, provider: 'google', access_token: 'ya29.access', refresh_token: '1//refresh', expires_at: 1_800_000_000_000,
  scope: 'https://www.googleapis.com/auth/drive.file',
};

describe('authorize URL and PKCE', () => {
  it('computes the RFC 7636 appendix B S256 challenge', async () => {
    expect(await oauth.s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('asks Google for drive.file only, offline, with consent and S256', () => {
    const url = new URL(oauth.buildAuthorizeUrl({
      clientId: 'client-1.apps.googleusercontent.com',
      redirectUri: 'https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1.apps.googleusercontent.com',
      redirect_uri: 'https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-abc',
      code_challenge: 'challenge-xyz',
      code_challenge_method: 'S256',
    });
  });

  it('derives the redirect URI from the project URL', () => {
    expect(oauth.redirectUriFor('https://rkugtcqztkkacvoylupw.supabase.co/')).toBe('https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback');
  });

  it('makes verifiers and tickets of the right length and alphabet', () => {
    const v = oauth.randomToken(48);
    expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(oauth.randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauth.randomToken()).not.toBe(oauth.randomToken());
  });

  it('requires drive.file among the granted scopes', () => {
    expect(oauth.hasScope('openid https://www.googleapis.com/auth/drive.file')).toBe(true);
    expect(oauth.hasScope('https://www.googleapis.com/auth/drive.readonly')).toBe(false);
    expect(oauth.hasScope(undefined)).toBe(false);
  });

  it('accepts only google-drive rows that point at Drive and sign in with OAuth', () => {
    expect(oauth.isGoogleDriveRow(DRIVE_ROW)).toBe(true);
    expect(oauth.isGoogleDriveRow({ ...DRIVE_ROW, endpoint: 'https://evil.example.com' })).toBe(false);
    expect(oauth.isGoogleDriveRow({ ...DRIVE_ROW, auth_type: 'bearer' })).toBe(false);
    expect(oauth.isGoogleDriveRow({ ...DRIVE_ROW, kind: 'mcp' })).toBe(false);
    expect(oauth.isGoogleDriveRow({ ...DRIVE_ROW, preset: 'custom-http' })).toBe(false);
    // The catalog preset and the server agree on the endpoint.
    expect(presetById('google-drive')!.endpoint).toBe(oauth.GOOGLE_DRIVE_ENDPOINT);
  });
});

describe('cookie and return URL', () => {
  it('sets the nonce cookie HttpOnly, Secure, Lax, on the function path', () => {
    const c = oauth.nonceCookie('n0nce');
    expect(c).toMatch(/^ioauth=n0nce;/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/functions/v1/integration-oauth', 'Max-Age=600']) expect(c).toContain(part);
    expect(oauth.clearNonceCookie()).toContain('Max-Age=0');
  });

  it('reads one cookie from a header', () => {
    expect(oauth.readCookie('a=1; ioauth=xyz; b=2', 'ioauth')).toBe('xyz');
    expect(oauth.readCookie('ioauthx=1', 'ioauth')).toBeNull();
    expect(oauth.readCookie(null, 'ioauth')).toBeNull();
  });

  const HANDLE = 'h'.repeat(20) + '_-' + 'K'.repeat(21);

  it('returns to the app that started the sign-in only when it is allowed', () => {
    const app = 'https://alcon.example.com';
    expect(oauth.returnOrigin('https://alcon.example.com', app, null)).toBe(app);
    expect(oauth.returnOrigin('http://localhost:3000', app, null)).toBe('http://localhost:3000');
    expect(oauth.returnOrigin('http://127.0.0.1:3001', app, null)).toBe('http://127.0.0.1:3001');
    expect(oauth.returnOrigin('https://preview-1.example.app', app, 'https://preview-1.example.app, https://x.example')).toBe('https://preview-1.example.app');
    // Anything else, or nothing usable, goes back to the app.
    expect(oauth.returnOrigin('https://evil.example', app, 'https://preview-1.example.app')).toBe(app);
    expect(oauth.returnOrigin('http://evil.example', app, 'http://evil.example')).toBe(app);
    expect(oauth.returnOrigin('https://alcon.example.com/next', app, null)).toBe(app);
    expect(oauth.returnOrigin(42, app, null)).toBe(app);
    expect(oauth.returnOrigin(undefined, null, null)).toBeNull();
  });

  it('returns only to a bare https app origin, with the completion handle on finish', () => {
    expect(oauth.appReturnUrl('https://alcon.example.com', 'finish', INTEGRATION, HANDLE))
      .toBe(`https://alcon.example.com/?integration_oauth=finish&integration=${INTEGRATION}&handle=${HANDLE}`);
    expect(oauth.appReturnUrl('https://alcon.example.com/', 'error', 'not-a-uuid')).toBe('https://alcon.example.com/?integration_oauth=error');
    expect(oauth.appReturnUrl('http://localhost:3000', 'error', null)).toBe('http://localhost:3000/?integration_oauth=error');
    // finish without a well-formed handle is not a return URL at all.
    expect(oauth.appReturnUrl('https://alcon.example.com', 'finish', INTEGRATION)).toBeNull();
    expect(oauth.appReturnUrl('https://alcon.example.com', 'finish', INTEGRATION, 'short')).toBeNull();
    expect(oauth.appReturnUrl('http://alcon.example.com', 'error', null)).toBeNull();
    expect(oauth.appReturnUrl('https://alcon.example.com/next?x=1', 'error', null)).toBeNull();
    expect(oauth.appReturnUrl('', 'error', null)).toBeNull();
    expect(oauth.appReturnUrl(undefined, 'finish', null, HANDLE)).toBeNull();
    expect(oauth.appOrigin('https://alcon.example.com/')).toBe('https://alcon.example.com');
    expect(oauth.appOrigin('https://user:pw@alcon.example.com')).toBeNull();
  });

  it('reads and strips the result on the app side', () => {
    expect(readOAuthReturn(`?integration_oauth=finish&integration=${INTEGRATION}&handle=${HANDLE}`)).toEqual({ kind: 'finish', handle: HANDLE, integrationId: INTEGRATION });
    expect(readOAuthReturn('?integration_oauth=finish&handle=bad')).toEqual({ kind: 'error', integrationId: null });
    expect(readOAuthReturn('?integration_oauth=error&integration=x')).toEqual({ kind: 'error', integrationId: null });
    expect(readOAuthReturn('?integration_oauth=ok')).toBeNull();
    expect(readOAuthReturn('')).toBeNull();
    expect(stripOAuthReturn(`https://app.example.com/?a=1&integration_oauth=finish&integration=${INTEGRATION}&handle=${HANDLE}#h`)).toBe('/?a=1#h');
    expect(stripOAuthReturn('https://app.example.com/?integration_oauth=error')).toBe('/');
  });

  it('confirms a finish once and records the outcome', async () => {
    const calls: string[] = [];
    const finish = async (h: string) => { calls.push(h); return INTEGRATION; };
    const ret = { kind: 'finish' as const, handle: HANDLE, integrationId: null };
    await Promise.all([completeOAuthReturn(ret, finish), completeOAuthReturn(ret, finish)]);
    expect(calls).toEqual([HANDLE]);
    const failing = async () => { throw new Error('This sign-in was started by someone else, so it was discarded.'); };
    const outcomes: unknown[] = [];
    await completeOAuthReturn({ kind: 'finish', handle: HANDLE.replace('h', 'j'), integrationId: INTEGRATION }, async (h) => {
      outcomes.push(h);
      return failing();
    });
    expect(outcomes).toHaveLength(1);
  });
});

describe('finishing a sign-in', () => {
  const NOW = 1_800_000_000_000;
  const LATER = new Date(NOW + 60_000).toISOString();
  const EARLIER = new Date(NOW - 1).toISOString();
  const STARTER = '60b10d95-f1d7-40dc-9d59-0836f4ae333c';
  const OTHER = '11111111-2222-4333-8444-555555555555';

  it('stores only for the person who started it, before it expires', () => {
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: STARTER, expiresAt: LATER, nowMs: NOW })).toBe('ok');
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: OTHER, expiresAt: LATER, nowMs: NOW })).toBe('wrong_user');
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: STARTER, expiresAt: EARLIER, nowMs: NOW })).toBe('expired');
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: OTHER, expiresAt: EARLIER, nowMs: NOW })).toBe('wrong_user');
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: null, expiresAt: LATER, nowMs: NOW })).toBe('wrong_user');
    expect(oauth.finishDecision({ flowUserId: null, callerId: null, expiresAt: LATER, nowMs: NOW })).toBe('wrong_user');
    expect(oauth.finishDecision({ flowUserId: STARTER, callerId: STARTER, expiresAt: null, nowMs: NOW })).toBe('expired');
  });

  it('treats a missing, unreadable or past deadline as expired', () => {
    expect(oauth.isExpired(new Date(NOW).toISOString(), NOW)).toBe(true);
    expect(oauth.isExpired(new Date(NOW + 1).toISOString(), NOW)).toBe(false);
    expect(oauth.isExpired('not a date', NOW)).toBe(true);
    expect(oauth.isExpired(undefined, NOW)).toBe(true);
    expect(oauth.COMPLETION_TTL_MS).toBe(10 * 60_000);
  });

  it('keeps only the hash of the handle, and the hash is stable', async () => {
    const handle = oauth.randomToken();
    const hash = await oauth.sha256Hex(handle);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await oauth.sha256Hex(handle)).toBe(hash);
    expect(hash).not.toContain(handle);
    expect(await oauth.sha256Hex(oauth.randomToken())).not.toBe(hash);
  });
});

describe('stored secret', () => {
  it('parses a well-formed secret from JSON or an object', () => {
    expect(oauth.parseOAuthSecret(JSON.stringify(SECRET))).toEqual(SECRET);
    expect(oauth.parseOAuthSecret(SECRET)).toEqual(SECRET);
  });

  it('rejects malformed input', () => {
    for (const bad of [
      null, undefined, '', 'not json', '[]', 42, 'ya29.plain-token',
      { ...SECRET, v: 2 },
      { ...SECRET, provider: 'microsoft' },
      { ...SECRET, access_token: '' },
      { ...SECRET, refresh_token: undefined },
      { ...SECRET, expires_at: '1800000000000' },
      { ...SECRET, expires_at: Number.NaN },
      { ...SECRET, scope: null },
    ]) expect(oauth.parseOAuthSecret(bad), JSON.stringify(bad)).toBeNull();
  });

  it('refreshes two minutes before expiry, and when already expired', () => {
    const exp = 1_000_000;
    expect(oauth.needsRefresh({ expires_at: exp }, exp - 120_001)).toBe(false);
    expect(oauth.needsRefresh({ expires_at: exp }, exp - 120_000)).toBe(true);
    expect(oauth.needsRefresh({ expires_at: exp }, exp)).toBe(true);
    expect(oauth.needsRefresh({ expires_at: exp }, exp + 1)).toBe(true);
    expect(oauth.needsRefresh({ expires_at: exp }, exp - 10_001, 10_000)).toBe(false);
    expect(oauth.needsRefresh({ expires_at: exp }, exp - 10_000, 10_000)).toBe(true);
  });

  it('keeps the refresh token and scope when a refresh response omits them', () => {
    const now = 1_000_000;
    expect(oauth.secretFromTokenResponse({ access_token: 'new', expires_in: 3599 }, now, SECRET))
      .toEqual({ ...SECRET, access_token: 'new', expires_at: now + 3_599_000 });
    expect(oauth.secretFromTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 10, scope: 's' }, now))
      .toEqual({ v: 1, provider: 'google', access_token: 'a', refresh_token: 'r', expires_at: now + 10_000, scope: 's' });
    expect(oauth.secretFromTokenResponse({ access_token: 'a' }, now)).toBeNull();
    expect(oauth.secretFromTokenResponse({ error: 'invalid_grant' }, now, SECRET)).toBeNull();
  });
});

describe('resolveCredential', () => {
  function fakeAdmin(written = true) {
    const calls: { rpc: [string, Record<string, unknown>][]; updates: [Record<string, unknown>, string][] } = { rpc: [], updates: [] };
    const admin = {
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.rpc.push([fn, args]); return { data: written, error: null }; },
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => { calls.updates.push([values, id]); return { error: null }; },
        }),
      }),
    };
    return { admin, calls };
  }
  const CLIENT = { clientId: 'cid', clientSecret: 'csecret' };

  it('passes non-OAuth credentials through', async () => {
    const { admin } = fakeAdmin();
    expect(await client.resolveCredential(admin, { ...DRIVE_ROW, preset: 'asana', auth_type: 'bearer' }, 'tok')).toBe('tok');
    expect(await client.resolveCredential(admin, { ...DRIVE_ROW, preset: 'asana', auth_type: 'bearer' }, '')).toBeNull();
  });

  it('gives nothing for an OAuth row that is not Google Drive, or a malformed secret', async () => {
    const { admin } = fakeAdmin();
    expect(await client.resolveCredential(admin, { ...DRIVE_ROW, endpoint: 'https://evil.example.com' }, JSON.stringify(SECRET))).toBeNull();
    expect(await client.resolveCredential(admin, DRIVE_ROW, 'ya29.plain')).toBeNull();
  });

  it('uses a fresh token as it is', async () => {
    const { admin, calls } = fakeAdmin();
    const fetchImpl = async () => { throw new Error('no network expected'); };
    expect(await client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now: SECRET.expires_at - 600_000, client: CLIENT, fetchImpl })).toBe('ya29.access');
    expect(calls.rpc).toEqual([]);
  });

  it('refreshes a token about to expire and stores the new set', async () => {
    const { admin, calls } = fakeAdmin();
    let sent: { url: string; body: string } | null = null;
    const fetchImpl = async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return new Response(JSON.stringify({ access_token: 'ya29.new', expires_in: 3600 }), { status: 200 });
    };
    const now = SECRET.expires_at - 60_000;
    expect(await client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now, client: CLIENT, fetchImpl })).toBe('ya29.new');
    expect(sent!.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(sent!.body))).toEqual({
      grant_type: 'refresh_token', refresh_token: '1//refresh', client_id: 'cid', client_secret: 'csecret',
    });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0][0]).toBe('store_integration_oauth_token');
    expect(JSON.parse(String(calls.rpc[0][1].p_secret))).toEqual({ ...SECRET, access_token: 'ya29.new', expires_at: now + 3_600_000 });
    // The write is conditional on the refresh token it started from.
    expect(calls.rpc[0][1].p_expected_refresh_hash).toBe(await oauth.sha256Hex('1//refresh'));
  });

  it('gives no token when the connection changed while refreshing', async () => {
    const { admin, calls } = fakeAdmin(false);
    const fetchImpl = async () => new Response(JSON.stringify({ access_token: 'ya29.late', expires_in: 3600 }), { status: 200 });
    expect(await client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now: SECRET.expires_at, client: CLIENT, fetchImpl })).toBeNull();
    expect(calls.rpc).toHaveLength(1);
  });

  it('marks the connection expired when Google refuses the refresh token', async () => {
    const { admin, calls } = fakeAdmin();
    const fetchImpl = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    expect(await client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now: SECRET.expires_at, client: CLIENT, fetchImpl })).toBeNull();
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0][1]).toBe(INTEGRATION);
    expect(calls.updates[0][0].last_test).toMatchObject({ ok: false, code: 'oauth_expired' });
    expect(calls.rpc).toEqual([]);
  });

  it('throws on other refresh failures and gives nothing without a client', async () => {
    const { admin } = fakeAdmin();
    const fetchImpl = async () => new Response('oops', { status: 503 });
    await expect(client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now: SECRET.expires_at, client: CLIENT, fetchImpl })).rejects.toThrow(/HTTP 503/);
    expect(await client.resolveCredential(admin, DRIVE_ROW, JSON.stringify(SECRET), { now: SECRET.expires_at, client: null })).toBeNull();
  });
});

describe('Drive request builders', () => {
  const FILE = '1AbCdEfGhIjKlMnOp_-x';

  it('classifies reads and writes', () => {
    expect(drive.DRIVE_TOOLS.map((t: { name: string }) => t.name)).toEqual(['drive_search', 'drive_read', 'drive_create', 'drive_update', 'drive_create_folder']);
    expect(drive.isDriveReadTool('drive_search')).toBe(true);
    expect(drive.isDriveReadTool('drive_read')).toBe(true);
    for (const w of ['drive_create', 'drive_update', 'drive_create_folder', 'http_request']) expect(drive.isDriveReadTool(w)).toBe(false);
    for (const t of drive.DRIVE_TOOLS) {
      expect(t.readOnly).toBe(drive.isDriveReadTool(t.name));
      expect(t.description).toContain('drive.file');
    }
  });

  it('searches files, excluding trash, with the text escaped', () => {
    const r = drive.buildSearchRequest({ text: "Q3 'plan' \\ notes", page_size: 500 });
    const u = new URL(r.url);
    expect(r.method).toBe('GET');
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(u.searchParams.get('q')).toBe("trashed = false and (name contains 'Q3 \\'plan\\' \\\\ notes' or fullText contains 'Q3 \\'plan\\' \\\\ notes')");
    expect(u.searchParams.get('fields')).toBe('files(id,name,mimeType,webViewLink,modifiedTime)');
    expect(u.searchParams.get('pageSize')).toBe('100');
  });

  it('exports Docs as text, Sheets as CSV, and reads text files as media', () => {
    expect(drive.buildContentRequest(FILE, drive.DOC_MIME).url).toBe(`https://www.googleapis.com/drive/v3/files/${FILE}/export?mimeType=text%2Fplain`);
    expect(drive.buildContentRequest(FILE, drive.SHEET_MIME).url).toBe(`https://www.googleapis.com/drive/v3/files/${FILE}/export?mimeType=text%2Fcsv`);
    expect(drive.buildContentRequest(FILE, 'text/markdown').url).toBe(`https://www.googleapis.com/drive/v3/files/${FILE}?alt=media`);
    expect(() => drive.buildContentRequest(FILE, 'image/png')).toThrow(/not text/);
    expect(() => drive.buildContentRequest(FILE, 'application/vnd.google-apps.form')).toThrow(/cannot be read/);
  });

  it('refuses a file id that is not one', () => {
    for (const bad of ['', 'short', '../../files', 'abc/def/ghi', 'https://evil.example.com', 'a b c d e f g h', 42, null]) {
      expect(() => drive.buildMetadataRequest(bad), String(bad)).toThrow(/file id/);
      expect(() => drive.buildUpdateRequest({ file_id: bad, name: 'x' }), String(bad)).toThrow(/file id/);
    }
    expect(() => drive.buildCreateRequest({ name: 'a', kind: 'text', content: '', parent_id: '../x' })).toThrow(/parent_id/);
    expect(() => drive.buildCreateFolderRequest({ name: 'a', parent_id: 'x?y=1' })).toThrow(/parent_id/);
  });

  it('builds a multipart create with the right boundary and mime types', () => {
    const r = drive.buildCreateRequest({ name: 'Brief', kind: 'html', content: '<h1>Hi</h1>', parent_id: FILE }, 'BOUNDARY1');
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink');
    expect(r.headers['content-type']).toBe('multipart/related; boundary=BOUNDARY1');
    expect(r.body).toBe([
      '--BOUNDARY1',
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: 'Brief', mimeType: 'application/vnd.google-apps.document', parents: [FILE] }),
      '--BOUNDARY1',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<h1>Hi</h1>',
      '--BOUNDARY1--',
      '',
    ].join('\r\n'));
  });

  it('maps content kinds to what Drive stores', () => {
    expect(drive.CONTENT_KINDS).toEqual({
      html: { media: 'text/html', target: 'application/vnd.google-apps.document' },
      csv: { media: 'text/csv', target: 'application/vnd.google-apps.spreadsheet' },
      text: { media: 'text/plain', target: 'text/plain' },
    });
    const sheet = drive.buildCreateRequest({ name: 'Data', kind: 'csv', content: 'a,b\n1,2' }, 'B');
    expect(sheet.body).toContain('"mimeType":"application/vnd.google-apps.spreadsheet"');
    expect(sheet.body).toContain('Content-Type: text/csv; charset=UTF-8');
    expect(sheet.body).not.toContain('parents');
    expect(() => drive.buildCreateRequest({ name: 'x', kind: 'pdf', content: '' })).toThrow(/kind/);
    expect(() => drive.buildCreateRequest({ name: ' ', kind: 'text', content: '' })).toThrow(/name/);
  });

  it('refuses content that contains the boundary', () => {
    expect(() => drive.buildCreateRequest({ name: 'x', kind: 'text', content: 'a --B b' }, 'B')).toThrow(/boundary/);
    expect(drive.newBoundary()).toMatch(/^alcon_[0-9a-f]{32}$/);
  });

  it('updates content with a multipart PATCH, or renames with JSON', () => {
    const r = drive.buildUpdateRequest({ file_id: FILE, kind: 'text', content: 'new body' }, 'B2');
    expect(r.method).toBe('PATCH');
    expect(r.url).toBe(`https://www.googleapis.com/upload/drive/v3/files/${FILE}?uploadType=multipart&fields=id,name,webViewLink`);
    expect(r.body).toContain('Content-Type: text/plain; charset=UTF-8\r\n\r\nnew body\r\n--B2--');
    const rename = drive.buildUpdateRequest({ file_id: FILE, name: 'Renamed' });
    expect(rename).toMatchObject({ method: 'PATCH', url: `https://www.googleapis.com/drive/v3/files/${FILE}?fields=id,name,webViewLink`, body: '{"name":"Renamed"}' });
    expect(() => drive.buildUpdateRequest({ file_id: FILE })).toThrow(/content|name/);
  });

  it('creates folders', () => {
    const r = drive.buildCreateFolderRequest({ name: 'Reports' });
    expect(r).toMatchObject({ method: 'POST', url: 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink' });
    expect(JSON.parse(r.body)).toEqual({ name: 'Reports', mimeType: 'application/vnd.google-apps.folder' });
  });

  it('keeps every request on www.googleapis.com over https', () => {
    const requests = [
      drive.buildSearchRequest({ query: "name = 'x'" }),
      drive.buildMetadataRequest(FILE),
      drive.buildContentRequest(FILE, drive.DOC_MIME),
      drive.buildContentRequest(FILE, 'text/plain'),
      drive.buildCreateRequest({ name: 'a', kind: 'text', content: 'b' }),
      drive.buildUpdateRequest({ file_id: FILE, kind: 'csv', content: 'c' }),
      drive.buildUpdateRequest({ file_id: FILE, name: 'n' }),
      drive.buildCreateFolderRequest({ name: 'f' }),
    ];
    for (const r of requests) {
      const u = new URL(r.url);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe('www.googleapis.com');
    }
  });

  it('sends the token only to googleapis and reports errors as text', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      if (url.includes('fields=id,name,mimeType,size')) return new Response(JSON.stringify({ name: 'Doc', mimeType: drive.DOC_MIME }), { status: 200 });
      return new Response('hello world', { status: 200 });
    };
    const r = await drive.runDriveTool('drive_read', { file_id: FILE }, 'ya29.t', fetchImpl);
    expect(r).toEqual({ text: expect.stringContaining('hello world'), isError: false });
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(['www.googleapis.com', 'www.googleapis.com']);
    expect(seen.every((s) => s.auth === 'Bearer ya29.t')).toBe(true);
    const bad = await drive.runDriveTool('drive_read', { file_id: '../x' }, 'ya29.t', fetchImpl);
    expect(bad.isError).toBe(true);
    const denied = await drive.runDriveTool('drive_search', {}, 'ya29.t', async () => new Response('{"error":{"message":"Insufficient permissions"}}', { status: 403 }));
    expect(denied).toEqual({ text: 'Google Drive: HTTP 403 Insufficient permissions', isError: true });
  });
});

// GitHub sign-in: the same flow as Google, with GitHub's URLs, scope and secret.
const gh = await import(new URL('../../supabase/functions/_shared/githubOAuth.ts', import.meta.url).pathname);

const GITHUB_ROW = {
  id: INTEGRATION, preset: 'github', kind: 'mcp', name: 'GitHub', description: null,
  endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', auth_header: null, delegation: 'approve_each',
};

describe('GitHub sign-in', () => {
  it('asks GitHub for repo, with S256 and no sign-up', () => {
    const u = new URL(gh.buildGithubAuthorizeUrl({ clientId: 'Iv1.abc', redirectUri: 'https://x.supabase.co/functions/v1/integration-oauth/callback', state: 's', codeChallenge: 'c' }));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ scope: 'repo', state: 's', code_challenge: 'c', code_challenge_method: 'S256', allow_signup: 'false' });
  });

  it('signs in only the GitHub preset row, and the catalog row is that row', () => {
    expect(gh.isGithubOAuthRow(GITHUB_ROW)).toBe(true);
    expect(gh.isGithubOAuthRow({ ...GITHUB_ROW, auth_type: 'bearer' })).toBe(false);
    expect(gh.isGithubOAuthRow({ ...GITHUB_ROW, endpoint: 'https://evil.example.com/mcp/' })).toBe(false);
    expect(gh.isGithubOAuthRow(DRIVE_ROW)).toBe(false);
    const preset = presetById('github')!;
    expect(gh.isGithubOAuthRow({ preset: preset.id, kind: preset.kind, auth_type: preset.auth, endpoint: preset.endpoint })).toBe(true);
  });

  it('keeps a token response only with a token, and reads GitHub scope lists', () => {
    expect(gh.githubSecretFromTokenResponse({ access_token: 'gho_x', scope: 'repo,read:user', token_type: 'bearer' }))
      .toEqual({ v: 1, provider: 'github', access_token: 'gho_x', scope: 'repo,read:user' });
    expect(gh.githubSecretFromTokenResponse({ error: 'bad_verification_code' })).toBeNull();
    expect(gh.githubHasScope('repo,read:user')).toBe(true);
    expect(gh.githubHasScope('public_repo')).toBe(false);
  });

  it('resolves a GitHub row to its access token and never to a Google secret', async () => {
    // A GitHub token is used as stored: nothing is read or written back.
    const admin = {};
    const secret = JSON.stringify({ v: 1, provider: 'github', access_token: 'gho_x', scope: 'repo' });
    expect(await client.resolveCredential(admin, GITHUB_ROW, secret)).toBe('gho_x');
    expect(await client.resolveCredential(admin, GITHUB_ROW, JSON.stringify(SECRET))).toBeNull();
    expect(await client.resolveCredential(admin, GITHUB_ROW, 'gho_plain')).toBeNull();
  });
});

// Provider profiles (P0): what differs between Google services lives in
// one table — the row each profile claims, its scopes, its account check.
// Drive's profile carries exactly the values the flow was hard-wired to,
// and Gmail's first stage asks to read only (D1).
const GMAIL_ROW = {
  id: INTEGRATION, preset: 'gmail', kind: 'http', name: 'Gmail', description: null,
  endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me', auth_type: 'oauth', auth_header: null, delegation: 'approve_each',
};
const GMAIL_SECRET = { ...SECRET, scope: 'https://www.googleapis.com/auth/gmail.readonly' };

describe('Google provider profiles', () => {
  it('claims each row by preset and endpoint together', () => {
    expect(oauth.googleProfileOf(DRIVE_ROW)).toBe(oauth.GOOGLE_DRIVE_PROFILE);
    expect(oauth.googleProfileOf(GMAIL_ROW)).toBe(oauth.GOOGLE_GMAIL_PROFILE);
    // A preset at another profile's endpoint (or the reverse) is no profile's row.
    expect(oauth.googleProfileOf({ ...GMAIL_ROW, endpoint: oauth.GOOGLE_DRIVE_ENDPOINT })).toBeNull();
    expect(oauth.googleProfileOf({ ...DRIVE_ROW, endpoint: oauth.GOOGLE_GMAIL_ENDPOINT })).toBeNull();
    expect(oauth.googleProfileOf({ ...GMAIL_ROW, kind: 'mcp' })).toBeNull();
    expect(oauth.googleProfileOf({ ...GMAIL_ROW, auth_type: 'bearer' })).toBeNull();
    expect(oauth.googleProfileOf({ ...GMAIL_ROW, preset: 'custom-http' })).toBeNull();
    expect(oauth.googleProfileOf(null)).toBeNull();
    expect(oauth.googleProfileOf(undefined)).toBeNull();
  });

  it('keeps Drive acceptance exactly the Drive profile, and widens only the Google question', () => {
    expect(oauth.isGoogleOAuthRow(DRIVE_ROW)).toBe(true);
    expect(oauth.isGoogleOAuthRow(GMAIL_ROW)).toBe(true);
    expect(oauth.isGoogleDriveRow(GMAIL_ROW)).toBe(false);
    expect(oauth.isGoogleOAuthRow(GITHUB_ROW)).toBe(false);
    expect(oauth.isGoogleOAuthRow({ ...DRIVE_ROW, endpoint: 'https://evil.example.com' })).toBe(false);
  });

  it('holds the scopes each profile requires — Drive’s one, Gmail read-only at the first stage', () => {
    expect(oauth.GOOGLE_DRIVE_PROFILE.scopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
    expect(oauth.GOOGLE_GMAIL_PROFILE.scopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(oauth.GOOGLE_GMAIL_PROFILE.includeGrantedScopes).toBe(true);
    expect(oauth.GOOGLE_DRIVE_PROFILE.includeGrantedScopes).toBe(false);
    expect(oauth.grantsRequiredScopes('openid https://www.googleapis.com/auth/drive.file', oauth.GOOGLE_DRIVE_PROFILE)).toBe(true);
    expect(oauth.grantsRequiredScopes('https://www.googleapis.com/auth/drive.readonly', oauth.GOOGLE_DRIVE_PROFILE)).toBe(false);
    expect(oauth.grantsRequiredScopes('https://www.googleapis.com/auth/gmail.readonly', oauth.GOOGLE_GMAIL_PROFILE)).toBe(true);
    expect(oauth.grantsRequiredScopes('https://www.googleapis.com/auth/drive.file', oauth.GOOGLE_GMAIL_PROFILE)).toBe(false);
    expect(oauth.grantsRequiredScopes(undefined, oauth.GOOGLE_DRIVE_PROFILE)).toBe(false);
  });

  it('builds the same authorize URL for Drive with the profile spelled out as by default', () => {
    const base = {
      clientId: 'client-1.apps.googleusercontent.com',
      redirectUri: 'https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
    };
    expect(oauth.buildAuthorizeUrl({ ...base, profile: oauth.GOOGLE_DRIVE_PROFILE })).toBe(oauth.buildAuthorizeUrl(base));
    expect(new URL(oauth.buildAuthorizeUrl(base)).searchParams.has('include_granted_scopes')).toBe(false);
  });

  it('asks for Gmail read-only, keeping earlier grants for the staged consent', () => {
    const url = new URL(oauth.buildAuthorizeUrl({
      clientId: 'client-1.apps.googleusercontent.com',
      redirectUri: 'https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
      profile: oauth.GOOGLE_GMAIL_PROFILE,
    }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1.apps.googleusercontent.com',
      redirect_uri: 'https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: 'state-abc',
      code_challenge: 'challenge-xyz',
      code_challenge_method: 'S256',
    });
  });

  it('reads the account email from each profile’s own answer shape', () => {
    expect(oauth.GOOGLE_DRIVE_PROFILE.accountCheck.url).toBe(oauth.GOOGLE_ABOUT_URL);
    expect(oauth.GOOGLE_GMAIL_PROFILE.accountCheck.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile');
    expect(oauth.GOOGLE_GMAIL_PROFILE.endpoint).toBe(oauth.GOOGLE_GMAIL_ENDPOINT);
    const drive = oauth.GOOGLE_DRIVE_PROFILE.accountCheck.emailOf;
    const gmail = oauth.GOOGLE_GMAIL_PROFILE.accountCheck.emailOf;
    expect(drive({ user: { emailAddress: 'a@example.com' } })).toBe('a@example.com');
    expect(drive({ emailAddress: 'a@example.com' })).toBeNull();
    expect(drive({ user: {} })).toBeNull();
    expect(drive(null)).toBeNull();
    expect(gmail({ emailAddress: 'a@example.com', messagesTotal: 12 })).toBe('a@example.com');
    expect(gmail({ user: { emailAddress: 'a@example.com' } })).toBeNull();
    expect(gmail({ emailAddress: 42 })).toBeNull();
    // The cap the sign-in flow has always applied to a read address.
    expect(gmail({ emailAddress: 'x'.repeat(321) })).toBeNull();
  });

  it('maps a Gmail-shaped OAuth preset to the Google sign-in on the web side', () => {
    const gmailPreset: IntegrationPreset = {
      id: 'gmail', name: 'Gmail', icon: null, kind: 'http', endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me', auth: 'oauth',
      description: 'Read Gmail.', credentialLabel: 'Google account', category: 'communication', source: 'official',
      builtBy: 'Google', featured: false, custom: false,
    };
    expect(oauthProviderOf(gmailPreset)).toBe('google');
    expect(gmailPreset.endpoint).toBe(oauth.GOOGLE_GMAIL_ENDPOINT);
  });

  it('resolves a Gmail row’s credential through the same refresh path as Drive’s', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const admin = {
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: true, error: null }; },
      from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    };
    const CLIENT = { clientId: 'cid', clientSecret: 'csecret' };
    const noFetch = async () => { throw new Error('no network expected'); };
    // Fresh: used as stored, no refresh.
    expect(await client.resolveCredential(admin, GMAIL_ROW, JSON.stringify(GMAIL_SECRET), { now: GMAIL_SECRET.expires_at - 600_000, client: CLIENT, fetchImpl: noFetch })).toBe('ya29.access');
    // Due: refreshed and stored, exactly as a Drive row is.
    const fetchImpl = async () => new Response(JSON.stringify({ access_token: 'ya29.new', expires_in: 3600 }), { status: 200 });
    const now = GMAIL_SECRET.expires_at - 60_000;
    expect(await client.resolveCredential(admin, GMAIL_ROW, JSON.stringify(GMAIL_SECRET), { now, client: CLIENT, fetchImpl })).toBe('ya29.new');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('store_integration_oauth_token');
    expect(JSON.parse(String(calls[0][1].p_secret))).toEqual({ ...GMAIL_SECRET, access_token: 'ya29.new', expires_at: now + 3_600_000 });
    // A row no profile claims (preset and endpoint disagreeing) gets nothing.
    expect(await client.resolveCredential(admin, { ...GMAIL_ROW, endpoint: 'https://www.googleapis.com/drive/v3' }, JSON.stringify(GMAIL_SECRET), { now, client: CLIENT, fetchImpl })).toBeNull();
  });
});
