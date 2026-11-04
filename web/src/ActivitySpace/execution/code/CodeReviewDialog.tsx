'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, ChevronLeft, ChevronRight, ExternalLink, FileCode2, GitMerge, ListOrdered, PanelLeft, PanelRight, RefreshCw, Search, Sparkles } from '@/ui/icons';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { formatAge } from '@/Function/shared/dateUtils';
import { formatDisplayName, getCachedDisplayNames } from '@/Function/settings/preferencesStore';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { isAgentRunOpen, useAgentRun } from '@/Function/copilot/agentData';
import {
  buildFileTree, changeSize, iteratePrompt, matchFile, readGuide, readIntentCheck, reviewState, splitPath, treeOrder,
} from '@/Function/codeReview/diffModel';
import {
  useCodeChangeActions, useCodeChangeComments, useCodeChangeReviews, useCodeCommentActions, useCodeDiff, useRetryPublish,
} from '@/hooks/codeChangeData';
import type { CodeChange, CodeChangeComment, Json } from '@/types/database';
import { CodeChangeStateIcon, LineCounts, StatePill } from './codeChangeLabels';
import { DiffFileView, type DiffLayout, type LineAnchor } from './DiffFileView';
import { IntentPanel } from './IntentPanel';

// The review screen for one code change: files on the left, the diff in the
// middle, and on the right what the change was meant to do — the Element and
// its Strategies' intent — with the AI's check and the team's verdicts.
//
// A large change reads as a guided review: the AI splits it into a few
// sections, each with what it changes and why, and the reviewer steps through
// them. Verdicts and line comments go to the pull request on GitHub as well;
// the points still open can be sent back to the agent, which pushes to the
// same branch while the diff follows. ⌘B / Ctrl+B switches unified and split.
//
// The diff is what has to stay readable, so the screen gives way around it:
// the files and intent columns fold away when the screen is narrow (each can
// be opened from the toolbar), and split falls back to unified when the diff
// is too narrow for two columns of code.

const LAYOUT_KEY = 'alcon.codeReview.layout';
const PANELS_KEY = 'alcon.codeReview.panels';
/** Files a viewer marked reviewed, per change: path → the head commit it was marked on. */
const reviewedKey = (changeId: string) => `alcon.codeReview.reviewed.${changeId}`;

function readReviewed(changeId: string): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(reviewedKey(changeId)) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string> : {};
  } catch { return {}; }
}

/** Below these widths of the whole screen a column starts folded. */
const FILES_FROM = 1180;
const INTENT_FROM = 860;
/** Below this width of the diff column, split shows as unified. */
const SPLIT_FROM = 760;

type Panels = { files: boolean | null; intent: boolean | null };

function readPanels(): Panels {
  try {
    const raw = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') as Partial<Panels>;
    return { files: typeof raw.files === 'boolean' ? raw.files : null, intent: typeof raw.intent === 'boolean' ? raw.intent : null };
  } catch { return { files: null, intent: null }; }
}

/** The width of an element, kept current. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setWidth(el.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width];
}
const MERGE_KEY = 'alcon.codeReview.mergeMethod';

type MergeMethod = 'merge' | 'squash' | 'rebase';
type Mode = 'guided' | 'files';

function readLayout(): DiffLayout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'unified'; } catch { return 'unified'; }
}

function readMergeMethod(): MergeMethod {
  try {
    const v = localStorage.getItem(MERGE_KEY);
    return v === 'squash' || v === 'rebase' ? v : 'merge';
  } catch { return 'merge'; }
}

export function CodeReviewDialog({ change, open, onOpenChange }: { change: CodeChange; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        {open && <CodeReviewScreen change={change} inDialog />}
      </DialogContent>
    </Dialog>
  );
}

/** The review screen itself — in the Reviews mode's main pane, or in a
 *  dialog over an Element or a Strategy. */
