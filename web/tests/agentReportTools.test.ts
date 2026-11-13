import { describe, expect, it } from 'vitest';

const report = await import(new URL('../../supabase/functions/_shared/agentReportTools.ts', import.meta.url).pathname);
const { mcpTools } = await import(new URL('../../supabase/functions/clayware-mcp/tools.ts', import.meta.url).pathname);
const { runExternalTool } = await import(new URL('../../supabase/functions/_shared/externalTools.ts', import.meta.url).pathname);

const { leaseHolder, progressComment, outcomeComment, outcomeNotice, outcomeStatus, sanitizeBranch, runAgentReportTool, AGENT_REPORT_TOOL_NAMES } = report;

const UUID = '93fb2fb0-a7a1-434e-9211-af4db709a247';
const USER = '1a2b3c4d-0000-0000-0000-000000000000';
const actor = { agent: 'Claude Code (MCP · token: laptop)', userId: USER };

type Row = Record<string, unknown>;

/**
 * The Supabase client as these tools use it: eq-filtered reads, insert /
 * update with select().single(), and the two lease RPCs with their SQL
 * semantics (a live lease of another holder refuses; release only by holder).
 */
function fakeDb(tables: Record<string, Row[]>, now = Date.now()) {
  const writes: { table: string; op: string; row: Row }[] = [];
  const rpcs: { fn: string; args: Row }[] = [];
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: 'insert' | 'update'; row: Row } | null = null;
    const run = () => {
      if (pending?.op === 'insert') {
        const row = { id: `new-${writes.length}`, ...pending.row };
        writes.push({ table, op: 'insert', row });
        (tables[table] ??= []).push(row);
        return [row];
      }
      const hit = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      if (pending?.op === 'update') {
        for (const r of hit) Object.assign(r, pending.row);
        writes.push({ table, op: 'update', row: pending.row });
      }
      return hit;
    };
    const q = {
      select: () => q,
      insert: (row: Row) => { pending = { op: 'insert', row }; return q; },
      update: (row: Row) => { pending = { op: 'update', row }; return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return q; },
      ilike: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row' } };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  }
  async function rpc(fn: string, args: Row) {
    rpcs.push({ fn, args });
    const el = (tables.elements ?? []).find(r => r.id === args.p_element_id);
    if (!el) return { data: false, error: null };
    if (fn === 'claim_element') {
      const live = el.claimed_by && el.claim_expires_at && Date.parse(String(el.claim_expires_at)) > now;
      if (live && el.claimed_by !== args.p_holder) return { data: false, error: null };
      el.branch = el.claimed_by !== args.p_holder ? args.p_branch : (args.p_branch ?? el.branch);
      el.claimed_by = args.p_holder;
      el.claim_expires_at = new Date(now + 40 * 60_000).toISOString();
      return { data: true, error: null };
    }
    if (fn === 'release_element') {
      if (el.claimed_by !== args.p_holder) return { data: false, error: null };
      el.claimed_by = null; el.claim_expires_at = null; el.branch = null;
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }
  return { db: { from, rpc } as never, writes, rpcs };
}

describe('leaseHolder', () => {
  it('ties the token to the person and, when given, the session', () => {
    expect(leaseHolder(actor)).toBe('Claude Code (MCP · token: laptop)@1a2b3c4d');
    expect(leaseHolder(actor, 'feat-x')).toBe('Claude Code (MCP · token: laptop)@1a2b3c4d.feat-x');
    expect(leaseHolder({ agent: 'AI (MCP)', userId: 'ffffffff-1' }, 'feat-x')).not.toBe(leaseHolder(actor, 'feat-x'));
  });

  it('strips anything from the session that is not a name', () => {
    expect(leaseHolder(actor, 'a b@c/../d')).toBe('Claude Code (MCP · token: laptop)@1a2b3c4d.abc..d');
    expect(leaseHolder(actor, 42)).toBe('Claude Code (MCP · token: laptop)@1a2b3c4d');
    expect(leaseHolder({ agent: 'AI', userId: null })).toBe('AI@anon');
  });
});

describe('report wording and status', () => {
  it('writes a plan as numbered steps and progress as one line plus detail', () => {
    expect(progressComment('方針', undefined, ['調べる', '直す'])).toBe('**計画** — 方針\n\n1. 調べる\n2. 直す');
    expect(progressComment('原因が分かった', ' 根拠 ')).toBe('**進捗** — 原因が分かった\n\n根拠');
  });

  it('labels an outcome the way run-agent does', () => {
    expect(outcomeComment('blocked', '権限が要る', '本番キーが必要')).toBe('**対応が必要です** — 権限が要る\n\n本番キーが必要');
    expect(outcomeComment('completed', '済み', '')).toBe('**完了報告** — 済み\n\n済み');
    expect(outcomeComment('partial', '半分', 'x')).toMatch(/^\*\*途中報告\*\*/);
  });

  it('moves completed work to review and blocked to blocked, leaving done / cancelled alone', () => {
    expect(outcomeStatus('completed', 'in_progress')).toBe('review');
    expect(outcomeStatus('blocked', 'todo')).toBe('blocked');
    expect(outcomeStatus('partial', 'in_progress')).toBeNull();
    expect(outcomeStatus('completed', 'done')).toBeNull();
    expect(outcomeStatus('blocked', 'cancelled')).toBeNull();
    expect(outcomeStatus('blocked', 'blocked')).toBeNull();
  });

  it('keeps branch names git would accept', () => {
    expect(sanitizeBranch('claude/obj2-x')).toBe('claude/obj2-x');
    expect(sanitizeBranch('a b;rm')).toBe('abrm');
    expect(sanitizeBranch('')).toBeNull();
    expect(sanitizeBranch(undefined)).toBeNull();
  });
});

describe('runAgentReportTool', () => {
  it('claims through claim_element and refuses while another session holds it', async () => {
    const { db, writes, rpcs } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'todo' }] });
    const res = await runAgentReportTool(db, 'claimElement', { elementId: 'PLT-003', branch: 'feat/x', session: 's1' }, actor);
    expect(res).toMatchObject({ ok: true, data: { elementId: UUID, holder: leaseHolder(actor, 's1'), branch: 'feat/x' } });
    expect(rpcs[0]).toEqual({ fn: 'claim_element', args: { p_element_id: UUID, p_holder: leaseHolder(actor, 's1'), p_branch: 'feat/x' } });
    // The lease columns are never written directly.
    expect(writes.some(w => w.table === 'elements')).toBe(false);

    const other = await runAgentReportTool(db, 'claimElement', { elementId: UUID, session: 's2' }, actor);
    expect(other.ok).toBe(false);
    expect(other.error).toContain(`held by ${leaseHolder(actor, 's1')} on feat/x`);
  });

  it('logs progress as a comment and renews only its own lease', async () => {
    const tables = { elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'in_progress', claimed_by: 'Claude@wt', claim_expires_at: new Date(Date.now() + 60_000).toISOString() }] };
    const { db, writes, rpcs } = fakeDb(tables);
    const res = await runAgentReportTool(db, 'logProgress', { elementId: UUID, title: '調査', steps: ['a'] }, actor);
    expect(res).toMatchObject({ ok: true, data: { leaseRenewed: false } });
    expect(rpcs).toEqual([]);
    expect(writes.find(w => w.table === 'element_comments')!.row).toMatchObject({ content: '**計画** — 調査\n\n1. a', author_name: actor.agent, author_id: USER, author_kind: 'ai_agent' });

    await runAgentReportTool(db, 'releaseElement', { elementId: UUID }, actor).then((r: { ok: boolean }) => expect(r.ok).toBe(false));
    tables.elements[0].claimed_by = leaseHolder(actor, 's1');
    const renewed = await runAgentReportTool(db, 'logProgress', { elementId: UUID, title: '続き', session: 's1' }, actor);
    expect(renewed).toMatchObject({ ok: true, data: { leaseRenewed: true } });
  });

  it('closes blocked work: status, an attention comment, the lease returned', async () => {
    const holder = leaseHolder(actor, 's1');
    const tables = { elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'in_progress', claimed_by: holder, claim_expires_at: new Date(Date.now() + 60_000).toISOString(), branch: 'b' }] };
    const { db, writes } = fakeDb(tables);
    const notices: unknown[] = [];
    const notify = async (n: unknown) => { notices.push(n); };
    const res = await runAgentReportTool(db, 'reportOutcome', { elementId: UUID, outcome: 'blocked', summary: '判断が要る', message: 'A か B か', session: 's1' }, actor, notify);
    expect(res).toMatchObject({ ok: true, data: { status: 'blocked', released: true } });
    // The triggers skip the actor, so the connecting person is told directly.
    expect(notices).toEqual([{ actorName: actor.agent, elementId: UUID, title: `${actor.agent}: 対応が必要です`, body: 'ELE_PLT-003 — 判断が要る' }]);
    expect(writes.find(w => w.table === 'elements')!.row).toMatchObject({ status: 'blocked' });
    expect(writes.find(w => w.table === 'element_activity')!.row).toMatchObject({ detail: `Updated status — via ${actor.agent}` });
    expect(writes.find(w => w.table === 'element_comments')!.row).toMatchObject({ content: '**対応が必要です** — 判断が要る\n\nA か B か' });
    expect(tables.elements[0]).toMatchObject({ claimed_by: null, branch: null });
  });

  it('tells the connecting person about completed work, and keeps the report when telling fails', async () => {
    const { db, writes } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003', title: '請求書の照合', status: 'in_progress' }] });
    const failing = async () => { throw new Error('down'); };
    const res = await runAgentReportTool(db, 'reportOutcome', { elementId: UUID, outcome: 'completed', summary: '照合済み', message: '根拠: 120 件一致' }, actor, failing);
    expect(res).toMatchObject({ ok: true, data: { status: 'review', released: false } });
    expect(writes.some(w => w.table === 'element_comments')).toBe(true);
    expect(outcomeNotice('X (MCP)', 'completed', { id: UUID, display_id: 'ELE_PLT-003', title: '請求書の照合' }, '照合済み'))
      .toEqual({ actorName: 'X (MCP)', elementId: UUID, title: 'X (MCP): 完了報告', body: 'ELE_PLT-003 請求書の照合 — 照合済み' });
  });

  it('sends no notification for a refused report', async () => {
    const { db } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'todo' }] });
    const notices: unknown[] = [];
    await runAgentReportTool(db, 'reportOutcome', { elementId: UUID, outcome: 'blocked', summary: '', message: 'm' }, actor, async (n: unknown) => { notices.push(n); });
    expect(notices).toEqual([]);
  });

  it('refuses an unknown outcome and an Element the caller cannot see', async () => {
    const { db, writes } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'todo' }] });
    expect(await runAgentReportTool(db, 'reportOutcome', { elementId: UUID, outcome: 'done', summary: 's', message: 'm' }, actor))
      .toEqual({ ok: false, error: 'outcome must be completed, partial or blocked' });
    expect(await runAgentReportTool(db, 'claimElement', { elementId: '85c79ab0-fb76-4bf3-8a75-c5635880cb4f' }, actor))
      .toEqual({ ok: false, error: 'Element not found' });
    expect(writes).toEqual([]);
  });
});

describe('external surface', () => {
  it('offers the report tools to read-write connections only', async () => {
    const rw = mcpTools('read_write').map((t: { name: string }) => t.name);
    const ro = mcpTools('read').map((t: { name: string }) => t.name);
    for (const name of AGENT_REPORT_TOOL_NAMES) {
      expect(rw).toContain(name);
      expect(ro).not.toContain(name);
    }
    const { db, rpcs } = fakeDb({ elements: [{ id: UUID }] });
    const res = await runExternalTool(db, 'claimElement', { elementId: UUID }, actor, 'read');
    expect(res.ok).toBe(false);
    expect(rpcs).toEqual([]);
  });
});
