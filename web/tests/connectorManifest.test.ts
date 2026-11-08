import { describe, expect, it } from 'vitest';
import { criticalClassOfManifestCommand } from '@/AIP/connectors/catalog';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);

const RAW = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'search_issues', action: 'issues.search', effect: 'read', description: 'Search', input: { q: { type: 'string' } }, required: ['q'],
      http: { method: 'GET', path: '/search/issues', query: ['q'] } },
    { name: 'comment', action: 'issues.comment', effect: 'write', input: { repo: { type: 'string' }, number: { type: 'number' }, body: { type: 'string' } },
      required: ['repo', 'number', 'body'], http: { method: 'POST', path: '/repos/{repo}/issues/{number}/comments', body: ['body'] } },
    { name: 'close', action: 'issues.close', effect: 'write', permission: 'deny', http: { method: 'PATCH', path: '/x' } },
    { name: 'list_files', action: 'drive.list', effect: 'read', mcp: 'list_files' },
    { name: 'sneaky', action: 'issues.close', effect: 'write', permission: 'allow', http: { method: 'POST', path: '/y' } },
    { name: 'BadName', effect: 'read', http: { method: 'GET', path: '/z' } },
    { name: 'read_but_posts', effect: 'read', http: { method: 'POST', path: '/z' } },
    { name: 'nowhere', effect: 'read' },
  ],
  aliases: { find_issues: 'issues.search' },
};

describe('connector manifests', () => {
  const { manifest, errors } = cm.parseManifest(RAW);

  it('reads commands, fills permissions from the defaults, and leaves out what it cannot read', () => {
    expect(manifest.commands.map((c: { name: string }) => c.name)).toEqual(['search_issues', 'comment', 'close', 'list_files', 'sneaky']);
    expect(manifest.commands[0].permission).toBe('allow');
    expect(manifest.commands[1].permission).toBe('ask');
    expect(errors.length).toBe(3);
    expect(errors.join('\n')).toContain('read のコマンドは GET か HEAD');
  });

  it('resolves aliases to the canonical action, and a denial on an action cannot be slipped under another command', () => {
    expect(cm.canonicalAction(manifest, 'find_issues')).toBe('issues.search');
    expect(cm.permissionOf(manifest, 'issues.close')).toBe('deny');
    expect(cm.offeredCommands(manifest).map((c: { name: string }) => c.name)).toEqual(['search_issues', 'comment', 'list_files']);
    expect(cm.permissionOf(manifest, 'unknown')).toBe('deny');
  });

  it('builds the request: path values encoded inside their segment, query and body from the declared fields', () => {
    const comment = manifest.commands[1];
    expect(cm.requestFor(comment, { repo: 'a/../b', number: 7, body: 'hi', extra: 1 }))
      .toEqual({ method: 'POST', path: '/repos/a%2F..%2Fb/issues/7/comments', query: {}, body: { body: 'hi' } });
    expect(cm.requestFor(manifest.commands[0], { q: 'bug' })).toEqual({ method: 'GET', path: '/search/issues', query: { q: 'bug' } });
    expect(cm.requestFor(comment, { repo: 'a', number: 7 })).toEqual({ error: 'body が必要です' });
  });

  it('turns a command into a closed tool schema', () => {
    expect(cm.commandSchema(manifest.commands[0])).toEqual({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false });
  });

  it('refuses a manifest that is not an object', () => {
    expect(cm.parseManifest('x').manifest.commands).toEqual([]);
  });
});

