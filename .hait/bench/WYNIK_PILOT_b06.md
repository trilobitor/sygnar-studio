# ArbiterBench — pilot `b06`, wynik

**Data:** 2026-08-25 · **Zadanie:** `b06-gate-quiet` (`scripts/gate.sh A <T> --quiet`, trudność **S**)
**Baza obu ramion:** `2ac4b53`, izolowane klony, identyczny brief, identyczna komenda walidacji.

> To jest **pierwszy przebieg porównawczy w historii projektu**. Do 2026-08-24 `hait-bench`
> istniał jako skill i nie został uruchomiony ani razu.

---

## Wynik

| | **kontrolne** | **badane** |
|---|---|---|
| harness | `open-mercato/skills`, `om-auto-create-pr` | `hait-fazowy`, protokół pełny |
| **`bramka_walidacji_pass`** | **TAK** | **TAK** |
| tryb pełny bajtowo niezmieniony | TAK | TAK |
| `npm test` | 347/348 | 344/345 |
| agentów | **1** | **5** |
| tokeny podagentów | **151 198** | **648 697** |
| tokeny orkiestracji | — (brak orkiestracji) | **`null` — NIEZMIERZONE** |
| iteracji do zielonego | **1** | **2** |
| eskalacje | 0 | 0 |

**Stosunek kosztu: 4,29×** — i to jest wartość **zaniżona** dla ramienia badanego (patrz niżej).

---

## Kryterium *go*, ustalone przed przebiegiem

> **hAit ≥ ramię kontrolne na `bramka_walidacji_pass` przy koszcie ≤ 2×.**

- **Jakość: remis** (1 = 1) ⇒ warunek `≥` spełniony.
- **Koszt: 4,29×** ⇒ warunek `≤ 2×` **NIE spełniony**.

**Werdykt dla `b06`: kryterium *go* nie zostało spełnione.** Nie z powodu jakości — ramiona
są nierozróżnialne — tylko kosztu.

**Kryterium nie zostało zmienione po zobaczeniu wyniku** i nie zostanie. To jedyny sposób,
w jaki ten benchmark mógłby skłamać.

---

## Warunek falsyfikacji skilla — **zadziałał już na pierwszym zadaniu**

Skill deklaruje: *„Ten skill jest błędny, jeśli `bramka_walidacji_pass` okaże się metryką
nasyconą — jeśli oba ramiona przechodzą prawie zawsze, benchmark niczego nie rozróżnia."*

Na `b06` **oba ramiona przeszły**, oba za mniej niż dwoma podejściami, oba z bajtowo
niezmienionym trybem pełnym. Metryka rozstrzygająca **nie rozstrzygnęła niczego**.
Jedno zadanie to nie dowód nasycenia, ale kierunek jest zgodny z ostrzeżeniem skilla
i zestaw trzeba uzupełnić o zadania, w których jedno podejście nie wystarcza.

---

## Dlaczego 4,29× jest wartością ZANIŻONĄ

1. **Tokeny orkiestracji Arbitra są niezmierzone** (`null`, nie `0`). Ramię badane wymaga
   orkiestratora; ramię kontrolne nie. Doliczenie może wynik tylko **pogorszyć**.
2. **Fazy 5–8 zostały ucięte** decyzją Arbitra dla kosztu pilota. Ramię badane wykonało
   fazy 0, 1, 2 (dwie rundy) i 3. Tester, ślepy przegląd kodu, poprawki i odbiór — nie biegły.
   Ramię kontrolne dostarczyło **komplet, z testami**.
3. Ramię kontrolne napisało **3 własne testy**; ramię badane żadnego (to było zadanie fazy 5).

---

## Co ramię badane dało, czego kontrolne nie dało

**Faza 2 zgłosiła 12 pozycji, zanim powstała linijka kodu** — 2 blokujące, 7 istotnych,
3 drobne. Dwie blokujące to nieopisane ścieżki `stdout` (`gate.sh:151`, `:207`) łamiące
twardy budżet trzech linii w bramkach **B i C** — czyli w ścieżkach, których komenda
walidacji `b06` **w ogóle nie dotyka**. Ramię kontrolne nie miało jak ich znaleźć: nie ma
recenzenta, a jego bramką był ten sam test, który je omija.

