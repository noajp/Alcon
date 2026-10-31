import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER, INTEGRATION_PRESETS, buildIntegrationRow, darkIconFor, filterPresets, installedPresetIds,
  isSafeEndpoint, presetById, readLastTest, signsInWithOAuth, testOutcomeLabel, type IntegrationDraft,
} from '@/Function/integrations/catalog';

import { existsSync } from 'node:fs';

const server = await import(new URL('../../supabase/functions/_shared/integrationClient.ts', import.meta.url).pathname);

const SPACE = '00000000-0000-0000-0000-000000000001';
const draft: IntegrationDraft = { delegation: 'approve_each', enabled: true };

describe('integration presets', () => {
  it('have unique ids and safe fixed endpoints', () => {
    const ids = INTEGRATION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of INTEGRATION_PRESETS) {
      if (p.custom) expect(p.endpoint).toBeNull();
      else expect(isSafeEndpoint(p.endpoint!)).toBe(true);
    }
  });

  it('feature Linear first, then Asana and Google Drive', () => {
    expect(INTEGRATION_PRESETS.filter((p) => p.featured).map((p) => p.id)).toEqual(['linear', 'asana', 'google-drive']);
  });

  it('match the brief for each service', () => {
    expect(presetById('linear')).toMatchObject({ kind: 'mcp', endpoint: 'https://mcp.linear.app/mcp', auth: 'bearer', category: 'project' });
    expect(presetById('asana')).toMatchObject({ kind: 'http', endpoint: 'https://app.asana.com/api/1.0', auth: 'bearer' });
    expect(presetById('github')).toMatchObject({ kind: 'mcp', endpoint: 'https://api.githubcopilot.com/mcp/', category: 'development' });
    expect(presetById('slack')).toMatchObject({ kind: 'http', endpoint: 'https://slack.com/api', category: 'communication' });
    expect(presetById('google-drive')).toMatchObject({ auth: 'oauth' });
    expect(presetById('google-drive')).toMatchObject({ kind: 'http', endpoint: 'https://www.googleapis.com/drive/v3', category: 'files' });
    expect(presetById('google-drive')!.unavailableReason).toBeUndefined();
    expect(signsInWithOAuth(presetById('google-drive')!)).toBe(true);
    expect(signsInWithOAuth(presetById('linear')!)).toBe(false);
    expect(presetById('nope')).toBeNull();
  });
});

describe('filterPresets', () => {
  it('returns everything for the empty filter', () => {
    expect(filterPresets(INTEGRATION_PRESETS, EMPTY_FILTER)).toHaveLength(INTEGRATION_PRESETS.length);
  });

  it('combines query, category, kind and source', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => filterPresets(INTEGRATION_PRESETS, { ...EMPTY_FILTER, ...f }).map((p) => p.id);
    expect(ids({ query: 'LINEAR' })).toEqual(['linear']);
    expect(ids({ query: 'project management' })).toEqual(['linear', 'asana']);
    expect(ids({ category: 'project', kind: 'http' })).toEqual(['asana']);
    expect(ids({ kind: 'mcp', source: 'official' })).toEqual(['linear', 'github']);
    expect(ids({ source: 'custom' })).toEqual(['custom-mcp', 'custom-http']);
    expect(ids({ query: 'zzz' })).toEqual([]);
  });
});

describe('installedPresetIds', () => {
  it('collects presets that have a row, ignoring rows without one', () => {
    expect([...installedPresetIds([{ preset: 'linear' }, { preset: null }, { preset: 'linear' }, { preset: 'slack' }])].sort()).toEqual(['linear', 'slack']);
  });
});

describe('isSafeEndpoint', () => {
  const cases = [
    'https://mcp.linear.app/mcp', 'https://api.example.com/v1', 'http://api.example.com', 'https://localhost./x', 'https://198.18.0.1/', 'https://[2606:4700::1111]/',
    'https://localhost/x', 'https://foo.localhost', 'https://printer.local', 'https://svc.internal',
    'https://intranet', 'https://user:pw@example.com', 'https://10.0.0.1', 'https://127.0.0.1',
    'https://169.254.169.254/latest', 'https://172.16.0.1', 'https://172.32.0.1', 'https://192.168.1.1',
    'https://100.64.0.1', 'https://8.8.8.8', 'https://[::1]/', 'https://[fd00::1]/', 'https://[2606:4700::1111]/',
    'ftp://example.com', 'not a url', '',
  ];

  it('agrees with the server rule on every case', () => {
    for (const c of cases) expect([c, isSafeEndpoint(c)]).toEqual([c, server.isSafeEndpoint(c)]);
  });

  it('accepts public https and rejects the rest', () => {
    expect(isSafeEndpoint('https://api.example.com/v1')).toBe(true);
    expect(isSafeEndpoint('http://api.example.com')).toBe(false);
    expect(isSafeEndpoint('https://192.168.1.1')).toBe(false);
    for (const bad of ['https://localhost./x', 'https://198.18.0.1/', 'https://[2606:4700::1111]/']) expect(isSafeEndpoint(bad)).toBe(false);
  });
});

