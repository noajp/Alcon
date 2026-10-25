import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Function/ is what the board's surfaces stand on, so it never reaches up
  // into a surface. Widgets are the exception: a widget places a surface's
  // section on a board, and the registry loads them.
  {
    files: ["src/Function/**/*.{ts,tsx}"],
    ignores: ["src/Function/widget/widgets/**", "src/Function/widget/registry.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/ActivitySpace/*"], message: "Function/ must not depend on ActivitySpace/. Move the shared piece into Function/ or hooks/." }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
