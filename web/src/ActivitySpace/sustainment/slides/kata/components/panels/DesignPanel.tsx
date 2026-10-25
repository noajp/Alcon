"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { Check, ImagePlus, Lock, Pencil, Save, Shuffle } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { LOOKS } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";
import { paletteFromPixels } from "@/ActivitySpace/sustainment/slides/kata/theme/custom";
import { themeFromPptx, tokensFromTheme } from "@/ActivitySpace/sustainment/slides/kata/theme/pptxTheme";
import { LookEditor } from "./LookEditor";
import { MIX_ELEMENTS, assignSources, mixWarnings } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
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
      return <span className="h-5 w-5 rounded-[4px] border border-black/10" style={{ background: t.accent.accent }} />;
    case "number":
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-black/10 text-[10px] font-bold" style={{ background: t.number.block, color: t.number.num }}>
          9
        </span>
      );
    case "shape":
      return <span className="h-5 w-5 border-[1.5px] border-k-ink bg-k-panel" style={{ borderRadius: Math.min(t.shape.radius, 10) }} />;
  }
}

/** 世界観の見本：地と文字・書体・数字・強調色・形が一目でわかる小さな札 */
function Specimen({ look }: { look: Look }) {
  const t = look.tokens;
  return (
    <span className="relative block h-[92px] overflow-hidden rounded-[5px] border border-black/10" style={{ background: t.ground.bg, color: t.ground.ink }}>
      <span className="absolute left-3 top-2.5 text-[26px] leading-none" style={{ fontFamily: t.type.display, fontWeight: t.type.weight, letterSpacing: t.type.tracking }}>
        Aa あ
      </span>
      <span className="absolute left-3 top-[42px] h-[3px] w-6" style={{ background: t.accent.accent, boxShadow: `0 0 0 1px color-mix(in srgb, ${t.ground.ink} 25%, transparent)` }} />
      <span className="absolute bottom-2.5 left-3 flex flex-col gap-1">
        <span className="h-[3px] w-14 opacity-70" style={{ background: t.ground.ink }} />
        <span className="h-[3px] w-10 opacity-30" style={{ background: t.ground.ink }} />
      </span>
      <span
        className="absolute bottom-2.5 right-2.5 flex h-11 w-16 items-center justify-center text-[15px] font-extrabold"
        style={{ background: t.number.block, color: t.number.num, borderRadius: Math.min(t.shape.radius, 12), fontFamily: "var(--font-inter), sans-serif", boxShadow: `0 0 0 1px color-mix(in srgb, ${t.ground.ink} 18%, transparent)` }}
      >
        62%
      </span>
      <span className="absolute right-2.5 top-2.5 h-5 w-5" style={{ background: t.accent.accent, borderRadius: Math.min(t.shape.radius, 10), boxShadow: `0 0 0 1px color-mix(in srgb, ${t.ground.ink} 25%, transparent)` }} />
    </span>
  );
}

