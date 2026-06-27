'use client';

import { useEffect, useState } from 'react';
import { Check, Plus, Pencil, Trash2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { supabase } from '@/lib/supabase';
import {
  useActivitySpaces,
  createActivitySpace,
  updateActivitySpace,
  deleteActivitySpace,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { getActiveSpaceId, setActiveSpaceId, ACTIVE_SPACE_CHANGE_EVENT } from './activeSpaceStore';

type Mode = 'list' | 'create' | 'rename';

/**
 * The sidebar's top-of-tree header: the active ActivitySpace (company /
 * enterprise) name + a switcher to jump between spaces, create, rename, or
 * delete one. Replaces the old static "Activity Space" label.
 *
 * Create / delete reload afterward so the app gate re-resolves spaces with
 * fresh data (the gate's useActivitySpaces is a separate instance).
 */
export function SpaceSwitcher() {
  const { user } = useAuthContext();
  const { data: spaces, refetch } = useActivitySpaces();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('list');
  const [draft, setDraft] = useState('');
  const [activeId, setActiveId] = useState<string>(() => getActiveSpaceId() ?? '');

  useEffect(() => {
    const h = (e: Event) => setActiveId((e as CustomEvent<string>).detail ?? '');
    window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, h as EventListener);
    return () => window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, h as EventListener);
  }, []);

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const reset = () => { setMode('list'); setDraft(''); };

  const switchTo = (id: string) => {
    setActiveSpaceId(id);
    setActiveId(id);
    setOpen(false);
  };

  const submit = async () => {
    const next = draft.trim();
    if (!next || !user) return;
    try {
      if (mode === 'create') {
        const space = await createActivitySpace({ name: next, user_id: user.id });
        setActiveSpaceId(space.id);            // land in the new (empty) space
        window.location.reload();              // gate re-resolves with fresh spaces
      } else if (mode === 'rename' && active) {
        await updateActivitySpace(active.id, { name: next });
        await refetch();
        reset();
      }
    } catch (e) {
      console.error('Space update failed', e);
    }
  };

  const remove = async () => {
    if (!active) return;
    // Never orphan Domains: a non-empty Space can't be deleted (FK is set-null,
    // which would hide its Domains from every space). Make the user clear it first.
    const { count } = await supabase
      .from('domains')
      .select('id', { count: 'exact', head: true })
      .eq('activity_space_id', active.id);
    if ((count ?? 0) > 0) {
      window.alert(`"${active.name}" still has Domains. Move or delete them before deleting the Space.`);
      return;
    }
    if (!window.confirm(`Delete Space "${active.name}"? This can't be undone.`)) return;
    try {
      await deleteActivitySpace(active.id);
      window.location.reload();
    } catch (e) {
      console.error('Delete Space failed', e);
    }
  };

  const initial = (active?.name ?? '?').charAt(0).toUpperCase();

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-1 h-7 rounded-md hover:bg-sidebar-accent/50 transition-colors"
          title="Switch Space"
        >
          <span className="w-6 h-6 rounded-md bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center shrink-0">
            {initial}
          </span>
          <span className="text-left text-[13px] font-semibold text-foreground truncate max-w-[100px]">
            {active?.name ?? 'Space'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Spaces
        </div>
        {spaces.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => switchTo(s.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 text-[13px] text-left transition-colors"
          >
            <span className="w-5 h-5 rounded bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
              {s.name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{s.name}</span>
            {s.id === active?.id && <Check size={13} className="shrink-0 text-muted-foreground" />}
          </button>
        ))}

        <div className="my-1 border-t border-border/60" />

        {mode !== 'list' ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submit(); }
              else if (e.key === 'Escape') reset();
            }}
            onBlur={() => { if (!draft.trim()) reset(); }}
            placeholder={mode === 'create' ? 'Space name…' : 'Rename Space…'}
            className="w-full px-2 py-1.5 text-[13px] bg-muted/40 rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setMode('create'); setDraft(''); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 text-[13px] text-left text-muted-foreground transition-colors"
            >
              <Plus size={13} /> Create Space
            </button>
            {active && (
              <>
                <button
                  type="button"
                  onClick={() => { setMode('rename'); setDraft(active.name); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 text-[13px] text-left text-muted-foreground transition-colors"
                >
                  <Pencil size={13} /> Rename
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-destructive/10 text-[13px] text-left text-destructive transition-colors"
                >
                  <Trash2 size={13} /> Delete Space
                </button>
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