**Czy to jest wartość — benchmark tego nie mierzy.** Komenda walidacji sprawdza bramkę A.
Obie te ścieżki mogłyby być zepsute w obu ramionach i wynik byłby identyczny.

**Recenzent zakwestionował sam instrument pomiarowy i miał rację w czterech punktach:**
1. w `n=$(… | grep -c .); rc=$?` `rc` jest kodem **`grep`**, nie bramki — więc `[ "$rc" -eq 0 ]`
   jest tautologią wobec `[ "$n" -ge 1 ]`, a **połowa kryterium („ten sam kod wyjścia")
   nie jest mierzona wcale**;
2. `grep -c .` nie liczy linii pustych, a budżet jest budżetem linii;
3. komenda jest prawdziwa i dla PASS (1 ≤ 3), i dla FAIL (3 ≤ 3) — nie odróżnia tych stanów;
4. nie jest idempotentna: drugi przebieg po FAIL wpada w `require_rca_if_retry` → kod 70.

Instrument zostaje **niezmieniony** — zmiana kryterium po pomiarze jest zakazana. Wady są zapisane.

---

## Co poszło nie tak po stronie prowadzącego pomiar

1. **Zniszczyłem stan ramienia badanego własnym pomiarem.** Sprawdzając bajtową niezmienność,
   użyłem `git stash`/`pop` w drzewie z plikami nieśledzonymi; `pop` nie przeszedł i zdjął
   implementację. Pierwszy odczyt „321/345, 24 FAIL" był **artefaktem mojego zepsutego pomiaru**.
   Pracę odzyskałem ze stasha, metodę zmieniłem na nieniszczącą (podmiana samego `gate.sh`
   w osobnym czystym klonie).
2. **Jedna komenda walidacji zawieszała się w nieskończoność** (`b07`) — hook czyta stdin,
   a komenda go nie domykała. Poprawione **przed** pomiarem, nie po.
3. **Klasyfikacja zadania jest confoundem, którego nie kontrolowałem.** §2 protokołu
   kazałby prawdopodobnie zaklasyfikować `b06` jako **SKRÓCONY** (fazy 0→3→8, jeden plik).
   Puściłem PEŁNY, więc zmierzyłem tryb, którego protokół sam by nie wybrał.
   **To zawyża koszt ramienia badanego** i musi być kontrolowane w kolejnych zadaniach.
4. Jeden test (`budzet-czasu`, próg 3000 ms) oblewa **w obu ramionach** przy pełnym
   zrównoleglonym przebiegu, a przechodzi w izolacji we wszystkich trzech drzewach.
   Flak środowiskowy, nieprzypisywalny żadnemu ramieniu.

---

## Czego ten pilot NIE mierzy

- **Jakości kodu poza bramką** — czytelności, utrzymywalności, trafności rozwiązania.
- **Zadań, w których jedno podejście nie wystarcza.** `b06` jest klasy S i ramię kontrolne
  rozwiązało je za pierwszym razem. Teza protokołu dotyczy zadań, gdzie tak nie jest —
  i takich w tym pilocie nie było.
- **Krzywej uczenia.** Rejestr pułapek działa na korzyść ramienia badanego przy zadaniach
  późniejszych; kolejność trzeba losować, a tu było jedno zadanie.

---

## Wniosek — jednym zdaniem

**Na jednym zadaniu klasy S protokół dziewięciofazowy dał ten sam wynik co pojedynczy agent
z dojrzałym harnessem, przy ponad czterokrotnym koszcie i przy metryce, która nie rozróżniła
ramion — co jest dokładnie tym wynikiem negatywnym, który skill kazał dopuścić przed
uruchomieniem, a nie po.**

Żeby ten wniosek uogólnić, brakuje: zadań klasy M i L, kontroli klasyfikacji trybu,
pomiaru tokenów orkiestracji i pełnego przebiegu faz 5–8 w ramieniu badanym.
Dziewięć zadań zestawu czeka nieuruchomionych.
