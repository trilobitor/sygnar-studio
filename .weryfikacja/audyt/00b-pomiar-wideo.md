# Faza 0.5 — pomiar wideo

**Data:** 2026-09-10 · **Maszyna:** `MacBookPro18,2` (M1 Max, 32 GB), zasilanie sieciowe
**Rola:** architekt — pomiar poza kodem aplikacji, w `spike/`

---

## Werdykt

> **Zadanie zlecane i odbierane później, nie narzędzie z paskiem postępu.**

Pięć sekund w 720p kosztuje **310 sekund**. Grafik nie będzie czekał przy
ekranie pięciu minut na jeden klip, a przy trzech podejściach do ujęcia —
kwadransa. Interfejs musi to traktować jak zlecenie do odebrania, z powiadomieniem.

---

## Założenia

1. Mierzone na tej maszynie, nie przenoszone z cudzych publikacji.
2. Zasilanie sieciowe, bateria 100%, usypianie zablokowane (`caffeinate -dimsu`).
3. Panel Sygnar Studio działał w tle przez cały pomiar (161 MB, 0% CPU) —
   nie izolowałem maszyny, bo w pracy też nie będzie izolowana.

---

## 1. Wybrany runtime i dlaczego

`[PEWNE]` **FastVideo 0.2.1** (PyPI, wydane 2026-08-28) z runtime'em **MLX**,
model **FastMetal-5B-QAD** — destylowany Wan 2.2 TI2V-5B z INT8 DiT.

Dlaczego nie ComfyUI: oficjalny szablon WAN 2.2 zakłada FP8, którego Metal nie
implementuje. Droga przez GGUF jest niepraktycznie wolna. To ustalenie z zadania
przyjąłem i **nie testowałem go ponownie** — nie miałem powodu, a test kosztowałby
godziny.

### Licencje — sprawdzone przed pobraniem

| | bramka | licencja |
|---|---|---|
| FastVideo (kod) | — | Apache-2.0 |
| FastVideo/FastMetal-5B-QAD | nie | **apache-2.0** |
| Wan-AI/Wan2.2-TI2V-5B | nie | **apache-2.0** |

`[PEWNE]` Sprawdzone 10.09.2026 w rejestrze HuggingFace. Komercyjnie czyste —
w odróżnieniu od rodziny `FLUX.1-*-dev`, która jest niekomercyjna (D74).

**Instalacja poszła w osobnym środowisku Pythona 3.12.** Instalacji mfluxa
w `~/flux2-klein` nie ruszałem, zgodnie z `CLAUDE.md`.

---

## 2. Pomiar właściwy — 720p, 5 sekund

`[PEWNE]` 1280 × 704, 121 klatek, 24 kl./s, `seed 7`, trzy kroki DMD, dekoder TAEHV.

| miara | wartość |
|---|---|
| **czas całkowity** | **310,3 s** (5 min 10 s) |
| kodowanie opisu | 37,2 s |
| ładowanie DiT | 0,115 s |
| **samo liczenie (denoise)** | **234,6 s** |
| dekodowanie | 32,0 s |
| **szczyt pamięci MLX** | **11,42 GiB** (12,3 GB) |
| szczyt pamięci systemu | 31 GB z 32 GB |
| plik wyjściowy | **1,8 MB** |
| throttling termiczny | **nie wystąpił** (`pmset -g therm` czysty) |

Plik zweryfikowany `ffprobe`: 1280×704, 121 klatek, 24/1, **5,042 s**.

### Porównanie z liczbami autorów

`[PEWNE]` Autorzy podają **151,42 s i 9,34 GiB** — ale **na Apple M4 Max
z 36 GB**. Na tej maszynie:

| | M4 Max (autorzy) | **M1 Max (tu)** | różnica |
|---|---|---|---|
| czas | 151,4 s | **310,3 s** | **2,05× wolniej** |
| szczyt | 9,34 GiB | **11,42 GiB** | +22% |

Ostrzeżenie z zadania było trafne. Gdybym przyjął liczby autorów, zaprojektowałbym
interfejs pod dwie i pół minuty zamiast pod pięć.

---

## 3. Punkt odniesienia — 480p, 2 sekundy

`[PEWNE]` 832 × 480, 49 klatek.

| miara | wartość |
|---|---|
| czas całkowity | **26,3 s** |
| samo liczenie | 24,5 s |
| kodowanie opisu | 0,006 s *(z pamięci podręcznej pierwszego przebiegu)* |
| szczyt pamięci MLX | **6,89 GiB** |
| plik | 0,4 MB |

**Skalowanie nie jest liniowe.** 720p 5 s ma 6,7× więcej pikseli-klatek niż
480p 2 s, a trwa 11,8× dłużej. Skracanie klipu i obniżanie rozdzielczości
daje więcej, niż wynikałoby z prostej proporcji — to jest dźwignia dla
interfejsu, jeśli szybki podgląd ma sens.

