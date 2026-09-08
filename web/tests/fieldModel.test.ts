import { describe, expect, it } from 'vitest';
import { fieldValueText, formatFieldNumber, validateField } from '@/Function/property/fieldModel';
describe('Object custom fields', () => {
  it('renames and retires options without changing stored values', () => {
    expect(fieldValueText(['legacy', 'unknown'], { options: [{ value: 'legacy', label: 'Qualified', archived: true }] })).toBe('Qualified, unknown');
  });
  it('requires unique, named active choices', () => {
    expect(validateField({ name: 'Stage', type: 'select', options: { options: [{ value: 'a', label: 'New' }, { value: 'b', label: ' new ' }] } })).toContain('unique');
    expect(validateField({ name: 'Stage', type: 'select', options: {} })).toContain('at least');
    expect(validateField({ name: 'Stage', type: 'select', options: { options: [{ value: 'a', label: 'New' }] } })).toBeNull();
  });
  it('formats precision without modifying the underlying number', () => {
    const value = 1234.567;
    expect(formatFieldNumber(value, { decimals: 0 })).toBe('1,235');
    expect(formatFieldNumber(value, { decimals: 3 })).toBe('1,234.567');
    expect(value).toBe(1234.567);
    expect(formatFieldNumber(25, { format: 'percent', decimals: 0 })).toBe('25%');
    expect(formatFieldNumber(null)).toBe('');
    expect(formatFieldNumber('not a number')).toBe('');
  });
});
