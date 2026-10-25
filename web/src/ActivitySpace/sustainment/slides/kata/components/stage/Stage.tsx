"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronDown, Minus, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { InsertMenu, ObjectFormatBar, TextFormatBar } from "./EditBar";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { SLIDE_H, SLIDE_W, SlideScaler, SlideView } from "@/ActivitySpace/sustainment/slides/kata/components/slides/SlideView";
import { LAYOUT_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { insertSlide } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { newId } from "@/ActivitySpace/sustainment/slides/kata/model/id";
import { IconButton } from "@/ActivitySpace/sustainment/slides/kata/components/ui/IconButton";
import { reviewDeck, type Finding } from "@/ActivitySpace/sustainment/slides/kata/model/review";
import { reviewWithSkills, titleLimit } from "@/ActivitySpace/sustainment/slides/kata/model/skill";
import { canChange, changeItems, itemAxes, setHighlight, type ItemAxis } from "@/ActivitySpace/sustainment/slides/kata/model/items";
import { updateSlide } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { sectionText } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
import { FileText } from "lucide-react";
import { tx, roleLabel } from "@/ActivitySpace/sustainment/slides/kata/i18n";

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** 置きもの・文字の外を押したら、選びをやめる（書式バーの中は除く） */
function useDeselectOutside() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest("[data-formatbar]")) return;
      const st = useKata.getState();
      if (st.selected && !t.closest("[data-obj]")) st.select(null);
      if (st.textFocus && !t.closest("[data-style-key]")) st.setTextFocus(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
}

