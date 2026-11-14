import { describe, expect, it } from 'vitest';
import { formatError, serviceErrorLine } from '@/Function/shared/formatError';

// The fallback line formatError shows when a caught value carries no
// readable message — pinned here as a literal on purpose.
const ERROR_FALLBACK = 'Something went wrong.';

// The one coercion every surface reads a caught value through: a
// PostgREST error is a plain object, and String() on it is the literal
// "[object Object]" the smoke test showed under an Element. These pin
// the shapes Supabase actually throws.
describe('formatError', () => {
  it('reads an Error’s message', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('reads a PostgREST-shaped plain object’s message', () => {
    const pg = { message: 'duplicate key value violates unique constraint', code: '23505', details: 'Key (id)=(1) already exists.', hint: '' };
    expect(formatError(pg)).toBe('duplicate key value violates unique constraint');
  });

  it('reads a plain object’s message (a functions error unwrapped to JSON)', () => {
    expect(formatError({ message: 'GitHub は未接続です' })).toBe('GitHub は未接続です');
  });

  it('never renders "[object Object]": a messageless object falls back', () => {
    expect(formatError({ code: '42501' })).toBe(ERROR_FALLBACK);
    expect(formatError({})).toBe(ERROR_FALLBACK);
    expect(formatError(['a', 'b'])).toBe(ERROR_FALLBACK);
  });

  it('falls back for null, undefined and numbers', () => {
    expect(formatError(null)).toBe(ERROR_FALLBACK);
    expect(formatError(undefined)).toBe(ERROR_FALLBACK);
    expect(formatError(42)).toBe(ERROR_FALLBACK);
  });

  it('keeps a string as itself', () => {
    expect(formatError('認証に失敗しました')).toBe('認証に失敗しました');
    expect(formatError('')).toBe(ERROR_FALLBACK);
  });
});

describe('serviceErrorLine', () => {
  it('reads a provider error body as the kind of failure, never the JSON', () => {
    expect(serviceErrorLine('400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}'))
      .toBe('The AI service rejected this request, so the run stopped. Open the run to see the step it stopped at.');
    expect(serviceErrorLine('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'))
      .toBe('The AI service did not accept the API key. Check the key under Settings, Connectors.');
    expect(serviceErrorLine('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'))
      .toBe('The AI service is busy right now. Run it again in a moment.');
    expect(serviceErrorLine('500 {"type":"error","error":{"type":"api_error"}}'))
      .toBe('The AI service returned an error, so the run stopped. Run it again.');
  });

  it('leaves ordinary text alone', () => {
    expect(serviceErrorLine('ELE_AUT-041 と今後の料金の問い合わせの担当者')).toBeNull();
    expect(serviceErrorLine(null)).toBeNull();
    expect(formatError(new Error('GitHub は未接続です'))).toBe('GitHub は未接続です');
  });
});
