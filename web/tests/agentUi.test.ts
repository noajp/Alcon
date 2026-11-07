import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '@/Function/shared/markdownParse';
import { approvalRows, readableFields, rememberChoices, sharedColumns } from '@/ActivitySpace/execution/element/agent/approvalView';
import { agentMention, foldAgentRuns, plainFirstLine } from '@/ActivitySpace/execution/element/agent/commentAgent';

describe('markdown for agent reports', () => {
  it('reads headings, tables, lists and inline marks', () => {
    const blocks = parseMarkdown('## 結果\n3 件 **成功**\n\n| 宛先 | 判定 |\n|---|---|\n| alice | OK |\n| bob | OK |\n\n- a\n- `b`\n\n1. x\n2. y');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'table', 'ul', 'ol']);
    const table = blocks[2] as { t: 'table'; head: unknown[][]; rows: unknown[][][] };
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(parseInline('3 件 **成功**')).toEqual([{ t: 'text', v: '3 件 ' }, { t: 'strong', c: [{ t: 'text', v: '成功' }] }]);
  });

  it('keeps only safe links and never emits HTML', () => {
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false);
    expect(parseInline('[x](data:text/html,hi)')).toEqual([{ t: 'text', v: 'x' }]);
    expect(parseInline('[x](https://a.io)')).toEqual([{ t: 'link', href: 'https://a.io', c: [{ t: 'text', v: 'x' }] }]);
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });

  it('keeps fenced code as is', () => {
    expect(parseMarkdown('```json\n{"a": 1}\n```')).toEqual([{ t: 'code', v: '{"a": 1}', lang: 'json' }]);
  });
});

describe('approval card rows', () => {
  const action = {
    input: {
      calls: [
        { id: 'a', name: 'echo_ab12__http_request', input: { method: 'POST', path: '/notify', body: { to: 'alice', message: 'hi' } } },
        { id: 'b', name: 'echo_ab12__http_request', input: { method: 'POST', path: '/notify', body: { to: 'bob', message: 'hi' } } },
      ],
      display: [{ id: 'a', integration: 'Echo Test', operation: 'POST /notify' }, { id: 'b', integration: 'Echo Test', operation: 'POST /notify' }],
    },
  };

  it('shows one readable row per write, with a shared table when the batch is uniform', () => {
    const rows = approvalRows(action as never);
    expect(rows.map((r) => [r.integration, r.operation])).toEqual([['Echo Test', 'POST /notify'], ['Echo Test', 'POST /notify']]);
    expect(rows[0].fields).toEqual([['to', 'alice'], ['message', 'hi']]);
    expect(sharedColumns(rows)).toEqual(['to', 'message']);
  });

  it('reads MCP arguments directly and shortens long values', () => {
    const { fields } = readableFields({ title: 'x'.repeat(300), teamId: 't1', labels: ['a', 'b'], path: '/docs/a' });
    expect(fields[0][1].endsWith('…')).toBe(true);
    expect(fields).toContainEqual(['labels', 'a, b']);
    expect(fields).toContainEqual(['path', '/docs/a']);
  });

  it('shows an HTTP call\'s query and says how many fields it left out', () => {
    const r = readableFields({ method: 'POST', path: '/x', query: { force: true }, body: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } });
    expect(r.fields[0]).toEqual(['?force', 'true']);
    expect(r.fields).toHaveLength(6);
    expect(r.more).toBe(2);
  });

  it('falls back to the tool name when no label was stored', () => {
    const rows = approvalRows({ input: { calls: [{ id: 'x', name: 'linear_1234__create_issue', input: { title: 'Bug' } }] } } as never);
    expect(rows[0]).toMatchObject({ integration: 'linear_1234', operation: 'create_issue' });
    expect(sharedColumns(rows)).toBeNull();
  });

  it('carries destination, detail, effect, criticality and rememberability from the stored display', () => {
    const rich = {
      input: {
        calls: [{ id: 'a', name: 'slack_1__chat_postMessage', input: { channel: 'C1', text: 'hi' } }],
        display: [{
          id: 'a', integration: 'Slack', operation: 'chat.postMessage', destination: 'https://slack.com/api',
          detail: null, effect: 'write', critical: 'send', rememberable: false,
        }],
      },
    };
    expect(approvalRows(rich as never)[0]).toMatchObject({
      destination: 'https://slack.com/api', detail: null, effect: 'write', critical: 'send', rememberable: false,
    });
    const http = {
      input: {
        calls: [{ id: 'a', name: 'gh__comment', input: { repo: 'a/b', number: 7, body: 'x' } }],
        display: [{
          id: 'a', integration: 'GitHub', operation: 'issues.comment', destination: 'https://api.github.com',
          detail: 'POST /repos/a%2Fb/issues/7/comments', effect: 'write', critical: 'send', rememberable: false,
        }],
      },
    };
    expect(approvalRows(http as never)[0].detail).toBe('POST /repos/a%2Fb/issues/7/comments');
  });

  it('defaults a legacy display to the safe side: destination is the name, not critical, not rememberable', () => {
    const rows = approvalRows(action as never);
    expect(rows[0].destination).toBe('Echo Test');
    expect(rows[0].detail).toBeNull();
    expect(rows[0].critical).toBeNull();
    expect(rows[0].rememberable).toBe(false);
    // The fixture's calls share method/path values, but a legacy action may not be remembered.
    expect(rememberChoices(action as never)).toEqual([]);
  });

  it('offers shared fields only when every call in the batch is rememberable', () => {
    const batch = (flags: [boolean, boolean], critical: string | null = null) => ({
      input: {
        calls: [
          { id: 'a', name: 'gh__create_issue', input: { repo: 'Alcon', title: 'one' } },
          { id: 'b', name: 'gh__create_issue', input: { repo: 'Alcon', title: 'two' } },
        ],
        display: [
          { id: 'a', integration: 'GitHub', operation: 'issues.create', rememberable: flags[0], critical },
          { id: 'b', integration: 'GitHub', operation: 'issues.create', rememberable: flags[1], critical },
        ],
      },
    });
    expect(rememberChoices(batch([true, true]) as never)).toEqual([{ field: 'repo', value: 'Alcon' }]);
    // A critical batch, a manifest-less (raw HTTP) batch, and a mixed batch offer nothing.
    expect(rememberChoices(batch([false, false], 'send') as never)).toEqual([]);
    expect(rememberChoices(batch([false, false]) as never)).toEqual([]);
    expect(rememberChoices(batch([true, false]) as never)).toEqual([]);
  });
});

