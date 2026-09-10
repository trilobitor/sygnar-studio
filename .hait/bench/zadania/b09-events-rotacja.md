# b09 — rotacja telemetrii

- opis: `telemetry/events.jsonl` rosnie bez ograniczen (1228 zdarzen po 9 zadaniach) i jest commitowany przy kazdym przebiegu bramki.
- kryterium: skrypt `scripts/rotate-telemetry.sh` przenosi zdarzenia starsze niz N dni do `telemetry/archiwum/events-<RRRR-MM>.jsonl`, zostawiajac `events.jsonl` z reszta. Suma linii przed i po rotacji IDENTYCZNA. Domyslne N podane w skrypcie, nadpisywalne argumentem.
- walidacja: `przed=$(cat telemetry/events.jsonl telemetry/archiwum/*.jsonl 2>/dev/null | wc -l); bash scripts/rotate-telemetry.sh 30 >/dev/null 2>&1 && po=$(cat telemetry/events.jsonl telemetry/archiwum/*.jsonl 2>/dev/null | wc -l); [ "$przed" -eq "$po" ] && [ "$po" -gt 0 ]`
- trudnosc: M
