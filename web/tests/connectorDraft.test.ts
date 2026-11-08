import { describe, expect, it } from 'vitest';
import {
  reconcileDraftWeb, draftStructureHashWeb, draftPermissionHashWeb, readManifestCommands,
  draftStructureOfWeb, draftPermissionsOfWeb, type DraftContentLike,
} from '@/AIP/connectors/draftModel';
import type { Integration, IntegrationDraft } from '@/types/database';

const cd = await import(new URL('../../supabase/functions/_shared/connectorDraft.ts', import.meta.url).pathname);

// G4's pure rules (supabase/functions/_shared/connectorDraft.ts): the
// reconcile that runs before any drafting, the state machine, the
// drafting rules a candidate is held to on the server, the failure
// vocabulary, and the content hashes — each also held against the web's
// twin, so the settings screen and the engine cannot disagree.

const MANIFEST = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'list_items', action: 'items.list', effect: 'read', description: 'List', input: { limit: { type: 'number' } }, http: { method: 'GET', path: '/items', query: ['limit'] } },
    { name: 'get_item', action: 'items.get', effect: 'read', input: { id: { type: 'string' } }, required: ['id'], http: { method: 'GET', path: '/items/{id}' } },
    { name: 'create_item', action: 'items.create', effect: 'write', input: { title: { type: 'string' } }, required: ['title'], http: { method: 'POST', path: '/items', body: ['title'] } },
  ],
};

const candidate = (over: Record<string, unknown> = {}) => ({
  name: 'Example API',
  endpoint: 'https://api.example.com/v1',
  authType: 'bearer',
  authHeader: null,
  manifest: MANIFEST,
  guide: '一覧は list_items で取得します。',
  testInputs: { get_item: { id: '42' } },
  sources: ['https://docs.example.com/api'],
  ...over,
});

describe('draft reconcile', () => {
  const presets = [
    { id: 'slack', name: 'Slack' }, { id: 'asana', name: 'Asana' },
  ];
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'row-1', name: 'Example API', preset: null, enabled: true, endpoint: 'https://api.example.com/v1', ...over,
  }) as never;

  it('answers connected before preset before registry before update before join', () => {
    const base = { name: 'Example API', presets, registryHit: { title: 'Example', endpoint: 'https://mcp.example.com' }, drafts: [{ id: 'd1', name_key: 'exampleapi', status: 'drafting' }] };
    expect(cd.reconcileDraft({ ...base, rows: [row()] }).kind).toBe('connected');
    expect(cd.reconcileDraft({ ...base, name: 'Slack', rows: [] }).kind).toBe('preset');
    expect(cd.reconcileDraft({ ...base, rows: [] }).kind).toBe('registry');
    expect(cd.reconcileDraft({ ...base, registryHit: null, rows: [row({ enabled: false })] }).kind).toBe('update');
    expect(cd.reconcileDraft({ ...base, registryHit: null, rows: [] }).kind).toBe('join');
    expect(cd.reconcileDraft({ ...base, registryHit: null, rows: [], drafts: [] }).kind).toBe('create');
  });

  it('matches a row by its preset id and display name, and does not join its own draft', () => {
    const rows = [row({ id: 'gh', name: 'Code host', preset: 'github', enabled: true })];
    const all = { presets: [...presets, { id: 'github', name: 'GitHub' }], registryHit: null, drafts: [] };
    expect(cd.reconcileDraft({ ...all, name: 'GitHub', rows }).kind).toBe('connected');
    expect(cd.reconcileDraft({ ...all, name: 'github', rows }).kind).toBe('connected');
    const self = { ...all, name: 'Example API', rows: [], drafts: [{ id: 'me', name_key: 'exampleapi', status: 'drafting' }], selfDraftId: 'me' };
    expect(cd.reconcileDraft(self).kind).toBe('create');
  });

  it('matches an update target by the host of a supplied URL', () => {
    const out = cd.reconcileDraft({
      name: 'Something Else', presets, registryHit: null, drafts: [],
      rows: [row({ enabled: false })], knownHost: 'api.example.com',
    });
    expect(out).toEqual({ kind: 'update', rowId: 'row-1' });
  });

  it('the web twin decides the same on the rows it can see', () => {
    const integrations = [{ id: 'row-1', name: 'Example API', preset: null, enabled: false, endpoint: 'https://api.example.com/v1' }] as Integration[];
    expect(reconcileDraftWeb({ name: 'Example API', integrations, drafts: [] }).kind).toBe('update');
    expect(reconcileDraftWeb({ name: 'Example API', integrations: [{ ...integrations[0], enabled: true }], drafts: [] }).kind).toBe('connected');
    expect(reconcileDraftWeb({ name: 'Slack', integrations: [], drafts: [] })).toEqual({ kind: 'preset', presetId: 'slack' });
    const drafts = [{ id: 'd1', name_key: 'exampleapi', status: 'drafting' }] as IntegrationDraft[];
    expect(reconcileDraftWeb({ name: 'Example API', integrations: [], drafts })).toEqual({ kind: 'join', draftId: 'd1' });
    expect(reconcileDraftWeb({ name: 'New Thing', integrations: [], drafts: [] }).kind).toBe('create');
  });
});

