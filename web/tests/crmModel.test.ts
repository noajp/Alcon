import { describe, expect, it } from 'vitest';
import {
  accountsOf, buildCrmWorkspace, fieldsFor, measureValue, readChange, readUnit, fieldKey, fieldOptions, forecastFor, inList, metricValue, normalizeCrmStages, parseActivityLog,
  pipelineColumns, searchDeals, stageChange, todayQueue, upcoming, DEFAULT_CRM_STAGES,
  type CrmDealRecord, type CrmNextElement, type CrmPipelineRecord, type CrmRecords,
} from '@/Function/crm/crmModel';

const today = '2026-10-03';
const pipeline: CrmPipelineRecord = {
  id: 'p', name: 'Sales', stages: DEFAULT_CRM_STAGES, currency: 'USD', horizon_days: 30, follow_up_days: 14,
  object_id: null, measure_intent_id: null, measure_metric: null, measure_field: null, record_label: null, domain_id: null, order_index: 0,
  renewal_days: 90, renewal_pipeline_id: null,
};
let seq = 0;
const deal = (values: Partial<CrmDealRecord> = {}): CrmDealRecord => ({
  id: `d${++seq}`, pipeline_id: 'p', number: seq, name: 'Renewal', company_id: 'acme', contact_id: null, owner_worker_id: 'w1',
  stage: 'proposal', amount: 1000, currency: 'USD', probability: 50, close_date: '2026-10-20', last_contact_on: '2026-10-01',
  next_step: 'Send quote', next_step_on: '2026-10-06', next_element_id: null, initiative_id: null, source: null, lost_reason: null,
  closed_on: null, custom: {}, created_at: '2026-09-01T00:00:00Z', renews_on: null, renewal_of: null, ...values,
});
function workspace(deals: CrmDealRecord[], extra: Partial<CrmRecords> = {}) {
  return buildCrmWorkspace({
    pipeline, deals, activities: [], elements: [],
    companies: [{ id: 'acme', name: 'Acme', domain: null, industry: null, owner_worker_id: null, notes: null, custom: {}, created_at: '', domain_id: null },
      { id: 'beta', name: 'Beta', domain: null, industry: null, owner_worker_id: null, notes: null, custom: {}, created_at: '', domain_id: null }],
    contacts: [], people: [{ id: 'w1', name: 'Sato', type: 'human', user_id: 'u1' }, { id: 'w2', name: 'Claude', type: 'ai_agent', user_id: null }],
    ...extra,
  }, today);
}

describe('CRM stages', () => {
  it('falls back to defaults and drops reserved, duplicate or malformed stages', () => {
    expect(normalizeCrmStages(undefined)).toEqual(DEFAULT_CRM_STAGES);
    expect(normalizeCrmStages([{ id: 'Won' }, { id: 'demo', label: 'Demo', probability: 140 }, { id: 'DEMO' }, null])).toEqual([{ id: 'demo', label: 'Demo', probability: 100 }]);
  });

  it('keeps unknown open stages as their own column and closes won and lost', () => {
    const result = workspace([deal({ stage: 'Negotiation' }), deal({ stage: 'pilot' }), deal({ stage: 'won' }), deal({ stage: 'other-pipeline', pipeline_id: 'x' })]);
    expect(result.deals.map(item => [item.stage?.id, item.outcome])).toEqual([['negotiation', 'open'], ['pilot', 'open'], ['won', 'won']]);
    expect(pipelineColumns(result).map(column => column.stage.id)).toEqual(['lead', 'qualified', 'proposal', 'negotiation', 'pilot', 'won', 'lost']);
  });

  it('keeps a hand-set probability when moving between open stages', () => {
    const [qualified, proposal] = [DEFAULT_CRM_STAGES[1], DEFAULT_CRM_STAGES[2]];
    expect(stageChange({ probability: 25, stage: qualified }, proposal)).toEqual({ stage: 'proposal', probability: 50 });
    expect(stageChange({ probability: 35, stage: qualified }, proposal)).toEqual({ stage: 'proposal', probability: 35 });
  });
});