describe('manifestFromTools', () => {
  const tools = [
    { name: 'search_repositories', description: 'Search', readOnly: true },
    { name: 'mergePullRequest', description: 'Merge', readOnly: false },
    { name: '2fa-check', readOnly: true },
  ];
  it('declares one command per tool, read or write as the server marks it', () => {
    const m = cm.manifestFromTools(tools, null);
    expect(m.commands.map((c: { name: string; effect: string; mcp: string }) => [c.name, c.effect, c.mcp])).toEqual([
      ['search_repositories', 'read', 'search_repositories'], ['merge_pull_request', 'write', 'mergePullRequest'], ['t_2fa_check', 'read', '2fa-check'],
    ]);
    const { manifest, errors } = cm.parseManifest(m);
    expect(errors).toEqual([]);
    expect(cm.permissionOf(manifest, 'merge_pull_request')).toBe('ask');
    expect(cm.permissionOf(manifest, 'search_repositories')).toBe('allow');
  });

  it('keeps what a person set, drops tools that went away, keeps hand-declared API commands', () => {
    const before = { commands: [
      { name: 'merge_pull_request', action: 'merge_pull_request', effect: 'write', permission: 'deny', mcp: 'mergePullRequest' },
      { name: 'old_tool', effect: 'read', mcp: 'old_tool' },
      { name: 'ping', effect: 'read', http: { method: 'GET', path: '/ping' } },
    ] };
    const m = cm.manifestFromTools(tools, before);
    const names = m.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(['ping', 'search_repositories', 'merge_pull_request', 't_2fa_check']);
    expect(m.commands.find((c: { name: string }) => c.name === 'merge_pull_request').permission).toBe('deny');
  });
});

describe('presentation blocks', () => {
  const withPresent = (present: unknown) => cm.parseManifest({
    version: 1,
    commands: [{ name: 'open_pr', action: 'pulls.create', effect: 'write', mcp: 'create_pull_request', present }],
  }).manifest.commands[0];

  it('reads a well-shaped block onto the command', () => {
    const c = withPresent({
      title: 'Open a pull request',
      fields: [{ arg: 'title', label: 'Title' }, { arg: 'base', label: 'Base' }],
      preview: 'body',
    });
    expect(c.present).toEqual({
      title: 'Open a pull request',
      fields: [{ arg: 'title', label: 'Title' }, { arg: 'base', label: 'Base' }],
      preview: 'body',
    });
  });

  it('drops a malformed block whole, and keeps the command', () => {
    for (const bad of [
      { title: 'x'.repeat(121) },
      { title: 42 },
      { fields: Array.from({ length: 9 }, (_, i) => ({ arg: `a${i}`, label: 'L' })) },
      { fields: [{ arg: 'not a field!', label: 'L' }] },
      { fields: [{ arg: 'ok', label: 'y'.repeat(41) }] },
      { fields: 'title' },
      { preview: 'not a field!' },
      { preview: 7 },
    ]) {
      const c = withPresent(bad);
      expect(c.present, JSON.stringify(bad)).toBeNull();
      expect(c.name).toBe('open_pr');
    }
    expect(withPresent(undefined).present).toBeNull();
    expect(withPresent({}).present).toBeNull();
  });

  it('survives a connection test rewrite, keyed by the tool, and drops with its tool', () => {
    const before = {
      version: 1,
      commands: [{
        name: 'open_pr', action: 'pulls.create', effect: 'write', mcp: 'create_pull_request',
        present: { title: 'Open a pull request', preview: 'body' },
      }],
    };
    const next = cm.manifestFromTools([{ name: 'create_pull_request', readOnly: false }], before);
    const kept = (next.commands as { mcp: string; present?: unknown }[]).find((x) => x.mcp === 'create_pull_request');
    expect(kept?.present).toEqual({ title: 'Open a pull request', preview: 'body' });
    const gone = cm.manifestFromTools([{ name: 'search_repositories', readOnly: true }], before);
    expect((gone.commands as { present?: unknown }[]).every((x) => x.present === undefined)).toBe(true);
  });
});

