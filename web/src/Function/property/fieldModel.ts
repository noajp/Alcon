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

/** English words that mean something else elsewhere in the product ("Lead" is
 *  a CRM lead, "Title" a job title) are translated through a context key; in
 *  English, or when the key has no translation, the plain label stays. */
const FIELD_CONTEXT_KEYS: Record<string, string> = {
  lead: 'Lead (Object owner)',
  title: 'Title (Element name)',
};

/** Display name of a field: a Property keeps the name its author gave it; a
 *  built-in field's English label is translated. */
export function fieldDisplayLabel(
  t: (message: string) => string,
  field: { id: string; label: string; kind?: string },
): string {
  if (field.kind === 'custom') return field.label;
  const contextKey = FIELD_CONTEXT_KEYS[field.id];
  if (contextKey) {
    const translated = t(contextKey);
    if (translated !== contextKey) return translated;
    return field.label;
  }
  return t(field.label);
}
