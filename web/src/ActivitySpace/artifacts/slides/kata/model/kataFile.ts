import type { Deck, MixState, Slide } from "./types";
import { normalizeSlide, LAYOUT_BY_ID } from "./layouts";
import { normalizeObject } from "./objects";
import { newId } from "./id";

// 資料を1つのファイル（.kata.json）にして渡し合う。開くときは中身を確かめ、壊れた所は直すか捨てる

export interface KataFileJson {
  kata: 1;
  name: string;
  deck: Deck;
  mix?: MixState;
}

export function toKataJson(name: string, deck: Deck, mix?: MixState): string {
  const body: KataFileJson = { kata: 1, name, deck, mix };
  return JSON.stringify(body, null, 2);
}

const STORYLINES = ["scr", "pyramid", "skyrain", "issue", "scqa"];

export function fromKataJson(text: string): { name: string; deck: Deck; mix?: MixState } | null {
  // 大きすぎるファイルは保存先（ブラウザ）に入りきらない
  if (text.length > 8_000_000) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const j = raw as Partial<KataFileJson>;
  const d = j?.deck as Partial<Deck> | undefined;
  if (!j || j.kata !== 1 || !d || !Array.isArray(d.slides)) return null;
  const seen = new Set<string>();
  const slides: Slide[] = d.slides
    .filter((x): x is Slide => !!x && typeof x === "object" && typeof (x as Slide).layout === "string" && (x as Slide).layout in LAYOUT_BY_ID)
    .map((x) => {
      // id が重なっていれば振り直す（ページの参照が混ざらないように）
      const id = typeof x.id === "string" && x.id && !seen.has(x.id) ? x.id : newId("s");
      seen.add(id);
      const objects = Array.isArray(x.objects) ? x.objects.map(normalizeObject).filter((o): o is NonNullable<typeof o> => !!o) : undefined;
      const base = { ...x, id, title: String(x.title ?? ""), content: x.content && typeof x.content === "object" ? x.content : {}, objects, styles: x.styles && typeof x.styles === "object" && !Array.isArray(x.styles) ? x.styles : undefined };
      // 中身が壊れていれば、その型の空の中身にする（ファイル全体は開ける）
      try {
        return normalizeSlide(base);
      } catch {
        return normalizeSlide({ ...base, content: {} });
      }
    });
  if (!slides.length) return null;
  const deck: Deck = {
    title: String(d.title ?? j.name ?? ""),
    storyline: (STORYLINES.includes(String(d.storyline)) ? d.storyline : "scr") as Deck["storyline"],
    mode: d.mode === "read" ? "read" : d.mode === "present" ? "present" : undefined,
    slides,
    sourceDoc: d.sourceDoc && typeof d.sourceDoc.text === "string" ? { name: String(d.sourceDoc.name ?? ""), text: d.sourceDoc.text } : undefined,
  };
  const mix = j.mix && Array.isArray(j.mix.selected) && j.mix.selected.length ? { selected: j.mix.selected.map(String), pins: j.mix.pins && typeof j.mix.pins === "object" && !Array.isArray(j.mix.pins) ? j.mix.pins : {}, offset: Math.max(0, Math.floor(Number(j.mix.offset) || 0)) } : undefined;
  return { name: String(j.name || deck.title || "Imported deck").slice(0, 80), deck, mix };
}
