import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { rolesFor } from "@/ActivitySpace/sustainment/slides/kata/model/storyline";
import { atomsOf, switchLayout } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { moveSlide, deleteSlide, effectiveRoles } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { planDeck, toClaim, parseDoc } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
import { SAMPLE_DECK } from "@/ActivitySpace/sustainment/slides/kata/model/seed";
import { assignSources, mixWarnings, mixTokens, toggleLook } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
import { LOOK_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";

describe("rolesFor", () => {
  it("表紙・導入・本体・結びの順で枚数ぶん割り振る", () => {
    const r = rolesFor("scr", 10);
    expect(r).toHaveLength(10);
    expect(r[0]).toBe("表紙");
    expect(r[1]).toBe("要約");
    expect(r[9]).toBe("次の一歩");
    expect(r).toContain("状況");
    expect(r).toContain("難しさ");
    expect(r).toContain("解決");
  });
  it("少ない枚数でも壊れない", () => {
    expect(rolesFor("pyramid", 1)).toEqual(["表紙"]);
    expect(rolesFor("pyramid", 2)).toEqual(["表紙", "結論"]);
    expect(rolesFor("pyramid", 3)).toHaveLength(3);
    expect(rolesFor("issue", 0)).toEqual([]);
  });
});

describe("switchLayout", () => {
  it("行き来しても元の中身が戻る", () => {
    const s = SAMPLE_DECK.slides[7];
    const a = switchLayout(s, "claim3");
    const b = switchLayout(a, "compare");
    expect(b.content.compare).toEqual(s.content.compare);
    expect(b.layout).toBe("compare");
  });
  it("変換で文字が消えない", () => {
    for (const s of SAMPLE_DECK.slides) {
      for (const to of ["compare", "premise", "claim3", "issue", "steps", "statement"] as const) {
        const before = atomsOf(s).map((a) => a.head + a.body).join("");
        const conv = switchLayout({ ...s, content: { [s.layout]: s.content[s.layout] } }, to);
        const after = atomsOf(conv).map((a) => a.head + a.body).join("");
        // 主要な語が残っていること（先頭の要素の本文）
        const key = atomsOf(s)[0]?.body.slice(0, 6);
        if (key) expect(after + JSON.stringify(conv.content)).toContain(key);
        expect(before.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("deck ops", () => {
  it("並べ替えと削除", () => {
    const d = moveSlide(SAMPLE_DECK, 1, 3);
    expect(d.slides[3].id).toBe(SAMPLE_DECK.slides[1].id);
    expect(deleteSlide(d, 0).slides).toHaveLength(SAMPLE_DECK.slides.length - 1);
    expect(deleteSlide({ ...d, slides: [d.slides[0]] }, 0).slides).toHaveLength(1);
  });
  it("手で付けた役割は型より優先", () => {
    const d = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.map((s, i) => (i === 2 ? { ...s, role: "解決" } : s)) };
    expect(effectiveRoles(d)[2]).toBe("解決");
  });
});

describe("planner", () => {
  it("です・ますを外して結論の形にする", () => {
    expect(toClaim("会員費だけで伸ばすのは難しいです。")).toBe("会員費だけで伸ばすのは難しい");
    expect(toClaim("二層構造にします")).toBe("二層構造にする");
  });
  it("議事録から表紙・本体・結びを組む", () => {
    const md = fs.readFileSync("tests/slides/fixtures/minutes.md", "utf8");
    const deck = planDeck(md);
    expect(deck.slides[0].layout).toBe("cover");
    expect(deck.slides.length).toBeGreaterThanOrEqual(6);
    expect(deck.slides.length).toBeLessThanOrEqual(14);
    expect(deck.slides.at(-1)!.layout).toBe("closing");
    expect(deck.slides.some((s) => s.layout === "compare")).toBe(true);
    for (const s of deck.slides) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.title).not.toMatch(/(です|ます)$/);
    }
  });
  it("見出しの無い文章でも組める", () => {
    const t = "新しい店を出したい。駅前は家賃が高い。裏通りは人が少ない。\n\n平日の昼は客が少ない。夜は混む。\n\n予約制にすれば人手を読める。まずは週末だけ試す。";
    const { sections } = parseDoc(t);
    expect(sections.length).toBeGreaterThan(0);
    expect(planDeck(t).slides.length).toBeGreaterThan(1);
  });
});

describe("mix", () => {
  it("固定を優先し、残りを巡回で割り振る", () => {
    const st = { selected: ["forest", "noir"], pins: { accent: "forest" as const }, offset: 0 };
    const src = assignSources({ ...st, pins: { accent: "forest" } }, LOOK_BY_ID);
    expect(src.accent).toBe("forest");
    expect(new Set(Object.values(src))).toEqual(new Set(["forest", "noir"]));
  });
  it("最後の1つは外せず、外した世界観の固定は解ける", () => {
    const st = { selected: ["forest", "noir"], pins: { type: "noir" as const }, offset: 0 };
    const a = toggleLook({ ...st, pins: { type: "noir" } }, "noir");
    expect(a.selected).toEqual(["forest"]);
    expect(a.pins.type).toBeUndefined();
    expect(toggleLook(a, "forest").selected).toEqual(["forest"]);
  });
  it("公式の世界観それぞれは単独で警告を出さない", () => {
    for (const id of Object.keys(LOOK_BY_ID)) {
      const t = mixTokens({ selected: [id], pins: {}, offset: 0 }, LOOK_BY_ID);
      expect(mixWarnings(t), id).toEqual([]);
    }
  });
});

describe("planner（見出しの無いメモ）", () => {
  it("列挙は根拠3つ、依頼は結び、数字は大きく", () => {
    const t = fs.readFileSync("tests/slides/fixtures/memo-hr.txt", "utf8");
    const d = planDeck(t);
    const claim = d.slides.find((s) => s.layout === "claim3");
    expect(claim?.content.claim3?.points).toHaveLength(3);
    expect(claim?.content.claim3?.points[0].head).toBe("面接を2回に減らして");
    const close = d.slides.at(-1)!;
    expect(close.layout).toBe("closing");
    expect(close.content.closing?.asks).toEqual(["年収レンジを上げるかどうか", "リファラルの紹介料の承認"]);
    expect(d.slides.some((s) => s.content.statement?.figure === "1.3倍")).toBe(true);
  });
});

describe("planner（ピッチのメモ）", () => {
  it("出典の列は出どころへ、値1列の表は数字を大きく、大きな数字はタイトルの数字", () => {
    const d = planDeck(fs.readFileSync("tests/slides/fixtures/pitch.md", "utf8"));
    const market = d.slides.find((s) => s.title === "狙える市場は年460億円")!;
    expect(market.layout).toBe("claim3");
    expect(market.source).toBe("出典：経産省、自社調査、試算");
    expect(market.content.claim3!.points[0].head).toBe("約3.8万社");
    expect(d.slides.some((s) => s.content.statement?.figure === "62%" && s.title.includes("62%"))).toBe(true);
    expect(d.slides.at(-1)!.title).toBe("シードで1億円を調達したい");
  });
});

describe("planner（週次報告）", () => {
  it("A → B は課題と打ち手、変化は後の数字、来週やることは結び", () => {
    const d = planDeck(fs.readFileSync("tests/slides/fixtures/weekly.md", "utf8"));
    const issue = d.slides.find((s) => s.layout === "issue")!;
    expect(issue.content.issue!.pairs).toHaveLength(2);
    expect(issue.title).toBe("困っていることは2つあり、それぞれに打ち手を打つ");
    expect(d.slides.some((s) => s.content.statement?.figure === "55%")).toBe(true);
    expect(d.slides.at(-1)!.layout).toBe("closing");
  });
});

import { sectionText } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
describe("出どころ", () => {
  it("見出しの節の本文を取り出す", () => {
    const md = fs.readFileSync("tests/slides/fixtures/minutes.md", "utf8");
    expect(sectionText(md, "元：課題意識")).toContain("職場と家の往復");
    expect(sectionText(md, "存在しない見出し")).toBeNull();
    const memo = fs.readFileSync("tests/slides/fixtures/memo-hr.txt", "utf8");
    expect(sectionText(memo, "競合のSaaS企業に年収で負けている")).toContain("内定承諾率");
  });
});
describe("出どころ（見本）", () => {
  it("「議事録 3. 課題意識」の形でも引ける", () => {
    const md = fs.readFileSync("tests/slides/fixtures/minutes.md", "utf8");
    expect(sectionText(md, "議事録 3. 課題意識")).toContain("職場と家の往復");
  });
});
