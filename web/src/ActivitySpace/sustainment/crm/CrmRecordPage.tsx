'use client';

import type { ReactNode } from 'react';
import { ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { PageLayout } from '@/Function/shared/PageHead';
import { useEscapeLayer } from '@/Function/shared/keyboard/useEscapeLayer';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { CrmIcon } from '@/Function/shared/conceptIcons';

// A CRM record's page — a deal, a company, a contact — in the shape every
// record in Alcon opens on: a breadcrumb back to its container, the
// document on the left (PageHead, then what you can do), its facts on the
// right as islands. Escape goes back one level, as on an Element.

export function CrmRecordPage({ crumbs, actions, onBack, onDelete, deleteLabel, rail, children }: {
  /** The path above the record: [{ label: 'Sales', onClick }], the record's own name last. */
  crumbs: { label: string; onClick?: () => void }[];
  /** Header verbs at the right. */
  actions?: ReactNode;
  onBack: () => void;
  onDelete?: () => Promise<unknown>;
  deleteLabel?: string;
  rail: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape closes the page, except while typing — a draft is not thrown away.
  useEscapeLayer(true, () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return;
    onBack();
  });
  return <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
    <header className="flex h-[50px] flex-shrink-0 items-center gap-1 border-b border-border/60 bg-card pl-4 pr-2 text-[12px] font-semibold">
      <CrmIcon size={12} />
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return <span key={index} className="flex min-w-0 items-center gap-1">
          {index > 0 && <ChevronRight size={12} className="shrink-0 text-muted-foreground/40" />}
          {last || !crumb.onClick
            ? <span className={`truncate px-1.5 ${last ? 'max-w-[280px] text-foreground' : 'max-w-[160px] text-muted-foreground'}`}>{crumb.label}</span>
            : <button type="button" onClick={crumb.onClick} className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">{crumb.label}</button>}
        </span>;
      })}
      {onDelete && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('More')}><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
        <MenuShell as="dropdown" align="start">
          <DropdownMenuItem className="gap-2 text-[var(--status-danger)]" onSelect={() => setConfirm(true)}><Trash2 size={12} />{deleteLabel ?? t('Delete')}</DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>}
      <div className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
    {confirm && <div role="alertdialog" className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-[var(--status-danger-subtle)] px-4 py-2 text-xs">
      <span>{deleteLabel ?? t('Delete this record?')}</span>
      <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
      <Button size="xs" variant="danger" onClick={() => { setError(null); onDelete!().then(onBack).catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'))); }}>{t('Delete')}</Button>
      {error && <span role="alert" className="text-[var(--status-danger)]">{error}</span>}
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageLayout rail={rail}>{children}</PageLayout>
    </div>
  </div>;
}

/** A section of the record's document: a quiet heading, then its rows. */
export function RecordSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="space-y-2">
    <div className="flex h-7 items-center gap-2">
      <h2 className="text-[12px] font-medium text-muted-foreground">{title}</h2>
      {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
    </div>
    {children}
  </section>;
}