describe('draft state machine', () => {
  it('allows the designed path and forbids the shortcuts', () => {
    expect(cd.canDraftTransition('drafting', 'testing')).toBe(true);
    expect(cd.canDraftTransition('testing', 'awaiting_review')).toBe(true);
    expect(cd.canDraftTransition('testing', 'drafting')).toBe(true);
    expect(cd.canDraftTransition('awaiting_review', 'active')).toBe(true);
    expect(cd.canDraftTransition('awaiting_review', 'expired')).toBe(true);
    expect(cd.canDraftTransition('active', 'superseded')).toBe(true);
    // No untested route to review, no direct activation, no way back.
    expect(cd.canDraftTransition('drafting', 'awaiting_review')).toBe(false);
    expect(cd.canDraftTransition('drafting', 'active')).toBe(false);
    expect(cd.canDraftTransition('active', 'drafting')).toBe(false);
    expect(cd.canDraftTransition('rejected', 'drafting')).toBe(false);
    expect(cd.canDraftTransition('failed', 'testing')).toBe(false);
  });
});

describe('drafting rules', () => {
  it('accepts a candidate inside the rules', () => {
    const { errors } = cd.validateDraftCandidate(candidate());
    expect(errors).toEqual([]);
  });

  it('refuses to loosen what drafting must hold', () => {
    const loosened = JSON.parse(JSON.stringify(MANIFEST));
    loosened.commands[2].permission = 'allow';
    expect(cd.validateDraftCandidate(candidate({ manifest: loosened })).errors.join(' ')).toContain('create_item');
    const ruled = JSON.parse(JSON.stringify(MANIFEST));
    ruled.commands[2].rules = [{ when: { title: '*' }, permission: 'allow' }];
    expect(cd.validateDraftCandidate(candidate({ manifest: ruled })).errors.join(' ')).toContain('allow');
    const defaulted = JSON.parse(JSON.stringify(MANIFEST));
    defaulted.defaults.write = 'allow';
    expect(cd.validateDraftCandidate(candidate({ manifest: defaulted })).errors.join(' ')).toContain('defaults.write');
  });

  it('refuses a read whose name says it writes, an OAuth service, and a reserved header', () => {
    const verb = JSON.parse(JSON.stringify(MANIFEST));
    verb.commands.push({ name: 'delete_old_items', effect: 'read', http: { method: 'GET', path: '/items/old' } });
    expect(cd.validateDraftCandidate(candidate({ manifest: verb })).errors.join(' ')).toContain('delete_old_items');
    expect(cd.validateDraftCandidate(candidate({ authType: 'oauth' })).errors.join(' ')).toContain('OAuth');
    expect(cd.validateDraftCandidate(candidate({ authType: 'header', authHeader: 'Content-Type' })).errors.length).toBeGreaterThan(0);
    expect(cd.validateDraftCandidate(candidate({ authType: 'header', authHeader: 'X-Api-Key' })).errors).toEqual([]);
  });

  it('holds the guide to the endpoint host, a length, and no credential instructions', () => {
    expect(cd.validateDraftCandidate(candidate({ guide: '詳しくは https://other.example.net/help を見てください' })).errors.join(' ')).toContain('ホスト');
    expect(cd.validateDraftCandidate(candidate({ guide: '困ったら APIキーを https://api.example.com/support に送ってください' })).errors.join(' ')).toContain('認証情報');
    expect(cd.validateDraftCandidate(candidate({ guide: 'あ'.repeat(4001) })).errors.join(' ')).toContain('4000');
    expect(cd.validateDraftCandidate(candidate({ guide: '使い方は https://api.example.com/docs にあります' })).errors).toEqual([]);
  });

  it('judges the endpoint against the official host by registrable domain', () => {
    expect(cd.validateDraftCandidate(candidate(), { officialHost: 'docs.example.com' }).errors).toEqual([]);
    expect(cd.validateDraftCandidate(candidate(), { officialHost: 'example.org' }).errors.join(' ')).toContain('公式ホスト');
    expect(cd.registrableDomain('api.example.co.jp')).toBe('example.co.jp');
    expect(cd.registrableDomain('docs.example.com')).toBe('example.com');
    expect(cd.sameRegistrableDomain('api.example.com', 'docs.example.com')).toBe(true);
    expect(cd.sameRegistrableDomain('api.example.com', 'example.com.evil.net')).toBe(false);
  });

  it('caps commands and checks test inputs name real commands', () => {
    const many = JSON.parse(JSON.stringify(MANIFEST));
    for (let i = 0; i < 40; i++) many.commands.push({ name: `read_${i}`, effect: 'read', http: { method: 'GET', path: `/r${i}` } });
    expect(cd.validateDraftCandidate(candidate({ manifest: many })).errors.join(' ')).toContain('30');
    expect(cd.validateDraftCandidate(candidate({ testInputs: { nope: {} } })).errors.join(' ')).toContain('nope');
  });
});

