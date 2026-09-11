# b03 — preflight.sh --json

- opis: wynik preflightu jest dzis wylacznie tekstem dla czlowieka; kokpit i bench musza go parsowac regexem.
- kryterium: `scripts/preflight.sh --task <T> --json` wypisuje na stdout DOKLADNIE jedna linie poprawnego JSON z polami: `pass`, `warn`, `fail`, `pominiete`, `wycofane`, `wykonane` (liczby calkowite) oraz `fail_ids` (tablica). Tryb tekstowy bez `--json` pozostaje niezmieniony.
- walidacja: `bash scripts/preflight.sh --task T-ARB-1 --json 2>/dev/null | python3 -c "import sys,json; d=json.loads(sys.stdin.read().strip()); assert all(k in d for k in ['pass','warn','fail','pominiete','wycofane','wykonane','fail_ids']); assert d['fail']==0 and d['wykonane']>=12"`
- trudnosc: M
