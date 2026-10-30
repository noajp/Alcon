"use client";

import { useState } from "react";
import clsx from "clsx";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { STORYLINES, roleOptions, rolesFor } from "@/ActivitySpace/sustainment/slides/kata/model/storyline";
import { LAYOUTS } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { ChartEditor } from "./ChartEditor";
import { insertSlide, setRole } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { newId } from "@/ActivitySpace/sustainment/slides/kata/model/id";
import type { LayoutId } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx, roleLabel } from "@/ActivitySpace/sustainment/slides/kata/i18n";

function LayoutGlyph({ id }: { id: LayoutId }) {
  const b = "bg-k-ink/80";
  const l = "bg-k-ink/15";
  const box = "flex h-9 w-14 shrink-0 gap-[3px] rounded-md border border-k-line-strong bg-k-panel p-1";
  switch (id) {
    case "compare":
      return (
        <span className={box}>
          <span className={clsx("flex-1", l)} />
          <span className={clsx("flex-1", b)} />
          <span className={clsx("flex-1", l)} />
        </span>
      );
    case "premise":
      return (
        <span className={box}>
          <span className="flex flex-[3] flex-col gap-[3px]">
            <span className={clsx("flex-1", l)} />
            <span className={clsx("flex-1", l)} />
          </span>
          <span className={clsx("flex-[2]", b)} />
        </span>
      );
    case "claim3":
      return (
        <span className={box}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-1 flex-col gap-[2px] bg-k-ink/10 p-[2px]">
              <span className="h-[3px] w-2/3 bg-k-ink/70" />
            </span>
          ))}
        </span>
      );
    case "issue":
      return (
        <span className={clsx(box, "flex-col")}>
          {[0, 1].map((i) => (
            <span key={i} className="flex flex-1 gap-[3px]">
              <span className="flex-1 border border-k-ink/30" />
              <span className={clsx("flex-1", "bg-k-ink/25")} />
            </span>
          ))}
        </span>
      );
    case "steps":
      return (
        <span className={clsx(box, "items-center")}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-1 items-center">
              <span className="h-2.5 w-2.5 rounded-full bg-k-ink/80" />
              {i < 2 ? <span className="h-px flex-1 bg-k-ink/30" /> : null}
            </span>
          ))}
        </span>
      );
    case "matrix":
      return (
        <span className={clsx(box, "grid grid-cols-2 grid-rows-2")}>
          <span className="bg-k-ink/15" />
          <span className="bg-k-ink/80" />
          <span className="bg-k-ink/15" />
          <span className="bg-k-ink/15" />
        </span>
      );
    case "chart":
      return (
        <span className={clsx(box, "items-end")}>
          <span className="h-[40%] flex-1 bg-k-ink/25" />
          <span className="h-[70%] flex-1 bg-k-ink/80" />
          <span className="h-[55%] flex-1 bg-k-ink/25" />
          <span className="h-[90%] flex-1 bg-k-ink/25" />
        </span>
      );
    case "summary":
      return (
        <span className={clsx(box, "flex-col")}>
          <span className="h-[3px] w-2/3 bg-k-ink/80" />
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-1 items-center gap-[3px]">
              <span className="h-[3px] w-[3px] bg-k-ink/70" />
              <span className="h-[3px] flex-1 bg-k-ink/25" />
            </span>
          ))}
        </span>
      );
    case "agenda":
      return (
        <span className={clsx(box, "flex-col")}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={clsx("flex flex-1 items-center gap-[3px] px-[2px]", i === 1 && "bg-k-ink/80")}>
              <span className={clsx("h-[3px] w-[4px]", i === 1 ? "bg-k-panel" : "bg-k-ink/60")} />
              <span className={clsx("h-[3px] flex-1", i === 1 ? "bg-k-panel/80" : "bg-k-ink/25")} />
            </span>
          ))}
        </span>
      );
    case "grid":
      return (
        <span className={clsx(box, "grid grid-cols-3 grid-rows-2")}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="border-t-2 border-k-ink/70 bg-k-ink/15" />
          ))}
        </span>
      );
    case "kpi":
      return (
        <span className={clsx(box, "items-center")}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-1 flex-col gap-[3px]">
              <span className={clsx("h-[8px] w-3/4", i === 0 ? "bg-k-ink/80" : "bg-k-ink/45")} />
              <span className="h-[2px] w-1/2 bg-k-ink/25" />
            </span>
          ))}
        </span>
      );
    case "statement":
      return (
        <span className={box}>
          <span className={clsx("flex-[2]", b)} />
          <span className="flex flex-[3] flex-col justify-center gap-[3px]">
            <span className={clsx("h-[3px]", "bg-k-ink/40")} />
            <span className={clsx("h-[3px] w-2/3", "bg-k-ink/40")} />
          </span>
        </span>
      );
    default:
      return <span className={box} />;
  }
}

