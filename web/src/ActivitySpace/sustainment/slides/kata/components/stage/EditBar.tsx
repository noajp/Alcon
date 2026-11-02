"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  BringToFront,
  Circle,
  Copy,
  ImagePlus,
  Italic,
  Minus,
  MoreHorizontal,
  Plus,
  RotateCcw,
  SendToBack,
  Slash,
  Square,
  Trash2,
  Type,
  Underline,
} from '@/ui/icons';
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { useDeckView } from "@/ActivitySpace/sustainment/slides/kata/components/useDeckView";
import { updateSlide } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import {
  COLOR_REFS,
  FONT_REFS,
  addObject,
  colorLabel,
  duplicateObject,
  fontLabel,
  hexColor,
  isLineKind,
  makeObject,
  reorderObject,
  removeObject,
  setTextStyle,
  updateObject,
} from "@/ActivitySpace/sustainment/slides/kata/model/objects";
import type { ColorRef, FontRef, LookTokens, ObjectKind, SlideObject, TextStyle } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

// 書式のボタンは押しても文字から焦点を外さない（選んだ文字のまま書式を変えられるように）
const keep = (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
};

function Btn({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keep}
      onClick={onClick}
      className={clsx("flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-k-ink-2 hover:bg-k-hover hover:text-k-ink disabled:opacity-30", active && "bg-k-chosen text-k-ink")}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-k-line-strong" />;

function Popover({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const close = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={!!pos}
        onMouseDown={keep}
        onClick={() => {
          if (pos) return setPos(null);
          const r = btnRef.current?.getBoundingClientRect();
          // ツールバーは横にはみ出す分を隠すので、開いた中身は body に出して画面の中に収める
          if (r) setPos({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left, window.innerWidth - 300)) });
        }}
        className={clsx("flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink", pos && "bg-k-hover text-k-ink")}
      >
        {button}
      </button>
      {pos
        ? createPortal(
            <div ref={popRef} data-formatbar="true" onMouseDown={keep} style={{ top: pos.top, left: pos.left }} className="anim-in fixed z-[85] min-w-[180px] rounded-lg border border-k-line bg-k-panel p-2 shadow-[var(--shadow-pop)]">
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Swatch({ c, tokens }: { c: ColorRef; tokens: LookTokens }) {
  const hx = hexColor(c, tokens);
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-[4px] ring-1 ring-k-line-strong"
      style={hx ? { background: hx } : { background: "linear-gradient(135deg, transparent 45%, var(--k-danger) 45%, var(--k-danger) 55%, transparent 55%)" }}
    />
  );
}

/** 色を選ぶ：世界観の色（混ぜ直すと追従）か、好きな色 */
function ColorPicker({ label, value, tokens, onPick, allowNone = true, icon }: { label: string; value: ColorRef | undefined; tokens: LookTokens; onPick: (c: ColorRef) => void; allowNone?: boolean; icon?: ReactNode }) {
  const refs = COLOR_REFS.filter((c) => allowNone || c !== "none");
  return (
    <Popover
      label={label}
      button={
        <>
          {icon}
          <Swatch c={value ?? "ink"} tokens={tokens} />
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          <div className="px-1 pb-1 font-mono text-[10px] tracking-[0.08em] text-k-ink-3">{label.toUpperCase()}</div>
          <div className="grid grid-cols-3 gap-1">
            {refs.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={value === c}
                onMouseDown={keep}
                onClick={() => {
                  onPick(c);
                  close();
                }}
                className={clsx("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-k-ink-2 hover:bg-k-hover", value === c && "bg-k-chosen text-k-ink")}
              >
                <Swatch c={c} tokens={tokens} />
                <span className="truncate">{colorLabel(c)}</span>
              </button>
            ))}
          </div>
          <label className="mt-1 flex items-center justify-between gap-2 border-t border-k-line px-1 pt-2 text-[11px] text-k-ink-2">
            {tx("好きな色", "Custom")}
            <input
              type="color"
              // design-lint-ignore — <input type="color"> takes only #rrggbb; black is its empty value
value={hexColor(value, tokens) ?? "#000000"}
              onChange={(e) => onPick(e.target.value.toUpperCase() as ColorRef)}
              className="h-6 w-10 cursor-pointer rounded border border-k-line-strong bg-transparent"
            />
          </label>
        </div>
      )}
    </Popover>
  );
}

