import { describe, expect, it } from 'vitest';

// The server twin of the web's installFlow missingConnectors
// (supabase/functions/_shared/connectorNeeds.ts): the conversation's
// context and its connection proposals are computed with it, so it must
// mean exactly what the editor and the install walk mean — an enabled
// row answers a name by its own name, its preset's id or its preset's
// display name, folded.

const needs = await import(new URL('../../supabase/functions/_shared/connectorNeeds.ts', import.meta.url).pathname) as unknown as {
  missingConnectorNames: (names: readonly string[], rows: readonly { name: string; preset: string | null; enabled: boolean; last_test?: unknown }[]) => string[];
  connectorNeeds: (names: readonly string[], rows: readonly { name: string; preset: string | null; enabled: boolean; last_test?: unknown }[]) => { name: string; kind: 'missing' | 'reauth' }[];
  lastTestNeedsReauth: (lastTest: unknown) => boolean;
};
const { missingConnectorNames, connectorNeeds, lastTestNeedsReauth } = needs;

const row = (over: Partial<{ name: string; preset: string | null; enabled: boolean; last_test: unknown }> = {}) =>
  ({ name: 'GitHub', preset: 'github', enabled: true, ...over });

describe('missingConnectorNames', () => {
  it('a disabled connection does not satisfy a need', () => {
    expect(missingConnectorNames(['GitHub'], [row({ enabled: false })])).toEqual(['GitHub']);
  });

  it('an enabled connection satisfies by its name, its preset id, or its preset name, folded', () => {
    expect(missingConnectorNames(['My GitHub'], [row({ name: 'My GitHub' })])).toEqual([]);
    expect(missingConnectorNames(['github'], [row({ name: 'Renamed' })])).toEqual([]);
    expect(missingConnectorNames(['Google Drive'], [row({ name: 'Renamed', preset: 'google-drive' })])).toEqual([]);
    expect(missingConnectorNames(['googledrive'], [row({ name: 'Renamed', preset: 'google-drive' })])).toEqual([]);
    expect(missingConnectorNames(['Google Drive'], [row({ name: 'googledrive', preset: null })])).toEqual([]);
  });

  it('keeps the order named and de-duplicates by folded name', () => {
    expect(missingConnectorNames(['Notion', 'GitHub', ' notion ', 'Slack'], [row()])).toEqual(['Notion', 'Slack']);
  });

  it('everything is missing when the Space has connected nothing', () => {
    expect(missingConnectorNames(['GitHub', 'Slack'], [])).toEqual(['GitHub', 'Slack']);
  });

  it('a connection whose latest test failed is a need again — an auth failure is a reauth', () => {
    const expired = row({ last_test: { ok: false, code: 'auth_failed', message: 'Bad credentials', at: '2026-11-08T00:00:00Z' } });
    expect(missingConnectorNames(['GitHub'], [expired])).toEqual(['GitHub']);
    expect(connectorNeeds(['GitHub'], [expired])).toEqual([{ name: 'GitHub', kind: 'reauth' }]);
  });

  it('any failed latest test counts, not only auth codes', () => {
    expect(connectorNeeds(['GitHub'], [row({ last_test: { ok: false, message: 'network' } })]))
      .toEqual([{ name: 'GitHub', kind: 'reauth' }]);
    expect(connectorNeeds(['GitHub'], [row({ last_test: { code: 'oauth_expired' } })]))
      .toEqual([{ name: 'GitHub', kind: 'reauth' }]);
  });

  it('a passing test, or no test yet, still satisfies', () => {
    expect(connectorNeeds(['GitHub'], [row({ last_test: { ok: true, tools: 30 } })])).toEqual([]);
    expect(connectorNeeds(['GitHub'], [row({ last_test: null })])).toEqual([]);
    expect(connectorNeeds(['GitHub'], [row()])).toEqual([]);
  });

  it('one healthy connection among two answering the name satisfies it', () => {
    // A second row answers only to its own name — the first stays a reauth.
    const named = [row({ last_test: { ok: false, code: 'auth_failed' } }), row({ name: 'GitHub 2', preset: null })];
    expect(connectorNeeds(['GitHub'], named)).toEqual([{ name: 'GitHub', kind: 'reauth' }]);
    // A healthy row answering by the same preset id satisfies the name.
    const both = [row({ last_test: { ok: false, code: 'auth_failed' } }), row({ name: 'Other', preset: 'github', last_test: { ok: true } })];
    expect(connectorNeeds(['GitHub'], both)).toEqual([]);
  });

  it('a disabled row with a failed test is missing, not a reauth', () => {
    expect(connectorNeeds(['GitHub'], [row({ enabled: false, last_test: { ok: false, code: 'auth_failed' } })]))
      .toEqual([{ name: 'GitHub', kind: 'missing' }]);
  });
});

describe('lastTestNeedsReauth', () => {
  it('reads the shapes a connection test writes', () => {
    expect(lastTestNeedsReauth({ ok: false })).toBe(true);
    expect(lastTestNeedsReauth({ ok: true })).toBe(false);
    expect(lastTestNeedsReauth({ code: 'auth_failed' })).toBe(true);
    expect(lastTestNeedsReauth({ code: 'oauth_required' })).toBe(true);
    expect(lastTestNeedsReauth(null)).toBe(false);
    expect(lastTestNeedsReauth('auth_failed')).toBe(false);
    expect(lastTestNeedsReauth({})).toBe(false);
  });
});
