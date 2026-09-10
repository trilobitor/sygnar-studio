# Faza −1 — zespół agentów `hait`

**Data:** 2026-09-10 · **Autor:** audyt Sygnar.Studio

---

## 1. Gdzie to jest

`[PEWNE]` Repozytorium **`github.com/trilobitor/hait`**, prywatne (bez
uwierzytelnienia API zwraca 404). Sklonowane płytko do katalogu roboczego
sesji, poza projektem.

**Sprostowanie mojego pierwszego wniosku.** Napisałem wcześniej, że repozytorium
`hait` nie istnieje, i wskazałem `hweb/work/CodingTeam` jako zespół. **To był
błąd.** Znalazłem tam framework „AIDEATION v3.0" — siedem agentów w Pythonie,
listopad 2025, bez arbitra — i uznałem go za szukany zespół, bo katalog
nadrzędny nazywał się `hait-web`. To zupełnie inny system. Szukałem po dysku
i nie sprawdziłem, czy repozytorium o tej nazwie istnieje zdalnie.

## 2. Czym to jest

`[PEWNE]` **AiOS Fazowy v1.0-S (r3)** — protokół dziewięciu faz z bramkami
i rejestrem detektorów. Nie zbiór podpowiedzi, tylko maszyna stanów: role mają
rozłączne zakresy plików, komunikacja idzie wyłącznie przez Arbitra, a przejścia
między fazami są pilnowane skryptami, nie obietnicą modelu.

## 3. Role

`[PEWNE]` Sześć ról. Pięć ma plik agenta w `.claude/agents/`; **Arbiter pliku
nie ma i mieć nie może** — to sesja prowadząca, czyli ja.

| rola | model | zakres | plik agenta |
|---|---|---|---|
| **Arbiter** | Opus | maszyna stanów, jedyny kanał sterowania, pisze `PHASE_STATE` | — *(sesja główna)* |
| **Architekt** | Opus | ADR, `kontrakt.md`, File Map | `architekt.md` |
| **Impl-Backend** | Sonnet | API, walidacja, dane | `impl-backend.md` |
| **Impl-Frontend** | Sonnet | UI, dostępność | `impl-frontend.md` |
| **Tester** | Sonnet | testy jako produkt, bramka B | `tester.md` |
| **Recenzent** | Opus | **ślepy** — ocenia diff wobec kontraktu | `recenzent.md` |

Implementatorzy mają `isolation: worktree` — pracują na osobnych kopiach
repozytorium. Recenzent ma **wyłącznie narzędzia odczytu**; jego ślepota jest
wymuszona technicznie, nie regulaminowo.

## 4. Jak działa arbitraż — i dlaczego to jest dobry mechanizm

`[PEWNE]` `hait-governance/SKILL.md` opisuje trzy zasady, z których każda
odpowiada na realny sposób psucia się takich narad:

1. **Role o sprzecznych funkcjach celu**, nie o różnych osobowościach.
   „Zgodność ról o tym samym interesie nie wnosi informacji."
2. **Zbieranie w izolacji.** Każda rola formułuje rekomendację, nie widząc
   pozostałych — inaczej pierwsza wypowiedź zakotwicza resztę i „rada produkuje
   jedną opinię w pięciu redakcjach".
3. **Obowiązkowa rozbieżność.** Gdy wszyscy się zgadzają, ostatnia rola ma
   obowiązek sformułować najmocniejszy kontrargument.

