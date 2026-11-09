import { describe, expect, it } from 'vitest';
import { GMAIL_MANIFEST } from '@/AIP/connectors/gmailManifest';
import {
  canonicalJson, draftPermissionHashWeb, draftStructureHashWeb, draftStructureOfWeb,
} from '@/AIP/connectors/draftModel';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const cd = await import(new URL('../../supabase/functions/_shared/connectorDraft.ts', import.meta.url).pathname);
const gm = await import(new URL('../../supabase/functions/_shared/gmailManifest.ts', import.meta.url).pathname);
const oauth = await import(new URL('../../supabase/functions/_shared/googleOAuth.ts', import.meta.url).pathname);
const it8 = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);

// The Gmail read pair (Sim prototype P1; design §3): Sim's gmail_search /
// gmail_read translated into manifest declarations and bundled with the
// first-party gmail preset. The manifest exists twice — the browser
// writes it into the row at creation, the server declares the same
// content — and the two must agree in every way that binds: the raw
// content, and the structure / permission hashes a review compares.
// The commands parse clean under the engine's own grammar, their
// requests build the Gmail API calls the design spells, and a
// connection test's manifest rebuild (manifestFromTools) leaves the
// declared pair — transform reference included — exactly as stored.

const ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const content = (manifest: unknown) => ({
  name: 'Gmail', endpoint: ENDPOINT, auth_type: 'oauth', auth_header: null, manifest, guide: null,
});

describe('the gmail manifest twins', () => {
  it('hold the same content on the web and the server', () => {
    expect(canonicalJson(GMAIL_MANIFEST)).toBe(canonicalJson(gm.GMAIL_MANIFEST));
  });

  it('hash the same under the structure and permission projections', async () => {
    await expect(draftStructureHashWeb(content(GMAIL_MANIFEST)))
      .resolves.toBe(await cd.draftStructureHash(cd.draftContentOf(content(gm.GMAIL_MANIFEST))));
    await expect(draftPermissionHashWeb(content(GMAIL_MANIFEST)))
      .resolves.toBe(await cd.draftPermissionHash(cd.draftContentOf(content(gm.GMAIL_MANIFEST))));
  });

  it('sit at the endpoint the Gmail OAuth profile claims', () => {
    expect(ENDPOINT).toBe(oauth.GOOGLE_GMAIL_ENDPOINT);
    expect(oauth.GOOGLE_GMAIL_PROFILE.endpoint).toBe(ENDPOINT);
  });
});

describe('the translated read pair', () => {
  const { manifest, errors } = cm.parseManifest(gm.GMAIL_MANIFEST);

  it('parses clean: two declared reads, both offered', () => {
    expect(errors).toEqual([]);
    expect(manifest.commands.map((c: { name: string }) => c.name)).toEqual(['gmail_search', 'gmail_read']);
    expect(cm.offeredCommands(manifest)).toHaveLength(2);
    for (const c of manifest.commands) {
      expect(c.effect).toBe('read');
      expect(c.permission).toBe('allow');
      expect(c.mcp).toBeNull();
    }
  });

  it('gmail_search is GET /messages with the query as q', () => {
    const search = manifest.commands[0];
    expect(search.http).toEqual({ method: 'GET', path: '/messages', query: ['q', 'maxResults'], body: [] });
    expect(search.required).toEqual(['q']);
    expect(search.transform).toBeNull();
    expect(cm.commandSchema(search)).toEqual({
      type: 'object',
      properties: {
        q: { type: 'string', description: 'The search query, in Gmail search syntax (the API\'s q parameter).' },
        maxResults: { type: 'number', description: 'The most messages to list. When omitted, the service\'s own page size applies (up to 100).' },
      },
      required: ['q'],
      additionalProperties: false,
    });
  });

  it('gmail_read is GET /messages/{id} shaped by gmail_message', () => {
    const read = manifest.commands[1];
    expect(read.http).toEqual({ method: 'GET', path: '/messages/{id}', query: ['format'], body: [] });
    expect(read.required).toEqual(['id']);
    expect(read.transform).toBe('gmail_message');
  });

  it('carries no write, so nothing in it can be critical', () => {
    for (const c of manifest.commands) expect(cm.criticalClassOf(c)).toBeNull();
  });
});

