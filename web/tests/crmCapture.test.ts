import { describe, expect, it } from 'vitest';
import { buildCrmWorkspace, DEFAULT_CRM_STAGES, type CrmDealRecord } from '@/ActivitySpace/sustainment/crm/crmModel';
import {
  captureChanges, extractJson, findDates, parseAiCapture, parseAmount, readCapture, reviewRows, reviewValues,
} from '@/ActivitySpace/sustainment/crm/crmCapture';

const today = '2026-10-03'; // a Saturday
const record = (values: Partial<CrmDealRecord>): CrmDealRecord => ({
  id: 'x', pipeline_id: 'p', number: 1, name: '', company_id: null, contact_id: null, owner_worker_id: null, stage: 'proposal',
  amount: null, currency: 'USD', probability: null, close_date: null, last_contact_on: null, next_step: null, next_step_on: null,
  next_element_id: null, initiative_id: null, source: null, lost_reason: null, closed_on: null, custom: {}, created_at: '', renews_on: null, renewal_of: null, ...values,
});
const { deals } = buildCrmWorkspace({
  pipeline: { id: 'p', name: 'Sales', stages: DEFAULT_CRM_STAGES, currency: 'USD', horizon_days: 30, follow_up_days: 14, object_id: null, measure_intent_id: null, measure_metric: null, measure_field: null, record_label: null, domain_id: null, order_index: 0, renewal_days: 90, renewal_pipeline_id: null },
  deals: [
    record({ id: 'acme', number: 1, name: 'Acme rollout', company_id: 'c-acme', stage: 'proposal', amount: 1000, probability: 50, close_date: '2026-11-01' }),
    record({ id: 'beta', number: 2, name: 'Beta pilot', company_id: 'c-beta', stage: 'won', amount: 10 }),
  ],
  companies: [
    { id: 'c-acme', name: 'Acme', domain: null, industry: null, owner_worker_id: null, notes: null, custom: {}, created_at: '', domain_id: null },
    { id: 'c-beta', name: 'Beta Corp', domain: null, industry: null, owner_worker_id: null, notes: null, custom: {}, created_at: '', domain_id: null },
  ],
  contacts: [], activities: [], elements: [], people: [],
}, today);

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
    expect(findDates('visited 10/1', today)[0].date).toBe('2026-10-01');
    expect(findDates('12/20に訪問済み', '2027-01-05')[0].date).toBe('2026-12-20');
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

  it('marks a deal won only on an unambiguous outcome', () => {
    expect(readCapture('Acme rollout: contract signed today!', today, deals, DEFAULT_CRM_STAGES).fields.stage).toBe('won');
    expect(readCapture('Acme rollout: NDA signed', today, deals, DEFAULT_CRM_STAGES).fields.stage).toBeUndefined();
    expect(readCapture('Acme 受注確度は60%', today, deals, DEFAULT_CRM_STAGES).fields).toMatchObject({ probability: 60 });
    expect(readCapture('Acme 受注確度は60%', today, deals, DEFAULT_CRM_STAGES).fields.stage).toBeUndefined();
  });

  it('does not invent dates, likelihoods or deals from ordinary words', () => {
    const quiet = readCapture('We sat down with the CFO about Globex', today, [...deals, { ...deals[0], id: 'it', name: 'IT refresh', account: 'IT' }], DEFAULT_CRM_STAGES);
    expect(quiet.dealId).toBeNull();
    expect(quiet.fields.nextActionDate).toBeUndefined();
    expect(readCapture('Acme: 10%値引きを依頼された', today, deals, DEFAULT_CRM_STAGES).fields.probability).toBeUndefined();
    expect(readCapture('Acme 10/1に訪問しました', today, deals, DEFAULT_CRM_STAGES).fields.nextActionDate).toBeUndefined();
    expect(readCapture('Acme社と打ち合わせ', today, deals, DEFAULT_CRM_STAGES).dealId).toBe('acme');
  });

  it('reads amounts after a colon and the top of a range', () => {
    expect(parseAmount('Budget:$50k')).toEqual({ amount: 50_000, currency: 'USD' });
    expect(parseAmount('予算50-60万円')).toEqual({ amount: 600_000, currency: 'JPY' });
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

describe('capture review', () => {
  const options = { primaryCurrency: 'USD', fallbackName: 'New deal', hasField: () => true };
  it('shows a stage move\'s implied likelihood and leaves closing a deal unticked', () => {
    const rows = reviewRows({ dealId: 'acme', fields: { stage: 'won' }, activity: { type: 'note', text: '' }, source: 'local' }, deals[0], DEFAULT_CRM_STAGES, options);
    expect(rows).toEqual([
      { key: 'stage', from: 'proposal', to: 'won', optIn: true },
      { key: 'probability', from: 50, to: 100, impliedBy: 'stage' },
    ]);
    const untouched = (row: { optIn?: boolean }) => !row.optIn;
    expect(reviewValues(rows, untouched)).toEqual({});
    expect(reviewValues(rows, () => true)).toEqual({ stage: 'won', probability: 100 });
  });
  it('lists a new deal\'s defaults', () => {
    const rows = reviewRows({ dealId: null, fields: { name: 'Gamma', amount: 5 }, activity: { type: 'note', text: '' }, source: 'local' }, null, DEFAULT_CRM_STAGES, options);
    expect(reviewValues(rows, row => !row.optIn)).toEqual({ name: 'Gamma', amount: 5, stage: 'lead', currency: 'USD', probability: 10 });
  });
});
