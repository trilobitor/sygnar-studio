import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Dostępność sprawdzana automatycznie. Bierzemy same reguły z zestawu
  // `recommended`, bez deklaracji wtyczki: `eslint-config-next` rejestruje
  // `jsx-a11y` samo, a druga rejestracja tej samej nazwy przerywa lint.
  { rules: jsxA11y.flatConfigs.recommended.rules },
  /*
   * Komponenty nie sięgają do `server/`.
   *
   * `CLAUDE.md` zapisuje tylko kierunek odwrotny — że serwisy nie importują
   * z `next/*`. Kierunek klient → serwer nie był nigdzie zakazany i trzy
   * komponenty tak robiły. Dziś Turbopack odcina resztę modułu, więc nic
   * wrażliwego nie wycieka, ale wystarczyłby jeden import runtime'owy
   * w takim module — `node:fs`, klient bazy — żeby wciągnąć do przeglądarki
   * konfigurację serwera albo wywalić budowanie klienta (SYG-110).
   *
   * Rzeczy wspólne dla obu stron mieszkają w `src/lib/`.
   */
  {
    files: ["src/components/**/*.tsx", "src/components/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/server/**"],
              message:
                "Komponent nie importuje z server/. Rzeczy wspólne przenieś do src/lib/ (SYG-110).",
            },
          ],
        },
      ],
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
