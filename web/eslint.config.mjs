import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const NO_SURFACE_IMPORT = { group: ["@/ActivitySpace/*"], message: "Only surfaces depend on ActivitySpace/. Move the shared piece into Function/ or hooks/." };
const NO_DIRECT_QUERY = { group: ["**/lib/supabase"], importNames: ["supabase"], message: "Surfaces go through hooks/ for data. Add the query there." };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Layers: ActivitySpace/ (surfaces) stands on Function/, AIP/ and hooks/,
  // never the other way. Widgets are the exception: a widget places a surface's
  // section on a board.
  {
    files: ["src/Function/**/*.{ts,tsx}", "src/AIP/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/providers/**/*.{ts,tsx}", "src/types/**/*.{ts,tsx}"],
    ignores: ["src/Function/widget/widgets/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [NO_SURFACE_IMPORT],
      }],
    },
  },
  // Surfaces read and write through hooks/, so a query has one home.
  // Slides keeps the data access Kata brought with it (ADR 0042). The same
  // holds for every UI component outside ActivitySpace/: the Frame and
  // Function/'s and AIP/'s .tsx parts. A later block with this rule replaces an earlier
  // one's options, so Function/'s UI states both of its restrictions at once.
  {
    files: ["src/ActivitySpace/**/*.{ts,tsx}", "src/Frame/**/*.tsx", "src/Function/widget/widgets/**/*.tsx"],
    ignores: ["src/ActivitySpace/artifacts/slides/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_DIRECT_QUERY] }],
    },
  },
  {
    files: ["src/Function/**/*.tsx", "src/AIP/**/*.tsx"],
    ignores: [
      "src/Function/widget/widgets/**",
      // Settings and OAuth consent still query directly; each comes off this
      // list when its data moves into hooks/ (the layer rule above still holds).
      "src/Function/settings/{AccountSettings,ActivitySpaceSettings,ConnectWorkerAccountDialog,InviteUserDialog,MemberSettings,ProfileSettings,TeamSettings}.tsx",
      "src/AIP/connectors/oauth/OAuthConsentScreen.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_SURFACE_IMPORT, NO_DIRECT_QUERY] }],
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
