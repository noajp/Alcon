import { seedWorkspace } from "@/ActivitySpace/artifacts/slides/kata/model/seed";
import { describe, expect, it } from "vitest";
import { respondLocally } from "@/ActivitySpace/artifacts/slides/kata/model/chat";
import { switchLayout } from "@/ActivitySpace/artifacts/slides/kata/model/layouts";
import { reviewSlide } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { rolesFor } from "@/ActivitySpace/artifacts/slides/kata/model/storyline";
import { SAMPLE_DECK } from "@/ActivitySpace/artifacts/slides/kata/model/seed";
import type { Slide } from "@/ActivitySpace/artifacts/slides/kata/model/types";

describe("レビュー指摘の再発防止", () => {
  it("「この1枚を比較にして」は絞り込みではなく型の変更", () => {
    const r = respondLocally(SAMPLE_DECK, 2, "この1枚を比較にして");
    expect(r.deck!.slides).toHaveLength(SAMPLE_DECK.slides.length);
    expect(r.deck!.slides[2].layout).toBe("compare");
  });
  it("同じ枚数を頼むと、増やせとは言わない", () => {
    expect(respondLocally(SAMPLE_DECK, 0, `${SAMPLE_DECK.slides.length}枚にまとめて`).reply).toContain("ちょうど");
  });
  it("1枚しかないデッキは消せない", () => {
    const one = { ...SAMPLE_DECK, slides: [SAMPLE_DECK.slides[0]] };
    const r = respondLocally(one, 0, "このページを消して");
    expect(r.deck).toBeUndefined();
  });
  it("4つ以上の中身を変換しても削らない", () => {
    const steps = SAMPLE_DECK.slides.find((s) => s.layout === "steps")!;
    expect(steps.content.steps!.steps).toHaveLength(4);
    const a = switchLayout({ ...steps, content: { steps: steps.content.steps } }, "claim3");
    expect(a.content.claim3!.points).toHaveLength(4);
    const b = switchLayout({ ...a, content: { claim3: a.content.claim3 } }, "issue");
    expect(b.content.issue!.pairs).toHaveLength(4);
  });
  it("数の読み取りは数字全体を見る", () => {
    const s: Slide = { id: "x", title: "10の理由で選ばれる", layout: "claim3", content: { claim3: { points: Array.from({ length: 10 }, (_, i) => ({ head: `h${i}`, body: "b" })) } } };
    expect(reviewSlide(s).filter((f) => f.kind === "数")).toEqual([]);
    const p: Slide = { id: "y", title: "2つの前提から、次の一手が決まる", layout: "premise", content: { premise: { premises: ["a", "b"], conclusion: "c", figure: "" } } };
    expect(reviewSlide(p).filter((f) => f.kind === "数")).toEqual([]);
  });
  it("端数は最大剰余で配る", () => {
    const r = rolesFor("scr", 8);
    const count = (x: string) => r.filter((y) => y === x).length;
    expect([count("状況"), count("難しさ"), count("解決")]).toEqual([1, 2, 2]);
  });
});

import { planDeck, pickFigure, extractAsks } from "@/ActivitySpace/artifacts/slides/kata/model/planner";

describe("再レビュー指摘の再発防止", () => {
  it("中身の無い見出しは空のページにしない", () => {
    const d = planDeck("# 計画\n\n## 1. 現状\n\n### 売上\n- 売上は前年から10%伸びている\n- 粗利は横ばいになっている\n\n## 背景\n\n## 次のアクション\n- 予算を決める");
    expect(d.slides.some((s) => s.title === "現状" || s.title === "背景")).toBe(false);
  });
  it("依頼の取り出しで『と』が残らず、挨拶を拾わない", () => {
    expect(extractAsks("決めてほしいのは、予算の上限と、開始時期")).toEqual(["予算の上限", "開始時期"]);
    const d = planDeck("新しい制度を考えた。現場の負担を減らせる。\n\n決めてほしいのは、予算の上限と、開始時期。よろしくお願いします。\n\n試験は来月から始める。");
    const close = d.slides.at(-1)!;
    expect(close.layout).toBe("closing");
    expect(close.title).not.toContain("とと");
    expect(d.slides.some((s) => /よろしく/.test(s.title))).toBe(false);
  });
  it("年や日付を大きな数字にしない", () => {
    expect(pickFigure("2026年4月から新制度を導入し、満足度を20%上げる")).toBe("20%");
    expect(pickFigure("4月1日に始める")).toBe("");
    expect(pickFigure("100点満点で85点")).toBe("85点");
  });
  it("文の途中の『1つ目の案』は列挙と読まない", () => {
    const d = planDeck("比べる案は2つある。案の中身を整理した。\n\n1つ目の案と2つ目の案を比べると、2つ目が安い。だから2つ目を選ぶ。\n\n来週から動く。");
    expect(d.slides.every((s) => !(s.content.claim3?.points ?? []).some((p) => p.head.startsWith("の案")))).toBe(true);
  });
  it("2項目を比較にしても列は2つ", () => {
    const s = { id: "z", title: "t", layout: "premise" as const, content: { premise: { premises: ["a"], conclusion: "b", figure: "c" } } };
    expect(switchLayout(s, "compare").content.compare!.columns).toHaveLength(2);
  });
  it("「今のページは残して6枚に絞って」は絞り込み", () => {
    expect(respondLocally(SAMPLE_DECK, 3, "今のページは残して、6枚に絞って流れを整えて").deck!.slides).toHaveLength(6);
  });
});

