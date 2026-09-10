# b08 — gate.sh metrics --task

- opis: `gate.sh metrics` agreguje CALA telemetrie repozytorium; nie da sie dostac rollupu jednego zadania bez recznego greppowania.
- kryterium: `scripts/gate.sh metrics --task <T>` zapisuje agregat WYLACZNIE ze zdarzen tego zadania i wypisuje sciezke pliku wynikowego. Wywolanie bez `--task` zachowuje sie dokladnie jak dzis.
- walidacja: `bash scripts/gate.sh metrics --task T-ARB-1 >/dev/null 2>&1 && python3 -c "import json,glob; f=[p for p in glob.glob('telemetry/*T-ARB-1*.json')]; assert f; d=json.load(open(f[0])); assert d['bramki']['A']['pass']>=16 and d['bramki']['A']['pass']<40"`
- trudnosc: M
