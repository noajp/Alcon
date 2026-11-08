import { describe, expect, it } from 'vitest';

// The server twin of the web's installFlow missingConnectors
// (supabase/functions/_shared/connectorNeeds.ts): the conversation's
// context and its connection proposals are computed with it, so it must
// mean exactly what the editor and the install walk mean — an enabled
// row answers a name by its own name, its preset's id or its preset's
// display name, folded.

const needs = await import(new URL('../../supabase/functions/_shared/connectorNeeds.ts', import.meta.url).pathname) as unknown as {
  missingConnectorNames: (names: readonly string[], rows: readonly { name: string; preset: string | null; enabled: boolean }[]) => string[];
};
const { missingConnectorNames } = needs;

const row = (over: Partial<{ name: string; preset: string | null; enabled: boolean }> = {}) =>
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
});
