import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Layers: ActivitySpace/ (surfaces) stands on Function/ and hooks/, never
  // the other way. Widgets are the exception: a widget places a surface's
  // section on a board.
  {
    files: ["src/Function/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/providers/**/*.{ts,tsx}", "src/types/**/*.{ts,tsx}"],
    ignores: ["src/Function/widget/widgets/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/ActivitySpace/*"], message: "Only surfaces depend on ActivitySpace/. Move the shared piece into Function/ or hooks/." }],
      }],
    },
  },
  // Surfaces read and write through hooks/, so a query has one home.
  // Slides keeps the data access Kata brought with it (ADR 0042).
  {
    files: ["src/ActivitySpace/**/*.{ts,tsx}"],
    ignores: ["src/ActivitySpace/sustainment/slides/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@/lib/supabase", importNames: ["supabase"], message: "Surfaces go through hooks/ for data. Add the query there." }],
        patterns: [{ group: ["**/lib/supabase"], importNames: ["supabase"], message: "Surfaces go through hooks/ for data. Add the query there." }],
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
