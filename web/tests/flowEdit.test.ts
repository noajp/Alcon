import { describe, expect, it } from 'vitest';

// The canvas's edit model (Sim-incorporation P4, Function/shared/
// flowEdit.ts): edits to a definition's Procedure steps as pure
// functions on the body text. The body stays the single truth, so
// these pin the round trip — an edit touches only the targeted
// block's lines, everything else in the body is byte-for-byte what
// it was, and the projection of the edited body shows exactly the
// edit (the same step order the canvas acted on).
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import {
  deleteFlowStep, editFlowStepLine, flowStepCanMove, flowStepTitles, moveFlowStep,
} from '@/Function/shared/flowEdit';
import { projectDefinitionFlow, type FlowContext } from '@/Function/shared/flowProjection';

const NO_ROW: FlowContext = { trigger: null, objectName: null };
const stepTitles = (body: string) =>
  projectDefinitionFlow(parseDefinition(body), NO_ROW).nodes
    .filter((n) => n.kind === 'step' || n.kind === 'condition').map((n) => n.title);

// The owner's claim-handling flow (design §6), the P3 fixture's body.
const CLAIM = `# 目的
届いたクレームメールを処理し、対応を起票する

# 使うコネクタ
- Gmail

# 進め方
- Gmail で未処理のクレームメールを検索する
- メールを読み、内容を要約して分類する
- 緊急の場合は担当者にすぐ知らせる
- 分類に応じて対象 Object に Element を起票する

# 点検
- 起票先の Object が請求・障害・その他のどれかに合っているか
- 個人情報を転記していないか

# 成果物の型
\`\`\`markdown
# 処理レポート
\`\`\`

# 止める条件
- 対象が特定できないメールは起票せず、人に聞く

# 担当の決め方
- クレームの種別ごとに、対応表の担当者を割り当てる
`;

describe('flowEdit — the steps are the projection’s steps', () => {
  it('lists the step blocks in the projection’s order, condition included', () => {
    expect(flowStepTitles(CLAIM)).toEqual(stepTitles(CLAIM));
    expect(flowStepTitles(CLAIM)).toEqual([
      'Gmail で未処理のクレームメールを検索する',
      'メールを読み、内容を要約して分類する',
      '緊急の場合は担当者にすぐ知らせる',
      '分類に応じて対象 Object に Element を起票する',
    ]);
  });
});

describe('flowEdit — delete', () => {
  it('removes a middle step and nothing else, byte for byte', () => {
    const edited = deleteFlowStep(CLAIM, 1);
    expect(edited).toBe(CLAIM.replace('- メールを読み、内容を要約して分類する\n', ''));
    expect(stepTitles(edited!)).toEqual([
      'Gmail で未処理のクレームメールを検索する',
      '緊急の場合は担当者にすぐ知らせる',
      '分類に応じて対象 Object に Element を起票する',
    ]);
  });

  it('removes a condition step, and the branch goes with it', () => {
    const edited = deleteFlowStep(CLAIM, 2)!;
    const flow = projectDefinitionFlow(parseDefinition(edited), NO_ROW);
    expect(flow.nodes.some((n) => n.kind === 'condition')).toBe(false);
    expect(flow.edges.some((e) => e.kind === 'branch')).toBe(false);
    expect(stepTitles(edited)).toEqual(flowStepTitles(CLAIM).filter((_, i) => i !== 2));
  });

  it('removes the first and the last step, keeping the rest of the body intact', () => {
    expect(deleteFlowStep(CLAIM, 0)).toBe(
      CLAIM.replace('- Gmail で未処理のクレームメールを検索する\n', ''),
    );
    const last = deleteFlowStep(CLAIM, 3)!;
    // The blank lines that follow a block are its padding — they go with it.
    expect(last).toBe(CLAIM.replace('- 分類に応じて対象 Object に Element を起票する\n\n', ''));
    // Everything after the Procedure section is untouched.
    expect(last.slice(last.indexOf('# 点検'))).toBe(CLAIM.slice(CLAIM.indexOf('# 点検')));
  });

  it('removes the block’s detail lines with it, not the neighbour’s', () => {
    const body = `# 進め方
- 検索する
  期間は直近 24 時間に限る
- 要約する
`;
    expect(deleteFlowStep(body, 0)).toBe(`# 進め方
- 要約する
`);
  });

  it('refuses a step that does not exist', () => {
    expect(deleteFlowStep(CLAIM, 4)).toBeNull();
    expect(deleteFlowStep(CLAIM, -1)).toBeNull();
    expect(deleteFlowStep('# 目的\n何かのため\n', 0)).toBeNull();
  });
});

