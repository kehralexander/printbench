/**
 * How a spool used by a print is named, everywhere a print is listed.
 *
 * A filament is often named after its colour ("Galaxy Black", colour "Galaxy
 * Black"), so the parts are joined only when they add something: a part equal
 * to, or already contained in, an earlier one is dropped.
 */
export function usageLabel(snapshot: {
  spoolLabel?: string | null
  name: string
  colorName?: string | null
}): string {
  const parts: string[] = []
  for (const part of [snapshot.spoolLabel, snapshot.name, snapshot.colorName]) {
    const text = part?.trim()
    if (!text) continue
    const lower = text.toLowerCase()
    if (parts.some((earlier) => earlier.toLowerCase().includes(lower))) continue
    parts.push(text)
  }
  return parts.join(' · ')
}

/** Grams across all spools, to tell whether a separate total says anything new. */
export function usageTotal(usage: readonly { grams: number }[]): number {
  return usage.reduce((sum, row) => sum + row.grams, 0)
}