**Pamięć podręczna opisu ma znaczenie.** Kodowanie tekstu to 37 s przy
pierwszym uruchomieniu i 0,006 s przy powtórzeniu tego samego opisu.
Przy iteracji „ten sam opis, inny numer" oszczędza to **12% czasu**.

---

## 4. Czy oba modele mieszczą się w 32 GB naraz

`[PEWNE] w zakresie składników, [PRAWDOPODOBNE] w zakresie sumy` — poniżej wyjaśnienie.

| zestawienie | suma szczytów | werdykt |
|---|---|---|
| obraz 2,08 Mpx + wideo 720p | **40,1 GB** | **nie mieści się** |
| obraz 2,08 Mpx + wideo 480p | 35,2 GB | nie mieści się |
| obraz 1,05 Mpx + wideo 720p | 30,2 GB | teoretycznie tak, bez zapasu na system |
| obraz 1,05 Mpx + wideo 480p | 25,4 GB | teoretycznie tak, bez zapasu na system |

Składniki są zmierzone: 27,81 GB i 17,95 GB dla obrazu (E0, ta maszyna),
12,3 GB i 7,4 GB dla wideo (dziś, ta maszyna). **Sumy są arytmetyką, nie
pomiarem** — nie uruchomiłem obu modeli naraz i piszę to wprost.

**Dlaczego nie uruchomiłem.** Przy wariancie produkcyjnym suma to 40 GB na
maszynie z 32 GB. Wynikiem byłoby ciężkie zrzucanie na dysk, a panel działa
w tym czasie na tej samej maszynie i jest dziś pokazywany. Eksperyment
potwierdziłby liczbę, którą już znam, kosztem ryzyka. **Jeśli chcesz ten
pomiar mimo wszystko — zrobię go, ale przy wyłączonym panelu.**

### Wniosek architektoniczny

**Jedna wspólna kolejka dla obrazu i wideo, po jednym zadaniu naraz.**
Nie dwie kolejki, nie równoległość. Wariant produkcyjny nie mieści się nawet
teoretycznie, a warianty, które się mieszczą, nie zostawiają nic systemowi.

**Pamięć jest oddawana w całości.** Po zakończeniu przebiegu: aktywne 4,7 GB,
wolne 17,9 GB, proces zniknął. Przełączanie modeli w jednej kolejce nie wymaga
restartu — kosztuje tylko ponowne załadowanie wag.

---

## 5. Co to znaczy dla sekcji C

1. **Zadanie, nie narzędzie interaktywne.** Pięć minut to nie jest czas, przez
   który patrzy się na pasek.
2. **Kolejka musi przetrwać restart i zamknięcie karty** — stan w bazie,
   nie w pamięci procesu. Ta sama zasada, co przy obrazach.
3. **Grafik ma wiedzieć przed zleceniem, na jak długo zajmie stację.**
   Przy 720p to 5 minut na klip; przy trzech podejściach — kwadrans.
4. **Podgląd w 480p ma sens jako osobny tryb** — 26 s zamiast 310 s.
5. **Warto buforować kodowanie opisu** — 37 s przy pierwszym, 0,006 s przy
   powtórzeniu.

---

## 6. Czego nie zmierzyłem

1. **Obu modeli naraz** — powód wyżej.
2. **Wariantu `--fast`** (autorzy podają 47 s zamiast 151 s na M4 Max).
   Wart pomiaru, bo mógłby zmienić werdykt z „zadanie" na „narzędzie
   interaktywne" — ale nie wiem, jakim kosztem jakości.
3. **Modelu 14B** — nie pobierałem; przy 2× wolniejszej maszynie i 5B na
   pięciu minutach, 14B jest poza zasięgiem interaktywnym.
4. **Zachowania przy zamkniętej klapie.** `caffeinate` nie utrzymuje Maca
   przy życiu w trybie klapy zamkniętej bez monitora zewnętrznego.
5. **Kolejnych przebiegów tego samego pomiaru** — mam po jednym na wariant,
   więc nie znam rozrzutu. Przy 310 s pojedynczy pomiar wystarcza do decyzji
   „zadanie czy narzędzie", ale nie do planowania czasu co do sekundy.

---

## 7. Artefakty

- `spike/mlx_wan22_generate.py` — skrypt z repozytorium FastVideo (Apache-2.0)
- `spike/pomiar-wideo.sh` — mój pomiar
- `spike/A-720p-5s.mp4` — klip z przebiegu właściwego, 1,8 MB
- metryki: `wideo-out/*.metryki.json` w katalogu roboczym sesji
