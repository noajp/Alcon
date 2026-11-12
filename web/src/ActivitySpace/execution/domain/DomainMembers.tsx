'use client';

import { useState } from 'react';
import { Settings } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { setActiveSettingsSection } from '@/Function/settings/settingsNav';
import { useDomainRole } from '@/hooks/domainData';
import { setDomainMemberRole, useDomainMembers, type DomainMemberRow } from '@/hooks/useDomainMembers';
import type { DomainMemberRole } from '@/types/database';

// The Domain's Member tab: who is in it. People first, each with their
// role; then the AI Workers the Domain can assign. Its owners and admins
// change a role in place (only an owner grants or removes ownership — the
// server refuses the rest); adding and removing people is Settings' work.

const ROLES: DomainMemberRole[] = ['owner', 'admin', 'member', 'viewer'];
const ROLE_LABEL: Record<DomainMemberRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export function DomainMembers({ domainId, onViewChange }: { domainId: string | null; onViewChange?: (view: string) => void }) {
  const { t } = useI18n();
  const { members, loading, error, refresh } = useDomainMembers(domainId);
  const { data: myRole } = useDomainRole(domainId);
  const canManage = myRole === 'owner' || myRole === 'admin';
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const changeRole = async (row: DomainMemberRow, role: DomainMemberRole) => {
    if (!domainId || !row.userId || role === row.role) return;
    setBusy(row.id); setProblem(null);
    try { await setDomainMemberRole(domainId, row.userId, role); refresh(); }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (loading) return <p role="status" className="px-6 py-4 text-[13px] text-muted-foreground">{t('Loading…')}</p>;
  if (error) return <p role="alert" className="px-6 py-4 text-[13px] text-[var(--status-danger)]">{error.message}</p>;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup><col /><col style={{ width: 280 }} /><col style={{ width: 180 }} /></colgroup>
        <thead>
          <tr className="text-left text-[12px] text-muted-foreground">
            <th className="px-6 py-2.5 font-normal">{t('Name')}</th>
            <th className="px-3 py-2.5 font-normal">{t('Email')}</th>
            <th className="px-3 py-2.5 font-normal">
              <span className="flex items-center justify-between gap-2">
                {t('Role')}
                {canManage && (
                  <Button variant="ghost" size="icon-xs" title={t('Manage members')} aria-label={t('Manage members')}
                    onClick={() => { setActiveSettingsSection('domain'); onViewChange?.('settings'); }}>
                    <Settings size={13} />
                  </Button>
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((row) => (
            <tr key={row.id} className="group">
              <td className="px-6 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <WorkerAvatar worker={row.worker ?? { name: row.name, avatar_url: row.avatarUrl }} size={26} />
                  <span className="min-w-0 truncate text-[14px] text-foreground">{row.name}</span>
                </span>
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{row.email ?? ''}</td>
              <td className="px-3 py-2">
                {row.kind === 'ai' ? <span className="text-muted-foreground">AI</span>
                  : canManage && row.role ? (
                    <select aria-label={t('Role')} value={row.role} disabled={busy === row.id}
                      onChange={(e) => void changeRole(row, e.target.value as DomainMemberRole)}
                      className="h-7 rounded-md bg-transparent px-1.5 text-[13px] text-foreground hover:bg-muted/50">
                      {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
                    </select>
                  ) : <span className="text-foreground">{row.role ? t(ROLE_LABEL[row.role]) : ''}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <p className="px-6 py-3 text-[13px] text-muted-foreground">{t('No members to show.')}</p>}
      {problem && <p role="alert" className="px-6 py-2 text-[12px] text-[var(--status-danger)]">{problem}</p>}
    </div>
  );
}
