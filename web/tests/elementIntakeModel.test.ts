import { describe, expect, it } from 'vitest';
import {
  INTAKE_TEXT_LIMIT, intakeTextFromRows, normalizeIntake, parseIntake, reconcileIntakeResult,
  type IntakeWorker,
} from '@/Function/shared/element/intakeModel';

const workers: IntakeWorker[] = [
  { id: 'worker-alex', name: 'Alex Rivera', email: 'alex@example.com', status: 'active' },
  { id: 'worker-sam', name: 'Sam', email: 'sam@example.com', status: 'busy' },
  { id: 'worker-inactive', name: 'Former colleague', email: 'former@example.com', status: 'inactive' },
];
const preview = (text: string, options: Parameters<typeof parseIntake>[1] = {}) => {
  const table = parseIntake(text, options);
  return normalizeIntake(table, table.suggestedMap, workers);
};

describe('existing work intake', () => {
  it('parses an Asana CSV with BOM, quoted comma, escaped quotes, and embedded newline', () => {
    const result = preview('\uFEFFTask ID,Task Name,Notes,Assignee Email,Due Date,Completed\r\n123,"Plan, launch","First line\nA ""quote""",alex@example.com,2026-09-30,false\r\n');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ title: 'Plan, launch', description: 'First line\nA "quote"', worker_id: 'worker-alex', status: 'todo', due_date: '2026-09-30', source: { id: '123' } });
  });

  it('detects a Linear spreadsheet and preserves original identifiers and links', () => {
    const result = preview('Identifier\tTitle\tStatus\tAssignee\tURL\nENG-4\tShip fix\tIn Progress\tAlex Rivera\thttps://linear.app/example/issue/ENG-4');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ title: 'Ship fix', status: 'in_progress', worker_id: 'worker-alex', source: { id: 'ENG-4', url: 'https://linear.app/example/issue/ENG-4' } });
  });

  it('suggests common ClickUp headers and prioritizes email when both name and email exist', () => {
    expect(parseIntake('Task ID,Task Name,Task Content,Status,Due Date,Assignee,Assignee Email\n1,Name,Body,Todo,,,').suggestedMap).toMatchObject({ source_id: 0, title: 1, description: 2, status: 3, due_date: 4, assignee: 6 });
  });

  it('keeps commas inside plain titles and removes common list markers', () => {
    const result = preview('- Plan, launch\n* [x] Write summary\n3. Ask customer\n\n• Collect evidence');
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.title)).toEqual(['Plan, launch', 'Write summary', 'Ask customer', 'Collect evidence']);
    expect(result.rows.every((row) => row.status === 'todo')).toBe(true);
  });

  it('supports deliberate no-header CSV without silently losing the first row', () => {
    const table = parseIntake('Alpha,Doing\nBeta,Done', { format: 'csv', hasHeader: false });
    expect(table.rows).toHaveLength(2);
    expect(table.suggestedMap.title).toBeNull();
    expect(normalizeIntake(table, { ...table.suggestedMap, title: 0, status: 1 }, workers).rows.map((row) => [row.title, row.status])).toEqual([['Alpha', 'in_progress'], ['Beta', 'done']]);
  });

  it('requires explicit mapping for an unknown title column', () => {
    const table = parseIntake('Summary,State\nShip,Ready', { format: 'csv' });
    expect(normalizeIntake(table, table.suggestedMap, workers).errors).toContain('Choose the column that contains Element titles.');
  });

  it('makes unknown status, ambiguous date, and unknown assignee explicit without discarding source values', () => {
    const result = preview('Title,Status,Due Date,Assignee\nShip,Ready to ship,09/10/2026,New person');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ status: 'todo', due_date: null, worker_id: null, source: { status: 'Ready to ship', due_date: '09/10/2026', assignee: 'New person' } });
    expect(result.rows[0].warnings.map((warning) => warning.code)).toEqual(['unknown_status', 'unparsed_date', 'unknown_assignee']);
  });

  it.each([
    ['2024-02-29', '2024-02-29'], ['2026/9/7', '2026-09-07'], ['2026-12-31', '2026-12-31'],
    ['2026-02-29', null], ['2026-04-31', null], ['2026-13-01', null], ['2026-00-01', null],
    ['09/07/2026', null], ['7 Sep 2026', null], ['2026-09-07T23:30:00-04:00', null], ['NaN', null], ['0000-01-01', null],
  ])('interprets date %s conservatively', (input, expected) => {
    expect(preview(`Title,Due Date\nName,${input}`).rows[0].due_date).toBe(expected);
  });

  it('matches a unique ID or case-insensitive email, including display name with email', () => {
    const result = preview('Title,Assignee\nFirst,worker-alex\nSecond,ALEX@EXAMPLE.COM\nThird,Alex <alex@example.com>\nFourth,Sam');
    expect(result.rows.map((row) => row.worker_id)).toEqual(['worker-alex', 'worker-alex', 'worker-alex', 'worker-sam']);
  });

  it('treats object prototype names as unknown statuses', () => {
    const result = preview('Title,Status\nFirst,constructor');
    expect(result.rows[0].status).toBe('todo');
    expect(result.rows[0].warnings[0].code).toBe('unknown_status');
  });

  it('maps a source email to an explicitly chosen Worker without exposing their email', () => {
    const table = parseIntake('Title,Assignee Email\nShip,person@source.example');
    const hiddenEmails = workers.map((worker) => ({ ...worker, email: null }));
    const mappings = { 'person@source.example': 'worker-alex' };
    const result = normalizeIntake(table, table.suggestedMap, hiddenEmails, mappings);
    expect(result.rows[0]).toMatchObject({ worker_id: 'worker-alex', source: { assignee: 'person@source.example' }, warnings: [] });
    expect(mappings).toEqual({ 'person@source.example': 'worker-alex' });
  });

  it('invalidates a chosen Worker that disappears or becomes inactive', () => {
    const table = parseIntake('Title,Assignee\nShip,Source name');
    const mapping = { 'Source name': 'worker-alex' };
    const approved = normalizeIntake(table, table.suggestedMap, workers, mapping);
    const unavailable = normalizeIntake(table, table.suggestedMap, workers.map((worker) => ({ ...worker, status: 'inactive' })), mapping);
    expect(approved.rows[0].worker_id).toBe('worker-alex');
    expect(unavailable.rows[0].worker_id).toBeNull();
    expect(unavailable.rows[0].warnings[0].code).toBe('invalid_assignee_mapping');
    expect(approved.rows[0].worker_id).toBe('worker-alex');
    expect(normalizeIntake(table, table.suggestedMap, [], mapping).rows[0].warnings[0].code).toBe('invalid_assignee_mapping');
  });

  it('allows an explicit unassigned choice while retaining the source person', () => {
    const table = parseIntake('Title,Assignee\nShip,Sam');
    const row = normalizeIntake(table, table.suggestedMap, workers, { Sam: null }).rows[0];
    expect(row.worker_id).toBeNull();
    expect(row.source.assignee).toBe('Sam');
    expect(row.warnings).toEqual([]);
  });

  it('blocks oversized UTF-8 source references in preview before the SQL bound', () => {
    expect(preview(`Title,URL\nName,https://example.com/${'あ'.repeat(3000)}`).errors[0]).toContain('source references');
  });

  it('checks the aggregate UTF-8 request size before saving a large non-Latin paste', () => {
    const text = 'Title,Description\n' + Array.from({ length: 30 }, (_, index) => `Row ${index},${'あ'.repeat(12_000)}`).join('\n');
    expect(text.length).toBeLessThan(INTAKE_TEXT_LIMIT);
    expect(preview(text).errors).toContain('The reviewed import is too large to save together. Start with a smaller selection.');
  });

  it('recovers editable rows after rollback without losing original values or quoted descriptions', () => {
    const original = preview('Title,Description,Status,Due Date,Assignee,Original ID,Original Link\n"Ship, soon","first\nsecond",Custom state,09/10/2026,Unknown,EXT-1,https://example.com/1').rows;
    const recovered = preview(intakeTextFromRows(original)).rows;
    expect(recovered[0]).toMatchObject({ title: original[0].title, description: original[0].description, source: original[0].source });
  });

  it('does not guess duplicate names, inactive workers, or multiple-assignee text', () => {
    const table = parseIntake('Title,Assignee\nFirst,Sam\nSecond,former@example.com\nThird,"Alex Rivera, Sam"');
    const result = normalizeIntake(table, table.suggestedMap, [...workers, { id: 'other-sam', name: 'Sam', email: 'other@example.com', status: 'active' }]);
    expect(result.rows.map((row) => row.worker_id)).toEqual([null, null, null]);
    expect(result.rows.map((row) => row.warnings[0].code)).toEqual(['ambiguous_assignee', 'inactive_assignee', 'unknown_assignee']);
  });

  it('retains a non-web URL as text without making it an active link', () => {
    const result = preview('Title,URL\nFirst,javascript:alert(1)\nSecond,https://example.com/proof');
    expect(result.rows[0].source).toMatchObject({ url: null, original_url: 'javascript:alert(1)' });
    expect(result.rows[0].warnings[0].code).toBe('invalid_url');
    expect(result.rows[1].source.url).toBe('https://example.com/proof');
  });

  it('imports only mapped fields and never puts the whole paste into description', () => {
    const text = 'Title,Internal Budget,Description\nLaunch,secret value,Short note';
    const result = preview(text);
    expect(result.rows[0].description).toBe('Short note');
    expect(JSON.stringify(result.rows)).not.toContain('secret value');
    expect(result.rows[0].description).not.toBe(text);
  });

  it('accepts 100 rows and rejects 101 without truncating or pretending to import a subset', () => {
    const oneHundred = Array.from({ length: 100 }, (_, index) => `Element ${index}`).join('\n');
    expect(parseIntake(oneHundred).rows).toHaveLength(100);
    const excess = parseIntake(`${oneHundred}\nExtra`);
    expect(excess.rows).toEqual([]);
    expect(excess.errors[0]).toContain('at most 100');
    expect(parseIntake(`Title\n${oneHundred}\nExtra`, { format: 'csv' }).errors[0]).toContain('at most 100');
  });

  it('rejects oversized input before producing rows', () => {
    const result = parseIntake('x'.repeat(INTAKE_TEXT_LIMIT + 1));
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('too large');
  });

  it('rejects unfinished quotes and text after a closing quote', () => {
    expect(parseIntake('Title,Description\nFirst,"missing end', { format: 'csv' }).errors[0]).toContain('not closed');
    expect(parseIntake('Title,Description\nFirst,"closed"bad', { format: 'csv' }).errors[0]).toContain('Unexpected text');
  });

  it('rejects duplicate and invalid column mappings', () => {
    const table = parseIntake('Title,Status\nShip,Done');
    expect(normalizeIntake(table, { ...table.suggestedMap, status: 0 }, workers).errors[0]).toContain('only one field');
    expect(normalizeIntake(table, { ...table.suggestedMap, title: -1 }, workers).errors[0]).toContain('no longer available');
    expect(normalizeIntake(table, { ...table.suggestedMap, title: Number.NaN }, workers).errors[0]).toContain('no longer available');
  });

  it('does not allow empty titles hidden by a populated neighboring field', () => {
    expect(preview('Title,Status\n,Done').errors[0]).toContain('Row 2 has no title');
  });

  it('rejects excessively long fields rather than silently truncating', () => {
    expect(preview(`Title,Description\n${'x'.repeat(501)},body`).errors[0]).toContain('500 characters');
    expect(preview(`Title,Description\nName,${'x'.repeat(20_001)}`).errors[0]).toContain('20,000 characters');
  });

  it('preserves stable keys per source row without collapsing intentionally duplicated titles', () => {
    const first = preview('Same title\nSame title');
    const second = preview('Same title\nSame title');
    expect(first.rows.map((row) => row.rowKey)).toEqual(second.rows.map((row) => row.rowKey));
    expect(new Set(first.rows.map((row) => row.rowKey)).size).toBe(2);
  });

  it('does not mutate the parsed table, column mapping, or available workers', () => {
    const table = parseIntake('Title,Status,Assignee\nShip,Doing,Alex Rivera');
    const before = JSON.stringify({ table, workers });
    normalizeIntake(table, table.suggestedMap, workers);
    expect(JSON.stringify({ table, workers })).toBe(before);
  });
});

