'use client';

import { useMemo } from 'react';
import type { ElementWithDetails } from '@/types/database';

interface Props {
  elements: ElementWithDetails[];
}

interface MemberStats {
  id: string;
  name: string;
  role: string | null;
  type: string;
  total: number;
  done: number;
  active: number;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}

function avatarColor(seed: string): string {
  const palette = [
    'bg-rose-100 text-rose-700',
    'bg-amber-100 text-amber-700',
    'bg-emerald-100 text-emerald-700',
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
    'bg-pink-100 text-pink-700',
    'bg-cyan-100 text-cyan-700',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function TeamRosterWidget({ elements }: Props) {
  const members = useMemo(() => {
    const map = new Map<string, MemberStats>();
    for (const el of elements) {
      const assignees = el.assignees || [];
      for (const a of assignees) {
        if (!a.worker) continue;
        const w = a.worker;
        if (!map.has(w.id)) {
          map.set(w.id, {
            id: w.id,
            name: w.name,
            role: w.role,
            type: w.type,
            total: 0,
            done: 0,
            active: 0,
          });
        }
        const m = map.get(w.id)!;
        m.total += 1;
        if (el.status === 'done') m.done += 1;
        else if (el.status === 'in_progress') m.active += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [elements]);

  if (members.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">No team members assigned</div>
    );
  }

  return (
    <div className="space-y-2 max-h-[280px] overflow-y-auto -mx-2 px-2">
      {members.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors"
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${avatarColor(
              m.name,
            )}`}
          >
            {initials(m.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-foreground truncate">{m.name}</span>
              {m.type === 'ai_agent' && (
                <span className="text-[9px] font-medium uppercase tracking-wider px-1 py-px rounded bg-violet-50 text-violet-600">
                  AI
                </span>
              )}
            </div>
            {m.role && (
              <p className="text-[11px] text-muted-foreground truncate">{m.role}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[12px] font-medium text-foreground tabular-nums">
              {m.done}/{m.total}
            </div>
            {m.active > 0 && (
              <div className="text-[10px] text-amber-600 tabular-nums">{m.active} active</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
