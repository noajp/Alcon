/** @vitest-environment jsdom */
//
// QuickAdd is the only way to add an Element — the in-list add row was removed
// in favour of the section "+", which opens this popup. So the thing worth
// pinning down is that it does not close itself after every create, and that
// what it keeps between creates is exactly the batch's shared context.
//
// This is the first test in the suite that renders a component. It exists
// because the behaviour it covers cannot be checked any other way: tsc and
// design-lint both pass on a version of this popup that closes on every Enter.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAddElementPopup } from '@/ActivitySpace/execution/element/QuickAddElementPopup';

// The Type pill's icons are read from the Domains; this test has none.
vi.mock('@/Function/shared/elementTypeIcon', () => ({ useTypeIcons: () => new Map(), TypeMark: () => null }));

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof QuickAddElementPopup>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <QuickAddElementPopup
      open
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  const title = screen.getByPlaceholderText(/Element title/i) as HTMLTextAreaElement;
  const description = screen.getByPlaceholderText(/Add description/i) as HTMLTextAreaElement;
  return { onSubmit, onClose, title, description };
}

async function createWith(title: HTMLTextAreaElement, text: string, modifiers: object = {}) {
  fireEvent.change(title, { target: { value: text } });
  fireEvent.keyDown(title, { key: 'Enter', ...modifiers });
  // handleSubmit awaits onSubmit before touching state.
  await vi.waitFor(() => undefined);
}

describe('QuickAdd continuous create', () => {
  it('stays open after Enter and clears only the title', async () => {
    const { onSubmit, onClose, title, description } = setup();
    fireEvent.change(description, { target: { value: 'shared context' } });

    await createWith(title, 'first');

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      expect.objectContaining({ title: 'first', description: 'shared context' }),
    ]);

    // The point of the whole change: the popup is still here.
    expect(onClose).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(title.value).toBe(''));
    // ...and the second Element inherits the setup done for the first.
    expect(description.value).toBe('shared context');
  });

  it('carries the description into the next create', async () => {
    const { onSubmit, onClose, title, description } = setup();
    fireEvent.change(description, { target: { value: 'shared context' } });

    await createWith(title, 'first');
    await vi.waitFor(() => expect(title.value).toBe(''));
    await createWith(title, 'second');

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toEqual([
      expect.objectContaining({ title: 'second', description: 'shared context' }),
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cmd+Enter, the way out for wanting only one', async () => {
    const { onSubmit, onClose, title } = setup();

    await createWith(title, 'just the one', { metaKey: true });

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Ctrl+Enter too, for people not on a Mac', async () => {
    const { onClose, title } = setup();

    await createWith(title, 'just the one', { ctrlKey: true });

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('reports what the sitting has produced', async () => {
    const { title } = setup();

    expect(screen.queryByText(/added/)).toBeNull();

    await createWith(title, 'first');
    await vi.waitFor(() => expect(screen.getByText('1 added')).toBeTruthy());

    await createWith(title, 'second');
    await vi.waitFor(() => expect(screen.getByText('2 added')).toBeTruthy());
  });

  it('counts every line of a multi-line paste', async () => {
    const { onSubmit, title } = setup();

    await createWith(title, 'one\ntwo\nthree');

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveLength(3);
    await vi.waitFor(() => expect(screen.getByText('3 added')).toBeTruthy());
  });

  it('does not fire a second create while the first is still in flight', async () => {
    let release: () => void = () => {};
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = () => resolve(); }),
    );
    render(<QuickAddElementPopup open onClose={vi.fn()} onSubmit={onSubmit} />);
    const title = screen.getByPlaceholderText(/Element title/i);

    fireEvent.change(title, { target: { value: 'leaning on Enter' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });

  it('claims nothing and keeps the text when the create fails', async () => {
    // The counter is the only evidence the user gets that a create landed,
    // now that the popup no longer closes to say so. It must not fire on a
    // rejected submit, and the typed title has to survive so the attempt is
    // not silently lost.
    const onSubmit = vi.fn().mockRejectedValue(new Error('insert failed'));
    const onClose = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<QuickAddElementPopup open onClose={onClose} onSubmit={onSubmit} />);
    const title = screen.getByPlaceholderText(/Element title/i) as HTMLTextAreaElement;

    await createWith(title, 'this one will not land');

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/added/)).toBeNull();
    expect(title.value).toBe('this one will not land');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is open', async () => {
    const { onSubmit, title } = setup();

    fireEvent.change(title, { target: { value: 'にほんご' } });
    fireEvent.keyDown(title, { key: 'Enter', isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
