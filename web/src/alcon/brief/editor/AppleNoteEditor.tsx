'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, ListTodo,
  Heading1, Heading2, Type, Quote, Link as LinkIcon,
} from 'lucide-react';
import { sanitizeHtml } from './htmlSanitizer';

export interface AppleNoteEditorProps {
  initialHtml?: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  /** Called when the user right-clicks on a list item (bullet/check). */
  onBulletContextMenu?: (info: BulletContextInfo) => void;
}

export interface BulletContextInfo {
  /** Plain text of the targeted line. */
  text: string;
  /** All list items currently selected (or [target] when nothing is selected). */
  texts: string[];
  /** Screen position to anchor a popover. */
  x: number;
  y: number;
}

const TOOLBAR_GAP = 8;

export function AppleNoteEditor({
  initialHtml,
  onChange,
  editable = true,
  onBulletContextMenu,
}: AppleNoteEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  const initRef = useRef(false);
  const lastEmittedRef = useRef<string>('');

  // Set initial HTML once. Avoid re-setting on every prop update — that
  // would clobber the user's caret while they type.
  useEffect(() => {
    const el = ref.current;
    if (!el || initRef.current) return;
    initRef.current = true;
    el.innerHTML = initialHtml ? sanitizeHtml(initialHtml) : '';
    lastEmittedRef.current = el.innerHTML;
  }, [initialHtml]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML;
    if (html === lastEmittedRef.current) return;
    lastEmittedRef.current = html;
    onChange?.(html);
  }, [onChange]);

  const updateToolbarPosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) {
      setToolbar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbar(null);
      return;
    }
    setToolbar({
      x: rect.left + rect.width / 2,
      y: rect.top - TOOLBAR_GAP,
    });
  }, []);

  const exec = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    // execCommand applies inline `style="text-align: ..."` for justify.
    // Convert to data-align so our sanitizer + CSS handles it cleanly.
    normalizeAlignment(ref.current);
    emit();
    updateToolbarPosition();
  }, [emit, updateToolbarPosition]);

  useEffect(() => {
    const onSel = () => updateToolbarPosition();
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('scroll', onSel, true);
    window.addEventListener('resize', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('scroll', onSel, true);
      window.removeEventListener('resize', onSel);
    };
  }, [updateToolbarPosition]);

  const handleInput = useCallback(() => {
    normalizeAlignment(ref.current);
    emit();
  }, [emit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const cleaned = html ? sanitizeHtml(html) : escapeText(text);
    document.execCommand('insertHTML', false, cleaned);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl shortcuts that map to execCommand
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); exec('bold'); }
    else if (key === 'i') { e.preventDefault(); exec('italic'); }
    else if (key === 'u') { e.preventDefault(); exec('underline'); }
  }, [exec]);

  const toggleChecklist = useCallback(() => {
    // Toggle the currently selected line(s) into a checklist <ul data-checklist="true">.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const root = ref.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return;

    // Collect the block-level ancestors that the selection touches.
    const blocks = collectSelectedBlocks(root, range);
    if (blocks.length === 0) return;

    // If every block is already a checklist item → unwrap to <p>.
    const allChecklist = blocks.every((b) =>
      b.tagName === 'LI' && (b.parentElement?.getAttribute('data-checklist') === 'true')
    );

    if (allChecklist) {
      for (const li of blocks) {
        const p = document.createElement('p');
        p.innerHTML = li.innerHTML;
        const ul = li.parentElement!;
        ul.parentElement!.insertBefore(p, ul);
        li.remove();
        if (ul.children.length === 0) ul.remove();
      }
    } else {
      const ul = document.createElement('ul');
      ul.setAttribute('data-checklist', 'true');
      const first = blocks[0];
      first.parentElement!.insertBefore(ul, first);
      for (const b of blocks) {
        const li = document.createElement('li');
        li.setAttribute('data-checked', 'false');
        li.innerHTML = b.innerHTML;
        ul.appendChild(li);
        b.remove();
      }
    }
    emit();
  }, [emit]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Toggle checklist checkbox when user clicks the synthetic checkbox
    // pseudo-element. The checkbox sits at the leftmost ~16px of the <li>;
    // beyond that we have the AtomIcon (~22–36px) which must not toggle.
    const target = e.target as HTMLElement;
    const li = target.closest('li');
    if (!li) return;
    const ul = li.parentElement;
    if (ul?.getAttribute('data-checklist') !== 'true') return;
    const rect = li.getBoundingClientRect();
    if (e.clientX - rect.left > 18) return;
    e.preventDefault();
    const checked = li.getAttribute('data-checked') === 'true';
    li.setAttribute('data-checked', checked ? 'false' : 'true');
    emit();
  }, [emit]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onBulletContextMenu) return;
    const target = e.target as HTMLElement;
    const li = target.closest('li') as HTMLLIElement | null;
    if (!li) return;
    e.preventDefault();
    const sel = window.getSelection();
    let liNodes: HTMLLIElement[] = [li];
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const blocks = collectSelectedBlocks(ref.current!, range)
        .filter((b): b is HTMLLIElement => b.tagName === 'LI');
      if (blocks.length > 0) liNodes = blocks;
    }
    const texts = liNodes
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean);
    onBulletContextMenu({
      text: (li.textContent ?? '').trim(),
      texts,
      x: e.clientX,
      y: e.clientY,
    });
  }, [onBulletContextMenu]);

  const insertLink = useCallback(() => {
    const url = window.prompt('リンク先 URL', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert('http(s):// または mailto: で始まる URL を入力してください');
      return;
    }
    exec('createLink', url);
  }, [exec]);

  return (
    <>
      <div
        ref={ref}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        spellCheck
        className="apple-note-editor no-focus-ring outline-none min-h-[300px] text-[15px] leading-[1.65] text-foreground"
        data-placeholder="思いついたことを書く…"
      />

      {toolbar && editable && (
        <FloatingToolbar
          x={toolbar.x}
          y={toolbar.y}
          onCommand={exec}
          onChecklist={toggleChecklist}
          onLink={insertLink}
        />
      )}

      <style jsx global>{`
        .apple-note-editor:empty::before {
          content: attr(data-placeholder);
          color: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
          pointer-events: none;
        }
        .apple-note-editor h1 {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.25;
          margin: 1.2rem 0 0.4rem;
        }
        .apple-note-editor h2 {
          font-size: 1.3rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 1rem 0 0.3rem;
        }
        .apple-note-editor p { margin: 0.25rem 0; min-height: 1em; }
        .apple-note-editor blockquote {
          border-left: 3px solid var(--border);
          padding-left: 0.8rem;
          margin: 0.5rem 0;
          color: var(--muted-foreground);
        }
        .apple-note-editor pre {
          background: color-mix(in srgb, var(--muted) 60%, transparent);
          padding: 0.6rem 0.8rem;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13px;
          overflow-x: auto;
          margin: 0.5rem 0;
        }
        .apple-note-editor code {
          background: color-mix(in srgb, var(--muted) 50%, transparent);
          padding: 0.1em 0.35em;
          border-radius: 4px;
          font-size: 0.92em;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .apple-note-editor pre code {
          background: transparent;
          padding: 0;
        }
        .apple-note-editor a {
          color: var(--primary);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .apple-note-editor ul, .apple-note-editor ol {
          padding-left: 1.6rem;
          margin: 0.3rem 0;
        }
        .apple-note-editor li { margin: 0.15rem 0; }

        /* Alignment via data-align attribute (style="text-align" is normalized away) */
        .apple-note-editor [data-align="center"] { text-align: center; }
        .apple-note-editor [data-align="right"]  { text-align: right;  }

        /* Checklist row — visually identical to an ElementTableRow:
           [square checkbox] [AtomIcon] [text]. Both markers are pure CSS
           pseudo-elements so contentEditable doesn't have to manage extra
           DOM nodes. The checkbox swaps between an outlined SVG and an
           emerald-filled SVG with white tick, matching the List Done
           affordance exactly. */
        .apple-note-editor ul[data-checklist="true"] {
          list-style: none;
          padding-left: 0.25rem;
        }
        .apple-note-editor ul[data-checklist="true"] > li {
          position: relative;
          padding-left: 2.5rem; /* 16px checkbox + 6px gap + 14px atom + 4px gap */
          cursor: text;
        }
        /* ::before = the checkbox itself (single SVG; swaps on data-checked) */
        .apple-note-editor ul[data-checklist="true"] > li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0.35em;
          width: 1rem;
          height: 1rem;
          cursor: pointer;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='0.5' y='0.5' width='15' height='15' rx='2' fill='none' stroke='%23999' stroke-width='1'/></svg>");
        }
        .apple-note-editor ul[data-checklist="true"] > li:hover::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='0.5' y='0.5' width='15' height='15' rx='2' fill='none' stroke='%23666' stroke-width='1'/></svg>");
        }
        .apple-note-editor ul[data-checklist="true"] > li[data-checked="true"]::before,
        .apple-note-editor ul[data-checklist="true"] > li[data-checked="true"]:hover::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='2' fill='%2310b981'/><path d='M4 8.5 L7 11.5 L12 5.5' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
        }
        /* ::after = the AtomIcon (the same orbital marker used in Element List rows) */
        .apple-note-editor ul[data-checklist="true"] > li::after {
          content: "";
          position: absolute;
          left: 1.4rem;
          top: 0.45em;
          width: 14px;
          height: 14px;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='2' fill='%23888' stroke='none'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5' transform='rotate(60 12 12)'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5' transform='rotate(120 12 12)'/><circle cx='21.5' cy='12' r='1.2' fill='%23888' stroke='none'/><circle cx='6.8' cy='4.4' r='1.2' fill='%23888' stroke='none'/><circle cx='6.8' cy='19.6' r='1.2' fill='%23888' stroke='none'/></svg>");
        }
        .apple-note-editor ul[data-checklist="true"] > li[data-checked="true"] {
          color: var(--muted-foreground);
          text-decoration: line-through;
        }
      `}</style>
    </>
  );
}

