# b05 — add-pitfall.sh --dry-run

- opis: dopisanie wpisu do rejestru jest nieodwracalne bez recznej edycji, a rejestr jest chroniony przed reka (permissions:deny).
- kryterium: `scripts/add-pitfall.sh <RCA> --dry-run` pokazuje wpis, ktory POWSTALBY (z wygenerowanym identyfikatorem), NIE modyfikujac `docs/STACK_PITFALLS.md`; kod wyjscia 0. Kontrola podobienstwa dziala tak samo jak w trybie zapisu.
- walidacja: `c1=$(cksum docs/STACK_PITFALLS.md); bash scripts/add-pitfall.sh docs/rca/RCA_T-ARB-1_wyliczenie-krokow.md --dry-run >/dev/null 2>&1; rc=$?; c2=$(cksum docs/STACK_PITFALLS.md); [ "$rc" -eq 0 ] && [ "$c1" = "$c2" ]`
- trudnosc: M
