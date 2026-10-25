"use client";

import { useFocusTrap } from "@/ActivitySpace/sustainment/slides/kata/components/ui/useFocusTrap";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

const keys = (): [string, string][] => [
  ["⌘K", tx("やりたいことを探す", "Search actions")],
  ["↑ ↓ / ← → / j k", tx("ページを送る", "Next / previous slide")],
  ["Delete", tx("ページを消す（選んだ図形があれば図形を）", "Delete slide (or the selected shape)")],
  ["N", tx("ページを足す", "New slide")],
  ["⌘D", tx("ページ（選んだ図形）を複製", "Duplicate slide (or shape)")],
  ["↑ ↓ ← →  / Shift", tx("選んだ図形を動かす（10px ずつ）", "Nudge the selected shape (by 10px)")],
  ["Enter", tx("選んだ図形に文字を打つ", "Type into the selected shape")],
  ["⌘C / ⌘X / ⌘V", tx("図形をコピー／切り取り／貼り付け", "Copy / cut / paste a shape")],
  ["Shift + drag", tx("まっすぐ動かす／縦横比を保つ", "Constrain move / keep aspect ratio")],
  ["Alt + drag", tx("吸着せずに動かす", "Move without snapping")],
  ["⌘Z / ⌘⇧Z", tx("取り消す／やり直す", "Undo / redo")],
  ["⌘P", tx("PDF に書き出す", "Export to PDF")],
  ["⌘\\", tx("ファイル一覧を開け閉めする", "Show / hide files")],
  ["Alt + ↑ ↓", tx("ページ一覧で並べ替える", "Reorder in slide list")],
  ["Alt + ↑ ↓", tx("論理構成の一覧で並べ替える", "Reorder in structure list")],
  ["Enter / Shift + Enter", tx("チャットで送る／改行する", "Send / new line in chat")],
  ["Esc", tx("編集やダイアログをやめる", "Cancel editing or close dialog")],
  ["?", tx("この一覧", "This list")],
];

/** ? で開く、ショートカットの一覧 */
export function Shortcuts() {
  const open = useKata((s) => s.shortcuts);
  const setOpen = useKata((s) => s.setShortcuts);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-center justify-center bg-black/25" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tx("ショートカット", "Shortcuts")} className="anim-in w-[440px] rounded-2xl border border-k-line bg-k-panel p-6 shadow-[var(--shadow-pop)]">
        <div className="mb-4 font-mono text-[10px] tracking-[0.1em] text-k-ink-3">SHORTCUTS</div>
        <dl className="flex flex-col">
          {keys().map(([k, v]) => (
            <div key={k + v} className="flex items-center justify-between border-t border-k-line py-2.5 text-[13px] first:border-0">
              <dt className="text-k-ink-2">{v}</dt>
              <dd>
                <kbd className="rounded-md border border-k-line-strong bg-k-panel-2 px-2 py-0.5 font-mono text-[11px] text-k-ink">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
