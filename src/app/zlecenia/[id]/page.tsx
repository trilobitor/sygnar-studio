import { env, requiresLogin } from '@/lib/env'
import { StudioScreen } from '@/components/studio/StudioScreen'

/** Ten sam ekran roboczy, ale z otwartym konkretnym zleceniem. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <StudioScreen
      initialOrderId={id}
      autoLogoutSeconds={requiresLogin ? env.AUTO_LOGOUT_SECONDS : 0}
    />
  )
}
