'use client';

// Manual editing surface — open-pencil inspired.
//
// Two interaction modes:
//   - "wysiwyg": the rendered HTML is loaded into a sandboxed iframe with
//     contenteditable=true on <body>. A small toolbar (Bold/Italic/H1/H2/
//     Bullet/Number/Link/Image) posts execCommand-style operations into
//     the iframe via postMessage. On every input the iframe posts back the
//     fresh body HTML; the parent stitches it back into the full document
//     and updates the draft. This lets a human directly type/edit/format
//     content the AI produced — no need to round-trip through chat.
//   - "code": a plain textarea bound to the full HTML, for power-users who
//     want to tweak markup directly.
//
// The iframe sandbox is `allow-scripts` (no allow-same-origin), so the
// injected editor script runs in a null origin and can only talk to the
// parent via postMessage.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Italic, Heading1, Heading2, List, ListOrdered, Link2, Image as ImageIcon,
  Undo2, Redo2, Code2, Wand2,
} from 'lucide-react';

interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Adds a band tinted by the current craft format. */
  bandClass: string;
  /** Shown to the user above the toolbar so they remember which mode they're editing. */
  modeLabel: string;
}

type EditMode = 'wysiwyg' | 'code';

export function ManualEditor({ html, onChange, bandClass, modeLabel }: Props) {
  const [mode, setMode] = useState<EditMode>('wysiwyg');
  const [codeBuffer, setCodeBuffer] = useState(html);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // We keep a ref to the latest body content posted from the iframe so
  // toolbar actions don't race with edits in flight.
  const latestBodyRef = useRef<string>(extractBody(html));

  useEffect(() => {
    if (mode === 'code') setCodeBuffer(html);
  }, [html, mode]);

  // Listen for content updates posted from the iframe editor bridge.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'craft:editor-update' && typeof data.body === 'string') {
        latestBodyRef.current = data.body;
        onChange(replaceBody(html, data.body));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [html, onChange]);

  const editorSrc = useMemo(() => {
    if (mode !== 'wysiwyg') return null;
    return `data:text/html;charset=utf-8,${encodeURIComponent(withEditorBridge(html))}`;
  }, [html, mode]);

  const command = (cmd: string, value?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'craft:editor-command', command: cmd, value },
      '*'
    );
  };

  const handleCodeApply = () => {
    onChange(codeBuffer);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`px-4 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-white ${bandClass}`}>
        Manual edit · {modeLabel}
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card/40">
        <ToolBtn onClick={() => command('bold')} title="Bold (⌘B)"><Bold size={13} /></ToolBtn>
        <ToolBtn onClick={() => command('italic')} title="Italic (⌘I)"><Italic size={13} /></ToolBtn>
        <Divider />
        <ToolBtn onClick={() => command('formatBlock', 'H1')} title="Heading 1"><Heading1 size={14} /></ToolBtn>
        <ToolBtn onClick={() => command('formatBlock', 'H2')} title="Heading 2"><Heading2 size={14} /></ToolBtn>
        <ToolBtn onClick={() => command('formatBlock', 'P')} title="Paragraph">¶</ToolBtn>
        <Divider />
        <ToolBtn onClick={() => command('insertUnorderedList')} title="Bulleted list"><List size={13} /></ToolBtn>
        <ToolBtn onClick={() => command('insertOrderedList')} title="Numbered list"><ListOrdered size={13} /></ToolBtn>
        <Divider />
        <ToolBtn
          onClick={() => {
            const url = prompt('リンク URL を入力');
            if (url) command('createLink', url);
          }}
          title="Insert link"
        >
          <Link2 size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            const url = prompt('画像 URL (https: または data:)');
            if (url) command('insertImage', url);
          }}
          title="Insert image"
        >
          <ImageIcon size={13} />
        </ToolBtn>
        <Divider />
        <ToolBtn onClick={() => command('undo')} title="Undo (⌘Z)"><Undo2 size={13} /></ToolBtn>
        <ToolBtn onClick={() => command('redo')} title="Redo (⌘⇧Z)"><Redo2 size={13} /></ToolBtn>
        <div className="ml-auto flex items-center gap-1">
          <ToolBtn
            active={mode === 'wysiwyg'}
            onClick={() => setMode('wysiwyg')}
            title="Visual edit"
          >
            <Wand2 size={13} />
          </ToolBtn>
          <ToolBtn
            active={mode === 'code'}
            onClick={() => setMode('code')}
            title="Edit raw HTML"
          >
            <Code2 size={13} />
          </ToolBtn>
        </div>
      </div>

      {mode === 'wysiwyg' ? (
        <div className="flex-1 min-h-0 bg-muted/20">
          {editorSrc && (
            <iframe
              ref={iframeRef}
              key={editorSrc.slice(0, 64)}
              src={editorSrc}
              sandbox="allow-scripts"
              title="Craft manual editor"
              className="w-full h-full bg-white"
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col bg-muted/20 p-3 gap-2">
          <textarea
            value={codeBuffer}
            onChange={(e) => setCodeBuffer(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full text-[12px] leading-relaxed font-mono bg-card border border-border rounded-md p-3 resize-none focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setCodeBuffer(html)}
              className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleCodeApply}
              className="px-3 py-1.5 text-[12px] font-medium text-white bg-foreground hover:opacity-90 rounded transition-opacity"
            >
              Apply changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  onClick, title, children, active,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors text-[12px] ${
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-border mx-1" />;
}

// Stitch a fresh <body> back into a full HTML document. Falls back to
// returning the new body when no <body> wrapper is found.
function replaceBody(fullHtml: string, newBody: string): string {
  if (/<body[^>]*>[\s\S]*?<\/body>/i.test(fullHtml)) {
    return fullHtml.replace(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i, (_m, open, _mid, close) => {
      return `${open}${newBody}${close}`;
    });
  }
  return newBody;
}

function extractBody(fullHtml: string): string {
  const m = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : fullHtml;
}

// Inject an editor bridge into the model's HTML so the iframe becomes a
// contenteditable surface that posts changes back to the parent. Toolbar
// commands are received from the parent and applied via document.execCommand.
function withEditorBridge(html: string): string {
  const bridge = `
<style>
  body[contenteditable="true"] { caret-color: #1B4FA7; }
  body[contenteditable="true"]:focus { outline: none; }
  body[contenteditable="true"] *::selection { background: rgba(27, 79, 167, 0.25); }
</style>
<script>
(function () {
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    document.designMode = 'on';
    var post = function () {
      try {
        var body = document.body ? document.body.innerHTML : '';
        window.parent.postMessage({ type: 'craft:editor-update', body: body }, '*');
      } catch (e) {}
    };
    var pending = null;
    var schedule = function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; post(); }, 250);
    };
    document.addEventListener('input', schedule, true);
    document.addEventListener('blur', post, true);
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'craft:editor-command') return;
      try {
        document.execCommand(d.command, false, d.value || null);
        schedule();
      } catch (err) {}
    });
    // Initial sync so the parent always has a baseline body.
    setTimeout(post, 50);
  });
})();
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, bridge + '</head>');
  return bridge + html;
}
