'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { ChoiceCard } from '@/ui/choice-card';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { createDomain } from '@/hooks/useSupabase';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { suggestObjectPrefix } from '@/Function/shared/objectPrefix';
import { Globe, Lock } from '@/ui/icons';
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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('Failed to create Domain'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-2xl mx-auto px-10 py-12">
        <div className="mb-10">
          <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <DomainIcon size={18} />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-1.5">{t('Create Domain')}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('A Domain is where work happens — a hospital, a company, a department. Inside it, Objects (the projects that hold Elements) and Elements (actions) live, and an Object can belong to several Domains.')}
          </p>
        </div>

        <div className="space-y-7">
          <Field label={t('Domain name')} hint={t('Choose a name your team will immediately recognise.')}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('e.g. Clayware Dev, Marketing, Ward 1')}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
            />
          </Field>

          <Field label={t('Identifier')} hint={t('Used as a prefix for Object and Element IDs (e.g. MKT-001). Auto-generated from the name.')}>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder={t('e.g. MKT')}
            />
          </Field>

          <Field label={t('Privacy')} hint={t('Control who can find and access this Domain.')}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <PrivacyOption icon={<Globe size={14} />} title={t('Workspace')} desc={t('Anyone in the Space can find and access.')} checked={privacy === 'workspace'} onClick={() => setPrivacy('workspace')} />
              <PrivacyOption icon={<Lock size={14} />} title={t('Private')} desc={t('Only invited members can find and access.')} checked={privacy === 'private'} onClick={() => setPrivacy('private')} />
            </div>
          </Field>
        </div>

        {error && <p className="mt-6 text-[12px] text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2 mt-10">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={creating}>{t('Cancel')}</Button>
          <Button variant="primary" size="md" onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? t('Creating…') : t('Create Domain')}
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

// Privacy is a choice between two described options — the shared ChoiceCard:
// a thin outline, and the chosen one marked by the accent tint and a check.
function PrivacyOption({
  icon, title, desc, checked, onClick,
}: { icon: ReactNode; title: string; desc: string; checked: boolean; onClick: () => void }) {
  return (
    <ChoiceCard selected={checked} label={title} onClick={onClick} className="gap-1">
      <span className="flex items-start gap-2 text-xs font-normal text-muted-foreground">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0">{desc}</span>
      </span>
    </ChoiceCard>
  );
}
