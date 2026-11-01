"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import type { Slide, SlideObject } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { updateSlide } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { cssColor, isLineKind, moveBy, resizeBy, snapMove, textStyleCss, updateObject, type Handle } from "@/ActivitySpace/sustainment/slides/kata/model/objects";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { useAssetSrc } from "@/ActivitySpace/sustainment/slides/deckAssets";

let gestureSeq = 0;
const layer: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

/** 型の上（behind なら後ろ）に自由に置いたものを描く。編集できる画面では、選んで動かし、大きさを変え、文字を打てる */
export function ObjectsLayer({ slide, editable, behind = false }: { slide: Slide; editable: boolean; behind?: boolean }) {
  const all = slide.objects ?? [];
  const objs = all.filter((o) => !!o.behind === behind);
  if (!editable) {
    if (!objs.length) return null;
    return (
      <div style={layer}>
        {objs.map((o) => (
          <ObjectShape key={o.id} o={o} />
        ))}
      </div>
    );
  }
  return <EditableLayer slide={slide} objs={objs} front={!behind} />;
}

function EditableLayer({ slide, objs, front }: { slide: Slide; objs: SlideObject[]; front: boolean }) {
  const selected = useKata((s) => s.selected);
  const editing = useKata((s) => s.editing);
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1);
    measure();
    // The slide is drawn at 1280×720 and scaled by a transform, which a
    // ResizeObserver on the slide never sees. Watch the box the scaled slide
    // sits in (its size is what changes), and the window.
    let scaled: HTMLElement | null = el;
    while (scaled && getComputedStyle(scaled).transform === "none") scaled = scaled.parentElement;
    const ro = new ResizeObserver(measure);
    ro.observe(scaled?.parentElement ?? el.parentElement ?? el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  // A selection drawn after the stage changed size still gets marks of the right size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && selected) setScale(el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1);
  }, [selected]);
  const sel = front ? (slide.objects ?? []).find((o) => o.id === selected) : undefined;

  const begin = (e: RPointerEvent, o: SlideObject, handle?: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const st = useKata.getState();
    if (st.editing === o.id && !handle) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    st.select(o.id);
    const sc = ref.current ? ref.current.getBoundingClientRect().width / (ref.current.offsetWidth || 1) || 1 : 1;
    const sx = e.clientX;
    const sy = e.clientY;
    const gesture = `g:${o.id}:${++gestureSeq}`;
    const others = (slide.objects ?? []).filter((x) => x.id !== o.id);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      // ボタンを離したのに pointerup が来なかった（窓の外で離した等）ときは、そこで終える
      if (ev.buttons === 0) return onUp();
      let dx = (ev.clientX - sx) / sc;
      let dy = (ev.clientY - sy) / sc;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      moved = true;
      let next: SlideObject;
      if (handle) next = resizeBy(o, handle, dx, dy, ev.shiftKey);
      else {
        // Shift：縦か横の一方だけに動かす
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        next = moveBy(o, dx, dy);
        if (!ev.altKey) {
          const snapped = snapMove(next, others, 6 / sc);
          next = snapped.o;
          setGuides(snapped.guides);
        }
      }
      useKata.getState().editDeck((d) => updateSlide(d, slide.id, (s) => updateObject(s, o.id, () => next)), gesture);
    };
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      setGuides({});
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  };

  return (
    <div ref={ref} style={layer} data-objects-layer={front ? "front" : "back"}>
      {objs.map((o) => (
        <ObjectShape
          key={o.id}
          o={o}
          interactive
          editingText={editing === o.id}
          onPointerDown={(e) => begin(e, o)}
          onDoubleClick={() => {
            if (o.kind !== "line" && o.kind !== "arrow" && o.kind !== "image") useKata.getState().setEditing(o.id);
          }}
          onCommitText={(text) => {
            useKata.getState().editDeck((d) => updateSlide(d, slide.id, (s) => updateObject(s, o.id, (x) => ({ ...x, text }))));
            useKata.getState().setEditing(null);
          }}
        />
      ))}
      {sel ? <Selection o={sel} scale={scale} onHandle={(e, h) => begin(e, sel, h)} /> : null}
      {guides.x !== undefined ? <div style={{ position: "absolute", left: guides.x, top: 0, bottom: 0, width: 0, borderLeft: `${1 / scale}px solid var(--k-danger)` }} /> : null}
      {guides.y !== undefined ? <div style={{ position: "absolute", top: guides.y, left: 0, right: 0, height: 0, borderTop: `${1 / scale}px solid var(--k-danger)` }} /> : null}
    </div>
  );
}

// Selection marks follow the app's accent.
const SEL = "var(--k-lime)";

function Selection({ o, scale, onHandle }: { o: SlideObject; scale: number; onHandle: (e: RPointerEvent, h: Handle) => void }) {
  const size = 8 / scale;
  const handle = (h: Handle, x: number, y: number, cursor: string) => (
    <div
      key={h}
      data-obj="handle"
      aria-hidden="true"
      onPointerDown={(e) => onHandle(e, h)}
      style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, background: "var(--k-panel)", border: `${1 / scale}px solid ${SEL}`, borderRadius: isLineKind(o.kind) ? "50%" : 2, cursor, pointerEvents: "auto", touchAction: "none" }}
    />
  );
  if (isLineKind(o.kind)) {
    return (
      <>
        {handle("start", o.x, o.y, "crosshair")}
        {handle("end", o.x + o.w, o.y + o.h, "crosshair")}
      </>
    );
  }
  const { x, y, w, h } = o;
  return (
    <>
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, outline: `${1 / scale}px solid ${SEL}`, pointerEvents: "none" }} />
      {handle("nw", x, y, "nwse-resize")}
      {handle("n", x + w / 2, y, "ns-resize")}
      {handle("ne", x + w, y, "nesw-resize")}
      {handle("e", x + w, y + h / 2, "ew-resize")}
      {handle("se", x + w, y + h, "nwse-resize")}
      {handle("s", x + w / 2, y + h, "ns-resize")}
      {handle("sw", x, y + h, "nesw-resize")}
      {handle("w", x, y + h / 2, "ew-resize")}
    </>
  );
}

