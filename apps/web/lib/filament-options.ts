import { describeSpoolmanSpool, listFilaments, listSpoolmanSpools, spoolmanEnabled } from '@pb/core'
import type { Database } from '@pb/db'

/** One pickable material and colour, as the queue's picker shows it. */
export interface FilamentOption {
  id: string
  label: string
  material: string
  colorName: string | null
  colorHex: string | null
  /** Set when the option is a Spoolman spool rather than a filament type. */
  spoolmanSpoolId?: number
  /** Picker group heading. */
  group: string
}

/**
 * The material-and-colour choices for a print request.
 *
 * With Spoolman configured these are its spools — the physical ones, since a
 * request for "the navy on the printer" means that spool — grouped by where
 * they are. Empty and archived spools are left out. Spoolman being down gives
 * an empty list, leaving the picker's free-text "Other…"; PrintBench's own
 * inventory is never offered in its place.
 *
 * Without Spoolman these are PrintBench's own filaments on hand, with two
 * brands of the same material and colour collapsed into one choice, since a
 * request names a look, not a supplier.
 */
export async function filamentOptions(db: Database): Promise<FilamentOption[]> {
  if (spoolmanEnabled()) {
    const result = await listSpoolmanSpools()
    if (!result.ok) return []
    return result.spools
      .filter((spool) => !spool.archived && (spool.remainingG == null || spool.remainingG > 0))
      .map((spool) => ({
        id: `spoolman-${spool.id}`,
        label: [
          describeSpoolmanSpool(spool),
          `#${spool.id}`,
          spool.remainingG != null ? `${Math.round(spool.remainingG)} g` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        material: spool.material ?? '',
        colorName: spool.filamentName,
        colorHex: spool.colorHex,
        spoolmanSpoolId: spool.id,
        group: spool.location ?? 'No location',
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  }

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
      group: 'On hand',
    })
  }

  return options.sort((a, b) => a.label.localeCompare(b.label))
}