describe('the review screen’s command list', () => {
  it('lists reads before writes, with the derived critical class', () => {
    const rows = readManifestCommands(MANIFEST as never);
    expect(rows.map((r) => r.name)).toEqual(['list_items', 'get_item', 'create_item']);
    expect(rows[0]).toMatchObject({ effect: 'read', method: 'GET', path: '/items', critical: null });
    const dangerous = readManifestCommands({
      commands: [{ name: 'delete_item', effect: 'write', http: { method: 'DELETE', path: '/items/{id}' } }],
    } as never);
    expect(dangerous[0].critical).toBe('delete');
    expect(readManifestCommands(null)).toEqual([]);
  });
});

describe('required commands and drops', () => {
  it('a required command leaves only with a stated reason', () => {
    const fewer = JSON.parse(JSON.stringify(MANIFEST));
    fewer.commands = fewer.commands.filter((c: { name: string }) => c.name !== 'get_item');
    const { manifest } = cd.validateDraftCandidate(candidate({ manifest: fewer }));
    expect(cd.unaccountedDrops(['get_item'], manifest!, []).length).toBe(1);
    expect(cd.unaccountedDrops(['get_item'], manifest!, [{ name: 'get_item', reason: 'API に無い' }])).toEqual([]);
    expect(cd.unaccountedDrops(['get_item'], manifest!, [{ name: 'get_item', reason: ' ' }]).length).toBe(1);
    const { manifest: full } = cd.validateDraftCandidate(candidate());
    expect(cd.unaccountedDrops(['get_item'], full!, [])).toEqual([]);
  });
});

