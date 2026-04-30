/**
 * Widget System Types
 */

export type WidgetSpan = 'half' | 'full';

export interface WidgetConfig {
  id: string;             // unique widget instance id (used for sortable)
  type: string;           // widget kind (e.g. 'kpi-cards', 'status-chart')
  span?: WidgetSpan;      // grid span; default 'half'
  title?: string;         // optional override; default from registry
}

export interface WidgetDefinition {
  type: string;
  label: string;
  description?: string;
  defaultSpan: WidgetSpan;
  // Available scopes: which views can use this widget
  scopes: ('home' | 'object-summary' | 'overview')[];
}