export function Stage() {
  const view = useDeckView();
  const setCurrent = useKata((s) => s.setCurrent);
  const setSlidePath = useKata((s) => s.setSlidePath);
  const editDeck = useKata((s) => s.editDeck);
  const [boxRef, box] = useSize<HTMLDivElement>();
  const busy = useKata((s) => s.busy);
  const skills = useKata((s) => s.skills);
  const filmstripOpen = useKata((s) => s.filmstrip);
  const setFilmstrip = useKata((s) => s.setFilmstrip);
  const selected = useKata((s) => s.selected);
  const textFocus = useKata((s) => s.textFocus);
  useDeselectOutside();
  if (!view) return null;
  const { deck, slide, index, roles, tokens } = view;
  // スライドとフィルムストリップを一つのまとまりとして縦に中央へ置く。フィルムストリップの高さ（約96px）を引いて大きさを決める
  // フィルムストリップ（約109px）と間（16px）を引いた残りに収める。低い窓では小さくしてでも切らない
  const width = Math.max(160, Math.min(box.w - 8, ((box.h - 24) * SLIDE_W) / SLIDE_H));
  const findings = [...reviewDeck(deck, titleLimit(skills)), ...reviewWithSkills(deck, skills)].filter((f) => f.slideId === slide.id);

  const editingSomething = !!(selected && slide.objects?.some((o) => o.id === selected)) || !!(textFocus && textFocus.slideId === slide.id);
  const addAfter = () => {
    editDeck((d) =>
      insertSlide(d, index, { id: newId("s"), title: "", layout: "statement", content: { statement: { lead: "", figure: "" } } }),
    );
    setCurrent(index + 1);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-k-line bg-k-stage">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 whitespace-nowrap px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-[12px]">
          {!filmstripOpen ? (
            <IconButton label={tx("ページ一覧を開く", "Show pages")} onClick={() => setFilmstrip(true)}>
              <PanelLeftOpen size={15} />
            </IconButton>
          ) : null}
          <span className="font-mono text-k-ink-3" title={tx("↑ ↓ でページを送る", "↑ ↓ to move between slides")}>
            {String(index + 1).padStart(2, "0")} / {String(deck.slides.length).padStart(2, "0")}
          </span>
          {editingSomething ? (
            selected ? <ObjectFormatBar /> : <TextFormatBar />
          ) : (
            <>
              <button
                type="button"
                title={tx("このページの論理を変える", "Change this page's logic")}
                onClick={() => {
                  const st = useKata.getState();
                  st.setPanel("logic");
                  st.setLogicTab("page");
                }}
                className="flex items-center gap-1.5 rounded-full border border-k-line-strong px-2.5 py-0.5 hover:border-k-ink-3"
              >
                <span className="text-[10px] text-k-ink-3">{tx("型", "Layout")}</span>
                <span className="font-medium text-k-ink-2">{LAYOUT_BY_ID[slide.layout].name}</span>
                <ChevronDown size={11} className="text-k-ink-3" />
              </button>
              {findings.length ? <FindingsChip findings={findings} /> : null}
              {slide.source && deck.sourceDoc ? (
                <SourceChip source={slide.source} doc={deck.sourceDoc} nth={deck.slides.slice(0, index).filter((x) => x.source === slide.source).length} />
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editingSomething ? <ItemControls /> : null}
          <InsertMenu onNewPage={addAfter} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
      {filmstripOpen ? <Filmstrip onClose={() => setFilmstrip(false)} /> : null}
      <div ref={boxRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center px-5">
        {busy ? (
          <div className="anim-in pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-k-ink px-3.5 py-1.5 text-[12px] font-medium text-k-paper shadow-[var(--shadow-pop)] ring-1 ring-white/10">
            <span className="dot-pulse flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-k-lime" />
              <span className="h-1.5 w-1.5 rounded-full bg-k-lime" />
              <span className="h-1.5 w-1.5 rounded-full bg-k-lime" />
            </span>
            {tx("論点と順番を組み立て中", "Structuring the argument")}
          </div>
        ) : null}
        {box.w > 0 ? (
          <div key={slide.id} className="anim-in shrink-0 rounded-[6px] shadow-[var(--shadow-slide)]" style={{ overflow: "hidden" }}>
            <SlideScaler width={width}>
              <SlideView
                slide={slide}
                index={index}
                role={roles[index]}
                tokens={tokens}
                lang={view.lang}
                editable
                onEdit={(path, value) => setSlidePath(slide.id, path, value)}
                onFocusText={(key, size) => useKata.getState().setTextFocus({ slideId: slide.id, key, size })}
              />
            </SlideScaler>
          </div>
        ) : null}
      </div>
      </div>
    </main>
  );
}

/** 中央の左に縦に並ぶページ一覧。ドラッグか Alt + ↑↓ で並べ替え、閉じられる */
function Filmstrip({ onClose }: { onClose: () => void }) {
  const view = useDeckView();
  const setCurrent = useKata((s) => s.setCurrent);
  const moveSlide = useKata((s) => s.moveSlide);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const index = view?.index ?? 0;
  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);
  if (!view) return null;
  const { deck, roles, tokens } = view;
  return (
    <aside aria-label={tx("ページ一覧", "Pages")} className="flex w-[176px] shrink-0 flex-col border-r border-k-line">
      <div className="flex h-9 shrink-0 items-center justify-between pl-4 pr-1.5">
        <span className="font-mono text-[10px] tracking-[0.08em] text-k-ink-3">PAGES {String(deck.slides.length).padStart(2, "0")}</span>
        <IconButton label={tx("ページ一覧を閉じる", "Hide pages")} onClick={onClose}>
          <PanelLeftClose size={15} />
        </IconButton>
      </div>
      <div ref={listRef} className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-4 pt-1">
        {deck.slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            draggable
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) moveSlide(drag, i);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onClick={() => setCurrent(i)}
            onKeyDown={(e) => {
              if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                moveSlide(i, e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : i + 1);
              }
            }}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            aria-label={tx(`${i + 1}枚目：${s.title}`, `Slide ${i + 1}: ${s.title}`)}
            aria-current={i === view.index ? "true" : undefined}
            style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
            className={clsx("anim-in group flex shrink-0 items-start gap-2 text-left", drag === i && "opacity-40")}
          >
            <span className="flex w-5 shrink-0 flex-col items-end pt-0.5">
              <span className={clsx("font-mono text-[10px]", i === view.index ? "text-k-ink" : "text-k-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span
                className={clsx(
                  "block overflow-hidden rounded-[4px] transition-shadow",
                  i === view.index ? "ring-2 ring-k-ink ring-offset-2 ring-offset-stage" : "ring-1 ring-k-line-strong group-hover:ring-k-ink-3",
                  over === i && drag !== i && "ring-2 ring-k-lime-deep",
                )}
              >
                <SlideScaler width={124}>
                  <SlideView slide={s} index={i} role={roles[i]} tokens={tokens} lang={view.lang} />
                </SlideScaler>
              </span>
              <span className="truncate text-[10px] text-k-ink-3">{roles[i] ? roleLabel(roles[i]) : roles[i]}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const st = useKata.getState();
            st.editDeck((d) => insertSlide(d, d.slides.length - 1, { id: newId("s"), title: "", layout: "statement", content: { statement: { lead: "", figure: "" } } }));
            st.setCurrent(deck.slides.length);
          }}
          title={tx("ページを足す（N）", "New page (N)")}
          className="ml-7 flex h-[70px] w-[124px] shrink-0 items-center justify-center gap-1 rounded-[4px] border border-dashed border-k-line-strong text-[11px] text-k-ink-3 hover:border-k-ink-3 hover:text-k-ink-2"
        >
          <Plus size={13} /> {tx("ページ", "Page")}
        </button>
      </div>
    </aside>
  );
}

const axisLabel = (axis: ItemAxis): string =>
  ({ item: tx("項目", "Items"), row: tx("行", "Rows"), column: tx("列", "Columns") })[axis];

function ItemControls() {
  const view = useDeckView();
  const editDeck = useKata((s) => s.editDeck);
  if (!view) return null;
  const { slide } = view;
  const axes = itemAxes(slide);
  const mtx = slide.layout === "matrix" ? slide.content.matrix : undefined;
  if (mtx) {
    return (
      <div className="mr-2 flex h-7 items-center gap-0.5 rounded-md border border-k-line-strong bg-k-panel px-1" role="group" aria-label={tx("立たせる象限", "Highlighted quadrant")}>
        <span className="px-1 text-[11px] text-k-ink-3">{tx("推し", "Focus")}</span>
        {[tx("左上", "Top left"), tx("右上", "Top right"), tx("左下", "Bottom left"), tx("右下", "Bottom right")].map((name, i) => (
          <button
            key={name}
            type="button"
            aria-pressed={mtx.highlight === i}
            title={name}
            onClick={() => editDeck((dk) => updateSlide(dk, slide.id, (x) => setHighlight(x, i)))}
            className={clsx("h-5 rounded px-1 text-[10px]", mtx.highlight === i ? "bg-k-primary text-k-check" : "text-k-ink-2 hover:bg-k-hover")}
          >
            {name}
          </button>
        ))}
      </div>
    );
  }
  if (!axes.length) return null;
  const change = (axis: ItemAxis, d: 1 | -1) => editDeck((dk) => updateSlide(dk, slide.id, (x) => changeItems(x, axis, d)));
  const cmp = slide.content.compare;
  return (
    <div className="mr-2 flex items-center gap-1.5">
      {axes.map((axis) => (
        <div key={axis} className="flex h-7 items-center rounded-md border border-k-line-strong bg-k-panel">
          <button type="button" aria-label={tx(`${axisLabel(axis)}を減らす`, `Fewer ${axisLabel(axis).toLowerCase()}`)} disabled={!canChange(slide, axis, -1)} onClick={() => change(axis, -1)} className="flex h-full w-6 items-center justify-center text-k-ink-2 hover:text-k-ink disabled:opacity-25">
            <Minus size={12} />
          </button>
          <span className="px-1 text-[11px] text-k-ink-2">{axisLabel(axis)}</span>
          <button type="button" aria-label={tx(`${axisLabel(axis)}を足す`, `More ${axisLabel(axis).toLowerCase()}`)} disabled={!canChange(slide, axis, 1)} onClick={() => change(axis, 1)} className="flex h-full w-6 items-center justify-center text-k-ink-2 hover:text-k-ink disabled:opacity-25">
            <Plus size={12} />
          </button>
        </div>
      ))}
      {cmp ? (
        <div className="flex h-7 items-center gap-0.5 rounded-md border border-k-line-strong bg-k-panel px-1" role="group" aria-label={tx("立たせる列", "Highlighted column")}>
          <span className="px-1 text-[11px] text-k-ink-3">{tx("推し", "Focus")}</span>
          {cmp.columns.map((col, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={cmp.highlight === i}
              title={col || tx(`${i + 1}列目`, `Column ${i + 1}`)}
              onClick={() => editDeck((dk) => updateSlide(dk, slide.id, (x) => setHighlight(x, i)))}
              className={clsx("h-5 min-w-5 rounded px-1 font-mono text-[10px]", cmp.highlight === i ? "bg-k-primary text-k-check" : "text-k-ink-2 hover:bg-k-hover")}
            >
              {"ABCD"[i]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FindingsChip({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-k-danger-tint px-2.5 py-0.5 font-medium text-k-danger"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-k-danger" />
        {tx("赤入れ", "Review")} {findings.length}
      </button>
      {open ? (
        <div className="anim-in absolute left-0 top-8 z-40 w-80 rounded-xl border border-k-line bg-k-panel p-3 shadow-[var(--shadow-pop)]">
          <div className="mb-2 font-mono text-[10px] tracking-[0.08em] text-k-danger">REVIEW</div>
          <ul className="flex flex-col gap-2">
            {findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
                <span className="mt-0.5 shrink-0 rounded bg-k-danger-tint px-1.5 text-[10px] font-semibold text-k-danger">{f.kind}</span>
                <span className="text-k-ink">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** ページの出どころ：元の文章の、その節をそのまま見せる */
function SourceChip({ source, doc, nth }: { source: string; doc: { name: string; text: string }; nth: number }) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);
  const label = source.replace(/^(元|出典)：/, "");
  const body = sectionText(doc.text, label, nth);
  if (!body) return null;
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // 画面からはみ出さないように、幅と左端を画面の中に収める
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
    setPos({ top: r.bottom + 8, left, width });
  };
  return (
    <>
      <button ref={btnRef} type="button" aria-expanded={!!pos} onClick={toggle} className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-k-ink-3 hover:bg-k-hover hover:text-k-ink-2">
        <FileText size={12} /> {tx("元を見る", "Source")}
      </button>
      {pos
        ? createPortal(
            <div ref={popRef} role="dialog" aria-label={tx("出どころ", "Source")} style={{ top: pos.top, left: pos.left, width: pos.width }} className="anim-in fixed z-[80] rounded-xl border border-k-line bg-k-panel p-4 shadow-[var(--shadow-pop)]">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[10px] tracking-[0.08em] text-k-ink-3">SOURCE — {doc.name}</span>
                <span className="shrink-0 truncate text-[11px] font-medium text-k-ink-2">{label}</span>
              </div>
              <pre className="scroll-thin max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-[1.8] text-k-ink">{body}</pre>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