describe('request construction', () => {
  const { manifest } = cm.parseManifest(gm.GMAIL_MANIFEST);
  const [search, read] = manifest.commands;

  it('builds the search call, with and without a page size', () => {
    expect(cm.requestFor(search, { q: 'in:inbox is:unread', maxResults: 10 }))
      .toEqual({ method: 'GET', path: '/messages', query: { q: 'in:inbox is:unread', maxResults: 10 } });
    expect(cm.requestFor(search, { q: 'from:acme.example' }))
      .toEqual({ method: 'GET', path: '/messages', query: { q: 'from:acme.example' } });
  });

  it('refuses a search with no query', () => {
    expect(cm.requestFor(search, {})).toEqual({ error: 'q が必要です' });
  });

  it('builds the read call: the id fills its segment, format rides the query', () => {
    expect(cm.requestFor(read, { id: '18f1a2b3c4d5e6f7' }))
      .toEqual({ method: 'GET', path: '/messages/18f1a2b3c4d5e6f7', query: {} });
    expect(cm.requestFor(read, { id: '18f1a2b3c4d5e6f7', format: 'metadata' }))
      .toEqual({ method: 'GET', path: '/messages/18f1a2b3c4d5e6f7', query: { format: 'metadata' } });
    // A path value cannot leave its segment.
    expect(cm.requestFor(read, { id: 'a/b?format=raw' }).path).toBe('/messages/a%2Fb%3Fformat%3Draw');
  });
});

describe('the structure hash', () => {
  it('is stable over the same content, and a permission edit moves only the permission hash', async () => {
    const a = content(GMAIL_MANIFEST);
    await expect(draftStructureHashWeb(a)).resolves.toBe(await draftStructureHashWeb(content(GMAIL_MANIFEST)));
    const edited = JSON.parse(JSON.stringify(GMAIL_MANIFEST));
    edited.commands[1].permission = 'ask';
    await expect(draftStructureHashWeb(content(edited))).resolves.toBe(await draftStructureHashWeb(a));
    await expect(draftPermissionHashWeb(content(edited))).resolves.not.toBe(await draftPermissionHashWeb(a));
    // The structure projection itself reads the transform reference.
    const structure = draftStructureOfWeb(a) as { commands: { name: string; transform: string | null }[] };
    expect(structure.commands.find((c) => c.name === 'gmail_read')?.transform).toBe('gmail_message');
  });
});

describe('the assembly OAuth gate', () => {
  // oauthRowOpens is the one predicate both assemblies (a run's and the
  // chat's) apply: a Gmail row reaches manifest handling; a Drive or
  // GitHub row passes as it always has; an OAuth row no shipped sign-in
  // can complete still closes.
  const row = (over: Record<string, unknown>) => ({
    preset: 'custom', kind: 'http', endpoint: 'https://api.example.com', auth_type: 'bearer', ...over,
  });

  it('opens a Gmail row to manifest handling', () => {
    expect(it8.oauthRowOpens(row({
      preset: 'gmail', endpoint: ENDPOINT, auth_type: 'oauth',
    }))).toBe(true);
  });

  it('keeps Drive and GitHub rows open, as before', () => {
    expect(it8.oauthRowOpens(row({
      preset: 'google-drive', endpoint: 'https://www.googleapis.com/drive/v3', auth_type: 'oauth',
    }))).toBe(true);
    expect(it8.oauthRowOpens(row({
      preset: 'github', kind: 'mcp', endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth',
    }))).toBe(true);
  });

  it('still closes an OAuth row no sign-in can complete', () => {
    expect(it8.oauthRowOpens(row({ auth_type: 'oauth' }))).toBe(false);
    // A gmail preset name at the wrong endpoint is not a Gmail row.
    expect(it8.oauthRowOpens(row({ preset: 'gmail', auth_type: 'oauth' }))).toBe(false);
  });

  it('passes rows that are not OAuth at all', () => {
    expect(it8.oauthRowOpens(row({}))).toBe(true);
    expect(it8.oauthRowOpens(row({ auth_type: 'none' }))).toBe(true);
  });
});

describe('a connection test rebuild keeps the pair', () => {
  it('manifestFromTools preserves the declared commands verbatim, transform included', () => {
    const rebuilt = cm.manifestFromTools([], gm.GMAIL_MANIFEST);
    const before = (gm.GMAIL_MANIFEST as { commands: unknown[] }).commands;
    const after = (rebuilt as { commands: Record<string, unknown>[] }).commands;
    expect(after.map((c) => c.name)).toEqual(['gmail_search', 'gmail_read']);
    expect(canonicalJson(after)).toBe(canonicalJson(before));
  });

  it('keeps them beside tools a server lists, untouched', () => {
    const rebuilt = cm.manifestFromTools([{ name: 'some_tool', description: 'x', readOnly: true }], gm.GMAIL_MANIFEST);
    const after = (rebuilt as { commands: Record<string, unknown>[] }).commands;
    const read = after.find((c) => c.name === 'gmail_read');
    expect(read?.transform).toBe('gmail_message');
    expect(after.some((c) => c.mcp === 'some_tool')).toBe(true);
  });
});
