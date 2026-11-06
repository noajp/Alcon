"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, FileText, Paperclip, X } from '@/ui/icons';
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { useActiveFile } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { sendToKata } from "./send";
import { samplesFor } from "@/ActivitySpace/artifacts/slides/kata/model/samples";
import { getLang } from "@/ActivitySpace/artifacts/slides/kata/i18n";
import { ISSUES } from "@/ActivitySpace/artifacts/slides/kata/model/chat";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

import type { Deck } from "@/ActivitySpace/artifacts/slides/kata/model/types";

/** 今のページと資料に合わせた頼み方の例 */
function suggestions(deck: Deck, index: number): string[] {
  const s = deck.slides[index];
  const out = [tx("赤入れして", "Review this deck")];
  if (s && s.layout !== "cover" && s.layout !== "closing")
    out.push(s.layout === "compare" ? tx("このページを2×2にして", "Make this page a 2×2") : tx("このページを比較にして", "Make this page a comparison"));
  out.push(
    deck.storyline === "pyramid"
      ? tx("状況→難しさ→解決の順に並べ直して", "Reorder as situation → complication → resolution")
      : tx("結論から先に並べ直して", "Reorder answer first"),
  );
  out.push(deck.slides.length > 6 ? tx("6枚にまとめて", "Condense to 6 slides") : tx("用語をそろえて", "Align terms"));
  return out;
}

