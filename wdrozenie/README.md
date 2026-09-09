# Wdrożenie — etap E7

Trzy rzeczy, żeby grafik kliknął ikonę na pulpicie Windows i zobaczył panel.

## 1. Panel jako usługa systemowa

```
npm run build
cp wdrozenie/pl.sygnar.studio.plist ~/Library/LaunchAgents/
# podmień <SCIEZKA_PROJEKTU> i <UZYTKOWNIK> w skopiowanym pliku
launchctl load -w ~/Library/LaunchAgents/pl.sygnar.studio.plist
```

Sprawdzenie: `curl http://127.0.0.1:3000/api/health`.

## 2. Dostęp przez Tailscale

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

## 3. Instalacja PWA na laptopie grafika

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
