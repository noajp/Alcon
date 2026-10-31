"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, Lock, MoreHorizontal, Pencil, Save, Shuffle } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { LOOKS } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";
import { paletteFromPixels } from "@/ActivitySpace/sustainment/slides/kata/theme/custom";
import { themeFromPptx, tokensFromTheme } from "@/ActivitySpace/sustainment/slides/kata/theme/pptxTheme";
import { LookEditor } from "./LookEditor";
import { SlideScaler, SlideView } from "@/ActivitySpace/sustainment/slides/kata/components/slides/SlideView";
import { DisclosureTriangle } from "@/Function/shared/DisclosureTriangle";
import { MIX_ELEMENTS, assignSources, mixTokens, mixWarnings } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
import type { Look, MixElement } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

function Swatch({ look, el }: { look: Look; el: MixElement }) {
  const t = look.tokens;
  switch (el) {
    case "ground":
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-black/10 text-[10px] font-bold" style={{ background: t.ground.bg, color: t.ground.ink }}>
          A
        </span>
      );
    case "type":
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-k-line bg-k-panel text-[11px] text-k-ink" style={{ fontFamily: t.type.display, fontWeight: t.type.weight }}>
          あ
        </span>
      );
    case "accent":
      return <span className="block h-5 w-5 rounded-[4px] border border-black/10" style={{ background: t.accent.accent }} />;
    case "number":
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-black/10 text-[10px] font-bold" style={{ background: t.number.block, color: t.number.num }}>
          9
        </span>
      );
    case "shape":
      return <span className="block h-5 w-5 border-[1.5px] border-k-ink bg-k-panel" style={{ borderRadius: Math.min(t.shape.radius, 10) }} />;
  }
}

type View = NonNullable<ReturnType<typeof useDeckView>>;

/** その世界観で、いま開いているページを描いた見本。選ぶ前に仕上がりが見える */
function LookThumb({ look, view }: { look: Look; view: View }) {
  return (
    <SlideScaler width={THUMB_W} className="rounded-[6px] shadow-[0_0_0_1px_var(--k-line)]">
      <SlideView slide={view.slide} index={view.index} role={view.roles[view.index]} tokens={look.tokens} lang={view.lang} />
    </SlideScaler>
  );
}

const THUMB_W = 140;