export function CodeReviewScreen({ change: given, inDialog = false }: { change: CodeChange; inDialog?: boolean }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  // What this screen learned since it opened (a new guide, a merge) stays on
  // top of the row it was given, wherever that row came from.
  const [patch, setPatch] = useState<Partial<CodeChange>>({});
  const change = useMemo(() => ({ ...given, ...patch }), [given, patch]);
  const agent = useAgentRun(change.element_id);
  const agentWorking = isAgentRunOpen(agent.run);
  const diff = useCodeDiff(change, agentWorking);
  const comments = useCodeChangeComments(change.id);
  const reviews = useCodeChangeReviews(change.id);
  const commentActions = useCodeCommentActions(change.id);
  const retry = useRetryPublish(change.id);
  const actions = useCodeChangeActions(change.element_id);
  const [layout, setLayout] = useState<DiffLayout>(() => readLayout());
  const fileRefs = useRef(new Map<string, HTMLDivElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // Reviewed is each viewer's own progress through the files; a new push
  // un-marks the files it was given on an older head.
  const [reviewedMap, setReviewedMap] = useState<Record<string, string>>(() => readReviewed(given.id));
  const isReviewed = (path: string) => !!change.head_sha && reviewedMap[path] === change.head_sha;
  const toggleReviewed = (path: string) => {
    const next = { ...reviewedMap };
    if (isReviewed(path)) delete next[path]; else next[path] = change.head_sha ?? '';
    setReviewedMap(next);
    try { localStorage.setItem(reviewedKey(change.id), JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };

  const [rootRef, rootWidth] = useWidth<HTMLDivElement>();
  const [mainRef, mainWidth] = useWidth<HTMLElement>();
  // A column's own choice wins; until one is made it follows the width.
  const [panels, setPanels] = useState<Panels>(() => readPanels());
  const showFiles = panels.files ?? rootWidth >= FILES_FROM;
  const showIntent = panels.intent ?? rootWidth >= INTENT_FROM;
  const togglePanel = (key: keyof Panels, shown: boolean) => {
    const next = { ...panels, [key]: !shown };
    setPanels(next);
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };
  const splitFits = mainWidth === 0 || mainWidth >= SPLIT_FROM;
  const shownLayout: DiffLayout = layout === 'split' && !splitFits ? 'unified' : layout;

  const setAndKeepLayout = useCallback((next: DiffLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* per-viewer convenience only */ }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setAndKeepLayout(layout === 'unified' ? 'split' : 'unified');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, setAndKeepLayout]);

  const files = useMemo(() => diff.data?.files ?? [], [diff.data]);
  const githubComments = useMemo(() => diff.data?.githubComments ?? [], [diff.data]);
  const filenames = useMemo(() => files.map((f) => f.filename), [files]);
  const tree = useMemo(() => buildFileTree(filenames), [filenames]);
  const ordered = useMemo(() => {
    const byName = new Map(files.map((f) => [f.filename, f]));
    return treeOrder(tree).map((n) => byName.get(n)!).filter(Boolean);
  }, [files, tree]);
  const size = useMemo(() => changeSize(files), [files]);
  const cited = useMemo(() => {
    const c = readIntentCheck(change.intent_check);
    return new Set([...(c?.criteria.flatMap((x) => x.files) ?? []), ...(c?.outOfScope.map((o) => o.path) ?? [])]);
  }, [change.intent_check]);
  const guide = useMemo(() => readGuide(change.guide, filenames), [change.guide, filenames]);

  // Guided when there is a guide to follow, or when the change is big enough
  // to want one; the person's own choice wins once made.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const mode: Mode = chosenMode ?? (guide || files.length > 8 ? 'guided' : 'files');
  const [step, setStep] = useState(0);
  const section = guide?.sections[Math.min(step, guide.sections.length - 1)] ?? null;

  const commentsByFile = useMemo(() => {
    const map = new Map<string, CodeChangeComment[]>();
    for (const c of comments.data ?? []) map.set(c.path, [...(map.get(c.path) ?? []), c]);
    return map;
  }, [comments.data]);
  const githubByFile = useMemo(() => {
    const map = new Map<string, typeof githubComments>();
    for (const c of githubComments) map.set(c.path, [...(map.get(c.path) ?? []), c]);
    return map;
  }, [githubComments]);

  const openFile = (path: string) => {
    const target = matchFile(path, filenames);
    if (!target) return;
    // In a guided review, a cited file opens on the section that holds it.
    if (mode === 'guided' && guide) {
      const at = guide.sections.findIndex((s) => s.files.includes(target));
      if (at >= 0) setStep(at);
    }
    setFocused(target);
    requestAnimationFrame(() => fileRefs.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const addComment = async (anchor: LineAnchor, body: string) => {
    await commentActions.add.mutateAsync({
      ...anchor, body, head_sha: change.head_sha,
      author_name: formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames()),
    });
  };

  const writeGuide = () => actions.guide.mutate(change.id, {
    onSuccess: ({ guide: g }) => { setPatch((p) => ({ ...p, guide: g as Json })); setStep(0); setChosenMode('guided'); },
  });

  const sizeTitle = size.additions !== size.totalAdditions || size.deletions !== size.totalDeletions
    ? t('Implementation only. All files: +{a} −{d}', { a: size.totalAdditions, d: size.totalDeletions })
    : undefined;

  const visible = mode === 'guided' && section ? ordered.filter((f) => section.files.includes(f.filename)) : ordered;
  const guideStale = !!guide?.headSha && !!change.head_sha && guide.headSha !== change.head_sha;

  const prompt = useMemo(() => iteratePrompt({
    repo: change.repo, number: change.number, url: change.url, headRef: change.head_ref,
    comments: (comments.data ?? []).map((c) => ({ path: c.path, line: c.line, body: c.body, author: c.author_name, resolved: c.resolved })),
    reviews: (reviews.data ?? []).map((r) => ({
      verdict: r.verdict, body: r.body, reviewer: r.reviewer_name,
      stale: !!change.head_sha && !!r.head_sha && r.head_sha !== change.head_sha,
    })),
  }), [change.repo, change.number, change.url, change.head_ref, change.head_sha, comments.data, reviews.data]);

  const Title = inDialog ? DialogTitle : 'h1';
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Header */}
        <div className={`flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4 ${inDialog ? 'pr-12' : ''}`}>
          <CodeChangeStateIcon state={change.state} size={16} />
          <Title className="min-w-0 truncate text-[14px] font-medium">{change.title || `${change.repo}#${change.number}`}</Title>
          <StatePill state={change.state} />
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{change.repo}#{change.number}</span>
          {change.head_ref && (
            <span className="hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground xl:inline">
              {change.head_ref} → {change.base_ref}
            </span>
          )}
          <div className="flex-1" />
          {(change.state === 'open' || change.state === 'draft') && (
            <IterateButton
              prompt={prompt}
              working={agentWorking}
              starting={agent.starting}
              error={agent.error}
              onStart={() => agent.start({ prompt, domainId: getActiveDomainId(), triggeredFrom: 'detail' })}
            />
          )}
          {change.state === 'open' && (
            <MergeControl
              base={change.base_ref}
              teamNeedsChanges={reviewState(reviews.data ?? [], change.head_sha).overall === 'needs_changes'}
              merging={actions.merge.isPending}
              error={actions.merge.error ? (actions.merge.error as Error).message : null}
              onMerge={(method) => actions.merge.mutate({ changeId: change.id, method }, {
                onSuccess: ({ change: c }) => setPatch((p) => ({ ...p, ...c })),
              })}
            />
          )}
          <a href={change.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-foreground">
            GitHub<ExternalLink size={12} />
          </a>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sections or files */}
          {showFiles && <aside className="w-60 shrink-0 overflow-auto border-r border-[var(--border-default)] py-2">
            {mode === 'guided' && guide ? (
              <ol className="px-2">
                {guide.sections.map((s, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setStep(i)}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--surface-strong)] ${i === step ? 'bg-[var(--surface-strong)] text-foreground' : 'text-[var(--text-secondary)]'}`}>
                      <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2">{s.rest ? t('Other files') : s.title}</span>
                        <span className="text-[11px] text-muted-foreground">{t('{n} files', { n: s.files.length })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <>
                <FileList paths={ordered.map((f) => f.filename)} focused={focused} cited={cited} isReviewed={isReviewed} onOpen={openFile} />
              </>
            )}
          </aside>}

          {/* Diff */}
          <main ref={mainRef} className="min-w-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-20 flex h-10 items-center gap-2 border-b border-[var(--border-default)] bg-background px-3">
              <Button variant="ghost" size="icon-xs" onClick={() => togglePanel('files', showFiles)} aria-pressed={showFiles}
                aria-label={showFiles ? t('Hide files') : t('Show files')} title={showFiles ? t('Hide files') : t('Show files')}>
                <PanelLeft size={13} />
              </Button>
              <Segmented
                label={t('Review mode')}
                value={mode}
                options={[{ value: 'guided', label: t('Guided') }, { value: 'files', label: t('All files') }]}
                onChange={(m) => setChosenMode(m)}
              />
              <Segmented
                label={t('Diff layout')}
                value={shownLayout}
                options={[
                  { value: 'unified', label: t('Unified'), title: `${t('Unified')} (⌘B)` },
                  { value: 'split', label: t('Split'), title: splitFits ? `${t('Split')} (⌘B)` : t('Too narrow for split — widen the window or fold a column'), disabled: !splitFits },
                ]}
                onChange={setAndKeepLayout}
              />
              {files.length > 0 && <span className="hidden sm:inline"><LineCounts additions={size.additions} deletions={size.deletions} title={sizeTitle} /></span>}
              <div className="flex-1" />
              {agentWorking && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-hover)]"><Bot size={12} />{t('Agent is working — the diff follows its pushes')}</span>
              )}
              <Button variant="ghost" size="icon-xs" onClick={() => void diff.refetch()} disabled={diff.isFetching} aria-label={t('Refresh from GitHub')} title={t('Refresh from GitHub')}>
                <RefreshCw size={12} className={diff.isFetching ? 'animate-spin' : ''} />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={() => togglePanel('intent', showIntent)} aria-pressed={showIntent}
                aria-label={showIntent ? t('Hide intent') : t('Show intent')} title={showIntent ? t('Hide intent') : t('Show intent')}>
                <PanelRight size={13} />
              </Button>
            </div>
            <div className="space-y-3 p-4">
              {diff.isPending && <p className="text-[12px] text-muted-foreground">{t('Reading the diff from GitHub…')}</p>}
              {diff.error && <p className="text-[12px] text-[var(--status-danger)]">{(diff.error as Error).message}</p>}
              {!diff.isPending && !diff.error && files.length === 0 && <p className="text-[12px] text-muted-foreground">{t('No files changed.')}</p>}

              {mode === 'guided' && files.length > 0 && (
                guide && section ? (
                  <div className="rounded-md bg-[var(--surface-raised)] p-4">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <ListOrdered size={12} />
                      <span className="font-mono">{String(step + 1).padStart(2, '0')} / {String(guide.sections.length).padStart(2, '0')}</span>
                      {guide.at && <span>· {t('Guide written {age}', { age: formatAge(guide.at, true) })}</span>}
                      {guideStale && <span className="inline-flex items-center gap-1 text-[var(--status-warning)]"><AlertTriangle size={11} />{t('New commits since this guide')}</span>}
                      <div className="flex-1" />
                      <Button variant="ghost" size="xs" onClick={writeGuide} disabled={actions.guide.isPending}>
                        <Sparkles size={12} />{actions.guide.isPending ? t('Writing…') : t('Rewrite')}
                      </Button>
                    </div>
                    {step === 0 && guide.summary && <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{guide.summary}</p>}
                    <h2 className="mt-2 text-[15px] font-medium text-foreground">{section.rest ? t('Other files') : section.title}</h2>
                    {section.what && <p className="mt-1 text-[13px] text-foreground">{section.what}</p>}
                    {section.why && <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{section.why}</p>}
                    {section.rest && <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{t('Files the guide did not place in a section.')}</p>}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-md bg-[var(--surface-raised)] p-4">
                    <ListOrdered size={16} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground">{t('Review it one meaningful section at a time')}</div>
                      <p className="text-[12px] text-[var(--text-secondary)]">{t('AI splits the change into a few sections, in reading order, and says what each one changes and why.')}</p>
                      {actions.guide.error && <p className="mt-1 text-[12px] text-[var(--status-danger)]">{(actions.guide.error as Error).message}</p>}
                    </div>
                    <Button variant="primary" size="sm" onClick={writeGuide} disabled={actions.guide.isPending}>
                      <Sparkles size={12} />{actions.guide.isPending ? t('Writing…') : t('Write a guide')}
                    </Button>
                  </div>
                )
              )}

              {(mode === 'files' || section) && visible.map((f) => (
                <DiffFileView
                  key={f.filename}
                  ref={(el) => { if (el) fileRefs.current.set(f.filename, el); else fileRefs.current.delete(f.filename); }}
                  file={f}
                  layout={shownLayout}
                  comments={commentsByFile.get(f.filename) ?? []}
                  githubComments={githubByFile.get(f.filename)}
                  currentUserId={user?.id ?? null}
                  highlighted={focused === f.filename}
                  reviewed={isReviewed(f.filename)}
                  onToggleReviewed={() => toggleReviewed(f.filename)}
                  onAddComment={addComment}
                  onResolve={(id, resolved) => commentActions.resolve.mutate({ id, resolved })}
                  onDelete={(id) => commentActions.remove.mutate(id)}
                  onRetry={(id) => retry.mutate({ commentId: id })}
                />
              ))}

              {mode === 'guided' && guide && section && (
                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => { setStep(step - 1); setFocused(null); }}>
                    <ChevronLeft size={14} />{t('Previous')}
                  </Button>
                  {step < guide.sections.length - 1 ? (
                    <Button variant="primary" size="sm" onClick={() => { setStep(step + 1); setFocused(null); }}>
                      {t('Next section')}<ChevronRight size={14} />
                    </Button>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">{t('That is the whole change — give your verdict on the right.')}</span>
                  )}
                </div>
              )}
            </div>
          </main>

          {/* Intent */}
          {showIntent && <aside className="w-80 shrink-0 overflow-auto border-l border-[var(--border-default)]">
            <IntentPanel
              change={change}
              onCheck={() => actions.check.mutate(change.id, {
                onSuccess: ({ intent_check }) => setPatch((p) => ({ ...p, intent_check })),
              })}
              checking={actions.check.isPending}
              checkError={actions.check.error ? (actions.check.error as Error).message : null}
              onOpenFile={openFile}
            />
          </aside>}
        </div>
    </div>
  );
}

function Segmented<V extends string>({ label, value, options, onChange }: {
  label: string; value: V; options: { value: V; label: string; title?: string; disabled?: boolean }[]; onChange: (v: V) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-[var(--surface-strong)] p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} title={o.title} disabled={o.disabled}
          className={`h-6 whitespace-nowrap rounded px-2 text-[12px] disabled:opacity-40 ${value === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Sends the open review points back to the Element's agent, which pushes the
 *  fix to the same branch. */
function IterateButton({ prompt, working, starting, error, onStart }: {
  prompt: string | null; working: boolean; starting: boolean; error: string | null; onStart: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState<string | null>(null);
  const title = working ? t('The agent is already working on this Element.')
    : prompt ? t('Ask the agent to address the open comments and verdicts on the same branch.')
      : t('Nothing to address: no open comments or change requests.');
  return (
    <div className="flex shrink-0 items-center gap-2">
      {(note || error) && <span className={`max-w-56 truncate text-[11px] ${error ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`} title={error ?? note ?? ''}>{error ?? note}</span>}
      <Button variant="ghost" size="xs" disabled={!prompt || working || starting} title={title}
        onClick={async () => {
          const outcome = await onStart();
          setNote(outcome === 'busy' ? t('The agent is already working on this Element.') : outcome === 'started' ? t('Sent to the agent.') : null);
        }}>
        <Bot size={12} />{t('Ask agent to address')}
      </Button>
    </div>
  );
}

function MergeControl({ base, teamNeedsChanges, merging, error, onMerge }: {
  base: string | null; teamNeedsChanges: boolean; merging: boolean; error: string | null; onMerge: (method: MergeMethod) => void;
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState<MergeMethod>(() => readMergeMethod());
  const [confirming, setConfirming] = useState(false);
  const choose = (m: MergeMethod) => {
    setMethod(m);
    try { localStorage.setItem(MERGE_KEY, m); } catch { /* per-viewer convenience only */ }
  };
  const label: Record<MergeMethod, string> = { merge: t('Merge commit'), squash: t('Squash and merge'), rebase: t('Rebase and merge') };

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        {teamNeedsChanges && <span className="text-[11px] text-[var(--status-warning)]">{t('The team asked for changes.')}</span>}
        <span className="text-[12px] text-foreground">{t('Merge into {base} on GitHub?', { base: base ?? 'base' })}</span>
        <Button variant="primary" size="xs" disabled={merging} onClick={() => { onMerge(method); setConfirming(false); }}>{label[method]}</Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>{t('Cancel')}</Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error && <span className="max-w-56 truncate text-[11px] text-[var(--status-danger)]" title={error}>{error}</span>}
      <select value={method} onChange={(e) => choose(e.target.value as MergeMethod)} aria-label={t('Merge method')}
        className="h-6 rounded-md bg-[var(--surface-strong)] px-1.5 text-[12px] text-foreground outline-none">
        {(['merge', 'squash', 'rebase'] as const).map((m) => <option key={m} value={m}>{label[m]}</option>)}
      </select>
      <Button variant="primary" size="xs" disabled={merging} onClick={() => setConfirming(true)}>
        <GitMerge size={12} />{merging ? t('Merging…') : t('Merge')}
      </Button>
    </div>
  );
}

/** The changed files, flat: name, then its folder, filtered as you type. A
 *  dot marks a file the intent check cited; reviewed files are dimmed. */
function FileList({ paths, focused, cited, isReviewed, onOpen }: {
  paths: string[]; focused: string | null; cited: Set<string>; isReviewed: (path: string) => boolean; onOpen: (path: string) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths;
  const reviewedCount = paths.filter(isReviewed).length;
  return (
    <div className="px-2">
      <div className="mb-1 flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-strong)] px-2">
        <Search size={12} className="shrink-0 text-muted-foreground" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter files…')} aria-label={t('Filter files…')}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
      </div>
      <div className="px-1 pb-1 text-[11px] text-muted-foreground">
        {t('{n} files', { n: paths.length })}{reviewedCount > 0 && ` · ${t('{n} reviewed', { n: reviewedCount })}`}
      </div>
      <ul>
        {shown.map((path) => {
          const { name, dir } = splitPath(path);
          return (
            <li key={path}>
              <button type="button" onClick={() => onOpen(path)} title={path}
                className={`flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] hover:bg-[var(--surface-strong)] ${focused === path ? 'bg-[var(--surface-strong)]' : ''} ${isReviewed(path) ? 'opacity-50' : ''}`}>
                <FileCode2 size={12} className="shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-foreground">{name}</span>
                <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
                {cited.has(path) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--accent-default)]" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
