import { describe, expect, it } from 'vitest';
import { captureDialogModel, credentialRequestStateLabel } from '@/AIP/connectors/credentialRequestModel';
import type { CredentialRequest, Integration } from '@/types/database';

// The capture dialog's pure model (secure-login design §2.1, D2): the
// fields it shows, its locked destination, and its save-vs-use-once
// default — save for the token class, use-once for site passwords.

const request = (over: Partial<CredentialRequest> = {}): CredentialRequest => ({
  id: 'req-1', activity_space_id: 'sp-1', kind: 'integration_secret', integration_id: 'int-1',
  site_credential_id: null,
  origin: null, username_hint: null, need: { waiting_for: 'Linear の課題を調べる' },
  status: 'pending', requested_by: 'u-1', decided_by: null, decided_at: null,
  created_at: '2026-11-09T00:00:00Z', expires_at: null, ...over,
});

const linear = {
  id: 'int-1', activity_space_id: 'sp-1', name: 'Linear', preset: 'linear', kind: 'http',
  endpoint: 'https://api.linear.app/graphql', external_account: null, secret_id: null,
  auth: { type: 'bearer' }, enabled: true,
} as unknown as Integration;

describe('captureDialogModel', () => {
  it('the token class: connection name as subject, endpoint host locked, save by default', () => {
    const model = captureDialogModel(request(), linear);
    expect(model).toMatchObject({
      kind: 'integration_secret', subject: 'Linear', destination: 'api.linear.app',
      secretLabel: 'Linear API key', hasUsername: false, saveByDefault: true, pending: true,
      waitingFor: 'Linear の課題を調べる',
    });
  });

  it('the site class: the origin is subject and destination, use-once by default (D2)', () => {
    const site = request({ kind: 'site_login', integration_id: null, origin: 'https://example.com', username_hint: 't@example.com' });
    const model = captureDialogModel(site, null);
    expect(model).toMatchObject({
      kind: 'site_login', subject: 'https://example.com', destination: 'https://example.com',
      secretLabel: 'Password', hasUsername: true, usernameHint: 't@example.com', saveByDefault: false,
    });
  });

  it('a decided request is not pending', () => {
    expect(captureDialogModel(request({ status: 'saved' }), linear).pending).toBe(false);
  });

  it('the destination falls back to the raw endpoint when it is not a URL', () => {
    const stdio = { ...linear, endpoint: 'stdio command' } as unknown as Integration;
    expect(captureDialogModel(request(), stdio).destination).toBe('stdio command');
  });
});

describe('credentialRequestStateLabel', () => {
  it('names each terminal state and stays silent while pending', () => {
    expect(credentialRequestStateLabel('pending')).toBeNull();
    expect(credentialRequestStateLabel('saved')).toBe('Credential saved');
    expect(credentialRequestStateLabel('used_once')).toBe('One-time credential received');
    expect(credentialRequestStateLabel('declined')).toBe('Credential entry was declined');
    expect(credentialRequestStateLabel('expired')).toBe('This request has expired');
    expect(credentialRequestStateLabel('superseded')).toBe('This request was replaced by a newer one');
  });
});
