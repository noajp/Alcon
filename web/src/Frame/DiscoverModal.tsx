'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchDiscoverable, joinDomain as joinDomainRow, joinObject as joinObjectRow, type DiscoverableDomain, type DiscoverableObject } from '@/hooks/discoverData';
import { useAuthContext } from '@/providers/AuthProvider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ObjectIcon } from '@/Frame/icons';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { notifyDomainsChanged } from '@/Function/space/domainsStore';
import { useI18n } from '@/Function/i18n/I18nProvider';

// "Things I haven't joined yet." Opens from the 🔍 in the ModeStrip and
// lists Domains / Objects whose member tables don't yet have a row for the
// current user. Joining writes a `role='member'` row, after which the item
// drops out of the list (and will appear in the sidebar once the sidebar
// fetch is scoped to memberships — that work is a follow-up).

interface DiscoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiscoverModal({ open, onOpenChange }: DiscoverModalProps) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const [tab, setTab] = useState<'domains' | 'objects'>('domains');
  const [domains, setDomains] = useState<DiscoverableDomain[]>([]);
  const [objects, setObjects] = useState<DiscoverableObject[]>([]);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchDiscoverable(user.id);
      setDomains(found.domains);
      setObjects(found.objects);
    } catch (e) {
      console.error('Failed to load Discover', e);
      setError(t('Could not load what you can join. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // A refused join keeps its row and says so.
  const joinDomain = async (domainId: string) => {
    if (!user) return;
    setError(null);
    try {
      await joinDomainRow(user.id, domainId);
      // It surfaces as a "guest" Domain in the sidebar.
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      notifyDomainsChanged();
    } catch (e) {
      console.error('Failed to join domain', e);
      setError(t('Could not join. You may not have access to it.'));
    }
  };

  const joinObject = async (objectId: string) => {
    if (!user) return;
    setError(null);
    try {
      await joinObjectRow(user.id, objectId);
      setObjects((prev) => prev.filter((o) => o.id !== objectId));
    } catch (e) {
      console.error('Failed to join object', e);
      setError(t('Could not join. You may not have access to it.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold">{t('Discover')}</DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setTab('domains')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'domains'
                ? 'text-foreground border-b-2 border-foreground -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('Domains')} ({domains.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('objects')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'objects'
                ? 'text-foreground border-b-2 border-foreground -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('Objects')} ({objects.length})
          </button>
        </div>

        {error && <p role="alert" className="px-4 pt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-border/40">
          {loading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">{t('Loading…')}</div>
          ) : tab === 'domains' ? (
            domains.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Nothing left to discover — you&apos;re in every Domain.
              </div>
            ) : (
              domains.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-md flex items-center justify-center bg-muted text-foreground/70 shrink-0"
                    style={
                      d.color ? { backgroundColor: d.color, color: 'white' } : undefined
                    }
                  >
                    <DomainIcon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {d.name}
                    </div>
                    {d.description && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {d.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => joinDomain(d.id)}
                    className="px-2.5 py-1 text-[12px] bg-foreground text-background rounded hover:opacity-90 transition-opacity shrink-0"
                  >
                    Join
                  </button>
                </div>
              ))
            )
          ) : objects.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No Objects to join.
            </div>
          ) : (
            objects.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-muted text-foreground/70 shrink-0">
                  <ObjectIcon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">
                    {o.name}
                  </div>
                  {o.domain_name && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      in {o.domain_name}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => joinObject(o.id)}
                  className="px-2.5 py-1 text-[12px] bg-foreground text-background rounded hover:opacity-90 transition-opacity shrink-0"
                >
                  Join
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
