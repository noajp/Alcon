import { describe, expect, it } from 'vitest';
import { parseEmailLink } from '@/lib/emailLink';

const ORIGIN = 'https://app.example.com';

describe('parseEmailLink', () => {
  it('reads the token and type, and opens the app by default', () => {
    expect(parseEmailLink('?token_hash=abc&type=email', ORIGIN)).toEqual({ tokenHash: 'abc', type: 'email', next: '/' });
  });

  it('rejects a link without a token or with an unknown type', () => {
    expect(parseEmailLink('?type=email', ORIGIN)).toBeNull();
    expect(parseEmailLink('?token_hash=abc&type=sms', ORIGIN)).toBeNull();
  });

  it('keeps an unencoded redirect with its own query intact', () => {
    const search = `?token_hash=abc&type=email&redirect_to=${ORIGIN}/oauth/consent?client_id=c1&state=s&scope=read`;
    expect(parseEmailLink(search, ORIGIN)?.next).toBe('/oauth/consent?client_id=c1&state=s&scope=read');
  });

  it('accepts an encoded redirect', () => {
    const search = `?token_hash=abc&type=email&redirect_to=${encodeURIComponent(`${ORIGIN}/oauth/consent?client_id=c1&state=s`)}`;
    expect(parseEmailLink(search, ORIGIN)?.next).toBe('/oauth/consent?client_id=c1&state=s');
  });

  it('never follows a redirect to another site', () => {
    expect(parseEmailLink('?token_hash=abc&type=email&redirect_to=https://evil.example/x', ORIGIN)?.next).toBe('/');
    expect(parseEmailLink('?token_hash=abc&type=email&redirect_to=//evil.example/x', ORIGIN)?.next).toBe('/');
    expect(parseEmailLink('?token_hash=abc&type=email&redirect_to=javascript:alert(1)', ORIGIN)?.next).toBe('/');
  });
});
