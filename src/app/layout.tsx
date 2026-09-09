import type { Metadata, Viewport } from 'next'
import { Fraunces, Geist, Geist_Mono } from 'next/font/google'

import { RejestrujSW } from '@/components/studio/RejestrujSW'

import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'latin-ext'] })

// Krój szeryfowy marki (brief §4.3). Osie zmienne zostają domyślne —
// w Sygnarze nie używamy „wonky".
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin', 'latin-ext'],
  weight: ['600'],
})

export const metadata: Metadata = {
  title: 'Sygnar Studio',
  description: 'Panel do grafiki i wideo — brief, kadry, montaż, eksport.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Sygnar Studio', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  themeColor: '#141414',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Zmienne krojów siedzą na `html`, nie na `body` — `--font-serif`
    // z bloku `@theme` rozwiązuje się na `:root`, więc na `body` byłyby
    // dla niego niewidoczne i znak wychodziłby krojem zastępczym.
    <html lang="pl" className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <body className="antialiased">
        <RejestrujSW />
        {children}
      </body>
    </html>
  )
}