describe('flowEdit — reorder', () => {
  it('swaps two steps, whole blocks, padding travelling with the upper block', () => {
    const body = `# 進め方
- 最初
  補足の一行

- 二番目
- 三番目
`;
    expect(moveFlowStep(body, 0, 1)).toBe(`# 進め方
- 二番目
- 最初
  補足の一行

- 三番目
`);
    expect(moveFlowStep(body, 1, -1)).toBe(moveFlowStep(body, 0, 1));
    expect(stepTitles(moveFlowStep(body, 0, 1)!)).toEqual(['二番目', '最初', '三番目']);
  });

  it('keeps a numbered step’s number on its own line — the text is the truth', () => {
    const body = `# 進め方
1. 集める
2. 配る
`;
    expect(moveFlowStep(body, 0, 1)).toBe(`# 進め方
2. 配る
1. 集める
`);
  });

  it('moves a condition step like any step', () => {
    const edited = moveFlowStep(CLAIM, 2, 1)!;
    expect(stepTitles(edited)).toEqual([
      'Gmail で未処理のクレームメールを検索する',
      'メールを読み、内容を要約して分類する',
      '分類に応じて対象 Object に Element を起票する',
      '緊急の場合は担当者にすぐ知らせる',
    ]);
  });

  it('refuses the ends of the list', () => {
    expect(flowStepCanMove(CLAIM, 0, -1)).toBe(false);
    expect(flowStepCanMove(CLAIM, 3, 1)).toBe(false);
    expect(moveFlowStep(CLAIM, 0, -1)).toBeNull();
    expect(moveFlowStep(CLAIM, 3, 1)).toBeNull();
    expect(flowStepCanMove(CLAIM, 1, 1)).toBe(true);
  });

  it('never moves a step across a section boundary', () => {
    const body = `# 進め方
- 前半の手順

# 進め方
- 後半の手順
`;
    expect(flowStepTitles(body)).toEqual(['前半の手順', '後半の手順']);
    expect(flowStepCanMove(body, 0, 1)).toBe(false);
    expect(moveFlowStep(body, 0, 1)).toBeNull();
    expect(moveFlowStep(body, 1, -1)).toBeNull();
    // Deleting in the second region still works — regions only fence moves.
    expect(deleteFlowStep(body, 1)).toBe(`# 進め方
- 前半の手順

# 進め方
`);
  });
});

describe('flowEdit — line edit (D3)', () => {
  it('rewrites only the step’s own line, keeping its bullet marker', () => {
    const edited = editFlowStepLine(CLAIM, 0, 'Gmail で未処理のクレームメールを label:claim で検索する');
    expect(edited).toBe(CLAIM.replace(
      '- Gmail で未処理のクレームメールを検索する',
      '- Gmail で未処理のクレームメールを label:claim で検索する',
    ));
    expect(stepTitles(edited!)[0]).toBe('Gmail で未処理のクレームメールを label:claim で検索する');
  });

  it('keeps indentation and numbered markers exactly as written', () => {
    const body = `# 進め方
  - 字下げされた手順
1. 番号つき
`;
    expect(editFlowStepLine(body, 0, '書き直した手順')).toContain('  - 書き直した手順');
    expect(editFlowStepLine(body, 1, '書き直した手順')).toContain('1. 書き直した手順');
  });

  it('leaves the block’s detail lines alone', () => {
    const body = `# 進め方
- 検索する
  期間は直近 24 時間に限る
`;
    expect(editFlowStepLine(body, 0, '丁寧に検索する')).toBe(`# 進め方
- 丁寧に検索する
  期間は直近 24 時間に限る
`);
  });

  it('a condition edited out of its conditional words stops branching', () => {
    const edited = editFlowStepLine(CLAIM, 2, '担当者に知らせる')!;
    const flow = projectDefinitionFlow(parseDefinition(edited), NO_ROW);
    expect(flow.nodes.filter((n) => n.kind === 'step' || n.kind === 'condition').map((n) => n.kind))
      .toEqual(['step', 'step', 'step', 'step']);
    const kept = editFlowStepLine(CLAIM, 2, '特に緊急の場合は管理者にも知らせる')!;
    expect(projectDefinitionFlow(parseDefinition(kept), NO_ROW).nodes
      .some((n) => n.kind === 'condition' && n.title.includes('管理者'))).toBe(true);
  });

  it('refuses an empty, whitespace-only or multi-line replacement', () => {
    expect(editFlowStepLine(CLAIM, 0, '')).toBeNull();
    expect(editFlowStepLine(CLAIM, 0, '   ')).toBeNull();
    expect(editFlowStepLine(CLAIM, 0, '一行目\n二行目')).toBeNull();
    expect(editFlowStepLine(CLAIM, 9, '何か')).toBeNull();
  });

  it('edits a plain line in a bullet-less procedure, as one step per line', () => {
    const body = `# 進め方
メールを検索する
読んで分類する
`;
    expect(flowStepTitles(body)).toEqual(['メールを検索する', '読んで分類する']);
    expect(editFlowStepLine(body, 1, '読んで、分類して、起票する')).toBe(`# 進め方
メールを検索する
読んで、分類して、起票する
`);
    expect(deleteFlowStep(body, 0)).toBe(`# 進め方
読んで分類する
`);
  });
});

describe('flowEdit — the shared reading', () => {
  it('an author’s own heading inside the Procedure is part of the step before it', () => {
    const body = `# 進め方
- 手順その一
# メモ
補足のテキスト
- 手順その二
`;
    expect(flowStepTitles(body)).toEqual(['手順その一', '手順その二']);
    expect(deleteFlowStep(body, 0)).toBe(`# 進め方
- 手順その二
`);
  });

  it('a heading inside a fenced block does not open a new section', () => {
    const body = `# 進め方
- 様式を確認する
\`\`\`
# 進め方
- これは例示であって手順ではない、という読みはしない
\`\`\`
- 本当の次の手順
`;
    // The one reading, shared with the projection: the fenced lines
    // are section text, so the example's bullet is a step in both.
    expect(flowStepTitles(body)).toEqual(stepTitles(body));
    expect(flowStepTitles(body)).toContain('本当の次の手順');
  });

  it('the projection after an edit is the edit, re-derived — no drift', () => {
    const edited = moveFlowStep(deleteFlowStep(CLAIM, 2)!, 0, 1)!;
    expect(stepTitles(edited)).toEqual(flowStepTitles(edited));
    expect(stepTitles(edited)).toEqual([
      'メールを読み、内容を要約して分類する',
      'Gmail で未処理のクレームメールを検索する',
      '分類に応じて対象 Object に Element を起票する',
    ]);
  });
});