export function ChatPanel() {
  const file = useActiveFile();
  const busy = useKata((s) => s.busy);
  const current = useKata((s) => s.current);
  const endRef = useRef<HTMLDivElement>(null);
  const count = file?.chat.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count, busy]);
  if (!file) return null;

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {file.chat.length === 0 ? file.deck.slides.length <= 1 ? <Welcome canTry /> : <AskThisDeck items={suggestions(file.deck, Math.min(current, file.deck.slides.length - 1))} /> : null}
      {file.chat.map((m) => (
        <div key={m.id} className={clsx("anim-in flex flex-col gap-1.5", m.from === "me" ? "items-end" : "items-start")}>
          {m.attachment ? (
            <div className="flex items-center gap-2 rounded-lg border border-k-line bg-k-panel-2 px-2.5 py-1.5 text-[12px] text-k-ink-2">
              <FileText size={13} />
              {m.attachment}
            </div>
          ) : null}
          {m.text ? (
            <div
              className={clsx(
                "max-w-[300px] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.7]",
                m.from === "me" ? "rounded-br-md bg-k-primary text-k-on-primary" : "rounded-bl-md bg-k-bubble text-k-ink",
              )}
            >
              {m.text}
            </div>
          ) : null}
        </div>
      ))}
      {busy ? (
        <div className="dot-pulse flex items-center gap-1 self-start rounded-lg rounded-bl-md bg-k-bubble px-3.5 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-k-ink-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-k-ink-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-k-ink-2" />
        </div>
      ) : null}
      {file.chat.length > 0 && !busy && file.chat.at(-1)?.from === "kata" && /(組みました|Built|built)/.test(file.chat.at(-1)?.text ?? "") ? (
        <div className="anim-in mt-1 flex flex-col gap-2 rounded-lg border border-k-line p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold">{tx("論点の置き方を変える", "Change the framing")}</span>
            <span className="text-[10px] text-k-ink-3">{tx("この資料で答える問い", "The question this deck answers")}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ISSUES.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => sendToKata(x.ask)}
                aria-pressed={file.deck.storyline === x.storyline}
                className={clsx("h-9 rounded-lg border text-[12px] font-medium", file.deck.storyline === x.storyline ? "border-k-ink bg-k-chosen text-k-ink" : "border-k-line text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink")}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {file.chat.length > 0 && !busy ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {suggestions(file.deck, Math.min(current, file.deck.slides.length - 1)).map((s) => (
            <button key={s} type="button" onClick={() => sendToKata(s)} className="rounded-full border border-k-line px-2.5 py-1 text-[11px] text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

/** すでに中身のある資料で、チャットがまだ空のとき */
function AskThisDeck({ items }: { items: string[] }) {
  return (
    <div className="anim-in flex flex-col gap-4 pt-6">
      <div className="font-mono text-[11px] tracking-[0.1em] text-k-ink-3">ASK</div>
      <h3 className="text-[18px] font-bold leading-snug tracking-[-0.01em]">{tx("この資料に、頼みたいことを書いてください。", "What should we do with this deck?")}</h3>
      <p className="text-[13px] leading-[1.8] text-k-ink-2">{tx("文章を貼れば組み直し、一言なら今の資料を直します。", "Paste text to rebuild it, or type a short request to edit the current deck.")}</p>
      <div className="flex flex-col gap-1.5">
        {items.map((t) => (
          <button key={t} type="button" onClick={() => sendToKata(t)} className="rounded-md border border-k-line px-3 py-2.5 text-left text-[13px] text-k-ink-2 hover:border-k-ink hover:text-k-ink">
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Welcome({ canTry }: { canTry: boolean }) {
  return (
    <div className="anim-in flex flex-col gap-4 pt-6">
      <div className="font-mono text-[11px] tracking-[0.1em] text-k-ink-3">START</div>
      <h3 className="text-[20px] font-bold leading-snug tracking-[-0.01em]">
        {tx("議事録や文章を、", "Drop in meeting notes")}
        <br />
        {tx("ここに流してください。", "or any text.")}
      </h3>
      <p className="text-[13px] leading-[1.8] text-k-ink-2">{tx("論点を立て、語る順番を決め、1枚ずつ型に落とします。組んだあとは、右上の「論理構成」と「デザイン」でいつでも組み替えられます。", "Slides frames the issue, sets the storyline, and fits each slide to a layout. Afterwards, rework it anytime with Structure and Design at the top right.")}</p>
      {canTry ? (
      <div className="mt-2 flex flex-col gap-2">
        <div className="font-mono text-[10px] tracking-[0.1em] text-k-ink-3">{tx("見本で試す", "Try a sample")}</div>
        {samplesFor(getLang()).map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => sendToKata("", { name: tx("見本：{name}", "Sample: {name}", { name: x.name }), body: x.text })}
            className="group flex items-center justify-between gap-3 rounded-md border border-k-line px-3 py-2.5 text-left hover:border-k-ink"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{x.name}</span>
              <span className="text-[11px] text-k-ink-3">{x.desc}</span>
            </span>
            <span className="font-mono text-[10px] text-k-ink-3 group-hover:text-k-ink">{x.text.length.toLocaleString()}{tx("字", " chars")} →</span>
          </button>
        ))}
      </div>
      ) : null}
      <ol className="mt-3 flex flex-col gap-2 text-[12px] text-k-ink-2">
        {[
          tx("テキストを貼る（.md / .txt / PDF を落としてもよい）", "Paste text (or drop a .md / .txt / PDF file)"),
          tx("中央に組み上がったスライドを、その場で直す", "Edit the slides right in the center"),
          tx("書き出す（PowerPoint / PDF）", "Export (PowerPoint / PDF)"),
        ].map((t, i) => (
          <li key={t} className="flex items-center gap-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-k-primary font-mono text-[10px] text-k-on-primary">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ChatComposer() {
  const busy = useKata((s) => s.busy);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<{ name: string; body: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(180, Math.max(44, el.scrollHeight))}px`;
  }, [text]);

  const [reading, setReading] = useState(false);
  const readFile = async (f: File) => {
    // PDF は中の文字を抜き、行の折れ・ページ番号・目次を直して、見出しのある文章にしてから添える
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      setReading(true);
      try {
        const { pdfToText } = await import("@/ActivitySpace/artifacts/slides/kata/model/pdf");
        const { intakeDocument } = await import("@/ActivitySpace/artifacts/slides/kata/model/intake");
        const { text } = await pdfToText(await f.arrayBuffer());
        if (!text.replace(/\s+/g, "")) {
          useKata.getState().notify(tx("この PDF からは文字を読めませんでした（画像だけの PDF かもしれません）", "Couldn't read any text from this PDF (it may be scanned images)"));
          return;
        }
        setAttached({ name: f.name, body: intakeDocument(text).markdown });
      } catch {
        useKata.getState().notify(tx("PDF を読めませんでした", "Couldn't read that PDF"));
      } finally {
        setReading(false);
      }
      return;
    }
    if (!/\.(md|txt|markdown)$/i.test(f.name) && !f.type.startsWith("text/")) return;
    setAttached({ name: f.name, body: await f.text() });
  };

  const submit = () => {
    if (busy) return;
    const body = attached ? `${attached.body}\n\n${text}`.trim() : text.trim();
    if (!body) return;
    sendToKata(attached ? text.trim() : body, attached ? { name: attached.name, body: attached.body } : undefined);
    setText("");
    setAttached(null);
  };

  return (
    <div
      className={clsx("shrink-0 p-3", dragOver && "bg-k-drop")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void readFile(f);
      }}
    >
      {reading ? (
        <div role="status" className="mb-2 flex items-center gap-2 rounded-lg border border-k-line bg-k-panel-2 px-2.5 py-1.5 text-[12px] text-k-ink-2">
          <FileText size={13} className="shrink-0" /> {tx("PDF を読んでいます…", "Reading the PDF…")}
        </div>
      ) : null}
      {attached ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-k-line bg-k-panel-2 px-2.5 py-1.5 text-[12px] text-k-ink-2">
          <span className="flex min-w-0 items-center gap-2">
            <FileText size={13} className="shrink-0" />
            <span className="truncate">{attached.name}</span>
            <span className="shrink-0 text-k-ink-3">{attached.body.length.toLocaleString()} {tx("字", "chars")}</span>
          </span>
          <button type="button" aria-label={tx("添付を外す", "Remove attachment")} onClick={() => setAttached(null)} className="rounded p-0.5 hover:bg-k-hover">
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-lg border border-k-line-strong bg-k-panel px-2 py-1.5 focus-within:border-k-ink">
        <button type="button" aria-label={tx("ファイルを添付", "Attach file")} onClick={() => fileRef.current?.click()} className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
          <Paperclip size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.markdown,.pdf,text/plain,text/markdown,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
        <label htmlFor="kata-composer" className="sr-only">
          {tx("チャットに書く", "Message Slides")}
        </label>
        <textarea
          id="kata-composer"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={attached ? tx("どんな資料にしたいか（任意）", "What kind of deck? (optional)") : tx("議事録を貼る／「このページを比較にして」", "Paste notes, or try “Make this page a comparison”")}
          className="scroll-thin max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[13px] leading-[1.6] placeholder:text-k-ink-3"
        />
        <button
          type="button"
          aria-label={tx("送る", "Send")}
          onClick={submit}
          disabled={busy || (!text.trim() && !attached)}
          className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-k-primary text-k-on-primary transition-opacity disabled:opacity-25"
        >
          <ArrowUp size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
