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
curl -s http://localhost:3000/api/zyje    # {"ok":true} = proces żyje
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

## 3c. Alerty

Panel sam wysyła powiadomienie macOS przy logowaniu z nieznanego dotąd adresu
i przy wyczerpaniu limitu prób. Nie trzeba nic obserwować.

Historię przejrzysz w razie potrzeby: `npm run dostep -- wejscia 30`.
Kolumny to czas, wynik (`ok`, `zle-haslo`, `limit`), imię i skrót adresu
klienta. Wpisy `zle-haslo` z obcych skrótów przy publicznie wystawionym panelu
są normalne — to skanery. Niepokojące jest `ok` z adresu, którego nie
rozpoznajesz.

## 4. Instalacja PWA na laptopie grafika

1. Otwórz adres z Tailscale w Edge albo Chrome.
2. Menu przeglądarki → „Zainstaluj aplikację".
3. Ikona ląduje na pulpicie i otwiera panel w oknie bez paska adresu.

Manifest leży w `src/app/manifest.webmanifest`, ikony w `public/`.

## 5. Kopia zapasowa

```
npm run kopia                       # do ~/Sygnar/kopie
npm run kopia -- /Volumes/Dysk      # na dysk zewnętrzny — zalecane
```

Skrypt robi spójny zrzut bazy przez `database.backup()` i synchronizuje
`orders/` przez `rsync`. Na koniec **otwiera zrobioną kopię i przepuszcza ją
przez `quick_check`** — kopia, której nie da się otworzyć, jest bezwartościowa,
a wychodzi to na jaw dopiero przy odtwarzaniu.

Retencja: 7 kopii dziennych i po jednej z każdego z 4 ostatnich tygodni.

**Nie kopiuj samego pliku `studio.db`.** Baza chodzi w trybie WAL, więc świeże
zapisy leżą w dzienniku, nie w pliku głównym. Sprawdzone: `cp` bazy z 500
wierszami dał kopię, w której tabela w ogóle nie istniała.

### Automat

```
sed -e "s|__SCIEZKA_NODE__|$(which node)|" \
    -e "s|__SCIEZKA_PROJEKTU__|$(pwd)|" \
    -e "s|__KATALOG_KOPII__|$HOME/Sygnar/kopie|" \
    -e "s|__KATALOG_LOGOW__|$HOME/Library/Logs|" \
    wdrozenie/pl.sygnar.kopia.plist > ~/Library/LaunchAgents/pl.sygnar.kopia.plist
plutil -lint ~/Library/LaunchAgents/pl.sygnar.kopia.plist
launchctl load ~/Library/LaunchAgents/pl.sygnar.kopia.plist
```

### Odtworzenie

```
cp -R ~/Sygnar/kopie/<data>/. "$STUDIO_DATA_DIR"/
```

Sprawdzone na żywo: panel uruchomiony na odtworzonej kopii pokazał komplet
zleceń i wydał zarówno kadr, jak i zmontowane wideo.

### Czego to nie załatwia

Kopia na tym samym dysku nie chroni przed awarią dysku. Wskaż katalog na
nośniku zewnętrznym albo włącz Time Machine — dziś `tmutil destinationinfo`
odpowiada „No destinations configured".

## 6. Aktualizacja i wycofanie

```
launchctl unload ~/Library/LaunchAgents/pl.sygnar.studio.plist
npm run kopia                     # zawsze przed aktualizacją
git pull
npm ci
npm run db:migrate
npm run typecheck && npm run lint && npx vitest run
mv .next .next.poprzedni          # zapasowa kopia builda
npm run build
launchctl load -w ~/Library/LaunchAgents/pl.sygnar.studio.plist
curl -s http://localhost:3000/api/zyje
```

Każdy krok ma przejść, zanim ruszysz dalej. Testy **przed** buildem, bo
nieudany test przy zatrzymanej usłudze to kilka minut przestoju, a nieudany
build po podmianie `.next` — panel, który się nie podnosi.

### Wycofanie

```
launchctl unload ~/Library/LaunchAgents/pl.sygnar.studio.plist
git checkout <poprzedni-commit>
npm ci
rm -rf .next && mv .next.poprzedni .next
launchctl load -w ~/Library/LaunchAgents/pl.sygnar.studio.plist
```

**Migracje bazy nie cofają się same.** Drizzle nie generuje migracji wstecznych,
więc powrót do wersji sprzed zmiany schematu wymaga odtworzenia bazy z kopii
(§5). Dlatego kopia przed aktualizacją nie jest opcjonalna.

## 7. Testy

```
npm run typecheck && npm run lint && npx vitest run
E2E_VIDEO_FIXTURE="$(pwd)/e2e/materialy/klip.mp4" npx playwright test
npm run test:coverage         # pokrycie z progami
```

E2E biegnie na osobnym katalogu `.e2e-dane` i porcie 3100 — nigdy nie dotyka
danych grafika. Bez zmiennej `E2E_VIDEO_FIXTURE` scenariusz montażu jest
pomijany.

## 8. Logi

Usługa pisze do `~/Library/Logs/sygnar-studio.log`. Plik rośnie bez
ograniczenia, bo proces chodzi tygodniami i loguje każdą zmianę postępu —
dlatego warto włączyć rotację:

```
sed "s|__KATALOG_LOGOW__|$HOME/Library/Logs|" \
    wdrozenie/pl.sygnar.studio.newsyslog.conf \
  | sudo tee /etc/newsyslog.d/pl.sygnar.studio.conf > /dev/null
sudo newsyslog -nv          # podgląd bez zmian
```

Przeglądanie na bieżąco:

```
tail -f ~/Library/Logs/sygnar-studio.log | grep -v '"level":"debug"'
```

Log jest w formacie JSON po jednym wpisie na linię, więc da się go filtrować:

```
grep '"level":"error"' ~/Library/Logs/sygnar-studio.log | tail -20
```

## 9. Czujnik awarii

Bez niego jedynym czujnikiem jest grafik: dowiaduje się, że stacja padła,
dopiero próbując z niej skorzystać.

```
sed "s|__KATALOG_LOGOW__|$HOME/Library/Logs|" \
    wdrozenie/pl.sygnar.czujnik.plist > ~/Library/LaunchAgents/pl.sygnar.czujnik.plist
launchctl load ~/Library/LaunchAgents/pl.sygnar.czujnik.plist
```

Co dziesięć minut pyta `/api/zyje` i przy braku odpowiedzi wyświetla
powiadomienie macOS. Endpoint jest publiczny i nie zdradza niczego o maszynie,
więc czujnik nie potrzebuje ciasteczka sesji.

**Czego to nie łapie:** panel odpowiadający, ale z martwą bazą albo pełnym
dyskiem. Na to jest `/api/health`, który wymaga zalogowania — świadomie,
patrz D38.

## Czego tu nie ma

**Usługi `launchd` dla ComfyUI nie ma i nie będzie w tej wersji.** Backendem
generowania jest mflux uruchamiany na żądanie przez panel (decyzja D5),
więc nie ma osobnego procesu do pilnowania. Gdy ComfyUI wejdzie jako druga
implementacja adaptera, dojdzie druga usługa.

Blokada usypiania nie jest usługą — `caffeinate` startuje razem z każdym
zadaniem GPU i gaśnie razem z nim (`src/server/queue/keep-awake.ts`).
