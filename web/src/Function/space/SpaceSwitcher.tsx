'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useState } from 'react';
import { Plus, Trash2, Settings, Users, ChevronRight, LogOut, ArrowLeft } from '@/ui/icons';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import {
  useActivitySpaces,
  createActivitySpace,
  deleteActivitySpace,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId, setActiveSpaceId } from './activeSpaceStore';
import { countSpaceDomains } from './data';
import { MenuCheck } from '@/ui/dropdown-menu';

type Panel = 'main' | 'spaces' | 'create';

interface SpaceSwitcherProps {
  onSettings?: () => void;
}

export function SpaceSwitcher({ onSettings }: SpaceSwitcherProps) {
  const { user, signOut } = useAuthContext();
  const { data: spaces } = useActivitySpaces();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');
  const [draft, setDraft] = useState('');
  const activeId = useActiveSpaceId();

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const reset = () => { setPanel('main'); setDraft(''); };

  const switchTo = (id: string) => {
    setActiveSpaceId(id);
    setPanel('main');
  };

  const submitCreate = async () => {
    const next = draft.trim();
    if (!next || !user) return;
    try {
      const space = await createActivitySpace({ name: next, user_id: user.id });
      setActiveSpaceId(space.id);
      window.location.reload();
    } catch (e) {
      console.error('Create failed', e);
    }
  };

  const remove = async () => {
    if (!active) return;
    let domainCount: number;
    try {
      domainCount = await countSpaceDomains(active.id);
    } catch (e) {
      await appDialog.alert(e instanceof Error && e.message ? e.message : 'Could not check the Space for Domains. Try again.');
      return;
    }
    if (domainCount > 0) {
      await appDialog.alert(`"${active.name}" still has Domains. Move or delete them before deleting the Space.`);
      return;
    }
    if (!await appDialog.confirm(`Delete Space "${active.name}"? This can't be undone.`)) return;
    try {
      await deleteActivitySpace(active.id);
      window.location.reload();
    } catch (e) {
      console.error('Delete Space failed', e);
      if (e instanceof Error && e.message) await appDialog.alert(e.message);
    }
  };


  const menuItem = 'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors';

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-1 h-7 rounded-md hover:bg-sidebar-accent/50 transition-colors"
          title="Switch Space"
        >
          <SpaceMark space={active} size={24} />
          <span className="text-left text-[13px] font-medium text-foreground truncate max-w-[100px]">
            {active?.name ?? 'Space'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">

        {/* ── Main panel ── */}
        {panel === 'main' && (
          <>
            <button
              type="button"
              onClick={() => { setOpen(false); onSettings?.(); }}
              className={`${menuItem} text-foreground hover:bg-muted/40`}
            >
              <Settings size={15} className="text-muted-foreground" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onSettings?.(); }}
              className={`${menuItem} text-foreground hover:bg-muted/40`}
            >
              <Users size={15} className="text-muted-foreground" />
              Invite and manage members
            </button>

            <div className="my-1 border-t border-border/60" />

            <button
              type="button"
              onClick={() => setPanel('spaces')}
              className={`${menuItem} text-foreground hover:bg-muted/40`}
            >
              <SpaceMark space={active} size={15} />
              <span className="flex-1 truncate">Switch workspace</span>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className={`${menuItem} text-foreground hover:bg-muted/40`}
            >
              <LogOut size={15} className="text-muted-foreground" />
              Log out
            </button>
          </>
        )}

        {/* ── Spaces sub-panel ── */}
        {panel === 'spaces' && (
          <>
            <button
              type="button"
              onClick={() => setPanel('main')}
              className={`${menuItem} text-muted-foreground hover:bg-muted/40 mb-0.5`}
            >
              <ArrowLeft size={14} />
              <span className="text-[12px] font-medium">Back</span>
            </button>
            <div className="my-0.5 border-t border-border/60" />
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => switchTo(s.id)}
                className={`${menuItem} hover:bg-muted/40`}
              >
                <SpaceMark space={s} size={20} />
                <span className="flex-1 truncate text-foreground">{s.name}</span>
                {s.id === active?.id && <MenuCheck />}
              </button>
            ))}
            <div className="my-0.5 border-t border-border/60" />
            <button
              type="button"
              onClick={() => { setPanel('create'); setDraft(''); }}
              className={`${menuItem} text-muted-foreground hover:bg-muted/40`}
            >
              <Plus size={14} /> Create Space
            </button>
            {active && (
              <button
                type="button"
                onClick={() => void remove()}
                className={`${menuItem} text-destructive hover:bg-destructive/10`}
              >
                <Trash2 size={14} /> Delete Space
              </button>
            )}
          </>
        )}

        {/* ── Create input ── */}
        {panel === 'create' && (
          <>
            <button
              type="button"
              onClick={() => setPanel('spaces')}
              className={`${menuItem} text-muted-foreground hover:bg-muted/40 mb-0.5`}
            >
              <ArrowLeft size={14} />
              <span className="text-[12px] font-medium">Back</span>
            </button>
            <div className="my-0.5 border-t border-border/60" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void submitCreate(); }
                else if (e.key === 'Escape') setPanel('spaces');
              }}
              placeholder="Space name…"
              className="w-full px-2 py-1.5 text-[13px] bg-muted/40 rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none border-none"
            />
          </>
        )}

      </PopoverContent>
    </Popover>
  );
}

/** A Space's mark — its logo (an emoji or an image) where it has one, else
 *  its initial — drawn the same at every size, so the switcher's button and
 *  its list agree. */
function SpaceMark({ space, size }: { space: { name: string; logo?: string | null } | null | undefined; size: number }) {
  const logo = space?.logo ?? null;
  const box = { width: size, height: size };
  const radius = size >= 22 ? 'rounded-md' : 'rounded';
  if (logo && /^\p{Emoji}/u.test(logo) && logo.length <= 4) {
    return <span style={{ ...box, fontSize: Math.round(size * 0.58) }} className={`${radius} flex shrink-0 items-center justify-center bg-muted/60`}>{logo}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  if (logo) return <img src={logo} alt="" style={box} className={`${radius} shrink-0 object-cover`} />;
  return (
    <span style={{ ...box, fontSize: Math.round(size * 0.5) }} className={`${radius} flex shrink-0 items-center justify-center bg-primary/15 font-bold text-primary`}>
      {(space?.name ?? '?').charAt(0).toUpperCase()}
    </span>
  );
}

