'use client';

import { ObjectProperties } from '@/Function/shared/object/ObjectProperties';
import type { WidgetHost } from '../types';

/** The Object's Properties (ObjectProperties) as a board widget. */
export function ObjectPropertiesWidget({ host }: { host: WidgetHost }) {
  return (
    <ObjectProperties object={host.object} elements={host.elements} onRefresh={host.onRefresh}
      onOpenStrategy={(strategyId) => { host.onNavigate?.({ strategyId }); host.onViewChange?.('strategy'); }} />
  );
}
