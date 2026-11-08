import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The promotion path's conversational surface (PR5): the once-only
// offer that rides the memory section, the start_promotion tool that
// opens drafting at the person's word, and the heartbeat's two new
// things-waiting. The pure rules are asserted on behaviour; the Deno
// wiring on source, the repo's convention for code Vitest cannot run.
const promotion = await import(new URL('../../supabase/functions/_shared/promotion.ts', import.meta.url).pathname);
const memoryTools = await import(new URL('../../supabase/functions/_shared/memoryTools.ts', import.meta.url).pathname);
const memoryDb = readFileSync(new URL('../../supabase/functions/_shared/memoryDb.ts', import.meta.url), 'utf8');
const heartbeat = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname);
const index = readFileSync(new URL('../../supabase/functions/run-agent/index.ts', import.meta.url), 'utf8');

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1', layer: 'durable', kind: 'procedure', status: 'active',
    activity_space_id: 'space-1', promotion_offered_at: null, title: '請求書の送り方',
    ...over,
  };
}

describe('the conversational promotion offer (decision 9)', () => {
  it('offers for a Space durable procedure whose body was injected, once', () => {
    expect(promotion.promotionOfferCandidate([row()])).toEqual({ id: 'm1', title: '請求書の送り方' });
    expect(promotion.promotionOfferCandidate([row({ promotion_offered_at: '2026-11-08T00:00:00Z' })])).toBeNull();
  });

  it('never offers for episodes, facts, personal memories, or the superseded', () => {
    expect(promotion.promotionOfferCandidate([row({ layer: 'episode' })])).toBeNull();
    expect(promotion.promotionOfferCandidate([row({ kind: 'fact' })])).toBeNull();
    expect(promotion.promotionOfferCandidate([row({ activity_space_id: null })])).toBeNull();
    expect(promotion.promotionOfferCandidate([row({ status: 'superseded' })])).toBeNull();
    expect(promotion.promotionOfferCandidate([])).toBeNull();
  });

  it('the first eligible body wins', () => {
    const got = promotion.promotionOfferCandidate([row({ kind: 'fact' }), row({ id: 'm2', title: '二つ目' })]);
    expect(got).toEqual({ id: 'm2', title: '二つ目' });
  });

  it('the offer text names the tool and the once-only terms', () => {
    const text = promotion.promotionOfferText({ id: 'm1', title: '請求書の送り方' });
    expect(text).toContain('start_promotion');
    expect(text).toContain('memoryId: m1');
    expect(text).toContain('繰り返さない');
  });

  it('the funnel stamps through the service role and only at conversational entries', () => {
    expect(memoryDb).toContain('promotionOfferCandidate(bodies)');
    expect(memoryDb).toContain('promotion_offered_at: new Date().toISOString()');
    // execute() deliberately passes no admin: an Element run has no
    // person to offer to, and an unseen offer must not burn the once.
    const executeLoad = index.slice(index.indexOf('relevant to this Element'));
    expect(executeLoad.slice(0, 400)).not.toContain('}, admin)');
    expect(index).toContain('spaceId: run.activity_space_id, elementId: null,\n    }, admin)');
    expect(index).toContain('spaceId: context.spaceId ?? run.activity_space_id, elementId: context.elementId ?? null,\n  }, admin)');
  });

  it('the funnel composes the section it returns (the shape its call sites read)', () => {
    expect(memoryDb).toContain('const section = memorySection(indexRows, bodies)');
    expect(memoryDb).toContain('return { text, usedIds: section.usedIds, indexRows, bodies }');
  });
});

describe('start_promotion', () => {
  it('is a memory-area tool beside recall and remember', () => {
    expect(memoryTools.MEMORY_TOOLS.map((t: { name: string }) => t.name))
      .toEqual(['recall_memory', 'remember', 'start_promotion']);
    const tool = memoryTools.MEMORY_TOOLS.find((t: { name: string }) => t.name === 'start_promotion');
    expect(tool.input_schema.required).toEqual(['memoryId']);
  });

  it('creates records only — and the drivers start the run', () => {
    const src = readFileSync(new URL('../../supabase/functions/_shared/memoryTools.ts', import.meta.url), 'utf8');
    expect(src).toContain('source_kind: "memory", source_memory_id: m.id');
    expect(src).toContain('mode: "promote", status: "queued"');
    expect(src).toContain('promotionRunId');
    expect(index).toContain('call.name === "start_promotion" && r.ok) startPromotionRunFromTool(a, r.data)');
    expect(index).toContain('call.name === "start_promotion" && !r.is_error)');
  });
});

describe('heartbeat promotion signals', () => {
  it('the kinds exist, labelled, with their own fingerprints', () => {
    expect(heartbeat.HEARTBEAT_KIND_LABEL.promotion_review).toBe('昇格ドラフトの審査待ち');
    expect(heartbeat.HEARTBEAT_KIND_LABEL.promotion_input).toBe('昇格の起草の回答待ち');
    expect(index).toContain('kind: "promotion_review"');
    expect(index).toContain('kind: "promotion_input"');
  });
});
