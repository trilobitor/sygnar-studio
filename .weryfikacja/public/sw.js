/*
 * Service worker istnieje po to, żeby przeglądarka uznała panel za możliwy
 * do zainstalowania (SPEC §44 — „PWA instalowalna na laptopie grafika").
 * Chrome i Edge wymagają do tego zarejestrowanego workera z obsługą `fetch`.
 *
 * Świadomie NIE cache'ujemy aplikacji. Panel bez serwera i tak jest
 * bezużyteczny — nie wygeneruje kadru ani nie zmontuje filmu — a cache app
 * shellu oznaczałby klasyczną pułapkę: po przebudowie grafik dostaje stary
 * JavaScript do nowego API i widzi błędy, których nie ma.
 *
 * Jedynym wyjątkiem jest strona zastępcza `/offline.html`, pokazywana przy
 * **nawigacji** bez połączenia. Wcześniej grafik widział w tej sytuacji
 * systemowy ekran przeglądarki po angielsku, bez wskazówki, co robić.
 */
const STRONA_OFFLINE = '/offline.html'
const CACHE = 'sygnar-offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.add(STRONA_OFFLINE)
    })(),
  )

  // Nowa wersja przejmuje kontrolę od razu, bez czekania na zamknięcie kart.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Sprzątanie po starszych wersjach cache'u — zostawiamy tylko bieżącą.
      const nazwy = await caches.keys()
      await Promise.all(nazwy.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  // Tylko nawigacja dostaje stronę zastępczą. Żądania danych mają zawieść
  // normalnie — panel umie pokazać własny baner „nie mam kontaktu ze stacją",
  // a podstawienie im czegokolwiek byłoby kłamstwem.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request)
        } catch {
          const cache = await caches.open(CACHE)
          const zastepcza = await cache.match(STRONA_OFFLINE)
          return zastepcza ?? Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(fetch(event.request))
})
