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
export function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 px-2 pt-1 pb-3">
      <span className="font-serif text-lg font-semibold tracking-[0.16em] text-ink">
        SYGNAR<span className="text-accent">.</span>
      </span>
      <span className="font-serif text-lg font-semibold tracking-[0.02em] text-studio">
        Studio
      </span>
    </div>
  )
}
