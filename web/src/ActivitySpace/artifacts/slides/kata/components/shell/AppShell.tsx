"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { setUiLocale, tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";
import { Header } from "./Header";
import { Stage } from "@/ActivitySpace/artifacts/slides/kata/components/stage/Stage";
import { RightPanel } from "@/ActivitySpace/artifacts/slides/kata/components/panels/RightPanel";
import { PrintDeck } from "@/ActivitySpace/artifacts/slides/kata/components/stage/PrintDeck";
import { addObject, duplicateObject, moveBy, removeObject, updateObject } from "@/ActivitySpace/artifacts/slides/kata/model/objects";
import { insertSlide, updateSlide } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import { newId } from "@/ActivitySpace/artifacts/slides/kata/model/id";
import type { Slide, SlideObject } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/artifacts/slides/kata/components/useDeckView";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { CommandPalette } from "./CommandPalette";
import { Toast } from "@/ActivitySpace/artifacts/slides/kata/components/ui/Toast";
import { TitleRead } from "@/ActivitySpace/artifacts/slides/kata/components/panels/TitleRead";
import { Shortcuts } from "./Shortcuts";

export function AppShell() {
  // This person's preferences (language, panels, looks) come from the browser;
  // the decks come from the Space through slides/sync.ts before this mounts.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = () => setReady(true);
    if (useKata.persist.hasHydrated()) done();
    return useKata.persist.onFinishHydration(done);
  }, []);
  const view = useDeckView();
  const locale = useKata((s) => s.locale);
  // Alcon keeps hidden tabs mounted: a shell that is not on screen takes no keys and prints nothing.
  const shell = useRef<HTMLDivElement>(null);
  useShortcuts(shell);
  // ブラウザのメニューから印刷したときも、全ページを描いてから印刷する
  useEffect(() => {
    const before = () => { if (shown(shell.current)) flushSync(() => useKata.setState({ printing: true })); };
    const after = () => useKata.setState({ printing: false });
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  if (!ready) return <div className="kata-root h-full bg-k-paper" />;
  // 子の描画より先に表示言語をそろえる（アプリの言語が変わったら key で全体を描き直す）
  setUiLocale(locale);

  return (
    <div key={locale} className="kata-root contents">
      <div ref={shell} className="no-print flex h-full min-w-[720px] flex-col overflow-hidden bg-k-panel">
        <Header />
        {/* Like a design tool: the canvas runs edge to edge and the panels beside it
            are divided by a hairline, not set in boxes of their own. */}
        <div className="flex min-h-0 flex-1 border-t border-k-line">
          {view ? (
            <>
              <Stage />
              <RightPanel />
            </>
          ) : (
            <EmptyWorkspace />
          )}
        </div>
      </div>
      {view ? <PrintDeck /> : null}
      <CommandPalette />
      <Toast />
      <TitleRead />
      <Shortcuts />
    </div>
  );
}

let clipboard: SlideObject | null = null;

/** 置きものを選んでいるときのキー操作と、ページの削除・追加・複製。扱ったら true */
function handleObjectKeys(e: KeyboardEvent): boolean {
  const s = useKata.getState();
  const file = s.files.find((f) => f.id === s.activeFileId);
  const slide = file?.deck.slides[s.current];
  if (!file || !slide) return false;
  const mod = e.metaKey || e.ctrlKey;
  // ファイル一覧やチャットに焦点があるときは、スライドへのキー操作をしない
  const t = e.target as HTMLElement | null;
  if (t && t !== document.body && !t.closest("main")) return false;
  // 押しっぱなしで次々に消したり足したりしない
  if (e.repeat && (e.key === "Delete" || e.key === "Backspace" || e.key.toLowerCase() === "n" || e.key === "Enter")) return true;
  const obj = slide.objects?.find((o) => o.id === s.selected);
  const edit = (fn: (sl: Slide) => Slide, merge?: string) => s.editDeck((d) => updateSlide(d, slide.id, fn), merge);
  if (mod && e.key.toLowerCase() === "v" && clipboard) {
    e.preventDefault();
    const copy = { ...clipboard, id: newId("o"), x: clipboard.x + 24, y: clipboard.y + 24 };
    clipboard = copy;
    edit((sl) => addObject(sl, copy));
    s.select(copy.id);
    return true;
  }
  if (obj) {
    if (e.key === "Escape") {
      s.select(null);
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      edit((sl) => removeObject(sl, obj.id));
      s.select(null);
      return true;
    }
    if (e.key === "Enter" && (!t || t === document.body) && obj.kind !== "line" && obj.kind !== "arrow" && obj.kind !== "image") {
      e.preventDefault();
      s.setEditing(obj.id);
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && !mod) {
      e.preventDefault();
      edit((sl) => updateObject(sl, obj.id, (o) => moveBy(o, d[0], d[1])), `nudge:${obj.id}`);
      return true;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      let nid: string | null = null;
      edit((sl) => {
        const r = duplicateObject(sl, obj.id);
        nid = r.id;
        return r.slide;
      });
      if (nid) s.select(nid);
      return true;
    }
    if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
      e.preventDefault();
      clipboard = { ...obj };
      if (e.key.toLowerCase() === "x") {
        edit((sl) => removeObject(sl, obj.id));
        s.select(null);
      }
      return true;
    }
    return false;
  }
  // ページそのもの：Delete で消す（⌘Z で戻せる）、N で足す、⌘D で複製
  if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
    e.preventDefault();
    if (file.deck.slides.length <= 1) {
      s.notify(tx("最後の1枚は消せません", "Can't delete the only slide"));
      return true;
    }
    s.deleteSlide(s.current);
    s.notify(tx("{n}枚目を消しました（⌘Z で戻す）", "Deleted slide {n} (⌘Z to undo)", { n: s.current + 1 }));
    return true;
  }
  if (e.key.toLowerCase() === "n" && !mod && !e.altKey) {
    e.preventDefault();
    s.editDeck((d) => insertSlide(d, s.current, { id: newId("s"), title: "", layout: "statement", content: { statement: { lead: "", figure: "" } } }));
    s.setCurrent(s.current + 1);
    return true;
  }
  if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    const copy: Slide = { ...structuredClone(slide), id: newId("s"), objects: slide.objects?.map((o) => ({ ...o, id: newId("o") })) };
    s.editDeck((d) => insertSlide(d, s.current, copy));
    s.setCurrent(s.current + 1);
    return true;
  }
  return false;
}

/** On screen: not inside a hidden tab. */
const shown = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0;

function useShortcuts(shell: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !shown(shell.current)) return;
      // ⌘K stays Alcon's search; the editor's commands open with "/".
      // ダイアログを開いている間は、後ろのデッキを動かさない（エディタ自身を包むダイアログは除く）
      if ([...document.querySelectorAll('[aria-modal="true"]')].some((d) => !d.contains(shell.current))) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const s = useKata.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        s.setShortcuts(true);
        return;
      }
      // The editor's own commands (layouts, pages, looks); ⌘K stays Alcon's search.
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.setPalette(true);
        return;
      }
      if (handleObjectKeys(e)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") {
        s.setCurrent(s.current + 1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k") {
        s.setCurrent(s.current - 1);
        e.preventDefault();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        if (e.repeat) return;
        s.printDeck();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell]);
}