describe('CRM records', () => {
  it('resolves company and owner names, and a stage default for a missing probability', () => {
    const [item] = workspace([deal({ probability: null, owner_worker_id: 'w2' })]).deals;
    expect(item).toMatchObject({ account: 'Acme', ownerName: 'Claude', probability: 50, weighted: 500 });
  });

  it('treats an open deal without amount or close date as incomplete, never as healthy', () => {
    const [item] = workspace([deal({ amount: null, close_date: null })]).deals;
    expect(item.valid).toBe(false);
    expect(item.issues.map(issue => issue.message)).toEqual(['Add the amount', 'Add the expected close date']);
    expect(item.health.level).toBe('incomplete');
  });

  it('reads the next step from its Element and asks for the next one when it is done', () => {
    const element = (status: string): CrmNextElement => ({ id: 'e1', title: 'Demo for IT', status, due_date: '2026-10-02', display_id: 'ELE-9' });
    const [open] = workspace([deal({ next_element_id: 'e1' })], { elements: [element('todo')] }).deals;
    expect(open).toMatchObject({ nextStep: 'Demo for IT', nextActionDate: '2026-10-02' });
    expect(open.action?.code).toBe('action_overdue');
    const [done] = workspace([deal({ next_element_id: 'e1' })], { elements: [element('done')] }).deals;
    expect(done).toMatchObject({ nextStep: null, nextActionDate: null });
    expect(done.action?.code).toBe('step_done');
  });

  it('orders the history newest first and keeps stage entries', () => {
    const [item] = workspace([deal({ id: 'x' })], { activities: [
      { id: 'a1', deal_id: 'x', company_id: null, contact_id: null, kind: 'call', body: 'first', occurred_on: '2026-09-30', created_by: null, author_name: 'Sato', created_at: '1' },
      { id: 'a2', deal_id: 'x', company_id: null, contact_id: null, kind: 'stage', body: 'lead → proposal', occurred_on: '2026-10-01', created_by: null, author_name: null, created_at: '2' },
    ] }).deals;
    expect(item.activity.map(entry => [entry.type, entry.text])).toEqual([['stage', 'lead → proposal'], ['call', 'first']]);
  });
});

describe('CRM health and next actions', () => {
  it('explains every deduction, worst first', () => {
    const [item] = workspace([deal({ close_date: '2026-09-30', next_step: null, next_step_on: null, last_contact_on: '2026-09-01' })]).deals;
    expect(item.health.level).toBe('risk');
    expect(item.health.reasons.map(reason => reason.message)).toEqual(['Close date {date} has passed', '{n} days since last contact', 'No next action scheduled']);
  });

  it('orders the day by urgency, then by weighted value', () => {
    const result = workspace([
      deal({ name: 'Small overdue', amount: 100, next_step_on: '2026-10-01' }),
      deal({ name: 'Big overdue', amount: 9000, next_step_on: '2026-10-02' }),
      deal({ name: 'Today', next_step_on: today }),
      deal({ name: 'Unplanned', next_step: null, next_step_on: null }),
      deal({ name: 'Fine' }),
      deal({ name: 'Closed', stage: 'won', next_step_on: '2026-09-01' }),
    ]);
    expect(todayQueue(result.deals).map(item => item.name)).toEqual(['Big overdue', 'Small overdue', 'Today', 'Unplanned']);
    expect(upcoming(result.deals, today).map(item => item.name)).toEqual(['Fine']);
  });
});

