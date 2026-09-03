'use client';

import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { fetchAllWorkers, type Worker } from '@/hooks/useSupabase';
import { ReachHint, WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import { NavTeamsIcon } from '@/shell/sidebar/NavIcons';

// =============================================================
// TeamView — the Sustainment layer's "Team" surface. UI-only for now:
// a read-only roster of the Space's Workers, split into Members (humans)
// and AI Agents. No invite / edit here yet — membership management still
// lives in Settings → Team.
// =============================================================

function statusDot(status: Worker['status']): string {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'busy') return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

function WorkerRow({ worker }: { worker: Worker }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors">
      <div className="relative shrink-0">
        <WorkerAvatar worker={worker} size={28} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card ${statusDot(worker.status)}`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-[550] text-foreground truncate">{worker.name}</span>
          {worker.type === 'ai_agent' && (
            <Bot size={12} className="text-muted-foreground shrink-0" />
          )}
        </div>
        {(worker.role || worker.email) && (
          <div className="text-[11px] text-muted-foreground truncate">
            {worker.role ?? worker.email}
          </div>
        )}
      </div>
      {worker.type === 'ai_agent' && worker.ai_model && (
        <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
          {worker.ai_model}
        </span>
      )}
      {/* The roster is where a Worker's contact facts live, so this is where
          "there is no account behind this person" is said in words. */}
      <ReachHint worker={worker} />
    </div>
  );
}

function RosterSection({ title, workers }: { title: string; workers: Worker[] }) {
  if (workers.length === 0) return null;
  return (
    <section>
      <h2 className="text-[13px] font-medium text-foreground/90 mb-2">
        {title} <span className="text-muted-foreground/60">{workers.length}</span>
      </h2>
      <div className="rounded-lg border border-border/60 divide-y divide-border/60 overflow-hidden bg-card">
        {workers.map((w) => (
          <WorkerRow key={w.id} worker={w} />
        ))}
      </div>
    </section>
  );
}

export function TeamView() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllWorkers()
      .then(setWorkers)
      .catch((e) => console.error('Failed to load workers', e))
      .finally(() => setLoading(false));
  }, []);

  const humans = workers.filter((w) => w.type === 'human');
  const agents = workers.filter((w) => w.type !== 'human');

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavTeamsIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Team</span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          {loading ? null : workers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center pt-16 gap-3">
              <NavTeamsIcon size={28} />
              <p className="text-[13px] text-muted-foreground max-w-md">
                No Workers in this Space yet. Invite people or add AI agents from Settings.
              </p>
            </div>
          ) : (
            <>
              <RosterSection title="Members" workers={humans} />
              <RosterSection title="AI Agents" workers={agents} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
