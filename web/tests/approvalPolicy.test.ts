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
