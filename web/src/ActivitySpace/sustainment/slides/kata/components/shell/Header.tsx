"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown, FileJson, Play, Presentation, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "@/ActivitySpace/sustainment/slides/kata/components/ui/IconButton";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { STORYLINE_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/model/storyline";
import { exportPptx } from "@/ActivitySpace/sustainment/slides/kata/export/pptx";
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
    <header className="flex h-12 shrink-0 items-center justify-between pl-4 pr-3">
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => useKata.getState().setPalette(true)}
            className="hidden h-8 items-center gap-2 rounded-lg border border-k-line px-2.5 text-[12px] text-k-ink-3 hover:border-k-line-strong hover:text-k-ink-2 lg:flex"
          >
            {tx("やりたいことを探す", "Search actions")}
            <kbd className="rounded border border-k-line px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
          <LangToggle />
          <div className="mr-1 hidden items-center rounded-full border border-k-line bg-k-panel text-[12px] text-k-ink-2 xl:flex">
            <button type="button" onClick={() => {
                const st = useKata.getState();
                st.setPanel("logic");
                st.setLogicTab("deck");
              }}
              title={tx("論理構成を開く", "Open structure")} className="rounded-l-full py-1 pl-3 pr-2 hover:bg-k-hover hover:text-k-ink">
              {STORYLINE_BY_ID[view.deck.storyline].name}
            </button>
            <span className="h-3 w-px bg-k-line" />
            <button type="button" onClick={() => useKata.getState().setPanel("design")} title={tx("デザインを開く", "Open design")} className="flex items-center gap-1.5 rounded-r-full py-1 pl-2 pr-3 hover:bg-k-hover hover:text-k-ink">
              <span className="flex -space-x-1">
                {view.file.mix.selected.slice(0, 4).map((id) => (
                  <span key={id} className="h-3 w-3 rounded-full border border-white" style={{ background: view.looks[id]?.tokens.number.block }} />
                ))}
              </span>
              <span className="max-w-[220px] truncate">{view.file.mix.selected.map((id) => view.looks[id]?.name).filter(Boolean).join(" × ")}</span>
            </button>
          </div>
          <UndoRedo fileId={view.file.id} />
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-k-line-strong bg-k-panel px-3 text-[13px] font-medium text-k-ink hover:bg-k-hover"
          >
            <Play size={13} strokeWidth={2.2} />
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
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-k-primary px-3 text-[13px] font-medium text-k-on-primary hover:opacity-90"
      >
        {busy ? tx("書き出し中…", "Exporting…") : tx("書き出す", "Export")}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div role="menu" className="anim-in absolute right-0 top-10 z-50 w-64 rounded-xl border border-k-line bg-k-panel p-1.5 shadow-[var(--shadow-pop)]">
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-k-hover"
            onClick={async () => {
              setOpen(false);
              setBusy(true);
              try {
                await exportPptx(view.deck, view.tokens, view.roles, view.file.name);
                useKata.getState().notify(tx(`「${view.file.name}.pptx」を書き出しました`, `Exported “${view.file.name}.pptx”`));
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
            onClick={() => {
              setOpen(false);
              // 資料をそのまま渡せるファイルにする（Kata で開ける）
              const blob = new Blob([toKataJson(view.file.name, view.deck, view.file.mix)], { type: "application/json" });
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

function UndoRedo({ fileId }: { fileId: string }) {
  const h = useKata((s) => s.history[fileId]);
  const undo = useKata((s) => s.undo);
  const redo = useKata((s) => s.redo);
  return (
    <div className="mr-1 flex items-center">
      <IconButton label={tx("取り消す（⌘Z）", "Undo (⌘Z)")} onClick={() => undo()} disabled={!h?.past.length} className="disabled:opacity-25">
        <Undo2 size={15} />
      </IconButton>
      <IconButton label={tx("やり直す（⌘⇧Z）", "Redo (⌘⇧Z)")} onClick={() => redo()} disabled={!h?.future.length} className="disabled:opacity-25">
        <Redo2 size={15} />
      </IconButton>
    </div>
  );
}

function LangToggle() {
  const lang = useKata((s) => s.lang);
  return (
    <button
      type="button"
      onClick={() => useKata.getState().setLangPref(lang === "en" ? "ja" : "en")}
      aria-label={lang === "en" ? "日本語に切り替える" : "Switch to English"}
      title={lang === "en" ? "日本語に切り替える" : "Switch to English"}
      className="h-8 rounded-lg px-2 text-[12px] font-medium text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
    >
      {lang === "en" ? "日本語" : "EN"}
    </button>
  );
}
