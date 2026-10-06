'use client';

import type { ComponentProps } from 'react';
import { RecordPage } from '@/Function/shared/tool/RecordPage';
import { CrmIcon } from '@/Function/shared/conceptIcons';

/** A CRM record's page: the shared RecordPage under the CRM's icon. */
export function CrmRecordPage(props: Omit<ComponentProps<typeof RecordPage>, 'icon'>) {
  return <RecordPage icon={CrmIcon} {...props} />;
}

export { RecordSection } from '@/Function/shared/tool/RecordPage';
