import { describe, expect, it } from 'vitest';

// Structured section editing (Automation builder PR4, design §5.1):
// flowEdit's span discipline generalised beyond the Procedure. Every
// op touches only the section it names — the rest of the body comes
// back byte for byte — because the review diff must mean "what
// changed", and a person's prose in the sections a pick did not name
// is load-bearing.
import { parseDefinition, sectionOf } from '@/AIP/harness/harnessDefinition';
import {
  SECTION_HEADINGS, addSectionBullet, ensureSection, removeSectionBullet,
  replaceOutputFence, replaceSectionBullet, sectionBullets,
} from '@/Function/shared/flowEditSection';

const BODY = `# 目的
届いたクレームメールを処理し、対応を起票する

# 使うコネクタ
- Gmail
- Slack

# 入力
- Gmail: is:unread label:claim -label:processed

# 進め方
- gmail_search で未処理のクレームメールを検索する
- 分類に応じて対象 Object に Element を起票する

# 点検
- 起票先の Object が合っているか
- 個人情報を転記していないか

# 成果物の型
\`\`\`markdown
# 処理レポート
## 起票した Element
\`\`\`

# 止める条件
- 対象が特定できないメールは起票せず、人に聞く
`;

describe('flowEditSection — reading', () => {
  it('lists a section’s bullets in written order, and only that section’s', () => {
    expect(sectionBullets(BODY, 'connectors')).toEqual(['Gmail', 'Slack']);
    expect(sectionBullets(BODY, 'input')).toEqual(['Gmail: is:unread label:claim -label:processed']);
    expect(sectionBullets(BODY, 'checks')).toEqual(['起票先の Object が合っているか', '個人情報を転記していないか']);
    expect(sectionBullets(BODY, 'constraints')).toEqual([]);
    // The output section's fence is not bullets.
    expect(sectionBullets(BODY, 'output')).toEqual([]);
  });

  it('the canonical headings read back to their keys', () => {
    for (const [key, heading] of Object.entries(SECTION_HEADINGS)) {
      expect(sectionOf(heading)).toBe(key);
    }
  });
});

describe('flowEditSection — byte preservation', () => {
  it('replacing an Input row changes exactly that line', () => {
    const edited = replaceSectionBullet(BODY, 'input', 0, 'Gmail: is:unread label:urgent');
    expect(edited).toBe(BODY.replace(
      '- Gmail: is:unread label:claim -label:processed',
      '- Gmail: is:unread label:urgent',
    ));
    expect(parseDefinition(edited!).inputs).toEqual([
      { kind: 'connector', source: 'Gmail', connector: 'Gmail', detail: 'is:unread label:urgent' },
    ]);
  });

  it('removing a connector removes its block and nothing else', () => {
    expect(removeSectionBullet(BODY, 'connectors', 0)).toBe(BODY.replace('- Gmail\n', ''));
    // The last block of a section carries its padding blank line with
    // it — flowEdit's span rule, unchanged here.
    expect(removeSectionBullet(BODY, 'connectors', 1)).toBe(BODY.replace('- Slack\n\n', ''));
  });

  it('adding a bullet lands under the section’s last block, other sections untouched', () => {
    const edited = addSectionBullet(BODY, 'checks', '処理済みの印が付いているか')!;
    expect(edited).toBe(BODY.replace(
      '- 個人情報を転記していないか\n',
      '- 個人情報を転記していないか\n- 処理済みの印が付いているか\n',
    ));
    // Everything from the next section on is byte-for-byte what it was.
    expect(edited.slice(edited.indexOf('# 成果物の型'))).toBe(BODY.slice(BODY.indexOf('# 成果物の型')));
    expect(edited.slice(0, edited.indexOf('# 点検'))).toBe(BODY.slice(0, BODY.indexOf('# 点検')));
  });

  it('a block’s detail lines travel with it and survive a line rewrite', () => {
    const body = `# 制約
- 個人情報は転記しない
  電話番号と住所は特に注意する
- 送信はしない
`;
    expect(replaceSectionBullet(body, 'constraints', 0, '個人情報は一切転記しない')).toBe(`# 制約
- 個人情報は一切転記しない
  電話番号と住所は特に注意する
- 送信はしない
`);
    expect(removeSectionBullet(body, 'constraints', 0)).toBe(`# 制約
- 送信はしない
`);
  });

  it('bullet ops never touch the output fence — not even in its own section', () => {
    expect(addSectionBullet(BODY, 'output', '何か')).toBeNull();
    expect(removeSectionBullet(BODY, 'output', 0)).toBeNull();
    expect(replaceSectionBullet(BODY, 'output', 0, '何か')).toBeNull();
    const edited = removeSectionBullet(BODY, 'checks', 0)!;
    expect(edited).toContain('```markdown\n# 処理レポート\n## 起票した Element\n```');
  });

  it('bullets written inside a fence are not the section’s bullets', () => {
    const body = `# 進め方
- 様式を確認する
\`\`\`
- これは例示
\`\`\`
- 次の手順
`;
    // flowEditSection fences off fenced lines (flowEdit.ts, which
    // owns Procedure editing, keeps the projection's own reading).
    expect(sectionBullets(body, 'procedure')).toEqual(['様式を確認する', '次の手順']);
  });

  it('refuses what does not exist, and empty or multi-line text', () => {
    expect(removeSectionBullet(BODY, 'checks', 2)).toBeNull();
    expect(replaceSectionBullet(BODY, 'checks', 9, '何か')).toBeNull();
    expect(addSectionBullet(BODY, 'checks', '')).toBeNull();
    expect(addSectionBullet(BODY, 'checks', '一行目\n二行目')).toBeNull();
    expect(replaceSectionBullet(BODY, 'checks', 0, '  ')).toBeNull();
  });

  it('keeps a numbered bullet’s marker on a rewrite', () => {
    const body = `# 点検
1. 数が合っているか
2. 印が付いているか
`;
    expect(replaceSectionBullet(body, 'checks', 1, '印が全件に付いているか')).toContain('2. 印が全件に付いているか');
  });
});

