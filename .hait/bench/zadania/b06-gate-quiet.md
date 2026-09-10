# b06 — gate.sh --quiet

- opis: bramka A wypisuje kilkadziesiat linii; w petli i w CI potrzebny jest sam werdykt.
- kryterium: `scripts/gate.sh A <T> --quiet` wypisuje NAJWYZEJ 3 linie na stdout i konczy sie tym samym kodem wyjscia co tryb pelny. Przy FAIL nadal widac, ktory detektor oblal.
- walidacja: `n=$(bash scripts/gate.sh A T-ARB-1 --quiet 2>/dev/null | grep -c .); rc=$?; [ "$rc" -eq 0 ] && [ "$n" -le 3 ] && [ "$n" -ge 1 ]`
- trudnosc: S
