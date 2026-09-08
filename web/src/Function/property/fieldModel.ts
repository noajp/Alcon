import type { CustomColumnOptions, CustomColumnType, Json, SelectOption } from '@/types/database';

export interface FieldDraft {
  name: string;
  type: CustomColumnType;
  options: CustomColumnOptions;
}

export const CHOICE_TYPES: CustomColumnType[] = ['select', 'multi_select', 'status'];
export const FIELD_COLORS = ['var(--text-secondary)', 'var(--accent-default)', 'var(--status-success)', 'var(--status-warning)', 'var(--status-danger)'];
export const optionLabel = (option: SelectOption) => option.label ?? option.value;

export function validateField(draft: FieldDraft): string | null {
  if (!draft.name.trim()) return 'Enter a field name.';
  if (CHOICE_TYPES.includes(draft.type)) {
    const labels = (draft.options.options ?? []).filter((o) => !o.archived).map((o) => optionLabel(o).trim().toLocaleLowerCase());
    if (!labels.length || labels.some((label) => !label)) return 'Add at least one named option.';
    if (new Set(labels).size !== labels.length) return 'Option names must be unique.';
  }
  return null;
}

export function formatFieldNumber(value: Json, options: CustomColumnOptions = {}): string {
  if (value == null || value === '') return '';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '';
  const decimals = Math.max(0, Math.min(6, options.decimals ?? 2));
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    ...(options.format === 'currency' ? { style: 'currency', currency: options.currency || 'JPY' } : {}),
  }).format(number);
  if (options.format === 'percent') return `${formatted}%`;
  if (options.format === 'custom' && options.unit) return `${formatted} ${options.unit}`;
  return formatted;
}

export function fieldValueText(value: Json, options: CustomColumnOptions = {}): string {
  const label = (v: string) => {
    const option = options.options?.find((o) => o.value === v);
    return option ? optionLabel(option) : v;
  };
  return Array.isArray(value) ? value.map((v) => label(String(v))).join(', ') : value == null ? '' : label(String(value));
}
