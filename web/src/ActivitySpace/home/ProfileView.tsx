'use client';

import { useMemo, useState } from 'react';
import { FileText, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/ui/button';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { NavHomeIcon } from '@/shell/sidebar/NavIcons';
import { MyElementsView } from '@/ActivitySpace/home/MyElementsView';
import { NowScreen } from '@/ActivitySpace/home/now/NowScreen';
import { ProfileAI } from '@/Function/copilot/ProfileAI';
import { useWorkers } from '@/ActivitySpace/sustainment/team/data';
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

type ProfileTab = 'now' | 'elements' | 'notes' | 'ai';

// The Profile page is the person's own home: a header (cover, avatar, name,
// id, bio, Edit profile) and, under a rule, the personal surfaces as tabs.
// It has no sidebar — the tabs are its navigation.
export function ProfileView({ onNavigate, onViewChange, onOpenSettings, activeDomainId }: Props) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const spaceId = useActiveSpaceId();
  const [tab, setTab] = useState<ProfileTab>('elements');
  const name = profile?.display_name || user?.email?.split('@')[0] || 'You';
  // The person's Worker id (wrk_015) is the handle other surfaces show.
  const { data: workers } = useWorkers();
  const handle = workers.find(worker => worker.user_id === user?.id)?.display_id ?? user?.email?.split('@')[0] ?? null;
  const { nodes: notes, loading: notesLoading } = useNotes();
  const myNotes = useMemo(() => notes.filter(node => node.type === 'file' && node.createdBy === user?.id), [notes, user?.id]);
  const openNote = (id: string) => {
    // The notebook opens on a root Folder; walk up from the page to find it.
    const byId = new Map(notes.map(node => [node.id, node]));
    let node = byId.get(id);
    while (node?.parentId && byId.has(node.parentId)) node = byId.get(node.parentId);
    onViewChange?.('note');
    onNavigate({ noteFolderId: node?.id ?? null, noteId: id });
  };

  const tabs: { id: ProfileTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'now', label: 'Now', icon: NavHomeIcon },
    { id: 'elements', label: 'My Elements', icon: ElementIcon },
    { id: 'notes', label: 'My Notes', icon: FileText },
    { id: 'ai', label: 'AI', icon: Sparkles },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="shrink-0">
        <div className="h-28 bg-[var(--surface-strong)]" aria-hidden="true" />
        <div className="px-6">
          <div className="flex items-end justify-between">
            <div className="-mt-10 rounded-full bg-card p-1">
              <WorkerAvatar worker={{ name, avatar_url: profile?.avatar_url }} size={80} className="ring-0" />
            </div>
            <Button variant="secondary" onClick={onOpenSettings} className="mb-1"><Pencil size={14} />{t('Edit profile')}</Button>
          </div>
          <div className="mt-2 min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">{name}</h1>
            {handle && <p className="truncate text-[13px] text-muted-foreground">@{handle}</p>}
          </div>
          {profile?.bio && <p className="mt-3 max-w-2xl whitespace-pre-wrap text-[14px] leading-6 text-foreground/90">{profile.bio}</p>}
        </div>
        <nav className="mt-4 flex gap-1 border-b border-border px-6" aria-label={t('Profile sections')}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <Button key={id} shape="tab" variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)} className="mb-1.5">
              <Icon size={16} />{t(label)}
            </Button>
          ))}
        </nav>
      </header>
      <div className={tab === 'now' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <NowScreen spaceId={spaceId} onNavigate={onNavigate} onViewChange={onViewChange} />
      </div>
      {/* MyElementsView lays itself out as a flex child (header + scrolling
          list), so its wrapper has to be a bounded flex column or the list
          is clipped instead of scrolling. */}
      <div className={tab === 'elements' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <MyElementsView embedded onNavigate={onNavigate} onViewChange={onViewChange} />
      </div>
      <div className={tab === 'notes' ? 'min-h-0 flex-1 overflow-y-auto px-6 py-4' : 'hidden'}>
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
