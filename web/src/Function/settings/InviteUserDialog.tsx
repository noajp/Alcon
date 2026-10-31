'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { inviteMember } from '@/Function/membership/invitations';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { Button } from '@/ui/button';
import type { InvitationRole } from '@/types/database';

// Search `profiles` by display_name and invite the picked user to a Domain
// (Guest path) or an ActivitySpace (full member), per `target`. A Domain
// invitation is as a member or as a viewer, who reads and changes nothing. The invitation
// grants nothing until they accept it from their Inbox (ADR 0029); accepting
// makes them a member, and the database then gives them their human Worker.
// Email-based invites for users who don't have an account yet are deferred to
// a later phase.

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** Where the invited user would join — a Domain (Guest path) or a Space (full member). */
export type InviteTarget =
  | { kind: 'domain'; domainId: string }
  | { kind: 'space'; spaceId: string };

interface InviteUserDialogProps {
  target: InviteTarget;
  /** User IDs already a member of the target — used to grey out / exclude them. */
  existingMemberIds: Set<string>;
  /** User IDs with a pending invitation to the target. */
  pendingInviteeIds?: Set<string>;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteUserDialog({
  target,
  existingMemberIds,
  pendingInviteeIds,
  onClose,
  onInvited,
}: InviteUserDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<InvitationRole>('member');

  useEscapeLayer(true, onClose);

  // Debounced search — 200 ms is enough to feel instant without spamming
  // Postgres on every keystroke.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const q = query.trim();
        const builder = supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .order('display_name', { ascending: true })
          .limit(20);
        const { data } = q
          ? await builder.ilike('display_name', `%${q}%`)
          : await builder;
        setResults((data ?? []) as ProfileRow[]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const handleInvite = async (profile: ProfileRow) => {
    setBusyId(profile.id);
    setError(null);
    try {
      await inviteMember(
        target.kind,
        target.kind === 'space' ? target.spaceId : target.domainId,
        profile.id,
        target.kind === 'domain' ? role : 'member',
      );
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('The invitation could not be sent. Try again.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card rounded-lg border border-border shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[14px] font-semibold text-foreground">
            {t(target.kind === 'space' ? 'Invite to Space' : 'Invite to Domain')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            aria-label={t('Close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <p className="mb-3 text-[12px] text-muted-foreground">
            {t('They join when they accept the invitation in their Inbox.')}
          </p>
          {target.kind === 'domain' && (
            <div className="mb-3">
              <div className="mb-1.5 text-[12px] font-medium text-foreground">{t('Invite as')}</div>
              <div className="grid grid-cols-2 gap-2">
                {(['member', 'viewer'] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    shape="tab"
                    variant={role === value ? 'secondary' : 'ghost'}
                    aria-pressed={role === value}
                    onClick={() => setRole(value)}
                    className="min-w-0 w-full truncate"
                  >
                    {t(value === 'member' ? 'Member' : 'Viewer')}
                  </Button>
                ))}
              </div>
              {role === 'viewer' && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t('Viewers read everything in this Domain and change nothing.')}
                </p>
              )}
            </div>
          )}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder={t('Search by display name…')}
              className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
            />
          </div>
          {error && <p className="mt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>

        <div className="max-h-[320px] overflow-y-auto mt-3">
          {loading ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">{t('Searching…')}</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              {t(query.trim() ? 'No users matched.' : 'Start typing to search users.')}
            </div>
          ) : (
            results.map((p) => {
              const isMember = existingMemberIds.has(p.id);
              const isInvited = !isMember && !!pendingInviteeIds?.has(p.id);
              const isBusy = busyId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isMember || isInvited || isBusy}
                  onClick={() => handleInvite(p)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
                >
                  <WorkerAvatar
                    worker={{ name: p.display_name, avatar_url: p.avatar_url }}
                    size={32}
                    className="ring-border/70"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {p.display_name || t('Unnamed')}
                    </div>
                    {isMember && (
                      <div className="text-[11px] text-muted-foreground">{t('Already a member')}</div>
                    )}
                  </div>
                  {!isMember && (
                    <span className="text-[12px] text-muted-foreground">
                      {t(isInvited ? 'Invited' : isBusy ? 'Inviting…' : 'Invite')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
