import { describe, expect, it } from 'vitest';

// The machine (workspace) declaration grammar (coding capability
// PR1, design §4.3): a definition that needs the isolated machine
// says so in its Conditions — the workspace kind, the egress it
// needs, the time it may take — and the server prices and bounds
// the binding from those words alone. Lenient like the freshness
// declarations (a declaration is a reading problem, never a
// validity problem), except the egress host reading, which fails
// closed: a token that is not a bare host never becomes one.
import { definitionReading, parseDefinition } from '@/AIP/harness/harnessDefinition';

const body = (conditions: string) =>
  `# 成果物\n計算の結果\n\n# 手順\n1. 計算する\n\n# 条件\n${conditions}\n`;

const HOUR = 3_600_000;

describe('the workspace declaration', () => {
  it('a definition that never mentions it has no machine requirement', () => {
    expect(parseDefinition(body('- 鮮度: 1日以内')).machine).toBeNull();
    expect(parseDefinition(body('')).machine).toBeNull();
  });

  it('declares in Japanese, per-run disposal by default', () => {
    const m = parseDefinition(body('- ワークスペース: 必要')).machine;
    expect(m).toEqual({ disposal: 'per-run', egress: [], wallClockMs: null });
  });

  it('declares through the bare keyword form too', () => {
    expect(parseDefinition(body('- ワークスペースが必要')).machine).not.toBeNull();
  });

  it('declares in English', () => {
    expect(parseDefinition(body('- workspace: required')).machine?.disposal).toBe('per-run');
    expect(parseDefinition(body('- machine: needed')).machine).not.toBeNull();
  });

  it('only the explicit standing words relax disposal', () => {
    expect(parseDefinition(body('- ワークスペース: 常駐でも可')).machine?.disposal).toBe('any');
    expect(parseDefinition(body('- workspace: standing allowed')).machine?.disposal).toBe('any');
    // A mention of a standing machine in prose does not relax it.
    expect(parseDefinition(body('- ワークスペース: 毎回使い捨て（常駐は不可）')).machine?.disposal).toBe('per-run');
  });

  it('mentions outside the Conditions section do not declare', () => {
    const other = `# 成果物\n結果\n\n# 手順\n1. ワークスペース: 必要なら使う\n`;
    expect(parseDefinition(other).machine).toBeNull();
  });
});

describe('the egress declaration', () => {
  it('an egress bullet alone declares the requirement', () => {
    const m = parseDefinition(body('- 外向き通信: registry.npmjs.org, pypi.org')).machine;
    expect(m?.egress).toEqual(['registry.npmjs.org', 'pypi.org']);
    expect(m?.disposal).toBe('per-run');
  });

  it('declares in English and splits on commas, spaces and 、', () => {
    const m = parseDefinition(body('- egress: registry.npmjs.org、pypi.org files.pythonhosted.org')).machine;
    expect(m?.egress).toEqual(['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org']);
  });

  it('an unrestricted declaration is one explicit star', () => {
    expect(parseDefinition(body('- 外向き通信: *（制限なし）')).machine?.egress).toEqual(['*']);
  });

  it('non-hosts never become hosts: schemes, ports and paths drop the token', () => {
    const m = parseDefinition(body('- egress: https://npmjs.org, registry.npmjs.org:443, example.com/path, ok.example.com, *.cdn.example.com')).machine;
    expect(m?.egress).toEqual(['ok.example.com', '*.cdn.example.com']);
  });
});

describe('the time declaration', () => {
  it('a time bullet alone declares the requirement and bounds the run', () => {
    const m = parseDefinition(body('- ワークスペース時間: 4時間まで')).machine;
    expect(m?.wallClockMs).toBe(4 * HOUR);
  });

  it('declares in English with the shared duration vocabulary', () => {
    expect(parseDefinition(body('- workspace time: 90 minutes')).machine?.wallClockMs).toBe(90 * 60_000);
  });

  it('coexists with the freshness declarations in the same Conditions', () => {
    const p = parseDefinition(body('- 価格の鮮度: 30分まで\n- ワークスペース: 必要\n- 外向き通信: registry.npmjs.org'));
    expect(p.freshness.price).toBe(30 * 60_000);
    expect(p.machine?.egress).toEqual(['registry.npmjs.org']);
  });
});

describe('the read-back', () => {
  it('reports the machine requirement in the reading, with its bounds', () => {
    const p = parseDefinition(body('- ワークスペース: 必要\n- 外向き通信: registry.npmjs.org\n- ワークスペース時間: 2時間まで'));
    const line = definitionReading(p).reads.find((l) => l.startsWith('実行環境'));
    expect(line).toContain('ワークスペースが必要');
    expect(line).toContain('使い捨て');
    expect(line).toContain('registry.npmjs.org');
    expect(line).toContain('時間上限 120 分');
  });

  it('a definition without a machine requirement reads no such line — and misses nothing for it', () => {
    const p = parseDefinition(body('- 鮮度: 1日以内'));
    const reading = definitionReading(p);
    expect(reading.reads.some((l) => l.startsWith('実行環境'))).toBe(false);
    expect(reading.missing.some((l) => l.includes('実行環境'))).toBe(false);
  });
});
