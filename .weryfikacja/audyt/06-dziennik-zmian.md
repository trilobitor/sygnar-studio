# Dziennik zmian audytu

Gałąź: `chore/audyt-2026-09`. Gałęzi głównej nie dotykam.

Każdy wpis: **co**, **dlaczego**, **którym commitem**, **jak zweryfikowane**,
**jak cofnąć**.

---

## 2026-09-10 · Przeniesienie powłoki AiOS z `hait`

**Co.** `scripts/gate.sh`, `preflight.sh`, `integrate.sh`, `add-pitfall.sh`,
`amend-pitfall.sh`, `memory.sh`, `lint.py`, `scripts/lib/`, `scripts/hooks/`,
`.hait/` (rejestr i konfiguracja), `.claude/agents/` (pięć ról),
`.claude/skills/` (pięć umiejętności), `docs/STACK_PITFALLS.md`,
`docs/RCA_TEMPLATE.md`.

**Dlaczego.** Decyzja właściciela z 10.09. Bez rejestru i skryptów bramki
`gate.sh` nie da się uruchomić w tym repozytorium.

**Jak zweryfikowane.** `bash scripts/gate.sh A AUDYT-2026-09` → **PASS**:
build OK, lint OK, tsc OK, 31 detektorów w rejestrze, 14 wykonanych,
12 PASS, 2 WARN, 0 FAIL.

Dwa ostrzeżenia są spodziewane i **nie są defektami Sygnar Studio**:

- `P-H19` — warstwa pamięci zdegradowana, embedder z `.hait/hait.config.json`
  niedostępny. Recall schodzi do wyszukiwania pełnotekstowego.
- `P-H20` — brak zdarzeń fazy 4 w telemetrii. Nie uruchamiamy tu pełnego
  protokołu dziewięciu faz, więc telemetria jest pusta. Sam detektor mówi
  wprost: „to nie jest dowód, że fazy 4 nie uruchamiano — pomiar NIEWYKONANY".

**Jak cofnąć.** `git checkout main` — całość leży na gałęzi audytu.

### Dwie porażki bramki po drodze — obie moje, obie udokumentowane

**Iteracja 1 — FAIL.** Preflight nie miał rejestru. Przeniosłem powłokę bez
`docs/STACK_PITFALLS.md` i `docs/RCA_TEMPLATE.md`, bo zależności ustalałem
grepem po `gate.sh`, a te dwa pliki czyta `preflight.sh`, o poziom głębiej.
RCA: `docs/rca/RCA_AUDYT-2026-09_A_1.md`, z detektorem wykrywającym dokładnie
ten stan (powłoka obecna, rejestru brak).

**Iteracja 2 — FAIL.** Detektory `P-H11` i `P-H16` testują **samą powłokę**,
a P-H11 wprost woła `scripts/integrate.sh`, którego nie przeniosłem. Ten sam
błąd co poprzednio, o jeden poziom dalej: przenosiłem powłokę częściami
zamiast w całości. Po uzupełnieniu `integrate.sh`, `memory.sh`, `lint.py`
i `hooks/` — 0 FAIL.

**Wniosek dla mnie na resztę audytu:** listy zależności ustalone grepem
pierwszego rzędu są niepełne. Dwa razy z rzędu.

**Nie dodałem detektora dla iteracji 2**, bo detektor z iteracji 1 pokrywa
tę samą przyczynę (niepełne przeniesienie powłoki), a rejestr wprost zabrania
wpisów o podobnym `detect:` — `add-pitfall.sh` porównuje je i odrzuca duplikaty.

### Do `.gitignore`

`.aios/` i `telemetry/` — stan lokalny przebiegu protokołu, nie treść projektu.
