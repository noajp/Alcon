'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';

// Search `profiles` by display_name and add the picked user to
// `domain_members` for the current Domain. If they don't yet have a worker
// row, we create one too so they immediately appear in TeamSettings + the
// assignee picker. Email-based invites for users who don't have an account
// yet are deferred to a later phase.

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface InviteUserDialogProps {
  domainId: string;
  /** User IDs already in this Domain — used to grey out / exclude them. */
  existingMemberIds: Set<string>;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteUserDialog({
  domainId,
  existingMemberIds,
  onClose,
  onInvited,
}: InviteUserDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      // 1. Add to domain_members.
      const { error: memberErr } = await supabase.from('domain_members').insert({
        domain_id: domainId,
        user_id: profile.id,
        role: 'member',
      });
      if (memberErr) throw memberErr;

      // 2. Ensure they have a human Worker row so assignee pickers /
      // TeamSettings include them. ensureSelfWorker runs only on the
      // invitee's own login, so we have to mirror its behaviour here for
      // someone else.
      const { data: existingWorker } = await supabase
        .from('workers')
        .select('id')
        .eq('user_id', profile.id)
        .eq('type', 'human')
        .limit(1)
        .maybeSingle();
      if (!existingWorker) {
        await supabase.from('workers').insert({
          user_id: profile.id,
          type: 'human',
          name: profile.display_name || 'Member',
          avatar_url: profile.avatar_url ?? null,
          status: 'active',
        });
      }

      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite');
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
        className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[14px] font-semibold text-foreground">Invite a user</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pt-4">
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
              placeholder="Search by display name…"
              className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
            />
          </div>
          {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="max-h-[320px] overflow-y-auto divide-y divide-border/40 mt-3">
          {loading ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              {query.trim() ? 'No users matched.' : 'Start typing to search users.'}
            </div>
          ) : (
            results.map((p) => {
              const already = existingMemberIds.has(p.id);
              const isBusy = busyId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={already || isBusy}
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
                      {p.display_name || 'Unnamed'}
                    </div>
                    {already && (
                      <div className="text-[11px] text-muted-foreground">Already a member</div>
                    )}
                  </div>
                  {!already && (
                    <span className="text-[12px] text-muted-foreground">
                      {isBusy ? 'Inviting…' : 'Invite'}
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
