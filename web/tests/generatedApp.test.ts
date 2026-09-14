import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAppSource, parseAppState } from '../src/Function/widget/generated/model';
import { appDocument } from '../src/Function/widget/generated/runtime';
const source = { title: 'Estimate', html: '<label>Seats<input id="seats" type="number"></label><output id="total"></output>', css: 'body { color: var(--foreground) }', js: 'document.querySelector("#total").textContent = 42;' };
describe('generated application boundary', () => {
  it('keeps the browser and Edge Function source validators identical', () => {
    const edge = readFileSync('../supabase/functions/generate-widget-app/model.ts', 'utf8');
    const browser = readFileSync('src/Function/widget/generated/model.ts', 'utf8');
    expect(browser).toContain(edge);
  });
  it('rejects incomplete and oversized model responses before replacing a saved app', () => {
    for (const value of [null, {}, { ...source, js: 1 }, { ...source, html: '' }, { ...source, js: 'あ'.repeat(50000) }]) expect(() => parseAppSource(value)).toThrow();
    expect(parseAppSource(source)).toEqual(source);
  });
  it.each(['<script>alert(1)</script>', '<iframe src="https://example.com"></iframe>', '<meta http-equiv="refresh" content="0;url=https://example.com">', '<input onfocus="alert(1)">', '<a href="javascript:alert(1)">click</a>'])('rejects active HTML: %s', html => expect(() => parseAppSource({ ...source, html })).toThrow());
  it('keeps data and object text from becoming executable markup', () => {
    const payload = '</script><script>alert("injected")</script>';
    const document = appDocument(source, { note: payload }, { objectId: 'id', objectName: payload }, 'channel', {});
    expect((document.match(/<script>/g) ?? []).length).toBe(1);
    expect(document).not.toContain(payload);
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
  });
  it('does not let CSS close the style element and inject HTML', () => {
    const document = appDocument({ ...source, css: '</style><script>evil()</script>' }, {}, { objectId: 'id', objectName: '' }, 'channel', {});
    expect((document.match(/<script>/g) ?? []).length).toBe(1);
  });
  it('rejects unsupported data and limits UTF-8 size', () => {
    for (const value of [null, [], 'text', { text: 'あ'.repeat(60000) }]) expect(() => parseAppState(value)).toThrow();
    const data = { count: 2, records: [{ note: '<b>literal</b>' }], checked: false };
    expect(parseAppState(data)).toEqual(data);
    expect(parseAppState(data)).not.toBe(data);
  });
});
