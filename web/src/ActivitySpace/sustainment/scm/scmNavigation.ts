import type { NavigationState } from '@/types/navigation';

/** The SCM App's panes. The sidebar lists them; the main pane shows one. */
export type ScmView = 'tower' | 'exceptions' | 'replenish' | 'orders' | 'inventory' | 'suppliers' | 'scenarios' | 'settings';

const SCM_VIEWS: readonly ScmView[] = ['tower', 'exceptions', 'replenish', 'orders', 'inventory', 'suppliers', 'scenarios', 'settings'];

export const SCM_VIEW_LABEL: Record<ScmView, string> = {
  tower: 'Control tower', exceptions: 'Exceptions', replenish: 'Replenishment', orders: 'Purchase orders',
  inventory: 'Inventory', suppliers: 'Suppliers', scenarios: 'Scenarios', settings: 'Planning settings',
};

export function scmViewOf(navigation: NavigationState): ScmView {
  return SCM_VIEWS.includes(navigation.scmView as ScmView) ? navigation.scmView as ScmView : 'tower';
}
