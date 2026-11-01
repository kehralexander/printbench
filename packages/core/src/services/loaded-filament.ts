import type { FilamentSlot } from './printer-status'

/**
 * Whether what a request asks for is loaded on any printer right now.
 *
 * A Spoolman spool is the exact question — is that spool in a slot — and is
 * answered that way whenever the printer reports spool ids. Otherwise it is a
 * looser one: the same kind of material, in a colour close enough that a
 * person would call it the same.
 */

export interface PrinterSlots {
  printerName: string
  slots: FilamentSlot[]
}

export type LoadedVerdict =
  | { loaded: true; printerName: string; slot: FilamentSlot }
  | {
      loaded: false
      /** What is loaded instead, to show next to the warning. */
      instead: FilamentSlot[]
    }

export interface WantedFilament {
  material: string | null
  colorHex: string | null
  spoolmanSpoolId: number | null
}

/**
 * Red, green and blue each 0–255, so the distance runs to ~441. Under this,
 * "Matte Navy" and "Navy Blue" match; black and dark grey do too, which is
 * what a person means by "the black one".
 */
const SAME_COLOUR_DISTANCE = 80

/** Null when there is nothing to compare: no printer reports slots, or nothing was asked for. */
export function loadedFilament(
  wanted: WantedFilament,
  printers: PrinterSlots[],
): LoadedVerdict | null {
  const withSlots = printers.filter((printer) => printer.slots.length > 0)
  if (withSlots.length === 0) return null
  if (wanted.spoolmanSpoolId == null && !wanted.material && !wanted.colorHex) return null

  const loaded = withSlots.flatMap((printer) =>
    printer.slots.filter((slot) => slot.loaded).map((slot) => ({ printer, slot })),
  )

  if (wanted.spoolmanSpoolId != null) {
    const exact = loaded.find(({ slot }) => slot.spoolmanSpoolId === wanted.spoolmanSpoolId)
    if (exact) return { loaded: true, printerName: exact.printer.printerName, slot: exact.slot }
    // The printer tracks spools and that one is not among them: no need to guess.
    if (loaded.some(({ slot }) => slot.spoolmanSpoolId != null)) {
      return { loaded: false, instead: loaded.map(({ slot }) => slot) }
    }
  }

  const match = loaded.find(({ slot }) => sameFilament(wanted, slot))
  if (match) return { loaded: true, printerName: match.printer.printerName, slot: match.slot }
  return { loaded: false, instead: loaded.map(({ slot }) => slot) }
}

function sameFilament(wanted: WantedFilament, slot: FilamentSlot): boolean {
  if (
    wanted.material &&
    slot.material &&
    materialFamily(wanted.material) !== materialFamily(slot.material)
  ) {
    return false
  }
  if (wanted.colorHex && slot.colorHex) {
    return colourDistance(wanted.colorHex, slot.colorHex) <= SAME_COLOUR_DISTANCE
  }
  // Only one side says anything; a material match alone is the best there is.
  return Boolean(wanted.material && slot.material)
}

/** "PLA Matte", "PLA+", "pla silk" → "PLA"; "PETG-CF" → "PETG". */
export function materialFamily(material: string): string {
  const first =
    material
      .trim()
      .toUpperCase()
      .split(/[\s\-_/]+/)[0] ?? ''
  return first.replace(/[^A-Z0-9]/g, '')
}

export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '').padEnd(6, '0')
  return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16) || 0) as [
    number,
    number,
    number,
  ]
}
