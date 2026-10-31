'use client';

import { forwardRef, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronsUpDown, FileCode2, Github, MessageSquarePlus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isSubmitChord, isCancelKey } from '@/Function/shared/keyboard';
import { formatAge } from '@/Function/shared/dateUtils';
import { fileKind, parsePatch, splitPath, splitRows, unchangedBefore, type DiffLine } from '@/Function/codeReview/diffModel';
import { highlightHunks, languageOf, type TokenLine } from '@/Function/codeReview/syntax';
import type { CodeDiffFile, GithubLineComment } from '@/hooks/codeChangeData';
import { useHighlighter } from './useHighlighter';
import type { CodeChangeComment } from '@/types/database';
import { LineCounts, Pill } from './codeChangeLabels';

// One changed file in the review screen: its header, its hunks in unified or
// split layout, and the line comments under the lines they were left on —
// those written in Alcon (with whether they reached GitHub) and those written
// on GitHub, which read here but are answered there.

export type DiffLayout = 'unified' | 'split';

export interface LineAnchor { path: string; line: number; side: 'old' | 'new' }

interface Props {
  file: CodeDiffFile;
  layout: DiffLayout;
  comments: CodeChangeComment[];
  /** Line comments written on GitHub. */
  githubComments?: GithubLineComment[];
  currentUserId: string | null;
  /** Highlighted because the intent check cited it. */
  highlighted: boolean;
  /** Marked reviewed by this viewer on the current head: shown folded. */
  reviewed: boolean;
  onToggleReviewed: () => void;
  onAddComment: (anchor: LineAnchor, body: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  /** Posts one of the person's comments to GitHub again after a refusal. */
  onRetry?: (id: string) => void;
}

const GITHUB_PREFIX = 'gh:';

/** A GitHub comment in the shape the threads draw. */
const fromGithub = (c: GithubLineComment & { line: number }): CodeChangeComment => ({
  id: `${GITHUB_PREFIX}${c.id}`, code_change_id: '', author_id: '', author_name: c.user, path: c.path, line: c.line,
  side: c.side === 'LEFT' ? 'old' : 'new', body: c.body, head_sha: null, resolved: false, created_at: c.created_at,
  github_comment_id: c.id, github_error: null,
});

const EMPTY_GITHUB: GithubLineComment[] = [];

/** Patches larger than this are shown without syntax colours. */
const HIGHLIGHT_MAX = 200_000;

const SYNTAX_TONE: Record<string, string> = {
  'hljs-keyword': 'text-[var(--syntax-keyword)]',
  'hljs-built_in': 'text-[var(--syntax-type)]',
  'hljs-type': 'text-[var(--syntax-type)]',
  'hljs-class': 'text-[var(--syntax-type)]',
  'hljs-literal': 'text-[var(--syntax-number)]',
  'hljs-number': 'text-[var(--syntax-number)]',
  'hljs-string': 'text-[var(--syntax-string)]',
  'hljs-regexp': 'text-[var(--syntax-string)]',
  'hljs-template-variable': 'text-[var(--syntax-property)]',
  'hljs-subst': 'text-foreground',
  'hljs-title': 'text-[var(--syntax-function)]',
  'hljs-function': 'text-[var(--syntax-function)]',
  'hljs-params': 'text-foreground',
  'hljs-attr': 'text-[var(--syntax-property)]',
  'hljs-attribute': 'text-[var(--syntax-property)]',
  'hljs-property': 'text-[var(--syntax-property)]',
  'hljs-variable': 'text-[var(--syntax-property)]',
  'hljs-tag': 'text-[var(--syntax-tag)]',
  'hljs-name': 'text-[var(--syntax-tag)]',
  'hljs-selector-tag': 'text-[var(--syntax-tag)]',
  'hljs-selector-class': 'text-[var(--syntax-type)]',
  'hljs-meta': 'text-[var(--syntax-comment)]',
  'hljs-comment': 'text-[var(--syntax-comment)] italic',
  'hljs-doctag': 'text-[var(--syntax-keyword)]',
  'hljs-section': 'text-[var(--syntax-function)]',
  'hljs-bullet': 'text-[var(--syntax-number)]',
  'hljs-symbol': 'text-[var(--syntax-number)]',
  'hljs-addition': 'text-[var(--status-success)]',
  'hljs-deletion': 'text-[var(--status-danger)]',
};

const LINE_TONE: Record<DiffLine['kind'], string> = {
  add: 'bg-[var(--status-success-subtle)]',
  del: 'bg-[var(--status-danger-subtle)]',
  context: '',
  note: 'text-muted-foreground italic',
};

const anchorOf = (path: string, line: DiffLine): LineAnchor | null =>
  line.kind === 'note' ? null
    : line.kind === 'del' ? { path, line: line.oldNo!, side: 'old' }
      : { path, line: line.newNo!, side: 'new' };

const keyOf = (a: LineAnchor) => `${a.side}:${a.line}`;

const KIND_LABEL: Record<string, string> = { test: 'Test', docs: 'Docs', generated: 'Generated' };

export const DiffFileView = forwardRef<HTMLDivElement, Props>(function DiffFileView(
  { file, layout, comments: own, githubComments = EMPTY_GITHUB, currentUserId, highlighted, reviewed, onToggleReviewed, onAddComment, onResolve, onDelete, onRetry }, ref,
) {
  const { t } = useI18n();
  const kind = fileKind(file.filename);
  // Tests, docs and generated files start folded: the implementation is what
  // is read against the intent first.
  const [open, setOpen] = useState(kind === 'implementation');
  const [composing, setComposing] = useState<LineAnchor | null>(null);
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const gaps = useMemo(() => unchangedBefore(hunks), [hunks]);
  // Syntax colours, worked out only for a file that is open.
  const highlighter = useHighlighter();
  const language = languageOf(file.filename);
  const colourable = open && !reviewed && !!highlighter && !!language && (file.patch?.length ?? 0) <= HIGHLIGHT_MAX;
  const tokensOf = useMemo(() => {
    const map = new Map<DiffLine, TokenLine>();
    if (!colourable) return map;
    highlightHunks(hunks, language!, highlighter!).forEach((lines, hi) => lines.forEach((tokens, li) => map.set(hunks[hi].lines[li], tokens)));
    return map;
  }, [colourable, hunks, language, highlighter]);
  const code = (l: DiffLine): ReactNode => {
    const tokens = tokensOf.get(l);
    if (!tokens) return l.text || ' ';
    if (tokens.length === 0) return ' ';
    return tokens.map((tok, i) => (tok.cls && SYNTAX_TONE[tok.cls]
      ? <span key={i} className={SYNTAX_TONE[tok.cls]}>{tok.text}</span>
      : tok.text));
  };
  const comments = useMemo(() => [
    ...own,
    ...githubComments.filter((c): c is GithubLineComment & { line: number } => c.line != null).map(fromGithub),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at)), [own, githubComments]);

  const byLine = useMemo(() => {
    const map = new Map<string, CodeChangeComment[]>();
    for (const c of comments) {
      const k = `${c.side}:${c.line}`;
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return map;
  }, [comments]);

  // Comments left on lines this diff no longer shows (the branch moved on).
  const shown = useMemo(() => {
    const keys = new Set<string>();
    for (const h of hunks) for (const l of h.lines) { const a = anchorOf(file.filename, l); if (a) keys.add(keyOf(a)); }
    return keys;
  }, [hunks, file.filename]);
  const outdated = comments.filter((c) => !shown.has(`${c.side}:${c.line}`));

  const threadFor = (anchor: LineAnchor | null): ReactNode => {
    if (!anchor) return null;
    const k = keyOf(anchor);
    const list = byLine.get(k) ?? [];
    const isComposing = composing && keyOf(composing) === k;
    if (!list.length && !isComposing) return null;
    return (
      <div className="border-y border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 font-sans">
        {list.map((c) => (
          <LineComment key={c.id} comment={c} mine={c.author_id === currentUserId} onResolve={onResolve} onDelete={onDelete} onRetry={onRetry} />
        ))}
        {isComposing && (
          <CommentComposer
            onCancel={() => setComposing(null)}
            onSubmit={async (body) => { await onAddComment(anchor, body); setComposing(null); }}
          />
        )}
      </div>
    );
  };

  /** The line-number cell, with the comment button that appears on hover. */
  const gutter = (label: ReactNode, anchor: LineAnchor | null, tone = 'text-muted-foreground/60') => (
    <span className={`relative w-12 shrink-0 select-none pr-3 text-right tabular-nums ${tone}`}>
      {label}
      {anchor && (
        <button
          type="button"
          onClick={() => setComposing(anchor)}
          aria-label={t('Comment on this line')}
          className="absolute left-1 top-0.5 hidden size-4 items-center justify-center rounded bg-[var(--accent-default)] text-white group-hover/line:flex"
        >
          <MessageSquarePlus size={10} />
        </button>
      )}
    </span>
  );
  /** Deleted lines show a dash where a new line would show its number. */
  const numberOf = (l: DiffLine) => (l.kind === 'del' ? '−' : l.newNo ?? '');
  const numberTone = (l: DiffLine) => (l.kind === 'del' ? 'text-[var(--status-danger)]' : l.kind === 'add' ? 'text-[var(--status-success)]' : 'text-muted-foreground/60');

  const gapRow = (n: number, key: string) => n > 0 && (
    <div key={key} className="flex h-7 items-center gap-2 bg-[var(--surface-raised)] px-3 font-sans text-[11px] text-muted-foreground">
      <ChevronsUpDown size={12} className="shrink-0" />
      {t('{n} unchanged lines', { n })}
    </div>
  );

  const { name, dir } = splitPath(file.filename);
  const renamedFrom = file.previous_filename && file.previous_filename !== file.filename ? file.previous_filename : null;
  const expanded = open && !reviewed;

  return (
    <div ref={ref} className={`overflow-hidden rounded-lg border bg-card ${highlighted ? 'border-[var(--accent-default)]' : 'border-[var(--border-default)]'}`}>
      <div className={`sticky top-0 z-10 flex h-10 items-center gap-2 bg-card px-3 ${expanded ? 'border-b border-[var(--border-default)]' : ''}`}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={file.filename}>
          <FileCode2 size={14} className="shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-[13px] font-medium text-foreground">{name}</span>
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">{renamedFrom ? `${renamedFrom} → ${dir}` : dir}</span>
        </button>
        {file.status === 'added' && <Pill tone="success">{t('New')}</Pill>}
        {file.status === 'removed' && <Pill tone="danger">{t('Deleted')}</Pill>}
        {file.status === 'renamed' && <Pill tone="neutral">{t('Renamed')}</Pill>}
        {kind !== 'implementation' && <Pill tone="neutral">{t(KIND_LABEL[kind])}</Pill>}
        {comments.length > 0 && <span className="text-[11px] text-muted-foreground">{t('{n} comments', { n: comments.length })}</span>}
        <LineCounts additions={file.additions} deletions={file.deletions} />
        <label className="ml-1 inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          <input type="checkbox" checked={reviewed} onChange={() => onToggleReviewed()} className="size-3.5 accent-[var(--accent-default)]" />
          {t('Reviewed')}
        </label>
      </div>

      {expanded && (
        <div className="overflow-x-auto font-mono text-[12px] leading-[22px]">
          {file.patch == null && (
            <div className="px-3 py-3 font-sans text-[12px] text-muted-foreground">
              {t('No diff to show — a binary file, or too large for GitHub to return.')}
            </div>
          )}
          {hunks.map((h, hi) => (
            <div key={hi}>
              {gapRow(gaps[hi], `gap-${hi}`)}
              {layout === 'unified'
                ? h.lines.map((l, li) => {
                  const anchor = anchorOf(file.filename, l);
                  return (
                    <div key={li}>
                      <div className={`group/line flex min-w-max ${LINE_TONE[l.kind]}`}>
                        {gutter(numberOf(l), anchor, numberTone(l))}
                        <span className="whitespace-pre pr-6">{code(l)}</span>
                      </div>
                      {threadFor(anchor)}
                    </div>
                  );
                })
                : splitRows(h.lines).map((row, ri) => {
                  const leftAnchor = row.left ? anchorOf(file.filename, row.left) : null;
                  const rightAnchor = row.right ? anchorOf(file.filename, row.right) : null;
                  return (
                    <div key={ri}>
                      <div className="grid grid-cols-2">
                        <div className={`group/line flex min-w-0 overflow-hidden border-r border-[var(--border-default)] ${row.left ? LINE_TONE[row.left.kind] : ''}`}>
                          {row.left && <>
                            {gutter(row.left.oldNo, row.left.kind === 'context' ? null : leftAnchor, row.left.kind === 'del' ? 'text-[var(--status-danger)]' : undefined)}
                            <span className="whitespace-pre pr-2">{code(row.left)}</span>
                          </>}
                        </div>
                        <div className={`group/line flex min-w-0 overflow-hidden ${row.right ? LINE_TONE[row.right.kind] : ''}`}>
                          {row.right && <>
                            {gutter(row.right.newNo, rightAnchor, row.right.kind === 'add' ? 'text-[var(--status-success)]' : undefined)}
                            <span className="whitespace-pre pr-2">{code(row.right)}</span>
                          </>}
                        </div>
                      </div>
                      {threadFor(leftAnchor && row.left?.kind === 'del' ? leftAnchor : null)}
                      {threadFor(rightAnchor)}
                    </div>
                  );
                })}
            </div>
          ))}
          {outdated.length > 0 && (
            <div className="border-t border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 font-sans">
              <div className="mb-1 text-[11px] text-muted-foreground">{t('On lines no longer in this diff')}</div>
              {outdated.map((c) => (
                <LineComment key={c.id} comment={c} mine={c.author_id === currentUserId} onResolve={onResolve} onDelete={onDelete} onRetry={onRetry} showLine />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function LineComment({ comment, mine, onResolve, onDelete, onRetry, showLine }: {
  comment: CodeChangeComment; mine: boolean; showLine?: boolean;
  onResolve: (id: string, resolved: boolean) => void; onDelete: (id: string) => void; onRetry?: (id: string) => void;
}) {
  const { t } = useI18n();
  const external = comment.id.startsWith(GITHUB_PREFIX);
  return (
    <div className={`group/comment flex items-start gap-2 py-1 text-[12px] ${comment.resolved ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{comment.author_name ?? t('Unknown')}</span>
          <span className="text-[11px] text-muted-foreground">{formatAge(comment.created_at, true)}</span>
          {showLine && <span className="font-mono text-[11px] text-muted-foreground">L{comment.line}</span>}
          {comment.resolved && <span className="text-[11px] text-muted-foreground">{t('Resolved')}</span>}
          {external && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Github size={11} />{t('On GitHub')}</span>}
          {!external && comment.github_comment_id != null && (
            <span className="text-muted-foreground" title={t('Posted to GitHub')}><Github size={11} /></span>
          )}
          {!external && comment.github_error && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--status-warning)]" title={comment.github_error}>
              <AlertTriangle size={11} />{t('Not on GitHub')}
              {mine && onRetry && (
                <button type="button" onClick={() => onRetry(comment.id)} className="inline-flex items-center gap-0.5 text-[var(--accent-hover)] hover:underline">
                  <RefreshCw size={10} />{t('Retry')}
                </button>
              )}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-foreground">{comment.body}</p>
      </div>
      <ButtonAppearanceProvider appearance="inline">
        <div className={`flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 ${external ? 'hidden' : ''}`}>
          <Button variant="ghost" size="icon-xs" onClick={() => onResolve(comment.id, !comment.resolved)}
            aria-label={comment.resolved ? t('Reopen') : t('Resolve')} title={comment.resolved ? t('Reopen') : t('Resolve')}>
            {comment.resolved ? <RotateCcw size={12} /> : <Check size={12} />}
          </Button>
          {mine && (
            <Button variant="ghost" size="icon-xs" onClick={() => onDelete(comment.id)} aria-label={t('Delete')} title={t('Delete')}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </ButtonAppearanceProvider>
    </div>
  );
}

function CommentComposer({ onSubmit, onCancel }: { onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { await onSubmit(draft.trim()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="py-1">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitChord(e)) { e.preventDefault(); void submit(); }
          else if (isCancelKey(e)) { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
        rows={2}
        placeholder={t('Comment on this line…')}
        className="w-full resize-none rounded-md bg-[var(--surface-strong)] px-2 py-1.5 text-[12px] outline-none"
      />
      {error && <p className="text-[11px] text-[var(--status-danger)]">{error}</p>}
      <div className="mt-1 flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="primary" size="xs" onClick={() => void submit()} disabled={!draft.trim() || busy}>{t('Comment')}</Button>
      </div>
    </div>
  );
}
