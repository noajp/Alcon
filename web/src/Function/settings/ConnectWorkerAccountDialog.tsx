'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { updateWorker } from '@/hooks/useSupabase';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import type { Worker } from '@/types/database';

// The other half of ELE_QLT-008's mark: an account-less human Worker
// (`workers.user_id IS NULL`) can be assigned and planned around while
// nothing reaches them. This is how an admin fixes that for an existing
// Worker — connect it to an account that already exists.
//
// Reuses InviteUserDialog's `profiles` search (same reason: this app has no
// email-invite / signup-acceptance path — see that file's own comment —
// so "connect to an account" can only mean "pick one that already signed
// up"), but writes differently: InviteUserDialog INSERTs a new membership
// row and a new Worker row for someone who has neither yet. This UPDATEs
// the *existing* Worker row's user_id in place — the Worker keeps its
// history (assignments, comments, display_id), it just stops being silent.
//
// workers_one_global_human_per_user (a partial unique index on
// (user_id) where type='human' and user_id is not null and object_id is
// null) can reject the write: if the picked account already logged in once
// before, ensureSelfWorker (useAuth.ts) already gave it its own global
// Worker row, and two global human Workers can't share one user_id. That
// collision surfaces as a plain 23505 from the UPDATE — reported here as a
// specific message rather than a raw constraint name, not resolved
// automatically (merging two Worker histories is its own decision, not a
// side effect of a connect action).

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ConnectWorkerAccountDialogProps {
  worker: Worker;
  onClose: () => void;
  onConnected: (updated: Worker) => void;
}

export function ConnectWorkerAccountDialog({
  worker,
  onClose,
  onConnected,
}: ConnectWorkerAccountDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEscapeLayer(true, onClose);

  // Debounced search — same 200ms as InviteUserDialog.
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

  const handleConnect = async (profile: ProfileRow) => {
    setBusyId(profile.id);
    setError(null);
    try {
      const updated = await updateWorker(worker.id, { user_id: profile.id });
      onConnected(updated);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setError(
        code === '23505'
          ? `${profile.display_name || 'That account'} is already connected to a different Worker.`
          : e instanceof Error
            ? e.message
            : 'Failed to connect',
      );
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
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">Connect to an account</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {worker.name} has no account — assignments and notifications don&apos;t reach them.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors shrink-0"
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
              const isBusy = busyId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  // Disabled while ANY row is connecting, not just this one —
                  // this Worker can only end up pointed at one account, so a
                  // second click on a different row before the first
                  // request resolves must not fire a second concurrent
                  // update racing the first.
                  disabled={busyId !== null}
                  onClick={() => handleConnect(p)}
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
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    {isBusy ? 'Connecting…' : 'Connect'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
