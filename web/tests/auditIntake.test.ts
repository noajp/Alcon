import { describe, expect, it } from 'vitest';

// The pure half of audit-intake (ADR 0045): the batch's shape, each event's
// digest and the batch's own chain, and the Ed25519 signature.
const intake = await import(new URL('../../supabase/functions/_shared/auditIntake.ts', import.meta.url).pathname);

const DEP = '7c1e2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b';
const OTHER = '0f1e2d3c-4b5a-4968-8776-655443322110';

const run = { deployment_id: DEP, external_id: 'PO-1042', template_version: 1, subject_ref: 'PO-1042', subject_digest: null, started_at: '2026-10-27T01:02:03.000000Z' };

function event(overrides: Record<string, unknown> = {}) {
  return {
    deployment_id: DEP, event_id: 'ev-1', run_external_id: 'PO-1042', step_key: 'read_order', kind: 'start',
    connector: 'mail', operation: 'read', result: 'ok', actor_kind: 'ai_agent', actor_name: 'Order clerk', reason: null,
    occurred_at: '2026-10-27T01:02:03.123456Z', duration_ms: 420, grants_version: 1, prev_digest: intake.GENESIS_DIGEST, ...overrides,
  };
}

async function sealed(events: Record<string, unknown>[]) {
  const tails = new Map<string, string>();
  const out: Record<string, unknown>[] = [];
  for (const e of events) {
    const step = { ...e, prev_digest: tails.get(e.deployment_id as string) ?? intake.GENESIS_DIGEST };
    const digest = await intake.eventDigest(step);
    tails.set(e.deployment_id as string, digest);
    out.push({ ...step, digest });
  }
  return out;
}

describe('parseBatch', () => {
  it('accepts a well-formed batch', async () => {
    const steps = await sealed([event()]);
    const parsed = intake.parseBatch({ batch_id: 'b-1', runs: [run], steps });
    expect(parsed.ok).toBe(true);
    expect(parsed.value.steps[0].digest).toBe(steps[0].digest);
  });

  it('refuses timestamps in any spelling but UTC microseconds', async () => {
    const steps = await sealed([event({ occurred_at: '2026-10-27T10:02:03+09:00' })]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps }).error).toMatch(/occurred_at/);
    expect(intake.parseBatch({ batch_id: 'b-1', runs: [{ ...run, started_at: '2026-10-27T01:02:03Z' }] }).error).toMatch(/started_at/);
  });

  it('refuses instants that do not exist, which the database would move', async () => {
    for (const occurred_at of ['2026-10-27T24:00:00.000000Z', '2026-10-27T23:59:60.000000Z', '2026-02-30T01:00:00.000000Z']) {
      const steps = await sealed([event({ occurred_at })]);
      expect(intake.parseBatch({ batch_id: 'b-1', steps }).error).toMatch(/occurred_at/);
    }
  });

  it('refuses text jsonb cannot hold, and versions past the integer range', async () => {
    for (const reason of ['a\u0000b', 'lone \ud800 high', 'lone \udc00 low']) {
      const steps = await sealed([event({ reason })]);
      expect(intake.parseBatch({ batch_id: 'b-1', steps }).ok).toBe(false);
    }
    const paired = await sealed([event({ reason: '絵文字 😀 は通る' })]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps: paired }).ok).toBe(true);
    expect(intake.parseBatch({ batch_id: 'b-1', runs: [{ ...run, template_version: 2 ** 31 }] }).error).toMatch(/template_version/);
    const negative = await sealed([event({ grants_version: -1 })]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps: negative }).error).toMatch(/grants_version/);
    const none = await sealed([event({ grants_version: null })]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps: none }).ok).toBe(true);
  });

  it('refuses values the ledger would refuse', async () => {
    const steps = await sealed([event({ kind: 'finish' })]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps }).error).toMatch(/kind/);
    expect(intake.parseBatch({ batch_id: 'b-1', runs: [{ ...run, deployment_id: 'nope' }] }).error).toMatch(/uuid/);
  });

  it('refuses an empty batch, a missing id, and an event sent twice', async () => {
    expect(intake.parseBatch({ batch_id: 'b-1', runs: [], steps: [] }).ok).toBe(false);
    expect(intake.parseBatch({ runs: [run] }).error).toMatch(/batch_id/);
    const [one] = await sealed([event()]);
    expect(intake.parseBatch({ batch_id: 'b-1', steps: [one, one] }).error).toMatch(/twice/);
  });
});

describe('batchChainProblem', () => {
  it('passes a chain that links within each deployment', async () => {
    const steps = await sealed([
      event(), event({ deployment_id: OTHER, event_id: 'x-1' }),
      event({ event_id: 'ev-2', kind: 'end', step_key: 'post' }),
    ]);
    expect(await intake.batchChainProblem(steps)).toBeNull();
  });

  it('finds an event whose fields were changed after it was sealed', async () => {
    const steps = await sealed([event(), event({ event_id: 'ev-2', kind: 'end' })]);
    steps[0] = { ...steps[0], result: 'failed' };
    expect(await intake.batchChainProblem(steps)).toMatch(/ev-1: digest/);
  });

  it('finds an event dropped from the middle', async () => {
    const steps = await sealed([event(), event({ event_id: 'ev-2' }), event({ event_id: 'ev-3', kind: 'end' })]);
    expect(await intake.batchChainProblem([steps[0], steps[2]])).toMatch(/ev-3: does not point/);
  });

  it('frames fields by length, so moving text between fields changes the digest', async () => {
    const a = await intake.eventDigest(event({ actor_name: 'ab', reason: 'c' }));
    const b = await intake.eventDigest(event({ actor_name: 'a', reason: 'bc' }));
    expect(a).not.toBe(b);
  });

  it('seals the grants version the gateway held, so it cannot be swapped later', async () => {
    const steps = await sealed([event()]);
    steps[0] = { ...steps[0], grants_version: 2 };
    expect(await intake.batchChainProblem(steps)).toMatch(/ev-1: digest/);
  });
});

describe('verifySignature', () => {
  const b64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url');

  it('accepts the key holder’s signature and nothing else', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
    const body = new TextEncoder().encode(JSON.stringify({ batch_id: 'b-1', runs: [run] }));
    const signature = b64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, body));
    const forged = b64url(await crypto.subtle.sign({ name: 'Ed25519' }, other.privateKey, body));

    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await intake.verifySignature(publicKey, signature, body)).toBe(true);
    expect(await intake.verifySignature(publicKey, forged, body)).toBe(false);
    const altered = body.slice();
    altered[5] ^= 1;
    expect(await intake.verifySignature(publicKey, signature, altered)).toBe(false);
    expect(await intake.verifySignature(publicKey, 'not+base64url', body)).toBe(false);
    expect(await intake.verifySignature('short', signature, body)).toBe(false);
  });
});
