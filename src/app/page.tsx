import { StudioScreen } from '@/components/studio/StudioScreen'

/** Ekran roboczy bez wybranego zlecenia — lista po lewej czeka na wybór. */
export default function Home() {
  return <StudioScreen initialOrderId={null} />
}
