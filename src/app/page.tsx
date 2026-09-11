import { Kafelki } from '@/components/studio/Kafelki'
import { env, hasFastVideo, requiresLogin } from '@/lib/env'
import { ktoZalogowany } from '@/server/services/kto'

/**
 * Ekran wyboru narzędzia.
 *
 * `force-dynamic` z tego samego powodu co przy ekranie roboczym: bez tego
 * Next zapiekłby w stronie `AUTO_LOGOUT_SECONDS` z chwili budowania i zmiana
 * w `.env` nie miałaby skutku nawet po restarcie.
 */
export const dynamic = 'force-dynamic'

export default async function Home() {
  return (
    <Kafelki
      autoLogoutSeconds={requiresLogin ? env.AUTO_LOGOUT_SECONDS : 0}
      kto={await ktoZalogowany()}
      niedostepne={hasFastVideo ? [] : ['wideo']}
    />
  )
}
