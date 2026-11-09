import { describe, expect, it } from 'vitest';

const ap = await import(new URL('../../supabase/functions/_shared/approvalPolicy.ts', import.meta.url).pathname);
const needs = ap.needsApprovalFor as (facts: Record<string, unknown>) => boolean;

describe('needsApprovalFor', () => {
  it('Alcon-internal tools follow their entry policy', () => {
    expect(needs({ catalogDecision: 'approve', isWrite: true, isRead: false })).toBe(true);
    expect(needs({ catalogDecision: 'allow', isWrite: true, isRead: false })).toBe(false);
    expect(needs({ catalogDecision: 'deny', isWrite: true, isRead: false })).toBe(false);
  });

  it('a call that is not a write never asks', () => {
    expect(needs({ isWrite: false, isRead: true, delegation: 'approve_each' })).toBe(false);
    expect(needs({ isWrite: false, isRead: false, delegation: null })).toBe(false);
  });

  it('a manifest command: a rule-bound ask asks under any delegation', () => {
    const m = { permission: 'ask', rule: 0, critical: null };
    expect(needs({ isWrite: true, isRead: false, manifest: m, delegation: 'full_delegation' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, manifest: m, delegation: 'approve_each' })).toBe(true);
  });

  it('a manifest command: a command-level ask is lifted by full delegation only', () => {
    const m = { permission: 'ask', rule: null, critical: null };
    expect(needs({ isWrite: true, isRead: false, manifest: m, delegation: 'full_delegation' })).toBe(false);
    expect(needs({ isWrite: true, isRead: false, manifest: m, delegation: 'approve_each' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, manifest: m, delegation: null })).toBe(true);
  });

  it('a manifest command: allow never asks, and deny is not asked about', () => {
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: null }, delegation: 'approve_each' })).toBe(false);
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: null }, delegation: 'approve_each' })).toBe(false);
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: 0, critical: null }, delegation: 'approve_each' })).toBe(false);
  });

  it('a critical manifest command asks whatever lifts ordinary asks — but a denial still denies', () => {
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: 'send' }, delegation: 'full_delegation' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: 0, critical: 'money' }, delegation: 'full_delegation' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: 'delete' }, delegation: 'full_delegation' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: 'send' }, delegation: 'approve_each' })).toBe(false);
  });

  it('a critical call with no manifest asks under full delegation too', () => {
    expect(needs({ isWrite: true, isRead: false, critical: 'delete', delegation: 'full_delegation' })).toBe(true);
  });

  it('raw HTTP: non-read methods ask under full delegation; reads do not', () => {
    for (const isRead of [false]) {
      expect(needs({ isWrite: true, isRead, rawHttp: true, delegation: 'full_delegation' })).toBe(true);
      expect(needs({ isWrite: true, isRead, rawHttp: true, delegation: 'approve_each' })).toBe(true);
    }
    expect(needs({ isWrite: true, isRead: true, rawHttp: true, delegation: 'full_delegation' })).toBe(false);
    expect(needs({ isWrite: true, isRead: true, rawHttp: true, delegation: 'approve_each' })).toBe(false);
  });

  it('an ordinary typed write follows the delegation; an unknown delegation asks', () => {
    expect(needs({ isWrite: true, isRead: false, delegation: 'full_delegation' })).toBe(false);
    expect(needs({ isWrite: true, isRead: false, delegation: 'approve_each' })).toBe(true);
    expect(needs({ isWrite: true, isRead: false, delegation: null })).toBe(true);
    expect(needs({ isWrite: true, isRead: false })).toBe(true);
  });

  it('a read with no manifest never asks', () => {
    expect(needs({ isWrite: true, isRead: true, delegation: 'approve_each' })).toBe(false);
  });
});

const verdict = ap.approvalVerdict as (facts: Record<string, unknown>) => 'allow' | 'ask' | 'deny';
const applyMode = ap.applyMode as (v: string, facts: Record<string, unknown>, mode: string) => 'allow' | 'ask' | 'deny';
const underMode = ap.verdictUnderMode as (facts: Record<string, unknown>, mode: string) => 'allow' | 'ask' | 'deny';
const modeOf = ap.approvalModeOf as (value: unknown) => string;

