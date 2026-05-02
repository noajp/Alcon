'use client';

import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { createObject } from '@/hooks/useSupabase';
import { addSystem, setActiveSystemId, useSystems } from '@/alcon/system/systemsStore';
import { Globe, Users, Lock, Check } from 'lucide-react';
import { NavSystemIcon } from '@/layout/sidebar/NavIcons';

export type CreateType = 'system' | 'object';

export interface CreateResult {
  type: CreateType;
  id: string;
}

type Privacy = 'workspace' | 'team' | 'members';

interface CreateViewProps {
  type: CreateType;
  activeSystemId?: string | null;
  onCancel: () => void;
  onCreated: (result: CreateResult) => void;
}

export function CreateView({ type, activeSystemId, onCancel, onCreated }: CreateViewProps) {
  if (type === 'system') {
    return <CreateDomainView onCancel={onCancel} onCreated={onCreated} />;
  }
  return <CreateObjectView activeSystemId={activeSystemId} onCancel={onCancel} onCreated={onCreated} />;
}

// ─── Create Domain ────────────────────────────────────────────────────────────

function CreateDomainView({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: CreateResult) => void }) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('workspace');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!identifier || identifier === deriveIdentifier(name)) {
      setIdentifier(deriveIdentifier(v));
    }
  };

  const handleCreate = () => {
    if (!name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const sys = addSystem({ name: name.trim(), privacy });
      setActiveSystemId(sys.id);
      onCreated({ type: 'system', id: sys.id });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-2xl mx-auto px-10 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-foreground mb-1.5">Create Domain</h1>
          <p className="text-sm text-muted-foreground">
            Set up a new execution space for your organisation, project, or initiative.
          </p>
        </div>

        {/* Domain description */}
        <div className="mb-8">
          <div className="flex gap-4">
            <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-foreground/50">
              <NavSystemIcon size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground mb-2">Domain</p>
              <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>A top-level container representing an independent operational unit — a hospital, company, campaign, or project portfolio.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>Nest Objects (departments, projects) and Elements (tasks, records) infinitely within a Domain.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>Objects support multi-homing — they can belong to multiple Domains simultaneously.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-6">
          <Field label="Domain name" hint="Choose a name your team will immediately recognise.">
            <Input
              autoFocus
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Alcon Dev, Marketing, Ward 1"
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
            />
          </Field>

          <Field label="Identifier" hint="Used as a prefix for Object and Element IDs (e.g. MKT-001). Auto-generated from the name.">
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="e.g. MKT"
            />
          </Field>

          <Field label="Privacy" hint="Control who can find and access this Domain.">
            <div className="space-y-2">
              <PrivacyOption icon={<Globe size={16} />} title="Workspace" desc="Anyone in the workspace can find and access." checked={privacy === 'workspace'} onClick={() => setPrivacy('workspace')} />
              <PrivacyOption icon={<Users size={16} />} title="Team only" desc="Only team members added to this Domain." checked={privacy === 'team'} onClick={() => setPrivacy('team')} />
              <PrivacyOption icon={<Lock size={16} />} title="Private" desc="Only invited members can view this." checked={privacy === 'members'} onClick={() => setPrivacy('members')} />
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-10 pt-6 border-t border-border">
          <Button variant="outline" onClick={onCancel} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? 'Creating...' : 'Create Domain'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function deriveIdentifier(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 6);
}

// ─── Create Object ────────────────────────────────────────────────────────────

function CreateObjectView({
  activeSystemId,
  onCancel,
  onCreated,
}: {
  activeSystemId?: string | null;
  onCancel: () => void;
  onCreated: (r: CreateResult) => void;
}) {
  const systems = useSystems();
  const [name, setName] = useState('');
  const [selectedDomainIds, setSelectedDomainIds] = useState<Set<string>>(
    () => new Set(activeSystemId ? [activeSystemId] : systems[0] ? [systems[0].id] : [])
  );
  const [privacy, setPrivacy] = useState<Privacy>('workspace');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const toggleDomain = (id: string) => {
    setSelectedDomainIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const primaryId = selectedDomainIds.has(activeSystemId ?? '')
        ? (activeSystemId ?? '')
        : [...selectedDomainIds][0] ?? null;
      const obj = await createObject({ name: name.trim(), parent_object_id: null, system_id: primaryId || null });
      onCreated({ type: 'object', id: obj.id });
    } catch (err) {
      console.error('Failed to create:', err);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-2xl mx-auto px-10 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-1.5">Create Object</h1>
          <p className="text-sm text-muted-foreground">Objects are mid-level structural units. They can be nested and shared across multiple parents.</p>
        </div>

        <div className="space-y-7">
          <Field label="Name" hint="Use a clear name your team will recognize.">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Website Redesign 2025"
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
            />
          </Field>

          <Field label="Domain" hint="Objects support multi-homing — they can belong to multiple Domains at once.">
            <div className="space-y-2">
              {systems.map((s) => {
                const checked = selectedDomainIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleDomain(s.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
                      checked ? 'border-foreground bg-accent/40' : 'border-border hover:bg-accent/30'
                    }`}
                  >
                    <span className={checked ? 'text-foreground' : 'text-muted-foreground'}>
                      <NavSystemIcon size={15} />
                    </span>
                    <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>
                    <span className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${
                      checked ? 'border-foreground bg-foreground' : 'border-border'
                    }`}>
                      {checked && <Check size={11} className="text-background" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Privacy" hint="Who can find and access this.">
            <div className="space-y-2">
              <PrivacyOption icon={<Globe size={16} />} title="Workspace" desc="Anyone in the workspace can find and access." checked={privacy === 'workspace'} onClick={() => setPrivacy('workspace')} />
              <PrivacyOption icon={<Users size={16} />} title="Shared with team" desc="Anyone on the team can find and access." checked={privacy === 'team'} onClick={() => setPrivacy('team')} />
              <PrivacyOption icon={<Lock size={16} />} title="Members only" desc="Only added members can view this." checked={privacy === 'members'} onClick={() => setPrivacy('members')} />
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-10 pt-6 border-t border-border">
          <Button variant="outline" onClick={onCancel} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function PrivacyOption({ icon, title, desc, checked, onClick }: {
  icon: React.ReactNode; title: string; desc: string; checked: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
        checked ? 'border-foreground bg-accent/40' : 'border-border hover:bg-accent/30'
      }`}
    >
      <span className={`mt-0.5 ${checked ? 'text-foreground' : 'text-muted-foreground'}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <span className={`mt-1 w-3.5 h-3.5 rounded-full border ${checked ? 'border-foreground bg-foreground' : 'border-border'}`} />
    </button>
  );
}
