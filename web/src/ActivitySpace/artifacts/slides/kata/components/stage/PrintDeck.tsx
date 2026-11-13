"use client";

import { useDeckView } from "@/ActivitySpace/artifacts/slides/kata/components/useDeckView";
import { SlideView } from "@/ActivitySpace/artifacts/slides/kata/components/slides/SlideView";
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";

/** 印刷（PDF 書き出し）のときだけ出す、全ページ原寸の並び */
export function PrintDeck() {
  const view = useDeckView();
  const printing = useKata((s) => s.printing);
  if (!view || !printing) return null;
  return (
    <div className="print-deck">
      {/* 用紙を 16:9 にするのは資料を印刷している間だけ（Clayware の他の画面の印刷には効かせない） */}
      <style>{"@page { size: 1280px 720px; margin: 0; }"}</style>
      {view.deck.slides.map((s, i) => (
        <div key={s.id} className="print-slide">
          <SlideView slide={s} index={i} role={view.roles[i]} tokens={view.tokens} lang={view.lang} />
        </div>
      ))}
    </div>
  );
}