describe('CRM rollups', () => {
  const result = workspace([
    deal({ name: 'A1', amount: 1000, probability: 80, close_date: '2026-10-20', initiative_id: 'i1' }),
    deal({ name: 'A2', amount: 500, probability: 20, close_date: '2026-12-01', owner_worker_id: 'w2' }),
    deal({ name: 'A3', stage: 'won', amount: 700, close_date: '2026-09-15', closed_on: '2026-10-02' }),
    deal({ name: 'A4', stage: 'won', amount: 300, close_date: '2026-02-01', closed_on: '2026-02-01' }),
    deal({ name: 'B1', company_id: 'beta', stage: 'lost', amount: 300 }),
    deal({ name: 'Late', company_id: null, amount: 200, probability: 50, close_date: '2026-09-15' }),
    deal({ name: 'Yen', company_id: 'beta', amount: 50000, currency: 'JPY', custom: { region: 'Kanto' } }),
  ]);

  it('groups deals by company with no-company last', () => {
    expect(accountsOf(result.deals).map(account => [account.name, account.openCount])).toEqual([['Beta', 1], ['Acme', 2], [null, 1]]);
  });

  it('counts a won deal in the month it closed and overdue open deals in this month', () => {
    const forecast = forecastFor(result.deals, 'USD', today, 3);
    expect(forecast.months[0]).toMatchObject({ month: '2026-10', bestCase: 1200, commit: 1000, weighted: 900, won: 700, count: 2 });
    expect(forecast.winRate).toBeCloseTo(2 / 3);
  });

  it('reports the figure an Initiative tracks', () => {
    expect(metricValue(result.deals, 'won_quarter', 'USD', today)).toBe(700);
    expect(metricValue(result.deals, 'won_year', 'USD', today)).toBe(1000);
    expect(metricValue(result.deals, 'won_total', 'USD', today)).toBe(1000);
    expect(metricValue(result.deals, 'open', 'USD', today)).toBe(1700);
    expect(metricValue(result.deals, 'weighted', 'USD', today)).toBe(1000);
  });

  it('counts deals won in every currency, by when they closed', () => {
    const counted = workspace([
      deal({ stage: 'won', closed_on: '2026-10-02' }), deal({ stage: 'won', currency: 'JPY', amount: null, closed_on: '2026-08-01' }),
      deal({ stage: 'won', closed_on: '2025-12-01' }), deal({ stage: 'lost', closed_on: '2026-10-01' }), deal(),
    ]);
    expect(metricValue(counted.deals, 'won_count_quarter', 'USD', today)).toBe(1);
    expect(metricValue(counted.deals, 'won_count_year', 'USD', today)).toBe(2);
    expect(metricValue(counted.deals, 'won_count_total', 'USD', today)).toBe(3);
  });

  it('writes money only into the pipeline currency at the condition scale, and counts only into counts', () => {
    expect(measureValue('円', 'won_quarter', 'JPY', 48_000_000)).toBe(48_000_000);
    expect(measureValue('万円', 'won_quarter', 'JPY', 48_000_000)).toBe(4800);
    expect(measureValue('百万円', 'won_total', 'JPY', 48_000_000)).toBe(48);
    expect(measureValue('￥', 'won_quarter', 'JPY', 10)).toBe(10);
    expect(measureValue('ＪＰＹ', 'open', 'JPY', 10)).toBe(10);
    expect(measureValue('USD', 'won_quarter', 'JPY', 10)).toBeNull();
    expect(measureValue('社', 'won_quarter', 'JPY', 10)).toBeNull();
    expect(measureValue('社', 'won_count_quarter', 'JPY', 3)).toBe(3);
    expect(measureValue('pcs', 'won_count_total', 'JPY', 3)).toBe(3);
    expect(measureValue('円', 'won_count_total', 'JPY', 3)).toBeNull();
    expect(measureValue('%', 'won_count_total', 'JPY', 3)).toBeNull();
    expect(measureValue('円/月', 'won_quarter', 'JPY', 3)).toBeNull();
    expect(measureValue(null, 'open', 'JPY', 7)).toBe(7);
    expect(readUnit('US$')).toEqual({ kind: 'money', currency: 'USD', scale: 1 });
    for (const unknown of ['円(税込)', '米ドル', 'yen', 'dollars', '十万円', '千万円', '万人', '万', 'k']) {
      expect(readUnit(unknown).kind, unknown).toBe('unknown');
      expect(measureValue(unknown, 'won_count_total', 'JPY', 3), unknown).toBeNull();
      expect(measureValue(unknown, 'won_total', 'JPY', 3), unknown).toBeNull();
    }
    expect(readUnit('cup')).toEqual({ kind: 'count' });
    expect(readUnit('人')).toEqual({ kind: 'count' });
  });

  it('filters my deals and searches custom fields and deal numbers', () => {
    expect(result.deals.filter(item => inList(item, 'mine', today, 30, 'w2')).map(item => item.name)).toEqual(['A2']);
    expect(searchDeals(result.deals, 'kanto').map(item => item.name)).toEqual(['Yen']);
    expect(searchDeals(result.deals, `d-${result.deals[0].number}`).map(item => item.name)).toEqual(['A1']);
  });
});

describe('CRM fields and import', () => {
  it('shows a Domain field only on that Domain\'s records, and Space fields everywhere', () => {
    const fields = [
      { id: '1', entity: 'deal' as const, domain_id: null }, { id: '2', entity: 'deal' as const, domain_id: 'nexus' },
      { id: '3', entity: 'deal' as const, domain_id: 'hokushin' }, { id: '4', entity: 'company' as const, domain_id: null },
    ];
    expect(fieldsFor(fields, 'deal', 'hokushin').map(field => field.id)).toEqual(['1', '3']);
    expect(fieldsFor(fields, 'deal', null).map(field => field.id)).toEqual(['1']);
    expect(fieldsFor(fields, 'company', 'nexus').map(field => field.id)).toEqual(['4']);
  });

  it('derives stable keys and clean choices', () => {
    expect(fieldKey('Contract type', [])).toBe('contract_type');
    expect(fieldKey('Contract type', ['contract_type'])).toBe('contract_type_2');
    expect(fieldKey('契約種別', [])).toBe('field');
    expect(fieldOptions({ options: ['A', ' ', 3, 'B'] })).toEqual(['A', 'B']);
  });

  it('reads a Table-era activity log', () => {
    expect(parseActivityLog('2026-10-02 · call · Budget\ntyped by hand')).toEqual([
      { date: '2026-10-02', type: 'call', text: 'Budget' }, { date: null, type: 'note', text: 'typed by hand' },
    ]);
  });
});

