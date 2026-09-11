import { permanentRedirect } from 'next/navigation'

/**
 * Stary adres szczegółu zlecenia.
 *
 * Przekierowanie jest obowiązkowe, nie kosmetyczne: grafik ma te adresy
 * w zakładkach, a panel jest zainstalowany jako aplikacja na pulpicie (PWA),
 * więc stary adres siedzi też w skrócie. `permanentRedirect` daje 308, czyli
 * przeglądarka zapamięta zmianę i przestanie pytać.
 */
export default async function StareZlecenie({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  permanentRedirect(`/n/obrazy/${id}`)
}
