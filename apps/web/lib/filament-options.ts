import { listFilaments } from '@pb/core'
import type { Database } from '@pb/db'

/** One pickable material and colour, as the queue's picker shows it. */
export interface FilamentOption {
  id: string
  label: string
  material: string
  colorName: string | null
  colorHex: string | null
}

/**
 * The filaments on hand, as material-and-colour choices for a print request.
 *
 * Archived filaments are left out — nobody should be asked for a colour that
 * ran out last year — and two brands of the same material and colour collapse
 * into one choice, since a request names a look, not a supplier.
 */
export async function filamentOptions(db: Database): Promise<FilamentOption[]> {
  const seen = new Set<string>()
  const options: FilamentOption[] = []

  for (const filament of await listFilaments(db)) {
    if (filament.archived) continue
    const colorName = filament.colorName?.trim() || null
    const colorHex = filament.colorHex?.toLowerCase() || null
    const key = [filament.material.toLowerCase(), colorName?.toLowerCase(), colorHex].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      id: filament.id,
      label: [filament.material, colorName ?? filament.name].join(' · '),
      material: filament.material,
      colorName,
      colorHex,
    })
  }

  return options.sort((a, b) => a.label.localeCompare(b.label))
}
