"use client";

import { useFocusTrap } from "@/ActivitySpace/sustainment/slides/kata/components/ui/useFocusTrap";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { STORYLINES } from "@/ActivitySpace/sustainment/slides/kata/model/storyline";
import { LAYOUTS } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { exportPptx } from "@/ActivitySpace/sustainment/slides/kata/export/pptx";
import { sendToKata } from "@/ActivitySpace/sustainment/slides/kata/components/panels/send";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K：画面のどこにいても、主な操作を名前で呼び出す */
export function CommandPalette() {
  const open = useKata((s) => s.palette);
  const setOpen = useKata((s) => s.setPalette);
  if (!open) return null;
  return <PaletteBody onClose={() => setOpen(false)} />;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const view = useDeckView();
  const files = useKata((s) => s.files);
  const folders = useKata((s) => s.folders);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const cmds = useMemo<Cmd[]>(() => {
    const st = useKata.getState();
    const out: Cmd[] = [];
    const folder = st.folders[0]?.id;
    out.push({ id: "new", group: tx("資料", "Deck"), label: tx("新しい資料を作る", "New deck"), hint: "N", run: () => st.createFile(folder ?? st.createFolder(tx("マイ資料", "My decks"))) });
    for (const f of files) {
      const fo = folders.find((x) => x.id === f.folderId);
      out.push({ id: `open-${f.id}`, group: tx("資料を開く", "Open deck"), label: f.name, hint: fo?.name, run: () => st.selectFile(f.id) });
    }
    if (view) {
      out.push({ id: "present", group: tx("発表と書き出し", "Present & export"), label: tx("このページから発表する", "Present from this slide"), hint: tx("全画面", "Full screen"), run: () => st.setPresenting(true) });
      out.push({
        id: "present0",
        group: tx("発表と書き出し", "Present & export"),
        label: tx("最初から発表する", "Present from start"),
        run: () => {
          st.setCurrent(0);
          st.setPresenting(true);
        },
      });
      out.push({ id: "pptx", group: tx("発表と書き出し", "Present & export"), label: tx("PowerPoint に書き出す", "Export to PowerPoint"), run: () => void exportPptx(view.deck, view.tokens, view.roles, view.file.name).then(() => st.notify(tx("「{name}.pptx」を書き出しました", "Exported “{name}.pptx”", { name: view.file.name }))) });
      out.push({ id: "pdf", group: tx("発表と書き出し", "Present & export"), label: tx("PDF に書き出す", "Export to PDF"), hint: "⌘P", run: () => st.printDeck() });
      out.push({ id: "titles", group: tx("論理構成", "Structure"), label: tx("タイトルだけで通し読みする", "Read titles only"), run: () => st.setTitleRead(true) });
      out.push({ id: "review", group: tx("チャット", "Chat"), label: tx("赤入れする", "Review"), run: () => void sendToKata(tx("赤入れして", "Review this deck")) });
      out.push({ id: "terms", group: tx("チャット", "Chat"), label: tx("マイ・スキルの用語にそろえる", "Apply My skills terms"), run: () => void sendToKata(tx("用語をそろえて", "Align the terms")) });
      out.push({ id: "pages", group: tx("パネル", "Panels"), label: st.filmstrip ? tx("ページ一覧を閉じる", "Hide slides") : tx("ページ一覧を開く", "Show slides"), run: () => st.setFilmstrip(!st.filmstrip) });
      out.push({ id: "p-design", group: tx("パネル", "Panels"), label: tx("デザインを開く", "Open design"), run: () => st.setPanel("design") });
      out.push({ id: "p-logic", group: tx("パネル", "Panels"), label: tx("論理構成を開く", "Open structure"), run: () => st.setPanel("logic") });
      for (const s of STORYLINES) {
        out.push({ id: `story-${s.id}`, group: tx("語る順番", "Storyline"), label: tx("「{name}」で並べる", "Arrange as “{name}”", { name: s.name }), hint: s.desc, run: () => st.setStoryline(s.id) });
      }
      for (const l of LAYOUTS.filter((x) => x.logic)) {
        out.push({ id: `layout-${l.id}`, group: tx("このページの論理", "Slide logic"), label: tx("このページを「{name}」にする", "Make this slide “{name}”", { name: l.name }), hint: l.desc, run: () => st.setLayout(view.slide.id, l.id) });
      }
      out.push({ id: "undo", group: tx("編集", "Edit"), label: tx("取り消す", "Undo"), hint: "⌘Z", run: () => st.undo() });
      out.push({ id: "redo", group: tx("編集", "Edit"), label: tx("やり直す", "Redo"), hint: "⌘⇧Z", run: () => st.redo() });
    }
    out.push({ id: "keys", group: tx("外観", "Appearance"), label: tx("ショートカットの一覧", "Keyboard shortcuts"), hint: "?", run: () => st.setShortcuts(true) });
    out.push({ id: "theme", group: tx("外観", "Appearance"), label: st.theme === "dark" ? tx("明るい外観にする", "Light mode") : tx("暗い外観にする", "Dark mode"), run: () => st.setTheme(st.theme === "dark" ? "light" : "dark") });
    return out;
  }, [files, folders, view]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cmds;
    return cmds.filter((c) => (c.label + (c.hint ?? "") + c.group).toLowerCase().includes(t));
  }, [cmds, q]);
  const active = Math.min(sel, Math.max(0, shown.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/25 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tx("コマンド", "Commands")} className="anim-in w-[560px] overflow-hidden rounded-2xl border border-k-line bg-k-panel shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-k-line px-4">
          <Search size={16} className="text-k-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={tx("やりたいことを入力（例：比較、発表、書き出し）", "Type an action (e.g. compare, present, export)")}
            aria-label={tx("コマンドを探す", "Search commands")}
            className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-k-ink-3"
          />
          <kbd className="rounded border border-k-line px-1.5 py-0.5 font-mono text-[10px] text-k-ink-3">esc</kbd>
        </div>
        <div ref={listRef} role="listbox" aria-label={tx("コマンド", "Commands")} className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {shown.length === 0 ? <div className="px-3 py-8 text-center text-[13px] text-k-ink-3">{tx("見つかりません", "No results")}</div> : null}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head ? <div className="px-3 pb-1 pt-2.5 font-mono text-[10px] tracking-[0.08em] text-k-ink-3">{head}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-i={i}
                  onMouseMove={() => i !== active && setSel(i)}
                  onClick={() => run(c)}
                  className={clsx("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px]", i === active ? "bg-k-selected text-k-ink" : "text-k-ink-2")}
                >
                  <span className="truncate">{c.label}</span>
                  {c.hint ? <span className="shrink-0 truncate text-[11px] text-k-ink-3">{c.hint}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
