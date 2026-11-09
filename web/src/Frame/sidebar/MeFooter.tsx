'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Settings } from '@/ui/icons';

// The foot of the sidebar: who you are and whether this window is connected
// — it opens the Profile — and beside it, the gear to Settings. Online and
// offline are the browser's own reading of the network, so what it says is
// true of this window.

const subscribe = (fn: () => void) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => { window.removeEventListener('online', fn); window.removeEventListener('offline', fn); };
};

export function MeFooter({ active, onOpen, onSettings }: { active: boolean; onOpen: () => void; onSettings?: () => void }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const name = profile?.display_name || user?.email?.split('@')[0] || null;
  const avatarUrl = profile?.avatar_url;
  const me = useMemo(() => ({ name, avatar_url: avatarUrl }), [name, avatarUrl]);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <div className="mx-1 mb-1.5 flex shrink-0 items-center gap-1">
    <button type="button" onClick={onOpen} aria-pressed={active} title={t('Profile')}
      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'}`}>
      <span className="relative shrink-0">
        <WorkerAvatar worker={me} size={26} />
        <span aria-hidden className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--sidebar)]"
          style={{ background: online ? 'var(--status-success)' : 'var(--text-tertiary)' }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{name ?? t('Profile')}</span>
        <span className="block text-[11px] text-muted-foreground">{online ? t('Online') : t('Offline')}</span>
      </span>
    </button>
    {onSettings && (
      <button type="button" onClick={onSettings} title={t('Settings')} aria-label={t('Settings')}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground">
        <Settings size={15} />
      </button>
    )}
    </div>
  );
}
