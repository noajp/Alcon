import { describe, expect, it } from 'vitest';
import { enabledConnectedNames, installReadiness, missingConnectors, missingForWork, workDefinition } from '@/AIP/harness/installFlow';

const row = (over: Record<string, unknown> = {}) => ({ name: 'GitHub', preset: 'github', enabled: true, ...over });

describe('missingConnectors', () => {
  it('a disabled connection does not satisfy a need', () => {
    const missing = missingConnectors(['GitHub'], [row({ enabled: false })]);
    expect(missing.map((m) => m.name)).toEqual(['GitHub']);
  });

  it('an enabled connection satisfies by its name, its preset id, or its preset name, folded', () => {
    expect(missingConnectors(['My GitHub'], [row({ name: 'My GitHub' })])).toEqual([]);
    expect(missingConnectors(['github'], [row({ name: 'Renamed' })])).toEqual([]);
    expect(missingConnectors(['Google Drive'], [row({ name: 'Renamed', preset: 'google-drive' })])).toEqual([]);
    expect(missingConnectors(['googledrive'], [row({ name: 'Renamed', preset: 'google-drive' })])).toEqual([]);
    // The row's own folded name works with no preset at all.
    expect(missingConnectors(['Google Drive'], [row({ name: 'googledrive', preset: null })])).toEqual([]);
  });

  it('keeps body order and de-duplicates by folded name', () => {
    const missing = missingConnectors(['Notion', 'GitHub', ' notion ', 'Slack'], [row()]);
    expect(missing.map((m) => m.name)).toEqual(['Notion', 'Slack']);
  });

  it('resolves a need to its fixed preset, and to none for registry-only or model names', () => {
    const [gh] = missingConnectors(['GitHub'], []);
    expect(gh.preset?.id).toBe('github');
    const [linear] = missingConnectors(['Linear'], []);
    expect(linear.preset?.id).toBe('linear');
    const [notion] = missingConnectors(['Notion'], []);
    expect(notion.preset).toBeNull();
    const [deepseek] = missingConnectors(['DeepSeek'], []);
    expect(deepseek.preset).toBeNull();
  });
});

describe('workDefinition / missingForWork', () => {
  const harnessBody = (connectors: string[]) =>
    `# 目的\n仕事を進める\n# 使うコネクタ\n${connectors.map((c) => `- ${c}`).join('\n')}`;
  const def = (id: string, connectors: string[], enabled = true) => ({ id, body: harnessBody(connectors), enabled });

  it('resolves the Element’s own definition first, then the Strategy’s — the engine’s order', () => {
    const defs = [def('own', ['GitHub']), def('strategy', ['Slack'])];
    expect(workDefinition(['own', 'strategy'], defs)).toBe('own');
    expect(workDefinition([null, 'strategy'], defs)).toBe('strategy');
    expect(workDefinition([null, null], defs)).toBeNull();
    expect(workDefinition(['gone', 'strategy'], defs)).toBe('strategy');
  });

  it('a disabled definition is skipped, as if its slot were empty', () => {
    const defs = [def('own', ['GitHub'], false), def('strategy', ['Slack'])];
    expect(workDefinition(['own', 'strategy'], defs)).toBe('strategy');
    expect(missingForWork(['own', 'strategy'], defs, []).map((m) => m.name)).toEqual(['Slack']);
  });

  it('reports what the resolved definition names that the Space has not connected', () => {
    const defs = [def('own', ['GitHub', 'Notion'])];
    expect(missingForWork(['own', null], defs, [row()]).map((m) => m.name)).toEqual(['Notion']);
    expect(missingForWork(['own', null], defs, [row(), row({ name: 'Notion', preset: null })])).toEqual([]);
  });

  it('no usable definition promises nothing, so nothing is missing', () => {
    expect(missingForWork([null, null], [def('own', ['GitHub'])], [])).toEqual([]);
    expect(missingForWork(['own'], [def('own', ['GitHub'], false)], [])).toEqual([]);
  });
});

describe('enabledConnectedNames', () => {
  it('lists the aliases of enabled rows only', () => {
    const names = enabledConnectedNames([row(), row({ name: 'Off Drive', preset: 'google-drive', enabled: false })]);
    expect(names).toContain('GitHub');
    expect(names).toContain('github');
    expect(names).not.toContain('Off Drive');
    expect(names).not.toContain('google-drive');
  });
});

describe('installReadiness', () => {
  const body = (connectors: string[], extra = '') =>
    `# 目的\n仕事を進める\n# 使うコネクタ\n${connectors.map((c) => `- ${c}`).join('\n')}\n# 成果物の型\n\`\`\`md\n# 結果\n\`\`\`${extra}`;

  it('passes when every named connector is connected and the check has no errors', () => {
    const r = installReadiness({ body: body(['GitHub']) }, [row()]);
    expect(r.missing).toEqual([]);
    expect(r.passing).toBe(true);
  });

  it('an H005 warning alone (a missing connector) makes it not passing', () => {
    const r = installReadiness({ body: body(['Notion']) }, []);
    expect(r.missing.map((m) => m.name)).toEqual(['Notion']);
    expect(r.diagnostics.some((d) => d.code === 'H005')).toBe(true);
    expect(r.passing).toBe(false);
  });

  it('an H006 hint alone leaves it passing', () => {
    const noShape = '# 目的\n仕事を進める\n# 止める条件\n- 終わったら止まる';
    const r = installReadiness({ body: noShape }, []);
    expect(r.diagnostics.map((d) => d.code)).toContain('H006');
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(r.passing).toBe(true);
  });

  it('an error diagnostic makes it not passing even with every connector connected', () => {
    const r = installReadiness({ body: '# 使うコネクタ\n- GitHub' }, [row()]);
    expect(r.diagnostics.some((d) => d.code === 'H001' && d.severity === 'error')).toBe(true);
    expect(r.passing).toBe(false);
  });
});
