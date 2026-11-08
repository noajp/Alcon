'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SettingsSection, SettingsRow } from './SettingsSection';
import { canEditMemory, filterMemories, promotionCandidates, type Memory } from './memoryModel';
import {
  deleteMemory, listMySpaces, promoteMemory, setMemoryPinned, setPersonalAutoCapture,
  setSpaceAutoCapture, shareMemoryToSpace, updateMemory, usePersonalMemories, useSpaceMemories,
  type MemoryListState,
} from '@/hooks/memoryData';
import type { MemoryKind, MemoryLayer, PromotionDraft } from '@/types/database';
import { createPromotionDraft, usePromotionObjectNames } from '@/AIP/harness/promotionData';
import { PromotionDraftDialog } from '@/AIP/harness/PromotionDrafts';
import { useDefinitions } from '@/hooks/definitionData';

// Memory, where a person controls it (Memory PR4): the auto-capture
// toggle, the kept memories themselves — read, corrected, pinned,
// promoted, shared, deleted — and the procedures Athena reaches for
// most, which is where the promotion path to a standing harness
// starts (condition 5: "Make it standing" opens the drafting here;
// the draft itself lives in the Harnesses screen). One view serves
// both scopes; the wrappers differ only in whose rows and whose
// toggle they hold. Everything works without AI: this screen is
// plain record-keeping over the memories table.

interface ViewProps {
  state: MemoryListState;
  userId: string | null;
  isSpaceOwner: boolean;
  captureEditable: boolean;
  onToggleCapture: (on: boolean) => Promise<void>;
  shareSpaces: { id: string; name: string }[] | null;
}

