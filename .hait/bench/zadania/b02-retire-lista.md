# b02 — retire-pitfall.sh --lista

- opis: `scripts/retire-pitfall.sh` obsluguje wycofywanie i przywracanie wpisow, ale nie ma sposobu, zeby zobaczyc wycofane bez czytania calego rejestru.
- kryterium: `scripts/retire-pitfall.sh --lista` wypisuje KAZDY wycofany wpis rejestru po jednej linii, kazda z identyfikatorem `[P-...]`, data wycofania i powodem; kod wyjscia 0; brak wycofanych = kod 0 i jawny komunikat.
- walidacja: `n=$(bash scripts/retire-pitfall.sh --lista 2>/dev/null | grep -cE 'P-H(04|05|06|10|14)'); [ "$n" -eq 5 ]`
- trudnosc: S
