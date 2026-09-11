# b01 — determinizm dowodow generowanych przez testy

- opis: `scripts/testy/DOWOD_DoD-7.md` i `scripts/testy/DOWOD_DoD-8_T-SHELL-1.md` stempluja znacznik czasu ISO przy kazdym `npm test`, wiec brudza drzewo przy kazdym przebiegu. `DOWOD_DoD-5_T-ARB-1.md` tego nie robi i jest wzorcem.
- kryterium: dwa kolejne `npm test` zostawiaja drzewo git BEZ zmian; tresc merytoryczna dowodow zachowana (naglowki i sekcje pomiarowe nadal obecne).
- walidacja: `npm test >/dev/null 2>&1; git add -A; git stash -u -q 2>/dev/null; git stash drop -q 2>/dev/null; npm test >/dev/null 2>&1; git diff --quiet && git diff --cached --quiet`
- trudnosc: S
