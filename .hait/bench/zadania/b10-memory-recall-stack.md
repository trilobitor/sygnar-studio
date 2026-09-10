# b10 — memory.sh recall --tylko-stack

- opis: `recall` filtruje po stacku miekko; precedens z innego stacku nadal wraca w wynikach z nizsza waga. Przy trzech nadpisaniach rankingu z rzedu potrzebny jest tryb twardy.
- kryterium: `scripts/memory.sh recall "<opis>" --stack <S> --tylko-stack` zwraca WYLACZNIE kapsuly o dokladnie tym stacku; brak trafien to kod 0 i jawny komunikat, nie blad. Tryb zdegradowany (kod 69) nadal dziala i nadal jest kodem 69.
- walidacja: `out=$(bash scripts/memory.sh recall "detektor bramka pomiar" --stack node22-esm-zerodep --tylko-stack 2>&1); rc=$?; { [ "$rc" -eq 0 ] || [ "$rc" -eq 69 ]; } && ! printf '%s' "$out" | grep -qE 'stack: (?!node22-esm-zerodep)' `
- trudnosc: M
