import { describe, expect, it } from "vitest";
import { canChange, changeItems, itemCount } from "@/ActivitySpace/sustainment/slides/kata/model/items";
import { SAMPLE_DECK } from "@/ActivitySpace/sustainment/slides/kata/model/seed";

const cmp = SAMPLE_DECK.slides.find((s) => s.id === "s_r2")!;
const steps = SAMPLE_DECK.slides.find((s) => s.layout === "steps")!;

describe("items", () => {
  it("比較の行と列を足し引きでき、セルの数がそろう", () => {
    const a = changeItems(cmp, "column", 1);
    expect(a.content.compare!.columns).toHaveLength(4);
    expect(a.content.compare!.rows.every((r) => r.cells.length === 4)).toBe(true);
    const b = changeItems(changeItems(a, "column", -1), "column", -1);
    expect(b.content.compare!.columns).toHaveLength(2);
    expect(b.content.compare!.highlight).toBeLessThan(2);
    expect(itemCount(changeItems(cmp, "row", 1), "row")).toBe(5);
  });
  it("上限と下限で止まる", () => {
    let s = steps;
    for (let i = 0; i < 5; i++) s = changeItems(s, "item", 1);
    expect(itemCount(s, "item")).toBe(5);
    expect(canChange(s, "item", 1)).toBe(false);
    for (let i = 0; i < 9; i++) s = changeItems(s, "item", -1);
    expect(itemCount(s, "item")).toBe(2);
  });
});
