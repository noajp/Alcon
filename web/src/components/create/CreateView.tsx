'use client';

import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { createObject } from '@/hooks/useSupabase';
import { addSystem, setActiveSystemId, useSystems } from '@/alcon/system/systemsStore';
import { Globe, Users, Lock } from 'lucide-react';
import { NavSystemIcon } from '@/layout/sidebar/NavIcons';

export type CreateType = 'system' | 'object';

export interface CreateResult {
  type: CreateType;
  id: string;
}

const COPY: Record<CreateType, { title: string; subtitle: string; namePlaceholder: string }> = {
  system: {
    title: 'Create System',
    subtitle: 'Systems are top-level containers (tenant). e.g. a hospital, company, or operation.',
    namePlaceholder: 'e.g. Marketing Q1',
  },
  object: {
    title: 'Create Object',
    subtitle: 'Objects are mid-level structural units. They can be nested and shared across multiple parents.',
    namePlaceholder: 'e.g. Website Redesign 2025',
  },
};

type Privacy = 'workspace' | 'team' | 'members';

interface CreateViewProps {
  type: CreateType;
  activeSystemId?: string | null;
  onCancel: () => void;
  onCreated: (result: CreateResult) => void;
}

export function CreateView({ type, activeSystemId, onCancel, onCreated }: CreateViewProps) {
  const copy = COPY[type];
  const systems = useSystems();
  const [name, setName] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState<string>(activeSystemId ?? systems[0]?.id ?? '');
  const [privacy, setPrivacy] = useState<Privacy>('workspace');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const handleCreate = async () => {
    if (!name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      if (type === 'system') {
        const sys = addSystem({ name: name.trim(), privacy });
        setActiveSystemId(sys.id);
        onCreated({ type: 'system', id: sys.id });
      } else {
        const obj = await createObject({ name: name.trim(), parent_object_id: null, system_id: selectedSystemId || null });
        onCreated({ type: 'object', id: obj.id });
      }
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
          <h1 className="text-2xl font-semibold text-foreground mb-1.5">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>

        <div className="space-y-7">
          <Field label="Name" hint="Use a clear name your team will recognize.">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
            />
          </Field>

          {type === 'object' && (
            <Field label="System" hint="The System this Object belongs to.">
              <div className="space-y-2">
                {systems.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSystemId(s.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
                      selectedSystemId === s.id ? 'border-foreground bg-accent/40' : 'border-border hover:bg-accent/30'
                    }`}
                  >
                    <span className={selectedSystemId === s.id ? 'text-foreground' : 'text-muted-foreground'}>
                      <NavSystemIcon size={15} />
                    </span>
                    <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>
                    <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${selectedSystemId === s.id ? 'border-foreground bg-foreground' : 'border-border'}`} />
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label="Privacy" hint="Who can find and access this.">
            <div className="space-y-2">
              <PrivacyOption
                icon={<Globe size={16} />}
                title="Workspace"
                desc="Anyone in the workspace can find and access."
                checked={privacy === 'workspace'}
                onClick={() => setPrivacy('workspace')}
              />
              <PrivacyOption
                icon={<Users size={16} />}
                title="Shared with team"
                desc="Anyone on the team can find and access."
                checked={privacy === 'team'}
                onClick={() => setPrivacy('team')}
              />
              <PrivacyOption
                icon={<Lock size={16} />}
                title="Members only"
                desc="Only added members can view this."
                checked={privacy === 'members'}
                onClick={() => setPrivacy('members')}
              />
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function PrivacyOption({
  icon, title, desc, checked, onClick,
}: { icon: React.ReactNode; title: string; desc: string; checked: boolean; onClick: () => void }) {
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