describe('renewals', () => {
  const won = (values: Partial<CrmDealRecord>) => deal({ stage: 'won', closed_on: '2026-04-01', ...values });
  const build = (deals: CrmDealRecord[], renewalDays = 90) => buildCrmWorkspace({
    pipeline: { ...pipeline, renewal_days: renewalDays }, deals, companies: [], contacts: [], activities: [], elements: [], people: [],
  }, today).deals;

  it('asks for the renewal of a won deal inside the window', () => {
    const [d] = build([won({ id: 'a', renews_on: '2026-12-01' })]);
    expect(d.action).toMatchObject({ code: 'renewal_due', urgency: 'plan' });
    expect(inList(d, 'renewing', today, 30)).toBe(true);
  });
  it('is soon within 30 days and overdue once the date has passed', () => {
    expect(build([won({ renews_on: '2026-10-20' })])[0].action?.urgency).toBe('soon');
    expect(build([won({ renews_on: '2026-09-30' })])[0].action?.urgency).toBe('overdue');
    expect(build([won({ renews_on: today })])[0].action?.urgency).toBe('today');
  });
  it('stays quiet outside the pipeline’s window', () => {
    expect(build([won({ renews_on: '2027-03-01' })])[0].action).toBeNull();
    expect(build([won({ renews_on: '2026-12-01' })], 30)[0].action).toBeNull();
  });
  it('stays quiet once a renewal deal exists, in any pipeline', () => {
    const deals = build([won({ id: 'a', renews_on: '2026-12-01' }), deal({ id: 'b', pipeline_id: 'other', renewal_of: 'a' })]);
    expect(deals[0].renewedBy).toBe('b');
    expect(deals[0].action).toBeNull();
  });
  it('leaves open and lost deals to their usual actions', () => {
    expect(build([deal({ stage: 'lost', renews_on: '2026-10-10' })])[0].action).toBeNull();
    expect(build([deal({ renews_on: '2026-10-10' })])[0].action?.code).not.toBe('renewal_due');
  });
});

describe('readChange', () => {
  it('reads an amount revision with its currency', () => {
    expect(readChange('amount: 48000000 JPY → 45600000 JPY')).toEqual({
      field: 'amount', from: { value: '48000000', currency: 'JPY' }, to: { value: '45600000', currency: 'JPY' },
    });
  });
  it('reads a missing side as null', () => {
    expect(readChange('close_date: — → 2026-12-15')).toEqual({ field: 'close_date', from: null, to: { value: '2026-12-15', currency: null } });
    expect(readChange('probability: 40 → —')).toEqual({ field: 'probability', from: { value: '40', currency: null }, to: null });
  });
  it('ignores lines that are not revisions', () => {
    expect(readChange('lead → qualified')).toBeNull();
    expect(readChange('name: a → b')).toBeNull();
  });
});

describe('field metrics', () => {
  const build = (deals: CrmDealRecord[]) => buildCrmWorkspace({
    pipeline, deals, companies: [], contacts: [], activities: [], elements: [], people: [],
  }, today).deals;
  const deals = build([
    deal({ stage: 'won', closed_on: '2026-08-10', custom: { arr: 1200000 } }),
    deal({ stage: 'won', closed_on: '2026-10-01', custom: { arr: '800,000' }, currency: 'JPY' }),
    deal({ stage: 'won', closed_on: '2025-12-01', custom: { arr: 500000 } }),
    deal({ stage: 'won', closed_on: '2026-10-02', custom: {} }),
    deal({ stage: 'proposal', custom: { arr: 9999999 } }),
  ]);

  it('adds up a number field over won deals in every currency', () => {
    expect(metricValue(deals, 'won_field_total', 'USD', today, 'arr')).toBe(2500000);
    expect(metricValue(deals, 'won_field_year', 'USD', today, 'arr')).toBe(2000000);
    expect(metricValue(deals, 'won_field_quarter', 'USD', today, 'arr')).toBe(800000);
  });
  it('reports nothing without a field', () => {
    expect(metricValue(deals, 'won_field_total', 'USD', today, null)).toBe(0);
  });
  it('reported as money, counts only deals in the pipeline’s currency', () => {
    expect(metricValue(deals, 'won_field_total', 'USD', today, 'arr', '円')).toBe(1700000);
    expect(metricValue(deals, 'won_field_total', 'JPY', today, 'arr', '万円')).toBe(800000);
    expect(metricValue(deals, 'won_field_total', 'USD', today, 'arr', '席')).toBe(2500000);
  });
  it('goes into counts as is, into money of the pipeline’s currency at its scale, never into rates', () => {
    expect(measureValue('席', 'won_field_total', 'USD', 120)).toBe(120);
    expect(measureValue('億円', 'won_field_total', 'JPY', 1_200_000_000)).toBe(12);
    expect(measureValue('億円', 'won_field_total', 'USD', 1_200_000_000)).toBeNull();
    expect(measureValue('%', 'won_field_total', 'USD', 5)).toBeNull();
    expect(measureValue(null, 'won_field_total', 'USD', 5)).toBe(5);
  });
});
