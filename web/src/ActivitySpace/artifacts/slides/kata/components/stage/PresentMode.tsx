"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDeckView } from "@/ActivitySpace/artifacts/slides/kata/components/useDeckView";
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { SLIDE_H, SLIDE_W, SlideScaler, SlideView } from "@/ActivitySpace/artifacts/slides/kata/components/slides/SlideView";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

/** 全画面の発表モード。← → で送り、Esc で戻る */
export function PresentMode({ onClose }: { onClose: () => void }) {
  const view = useDeckView();
  const setCurrent = useKata((s) => s.setCurrent);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const close = () => closeRef.current();
    const fit = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener("resize", fit);
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      const s = useKata.getState();
      if (e.key === "Escape") close();
      if (["ArrowRight", " ", "Enter", "PageDown"].includes(e.key)) s.setCurrent(s.current + 1);
      if (["ArrowLeft", "Backspace", "PageUp"].includes(e.key)) s.setCurrent(s.current - 1);
      e.stopPropagation();
    };
    const onFs = () => {
      if (!document.fullscreenElement) close();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  if (!view || !size.w) return null;
  const width = Math.min(size.w, (size.h * SLIDE_W) / SLIDE_H);
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
      onClick={() => setCurrent(view.index + 1)}
      role="dialog"
      aria-label={tx("発表モード", "Presentation")}
    >
      <SlideScaler width={width}>
        <SlideView slide={view.slide} index={view.index} role={view.roles[view.index]} tokens={view.tokens} lang={view.lang} />
      </SlideScaler>
      <div className="pointer-events-none absolute bottom-4 right-5 font-mono text-[11px] text-white/40">
        {view.index + 1} / {view.deck.slides.length} {tx("・ Esc で戻る", "· Esc to exit")}
      </div>
    </div>,
    document.body,
  );
}
