import { describe, expect, it } from 'vitest';
import { plannerSources } from '@/ActivitySpace/strategy/initiative/mission/missionModel';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const sources = await import(new URL('../../supabase/functions/plan-initiative/sources.ts', import.meta.url).pathname);

describe('the Planner reads every attached file', () => {
  it('cuts a long text into parts without losing a character', () => {
    const text = Array.from({ length: 400 }, (_, i) => `段落 ${i}。${'あ'.repeat(i % 37)}`).join('\n\n');
    const parts: string[] = sources.chunkText(text, 500);
    expect(parts.join('')).toBe(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    // Each cut falls at a paragraph break where one is near.
    expect(parts.slice(0, -1).every((p) => p.endsWith('\n\n'))).toBe(true);
  });

  it('cuts text with no line breaks at the size', () => {
    const text = 'x'.repeat(1234);
    expect(sources.chunkText(text, 500).map((p: string) => p.length)).toEqual([500, 500, 234]);
    expect(sources.chunkText('', 500)).toEqual([]);
  });

  it('reads parts a few at a time and keeps their order', async () => {
    let running = 0;
    let most = 0;
    const out = await sources.inBatches([5, 1, 4, 2, 3], 2, async (n: number) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
  });

  it('reports each file without its contents', () => {
    const report = sources.sourceReport([
      { name: 'a.txt', chars: 10, text: 'secret body', mode: 'full' },
      { name: 'b.pdf', chars: 0, pdf: 'AAAA', mode: 'digest' },
      { name: 'c.docx', chars: 0, mode: 'unread', reason: 'no text yet' },
    ]);
    expect(report).toEqual([
      { name: 'a.txt', chars: 10, mode: 'full' },
      { name: 'b.pdf', chars: 0, mode: 'digest' },
      { name: 'c.docx', chars: 0, mode: 'unread', reason: 'no text yet' },
    ]);
  });

  it('keeps the page to the report it understands', () => {
    expect(plannerSources(null)).toBeNull();
    expect(plannerSources([])).toEqual([]);
    expect(plannerSources([{ name: 'a.txt', chars: 3, mode: 'full' }, { name: 'x', mode: 'weird' }, 'junk', { chars: 1, mode: 'full' }]))
      .toEqual([{ name: 'a.txt', chars: 3, mode: 'full' }]);
  });
});
