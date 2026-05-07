'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createWorker, deleteWorker, updateWorker } from '@/hooks/useSupabase';
import type { Worker } from '@/types/database';
import { SettingsSection } from './SettingsSection';

const AVATAR_PALETTE = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
  'bg-indigo-100 text-indigo-700',
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function TeamSettings() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .order('type')
        .order('name');
      if (error) throw error;
      setWorkers((data ?? []) as Worker[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this team member? Their assignments will be cleared.')) return;
    try {
      await deleteWorker(id);
      setWorkers((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  const handleStatusToggle = async (w: Worker) => {
    const next: Worker['status'] = w.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await updateWorker(w.id, { status: next });
      setWorkers((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    }
  };

  const humans = workers.filter((w) => w.type === 'human');
  const agents = workers.filter((w) => w.type !== 'human');

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Team</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Workers (human or AI) that can be assigned to Elements.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          Add member
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <SettingsSection title={`Humans (${humans.length})`}>
        {loading && humans.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading…</div>
        ) : humans.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No human members yet.</div>
        ) : (
          humans.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={() => handleDelete(w.id)}
              onToggleStatus={() => handleStatusToggle(w)}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={`AI agents (${agents.length})`}>
        {agents.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No AI agents yet.</div>
        ) : (
          agents.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={() => handleDelete(w.id)}
              onToggleStatus={() => handleStatusToggle(w)}
            />
          ))
        )}
      </SettingsSection>

      {showAdd && (
        <AddMemberDialog
          onClose={() => setShowAdd(false)}
          onCreated={(w) => {
            setWorkers((prev) => [...prev, w]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  onDelete,
  onToggleStatus,
}: {
  worker: Worker;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const isAi = worker.type !== 'human';
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${avatarColor(
          worker.name,
        )}`}
      >
        {initials(worker.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
          {isAi && (
            <span className="text-[9px] font-medium uppercase tracking-wider px-1 py-px rounded bg-violet-50 text-violet-600">
              AI
            </span>
          )}
          {worker.status === 'inactive' && (
            <span className="text-[9px] font-medium uppercase tracking-wider px-1 py-px rounded bg-muted text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {[worker.role, worker.email].filter(Boolean).join(' · ') || (isAi ? worker.ai_model || 'Agent' : 'No role')}
        </div>
      </div>
      <button
        onClick={onToggleStatus}
        className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        title={worker.status === 'active' ? 'Deactivate' : 'Reactivate'}
      >
        {worker.status === 'active' ? 'Deactivate' : 'Activate'}
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors"
        title="Remove"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function AddMemberDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (worker: Worker) => void;
}) {
  const [type, setType] = useState<'human' | 'ai_agent'>('human');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [aiModel, setAiModel] = useState('claude-opus-4-7');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createWorker({
        name: name.trim(),
        type,
        role: role.trim() || null,
        email: type === 'human' ? email.trim() || null : null,
        ai_model: type === 'ai_agent' ? aiModel.trim() || null : null,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add member');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[14px] font-semibold text-foreground">Add team member</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setType('human')}
                className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-colors ${
                  type === 'human'
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Human
              </button>
              <button
                onClick={() => setType('ai_agent')}
                className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-colors ${
                  type === 'ai_agent'
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                AI agent
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'human' ? 'e.g. Alex Chen' : 'e.g. Codex'}
              autoFocus
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={type === 'human' ? 'e.g. Frontend Engineer' : 'e.g. Code reviewer'}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
            />
          </div>

          {type === 'human' ? (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">
                Email <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">AI model</label>
              <input
                type="text"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="claude-opus-4-7"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-[12px] text-red-500">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}
