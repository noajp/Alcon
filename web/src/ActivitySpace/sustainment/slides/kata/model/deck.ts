import { getLang, textLang, type Lang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { switchLayout } from "./layouts";
import { rolesFor } from "./storyline";
import type { Deck, LayoutId, Slide } from "./types";

export function effectiveRoles(deck: Deck): string[] {
  const hasCover = deck.slides[0]?.layout === "cover";
  const auto = rolesFor(deck.storyline, deck.slides.length, hasCover);
  return deck.slides.map((s, i) => s.role ?? auto[i] ?? "");
}

export function moveSlide(deck: Deck, from: number, to: number): Deck {
  if (from === to || from < 0 || to < 0 || from >= deck.slides.length || to >= deck.slides.length) return deck;
  const slides = deck.slides.slice();
  const [s] = slides.splice(from, 1);
  slides.splice(to, 0, s);
  return { ...deck, slides };
}

export function deleteSlide(deck: Deck, index: number): Deck {
  if (deck.slides.length <= 1) return deck;
  return { ...deck, slides: deck.slides.filter((_, i) => i !== index) };
}

export function insertSlide(deck: Deck, after: number, slide: Slide): Deck {
  const slides = deck.slides.slice();
  slides.splice(Math.min(after + 1, slides.length), 0, slide);
  return { ...deck, slides };
}

export function updateSlide(deck: Deck, id: string, patch: (s: Slide) => Slide): Deck {
  return { ...deck, slides: deck.slides.map((s) => (s.id === id ? patch(s) : s)) };
}

export function setLayout(deck: Deck, id: string, layout: LayoutId): Deck {
  return updateSlide(deck, id, (s) => switchLayout(s, layout));
}

export function setRole(deck: Deck, id: string, role: string | undefined): Deck {
  return updateSlide(deck, id, (s) => ({ ...s, role }));
}

type PathKey = string | number;

function setIn<T>(obj: T, path: PathKey[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const src = (obj ?? (typeof k === "number" ? [] : {})) as Record<PathKey, unknown>;
  const copy = (Array.isArray(src) ? src.slice() : { ...src }) as Record<PathKey, unknown>;
  copy[k] = setIn(src[k], rest, value);
  return copy as T;
}

/** スライドの中の1か所を書き換える。path は ["title"] や ["content","compare","rows",0,"cells",1] */
export function setSlidePath(slide: Slide, path: PathKey[], value: unknown): Slide {
  return setIn(slide, path, value);
}

/** サマリーの要点が指すページ番号。ref のページが今どこにあるかで出す（消えたページなら空）。ref が無ければ書かれた page のまま */
export function summaryPage(p: { page: string; ref?: string }, slides: Slide[] | undefined): string {
  if (!p.ref || !slides) return p.page;
  const i = slides.findIndex((s) => s.id === p.ref);
  return i >= 0 ? `p.${i + 1}` : "";
}

/** ページの id を付け直したとき（複製など）、サマリー・目次が指す先も付け直す */
export function remapRefs(slides: Slide[], map: Map<string, string>): Slide[] {
  const fix = <T extends { ref?: string }>(x: T): T => (x.ref && map.has(x.ref) ? { ...x, ref: map.get(x.ref)! } : x);
  return slides.map((s) => {
    const c = s.content;
    if (!c.summary && !c.agenda) return s;
    return {
      ...s,
      content: {
        ...c,
        ...(c.summary ? { summary: { points: c.summary.points.map(fix) } } : {}),
        ...(c.agenda ? { agenda: { ...c.agenda, items: c.agenda.items.map(fix) } } : {}),
      },
    };
  });
}

/** 消えたページを指す ref は外す（数え違いのページ番号を出さない） */
export function pruneRefs(slides: Slide[]): Slide[] {
  const ids = new Set(slides.map((s) => s.id));
  const fix = <T extends { ref?: string; page: string }>(x: T): T => (x.ref && !ids.has(x.ref) ? { ...x, ref: undefined, page: "" } : x);
  return slides.map((s) => {
    const c = s.content;
    if (!c.summary && !c.agenda) return s;
    return { ...s, content: { ...c, ...(c.summary ? { summary: { points: c.summary.points.map(fix) } } : {}), ...(c.agenda ? { agenda: { ...c.agenda, items: c.agenda.items.map(fix) } } : {}) } };
  });
}

/** 資料の言語。タイトルと各ページのタイトルにかな・漢字があれば日本語。文字が無ければ画面の言語 */
export function deckLang(deck: Deck): Lang {
  const text = [deck.title, ...deck.slides.map((s) => s.title)].join(" ");
  return /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(text) ? textLang(text) : getLang();
}