describe('argument rules', () => {
  const RULED = {
    version: 1,
    commands: [
      { name: 'create_pull_request', effect: 'write', mcp: 'create_pull_request',
        rules: [
          { when: { owner: 'noajp', repo: 'Alcon' }, permission: 'allow' },
          { when: { repo: 'secret-*' }, permission: 'deny' },
          { when: { owner: 'noajp' }, permission: 'ask' },
          { when: {}, permission: 'allow' },
          { when: { repo: 'x' }, permission: 'sometimes' },
        ] },
      { name: 'send_mail', effect: 'write', permission: 'deny', mcp: 'send_mail',
        rules: [{ when: { to: '*@example.com' }, permission: 'allow' }] },
      { name: 'delete_repo', effect: 'write', permission: 'deny', mcp: 'delete_repo' },
    ],
  };
  const { manifest } = cm.parseManifest(RULED);
  const [pr, mail] = manifest.commands;

  it('keeps only rules it can read', () => {
    expect(pr.rules).toHaveLength(3);
  });

  it('lets the first matching rule decide, then the command', () => {
    expect(cm.decide(manifest, pr, { owner: 'NOAJP', repo: 'alcon', title: 'x' })).toEqual({ permission: 'allow', rule: 0 });
    expect(cm.decide(manifest, pr, { owner: 'other', repo: 'secret-plans' })).toEqual({ permission: 'deny', rule: 1 });
    expect(cm.decide(manifest, pr, { owner: 'noajp', repo: 'web' })).toEqual({ permission: 'ask', rule: 2 });
    expect(cm.decide(manifest, pr, { owner: 'other', repo: 'web' })).toEqual({ permission: 'ask', rule: null });
  });

  it('never matches a missing or structured value', () => {
    expect(cm.ruleMatches({ when: { to: '*' }, permission: 'allow' }, {})).toBe(false);
    expect(cm.ruleMatches({ when: { to: '*' }, permission: 'allow' }, { to: ['a'] })).toBe(false);
  });

  it('treats pattern characters other than * literally', () => {
    expect(cm.globMatch('a.b', 'axb')).toBe(false);
    expect(cm.globMatch('a.b', 'A.B')).toBe(true);
    expect(cm.globMatch('*@example.com', 'x@evil.com?@example.com')).toBe(true);
    expect(cm.globMatch('*@example.com', 'x@example.com.evil')).toBe(false);
  });

  it('offers a denied command that a rule lets through, as an allowlist', () => {
    expect(cm.offeredCommands(manifest).map((c: { name: string }) => c.name)).toEqual(['create_pull_request', 'send_mail']);
    expect(cm.decide(manifest, mail, { to: 'a@example.com' }).permission).toBe('allow');
    expect(cm.decide(manifest, mail, { to: 'a@other.com' }).permission).toBe('deny');
  });

  it('builds a remembered rule only from values every call shares', () => {
    const calls = [{ owner: 'noajp', repo: 'Alcon', title: 'a' }, { owner: 'noajp', repo: 'Alcon', title: 'b' }];
    expect(cm.ruleFromCalls(calls, ['owner', 'repo'])).toEqual({ when: { owner: 'noajp', repo: 'Alcon' }, permission: 'allow' });
    expect(cm.ruleFromCalls(calls, ['title'])).toHaveProperty('error');
    expect(cm.ruleFromCalls([{ q: 'a*' }], ['q'])).toHaveProperty('error');
    expect(cm.ruleFromCalls([{ body: { x: 1 } }], ['body'])).toHaveProperty('error');
    expect(cm.ruleFromCalls(calls, [])).toHaveProperty('error');
  });

  it('adds a rule ahead of the others and does not store a condition twice', () => {
    const rule = { when: { repo: 'web', owner: 'noajp' }, permission: 'allow' };
    const once = cm.withRule(RULED, 'create_pull_request', rule);
    const twice = cm.withRule(once, 'create_pull_request', { when: { owner: 'noajp', repo: 'web' }, permission: 'allow' });
    const rules = (twice.commands as { name: string; rules: unknown[] }[])[0].rules;
    expect(rules[0]).toEqual({ when: { owner: 'noajp', repo: 'web' }, permission: 'allow' });
    expect(rules).toHaveLength(4);
    expect(cm.withRule(RULED, 'nope', rule)).toBeNull();
  });

  it('keeps rules when the connection test rewrites the commands', () => {
    const next = cm.manifestFromTools([{ name: 'create_pull_request', readOnly: false }], RULED);
    const c = (next.commands as { mcp: string; rules?: unknown[] }[]).find((x) => x.mcp === 'create_pull_request');
    expect(c?.rules).toHaveLength(5);
  });
});

