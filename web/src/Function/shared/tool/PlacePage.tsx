'use client';

import type { ReactNode } from 'react';
import { IslandHeader, type IslandCrumb } from '@/Function/shared/MainIsland';

// A place in a tool's sidebar that is not a container with views of its own
// — CRM's Today, Companies and Contacts. One
// header naming it, then its content in the page column.

export function PlacePage({ parent, title, actions, children, container }: {
  /** Where the place sits (the CRM's scope), before its name in the path. */
  parent?: IslandCrumb;
  title: string;
  /** Header verbs at the right. */
  actions?: ReactNode;
  /** A container-query name for the content (e.g. "crm"), when its parts use one. */
  container?: string;
  children: ReactNode;
}) {
  return <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
    <IslandHeader crumbs={[...(parent ? [parent] : []), { id: 'place', label: title }]} actions={actions} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`${container ? `@container/${container} ` : ''}mx-auto w-full max-w-7xl px-8 py-6`}>{children}</div>
    </div>
  </div>;
}
