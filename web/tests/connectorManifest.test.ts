import { describe, expect, it } from 'vitest';

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