export function LogicPanel() {
  const tab = useKata((s) => s.logicTab);
  const setTab = useKata((s) => s.setLogicTab);
  const view = useDeckView();
  if (!view) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3">
        <div role="tablist" aria-label={tx("論理構成", "Structure")} className="grid grid-cols-2 rounded-lg bg-k-seg p-0.5">
          {(
            [
              ["deck", tx("全体の構成", "Whole deck")],
              ["page", tx("このページ（{n}）", "This page ({n})", { n: String(view.index + 1).padStart(2, "0") })],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={clsx("h-7 rounded-md text-[12px] font-medium transition-colors", tab === id ? "bg-k-panel text-k-ink shadow-sm" : "text-k-ink-3 hover:text-k-ink-2")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "deck" ? <DeckTab /> : <PageTab />}
    </div>
  );
}

function DeckTab() {
  const view = useDeckView()!;
  const setStoryline = useKata((s) => s.setStoryline);
  const editDeck = useKata((s) => s.editDeck);
  const moveSlide = useKata((s) => s.moveSlide);
  const deleteSlide = useKata((s) => s.deleteSlide);
  const setCurrent = useKata((s) => s.setCurrent);
  const pushMessage = useKata((s) => s.pushMessage);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const { deck, index } = view;
  const options = roleOptions(deck.storyline);
  const auto = rolesFor(deck.storyline, deck.slides.length, deck.slides[0]?.layout === "cover");

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-4">
      <section>
        <h3 className="mb-2 text-[12px] font-semibold">{tx("資料の使い方", "How it will be used")}</h3>
        <div role="radiogroup" aria-label={tx("資料の使い方", "How it will be used")} className="grid grid-cols-2 gap-2">
          {(
            [
              ["present", tx("話す資料", "Presented"), tx("見せながら話す。1枚の文字は少なく", "You talk over it — keep text light")],
              ["read", tx("読む資料", "Read-ahead"), tx("配って読ませる（Slidedocs）。文章で伝える", "Sent to be read (Slidedocs) — text carries it")],
            ] as const
          ).map(([id, name, desc]) => {
            const on = (deck.mode ?? "present") === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => editDeck((d) => ({ ...d, mode: id }))}
                className={clsx("flex flex-col gap-1 rounded-xl p-2.5 text-left", on ? "bg-k-chosen ring-2 ring-k-ink" : "ring-1 ring-k-line hover:ring-k-ink-3")}
              >
                <span className="text-[12px] font-semibold">{name}</span>
                <span className="text-[10px] leading-snug text-k-ink-3">{desc}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[12px] font-semibold">{tx("語る順番の型", "Storyline")}</h3>
        <div className="grid grid-cols-2 gap-2">
          {STORYLINES.map((s) => {
            const on = deck.storyline === s.id;
                        return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (on) return;
                  setStoryline(s.id);
                  pushMessage({ from: "kata", text: tx("「{name}」の順に組み直しました。手で付け替えた役割はそのまま残しています。", "Reordered as “{name}”. Roles you set by hand are kept.", { name: s.name }) });
                }}
                className={clsx("flex flex-col gap-2 rounded-xl p-2.5 text-left", on ? "bg-k-chosen ring-2 ring-k-ink" : "ring-1 ring-k-line hover:ring-k-ink-3")}
              >
                <span className="text-[12px] font-semibold leading-tight">{s.name}</span>
                <span className="flex flex-wrap items-center gap-1 text-[10px] text-k-ink-2">
                  {s.roles.slice(1, -1).map((r, i) => (
                    <span key={r} className="flex items-center gap-1">
                      {i > 0 ? <span className="text-k-ink-3">→</span> : null}
                      <span className={clsx("rounded px-1 py-px", i === s.roles.length - 3 ? "bg-k-primary text-k-on-primary" : "bg-k-ink/10")}>{roleLabel(r).replace(/（.*）/, "").replace(/ \(.*\)$/, "")}</span>
                    </span>
                  ))}
                </span>
                <span className="text-[10px] text-k-ink-3">{s.desc}</span>
                {s.basis ? <span className="font-mono text-[9px] text-k-ink-3/80">{s.basis}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => useKata.getState().setTitleRead(true)}
          className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-k-line-strong text-[12px] font-medium text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink"
        >
          {tx("タイトルだけで通し読みする", "Read through titles only")}
        </button>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[12px] font-semibold">{tx("ページの並びと役割", "Page order and roles")}</h3>
          <span className="text-[10px] text-k-ink-3">{tx("ドラッグ／Alt + ↑↓ で並べ替え", "Drag or Alt + ↑↓ to reorder")}</span>
        </div>
        <ol className="flex flex-col">
          {deck.slides.map((s, i) => (
            <li
              key={s.id}
              draggable
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
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
              className={clsx(
                "group grid grid-cols-[14px_22px_92px_minmax(0,1fr)_24px] items-center gap-1.5 rounded-lg px-1 py-1.5",
                i === index ? "bg-k-selected" : "hover:bg-k-hover",
                drag === i && "opacity-40",
                over === i && drag !== null && drag !== i && "shadow-[inset_0_2px_0_var(--k-ink)]",
              )}
            >
              <GripVertical size={12} className="cursor-grab text-k-ink-3" aria-hidden="true" />
              <span className="font-mono text-[10px] text-k-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <select
                aria-label={tx("{n}枚目の役割", "Role of slide {n}", { n: i + 1 })}
                title={s.role ? tx("手で決めた役割", "Role set by hand") : tx("語る順番の型から自動で決めた役割", "Role set automatically from the storyline")}
                value={s.role ?? ""}
                onChange={(e) => editDeck((d) => setRole(d, s.id, e.target.value || undefined))}
                className={clsx("h-6 w-full rounded-md border px-1 text-[11px]", s.role ? "border-k-ink bg-k-panel font-semibold" : "border-k-line bg-k-panel-2 text-k-ink-2")}
              >
                <option value="">{s.role ? tx("自動に戻す（{role}）", "Reset to auto ({role})", { role: roleLabel(auto[i]) }) : roleLabel(auto[i])}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {roleLabel(o)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCurrent(i)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    e.stopPropagation();
                    moveSlide(i, e.key === "ArrowUp" ? i - 1 : i + 1);
                  }
                }}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className="line-clamp-2 text-left text-[12px] leading-snug text-k-ink"
                title={tx("{title}（Alt + ↑↓ で並べ替え）", "{title} (Alt + ↑↓ to reorder)", { title: s.title })}
              >
                {s.title || <span className="text-k-ink-3">{tx("（タイトル未入力）", "(Untitled)")}</span>}
              </button>
              <button type="button" aria-label={tx("{n}枚目を削除", "Delete slide {n}", { n: i + 1 })} onClick={() => deleteSlide(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-k-ink-3 opacity-0 transition-opacity hover:bg-k-panel hover:text-k-danger focus:opacity-100 group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => {
            editDeck((d) => insertSlide(d, index, { id: newId("s"), title: "", layout: "statement", content: { statement: { lead: "", figure: "" } } }));
            setCurrent(index + 1);
          }}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-k-line-strong text-[12px] text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink"
        >
          <Plus size={13} /> {tx("選んでいるページの後ろに1枚足す", "Add a slide after the selected page")}
        </button>
      </section>
    </div>
  );
}

function PageTab() {
  const view = useDeckView()!;
  const setLayout = useKata((s) => s.setLayout);
  const editDeck = useKata((s) => s.editDeck);
  const { slide, index, deck } = view;
  const options = roleOptions(deck.storyline);
  const auto = rolesFor(deck.storyline, deck.slides.length, deck.slides[0]?.layout === "cover");
  const special = slide.layout === "cover" || slide.layout === "closing";
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-4">
      <section className="rounded-xl bg-k-panel-2 p-3 ring-1 ring-k-line">
        <div className="mb-1 font-mono text-[10px] tracking-[0.08em] text-k-ink-3">{String(index + 1).padStart(2, "0")} — {tx("タイトル（主張）", "Title (claim)")}</div>
        <p className="text-[13px] font-medium leading-relaxed">{slide.title || tx("（タイトル未入力）", "(Untitled)")}</p>
        <label className="mt-3 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-k-ink-2">{tx("このページの役割", "Role of this page")}</span>
          <select
            value={slide.role ?? ""}
            onChange={(e) => editDeck((d) => setRole(d, slide.id, e.target.value || undefined))}
            className="h-7 rounded-md border border-k-line-strong bg-k-panel px-2 text-[12px]"
          >
            <option value="">{slide.role ? tx("自動に戻す（{role}）", "Reset to auto ({role})", { role: roleLabel(auto[index]) }) : tx("自動：{role}", "Auto: {role}", { role: roleLabel(auto[index]) })}</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {roleLabel(o)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {slide.layout === "chart" ? <ChartEditor slide={slide} /> : null}
      <section>
        <h3 className="mb-1 text-[12px] font-semibold">{tx("ページの中の論理", "Logic within the page")}</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-k-ink-3">{tx("主張はそのままで、中身の並べ方だけを組み替えます。前の型で書いた中身は残るので、戻せば元通りです。", "Keeps the claim and rearranges only the content. What you wrote in the previous layout is kept, so switching back restores it.")}</p>
        <div className="flex flex-col gap-1.5">
          {LAYOUTS.filter((l) => l.logic || l.id === slide.layout || (special && (l.id === "cover" || l.id === "closing"))).map((l) => {
            const on = slide.layout === l.id;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => setLayout(slide.id, l.id)}
                className={clsx("flex items-center gap-3 rounded-xl p-2 text-left", on ? "bg-k-chosen ring-2 ring-k-ink" : "ring-1 ring-k-line hover:ring-k-ink-3")}
              >
                <LayoutGlyph id={l.id} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">{l.name}</span>
                  <span className="text-[11px] text-k-ink-3">{l.desc}</span>
                  {l.basis ? <span className="font-mono text-[9px] tracking-[0.02em] text-k-ink-3/80">{l.basis}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
