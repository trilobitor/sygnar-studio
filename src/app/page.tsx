import { env, requiresLogin } from '@/lib/env'
import { StudioScreen } from '@/components/studio/StudioScreen'

/** Ekran roboczy bez wybranego zlecenia — lista po lewej czeka na wybór. */
export default function Home() {
  // Wartość idzie propem z serwera, a nie zmienną `NEXT_PUBLIC_` —
  // `SPEC.md` §11 zabrania tego prefiksu w tym projekcie.
  return (
    <StudioScreen
      initialOrderId={null}
      autoLogoutSeconds={requiresLogin ? env.AUTO_LOGOUT_SECONDS : 0}
    />
  )
}
