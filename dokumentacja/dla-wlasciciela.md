# Sygnar Studio — utrzymanie

Strona dla osoby, która trzyma tę maszynę przy życiu. Instalacja i wdrożenie
są w `wdrozenie/README.md`; tutaj jest to, co robi się później.

## Codziennie samo

| Co | Kiedy | Gdzie sprawdzić |
|---|---|---|
| kopia zapasowa | 3:00 | `~/Library/Logs/kopia.log` |
| migracje bazy | przy każdym starcie | log serwera, wpis „schemat bazy aktualny" |

## Dostęp

```
npm run dostep -- lista
npm run dostep -- dodaj <imię>       # hasło podaje się na wejściu
npm run dostep -- odbierz <imię>     # działa natychmiast
npm run dostep -- przywroc <imię>
npm run dostep -- wejscia 30
```

Panel wysyła powiadomienie macOS przy logowaniu z **nieznanego dotąd adresu**
i przy wyczerpaniu limitu prób. Codzienne wejścia z tego samego komputera są
ciche — inaczej alert stałby się tłem.

Wpisy `zle-haslo` z obcych adresów przy panelu wystawionym publicznie są
normalne, to skanery. Niepokojące jest `ok` z adresu, którego nie kojarzysz.

## Wystawienie na zewnątrz

```
tailscale serve --bg 3000            # tylko tailnet
tailscale funnel --bg 3000           # otwarty internet
tailscale funnel --https=443 off     # wycofanie
```

Nazwa hosta jest w publicznych logach przejrzystości certyfikatów, więc adresu
nie da się utrzymać w tajemnicy — jedyną ochroną jest hasło.

Serwer nasłuchuje wyłącznie na `127.0.0.1`, więc bez Tailscale'a nie ma go
w sieci lokalnej. To celowe.

## Kopia zapasowa

Patrz `wdrozenie/README.md` §5. Dwie rzeczy warte zapamiętania:

- **Nie kopiuj samego `studio.db`** — baza chodzi w WAL, świeże zapisy leżą
  w dzienniku. Sprawdzone: `cp` bazy z 500 wierszami dał plik, w którym tabela
  nie istniała.
- Kopia na tym samym dysku nie chroni przed awarią dysku. Wskaż nośnik
  zewnętrzny albo włącz Time Machine.

## Gdy coś nie działa

**Panel zwraca 503 z `DATABASE_UNAVAILABLE`** — plik bazy jest uszkodzony albo
dysk pełny. Odtwórz z kopii.

**`/api/health` pokazuje „Baza zleceń: błąd"** — to samo, tylko wcześniej
zauważone.

**Panel nie startuje z komunikatem o bramce logowania** — brakuje
`STUDIO_PASSWORD_HASH` albo `STUDIO_SESSION_SECRET` ma mniej niż 32 znaki.
To zachowanie celowe: brak hasła zatrzymuje start, zamiast po cichu otwierać
panel. Świadome wyłączenie to `STUDIO_REQUIRE_LOGIN=0`.

**Zadania stoją w kolejce** — jedno zadanie GPU naraz, generowanie czterech
wariantów trwa około dwóch minut. Sprawdź `npm run dostep -- wejscia`, czy ktoś
nie zamawia hurtem.

## Czego świadomie nie ma

- **darktable** — cask wyłączony 01.09.2026, nie przechodzi Gatekeepera.
  Kod adaptera jest, nie uruchomiony ani razu.
- **ComfyUI** — backendem jest mflux (decyzja D5). Oficjalna ścieżka ComfyUI
  dla FLUX.2 klein wymaga fp8, nieużywalnego na MPS.
- **Klucz API Anthropic** — warstwa promptowa działa przez Claude Code CLI na
  subskrypcji, klucz jest opcjonalny.

## Dziennik decyzji

`dziennik/DECYZJE.md` — każde odstępstwo od `SPEC.md` z powodem i pomiarem.
Zanim zmienisz coś, co wygląda na dziwne, sprawdź, czy nie jest tam opisane.
