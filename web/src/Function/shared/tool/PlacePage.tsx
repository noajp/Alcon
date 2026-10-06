'use client';

import type { ComponentType, ReactNode } from 'react';

// A place in a tool's sidebar that is not a container with views of its own
// — CRM's Today, Companies and Contacts. One
// header naming it, then its content in the page column.

export function PlacePage({ icon: Icon, title, actions, children, container }: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  /** Header verbs at the right. */
  actions?: ReactNode;
  /** A container-query name for the content (e.g. "crm"), when its parts use one. */
  container?: string;
  children: ReactNode;
}) {
  return <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
    <header className="flex h-[50px] flex-shrink-0 items-center gap-1.5 border-b border-border/60 bg-card pl-4 pr-2">
      <Icon size={12} /><span className="text-[12px] font-semibold text-foreground">{title}</span>
      <div className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`${container ? `@container/${container} ` : ''}mx-auto w-full max-w-7xl px-8 py-6`}>{children}</div>
    </div>
  </div>;
}
