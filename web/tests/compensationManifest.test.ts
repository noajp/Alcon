import { describe, expect, it } from 'vitest';
import { draftStructureHashWeb, draftPermissionHashWeb, draftStructureOfWeb, type DraftContentLike } from '@/AIP/connectors/draftModel';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const cd = await import(new URL('../../supabase/functions/_shared/connectorDraft.ts', import.meta.url).pathname);

// Compensation declarations (back-half B9, PR1): a write command may
// declare its undo — another write command of the same manifest plus
// an argument mapping read like verify's expect. The declaration is
// enforcement, not presentation: a malformed one, or one naming a
// target that cannot serve, costs the command its place (fail-closed,
// as with verify and quota); a read's undo is discarded unread. The
// declaration rides the G4 structure hash (it is what the command is)
// and never the permission hash (it is not who may run it), on the
// server and in the web's twin alike.

const MANIFEST = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'get_issue', action: 'issues.get', effect: 'read', input: { number: { type: 'number' } }, required: ['number'], http: { method: 'GET', path: '/issues/{number}' } },
    {
      name: 'create_issue', action: 'issues.create', effect: 'write',
      input: { title: { type: 'string' } }, required: ['title'],
      http: { method: 'POST', path: '/issues', body: ['title'] },
      undo: { command: 'close_issue', input: { issue_number: 'number', state_reason: 'not_planned' } },
    },
    {
      name: 'close_issue', action: 'issues.close', effect: 'write',
      input: { issue_number: { type: 'number' }, state_reason: { type: 'string' } }, required: ['issue_number'],
      http: { method: 'PATCH', path: '/issues/{issue_number}', body: ['state_reason'] },
    },
    { name: 'ping', action: 'meta.ping', effect: 'write', http: { method: 'POST', path: '/ping' } },
  ],
};

const withCommands = (commands: unknown[]) => ({ ...MANIFEST, commands });
const commandOf = (raw: unknown, name: string) => cm.parseManifest(raw).manifest.commands.find((c: { name: string }) => c.name === name);

describe('parseUndo via parseManifest (B9)', () => {
  it('a well-formed declaration lands on the write command', () => {
    const { manifest, errors } = cm.parseManifest(MANIFEST);
    expect(errors).toEqual([]);
    const create = manifest.commands.find((c: { name: string }) => c.name === 'create_issue');
    expect(create?.undo).toEqual({ command: 'close_issue', input: { issue_number: 'number', state_reason: 'not_planned' } });
    const close = manifest.commands.find((c: { name: string }) => c.name === 'close_issue');
    expect(close?.undo).toBeNull();
  });

  it('an absent declaration is simply null — v1 manifests parse exactly as before', () => {
    const bare = withCommands(MANIFEST.commands.map((c) => {
      const { undo: _undo, ...rest } = c as Record<string, unknown>;
      return rest;
    }));
    const { manifest, errors } = cm.parseManifest(bare);
    expect(errors).toEqual([]);
    expect(manifest.commands.every((c: { undo: unknown }) => c.undo === null)).toBe(true);
  });

  it('a malformed declaration drops the command, with the reason named (fail-closed)', () => {
    const malformed: unknown[] = [
      'close_issue',                                                    // not an object
      { command: '', input: {} },                                       // no command name
      { command: 'Close Issue', input: {} },                            // not a command name
      { command: 'close_issue' },                                       // no input map
      { command: 'close_issue', input: 'number' },                      // input not a map
      { command: 'close_issue', input: { issue_number: { n: 1 } } },    // non-scalar value
      { command: 'close_issue', input: { 'bad field': 'number' } },     // unusable field name
      { command: 'close_issue', input: { f: 'x'.repeat(501) } },        // value over the cap
      { command: 'close_issue', input: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, 'number'])) }, // too many fields
    ];
    for (const undo of malformed) {
      const raw = JSON.parse(JSON.stringify(MANIFEST));
      raw.commands[1].undo = undo;
      const { manifest, errors } = cm.parseManifest(raw);
      expect(manifest.commands.some((c: { name: string }) => c.name === 'create_issue')).toBe(false);
      expect(errors.some((e: string) => e.includes('undo'))).toBe(true);
    }
  });

  it('a declaration naming a target that cannot serve drops the command', () => {
    const cases: [string, unknown][] = [
      ['missing target', { command: 'no_such_write', input: {} }],
      ['a read target', { command: 'get_issue', input: {} }],
      ['itself', { command: 'create_issue', input: {} }],
    ];
    for (const [, undo] of cases) {
      const raw = JSON.parse(JSON.stringify(MANIFEST));
      raw.commands[1].undo = undo;
      const { manifest, errors } = cm.parseManifest(raw);
      expect(manifest.commands.some((c: { name: string }) => c.name === 'create_issue')).toBe(false);
      expect(errors.some((e: string) => e.includes('undo'))).toBe(true);
    }
  });

  it('an undo may itself declare an undo (the declaration is harmless; execution never recurses)', () => {
    const raw = JSON.parse(JSON.stringify(MANIFEST));
    raw.commands[2].undo = { command: 'ping', input: {} };
    const { manifest, errors } = cm.parseManifest(raw);
    expect(errors).toEqual([]);
    expect(manifest.commands.find((c: { name: string }) => c.name === 'close_issue')?.undo).toEqual({ command: 'ping', input: {} });
  });

  it("a read's undo is discarded unread — even a malformed one costs the read nothing", () => {
    const raw = JSON.parse(JSON.stringify(MANIFEST));
    raw.commands[0].undo = { command: 'close_issue', input: { issue_number: 'number' } };
    const ok = cm.parseManifest(raw);
    expect(ok.errors).toEqual([]);
    expect(ok.manifest.commands.find((c: { name: string }) => c.name === 'get_issue')?.undo).toBeNull();
    raw.commands[0].undo = 'garbage';
    const bad = cm.parseManifest(raw);
    expect(bad.manifest.commands.some((c: { name: string }) => c.name === 'get_issue')).toBe(true);
    expect(bad.manifest.commands.find((c: { name: string }) => c.name === 'get_issue')?.undo).toBeNull();
  });
});

