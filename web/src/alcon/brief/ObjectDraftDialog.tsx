'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { draftObjectFromBrief, type ObjectDraftElement } from './objectDraft';
import type { Brief } from './types';
import { useSystems } from '@/alcon/system/systemsStore';
import { ChevronDown } from 'lucide-react';

interface ObjectDraftDialogProps {
  brief: Brief;
  defaultSystemId?: string | null;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description?: string;
    color?: string;
    systemId: string | null;
    elements: ObjectDraftElement[];
  }) => Promise<void>;
}

type Phase = 'generating' | 'ready' | 'error';

interface ElementItem extends ObjectDraftElement {
  include: boolean;
}

export function ObjectDraftDialog({ brief, defaultSystemId, onClose, onCreate }: ObjectDraftDialogProps) {
  const systems = useSystems();
  const [phase, setPhase] = useState<Phase>('generating');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(brief.title);
  const [description, setDescription] = useState(
    brief.structured?.overview ?? brief.summary ?? ''
  );
  // Keep AI-suggested color flowing through to creation but skip the
  // picker UI — color is rarely set at draft time and adds noise.
  const [color, setColor] = useState<string | undefined>(undefined);
  const [elements, setElements] = useState<ElementItem[]>([]);
  const [systemId, setSystemId] = useState<string | null>(
    defaultSystemId ?? systems[0]?.id ?? null
  );
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const systemPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (systemPickerRef.current && !systemPickerRef.current.contains(e.target as Node)) {
        setSystemPickerOpen(false);
      }
    };
    if (systemPickerOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [systemPickerOpen]);

  const activeSystem = systems.find((s) => s.id === systemId) ?? systems[0];

  const run = useCallback(async () => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const draft = await draftObjectFromBrief(brief);
      if (draft.name) setName(draft.name);
      if (draft.description) setDescription(draft.description);
      if (draft.color) setColor(draft.color);
      setElements(draft.elements.map((e) => ({ ...e, include: true })));
      setPhase('ready');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to draft object');
      setPhase('error');
    }
  }, [brief]);

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
        systemId,
        elements: elements.filter((e) => e.include).map(({ include: _i, ...rest }) => rest),
      });
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create Object');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, color, elements, systemId, onCreate]);

  const includedCount = elements.filter((e) => e.include).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-full z-10"
        >
          <CloseIcon />
        </button>

        <div className="px-5 pt-5 pb-3 pr-14 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Object化する
            </div>
            <div className="text-[12px] text-muted-foreground">
              From Brief <span className="text-foreground/80 font-medium">{brief.title}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={phase === 'generating'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border border-border rounded-md hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-wait mr-8"
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
                  className="w-full bg-transparent outline-none text-[15px] font-semibold text-foreground border border-border rounded-lg px-2.5 py-2 focus:border-foreground/40"
                />
              </Field>

              <Field label="System">
                <div ref={systemPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSystemPickerOpen((v) => !v)}
                    className="w-full flex items-center gap-2 text-[13px] text-foreground border border-border rounded-lg px-2.5 py-2 hover:border-foreground/40 focus:border-foreground/40 focus:outline-none"
                  >
                    {activeSystem?.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeSystem.icon} alt="" className="w-5 h-5 rounded object-cover" />
                    ) : (
                      <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                        {activeSystem?.name.charAt(0) ?? '?'}
                      </div>
                    )}
                    <span className="flex-1 text-left truncate">{activeSystem?.name ?? 'No System'}</span>
                    <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                  </button>
                  {systemPickerOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg py-1 max-h-60 overflow-auto">
                      {systems.map((sys) => (
                        <button
                          key={sys.id}
                          type="button"
                          onClick={() => { setSystemId(sys.id); setSystemPickerOpen(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-accent transition-colors ${
                            sys.id === systemId ? 'bg-accent/50 text-foreground' : 'text-foreground/80'
                          }`}
                        >
                          {sys.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sys.icon} alt="" className="w-5 h-5 rounded object-cover" />
                          ) : (
                            <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                              {sys.name.charAt(0)}
                            </div>
                          )}
                          <span className="flex-1 truncate">{sys.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="2〜3行の概要"
                  rows={3}
                  className="w-full bg-transparent outline-none text-[13px] leading-[1.6] text-foreground/90 border border-border rounded-lg px-2.5 py-2 focus:border-foreground/40 resize-none"
                />
              </Field>

              <div className="mt-2 pt-4 border-t border-border/60">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Elements
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {includedCount} / {elements.length} 追加
                  </span>
                </div>
                {elements.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/70">
                    Brief に Action Items が無かったため、Elements は提案されませんでした。
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {elements.map((el, i) => (
                      <li
                        key={i}
                        className="group flex items-start gap-2 py-1.5 border-t border-border/40 first:border-t-0"
                      >
                        <input
                          type="checkbox"
                          checked={el.include}
                          onChange={() =>
                            setElements((prev) =>
                              prev.map((e, j) => (j === i ? { ...e, include: !e.include } : e))
                            )
                          }
                          className="mt-1 shrink-0 accent-foreground"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-foreground/90 leading-[1.45] break-words">
                            {el.title}
                          </div>
                          {el.description && (
                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-[1.45] break-words">
                              {el.description}
                            </div>
                          )}
                          {el.priority && el.priority !== 'medium' && (
                            <div className="text-[10px] text-muted-foreground/80 mt-0.5 tabular-nums">
                              priority: {el.priority}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setElements((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive px-1 mt-0.5"
                          aria-label="Remove"
                          title="Remove"
                        >
                          <XIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-[11px] text-destructive min-w-0 flex-1 break-words">
            {submitError}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={phase !== 'ready' || !name.trim() || submitting}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 bg-foreground text-background rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting && <Spinner />}
            {submitting
              ? 'Creating...'
              : includedCount > 0
              ? `Create Object + ${includedCount} Element${includedCount === 1 ? '' : 's'}`
              : 'Create Object'}
          </button>
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
      <div className="text-[12px]">AI が Object と Elements を起草しています...</div>
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
        className="text-[12px] px-3 py-1.5 border border-border rounded-md hover:bg-accent text-foreground/80 hover:text-foreground mt-1"
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
