import { describe, expect, it } from 'vitest';

// The shared connection-proposal core (supabase/functions/_shared/
// connectProposal.ts): both the Strategy conversation's handler and
// the Copilot panel driver judge a propose_connection call through it,
// so what counts as a need — never connected, or connected but its
// latest test failed — is decided once.

const core = await import(new URL('../../supabase/functions/_shared/connectProposal.ts', import.meta.url).pathname) as unknown as {
  resolveConnectionProposal: (db: unknown, spaceId: string | null, input: Record<string, unknown> | undefined) => Promise<
    | { kind: 'proposed'; names: string[]; waitingFor: string }
    | { kind: 'already'; asked: string[] }
    | { kind: 'invalid'; error: string }>;
  PROPOSE_CONNECTION_TOOL: { name: string };
};

interface Row { name: string; preset: string | null; enabled: boolean; last_test: unknown }

function fakeDb(rows: Row[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: rows }),
        }),
      }),
    }),
  };
}

const gh = (over: Partial<Row> = {}): Row => ({ name: 'GitHub', preset: 'github', enabled: true, last_test: { ok: true }, ...over });

describe('resolveConnectionProposal', () => {
  it('proposes what is missing, and only that', async () => {
    const r = await core.resolveConnectionProposal(fakeDb([gh()]), 'space-1', { names: ['GitHub', 'Slack'], waitingFor: 'PR を作る' });
    expect(r).toEqual({ kind: 'proposed', names: ['Slack'], waitingFor: 'PR を作る' });
  });

  it('an expired connection is proposed, not answered "already connected" (the chat refusal)', async () => {
    const r = await core.resolveConnectionProposal(
      fakeDb([gh({ last_test: { ok: false, code: 'auth_failed', message: 'Bad credentials' } })]),
      'space-1', { names: ['GitHub'], waitingFor: 'PR を作る' },
    );
    expect(r).toEqual({ kind: 'proposed', names: ['GitHub'], waitingFor: 'PR を作る' });
  });

  it('everything usable reads as already connected', async () => {
    const r = await core.resolveConnectionProposal(fakeDb([gh()]), 'space-1', { names: ['GitHub'], waitingFor: 'PR を作る' });
    expect(r).toEqual({ kind: 'already', asked: ['GitHub'] });
  });

  it('names and waitingFor are both required', async () => {
    expect((await core.resolveConnectionProposal(fakeDb([]), 'space-1', { names: [], waitingFor: 'x' })).kind).toBe('invalid');
    expect((await core.resolveConnectionProposal(fakeDb([]), 'space-1', { names: ['GitHub'] })).kind).toBe('invalid');
    expect((await core.resolveConnectionProposal(fakeDb([]), 'space-1', undefined)).kind).toBe('invalid');
  });

  it('with no Space, everything named is proposed', async () => {
    const r = await core.resolveConnectionProposal(fakeDb([gh()]), null, { names: ['GitHub'], waitingFor: 'PR を作る' });
    expect(r).toEqual({ kind: 'proposed', names: ['GitHub'], waitingFor: 'PR を作る' });
  });

  it('the tool is propose_connection, named for both drivers', () => {
    expect(core.PROPOSE_CONNECTION_TOOL.name).toBe('propose_connection');
  });
});
