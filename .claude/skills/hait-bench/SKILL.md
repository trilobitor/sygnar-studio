---
name: hait-bench
description: >
  ArbiterBench — pomiar odpowiedzi na centralne pytanie hAit: czy protokół
  wielu agentów daje lepszy wynik niż jeden agent z dobrym harnessem. Używaj,
  gdy pojawiają się hasła „benchmark", „grupa kontrolna", „zmierz", „ArbiterBench",
  „porównaj z pojedynczym agentem", „kryterium go", albo gdy ktoś twierdzi, że
  protokół jest lepszy — wtedy ten skill pyta, na jakiej podstawie.
---

# hait-bench — ArbiterBench

## Po co ten skill istnieje

Jedyne twierdzenie hAit, którego nie da się skopiować w kwartał, to **zmierzona**
odpowiedź na pytanie, czy wiele perspektyw bije jedną. Dopóki pomiaru nie ma,
przewaga hAit jest twierdzeniem. Ten skill nie ma nic wspólnego z przekonywaniem
kogokolwiek — jego zadaniem jest **dopuścić wynik negatywny przed uruchomieniem,
nie po**.

**Wynik, który trzeba dopuścić:** różnica w granicach szumu albo koszt protokołu
przewyższający zysk. Jeśli tak wyjdzie, teza hAit o SDLC upada i zostaje
wyłącznie warstwa governance, gdzie nie ma testu jednostkowego, więc
ustrukturyzowany spór jest jedyną dostępną bramką.

## Konstrukcja eksperymentu

**Pytanie:** czy protokół 9 faz daje wyższy odsetek zadań przechodzących bramkę
walidacji niż pojedynczy agent z dojrzałym harnessem, przy koszcie nie
przekraczającym dwukrotności?

**Ramię kontrolne.** Nie „goły model" — to byłaby ustawiona walka. Grupą
kontrolną jest **cudzy działający harness**: `npx skills add open-mercato/skills`,
`om-auto-create-pr` na tym samym zadaniu i tym samym repozytorium. Jest darmowy,
utrzymywany i dojrzalszy od naszego — to najuczciwsza i najtańsza grupa
kontrolna, jaka istnieje. Jeśli okaże się nieuruchamialny na naszym stacku,
ramieniem kontrolnym jest Claude Code z `AGENTS.md` i bez protokołu, co jest
odniesieniem słabszym, ale wystarczającym; fakt degradacji zapisuje się
w manifeście.

**Ramię badane.** `hait-fazowy`, protokół pełny, bramki A/B/C, ta sama telemetria.

**Zadania.** Minimum 10, po jednym pliku w `.hait/bench/zadania/`. Każde
zadanie deklaruje: opis (jedno zdanie), kryterium akceptacji, komendę
walidacji zwracającą kod wyjścia. Zadanie bez wykonywalnej komendy walidacji
**nie wchodzi do zestawu** — jego wynik byłby opinią.

## Co się mierzy

| Metryka | Skąd | Uwaga |
|---|---|---|
| `bramka_walidacji_pass` | kod wyjścia komendy z zadania | jedyna metryka rozstrzygająca |
| `tokeny_wejscie` / `tokeny_wyjscie` | runner | `null`, gdy runner nie raportuje |
| `koszt_usd` | runner albo cennik × tokeny | oznacz, który z dwóch |
| `bledy_zlapane_przed_merge` | RCA + uwagi Recenzenta | licz zdarzenia, nie wrażenia |
| `iteracje` | `telemetry/protocol-metrics.json` | licznik per bramka |
| `eskalacje` | telemetria | 3. FAIL = 1 eskalacja |
| `czas_s` | znacznik czasu przebiegu | czas ścienny, nie czas modelu |

**Zasada nadrzędna pomiaru:** brak pomiaru zapisuje się jako `null`, nigdy
jako `0`. Zero jest wynikiem; `null` jest przyznaniem się do braku. Mieszanie
tych dwóch rzeczy zamienia benchmark w materiał marketingowy.

## Przebieg

```bash
hait bench init                          # manifest + katalogi
# … dodaj >= 10 zadań do .hait/bench/zadania/
hait bench run <zadanie> kontrolne       # cudzy harness
hait bench run <zadanie> badane          # protokół hAit
hait bench compare                       # zestawienie; kreska = brak pomiaru
```

## Kryterium *go* — ustalone z góry

**hAit ≥ ramię kontrolne na `bramka_walidacji_pass` przy koszcie ≤ 2×.**

Kryterium zapisuje się **przed pierwszym przebiegiem** i nie zmienia po
zobaczeniu wyników. Zmiana kryterium po pomiarze jest jedynym sposobem, w jaki
ten benchmark może skłamać, więc jest to jedyna rzecz, której skill zabrania
wprost.

## Czego ten benchmark NIE mierzy

1. **Jakości kodu poza bramką.** Bramka mierzy, czy się buduje i czy testy
   przechodzą. Czytelność, utrzymywalność i trafność architektury zostają
   niezmierzone — i trzeba to powiedzieć w każdym raporcie.
2. **Zadań governance.** Scenariusze bez testu jednostkowego wymagają innej
   metodyki (zgodność z listą kontrolną ocenianą ślepo przez trzeciego)
   i nie mieszają się do tego zestawu.
3. **Krzywej uczenia.** Rejestr pułapek sprawia, że dziesiąte zadanie jest
   łatwiejsze niż pierwsze. Kolejność zadań trzeba losować, a fakt
   odnotować — inaczej mierzymy rejestr, nie protokół.

## Warunek falsyfikacji tego skilla

Ten skill jest błędny, jeśli `bramka_walidacji_pass` okaże się metryką
nasyconą — jeśli oba ramiona przechodzą prawie zawsze, benchmark niczego nie
rozróżnia i trzeba zejść na metryki drugiego rzędu (liczba iteracji do PASS,
błędy złapane przed merge). Sprawdzalne po trzech pierwszych zadaniach.
