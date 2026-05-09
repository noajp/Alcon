'use client';

// DocEditor — flowing HTML editor for the Documentation craft mode.
// Inspired by the "HTML as primary output" article: a contenteditable
// surface where the user (and the AI) write a normal HTML document with
// h1/h2/p/ul/blockquote/etc., not absolute-positioned shapes on a
// canvas. The center is a white "page" of paper-realistic width,
// floating on the same dotted dark background as the canvas mode so
// the studio feels coherent across modes.
//
// The toolbar lives at the bottom-center (Figma-style popup) and uses
// document.execCommand for formatting. execCommand is deprecated but
// still ships in every browser, gives us a 0-dependency WYSIWYG, and
// the article's bet is that LLMs already write fine HTML — we just
// need a thin shell for human edits on top.

import { useEffect, useRef } from 'react';
import {
  Bold, Italic, Underline, Heading1, Heading2, Heading3, Type as TypeIcon,
  List, ListOrdered, Quote, Code2, Link2, Image as ImageIconLuc,
  Undo2, Redo2, Strikethrough,
} from 'lucide-react';

interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Used only as the active-tool background tint on the toolbar. */
  accent?: string;
  /** Called when the user triggers AI assist from the bottom bar. */
  onAi?: () => void;
}

export function DocEditor({ html, onChange, accent = '#1B4FA7' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Only seed innerHTML when the external html diverges AND the user
  // isn't editing — otherwise we'd clobber the caret on every keystroke.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = html ?? '';
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [html]);

  const flush = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const cmd = (command: string, value?: string) => {
    // Re-focus first so execCommand targets the editor.
    ref.current?.focus();
    try { document.execCommand(command, false, value); } catch { /* ignore */ }
    flush();
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* Dotted dark canvas — matches the slide canvas background. */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{
          backgroundColor: '#0e0e10',
          backgroundImage: 'radial-gradient(circle, #2a2a2e 1px, transparent 1.5px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div className="min-w-full min-h-full flex items-start justify-center p-10">
          {/* Paper-realistic page */}
          <div
            className="bg-white text-zinc-900 rounded-sm shadow-2xl"
            style={{ width: 794, minHeight: 1123, padding: '64px 72px' }}
          >
            <div
              ref={ref}
              contentEditable
              suppressContentEditableWarning
              onInput={flush}
              onBlur={flush}
              onPaste={(e) => {
                // Paste as plain text by default — keeps the doc clean
                // when copying from arbitrary websites with messy markup.
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
              data-placeholder="Documentation 本文をここに。h1 / h2 / リスト / 引用などをツールバーから挿入できます。"
            />
          </div>
        </div>
      </div>

      {/* Per-doc baseline styles. Rendered via a single inline <style>
          so headings / lists / quotes have sensible defaults without
          depending on Tailwind's prose plugin. */}
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

      {/* Bottom popup toolbar — same visual rhythm as the canvas mode. */}
      <div className="absolute left-1/2 bottom-5 -translate-x-1/2 z-10 flex items-center gap-0.5 px-2 h-11 bg-[#2c2c2c] rounded-xl shadow-2xl border border-zinc-700/60">
        <ToolBtn onClick={() => cmd('formatBlock', 'H1')} title="Heading 1"><Heading1 size={14} /></ToolBtn>
        <ToolBtn onClick={() => cmd('formatBlock', 'H2')} title="Heading 2"><Heading2 size={14} /></ToolBtn>
        <ToolBtn onClick={() => cmd('formatBlock', 'H3')} title="Heading 3"><Heading3 size={14} /></ToolBtn>
        <ToolBtn onClick={() => cmd('formatBlock', 'P')} title="Paragraph"><TypeIcon size={14} /></ToolBtn>
        <Divider />
        <ToolBtn onClick={() => cmd('bold')} title="Bold (⌘B)" accent={accent}><Bold size={13} /></ToolBtn>
        <ToolBtn onClick={() => cmd('italic')} title="Italic (⌘I)" accent={accent}><Italic size={13} /></ToolBtn>
        <ToolBtn onClick={() => cmd('underline')} title="Underline (⌘U)" accent={accent}><Underline size={13} /></ToolBtn>
        <ToolBtn onClick={() => cmd('strikeThrough')} title="Strikethrough" accent={accent}><Strikethrough size={13} /></ToolBtn>
        <Divider />
        <ToolBtn onClick={() => cmd('insertUnorderedList')} title="Bulleted list"><List size={14} /></ToolBtn>
        <ToolBtn onClick={() => cmd('insertOrderedList')} title="Numbered list"><ListOrdered size={14} /></ToolBtn>
        <ToolBtn onClick={() => cmd('formatBlock', 'BLOCKQUOTE')} title="Quote"><Quote size={13} /></ToolBtn>
        <ToolBtn onClick={() => cmd('formatBlock', 'PRE')} title="Code block"><Code2 size={14} /></ToolBtn>
        <Divider />
        <ToolBtn
          onClick={() => {
            const url = prompt('リンク URL を入力');
            if (url) cmd('createLink', url);
          }}
          title="Insert link"
        >
          <Link2 size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            const url = prompt('画像 URL (https: または data:)');
            if (url) cmd('insertImage', url);
          }}
          title="Insert image"
        >
          <ImageIconLuc size={13} />
        </ToolBtn>
        <Divider />
        <ToolBtn onClick={() => cmd('undo')} title="Undo (⌘Z)"><Undo2 size={13} /></ToolBtn>
        <ToolBtn onClick={() => cmd('redo')} title="Redo (⌘⇧Z)"><Redo2 size={13} /></ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({
  onClick, title, children, active, accent,
}: {
  onClick: () => void; title: string; children: React.ReactNode; active?: boolean; accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 rounded-lg transition-colors text-zinc-300 hover:bg-zinc-700"
      style={active ? { background: accent ?? '#F24E1E', color: '#fff' } : undefined}
    >
      {children}
    </button>
  );
}

function Divider() { return <span className="w-px h-5 bg-zinc-700 mx-0.5" />; }
