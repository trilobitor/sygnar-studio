# b07 — filemap-guard --wyjasnij

- opis: rola dowiaduje sie o braku przydzialu dopiero przy probie zapisu, kodem 2 z hooka. Nie ma sposobu, zeby zapytac wczesniej.
- kryterium: `scripts/hooks/filemap-guard.sh --wyjasnij <sciezka>` wypisuje, ktora rola (jesli ktorakolwiek) ma prawo zapisu do tej sciezki wg File Mapy aktywnego zadania; kod 0 zawsze; brak mapy = jawny komunikat, nie cisza.
- walidacja: `bash scripts/hooks/filemap-guard.sh --wyjasnij scripts/lib/kroki-arbitra.sh </dev/null 2>/dev/null | grep -q 'impl-backend' && bash scripts/hooks/filemap-guard.sh --wyjasnij scripts/testy/arbiter/x.mjs </dev/null 2>/dev/null | grep -q 'tester'`
- trudnosc: M
