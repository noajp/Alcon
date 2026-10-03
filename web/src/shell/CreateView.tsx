'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { createDomain } from '@/hooks/useSupabase';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { suggestObjectPrefix } from '@/ActivitySpace/execution/object/objectPrefix';
import { Globe, Lock } from 'lucide-react';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { useAuthContext } from '@/providers/AuthProvider';
import type { DomainPrivacy } from '@/types/database';

export type CreateType = 'domain';

export interface CreateResult {
  type: CreateType;
  id: string;
}

interface CreateViewProps {
  type: CreateType;
  onCancel: () => void;
  onCreated: (result: CreateResult) => void;
}

export function CreateView({ onCancel, onCreated }: CreateViewProps) {
  return <CreateDomainView onCancel={onCancel} onCreated={onCreated} />;
}

// ─── Create Domain ────────────────────────────────────────────────────────────

function CreateDomainView({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: CreateResult) => void }) {
  const { user } = useAuthContext();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [privacy, setPrivacy] = useState<DomainPrivacy>('workspace');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!identifier || identifier === deriveIdentifier(name)) {
      setIdentifier(deriveIdentifier(v));
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const domain = await createDomain({
        name: name.trim(),
        identifier: identifier.trim() || null,
        privacy,
        user_id: user?.id ?? '',
        // Land the new Domain in the active ActivitySpace so it shows up in the
        // space-scoped Domain list (else it'd have a null space and vanish).
        activity_space_id: getActiveSpaceId(),
      });
      onCreated({ type: 'domain', id: domain.id });
    } catch (err) {
      console.error('Failed to create domain:', err);
      setError(err instanceof Error ? err.message : 'Failed to create Domain');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-2xl mx-auto px-10 py-12">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-foreground mb-1.5">Create Domain</h1>
          <p className="text-sm text-muted-foreground">
            Set up a new execution space for your organisation, project, or initiative.
          </p>
        </div>

        <div className="mb-8">
          <div className="flex gap-4">
            <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-foreground/50">
              <DomainIcon size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground mb-2">Domain</p>
              <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>A top-level container representing an independent operational unit — a hospital, company, initiative, or project portfolio.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>Group Objects (departments, projects) and Elements (records, work units) under a Domain.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-foreground/40 mt-px shrink-0">—</span>
                  <span>Objects support multi-homing — they can belong to multiple Domains simultaneously.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

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
              <PrivacyOption icon={<Globe size={16} />} title="Workspace" desc="Anyone in the Space can find and access." checked={privacy === 'workspace'} onClick={() => setPrivacy('workspace')} />
              <PrivacyOption icon={<Lock size={16} />} title="Private" desc="Only invited members can find and access." checked={privacy === 'private'} onClick={() => setPrivacy('private')} />
            </div>
          </Field>
        </div>

        {error && <p className="mt-6 text-[12px] text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2 mt-10 pt-6 border-t border-border">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={creating}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? 'Creating...' : 'Create Domain'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Domain identifiers and Object prefixes are the same thing one level apart —
// the ASCII stem every display_id under them is built from — so they share a
// derivation. Domains allow six characters where Objects take four.
function deriveIdentifier(name: string): string {
  return suggestObjectPrefix(name, [], 6);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function PrivacyOption({
  icon, title, desc, checked, onClick,
}: { icon: ReactNode; title: string; desc: string; checked: boolean; onClick: () => void }) {
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
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <span className={`mt-1 w-3.5 h-3.5 rounded-full border ${checked ? 'border-foreground bg-foreground' : 'border-border'}`} />
    </button>
  );
}
