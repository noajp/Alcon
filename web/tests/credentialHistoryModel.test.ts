import { describe, expect, it } from 'vitest';

// The credential history's reading (secure-login PR4,
// Function/audit/credentialHistoryModel.ts): a trail row shows the
// credential, the event, the person or run behind it, and known
// fixed codes only — bookkeeping detail (a request id inside the
// once-take's sentence) never reaches the surface.
import {
  credentialHistoryRow, filterCredentialHistory, type CredentialHistoryRow,
} from '@/Function/audit/credentialHistoryModel';
import type { CredentialUse } from '@/types/database';

const names = {
  integrationName: new Map([['in1', 'GitHub']]),
  siteOrigin: new Map([['sc1', 'https://example.com']]),
  siteUsername: new Map([['sc1', 'taro@example.com']]),
  personName: new Map([['u1', 'Taro']]),
};

const use = (over: Partial<CredentialUse> = {}): CredentialUse => ({
  id: 'x1', activity_space_id: 'sp1', credential_kind: 'integration', integration_id: 'in1',
  site_credential_id: null, event: 'used', run_id: 'run1', actor_id: null, origin: null,
  detail: null, created_at: '2026-11-09T00:00:00.000Z', ...over,
});

describe('credentialHistoryRow', () => {
  it('names a connection credential and keeps its run', () => {
    const row = credentialHistoryRow(use(), names);
    expect(row.credentialLabel).toBe('GitHub');
    expect(row.runId).toBe('run1');
    expect(row.origin).toBeNull();
  });

  it('a deleted connection keeps its story as a removed connection', () => {
    const row = credentialHistoryRow(use({ integration_id: null }), names);
    expect(row.credentialLabel).toBe('Removed connection');
  });

  it('a site credential is its origin and username; the origin is not repeated beside it', () => {
    const row = credentialHistoryRow(use({
      credential_kind: 'site', integration_id: null, site_credential_id: 'sc1',
      event: 'stored', run_id: null, actor_id: 'u1', origin: 'https://example.com',
    }), names);
    expect(row.credentialLabel).toBe('https://example.com · taro@example.com');
    expect(row.origin).toBeNull();
    expect(row.actorName).toBe('Taro');
  });

  it('a one-time credential is named as itself, with its origin beside it', () => {
    const row = credentialHistoryRow(use({
      credential_kind: 'once', integration_id: null, event: 'used', origin: 'https://example.com',
      detail: 'one-time credential for request 9f2c',
    }), names);
    expect(row.credentialLabel).toBe('One-time credential');
    expect(row.origin).toBe('https://example.com');
    // The bookkeeping detail names a request id: internal, never shown.
    expect(row.detailLabel).toBeNull();
  });

  it('known fixed codes show as words; the signed_in outcome is the event itself', () => {
    expect(credentialHistoryRow(use({ event: 'test_failed', run_id: null, detail: 'auth_failed' }), names).detailLabel)
      .toBe('Authentication failed');
    expect(credentialHistoryRow(use({ detail: 'still_walled' }), names).detailLabel).toBe('The login wall stayed');
    expect(credentialHistoryRow(use({ detail: 'signed_in' }), names).detailLabel).toBeNull();
    expect(credentialHistoryRow(use({ detail: 'some-unlisted-code' }), names).detailLabel).toBeNull();
  });
});

describe('filterCredentialHistory', () => {
  const row = (event: CredentialHistoryRow['event']): CredentialHistoryRow => ({
    id: event, at: '2026-11-09T00:00:00.000Z', event, credentialLabel: 'GitHub',
    origin: null, detailLabel: null, actorName: null, runId: null,
  });
  const rows = [row('stored'), row('used'), row('test_failed'), row('release_refused'), row('declined'), row('deleted')];

  it('partitions the trail without remainder', () => {
    expect(filterCredentialHistory(rows, 'all')).toHaveLength(6);
    expect(filterCredentialHistory(rows, 'used').map((r) => r.event)).toEqual(['used']);
    expect(filterCredentialHistory(rows, 'problems').map((r) => r.event)).toEqual(['test_failed', 'release_refused']);
    expect(filterCredentialHistory(rows, 'changes').map((r) => r.event)).toEqual(['stored', 'declined', 'deleted']);
    const total = (['used', 'problems', 'changes'] as const)
      .reduce((n, f) => n + filterCredentialHistory(rows, f).length, 0);
    expect(total).toBe(6);
  });
});
