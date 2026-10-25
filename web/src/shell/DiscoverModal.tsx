'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ObjectIcon } from '@/shell/icons';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { notifyDomainsChanged } from '@/Function/space/domainsStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { onlyActiveObjects } from '@/Function/shared/objectArchive';

// "Things I haven't joined yet." Opens from the 🔍 in the ModeStrip and
// lists Domains / Objects whose member tables don't yet have a row for the
// current user. Joining writes a `role='member'` row, after which the item
// drops out of the list (and will appear in the sidebar once the sidebar
// fetch is scoped to memberships — that work is a follow-up).

interface DiscoverableDomain {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

interface DiscoverableObject {
  id: string;
  name: string;
  color: string | null;
  domain_id: string | null;
  domain_name: string | null;
}

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

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Domains the user is NOT a member of.
      const { data: myDomainRows } = await supabase
        .from('domain_members')
        .select('domain_id')
        .eq('user_id', user.id);
      const myDomainIds = new Set((myDomainRows ?? []).map((r) => r.domain_id));

      const { data: allDomains } = await supabase
        .from('domains')
        .select('id, name, color, description')
        .order('created_at');

      const unjoinedDomains: DiscoverableDomain[] = (allDomains ?? [])
        .filter((d) => !myDomainIds.has(d.id))
        .map((d) => ({
          id: d.id,
          name: d.name,
          color: d.color,
          description: d.description ?? null,
        }));
      setDomains(unjoinedDomains);

      // Objects the user is NOT a member of. Domain name is looked up
      // client-side to avoid relying on the FK-typed join.
      const domainNameById = new Map<string, string>(
        (allDomains ?? []).map((d) => [d.id, d.name]),
      );

      const { data: myObjectRows } = await supabase
        .from('object_members')
        .select('object_id')
        .eq('user_id', user.id);
      const myObjectIds = new Set((myObjectRows ?? []).map((r) => r.object_id));

      // Archived Objects are not offered to join.
      const { data: allObjects } = await onlyActiveObjects(supabase
        .from('objects')
        .select('id, name, color, domain_id'))
        .order('created_at');

      const unjoinedObjects: DiscoverableObject[] = (allObjects ?? [])
        .filter((o) => !myObjectIds.has(o.id))
        .map((o) => ({
          id: o.id,
          name: o.name,
          color: o.color,
          domain_id: o.domain_id,
          domain_name: o.domain_id ? domainNameById.get(o.domain_id) ?? null : null,
        }));
      setObjects(unjoinedObjects);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const joinDomain = async (domainId: string) => {
    if (!user) return;
    try {
      await supabase.from('domain_members').insert({
        domain_id: domainId,
        user_id: user.id,
        role: 'member',
      });
      // Domain access only — joining a Domain must NOT make you a member of its
      // ActivitySpace (that would expose the whole company). It surfaces as a
      // "guest" Domain in the sidebar instead.
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      notifyDomainsChanged();
    } catch (e) {
      console.error('Failed to join domain', e);
    }
  };

  const joinObject = async (objectId: string) => {
    if (!user) return;
    try {
      await supabase.from('object_members').insert({
        object_id: objectId,
        user_id: user.id,
        role: 'member',
      });
      setObjects((prev) => prev.filter((o) => o.id !== objectId));
    } catch (e) {
      console.error('Failed to join object', e);
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