export function DesignPanel() {
  const view = useDeckView();
  const toggleLook = useKata((s) => s.toggleLook);
  const pinElement = useKata((s) => s.pinElement);
  const remix = useKata((s) => s.remix);
  const custom = useKata((s) => s.customLooks);
  const saveLook = useKata((s) => s.saveLook);
  const [editing, setEditing] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const imgRef = useRef<HTMLInputElement>(null);
  if (!view) return null;
  const { file, tokens, looks } = view;
  const mix = file.mix;
  const src = assignSources(mix, looks);

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

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="border-b border-k-line px-4 pb-4 pt-3">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-[12px] font-semibold">{tx("世界観", "Looks")}</h3>
          <span className="text-[11px] text-k-ink-3">{tx("いくつでも選べます", "Pick as many as you like")}</span>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => {
              const id = saveLook(tx("ミックス {n}", "Mix {n}", { n: custom.length + 1 }), tokens, "mine");
              useKata.getState().notify(tx("今のミックスをマイ世界観に保存しました", "Saved the current mix to My looks"));
              setEditing(id);
            }}
            className="flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium text-k-ink-3 hover:bg-k-hover hover:text-k-ink"
          >
            <Save size={13} /> {tx("今のミックスを保存", "Save current mix")}
          </button>
          <button type="button" onClick={() => imgRef.current?.click()} className="flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
            <ImagePlus size={13} /> {tx("画像・PPTX から", "From image / PPTX")}
          </button>
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
        {importError ? <p className="mb-3 rounded-lg bg-k-danger-tint px-3 py-2 text-[11px] text-k-danger">{importError}</p> : null}
        <div className="grid grid-cols-2 gap-2.5">
          {all.map((look) => {
            const on = mix.selected.includes(look.id);
            const uses = MIX_ELEMENTS.filter((e) => src[e.key] === look.id).map((e) => e.label);
            return (
              <div key={look.id} className="relative">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLook(look.id)}
                  className={clsx("group relative flex w-full flex-col gap-1.5 rounded-lg p-1.5 text-left transition-colors", on ? "bg-k-chosen ring-[1.5px] ring-k-lime" : "hover:bg-k-hover")}
                >
                  <Specimen look={look} />
                  <span className="flex items-center justify-between gap-1 px-0.5 pr-6">
                    <span className="truncate text-[12px] font-semibold">{look.name}</span>
                    {look.source !== "official" ? <span className="font-mono text-[9px] text-k-ink-3">{look.source === "import" ? "IMPORT" : "MINE"}</span> : null}
                  </span>
                  <span className={clsx("min-h-[14px] truncate px-0.5 text-[10px]", on ? "text-k-lime-deep" : "text-k-ink-3")}>{on ? (uses.length ? uses.join(tx("・", " · ")) : tx("選択中・未使用", "Selected · unused")) : look.tags.join(" ・ ")}</span>
                  {on ? (
                    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-k-primary text-k-check ring-2 ring-k-panel">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
                {custom.some((c) => c.id === look.id) ? (
                  <button
                    type="button"
                    aria-label={tx("{name}を編集", "Edit {name}", { name: look.name })}
                    onClick={() => setEditing(look.id)}
                    className="absolute bottom-[26px] right-2 flex h-6 w-6 items-center justify-center rounded-md text-k-ink-3 hover:bg-k-panel hover:text-k-ink"
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold">{tx("要素ごとのミックス", "Mix by element")}</h3>
          <button type="button" onClick={remix} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-k-line-strong px-2 text-[11px] font-medium text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink">
            <Shuffle size={12} /> {tx("おまかせで混ぜ直す", "Remix automatically")}
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-k-ink-3">{tx("押すと、その要素はその世界観で固定されます。もう一度押すと固定を外します。", "Click to lock an element to that look. Click again to unlock.")}</p>
        <div className="flex flex-col">
          {MIX_ELEMENTS.map((el) => {
            const pinned = mix.pins[el.key] && mix.selected.includes(mix.pins[el.key]!);
            return (
              <div key={el.key} className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 border-b border-k-line py-2 last:border-0">
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium">{el.label}</span>
                  <span className={clsx("flex items-center gap-1 text-[10px]", pinned ? "text-k-ink" : "text-k-ink-3")}>
                    {pinned ? <Lock size={9} /> : null}
                    {pinned ? tx("固定", "Locked") : tx("おまかせ", "Auto")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
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
                        onClick={() => pinElement(el.key, pinned && active ? null : id)}
                        className={clsx("flex h-8 items-center gap-1.5 rounded-lg border px-1.5 pr-2 text-[11px]", active ? "border-k-ink bg-k-panel text-k-ink" : "border-k-line text-k-ink-3 hover:border-k-ink-3")}
                      >
                        <Swatch look={look} el={el.key} />
                        {look.name.split("・").at(-1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {warnings.length ? (
          <div className="mt-3 flex flex-col gap-1 rounded-lg bg-k-danger-tint px-3 py-2 text-[11px] leading-relaxed text-k-danger">
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
