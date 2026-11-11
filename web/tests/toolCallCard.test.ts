import { describe, expect, it } from 'vitest';
import { formatToolDuration, highlightTokens, toolCallText } from '@/Function/shared/toolCallFormat';
import { toolCardOf } from '@/AIP/ai/copilotToolCards';

describe('formatToolDuration', () => {
  it('reads ms, tenths, minutes, hours and days', () => {
    expect(formatToolDuration(420, false)).toBe('420ms');
    expect(formatToolDuration(420, true)).toBe('0.4s');
    expect(formatToolDuration(12_340, false)).toBe('12.3s');
    expect(formatToolDuration(125_000, false)).toBe('2m 05s');
    expect(formatToolDuration(3 * 3600_000 + 12 * 60_000, false)).toBe('3h 12m');
    expect(formatToolDuration(52 * 3600_000, false)).toBe('2d 4h');
  });
});

describe('toolCallText', () => {
  it('pretty-prints objects and JSON strings, and leaves other text alone', () => {
    expect(toolCallText({ a: 1 })).toEqual({ text: '{\n  "a": 1\n}', json: true });
    expect(toolCallText('[1,2]')).toEqual({ text: '[\n  1,\n  2\n]', json: true });
    expect(toolCallText('{not json')).toEqual({ text: '{not json', json: false });
    expect(toolCallText('plain')).toEqual({ text: 'plain', json: false });
  });
});

describe('highlightTokens', () => {
  it('colors keys, strings, numbers and literals, and keeps the text whole', () => {
    const text = '{\n  "q": "x",\n  "n": -1.5,\n  "ok": true\n}';
    const tokens = highlightTokens(text);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    expect(tokens.filter((t) => t.kind !== 'plain')).toEqual([
      { kind: 'key', text: '"q"' }, { kind: 'str', text: '"x"' },
      { kind: 'key', text: '"n"' }, { kind: 'num', text: '-1.5' },
      { kind: 'key', text: '"ok"' }, { kind: 'lit', text: 'true' },
    ]);
  });
});

describe('toolCardOf', () => {
  it('reads a board tool call: its verb, subject, status and what came back', () => {
    expect(toolCardOf({ name: 'listElements', input: { query: '期限' }, result: { ok: true, rows: 17 } })).toEqual({
      name: 'listElements', verb: 'Reading', subject: '期限', kind: 'read', status: 'success',
      args: { query: '期限' }, result: { rows: 17 }, error: undefined,
    });
    expect(toolCardOf({ name: 'createElement', input: { title: 'A' } })).toMatchObject({ kind: 'create', status: 'running', subject: 'A' });
    const failed = toolCardOf({ name: 'updateElement', result: { ok: false, error: 'denied' } });
    expect(failed).toMatchObject({ kind: 'update', status: 'error', error: 'denied' });
    expect(failed).not.toHaveProperty('args');
  });

  it('reads the server steps back into the tool they came from', () => {
    expect(toolCardOf({ name: 'Web 検索: 東京 天気', result: { ok: true } })).toMatchObject({
      name: 'web_search', kind: 'web', verb: 'Searched the web', subject: '東京 天気', args: { query: '東京 天気' }, status: 'success',
    });
    expect(toolCardOf({ name: 'Web ページ: https://example.com', result: { ok: true } }))
      .toMatchObject({ name: 'web_fetch', kind: 'fetch', args: { url: 'https://example.com' } });
    expect(toolCardOf({ name: '検索結果を絞り込み', result: { ok: true } }))
      .toMatchObject({ name: 'code_execution', kind: 'code', subject: null });
  });
});
