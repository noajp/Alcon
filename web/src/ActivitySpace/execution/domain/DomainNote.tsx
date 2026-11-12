'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { DescriptionEditor } from '@/Function/shared/DescriptionEditor';
import { PAGE_FRAME } from '@/Function/shared/PageHead';
import { updateDomain, useDomainRole, useDomains } from '@/hooks/domainData';

// The Domain's Note: one shared page of long-form text — how the Domain
// works, what it has agreed, where things are. Everyone who can see the
// Domain reads it; its members write it. Saved as Markdown on the Domain.

export function DomainNote({ domainId }: { domainId: string | null }) {
  const { t } = useI18n();
  const { data: domains, guestDomains } = useDomains();
  const { data: role } = useDomainRole(domainId);
  const domain = domainId ? [...(domains ?? []), ...(guestDomains ?? [])].find((d) => d.id === domainId) ?? null : null;
  if (!domain) return null;
  const canWrite = role === 'owner' || role === 'admin' || role === 'member';

  return (
    <div className="flex-1 overflow-auto">
      <div className={`${PAGE_FRAME} max-w-4xl`}>
        <DescriptionEditor
          key={domain.id}
          value={domain.note ?? ''}
          readOnly={!canWrite}
          placeholder={t('Write the Domain’s note…')}
          emptyText={t('No note yet.')}
          onSave={async (markdown) => { await updateDomain(domain.id, { note: markdown || null }); }}
        />
      </div>
    </div>
  );
}
