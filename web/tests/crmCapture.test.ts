import { describe, expect, it } from 'vitest';
import { OPERATIONS_FIELDS } from '@/ActivitySpace/sustainment/operations/operationsModel';
import { buildCrmWorkspace, DEFAULT_CRM_STAGES } from '@/ActivitySpace/sustainment/crm/crmModel';
import {
  captureChanges, extractJson, findDates, parseAiCapture, parseAmount, readCapture,
} from '@/ActivitySpace/sustainment/crm/crmCapture';

const today = '2026-10-03'; // a Saturday
const fields = Object.fromEntries(OPERATIONS_FIELDS.crm.map(field => [field.key, field.key]));
const { deals } = buildCrmWorkspace({
  columns: OPERATIONS_FIELDS.crm.map(field => ({ id: field.key, type: field.type })),
  rows: [{ id: 'acme' }, { id: 'beta' }],
  cellsByRow: {
    acme: { name: 'Acme rollout', account: 'Acme', stage: 'proposal', amount: 1000, probability: 50, currency: 'USD', closeDate: '2026-11-01' },
    beta: { name: 'Beta pilot', account: 'Beta Corp', stage: 'won', amount: 10, currency: 'USD' },
  },
}, { kind: 'crm', tableId: 't', fields }, today);

describe('amounts', () => {
  it.each([
    ['budget ¥1.2M', 1_200_000, 'JPY'], ['$50k ARR', 50_000, 'USD'], ['予算は120万円', 1_200_000, 'JPY'],
    ['1.5億', 150_000_000, null], ['50,000 USD', 50_000, 'USD'], ['3,000,000円で合意', 3_000_000, 'JPY'],
  ])('reads %s', (input, amount, currency) => {
    expect(parseAmount(input)).toEqual({ amount, currency });
  });
  it('ignores dates, percentages and bare counts', () => {
    expect(parseAmount('2026-10-03 at 50% with 20 seats')).toBeNull();
  });
});

describe('dates', () => {
  it('resolves absolute and relative expressions against today', () => {
    expect(findDates('call 2026-10-09, then 10/20', today).map(item => item.date)).toEqual(['2026-10-09', '2026-10-20']);
    expect(findDates('次回は来週、契約は来月末', today).map(item => item.date)).toEqual(['2026-10-10', '2026-11-30']);
    expect(findDates('tomorrow', today)[0].date).toBe('2026-10-04');
    expect(findDates('demo on Tuesday', today)[0].date).toBe('2026-10-06');
    expect(findDates('1/15 kickoff', today)[0].date).toBe('2027-01-15');
  });
});

describe('local capture', () => {
  it('updates the deal it mentions and separates close date from next action', () => {
    const proposal = readCapture('Call with Acme: budget $80k, 70% likely. Contract signing end of month. Next: send revised quote on Tuesday', today, deals, DEFAULT_CRM_STAGES);
    expect(proposal.dealId).toBe('acme');
    expect(proposal.fields).toMatchObject({ amount: 80_000, currency: 'USD', probability: 70, closeDate: '2026-10-31', nextActionDate: '2026-10-06', nextStep: 'send revised quote on Tuesday' });
    expect(proposal.fields.name).toBeUndefined();
    expect(proposal.activity.type).toBe('call');
  });

  it('proposes a new deal and reads Japanese notes', () => {
    const proposal = readCapture('新規：Gamma社 打ち合わせ。見積 300万円、決裁は来月末。次回 10/9 に提案資料送付', today, deals, DEFAULT_CRM_STAGES);
    expect(proposal.dealId).toBeNull();
    expect(proposal.fields).toMatchObject({ amount: 3_000_000, currency: 'JPY', stage: 'proposal', closeDate: '2026-11-30', nextActionDate: '2026-10-09' });
    expect(proposal.fields.name).toContain('Gamma');
    expect(proposal.activity.type).toBe('meeting');
  });

  it('marks a deal won', () => {
    expect(readCapture('Acme rollout signed today!', today, deals, DEFAULT_CRM_STAGES).fields.stage).toBe('won');
  });
});

describe('AI capture', () => {
  it('extracts the first JSON object even around prose and braces in strings', () => {
    expect(extractJson('Sure! {"a": "x}y", "b": {"c": 1}} trailing')).toEqual({ a: 'x}y', b: { c: 1 } });
    expect(extractJson('no json')).toBeNull();
  });

  it('keeps only valid fields and known deals', () => {
    const reply = JSON.stringify({ dealId: 'acme', summary: 'Pricing agreed', activityType: 'meeting', fields: {
      amount: 90000, currency: 'usd', probability: 140, closeDate: '2026-02-30', nextActionDate: '2026-10-08', stage: 'negotiation', email: 'not-an-email', nextStep: 'Send MSA',
    } });
    const proposal = parseAiCapture(reply, 'notes', deals, DEFAULT_CRM_STAGES)!;
    expect(proposal).toMatchObject({ dealId: 'acme', source: 'ai', summary: 'Pricing agreed', activity: { type: 'meeting' } });
    expect(proposal.fields).toEqual({ amount: 90000, currency: 'USD', nextActionDate: '2026-10-08', stage: 'negotiation', nextStep: 'Send MSA' });
    expect(parseAiCapture(JSON.stringify({ dealId: 'ghost', fields: {} }), 'First line\nmore', deals, DEFAULT_CRM_STAGES)).toMatchObject({ dealId: null, fields: { name: 'First line' } });
  });

  it('lists only real changes for review', () => {
    const proposal = parseAiCapture(JSON.stringify({ dealId: 'acme', fields: { amount: 1000, probability: 60, name: 'Renamed' } }), 'x', deals, DEFAULT_CRM_STAGES)!;
    expect(captureChanges(proposal, deals[0])).toEqual([{ key: 'probability', from: 50, to: 60 }]);
  });
});
