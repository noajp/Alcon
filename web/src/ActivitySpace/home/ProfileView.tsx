'use client';

import { useMemo, useState } from 'react';
import { FileText, Pencil, Sparkles } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { NavHomeIcon } from '@/Frame/sidebar/NavIcons';
import { MyElementsView } from '@/ActivitySpace/home/MyElementsView';
import { ProfileOverview } from '@/ActivitySpace/home/ProfileOverview';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { useActivitySpaces, useSpaceRole } from '@/Function/space/data';
import { useNowMinute } from '@/Function/shared/useNow';
import { ProfileAI } from '@/AIP/ai/ProfileAI';
import { useSelfWorker } from '@/hooks/teamData';
import { useNotes } from '@/hooks/useNotesDb';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';

interface Props {
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  onOpenSettings: () => void;
  activeDomainId?: string | null;
}

type ProfileTab = 'overview' | 'elements' | 'notes' | 'ai';

// The Profile page is the person's own page, read like a contact card: the
// avatar and name, who they are in this Space, a line of facts (their local
// time, handle, email) and their bio; under it, tabs — an Overview of what
// matters about their work now, their Elements, their Notes and their AI.
export function ProfileView({ onNavigate, onViewChange, onOpenSettings, activeDomainId }: Props) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const spaceId = useActiveSpaceId();
  const [tab, setTab] = useState<ProfileTab>('overview');
  const spaces = useActivitySpaces().data;
  const spaceName = spaces.find((sp) => sp.id === spaceId)?.name ?? null;
  const role = useSpaceRole(spaceId);
  // Their local time, as the card reads it.
  const now = useNowMinute(true);
  const localTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = profile?.display_name || user?.email?.split('@')[0] || t('You');
  // The person's Worker id (wrk_015) is the handle other surfaces show.
  const selfWorker = useSelfWorker(user?.id);
  const handle = selfWorker?.display_id ?? user?.email?.split('@')[0] ?? null;
  const { nodes: notes, loading: notesLoading } = useNotes();
  const myNotes = useMemo(() => notes.filter(node => node.type === 'file' && node.createdBy === user?.id), [notes, user?.id]);
  const openNote = (id: string) => {
    // The notebook opens on a root Folder; walk up from the page to find it.
    const byId = new Map(notes.map(node => [node.id, node]));
    let node = byId.get(id);
    while (node?.parentId && byId.has(node.parentId)) node = byId.get(node.parentId);
    onViewChange?.('note');
    onNavigate({ noteFolderId: node?.id ?? null, noteSectionId: null, noteId: id });
  };

  const tabs: { id: ProfileTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'overview', label: 'Overview', icon: NavHomeIcon },
    { id: 'elements', label: 'My Elements', icon: ElementIcon },
    { id: 'notes', label: 'My Notes', icon: FileText },
    { id: 'ai', label: 'AI', icon: Sparkles },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <IslandHeader crumbs={[{ id: 'profile', label: t('Profile') }]}
        actions={<Button variant="ghost" size="sm" onClick={onOpenSettings}><Pencil size={14} />{t('Edit profile')}</Button>} />
      <header className="shrink-0 border-b border-[var(--border-subtle)]">
        <div className="mx-auto w-full max-w-3xl px-8 pt-8">
          <div className="flex items-center gap-4">
            <WorkerAvatar worker={{ name, avatar_url: profile?.avatar_url }} size={56} className="ring-0" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[20px] font-semibold leading-7 text-foreground">{name}</h1>
              {spaceName && (
                <p className="truncate text-[13px] text-muted-foreground">
                  {t(role === 'owner' ? 'Owner at {space}' : 'Member at {space}', { space: spaceName })}
                </p>
              )}
              {/* The facts, in one line: local time, handle, email. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                <span>{t('{time} there', { time: localTime })} · {zone}</span>
                {handle && <span className="rounded border border-[var(--border-default)] px-1.5 py-px text-[11px] text-foreground/80">@{handle}</span>}
                {user?.email && <span className="rounded border border-[var(--border-default)] px-1.5 py-px text-[11px] text-foreground/80">{user.email}</span>}
              </p>
            </div>
          </div>
          {profile?.bio && <p className="mt-4 max-w-2xl whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{profile.bio}</p>}
          <nav className="mt-5 flex gap-1 pb-2" aria-label={t('Profile sections')}>
            {tabs.map(({ id, label, icon: Icon }) => (
              <Button key={id} shape="tab" size="sm" variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)}>
                <Icon size={14} />{t(label)}
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <div className={tab === 'overview' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <ProfileOverview userId={user?.id ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />
        </div>
      </div>
      {/* MyElementsView lays itself out as a flex child (header + scrolling
          list), so its wrapper has to be a bounded flex column or the list
          is clipped instead of scrolling. */}
      <div className={tab === 'elements' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <MyElementsView embedded onNavigate={onNavigate} onViewChange={onViewChange} />
      </div>
      <div className={tab === 'notes' ? 'mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-6 py-4' : 'hidden'}>
        {notesLoading ? <p role="status" className="text-[13px] text-muted-foreground">{t('Loading…')}</p>
          : myNotes.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('No notes yet.')}</p>
          : <ul className="space-y-0.5">
            {myNotes.map(note => (
              <li key={note.id}>
                <button type="button" onClick={() => openNote(note.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted/50">
                  <FileText size={16} className="shrink-0 text-muted-foreground" /><span className="truncate">{note.name || t('Untitled')}</span>
                </button>
              </li>
            ))}
          </ul>}
      </div>
      <div className={tab === 'ai' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <ProfileAI activeDomainId={activeDomainId} />
      </div>
    </div>
  );
}