// One fact set per branch of the policy, so the equivalence test below
// walks the whole decision tree instead of a sample of it.
const FACT_MATRIX: Record<string, unknown>[] = [
  { catalogDecision: 'allow', isWrite: true, isRead: false },
  { catalogDecision: 'approve', isWrite: true, isRead: false },
  { catalogDecision: 'deny', isWrite: true, isRead: false },
  { isWrite: false, isRead: true, delegation: 'approve_each' },
  { isWrite: false, isRead: false, delegation: null },
  { isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: null }, delegation: 'approve_each' },
  { isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: 'send' }, delegation: 'approve_each' },
  { isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: 'money' }, delegation: 'full_delegation' },
  { isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: null }, delegation: 'approve_each' },
  { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: 0, critical: null }, delegation: 'full_delegation' },
  { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'full_delegation' },
  { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'approve_each' },
  { isWrite: true, isRead: true, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'approve_each' },
  { isWrite: true, isRead: false, critical: 'delete', delegation: 'full_delegation' },
  { isWrite: true, isRead: false, rawHttp: true, delegation: 'full_delegation' },
  { isWrite: true, isRead: true, rawHttp: true, delegation: 'full_delegation' },
  { isWrite: true, isRead: true, delegation: 'approve_each' },
  { isWrite: true, isRead: false, delegation: 'full_delegation' },
  { isWrite: true, isRead: false, delegation: 'approve_each' },
  { isWrite: true, isRead: false, delegation: null },
  { isWrite: true, isRead: false },
];

describe('approvalVerdict', () => {
  it('names a denial as one, in both places a person can set one', () => {
    expect(verdict({ catalogDecision: 'deny', isWrite: true, isRead: false })).toBe('deny');
    expect(verdict({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: null }, delegation: 'approve_each' })).toBe('deny');
    // A denial outranks even a critical class on the same command.
    expect(verdict({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: 'send' }, delegation: 'approve_each' })).toBe('deny');
  });

  it('is needsApprovalFor read three ways, over the whole matrix', () => {
    for (const facts of FACT_MATRIX) {
      expect(needs(facts), JSON.stringify(facts)).toBe(verdict(facts) === 'ask');
    }
  });
});

describe('applyMode', () => {
  it('deny is refused in every mode — a mode never outranks a prohibition', () => {
    const denied = { isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: null } };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(denied, mode)).toBe('deny');
    const catalogDenied = { catalogDecision: 'deny', isWrite: true, isRead: false };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(catalogDenied, mode)).toBe('deny');
  });

  it('auto is the verdict itself', () => {
    for (const facts of FACT_MATRIX) expect(underMode(facts, 'auto')).toBe(verdict(facts));
  });

  it('free lifts every ask to allow — critical and raw HTTP included — and nothing else', () => {
    expect(underMode({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: 'money' }, delegation: 'full_delegation' }, 'free')).toBe('allow');
    expect(underMode({ isWrite: true, isRead: false, rawHttp: true, delegation: 'approve_each' }, 'free')).toBe('allow');
    expect(underMode({ catalogDecision: 'approve', isWrite: true, isRead: false }, 'free')).toBe('allow');
    expect(underMode({ isWrite: true, isRead: true, delegation: 'approve_each' }, 'free')).toBe('allow');
  });

  it('ask mode collapses every write allow-source to ask', () => {
    // A command's allow.
    expect(underMode({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: null }, delegation: 'approve_each' }, 'ask')).toBe('ask');
    // Full delegation.
    expect(underMode({ isWrite: true, isRead: false, delegation: 'full_delegation' }, 'ask')).toBe('ask');
    expect(underMode({ isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'full_delegation' }, 'ask')).toBe('ask');
    // A catalog allow.
    expect(underMode({ catalogDecision: 'allow', isWrite: true, isRead: false }, 'ask')).toBe('ask');
  });

  it('a mode never adds an ask to a read', () => {
    // Reads whose verdict is allow stay allowed in every mode — above
    // all in ask mode, whose whole job is collapsing allows to asks.
    const readCommand = { isWrite: true, isRead: true, manifest: { permission: 'allow', rule: null, critical: null }, delegation: 'approve_each' };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(readCommand, mode)).toBe('allow');
    const plainRead = { isWrite: true, isRead: true, delegation: 'approve_each' };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(plainRead, mode)).toBe('allow');
    const rawRead = { isWrite: true, isRead: true, rawHttp: true, delegation: 'approve_each' };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(rawRead, mode)).toBe('allow');
    const notWrite = { isWrite: false, isRead: false, delegation: null };
    for (const mode of ['ask', 'auto', 'free']) expect(underMode(notWrite, mode)).toBe('allow');
    // A read the floors themselves hold (a manifest read command whose
    // permission is ask, under approve-each) keeps today's ask under
    // auto and ask mode; only free lifts it, like every other ask.
    const heldRead = { isWrite: true, isRead: true, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'approve_each' };
    expect(underMode(heldRead, 'auto')).toBe('ask');
    expect(underMode(heldRead, 'ask')).toBe('ask');
    expect(underMode(heldRead, 'free')).toBe('allow');
  });

  it('applyMode alone: an ask verdict under ask mode stays an ask', () => {
    expect(applyMode('ask', { isWrite: true, isRead: false }, 'ask')).toBe('ask');
    expect(applyMode('deny', { isWrite: true, isRead: false }, 'free')).toBe('deny');
  });
});

