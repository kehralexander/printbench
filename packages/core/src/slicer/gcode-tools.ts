/**
 * The filaments a sliced file prints with, one per G-code tool.
 *
 * One reading for every caller — the queue, the slicer metadata and the
 * KX-Bridge send — so they always agree on what T1 is. It follows the way
 * KX-Bridge reads a file (gcode_meta._extract_filament_info), since that is
 * the reader a mismatch would hurt most: colours from `filament_colour`,
 * materials from `filament_type`, and a tool is in use when the body changes
 * to it — or, failing that, when the slicer gave it grams, or listed it in the
 * header's `; filament: 1,3`.
 *
 * Which tools the body changes to needs the whole file. That scan is the
 * caller's to make, once, and pass in: it is far too slow for a page render.
 */

export interface GcodeTool {
  /** T0 = 0. */
  tool: number
  material: string | null
  /** "#rrggbb" */
  colorHex: string | null
  /** Grams for one print, when the slicer wrote a figure per tool. */
  grams: number | null
  /** Whether the print actually uses it. */
  used: boolean
}

/** Grams lists, most specific first. Per-tool in Prusa, Orca and Bambu alike. */
const GRAMS_KEYS = ['filament used [g]', 'total filament weight [g]']

export function readGcodeTools(
  head: string,
  tail: string,
  /** Tools the body changes to, from `scanUsedTools`; omitted when not scanned. */
  usedTools?: ReadonlySet<number> | null,
): GcodeTool[] {
  let colours: string[] = []
  let materials: string[] = []
  let countHint = 0
  let toolOrder: number[] = []
  const grams = new Map<string, number[]>()

  for (const line of `${head}\n${tail}`.split(/\r?\n/)) {
    const value = (separator: string) => line.slice(line.indexOf(separator) + 1).trim()
    if (/^\s*;\s*filament_colour\s*=/.test(line)) {
      colours = list(value('='), /;/).map((colour) => colour.replace(/^#/, ''))
    } else if (/^\s*;\s*filament_multi_colour\s*=/.test(line) && colours.length === 0) {
      colours = list(value('='), /;/).map((colour) => colour.replace(/^#/, ''))
    } else if (/^\s*;\s*filament_type\s*=/.test(line)) {
      materials = list(value('='), /[;,]/)
      countHint = Math.max(countHint, materials.length)
    } else if (/^\s*;\s*filament_(density|diameter)\s*:/.test(line)) {
      countHint = Math.max(countHint, list(value(':'), /[;,]/).length)
    } else if (/^\s*;\s*filament\s*:/.test(line)) {
      const order = list(value(':'), /,/).map(Number).filter(Number.isInteger)
      if (order.length > 0) toolOrder = order
    } else {
      const match = /^\s*;\s*([a-z ]+\[g\])\s*[=:]\s*(.*)$/i.exec(line)
      const key = match?.[1]?.trim().toLowerCase()
      if (key && GRAMS_KEYS.includes(key)) {
        grams.set(
          key,
          list(match![2]!, /,/).map((part) => {
            const parsed = Number.parseFloat(part)
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
          }),
        )
      }
    }
  }

  let total = Math.max(colours.length, materials.length, countHint)
  if (toolOrder.length > 0) total = Math.max(total, ...toolOrder)
  if (total <= 0) return []

  /*
   * A list as long as the tools is per tool. A single figure for several tools
   * is the total, and splitting it would be a guess.
   */
  const perTool = GRAMS_KEYS.map((key) => grams.get(key)).find(
    (values) => values != null && (values.length === total || total === 1),
  )
  // Orca and Prusa number the header list from 1.
  const fromHeader = new Set(toolOrder.map((n) => Math.max(0, n - 1)))

  return Array.from({ length: total }, (_, tool) => {
    const g = perTool?.[tool]
    const toolGrams = g != null && Number.isFinite(g) ? g : null
    const colour = colours[tool]
    const material = materials[tool]
    return {
      tool,
      material: material && !isPlaceholder(material) ? material : null,
      colorHex:
        colour && /^[0-9a-f]{6}/i.test(colour) ? `#${colour.slice(0, 6).toLowerCase()}` : null,
      grams: toolGrams,
      used:
        usedTools && usedTools.size > 0
          ? usedTools.has(tool)
          : total === 1
            ? true
            : perTool
              ? (toolGrams ?? 0) > 0
              : fromHeader.size > 0
                ? fromHeader.has(tool)
                : true,
    }
  })
}

/** Tool changes in G-code text: every `T<n>` at the start of a line. */
export function scanUsedTools(text: string, into: Set<number> = new Set()): Set<number> {
  for (const match of text.matchAll(/^[ \t]*T(\d+)\b/gm)) into.add(Number(match[1]))
  return into
}

/**
 * The same over a stream, for files too big to hold as one string. Keeps the
 * unfinished last line of each chunk so a `T1` split across two is not lost.
 */
export async function scanUsedToolsStream(
  chunks: AsyncIterable<Uint8Array | string>,
): Promise<Set<number>> {
  const used = new Set<number>()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let carry = ''
  for await (const chunk of chunks) {
    const text =
      carry + (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
    const cut = text.lastIndexOf('\n')
    if (cut < 0) {
      carry = text
      continue
    }
    scanUsedTools(text.slice(0, cut), used)
    carry = text.slice(cut + 1)
  }
  scanUsedTools(carry + decoder.decode(), used)
  return used
}

function list(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((part) => part.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

function isPlaceholder(value: string): boolean {
  const text = value.trim().toLowerCase()
  return text === '' || text === 'undefine' || text === 'undefined' || text === 'unknown'
}
