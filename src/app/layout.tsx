import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'latin-ext'] })

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
    <html lang="pl">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  )
}
