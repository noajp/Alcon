'use client';

import { useCallback, useEffect, useState } from 'react';

interface TicketizeDialogProps {
  defaultTitle: string;
  defaultSummary: string;
  sourceFileName: string;
  onClose: () => void;
  onCreate: (input: { title: string; summary: string }) => void;
}

export function TicketizeDialog({
  defaultTitle,
  defaultSummary,
  sourceFileName,
  onClose,
  onCreate,
}: TicketizeDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [summary, setSummary] = useState(defaultSummary);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const submit = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    onCreate({ title: t, summary: summary.trim() });
  }, [title, summary, onCreate]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-card border border-border shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Ticket化する
          </div>
          <div className="text-[12px] text-muted-foreground">
            From <span className="text-foreground/80 font-medium">{sourceFileName}</span>
          </div>
        </div>

        <div className="flex-1 p-5 space-y-4">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
              Title
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Untitled"
              className="w-full bg-transparent outline-none text-[15px] font-semibold text-foreground border border-border px-2.5 py-2 focus:border-foreground/40"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="このNoteの要約 (3〜5行)"
              rows={5}
              className="w-full bg-transparent outline-none text-[13px] leading-[1.6] text-foreground/90 border border-border px-2.5 py-2 focus:border-foreground/40 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim()}
            className="text-[12px] font-medium px-3 py-1.5 bg-foreground text-background disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
