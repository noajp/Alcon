import { describe, expect, it } from 'vitest';

// Retrieval's three injection points, rendered: an Element run's task
// message, a Strategy conversation's opening, and a Copilot turn's
// context block. The section comes from memoryRetrieve itself, so the
// seam the drivers share is the one under test. The rule under test
// everywhere: memory enters the uncached part — never the cached
// system prompt.
const retrieve = await import(new URL('../../supabase/functions/_shared/memoryRetrieve.ts', import.meta.url).pathname);
const contextMod = await import(new URL('../../supabase/functions/run-agent/context.ts', import.meta.url).pathname);
const conversation = await import(new URL('../../supabase/functions/run-agent/conversation.ts', import.meta.url).pathname);
const turnMod = await import(new URL('../../supabase/functions/_shared/copilotTurn.ts', import.meta.url).pathname);

const row = (over: Record<string, unknown>) => ({
  id: 'm1', layer: 'durable', kind: 'procedure', title: '請求書は税込で送る', gist: '送信前に税込へ直す',
  body: '請求書は必ず税込表示で送る。', topic_key: '請求書', status: 'active', scope: 'space', pinned: false, use_count: 4,
  element_id: null, created_at: '2026-11-01T00:00:00Z', ...over,
});
const section = retrieve.memorySection([row({})], [row({})]).text;

const baseTask = {
  mode: 'execute', prompt: null,
  element: { id: 'e', display_id: 'ELE_M-1', title: '請求書を送る', description: null, status: 'todo', priority: null, due_date: null, labels: [] },
  objectName: null, subElements: [], initiatives: [], comments: [], previousRuns: [], artifacts: [], upstream: [], integrations: [], tables: null, today: '2026-11-08',
};

describe('the Element run’s task message', () => {
  it('carries the memory section at its end — after the work, before the date', () => {
    const msg = contextMod.taskMessage({ ...baseTask, memories: section });
    expect(msg).toContain('# 記憶（これまでの仕事から残した知見）');
    expect(msg).toContain('請求書は必ず税込表示で送る。');
    expect(msg.indexOf('# 記憶')).toBeGreaterThan(msg.indexOf('# 使える外部連携'));
    expect(msg.indexOf('# 記憶')).toBeLessThan(msg.indexOf('今日の日付'));
  });

  it('without memories the message is the old message', () => {
    expect(contextMod.taskMessage(baseTask)).not.toContain('# 記憶');
  });

  it('the cached system prompt never carries a memory', () => {
    expect(contextMod.systemPrompt({ name: 'Athena', instructions: null })).not.toContain('請求書は必ず税込');
  });
});

describe('the Strategy conversation’s opening', () => {
  const baseConv = {
    strategy: { id: 's1', name: '請求の自動化', description: null, intents: [], objects: [], children: [], elements: [] },
    canEdit: true, definition: null, integrations: [], missingConnectors: [], connectorDrafts: [], today: '2026-11-08',
  };

  it('carries the section, and still ends with what the person said', () => {
    const opening = conversation.conversationOpening({ ...baseConv, memories: section }, '進めて');
    expect(opening).toContain('# 記憶（これまでの仕事から残した知見）');
    expect(opening.endsWith('進めて')).toBe(true);
    expect(conversation.conversationOpening(baseConv, '進めて')).not.toContain('# 記憶');
  });
});

describe('the Copilot turn’s context block', () => {
  const args = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userDb: {} as any, admin: null,
    context: { viewLabel: 'ボード', today: '2026-11-08' },
    supabaseUrl: null, actor: { agent: 'Alcon Copilot', userId: 'u1' },
  };

  it('puts the memories in the uncached block, never in the cached prompt', async () => {
    const turn = await turnMod.buildCopilotTurn({ ...args, memories: section });
    expect(turn.system[1].text).toContain('# 記憶（これまでの仕事から残した知見）');
    expect(turn.system[1].text).toContain('請求書は必ず税込表示で送る。');
    // The cached prompt names the memory tools (the catalog index) but
    // never carries a memory itself.
    expect(turn.system[0].text).not.toContain('これまでの仕事から残した知見');
    expect(turn.system[0].text).not.toContain('請求書は必ず税込表示で送る。');
    const plain = await turnMod.buildCopilotTurn(args);
    expect(plain.system[1].text).not.toContain('これまでの仕事から残した知見');
  });
});
