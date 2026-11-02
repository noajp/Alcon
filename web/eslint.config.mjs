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
  // The same holds for every UI component outside ActivitySpace/ — the shell
  // and Function/'s .tsx parts (settings, OAuth consent, Discover).
  {
    files: ["src/ActivitySpace/**/*.{ts,tsx}", "src/shell/**/*.tsx", "src/Function/**/*.tsx"],
    ignores: [
      "src/ActivitySpace/sustainment/slides/**",
      // Settings and OAuth consent still query directly; each comes off this
      // list when its data moves into hooks/.
      "src/Function/settings/{AccountSettings,ActivitySpaceSettings,ConnectWorkerAccountDialog,InviteUserDialog,MemberSettings,ProfileSettings,TeamSettings}.tsx",
      "src/Function/oauth/OAuthConsentScreen.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/lib/supabase"], importNames: ["supabase"], message: "Surfaces go through hooks/ for data. Add the query there." }],
      }],
    },
  },
  // Icons come from ui/icons — Alcon's own drawings, with Lucide behind them
  // for the ones not drawn yet — so a glyph drawn once shows everywhere.
  // (Its own rule name, so it sits beside the layer rules above.)
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ui/icons/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [{ name: "lucide-react", message: "Import icons from '@/ui/icons'." }],
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