export function DesignPanel() {
  const view = useDeckView();
  const chooseLook = useKata((s) => s.chooseLook);
  const toggleLook = useKata((s) => s.toggleLook);
  const setPreview = useKata((s) => s.setPreviewLook);
  const pinElement = useKata((s) => s.pinElement);
  const remix = useKata((s) => s.remix);
  const custom = useKata((s) => s.customLooks);
  const saveLook = useKata((s) => s.saveLook);
  const [editing, setEditing] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const [menu, setMenu] = useState(false);
  const [mixOpen, setMixOpen] = useState<boolean | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 見本の上から離れたら、仮の見せ方をやめる（パネルを閉じたときも）
  useEffect(() => () => setPreview(null), [setPreview]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  if (!view) return null;
  const { file, looks } = view;
  const mix = file.mix;
  const src = assignSources(mix, looks);
  const tokens = mixTokens(mix, looks);

  const importFile = async (f: File) => {
    setImportError("");
    if (/\.(pptx|potx)$/i.test(f.name)) {
      try {
        const th = await themeFromPptx(await f.arrayBuffer());
        if (!th) throw new Error("no theme");
        const id = saveLook(f.name.replace(/\.[^.]+$/, "").slice(0, 16) || th.name, tokensFromTheme(th), "import");
        setEditing(id);
      } catch {
        setImportError(tx("この PowerPoint からテーマを読み取れませんでした。", "Couldn't read a theme from this PowerPoint file."));
      }
      return;
    }
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      const k = Math.min(1, 96 / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const px: [number, number, number][] = [];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
      const id = saveLook(f.name.replace(/\.[^.]+$/, "").slice(0, 16) || tx("取り込み", "Imported"), paletteFromPixels(px), "import");
      setEditing(id);
    } catch {
      setImportError(tx("この画像は読み取れませんでした。PNG か JPEG、または .pptx で試してください。", "Couldn't read this image. Try a PNG, JPEG, or .pptx."));
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const all = [...custom, ...LOOKS];
  const warnings = mixWarnings(tokens);
  const mixed = mix.selected.length > 1;
  const showMix = mixOpen ?? mixed;
  const menuItem = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink";

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="sticky top-0 z-20 flex h-10 shrink-0 items-center justify-between bg-k-panel pl-4 pr-2">
        <h3 className="text-[12px] font-semibold">{tx("世界観", "Looks")}</h3>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={tx("その他", "More")}
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className={clsx("flex h-7 w-7 items-center justify-center rounded-md text-k-ink-3 hover:bg-k-hover hover:text-k-ink", menu && "bg-k-hover text-k-ink")}
          >
            <MoreHorizontal size={15} />
          </button>
          {menu ? (
            <div className="anim-in absolute right-0 top-8 z-30 w-[220px] rounded-lg border border-k-line bg-k-panel p-1.5 shadow-[var(--shadow-pop)]">
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenu(false);
                  const id = saveLook(tx("ミックス {n}", "Mix {n}", { n: custom.length + 1 }), tokens, "mine");
                  useKata.getState().notify(tx("今のデザインをマイ世界観に保存しました", "Saved the current design to My looks"));
                  setEditing(id);
                }}
              >
                <Save size={14} /> {tx("今のデザインを保存", "Save current design")}
              </button>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenu(false);
                  imgRef.current?.click();
                }}
              >
                <ImagePlus size={14} /> {tx("画像・PPTX から作る", "Create from image / PPTX")}
              </button>
            </div>
          ) : null}
          <input
            ref={imgRef}
            type="file"
            accept="image/*,.pptx,.potx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {importError ? <p className="mx-3 mb-2 rounded-lg bg-k-danger-tint px-3 py-2 text-[11px] text-k-danger">{importError}</p> : null}

      <div className="grid grid-cols-2 gap-x-2 gap-y-3 px-3 pb-3" onMouseLeave={() => setPreview(null)}>
        {all.map((look) => {
          const on = mix.selected.includes(look.id);
          const mine = custom.some((c) => c.id === look.id);
          return (
            <div key={look.id} className="group relative">
              <button
                type="button"
                aria-pressed={on}
                title={tx("クリックで適用・⇧クリックで組み合わせに加える", "Click to apply · Shift-click to combine")}
                onMouseEnter={() => setPreview(look.id)}
                onFocus={() => setPreview(look.id)}
                onBlur={() => setPreview(null)}
                onClick={(e) => {
                  setPreview(null);
                  if (e.shiftKey || e.metaKey || e.ctrlKey) toggleLook(look.id);
                  else chooseLook(look.id);
                }}
                className="flex w-full flex-col gap-1.5 text-left"
              >
                <span
                  className={clsx(
                    "block rounded-[8px] p-[3px] transition-shadow",
                    on ? "shadow-[0_0_0_2px_var(--k-lime)]" : "group-hover:shadow-[0_0_0_2px_var(--k-line-strong)]",
                  )}
                >
                  <LookThumb look={look} view={view} />
                </span>
                <span className="flex items-center gap-1.5 px-1">
                  <span className={clsx("truncate text-[11.5px]", on ? "font-semibold text-k-ink" : "text-k-ink-2")}>{look.name}</span>
                  {look.source !== "official" ? <span className="shrink-0 text-[10px] text-k-ink-3">{look.source === "import" ? tx("取り込み", "Imported") : tx("マイ", "Mine")}</span> : null}
                </span>
              </button>
              {mine ? (
                <button
                  type="button"
                  aria-label={tx("{name}を編集", "Edit {name}", { name: look.name })}
                  onClick={() => setEditing(look.id)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-k-panel/90 text-k-ink-2 opacity-0 shadow-sm hover:text-k-ink group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="border-t border-k-line px-4 py-2">
        <div className="flex h-8 items-center justify-between">
          <button type="button" aria-expanded={showMix} onClick={() => setMixOpen(!showMix)} className="flex items-center gap-1.5 text-[12px] font-semibold text-k-ink">
            <DisclosureTriangle open={showMix} className="text-k-ink-3" />
            {tx("組み合わせる", "Combine")}
            {mixed ? <span className="font-normal text-k-ink-3">{mix.selected.length}</span> : null}
          </button>
          {showMix && mixed ? (
            <button
              type="button"
              onClick={remix}
              aria-label={tx("おまかせで混ぜ直す", "Remix automatically")}
              title={tx("おまかせで混ぜ直す", "Remix automatically")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-k-ink-3 hover:bg-k-hover hover:text-k-ink"
            >
              <Shuffle size={13} />
            </button>
          ) : null}
        </div>
        {showMix ? (
          mixed ? (
            <div className="flex flex-col pb-2">
              {MIX_ELEMENTS.map((el) => {
                const pinned = !!mix.pins[el.key] && mix.selected.includes(mix.pins[el.key]!);
                return (
                  <div key={el.key} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 py-1.5">
                    <span className="flex items-center gap-1 text-[11.5px] text-k-ink-2">
                      {el.label}
                      {pinned ? <Lock size={9} className="text-k-ink-3" aria-label={tx("固定", "Locked")} /> : null}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {mix.selected.map((id) => {
                        const look = looks[id];
                        if (!look) return null;
                        const active = src[el.key] === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={active}
                            aria-label={tx("{label}：{name}", "{label}: {name}", { label: el.label, name: look.name })}
                            title={look.name}
                            onClick={() => pinElement(el.key, pinned && active ? null : id)}
                            className={clsx("flex rounded-[6px] p-[2px] transition-shadow", active ? "shadow-[0_0_0_1.5px_var(--k-lime)]" : "opacity-60 hover:opacity-100")}
                          >
                            <Swatch look={look} el={el.key} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] leading-relaxed text-k-ink-3">{tx("押した要素はその世界観で固定されます。", "Click a swatch to lock that element to its look.")}</p>
            </div>
          ) : (
            <p className="pb-2 text-[11px] leading-relaxed text-k-ink-3">
              {tx("⇧クリックで世界観を重ねると、地・書体・強調色などを要素ごとに混ぜられます。", "Shift-click more looks to mix ground, type, accent and more, element by element.")}
            </p>
          )
        ) : null}
        {warnings.length ? (
          <div className="mb-2 flex flex-col gap-1 rounded-lg bg-k-danger-tint px-3 py-2 text-[11px] leading-relaxed text-k-danger">
            {warnings.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        ) : null}
      </section>
      {editing ? <LookEditor lookId={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
