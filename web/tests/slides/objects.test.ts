import { describe, expect, it } from "vitest";
import fs from "node:fs";
import JSZip from "jszip";
import { exportPptx } from "@/ActivitySpace/sustainment/slides/kata/export/pptx";
import { mixTokens } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
import { LOOK_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";
import { effectiveRoles } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import {
  addObject,
  cssColor,
  duplicateObject,
  hexColor,
  makeObject,
  moveBy,
  normalizeObject,
  removeObject,
  reorderObject,
  resizeBy,
  setTextStyle,
  snapMove,
  textStyleCss,
} from "@/ActivitySpace/sustainment/slides/kata/model/objects";
import type { Deck, Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";

const base: Slide = { id: "s1", title: "主張", layout: "statement", content: { statement: { lead: "a", figure: "1" } } };

describe("自由に置くもの", () => {
  it("置く・複製する・消す・重なりの順を変える", () => {
    const a = makeObject("rect");
    const b = makeObject("ellipse");
    let s = addObject(addObject(base, a), b);
    const d = duplicateObject(s, a.id);
    expect(d.id).not.toBe(a.id);
    s = d.slide;
    expect(s.objects!.length).toBe(3);
    expect(s.objects![2]).toMatchObject({ x: a.x + 24, y: a.y + 24, kind: "rect" });
    s = reorderObject(s, b.id, "back");
    expect(s.objects![0]).toMatchObject({ id: b.id, behind: true });
    s = reorderObject(s, b.id, "front");
    expect(s.objects!.at(-1)).toMatchObject({ id: b.id, behind: false });
    s = removeObject(s, a.id);
    expect(s.objects!.map((o) => o.id)).not.toContain(a.id);
  });

  it("大きさを変える：左上の取っ手は右下を固定し、小さくしすぎない。Shift で縦横比を保つ", () => {
    const o = { ...makeObject("rect"), x: 100, y: 100, w: 200, h: 100 };
    expect(resizeBy(o, "nw", 50, 20)).toMatchObject({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeBy(o, "e", -500, 0).w).toBe(8);
    const k = resizeBy(o, "se", 100, 0, true);
    expect(k.w / k.h).toBeCloseTo(2, 1);
  });

  it("線の端を動かし、Shift で45度に揃える", () => {
    const l = { ...makeObject("line"), x: 0, y: 0, w: 100, h: 0 };
    expect(resizeBy(l, "start", 10, 10)).toMatchObject({ x: 10, y: 10, w: 90, h: -10 });
    const snapped = resizeBy(l, "end", 0, 95, true);
    expect(Math.abs(snapped.w)).toBe(Math.abs(snapped.h));
  });

  it("動かすと中心や余白の線、ほかの置きものの端に吸い付く", () => {
    const o = { ...makeObject("rect"), x: 0, y: 0, w: 100, h: 100 };
    const near = moveBy(o, 588, 3); // 中心 638 は スライドの中心 640 の近く
    const r = snapMove(near, []);
    expect(r.o.x + r.o.w / 2).toBe(640);
    expect(r.guides.x).toBe(640);
    const other = { ...makeObject("rect"), x: 400, y: 300, w: 50, h: 50 };
    const r2 = snapMove({ ...o, x: 403, y: 500 }, [other]);
    expect(r2.o.x).toBe(400);
  });

  it("色は世界観の名前で持ち、画面では CSS 変数、書き出しでは今の世界観の色になる", () => {
    const t = LOOK_BY_ID.forest.tokens;
    expect(cssColor("accent")).toBe("var(--s-accent)");
    expect(cssColor("onAccent")).toBe("var(--s-on-accent)");
    expect(cssColor("none")).toBeUndefined();
    expect(hexColor("accent", t)).toBe(t.accent.accent);
    expect(hexColor("#123456", t)).toBe("#123456");
    expect(textStyleCss({ font: "serif", size: 40, bold: true, color: "block", align: "center" })).toMatchObject({ fontSize: 40, fontWeight: 700, color: "var(--s-block)", textAlign: "center" });
  });

  it("型の文字の見た目を上書きし、空になったら消す", () => {
    let s = setTextStyle(base, "title", { size: 48 });
    s = setTextStyle(s, "title", { bold: true });
    expect(s.styles!.title).toEqual({ size: 48, bold: true });
    s = setTextStyle(s, "title", { size: undefined, bold: undefined });
    expect(s.styles).toBeUndefined();
    s = setTextStyle(setTextStyle(base, "title", { italic: true }), "title", null);
    expect(s.styles).toBeUndefined();
  });

  it("壊れた置きものは直すか捨てる", () => {
    expect(normalizeObject({ kind: "star" as never })).toBeNull();
    const o = normalizeObject({ kind: "rect", x: Number.NaN, w: -5 } as never)!;
    expect(o.x).toBe(makeObject("rect").x);
    expect(o.w).toBe(4);
  });

  it("置いたもの・文字の上書きも PowerPoint に出る", async () => {
    const slide: Slide = {
      ...base,
      styles: { title: { size: 50, italic: true, color: "accent" } },
      objects: [
        { ...makeObject("rect"), text: "四角の中" },
        { ...makeObject("text"), text: "自由な文字", textStyle: { size: 30, font: "serif" } },
        { ...makeObject("arrow"), w: -200, h: 80 },
        { ...makeObject("ellipse"), behind: true, stroke: "ink", dash: true },
      ],
    };
    const deck: Deck = { title: "o", storyline: "scr", slides: [slide] };
    const dir = fs.mkdtempSync("/tmp/kata-obj-");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await exportPptx(deck, mixTokens({ selected: ["forest"], pins: {}, offset: 0 }, LOOK_BY_ID), effectiveRoles(deck), "obj");
      const zip = await JSZip.loadAsync(fs.readFileSync(`${dir}/obj.pptx`));
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      expect(xml).toContain("四角の中");
      expect(xml).toContain("自由な文字");
      expect(xml).toContain('type="triangle"');
      expect(xml).toContain('flipH="1"');
      expect(xml).toContain('prstDash val="dash"');
      // 上書きした大きさ（50px → 37.5pt、縮めても 22.5pt 以上）と斜体がタイトルに効いている
      expect(xml).toMatch(/i="1"[^>]*>|<a:rPr[^>]*i="1"/);
      // 後ろに回した丸は、型の文字（主張）より先に描かれる
      expect(xml.indexOf('prst="ellipse"')).toBeLessThan(xml.indexOf("主張"));
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});

import { changeItems } from "@/ActivitySpace/sustainment/slides/kata/model/items";
describe("項目を減らすと、その項目の文字の上書きも消える", () => {
  it("claim3 の最後の点の見た目は残らない", () => {
    const s: Slide = {
      id: "c",
      title: "t",
      layout: "claim3",
      content: { claim3: { points: [{ head: "a", body: "" }, { head: "b", body: "" }, { head: "c", body: "" }] } },
      styles: { "content.claim3.points.2.head": { size: 40 }, "content.claim3.points.0.head": { bold: true }, title: { italic: true } },
    };
    const r = changeItems(s, "item", -1);
    expect(Object.keys(r.styles!).sort()).toEqual(["content.claim3.points.0.head", "title"]);
  });
});
