# RCA — AUDYT-2026-09 / bramka A / iteracja 1

- data: 2026-09-10
- zadanie: AUDYT-2026-09
- bramka: A
- iteracja: 1
- tytul: Powłoka AiOS przeniesiona bez rejestru detektorów
- kategoria: H
- tryb: empty

## Objaw (co zgłosiła bramka)

Build, lint i tsc przeszły. Krok „detektory (preflight)" zgłosił:

    preflight: brak rejestru: docs/STACK_PITFALLS.md
    cat: docs/RCA_TEMPLATE.md: No such file or directory

## Przyczyna źródłowa (min. 2 poziomy „dlaczego")

1. **Dlaczego wystąpił objaw?** → Przeniosłem do Sygnar Studio `scripts/`,
   `scripts/lib/`, `.hait/` i `.claude/`, ale nie `docs/STACK_PITFALLS.md`
   ani `docs/RCA_TEMPLATE.md`. Preflight nie ma czego wykonać, a gate.sh nie
   ma z czego złożyć RCA.

2. **Dlaczego to było możliwe?** → Zależności powłoki ustalałem grepem po
   `gate.sh` (`source`, `.hait/`, `scripts/`). Ten grep pokazuje pliki, które
   `gate.sh` **ładuje**, ale nie te, które ładuje `preflight.sh` — a rejestr
   i szablon są czytane właśnie tam, o jeden poziom głębiej. Sprawdziłem
   zależności pierwszego rzędu i uznałem listę za pełną.

3. **Dlaczego to nie zostało wykryte wcześniej?** → Bo w hait te pliki zawsze
   są. Brak ujawnia się wyłącznie przy przenoszeniu powłoki do nowego
   repozytorium, czyli w sytuacji, która zdarza się raz na projekt.

## Poprawka (co zmieniamy TERAZ)

- Skopiowane `docs/STACK_PITFALLS.md` (40 detektorów) i `docs/RCA_TEMPLATE.md`.
- Rejestr jest deklarowany jako przenośny między projektami na tym samym
  stacku — oba projekty stoją na Next.js i TypeScripcie, więc siatka pasuje.

- fix: przenosząc powłokę AiOS, kopiuj razem `scripts/`, `scripts/lib/`, `.hait/`, `docs/STACK_PITFALLS.md` i `docs/RCA_TEMPLATE.md` — cztery pierwsze bez dwóch ostatnich dają bramkę, która nie ma czego wykonać

## Detektor (OBOWIĄZKOWE przed 2. iteracją)

Wykrywa dokładnie ten stan: powłoka jest, rejestru albo szablonu nie ma.
Tryb `empty` — jakikolwiek wynik znaczy FAIL.

- detect: test -f scripts/gate.sh && { test -f docs/STACK_PITFALLS.md || echo "brak docs/STACK_PITFALLS.md przy obecnym scripts/gate.sh"; test -f docs/RCA_TEMPLATE.md || echo "brak docs/RCA_TEMPLATE.md przy obecnym scripts/gate.sh"; } || true

## Weryfikacja

Bramka A uruchomiona ponownie po skopiowaniu obu plików — wynik poniżej,
w dzienniku zmian audytu.