describe('critical commands', () => {
  const cmd = (over: Record<string, unknown>) => ({
    name: 'x', action: 'x', effect: 'write', permission: 'ask', description: '', input: {}, required: [], http: null, mcp: null, rules: [], ...over,
  });

  it('classifies the operations a person must be able to stop every time', () => {
    expect(cm.criticalClassOf(cmd({ name: 'send', action: 'gmail.send' }))).toBe('send');
    expect(cm.criticalClassOf(cmd({ name: 'post_message', action: 'chat.postMessage', mcp: 'chat.postMessage' }))).toBe('send');
    expect(cm.criticalClassOf(cmd({ name: 'comment', action: 'issues.comment' }))).toBe('send');
    expect(cm.criticalClassOf(cmd({ name: 'create_charge', action: 'charges.create' }))).toBe('money');
    expect(cm.criticalClassOf(cmd({ name: 'create_refund', action: 'refunds.create' }))).toBe('money');
    expect(cm.criticalClassOf(cmd({ name: 'accept_quote', action: 'quotes.accept' }))).toBe('contract');
    expect(cm.criticalClassOf(cmd({ name: 'create_order', action: 'orders.create' }))).toBe('contract');
    expect(cm.criticalClassOf(cmd({ name: 'sign_contract', action: 'contracts.sign' }))).toBe('contract');
    expect(cm.criticalClassOf(cmd({ name: 'delete_file', action: 'files.delete' }))).toBe('delete');
    // A typed tool's name is judged by the same tokens (Google Drive's trash).
    expect(cm.criticalClassForTokens('trash', 'write')).toBe('delete');
    // An HTTP DELETE is a delete whatever its names say.
    expect(cm.criticalClassOf(cmd({ name: 'fetch_it', action: 'things.fetch', http: { method: 'DELETE', path: '/things/1', query: [], body: [] } }))).toBe('delete');
  });

  it('does not classify ordinary writes, near-miss tokens, or any read', () => {
    expect(cm.criticalClassOf(cmd({ name: 'create_issue', action: 'issues.create' }))).toBeNull();
    expect(cm.criticalClassOf(cmd({ name: 'merge_pull_request', action: 'pulls.merge' }))).toBeNull();
    expect(cm.criticalClassOf(cmd({ name: 'update_postpone_flag', action: 'flags.update' }))).toBeNull();
    expect(cm.criticalClassForTokens('sender postpone', 'write')).toBeNull();
    expect(cm.criticalClassOf(cmd({ name: 'list_deleted_items', action: 'items.listDeleted', effect: 'read' }))).toBeNull();
    expect(cm.criticalClassForTokens('send', 'read')).toBeNull();
  });

  it('orders the classes delete → money → contract → send', () => {
    expect(cm.criticalClassOf(cmd({ name: 'send_invoice', action: 'invoices.send' }))).toBe('money');
    expect(cm.criticalClassOf(cmd({ name: 'delete_order', action: 'orders.delete' }))).toBe('delete');
  });

  it('agrees with the Settings mirror over loose manifest JSON', () => {
    const fixtures = [
      { name: 'send', action: 'gmail.send', effect: 'write', mcp: null, http: null },
      { name: 'post_message', action: 'chat.postMessage', effect: 'write', mcp: 'chat.postMessage', http: null },
      { name: 'create_charge', action: 'charges.create', effect: 'write', mcp: null, http: null },
      { name: 'sign_contract', action: 'contracts.sign', effect: 'write', mcp: null, http: null },
      { name: 'fetch_it', action: 'things.fetch', effect: 'write', mcp: null, http: { method: 'DELETE', path: '/things/1' } },
      { name: 'create_issue', action: 'issues.create', effect: 'write', mcp: null, http: null },
      { name: 'list_deleted_items', action: 'items.listDeleted', effect: 'read', mcp: null, http: null },
    ];
    for (const f of fixtures) expect(criticalClassOfManifestCommand(f), f.name).toBe(cm.criticalClassOf(f));
  });
});
