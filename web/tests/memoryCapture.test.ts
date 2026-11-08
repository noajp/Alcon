import { describe, expect, it } from 'vitest';

// The capture seam's pure decisions and the catalog's memory offering.
// The drivers themselves run on Deno; what can be decided without a
// database is decided here, and pinned.
const capture = await import(new URL('../../supabase/functions/run-agent/memoryCapture.ts', import.meta.url).pathname);
const catalog = await import(new URL('../../supabase/functions/_shared/catalog.ts', import.meta.url).pathname);

type T = { name: string; effect: string; area: string };
const names = (tools: T[]) => tools.map((t) => t.name);

describe('capture scope', () => {
  it('follows the work’s boundary: its Space’s memory, or its person’s', () => {
    expect(capture.captureScopeOf('space-1')).toBe('space');
    expect(capture.captureScopeOf(null)).toBe('personal');
    expect(capture.captureScopeOf(undefined)).toBe('personal');
  });
});

describe('the landing threshold', () => {
  it('distils only a turn that did real tool work — chatter leaves no episode', () => {
    expect(capture.landingWorthDistilling(0)).toBe(false);
    expect(capture.landingWorthDistilling(1)).toBe(false);
    expect(capture.landingWorthDistilling(2)).toBe(true);
    expect(capture.landingWorthDistilling(9)).toBe(true);
  });
});

describe('the memory tools in the catalog', () => {
  it('recall reads, remember writes, both live in the memory area', () => {
    const recall = catalog.catalogTool('recall_memory') as T;
    const remember = catalog.catalogTool('remember') as T;
    expect(recall).toMatchObject({ effect: 'read', area: 'memory' });
    expect(remember).toMatchObject({ effect: 'write', area: 'memory' });
  });

  it('a person can say “remember this” in the panel and in a conversation', () => {
    expect(names(catalog.toolsFor('panel'))).toEqual(expect.arrayContaining(['recall_memory', 'remember']));
    expect(names(catalog.toolsFor('conversation'))).toEqual(expect.arrayContaining(['recall_memory', 'remember']));
  });

  it('an Element’s run can recall but never writes durable at its own word', () => {
    const offered = names(catalog.toolsFor('element'));
    expect(offered).toContain('recall_memory');
    expect(offered).not.toContain('remember');
  });

  it('the index names the area, so a deferred search can find the tools', () => {
    expect(catalog.catalogIndex(catalog.toolsFor('panel'))).toContain('記憶');
  });
});