describe('partial import reconciliation', () => {
  const rows = preview('First\nSecond\nThird').rows;

  it('keeps confirmed saves while retaining failures and unreported rows for retry', () => {
    const result = reconcileIntakeResult(rows, { saved: [{ rowKey: rows[0].rowKey, elementId: 'created-1' }], failed: [{ rowKey: rows[1].rowKey, message: 'Permission denied' }] });
    expect(result.saved).toEqual({ [rows[0].rowKey]: 'created-1' });
    expect(result.failed[rows[1].rowKey]).toBe('Permission denied');
    expect(result.failed[rows[2].rowKey]).toContain('Could not confirm');
    expect(result.failed).not.toHaveProperty(rows[0].rowKey);
  });

  it('does not count unrelated response rows or empty IDs as saved', () => {
    const result = reconcileIntakeResult(rows.slice(0, 1), { saved: [{ rowKey: 'unrelated', elementId: 'created-99' }, { rowKey: rows[0].rowKey, elementId: '' }] });
    expect(result.saved).toEqual({});
    expect(Object.keys(result.failed)).toEqual([rows[0].rowKey]);
  });

  it('treats conflicting success and failure, or multiple saves for one row, as unconfirmed', () => {
    const result = reconcileIntakeResult(rows.slice(0, 2), {
      saved: [{ rowKey: rows[0].rowKey, elementId: 'one' }, { rowKey: rows[0].rowKey, elementId: 'two' }, { rowKey: rows[1].rowKey, elementId: 'three' }],
      failed: [{ rowKey: rows[1].rowKey, message: 'Readback failed' }],
    });
    expect(result.saved).toEqual({});
    expect(Object.keys(result.failed)).toHaveLength(2);
    expect(result.failed[rows[1].rowKey]).toBe('Readback failed');
  });
});
