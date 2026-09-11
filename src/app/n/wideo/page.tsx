import { env, hasFastVideo, requiresLogin } from '@/lib/env'
import { ktoZalogowany } from '@/server/services/kto'
import { StudioScreen } from '@/components/studio/StudioScreen'

/**
 * Ekran roboczy wymaga renderowania na żądanie.
 *
 * Bez tego Next prerenderuje stronę przy budowaniu i zapieka w niej
 * `AUTO_LOGOUT_SECONDS` z chwili builda — zmiana w `.env` nie miałaby
 * wtedy żadnego skutku, nawet po restarcie. Wykryte pomiarem: serwer
 * uruchomiony z inną wartością i tak podawał tę z builda.
 */
export const dynamic = 'force-dynamic'

/** Ekran roboczy narzędzia wideo — ten sam co dla obrazów, inne pierwszeństwo działań. */
export default async function Home() {
  // Wartość idzie propem z serwera, a nie zmienną `NEXT_PUBLIC_` —
  // `SPEC.md` §11 zabrania tego prefiksu w tym projekcie.
  return (
    <StudioScreen
      initialOrderId={null}
      autoLogoutSeconds={requiresLogin ? env.AUTO_LOGOUT_SECONDS : 0}
      kto={await ktoZalogowany()}
      narzedzie="wideo"
      wideoDostepne={hasFastVideo}
    />
  )
}