interface ShapeProps {
  o: SlideObject;
  interactive?: boolean;
  editingText?: boolean;
  onPointerDown?: (e: RPointerEvent) => void;
  onDoubleClick?: () => void;
  onCommitText?: (text: string) => void;
}

/** 置きもの1つ。画面・サムネイル・発表・印刷で同じ見た目 */
function ObjectShape({ o, interactive, editingText, onPointerDown, onDoubleClick, onCommitText }: ShapeProps) {
  const pe: CSSProperties = interactive ? { pointerEvents: "auto", cursor: editingText ? "text" : "move", touchAction: "none" } : {};
  const common = interactive ? { "data-obj": o.id, onPointerDown, onDoubleClick } : {};
  if (isLineKind(o.kind)) {
    const color = cssColor(o.stroke) ?? "var(--s-ink)";
    const x2 = o.x + o.w;
    const y2 = o.y + o.h;
    const sw = Math.max(1, o.strokeWidth);
    const head = o.kind === "arrow" ? arrowHead(o.x, o.y, x2, y2, sw) : null;
    // 矢印の先は塗った三角。線は三角の付け根で止める
    const end = head ? head.base : { x: x2, y: y2 };
    return (
      <svg width="1280" height="720" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
        <line x1={o.x} y1={o.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={sw} strokeDasharray={o.dash ? `${sw * 3} ${sw * 2}` : undefined} strokeLinecap="butt" />
        {head ? <polygon points={head.points} fill={color} /> : null}
        {interactive ? <line {...common} x1={o.x} y1={o.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(16, sw + 12)} style={pe} /> : null}
      </svg>
    );
  }
  const fill = cssColor(o.fill);
  const stroke = cssColor(o.stroke);
  const box: CSSProperties = {
    position: "absolute",
    left: o.x,
    top: o.y,
    width: o.w,
    height: o.h,
    background: fill,
    border: stroke && o.strokeWidth > 0 ? `${o.strokeWidth}px ${o.dash ? "dashed" : "solid"} ${stroke}` : undefined,
    borderRadius: o.kind === "ellipse" ? "50%" : o.kind === "rect" ? (o.radius ?? 0) : undefined,
    boxSizing: "border-box",
    overflow: o.kind === "image" ? "hidden" : undefined,
    ...pe,
  };
  if (o.kind === "image") {
    return (
      <div {...common} style={box}>
        {o.src ? <ObjectImage src={o.src} /> : null}
      </div>
    );
  }
  const isText = o.kind === "text";
  const textCss: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: isText ? "flex-start" : "center",
    textAlign: isText ? "left" : "center",
    padding: isText ? 4 : 16,
    boxSizing: "border-box",
    fontSize: 24,
    lineHeight: 1.4,
    color: isText ? "var(--s-ink)" : o.fill === "block" ? "var(--s-num)" : o.fill === "accent" ? "var(--s-on-accent)" : "var(--s-ink)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    ...textStyleCss(o.textStyle),
  };
  return (
    <div {...common} style={box}>
      {editingText ? (
        <TextEditor value={o.text ?? ""} style={textCss} onCommit={(t) => onCommitText?.(t)} />
      ) : o.text ? (
        <div style={{ ...textCss, pointerEvents: "none" }}>{o.text}</div>
      ) : null}
    </div>
  );
}

function TextEditor({ value, style, onCommit }: { value: string; style: CSSProperties; onCommit: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  const commit = () => {
    if (done.current) return;
    done.current = true;
    commitRef.current((ref.current?.innerText ?? "").replace(/\n+$/, ""));
  };
  // ほかを押して選びが外れると、blur より先に消えることがある。消えるときにも打った文字を残す
  useEffect(() => {
    const el = ref.current;
    return () => {
      // 開発中の二重実行（StrictMode）では要素は画面に残っている。本当に消えたときだけ残す
      if (done.current || !el || el.isConnected) return;
      done.current = true;
      const text = (el.innerText ?? "").replace(/\n+$/, "");
      queueMicrotask(() => commitRef.current(text));
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // 全部を選んだ状態で始める（打てば置き換わる）
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-edit="true"
      data-placeholder={tx("文字を入力", "Type text")}
      aria-label={tx("置いた文字", "Text box")}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") (e.currentTarget as HTMLElement).blur();
      }}
      onBlur={commit}
      style={{ ...style, outline: "none", cursor: "text" }}
    >
      {value}
    </div>
  );
}

/** 矢印の先の三角。線の太さに合わせた大きさ */
function arrowHead(x1: number, y1: number, x2: number, y2: number, sw: number) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const L = Math.min(len * 0.6, 10 + sw * 3);
  const W = 6 + sw * 1.8;
  const bx = x2 - ux * L;
  const by = y2 - uy * L;
  const points = [`${x2},${y2}`, `${bx - uy * W},${by + ux * W}`, `${bx + uy * W},${by - ux * W}`].join(" ");
  return { points, base: { x: bx + ux * 0.5, y: by + uy * 0.5 } };
}

/** 置いた画像。保存先に移した画像は、短い期限の署名つきリンクで読む */
function ObjectImage({ src }: { src: string }) {
  const url = useAssetSrc(src);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />;
}