function MemoryView({ state, userId, isSpaceOwner, captureEditable, onToggleCapture, shareSpaces }: ViewProps) {
  const { t, locale } = useI18n();
  const [layer, setLayer] = useState<MemoryLayer | 'all'>('all');
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', gist: '', body: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [shareSpaceId, setShareSpaceId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => filterMemories(state.memories, { layer, kind, query, showHistory }),
    [state.memories, layer, kind, query, showHistory],
  );
  const candidates = useMemo(() => promotionCandidates(state.memories).slice(0, 5), [state.memories]);

  // The promotion path's door (condition 5): a candidate that belongs
  // to a Space can start its drafting here; the draft then lives in
  // the Harnesses screen's promotion section, and this dialog follows
  // it. Personal candidates cross only after being shared to a Space
  // (the share action below is that crossing, with the body shown).
  const [promoDraft, setPromoDraft] = useState<PromotionDraft | null>(null);
  const promoDefinitions = useDefinitions(promoDraft?.activity_space_id ?? null);
  const promoObjectNames = usePromotionObjectNames(promoDraft?.activity_space_id ?? null);

  const act = async (fn: () => Promise<void>, failKey: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await state.refetch();
    } catch (e) {
      setError(t(failKey, { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = (k: MemoryKind) => (k === 'event' ? t('Event') : k === 'procedure' ? t('Procedure') : t('Fact'));
  const provenance = (m: Memory) => (m.origin === 'person'
    ? t('Written by a person')
    : m.source_session_id ? t('Distilled from a conversation') : t('Distilled from a run'));
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : '');

  if (state.loading) {
    return <p className="py-2 text-[12px] text-muted-foreground">{t('Loading…')}</p>;
  }
  if (state.error) {
    return <p role="alert" className="py-2 text-[12px] text-[var(--status-danger)]">{t("Couldn't load the memories: {error}", { error: state.error.message })}</p>;
  }

  return (
    <>
      <SettingsRow label={t('Auto-capture')} hint={t('When work finishes, Athena distils what it taught into a memory. Turning this off stops new memories; the ones already kept stay.')}>
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            checked={state.autoCapture ?? true}
            disabled={!captureEditable || busy}
            onChange={(e) => void act(() => onToggleCapture(e.target.checked), "Couldn't change auto-capture: {error}")}
          />
          {(state.autoCapture ?? true) ? t('On') : t('Off')}
        </label>
      </SettingsRow>
      {!captureEditable && <p className="text-[12px] text-muted-foreground">{t('Only the owner can change auto-capture here.')}</p>}
      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      {notice && <p className="text-[12px] text-muted-foreground">{notice}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(['all', 'durable', 'episode'] as const).map((l) => (
          <button
            key={l} type="button" onClick={() => setLayer(l)}
            className={`px-2 py-1 text-[12px] rounded-md transition-colors ${layer === l ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'}`}
          >{l === 'all' ? t('All memories') : l === 'durable' ? t('Durable') : t('Episodes')}</button>
        ))}
        <select
          value={kind} onChange={(e) => setKind(e.target.value as MemoryKind | 'all')}
          className="px-2 py-1 text-[12px] rounded-md bg-muted/40 text-foreground border-none"
          aria-label={t('Kind')}
        >
          <option value="all">{t('All kinds')}</option>
          <option value="event">{t('Event')}</option>
          <option value="procedure">{t('Procedure')}</option>
          <option value="fact">{t('Fact')}</option>
        </select>
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search memories')}
          className="w-48 px-2 py-1 text-[12px] rounded-md bg-muted/40 text-foreground border-none focus:bg-muted/70"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          {t('Show history')}
        </label>
      </div>

      {candidates.length > 0 && layer !== 'episode' && (
        <div className="mt-4 rounded-md border border-border/60 p-3">
          <p className="text-[12px] font-medium text-foreground">{t('Promotion candidates')}</p>
          <p className="text-[12px] text-muted-foreground">{t('The procedures Athena reaches for most — where turning know-how into a harness would start.')}</p>
          <ul className="mt-1.5 space-y-1">
            {candidates.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                <button type="button" className="text-left text-foreground hover:underline" onClick={() => { setOpenId(m.id); setLayer('durable'); }}>{m.title}</button>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-muted-foreground">{t('Used {n} times', { n: m.use_count })}</span>
                  {m.activity_space_id && (
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(async () => {
                      const d = await createPromotionDraft({ spaceId: m.activity_space_id!, source: { kind: 'memory', memoryId: m.id } });
                      setPromoDraft(d);
                    }, "Couldn't start the promotion: {error}")}>
                      {t('Make it standing')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 divide-y divide-border/60">
        {rows.length === 0 && (
          <p className="py-3 text-[12px] text-muted-foreground">{state.memories.length === 0 ? t('No memories yet. When work finishes, what it taught appears here.') : t('No memories match.')}</p>
        )}
        {rows.map((m) => {
          const editable = canEditMemory(m, userId, isSpaceOwner);
          const open = openId === m.id;
          const editing = editingId === m.id;
          return (
            <div key={m.id} className="py-2.5">
              <button type="button" className="block w-full text-left" onClick={() => setOpenId(open ? null : m.id)}>
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">{kindLabel(m.kind)}</span>
                  <span className="text-[13px] text-foreground">{m.title}</span>
                  {m.pinned && <span className="shrink-0 text-[11px] text-muted-foreground">{t('Pinned')}</span>}
                  {m.status !== 'active' && <span className="shrink-0 text-[11px] text-muted-foreground">{m.status === 'superseded' ? t('Superseded') : m.status === 'expired' ? t('Expired') : t('Archived')}</span>}
                </span>
                {m.gist && <span className="mt-0.5 block text-[12px] text-muted-foreground">{m.gist}</span>}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {provenance(m)} · {t('Used {n} times', { n: m.use_count })} · {date(m.created_at)}
                  {m.layer === 'episode' && m.expires_at && m.status === 'active' ? ` · ${t('Expires {date}', { date: date(m.expires_at) })}` : ''}
                </span>
              </button>

              {open && !editing && (
                <div className="mt-2">
                  <p className="whitespace-pre-wrap text-[13px] text-foreground">{m.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {editable && (
                      <Button variant="ghost" disabled={busy} onClick={() => { setEditingId(m.id); setDraft({ title: m.title, gist: m.gist, body: m.body }); }}>
                        {t('Edit')}
                      </Button>
                    )}
                    <Button variant="ghost" disabled={busy} onClick={() => void act(() => setMemoryPinned(m.id, !m.pinned), "Couldn't change the pin: {error}")}>
                      {m.pinned ? t('Unpin memory') : t('Pin memory')}
                    </Button>
                    {m.layer === 'episode' && m.status === 'active' && editable && (
                      <Button variant="ghost" disabled={busy} onClick={() => void act(() => promoteMemory(m), "Couldn't promote the memory: {error}")}>
                        {t('Promote to durable')}
                      </Button>
                    )}
                    {editable && (confirmDeleteId === m.id ? (
                      <>
                        <span className="text-[12px] text-muted-foreground">{t('Delete this memory?')}</span>
                        <Button variant="danger" disabled={busy} onClick={() => void act(async () => { await deleteMemory(m.id); setConfirmDeleteId(null); setOpenId(null); }, "Couldn't delete the memory: {error}")}>
                          {t('Delete')}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setConfirmDeleteId(null)}>{t('Cancel')}</Button>
                      </>
                    ) : (
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirmDeleteId(m.id)}>{t('Delete')}</Button>
                    ))}
                  </div>
                  {shareSpaces && shareSpaces.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] text-muted-foreground">{t('Share to a Space')}</span>
                      <select
                        value={shareSpaceId} onChange={(e) => setShareSpaceId(e.target.value)}
                        className="px-2 py-1 text-[12px] rounded-md bg-muted/40 text-foreground border-none"
                        aria-label={t('Share to a Space')}
                      >
                        <option value="">—</option>
                        {shareSpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <Button
                        variant="ghost" disabled={busy || !shareSpaceId}
                        onClick={() => void act(async () => {
                          const target = shareSpaces.find((s) => s.id === shareSpaceId);
                          await shareMemoryToSpace(m, shareSpaceId, userId ?? '');
                          setNotice(t('Shared to {name}.', { name: target?.name ?? '' }));
                        }, "Couldn't share the memory: {error}")}
                      >{t('Share')}</Button>
                      <span className="text-[11px] text-muted-foreground">{t('The whole memory above is copied, as yours. The original stays personal.')}</span>
                    </div>
                  )}
                </div>
              )}

              {open && editing && (
                <div className="mt-2 space-y-2">
                  <input
                    value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full px-2 py-1.5 text-[13px] rounded-md bg-muted/40 text-foreground border-none focus:bg-muted/70"
                    aria-label={t('Title')}
                  />
                  <input
                    value={draft.gist} onChange={(e) => setDraft({ ...draft, gist: e.target.value })}
                    className="w-full px-2 py-1.5 text-[12px] rounded-md bg-muted/40 text-foreground border-none focus:bg-muted/70"
                    aria-label={t('Summary')}
                  />
                  <textarea
                    value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={6}
                    className="w-full px-2 py-1.5 text-[13px] rounded-md bg-muted/40 text-foreground border-none focus:bg-muted/70"
                    aria-label={t('Body')}
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="primary" disabled={busy || !draft.title.trim() || !draft.body.trim()}
                      onClick={() => void act(async () => {
                        await updateMemory(m.id, { title: draft.title.trim(), gist: draft.gist.trim(), body: draft.body }, userId ?? '');
                        setEditingId(null);
                      }, "Couldn't save the memory: {error}")}
                    >{t('Save')}</Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>{t('Cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {promoDraft && (
        <PromotionDraftDialog draft={promoDraft} isOwner={isSpaceOwner}
          definitions={promoDefinitions.data} objectNames={promoObjectNames}
          onClose={() => setPromoDraft(null)}
          onChanged={() => { void state.refetch(); }} />
      )}
    </>
  );
}

const DESCRIPTION = 'What Athena keeps from finished work, and what it brings back when similar work comes. A memory is a record of what was learned — never an instruction, and always traceable to the work it came from.';

export function SpaceMemorySettings({ spaceId, isOwner, userId }: { spaceId: string; isOwner: boolean; userId: string | null }) {
  const { t } = useI18n();
  const state = useSpaceMemories(spaceId);
  return (
    <SettingsSection title={t('Memory')} description={t(DESCRIPTION)}>
      <MemoryView
        state={state}
        userId={userId}
        isSpaceOwner={isOwner}
        captureEditable={isOwner}
        onToggleCapture={(on) => setSpaceAutoCapture(spaceId, on)}
        shareSpaces={null}
      />
    </SettingsSection>
  );
}

export function PersonalMemorySettings({ userId }: { userId: string }) {
  const { t } = useI18n();
  const state = usePersonalMemories(userId);
  const [spaces, setSpaces] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    void listMySpaces(userId).then((s) => { if (live) setSpaces(s); }).catch(() => { if (live) setSpaces([]); });
    return () => { live = false; };
  }, [userId]);
  return (
    <SettingsSection title={t('Memory')} description={t('Your own memories: what Athena kept from your work outside a Space, and from your conversations. Only you can read them; sharing one into a Space is always your explicit act, from the opened memory.')}>
      <MemoryView
        state={state}
        userId={userId}
        isSpaceOwner={false}
        captureEditable
        onToggleCapture={(on) => setPersonalAutoCapture(userId, on)}
        shareSpaces={spaces}
      />
    </SettingsSection>
  );
}
