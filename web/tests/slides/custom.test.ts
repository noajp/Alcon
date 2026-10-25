import { describe, expect, it } from "vitest";
import { paletteFromPixels, deriveTokens } from "@/ActivitySpace/sustainment/slides/kata/theme/custom";
import { contrast, mixWarnings } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";

type RGB = [number, number, number];
const fill = (c: RGB, n: number): RGB[] => Array.from({ length: n }, () => c);

describe("paletteFromPixels", () => {
  it("白地・黒文字・ライムの画像から、ライムを強調に選ぶ", () => {
    const px = [...fill([246, 246, 242], 7000), ...fill([17, 17, 17], 1800), ...fill([212, 242, 58], 900), ...fill([120, 120, 120], 300)];
    const t = paletteFromPixels(px);
    expect(t.ground.bg).toBe("#F6F6F2");
    expect(t.ground.ink).toBe("#111111");
    expect(t.accent.accent).toBe("#D4F23A");
    expect(t.ground.dark).toBe(false);
    expect(mixWarnings(t)).toEqual([]);
  });
  it("暗い地でも文字が読める", () => {
    const px = [...fill([15, 61, 42], 8000), ...fill([201, 242, 75], 1200), ...fill([40, 90, 70], 800)];
    const t = paletteFromPixels(px);
    expect(t.ground.dark).toBe(true);
    expect(contrast(t.ground.ink, t.ground.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.number.num, t.number.block)).toBeGreaterThanOrEqual(3);
  });
  it("地と文字を変えると補助色も追随する", () => {
    const t = paletteFromPixels(fill([255, 255, 255], 100));
    const d = deriveTokens({ ...t, ground: { ...t.ground, bg: "#000000", ink: "#FFFFFF" } });
    expect(d.ground.dark).toBe(true);
    expect(d.ground.sub).not.toBe(t.ground.sub);
  });
});
