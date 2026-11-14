'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2 } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { formatError } from '@/Function/shared/formatError';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { createIntent, deleteIntent, strategyIntentBundleKey, updateIntent, type IntentBundle } from '@/hooks/useSupabase';
import type { Intent } from '@/types/database';
import type { EmbedBlock, EmbedSpec } from '@/Function/notebook/editor/embedBlocks';
import { useInitiativeIntentContext } from './InitiativeIntent';
import {
  FRAME_KINDS, boundFrameSpec, draftFrameSpec, elementsOn, frameRef, isFrameKind, labelColumnEm, measureStanding,
  placedFrameIds, unplacedFrameRows, type FrameKind,
} from './frameLineModel';

// =============================================================
// A line of a Strategy's frame, as it stands in the description: what kind it
// is, its sentence, where it stands and how much work rests on it. The
// sentence is edited in place and saves as a name does — when the focus
// leaves it. Nothing here asks an AI anything.
// =============================================================

const KIND_LABEL: Record<FrameKind, string> = {
  assumption: 'Hypothesis',
  measure: 'Success condition',
  decision: 'Decided',
};
const KIND_PLACEHOLDER: Record<FrameKind, string> = {
  assumption: 'Write what you want to find out…',
  measure: 'Write what must be reached…',
  decision: 'Write what was chosen…',
};

/** The cached bundle changed to what a write just made true, so the line does
 *  not show the old rows until the re-read lands. */
function patchBundle(qc: QueryClient, strategyId: string, change: (bundle: IntentBundle) => IntentBundle) {
  qc.setQueryData<IntentBundle | null>(strategyIntentBundleKey(strategyId), (old) => (old ? change(old) : old));
}

/** A sentence that grows with what is written in it, one line to start. */
function LineText({ value, onChange, onCommit, placeholder, readOnly, autoFocus, muted }: {
  value: string;
  onChange: (next: string) => void;
  /** The focus left, or Enter: keep what is written. */
  onCommit: () => void;
  placeholder: string;
  readOnly: boolean;
  autoFocus?: boolean;
  muted?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} readOnly={readOnly} aria-readonly={readOnly}
      autoFocus={autoFocus} tabIndex={readOnly ? -1 : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        // One sentence: Enter keeps it, as the focus leaving does. It saves
        // by itself, so Escape keeps it too, and is used up here — the
        // page's own Escape waits for the next press.
        if (isCommitEnter(e) || isSubmitChord(e) || isCancelKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
      className={`block w-full resize-none overflow-hidden border-none bg-transparent p-0 text-[14px] leading-[1.65] outline-none placeholder:text-muted-foreground/60 ${muted ? 'text-muted-foreground line-through' : 'text-foreground'}`} />
  );
}

function LineShell({ kind, children, tail }: { kind: FrameKind; children: React.ReactNode; tail?: React.ReactNode }) {
  const { t } = useI18n();
  const column = useMemo(() => labelColumnEm(FRAME_KINDS.map((k) => t(KIND_LABEL[k]))), [t]);
  return (
    <div className="group/line flex items-start gap-2.5 py-0.5">
      <span className="shrink-0 pt-[3px] text-[12px] leading-[1.65] text-muted-foreground" style={{ width: `${column}em` }}>{t(KIND_LABEL[kind])}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {tail}
    </div>
  );
}

/** A line placed and not yet written: the row is made with its first sentence. */
function DraftLine({ kind, written, block }: { kind: FrameKind; written: string; block?: EmbedBlock }) {
  const { t } = useI18n();
  const intent = useInitiativeIntentContext();
  const qc = useQueryClient();
  const [text, setText] = useState(written);
  const [busy, setBusy] = useState(false);
  if (!intent) return null;
  const commit = async () => {
    if (busy) return;
    const title = text.trim();
    // Left empty, it was never written: the line goes, and nothing was made.
    if (!title) { block?.remove(); return; }
    setBusy(true);
    // The line points at its row before the row is written: the description
    // saves as the focus leaves, and what it saves must already name the row.
    // The row is in the bundle at once too, so the line never shows as
    // pointing at nothing.
    const id = crypto.randomUUID();
    const order = Math.max(0, ...(intent.data?.subs ?? []).map((s) => s.order_index ?? 0)) + 1;
    const now = new Date().toISOString();
    const provisional: Intent = {
      id, strategy_id: intent.initiativeId, parent_intent_id: intent.data?.master?.id ?? null, kind, title,
      target_value: null, actual_value: null, unit: null, measured_at: null, direction: null, slug: null, subtitle: null,
      captured_dimensions: [], uncaptured_dimensions: [], abandoned: null, horizon: null, status: 'on_track',
      decided_by_name: null, decided_by_role: null, decided_at: null, superseded_by_intent_id: null,
      order_index: order, created_by: '', created_at: now, updated_at: now,
    };
    patchBundle(qc, intent.initiativeId, (bundle) => ({ ...bundle, subs: [...bundle.subs, provisional] }));
    block?.update(boundFrameSpec(id));
    try {
      const parent = await intent.ensureRoot();
      await createIntent({ id, strategy_id: intent.initiativeId, parent_intent_id: parent, kind, title, status: 'on_track', order_index: order });
      intent.refetch();
    } catch (e) {
      // Not written: the row leaves the bundle and the line goes back to a
      // draft holding the sentence, so nothing typed is lost and the next
      // Enter tries again.
      patchBundle(qc, intent.initiativeId, (bundle) => ({ ...bundle, subs: bundle.subs.filter((sub) => sub.id !== id) }));
      block?.update(draftFrameSpec(kind, title));
      void appDialog.alert(formatError(e));
    }
  };
  return (
    <LineShell kind={kind}>
      <LineText value={text} onChange={setText} onCommit={() => void commit()} placeholder={t(KIND_PLACEHOLDER[kind])}
        readOnly={!intent.canEdit || busy} autoFocus={!!block?.fresh && intent.canEdit} />
    </LineShell>
  );
}

/** A line whose row is no longer there — deleted elsewhere. */
function GoneLine({ block, canEdit }: { block?: EmbedBlock; canEdit: boolean }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
      {t('What this line pointed at has been deleted.')}
      {canEdit && block && (
        <button type="button" onClick={() => block.remove()} className="rounded px-1 text-foreground/80 underline underline-offset-2 hover:text-foreground">
          {t('Remove the line')}
        </button>
      )}
    </p>
  );
}