const reasonOf = ap.askReasonOf as (facts: Record<string, unknown>) => string | null;

describe('askReasonOf', () => {
  it('names the hold each facts shape makes, and nothing the verdict lets through', () => {
    expect(reasonOf({ catalogDecision: 'approve', isWrite: true, isRead: false })).toBe('catalog');
    expect(reasonOf({ catalogDecision: 'allow', isWrite: true, isRead: false })).toBeNull();
    expect(reasonOf({ isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: 'send' }, delegation: 'full_delegation' })).toBe('critical');
    expect(reasonOf({ isWrite: true, isRead: false, manifest: { permission: 'ask', rule: 2, critical: null }, delegation: 'full_delegation' })).toBe('rule');
    expect(reasonOf({ isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'approve_each' })).toBe('command');
    expect(reasonOf({ isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'full_delegation' })).toBeNull();
    expect(reasonOf({ isWrite: true, isRead: false, critical: 'delete', delegation: 'approve_each' })).toBe('critical');
    expect(reasonOf({ isWrite: true, isRead: false, rawHttp: true, delegation: 'approve_each' })).toBe('http');
    // A denial is not asked about, and a typed write held only by its
    // connection's delegation has no named reason.
    expect(reasonOf({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: 'send' }, delegation: 'approve_each' })).toBeNull();
    expect(reasonOf({ isWrite: true, isRead: false, delegation: 'approve_each' })).toBeNull();
    expect(reasonOf({ isWrite: false, isRead: true, delegation: 'approve_each' })).toBeNull();
  });
});

describe('approvalModeOf', () => {
  it('reads the three modes and falls back to auto for anything else', () => {
    expect(modeOf('ask')).toBe('ask');
    expect(modeOf('auto')).toBe('auto');
    expect(modeOf('free')).toBe('free');
    expect(modeOf(null)).toBe('auto');
    expect(modeOf(undefined)).toBe('auto');
    expect(modeOf('yolo')).toBe('auto');
    expect(ap.APPROVAL_MODES).toEqual(['ask', 'auto', 'free']);
  });
});

describe('liftOf', () => {
  const lift = ap.liftOf as (facts: Record<string, unknown>) => 'delegation' | null;
  const underMode = ap.verdictUnderMode as (facts: Record<string, unknown>, mode: string) => string;
  const lifted = { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'full_delegation' };

  it('names exactly the delegation branch of the verdict', () => {
    expect(lift(lifted)).toBe('delegation');
    // A rule-bound ask is held, not lifted; a critical command asks.
    expect(lift({ ...lifted, manifest: { permission: 'ask', rule: 0, critical: null } })).toBeNull();
    expect(lift({ ...lifted, manifest: { permission: 'ask', rule: null, critical: 'send' } })).toBeNull();
    // No delegation, no lift; an allowed or denied command was never lifted.
    expect(lift({ ...lifted, delegation: 'approve_each' })).toBeNull();
    expect(lift({ ...lifted, delegation: null })).toBeNull();
    expect(lift({ ...lifted, manifest: { permission: 'allow', rule: null, critical: null } })).toBeNull();
    expect(lift({ ...lifted, manifest: { permission: 'deny', rule: null, critical: null } })).toBeNull();
    // Not a manifest command at all: catalog, raw HTTP, the typed-write
    // fall-through (its verdict allows under full delegation, but no
    // command's "Asks first" was lifted), and reads.
    expect(lift({ catalogDecision: 'allow', isWrite: true, isRead: false })).toBeNull();
    expect(lift({ isWrite: true, isRead: false, rawHttp: true, delegation: 'full_delegation' })).toBeNull();
    expect(lift({ isWrite: true, isRead: false, delegation: 'full_delegation' })).toBeNull();
    expect(lift({ isWrite: false, isRead: true, manifest: { permission: 'ask', rule: null, critical: null }, delegation: 'full_delegation' })).toBeNull();
  });

  it('the mode is not part of the lift: under ask-every-time the same call is held, so no driver discloses a run that did not happen unasked', () => {
    expect(underMode(lifted, 'ask')).toBe('ask');
    expect(underMode(lifted, 'auto')).toBe('allow');
    expect(underMode(lifted, 'free')).toBe('allow');
  });
});

