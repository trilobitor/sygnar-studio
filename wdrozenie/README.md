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

Najpierw **raz na tailnet**: w panelu admina `login.tailscale.com/admin/dns`
włącz MagicDNS i *HTTPS Certificates*. Bez tego `tailscale cert` odpowiada
`your Tailscale account does not support getting TLS certs`, a `serve` nie
wystawi HTTPS.

```
tailscale serve --bg 3000
tailscale serve status
```

Panel jest wtedy pod `https://<nazwa-maszyny>.<tailnet>.ts.net` — tylko dla
urządzeń w tailnecie, nie dla całego internetu. Publiczne wystawienie to
osobne polecenie (`tailscale funnel`) i osobna decyzja.

**Zweryfikowane 09.09.2026** na `macbook-pro-kamil.tailbd8aac.ts.net`:
certyfikat od Let's Encrypt (CN=YE2), HTTP/2, `window.isSecureContext`
prawdziwy, service worker aktywny. Komplet warunków instalacji PWA spełniony
— pozycja z listy „Otwarte i niezweryfikowane" w `CLAUDE.md` jest zamknięta.

Serwer nasłuchuje wyłącznie na `127.0.0.1` (decyzja D20), więc `serve` jest
jedynym wejściem z zewnątrz. Adres sieci lokalnej i sam adres IP tailnetu
z portem 3000 odmawiają połączenia — to zamierzone.

## 3b. Wystawienie publiczne (Funnel)

`tailscale serve` udostępnia panel wyłącznie urządzeniom w tailnecie. Żeby
wpuścić kogoś bez Tailscale'a, trzeba Funnela — to jest **otwarty internet**,
adres pod tą samą nazwą.

Raz na tailnet trzeba go włączyć linkiem, który poda samo polecenie:

```
tailscale funnel --bg 3000
tailscale funnel status
tailscale funnel --https=443 off     # wycofanie
```

Zanim to zrobisz, pamiętaj: nazwa hosta jest w publicznych logach
przejrzystości certyfikatów, więc adresu nie da się utrzymać w tajemnicy.
Jedyną ochroną zostaje hasło — patrz §3a.

## 3a. Kto ma dostęp

```
npm run dostep -- lista
npm run dostep -- dodaj Oliwia      # hasło podaje się na wejściu, nie w argumencie
npm run dostep -- odbierz Oliwia    # działa natychmiast, nie po wygaśnięciu ciasteczka
npm run dostep -- przywroc Oliwia
npm run dostep -- wejscia 30        # log prób logowania
```

Logowanie pyta wyłącznie o hasło — panel sam rozpoznaje, czyje ono jest, i pokazuje
imię obok ikony wylogowania. Dwie osoby nie mogą mieć tego samego hasła.

Hasło z `STUDIO_PASSWORD_HASH` przenosi się do tabeli osób raz, przy pierwszym
starcie po tej zmianie, pod imieniem z `STUDIO_OWNER_NAME`.

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
