'use client';

import { Button } from '@/ui/button';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { draftObjectFromBrief, type ObjectDraft, type ObjectDraftElement } from '@/hooks/objectDraft';
import type { Brief } from '@/types/notes';
import { useDomains } from '@/hooks/useSupabase';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface ObjectDraftDialogProps {
  brief: Brief;
  defaultDomainId?: string | null;
  /** Pre-computed draft to skip the initial AI call (used by the Note → Obj化 session cache). */
  initialDraft?: ObjectDraft;
  /** Fired whenever a fresh draft becomes available (initial or after Regenerate) — caller caches it. */
  onDraftReady?: (draft: ObjectDraft) => void;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description?: string;
    color?: string;
    domainId: string | null;
    elements: ObjectDraftElement[];
  }) => Promise<void>;
}

type Phase = 'generating' | 'ready' | 'error';

interface ElementItem extends ObjectDraftElement {
  include: boolean;
}

const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', low: 'Low' };

export function ObjectDraftDialog({ brief, defaultDomainId, initialDraft, onDraftReady, onClose, onCreate }: ObjectDraftDialogProps) {
  const { t } = useI18n();
  const { data: domains } = useDomains();
  const [phase, setPhase] = useState<Phase>('generating');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(brief.title);
  const [description, setDescription] = useState(
    brief.structured?.overview ?? brief.summary ?? ''
  );
  const [color, setColor] = useState<string | undefined>(undefined);
  const [elements, setElements] = useState<ElementItem[]>([]);
  const [domainId, setDomainId] = useState<string | null>(
    defaultDomainId ?? domains[0]?.id ?? null
  );
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const domainPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (domainPickerRef.current && !domainPickerRef.current.contains(e.target as Node)) {
        setDomainPickerOpen(false);
      }
    };
    if (domainPickerOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [domainPickerOpen]);

  const activeDomain = domains.find((d) => d.id === domainId) ?? domains[0];

  const applyDraft = useCallback((draft: ObjectDraft) => {
    if (draft.name) setName(draft.name);
    if (draft.description) setDescription(draft.description);
    if (draft.color) setColor(draft.color);
    setElements(draft.elements.map((e) => ({ ...e, include: true })));
    setPhase('ready');
  }, []);

  const run = useCallback(async () => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const draft = await draftObjectFromBrief(brief);
      applyDraft(draft);
      onDraftReady?.(draft);
    } catch (err) {
      setErrorMsg((err as Error).message || t('Could not draft the Object.'));
      setPhase('error');
    }
  }, [brief, applyDraft, onDraftReady, t]);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (initialDraft) {
      // Session cache hit — skip the AI call and render the prior draft.
      applyDraft(initialDraft);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEscapeLayer(true, onClose);

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
        domainId,
        elements: elements.filter((e) => e.include).map(({ include: _i, ...rest }) => rest),
      });
    } catch (err) {
      setSubmitError((err as Error).message || t('Could not create the Object.'));
    } finally {
      setSubmitting(false);
    }
  }, [name, description, color, elements, domainId, onCreate, t]);

  const includedCount = elements.filter((e) => e.include).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-xl bg-card border border-border rounded-lg shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="absolute right-3 top-3 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-full z-10"
        >
          <CloseIcon />
        </button>

        <div className="px-5 pt-5 pb-3 pr-14 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              {t('Turn into an Object')}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {t('From {title}', { title: brief.title })}
            </div>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={run}
            disabled={phase === 'generating'}
            className="mr-8"
            title={t('Regenerate with AI')}
          >
            {phase === 'generating' && <Spinner />}
            {phase === 'generating' ? t('Drafting…') : t('Regenerate')}
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {phase === 'generating' && <GeneratingState />}
          {phase === 'error' && <ErrorState message={errorMsg} onRetry={run} />}
          {phase === 'ready' && (
            <div className="px-5 pt-5 pb-6 space-y-4">
              <Field label={t('Name')}>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Object name')}
                  className="w-full bg-muted/40 outline-none text-[15px] font-semibold text-foreground rounded-lg px-2.5 py-2 border-none"
                />
              </Field>

              <Field label={t('Domain')}>
                <div ref={domainPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setDomainPickerOpen((v) => !v)}
                    className="w-full flex items-center gap-2 text-[13px] text-foreground border border-border rounded-lg px-2.5 py-2 hover:border-foreground/40"
                  >
                    <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                      {activeDomain?.name.charAt(0) ?? '?'}
                    </div>
                    <span className="flex-1 text-left truncate">{activeDomain?.name ?? t('No Domain')}</span>
                    <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                  </button>
                  {domainPickerOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg py-1 max-h-60 overflow-auto">
                      {domains.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => { setDomainId(d.id); setDomainPickerOpen(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-accent transition-colors ${
                            d.id === domainId ? 'bg-accent/50 text-foreground' : 'text-foreground/80'
                          }`}
                        >
                          <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                            {d.name.charAt(0)}
                          </div>
                          <span className="flex-1 truncate">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field label={t('Description')}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('A two- or three-line summary')}
                  rows={3}
                  className="w-full bg-muted/40 outline-none text-[13px] leading-[1.6] text-foreground/90 rounded-lg px-2.5 py-2 border-none resize-none"
                />
              </Field>

              <div className="mt-2 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {t('Elements')}
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {t('{included} of {total} added', { included: includedCount, total: elements.length })}
                  </span>
                </div>
                {elements.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/70">
                    {t('No Elements were suggested because the note has no action items.')}
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {elements.map((el, i) => (
                      <li
                        key={i}
                        className="group flex items-start gap-2 py-1.5"
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
                              {t('Priority: {priority}', { priority: t(PRIORITY_LABEL[el.priority] ?? el.priority) })}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setElements((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive px-1 mt-0.5"
                          aria-label={t('Remove')}
                          title={t('Remove')}
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
          <Button variant="primary"
            type="button"
            onClick={submit}
            disabled={phase !== 'ready' || !name.trim() || submitting}
          >
            {submitting && <Spinner />}
            {submitting
              ? t('Creating…')
              : includedCount === 1
              ? t('Create Object + 1 Element')
              : includedCount > 1
              ? t('Create Object + {count} Elements', { count: includedCount })
              : t('Create Object')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function GeneratingState() {
  const { t } = useI18n();
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner size={18} />
      <div className="text-[12px]">{t('AI is drafting the Object and its Elements…')}</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-destructive px-6 text-center">
      <div className="text-[12px]">{t('Could not generate the AI draft.')}</div>
      <div className="text-[11px] text-muted-foreground max-w-sm break-words">{message}</div>
      <Button variant="ghost" size="sm" onClick={onRetry} className="mt-1">
        {t('Retry')}
      </Button>
    </div>
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
