# Wdrożenie — etap E7

Trzy rzeczy, żeby grafik kliknął ikonę na pulpicie Windows i zobaczył panel.

## 1. Baza

Migracje stosują się same przy starcie serwera (`src/instrumentation.ts`),
ale przy pierwszej instalacji warto je puścić ręcznie i zobaczyć wynik:

```
npm run db:migrate
```

Komenda czyta `.env` sama i działa z dowolnego katalogu roboczego.

## 2. Panel jako usługa systemowa

```
npm run build

sed -e "s|__SCIEZKA_NODE__|$(which node)|" \
    -e "s|__SCIEZKA_PROJEKTU__|$PWD|" \
    -e "s|__KATALOG_LOGOW__|$HOME/Library/Logs|" \
    wdrozenie/pl.sygnar.studio.plist > ~/Library/LaunchAgents/pl.sygnar.studio.plist

plutil -lint ~/Library/LaunchAgents/pl.sygnar.studio.plist
launchctl load -w ~/Library/LaunchAgents/pl.sygnar.studio.plist
```

Sprawdzenie — **oba naraz**, bo sam `curl` wprowadza w błąd, gdy serwer
chodzi jeszcze uruchomiony ręcznie:

```
launchctl print gui/$(id -u)/pl.sygnar.studio | grep -E "state|last exit"
curl http://127.0.0.1:3000/api/health
```

## 3. Dostęp przez Tailscale

```
tailscale serve --bg 3000
tailscale serve status
```

**[NIEZWERYFIKOWANE]** Czy `tailscale serve` daje HTTPS z zaufanym
certyfikatem, bez którego PWA się nie zainstaluje, nie zostało sprawdzone
na tej maszynie — Tailscale nie jest tu zainstalowany. To pozycja z listy
„Otwarte i niezweryfikowane" w `CLAUDE.md` i wymaga potwierdzenia przed
oddaniem panelu grafikowi.

Jeśli okaże się, że certyfikatu nie ma, alternatywą jest `tailscale cert`
i podanie certyfikatu wprost do serwera — ale to zmiana w konfiguracji,
nie w kodzie.

## 4. Instalacja PWA na laptopie grafika

1. Otwórz adres z Tailscale w Edge albo Chrome.
2. Menu przeglądarki → „Zainstaluj aplikację".
3. Ikona ląduje na pulpicie i otwiera panel w oknie bez paska adresu.

Manifest leży w `src/app/manifest.webmanifest`, ikony w `public/`.

## Czego tu nie ma

**Usługi `launchd` dla ComfyUI nie ma i nie będzie w tej wersji.** Backendem
generowania jest mflux uruchamiany na żądanie przez panel (decyzja D5),
więc nie ma osobnego procesu do pilnowania. Gdy ComfyUI wejdzie jako druga
implementacja adaptera, dojdzie druga usługa.

Blokada usypiania nie jest usługą — `caffeinate` startuje razem z każdym
zadaniem GPU i gaśnie razem z nim (`src/server/queue/keep-awake.ts`).
