"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { LookTokens, Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tokensToCss } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
import { Ed, SlideEditContext, type EditFn } from "./Editable";
import { Body } from "./layouts";
import { ObjectsLayer } from "./Objects";
import { getLang, tx, roleLabel, textLang, type Lang } from "@/ActivitySpace/sustainment/slides/kata/i18n";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

interface Props {
  slide: Slide;
  index: number;
  role?: string;
  tokens: LookTokens;
  editable?: boolean;
  onEdit?: EditFn;
  onFocusText?: (key: string, size: number) => void;
  /** 資料の言語（無ければこのページの文字から決める） */
  lang?: Lang;
}

/** 1280×720 の原寸で描く。拡大縮小は外側の SlideScaler が受け持つ */
export function SlideView({ slide, index, role, tokens, editable = false, onEdit, onFocusText, lang: deckLang }: Props) {
  const vars = tokensToCss(tokens) as CSSProperties;
  const [boxRef, innerRef] = useFit(slide, tokens.type);
  const isCover = slide.layout === "cover";
  const own = slide.title + JSON.stringify(slide.content);
  const lang = deckLang ?? (/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(slide.title) ? textLang(own) : getLang());
  return (
    <SlideEditContext.Provider value={{ editable, onEdit, styles: slide.styles, onFocusText, lang }}>
      <div
        data-editable={editable ? "true" : undefined}
        style={{
          ...vars,
          width: SLIDE_W,
          height: SLIDE_H,
          background: "var(--s-bg)",
          color: "var(--s-ink)",
          fontFamily: "var(--s-body)",
          position: "relative",
          overflow: "hidden",
          wordBreak: "auto-phrase" as never,
          lineBreak: "strict",
          textWrap: "pretty" as never,
        }}
      >
        <ObjectsLayer slide={slide} editable={editable} behind />
        {isCover ? (
          <Body slide={slide} />
        ) : (
          <div style={{ position: "absolute", inset: 0, padding: "56px 80px 44px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-plex-mono), monospace", fontSize: 14, letterSpacing: "0.08em", color: "var(--s-sub)" }}>
              <span style={{ width: 8, height: 8, background: "var(--s-accent)", borderRadius: "var(--s-radius-pill)" }} />
              <span>{String(index + 1).padStart(2, "0")}</span>
              {role ? <span>— {roleLabel(role, lang)}</span> : null}
            </div>
            <Ed
              as="h1"
              value={slide.title}
              path={["title"]}
              multiline
              placeholder={tx("このページで言いたいこと（結論）", "The point of this page (the answer)")}
              style={{
                margin: "18px 0 0",
                fontFamily: "var(--s-display)",
                fontWeight: "var(--s-weight)" as unknown as number,
                letterSpacing: "var(--s-tracking)",
                fontSize: slide.title.length > 40 ? 34 : 38,
                lineHeight: 1.38,
                maxWidth: 1080,
              }}
            />
            <div style={{ width: 56, height: 4, background: "var(--s-accent)", marginTop: 20, borderRadius: "var(--s-radius-pill)" }} />
            <div ref={boxRef} style={{ flexGrow: 1, minHeight: 0, marginTop: 36, display: "flex", overflow: "hidden" }}>
              <div ref={innerRef} style={{ display: "flex", width: "100%" }}>
                <Body slide={slide} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 20, fontSize: 13, color: "var(--s-sub)" }}>
              <span>{slide.source ?? ""}</span>
              <span style={{ fontFamily: "var(--font-plex-mono), monospace", letterSpacing: "0.06em" }}>{String(index + 1).padStart(2, "0")}</span>
            </div>
          </div>
        )}
        <ObjectsLayer slide={slide} editable={editable} />
      </div>
    </SlideEditContext.Provider>
  );
}

/** 本文が枠からはみ出すときだけ、収まるまで少しずつ縮める（最小 0.7 倍） */
function useFit(slide: Slide, t: LookTokens["type"]) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // 本文の高さに効くもの：中身・型・タイトル（折り返すと本文の枠が縮む）・書体
  const key = JSON.stringify(slide.content) + JSON.stringify(slide.styles ?? null) + slide.layout + slide.title + t.display + t.body + t.weight + t.tracking;
  useLayoutEffect(() => {
    const b = box.current;
    const el = inner.current;
    if (!b || !el) return;
    const run = () => {
      if (!b.clientHeight) return;
      let z = 1;
      // zoom をかけた要素の寸法は、かけた後の座標で返るので z を掛けて親と比べる。
      // カードは「子を持つ箱」だけを見る（大きな数字は字面が行の箱から出るが、それははみ出しではない）
      // 縮小表示（サムネイル）でも原寸と同じ判定になるよう、許容量を画面上の倍率に合わせる
      const scale = b.getBoundingClientRect().width / (b.offsetWidth || 1) || 1;
      const tol = 2 * scale;
      const overflowing = () => {
        if (el.scrollHeight * z > b.clientHeight + 1 || el.scrollWidth * z > b.clientWidth + 1) return true;
        // 塗りや枠のある箱（カード）から、中身が縁の外へ出ているか。字面のはみ出しは縁の内側なので数えない
        for (const card of el.querySelectorAll<HTMLElement>("div")) {
          const cs = getComputedStyle(card);
          // design-lint-ignore — compares a computed style with transparent; chooses no color
          if (cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.borderTopWidth === "0px") continue;
          const r = card.getBoundingClientRect();
          // 塗った枠そのもの（表のセル）に文字があふれている
          if (card.scrollHeight > card.clientHeight + 2 && getComputedStyle(card).overflow !== "visible") return true;
          if (card.scrollHeight > card.clientHeight + 2 && card.childElementCount === 0) return true;
          for (const child of card.querySelectorAll<HTMLElement>("*")) {
            const c = child.getBoundingClientRect();
            if (c.bottom > r.bottom + tol || c.right > r.right + tol) return true;
          }
        }
        return false;
      };
      el.style.zoom = "1";
      while (z > 0.7 && overflowing()) {
        z = Math.round((z - 0.05) * 100) / 100;
        el.style.zoom = String(z);
      }
      // 縮めても収まらないときは印を付ける（編集画面では赤い破線で見える）
      if (overflowing()) b.dataset.overflow = "1";
      else delete b.dataset.overflow;
    };
    run();
    // 書体の読み込みが終わると字幅が変わるので、もう一度測る
    let alive = true;
    document.fonts?.ready.then(() => alive && run());
    return () => {
      alive = false;
    };
  }, [key]);
  return [box, inner] as const;
}

/** 原寸のスライドを、与えた幅に合わせて縮める */
export function SlideScaler({ width, children, className, style }: { width: number; children: React.ReactNode; className?: string; style?: CSSProperties }) {
  const scale = width / SLIDE_W;
  return (
    <div className={className} style={{ width, height: SLIDE_H * scale, position: "relative", overflow: "hidden", ...style }}>
      <div style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>{children}</div>
    </div>
  );
}
