import { describe, expect, it } from 'vitest';
import { inboxRowText, readableBody } from '@/ActivitySpace/home/inboxRow';

describe('inboxRowText', () => {
  it('leads with the Element when the title is a stock phrase', () => {
    expect(inboxRowText({ title: 'Claude: 完了報告', body: '受付した', element: { title: 'クレーム受付 — 二重請求' } }))
      .toEqual({ subject: 'クレーム受付 — 二重請求', event: 'Claude: 完了報告', detail: '受付した' });
  });
  it('keeps the title when it already names the Element, or there is none', () => {
    expect(inboxRowText({ title: '試験 04 is done', body: 'todo → done', element: { title: '試験 04' } }))
      .toEqual({ subject: '試験 04 is done', event: null, detail: 'todo → done' });
    expect(inboxRowText({ title: '担当は誰にしますか？', body: null, element: null }))
      .toEqual({ subject: '担当は誰にしますか？', event: null, detail: null });
  });
});

describe('readableBody', () => {
  const t = (m: string) => `[${m}]`;
  it('turns a provider error body into its readable line', () => {
    expect(readableBody('400 {"type":"error","error":{"type":"invalid_request_error"}}', t))
      .toBe('[The AI service rejected this request, so the run stopped. Open the run to see the step it stopped at.]');
  });
  it('shows any other body as written', () => {
    expect(readableBody('受付した', t)).toBe('受付した');
    expect(readableBody(null, t)).toBeNull();
  });
});
