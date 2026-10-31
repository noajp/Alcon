'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Folder, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { formatDisplayName, getCachedDisplayNames } from '@/Function/settings/preferencesStore';
import { buildFileTree, changeSize, treeOrder, readIntentCheck, type FileTreeNode } from '@/Function/codeReview/diffModel';
import { useCodeChangeActions, useCodeChangeComments, useCodeCommentActions, useCodeDiff } from '@/hooks/codeChangeData';
import type { CodeChange, CodeChangeComment } from '@/types/database';
import { CodeChangeIcon, LineCounts, StatePill } from './codeChangeLabels';
import { DiffFileView, type DiffLayout, type LineAnchor } from './DiffFileView';
import { IntentPanel } from './IntentPanel';

// The review screen for one code change: files on the left, the diff in the
// middle, and on the right what the change was meant to do — the Element and
// its Initiatives' intent — with the AI's check and the team's verdicts.
// ⌘B / Ctrl+B switches unified and split.

const LAYOUT_KEY = 'alcon.codeReview.layout';

function readLayout(): DiffLayout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'unified'; } catch { return 'unified'; }
}

export function CodeReviewDialog({ change, open, onOpenChange }: { change: CodeChange; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const diff = useCodeDiff(open ? change : null);
  const comments = useCodeChangeComments(open ? change.id : null);
  const commentActions = useCodeCommentActions(change.id);
  const { check } = useCodeChangeActions(change.element_id);
  const [layout, setLayout] = useState<DiffLayout>(() => readLayout());
  const fileRefs = useRef(new Map<string, HTMLDivElement>());
  const [focused, setFocused] = useState<string | null>(null);

  const setAndKeepLayout = useCallback((next: DiffLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* per-viewer convenience only */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setAndKeepLayout(layout === 'unified' ? 'split' : 'unified');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, layout, setAndKeepLayout]);

  const files = useMemo(() => diff.data ?? [], [diff.data]);
  const tree = useMemo(() => buildFileTree(files.map((f) => f.filename)), [files]);
  const ordered = useMemo(() => {
    const byName = new Map(files.map((f) => [f.filename, f]));
    return treeOrder(tree).map((n) => byName.get(n)!).filter(Boolean);
  }, [files, tree]);
  const size = useMemo(() => changeSize(files), [files]);
  const cited = useMemo(() => {
    const c = readIntentCheck(change.intent_check);
    return new Set([...(c?.criteria.flatMap((x) => x.files) ?? []), ...(c?.outOfScope.map((o) => o.path) ?? [])]);
  }, [change.intent_check]);

  const commentsByFile = useMemo(() => {
    const map = new Map<string, CodeChangeComment[]>();
    for (const c of comments.data ?? []) map.set(c.path, [...(map.get(c.path) ?? []), c]);
    return map;
  }, [comments.data]);

  const openFile = (path: string) => {
    // The model may cite a path by its tail; match the file that ends with it.
    const target = files.find((f) => f.filename === path) ?? files.find((f) => f.filename.endsWith(`/${path}`) || path.endsWith(`/${f.filename}`));
    if (!target) return;
    setFocused(target.filename);
    fileRefs.current.get(target.filename)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const addComment = async (anchor: LineAnchor, body: string) => {
    await commentActions.add.mutateAsync({
      ...anchor, body, head_sha: change.head_sha,
      author_name: formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames()),
    });
  };

  const sizeTitle = size.additions !== size.totalAdditions || size.deletions !== size.totalDeletions
    ? t('Implementation only. All files: +{a} −{d}', { a: size.totalAdditions, d: size.totalDeletions })
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        {/* Header */}
        <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4 pr-12">
          <CodeChangeIcon size={16} className="shrink-0 text-muted-foreground" />
          <DialogTitle className="min-w-0 truncate text-[14px] font-medium">{change.title || `${change.repo}#${change.number}`}</DialogTitle>
          <StatePill state={change.state} />
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{change.repo}#{change.number}</span>
          {change.head_ref && (
            <span className="hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground md:inline">
              {change.head_ref} → {change.base_ref}
            </span>
          )}
          <div className="flex-1" />
          <a href={change.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-foreground">
            GitHub<ExternalLink size={12} />
          </a>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Files */}
          <aside className="hidden w-60 shrink-0 overflow-auto border-r border-[var(--border-default)] py-2 lg:block">
            <div className="px-3 pb-1 text-[11px] text-muted-foreground">{t('{n} files', { n: files.length })}</div>
            <FileTree nodes={tree} depth={0} focused={focused} cited={cited} onOpen={openFile} />
          </aside>

          {/* Diff */}
          <main className="min-w-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-20 flex h-10 items-center gap-2 border-b border-[var(--border-default)] bg-background px-4">
              <div className="inline-flex rounded-md bg-[var(--surface-strong)] p-0.5" role="group" aria-label={t('Diff layout')}>
                {(['unified', 'split'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={layout === l} onClick={() => setAndKeepLayout(l)}
                    title={`${l === 'unified' ? t('Unified') : t('Split')} (⌘B)`}
                    className={`h-6 rounded px-2 text-[12px] ${layout === l ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {l === 'unified' ? t('Unified') : t('Split')}
                  </button>
                ))}
              </div>
              {files.length > 0 && <LineCounts additions={size.additions} deletions={size.deletions} title={sizeTitle} />}
              {sizeTitle && <span className="text-[11px] text-muted-foreground" title={sizeTitle}>*</span>}
              <div className="flex-1" />
              <Button variant="ghost" size="icon-xs" onClick={() => void diff.refetch()} disabled={diff.isFetching} aria-label={t('Refresh from GitHub')} title={t('Refresh from GitHub')}>
                <RefreshCw size={12} className={diff.isFetching ? 'animate-spin' : ''} />
              </Button>
            </div>
            <div className="space-y-3 p-4">
              {diff.isPending && <p className="text-[12px] text-muted-foreground">{t('Reading the diff from GitHub…')}</p>}
              {diff.error && <p className="text-[12px] text-[var(--status-danger)]">{(diff.error as Error).message}</p>}
              {!diff.isPending && !diff.error && files.length === 0 && <p className="text-[12px] text-muted-foreground">{t('No files changed.')}</p>}
              {ordered.map((f) => (
                <DiffFileView
                  key={f.filename}
                  ref={(el) => { if (el) fileRefs.current.set(f.filename, el); else fileRefs.current.delete(f.filename); }}
                  file={f}
                  layout={layout}
                  comments={commentsByFile.get(f.filename) ?? []}
                  currentUserId={user?.id ?? null}
                  highlighted={focused === f.filename}
                  onAddComment={addComment}
                  onResolve={(id, resolved) => commentActions.resolve.mutate({ id, resolved })}
                  onDelete={(id) => commentActions.remove.mutate(id)}
                />
              ))}
            </div>
          </main>

          {/* Intent */}
          <aside className="w-[22rem] shrink-0 overflow-auto border-l border-[var(--border-default)]">
            <IntentPanel
              change={change}
              onCheck={() => check.mutate(change.id)}
              checking={check.isPending}
              checkError={check.error ? (check.error as Error).message : null}
              onOpenFile={openFile}
            />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileTree({ nodes, depth, focused, cited, onOpen }: {
  nodes: FileTreeNode[]; depth: number; focused: string | null; cited: Set<string>; onOpen: (path: string) => void;
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={`${n.file ? 'f' : 'd'}:${n.path}`}>
          {n.file ? (
            <button type="button" onClick={() => onOpen(n.file!)}
              className={`flex h-7 w-full items-center gap-1.5 pr-2 text-left text-[12px] hover:bg-[var(--surface-strong)] ${focused === n.file ? 'bg-[var(--surface-strong)] text-foreground' : 'text-[var(--text-secondary)]'}`}
              style={{ paddingLeft: 12 + depth * 12 }} title={n.file}>
              <FileText size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
              {cited.has(n.file) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--accent-default)]" />}
            </button>
          ) : (
            <>
              <div className="flex h-7 items-center gap-1.5 pr-2 text-[12px] text-muted-foreground" style={{ paddingLeft: 12 + depth * 12 }}>
                <Folder size={12} className="shrink-0" />
                <span className="truncate">{n.name}</span>
              </div>
              <FileTree nodes={n.children} depth={depth + 1} focused={focused} cited={cited} onOpen={onOpen} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