**Rada nie podejmuje decyzji.** Produkuje opcje z konsekwencjami (każda kończy
się zdaniem „to jest błędne, jeśli…"), rekomendację **z rodowodem** — z jawnym
rozdziałem faktu od wniosku od zgadywania — oraz zapis rozbieżności.
„Rada, której protokół nie odnotował sporu, przebiegła źle."

To pokrywa się z tym, co zaproponowałem wczoraj jako zastępnik, i jest od tego
lepsze w jednym punkcie: **izolacja przed zestawieniem**. Sam bym tego nie
zrobił, bo pisząc raport po kolei, siłą rzeczy zakotwiczam się własnym
poprzednim akapitem.

## 5. Bramki

`[PEWNE]` `scripts/gate.sh` — A (build, lint, tsc, detektory), B (start,
trasy 200, dostępność, kontrakt API), C (zrzuty dla ślepego Recenzenta).
Kody wyjścia: 0 PASS, 1 FAIL, 75 blokada-RCA, 2 SKIPPED.

Konfigurowalne przez zmienne `BUILD_CMD`, `LINT_CMD`, `TSC_CMD`, `START_CMD`,
`PORT`, `BASE_URL` — więc dają się wskazać na Sygnar Studio bez przepisywania.

**Czego brakuje w Sygnar Studio:** `scripts/gate.sh`, `docs/contracts/`
i katalog `.hait` z rejestrem detektorów. Bramek nie da się dziś uruchomić
w tym projekcie bez przeniesienia powłoki.

## 6. Mapowanie na role potrzebne w audycie

| rola w audycie | odpowiednik w hait | ocena |
|---|---|---|
| architekt | `architekt` | **jest** |
| reviewer | `recenzent` | **jest**, i mocniejszy niż typowy — ślepy z założenia |
| tester | `tester` | **jest** |
| security | `recenzent` | **częściowo** — recenzja wobec kontraktu, bez osobnego prawa weta |
| ui-design | `impl-frontend` | **częściowo** — implementator UI, nie projektant |
| **copy** | brak | **rola bez agenta w hait** |
| **performance** | brak | **rola bez agenta w hait** |
| **debugger** | brak | **rola bez agenta w hait** |
| **integrator** | brak | **rola bez agenta w hait** |
| **product-owner** | brak | **rola bez agenta w hait** — to Ty |

Pięć ról wykonam sam, oznaczając „rola bez agenta w hait".

**Uwaga o dopasowaniu.** AiOS jest protokołem **wytwarzania**: kontrakt →
implementacja → recenzja diffu. Audyt istniejącego kodu to inny kształt pracy —
nie ma kontraktu ani diffu do oceny. Trzy role (architekt, recenzent, tester)
przenoszą się wprost. Reszta protokołu — dziewięć faz, File Map, bramki wokół
zmiany — do audytu nie pasuje i **nie będę go naciągał**.

## 7. Czego ten zespół nie obejmuje

- projektowania interfejsu i redakcji tekstów po polsku,
- pomiarów wydajności,
- odtwarzania błędów w działającej aplikacji,
- integracji z API platform społecznościowych,
- decyzji produktowych.

## 8. Jak zamierzam tego użyć w audycie

**Arbitrem jestem ja** — to wynika wprost z tabeli ról, nie z mojej wygody.

Przy czterech konfliktach wymienionych w zadaniu zastosuję procedurę
z `hait-governance`: zbiorę stanowiska **w izolacji** (osobne wywołania
podagentów, każdy bez wiedzy o pozostałych), dopiero potem zestawię. Przy
jednomyślności wymuszę kontrargument. Zapiszę opcje z konsekwencjami,
rekomendację z rodowodem i rozbieżność.

Do zbierania stanowisk użyję `architekt` i `recenzent` z hait tam, gdzie
konflikt dotyczy ich zakresu. Tam, gdzie stroną sporu jest rola bez agenta
(ui-design kontra performance), sformułuję oba stanowiska sam — **osobno,
w oddzielnych przebiegach, żeby nie zakotwiczyć drugiego pierwszym** — i to
odnotuję.

---

## 9. Sprostowania do sekcji „FAKTY O PROJEKCIE"

Zasada „zero cichych założeń" wymaga, żebym to zgłosił **przed** audytem.
Trzy punkty zadania są nieaktualne.

### 9.1 „Testy / CI: brak" — `[PEWNE]` nieprawda

Zadanie mówi: *„w projekcie nie ma żadnych testów ani konfiguracji do ich
uruchamiania"* i uzależnia od tego cały tryb pracy z poprawkami.

Stan faktyczny, sprawdzony przed chwilą:

```
Test Files  28 passed (28)
Tests      403 passed (403)
```

Konfiguracja: `vitest.config.mts` i `playwright.config.ts`. Vitest 5.0.0,
Playwright 1.63.0, pięć scenariuszy E2E.

**Konsekwencja:** krok „zaproponuj konfigurację testów i poczekaj na zgodę"
jest bezprzedmiotowy. Reguła testu odtwarzającego przed poprawką **obowiązuje
dalej i będę jej przestrzegał** — po prostu nie trzeba niczego stawiać.

### 9.2 Kolor akcentu `#C2A2D4` — `[PEWNE]` nie występuje w kodzie

W `globals.css` są dwa kolory:

- `--color-accent: #b8935a` — ciepły mosiądz, akcent akcji
- `--color-studio: #c0a3d6` — wrzos, wyłącznie człon „Studio" w znaku

`#C2A2D4` **nie pojawia się w kodzie ani razu**. Wrzos jest o krok inny
(`#c0a3d6`), i to Twój wybór z 09.09: *„kolor jednak ten co jest w zmiennej"*.

**To ma znaczenie dla sekcji A**, bo zadanie każe trzymać akcent z dala od
podglądu — a akcentem przy kadrze jest mosiądz, nie wrzos.

### 9.3 „Podgląd pełnoekranowy i kadrowanie działają źle" — `[PEWNE]` obie powstały wczoraj i dziś

Sekcja E1 każe diagnozować obie funkcje jako zepsute. Obie zbudowałem
w ciągu ostatnich dwóch dni i zweryfikowałem pomiarem:

- **pełny ekran** (commit `9efa8d2`, 09.09) — siedem sprawdzeń: F otwiera,
  Z przechodzi 72% → 100% → 200% → 72%, przy 100% kadr ma dokładnie 1664 px,
  Escape zamyka i oddaje focus;
- **kadrowanie** (commit `3500e28`, 10.09) — hipoteza o przeliczaniu
  współrzędnych była trafna i **została uwzględniona przy budowie**: zaznaczenie
  połowy szerokości kadru 1024 × 1344 dało wycinek 512 × 538 px, **błąd zero
  pikseli na obu osiach**.

To nie znaczy, że są bezbłędne — znaczy, że sekcja E1 nie może wyjść od
założenia „są zepsute". **Przejdę obie klikając i zaraportuję, co znajdę**,
ale bez z góry przyjętej tezy.

---

## 10. Zastrzeżenie do zakresu

Zadanie zakłada aplikację bez testów, z zepsutymi funkcjami i z nieznanym
kolorem akcentu. Trzy z tych założeń są nieaktualne. **Podejrzewam, że
zadanie powstało przed ostatnimi dwoma dniami pracy** — potwierdź, czy audyt
ma dotyczyć stanu na dziś, czy stanu sprzed tych zmian.

Jeśli na dziś: sekcja E1 traci część uzasadnienia, a krok z konfiguracją
testów odpada. Reszta zakresu zostaje w mocy.