function FontPicker({ value, onPick }: { value: FontRef | undefined; onPick: (f: FontRef | undefined) => void }) {
  return (
    <Popover label={tx("書体", "Font")} button={<span className="max-w-[64px] truncate">{value ? fontLabel(value) : tx("書体", "Font")}</span>}>
      {(close) => (
        <div className="flex flex-col">
          {[undefined, ...FONT_REFS].map((f) => (
            <button
              key={f ?? "auto"}
              type="button"
              aria-pressed={value === f}
              onMouseDown={keep}
              onClick={() => {
                onPick(f);
                close();
              }}
              className={clsx("rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-k-hover", value === f && "bg-k-chosen")}
              style={{ fontFamily: f === "serif" ? "var(--font-noto-serif), serif" : f === "mono" ? "var(--font-plex-mono), monospace" : f === "sans" ? "var(--font-inter), sans-serif" : undefined }}
            >
              {f ? fontLabel(f) : tx("型のまま", "Layout default")}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 88, 104, 128];
const stepSize = (cur: number, d: 1 | -1) => (d > 0 ? (SIZES.find((s) => s > cur) ?? cur + 16) : ([...SIZES].reverse().find((s) => s < cur) ?? Math.max(8, cur - 2)));

function SizeControl({ size, onSize }: { size: number; onSize: (n: number) => void }) {
  return (
    <div className="flex h-7 items-center rounded-md border border-k-line-strong bg-k-panel">
      <Btn label={tx("文字を小さく", "Smaller text")} onClick={() => onSize(stepSize(size, -1))}>
        <Minus size={12} />
      </Btn>
      <span className="w-7 text-center font-mono text-[11px] text-k-ink">{Math.round(size)}</span>
      <Btn label={tx("文字を大きく", "Larger text")} onClick={() => onSize(stepSize(size, 1))}>
        <Plus size={12} />
      </Btn>
    </div>
  );
}

/** 文字の書式（型の文字にも、置いた文字にも） */
function TextControls({ style, size, tokens, onPatch }: { style: TextStyle; size: number; tokens: LookTokens; onPatch: (p: Partial<TextStyle>) => void }) {
  return (
    <>
      <FontPicker value={style.font} onPick={(f) => onPatch({ font: f })} />
      <SizeControl size={style.size ?? size} onSize={(n) => onPatch({ size: n })} />
      <Btn label={tx("太字", "Bold")} active={!!style.bold} onClick={() => onPatch({ bold: style.bold ? undefined : true })}>
        <Bold size={14} />
      </Btn>
      <Btn label={tx("斜体", "Italic")} active={!!style.italic} onClick={() => onPatch({ italic: style.italic ? undefined : true })}>
        <Italic size={14} />
      </Btn>
      <Btn label={tx("下線", "Underline")} active={!!style.underline} onClick={() => onPatch({ underline: style.underline ? undefined : true })}>
        <Underline size={14} />
      </Btn>
      <Popover label={tx("揃え", "Alignment")} button={style.align === "center" ? <AlignCenter size={14} /> : style.align === "right" ? <AlignRight size={14} /> : <AlignLeft size={14} />}>
        {(close) => (
          <div className="flex gap-0.5">
            {(["left", "center", "right"] as const).map((a) => (
              <Btn
                key={a}
                label={{ left: tx("左揃え", "Align left"), center: tx("中央揃え", "Align center"), right: tx("右揃え", "Align right") }[a]}
                active={style.align === a}
                onClick={() => {
                  onPatch({ align: style.align === a ? undefined : a });
                  close();
                }}
              >
                {a === "left" ? <AlignLeft size={14} /> : a === "center" ? <AlignCenter size={14} /> : <AlignRight size={14} />}
              </Btn>
            ))}
          </div>
        )}
      </Popover>
      <ColorPicker label={tx("文字の色", "Text color")} value={style.color} tokens={tokens} allowNone={false} icon={<Type size={13} />} onPick={(c) => onPatch({ color: c })} />
    </>
  );
}

/** 型の文字を選んでいるときの書式バー */
export function TextFormatBar() {
  const view = useDeckView();
  const focus = useKata((s) => s.textFocus);
  const editDeck = useKata((s) => s.editDeck);
  const key = focus?.key;
  const slide = view?.slide;
  const style = (slide && key && slide.styles?.[key]) || {};
  const size = focus?.size ?? 24;
  if (!view || !focus || !slide || focus.slideId !== slide.id) return null;
  const patch = (p: Partial<TextStyle>) => editDeck((d) => updateSlide(d, slide.id, (s) => setTextStyle(s, focus.key, p)), `style:${slide.id}:${focus.key}`);
  return (
    <div data-formatbar="true" role="toolbar" aria-label={tx("文字の書式", "Text format")} className="anim-in flex items-center gap-0.5">
      <TextControls style={style} size={size} tokens={view.tokens} onPatch={patch} />
      <Sep />
      <Btn label={tx("書式を戻す", "Reset format")} disabled={!slide.styles?.[focus.key]} onClick={() => editDeck((d) => updateSlide(d, slide.id, (s) => setTextStyle(s, focus.key, null)))}>
        <RotateCcw size={13} />
      </Btn>
    </div>
  );
}

/** 置きものを選んでいるときの書式バー */
export function ObjectFormatBar() {
  const view = useDeckView();
  const selected = useKata((s) => s.selected);
  const editDeck = useKata((s) => s.editDeck);
  const select = useKata((s) => s.select);
  if (!view) return null;
  const { slide, tokens } = view;
  const o = slide.objects?.find((x) => x.id === selected);
  if (!o) return null;
  const set = (fn: (x: SlideObject) => SlideObject, merge?: string) => editDeck((d) => updateSlide(d, slide.id, (s) => updateObject(s, o.id, fn)), merge);
  const line = isLineKind(o.kind);
  const hasText = o.kind === "text" || o.kind === "rect" || o.kind === "ellipse";
  return (
    <div data-formatbar="true" role="toolbar" aria-label={tx("図形の書式", "Shape format")} className="anim-in flex items-center gap-0.5">
      {!line && o.kind !== "image" ? <ColorPicker label={tx("塗り", "Fill")} value={o.fill} tokens={tokens} icon={<Square size={13} />} onPick={(c) => set((x) => ({ ...x, fill: c }))} /> : null}
      <ColorPicker label={tx("線の色", "Line color")} value={o.stroke} tokens={tokens} allowNone={!line} icon={<Slash size={13} />} onPick={(c) => set((x) => ({ ...x, stroke: c, strokeWidth: x.strokeWidth || 2 }))} />
      {o.stroke !== "none" ? (
        <>
      <div className="flex h-7 items-center rounded-md border border-k-line-strong bg-k-panel" title={tx("線の太さ", "Line width")}>
        <Btn label={tx("線を細く", "Thinner line")} disabled={o.strokeWidth <= (line ? 1 : 0)} onClick={() => set((x) => ({ ...x, strokeWidth: Math.max(line ? 1 : 0, x.strokeWidth - 1) }), `sw:${o.id}`)}>
          <Minus size={12} />
        </Btn>
        <span className="w-6 text-center font-mono text-[11px]">{o.strokeWidth}</span>
        <Btn label={tx("線を太く", "Thicker line")} disabled={o.strokeWidth >= 40} onClick={() => set((x) => ({ ...x, strokeWidth: Math.min(40, x.strokeWidth + 1) }), `sw:${o.id}`)}>
          <Plus size={12} />
        </Btn>
      </div>
      <Btn label={tx("破線", "Dashed")} active={!!o.dash} onClick={() => set((x) => ({ ...x, dash: !x.dash }))}>
        <span className="font-mono text-[11px] tracking-[-0.1em]">- -</span>
      </Btn>
        </>
      ) : null}
      {o.kind === "rect" ? (
        <Btn label={tx("角を丸める", "Round corners")} active={(o.radius ?? 0) > 0} onClick={() => set((x) => ({ ...x, radius: (x.radius ?? 0) > 0 ? 0 : 12 }))}>
          <span className="h-3 w-3 rounded-[4px] border-[1.5px] border-current" />
        </Btn>
      ) : null}
      {hasText ? (
        <>
          <Sep />
          {o.kind === "text" ? (
            <TextControls style={o.textStyle ?? {}} size={o.textStyle?.size ?? 24} tokens={tokens} onPatch={(p) => set((x) => ({ ...x, textStyle: cleanStyle({ ...(x.textStyle ?? {}), ...p }) }), `ts:${o.id}`)} />
          ) : (
            // 図形の中の文字は、まとめて1つの入口から（バーを短く保つ）
            <Popover label={tx("図形の中の文字", "Text in shape")} button={<><Type size={14} /><span>{tx("文字", "Text")}</span></>}>
              {() => (
                <div className="flex items-center gap-0.5">
                  <TextControls style={o.textStyle ?? {}} size={o.textStyle?.size ?? 24} tokens={tokens} onPatch={(p) => set((x) => ({ ...x, textStyle: cleanStyle({ ...(x.textStyle ?? {}), ...p }) }), `ts:${o.id}`)} />
                  <Btn label={tx("文字を打つ（Enter）", "Edit text (Enter)")} onClick={() => useKata.getState().setEditing(o.id)}>
                    <span className="text-[11px]">{tx("打つ", "Edit")}</span>
                  </Btn>
                </div>
              )}
            </Popover>
          )}
        </>
      ) : null}
      <Sep />
      <Popover label={tx("その他", "More")} button={<MoreHorizontal size={15} />}>
        {(close) => (
          <div className="flex min-w-[200px] flex-col">
            {[
              { label: tx("一番手前へ", "Bring to front"), icon: <BringToFront size={14} />, run: () => editDeck((d) => updateSlide(d, slide.id, (s) => reorderObject(s, o.id, "front"))) },
              { label: tx("文字の後ろへ", "Send behind text"), icon: <SendToBack size={14} />, run: () => editDeck((d) => updateSlide(d, slide.id, (s) => reorderObject(s, o.id, "back"))) },
              {
                label: tx("複製", "Duplicate"),
                kbd: "⌘D",
                icon: <Copy size={14} />,
                run: () => {
                  let nid: string | null = null;
                  editDeck((d) =>
                    updateSlide(d, slide.id, (s) => {
                      const r = duplicateObject(s, o.id);
                      nid = r.id;
                      return r.slide;
                    }),
                  );
                  if (nid) select(nid);
                },
              },
              {
                label: tx("消す", "Delete"),
                kbd: "Del",
                icon: <Trash2 size={14} />,
                run: () => {
                  editDeck((d) => updateSlide(d, slide.id, (s) => removeObject(s, o.id)));
                  select(null);
                },
              },
            ].map((it) => (
              <button
                key={it.label}
                type="button"
                onMouseDown={keep}
                onClick={() => {
                  it.run();
                  close();
                }}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
              >
                <span className="flex items-center gap-2.5">
                  {it.icon}
                  {it.label}
                </span>
                {it.kbd ? <kbd className="font-mono text-[10px] text-k-ink-3">{it.kbd}</kbd> : null}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

function cleanStyle(s: TextStyle): TextStyle | undefined {
  const out = { ...s };
  for (const k of Object.keys(out) as (keyof TextStyle)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** 置く：文字・四角・丸・線・矢印・画像 */
export function InsertMenu({ onNewPage }: { onNewPage: () => void }) {
  const view = useDeckView();
  const editDeck = useKata((s) => s.editDeck);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!view) return null;
  const { slide } = view;
  const put = (kind: ObjectKind, extra: Partial<SlideObject> = {}) => {
    const o = makeObject(kind, extra);
    // 同じ所に重ねて置かない
    const n = (slide.objects ?? []).filter((x) => x.kind === kind).length;
    o.x += (n % 6) * 24;
    o.y += (n % 6) * 24;
    editDeck((d) => updateSlide(d, slide.id, (s) => addObject(s, o)));
    const st = useKata.getState();
    if (kind === "text") st.setEditing(o.id);
    else st.select(o.id);
  };
  const items: { kind: ObjectKind; label: string; icon: ReactNode }[] = [
    { kind: "text", label: tx("文字", "Text"), icon: <Type size={14} /> },
    { kind: "rect", label: tx("四角", "Rectangle"), icon: <Square size={14} /> },
    { kind: "ellipse", label: tx("丸", "Ellipse"), icon: <Circle size={14} /> },
    { kind: "line", label: tx("線", "Line"), icon: <Minus size={14} /> },
    { kind: "arrow", label: tx("矢印", "Arrow"), icon: <ArrowRight size={14} /> },
  ];
  return (
    <>
      <Popover label={tx("置く", "Insert")} button={<><Plus size={14} /> <span className="font-medium">{tx("置く", "Insert")}</span></>}>
        {(close) => (
          <div className="flex flex-col">
            {items.map((it) => (
              <button
                key={it.kind}
                type="button"
                onClick={() => {
                  put(it.kind);
                  close();
                }}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
              >
                {it.icon}
                {it.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                fileRef.current?.click();
                close();
              }}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
            >
              <ImagePlus size={14} />
              {tx("画像…", "Image…")}
            </button>
            <div className="my-1 h-px bg-k-line" />
            <button
              type="button"
              onClick={() => {
                onNewPage();
                close();
              }}
              className="flex items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink"
            >
              <span className="flex items-center gap-2.5">
                <Plus size={14} />
                {tx("新しいページ", "New page")}
              </span>
              <kbd className="font-mono text-[10px] text-k-ink-3">N</kbd>
            </button>
          </div>
        )}
      </Popover>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            const { src, w, h } = await shrinkImage(file);
            const scale = Math.min(1, 640 / w, 400 / h);
            const W = Math.round(w * scale);
            const H = Math.round(h * scale);
            put("image", { src, ratio: w / h, w: W, h: H, x: Math.round((1280 - W) / 2), y: Math.round((720 - H) / 2) });
          } catch {
            useKata.getState().notify(tx("画像を読み込めませんでした", "Couldn't read that image"));
          }
        }}
      />
    </>
  );
}

/** 画像は保存先（ブラウザ）を圧迫しないよう、長い辺 1600px に縮めてから持つ */
async function shrinkImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const w = img.naturalWidth || 400;
  const h = img.naturalHeight || 300;
  if (file.type === "image/svg+xml") {
    if (file.size > 300_000) throw new Error("svg too large");
    return { src: url, w, h };
  }
  if (Math.max(w, h) <= 1600 && file.size < 150_000) return { src: url, w, h };
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return { src: c.toDataURL(type, 0.85), w: c.width, h: c.height };
}