describe('chain scope (B10) — the fence is the verdict\u2019s first rule', () => {
  const verdict = ap.approvalVerdict as (facts: Record<string, unknown>) => string;
  const withAutonomy = ap.verdictWithAutonomy as (facts: Record<string, unknown>, mode: string) => { base: string; final: string; lift: string | null };
  const grantLiftable = ap.grantLiftable as (facts: Record<string, unknown>) => boolean;

  // The matrix the design pins (§10 fixture 7): mode × delegation ×
  // grant × critical, over the fact shapes a call can carry. An
  // out-of-scope call is denied in EVERY combination — no mode,
  // delegation, standing rule, grant or plan approval composes over
  // the fence, because each of them reads this verdict and applyMode
  // never moves a deny — and an in-scope call's verdict is
  // byte-identical to the same call with no chain fact at all (the
  // fact does nothing but deny the outside).
  const shapes: Record<string, Record<string, unknown>> = {
    'grant-liftable ask': { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: null, critical: null } },
    'allowed write': { isWrite: true, isRead: false, manifest: { permission: 'allow', rule: null, critical: null } },
    'rule-bound ask': { isWrite: true, isRead: false, manifest: { permission: 'ask', rule: 0, critical: null } },
    'a read': { isWrite: true, isRead: true, manifest: { permission: 'allow', rule: null, critical: null } },
    'raw http write': { isWrite: true, isRead: false, rawHttp: true },
    'catalog allow': { catalogDecision: 'allow', isWrite: true, isRead: false },
  };
  const modes = ['ask', 'auto', 'free'];
  const delegations = ['approve_each', 'full_delegation', null];
  const grants = [null, { lane: 1, clean: 9 }];
  const criticals = [null, 'send'];

  it('out-of-scope is deny in every combination of the matrix', () => {
    for (const [shapeName, shape] of Object.entries(shapes)) {
      for (const mode of modes) for (const delegation of delegations) for (const grant of grants) for (const critical of criticals) {
        const facts = {
          ...shape, delegation,
          ...(shape.manifest ? { manifest: { ...(shape.manifest as Record<string, unknown>), critical } } : {}),
          ...(shape.critical === undefined && critical && !shape.manifest ? { critical } : {}),
          autonomyGrant: grant, chain: { inScope: false },
        };
        const v = withAutonomy(facts, mode);
        expect(v, `${shapeName} / ${mode} / ${delegation} / grant=${!!grant} / critical=${critical}`).toEqual({ base: 'deny', final: 'deny', lift: null });
        expect(needs(facts)).toBe(false); // a deny is refused, never asked about
      }
    }
  });

  it('in-scope verdicts are byte-identical to the no-fact verdicts (the regression pin)', () => {
    for (const shape of Object.values(shapes)) {
      for (const mode of modes) for (const delegation of delegations) for (const grant of grants) for (const critical of criticals) {
        const base = {
          ...shape, delegation,
          ...(shape.manifest ? { manifest: { ...(shape.manifest as Record<string, unknown>), critical } } : {}),
          autonomyGrant: grant,
        };
        expect(withAutonomy({ ...base, chain: { inScope: true } }, mode)).toEqual(withAutonomy(base, mode));
        expect(withAutonomy({ ...base, chain: null }, mode)).toEqual(withAutonomy(base, mode));
      }
    }
  });

  it('a grant can never reach an out-of-scope call: grantLiftable requires an ask, and the base is deny', () => {
    const liftableShape = {
      isWrite: true, isRead: false, delegation: 'approve_each',
      manifest: { permission: 'ask', rule: null, critical: null }, autonomyGrant: { lane: 1, clean: 9 },
    };
    expect(grantLiftable(liftableShape)).toBe(true);
    expect(verdict(liftableShape)).toBe('ask');
    const fenced = { ...liftableShape, chain: { inScope: false } };
    expect(verdict(fenced)).toBe('deny');
    expect(grantLiftable(fenced)).toBe(false);
  });

  it('the fence precedes the catalog\u2019s entry policy and the manifest\u2019s own deny', () => {
    expect(verdict({ catalogDecision: 'allow', isWrite: true, isRead: false, chain: { inScope: false } })).toBe('deny');
    expect(verdict({ catalogDecision: 'deny', isWrite: true, isRead: false, chain: { inScope: true } })).toBe('deny');
    expect(verdict({ isWrite: true, isRead: false, manifest: { permission: 'deny', rule: null, critical: null }, chain: { inScope: false } })).toBe('deny');
  });
});
