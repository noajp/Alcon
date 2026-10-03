import { describe, expect, it } from 'vitest';
import type { Json } from '@/types/database';
import { OPERATIONS_FIELDS } from '@/ActivitySpace/sustainment/operations/operationsModel';
import {
  accountsOf, appendActivity, buildCrmWorkspace, forecastFor, inList, normalizeCrmStages, parseActivityLog,
  pipelineColumns, searchDeals, stageChange, todayQueue, upcoming, DEFAULT_CRM_STAGES,
} from '@/ActivitySpace/sustainment/crm/crmModel';

const today = '2026-10-03';
const fields = Object.fromEntries(OPERATIONS_FIELDS.map(field => [field.key, field.key]));

function workspace(values: Record<string, Json | null>[], extra: Record<string, unknown> = {}) {
  const schema = {
    columns: OPERATIONS_FIELDS.map(field => ({ id: field.key, type: field.type })),
    rows: values.map((_, index) => ({ id: `r${index}`, created_at: '2026-09-01T00:00:00Z' })),
    cellsByRow: Object.fromEntries(values.map((value, index) => [`r${index}`, value])),
  };
  return buildCrmWorkspace(schema, { kind: 'crm', tableId: 't', fields, ...extra }, today);
}

const deal = (values: Record<string, Json | null> = {}) => ({
  name: 'Renewal', account: 'Acme', stage: 'proposal', amount: 1000, probability: 50, currency: 'USD',
  closeDate: '2026-10-20', lastContact: '2026-10-01', nextActionDate: '2026-10-06', ...values,
});

describe('CRM stages', () => {
  it('falls back to defaults and drops reserved, duplicate or malformed stages', () => {
    expect(normalizeCrmStages(undefined)).toEqual(DEFAULT_CRM_STAGES);
    expect(normalizeCrmStages([{ id: 'Won' }, { id: 'demo', label: 'Demo', probability: 140 }, { id: 'DEMO' }, null])).toEqual([{ id: 'demo', label: 'Demo', probability: 100 }]);
    expect(normalizeCrmStages([])).toEqual(DEFAULT_CRM_STAGES);
  });

  it('resolves stages by id or label and keeps unknown open stages as their own column', () => {
    const result = workspace([deal({ stage: 'Negotiation' }), deal({ stage: 'pilot' }), deal({ stage: 'won' }), deal({ stage: null })]);
    expect(result.deals.map(item => item.stage?.id ?? null)).toEqual(['negotiation', 'pilot', 'won', null]);
    const columns = pipelineColumns(result);
    expect(columns.map(column => column.stage.id)).toEqual(['', 'lead', 'qualified', 'proposal', 'negotiation', 'pilot', 'won', 'lost']);
    expect(columns.find(column => column.stage.id === 'pilot')!.totals).toEqual({ USD: 1000 });
  });

  it('keeps a hand-set probability when moving between open stages', () => {
    const [qualified, proposal] = [DEFAULT_CRM_STAGES[1], DEFAULT_CRM_STAGES[2]];
    expect(stageChange({ probability: 25, stage: qualified }, proposal)).toEqual({ stage: 'proposal', probability: 50 });
    expect(stageChange({ probability: 35, stage: qualified }, proposal)).toEqual({ stage: 'proposal', probability: 35 });
    expect(stageChange({ probability: 35, stage: qualified }, { id: 'won', label: 'Won', probability: 100 })).toEqual({ stage: 'won', probability: 100 });
  });
});

describe('CRM activity log', () => {
  it('round-trips entries newest first and keeps unrecognised lines', () => {
    const log = appendActivity('typed by hand', { date: '2026-10-02', type: 'call', text: 'Budget\nconfirmed' });
    expect(log).toBe('2026-10-02 · call · Budget / confirmed\ntyped by hand');
    expect(parseActivityLog(log)).toEqual([
      { date: '2026-10-02', type: 'call', text: 'Budget / confirmed' },
      { date: null, type: 'note', text: 'typed by hand' },
    ]);
    expect(parseActivityLog('2026-10-01 | fax | sent')).toEqual([{ date: '2026-10-01', type: 'note', text: 'sent' }]);
  });
});

