import { describe, expect, it } from 'vitest';

// The REST API (clayware-api, ELE_PLT-006): the pure routing layer.
const routes = await import(new URL('../../supabase/functions/clayware-api/routes.ts', import.meta.url).pathname);
const external = await import(new URL('../../supabase/functions/_shared/externalTools.ts', import.meta.url).pathname);
const { mcpTools } = await import(new URL('../../supabase/functions/clayware-mcp/tools.ts', import.meta.url).pathname);

const {
  ROUTES, apiPath, matchRoute, planRequest, validateArgs, queryArgs, errorForToolFailure, toResponse,
  apiActorLabel, openApiDocument,
} = routes;
const { EXTERNAL_READ_TOOLS, EXTERNAL_WRITE_TOOLS, runExternalTool } = external;

const UUID = '93fb2fb0-a7a1-434e-9211-af4db709a247';

type Plan = { ok: true; call: { tool: string; args: Record<string, unknown>; successStatus: number } }
  | { ok: false; error: { status: number; code: string; message: string; allow?: string } };

function plan(method: string, path: string, opts: { query?: string; body?: unknown; access?: 'read' | 'read_write' } = {}): Plan {
  return planRequest({
    method,
    path,
    query: new URLSearchParams(opts.query ?? ''),
    body: opts.body === undefined ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    access: opts.access ?? 'read_write',
  });
}

describe('the allowlist', () => {
  it('is a part of what MCP offers', () => {
    const mcp = mcpTools().map((t: { name: string }) => t.name);
    for (const n of [...EXTERNAL_READ_TOOLS, ...EXTERNAL_WRITE_TOOLS]) expect(mcp).toContain(n);
  });

  it('gives every allowed tool exactly one route and no route to anything else', () => {
    const routed = ROUTES.map((r: { tool: string }) => r.tool).sort();
    expect(routed).toEqual([...EXTERNAL_READ_TOOLS, ...EXTERNAL_WRITE_TOOLS].sort());
  });

  it('reaches no delete, bulk change, move or Object edit', () => {
    const forbidden = ['deleteElement', 'bulkUpdateElements', 'bulkDeleteElements', 'moveElement', 'linkElementToObject',
      'unlinkElementFromObject', 'createObject', 'updateObject', 'deleteObject', 'deleteSubelement', 'removeElementAssignee'];
    for (const tool of forbidden) expect(ROUTES.some((r: { tool: string }) => r.tool === tool)).toBe(false);
    expect(ROUTES.some((r: { method: string }) => r.method === ('DELETE' as string))).toBe(false);
  });

  it('runs reads with GET and writes with POST / PATCH / PUT', () => {
    for (const r of ROUTES as { method: string; tool: string }[]) {
      expect(r.method === 'GET').toBe(EXTERNAL_READ_TOOLS.includes(r.tool));
    }
  });

  it('refuses a tool outside the list even when called directly', async () => {
    const db = { from: () => { throw new Error('no db access expected'); } } as never;
    const actor = { agent: 'API', userId: 'u' };
    expect(await runExternalTool(db, 'deleteElement', { id: UUID }, actor)).toMatchObject({ ok: false });
    expect(await runExternalTool(db, 'createElement', { objectId: UUID, title: 'x' }, actor, 'read')).toMatchObject({ ok: false });
  });
});

