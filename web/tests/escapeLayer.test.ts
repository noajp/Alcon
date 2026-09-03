/** @vitest-environment jsdom */
//
// Escape goes to one layer: the one that opened last. This is the rule every
// hand-rolled dialog, picker and detail view in alcon/ now shares instead of
// each owning a window listener, and it is worth pinning because the failure
// it replaces was silent — two listeners both fired, tsc and design-lint both
// passed, and the user watched a modal and the page under it close together.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchEscape, escapeLayerDepth, pushEscapeLayer } from '@/alcon/shared/keyboard';

const cleanups: Array<() => void> = [];
function open(onEscape: () => void, root?: () => Element | null) {
  const pop = pushEscapeLayer(onEscape, root ? { root } : undefined);
  cleanups.push(pop);
  return pop;
}

function press(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = '';
});

describe('escape layers', () => {
  it('delivers Escape to the layer that opened last, and only to it', () => {
    const view = vi.fn();
    const modal = vi.fn();
    open(view);
    open(modal);

    const e = press();

    expect(modal).toHaveBeenCalledTimes(1);
    expect(view).not.toHaveBeenCalled();
    // Claimed, so nothing further down the line treats it as unhandled.
    expect(e.defaultPrevented).toBe(true);
  });

  it('hands the next Escape to the layer underneath once the top one closes', () => {
    const view = vi.fn();
    const modal = vi.fn();
    open(view);
    const closeModal = open(modal);

    closeModal();
    press();

    expect(modal).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalledTimes(1);
  });

  it('leaves an Escape that something else already handled', () => {
    const view = vi.fn();
    open(view);

    // A Radix layer (capture phase) or a field cancelling its own edit marks
    // the event handled before it reaches the window.
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    expect(dispatchEscape(e)).toBe(false);
    expect(view).not.toHaveBeenCalled();
  });

  it('ignores the Escape that ends an IME composition', () => {
    const view = vi.fn();
    open(view);

    press(document.body, { isComposing: true });

    expect(view).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const view = vi.fn();
    open(view);

    press(document.body, { key: 'Enter' });

    expect(view).not.toHaveBeenCalled();
  });

  it('leaves an Escape typed into a field outside the layer root', () => {
    const page = document.createElement('div');
    const sidebarInput = document.createElement('input');
    document.body.append(page, sidebarInput);
    const view = vi.fn();
    open(view, () => page);

    // A rename in the sidebar is that field's Escape, not the page's.
    press(sidebarInput);
    expect(view).not.toHaveBeenCalled();

    // A field inside the page is the page's business.
    const inner = document.createElement('textarea');
    page.append(inner);
    press(inner);
    expect(view).toHaveBeenCalledTimes(1);

    // And so is focus on something that is not a field, wherever it sits.
    const button = document.createElement('button');
    document.body.append(button);
    press(button);
    expect(view).toHaveBeenCalledTimes(2);
  });

  it('does nothing with no layer open', () => {
    const e = press();
    expect(e.defaultPrevented).toBe(false);
    expect(escapeLayerDepth()).toBe(0);
  });

  it('removes a layer that closes out of order without disturbing the others', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    open(a);
    const closeB = open(b);
    open(c);

    closeB();
    expect(escapeLayerDepth()).toBe(2);
    press();
    expect(c).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
