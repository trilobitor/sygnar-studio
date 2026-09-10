# b04 — kroki-arbitra.sh --json

- opis: detektor `[P-H17]` wypisuje zdania po polsku; narzedzia potrzebuja formy maszynowej.
- kryterium: `scripts/lib/kroki-arbitra.sh <korzen> --json` wypisuje jedna linie JSON: tablice obiektow `{"zadanie":..,"krok":..}` dla brakujacych krokow, pusta tablica przy ciszy. Tryb domyslny (bez `--json`) BAJTOWO niezmieniony. Kod wyjscia zawsze 0.
- walidacja: `bash scripts/lib/kroki-arbitra.sh . --json 2>/dev/null | python3 -c "import sys,json; d=json.loads(sys.stdin.read().strip()); assert isinstance(d,list) and len(d)==0" && [ -z "$(bash scripts/lib/kroki-arbitra.sh .)" ]`
- trudnosc: M
