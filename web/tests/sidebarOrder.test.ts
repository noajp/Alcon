import { describe, expect, it } from 'vitest';
import { moveSidebarItem, normalizeSidebarOrder, SIDEBAR_ITEMS } from '@/Frame/sidebarOrder';

describe('normalizeSidebarOrder', () => {
  it('starts from Inbox, AI, Strategy', () => {
    expect(normalizeSidebarOrder(null)).toEqual(['inbox', 'ai', 'strategy']);
  });
  it('keeps a saved order, drops unknown and repeated rows, and places new ones by default', () => {
    expect(normalizeSidebarOrder(['strategy', 'team', 'audit', 'strategy'])).toEqual(['inbox', 'ai', 'strategy']);
    expect(normalizeSidebarOrder([...SIDEBAR_ITEMS].reverse())).toEqual([...SIDEBAR_ITEMS].reverse());
  });
});

describe('moveSidebarItem', () => {
  const order = [...SIDEBAR_ITEMS];
  it('moves a row before or after another', () => {
    expect(moveSidebarItem(order, 'strategy', 'inbox', 'before').slice(0, 2)).toEqual(['strategy', 'inbox']);
    expect(moveSidebarItem(order, 'inbox', 'strategy', 'after').at(-1)).toBe('inbox');
  });
  it('leaves the order alone on a drop onto itself', () => {
    expect(moveSidebarItem(order, 'ai', 'ai', 'before')).toEqual(order);
  });
});
