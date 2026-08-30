import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest runs the pure-logic tests in `tests/`. Deliberately minimal:
//
//   - environment 'node' — nothing under test touches the DOM. The moment a
//     test needs `document`, add jsdom + @testing-library/react then, not now.
//   - the `@/*` alias is declared here rather than pulled in through a plugin,
//     so the runner adds exactly one devDependency (vitest) to the tree.
//
// Tests live in `tests/` instead of beside their sources on purpose: the
// design-lint fixtures are strings like `className="uppercase"` and `#ff0000`,
// which design-lint would flag as real violations if they sat under `src/`.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
