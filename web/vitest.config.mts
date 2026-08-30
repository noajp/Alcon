import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest runs the tests in `tests/`. Still deliberately minimal:
//
//   - environment 'node' stays the default, because most of what is worth
//     testing here is pure logic and jsdom costs a second of startup to give
//     it a `document` it never reads. A test that needs the DOM opts in for
//     itself with `@vitest-environment jsdom` in its own docblock, so the
//     cost lands only on the files that asked for it and there is no second
//     config to keep in sync.
//   - the `@/*` alias is declared here rather than pulled in through a plugin.
//   - no JSX config: esbuild reads `jsx` from tsconfig.json, so component
//     tests transform without a plugin or an `esbuild` override (which this
//     vitest's types reject anyway).
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
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
