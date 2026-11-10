/** @vitest-environment jsdom */
//
// The settings redesign's shared primitives (PR1, design §4/§9): the ONE
// Switch every boolean setting renders, the SegmentedControl for short
// enums (radio-group semantics — exactly one checked, arrow keys move the
// selection), and the SettingRow anatomy (title + description + caption
// slots). Panels keep their own stores; these pins hold the presentation
// contract the later settings PRs build on.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import {
  SettingRow, SettingsIsland, SegmentedControl, SelectControl, Switch,
} from '@/Function/settings/SettingsControls';

afterEach(() => { cleanup(); });

describe('Switch', () => {
  it('renders role="switch" with aria-checked and fires on toggle', () => {
    const onChange = vi.fn();
    render(<Switch label="Enabled" value={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('respects disabled', () => {
    const onChange = vi.fn();
    render(<Switch label="Enabled" value onChange={onChange} disabled />);
    const sw = screen.getByRole('switch', { name: 'Enabled' }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('SegmentedControl', () => {
  const options = ['Now', 'Inbox', 'Calendar'];
  const renderControl = (onChange: (v: string) => void) => render(
    <I18nProvider>
      <SegmentedControl label="Default home view" value="Now" options={options} onChange={onChange} />
    </I18nProvider>,
  );

  it('renders a radiogroup with exactly one option checked', () => {
    renderControl(vi.fn());
    expect(screen.getByRole('radiogroup', { name: 'Default home view' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    renderControl(onChange);
    fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
    expect(onChange).toHaveBeenCalledWith('Calendar');
  });

  it('moves the selection on arrow keys, wrapping at the ends', () => {
    const onChange = vi.fn();
    renderControl(onChange);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Now' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('Inbox');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Now' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('Calendar');
  });

  it('disabled renders every option disabled and fires nothing', () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <SegmentedControl label="Default home view" value="Now" options={options} onChange={onChange} disabled />
      </I18nProvider>,
    );
    for (const r of screen.getAllByRole('radio')) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SettingRow', () => {
  it('renders the title, description and caption slots', () => {
    render(
      <SettingRow label="Theme" desc="Match the system or pick a colour theme" caption="Applies on this device">
        <span>control</span>
      </SettingRow>,
    );
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Match the system or pick a colour theme')).toBeTruthy();
    expect(screen.getByText('Applies on this device')).toBeTruthy();
    expect(screen.getByText('control')).toBeTruthy();
  });

  it('omits description and caption when they are not given', () => {
    render(<SettingRow label="Theme"><span>control</span></SettingRow>);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.queryByText('Match the system or pick a colour theme')).toBeNull();
    expect(screen.queryByText('Applies on this device')).toBeNull();
  });
});

describe('SettingsIsland', () => {
  it('renders its heading above the island and the rows inside', () => {
    const { container } = render(
      <SettingsIsland title="General">
        <SettingRow label="Language"><span>control</span></SettingRow>
      </SettingsIsland>,
    );
    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
    expect(container.querySelector('[class*="shadow-[var(--shadow-island)]"]')).toBeTruthy();
  });
});

describe('SelectControl', () => {
  it('disabled renders its trigger disabled', () => {
    render(
      <I18nProvider>
        <SelectControl value="Every hour" options={['Every hour', 'Every day']} onChange={vi.fn()} disabled />
      </I18nProvider>,
    );
    const trigger = screen.getByRole('button', { name: /Every hour/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
