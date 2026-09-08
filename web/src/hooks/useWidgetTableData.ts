'use client';

// Widget placements and the Table app share the same query and write queue.
export { useTableData as useWidgetTableData } from '@/ActivitySpace/sustainment/table/useTableData';
export type { TableData as WidgetTableData } from '@/ActivitySpace/sustainment/table/useTableData';
