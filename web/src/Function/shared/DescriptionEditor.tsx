'use client';

import { useMemo, useRef, useState } from 'react';
import { NoteEditor } from '@/Function/notebook/editor/NoteEditor';
import { htmlToMarkdown, markdownToHtml } from '@/Function/shared/markdownHtml';

// The description of anything — an Element, an Object, a Domain, an
// Strategy — written and read the same way: a short
// Note body kept as Markdown, edited in place, with its headings, lists,
// tables and diagrams. It saves when the focus leaves it (or at once for a
// one-click edit such as a checklist box), and starts over from the saved
// text when that changes elsewhere while nobody here is typing in it.
// A host that shows another subject keys it by that subject's id.
export function DescriptionEditor({ value, onSave, onChange, placeholder, readOnly = false, emptyText }: {
  /** The saved description, as Markdown. */
  value: string;
  /** Called with the Markdown when it differs from `value`. */
  onSave: (markdown: string) => void | Promise<void>;
  /** Every edit, as Markdown (a host keeping an unsaved draft). */
  onChange?: (markdown: string) => void;
  placeholder: string;
  readOnly?: boolean;
  /** What a read-only, empty description says (nothing when omitted). */
  emptyText?: string;
}) {
  const [editing, setEditing] = useState(false);
  // The text the editor started from, and a count that restarts it.
  const [seed, setSeed] = useState(value);
  const [rev, setRev] = useState(0);
  if (value !== seed && !editing) {
    setSeed(value);
    setRev((n) => n + 1);
  }
  const html = useMemo(() => markdownToHtml(seed), [seed]);
  const draft = useRef(value);
  const save = (markdown: string) => {
    if (markdown === value) return;
    // What it saves is what it already shows: the echo of the save must not
    // restart it.
    setSeed(markdown);
    void onSave(markdown);
  };

  if (readOnly) {
    if (!value.trim()) return emptyText ? <p className="text-[14px] leading-relaxed text-muted-foreground">{emptyText}</p> : null;
    return <NoteEditor key={rev} compact editable={false} initialHtml={html} />;
  }
  return (
    <div onFocus={() => { if (!editing) { draft.current = seed; setEditing(true); } }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setEditing(false);
        save(draft.current);
      }}>
      <NoteEditor key={rev} compact initialHtml={html} placeholder={placeholder}
        onChange={(next) => { draft.current = htmlToMarkdown(next); onChange?.(draft.current); }}
        onCommit={(next) => { draft.current = htmlToMarkdown(next); save(draft.current); }} />
    </div>
  );
}
