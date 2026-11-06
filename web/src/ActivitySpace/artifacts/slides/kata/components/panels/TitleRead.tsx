"use client";

import { useFocusTrap } from "@/ActivitySpace/artifacts/slides/kata/components/ui/useFocusTrap";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from '@/ui/icons';
import { useDeckView } from "@/ActivitySpace/artifacts/slides/kata/components/useDeckView";
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { STORYLINE_BY_ID } from "@/ActivitySpace/artifacts/slides/kata/model/storyline";
import { reviewSlide } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { tx, roleLabel } from "@/ActivitySpace/artifacts/slides/kata/i18n";

/** タイトルだけを順に読む。1本の話になっているか、主張が言い切れているかを確かめる */
export function TitleRead() {
  const open = useKata((s) => s.titleRead);
  const setOpen = useKata((s) => s.setTitleRead);
  const view = useDeckView();
  const setCurrent = useKata((s) => s.setCurrent);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open && !!view);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open || !view) return null;
  const { deck, roles } = view;
  return createPortal(
    <div ref={trapRef} tabIndex={-1} className="fixed inset-0 z-[92] overflow-y-auto bg-k-paper/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tx("タイトルの通し読み", "Title read-through")}>
      <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-8 py-14">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[0.1em] text-k-ink-3">STORYLINE — {STORYLINE_BY_ID[deck.storyline].name}</span>
            <h2 className="text-[26px] font-bold tracking-[-0.01em]">{tx("タイトルだけで、話が通るか", "Does the story hold with titles alone?")}</h2>
            <p className="text-[13px] text-k-ink-2">{tx("各ページの主張を順に読みます。押すと、そのページに移ります。", "Read each slide’s message in order. Click one to jump to it.")}</p>
          </div>
          <button type="button" aria-label={tx("閉じる", "Close")} onClick={() => setOpen(false)} className="rounded-lg p-2 text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
            <X size={18} />
          </button>
        </div>
        <ol className="flex flex-col">
          {deck.slides.map((s, i) => {
            const head = i === 0 || roles[i] !== roles[i - 1] ? roles[i] : null;
            const weak = !s.title.trim() || reviewSlide(s).some((f) => f.kind === "語尾");
            return (
              <li key={s.id} className="flex flex-col">
                {head ? <div className="mt-6 pb-2 font-mono text-[11px] tracking-[0.08em] text-k-ink-3 first:mt-0">{roleLabel(head)}</div> : null}
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(i);
                    setOpen(false);
                  }}
                  className="group grid grid-cols-[44px_minmax(0,1fr)_auto] items-baseline gap-4 border-t border-k-line py-4 text-left hover:bg-k-hover/60"
                >
                  <span className="font-mono text-[12px] text-k-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <span className={weak ? "text-[18px] leading-relaxed text-k-danger" : "text-[18px] font-medium leading-relaxed text-k-ink"}>{s.title || tx("（タイトル未入力）", "(No title)")}</span>
                  {weak ? <span className="rounded bg-k-danger-tint px-1.5 py-0.5 text-[10px] font-semibold text-k-danger">{tx("言い切れていない", "Not assertive")}</span> : <span />}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
