import type { NextConfig } from "next";

/**
 * Nagłówki ochronne i wyciszenie `X-Powered-By`.
 *
 * Panel stoi w internecie za `tailscale funnel`, więc odpowiedzi trafiają też
 * do skanerów. `X-Powered-By: Next.js` mówi im, czego szukać; reszta nagłówków
 * odbiera przeglądarce swobodę, której panel nie potrzebuje.
 *
 * CSP jest celowo wąskie: aplikacja nie ładuje niczego z zewnątrz — kroje idą
 * przez `next/font` jako pliki lokalne, a jedyne obrazy pochodzą z naszego
 * własnego endpointu. `'unsafe-inline'` dla stylów jest wymuszone przez
 * Tailwind i Next, które wstrzykują style w atrybucie.
 */
const naglowkiOchronne = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      // `unsafe-eval` odpada — Next w trybie produkcyjnym go nie potrzebuje.
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // Nazwa i wersja frameworka to darmowa podpowiedź dla skanera.
  poweredByHeader: false,

  /*
   * Katalog wyniku budowania da się przestawić zmienną środowiskową.
   *
   * Domyślny `.next` jest wspólny dla budowania i dla `next start`, więc
   * przebudowa podmienia pliki pod nogami działającemu panelowi — a ten
   * doczytuje fragmenty z dysku leniwie i zaczyna oddawać 404 na kawałki,
   * które grafik ma właśnie otwarte. Osobny katalog pozwala zbudować nową
   * wersję obok, sprawdzić ją na innym porcie i dopiero potem przełączyć.
   */
  distDir: process.env.STUDIO_DIST_DIR ?? '.next',
  /*
   * Uwaga przy używaniu: budowanie z ustawionym `STUDIO_DIST_DIR` przepisuje
   * `next-env.d.ts` i `tsconfig.json` na ten katalog. Po zbudowaniu wersji
   * obocznej trzeba je cofnąć (`git checkout next-env.d.ts tsconfig.json`),
   * inaczej wjadą do commita i zepsują zwykłe budowanie.
   */

  async headers() {
    return [{ source: '/:path*', headers: naglowkiOchronne }]
  },
};

export default nextConfig;
