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

/** One wanted filament and the slot it was found in. */
export interface LoadedMatch {
  filament: WantedFilament
  slot: FilamentSlot
}

export type LoadedVerdict =
  | {
      loaded: true
      printerName: string
      /** The first filament's slot, for the one-filament case. */
      slot: FilamentSlot
      /** Every filament asked for, with its slot. */
      matches: LoadedMatch[]
    }
  | {
      loaded: false
      /** What is not in the printer that comes closest, to name in the warning. */
      missing: WantedFilament[]
      /** What is loaded instead, to show next to the warning. */
      instead: FilamentSlot[]
    }

export interface WantedFilament {
  material: string | null
  colorHex: string | null
  spoolmanSpoolId: number | null
  /** "Galaxy Black", for naming what is missing. */
  colorName?: string | null
}

/**
 * Red, green and blue each 0–255, so the distance runs to ~441. Under this,
 * "Matte Navy" and "Navy Blue" match; black and dark grey do too, which is
 * what a person means by "the black one".
 */
const SAME_COLOUR_DISTANCE = 80

/**
 * How far off a slot's colour must be before it outweighs the spool bound to
 * it. Printers report a colour from their own palette, not the spool's: teal
 * #74cdc7 comes back as #23a3c7 (~91 apart), while a wrong spool — yellow in a
 * white slot — is ~250 apart. Between the two lies "the printer rounded it".
 */
const CONTRADICTING_COLOUR_DISTANCE = 160

/** Whether a filament row asks for anything at all; an empty one is "any". */
export function namesFilament(wanted: WantedFilament): boolean {
  return wanted.spoolmanSpoolId != null || Boolean(wanted.material) || Boolean(wanted.colorHex)
}

/**
 * Whether every filament a request asks for is loaded on one printer — a
 * two-colour print needs both colours in the same machine, not one in each.
 *
 * Null when there is nothing to compare: no printer reports slots, or nothing
 * was asked for. Otherwise the printer that has them all, or, when none does,
 * the filaments missing from the printer that comes closest.
 */
export function loadedFilament(
  wanted: WantedFilament | readonly WantedFilament[],
  printers: PrinterSlots[],
): LoadedVerdict | null {
  const withSlots = printers.filter((printer) => printer.slots.length > 0)
  if (withSlots.length === 0) return null
  const asked = (Array.isArray(wanted) ? wanted : [wanted as WantedFilament]).filter(namesFilament)
  if (asked.length === 0) return null

  let best: { printer: PrinterSlots; matches: LoadedMatch[]; missing: WantedFilament[] } | null =
    null
  for (const printer of withSlots) {
    const loaded = printer.slots.filter((slot) => slot.loaded)
    const matches: LoadedMatch[] = []
    const missing: WantedFilament[] = []
    for (const filament of asked) {
      const slot = findSlot(filament, loaded)
      if (slot) matches.push({ filament, slot })
      else missing.push(filament)
    }
    if (missing.length === 0) {
      return { loaded: true, printerName: printer.printerName, slot: matches[0]!.slot, matches }
    }
    if (!best || missing.length < best.missing.length) best = { printer, matches, missing }
  }

  const instead = withSlots.flatMap((printer) => printer.slots.filter((slot) => slot.loaded))
  return { loaded: false, missing: best!.missing, instead }
}

/**
 * A Spoolman spool is the exact question — is that spool in a slot — and is
 * answered that way whenever the printer reports spool ids. Otherwise it is a
 * looser one: the same kind of material, in a colour close enough.
 */
function findSlot(wanted: WantedFilament, loaded: FilamentSlot[]): FilamentSlot | null {
  if (wanted.spoolmanSpoolId != null) {
    const exact = loaded.find(
      (slot) => slot.spoolmanSpoolId === wanted.spoolmanSpoolId && !contradicts(wanted, slot),
    )
    if (exact) return exact
    // The printer tracks spools and that one is not among them: no need to guess.
    if (loaded.some((slot) => slot.spoolmanSpoolId != null)) return null
  }
  return loaded.find((slot) => sameFilament(wanted, slot)) ?? null
}

/**
 * Whether a slot plainly holds something else than what is wanted: another
 * material family, or a colour far off — further than a printer's palette
 * would round it. A slot's spool binding outlives the
 * spool — swap white in where spool #14 (yellow) was and the bridge can still
 * report #14 — so a spool id only counts while what the slot reports agrees.
 */
export function contradicts(
  wanted: { material?: string | null; colorHex?: string | null },
  slot: FilamentSlot,
): boolean {
  if (
    wanted.material &&
    slot.material &&
    materialFamily(wanted.material) !== materialFamily(slot.material)
  ) {
    return true
  }
  return Boolean(
    wanted.colorHex &&
    slot.colorHex &&
    colourDistance(wanted.colorHex, slot.colorHex) > CONTRADICTING_COLOUR_DISTANCE,
  )
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