// =============================================================
// Floating toolbar
// =============================================================
function FloatingToolbar({
  x,
  y,
  onCommand,
  onChecklist,
  onLink,
}: {
  x: number;
  y: number;
  onCommand: (cmd: string, value?: string) => void;
  onChecklist: () => void;
  onLink: () => void;
}) {
  // Constrain the toolbar to the viewport horizontally.
  const width = 460;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
  const top = Math.max(8, y - 40);

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg px-1 py-1"
      style={{ left, top, width }}
      onMouseDown={(e) => e.preventDefault() /* keep selection */}
    >
      <TbBtn icon={Type} title="本文" onClick={() => onCommand('formatBlock', 'P')} />
      <TbBtn icon={Heading1} title="見出し1" onClick={() => onCommand('formatBlock', 'H1')} />
      <TbBtn icon={Heading2} title="見出し2" onClick={() => onCommand('formatBlock', 'H2')} />
      <TbDivider />
      <TbBtn icon={Bold} title="太字 (⌘B)" onClick={() => onCommand('bold')} />
      <TbBtn icon={Italic} title="斜体 (⌘I)" onClick={() => onCommand('italic')} />
      <TbBtn icon={UnderlineIcon} title="下線 (⌘U)" onClick={() => onCommand('underline')} />
      <TbBtn icon={Strikethrough} title="取り消し線" onClick={() => onCommand('strikeThrough')} />
      <TbDivider />
      <TbBtn icon={AlignLeft} title="左揃え" onClick={() => onCommand('justifyLeft')} />
      <TbBtn icon={AlignCenter} title="中央揃え" onClick={() => onCommand('justifyCenter')} />
      <TbBtn icon={AlignRight} title="右揃え" onClick={() => onCommand('justifyRight')} />
      <TbDivider />
      <TbBtn icon={List} title="箇条書き" onClick={() => onCommand('insertUnorderedList')} />
      <TbBtn icon={ListOrdered} title="番号付き" onClick={() => onCommand('insertOrderedList')} />
      <TbBtn icon={ListTodo} title="チェックリスト" onClick={onChecklist} />
      <TbDivider />
      <TbBtn icon={Quote} title="引用" onClick={() => onCommand('formatBlock', 'BLOCKQUOTE')} />
      <TbBtn icon={LinkIcon} title="リンク" onClick={onLink} />
    </div>
  );
}

function TbBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-accent text-foreground/80 hover:text-foreground"
    >
      <Icon size={14} />
    </button>
  );
}

function TbDivider() {
  return <span className="w-px h-4 bg-border mx-0.5" />;
}

// =============================================================
// Helpers
// =============================================================
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// Convert any inline `style="text-align: x"` produced by execCommand justify*
// to `data-align="x"`. Keeps the DB shape consistent.
function normalizeAlignment(root: HTMLElement | null): void {
  if (!root) return;
  const all = root.querySelectorAll<HTMLElement>('[style*="text-align"]');
  for (const el of Array.from(all)) {
    const m = el.getAttribute('style')?.match(/text-align\s*:\s*(left|center|right)/i);
    if (!m) continue;
    const align = m[1].toLowerCase();
    el.style.removeProperty('text-align');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    if (align === 'left') el.removeAttribute('data-align');
    else el.setAttribute('data-align', align);
  }
}

// Find the block-level elements that the given range touches.
function collectSelectedBlocks(root: HTMLElement, range: Range): HTMLElement[] {
  const blockTags = new Set(['P', 'H1', 'H2', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV']);
  const startBlock = closestBlock(range.startContainer, root, blockTags);
  const endBlock = closestBlock(range.endContainer, root, blockTags);
  if (!startBlock) return [];
  if (startBlock === endBlock || !endBlock) return [startBlock];

  // Walk forward in document order from startBlock to endBlock.
  const all = Array.from(root.querySelectorAll<HTMLElement>('p, h1, h2, li, blockquote, pre, div'));
  const startIdx = all.indexOf(startBlock);
  const endIdx = all.indexOf(endBlock);
  if (startIdx < 0 || endIdx < 0) return [startBlock];
  return all.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
}

function closestBlock(node: Node, root: HTMLElement, blockTags: Set<string>): HTMLElement | null {
  let cur: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (cur && cur !== root) {
    if (cur.nodeType === 1 && blockTags.has((cur as HTMLElement).tagName)) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}