describe('manifestFromTools preserves a stored undo (B9)', () => {
  it('a connection-test rebuild keeps the declaration a person wrote', () => {
    const existing = {
      version: 1,
      defaults: { read: 'allow', write: 'ask' },
      commands: [
        { name: 'create_issue', action: 'create_issue', effect: 'write', mcp: 'create_issue', undo: { command: 'close_issue', input: { issue_number: 'number' } } },
        { name: 'close_issue', action: 'close_issue', effect: 'write', mcp: 'close_issue' },
      ],
    };
    const rebuilt = cm.manifestFromTools([
      { name: 'create_issue', description: 'Open an issue', readOnly: false },
      { name: 'close_issue', description: 'Close an issue', readOnly: false },
    ], existing) as { commands: Record<string, unknown>[] };
    const create = rebuilt.commands.find((c) => c.mcp === 'create_issue');
    expect(create?.undo).toEqual({ command: 'close_issue', input: { issue_number: 'number' } });
    // And the rebuilt manifest still parses with the declaration live.
    expect(commandOf(rebuilt, 'create_issue')?.undo).toEqual({ command: 'close_issue', input: { issue_number: 'number' } });
  });
});

describe('the G4 hashes bind undo as structure, never as permission (B9)', () => {
  const content = {
    name: 'Issues API', endpoint: 'https://api.example.com/v1', auth_type: 'bearer',
    auth_header: null, manifest: MANIFEST, guide: null as string | null,
  };

  it('an undo-only difference moves the structure hash and leaves the permission hash', async () => {
    const structure = await cd.draftStructureHash(content);
    const permissions = await cd.draftPermissionHash(content);
    const without = JSON.parse(JSON.stringify(MANIFEST));
    delete without.commands[1].undo;
    expect(await cd.draftStructureHash({ ...content, manifest: without })).not.toBe(structure);
    expect(await cd.draftPermissionHash({ ...content, manifest: without })).toBe(permissions);
    const retargeted = JSON.parse(JSON.stringify(MANIFEST));
    retargeted.commands[1].undo = { command: 'ping', input: {} };
    expect(await cd.draftStructureHash({ ...content, manifest: retargeted })).not.toBe(structure);
    expect(await cd.draftPermissionHash({ ...content, manifest: retargeted })).toBe(permissions);
  });

  it('the web twin projects the declaration identically', async () => {
    const like: DraftContentLike = content;
    expect(draftStructureOfWeb(like)).toEqual(cd.draftStructureOf(content));
    expect(await draftStructureHashWeb(like)).toBe(await cd.draftStructureHash(content));
    expect(await draftPermissionHashWeb(like)).toBe(await cd.draftPermissionHash(content));
    // A manifest whose undo target cannot serve loses the command on both sides.
    const broken = JSON.parse(JSON.stringify(MANIFEST));
    broken.commands[1].undo = { command: 'get_issue', input: {} };
    expect(draftStructureOfWeb({ ...like, manifest: broken })).toEqual(cd.draftStructureOf({ ...content, manifest: broken }));
  });
});
