'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { draftObjectFromTicket } from './objectDraft';
import type { Ticket } from './types';

interface ObjectDraftDialogProps {
  ticket: Ticket;
  onClose: () => void;
  onCreate: (input: { name: string; description?: string; color?: string }) => Promise<void>;
}

type Phase = 'generating' | 'ready' | 'error';

// Preset palette — picked from Tailwind neutrals / tinted tones to match
// Alcon's muted aesthetic. AI can also return any hex via draftObject.
const COLOR_OPTIONS: { hex: string; label: string }[] = [
  { hex: '#6B7280', label: 'Graphite' },
  { hex: '#10B981', label: 'Emerald' },
  { hex: '#3B82F6', label: 'Blue' },
  { hex: '#8B5CF6', label: 'Violet' },
  { hex: '#F59E0B', label: 'Amber' },
  { hex: '#F43F5E', label: 'Rose' },
];

export function ObjectDraftDialog({ ticket, onClose, onCreate }: ObjectDraftDialogProps) {
  const [phase, setPhase] = useState<Phase>('generating');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(ticket.title);
  const [description, setDescription] = useState(
    ticket.structured?.overview ?? ticket.summary ?? ''
  );
  const [color, setColor] = useState<string | undefined>(undefined);

  const run = useCallback(async () => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const draft = await draftObjectFromTicket(ticket);
      if (draft.name) setName(draft.name);
      if (draft.description) setDescription(draft.description);
      if (draft.color) setColor(draft.color);
      setPhase('ready');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to draft object');
      setPhase('error');
    }
  }, [ticket]);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const submit = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onCreate({
        name: n,
        description: description.trim() || undefined,
        color,
      });
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create Object');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, color, onCreate]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl bg-card border border-border shadow-2xl flex flex-col max-h-[88vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Object化する
            </div>
            <div className="text-[12px] text-muted-foreground">
              From Commit <span className="text-foreground/80 font-medium">{ticket.title}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={phase === 'generating'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border border-border hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-wait"
            title="AIで再生成"
          >
            {phase === 'generating' ? <Spinner /> : <SparkleIcon />}
            <span>{phase === 'generating' ? '生成中...' : '再生成'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {phase === 'generating' && <GeneratingState />}
          {phase === 'error' && <ErrorState message={errorMsg} onRetry={run} />}
          {phase === 'ready' && (
            <div className="px-5 pt-5 pb-6 space-y-4">
              <Field label="Name">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Object name"
                  className="w-full bg-transparent outline-none text-[15px] font-semibold text-foreground border border-border px-2.5 py-2 focus:border-foreground/40"
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="2〜3行の概要"
                  rows={3}
                  className="w-full bg-transparent outline-none text-[13px] leading-[1.6] text-foreground/90 border border-border px-2.5 py-2 focus:border-foreground/40 resize-none"
                />
              </Field>

              <Field label="Color">
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.hex}
                      type="button"
                      onClick={() => setColor(opt.hex)}
                      title={opt.label}
                      aria-label={opt.label}
                      className={[
                        'w-7 h-7 border transition-shadow',
                        color === opt.hex
                          ? 'border-foreground/70 ring-1 ring-foreground/40 ring-offset-1 ring-offset-card'
                          : 'border-transparent',
                      ].join(' ')}
                      style={{ backgroundColor: opt.hex }}
                    />
                  ))}
                  {color && !COLOR_OPTIONS.some((o) => o.hex === color) && (
                    <span
                      title={color}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                    >
                      <span
                        className="w-4 h-4 inline-block border border-border"
                        style={{ backgroundColor: color }}
                      />
                      {color}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setColor(undefined)}
                    className="text-[11px] ml-1 text-muted-foreground hover:text-foreground"
                  >
                    clear
                  </button>
                </div>
              </Field>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-[11px] text-destructive min-w-0 flex-1 break-words">
            {submitError}
          </div>
          <div className="flex items-center gap-2">
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
              disabled={phase !== 'ready' || !name.trim() || submitting}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 bg-foreground text-background disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {submitting && <Spinner />}
              {submitting ? 'Creating...' : 'Create Object'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner size={18} />
      <div className="text-[12px]">AI が Object 案を生成しています...</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-destructive px-6 text-center">
      <div className="text-[12px]">AIドラフト生成に失敗しました</div>
      <div className="text-[11px] text-muted-foreground max-w-sm break-words">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="text-[12px] px-3 py-1.5 border border-border hover:bg-accent text-foreground/80 hover:text-foreground mt-1"
      >
        Retry
      </button>
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

function Spinner({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="14 40" strokeLinecap="round" />
    </svg>
  );
}
