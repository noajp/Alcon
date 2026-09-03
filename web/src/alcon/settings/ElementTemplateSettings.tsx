'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import {
  useDomains,
  useElementTemplates,
  createElementTemplate,
  updateElementTemplate,
  deleteElementTemplate,
} from '@/hooks/useSupabase';
import type { Domain, ElementTemplate, ElementStatus, ElementPriority } from '@/types/database';
import { PRIORITY_OPTIONS } from '@/alcon/shared/PriorityPicker';
import { STATUS_OPTIONS as STATUS_VALUES } from '@/alcon/shared/listControls/types';
import { domainLabelNames, labelColor, useLabelColors } from '@/alcon/shared/labelColor';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/dialog';
import { MenuShell } from '@/alcon/shared/menu';
import { SettingsSection, SettingsRow } from './SettingsSection';

// Settings > Elements > Templates (el_QLT-029). A saved Element shape,
// Domain-scoped, pickable from QuickAddElementPopup so a new Element can
// start from something other than "whatever the group I opened it from
// happened to have."

const STATUS_LABEL: Record<ElementStatus, string> = {
  backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress',
  review: 'Review', done: 'Done', blocked: 'Blocked', cancelled: 'Cancelled',
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Couldn't save.";
}

export function ElementTemplateSettings() {
  const { data: domains, loading } = useDomains();

  if (!loading && domains.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No Domains in this Space yet. Templates are set per Domain, so there is nothing to configure until one exists.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground -mt-2">
        A saved Element shape, offered as a starting point from the &quot;+&quot; new-Element popup. Authoring one
        needs owner or admin access to the Domain.
      </p>
      {domains.map((domain) => (
        <DomainTemplates key={domain.id} domain={domain} />
      ))}
    </div>
  );
}

function DomainTemplates({ domain }: { domain: Domain }) {
  const { templates, loading, error, refetch } = useElementTemplates(domain.id);
  const [editing, setEditing] = useState<ElementTemplate | 'new' | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<string | null>(null);

  const setBusy = (id: string, busy: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleDelete = async (t: ElementTemplate) => {
    if (!window.confirm(`Delete the "${t.name}" template? This cannot be undone.`)) return;
    setBusy(t.id, true);
    setRowError(null);
    try {
      await deleteElementTemplate(t.id);
      await refetch();
    } catch (e) {
      setRowError(messageOf(e));
    } finally {
      setBusy(t.id, false);
    }
  };

  return (
    <>
      <SettingsSection
        title={domain.name}
        description={loading ? 'Loading…' : templates.length === 0 ? 'No templates yet' : `${templates.length} ${templates.length === 1 ? 'template' : 'templates'}`}
      >
        {templates.map((t) => (
          <SettingsRow
            key={t.id}
            label={t.name}
            hint={[t.type, t.status ? STATUS_LABEL[t.status] : null, t.priority].filter(Boolean).join(' · ') || undefined}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${t.name}`} disabled={pending.has(t.id)}>
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <MenuShell as="dropdown" align="end">
                <DropdownMenuItem onSelect={() => setEditing(t)}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleDelete(t)}
                  className="text-[var(--status-danger)] focus:text-[var(--status-danger)]"
                >
                  Delete
                </DropdownMenuItem>
              </MenuShell>
            </DropdownMenu>
          </SettingsRow>
        ))}
        <div className="flex h-10 items-center px-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} />
            New template
          </Button>
        </div>
      </SettingsSection>
      {(error || rowError) && (
        <div className="-mt-4 mb-4 px-1 text-[11px] text-destructive">{error ?? rowError}</div>
      )}
      {editing && (
        <TemplateDialog
          domain={domain}
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refetch(); }}
        />
      )}
    </>
  );
}

interface TemplateForm {
  name: string;
  type: string;
  status: ElementStatus | '';
  priority: ElementPriority | '';
  labels: Set<string>;
  description: string;
  estimatedHours: string;
}

function formOf(t: ElementTemplate | null): TemplateForm {
  return {
    name: t?.name ?? '',
    type: t?.type ?? '',
    status: t?.status ?? '',
    priority: t?.priority ?? '',
    labels: new Set(t?.labels ?? []),
    description: t?.description ?? '',
    estimatedHours: t?.estimated_hours != null ? String(t.estimated_hours) : '',
  };
}

function TemplateDialog({
  domain, template, onClose, onSaved,
}: {
  domain: Domain;
  template: ElementTemplate | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<TemplateForm>(() => formOf(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLabelColors();
  const labelOptions = useMemo(() => domainLabelNames(domain.id), [domain.id]);

  const toggleLabel = (name: string) => {
    setForm((f) => {
      const next = new Set(f.labels);
      if (next.has(name)) next.delete(name); else next.add(name);
      return { ...f, labels: next };
    });
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) { setError('Give the template a name.'); return; }
    const hours = form.estimatedHours.trim();
    const estimated_hours = hours === '' ? null : Number(hours);
    if (hours !== '' && (!Number.isFinite(estimated_hours) || estimated_hours! < 0)) {
      setError('Estimated hours must be a positive number.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name,
      type: form.type || null,
      status: form.status || null,
      priority: form.priority || null,
      labels: Array.from(form.labels),
      description: form.description.trim() || null,
      estimated_hours,
    };
    try {
      if (template) await updateElementTemplate(template.id, payload);
      else await createElementTemplate({ domain_id: domain.id, ...payload });
      await onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>In {domain.name}. Blank fields are left unset on the created Element.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Name">
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Bug report"
              className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 outline-none"
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 focus:outline-none"
              >
                <option value="">—</option>
                {(domain.element_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ElementStatus | '' }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 focus:outline-none"
              >
                <option value="">—</option>
                {STATUS_VALUES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ElementPriority | '' }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 focus:outline-none"
              >
                <option value="">—</option>
                {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </div>

          {labelOptions.length > 0 && (
            <Field label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {labelOptions.map((name) => {
                  const on = form.labels.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleLabel(name)}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] transition-colors ${
                        on ? 'bg-[var(--accent-subtle)] text-foreground' : 'bg-muted/40 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: labelColor(name, domain.id) }} />
                      {name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Prefilled into the Element on create"
              className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 outline-none resize-none"
            />
          </Field>

          <Field label="Estimated hours" hint="Applied to the Element directly after creation">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={form.estimatedHours}
              onChange={(e) => setForm((f) => ({ ...f, estimatedHours: e.target.value }))}
              placeholder="—"
              className="w-24 text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 outline-none"
            />
          </Field>

          {error && <div className="text-[12px] text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => void submit()} disabled={saving}>
            {template ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[12px] font-medium text-foreground">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
