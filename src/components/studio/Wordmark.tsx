/**
 * Znak marki w lewym górnym rogu.
 *
 * Sygnar **nie ma logo graficznego** — znakiem jest sama typografia,
 * sprawdzone w źródle sygnar.vercel.app:
 *
 *   <span className="font-serif text-xl font-semibold tracking-[0.16em]">
 *     SYGNAR<span className="text-primary">.</span>
 *   </span>
 *
 * Odwzorowuję to dokładnie: Fraunces semibold, wersaliki, rozstrzelenie
 * 0.16em, kropka w kolorze akcentu. Doklejam wyłącznie nazwę produktu.
 *
 * „Studio" idzie wrzosem — kolorem spoza palety marki, żeby narzędzie
 * wewnętrzne nie udawało szóstej branży.
 */
export function Wordmark({ size = 'default' }: { size?: 'default' | 'large' }) {
  const scale = size === 'large' ? 'text-3xl' : 'text-lg'
  const padding = size === 'large' ? '' : 'px-2 pt-1 pb-3'

  return (
    <div className={`flex items-baseline font-serif font-semibold ${scale} ${padding}`}>
      <span className="tracking-[0.16em] text-ink">SYGNAR</span>
      {/* Kropka bez rozstrzelenia. W tracked spanie ciągnęłaby za sobą
          2,88 px odstępu, przez co „Studio" odjeżdżało od znaku. */}
      <span className="text-accent">.</span>
      <span className="ml-1 tracking-[0.02em] text-studio">Studio</span>
    </div>
  )
}