describe('CRM health and next actions', () => {
  it('scores an on-track deal healthy with no action due', () => {
    const [item] = workspace([deal()]).deals;
    expect(item.health).toMatchObject({ score: 100, level: 'healthy', reasons: [] });
    expect(item.action).toBeNull();
  });

  it('explains every deduction, worst first', () => {
    const [item] = workspace([deal({ closeDate: '2026-09-30', nextActionDate: null, lastContact: '2026-09-01' })]).deals;
    expect(item.health.level).toBe('risk');
    expect(item.health.reasons.map(reason => reason.message)).toEqual(['Close date {date} has passed', '{n} days since last contact', 'No next action scheduled']);
    expect(item.action?.code).toBe('close_overdue');
  });

  it('orders the day by urgency, then by weighted value', () => {
    const result = workspace([
      deal({ name: 'Small overdue', amount: 100, nextActionDate: '2026-10-01' }),
      deal({ name: 'Big overdue', amount: 9000, nextActionDate: '2026-10-02' }),
      deal({ name: 'Today', nextActionDate: today, nextStep: 'Send quote' }),
      deal({ name: 'Unplanned', nextActionDate: null }),
      deal({ name: 'Fine' }),
      deal({ name: 'Closed', stage: 'won', nextActionDate: '2026-09-01' }),
    ]);
    expect(todayQueue(result.deals).map(item => item.name)).toEqual(['Big overdue', 'Small overdue', 'Today', 'Unplanned']);
    expect(result.deals.find(item => item.name === 'Today')!.action).toMatchObject({ message: 'Today: {step}', values: { step: 'Send quote' } });
    expect(upcoming(result.deals, today).map(item => item.name)).toEqual(['Fine']);
  });

  it('never flags incomplete or closed deals as actions', () => {
    const result = workspace([deal({ currency: null }), deal({ stage: 'lost' })]);
    expect(result.deals.map(item => [item.health.level, item.action])).toEqual([['incomplete', null], ['closed', null]]);
    expect(inList(result.deals[0], 'incomplete', today, 30)).toBe(true);
  });
});

describe('CRM accounts, forecast and search', () => {
  const result = workspace([
    deal({ name: 'A1', account: 'Acme', amount: 1000, probability: 80, closeDate: '2026-10-20' }),
    deal({ name: 'A2', account: 'acme', amount: 500, probability: 20, closeDate: '2026-12-01' }),
    deal({ name: 'A3', account: 'Acme', stage: 'won', amount: 700, closeDate: '2026-10-02' }),
    deal({ name: 'B1', account: 'Beta', stage: 'lost', amount: 300 }),
    deal({ name: 'Late', account: null, amount: 200, probability: 50, closeDate: '2026-09-15' }),
    deal({ name: 'Yen', account: 'Gamma', amount: 50000, currency: 'JPY' }),
  ]);

  it('groups accounts case-insensitively with no-account last', () => {
    const accounts = accountsOf(result.deals);
    expect(accounts.map(account => [account.name, account.openCount])).toEqual([['Gamma', 1], ['Acme', 2], ['Beta', 0], [null, 1]]);
    expect(accounts[1].pipeline).toEqual({ USD: 1500 });
    expect(accounts[1].won).toEqual({ USD: 700 });
  });

  it('buckets by close month per currency and counts overdue deals in this month', () => {
    const forecast = forecastFor(result.deals, 'USD', today, 3);
    expect(forecast.months.map(month => month.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(forecast.months[0]).toMatchObject({ bestCase: 1200, commit: 1000, weighted: 900, won: 700, count: 2 });
    expect(forecast.months[2]).toMatchObject({ bestCase: 500, weighted: 100 });
    expect(forecast.winRate).toBe(0.5);
    expect(forecast.openPipeline).toBe(1700);
    expect(result.primaryCurrency).toBe('JPY');
  });

  it('matches every search term across name, account and contact', () => {
    expect(searchDeals(result.deals, 'acme a2').map(item => item.name)).toEqual(['A2']);
    expect(searchDeals(result.deals, '  ').length).toBe(6);
  });
});
