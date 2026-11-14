import { describe, expect, it } from 'vitest';
import { deepLinkScreen, parseDeepLink, stripDeepLink } from '@/lib/deepLink';

const mod = await import(new URL('../../supabase/functions/_shared/notificationEmail.ts', import.meta.url).pathname);
const ID = '0b9a7c1e-1234-4abc-8def-0123456789ab';

describe('parseDeepLink', () => {
  it('reads an Element, Object or Strategy by id', () => {
    expect(parseDeepLink(`?element=${ID}`)).toEqual({ kind: 'element', id: ID });
    expect(parseDeepLink(`?object=${ID.toUpperCase()}`)).toEqual({ kind: 'object', id: ID });
    expect(parseDeepLink(`?strategy=${ID}`)).toEqual({ kind: 'strategy', id: ID });
  });

  it('reads the Inbox, and ignores anything that is not an id', () => {
    expect(parseDeepLink('?view=inbox')).toEqual({ kind: 'inbox' });
    expect(parseDeepLink('?element=1%27%20or%201=1')).toBeNull();
    expect(parseDeepLink('?view=settings')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
  });

  it('reads the addresses the notification emails build', () => {
    for (const type of ['element', 'object', 'strategy'] as const) {
      const href = mod.notificationLink('https://app.example.com/', { type, title: 't', id: ID });
      expect(parseDeepLink(new URL(href).search)).toEqual({ kind: type, id: ID });
    }
    expect(parseDeepLink(new URL(mod.notificationLink('https://app.example.com', null)).search)).toEqual({ kind: 'inbox' });
  });
});

describe('stripDeepLink', () => {
  it('drops the link and keeps the rest', () => {
    expect(stripDeepLink(`https://a.example/?element=${ID}&x=1`)).toBe('https://a.example/?x=1');
    expect(stripDeepLink('https://a.example/?view=inbox')).toBe('https://a.example/');
  });
});

describe('deepLinkScreen', () => {
  it('opens an Element over its Domain as ⌘K does', () => {
    expect(deepLinkScreen({ kind: 'element', id: ID }, { objectId: 'o', domainId: 'd' }))
      .toEqual({ view: 'domain-elements', nav: { elementId: ID, objectId: 'o', objectDomainId: 'd' } });
    expect(deepLinkScreen({ kind: 'element', id: ID }, {}))
      .toEqual({ view: 'domain-elements', nav: { elementId: ID, objectId: null } });
  });

  it('opens an Object as its page and a Strategy in Strategy', () => {
    expect(deepLinkScreen({ kind: 'object', id: ID }, { objectId: ID, domainId: 'd' })).toEqual({ view: 'objects', nav: { objectId: ID, objectDomainId: 'd' } });
    expect(deepLinkScreen({ kind: 'strategy', id: ID }, {})).toEqual({ view: 'strategy', nav: { strategyId: ID } });
  });
});
