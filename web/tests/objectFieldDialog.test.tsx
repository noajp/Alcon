// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ObjectFieldDialog } from '@/Function/property/ObjectFieldDialog';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
afterEach(cleanup);

describe('Object field editor', () => {
  it('keeps the draft on a failed save and supports retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(<ObjectFieldDialog onSave={onSave} onClose={close} />);
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Supplier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Field name') as HTMLInputElement).value).toBe('Supplier');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledTimes(2);
  });
  it('does not submit when adding or reordering choices', () => {
    const save = vi.fn();
    render(<ObjectFieldDialog onSave={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Field type'), { target: { value: 'multi_select' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Shipped' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move option 2 up' }));
    expect((screen.getByLabelText('Option 1') as HTMLInputElement).value).toBe('Shipped');
    expect(save).not.toHaveBeenCalled();
  });
  it('requires the field name before destructive deletion', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const field = { id: 'f', name: 'Value', column_type: 'number', options: {} } as CustomColumnWithValues;
    render(<ObjectFieldDialog column={field} onSave={vi.fn()} onClose={vi.fn()} onDelete={remove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    expect((screen.getByRole('button', { name: 'Delete field' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirm field name'), { target: { value: 'Value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });
});
