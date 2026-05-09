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
const BAND_PX = 6;
import {
  Bold, Italic, Underline, Heading1, Heading2, Heading3, Type as TypeIcon,
  List, ListOrdered, Quote, Code2, Link2, Image as ImageIconLuc,
  Undo2, Redo2, Strikethrough,
} from 'lucide-react';

interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Shared with DocSidePanel so the sidebar can drive the same editor. */
  editorRef: RefObject<HTMLDivElement | null>;
  /** Used only as the active-tool background tint on the toolbar. */
  accent?: string;
  /** Tailwind classes for the thin colored band rendered at the top of
      the paper. Lets the studio swap it per format (navy / orange). */
  bandClass?: string;
}

export function DocEditor({ html, onChange, editorRef, accent = '#1B4FA7', bandClass }: Props) {
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
  const pageCount = Math.max(1, Math.ceil((paperHeight - BAND_PX) / A4_PX));
  // Seed innerHTML on first attach + when the external html diverges
  // and the user isn't actively editing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = html ?? '';
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

  const cmd = (command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* ignore */ }
    try { document.execCommand(command, false, value); } catch { /* ignore */ }
    flush();
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* Dotted canvas — flips with the app theme. */}
      <div
        className={
          'flex-1 min-h-0 overflow-auto bg-[#f4f4f5] dark:bg-[#0e0e10] ' +
          '[background-image:radial-gradient(circle,#d4d4d8_1px,transparent_1.5px)] ' +
          'dark:[background-image:radial-gradient(circle,#2a2a2e_1px,transparent_1.5px)] ' +
          '[background-size:20px_20px]'
        }
      >
        {/* Reserve room for the floating islands (left rail + right
            inspector) so the paper centers in the visible slot rather
            than in the full bleed. */}
        <div
          className="flex items-start justify-center"
          style={{
            minHeight: '100%',
            paddingLeft: 248,
            paddingRight: 280,
            paddingTop: 32,
            paddingBottom: 32,
          }}
        >
          {/* Paper-realistic page — clicking anywhere on the paper jumps
              the caret in, so it really is "Word-like, just type". The
              top band is a thin colored strip that identifies the mode
              (Documentation = navy gradient, Presentation = orange).  */}
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
            {bandClass && <div className={`h-1.5 ${bandClass}`} />}

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
                  top: BAND_PX + (i + 1) * A4_PX,
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
        .doc-editor h1 { font-size: 28px; font-weight: 700; margin: 24px 0 12px; line-height: 1.2; }
        .doc-editor h2 { font-size: 22px; font-weight: 700; margin: 20px 0 10px; line-height: 1.25; }
        .doc-editor h3 { font-size: 18px; font-weight: 600; margin: 18px 0 8px; line-height: 1.3; }
        .doc-editor p  { margin: 8px 0; }
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

      {/* Bottom popup toolbar — block structure (headings, lists, quote,
          code, links, images, undo/redo). Inline styling lives in the
          right sidebar. */}
      <div className="absolute left-1/2 bottom-5 -translate-x-1/2 z-10 flex items-center gap-0.5 px-2 h-11 bg-[#2c2c2c] rounded-xl shadow-2xl border border-zinc-700/60">
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'H1')} title="Heading 1"><Heading1 size={14} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'H2')} title="Heading 2"><Heading2 size={14} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'H3')} title="Heading 3"><Heading3 size={14} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'P')} title="Paragraph"><TypeIcon size={14} /></ToolBtn>
        <Divider />
        <ToolBtn onMouseDown={() => cmd('insertUnorderedList')} title="Bulleted list"><List size={14} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('insertOrderedList')} title="Numbered list"><ListOrdered size={14} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'BLOCKQUOTE')} title="Quote"><Quote size={13} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('formatBlock', 'PRE')} title="Code block"><Code2 size={14} /></ToolBtn>
        <Divider />
        <ToolBtn onMouseDown={() => cmd('bold')} title="Bold (⌘B)" accent={accent}><Bold size={13} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('italic')} title="Italic (⌘I)" accent={accent}><Italic size={13} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('underline')} title="Underline (⌘U)" accent={accent}><Underline size={13} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('strikeThrough')} title="Strikethrough" accent={accent}><Strikethrough size={13} /></ToolBtn>
        <Divider />
        <ToolBtn
          onMouseDown={() => {
            const url = prompt('リンク URL を入力');
            if (url) cmd('createLink', url);
          }}
          title="Insert link"
        >
          <Link2 size={13} />
        </ToolBtn>
        <ToolBtn
          onMouseDown={() => {
            const url = prompt('画像 URL (https: または data:)');
            if (url) cmd('insertImage', url);
          }}
          title="Insert image"
        >
          <ImageIconLuc size={13} />
        </ToolBtn>
        <Divider />
        <ToolBtn onMouseDown={() => cmd('undo')} title="Undo (⌘Z)"><Undo2 size={13} /></ToolBtn>
        <ToolBtn onMouseDown={() => cmd('redo')} title="Redo (⌘⇧Z)"><Redo2 size={13} /></ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({
  onMouseDown, title, children, accent,
}: {
  onMouseDown: () => void; title: string; children: React.ReactNode; accent?: string;
}) {
  return (
    <button
      // mousedown + preventDefault keeps the editor focused so the
      // selection / caret survives the click.
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      title={title}
      className="p-2 rounded-lg transition-colors text-zinc-300 hover:bg-zinc-700"
      style={accent ? undefined : undefined}
    >
      {children}
    </button>
  );
}

function Divider() { return <span className="w-px h-5 bg-zinc-700 mx-0.5" />; }
