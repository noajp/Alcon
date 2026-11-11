import { describe, expect, it } from 'vitest';

// A paused run tells its starter why (_shared/runErrorExplain.ts). The
// causes that are somebody's to fix are said in plain words with what
// to do; anything unrecognised keeps the raw text, so nothing is
// hidden behind a guess.
const ex = await import(new URL('../../supabase/functions/_shared/runErrorExplain.ts', import.meta.url).pathname);

const BALANCE = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011C"}';

describe('explainRunError', () => {
  it('names an empty balance, who fixes it and how the work goes on', () => {
    const e = ex.explainRunError(BALANCE);
    expect(e.cause).toBe('balance');
    expect(e.title).toBe('AI の利用残高がなくなったため、止まっています');
    expect(e.body).toContain('残高を足す');
    expect(e.body).toContain('続きから再開');
    // The same words are shown on an Element, in a conversation and in the Inbox.
    expect(e.body).not.toContain('Element');
    expect(e.body).not.toContain('Resume');
    expect(e.title + e.body).not.toContain('{');
    expect(e.title + e.body).not.toContain('req_');
  });

  it('tells the other causes apart', () => {
    expect(ex.explainRunError('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}').cause).toBe('key');
    expect(ex.explainRunError('429 {"type":"error","error":{"type":"rate_limit_error","message":"..."}}').cause).toBe('rate_limit');
    expect(ex.explainRunError('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}').cause).toBe('overloaded');
    expect(ex.explainRunError('402 Insufficient Balance').cause).toBe('balance');
    // Mid-stream, the provider's error arrives as its body alone.
    expect(ex.explainRunError('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}').cause).toBe('overloaded');
    expect(ex.explainRunError('{"type":"error","error":{"type":"api_error","message":"Internal server error"}}').cause).toBe('unknown');
    expect(ex.explainRunError('401 Unauthorized').cause).toBe('key');
    // A 429 that is really an empty quota is the balance, not a wait.
    expect(ex.explainRunError('429 {"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}').cause).toBe('balance');
    expect(ex.explainRunError('429 {"error":{"type":"engine_overloaded_error","message":"The engine is currently overloaded"}}').cause).toBe('overloaded');
  });

  it('does not guess: an unrecognised error keeps its own words', () => {
    const raw = "TypeError: Cannot read properties of undefined (reading 'id')";
    expect(ex.explainRunError(raw)).toEqual({ cause: 'unknown', title: 'エラーで一時停止しました', body: raw });
    // A number that only looks like a status code is not a cause.
    expect(ex.explainRunError('row 4290 could not be written').cause).toBe('unknown');
    expect(ex.explainRunError('Element 401 が見つかりません').cause).toBe('unknown');
    expect(ex.explainRunError('ELE-429 を更新できませんでした（503 行目）').cause).toBe('unknown');
    // Not the provider's answer, whatever words it carries.
    expect(ex.explainRunError('経過を保存できませんでした: Invalid API key').cause).toBe('unknown');
    expect(ex.explainRunError('経過を保存できませんでした: Service Unavailable').cause).toBe('unknown');
    expect(ex.explainRunError('Strategy を読めませんでした: rate limit exceeded').cause).toBe('unknown');
  });
});

describe('runErrorLine', () => {
  it('is the plain explanation for a known cause', () => {
    const line = ex.runErrorLine(BALANCE);
    expect(line.startsWith('AI の利用残高がなくなったため、止まっています。')).toBe(true);
    expect(line).not.toContain('{');
  });

  it('keeps the raw text, capped by whole characters, when the cause is unknown', () => {
    const line = ex.runErrorLine('boom ' + '🙂'.repeat(400));
    expect(line.startsWith('エラーで一時停止しました: boom ')).toBe(true);
    expect(Array.from(line.slice('エラーで一時停止しました: '.length))).toHaveLength(300);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(line)).toBe(false);
  });
});

describe('toldOnce', () => {
  it('holds for what stops every run, not for what passes', () => {
    expect(ex.toldOnce('balance')).toBe(true);
    expect(ex.toldOnce('key')).toBe(true);
    expect(ex.toldOnce('rate_limit')).toBe(false);
    expect(ex.toldOnce('overloaded')).toBe(false);
    expect(ex.toldOnce('unknown')).toBe(false);
  });
});

