// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('falls back safely when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage is disabled', 'SecurityError');
  });

  expect(() => render(<I18nProvider><div>Clayware</div></I18nProvider>)).not.toThrow();
});
