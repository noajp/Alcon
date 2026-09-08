// Built-in column type definitions

export interface BuiltInColumn {
  id: string;
  name: string;
  type: 'builtin';
  builtinType: 'assignees' | 'priority' | 'status' | 'due_date';
  width: number;
  isVisible: boolean;
  options?: { value: string; color?: string }[];
}

export const DEFAULT_BUILTIN_COLUMNS: BuiltInColumn[] = [
  {
    id: 'builtin_assignees',
    name: 'Assignees',
    type: 'builtin',
    builtinType: 'assignees',
    width: 96,
    isVisible: true,
  },
  {
    id: 'builtin_priority',
    name: 'Priority',
    type: 'builtin',
    builtinType: 'priority',
    width: 80,
    isVisible: true,
    options: [
      { value: 'low', color: '#eff6ff' },
      { value: 'medium', color: '#f0fdf4' },
      { value: 'high', color: '#fef2f2' },
      { value: 'urgent', color: '#fef2f2' },
    ],
  },
  {
    id: 'builtin_status',
    name: 'Status',
    type: 'builtin',
    builtinType: 'status',
    width: 112,
    isVisible: true,
    options: [
      { value: 'todo', color: '#f5f5f5' },
      { value: 'in_progress', color: '#fef3c7' },
      { value: 'review', color: '#e0e7ff' },
      { value: 'done', color: '#f0fdf4' },
      { value: 'blocked', color: '#fef2f2' },
    ],
  },
  {
    id: 'builtin_due_date',
    name: 'Due date',
    type: 'builtin',
    builtinType: 'due_date',
    width: 112,
    isVisible: true,
  },
];