import { ISSUES } from "@/ActivitySpace/artifacts/slides/kata/model/chat";
describe("論点の置き方", () => {
  it("論点を選ぶと語る順番が変わる", () => {
    for (const x of ISSUES) {
      const r = respondLocally(SAMPLE_DECK, 3, x.ask);
      expect(r.deck!.storyline).toBe(x.storyline);
      expect(r.reply).toContain(x.label);
    }
  });
});

import { exportPptx } from "@/ActivitySpace/artifacts/slides/kata/export/pptx";
import { mixTokens } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import { LOOK_BY_ID } from "@/ActivitySpace/artifacts/slides/kata/theme/looks";
import { effectiveRoles } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import nodeFs from "node:fs";
describe("2×2", () => {
  it("チャットで2×2にでき、行き来しても元の比較が戻り、書き出せる", async () => {
    const r = respondLocally(SAMPLE_DECK, 4, "このページを2×2にして");
    const s = r.deck!.slides[4];
    expect(s.layout).toBe("matrix");
    expect(s.content.matrix!.cells).toHaveLength(4);
    expect(switchLayout(s, "compare").content.compare).toEqual(SAMPLE_DECK.slides[4].content.compare);
    const dir = nodeFs.mkdtempSync("/tmp/kata-mx-");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await exportPptx(r.deck!, mixTokens({ selected: ["forest"], pins: {}, offset: 0 }, LOOK_BY_ID), effectiveRoles(r.deck!), "mx");
      expect(nodeFs.statSync(`${dir}/mx.pptx`).size).toBeGreaterThan(20000);
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});

describe("第3レビューの再発防止", () => {
  it("2列で値が数字の表も、数字を大きく並べる", () => {
    const d = planDeck("# 計画\n\n## 市場\n| 指標 | 数字 |\n|---|---|\n| 国内 | 3万社 |\n| 単価 | 月3万円 |\n| 市場 | 年100億円 |\n");
    expect(d.slides.some((s) => s.layout === "claim3" && s.content.claim3!.points[0].head === "3万社")).toBe(true);
  });
});

import { normalizeSlide } from "@/ActivitySpace/artifacts/slides/kata/model/layouts";
import { tokensFromTheme } from "@/ActivitySpace/artifacts/slides/kata/theme/pptxTheme";
describe("第4レビューの再発防止", () => {
  it("AI から来た 2×2 は4象限にそろえ、推しを範囲に収める", () => {
    const s = normalizeSlide({ id: "a", title: "t", layout: "matrix", content: { matrix: { x: { low: "", high: "" }, y: { low: "", high: "" }, cells: [{ head: "a", body: "" }, { head: "b", body: "" }], highlight: 7 } } });
    expect(s.content.matrix!.cells).toHaveLength(4);
    expect(s.content.matrix!.highlight).toBe(3);
    const c = normalizeSlide({ id: "b", title: "t", layout: "compare", content: { compare: { columns: ["A", "B"], rows: [{ label: "x", cells: ["1"] }], highlight: -2, takeaways: [] } } });
    expect(c.content.compare!.rows[0].cells).toHaveLength(2);
    expect(c.content.compare!.highlight).toBe(0);
    expect(normalizeSlide({ id: "c", title: "t", layout: "steps", content: {} }).content.steps).toBeDefined();
  });
  it("「3人で回す」のような表は、数字の表とみなさない", () => {
    const d = planDeck("# 計画\n\n## 進め方\n| 段階 | 中身 |\n|---|---|\n| 準備 | 3人で回す |\n| 試験 | 1年続ける |\n| 展開 | 2社に広げる |\n");
    expect(d.slides.some((s) => /^展開は/.test(s.title))).toBe(false);
  });
  it("黄色い強調色には、黒い文字を載せる", () => {
    const t = tokensFromTheme({ name: "x", majorFont: "", colors: { lt1: "#FFFFFF", dk1: "#000000", accent1: "#FFC000" } });
    expect(t.accent.onAccent).toBe("#111111");
  });
});

describe("第5レビューの再発防止", () => {
  it("途中の「導入予定の〜」は締めにしない。締めは最後の節", () => {
    const d = planDeck("# 計画\n\n## 導入予定のシステム\n- 会計システムを刷新する\n- 移行は半年かかる\n\n## 次のアクション\n- 予算を承認してほしい\n");
    expect(d.slides.at(-1)!.layout).toBe("closing");
    expect(d.slides.at(-1)!.content.closing!.asks).toContain("予算を承認してほしい");
  });
  it("数字の推移は課題→打ち手にしない", () => {
    const d = planDeck("# 報告\n\n## KPIの推移\n- CVR 2.1% → 2.8%\n- 解約率 5% → 3%\n- 施策の効果が出ている\n");
    expect(d.slides.some((s) => s.layout === "issue")).toBe(false);
  });
  it("「月額1万円から」は推移ではない", () => {
    expect(pickFigure("月額1万円から始められ、導入社数は20社")).toBe("1万円");
  });
});

import { sectionText as secText } from "@/ActivitySpace/artifacts/slides/kata/model/planner";
describe("第6レビューの再発防止", () => {
  it("締めの見出しの言い換えも締めとみなす", () => {
    for (const h of ["お願い事項", "宿題事項", "アクションアイテム", "今後の進め方について", "次のアクション（担当・期日）", "今後のスケジュール", "今後の対応", "決めてほしいこと"]) {
      const d = planDeck(`# 会議\n\n## 現状\n- 売上が10%落ちている\n- 原因は値上げにある\n\n## ${h}\n- 来週までに価格を見直す\n`);
      expect(d.slides.at(-1)!.layout, h).toBe("closing");
    }
  });
  it("同じ見出しが2回あれば、何番目かで引き分ける", () => {
    const doc = "## 課題\n- 一つ目\n\n## 別\n- x\n\n## 課題\n- 二つ目\n";
    expect(secText(doc, "元：課題", 0)).toContain("一つ目");
    expect(secText(doc, "元：課題", 1)).toContain("二つ目");
    expect(secText(doc, "元：課")).toBeNull();
  });
  it("「現状3日 → 目標1日」は推移", () => {
    const d = planDeck("# 改善\n\n## 目標\n- リードタイム：現状3日 → 目標1日\n- 不良率：現状5% → 目標2%\n- 現場の負担を減らす\n");
    expect(d.slides.some((s) => s.layout === "issue")).toBe(false);
  });
});

import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
describe("取り消しと出どころ", () => {
  it("取り消すと、デッキと一緒に元の文章も戻る", () => {
    // Decks load from the Space in the app; here the seed workspace stands in for one.
    const seed = seedWorkspace(Date.now(), "ja");
    useKata.setState({ folders: seed.folders, files: seed.files, activeFileId: seed.files[0].id, current: 0, history: {} });
    const st = useKata.getState();
    const before = st.files.find((f) => f.id === st.activeFileId)!.deck;
    const seedName = before.sourceDoc?.name;
    expect(seedName).toBeTruthy();
    st.editDeck(() => ({ ...planDeck("# 別\n\n## 節\n- 一文目がここにある\n- 二文目もある\n"), sourceDoc: { name: "B.md", text: "## 節\n- 一文目" } }));
    expect(useKata.getState().files.find((f) => f.id === st.activeFileId)!.deck.sourceDoc?.name).toBe("B.md");
    useKata.getState().undo();
    expect(useKata.getState().files.find((f) => f.id === st.activeFileId)!.deck.sourceDoc?.name).toBe(seedName);
  });
});

describe("PM 指摘の再発防止", () => {
  it("表紙の副題が埋まり、帰結がタイトルを繰り返さない", () => {
    for (const f of ["pitch.md", "weekly.md", "memo-hr.txt"]) {
      const d = planDeck(nodeFs.readFileSync(`tests/slides/fixtures/${f}`, "utf8"));
      expect(d.slides[0].content.cover!.subtitle, f).not.toBe("");
      for (const s of d.slides) if (s.content.premise) expect(s.content.premise.conclusion, f).not.toBe(s.title);
    }
  });
});

import { isNumericHead } from "@/ActivitySpace/artifacts/slides/kata/model/figure";
describe("第8レビューの再発防止", () => {
  it("数字の見出しの判定", () => {
    for (const t of ["約3.8万社", "月120件", "年460億円", "+20%", "▲3%", "62%", "1.3倍"]) expect(isNumericHead(t), t).toBe(true);
    for (const t of ["3つの壁", "2人で", "1日で", "2024年", "恋愛"]) expect(isNumericHead(t), t).toBe(false);
  });
  it("「最後に1枚足して」は結びの手前に入る", () => {
    const r = respondLocally(SAMPLE_DECK, 0, "最後に、価格の比較を1枚足して");
    expect(r.deck!.slides.at(-1)!.layout).toBe("closing");
    expect(r.deck!.slides.at(-2)!.title).toContain("価格の比較");
  });
  it("表紙の副題に、見出しのままの名詞を使わない", () => {
    const d = planDeck(nodeFs.readFileSync("tests/slides/fixtures/weekly.md", "utf8"));
    expect(d.slides[0].content.cover!.subtitle).not.toBe("数字");
  });
});