describe('buildIntegrationRow', () => {
  it('fixes everything but delegation and enabled for a preset', () => {
    const r = buildIntegrationRow(presetById('linear')!, SPACE, { ...draft, name: 'ignored', endpoint: 'https://evil.example.com', delegation: 'full_delegation' });
    expect(r).toEqual({
      ok: true,
      row: expect.objectContaining({
        activity_space_id: SPACE, preset: 'linear', kind: 'mcp', name: 'Linear', endpoint: 'https://mcp.linear.app/mcp',
        auth_type: 'bearer', auth_header: null, delegation: 'full_delegation', enabled: true,
      }),
    });
  });

  it('builds an OAuth row for Google Drive, with no credential', () => {
    expect(buildIntegrationRow(presetById('google-drive')!, SPACE, draft)).toEqual({
      ok: true,
      row: expect.objectContaining({ preset: 'google-drive', kind: 'http', endpoint: 'https://www.googleapis.com/drive/v3', auth_type: 'oauth', auth_header: null }),
    });
  });

  it('refuses a preset that cannot be connected yet', () => {
    expect(buildIntegrationRow({ ...presetById('google-drive')!, unavailableReason: 'Not yet.' }, SPACE, draft)).toEqual({ ok: false, error: 'Not yet.' });
  });

  it('validates a custom connection', () => {
    const mcp = presetById('custom-mcp')!;
    expect(buildIntegrationRow(mcp, SPACE, { ...draft, name: ' ', endpoint: 'https://x.example.com' })).toEqual({ ok: false, error: 'Enter a name.' });
    expect(buildIntegrationRow(mcp, SPACE, { ...draft, name: 'Mine', endpoint: 'http://x.example.com' }).ok).toBe(false);
    expect(buildIntegrationRow(mcp, SPACE, { ...draft, name: 'Mine', endpoint: 'https://x.example.com', auth: 'header', authHeader: 'Bad Header' }).ok).toBe(false);
    expect(buildIntegrationRow(mcp, SPACE, { ...draft, name: 'Mine', endpoint: 'https://x.example.com', auth: 'header', authHeader: 'Host' }).ok).toBe(false);
    expect(buildIntegrationRow(mcp, SPACE, { ...draft, name: 'Mine', endpoint: 'https://x.example.com', auth: 'oauth' }).ok).toBe(false);
  });

  it('builds a custom API row with a header credential', () => {
    const r = buildIntegrationRow(presetById('custom-http')!, SPACE, { ...draft, name: ' Billing ', endpoint: ' https://billing.example.com/api ', auth: 'header', authHeader: 'X-API-Key' });
    expect(r).toEqual({
      ok: true,
      row: expect.objectContaining({ preset: 'custom-http', kind: 'http', name: 'Billing', endpoint: 'https://billing.example.com/api', auth_type: 'header', auth_header: 'X-API-Key' }),
    });
  });

  it('drops the header name unless auth is header', () => {
    const r = buildIntegrationRow(presetById('custom-mcp')!, SPACE, { ...draft, name: 'Mine', endpoint: 'https://x.example.com', auth: 'none', authHeader: 'X-Key' });
    expect(r.ok && r.row.auth_header).toBeNull();
  });
});

describe('readLastTest', () => {
  it('reads null for never-tested or malformed values', () => {
    for (const v of [null, undefined, 'ok', 1, [], {}, { ok: 'yes' }]) expect(readLastTest(v)).toBeNull();
  });

  it('reads an MCP result with tools', () => {
    expect(readLastTest({ ok: true, at: '2026-10-03T00:00:00Z', detail: '2', tool_count: 25, tools: [{ name: 'a', readOnly: true }, { name: 'b' }, { nope: 1 }] })).toEqual({
      ok: true, code: 'connected', at: '2026-10-03T00:00:00Z', detail: '2', toolCount: 25, tools: [{ name: 'a', readOnly: true }, { name: 'b', readOnly: false }], status: null,
    });
  });

  it('reads an HTTP result', () => {
    expect(readLastTest({ ok: false, detail: 'auth', status: 401 })).toEqual({ ok: false, code: 'error', at: null, detail: 'auth', toolCount: null, tools: [], status: 401 });
    expect(readLastTest({ ok: false, code: 'auth_failed', detail: '', status: 401 })?.code).toBe('auth_failed');
  });

  it('words every outcome, and only a verified one as connected', () => {
    expect(testOutcomeLabel('connected')).toBe('Connected');
    expect(testOutcomeLabel('reachable')).toMatch(/not checked/);
    for (const c of ['auth_failed', 'http_error', 'unreachable', 'blocked', 'oauth_required', 'oauth_expired', 'whatever']) expect(testOutcomeLabel(c)).not.toBe('Connected');
  });
});

describe('preset logos', () => {
  const publicFile = (src: string) => new URL(`../public${src}`, import.meta.url).pathname;

  it('every service preset has a logo that exists, and only custom presets go without', () => {
    for (const p of INTEGRATION_PRESETS) {
      if (p.custom) { expect(p.icon).toBeNull(); continue; }
      expect(p.icon, p.id).toMatch(/^\/integrations\/.+\.svg$/);
      expect(existsSync(publicFile(p.icon!)), p.icon!).toBe(true);
      const dark = darkIconFor(p.icon!);
      if (dark) expect(existsSync(publicFile(dark)), dark).toBe(true);
    }
  });

  it('a one-color logo has a dark counterpart; a colored one does not', () => {
    expect(darkIconFor('/integrations/github.svg')).toBe('/integrations/github-dark.svg');
    expect(darkIconFor('/integrations/slack.svg')).toBeNull();
  });
});
