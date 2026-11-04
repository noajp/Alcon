import { describe, expect, it } from 'vitest';

const d = await import(new URL('../../supabase/functions/_shared/connectorDirectory.ts', import.meta.url).pathname);

describe('connector directory', () => {
  it('turns a remote registry server into what adding it needs', () => {
    expect(d.entryOf({ server: {
      name: 'com.notion/mcp', title: 'Notion', description: 'Pages', version: '1.0.1', websiteUrl: 'https://notion.so',
      remotes: [{ type: 'sse', url: 'https://mcp.notion.com/sse' }, { type: 'streamable-http', url: 'https://mcp.notion.com/mcp' }],
    } })).toEqual({
      id: 'com.notion/mcp', title: 'Notion', description: 'Pages', endpoint: 'https://mcp.notion.com/mcp',
      auth: 'none', authHeader: null, website: 'https://notion.so/', icon: null, version: '1.0.1',
    });
  });

  it('reads how it authenticates from the headers it asks for', () => {
    const bearer = d.entryOf({ server: { name: 'a/b', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp', headers: [{ name: 'Authorization', isRequired: true }] }] } });
    expect([bearer.auth, bearer.authHeader, bearer.title]).toEqual(['bearer', null, 'B']);
    const header = d.entryOf({ server: { name: 'a/c', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp', headers: [{ name: 'X-Api-Key', isSecret: true }] }] } });
    expect([header.auth, header.authHeader]).toEqual(['header', 'X-Api-Key']);
  });

  it('leaves out servers that cannot be called remotely over https, and repeats', () => {
    expect(d.entryOf({ server: { name: 'a/local', packages: [{}] } })).toBeNull();
    expect(d.entryOf({ server: { name: 'a/http', remotes: [{ type: 'streamable-http', url: 'http://x.example/mcp' }] } })).toBeNull();
    const page = d.entriesOf({ servers: [
      { server: { name: 'a/b', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp' }] } },
      { server: { name: 'a/b', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp' }] } },
      { server: { name: 'a/local' } },
    ], metadata: { nextCursor: 'a/b:1' } });
    expect(page.entries.map((e: { id: string }) => e.id)).toEqual(['a/b']);
    expect(page.nextCursor).toBe('a/b:1');
  });

  it('names a server without a title by what its name says', () => {
    expect(d.titleFromName('com.notion/mcp')).toBe('Notion');
    expect(d.titleFromName('io.github.sadri/notion-url-shape')).toBe('Notion url shape');
    expect(d.titleFromName('ai.smithery/smithery-notion')).toBe('Smithery notion');
  });
});
