'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, UserMinus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useEscapeLayer } from '@/Function/shared/keyboard';

// "Who has access to this Object" panel — backs the Object-detail Members
// tab (rendered when tab_type === 'workers' so we don't need a schema/enum
// migration to introduce the tab type). Lists object_members + their worker
// info, lets the current user add domain_members that aren't here yet, and
// remove anyone except themselves.

interface ObjectMemberRow {
  id: string;
  user_id: string;
  role: string;
  worker?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
}

interface DomainCandidate {
  user_id: string;
  worker_id: string | null;
  name: string;
  avatar_url: string | null;
}

interface ObjectMembersPanelProps {
  objectId: string;
  domainId: string | null;
}

export function ObjectMembersPanel({ objectId, domainId }: ObjectMembersPanelProps) {
  const { user } = useAuthContext();
  const [members, setMembers] = useState<ObjectMemberRow[]>([]);
  const [candidates, setCandidates] = useState<DomainCandidate[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeLayer(showAdd, () => setShowAdd(false));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Members of this Object.
      const { data: memberRows } = await supabase
        .from('object_members')
        .select('id, user_id, role')
        .eq('object_id', objectId)
        .order('created_at');
      const memberUserIds = (memberRows ?? []).map((r) => r.user_id);

      // 2. Worker info for those users (name + avatar). One worker per user
      // is the norm (via ensureSelfWorker); if multiple exist we just pick
      // the first.
      const workerByUserId = new Map<string, { id: string; name: string; avatar_url: string | null }>();
      if (memberUserIds.length > 0) {
        const { data: workers } = await supabase
          .from('workers')
          .select('id, name, avatar_url, user_id')
          .in('user_id', memberUserIds);
        for (const w of workers ?? []) {
          if (w.user_id && !workerByUserId.has(w.user_id)) {
            workerByUserId.set(w.user_id, { id: w.id, name: w.name, avatar_url: w.avatar_url });
          }
        }
      }
      setMembers(
        (memberRows ?? []).map((m) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          worker: workerByUserId.get(m.user_id),
        })),
      );

      // 3. Candidates — Domain members who aren't yet Object members. Drives
      // the Add picker; constraint enforced at the UI level (object_members ⊆
      // domain_members).
      if (domainId) {
        const { data: domMembers } = await supabase
          .from('domain_members')
          .select('user_id')
          .eq('domain_id', domainId);
        const objMemberSet = new Set(memberUserIds);
        const candidateUserIds = (domMembers ?? [])
          .map((r) => r.user_id)
          .filter((uid) => !objMemberSet.has(uid));

        if (candidateUserIds.length > 0) {
          const { data: candWorkers } = await supabase
            .from('workers')
            .select('id, name, avatar_url, user_id')
            .in('user_id', candidateUserIds);
          const byUid = new Map<string, { id: string; name: string; avatar_url: string | null }>();
          for (const w of candWorkers ?? []) {
            if (w.user_id) byUid.set(w.user_id, { id: w.id, name: w.name, avatar_url: w.avatar_url });
          }
          setCandidates(
            candidateUserIds.map((uid) => {
              const w = byUid.get(uid);
              return {
                user_id: uid,
                worker_id: w?.id ?? null,
                name: w?.name ?? 'Member',
                avatar_url: w?.avatar_url ?? null,
              };
            }),
          );
        } else {
          setCandidates([]);
        }
      } else {
        setCandidates([]);
      }
    } finally {
      setLoading(false);
    }
  }, [objectId, domainId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = async (userId: string) => {
    try {
      await supabase.from('object_members').insert({
        object_id: objectId,
        user_id: userId,
        role: 'member',
      });
      setShowAdd(false);
      await refresh();
    } catch (e) {
      console.error('Failed to add object member', e);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this member from the Object?')) return;
    try {
      await supabase.from('object_members').delete().eq('id', memberId);
      await refresh();
    } catch (e) {
      console.error('Failed to remove object member', e);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-card p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Members ({members.length})
            </h2>
            <p className="text-[12px] text-muted-foreground">
              People with access to this Object. Pulled from the Domain&apos;s members.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={!domainId}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-foreground text-background rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Plus size={14} /> Add member
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-card divide-y divide-border/40">
            {members.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No members yet.
              </div>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <WorkerAvatar worker={m.worker ?? { name: 'Member' }} size={32} className="ring-border/70" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {m.worker?.name ?? 'Member'}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{m.role}</div>
                  </div>
                  {m.user_id !== user?.id && (
                    <button
                      type="button"
                      onClick={() => handleRemove(m.id)}
                      className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors"
                      title="Remove member"
                      aria-label="Remove member"
                    >
                      <UserMinus size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {showAdd && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
            onClick={() => setShowAdd(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-[14px] font-semibold">Add member</h3>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto divide-y divide-border/40">
                {candidates.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Every Domain member is already in this Object.
                  </div>
                ) : (
                  candidates.map((c) => (
                    <button
                      key={c.user_id}
                      type="button"
                      onClick={() => handleAdd(c.user_id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 text-left transition-colors"
                    >
                      <WorkerAvatar worker={c} size={32} className="ring-border/70" />
                      <span className="text-[13px] font-medium text-foreground">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
