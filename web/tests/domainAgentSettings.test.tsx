/** @vitest-environment jsdom */
//
// The Domain agent panel's modal convergence (settings redesign PR4b,
// §2.5/§10): the hand-rolled switch retires for the ONE shared Switch,
// the native model <select> becomes the shared SelectControl speaking in
// model labels, and every string renders through t() — the panel was the
// last hard-coded-Japanese settings surface. Save semantics (one
// updateDomain write of ai_config, turns clamped, instructions trimmed)
// and the fieldset's canEdit gating are pinned unchanged against a
// stubbed useSupabase.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { DomainAgentSettings } from '@/ActivitySpace/execution/domain/DomainAgentSettings';
import type { Domain } from '@/hooks/useSupabase';

const h = vi.hoisted(() => ({
  updateDomain: vi.fn(async (_id: string, _patch: unknown) => ({})),
  pingAgentRuntime: vi.fn(async () => ({ ok: true, key_configured: true })),
}));

vi.mock('@/hooks/useSupabase', () => ({
  updateDomain: h.updateDomain,
  pingAgentRuntime: h.pingAgentRuntime,
}));

const domain = {
  id: 'dom-1',
  ai_config: { enabled: true, model: 'claude-haiku-5-5', max_turns: 30, instructions: 'Be brief.' },
} as unknown as Domain;

beforeEach(() => {
  h.updateDomain.mockClear();
  h.pingAgentRuntime.mockClear();
});
afterEach(() => { cleanup(); });

const renderPanel = (canEdit = true) => render(
  <I18nProvider>
    <DomainAgentSettings domain={domain} canEdit={canEdit} />
  </I18nProvider>,
);

describe('DomainAgentSettings', () => {
  it('renders the shared Switch and the panel in translation keys — no native select or checkbox remains', () => {
    const { container } = renderPanel();
    const sw = screen.getByRole('switch', { name: 'Enable agent execution' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('AI agent')).toBeTruthy();
    expect(screen.getByText(/When you press Start on the board/)).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("shows the current model's label on the shared select trigger", () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Claude Haiku 5.5 — Fast, low cost/ })).toBeTruthy();
  });

  it('toggling the switch and saving writes the flipped enabled flag with the rest of ai_config intact', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable agent execution' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect(h.updateDomain).toHaveBeenCalledWith('dom-1', {
      ai_config: { enabled: false, model: 'claude-haiku-5-5', max_turns: 30, instructions: 'Be brief.' },
    });
  });

  it('saving clamps an out-of-range max turns to the engine limit', async () => {
    const { container } = renderPanel();
    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect(h.updateDomain).toHaveBeenCalledWith('dom-1', {
      ai_config: expect.objectContaining({ max_turns: 200 }),
    });
  });

  it('test connection reports the key as set when the runtime answers ok', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('API key is set — connection OK')).toBeTruthy();
  });

  it('canEdit=false disables the whole fieldset, as the native controls were gated', () => {
    const { container } = renderPanel(false);
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
});