describe('comments and agents', () => {
  const ai = [{ id: 'w1', name: 'Claude' }, { id: 'w2', name: 'Claude Code' }];

  it('recognises @AI and AI Worker names, preferring the longest name', () => {
    expect(agentMention('@AI 税込にして', ai)).toEqual({ workerId: null });
    expect(agentMention('お願い @Claude、続けて', ai)).toEqual({ workerId: 'w1' });
    expect(agentMention('@Claude Code これ直して', ai)).toEqual({ workerId: 'w2' });
    expect(agentMention('mail@ai.example を確認', ai)).toBeNull();
    expect(agentMention('普通のコメント', ai)).toBeNull();
  });

  it('ignores people named like the agent, quoted lines and code', () => {
    expect(agentMention('@Ai Tanaka 確認お願いします', ai, ['Ai Tanaka'])).toBeNull();
    expect(agentMention('> @AI 税込にして\n了解です', ai)).toBeNull();
    expect(agentMention('`@AI` と書くと動きます', ai)).toBeNull();
    expect(agentMention('```\n@AI\n```', ai)).toBeNull();
    expect(agentMention('@Ai Tanaka と @AI で確認', ai, ['Ai Tanaka'])).toEqual({ workerId: null });
    expect(agentMention('@Claude Code 直して', ai, ['Claude'])).toEqual({ workerId: 'w2' });
    expect(agentMention('@Claude 見て', ai, ['Claude'])).toBeNull();
    expect(agentMention('お願い、@AI で', ai)).toEqual({ workerId: null });
  });

  it('folds long stretches of agent comments, keeping the last and any focused one', () => {
    const c = (id: string, kind: string) => ({ id, author_kind: kind });
    const list = [c('h1', 'human'), c('a1', 'ai_agent'), c('a2', 'ai_agent'), c('a3', 'ai_agent'), c('a4', 'ai_agent'), c('h2', 'human'), c('a5', 'ai_agent')];
    const segs = foldAgentRuns(list, 4);
    expect(segs.map((s) => s.kind)).toEqual(['one', 'fold', 'one', 'one']);
    const fold = segs[1] as { kind: 'fold'; hidden: { id: string }[]; last: { id: string } };
    expect(fold.hidden.map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
    expect(fold.last.id).toBe('a4');
    expect(foldAgentRuns(list, 4, 'a2').map((s) => s.kind)).toEqual(['one', 'one', 'one', 'one', 'one', 'one', 'one']);
  });

  it('never folds a pinned comment away', () => {
    const c = (id: string, pinned = false) => ({ id, author_kind: 'ai_agent', is_pinned: pinned });
    const segs = foldAgentRuns([c('p1', true), c('a1'), c('a2'), c('a3')], 4);
    expect(segs.map((s) => s.kind)).toEqual(['one', 'one', 'one', 'one']);
  });

  it('summarises a comment without markdown marks', () => {
    expect(plainFirstLine('\n**完了報告** — 3 件送信\n## 結果')).toBe('完了報告 — 3 件送信');
  });
});
