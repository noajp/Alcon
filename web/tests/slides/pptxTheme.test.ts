import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseThemeXml, themeFromPptx, tokensFromTheme } from "@/ActivitySpace/artifacts/slides/kata/theme/pptxTheme";
import { mixWarnings } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";

const XML = `<a:theme name="社内テンプレ"><a:themeElements><a:clrScheme name="x"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E3A5F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="D9481E"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Yu Mincho"/><a:ea typeface=""/><a:font script="Jpan" typeface="游明朝"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`;

describe("pptx theme", () => {
  it("色と書体を読む", () => {
    const th = parseThemeXml(XML);
    expect(th.name).toBe("社内テンプレ");
    expect(th.colors.dk2).toBe("#1E3A5F");
    expect(th.colors.accent1).toBe("#D9481E");
    expect(th.majorFont).toBe("游明朝");
    const t = tokensFromTheme(th);
    expect(t.ground.bg).toBe("#FFFFFF");
    expect(t.accent.accent).toBe("#D9481E");
    expect(t.number.block).toBe("#1E3A5F");
    expect(t.type.display).toContain("serif");
    expect(mixWarnings(t)).toEqual([]);
  });
  const real = "/Users/nakanotakanori/Dev/jinba-consulting-pptx-skill-main/assets/SuperTemplate_62type.pptx";
  it.skipIf(!fs.existsSync(real))("実物の .pptx からも読める", async () => {
    const th = await themeFromPptx(fs.readFileSync(real));
    expect(th).not.toBeNull();
    expect(th!.colors.accent1).toBe("#4472C4");
    expect(mixWarnings(tokensFromTheme(th!))).toEqual([]);
  });
});
