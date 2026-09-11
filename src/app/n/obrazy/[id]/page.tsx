import { env, hasFastVideo, requiresLogin } from '@/lib/env'
import { ktoZalogowany } from '@/server/services/kto'
import { StudioScreen } from '@/components/studio/StudioScreen'

/**
 * Ekran zlecenia wymaga renderowania na żądanie.
 *
 * Bez tego Next prerenderuje stronę przy budowaniu i zapieka w niej
 * `AUTO_LOGOUT_SECONDS` z chwili builda — zmiana w `.env` nie miałaby
 * wtedy żadnego skutku, nawet po restarcie. Wykryte pomiarem: serwer
 * uruchomiony z inną wartością i tak podawał tę z builda.
 */
export const dynamic = 'force-dynamic'

/** Ten sam ekran roboczy, ale z otwartym konkretnym zleceniem. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <StudioScreen
      initialOrderId={id}
      autoLogoutSeconds={requiresLogin ? env.AUTO_LOGOUT_SECONDS : 0}
      kto={await ktoZalogowany()}
      wideoDostepne={hasFastVideo}
    />
  )
}
