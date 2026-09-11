# Deskryptor runnera — Claude Code

**Kontrakt:** protokół fazowy nie wie, jaki agent go wykonuje. Wie tylko, że
runner umie pięć rzeczy: uruchomić rolę w izolowanym kontekście, przekazać jej
referencje do plików, wymusić zestaw narzędzi, zwrócić znormalizowane zdarzenia
i podać zużycie. Ten plik mapuje te pięć rzeczy na Claude Code.

Wzorzec przejęty z `open-mercato/cezar` (`AGENT_PROTOCOL.md` — szew
`AgentRunner` + fabryka `createRunner`). Kluczowa zasada stamtąd, którą
przyjmujemy dosłownie: **nic poza rdzeniem nie rozgałęzia się po identyfikatorze
backendu.** Jeśli w protokole pojawi się `if runner == "claude"`, szew jest
złamany.

---

## Mapowanie poziomów zdolności

Chart deklaruje `poziom: cheap | standard | capable`. Runner mapuje:

| Poziom | Zastosowanie w protokole |
|---|---|
| `cheap` | kroki mechaniczne przy kompletnym kontrakcie (transkrypcja) |
| `standard` | implementacja, testy — wolumen |
| `capable` | architektura, recenzja, arbitraż — osąd |

Mapowanie na konkretne modele należy do runnera i **nie jest zapisane w charcie**.
Runner, który nie umie wybierać modelu, ignoruje poziom — chart nadal działa.

## Uruchomienie roli

Rola = plik `.claude/agents/<id>.md` z frontmatterem `tools:`, `model:`,
opcjonalnie `isolation: worktree`. Runner wywołuje subagenta; kontekst jest
izolowany z definicji platformy — to jest właśnie mechanizm, na którym opiera
się ślepota Recenzenta.

## Znormalizowane zdarzenia

Runner dopisuje do `telemetry/events.jsonl` po jednej linii JSON na zdarzenie:

```
{"ts":"…","typ":"faza|bramka|rca|eskalacja|pitfall|kompakcja","rola":"…","zadanie":"…","wynik":"PASS|FAIL|SKIPPED","iter":1}
```

**Zasada wersjonowania (za Cezarem):** format zdarzeń nigdy nie jest zastępowany,
tylko rozszerzany. Stare nagrania muszą dać się odtworzyć zawsze. Plik z liniami
w dwóch wersjach schematu jest poprawny z założenia. Kiedy dokumentacja nie
zgadza się z kodem, **wygrywa kod** — fixture'y i test parzystości są
wykonywalne, proza nie jest.

## Zużycie

Runner raportuje `tokeny_wejscie`, `tokeny_wyjscie`, `koszt_usd` per wywołanie
roli, jeśli je zna. **Jeśli nie zna — zapisuje `null`, nigdy `0`.**
Brak pomiaru jest informacją; zero jest kłamstwem.

## Zachowanie przy braku funkcji

| Brak | Zachowanie |
|---|---|
| wyboru modelu | poziomy ignorowane, wszystko na modelu domyślnym |
| izolacji worktree | faza 3 sekwencyjnie zamiast równolegle; File Map nadal obowiązuje |
| hooków | warstwa 3 nieaktywna; warstwa 2 (skrypty) jest samowystarczalna |
| liczników zużycia | pola `null`; budżet nie jest egzekwowany, tylko deklarowany |

Żaden z tych braków nie zatrzymuje protokołu. Każdy z nich jest widoczny
w `hait status` — degradacja ma być jawna, nie cicha.
