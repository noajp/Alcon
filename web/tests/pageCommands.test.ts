import { describe, expect, it } from 'vitest';
import { getPageCommands, registerPageCommand, type PageCommand } from '@/Function/shared/pageCommands';

const Icon = () => null;
const cmd = (id: string, label: string): PageCommand => ({ id, label, icon: Icon, run: () => {} });

describe('page commands', () => {
  it('offers a command while registered and withdraws it after', () => {
    const off = registerPageCommand(cmd('a', 'A'));
    expect(getPageCommands().map((c) => c.label)).toEqual(['A']);
    off();
    expect(getPageCommands()).toEqual([]);
  });

  it('lets the newest registration of an id shadow the older one, and brings the older back when it leaves', () => {
    const offList = registerPageCommand(cmd('delegate', 'List'));
    const offPeek = registerPageCommand(cmd('delegate', 'Peek'));
    expect(getPageCommands().map((c) => c.label)).toEqual(['Peek']);
    offPeek();
    expect(getPageCommands().map((c) => c.label)).toEqual(['List']);
    offList();
    expect(getPageCommands()).toEqual([]);
  });

  it('keeps distinct ids in registration order', () => {
    const offA = registerPageCommand(cmd('a', 'A'));
    const offB = registerPageCommand(cmd('b', 'B'));
    expect(getPageCommands().map((c) => c.id)).toEqual(['a', 'b']);
    offA(); offB();
  });
});
