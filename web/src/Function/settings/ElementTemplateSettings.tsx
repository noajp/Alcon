'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { statusLabel } from '@/shared/designTokens';
import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Tag } from '@/ui/icons';
import {
  useDomains,
  useElementTemplates,
  createElementTemplate,
  updateElementTemplate,
  deleteElementTemplate,
} from '@/hooks/useSupabase';
import type { Domain, ElementTemplate, ElementStatus, ElementPriority } from '@/types/database';
import { PRIORITY_OPTIONS, STATUS_ORDER } from '@/shared/designTokens';
import { domainLabelNames, hydrateLabelColors, labelColor, useLabelColors } from '@/Function/shared/labelColor';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/dialog';
import { MenuShell } from '@/Function/shared/menu';
import { SettingRow, SettingsIsland } from './SettingsControls';
import { useI18n, translate } from '@/Function/i18n/I18nProvider';

// Settings > Elements > Templates (el_QLT-029). A saved Element shape,
// Domain-scoped, pickable from QuickAddElementPopup so a new Element can
// start from something other than "whatever the group I opened it from
// happened to have."



function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : translate("Couldn't save.");
}

export function ElementTemplateSettings() {
  const { t } = useI18n();
  const { data: domains, loading } = useDomains();
  useLabelColors();
  // The Template dialog's Labels field reads the same in-memory catalogue
  // ElementDetailView hydrates lazily per-Domain as Elements/Objects are
  // opened. A Domain a user hasn't touched any other way this session (came
  // straight here) would otherwise show zero label options with no
  // indication anything was hidden — seed every Domain on the page, the same
  // fix `useLabelCatalog.ts` applied for Settings > Elements > Labels.
  useEffect(() => {
    for (const d of domains) hydrateLabelColors(d.id, d.label_colors ?? {});
  }, [domains]);

  if (!loading && domains.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        {t('No Domains in this Space yet. Templates are set per Domain, so there is nothing to configure until one exists.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12px] text-muted-foreground -mt-2">
        {t('A saved Element shape, offered as a starting point from the “+” new-Element popup. Authoring one needs owner or admin access to the Domain.')}
      </p>
      {domains.map((domain) => (
        <DomainTemplates key={domain.id} domain={domain} />
      ))}
    </div>
  );
}

function DomainTemplates({ domain }: { domain: Domain }) {
  const { t } = useI18n();
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

  const handleDelete = async (tpl: ElementTemplate) => {
    if (!await appDialog.confirm(t('Delete the "{name}" template? This cannot be undone.', { name: tpl.name }))) return;
    setBusy(tpl.id, true);
    setRowError(null);
    try {
      await deleteElementTemplate(tpl.id);
      await refetch();
    } catch (e) {
      setRowError(messageOf(e));
    } finally {
      setBusy(tpl.id, false);
    }
  };

  return (
    <>
      <SettingsIsland
        title={domain.name}
        description={loading ? t('Loading…') : templates.length === 0 ? t('No templates yet') : templates.length === 1 ? t('1 template') : t('{n} templates', { n: templates.length })}
      >
        {templates.map((tpl) => (
          <SettingRow
            key={tpl.id}
            label={tpl.name}
            desc={[tpl.type, tpl.status ? t(statusLabel(tpl.status)) : null, tpl.priority ? t(PRIORITY_OPTIONS.find((p) => p.value === tpl.priority)?.label ?? tpl.priority) : null].filter(Boolean).join(' · ') || undefined}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={t('Actions for {name}', { name: tpl.name })} disabled={pending.has(tpl.id)}>
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <MenuShell as="dropdown" align="end">
                <DropdownMenuItem onSelect={() => setEditing(tpl)}>{t('Edit')}</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleDelete(tpl)}
                  className="text-[var(--status-danger)] focus:text-[var(--status-danger)]"
                >
                  {t('Delete')}
                </DropdownMenuItem>
              </MenuShell>
            </DropdownMenu>
          </SettingRow>
        ))}
        <div className="flex h-10 items-center px-5">
          <ButtonAppearanceProvider appearance="inline">
            <Button variant="ghost" size="sm" onClick={() => setEditing('new')}>
              <Plus size={14} />
              {t('New template')}
            </Button>
          </ButtonAppearanceProvider>
        </div>
        {(error || rowError) && (
          <div className="px-5 py-2 text-[11px] text-destructive">{error ?? rowError}</div>
        )}
      </SettingsIsland>
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
  const { t } = useI18n();
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
    if (!name) { setError(t('Give the template a name.')); return; }
    const hours = form.estimatedHours.trim();
    // Plain decimal digits only — `Number()` alone would also accept
    // scientific notation ("1e3") and other input that reads as a typo
    // rather than a considered estimate.
    if (hours !== '' && !/^\d+(\.\d+)?$/.test(hours)) {
      setError(t('Estimated hours must be a positive number.'));
      return;
    }
    const estimated_hours = hours === '' ? null : Number(hours);
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
          <DialogTitle>{template ? t('Edit template') : t('New template')}</DialogTitle>
          <DialogDescription>{t('In {domain}. Blank fields are left unset on the created Element.', { domain: domain.name })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label={t('Name')}>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('e.g. Bug report')}
              className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 outline-none focus:bg-muted/70"
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label={t('Type')}>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 outline-none focus:bg-muted/70"
              >
                <option value="">—</option>
                {(domain.element_types ?? []).map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label={t('Status')}>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ElementStatus | '' }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 outline-none focus:bg-muted/70"
              >
                <option value="">—</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(statusLabel(s))}</option>)}
              </select>
            </Field>
            <Field label={t('Priority')}>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ElementPriority | '' }))}
                className="w-full text-[13px] bg-muted/40 rounded-md px-2 py-1.5 border border-border/60 outline-none focus:bg-muted/70"
              >
                <option value="">—</option>
                {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
              </select>
            </Field>
          </div>

          {labelOptions.length > 0 && (
            <Field label={t('Labels')}>
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
                      <Tag aria-hidden size={10} className="shrink-0" style={{ color: labelColor(name, domain.id) }} />
                      {name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label={t('Description')}>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder={t('Prefilled into the Element on create')}
              className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 outline-none focus:bg-muted/70 resize-none"
            />
          </Field>

          <Field label={t('Estimated hours')} hint={t('Applied to the Element directly after creation')}>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={form.estimatedHours}
              onChange={(e) => setForm((f) => ({ ...f, estimatedHours: e.target.value }))}
              placeholder="—"
              className="w-24 text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 outline-none focus:bg-muted/70"
            />
          </Field>

          {error && <div className="text-[12px] text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" size="md" onClick={() => void submit()} disabled={saving}>
            {template ? t('Save') : t('Create')}
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
