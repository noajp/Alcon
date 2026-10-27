import { describe, expect, it } from 'vitest';

// The pure half of audit-approvals (ADR 0047): what a gateway sends to ask
// for and use an approval, and the one-time proof it gets back.
const approvals = await import(new URL('../../supabase/functions/_shared/auditApprovals.ts', import.meta.url).pathname);
const grants = await import(new URL('../../supabase/functions/_shared/auditGrants.ts', import.meta.url).pathname);

const DEP = '7c1e2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b';
const APPROVAL = '0f1e2d3c-4b5a-4968-8776-655443322110';
const HASH = 'a'.repeat(64);

const request = {
  action: 'request', request_id: 'req-1', deployment_id: DEP, run_external_id: 'PO-1042', connector: 'Gmail',
  operation: 'send', input_hash: HASH, summary: 'Send the delivery reply for PO-1042', valid_minutes: 60,
};

describe('parseApprovalCall', () => {
  it('reads a request and a redemption', () => {
    expect(approvals.parseApprovalCall(request)).toEqual({ ok: true, value: request });
    expect(approvals.parseApprovalCall({ ...request, valid_minutes: undefined }).value.valid_minutes).toBeNull();
    expect(approvals.parseApprovalCall({ action: 'redeem', approval_id: APPROVAL, input_hash: HASH }))
      .toEqual({ ok: true, value: { action: 'redeem', approval_id: APPROVAL, input_hash: HASH } });
  });

  it('refuses what the database would refuse', () => {
    expect(approvals.parseApprovalCall({ ...request, operation: 'none' }).error).toMatch(/operation/);
    expect(approvals.parseApprovalCall({ ...request, input_hash: 'A'.repeat(64) }).error).toMatch(/input_hash/);
    expect(approvals.parseApprovalCall({ ...request, summary: ' ' }).error).toMatch(/summary/);
    expect(approvals.parseApprovalCall({ ...request, summary: 'a\u0000b' }).error).toMatch(/summary/);
    expect(approvals.parseApprovalCall({ ...request, valid_minutes: 2 }).error).toMatch(/valid_minutes/);
    expect(approvals.parseApprovalCall({ ...request, request_id: 'has space' }).error).toMatch(/request_id/);
    expect(approvals.parseApprovalCall({ action: 'redeem', approval_id: 'x', input_hash: HASH }).error).toMatch(/approval_id/);
    expect(approvals.parseApprovalCall({ action: 'approve' }).error).toMatch(/action/);
  });
});

describe('the proof', () => {
  const redeemed = {
    approval_id: APPROVAL, space_id: 'space', deployment_id: DEP, run_external_id: 'PO-1042', connector: 'Gmail',
    operation: 'send', input_hash: HASH, approved_by: 'Owner', approved_at: '2026-10-28T09:00:00.000Z', used_at: '2026-10-28T09:05:00.123456+00:00',
  };

  it('is issued at the moment it is spent and lives briefly', () => {
    const proof = approvals.buildApprovalProof(redeemed, 'key');
    expect(proof.issued_at).toBe('2026-10-28T09:05:00.123Z');
    expect(Date.parse(proof.expires_at) - Date.parse(proof.issued_at)).toBe(approvals.APPROVAL_PROOF_TTL_SECONDS * 1000);
    expect(proof).toMatchObject({ kind: 'alcon.approval', approval_id: APPROVAL, input_hash: HASH, deployment_id: DEP });
  });

  it('reads only for that approval, that content, under the pinned key, before it expires', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pinned = grants.base64UrlEncode(await crypto.subtle.exportKey('raw', pair.publicKey));
    const body = new TextEncoder().encode(JSON.stringify(approvals.buildApprovalProof(redeemed, pinned)));
    const signature = grants.base64UrlEncode(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, body));
    const now = Date.parse('2026-10-28T09:06:00Z');
    const expect_ = { approvalId: APPROVAL, inputHash: HASH, deploymentId: DEP, connector: 'Gmail', operation: 'send', nowMs: now };

    expect((await approvals.readApprovalProof(pinned, signature, body, expect_))?.approved_by).toBe('Owner');
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, inputHash: 'b'.repeat(64) })).toBeNull();
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, approvalId: DEP })).toBeNull();
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, nowMs: now + 10 * 60_000 })).toBeNull();
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, operation: 'money' })).toBeNull();
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, connector: 'Slack' })).toBeNull();
    expect(await approvals.readApprovalProof(pinned, signature, body, { ...expect_, deploymentId: APPROVAL })).toBeNull();
    const swapped = new TextEncoder().encode(new TextDecoder().decode(body).replace(HASH, 'b'.repeat(64)));
    expect(await approvals.readApprovalProof(pinned, signature, swapped, { ...expect_, inputHash: 'b'.repeat(64) })).toBeNull();
    // A grants table signed by the same key is not a proof.
    const table = new TextEncoder().encode(JSON.stringify({ kind: 'alcon.grants', approval_id: APPROVAL, input_hash: HASH, expires_at: '2099-01-01T00:00:00Z' }));
    const tableSig = grants.base64UrlEncode(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, table));
    expect(await approvals.readApprovalProof(pinned, tableSig, table, expect_)).toBeNull();
  });
});