describe('paths', () => {
  it('strips the function prefix', () => {
    expect(apiPath('/clayware-api/elements')).toBe('/elements');
    expect(apiPath('/functions/v1/clayware-api/elements/ELE_PLT-006/')).toBe('/elements/ELE_PLT-006');
    expect(apiPath('/clayware-api')).toBe('/');
    expect(apiPath('/clayware-apiary/elements')).toBe('/clayware-apiary/elements');
  });

  it('matches a route and reads its id', () => {
    const m = matchRoute('GET', '/elements/ELE_PLT-006');
    expect(m).toMatchObject({ ok: true, id: 'ELE_PLT-006' });
    expect(m.route.tool).toBe('getElement');
    expect(matchRoute('GET', '/elements/ELE%5FPLT-006')).toMatchObject({ ok: true, id: 'ELE_PLT-006' });
  });

  it('answers 405 with Allow for a known path and 404 for an unknown one', () => {
    expect(matchRoute('DELETE', `/elements/${UUID}`)).toMatchObject({ ok: false, error: { status: 405, allow: 'GET, PATCH, OPTIONS' } });
    expect(matchRoute('GET', '/objects/x/elements')).toMatchObject({ ok: false, error: { status: 404 } });
    expect(matchRoute('GET', '/elements/%E0%A4%A')).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe('planRequest', () => {
  it('types query values by the tool schema', () => {
    expect(plan('GET', '/elements', { query: 'objectId=o&status=todo&limit=20&overdueOnly=true' })).toEqual({
      ok: true,
      call: { tool: 'listElements', args: { objectId: 'o', status: 'todo', limit: 20, overdueOnly: true }, successStatus: 200 },
    });
  });

  it('refuses unknown, repeated, untyped and out-of-enum query values with 422', () => {
    expect(plan('GET', '/elements', { query: 'sort=title' })).toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('GET', '/elements', { query: 'status=todo&status=done' })).toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('GET', '/elements', { query: 'limit=many' })).toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('GET', '/elements', { query: 'overdueOnly=yes' })).toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('GET', '/elements', { query: 'status=finished' })).toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('GET', '/search')).toMatchObject({ ok: false, error: { status: 422, message: '"query" is required' } });
  });

  it('fills the path id into the argument the tool names', () => {
    expect(plan('POST', '/elements/ELE_PLT-006/comments', { body: { body: 'hi' } })).toEqual({
      ok: true, call: { tool: 'addElementComment', args: { body: 'hi', elementId: 'ELE_PLT-006' }, successStatus: 201 },
    });
    expect(plan('PATCH', `/elements/${UUID}`, { body: { status: 'done', due_date: null } })).toEqual({
      ok: true, call: { tool: 'updateElement', args: { status: 'done', due_date: null, id: UUID }, successStatus: 200 },
    });
    expect(plan('PUT', `/elements/${UUID}/labels`, { body: { labels: ['a'] } })).toMatchObject({ ok: true, call: { tool: 'setElementLabels' } });
  });

  it('refuses a body that names the path id, or carries the fields in the query string', () => {
    expect(plan('PATCH', `/elements/${UUID}`, { body: { id: 'other', title: 'x' } }))
      .toMatchObject({ ok: false, error: { status: 422, message: '"id" comes from the path' } });
    expect(plan('POST', '/elements', { query: 'title=x', body: { objectId: UUID, title: 'x' } }))
      .toMatchObject({ ok: false, error: { status: 422 } });
  });

  it('checks the body against the tool schema', () => {
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: 'x' } })).toMatchObject({ ok: true, call: { successStatus: 201 } });
    expect(plan('POST', '/elements', { body: { title: 'x' } })).toMatchObject({ ok: false, error: { status: 422, message: '"objectId" is required' } });
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: 'x', progress: 50 } }))
      .toMatchObject({ ok: false, error: { status: 422, message: 'Unknown field "progress"' } });
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: 'x', labels: 'a' } }))
      .toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: 'x', priority: 'p0' } }))
      .toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: null } }))
      .toMatchObject({ ok: false, error: { status: 422, message: '"title" is required' } });
  });

  it('answers 400 for a body that is not a JSON object', () => {
    expect(plan('POST', '/elements', { body: '{nope' })).toMatchObject({ ok: false, error: { status: 400 } });
    expect(plan('POST', '/elements', { body: '[1]' })).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it('refuses every write to a read-only token with 403 and lets its reads through', () => {
    for (const r of ROUTES as { method: string; path: string; tool: string }[]) {
      if (r.method === 'GET') continue;
      const p = plan(r.method, r.path.replace('{id}', UUID), { body: {}, access: 'read' });
      expect(p).toMatchObject({ ok: false, error: { status: 403 } });
    }
    expect(plan('GET', `/elements/${UUID}`, { access: 'read' })).toMatchObject({ ok: true });
  });

  it('answers 404 for an Initiative or subelement id that is not a UUID', () => {
    expect(plan('GET', '/initiatives/strategy-1')).toMatchObject({ ok: false, error: { status: 404, message: 'Initiative not found' } });
    expect(plan('PATCH', '/subelements/x', { body: {} })).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe('responses', () => {
  it('maps a refused tool call to its status', () => {
    expect(errorForToolFailure('Element not found').status).toBe(404);
    expect(errorForToolFailure('new row violates row-level security policy for table "element_comments"').status).toBe(403);
    expect(errorForToolFailure('title is required').status).toBe(422);
  });

  it('wraps data and meta, and errors as { error: { code, message } }', () => {
    expect(toResponse({ ok: true, data: [1], meta: { rows: 1 } }, 200)).toEqual({ status: 200, body: { data: [1], meta: { rows: 1 } } });
    expect(toResponse({ ok: true, data: { id: 'x' } }, 201)).toEqual({ status: 201, body: { data: { id: 'x' } } });
    expect(toResponse({ ok: false, error: 'Element not found' }, 200))
      .toEqual({ status: 404, body: { error: { code: 'not_found', message: 'Element not found' } } });
  });

  it('records writes as the API, with the token and the caller name', () => {
    expect(apiActorLabel(null, 'ops')).toBe('API · token: ops');
    expect(apiActorLabel('n8n', 'ops')).toBe('n8n (API · token: ops)');
    expect(apiActorLabel(null, null)).toBe('API');
    expect(apiActorLabel('<b>', '<<>>')).toBe('b (API · token)');
  });
});

describe('validateArgs and queryArgs', () => {
  const schema = {
    type: 'object',
    properties: { n: { type: 'number' }, b: { type: 'boolean' }, s: { type: 'string', enum: ['x'] } },
    required: ['s'],
    additionalProperties: false,
  };
  it('accepts a valid set and names the first problem otherwise', () => {
    expect(validateArgs({ s: 'x', n: 1 }, schema)).toBeNull();
    expect(validateArgs({ s: 'x', n: '1' }, schema)?.message).toBe('"n" must be a number');
    expect(validateArgs({}, schema)?.message).toBe('"s" is required');
  });
  it('types numbers and booleans from the query string', () => {
    expect(queryArgs(new URLSearchParams('n=2&b=false&s=x'), schema)).toEqual({ ok: true, args: { n: 2, b: false, s: 'x' } });
    expect(queryArgs(new URLSearchParams('n='), schema)).toMatchObject({ ok: false });
  });
});

describe('openApiDocument', () => {
  it('describes every route from the tool schemas', () => {
    const doc = openApiDocument('https://example.test/functions/v1/clayware-api') as {
      paths: Record<string, Record<string, { operationId: string; requestBody?: { content: Record<string, { schema: { properties: Record<string, unknown>; required?: string[] } }> } }>>;
    };
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId)).sort();
    expect(ops).toEqual([...EXTERNAL_READ_TOOLS, ...EXTERNAL_WRITE_TOOLS].sort());
    const patch = doc.paths['/elements/{id}'].patch.requestBody!.content['application/json'].schema;
    expect(patch.properties).not.toHaveProperty('id');
    expect(patch.required).toBeUndefined();
    const comment = doc.paths['/elements/{id}/comments'].post.requestBody!.content['application/json'].schema;
    expect(comment.required).toEqual(['body']);
  });
});

describe('review hardening', () => {
  it('refuses inherited property names as unknown fields', () => {
    expect(plan('POST', '/elements', { body: { objectId: UUID, title: 'x', constructor: 'y' } }))
      .toMatchObject({ ok: false, error: { status: 422, message: 'Unknown field "constructor"' } });
    expect(plan('GET', '/elements', { query: 'toString=1' })).toMatchObject({ ok: false, error: { status: 422 } });
  });

  it('lets only clearable fields be null', () => {
    expect(plan('PATCH', `/elements/${UUID}`, { body: { status: null } }))
      .toMatchObject({ ok: false, error: { status: 422, message: '"status" cannot be null' } });
    expect(plan('PATCH', '/subelements/' + UUID, { body: { isCompleted: null } }))
      .toMatchObject({ ok: false, error: { status: 422 } });
    expect(plan('PATCH', `/elements/${UUID}`, { body: { due_date: null, estimated_hours: null, description: null } }))
      .toMatchObject({ ok: true });
  });

  it('describes clearable fields as nullable and an all-optional body as optional', () => {
    const doc = openApiDocument('https://example.test') as {
      paths: Record<string, Record<string, { requestBody?: { required: boolean; content: Record<string, { schema: { properties: Record<string, { type: unknown }> } }> } }>>;
    };
    const patch = doc.paths['/elements/{id}'].patch.requestBody!;
    expect(patch.required).toBe(false);
    expect(patch.content['application/json'].schema.properties.due_date.type).toEqual(['string', 'null']);
    expect(doc.paths['/subelements/{id}'].patch.requestBody!.required).toBe(false);
    expect(doc.paths['/elements'].post.requestBody!.required).toBe(true);
  });
});

describe('findByText filter value', () => {
  it('keeps commas, parentheses and quotes inside the value', async () => {
    const board = await import(new URL('../../supabase/functions/_shared/boardTools.ts', import.meta.url).pathname);
    expect(board.quoteFilterValue('%a,b%')).toBe('"%a,b%"');
    expect(board.quoteFilterValue('%x),id.not.is.null,(y%')).toBe('"%x),id.not.is.null,(y%"');
    expect(board.quoteFilterValue('%say "hi" \\%%')).toBe('"%say \\"hi\\" \\\\%%"');
  });
});
