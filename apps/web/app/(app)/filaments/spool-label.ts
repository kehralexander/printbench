import type { Spool } from '@pb/core'

/**
 * Brand, filament, material and colour — minus whatever the card's title
 * already says, which is often the filament's name or its colour.
 */
export function spoolSubtitle(s: Spool): string {
  const title = (s.label || s.filament.name).toLowerCase()
  const parts = [s.filament.brand, s.filament.name, s.filament.material, s.filament.colorName]
  const seen = new Set([title])
  return parts
    .filter((part): part is string => {
      if (!part || seen.has(part.toLowerCase())) return false
      seen.add(part.toLowerCase())
      return true
    })
    .join(' · ')
}
