'use client';

import { useCallback, useEffect, useState } from 'react';
import { summarizeNoteContent } from './aiSummary';

interface TicketizeDialogProps {
  defaultTitle: string;
  defaultSummary: string;
  sourceFileName: string;
  sourceContent: string;
  onClose: () => void;
  onCreate: (input: { title: string; summary: string }) => void;
}

export function TicketizeDialog({
  defaultTitle,
  defaultSummary,
  sourceFileName,
  sourceContent,
  onClose,
  onCreate,
}: TicketizeDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [summary, setSummary] = useState(defaultSummary);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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

  const runAiSummarize = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const next = await summarizeNoteContent({ title, content: sourceContent });
      if (next) setSummary(next);
      else setAiError('要約が空でした');
    } catch (err) {
      setAiError((err as Error).message || 'Failed to summarize');
    } finally {
      setAiLoading(false);
    }
  }, [title, sourceContent]);

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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Summary
              </label>
              <button
                type="button"
                onClick={runAiSummarize}
                disabled={aiLoading}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 border border-border hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-wait"
                title="AIでNote本文から要約を生成"
              >
                {aiLoading ? (
                  <>
                    <Spinner />
                    <span>要約中...</span>
                  </>
                ) : (
                  <>
                    <SparkleIcon />
                    <span>AIで要約</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="このNoteの要約 (3〜5行)"
              rows={5}
              className="w-full bg-transparent outline-none text-[13px] leading-[1.6] text-foreground/90 border border-border px-2.5 py-2 focus:border-foreground/40 resize-none"
            />
            {aiError && (
              <div className="mt-1.5 text-[11px] text-destructive">
                {aiError}
              </div>
            )}
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

function SparkleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="14 40" strokeLinecap="round" />
    </svg>
  );
}
