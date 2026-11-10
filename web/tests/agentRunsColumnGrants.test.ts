import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// agent_runs is readable from the browser column by column (the transcript
// and the continuation token stay with the service role). A column the
// browser selects without a grant fails the whole read with "permission
// denied for table agent_runs", so every column a browser read names must
// be granted to authenticated by some migration.

const root = new URL('../../', import.meta.url).pathname;
const migrationsDir = join(root, 'supabase/migrations');
const srcDir = join(root, 'web/src');

const HIDDEN = ['transcript', 'continuation_token'];

function columns(list: string): string[] {
  return list.split(',').map((c) => c.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

function granted(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // "grant select (a, b) on …" and "grant insert (a), select (a) on …".
    for (const m of sql.matchAll(/grant ([^;']*?) on public\.agent_runs to authenticated/gi)) {
      for (const s of m[1].matchAll(/select \(([^)]+)\)/gi)) for (const c of columns(s[1])) out.add(c);
    }
    // A guarded loop that grants a list of columns one by one.
    if (/grant select \(%I\) on public\.agent_runs to authenticated/i.test(sql)) {
      const list = sql.match(/array\[([^\]]+)\]/i);
      if (list) for (const c of columns(list[1])) out.add(c);
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every column a browser read of agent_runs names, by file. */
function selected(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of sourceFiles(srcDir)) {
    if (file.includes('/types/')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/from\('agent_runs'\)[\s\S]{0,200}?\.select\(([^)]*)\)/g)) {
      const arg = m[1].trim();
      let list: string | null = null;
      if (/^'[^']*'$/.test(arg)) list = arg.slice(1, -1);
      else if (/^[A-Z_]+$/.test(arg)) {
        const def = text.match(new RegExp(`const ${arg}\\s*=\\s*\\n?\\s*'([^']*)'`));
        list = def ? def[1] : null;
      }
      if (list === null) continue;
      out.set(file.replace(srcDir, 'src'), [...(out.get(file.replace(srcDir, 'src')) ?? []), ...columns(list)]);
    }
  }
  return out;
}

describe('agent_runs column grants', () => {
  it('finds the browser reads it checks', () => {
    const reads = selected();
    expect([...reads.keys()]).toEqual(expect.arrayContaining(['src/AIP/ai/agentData.ts', 'src/hooks/strategyEvaluationData.ts']));
    expect(reads.get('src/AIP/ai/agentData.ts')).toContain('chain_scope');
  });

  it('grants every column a browser read selects', () => {
    const grants = granted();
    const missing = [...selected()].flatMap(([file, cols]) =>
      cols.filter((c) => c !== '*' && !grants.has(c)).map((c) => `${file}: ${c}`));
    expect(missing).toEqual([]);
  });

  it('never grants the transcript or the continuation token', () => {
    const grants = granted();
    for (const c of HIDDEN) expect(grants.has(c)).toBe(false);
  });
});
