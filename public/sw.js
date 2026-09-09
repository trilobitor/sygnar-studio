/*
 * Service worker istnieje po to, żeby przeglądarka uznała panel za możliwy
 * do zainstalowania (SPEC §44 — „PWA instalowalna na laptopie grafika").
 * Chrome i Edge wymagają do tego zarejestrowanego workera z obsługą `fetch`.
 *
 * Świadomie NIE cache'ujemy niczego. Panel bez serwera i tak jest bezużyteczny
 * — nie wygeneruje kadru ani nie zmontuje filmu — a cache app shellu oznaczałby
 * klasyczną pułapkę: po przebudowie grafik dostaje stary JavaScript do nowego
 * API i widzi błędy, których nie ma. Przepuszczamy żądania bez zmian.
 */

self.addEventListener('install', () => {
  // Nowa wersja przejmuje kontrolę od razu, bez czekania na zamknięcie kart.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Sprzątanie po ewentualnych starszych wersjach, gdyby kiedyś coś
      // cache'owały. Dziś nie ma czego usuwać, ale zostawiamy furtkę.
      const nazwy = await caches.keys()
      await Promise.all(nazwy.map((nazwa) => caches.delete(nazwa)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
