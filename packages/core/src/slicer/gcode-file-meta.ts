/**
 * Everything known about a sliced file, in the shape model_files.slicer_meta
 * stores it.
 *
 * Put together from three readers: gcode-metadata (the print settings),
 * gcode-details (the summary and machine figures around them) and, when the
 * whole file was read, gcode-body-scan. Where two of them answer the same
 * question the more reliable one is chosen here, once, so every reader of the
 * column gets the same answer.
 *
 * The slicer's own cost figure is left out on purpose: it is priced with the
 * slicer's per-kilo setting, not with this instance's pricing, and a second
 * price that disagrees with ours is worse than none.
 */

import { parseGcodeMetadata, type GcodeMetadata } from './gcode-metadata'
import { parseGcodeDetails, type GcodeDetails, type GcodeExtents } from './gcode-details'
import { readGcodeTools } from './gcode-tools'
import type { GcodeBodyScan, GcodeWhen } from './gcode-body-scan'

/**
 * Bump when a reader learns something new. Every stored file with an older
 * version is read again by the maintenance sweep.
 */
export const SLICER_META_VERSION = 1

export interface GcodePurge {
  tool: number
  mm: number
  /** From the slicer's own diameter and density for that tool; null without them. */
  grams: number | null
}

export interface SlicerFileMeta
  extends Omit<GcodeMetadata, 'filamentCost'>, Omit<GcodeDetails, 'extents'> {
  /** Where extrusion happens: from the body when it was read, else Cura's header. */
  extents?: GcodeExtents
  /** Filament into towers and flushes, per tool. */
  purge?: GcodePurge[]
  /** All purge together: Prusa's own wipe-tower figure, or the sum of `purge`. */
  purgeG?: number
  /** What the full read found; absent when only the ends were read. */
  body?: GcodeBodyScan
}

export function buildSlicerFileMeta(
  head: string,
  tail: string,
  body: GcodeBodyScan | null,
): SlicerFileMeta {
  const { filamentCost: _cost, ...settings } = parseGcodeMetadata(head, tail)
  const { extents: headerExtents, ...details } = parseGcodeDetails(head, tail)
  const out: SlicerFileMeta = { ...settings, ...details }

  if (headerExtents) out.extents = headerExtents
  if (!body) return out

  // Which tools the body really selects settles which filaments are used.
  const filaments = readGcodeTools(head, tail, new Set(body.usedTools))
  if (filaments.length > 0) out.filaments = filaments

  // The slicer's count is what it shows its user; ours is the fallback.
  if (out.layerCount == null && body.layerCount != null) out.layerCount = body.layerCount
  // Where extrusion really reaches beats any summary of it.
  if (body.extents) out.extents = body.extents
  if (body.maxZMm != null) out.maxZMm = body.maxZMm

  const purge = body.purgeMm.map(({ tool, mm }) => ({
    tool,
    mm,
    grams: grams(
      mm,
      perTool(details.filamentDiametersMm, tool),
      perTool(details.filamentDensities, tool),
    ),
  }))
  if (purge.length > 0) out.purge = purge
  const computed = purge.every((entry) => entry.grams != null)
    ? purge.reduce((total, entry) => total + entry.grams!, 0)
    : null
  const purgeG = details.wipeTowerG ?? (purge.length > 0 ? computed : null)
  if (purgeG != null) out.purgeG = round(purgeG, 2)

  /*
   * Slicers that write M73 P without R leave elapsed time blank; the
   * percentage of the estimate is close enough to place an event.
   */
  const duration = out.totalDurationMin ?? out.durationMin
  const place = <T extends GcodeWhen>(event: T): T =>
    event.elapsedMin == null && event.progressPercent != null && duration != null
      ? { ...event, elapsedMin: Math.round((duration * event.progressPercent) / 100) }
      : event

  out.body = {
    ...body,
    pauses: body.pauses.map(place),
    toolChangeTimeline: body.toolChangeTimeline.map(place),
  }

  return out
}

/** A per-tool list's entry for one tool; a single entry applies to every tool. */
function perTool(values: number[] | undefined, tool: number): number | null {
  if (!values || values.length === 0) return null
  return values.length === 1 ? values[0]! : (values[tool] ?? null)
}

/** Millimetres of filament to grams, from its diameter (mm) and density (g/cm³). */
function grams(mm: number, diameter: number | null, density: number | null): number | null {
  if (diameter == null || density == null) return null
  const areaMm2 = Math.PI * (diameter / 2) ** 2
  return round(((mm * areaMm2) / 1000) * density, 2)
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
