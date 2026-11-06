"use client";

import { useFocusTrap } from "@/ActivitySpace/artifacts/slides/kata/components/ui/useFocusTrap";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Trash2, X } from '@/ui/icons';
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/artifacts/slides/kata/components/useDeckView";
import { SlideScaler, SlideView } from "@/ActivitySpace/artifacts/slides/kata/components/slides/SlideView";
import { FONT_CHOICES, deriveTokens } from "@/ActivitySpace/artifacts/slides/kata/theme/custom";
import { mixWarnings } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import type { LookTokens } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

const shapes = () => [
  { r: 0, name: tx("角", "Square") },
  { r: 6, name: tx("少し丸", "Soft") },
  { r: 16, name: tx("丸", "Round") },
  { r: 999, name: tx("ピル", "Pill") },
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-k-ink-2">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-k-ink-3">{value.toUpperCase()}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded-md border border-k-line-strong bg-k-panel p-0.5" />
      </span>
    </label>
  );
}

/** 自分の世界観を、5つの要素ごとに直す。変えたそばから反映する */
export function LookEditor({ lookId, onClose: close }: { lookId: string; onClose: () => void }) {
  const onClose = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    close();
  };
  const look = useKata((s) => s.customLooks.find((l) => l.id === lookId));
  const updateLook = useKata((s) => s.updateLook);
  const deleteLook = useKata((s) => s.deleteLook);
  const toggleLook = useKata((s) => s.toggleLook);
  const view = useDeckView();
  const [confirm, setConfirm] = useState(false);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, !!look && !!view);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur?.();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  if (!look || !view) return null;
  const t = look.tokens;
  const set = (fn: (t: LookTokens) => LookTokens) => updateLook(look.id, { tokens: deriveTokens(fn(t)) });
  const warnings = mixWarnings(t);
  const inUse = view.file.mix.selected.includes(look.id);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tx("世界観を編集", "Edit look")} className="anim-in flex max-h-[90vh] w-[880px] overflow-hidden rounded-lg bg-k-panel shadow-[var(--shadow-pop)]">
        <div className="flex flex-1 flex-col gap-4 bg-k-stage p-6">
          <div className="font-mono text-[10px] tracking-[0.1em] text-k-ink-3">PREVIEW — {String(view.index + 1).padStart(2, "0")}</div>
          <div className="overflow-hidden rounded-md shadow-[var(--shadow-slide)]">
            <SlideScaler width={480}>
              <SlideView slide={view.slide} index={view.index} role={view.roles[view.index]} tokens={t} lang={view.lang} />
            </SlideScaler>
          </div>
          {warnings.length ? (
            <div className="flex flex-col gap-1 rounded-lg bg-k-danger-tint px-3 py-2 text-[11px] leading-relaxed text-k-danger">
              {warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-k-ink-3">{tx("色の組み合わせに見づらいところはありません。", "No contrast issues in this color combination.")}</p>
          )}
          <div className="mt-auto flex items-center gap-2">
            {!inUse ? (
              <button type="button" onClick={() => toggleLook(look.id)} className="h-9 rounded-lg bg-k-primary px-4 text-[12px] font-medium text-k-on-primary">
                {tx("この資料のミックスに加える", "Add to this deck's mix")}
              </button>
            ) : (
              <span className="text-[12px] text-k-ink-2">{tx("この資料のミックスに入っています", "In this deck's mix")}</span>
            )}
          </div>
        </div>
        <div className="scroll-thin flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.1em] text-k-ink-3">{look.source === "import" ? "IMPORTED LOOK" : "MY LOOK"}</span>
            <button type="button" aria-label={tx("閉じる", "Close")} onClick={onClose} className="rounded-md p-1 text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
              <X size={16} />
            </button>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold">{tx("名前", "Name")}</span>
            <input defaultValue={look.name} onBlur={(e) => updateLook(look.id, { name: e.target.value })} className="h-9 rounded-lg border border-k-line-strong px-3 text-[13px]" />
          </label>

          <section className="flex flex-col gap-2.5">
            <h4 className="text-[12px] font-semibold">{tx("地と文字", "Ground & ink")}</h4>
            <ColorField label={tx("地", "Background")} value={t.ground.bg} onChange={(v) => set((x) => ({ ...x, ground: { ...x.ground, bg: v } }))} />
            <ColorField label={tx("文字", "Text")} value={t.ground.ink} onChange={(v) => set((x) => ({ ...x, ground: { ...x.ground, ink: v } }))} />
          </section>
          <section className="flex flex-col gap-2.5">
            <h4 className="text-[12px] font-semibold">{tx("書体", "Type")}</h4>
            <div className="grid grid-cols-3 gap-1.5">
              {FONT_CHOICES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={t.type.display === f.display}
                  onClick={() => set((x) => ({ ...x, type: { ...x.type, display: f.display, weight: f.weight, tracking: f.tracking } }))}
                  className={clsx("flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px]", t.type.display === f.display ? "border-k-ink bg-k-chosen" : "border-k-line hover:border-k-ink-3")}
                >
                  <span style={{ fontFamily: f.display, fontWeight: f.weight, fontSize: 18 }}>あA</span>
                  {f.name}
                </button>
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-2.5">
            <h4 className="text-[12px] font-semibold">{tx("強調色", "Accent")}</h4>
            <ColorField label={tx("強調", "Accent")} value={t.accent.accent} onChange={(v) => set((x) => ({ ...x, accent: { ...x.accent, accent: v } }))} />
          </section>
          <section className="flex flex-col gap-2.5">
            <h4 className="text-[12px] font-semibold">{tx("数字", "Numbers")}</h4>
            <ColorField label={tx("数字の地", "Number fill")} value={t.number.block} onChange={(v) => set((x) => ({ ...x, number: { ...x.number, block: v } }))} />
            <ColorField label={tx("数字", "Number")} value={t.number.num} onChange={(v) => set((x) => ({ ...x, number: { ...x.number, num: v } }))} />
          </section>
          <section className="flex flex-col gap-2.5">
            <h4 className="text-[12px] font-semibold">{tx("形", "Shape")}</h4>
            <div className="grid grid-cols-4 gap-1.5">
              {shapes().map((sh) => (
                <button
                  key={sh.r}
                  type="button"
                  aria-pressed={t.shape.radius === sh.r}
                  onClick={() => set((x) => ({ ...x, shape: { radius: sh.r } }))}
                  className={clsx("flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-[10px]", t.shape.radius === sh.r ? "border-k-ink bg-k-chosen" : "border-k-line hover:border-k-ink-3")}
                >
                  <span className="h-4 w-6 border-[1.5px] border-k-ink" style={{ borderRadius: Math.min(sh.r, 8) }} />
                  {sh.name}
                </button>
              ))}
            </div>
          </section>

          <div className="mt-auto border-t border-k-line pt-4">
            {confirm ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-k-danger-tint px-3 py-2 text-[12px] text-k-danger">
                <span>{tx("この世界観を削除しますか", "Delete this look?")}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      deleteLook(look.id);
                      onClose();
                    }}
                    className="rounded-md bg-k-danger px-2 py-0.5 font-medium text-k-on-danger"
                  >
                    {tx("削除", "Delete")}
                  </button>
                  <button type="button" onClick={() => setConfirm(false)} className="rounded-md px-2 py-0.5 text-k-ink-2 hover:bg-k-panel">
                    {tx("やめる", "Cancel")}
                  </button>
                </span>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="flex items-center gap-1.5 text-[12px] text-k-ink-3 hover:text-k-danger">
                <Trash2 size={13} /> {tx("この世界観を削除", "Delete this look")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
