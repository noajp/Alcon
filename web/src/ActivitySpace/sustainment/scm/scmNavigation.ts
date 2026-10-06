import type { ComponentType } from 'react';
import { AlertTriangle, Boxes, FlaskConical, LayoutDashboard, MapPin, ScrollText, Settings2, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import type { NavigationState } from '@/types/navigation';
import type { ScmData } from '@/hooks/useScm';
import type { ScmNode, ScmPlan } from './scmEngine';

/** The SCM App's panes — its views, shown as tabs. */
export type ScmView = 'tower' | 'exceptions' | 'replenish' | 'orders' | 'inventory' | 'locations' | 'ledger' | 'suppliers' | 'scenarios' | 'settings';

const SCM_VIEWS: readonly ScmView[] = ['tower', 'exceptions', 'replenish', 'orders', 'inventory', 'locations', 'ledger', 'suppliers', 'scenarios', 'settings'];

/** The scope overview's tabs: the tower, then the readings of the whole supply.
 *  Needs attention, Orders, Items, Suppliers and Locations are places of their
 *  own in the sidebar; settings is a dialog. */
export const ROOT_VIEWS: readonly ScmView[] = ['tower', 'replenish', 'ledger', 'scenarios'];

export const SCM_VIEW_LABEL: Record<ScmView, string> = {
  tower: 'Control tower', exceptions: 'Needs attention', locations: 'Locations', replenish: 'Replenishment', orders: 'Purchase orders',
  inventory: 'Inventory', ledger: 'Stock ledger', suppliers: 'Suppliers', scenarios: 'Scenarios', settings: 'Planning settings',
};

export function scmViewOf(navigation: NavigationState): ScmView {
  return SCM_VIEWS.includes(navigation.scmView as ScmView) ? navigation.scmView as ScmView : 'tower';
}

/** The panes' icons — the same on the tabs and anywhere a pane is named. */
export const SCM_VIEW_ICON: Record<ScmView, ComponentType<{ size?: number }>> = {
  tower: LayoutDashboard, locations: MapPin, exceptions: AlertTriangle, replenish: ShoppingCart, orders: Truck,
  inventory: Boxes, ledger: ScrollText, suppliers: Warehouse, scenarios: FlaskConical, settings: Settings2,
};

/** What each pane shows, in one line — under its tab and on the Overview. */
export const SCM_VIEW_DESCRIPTION: Record<ScmView, string> = {
  tower: 'What runs out, what to order, and what the autopilot did.',
  locations: 'Every location, with what it holds and what is at risk there.',
  exceptions: 'Orders awaiting approval, late orders, and items that run out — soonest first.',
  replenish: 'Orders the planner proposes, with the evidence for each line.',
  orders: 'Every purchase order, from draft to received.',
  inventory: 'Stock, demand and cover for every item at every location.',
  ledger: 'Every receipt, issue, transfer and adjustment, newest first.',
  suppliers: 'How each supplier really delivers.',
  scenarios: 'Change an assumption and see what breaks.',
  settings: 'The policy the planner works within, locations, and data.',
};

export interface ScmViewCounts {
  exceptions: number; urgent: number; replenish: number;
  orders: number; overdue: number; drafts: number;
  inventory: number; suppliers: number;
}

/** The counts that say whether a pane is worth opening, for the shown scope and location. */
export function scmViewCounts(data: ScmData, plan: ScmPlan, nodes: ScmNode[], locationId: string | null): ScmViewCounts {
  const orders = data.orders.filter(order => !locationId || order.locationId === locationId);
  const open = orders.filter(order => ['approved', 'sent', 'partial'].includes(order.status));
  return {
    exceptions: nodes.filter(node => ['stockout', 'critical', 'reorder'].includes(node.health) || node.arrivals.some(arrival => arrival.overdue)).length,
    urgent: nodes.filter(node => node.health === 'stockout' || node.health === 'critical').length,
    replenish: plan.proposals.filter(proposal => !locationId || proposal.locationId === locationId).length,
    orders: open.length,
    overdue: open.filter(order => order.expectedOn < data.today).length,
    drafts: orders.filter(order => order.status === 'draft').length,
    inventory: nodes.length,
    suppliers: data.suppliers.length,
  };
}
