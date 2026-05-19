'use client';

// DocEditor — flowing HTML editor for the Documentation craft mode.
// Inspired by the "HTML as primary output" article: a contenteditable
// surface where the user (and the AI) write a normal HTML document with
// h1/h2/p/ul/blockquote/etc., not absolute-positioned shapes on a
// canvas. The center is a white "page" of paper-realistic width,
// floating on the same dotted dark background as the canvas mode so
// the studio feels coherent across modes.
//
// The editor exposes its DOM node via `editorRef` so the parent's right
// sidebar can run execCommand on the same selection without us having
// to lift state. All toolbar buttons use `onMouseDown` + preventDefault
// so the editor never loses focus → the caret + selection survive.

import { useEffect, useRef, useState, type RefObject } from 'react';

// A4 portrait at 96 dpi. The editor flows continuously in one big
// contenteditable; we draw a "Page N" cue every A4_PX vertical pixels
// so the user sees how the doc will paginate when printed / exported.
const A4_PX = 1123;
interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Shared with DocSidePanel so the sidebar can drive the same editor. */
  editorRef: RefObject<HTMLDivElement | null>;
}

const DEFAULT_DOC_HTML = '<h1>タイトルを入力</h1><p>本文を入力</p>';

export function DocEditor({ html, onChange, editorRef }: Props) {
  // Track paper height so we can render visual page breaks every A4_PX.
  // The doc data is still one continuous string — these are just cues.
  const paperRef = useRef<HTMLDivElement>(null);
  const [paperHeight, setPaperHeight] = useState(A4_PX);
  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setPaperHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageCount = Math.max(1, Math.ceil(paperHeight / A4_PX));
  // Seed innerHTML on first attach + when the external html diverges
  // and the user isn't actively editing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = html?.trim() ? html : DEFAULT_DOC_HTML;
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [html, editorRef]);

  // Auto-focus the editor on mount so the user can just start typing —
  // no "click into the page first" friction. Caret lands at the end of
  // existing content (or at position 0 for a blank doc).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = () => {
    const el = editorRef.current;
    if (el) onChange(el.innerHTML);
  };

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Dotted canvas — flips with the app theme. */}
      <div
        className={
          'flex-1 min-h-0 overflow-auto bg-[#f4f4f5] dark:bg-[#0e0e10] ' +
          '[background-image:radial-gradient(circle,#d4d4d8_1px,transparent_1.5px)] ' +
          'dark:[background-image:radial-gradient(circle,#2a2a2e_1px,transparent_1.5px)] ' +
          '[background-size:20px_20px]'
        }
      >
        {/* Reserve room for the right inspector and the top editing island
            so the paper stays framed in the visible working area. */}
        <div
          className="flex items-start justify-center"
          style={{
            minHeight: '100%',
            paddingLeft: 32,
            paddingRight: 32,
            paddingTop: 120,
            paddingBottom: 32,
          }}
        >
          {/* Paper-realistic page — clicking anywhere on the paper jumps
              the caret in, so it really is "Word-like, just type". The
              document starts with a PowerPoint-like title area followed
              by a body area, instead of a blank sheet. */}
          <div
            ref={paperRef}
            className="bg-white text-zinc-900 rounded-sm shadow-2xl overflow-hidden relative"
            style={{ width: 794, minHeight: A4_PX }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault();
                editorRef.current?.focus();
              }
            }}
          >
            {/* Visual page-break cues — one for every A4 boundary after
                the first page. The editor content flows past them, so
                these are decoration only (the real pagination happens
                via @page A4 in the print/export shell). */}
            {Array.from({ length: pageCount - 1 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                style={{
                  position: 'absolute',
                  top: (i + 1) * A4_PX,
                  left: 0,
                  right: 0,
                  height: 0,
                  borderTop: '1px dashed #d4d4d8',
                  pointerEvents: 'none',
                  zIndex: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: 16,
                    top: -8,
                    background: 'white',
                    padding: '0 6px',
                    fontSize: 10,
                    color: '#9ca3af',
                    fontWeight: 500,
                  }}
                >
                  Page {i + 2}
                </span>
              </div>
            ))}

            <div style={{ padding: '64px 72px', position: 'relative', zIndex: 1 }}>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={flush}
              onBlur={flush}
              onPaste={(e) => {
                if (!e.clipboardData) return;
                const text = e.clipboardData.getData('text/plain');
                if (!text) return;
                e.preventDefault();
                document.execCommand('insertText', false, text);
                flush();
              }}
              className="doc-editor outline-none"
              style={{
                minHeight: 800,
                fontFamily: 'system-ui, -apple-system, "Inter", sans-serif',
                fontSize: 16,
                lineHeight: 1.6,
                color: '#111',
              }}
              data-placeholder="ここから書き始める。スタイルは右パネルから、構造は下のツールバーから。"
            />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .doc-editor:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        .doc-editor h1 { font-size: 34px; font-weight: 700; margin: 0 0 28px; line-height: 1.15; color: #111827; }
        .doc-editor h2 { font-size: 22px; font-weight: 700; margin: 20px 0 10px; line-height: 1.25; }
        .doc-editor h3 { font-size: 18px; font-weight: 600; margin: 18px 0 8px; line-height: 1.3; }
        .doc-editor p  { margin: 8px 0; }
        .doc-editor > p:first-of-type { min-height: 420px; padding-top: 6px; color: #374151; }
        .doc-editor ul, .doc-editor ol { padding-left: 24px; margin: 8px 0; }
        .doc-editor li { margin: 4px 0; }
        .doc-editor blockquote { border-left: 3px solid #d4d4d8; padding-left: 12px; color: #52525b; margin: 12px 0; font-style: italic; }
        .doc-editor pre { background: #f4f4f5; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
        .doc-editor code { background: #f4f4f5; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; }
        .doc-editor a { color: #1B4FA7; text-decoration: underline; }
        .doc-editor img { max-width: 100%; height: auto; border-radius: 4px; }
        .doc-editor table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        .doc-editor th, .doc-editor td { border: 1px solid #e4e4e7; padding: 8px 10px; text-align: left; }
        .doc-editor th { background: #fafafa; font-weight: 600; }
      `}</style>
    </div>
  );
}
