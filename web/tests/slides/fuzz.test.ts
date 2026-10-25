import { describe, expect, it } from "vitest";
import { planDeck } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
import { respondLocally } from "@/ActivitySpace/sustainment/slides/kata/model/chat";
import { switchLayout, LAYOUTS } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { reviewDeck } from "@/ActivitySpace/sustainment/slides/kata/model/review";
import { effectiveRoles } from "@/ActivitySpace/sustainment/slides/kata/model/deck";

// 決まった乱数で、いろいろな形の文章とチャットを流し、落ちないこと・形が崩れないことを確かめる
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}
const PIECES = ["## 課題", "## 次のアクション", "### 小見出し", "- 売上が10%伸びている", "- A → B", "- 現状3日 → 目標1日", "1. 準備する", "2. 試す", "3. 広げる", "| 指標 | 数字 |", "|---|---|", "| 市場 | 年100億円 |", "決めてほしいのは、予算と時期。", "1つ目は速さ、2つ目は安さ、3つ目は質。", "", "ただの文章が続く。", "- 目的：検証する", "  - 入れ子の項目：中身", "# タイトル"];
const CMDS = ["赤入れして", "このページを比較にして", "3枚にまとめて", "結論から先に並べ直して", "最後に価格を1枚足して", "このページは消して", "用語をそろえて", "このページを2×2にして", "論点を「やるか、やらないか」に置き直して", "？？？"];

describe("fuzz", () => {
  it("500通りの文章と操作で落ちず、デッキの形が保たれる", () => {
    const r = rng(42);
    for (let n = 0; n < 500; n++) {
      const lines = Array.from({ length: 2 + Math.floor(r() * 18) }, () => PIECES[Math.floor(r() * PIECES.length)]);
      let deck = planDeck(lines.join("\n"));
      expect(deck.slides.length).toBeGreaterThan(0);
      let cur = 0;
      for (let k = 0; k < 4; k++) {
        const res = respondLocally(deck, cur, CMDS[Math.floor(r() * CMDS.length)]);
        if (res.deck) deck = res.deck;
        if (typeof res.current === "number") cur = res.current;
        cur = Math.max(0, Math.min(cur, deck.slides.length - 1));
      }
      const s = deck.slides[Math.floor(r() * deck.slides.length)];
      const to = LAYOUTS[Math.floor(r() * LAYOUTS.length)].id;
      const conv = switchLayout(s, to);
      expect(conv.content[to]).toBeDefined();
      expect(effectiveRoles(deck)).toHaveLength(deck.slides.length);
      expect(() => reviewDeck(deck)).not.toThrow();
      for (const sl of deck.slides) {
        expect(sl.content[sl.layout], `${sl.layout} ${JSON.stringify(sl).slice(0, 80)}`).toBeDefined();
        expect(new Set(deck.slides.map((x) => x.id)).size).toBe(deck.slides.length);
      }
    }
  });
});