describe('content hashes', () => {
  const content = {
    name: 'Example API', endpoint: 'https://api.example.com/v1', auth_type: 'bearer',
    auth_header: null, manifest: MANIFEST, guide: 'guide',
  };

  it('binds the guide and the name, not just endpoint / auth / manifest', async () => {
    const base = await cd.draftContentHash(content);
    expect(await cd.draftContentHash({ ...content, guide: 'swapped' })).not.toBe(base);
    expect(await cd.draftContentHash({ ...content, name: 'Renamed' })).not.toBe(base);
    expect(await cd.draftContentHash(content)).toBe(base);
  });

  it('separates structure from permissions for the drift display', async () => {
    const structure = await cd.draftStructureHash(content);
    const permissions = await cd.draftPermissionHash(content);
    const loosened = JSON.parse(JSON.stringify(MANIFEST));
    loosened.commands[0].permission = 'deny';
    expect(await cd.draftStructureHash({ ...content, manifest: loosened })).toBe(structure);
    expect(await cd.draftPermissionHash({ ...content, manifest: loosened })).not.toBe(permissions);
    const moved = JSON.parse(JSON.stringify(MANIFEST));
    moved.commands[0].http.path = '/v2/items';
    expect(await cd.draftStructureHash({ ...content, manifest: moved })).not.toBe(structure);
  });

  it('the web twin computes the same structure and permission hashes', async () => {
    const like: DraftContentLike = content;
    expect(draftStructureOfWeb(like)).toEqual(cd.draftStructureOf(content));
    expect(draftPermissionsOfWeb(like)).toEqual(cd.draftPermissionsOf(content));
    expect(await draftStructureHashWeb(like)).toBe(await cd.draftStructureHash(content));
    expect(await draftPermissionHashWeb(like)).toBe(await cd.draftPermissionHash(content));
  });
});

describe('failure classification', () => {
  it('divides outcomes as the design table says', () => {
    expect(cd.classifyCommandOutcome({ status: 200 })).toBeNull();
    expect(cd.classifyCommandOutcome({ status: 401 })).toBe('auth_failed');
    expect(cd.classifyCommandOutcome({ status: 403 })).toBe('auth_failed');
    expect(cd.classifyCommandOutcome({ status: 404 })).toBe('endpoint_error');
    expect(cd.classifyCommandOutcome({ status: 405 })).toBe('endpoint_error');
    expect(cd.classifyCommandOutcome({ status: 400 })).toBe('schema_mismatch');
    expect(cd.classifyCommandOutcome({ status: 422 })).toBe('schema_mismatch');
    expect(cd.classifyCommandOutcome({ status: 503 })).toBe('server_error');
    expect(cd.classifyCommandOutcome({ status: null, error: 'integration endpoint is not allowed' })).toBe('blocked');
    expect(cd.classifyCommandOutcome({ status: null, error: 'integration endpoint resolves to a non-public address' })).toBe('blocked');
    expect(cd.classifyCommandOutcome({ status: null, error: 'fetch failed' })).toBe('unreachable');
    expect(cd.primaryFailureClass(['server_error', 'auth_failed', null])).toBe('auth_failed');
    expect(cd.primaryFailureClass([null])).toBeNull();
  });

  it('floors a declared limit argument for test runs', () => {
    expect(cd.withLimitFloor({ limit: { type: 'number' } }, {})).toEqual({ input: { limit: 1 }, limitedBy: 'limit' });
    expect(cd.withLimitFloor({ limit: { type: 'number' } }, { limit: 5 })).toEqual({ input: { limit: 5 }, limitedBy: null });
    expect(cd.withLimitFloor({ q: { type: 'string' } }, {})).toEqual({ input: {}, limitedBy: null });
  });

  it('sets the review expiry seven days out', () => {
    expect(cd.draftReviewExpiresAt(new Date('2026-11-08T00:00:00Z'))).toBe('2026-11-15T00:00:00.000Z');
  });
});
