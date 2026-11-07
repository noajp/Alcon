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