function RowLine({ row, kind, block }: { row: Intent; kind: FrameKind; block?: EmbedBlock }) {
  const { t } = useI18n();
  const intent = useInitiativeIntentContext();
  const qc = useQueryClient();
  const [text, setText] = useState(row.title);
  const [focused, setFocused] = useState(false);
  // The saved sentence, taken up again when it changes elsewhere while nobody
  // here is typing in it.
  const [seed, setSeed] = useState(row.title);
  if (row.title !== seed && !focused) { setSeed(row.title); setText(row.title); }
  if (!intent) return null;
  const count = elementsOn(intent.data?.bindings ?? [], row.id);
  const standing = kind === 'measure' ? measureStanding(row) : null;
  const reversed = !!row.superseded_by_intent_id;

  const save = async () => {
    setFocused(false);
    const next = text.trim();
    // A line is never left without its sentence: emptied, it keeps the one it had.
    if (!next || next === row.title) { setText(row.title); return; }
    const before = row.title;
    patchBundle(qc, intent.initiativeId, (bundle) => ({ ...bundle, subs: bundle.subs.map((s) => (s.id === row.id ? { ...s, title: next } : s)) }));
    try {
      await updateIntent(row.id, { title: next });
      intent.refetch();
    } catch (e) {
      patchBundle(qc, intent.initiativeId, (bundle) => ({ ...bundle, subs: bundle.subs.map((s) => (s.id === row.id ? { ...s, title: before } : s)) }));
      void appDialog.alert(formatError(e));
    }
  };
  const remove = async () => {
    const question = count > 0
      ? t('{n} Elements rest on this line. Delete it anyway? They lose it as their reason.', { n: count })
      : t('Delete this line?');
    if (!await appDialog.confirm(question)) return;
    try {
      await deleteIntent(row.id);
      patchBundle(qc, intent.initiativeId, (bundle) => ({
        ...bundle,
        subs: bundle.subs.filter((s) => s.id !== row.id),
        bindings: bundle.bindings.filter((b) => b.intent_id !== row.id),
      }));
      block?.remove();
      intent.refetch();
    } catch (e) {
      void appDialog.alert(formatError(e));
    }
  };

  return (
    <LineShell kind={kind} tail={
      <div className="flex shrink-0 items-center gap-2.5 pt-[3px] text-[12px] leading-[1.65] tabular-nums text-muted-foreground">
        {reversed && <span>{t('Reversed')}</span>}
        {standing && <span>{standing}</span>}
        <span className={count === 0 ? 'text-muted-foreground/60' : undefined}>{t('{n} Elements', { n: count })}</span>
        {intent.canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title={t('More')} aria-label={t('More')}
                className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/line:opacity-100 data-[state=open]:opacity-100">
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void remove()} className="gap-2.5 py-1.5 text-[13px]">
                <Trash2 size={15} />{t('Delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    }>
      <div onFocus={() => setFocused(true)}>
        <LineText value={text} onChange={setText} onCommit={() => void save()} placeholder={t(KIND_PLACEHOLDER[kind])}
          readOnly={!intent.canEdit} muted={reversed} />
      </div>
    </LineShell>
  );
}

/** One line of the frame, drawn where the description places it. */
export function FrameLine({ spec, block }: { spec: EmbedSpec; block?: EmbedBlock }) {
  const { t } = useI18n();
  const intent = useInitiativeIntentContext();
  const ref = frameRef(spec);
  if (!intent || !ref) return <p className="py-1 text-[12px] text-muted-foreground">{t('This line cannot be read.')}</p>;
  if ('kind' in ref) return <DraftLine kind={ref.kind} written={ref.text} block={block} />;
  // Still reading: hold the line's room rather than call its row missing.
  if (!intent.data) return <div className="h-7" aria-hidden />;
  const row = intent.data.subs.find((s) => s.id === ref.id) ?? null;
  if (!row || !isFrameKind(row.kind)) return <GoneLine block={block} canEdit={intent.canEdit} />;
  return <RowLine key={row.id} row={row} kind={row.kind} block={block} />;
}

/** The lines of the frame the description does not place, after it: a row
 *  made elsewhere (by a conversation, or before lines existed) is still part
 *  of the Strategy, and stays in view until someone places or deletes it. */
export function UnplacedFrameLines({ description }: { description: string | null }) {
  const intent = useInitiativeIntentContext();
  const subs = intent?.data?.subs;
  const rows = useMemo(() => unplacedFrameRows(subs ?? [], placedFrameIds(description)), [subs, description]);
  if (!rows.length) return null;
  return (
    <div className="mt-1">
      {rows.map((row) => (isFrameKind(row.kind) ? <RowLine key={row.id} row={row} kind={row.kind} /> : null))}
    </div>
  );
}
