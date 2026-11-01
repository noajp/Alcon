"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown, FileJson, Play, Presentation } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { exportPptx } from "@/ActivitySpace/sustainment/slides/kata/export/pptx";
import { inlineDeck } from "@/ActivitySpace/sustainment/slides/deckAssets";
import { toKataJson } from "@/ActivitySpace/sustainment/slides/kata/model/kataFile";
import { PresentMode } from "@/ActivitySpace/sustainment/slides/kata/components/stage/PresentMode";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

export function Header() {
  const view = useDeckView();
  const folders = useKata((s) => s.folders);
  const renameFile = useKata((s) => s.renameFile);
  const [editing, setEditing] = useState(false);
  const presenting = useKata((s) => s.presenting);
  const setPresenting = useKata((s) => s.setPresenting);
  const cancelRename = useRef(false);
  const stopPresenting = useCallback(() => setPresenting(false), [setPresenting]);
  const folder = view ? folders.find((f) => f.id === view.file.folderId) : null;

  return (
    <header className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2">
      <div className="flex min-w-0 items-center gap-3">
        {view ? (
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="truncate text-k-ink-3">{folder?.name}</span>
            <span className="text-k-ink-3">/</span>
            {editing ? (
              <input
                autoFocus
                defaultValue={view.file.name}
                aria-label={tx("ファイル名", "File name")}
                className="w-56 rounded-md bg-k-panel px-2 py-1 text-[13px] font-medium"
                onBlur={(e) => {
                  if (!cancelRename.current) renameFile(view.file.id, e.target.value);
                  cancelRename.current = false;
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    cancelRename.current = true;
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            ) : (
              <button type="button" onDoubleClick={() => setEditing(true)} title={tx("ダブルクリックで名前を変える", "Double-click to rename")} className="truncate rounded-md px-1 py-0.5 font-medium hover:bg-k-hover">
                {view.file.name}
              </button>
            )}
          </div>
        ) : null}
      </div>
      {view ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
          >
            <Play size={12} strokeWidth={2.2} />
            {tx("発表", "Present")}
          </button>
          <ExportMenu />
        </div>
      ) : null}
      {presenting ? <PresentMode onClose={stopPresenting} /> : null}
    </header>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = useDeckView();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!view) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1 rounded-md bg-k-primary px-2.5 text-[12px] font-medium text-k-on-primary hover:opacity-90"
      >
        {busy ? tx("書き出し中…", "Exporting…") : tx("書き出す", "Export")}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div role="menu" className="anim-in absolute right-0 top-10 z-50 w-64 rounded-lg border border-k-line bg-k-panel p-1.5 shadow-[var(--shadow-pop)]">
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-k-hover"
            onClick={async () => {
              setOpen(false);
              setBusy(true);
              try {
                await exportPptx(view.deck, view.tokens, view.roles, view.file.name);
                useKata.getState().notify(tx("「{name}.pptx」を書き出しました", "Exported “{name}.pptx”", { name: view.file.name }));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Presentation size={16} className="mt-0.5 text-k-ink-2" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium">{tx("PowerPoint（.pptx）", "PowerPoint (.pptx)")}</span>
              <span className="text-[11px] text-k-ink-3">{tx("文字を編集できる形で書き出す", "Export with editable text")}</span>
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-k-hover"
            onClick={() => {
              setOpen(false);
              useKata.getState().printDeck();
            }}
          >
            <FileDown size={16} className="mt-0.5 text-k-ink-2" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium">PDF</span>
              <span className="text-[11px] text-k-ink-3">{tx("印刷画面で「PDF に保存」を選ぶ（⌘P）", "Choose “Save as PDF” in the print dialog (⌘P)")}</span>
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-k-hover"
            onClick={async () => {
              setOpen(false);
              // 資料をそのまま渡せるファイルにする（Kata で開ける）。画像は中身ごと入れる
              const blob = new Blob([toKataJson(view.file.name, await inlineDeck(view.deck), view.file.mix)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${view.file.name || "deck"}.kata.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
          >
            <FileJson size={16} className="mt-0.5 text-k-ink-2" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium">{tx("資料ファイル（.kata.json）", "Deck file (.kata.json)")}</span>
              <span className="text-[11px] text-k-ink-3">{tx("ほかの人の Slides でそのまま開ける", "Opens as-is in Slides")}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
