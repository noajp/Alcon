'use client';

import { useState } from 'react';
import { Settings, Sparkles } from 'lucide-react';
import { Button } from '@/ui/button';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { MyElementsView } from '@/ActivitySpace/home/MyElementsView';
import { ProfileAI } from '@/Function/copilot/ProfileAI';
import { useDomains } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';

interface Props {
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  onOpenSettings: () => void;
  activeDomainId?: string | null;
}

export function ProfileView({ onNavigate, onViewChange, onOpenSettings, activeDomainId }: Props) {
  const { user, profile } = useAuthContext();
  const { data: domains, guestDomains } = useDomains();
  const [tab, setTab] = useState<'elements' | 'ai'>('elements');
  const name = profile?.display_name || user?.email?.split('@')[0] || 'You';
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex items-start gap-4 px-6 pt-6 pb-4">
        <WorkerAvatar worker={{ name, avatar_url: profile?.avatar_url }} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold truncate">{name}</h1>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          <p className="text-xs text-muted-foreground mt-1">{[...domains, ...guestDomains].find(domain => domain.id === activeDomainId)?.name}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpenSettings}><Settings size={16} /></Button>
      </header>
      <div className="flex gap-2 px-6 pb-3" aria-label="Profile sections">
        <Button variant={tab === 'elements' ? 'secondary' : 'ghost'} aria-pressed={tab === 'elements'} onClick={() => setTab('elements')}><ElementIcon size={16} />My Elements</Button>
        <Button variant={tab === 'ai' ? 'secondary' : 'ghost'} aria-pressed={tab === 'ai'} onClick={() => setTab('ai')}><Sparkles size={16} />AI</Button>
      </div>
      <div className={tab === 'elements' ? 'flex-1 min-h-0 overflow-hidden' : 'hidden'}>
        <MyElementsView embedded onNavigate={onNavigate} onViewChange={onViewChange} />
      </div>
      <div className={tab === 'ai' ? 'flex flex-1 min-h-0' : 'hidden'}>
        <ProfileAI activeDomainId={activeDomainId} />
      </div>
    </div>
  );
}
