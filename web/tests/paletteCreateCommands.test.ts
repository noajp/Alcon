// el_UXQ-010 — ⌘K's "Create" group must show at an empty query and must be
// reachable by "create" / "new" / 作成, without the displayed label ever
// changing from "New Element" / "New Object" / "New Campaign". The matching
// (aliases) and ordering rules live in paletteCreateCommands.ts as plain
// data + a pure function specifically so they're testable without rendering
// CommandPalette.tsx.

import { describe, expect, it } from 'vitest';

import {
  CREATE_COMMANDS,
  filterCreateCommands,
  matchesCreateCommand,
  type CreateCommandId,
} from '@/shell/paletteCreateCommands';

const ids = (specs: { id: CreateCommandId }[]) => specs.map((s) => s.id);

describe('CREATE_COMMANDS', () => {
  it('declares exactly the three creation actions el_UXQ-010 asks for, with the English labels unchanged', () => {
    expect(CREATE_COMMANDS.map((c) => c.label)).toEqual(['New Element', 'New Object', 'New Campaign']);
  });

  it('never puts the Japanese alias in the label — only in aliases', () => {
    for (const c of CREATE_COMMANDS) {
      expect(c.label).not.toMatch(/[぀-ヿ一-鿿]/);
    }
  });
});

describe('filterCreateCommands', () => {
  it('shows all three, in declaration order, at an empty query', () => {
    expect(ids(filterCreateCommands(''))).toEqual(['create-element', 'create-object', 'create-campaign']);
  });

  it('treats a whitespace-only query the same as empty', () => {
    expect(ids(filterCreateCommands('   '))).toEqual(['create-element', 'create-object', 'create-campaign']);
  });

  it('matches all three on the English verb "create"', () => {
    expect(ids(filterCreateCommands('create'))).toEqual(['create-element', 'create-object', 'create-campaign']);
  });

  it('matches all three on the English verb "new"', () => {
    expect(ids(filterCreateCommands('new'))).toEqual(['create-element', 'create-object', 'create-campaign']);
  });

  it('matches all three on the Japanese verb 作成 (acceptance criterion)', () => {
    expect(ids(filterCreateCommands('作成'))).toEqual(['create-element', 'create-object', 'create-campaign']);
  });

  it('narrows to one command when the query names its concept', () => {
    expect(ids(filterCreateCommands('element'))).toEqual(['create-element']);
    expect(ids(filterCreateCommands('object'))).toEqual(['create-object']);
    expect(ids(filterCreateCommands('campaign'))).toEqual(['create-campaign']);
  });

  it('narrows to one command on its Japanese concept name', () => {
    expect(ids(filterCreateCommands('要素'))).toEqual(['create-element']);
    expect(ids(filterCreateCommands('オブジェクト'))).toEqual(['create-object']);
    expect(ids(filterCreateCommands('キャンペーン'))).toEqual(['create-campaign']);
  });

  it('is case-insensitive', () => {
    expect(ids(filterCreateCommands('CREATE'))).toEqual(['create-element', 'create-object', 'create-campaign']);
    expect(ids(filterCreateCommands('New Element'))).toEqual(['create-element']);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(ids(filterCreateCommands('  element  '))).toEqual(['create-element']);
  });

  it('returns nothing for a query that matches none of the aliases', () => {
    expect(filterCreateCommands('xyz123')).toEqual([]);
  });

  it('matches a command by its exact displayed label', () => {
    for (const c of CREATE_COMMANDS) {
      expect(matchesCreateCommand(c, c.label)).toBe(true);
    }
  });
});