describe('flowEditSection — ensureSection', () => {
  it('is a no-op when the section already stands', () => {
    expect(ensureSection(BODY, 'input')).toBe(BODY);
    expect(ensureSection(BODY, 'checks')).toBe(BODY);
  });

  it('inserts a missing section at its canonical place in the grammar’s order', () => {
    // input sits after connectors and before breakdown in the
    // grammar's order; this body has connectors, then procedure —
    // procedure precedes input, breakdown follows it, so the new
    // section lands before the breakdown heading.
    const body = `# 目的
何かのため

# 使うコネクタ
- Gmail

# 分け方
- 種別ごとに分ける
`;
    expect(ensureSection(body, 'input')).toBe(`# 目的
何かのため

# 使うコネクタ
- Gmail

# 入力

# 分け方
- 種別ごとに分ける
`);
  });

  it('appends at the end when no later section stands', () => {
    const body = `# 目的
何かのため
`;
    expect(ensureSection(body, 'input')).toBe(`# 目的
何かのため

# 入力
`);
  });

  it('an add to a missing section creates it where it belongs, then adds', () => {
    const body = `# 目的
何かのため

# 進め方
- 検索する
`;
    const edited = addSectionBullet(body, 'input', 'ファイル: 報告書')!;
    expect(parseDefinition(edited).inputs).toEqual([
      { kind: 'files', source: 'ファイル', connector: null, detail: '報告書' },
    ]);
    expect(edited.indexOf('# 入力')).toBeGreaterThan(edited.indexOf('# 進め方'));
    expect(edited).toContain('# 進め方\n- 検索する\n');
  });
});

describe('flowEditSection — the output fence', () => {
  it('replaces the fenced block as one span, keeping its language', () => {
    const edited = replaceOutputFence(BODY, '# 日次レポート\n## 件数')!;
    expect(edited).toBe(BODY.replace(
      '```markdown\n# 処理レポート\n## 起票した Element\n```',
      '```markdown\n# 日次レポート\n## 件数\n```',
    ));
    expect(parseDefinition(edited).output).toEqual({ format: 'markdown', body: '# 日次レポート\n## 件数' });
  });

  it('bullet edits elsewhere leave the fence byte for byte', () => {
    const edited = addSectionBullet(BODY, 'stop', '費用 $2 まで')!;
    expect(edited.slice(edited.indexOf('# 成果物の型'), edited.indexOf('# 止める条件')))
      .toBe(BODY.slice(BODY.indexOf('# 成果物の型'), BODY.indexOf('# 止める条件')));
  });

  it('a section without a fence gains one after its prose, prose intact', () => {
    const body = `# 成果物の型
レポートの形は下記のとおり
`;
    const edited = replaceOutputFence(body, '# レポート')!;
    expect(edited).toBe(`# 成果物の型
レポートの形は下記のとおり
\`\`\`markdown
# レポート
\`\`\`
`);
    expect(parseDefinition(edited).output?.body).toBe('# レポート');
  });

  it('a body without an output section gains the section and the fence', () => {
    const body = `# 目的
何かのため
`;
    const edited = replaceOutputFence(body, '# レポート')!;
    expect(parseDefinition(edited).output?.body).toBe('# レポート');
    expect(edited.startsWith('# 目的\n何かのため\n')).toBe(true);
  });

  it('refuses content that itself carries a fence line', () => {
    expect(replaceOutputFence(BODY, '```\n壊れる\n```')).toBeNull();
  });
});
