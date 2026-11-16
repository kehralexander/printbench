import type { GcodeTool } from '../slicer/gcode-tools'

/**
 * The filaments a print request is made in, as rows: one per G-code tool once
 * there is a file, and before that whatever was asked for ("in red PLA").
 *
 * Pure and free of any database import, so the request form can merge a
 * chosen file's tools into its rows with the same rules the server uses.
 */

export interface RequestFilamentInput {
  /** G-code tool, T0 = 0; null for a wish made before there was a file. */
  tool?: number | null
  material?: string | null
  colorHex?: string | null
  colorName?: string | null
  /** The Spoolman spool, when Spoolman is the inventory. */
  spoolmanSpoolId?: number | null
  /** PrintBench's own spool, when it is the inventory. */
  spoolId?: string | null
  /** Grams for ONE print. */
  grams?: number | null
}

export interface RequestFilament {
  tool: number | null
  material: string | null
  colorHex: string | null
  colorName: string | null
  spoolmanSpoolId: number | null
  spoolId: string | null
  grams: number | null
}

export const MAX_FILAMENTS = 16
const MAX_FILAMENT_TEXT = 120
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class FilamentRowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilamentRowError'
  }
}

/**
 * Validates and tidies the rows as submitted. A row that says nothing at all
 * — no tool, no material, no colour, no spool, no grams — is dropped: an empty
 * list is "any filament", and so is a list of blanks.
 */
export function cleanFilaments(
  rows: readonly RequestFilamentInput[] | null | undefined,
): RequestFilament[] {
  if (!rows) return []
  if (!Array.isArray(rows)) throw new FilamentRowError('Filaments must be a list.')
  if (rows.length > MAX_FILAMENTS) {
    throw new FilamentRowError(`A request can use at most ${MAX_FILAMENTS} filaments.`)
  }

  const out: RequestFilament[] = []
  const tools = new Set<number>()
  for (const row of rows) {
    const tool = row.tool == null ? null : Number(row.tool)
    if (tool != null && (!Number.isInteger(tool) || tool < 0 || tool > 255)) {
      throw new FilamentRowError('That is not a tool number.')
    }
    if (tool != null) {
      if (tools.has(tool)) throw new FilamentRowError(`Tool T${tool} is listed twice.`)
      tools.add(tool)
    }
    const colorHex = row.colorHex ? String(row.colorHex) : null
    if (colorHex && !/^#[0-9a-f]{6}$/i.test(colorHex)) {
      throw new FilamentRowError('Colour must be a hex value like #1a2b3c.')
    }
    const spoolmanSpoolId = row.spoolmanSpoolId == null ? null : Number(row.spoolmanSpoolId)
    if (spoolmanSpoolId != null && (!Number.isInteger(spoolmanSpoolId) || spoolmanSpoolId < 1)) {
      throw new FilamentRowError('That is not a Spoolman spool.')
    }
    const spoolId = row.spoolId ? String(row.spoolId) : null
    if (spoolId && !UUID.test(spoolId)) throw new FilamentRowError('That is not a spool.')
    const grams = row.grams == null ? null : Number(row.grams)
    if (grams != null && (!Number.isFinite(grams) || grams < 0 || grams >= 100_000)) {
      throw new FilamentRowError('Filament grams must be between 0 and 100 kg.')
    }
    const cleaned: RequestFilament = {
      tool,
      material: text(row.material),
      colorHex: colorHex?.toLowerCase() ?? null,
      colorName: text(row.colorName),
      spoolmanSpoolId,
      spoolId,
      grams: grams == null ? null : Math.round(grams * 100) / 100,
    }
    if (isBlank(cleaned)) continue
    out.push(cleaned)
  }
  return out
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, MAX_FILAMENT_TEXT) : null
}

function isBlank(row: RequestFilament): boolean {
  return (
    row.tool == null &&
    row.material == null &&
    row.colorHex == null &&
    row.colorName == null &&
    row.spoolmanSpoolId == null &&
    row.spoolId == null &&
    row.grams == null
  )
}

/** Whether a row asks for a particular filament, rather than leaving it open. */
export function rowNamesFilament(row: RequestFilamentInput): boolean {
  return (
    row.spoolmanSpoolId != null ||
    row.spoolId != null ||
    Boolean(row.material) ||
    Boolean(row.colorHex)
  )
}

/**
 * The rows once a file is linked: one per tool the file uses, numbered and
 * weighed by it, carrying over what was asked for.
 *
 * What was asked for wins over what the file was sliced with — "in red" means
 * red, whatever colour the slicer profile happened to show. A row already on
 * a tool keeps it; wishes made before the file go to the tools in order when
 * there are as many of each. Otherwise a multi-colour file fills its rows in
 * from what it was sliced with, so each colour has something to match against.
 * A single-tool file does not: its sliced colour is usually just the profile's
 * default, and a wish of "any" should stay "any".
 *
 * Without tools — no file, or one the slicer said nothing about — the rows go
 * back to being wishes.
 */
export function mergeFilaments(
  existing: readonly RequestFilament[],
  tools: readonly GcodeTool[],
): RequestFilament[] {
  const used = tools.filter((tool) => tool.used)
  if (used.length === 0) {
    return existing.map((row) => ({
      ...row,
      tool: null,
      grams: tools.length > 0 ? row.grams : null,
    }))
  }

  const wishes = existing.filter((row) => row.tool == null)
  const onTool = new Map(existing.filter((row) => row.tool != null).map((row) => [row.tool!, row]))
  const byPosition = wishes.length === used.length

  if (used.length === 1) {
    const tool = used[0]!
    const keep = onTool.get(tool.tool) ?? wishes[0] ?? existing[0]
    return [
      {
        tool: tool.tool,
        material: keep?.material ?? null,
        colorHex: keep?.colorHex ?? null,
        colorName: keep?.colorName ?? null,
        spoolmanSpoolId: keep?.spoolmanSpoolId ?? null,
        spoolId: keep?.spoolId ?? null,
        grams: tool.grams,
      },
    ]
  }

  return used.map((tool, index) => {
    const keep = onTool.get(tool.tool) ?? (byPosition ? wishes[index] : undefined)
    if (keep && rowNamesFilament(keep)) {
      return { ...keep, tool: tool.tool, grams: tool.grams }
    }
    return {
      tool: tool.tool,
      material: tool.material,
      colorHex: tool.colorHex,
      colorName: keep?.colorName ?? null,
      spoolmanSpoolId: null,
      spoolId: null,
      grams: tool.grams,
    }
  })
}

/** Grams for one print across every filament; null when none is known. */
export function totalGrams(rows: readonly { grams: number | null }[]): number | null {
  const known = rows.filter((row) => row.grams != null)
  if (known.length === 0) return null
  return Math.round(known.reduce((sum, row) => sum + row.grams!, 0) * 100) / 100
}
